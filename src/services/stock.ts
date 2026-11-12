import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma as db } from "@/lib/db";
import { AppError } from "@/lib/http";
import { canMoveStock } from "@/lib/access-profiles";

export type StockActor = {
  id: string;
  unitId: string;
  permissions: readonly string[];
};
export type StockTransaction = Prisma.TransactionClient;

const MAX_QUANTITY = new Prisma.Decimal("999999999999999.999");

/** Parse decimal text before arithmetic; quantities never pass through floating point. */
export function quantitySchema(
  options: { signed?: boolean; positive?: boolean } = {},
) {
  return z
    .union([z.string(), z.number()])
    .transform((value) => String(value).trim())
    .refine((value) => {
      const pattern = options.signed
        ? /^-?\d{1,15}(?:\.\d{1,3})?$/
        : /^\d{1,15}(?:\.\d{1,3})?$/;
      if (!pattern.test(value)) return false;
      const decimal = new Prisma.Decimal(value);
      return (
        decimal.abs().lte(MAX_QUANTITY) && (!options.positive || decimal.gt(0))
      );
    }, "Informe uma quantidade válida com até 3 casas decimais.")
    .transform((value) => new Prisma.Decimal(value).toFixed(3));
}

export const idempotencyKeySchema = z
  .string()
  .min(16)
  .max(128)
  .regex(/^[A-Za-z0-9:_-]+$/);

export const movementSchema = z
  .object({
    type: z.enum(["ENTRY", "EXIT", "TRANSFER"]),
    productId: z.string().uuid(),
    quantity: quantitySchema({ positive: true }),
    sourceId: z.string().uuid().nullish(),
    destinationId: z.string().uuid().nullish(),
    note: z.string().trim().max(2000).optional(),
    reference: z.string().trim().max(200).optional(),
    purpose: z.enum(["PRODUCTIVE", "OTHER", "LOSS"]).optional(),
    receivedByName: z.string().trim().min(3).max(120).optional(),
    receivedByIdentifier: z.string().trim().min(1).max(80).optional(),
    idempotencyKey: idempotencyKeySchema,
  })
  .strict()
  .superRefine((input, context) => {
    if (input.type === "EXIT") {
      if (!input.purpose || input.purpose === "PRODUCTIVE")
        context.addIssue({ code: "custom", path: ["purpose"],
          message: "Retiradas produtivas exigem uma O.S./O.P. Use a aplicação de materiais na ordem. Para exceções, informe outra finalidade ou perda." });
      if (!input.note || input.note.length < 10)
        context.addIssue({ code: "custom", path: ["note"], message: "Justifique a saída com pelo menos 10 caracteres." });
      if (input.purpose === "OTHER") {
        if (!input.receivedByName)
          context.addIssue({ code: "custom", path: ["receivedByName"], message: "Identifique quem retirou o material." });
        if (!input.receivedByIdentifier)
          context.addIssue({ code: "custom", path: ["receivedByIdentifier"], message: "Informe a matrícula ou identificação de quem retirou." });
      }
    } else if (input.purpose || input.receivedByName || input.receivedByIdentifier) {
      context.addIssue({ code: "custom", path: ["purpose"], message: "Finalidade de retirada e recebedor devem ser informados apenas em saídas." });
    }
    if (input.type !== "ENTRY" && !input.sourceId) {
      context.addIssue({
        code: "custom",
        path: ["sourceId"],
        message: "Selecione a localização de origem.",
      });
    }
    if (input.type !== "EXIT" && !input.destinationId) {
      context.addIssue({
        code: "custom",
        path: ["destinationId"],
        message: "Selecione a localização de destino.",
      });
    }
    if (input.type === "ENTRY" && input.sourceId) {
      context.addIssue({
        code: "custom",
        path: ["sourceId"],
        message: "Uma entrada deve informar somente o destino.",
      });
    }
    if (input.type === "EXIT" && input.destinationId) {
      context.addIssue({
        code: "custom",
        path: ["destinationId"],
        message: "Uma saída deve informar somente a origem.",
      });
    }
    if (input.sourceId && input.sourceId === input.destinationId) {
      context.addIssue({
        code: "custom",
        path: ["destinationId"],
        message: "Origem e destino devem ser diferentes.",
      });
    }
  });

