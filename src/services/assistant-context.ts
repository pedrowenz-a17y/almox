import { canViewReports, canViewInventory } from "@/lib/access-profiles";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { StockActor } from "@/services/stock";

// Deliberately excludes names/emails of employees, notes, supplier documents and costs.
async function collectContext(actor: StockActor, db: Prisma.TransactionClient) {
  const can = (permission: string) => actor.permissions.includes(permission);
  const products = await db.product.findMany({
    where: { unitId: actor.unitId, active: true },
    take: 30,
    orderBy: { internalCode: "asc" },
    select: {
      id: true,
      internalCode: true,
      name: true,
      unit: true,
      minStock: true,
    },
  });
  const ids = products.map((product) => product.id);
  const [balances, allocations, totalProducts] = await Promise.all([
    db.inventoryBalance.groupBy({
      by: ["productId"],
      where: { unitId: actor.unitId, productId: { in: ids } },
      _sum: { quantity: true },
    }),
    db.orderMaterial.groupBy({
      by: ["productId"],
      where: { unitId: actor.unitId, productId: { in: ids } },
      _sum: { reservedQuantity: true, appliedQuantity: true },
    }),
    db.product.count({ where: { unitId: actor.unitId, active: true } }),
  ]);
  const orders = can("orders:read")
    ? await db.workOrder.findMany({
        where: { unitId: actor.unitId, status: "OPEN" },
        take: 15,
        orderBy: { createdAt: "asc" },
        select: {
          code: true,
          kind: true,
          createdAt: true,
          materials: {
            take: 15,
            orderBy: { id: "asc" },
            select: {
              product: {
                select: { internalCode: true, name: true, unit: true },
              },
              requestedQuantity: true,
              reservedQuantity: true,
              appliedQuantity: true,
              consumedQuantity: true,
              returnedQuantity: true,
            },
          },
          _count: { select: { materials: true } },
        },
      })
    : undefined;
  const counts =
    canViewInventory(actor.permissions) || can("inventory:adjust") || canViewReports(actor.permissions)
      ? await db.inventoryCount.groupBy({
          by: ["status"],
          where: { unitId: actor.unitId },
          _count: { _all: true },
        })
      : undefined;
  const purchases = can("purchases:read")
    ? await db.purchaseOrder.count({
        where: { unitId: actor.unitId, status: "OPEN" },
      })
    : undefined;
  return {
    generatedAt: new Date().toISOString(),
    scope: "Somente unidade ativa; amostra limitada, não é auditoria completa.",
    limitations: [
      "Até 30 produtos em ordem de código e 15 ordens abertas mais antigas, com até 15 materiais por ordem.",
      "Não contém custos, identificação de funcionários, notas livres ou dados de outras unidades.",
      "Saldos representam registros do aplicativo; não comprovam contagem física nem sincronização com ERP externo.",
    ],
    totalActiveProducts: totalProducts,
    products: products.map((product) => {
      const ledger =
        balances.find((item) => item.productId === product.id)?._sum.quantity ??
        new Prisma.Decimal(0);
      const allocation = allocations.find(
        (item) => item.productId === product.id,
      )?._sum;
      const applied = allocation?.appliedQuantity ?? new Prisma.Decimal(0);
      const reserved = allocation?.reservedQuantity ?? new Prisma.Decimal(0);
      const physicalExpected = ledger.minus(applied);
      return {
        code: product.internalCode,
        name: product.name,
        unit: product.unit,
        minimum: product.minStock.toFixed(3),
        ledger: ledger.toFixed(3),
        appliedOpen: applied.toFixed(3),
        reserved: reserved.toFixed(3),
        physicalExpected: physicalExpected.toFixed(3),
        available: physicalExpected.minus(reserved).toFixed(3),
      };
    }),
    openOrders: orders,
    inventoryCountsByStatus: counts,
    openPurchaseOrders: purchases,
    unavailable: [
      !can("orders:read") && "ordens",
      !can("purchases:read") && "compras",
      !counts && "inventários",
      "custos",
    ].filter(Boolean),
  };
}

// A single database snapshot avoids mixing ledger and application quantities from concurrent operations.
export async function assistantContext(actor: StockActor, db = prisma) {
  return db.$transaction((tx) => collectContext(actor, tx), {
    isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
    timeout: 10000,
  });
}
