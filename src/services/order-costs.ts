import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requirePermission, type StockActor } from "@/services/stock";

export const MATERIAL_COST_CRITERION =
  "Estimativa de materiais: custo cadastral capturado no faturamento, menos devoluções pelo mesmo custo. Não inclui mão de obra, frete ou custos indiretos. Critério sujeito à validação da empresa.";

// A quantity (18,3) multiplied by a price (18,2), then summed, exceeds
// decimal.js's default 20 significant digits. Keep this precision local.
export const CostDecimal = Prisma.Decimal.clone({ precision: 50 });

type CostMaterial = {
  id: string;
  consumedQuantity: Prisma.Decimal;
  returnedQuantity: Prisma.Decimal;
  invoicedUnitCost: Prisma.Decimal | null;
  product: { internalCode: string; name: string; unit: string };
};
type CostOrder = {
  id: string;
  code: string;
  title: string;
  kind: string;
  status: string;
  invoiceReference: string | null;
  invoicedAt: Date | null;
  materials: CostMaterial[];
};

/** Prices are historical snapshots. Never substitute the current product price. */
export function summarizeOrderCost(order: CostOrder) {
  let subtotal = new CostDecimal(0);
  let missingCostCount = 0;
  const materials = order.materials.map((material) => {
    const netQuantity = new CostDecimal(
      material.consumedQuantity.toString(),
    ).minus(material.returnedQuantity.toString());
    const amount = netQuantity.eq(0)
      ? new CostDecimal(0)
      : material.invoicedUnitCost === null
        ? null
        : netQuantity
            .mul(material.invoicedUnitCost.toString())
            .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
    if (amount === null) missingCostCount += 1;
    else subtotal = subtotal.plus(amount);
    return {
      id: material.id,
      productCode: material.product.internalCode,
      productName: material.product.name,
      unit: material.product.unit,
      consumedQuantity: material.consumedQuantity.toFixed(3),
      returnedQuantity: material.returnedQuantity.toFixed(3),
      netQuantity: netQuantity.toFixed(3),
      invoicedUnitCost: material.invoicedUnitCost?.toFixed(2) ?? null,
      netMaterialCost: amount?.toFixed(2) ?? null,
    };
  });
  const ready = order.status === "INVOICED";
  return {
    id: order.id,
    code: order.code,
    title: order.title,
    kind: order.kind,
    status: order.status,
    invoiceReference: order.invoiceReference,
    invoicedAt: order.invoicedAt?.toISOString() ?? null,
    completeness: !ready
      ? "AWAITING_INVOICE"
      : missingCostCount
        ? "MISSING_COST"
        : "COMPLETE",
    missingCostCount,
    knownSubtotal: subtotal.toFixed(2),
    netMaterialCost: ready && !missingCostCount ? subtotal.toFixed(2) : null,
    materials,
  };
}

export const costOrderSelect = {
  id: true,
  code: true,
  title: true,
  kind: true,
  status: true,
  invoiceReference: true,
  invoicedAt: true,
  materials: {
    select: {
      id: true,
      consumedQuantity: true,
      returnedQuantity: true,
      invoicedUnitCost: true,
      product: { select: { internalCode: true, name: true, unit: true } },
    },
  },
} satisfies Prisma.WorkOrderSelect;

export async function listOrderCosts(
  actor: StockActor,
  query: Record<string, unknown> = {},
) {
  requirePermission(actor, "costs:read");
  const { page, q } = z
    .object({
      page: z.coerce.number().int().min(1).default(1),
      q: z.string().trim().max(100).default(""),
    })
    .parse(query);
  const where: Prisma.WorkOrderWhereInput = {
    unitId: actor.unitId,
    ...(q
      ? {
          OR: [
            { code: { contains: q, mode: "insensitive" } },
            { title: { contains: q, mode: "insensitive" } },
          ],
        }
      : {}),
  };
  const [orders, total] = await prisma.$transaction([
    prisma.workOrder.findMany({
      where,
      select: costOrderSelect,
      orderBy: [{ invoicedAt: "desc" }, { createdAt: "desc" }],
      skip: (page - 1) * 25,
      take: 25,
    }),
    prisma.workOrder.count({ where }),
  ]);
  return {
    criterion: MATERIAL_COST_CRITERION,
    currency: "BRL",
    page,
    pageSize: 25,
    total,
    orders: orders.map(summarizeOrderCost),
  };
}