export function requirePermission(actor: StockActor, permission: string) {
  requireAnyPermission(actor, [permission]);
}
export function requireAnyPermission(actor: StockActor, permissions: readonly string[]) {
  if (!actor.unitId) throw new AppError("Selecione uma unidade autorizada.", 403);
  if (!permissions.some(permission => actor.permissions.includes(permission))) {
    throw new AppError(
      "Seu perfil não possui permissão para esta operação.",
      403,
    );
  }
}

export function payloadHash(
  actor: StockActor,
  operation: string,
  payload: unknown,
) {
  return createHash("sha256")
    .update(JSON.stringify({ actorId: actor.id, unitId: actor.unitId, operation, payload }))
    .digest("hex");
}

export function assertQuantityRange(value: Prisma.Decimal) {
  if (value.abs().gt(MAX_QUANTITY)) {
    throw new AppError(
      "O saldo resultante ultrapassa o limite permitido.",
      400,
    );
  }
}

/** PostgreSQL retries the whole unit of work, including audit and idempotency writes. */
export async function serializable<T>(
  operation: (tx: StockTransaction) => Promise<T>,
): Promise<T> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      return await db.$transaction(operation, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 10_000,
        timeout: 15_000,
      });
    } catch (error) {
      const retryable =
        error instanceof Prisma.PrismaClientKnownRequestError &&
        ["P2034", "P2002"].includes(error.code);
      if (!retryable) throw error;
      if (attempt === 4) {
        throw new AppError(
          "O estoque está sendo atualizado por outra operação. Atualize e tente novamente.",
          409,
        );
      }
      await new Promise((resolve) =>
        setTimeout(resolve, 20 * (attempt + 1) + Math.random() * 40),
      );
    }
  }
  throw new AppError("Não foi possível concluir a movimentação.", 409);
}

export const movementInclude = {
  product: { select: { id: true, name: true, internalCode: true, unit: true } },
  user: { select: { id: true, name: true } },
  source: true,
  destination: true,
} satisfies Prisma.StockMovementInclude;

export async function assertActiveProduct(
  tx: StockTransaction,
  productId: string,
  unitId: string,
) {
  const product = await tx.product.findFirst({
    where: { id: productId, unitId },
    select: { id: true, active: true },
  });
  if (!product) throw new AppError("Produto não encontrado.", 404);
  if (!product.active)
    throw new AppError(
      "Este produto está inativo. Reative-o antes de movimentar estoque.",
      409,
    );
}

/** A disabled warehouse or ancestor also disables movement into its descendants. */
export async function assertActiveLocation(
  tx: StockTransaction,
  locationId: string,
  unitId: string,
) {
  const visited = new Set<string>();
  let currentId: string | null = locationId;
  while (currentId) {
    if (visited.has(currentId))
      throw new AppError("A hierarquia da localização é inválida.", 409);
    visited.add(currentId);
    const location: {
      parentId: string | null;
      active: boolean;
      warehouse: { active: boolean };
    } | null = await tx.location.findFirst({
      where: { id: currentId, unitId, warehouse: { unitId } },
      select: {
        parentId: true,
        active: true,
        warehouse: { select: { active: true } },
      },
    });
    if (!location) throw new AppError("Localização não encontrada.", 404);
    if (!location.active || !location.warehouse.active) {
      throw new AppError(
        "A localização, um de seus níveis ou o almoxarifado está inativo.",
        409,
      );
    }
    currentId = location.parentId;
  }
}

export async function readBalance(
  tx: StockTransaction,
  productId: string,
  locationId: string,
) {
  const balance = await tx.inventoryBalance.findUnique({
    where: { productId_locationId: { productId, locationId } },
  });
  return balance?.quantity ?? new Prisma.Decimal(0);
}

export async function writeBalance(
  tx: StockTransaction,
  productId: string,
  locationId: string,
  quantity: Prisma.Decimal,
  unitId: string,
) {
  assertQuantityRange(quantity);
  return tx.inventoryBalance.upsert({
    where: { productId_locationId: { productId, locationId } },
    create: { productId, locationId, quantity, unitId, version: 1 },
    update: { quantity, version: { increment: 1 } },
  });
}

