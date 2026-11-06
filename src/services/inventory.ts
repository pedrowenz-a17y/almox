import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/http";
import {
  assertActiveLocation,
  assertActiveProduct,
  assertQuantityRange,
  availability,
  findIdempotentResource,
  idempotencyKeySchema,
  payloadHash,
  quantitySchema,
  requirePermission,
  serializable,
  type StockActor,
  writeBalance,
} from "@/services/stock";

export const inventorySchema = z
  .object({
    locationId: z.string().uuid(),
    scheduleId: z.string().uuid().optional(),
    allowEarly: z.boolean().optional(),
    items: z
      .array(
        z
          .object({
            productId: z.string().uuid(),
            expectedQuantity: quantitySchema({ signed: true }),
            countedQuantity: quantitySchema(),
          })
          .strict(),
      )
      .min(1, "Informe ao menos um produto contado.")
      .max(1000),
    note: z
      .string()
      .trim()
      .min(3, "Informe o motivo ou observação da contagem.")
      .max(2000),
    idempotencyKey: idempotencyKeySchema,
  })
  .strict()
  .superRefine((input, context) => {
    if (
      new Set(input.items.map((item) => item.productId)).size !==
      input.items.length
    ) {
      context.addIssue({
        code: "custom",
        path: ["items"],
        message: "Um produto não pode aparecer duas vezes na contagem.",
      });
    }
  });

export const countInclude = {
  location: true,
  user: { select: { id: true, name: true } },
  approvedBy: { select: { id: true, name: true } },
  items: {
    include: {
      product: {
        select: { id: true, name: true, internalCode: true, unit: true },
      },
    },
  },
} satisfies Prisma.InventoryCountInclude;

export async function getInventoryCount(actor: StockActor, rawId: string) {
  requirePermission(actor, "inventory:count");
  const id = z.string().uuid().parse(rawId);
  const count = await prisma.inventoryCount.findFirst({
    where: { id, unitId: actor.unitId },
    include: countInclude,
  });
  if (!count) throw new AppError("Contagem não encontrada.", 404);
  return count;
}

function staleCount() {
  return new AppError(
    "O estoque desta localização mudou desde a contagem. Atualize os saldos e registre uma nova contagem.",
    409,
  );
}

