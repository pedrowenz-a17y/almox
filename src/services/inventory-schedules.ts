import { requireAnyPermission } from "@/services/stock";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/http";
import {
  assertActiveLocation,
  findIdempotentResource,
  idempotencyKeySchema,
  payloadHash,
  requirePermission,
  serializable,
  type StockActor,
} from "@/services/stock";

const dueDate = z.string().datetime({ offset: true });
const assignee = z.string().uuid().nullable().optional();
export const inventoryScheduleSchema = z
  .object({
    title: z.string().trim().min(3).max(160),
    locationId: z.string().uuid(),
    intervalDays: z.number().int().min(1).max(365),
    nextDueAt: dueDate,
    assigneeId: assignee,
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();

export const inventoryScheduleUpdateSchema = z
  .object({
    intervalDays: z.number().int().min(1).max(365).optional(),
    nextDueAt: dueDate.optional(),
    assigneeId: assignee,
    active: z.boolean().optional(),
    note: z.string().trim().min(3).max(1000),
  })
  .strict()
  .refine(
    (input) =>
      ["intervalDays", "nextDueAt", "assigneeId", "active"].some(
        (key) => key in input,
      ),
    {
      message: "Informe a alteração da programação.",
    },
  );

const include = {
  location: { select: { id: true, code: true, name: true } },
  assignee: { select: { id: true, name: true } },
  lastCount: { select: { id: true, approvedAt: true } },
} satisfies Prisma.InventoryScheduleInclude;

async function assertAssignee(
  tx: Prisma.TransactionClient,
  unitId: string,
  assigneeId?: string | null,
) {
  if (!assigneeId) return;
  const membership = await tx.unitMembership.findFirst({
    where: { unitId, userId: assigneeId, active: true, user: { active: true } },
    select: { userId: true },
  });
  if (!membership)
    throw new AppError("Escolha um responsável ativo desta unidade.", 400);
}

export async function listInventorySchedules(actor: StockActor) {
  requireAnyPermission(actor, ["inventory:count", "inventory:read"]);
  const [items, total, memberships] = await Promise.all([
    prisma.inventorySchedule.findMany({
      where: { unitId: actor.unitId },
      include,
      orderBy: [{ active: "desc" }, { nextDueAt: "asc" }, { id: "asc" }],
      take: 1000,
    }),
    prisma.inventorySchedule.count({ where: { unitId: actor.unitId } }),
    actor.permissions.includes("inventory:adjust")
      ? prisma.unitMembership.findMany({
          where: { unitId: actor.unitId, active: true, user: { active: true } },
          select: { user: { select: { id: true, name: true } } },
          orderBy: { user: { name: "asc" } },
          take: 1001,
        })
      : Promise.resolve([]),
  ]);
  const pending = items.length
    ? await prisma.inventoryCount.findMany({
        where: {
          unitId: actor.unitId,
          status: "PENDING",
          OR: items.map((item) => ({
            scheduleId: item.id,
            scheduleDueAt: item.nextDueAt,
          })),
        },
        select: { id: true, scheduleId: true, createdAt: true },
        orderBy: { createdAt: "desc" },
      })
    : [];
  const bySchedule = new Map<string, { id: string; createdAt: Date }>();
  for (const count of pending)
    if (count.scheduleId && !bySchedule.has(count.scheduleId))
      bySchedule.set(count.scheduleId, count);
  return {
    items: items.map((item) => ({
      ...item,
      pendingCount: bySchedule.get(item.id) ?? null,
    })),
    total,
    truncated: total > items.length,
    assignees: memberships.slice(0, 1000).map((item) => item.user),
    assigneesTruncated: memberships.length > 1000,
    serverTime: new Date().toISOString(),
  };
}

export async function createInventorySchedule(
  actor: StockActor,
  rawInput: unknown,
) {
  requirePermission(actor, "inventory:adjust");
  const { idempotencyKey, ...parsed } = inventoryScheduleSchema.parse(rawInput);
  const input = { ...parsed, assigneeId: parsed.assigneeId ?? null };
  const hash = payloadHash(actor, "inventory-schedule", input);
  return serializable(async (tx) => {
    const previousId = await findIdempotentResource(
      tx,
      actor,
      idempotencyKey,
      hash,
      "inventory-schedule",
    );
    if (previousId) {
      const previous = await tx.inventorySchedule.findFirst({
        where: { id: previousId, unitId: actor.unitId },
        include,
      });
      if (!previous)
        throw new AppError("A programação anterior não está disponível.", 409);
      return previous;
    }
    await assertActiveLocation(tx, input.locationId, actor.unitId);
    await assertAssignee(tx, actor.unitId, input.assigneeId);
    const result = await tx.inventorySchedule.create({
      data: {
        ...input,
        nextDueAt: new Date(input.nextDueAt),
        unitId: actor.unitId,
        createdById: actor.id,
      },
      include,
    });
    await tx.auditLog.create({
      data: {
        unitId: actor.unitId,
        userId: actor.id,
        action: "INVENTORY_SCHEDULE_CREATED",
        entity: "InventorySchedule",
        entityId: result.id,
        after: { ...input, nextDueAt: result.nextDueAt.toISOString() },
      },
    });
    await tx.idempotencyRecord.create({
      data: {
        key: idempotencyKey,
        actorId: actor.id,
        unitId: actor.unitId,
        payloadHash: hash,
        resourceType: "inventory-schedule",
        resourceId: result.id,
      },
    });
    return result;
  });
}

export async function updateInventorySchedule(
  actor: StockActor,
  rawId: string,
  rawInput: unknown,
) {
  requirePermission(actor, "inventory:adjust");
  const id = z.string().uuid().parse(rawId);
  const { note, ...input } = inventoryScheduleUpdateSchema.parse(rawInput);
  return serializable(async (tx) => {
    const schedule = await tx.inventorySchedule.findFirst({
      where: { id, unitId: actor.unitId },
    });
    if (!schedule) throw new AppError("Programação não encontrada.", 404);
    await assertAssignee(tx, actor.unitId, input.assigneeId);
    if (input.active === true)
      await assertActiveLocation(tx, schedule.locationId, actor.unitId);
    const result = await tx.inventorySchedule.update({
      where: { id },
      data: {
        ...input,
        ...(input.nextDueAt ? { nextDueAt: new Date(input.nextDueAt) } : {}),
      },
      include,
    });
    await tx.auditLog.create({
      data: {
        unitId: actor.unitId,
        userId: actor.id,
        action: "INVENTORY_SCHEDULE_UPDATED",
        entity: "InventorySchedule",
        entityId: id,
        before: {
          intervalDays: schedule.intervalDays,
          nextDueAt: schedule.nextDueAt.toISOString(),
          active: schedule.active,
          assigneeId: schedule.assigneeId,
        },
        after: { ...input, note },
      },
    });
    return result;
  });
}