/** Booked stock remains owned until invoicing. Applied stock is no longer on the shelf. */
export async function availability(
  tx: StockTransaction,
  productId: string,
  locationId: string,
  unitId: string,
) {
  const quantity = await readBalance(tx, productId, locationId);
  const allocation = await tx.orderMaterial.aggregate({
    where: { unitId, productId, locationId },
    _sum: { reservedQuantity: true, appliedQuantity: true },
  });
  const reserved = allocation._sum.reservedQuantity ?? new Prisma.Decimal(0);
  const applied = allocation._sum.appliedQuantity ?? new Prisma.Decimal(0);
  const physical = quantity.minus(applied);
  return { quantity, reserved, applied, physical, available: physical.minus(reserved) };
}

/** Allocation changes invalidate inventory snapshots even when booked stock is unchanged. */
export async function touchBalance(tx: StockTransaction, productId: string, locationId: string, unitId: string) {
  const quantity = await readBalance(tx, productId, locationId);
  await writeBalance(tx, productId, locationId, quantity, unitId);
}

export async function findIdempotentResource(
  tx: StockTransaction,
  actor: StockActor,
  key: string,
  hash: string,
  resourceType: string,
) {
  const existing = await tx.idempotencyRecord.findUnique({ where: { key } });
  if (!existing) return null;
  if (
    existing.actorId !== actor.id ||
    existing.unitId !== actor.unitId ||
    existing.payloadHash !== hash ||
    existing.resourceType !== resourceType
  ) {
    throw new AppError(
      "Esta solicitação já foi utilizada com outros dados. Inicie uma nova operação.",
      409,
    );
  }
  return existing.resourceId;
}

/** The sole public entry point for receipts, withdrawals and transfers. */
export async function createMovement(actor: StockActor, rawInput: unknown) {
  requireAnyPermission(actor, ["stock:move", "stock:entry", "stock:exit", "stock:transfer"]);
  const parsed = movementSchema.parse(rawInput);
  if (!canMoveStock(actor.permissions, parsed.type))
    throw new AppError("Seu perfil não permite este tipo de movimentação.", 403);
  if (parsed.type === "EXIT" && parsed.purpose === "LOSS")
    requirePermission(actor, "inventory:adjust");
  const input = {
    type: parsed.type,
    productId: parsed.productId,
    quantity: parsed.quantity,
    sourceId: parsed.sourceId ?? null,
    destinationId: parsed.destinationId ?? null,
    note: parsed.note ?? "",
    reference: parsed.reference ?? "",
  };
  const declaration = parsed.type === "EXIT" ? {
    purpose: parsed.purpose,
    receivedByName: parsed.receivedByName ?? null,
    receivedByIdentifier: parsed.receivedByIdentifier ?? null,
  } : null;
  const hash = payloadHash(actor, "movement", declaration ? { ...input, declaration } : input);
  return serializable(async (tx) => {
    const previousId = await findIdempotentResource(
      tx,
      actor,
      parsed.idempotencyKey,
      hash,
      "movement",
    );
    if (previousId) {
      const previous = await tx.stockMovement.findUnique({
        where: { id: previousId, unitId: actor.unitId },
        include: movementInclude,
      });
      if (!previous)
        throw new AppError(
          "A operação anterior não está disponível. Consulte o histórico.",
          409,
        );
      return previous;
    }

    await assertActiveProduct(tx, input.productId, actor.unitId);
    if (input.sourceId) await assertActiveLocation(tx, input.sourceId, actor.unitId);
    if (input.destinationId)
      await assertActiveLocation(tx, input.destinationId, actor.unitId);

    const quantity = new Prisma.Decimal(input.quantity);
    const sourceBefore = input.sourceId
      ? await readBalance(tx, input.productId, input.sourceId)
      : null;
    const destinationBefore = input.destinationId
      ? await readBalance(tx, input.productId, input.destinationId)
      : null;
    const sourceAfter = sourceBefore?.minus(quantity) ?? null;
    const destinationAfter = destinationBefore?.plus(quantity) ?? null;
    const originAvailability = input.sourceId
      ? await availability(tx, input.productId, input.sourceId, actor.unitId)
      : null;
    if (originAvailability && originAvailability.available.lt(quantity)) {
      throw new AppError(
        `Saldo disponível insuficiente na origem. Disponível: ${originAvailability.available.toFixed(3)}. Reservas e aplicações não podem ser consumidas por uma saída avulsa.`,
        409,
      );
    }
    if (input.sourceId && sourceAfter)
      await writeBalance(tx, input.productId, input.sourceId, sourceAfter, actor.unitId);
    if (input.destinationId && destinationAfter)
      await writeBalance(
        tx,
        input.productId,
        input.destinationId,
        destinationAfter,
        actor.unitId,
      );

    const movement = await tx.stockMovement.create({
      data: {
        ...input,
        unitId: actor.unitId,
        quantity,
        userId: actor.id,
        sourceBefore,
        sourceAfter,
        destinationBefore,
        destinationAfter,
      },
      include: movementInclude,
    });
    const handoff = parsed.type === "EXIT" && parsed.purpose === "OTHER" ? {
      deliveredById: actor.id, deliveredByName: movement.user.name,
      receivedByName: parsed.receivedByName!, receivedByIdentifier: parsed.receivedByIdentifier!,
      confirmation: "DECLARED_BY_OPERATOR",
    } : null;
    await tx.auditLog.create({
      data: {
        userId: actor.id,
        action: input.type,
        unitId: actor.unitId,
        entity: "StockMovement",
        entityId: movement.id,
        before: {
          productId: input.productId,
          sourceId: input.sourceId,
          destinationId: input.destinationId,
          sourceQuantity: sourceBefore?.toFixed(3) ?? null,
          destinationQuantity: destinationBefore?.toFixed(3) ?? null,
        },
        after: {
          productId: input.productId,
          quantity: quantity.toFixed(3),
          sourceId: input.sourceId,
          destinationId: input.destinationId,
          sourceQuantity: sourceAfter?.toFixed(3) ?? null,
          destinationQuantity: destinationAfter?.toFixed(3) ?? null,
          note: input.note,
          reference: input.reference,
          ...(declaration ? { purpose: declaration.purpose!, handoff } : {}),
        },
      },
    });
    await tx.idempotencyRecord.create({
      data: {
        key: parsed.idempotencyKey,
        actorId: actor.id,
        unitId: actor.unitId,
        payloadHash: hash,
        resourceType: "movement",
        resourceId: movement.id,
      },
    });
    return movement;
  });
}