/** A physical count is a proposal. Only a separately authorized approval changes stock. */
export async function createInventoryCount(
  actor: StockActor,
  rawInput: unknown,
) {
  requirePermission(actor, "inventory:count");
  const parsed = inventorySchema.parse(rawInput);
  const input = {
    locationId: parsed.locationId,
    ...(parsed.scheduleId
      ? {
          scheduleId: parsed.scheduleId,
          allowEarly: parsed.allowEarly ?? false,
        }
      : {}),
    note: parsed.note,
    items: [...parsed.items].sort((a, b) =>
      a.productId.localeCompare(b.productId),
    ),
  };
  const hash = payloadHash(actor, "inventory", input);
  return serializable(async (tx) => {
    const previousId = await findIdempotentResource(
      tx,
      actor,
      parsed.idempotencyKey,
      hash,
      "inventory",
    );
    if (previousId) {
      const previous = await tx.inventoryCount.findUnique({
        where: { id: previousId, unitId: actor.unitId },
        include: countInclude,
      });
      if (!previous)
        throw new AppError(
          "A contagem anterior não está disponível. Consulte o histórico.",
          409,
        );
      return previous;
    }

    await assertActiveLocation(tx, input.locationId, actor.unitId);
    const schedule = input.scheduleId
      ? await tx.inventorySchedule.findFirst({
          where: {
            id: input.scheduleId,
            unitId: actor.unitId,
            locationId: input.locationId,
            active: true,
          },
        })
      : null;
    if (input.scheduleId && !schedule)
      throw new AppError(
        "A programação está inativa, mudou de local ou não pertence a esta unidade.",
        409,
      );
    if (
      schedule &&
      schedule.nextDueAt.getTime() > Date.now() &&
      !input.allowEarly
    )
      throw new AppError(
        "Esta conferência ainda não venceu. Confirme explicitamente a antecipação para registrá-la.",
        409,
      );
    if (
      schedule &&
      (await tx.inventoryCount.findFirst({
        where: {
          unitId: actor.unitId,
          scheduleId: schedule.id,
          scheduleDueAt: schedule.nextDueAt,
          status: "PENDING",
        },
        select: { id: true },
      }))
    )
      throw new AppError(
        "Este ciclo já tem uma contagem aguardando aprovação. Se ela estiver desatualizada, um supervisor deve encerrá-la antes da recontagem.",
        409,
      );
    const balances = await tx.inventoryBalance.findMany({
      where: { locationId: input.locationId, unitId: actor.unitId },
    });
    const byProduct = new Map(
      balances.map((balance) => [balance.productId, balance]),
    );
    const countedProducts = new Set(input.items.map((item) => item.productId));
    if (
      balances.some(
        (balance) =>
          !balance.quantity.isZero() && !countedProducts.has(balance.productId),
      )
    ) {
      throw new AppError(
        "A contagem deve incluir todos os materiais com saldo na localização. Atualize a lista de produtos.",
        409,
      );
    }
    const items: {
      productId: string;
      expectedQuantity: Prisma.Decimal;
      countedQuantity: Prisma.Decimal;
      difference: Prisma.Decimal;
      expectedVersion: number | null;
      expectedAppliedQuantity: Prisma.Decimal;
    }[] = [];
    for (const item of input.items) {
      await assertActiveProduct(tx, item.productId, actor.unitId);
      const expected = new Prisma.Decimal(item.expectedQuantity);
      const stock = await availability(
        tx,
        item.productId,
        input.locationId,
        actor.unitId,
      );
      if (!stock.physical.eq(expected)) throw staleCount();
      const counted = new Prisma.Decimal(item.countedQuantity);
      const difference = counted.minus(expected);
      assertQuantityRange(difference);
      items.push({
        productId: item.productId,
        expectedQuantity: expected,
        countedQuantity: counted,
        difference,
        expectedVersion: byProduct.get(item.productId)?.version ?? null,
        expectedAppliedQuantity: stock.applied,
      });
    }

    const count = await tx.inventoryCount.create({
      data: {
        locationId: input.locationId,
        unitId: actor.unitId,
        userId: actor.id,
        ...(schedule
          ? { scheduleId: schedule.id, scheduleDueAt: schedule.nextDueAt }
          : {}),
        note: input.note,
        status: "PENDING",
        items: {
          create: items.map((item) => ({ ...item, unitId: actor.unitId })),
        },
      },
      include: countInclude,
    });
    await tx.auditLog.create({
      data: {
        userId: actor.id,
        action: "INVENTORY_COUNT",
        unitId: actor.unitId,
        entity: "InventoryCount",
        entityId: count.id,
        after: {
          status: "PENDING",
          locationId: input.locationId,
          ...(schedule
            ? {
                scheduleId: schedule.id,
                scheduleDueAt: schedule.nextDueAt.toISOString(),
                anticipated: Boolean(input.allowEarly),
              }
            : {}),
          note: input.note,
          items: items.map((item) => ({
            productId: item.productId,
            expectedQuantity: item.expectedQuantity.toFixed(3),
            countedQuantity: item.countedQuantity.toFixed(3),
            difference: item.difference.toFixed(3),
            expectedVersion: item.expectedVersion,
            expectedAppliedQuantity: item.expectedAppliedQuantity.toFixed(3),
          })),
        },
      },
    });
    await tx.idempotencyRecord.create({
      data: {
        key: parsed.idempotencyKey,
        actorId: actor.id,
        unitId: actor.unitId,
        payloadHash: hash,
        resourceType: "inventory",
        resourceId: count.id,
      },
    });
    return count;
  });
}

