import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/http";
import {
  assertActiveLocation, assertActiveProduct, assertQuantityRange, availability,
  documentMovement, findIdempotentResource, idempotencyKeySchema, payloadHash,
  quantitySchema, requirePermission, serializable, touchBalance,
  type StockActor, type StockTransaction,
} from "@/services/stock";

const person = { select: { id: true, name: true } } as const;
const product = { select: { id: true, name: true, internalCode: true, unit: true } } as const;
export const orderInclude = {
  user: person,
  materials: { include: { product, location: { select: { id: true, code: true, name: true } } } },
  events: { include: { user: person }, orderBy: { createdAt: "asc" as const } },
} satisfies Prisma.WorkOrderInclude;

const orderSchema = z.object({
  code: z.string().trim().min(1).max(80),
  title: z.string().trim().min(3).max(200),
  kind: z.enum(["SERVICE", "PRODUCTION"]),
  description: z.string().trim().max(4000).default(""),
  idempotencyKey: idempotencyKeySchema,
}).strict();

const common = {
  note: z.string().trim().max(2000).default(""),
  idempotencyKey: idempotencyKeySchema,
};
const materialAction = {
  ...common, materialId: z.string().uuid(), quantity: quantitySchema({ positive: true }),
};
export const orderActionSchema = z.discriminatedUnion("action", [
  z.object({ ...common, action: z.literal("REQUEST"), productId: z.string().uuid(),
    locationId: z.string().uuid(), quantity: quantitySchema({ positive: true }),
    unit: z.string().trim().min(1).max(20).optional() }).strict(),
  z.object({ ...materialAction, action: z.literal("RESERVE") }).strict(),
  z.object({ ...materialAction, action: z.literal("RELEASE") }).strict(),
  z.object({ ...materialAction, action: z.literal("APPLY") }).strict(),
  z.object({ ...materialAction, action: z.literal("RETURN"), note: z.string().trim().min(3).max(2000) }).strict(),
  z.object({ ...common, action: z.literal("INVOICE"), reference: z.string().trim().min(1).max(200) }).strict(),
  z.object({ ...common, action: z.literal("CANCEL"), note: z.string().trim().min(3).max(2000) }).strict(),
]);

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  q: z.string().trim().max(100).default(""),
});

export async function listOrders(actor: StockActor, query: Record<string, unknown> = {}) {
  requirePermission(actor, "orders:read");
  const { page, pageSize, q } = paginationSchema.parse(query);
  const kind = z.enum(["SERVICE", "PRODUCTION"]).optional().parse(query.kind || undefined);
  const where: Prisma.WorkOrderWhereInput = { unitId: actor.unitId, kind,
    ...(q ? { OR: [{ code: { contains: q, mode: "insensitive" } }, { title: { contains: q, mode: "insensitive" } }] } : {}) };
  const [items, total] = await prisma.$transaction([
    prisma.workOrder.findMany({ where, include: orderInclude, skip: (page - 1) * pageSize,
      take: pageSize, orderBy: { createdAt: "desc" } }),
    prisma.workOrder.count({ where }),
  ]);
  return { items, total, page, pageSize };
}

async function scopedOrder(tx: StockTransaction, actor: StockActor, id: string) {
  const order = await tx.workOrder.findFirst({ where: { id, unitId: actor.unitId }, include: orderInclude });
  if (!order) throw new AppError("Ordem não encontrada nesta unidade.", 404);
  return order;
}

export async function getOrder(actor: StockActor, rawId: string) {
  requirePermission(actor, "orders:read");
  return scopedOrder(prisma, actor, z.string().uuid().parse(rawId));
}

async function remember(tx: StockTransaction, actor: StockActor, key: string, hash: string, type: string, id: string) {
  await tx.idempotencyRecord.create({ data: { key, unitId: actor.unitId, actorId: actor.id,
    payloadHash: hash, resourceType: type, resourceId: id } });
}

async function event(tx: StockTransaction, actor: StockActor, orderId: string, type: string,
  fields: { materialId?: string; quantity?: Prisma.Decimal; note?: string; reference?: string; metadata?: Prisma.InputJsonValue } = {}) {
  const record = await tx.orderEvent.create({ data: { unitId: actor.unitId, orderId,
    userId: actor.id, type, ...fields } });
  await tx.auditLog.create({ data: { unitId: actor.unitId, userId: actor.id,
    action: `ORDER_${type}`, entity: "WorkOrder", entityId: orderId,
    after: { eventId: record.id, materialId: fields.materialId ?? null,
      quantity: fields.quantity?.toFixed(3) ?? null, note: fields.note ?? "",
      reference: fields.reference ?? "", metadata: fields.metadata ?? null } } });
  return record;
}