/** Internal document operation; callers must authorize and validate the document transition. */
export async function documentMovement(
  tx: StockTransaction,
  actor: StockActor,
  input: {
    type: "ENTRY" | "EXIT";
    productId: string;
    locationId: string;
    quantity: Prisma.Decimal;
    note: string;
    reference: string;
    workOrderId?: string;
    orderMaterialId?: string;
    receiptItemId?: string;
    returnOfId?: string;
  },
) {
  await assertActiveProduct(tx, input.productId, actor.unitId);
  await assertActiveLocation(tx, input.locationId, actor.unitId);
  if (!input.quantity.gt(0)) throw new AppError("Quantidade deve ser positiva.");
  const before = await readBalance(tx, input.productId, input.locationId);
  const after = input.type === "ENTRY" ? before.plus(input.quantity) : before.minus(input.quantity);
  if (after.lt(0)) throw new AppError("Saldo registrado insuficiente para efetivar o documento.", 409);
  await writeBalance(tx, input.productId, input.locationId, after, actor.unitId);
  const incoming = input.type === "ENTRY";
  const movement = await tx.stockMovement.create({
    data: {
      unitId: actor.unitId, type: input.type, productId: input.productId,
      quantity: input.quantity, userId: actor.id,
      sourceId: incoming ? null : input.locationId,
      destinationId: incoming ? input.locationId : null,
      sourceBefore: incoming ? null : before, sourceAfter: incoming ? null : after,
      destinationBefore: incoming ? before : null, destinationAfter: incoming ? after : null,
      note: input.note, reference: input.reference,
      workOrderId: input.workOrderId, orderMaterialId: input.orderMaterialId,
      receiptItemId: input.receiptItemId, returnOfId: input.returnOfId,
    },
  });
  await tx.auditLog.create({ data: {
    unitId: actor.unitId, userId: actor.id, action: input.type,
    entity: "StockMovement", entityId: movement.id,
    before: { quantity: before.toFixed(3) },
    after: { quantity: after.toFixed(3), productId: input.productId, locationId: input.locationId,
      reference: input.reference, workOrderId: input.workOrderId ?? null,
      receiptItemId: input.receiptItemId ?? null, returnOfId: input.returnOfId ?? null },
  } });
  return movement;
}
