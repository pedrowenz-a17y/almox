import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/http";
import { paginationSchema } from "@/services/orders";
import { assertActiveLocation, assertActiveProduct, documentMovement,
  findIdempotentResource, idempotencyKeySchema, payloadHash, quantitySchema,
  requirePermission, serializable, type StockActor, type StockTransaction,
} from "@/services/stock";

const product = { select: { id: true, name: true, internalCode: true, unit: true } } as const;
const person = { select: { id: true, name: true } } as const;
export const purchaseInclude = {
  supplier: { select: { id: true, legalName: true, tradeName: true } },
  user: person,
  items: { include: { product } },
  receipts: { include: { user: person, items: { include: { product,
    location: { select: { id: true, code: true, name: true } } } } }, orderBy: { createdAt: "asc" as const } },
} satisfies Prisma.PurchaseOrderInclude;

const money = z.union([z.string(), z.number()]).transform(String)
  .refine(value => /^\d{1,15}(?:\.\d{1,2})?$/.test(value), "Custo inválido; use até 2 casas decimais.")
  .transform(value => new Prisma.Decimal(value).toFixed(2));
export const purchaseSchema = z.object({
  code: z.string().trim().min(1).max(80),
  title: z.string().trim().max(200).default(""),
  supplierId: z.string().uuid(),
  description: z.string().trim().max(4000).default(""),
  items: z.array(z.object({ productId: z.string().uuid(), quantity: quantitySchema({ positive: true }),
    unitCost: money.nullish(), unit: z.string().trim().min(1).max(20).optional() }).strict()).min(1).max(200),
  idempotencyKey: idempotencyKeySchema,
}).strict().superRefine((input, context) => {
  if (new Set(input.items.map(item => item.productId)).size !== input.items.length)
    context.addIssue({ code: "custom", path: ["items"], message: "Informe cada material apenas uma vez no pedido." });
});
export const receiptSchema = z.object({
  documentReference: z.string().trim().min(1, "Informe o documento efetivamente recebido.").max(200),
  note: z.string().trim().max(2000).default(""),
  items: z.array(z.object({ purchaseOrderItemId: z.string().uuid(), locationId: z.string().uuid(),
    quantity: quantitySchema({ positive: true }), unit: z.string().trim().min(1).max(20).optional(),
    unitCost: money.nullish(),
  }).strict()).min(1).max(200),
  idempotencyKey: idempotencyKeySchema,
}).strict().superRefine((input, context) => {
  if (new Set(input.items.map(item => item.purchaseOrderItemId)).size !== input.items.length)
    context.addIssue({ code: "custom", path: ["items"], message: "Informe cada item do pedido apenas uma vez por recebimento." });
});

function redactCosts<T>(actor: StockActor, value: T): T {
  if (actor.permissions.includes("costs:read")) return value;
  function scrub(input: unknown): unknown {
    if (Array.isArray(input)) return input.map(scrub);
    if (input && typeof input === "object" && !(input instanceof Date) && !Prisma.Decimal.isDecimal(input))
      return Object.fromEntries(Object.entries(input).filter(([key]) => key !== "unitCost").map(([key, item]) => [key, scrub(item)]));
    return input;
  }
  return scrub(value) as T;
}

async function scopedPurchase(tx: StockTransaction, actor: StockActor, id: string) {
  const purchase = await tx.purchaseOrder.findFirst({ where: { id, unitId: actor.unitId }, include: purchaseInclude });
  if (!purchase) throw new AppError("Pedido de compra não encontrado nesta unidade.", 404);
  return purchase;
}

export async function listPurchases(actor: StockActor, query: Record<string, unknown> = {}) {
  requirePermission(actor, "purchases:read");
  const { page, pageSize, q } = paginationSchema.parse(query);
  const where: Prisma.PurchaseOrderWhereInput = { unitId: actor.unitId,
    ...(q ? { OR: [{ code: { contains: q, mode: "insensitive" } }, { title: { contains: q, mode: "insensitive" } },
      { supplier: { legalName: { contains: q, mode: "insensitive" } } }] } : {}) };
  const [items, total] = await prisma.$transaction([
    prisma.purchaseOrder.findMany({ where, include: purchaseInclude, skip: (page - 1) * pageSize,
      take: pageSize, orderBy: { createdAt: "desc" } }),
    prisma.purchaseOrder.count({ where }),
  ]);
  return redactCosts(actor, { items, total, page, pageSize });
}

