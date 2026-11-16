import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/http";
import { canActOnOrder } from "@/lib/access-profiles";
import type { QueueAge } from "@/lib/management";
import {
  RECEIPT_EVENT_TYPES,
  RECEIPT_LABELS,
  type DeliveryReceipt,
  type ReceiptHistory,
  type ReceiptStatus,
} from "@/lib/delivery-receipts";
import { activeMember } from "@/services/operational-coordination";
import {
  serializable,
  quantitySchema,
  idempotencyKeySchema,
  payloadHash,
  findIdempotentResource,
  type StockActor,
  type StockTransaction,
} from "@/services/stock";

function requireUnit(actor: StockActor) {
  if (!actor.unitId)
    throw new AppError("Selecione uma unidade autorizada.", 403);
}

const listSchema = z
  .object({
    scope: z.enum(["MINE", "UNIT"]).default("MINE"),
    status: z
      .enum(["ALL", ...(Object.keys(RECEIPT_LABELS) as ReceiptStatus[])])
      .default("ALL"),
    q: z.string().trim().max(100).default(""),
    page: z.coerce.number().int().min(1).max(1000000).default(1),
    deliveryId: z.string().uuid().optional(),
  })
  .strict();
const common = {
  expectedVersion: z.number().int().min(0).max(1000000),
  idempotencyKey: idempotencyKeySchema,
};
const note = z.string().trim().min(10).max(2000);
const responseSchema = z.discriminatedUnion("action", [
  z.object({ ...common, action: z.literal("CONFIRM") }).strict(),
  z
    .object({
      ...common,
      action: z.literal("DISPUTE"),
      receivedQuantity: quantitySchema(),
      materialMatches: z.boolean(),
      note,
    })
    .strict(),
  z
    .object({
      ...common,
      action: z.literal("PROPOSE"),
      note,
      reference: z.string().trim().min(3).max(200),
    })
    .strict(),
  z.object({ ...common, action: z.literal("ACCEPT"), note }).strict(),
  z.object({ ...common, action: z.literal("REJECT"), note }).strict(),
]);
type ResponseState = {
  deliveryEventId: string;
  schemaVersion: number;
  version: number;
  status: ReceiptStatus;
  receivedQuantity: string | null;
  materialMatches: boolean | null;
};

export async function receiptCandidates(actor: StockActor) {
  requireUnit(actor);
  const member = await activeMember(prisma, actor);
  if (!canActOnOrder(member.permissions, "APPLY"))
    throw new AppError(
      "Seu perfil não permite indicar destinatários de entregas.",
      403,
    );
  const members = await prisma.unitMembership.findMany({
    where: {
      unitId: actor.unitId,
      active: true,
      userId: { not: actor.id },
      user: { active: true, authUserId: { not: null } },
    },
    select: { user: { select: { id: true, name: true } } },
    orderBy: [{ user: { name: "asc" } }, { userId: "asc" }],
    take: 1001,
  });
  return {
    people: members.slice(0, 1000).map((m) => m.user),
    truncated: members.length > 1000,
  };
}

