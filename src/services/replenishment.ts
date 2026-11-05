import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { replenishmentAmounts } from "@/lib/replenishment";
import { requirePermission, type StockActor } from "@/services/stock";

export async function listReplenishment(actor: StockActor) {
  requirePermission(actor, "purchases:read");
  return prisma.$transaction(
    async (tx) => {
      const [products, balances, allocations, pending] = await Promise.all([
        tx.product.findMany({
          where: { unitId: actor.unitId, active: true },
          orderBy: { name: "asc" },
          select: {
            id: true,
            internalCode: true,
            name: true,
            unit: true,
            minStock: true,
            maxStock: true,
            supplier: {
              select: { id: true, legalName: true, tradeName: true },
            },
          },
        }),
        tx.inventoryBalance.groupBy({
          by: ["productId"],
          where: { unitId: actor.unitId },
          _sum: { quantity: true },
        }),
        tx.orderMaterial.groupBy({
          by: ["productId"],
          where: { unitId: actor.unitId },
          _sum: { reservedQuantity: true, appliedQuantity: true },
        }),
        tx.purchaseOrderItem.findMany({
          where: {
            unitId: actor.unitId,
            purchaseOrder: { unitId: actor.unitId, status: "OPEN" },
          },
          select: {
            productId: true,
            orderedQuantity: true,
            receivedQuantity: true,
          },
        }),
      ]);
      const quantities = new Map(
        balances.map((b) => [
          b.productId,
          b._sum.quantity ?? new Prisma.Decimal(0),
        ]),
      );
      const held = new Map(
        allocations.map((a) => [
          a.productId,
          (a._sum.reservedQuantity ?? new Prisma.Decimal(0)).plus(
            a._sum.appliedQuantity ?? 0,
          ),
        ]),
      );
      const incoming = new Map<string, Prisma.Decimal>();
      for (const item of pending)
        incoming.set(
          item.productId,
          (incoming.get(item.productId) ?? new Prisma.Decimal(0)).plus(
            item.orderedQuantity.minus(item.receivedQuantity),
          ),
        );
      return products.flatMap((p) => {
        const available = (quantities.get(p.id) ?? new Prisma.Decimal(0)).minus(
          held.get(p.id) ?? 0,
        );
        const onOrder = incoming.get(p.id) ?? new Prisma.Decimal(0);
        const plan = replenishmentAmounts({
          available,
          minimum: p.minStock,
          maximum: p.maxStock,
          incoming: onOrder,
        });
        return plan.needsAttention
          ? [
              {
                productId: p.id,
                code: p.internalCode,
                name: p.name,
                unit: p.unit,
                supplierId: p.supplier?.id ?? null,
                supplierName:
                  p.supplier?.tradeName ||
                  p.supplier?.legalName ||
                  "Sem fornecedor",
                available: available.toFixed(3),
                minimum: p.minStock.toFixed(3),
                incoming: onOrder.toFixed(3),
                target: plan.target,
                suggested: plan.suggested,
              },
            ]
          : [];
      });
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}
