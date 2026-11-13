import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/http";
import { canViewInventory } from "@/lib/access-profiles";
import type {
  AlertSnapshot,
  AlertHistoryStatus,
} from "@/lib/operational-alerts";
import { activeMember } from "@/services/operational-coordination";
import {
  pendingSnapshot,
  pendingTypes,
  type PendingItem,
} from "@/services/operational-pending";
import {
  serializable,
  idempotencyKeySchema,
  payloadHash,
  findIdempotentResource,
  type StockActor,
  type StockTransaction,
} from "@/services/stock";
const inputSchema = z
  .object({
    pendingId: z
      .string()
      .regex(
        /^[0-9a-f-]{36}:(UNAPPLIED|RESERVED|AWAITING_INVOICE|RETURN|COUNT|SCHEDULE)$/,
      ),
    alertKey: z.string().regex(/^[a-f0-9]{64}$/),
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();
const readSchema = z
  .object({
    type: z.enum(["ALL", ...pendingTypes]).default("ALL"),
    focus: z
      .enum(["ALL", "MINE", "UNASSIGNED", "OVERDUE", "TODAY"])
      .default("ALL"),
    read: z.enum(["ALL", "UNREAD", "READ"]).default("ALL"),
    page: z.coerce.number().int().min(1).max(1000000).default(1),
  })
  .strict();
export const canReadOperationalAlerts = (permissions: readonly string[]) =>
  permissions.includes("orders:read") || canViewInventory(permissions);
function authorize(actor: StockActor) {
  if (!actor.unitId || !canReadOperationalAlerts(actor.permissions))
    throw new AppError("Seu perfil não permite consultar estes alertas.", 403);
}
const typesFor = (actor: StockActor) =>
  pendingTypes.filter((type) =>
    ["COUNT", "SCHEDULE"].includes(type)
      ? canViewInventory(actor.permissions)
      : actor.permissions.includes("orders:read"),
  );
function snapshot(item: PendingItem): AlertSnapshot {
  return {
    id: item.id,
    type: item.type,
    occurrenceKey: item.occurrenceKey,
    orderId: item.orderId,
    orderKind: item.orderKind,
    code: item.code,
    title: item.title,
    productCode: item.productCode,
    productName: item.productName,
    locationCode: item.locationCode,
    quantity: item.quantity,
    unit: item.unit,
    assigneeId: item.assigneeId,
    assigneeName: item.assigneeName,
    dueAt: item.dueAt,
  };
}
export async function listOperationalAlerts(
  actor: StockActor,
  raw: unknown = {},
) {
  authorize(actor);
  const { read, ...query } = readSchema.parse(raw);
  return prisma.$transaction(
    async (tx) => {
      const page = await pendingSnapshot(
        actor,
        { ...query, pageSize: 25 },
        tx,
        { alerts: { read } },
      );
      return {
        ...page,
        items: page.items.map((item) => ({
          ...item,
          alertKey: item.alertKey!,
          readAt: item.readAt ?? null,
        })),
        summary: page.alertSummary!,
      };
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
      timeout: 15000,
    },
  );
}
export async function markOperationalAlertRead(
  actor: StockActor,
  raw: unknown,
) {
  authorize(actor);
  const input = inputSchema.parse(raw);
  const hash = payloadHash(actor, "operational-alert:read", input);
  return serializable(async (tx) => {
    const member = await activeMember(tx, actor);
    authorize({ ...actor, permissions: member.permissions });
    const previous = await findIdempotentResource(
      tx,
      actor,
      input.idempotencyKey,
      hash,
      "alert-read",
    );
    if (previous) {
      const log = await tx.auditLog.findFirstOrThrow({
        where: {
          id: previous,
          unitId: actor.unitId,
          userId: actor.id,
          entity: "OperationalAlert",
        },
      });
      const saved = log.after as unknown as { item: AlertSnapshot };
      if (
        !typesFor({ ...actor, permissions: member.permissions }).includes(
          saved.item.type,
        )
      )
        throw new AppError("Seu perfil não permite consultar este aviso.", 403);
      return { readAt: log.createdAt.toISOString(), alertKey: log.entityId };
    }
    const current = await pendingSnapshot(
      { ...actor, permissions: member.permissions },
      { pageSize: 1 },
      tx,
      { id: input.pendingId, alerts: { read: "ALL" } },
    );
    const item = current.items[0];
    if (!item)
      throw new AppError(
        "O aviso não está mais disponível nesta unidade ou área. Atualize a central.",
        404,
      );
    if (item.alertKey !== input.alertKey)
      throw new AppError(
        "A quantidade, o prazo, o responsável ou o ciclo do aviso mudou. Atualize a central antes de marcar a leitura.",
        409,
        "ALERT_CHANGED",
      );
    const lock = `alert-read:${actor.unitId}:${actor.id}:${input.alertKey}`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lock},0))`;
    let log = await tx.auditLog.findFirst({
      where: {
        unitId: actor.unitId,
        userId: actor.id,
        entity: "OperationalAlert",
        entityId: input.alertKey,
        action: "OPERATIONAL_ALERT_READ",
      },
    });
    if (!log)
      log = await tx.auditLog.create({
        data: {
          unitId: actor.unitId,
          userId: actor.id,
          entity: "OperationalAlert",
          entityId: input.alertKey,
          action: "OPERATIONAL_ALERT_READ",
          after: {
            schemaVersion: 1,
            alertKey: input.alertKey,
            item: snapshot(item),
          } as unknown as Prisma.InputJsonValue,
        },
      });
    await tx.idempotencyRecord.create({
      data: {
        key: input.idempotencyKey,
        unitId: actor.unitId,
        actorId: actor.id,
        payloadHash: hash,
        resourceType: "alert-read",
        resourceId: log.id,
      },
    });
    return { readAt: log.createdAt.toISOString(), alertKey: input.alertKey };
  });
}
type HistoryFacts = Awaited<ReturnType<typeof historyFacts>>;
async function historyFacts(
  tx: StockTransaction,
  actor: StockActor,
  entries: Array<{ id: string; item: AlertSnapshot }>,
) {
  const ids = (type: string) =>
    entries
      .filter((entry) => entry.item.type === type)
      .map((entry) => entry.item.id.split(":")[0]);
  const materialIds = entries
    .filter((entry) => !["COUNT", "SCHEDULE"].includes(entry.item.type))
    .map((entry) => entry.item.id.split(":")[0]);
  const returnLogs = entries
    .filter((entry) => entry.item.type === "RETURN")
    .map((entry) => entry.id);
  const scheduleCycles = entries
    .filter((entry) => entry.item.type === "SCHEDULE" && entry.item.dueAt)
    .map((entry) => ({
      scheduleId: entry.item.id.split(":")[0],
      scheduleDueAt: new Date(entry.item.dueAt!),
    }));
  const [counts, schedules, materials, returns] = await Promise.all([
    tx.inventoryCount.findMany({
      where: {
        unitId: actor.unitId,
        OR: [
          { id: { in: ids("COUNT") } },
          ...(scheduleCycles.length
            ? [{ status: "APPROVED" as const, OR: scheduleCycles }]
            : []),
        ],
      },
      select: { id: true, status: true, scheduleId: true, scheduleDueAt: true },
    }),
    tx.inventorySchedule.findMany({
      where: { unitId: actor.unitId, id: { in: ids("SCHEDULE") } },
      select: {
        id: true,
        active: true,
      },
    }),
    tx.orderMaterial.findMany({
      where: { unitId: actor.unitId, id: { in: materialIds } },
      select: {
        id: true,
        pendingReturnQuantity: true,
        order: { select: { status: true } },
      },
    }),
    returnLogs.length
      ? tx.$queryRaw<
          Array<{ id: string; type: string | null; reopened: boolean }>
        >(Prisma.sql`
 SELECT a.id, returned.type, EXISTS(SELECT 1 FROM "OrderEvent" e WHERE e."unitId"=${actor.unitId}::uuid
   AND e."materialId"=split_part(a."after" #>> '{item,id}',':',1)::uuid AND e."createdAt">a."createdAt" AND e.metadata->'pendingOpened' ? 'RETURN') AS reopened
 FROM "AuditLog" a LEFT JOIN LATERAL(SELECT e.type FROM "OrderEvent" e WHERE e."unitId"=${actor.unitId}::uuid
   AND e."materialId"=split_part(a."after" #>> '{item,id}',':',1)::uuid AND e."createdAt">=a."createdAt"
   AND e.type IN ('RETURNED_BEFORE_INVOICE','RETURNED_AFTER_INVOICE','RETURN_REQUEST_CANCELLED') ORDER BY e."createdAt" DESC,e.id DESC LIMIT 1) returned ON true
 WHERE a."unitId"=${actor.unitId}::uuid AND a."userId"=${actor.id}::uuid AND a.id IN (${Prisma.join(returnLogs.map((id) => Prisma.sql`${id}::uuid`))})`)
      : Promise.resolve([]),
  ]);
  return {
    counts: new Map(counts.map((row) => [row.id, row])),
    approvedCycles: new Set(
      counts
        .filter(
          (row) =>
            row.status === "APPROVED" && row.scheduleId && row.scheduleDueAt,
        )
        .map((row) => `${row.scheduleId}:${row.scheduleDueAt!.toISOString()}`),
    ),
    schedules: new Map(schedules.map((row) => [row.id, row])),
    materials: new Map(materials.map((row) => [row.id, row])),
    returns: new Map(returns.map((row) => [row.id, row])),
  };
}
function sourceState(
  facts: HistoryFacts,
  logId: string,
  item: AlertSnapshot,
): { status: AlertHistoryStatus; reason: string } {
  const [id] = item.id.split(":");
  if (item.type === "COUNT") {
    const source = facts.counts.get(id);
    if (!source)
      return {
        status: "UNAVAILABLE",
        reason: "A contagem não está disponível nesta unidade.",
      };
    return source.status === "APPROVED"
      ? { status: "REGULARIZED", reason: "A contagem foi aprovada no sistema." }
      : source.status === "REJECTED"
        ? {
            status: "CLOSED",
            reason: "A contagem foi encerrada sem aprovação.",
          }
        : {
            status: "UNAVAILABLE",
            reason: "A contagem ainda aguarda conferência. Atualize a fila.",
          };
  }
  if (item.type === "SCHEDULE") {
    const source = facts.schedules.get(id);
    if (!source)
      return {
        status: "UNAVAILABLE",
        reason: "A agenda não está disponível nesta unidade.",
      };
    if (facts.approvedCycles.has(`${id}:${item.dueAt}`))
      return {
        status: "REGULARIZED",
        reason: "O ciclo da agenda foi concluído por uma contagem aprovada.",
      };
    return {
      status: source.active ? "UPDATED" : "CLOSED",
      reason: source.active
        ? "A agenda foi reprogramada; confira o novo vencimento."
        : "A programação foi desativada.",
    };
  }
  const source = facts.materials.get(id);
  if (!source)
    return {
      status: "UNAVAILABLE",
      reason: "O material ou a ordem não está disponível nesta unidade.",
    };
  if (source.order.status === "CANCELLED")
    return {
      status: "CLOSED",
      reason: "A ordem foi cancelada. Consulte o histórico da operação.",
    };
  if (item.type === "AWAITING_INVOICE" && source.order.status === "INVOICED")
    return {
      status: "REGULARIZED",
      reason: "O faturamento da ordem foi confirmado.",
    };
  if (item.type === "RETURN" && source.pendingReturnQuantity.eq(0)) {
    const result = facts.returns.get(logId);
    if (result?.reopened)
      return {
        status: "CLOSED",
        reason:
          "Houve outro ciclo de devolução após este aviso. Consulte os eventos da ordem.",
      };
    if (result?.type?.startsWith("RETURNED_"))
      return {
        status: "REGULARIZED",
        reason: "O recebimento da devolução foi registrado.",
      };
    return {
      status: "CLOSED",
      reason:
        "A solicitação de devolução foi encerrada; confira os eventos da ordem.",
    };
  }
  return {
    status: "CLOSED",
    reason:
      "Esta etapa não aparece mais na fila. Consulte a operação para verificar como foi encerrada.",
  };
}
export async function operationalAlertHistory(actor: StockActor) {
  authorize(actor);
  return prisma.$transaction(
    async (tx) => {
      const logs = await tx.auditLog.findMany({
        where: {
          unitId: actor.unitId,
          userId: actor.id,
          entity: "OperationalAlert",
          action: "OPERATIONAL_ALERT_READ",
          AND: [
            {
              OR: typesFor(actor).map((type) => ({
                after: { path: ["item", "type"], equals: type },
              })),
            },
          ],
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 51,
      });
      const selected = logs.slice(0, 50);
      const ids = [
        ...new Set(
          selected.map(
            (log) => (log.after as unknown as { item: AlertSnapshot }).item.id,
          ),
        ),
      ];
      const currentPage = ids.length
        ? await pendingSnapshot(actor, { pageSize: 100 }, tx, {
            ids,
            alerts: { read: "ALL" },
          })
        : null;
      const currentMap = new Map(
        currentPage?.items.map((item) => [item.id, item]) ?? [],
      );
      const facts = await historyFacts(
        tx,
        actor,
        selected.map((log) => ({
          id: log.id,
          item: (log.after as unknown as { item: AlertSnapshot }).item,
        })),
      );
      const items = [];
      for (const log of selected) {
        const saved = log.after as unknown as { item: AlertSnapshot };
        const current = currentMap.get(saved.item.id);
        const state = current
          ? current.alertKey === log.entityId
            ? {
                status: "PENDING" as const,
                reason:
                  "A leitura foi registrada, mas a operação continua pendente.",
              }
            : {
                status: "UPDATED" as const,
                reason:
                  current.occurrenceKey !== saved.item.occurrenceKey
                    ? "Há um novo ciclo desta pendência. O novo aviso precisa ser conferido."
                    : "Os dados ou a prioridade mudaram. Confira o aviso atual.",
              }
          : sourceState(facts, log.id, saved.item);
        items.push({
          id: log.id,
          alertKey: log.entityId,
          readAt: log.createdAt.toISOString(),
          item: saved.item,
          ...state,
        });
      }
      return {
        items,
        truncated: logs.length > 50,
        generatedAt: new Date().toISOString(),
      };
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
      timeout: 20000,
    },
  );
}