export async function getPurchase(actor: StockActor, id: string) {
  requirePermission(actor, "purchases:read");
  return redactCosts(actor, await scopedPurchase(prisma, actor, z.string().uuid().parse(id)));
}

export async function createPurchase(actor: StockActor, rawInput: unknown) {
  requirePermission(actor, "purchases:write");
  const { idempotencyKey, ...parsed } = purchaseSchema.parse(rawInput);
  const input = { ...parsed, items: [...parsed.items].sort((a, b) => a.productId.localeCompare(b.productId)) };
  if (input.items.some(item => item.unitCost != null)) requirePermission(actor, "costs:read");
  const hash = payloadHash(actor, "purchase:create", input);
  const result = await serializable(async (tx) => {
    const previous = await findIdempotentResource(tx, actor, idempotencyKey, hash, "purchase");
    if (previous) return scopedPurchase(tx, actor, previous);
    if (!await tx.supplier.findFirst({ where: { id: input.supplierId, unitId: actor.unitId, active: true } }))
      throw new AppError("Fornecedor inexistente ou inativo nesta unidade.", 404);
    for (const item of input.items) {
      await assertActiveProduct(tx, item.productId, actor.unitId);
      if (item.unit) {
        const material = await tx.product.findFirstOrThrow({ where: { id: item.productId, unitId: actor.unitId } });
        if (item.unit !== material.unit) throw new AppError(`Quantidade deve ser informada em ${material.unit}; conversão não configurada.`);
      }
    }
    const purchase = await tx.purchaseOrder.create({ data: {
      unitId: actor.unitId, userId: actor.id, code: input.code, title: input.title,
      supplierId: input.supplierId, description: input.description,
      items: { create: input.items.map(item => ({ unitId: actor.unitId, productId: item.productId,
        orderedQuantity: item.quantity, unitCost: item.unitCost ?? null })) },
    } });
    await tx.auditLog.create({ data: { unitId: actor.unitId, userId: actor.id,
      action: "PURCHASE_CREATED", entity: "PurchaseOrder", entityId: purchase.id,
      after: { code: input.code, supplierId: input.supplierId,
        items: input.items.map(item => ({ productId: item.productId, quantity: item.quantity })) } } });
    await tx.idempotencyRecord.create({ data: { key: idempotencyKey, unitId: actor.unitId,
      actorId: actor.id, payloadHash: hash, resourceType: "purchase", resourceId: purchase.id } });
    return scopedPurchase(tx, actor, purchase.id);
  });
  return redactCosts(actor, result);
}