export async function deliveryReceiptSnapshot(
  actor: StockActor,
  raw: unknown,
  db: StockTransaction,
  management?: { now: Date },
) {
  const input = listSchema.parse(raw);
  if (input.scope === "UNIT" && !actor.permissions.includes("orders:read"))
    throw new AppError(
      "Seu perfil não permite acompanhar entregas de toda a unidade.",
      403,
    );
  const [result] = await db.$queryRaw<
    Array<{
      items: DeliveryReceipt[] | null;
      total: number;
      summary: Record<ReceiptStatus, number> | null;
      management?: Partial<Record<ReceiptStatus, QueueAge>>;
    }>
  >(Prisma.sql`
  WITH deliveries AS (
    SELECT e.id::text AS id, o.id::text AS "orderId", o.kind::text AS "orderKind", o.code AS "orderCode", o.title AS "orderTitle", o.status::text AS "orderStatus", m.id::text AS "materialId",
      COALESCE(e.metadata #>> '{handoff,itemSnapshot,productCode}', p."internalCode") AS "productCode",
      COALESCE(e.metadata #>> '{handoff,itemSnapshot,productName}', p.name) AS "productName",
      COALESCE(e.metadata #>> '{handoff,itemSnapshot,unit}', p.unit) AS unit,
      COALESCE(e.metadata #>> '{handoff,itemSnapshot,locationCode}', l.code) AS "locationCode",
      e.quantity::text AS "expectedQuantity", e."createdAt" AS "deliveredAt", e."userId"::text AS "deliveredById",
      COALESCE(e.metadata #>> '{handoff,deliveredByName}', sender.name) AS "deliveredByName",
      e.metadata #>> '{handoff,receivedByUserId}' AS "recipientId", e.metadata #>> '{handoff,receivedByName}' AS "recipientName",
      COALESCE(recipient.active AND membership.active AND recipient."authUserId" IS NOT NULL, false) AS "recipientActive",
      COALESCE(r.metadata->>'status', CASE WHEN e.metadata #>> '{handoff,receivedByUserId}' IS NULL THEN 'UNLINKED' ELSE 'PENDING' END) AS status,
      COALESCE((r.metadata->>'version')::integer,0) AS version, r.metadata->>'receivedQuantity' AS "receivedQuantity",
      (r.metadata->>'materialMatches')::boolean AS "materialMatches", r.note, r.reference, r."createdAt" AS "respondedAt"
      ${management ? Prisma.sql`, CASE WHEN COALESCE(r.metadata->>'status','PENDING') IN ('DISPUTED','PROPOSED') THEN r."createdAt" ELSE e."createdAt" END AS "waitingSince"` : Prisma.empty}
    FROM "OrderEvent" e JOIN "WorkOrder" o ON o.id=e."orderId" AND o."unitId"=e."unitId"
    JOIN "OrderMaterial" m ON m.id=e."materialId" AND m."unitId"=e."unitId"
    JOIN "Product" p ON p.id=m."productId" AND p."unitId"=e."unitId"
    JOIN "Location" l ON l.id=m."locationId" AND l."unitId"=e."unitId"
    JOIN "User" sender ON sender.id=e."userId"
    LEFT JOIN "User" recipient ON recipient.id::text=e.metadata #>> '{handoff,receivedByUserId}'
    LEFT JOIN "UnitMembership" membership ON membership."userId"=recipient.id AND membership."unitId"=e."unitId"
    LEFT JOIN LATERAL (SELECT r.metadata,r.note,r.reference,r."createdAt" FROM "OrderEvent" r
      WHERE r."unitId"=e."unitId" AND r."orderId"=e."orderId" AND r."materialId"=e."materialId"
        AND r.type IN (${Prisma.join([...RECEIPT_EVENT_TYPES])}) AND r.metadata->>'deliveryEventId'=e.id::text
      ORDER BY (r.metadata->>'version')::integer DESC, r."createdAt" DESC, r.id DESC LIMIT 1) r ON true
    WHERE e."unitId"=${actor.unitId}::uuid AND e.type='APPLIED'
      AND ${input.scope === "MINE" ? Prisma.sql`e.metadata #>> '{handoff,receivedByUserId}'=${actor.id}` : Prisma.sql`true`}
      AND ${input.deliveryId ? Prisma.sql`e.id=${input.deliveryId}::uuid` : Prisma.sql`true`}
  ), filtered AS (SELECT * FROM deliveries WHERE (${input.status}='ALL' OR status=${input.status})
      AND (${input.q}='' OR "orderCode" ILIKE ${"%" + input.q + "%"} OR "productCode" ILIKE ${"%" + input.q + "%"} OR "productName" ILIKE ${"%" + input.q + "%"})),
  page AS (SELECT * FROM filtered ORDER BY "deliveredAt" DESC,id DESC LIMIT 25 OFFSET ${(input.page - 1) * 25}),
  totals AS (SELECT status,count(*)::integer AS count FROM deliveries GROUP BY status)
  SELECT (SELECT jsonb_agg(page ORDER BY "deliveredAt" DESC,id DESC) FROM page) AS items,
    (SELECT count(*)::integer FROM filtered) AS total, (SELECT jsonb_object_agg(status,count) FROM totals) AS summary
    ${
      management
        ? Prisma.sql`, (SELECT jsonb_object_agg(status,jsonb_build_object('count',total,'dated',dated,'undated',total-dated,'oldestAt',oldest)) FROM (
      SELECT status,count(*)::integer AS total,count(*) FILTER(WHERE "waitingSince"<=${management.now})::integer AS dated,
        min("waitingSince") FILTER(WHERE "waitingSince"<=${management.now}) AS oldest FROM deliveries GROUP BY status) ages) AS management`
        : Prisma.empty
    }
  `);
  const utc = (value: string) =>
    new Date(
      /[zZ]|[+-]\d{2}:?\d{2}$/.test(value) ? value : value + "Z",
    ).toISOString();
  return {
    ...(management
      ? {
          management: Object.fromEntries(
            Object.keys(RECEIPT_LABELS).map((key) => {
              const metric = result?.management?.[key as ReceiptStatus] ?? {
                count: 0,
                dated: 0,
                undated: 0,
                oldestAt: null,
              };
              return [
                key,
                {
                  ...metric,
                  oldestAt: metric.oldestAt ? utc(metric.oldestAt) : null,
                },
              ];
            }),
          ) as Record<ReceiptStatus, QueueAge>,
        }
      : {}),
    items: (result?.items ?? []).map((item) => ({
      ...item,
      deliveredAt: utc(item.deliveredAt),
      respondedAt: item.respondedAt ? utc(item.respondedAt) : null,
      canRespond:
        item.recipientActive &&
        item.recipientId === actor.id &&
        item.deliveredById !== actor.id,
      canTreat:
        actor.permissions.includes("orders:read") &&
        canActOnOrder(actor.permissions, "APPLY") &&
        item.recipientId !== actor.id,
    })),
    total: result?.total ?? 0,
    page: input.page,
    pageSize: 25,
    summary: Object.fromEntries(
      Object.keys(RECEIPT_LABELS).map((key) => [
        key,
        result?.summary?.[key as ReceiptStatus] ?? 0,
      ]),
    ) as Record<ReceiptStatus, number>,
    canMonitor: actor.permissions.includes("orders:read"),
    serverTime: new Date().toISOString(),
  };
}

export async function listDeliveryReceipts(
  actor: StockActor,
  raw: unknown = {},
) {
  requireUnit(actor);
  return prisma.$transaction(
    async (tx) => {
      const member = await activeMember(tx, actor);
      return deliveryReceiptSnapshot(
        { ...actor, permissions: member.permissions },
        raw,
        tx,
      );
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
      timeout: 15000,
    },
  );
}
async function scopedDelivery(
  tx: StockTransaction,
  actor: StockActor,
  id: string,
) {
  const result = await deliveryReceiptSnapshot(
    actor,
    {
      scope: actor.permissions.includes("orders:read") ? "UNIT" : "MINE",
      deliveryId: id,
    },
    tx,
  );
  if (!result.items[0])
    throw new AppError(
      "Entrega não encontrada ou não disponível para sua conta nesta unidade.",
      404,
    );
  return result.items[0];
}
export async function getDeliveryReceipt(actor: StockActor, rawId: string) {
  requireUnit(actor);
  const id = z.string().uuid().parse(rawId);
  return prisma.$transaction(
    async (tx) => {
      const member = await activeMember(tx, actor),
        fresh = { ...actor, permissions: member.permissions };
      const item = await scopedDelivery(tx, fresh, id);
      const events = await tx.orderEvent.findMany({
        where: {
          unitId: actor.unitId,
          orderId: item.orderId,
          materialId: item.materialId,
          type: { in: [...RECEIPT_EVENT_TYPES] },
          metadata: { path: ["deliveryEventId"], equals: id },
        },
        select: {
          id: true,
          type: true,
          createdAt: true,
          note: true,
          reference: true,
          metadata: true,
          user: { select: { id: true, name: true } },
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 101,
      });
      return {
        item,
        history: events.slice(0, 100).map((row) => {
          const state = row.metadata as unknown as ResponseState;
          return {
            id: row.id,
            type: row.type,
            createdAt: row.createdAt.toISOString(),
            user: row.user,
            note: row.note,
            reference: row.reference,
            receivedQuantity: state.receivedQuantity,
            materialMatches: state.materialMatches,
          } satisfies ReceiptHistory;
        }),
        truncated: events.length > 100,
      };
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
      timeout: 15000,
    },
  );
}

export async function respondToDelivery(
  actor: StockActor,
  rawId: string,
  raw: unknown,
) {
  requireUnit(actor);
  const id = z.string().uuid().parse(rawId),
    input = responseSchema.parse(raw),
    hash = payloadHash(actor, "delivery:response", { id, ...input });
  return serializable(async (tx) => {
    const member = await activeMember(tx, actor),
      fresh = { ...actor, permissions: member.permissions };
    const item = await scopedDelivery(tx, fresh, id);
    if (input.action === "PROPOSE" ? !item.canTreat : !item.canRespond)
      throw new AppError(
        input.action === "PROPOSE"
          ? "Seu perfil não permite propor o tratamento desta entrega."
          : "Somente o destinatário indicado, em conta diferente da de quem entregou, pode responder.",
        403,
      );
    const previous = await findIdempotentResource(
      tx,
      actor,
      input.idempotencyKey,
      hash,
      "delivery-response",
    );
    if (previous) {
      const saved = await tx.orderEvent.findFirstOrThrow({
        where: { id: previous, unitId: actor.unitId, userId: actor.id },
      });
      const state = saved.metadata as unknown as ResponseState;
      return {
        eventId: saved.id,
        version: state.version,
        status: state.status,
      };
    }
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`delivery:${actor.unitId}:${id}`},0))`;
    if (item.version !== input.expectedVersion)
      throw new AppError(
        "Esta entrega recebeu outra resposta. Atualize antes de continuar.",
        409,
        "DELIVERY_CHANGED",
      );
    let status: ReceiptStatus, type: string;
    let receivedQuantity = item.receivedQuantity,
      materialMatches = item.materialMatches;
    if (input.action === "CONFIRM" || input.action === "DISPUTE") {
      if (item.status !== "PENDING")
        throw new AppError(
          "O recebimento já possui uma resposta. Consulte o histórico.",
          409,
        );
      status = input.action === "CONFIRM" ? "CONFIRMED" : "DISPUTED";
      type =
        input.action === "CONFIRM" ? "DELIVERY_CONFIRMED" : "DELIVERY_DISPUTED";
      receivedQuantity =
        input.action === "CONFIRM"
          ? item.expectedQuantity
          : input.receivedQuantity;
      materialMatches =
        input.action === "CONFIRM" ? true : input.materialMatches;
      if (
        input.action === "DISPUTE" &&
        materialMatches &&
        new Prisma.Decimal(receivedQuantity!).eq(item.expectedQuantity)
      )
        throw new AppError(
          "Informe uma diferença de quantidade ou material para registrar a divergência.",
          400,
        );
    } else if (input.action === "PROPOSE") {
      if (item.status !== "DISPUTED")
        throw new AppError(
          "A entrega não tem uma divergência aguardando tratamento.",
          409,
        );
      status = "PROPOSED";
      type = "DELIVERY_TREATMENT_PROPOSED";
    } else {
      if (item.status !== "PROPOSED")
        throw new AppError("Não há tratamento aguardando seu aceite.", 409);
      status = input.action === "ACCEPT" ? "RESOLVED" : "DISPUTED";
      type =
        input.action === "ACCEPT"
          ? "DELIVERY_TREATMENT_ACCEPTED"
          : "DELIVERY_TREATMENT_REJECTED";
    }
    const state: ResponseState = {
      schemaVersion: 1,
      deliveryEventId: id,
      version: item.version + 1,
      status,
      receivedQuantity,
      materialMatches,
    };
    const record = await tx.orderEvent.create({
      data: {
        unitId: actor.unitId,
        orderId: item.orderId,
        materialId: item.materialId,
        userId: actor.id,
        type,
        createdAt: new Date(
          Math.max(
            Date.now(),
            new Date(item.respondedAt ?? item.deliveredAt).getTime() + 1,
          ),
        ),
        note:
          "note" in input
            ? input.note
            : "Recebimento integral e material conferidos pelo destinatário na própria conta.",
        reference: "reference" in input ? input.reference : "",
        metadata: state as unknown as Prisma.InputJsonValue,
      },
    });
    await tx.auditLog.create({
      data: {
        unitId: actor.unitId,
        userId: actor.id,
        entity: "WorkOrder",
        entityId: item.orderId,
        action: type,
        after: {
          eventId: record.id,
          ...state,
        } as unknown as Prisma.InputJsonValue,
      },
    });
    await tx.idempotencyRecord.create({
      data: {
        key: input.idempotencyKey,
        unitId: actor.unitId,
        actorId: actor.id,
        payloadHash: hash,
        resourceType: "delivery-response",
        resourceId: record.id,
      },
    });
    return { eventId: record.id, version: state.version, status };
  });
}