export async function createOrder(actor: StockActor, rawInput: unknown) {
  requirePermission(actor, "orders:write");
  const { idempotencyKey, ...input } = orderSchema.parse(rawInput);
  const hash = payloadHash(actor, "order:create", input);
  return serializable(async (tx) => {
    const previous = await findIdempotentResource(tx, actor, idempotencyKey, hash, "order");
    if (previous) return scopedOrder(tx, actor, previous);
    const order = await tx.workOrder.create({ data: { ...input, unitId: actor.unitId, userId: actor.id } });
    await event(tx, actor, order.id, "CREATED", { metadata: { code: input.code, kind: input.kind } });
    await remember(tx, actor, idempotencyKey, hash, "order", order.id);
    return scopedOrder(tx, actor, order.id);
  });
}

/** Reservation, application, invoicing and compensation are separate audited state transitions. */
export async function actOnOrder(actor: StockActor, rawId: string, rawInput: unknown) {
  const id = z.string().uuid().parse(rawId);
  const { idempotencyKey, ...input } = orderActionSchema.parse(rawInput);
  const permission = input.action === "INVOICE" ? "orders:invoice"
    : ["APPLY", "RETURN"].includes(input.action) ? "orders:apply" : "orders:write";
  requirePermission(actor, permission);
  const hash = payloadHash(actor, "order:action", { id, ...input });
  return serializable(async (tx) => {
    const previous = await findIdempotentResource(tx, actor, idempotencyKey, hash, "orderAction");
    if (previous) return scopedOrder(tx, actor, previous);
    const order = await scopedOrder(tx, actor, id);

    if (input.action === "INVOICE" && order.status === "INVOICED") {
      if (order.invoiceReference !== input.reference)
        throw new AppError("Esta ordem já foi faturada com outra referência.", 409);
      await remember(tx, actor, idempotencyKey, hash, "orderAction", id);
      return order;
    }
    if (input.action === "CANCEL" && order.status === "CANCELLED") {
      await remember(tx, actor, idempotencyKey, hash, "orderAction", id);
      return order;
    }
    if (order.status === "CANCELLED" || (order.status === "INVOICED" && input.action !== "RETURN"))
      throw new AppError("A situação desta ordem não permite esta operação.", 409);

    if (input.action === "REQUEST") {
      await assertActiveProduct(tx, input.productId, actor.unitId);
      await assertActiveLocation(tx, input.locationId, actor.unitId);
      const productRecord = await tx.product.findFirstOrThrow({ where: { id: input.productId, unitId: actor.unitId } });
      if (input.unit && input.unit !== productRecord.unit)
        throw new AppError(`Informe a quantidade em ${productRecord.unit}. Não há conversão de unidades configurada.`, 400);
      const quantity = new Prisma.Decimal(input.quantity);
      const previousMaterial = await tx.orderMaterial.findUnique({ where: {
        orderId_productId_locationId: { orderId: id, productId: input.productId, locationId: input.locationId },
      } });
      assertQuantityRange((previousMaterial?.requestedQuantity ?? new Prisma.Decimal(0)).plus(quantity));
      const material = await tx.orderMaterial.upsert({ where: {
        orderId_productId_locationId: { orderId: id, productId: input.productId, locationId: input.locationId },
      }, create: { unitId: actor.unitId, orderId: id, productId: input.productId,
        locationId: input.locationId, requestedQuantity: quantity },
      update: { requestedQuantity: { increment: quantity } } });
      await event(tx, actor, id, "REQUESTED", { materialId: material.id, quantity, note: input.note });
    } else if (input.action === "INVOICE") {
      if (order.materials.some(material => material.reservedQuantity.gt(0)))
        throw new AppError("Aplique ou libere todas as reservas antes de confirmar o faturamento.", 409);
      if (order.materials.some(material => !material.requestedQuantity.eq(
        material.appliedQuantity.plus(material.consumedQuantity).minus(material.returnedQuantity),
      )))
        throw new AppError("Faturamento bloqueado: atenda integralmente todos os materiais requisitados antes de confirmar o faturamento.", 409);
      const applied = order.materials.filter(material => material.appliedQuantity.gt(0));
      if (!applied.length) throw new AppError("Não há materiais aplicados pendentes de baixa.", 409);
      for (const material of applied) {
        await documentMovement(tx, actor, { type: "EXIT", productId: material.productId,
          locationId: material.locationId, quantity: material.appliedQuantity,
          note: input.note, reference: input.reference, workOrderId: id, orderMaterialId: material.id });
        await tx.orderMaterial.update({ where: { id: material.id }, data: {
          consumedQuantity: { increment: material.appliedQuantity }, appliedQuantity: 0,
        } });
        await event(tx, actor, id, "CONSUMED", { materialId: material.id, quantity: material.appliedQuantity,
          note: input.note, reference: input.reference });
      }
      await tx.workOrder.update({ where: { id }, data: { status: "INVOICED",
        invoiceReference: input.reference, invoicedAt: new Date() } });
      await event(tx, actor, id, "INVOICED", { note: input.note, reference: input.reference });
    } else if (input.action === "CANCEL") {
      if (order.materials.some(material => material.appliedQuantity.gt(0)))
        throw new AppError("Registre a devolução dos materiais aplicados antes de cancelar a ordem.", 409);
      for (const material of order.materials.filter(item => item.reservedQuantity.gt(0))) {
        await tx.orderMaterial.update({ where: { id: material.id }, data: { reservedQuantity: 0 } });
        await touchBalance(tx, material.productId, material.locationId, actor.unitId);
        await event(tx, actor, id, "RELEASED", { materialId: material.id,
          quantity: material.reservedQuantity, note: input.note });
      }
      await tx.workOrder.update({ where: { id }, data: { status: "CANCELLED" } });
      await event(tx, actor, id, "CANCELLED", { note: input.note });
    } else {
      const material = order.materials.find(item => item.id === input.materialId);
      if (!material) throw new AppError("Material não pertence a esta ordem.", 404);
      await assertActiveProduct(tx, material.productId, actor.unitId);
      await assertActiveLocation(tx, material.locationId, actor.unitId);
      const quantity = new Prisma.Decimal(input.quantity);
      const stock = await availability(tx, material.productId, material.locationId, actor.unitId);
      const data: Prisma.OrderMaterialUpdateInput = {};
      let type: string = input.action;
      if (input.action === "RESERVE") {
        const pending = material.requestedQuantity.minus(material.reservedQuantity)
          .minus(material.appliedQuantity).minus(material.consumedQuantity);
        if (quantity.gt(pending)) throw new AppError("Reserva excede a quantidade requisitada pendente.", 409);
        if (quantity.gt(stock.available)) throw new AppError(`Saldo disponível insuficiente: ${stock.available.toFixed(3)}.`, 409);
        data.reservedQuantity = { increment: quantity }; type = "RESERVED";
      } else if (input.action === "RELEASE") {
        if (quantity.gt(material.reservedQuantity)) throw new AppError("Liberação excede a reserva desta ordem.", 409);
        data.reservedQuantity = { decrement: quantity }; type = "RELEASED";
      } else if (input.action === "APPLY") {
        if (quantity.gt(material.reservedQuantity)) throw new AppError("Reserve o material antes de aplicá-lo; quantidade maior que a reserva.", 409);
        data.reservedQuantity = { decrement: quantity };
        data.appliedQuantity = { increment: quantity }; type = "APPLIED";
      } else if (order.status === "OPEN") {
        if (quantity.gt(material.appliedQuantity)) throw new AppError("Devolução excede o material aplicado ainda não baixado.", 409);
        data.appliedQuantity = { decrement: quantity }; type = "RETURNED_BEFORE_INVOICE";
      } else {
        const returnable = material.consumedQuantity.minus(material.returnedQuantity);
        if (quantity.gt(returnable)) throw new AppError("Devolução excede o consumo ainda não devolvido.", 409);
        const original = await tx.stockMovement.findFirst({ where: { unitId: actor.unitId,
          workOrderId: id, orderMaterialId: material.id, type: "EXIT" }, orderBy: { createdAt: "asc" } });
        if (!original) throw new AppError("Baixa original não encontrada; confira a auditoria.", 409);
        await documentMovement(tx, actor, { type: "ENTRY", productId: material.productId,
          locationId: material.locationId, quantity, note: input.note,
          reference: `Devolução ${order.code}`, workOrderId: id, orderMaterialId: material.id,
          returnOfId: original.id });
        data.returnedQuantity = { increment: quantity }; type = "RETURNED_AFTER_INVOICE";
      }
      const changed = await tx.orderMaterial.update({ where: { id: material.id }, data });
      await touchBalance(tx, material.productId, material.locationId, actor.unitId);
      await event(tx, actor, id, type, { materialId: material.id, quantity, note: input.note,
        metadata: { reservedBefore: material.reservedQuantity.toFixed(3),
          appliedBefore: material.appliedQuantity.toFixed(3), consumedBefore: material.consumedQuantity.toFixed(3),
          returnedBefore: material.returnedQuantity.toFixed(3), reservedAfter: changed.reservedQuantity.toFixed(3),
          appliedAfter: changed.appliedQuantity.toFixed(3), consumedAfter: changed.consumedQuantity.toFixed(3),
          returnedAfter: changed.returnedQuantity.toFixed(3) } });
    }
    await remember(tx, actor, idempotencyKey, hash, "orderAction", id);
    return scopedOrder(tx, actor, id);
  });
}