/** Approval of a receipt and every stock entry commit together; no implicit invoice or fictitious document. */
export async function receivePurchase(actor: StockActor, rawId: string, rawInput: unknown) {
  requirePermission(actor, "purchases:receive");
  const id = z.string().uuid().parse(rawId);
  const { idempotencyKey, ...parsed } = receiptSchema.parse(rawInput);
  const input = { ...parsed, items: [...parsed.items].sort((a, b) => a.purchaseOrderItemId.localeCompare(b.purchaseOrderItemId)) };
  if (input.items.some(item => item.unitCost != null)) requirePermission(actor, "costs:read");
  const hash = payloadHash(actor, "purchase:receive", { id, ...input });
  const result = await serializable(async (tx) => {
    const previous = await findIdempotentResource(tx, actor, idempotencyKey, hash, "receipt");
    if (previous) {
      const receipt = await tx.receipt.findFirst({ where: { id: previous, unitId: actor.unitId } });
      if (!receipt) throw new AppError("Recebimento anterior não encontrado.", 409);
      return scopedPurchase(tx, actor, receipt.purchaseOrderId);
    }
    const purchase = await scopedPurchase(tx, actor, id);
    if (purchase.status !== "OPEN") throw new AppError("Este pedido não está aberto para recebimento.", 409);
    for (const item of input.items) {
      const ordered = purchase.items.find(row => row.id === item.purchaseOrderItemId);
      if (!ordered) throw new AppError("Item não pertence a este pedido.", 404);
      if (new Prisma.Decimal(item.quantity).gt(ordered.orderedQuantity.minus(ordered.receivedQuantity)))
        throw new AppError("Recebimento excede a quantidade pendente do pedido.", 409);
      if (item.unit && item.unit !== ordered.product.unit)
        throw new AppError(`Receba o material em ${ordered.product.unit}; conversão não configurada.`);
      await assertActiveProduct(tx, ordered.productId, actor.unitId);
      await assertActiveLocation(tx, item.locationId, actor.unitId);
    }
    const receipt = await tx.receipt.create({ data: { unitId: actor.unitId, purchaseOrderId: id,
      userId: actor.id, documentReference: input.documentReference, note: input.note } });
    for (const item of input.items) {
      const ordered = purchase.items.find(row => row.id === item.purchaseOrderItemId)!;
      const quantity = new Prisma.Decimal(item.quantity);
      const received = await tx.receiptItem.create({ data: { unitId: actor.unitId,
        receiptId: receipt.id, purchaseOrderItemId: ordered.id, productId: ordered.productId,
        locationId: item.locationId, quantity, unitCost: item.unitCost ?? null } });
      await documentMovement(tx, actor, { type: "ENTRY", productId: ordered.productId,
        locationId: item.locationId, quantity, note: input.note,
        reference: input.documentReference, receiptItemId: received.id });
      await tx.purchaseOrderItem.update({ where: { id: ordered.id }, data: { receivedQuantity: { increment: quantity } } });
    }
    const current = await tx.purchaseOrderItem.findMany({ where: { purchaseOrderId: id, unitId: actor.unitId } });
    if (current.every(item => item.receivedQuantity.eq(item.orderedQuantity)))
      await tx.purchaseOrder.update({ where: { id }, data: { status: "COMPLETED" } });
    await tx.auditLog.create({ data: { unitId: actor.unitId, userId: actor.id,
      action: "RECEIPT_APPROVED", entity: "Receipt", entityId: receipt.id,
      after: { purchaseOrderId: id, documentReference: input.documentReference, note: input.note,
        items: input.items.map(item => ({ purchaseOrderItemId: item.purchaseOrderItemId,
          locationId: item.locationId, quantity: item.quantity })) } } });
    await tx.idempotencyRecord.create({ data: { key: idempotencyKey, unitId: actor.unitId,
      actorId: actor.id, payloadHash: hash, resourceType: "receipt", resourceId: receipt.id } });
    return scopedPurchase(tx, actor, id);
  });
  return redactCosts(actor, result);
}

export async function cancelPurchase(actor: StockActor, rawId: string, rawInput: unknown) {
  requirePermission(actor, "purchases:write");
  const id = z.string().uuid().parse(rawId);
  const { idempotencyKey, note } = z.object({ idempotencyKey: idempotencyKeySchema,
    note: z.string().trim().min(3).max(2000) }).strict().parse(rawInput);
  const hash = payloadHash(actor, "purchase:cancel", { id, note });
  const result = await serializable(async (tx) => {
    const previous = await findIdempotentResource(tx, actor, idempotencyKey, hash, "purchaseCancel");
    if (previous) return scopedPurchase(tx, actor, previous);
    const purchase = await scopedPurchase(tx, actor, id);
    if (purchase.status === "COMPLETED" || purchase.items.some(item => item.receivedQuantity.gt(0)))
      throw new AppError("Pedidos com recebimentos não podem ser cancelados. Preserve o documento e registre a correção com rastreabilidade.", 409);
    if (purchase.status !== "CANCELLED") {
      await tx.purchaseOrder.update({ where: { id }, data: { status: "CANCELLED" } });
      await tx.auditLog.create({ data: { unitId: actor.unitId, userId: actor.id, action: "PURCHASE_CANCELLED",
        entity: "PurchaseOrder", entityId: id, before: { status: purchase.status },
        after: { status: "CANCELLED", note } } });
    }
    await tx.idempotencyRecord.create({ data: { key: idempotencyKey, unitId: actor.unitId,
      actorId: actor.id, payloadHash: hash, resourceType: "purchaseCancel", resourceId: id } });
    return scopedPurchase(tx, actor, id);
  });
  return redactCosts(actor, result);
}
