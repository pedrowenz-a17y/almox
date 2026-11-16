import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/http";
import { canViewInventory } from "@/lib/access-profiles";
import {
  canViewManagement,
  canRecordManagement,
  MANAGEMENT_METRICS,
  type ManagementAreas,
  type ManagementMetrics,
} from "@/lib/management";
import {
  pendingSnapshot,
  type PendingType,
} from "@/services/operational-pending";
import { deliveryReceiptSnapshot } from "@/services/delivery-receipts";
import type { ReceiptStatus } from "@/lib/delivery-receipts";
import { validationPeriod } from "@/services/validation-report";
import {
  serializable,
  idempotencyKeySchema,
  payloadHash,
  findIdempotentResource,
  type StockActor,
  type StockTransaction,
} from "@/services/stock";

const metricKeys = MANAGEMENT_METRICS.map((m) => m.key) as [
  (typeof MANAGEMENT_METRICS)[number]["key"],
  ...(typeof MANAGEMENT_METRICS)[number]["key"][],
];
const bucket = z
  .object({
    count: z.number().int().nonnegative(),
    dated: z.number().int().nonnegative(),
    undated: z.number().int().nonnegative(),
    oldestAt: z.string().datetime().nullable(),
  })
  .strict();
const savedSchema = z
  .object({
    schemaVersion: z.literal(1),
    capturedAt: z.string().datetime(),
    areas: z.object({ orders: z.boolean(), inventory: z.boolean() }).strict(),
    coordinationReady: z.boolean(),
    metrics: z.record(z.enum(metricKeys), bucket.nullable()),
  })
  .strict();
const querySchema = z
  .object({
    units: z.string().max(200).optional(),
    from: z.string().optional(),
    to: z.string().optional(),
  })
  .strict();
const recordSchema = z
  .object({
    idempotencyKey: idempotencyKeySchema,
    expectedUnitId: z.string().uuid(),
  })
  .strict();
const dayOf = (now: Date) =>
  now.toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });

export function managementPeriod(
  raw: { from?: string; to?: string },
  now: Date,
) {
  const today = dayOf(now),
    from = new Date(Date.parse(today + "T12:00:00Z") - 13 * 86400000)
      .toISOString()
      .slice(0, 10);
  const period = validationPeriod(
    { from: raw.from ?? from, to: raw.to ?? today },
    now,
  );
  if (period.days > 31)
    throw new AppError(
      "Escolha até 31 dias para comparar as posições registradas.",
      400,
    );
  return {
    from: period.from,
    to: period.to,
    days: period.days,
    timezone: "America/Sao_Paulo",
  };
}
async function authorizedUnits(tx: StockTransaction, actor: StockActor) {
  if (!actor.unitId)
    throw new AppError("Selecione uma unidade autorizada.", 403);
  const members = await tx.unitMembership.findMany({
    where: {
      userId: actor.id,
      active: true,
      user: { active: true },
      unit: { active: true, organization: { active: true } },
    },
    select: {
      unit: { select: { id: true, code: true, name: true } },
      role: {
        select: {
          permissions: { select: { permission: { select: { key: true } } } },
        },
      },
    },
    orderBy: [{ unit: { code: "asc" } }, { unitId: "asc" }],
  });
  const allowed = members
    .map((m) => ({
      unit: m.unit,
      permissions: m.role.permissions.map((p) => p.permission.key),
    }))
    .filter((m) => canViewManagement(m.permissions));
  if (!allowed.some((m) => m.unit.id === actor.unitId))
    throw new AppError(
      "Seu perfil não permite consultar o painel gerencial nesta unidade.",
      403,
    );
  return allowed;
}
type AllowedUnit = Awaited<ReturnType<typeof authorizedUnits>>[number];
const areasFor = (p: string[]): ManagementAreas => ({
  orders: p.includes("orders:read"),
  inventory: canViewInventory(p),
});
async function currentPosition(
  tx: StockTransaction,
  actor: StockActor,
  allowed: AllowedUnit,
  now: Date,
) {
  const scoped = {
      ...actor,
      unitId: allowed.unit.id,
      permissions: allowed.permissions,
    },
    areas = areasFor(allowed.permissions);
  const pending = await pendingSnapshot(scoped, { pageSize: 1 }, tx, {
    management: true,
    now,
  });
  const receipts = areas.orders
    ? await deliveryReceiptSnapshot(scoped, { scope: "UNIT" }, tx, { now })
    : null;
  const metrics = Object.fromEntries(
    MANAGEMENT_METRICS.map((m) => [
      m.key,
      !areas[m.area]
        ? null
        : m.source === "PENDING"
          ? pending.management![m.key as PendingType]
          : receipts!.management![m.key.slice(8) as ReceiptStatus],
    ]),
  ) as ManagementMetrics;
  return {
    schemaVersion: 1 as const,
    capturedAt: now.toISOString(),
    areas,
    coordinationReady: pending.coordinationReady,
    metrics,
  };
}
function mask(
  saved: z.infer<typeof savedSchema>,
  currentAreas: ManagementAreas,
) {
  const areas = {
    orders: saved.areas.orders && currentAreas.orders,
    inventory: saved.areas.inventory && currentAreas.inventory,
  };
  return {
    capturedAt: saved.capturedAt,
    areas,
    metrics: Object.fromEntries(
      MANAGEMENT_METRICS.map((m) => [
        m.key,
        areas[m.area] ? saved.metrics[m.key] : null,
      ]),
    ) as ManagementMetrics,
  };
}
export async function managementReport(
  actor: StockActor,
  raw: unknown = {},
  now = new Date(),
) {
  const input = querySchema.parse(raw),
    period = managementPeriod(input, now),
    today = dayOf(now);
  return prisma.$transaction(
    async (tx) => {
      const allowed = await authorizedUnits(tx, actor);
      const selected = z
        .array(z.string().uuid())
        .min(1)
        .max(4)
        .parse(
          input.units === undefined ? [actor.unitId] : input.units.split(","),
        );
      if (
        new Set(selected).size !== selected.length ||
        !selected.includes(actor.unitId)
      )
        throw new AppError(
          "Inclua a unidade atual e selecione até quatro unidades distintas.",
          400,
        );
      if (selected.some((id) => !allowed.some((m) => m.unit.id === id)))
        throw new AppError(
          "Uma das unidades selecionadas não está autorizada para este painel.",
          403,
        );
      const units = [];
      for (const id of selected) {
        const member = allowed.find((m) => m.unit.id === id)!,
          current = await currentPosition(tx, actor, member, now);
        const logs = await tx.auditLog.findMany({
          where: {
            unitId: id,
            entity: "ManagementPosition",
            action: "MANAGEMENT_POSITION_CAPTURED",
            OR: [
              { entityId: { gte: period.from, lte: period.to } },
              { entityId: today },
            ],
          },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          take: 65,
        });
        const byDay = new Map<
          string,
          {
            id: string;
            day: string;
            capturedAt: string;
            areas: ManagementAreas;
            metrics: ManagementMetrics;
          }
        >();
        for (const log of logs) {
          const parsed = savedSchema.safeParse(log.after);
          if (
            !parsed.success ||
            byDay.has(log.entityId) ||
            !/^\d{4}-\d{2}-\d{2}$/.test(log.entityId)
          )
            continue;
          byDay.set(log.entityId, {
            id: log.id,
            day: log.entityId,
            ...mask(parsed.data, current.areas),
          });
        }
        const todayCapture = byDay.get(today);
        units.push({
          unit: member.unit,
          current,
          canRecord: canRecordManagement(member.permissions),
          todayCapture: todayCapture
            ? { id: todayCapture.id, capturedAt: todayCapture.capturedAt }
            : null,
          history: [...byDay.values()]
            .filter((p) => p.day >= period.from && p.day <= period.to)
            .sort((a, b) => a.day.localeCompare(b.day)),
          historyTruncated: logs.length === 65,
        });
      }
      return {
        generatedAt: now.toISOString(),
        currentUnitId: actor.unitId,
        period,
        today,
        availableUnits: allowed.map((m) => ({
          ...m.unit,
          areas: areasFor(m.permissions),
        })),
        units,
      };
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
      timeout: 30000,
    },
  );
}