/** Approval is naturally idempotent by count ID and adjusts the complete count atomically. */
export async function approveInventoryCount(actor: StockActor, rawId: string) {
  requirePermission(actor, "inventory:adjust");
  const id = z.string().uuid().parse(rawId);
  return serializable(async (tx) => {
    const count = await tx.inventoryCount.findUnique({
      where: { id, unitId: actor.unitId },
      include: countInclude,
    });
    if (!count) throw new AppError("Contagem não encontrada.", 404);
    if (count.status === "APPROVED") return count;
    if (count.status === "REJECTED")
      throw new AppError(
        "Esta contagem foi encerrada sem ajuste. Registre uma nova contagem.",
        409,
      );

    await assertActiveLocation(tx, count.locationId, actor.unitId);
    const balances = await tx.inventoryBalance.findMany({
      where: { locationId: count.locationId, unitId: actor.unitId },
    });
    const byProduct = new Map(
      balances.map((balance) => [balance.productId, balance]),
    );
    const countedProducts = new Set(count.items.map((item) => item.productId));
    if (
      balances.some(
        (balance) =>
          !balance.quantity.isZero() && !countedProducts.has(balance.productId),
      )
    )
      throw staleCount();

    // Validate every item before applying any adjustment. The transaction also protects against races.
    for (const item of count.items) {
      await assertActiveProduct(tx, item.productId, actor.unitId);
      const balance = byProduct.get(item.productId);
      const stock = await availability(
        tx,
        item.productId,
        count.locationId,
        actor.unitId,
      );
      if (
        !stock.physical.eq(item.expectedQuantity) ||
        !stock.applied.eq(item.expectedAppliedQuantity) ||
        (balance?.version ?? null) !== item.expectedVersion
      )
        throw staleCount();
      if (item.countedQuantity.lt(stock.reserved))
        throw new AppError(
          "A contagem deixaria reservas sem saldo. Libere ou corrija as reservas antes de aprovar o ajuste.",
          409,
        );
    }

    for (const item of count.items) {
      if (item.difference.isZero()) continue;
      const incoming = item.difference.gt(0);
      const bookedBefore = item.expectedQuantity.plus(
        item.expectedAppliedQuantity,
      );
      const bookedAfter = item.countedQuantity.plus(
        item.expectedAppliedQuantity,
      );
      await writeBalance(
        tx,
        item.productId,
        count.locationId,
        bookedAfter,
        actor.unitId,
      );
      const movement = await tx.stockMovement.create({
        data: {
          type: "ADJUSTMENT",
          unitId: actor.unitId,
          productId: item.productId,
          quantity: item.difference.abs(),
          userId: actor.id,
          sourceId: incoming ? null : count.locationId,
          destinationId: incoming ? count.locationId : null,
          sourceBefore: incoming ? null : bookedBefore,
          sourceAfter: incoming ? null : bookedAfter,
          destinationBefore: incoming ? bookedBefore : null,
          destinationAfter: incoming ? bookedAfter : null,
          note: count.note,
          reference: `Inventário ${count.id}`,
          inventoryCountId: count.id,
        },
      });
      await tx.auditLog.create({
        data: {
          userId: actor.id,
          action: "ADJUSTMENT",
          unitId: actor.unitId,
          entity: "StockMovement",
          entityId: movement.id,
          before: {
            productId: item.productId,
            locationId: count.locationId,
            physicalQuantity: item.expectedQuantity.toFixed(3),
            bookedQuantity: bookedBefore.toFixed(3),
          },
          after: {
            productId: item.productId,
            locationId: count.locationId,
            physicalQuantity: item.countedQuantity.toFixed(3),
            bookedQuantity: bookedAfter.toFixed(3),
            appliedQuantity: item.expectedAppliedQuantity.toFixed(3),
            difference: item.difference.toFixed(3),
            inventoryCountId: count.id,
            note: count.note,
          },
        },
      });
    }
    const approvedAt = new Date();
    const approved = await tx.inventoryCount.update({
      where: { id: count.id },
      data: {
        status: "APPROVED",
        approvedById: actor.id,
        approvedAt,
      },
      include: countInclude,
    });
    if (count.scheduleId && count.scheduleDueAt) {
      const schedule = await tx.inventorySchedule.findFirst({
        where: {
          id: count.scheduleId,
          unitId: actor.unitId,
          locationId: count.locationId,
          active: true,
        },
      });
      if (
        schedule &&
        schedule.nextDueAt.getTime() === count.scheduleDueAt.getTime()
      ) {
        // Only the approved snapshot can close this cycle. A reprogrammed or already closed
        // cycle is preserved, so older pending counts cannot advance it a second time.
        const nextDueAt = new Date(
          Math.max(approvedAt.getTime(), schedule.nextDueAt.getTime()) +
            schedule.intervalDays * 86400000,
        );
        await tx.inventorySchedule.update({
          where: { id: schedule.id },
          data: { nextDueAt, lastCountId: count.id },
        });
        await tx.auditLog.create({
          data: {
            unitId: actor.unitId,
            userId: actor.id,
            action: "INVENTORY_SCHEDULE_COMPLETED",
            entity: "InventorySchedule",
            entityId: schedule.id,
            before: { nextDueAt: schedule.nextDueAt.toISOString() },
            after: {
              countId: count.id,
              approvedAt: approvedAt.toISOString(),
              nextDueAt: nextDueAt.toISOString(),
            },
          },
        });
      }
    }
    await tx.auditLog.create({
      data: {
        userId: actor.id,
        action: "INVENTORY_APPROVED",
        unitId: actor.unitId,
        entity: "InventoryCount",
        entityId: count.id,
        before: { status: count.status },
        after: {
          status: "APPROVED",
          approvedById: actor.id,
          locationId: count.locationId,
        },
      },
    });
    return approved;
  });
}

/** A rejected proposal does not change balances or complete a scheduled cycle. */
export async function rejectInventoryCount(
  actor: StockActor,
  rawId: string,
  rawInput: unknown,
) {
  requirePermission(actor, "inventory:adjust");
  const id = z.string().uuid().parse(rawId);
  const { note } = z
    .object({ note: z.string().trim().min(10).max(2000) })
    .strict()
    .parse(rawInput);
  return serializable(async (tx) => {
    const count = await tx.inventoryCount.findFirst({
      where: { id, unitId: actor.unitId },
      include: countInclude,
    });
    if (!count) throw new AppError("Contagem não encontrada.", 404);
    if (count.status === "REJECTED") return count;
    if (count.status === "APPROVED")
      throw new AppError(
        "Uma contagem aprovada não pode ser encerrada sem ajuste.",
        409,
      );
    const rejected = await tx.inventoryCount.update({
      where: { id },
      data: { status: "REJECTED" },
      include: countInclude,
    });
    await tx.auditLog.create({
      data: {
        unitId: actor.unitId,
        userId: actor.id,
        action: "INVENTORY_REJECTED",
        entity: "InventoryCount",
        entityId: count.id,
        before: { status: count.status },
        after: {
          status: "REJECTED",
          note,
          locationId: count.locationId,
          scheduleId: count.scheduleId,
        },
      },
    });
    return rejected;
  });
}