export async function recordManagementPosition(
  actor: StockActor,
  raw: unknown,
  now = new Date(),
) {
  const input = recordSchema.parse(raw),
    hash = payloadHash(actor, "management:record", {}),
    day = dayOf(now);
  return serializable(async (tx) => {
    const allowed = await authorizedUnits(tx, actor),
      member = allowed.find((m) => m.unit.id === actor.unitId)!;
    if (input.expectedUnitId !== actor.unitId)
      throw new AppError(
        "A unidade ativa mudou. Atualize o painel antes de registrar a posição.",
        409,
        "UNIT_CHANGED",
      );
    if (!canRecordManagement(member.permissions))
      throw new AppError(
        "Seu perfil permite consultar, mas não registrar posições gerenciais.",
        403,
      );
    const previous = await findIdempotentResource(
      tx,
      actor,
      input.idempotencyKey,
      hash,
      "management-position",
    );
    if (previous) {
      const record = await tx.auditLog.findFirstOrThrow({
        where: {
          id: previous,
          unitId: actor.unitId,
          entity: "ManagementPosition",
        },
      });
      return {
        id: record.id,
        day: record.entityId,
        capturedAt: record.createdAt.toISOString(),
        created: false,
      };
    }
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`management:${actor.unitId}:${day}`},0))`;
    let log = await tx.auditLog.findFirst({
      where: {
        unitId: actor.unitId,
        entity: "ManagementPosition",
        entityId: day,
        action: "MANAGEMENT_POSITION_CAPTURED",
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    const created = !log;
    if (!log) {
      const snapshot = await currentPosition(tx, actor, member, now);
      log = await tx.auditLog.create({
        data: {
          unitId: actor.unitId,
          userId: actor.id,
          entity: "ManagementPosition",
          entityId: day,
          action: "MANAGEMENT_POSITION_CAPTURED",
          createdAt: now,
          after: snapshot as unknown as Prisma.InputJsonValue,
        },
      });
    }
    await tx.idempotencyRecord.create({
      data: {
        key: input.idempotencyKey,
        unitId: actor.unitId,
        actorId: actor.id,
        payloadHash: hash,
        resourceType: "management-position",
        resourceId: log.id,
      },
    });
    return {
      id: log.id,
      day: log.entityId,
      capturedAt: log.createdAt.toISOString(),
      created,
    };
  });
}
export type ManagementReport = Awaited<ReturnType<typeof managementReport>>;
