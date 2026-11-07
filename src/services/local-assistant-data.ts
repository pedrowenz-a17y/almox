import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { assertActiveLocation, type StockActor } from "@/services/stock";
import { AppError } from "@/lib/http";

export const Quantity = Prisma.Decimal.clone({ precision: 40 });
export const displayQty = (value: string | Prisma.Decimal) => {
  const [integer, fraction] = new Quantity(value.toString())
    .toFixed(3)
    .split(".");
  const decimals = fraction.replace(/0+$/, "");
  return (
    integer.replace(/\B(?=(\d{3})+(?!\d))/g, ".") +
    (decimals ? `,${decimals}` : "")
  );
};
export interface ProductCandidate {
  id: string;
  code: string;
  name: string;
  unit: string;
  strength: number;
  total: number;
}
/** All terms are bound parameters. Even approximate matches remain inside the selected unit. */
export async function findLocalProducts(
  actor: StockActor,
  terms: string[],
): Promise<ProductCandidate[]> {
  if (!terms.length) return [];
  const text = terms.join(" ").slice(0, 200),
    compact = text.replace(/[^a-z0-9]/g, "");
  return prisma.$queryRaw<ProductCandidate[]>(Prisma.sql`
    WITH catalog AS (
      SELECT id,"internalCode" AS code,name,unit,
        translate(lower(name),'áàãâéêíóôõúüç','aaaaeeiooouuc') AS folded,
        translate(lower("internalCode"),'áàãâéêíóôõúüç','aaaaeeiooouuc') AS folded_code
      FROM "Product" WHERE "unitId"=${actor.unitId}::uuid AND active
    ), matches AS (
      SELECT id,code,name,unit, CASE
        WHEN regexp_replace(folded_code,'[^a-z0-9]','','g')=${compact} THEN 3
        WHEN NOT EXISTS (SELECT 1 FROM unnest(${terms}::text[]) term
          WHERE strpos(folded,term)=0 AND strpos(folded_code,term)=0) THEN 2
        WHEN similarity(folded,${text}) >= 0.2 OR similarity(folded_code,${text}) >= 0.3 THEN 1 ELSE 0 END AS strength
      FROM catalog
    ), best AS (SELECT * FROM matches WHERE strength>0 AND strength=(SELECT max(strength) FROM matches))
    SELECT id::text,code,name,unit,strength,count(*) OVER()::integer AS total
    FROM best ORDER BY code,id LIMIT 6
  `);
}
export async function localProductSnapshot(actor: StockActor, id: string) {
  return prisma.$transaction(
    async (tx) => {
      const product = await tx.product.findFirst({
        where: { id, unitId: actor.unitId, active: true },
        select: {
          id: true,
          internalCode: true,
          name: true,
          unit: true,
          minStock: true,
        },
      });
      if (!product) return null;
      const [balances, allocations] = await Promise.all([
        tx.inventoryBalance.findMany({
          where: { unitId: actor.unitId, productId: id },
          select: {
            locationId: true,
            quantity: true,
            location: { select: { code: true, name: true, active: true } },
          },
          orderBy: { location: { code: "asc" } },
        }),
        tx.orderMaterial.groupBy({
          by: ["locationId"],
          where: { unitId: actor.unitId, productId: id },
          _sum: { reservedQuantity: true, appliedQuantity: true },
        }),
      ]);
      const missing = allocations.filter(
        (a) => !balances.some((b) => b.locationId === a.locationId),
      );
      const missingLocations = missing.length
        ? await tx.location.findMany({
            where: {
              unitId: actor.unitId,
              id: { in: missing.map((a) => a.locationId) },
            },
            select: { id: true, code: true, name: true, active: true },
          })
        : [];
      const positions = [
        ...balances,
        ...missingLocations.map((location) => ({
          locationId: location.id,
          quantity: new Prisma.Decimal(0),
          location,
        })),
      ].sort((a, b) => a.location.code.localeCompare(b.location.code));
      const operational = new Map<string, boolean>();
      for (const position of positions) {
        try {
          await assertActiveLocation(tx, position.locationId, actor.unitId);
          operational.set(position.locationId, true);
        } catch (error) {
          if (error instanceof AppError && [404, 409].includes(error.status))
            operational.set(position.locationId, false);
          else throw error;
        }
      }
      const rows = positions.map((balance) => {
        const commitments = allocations.find(
          (a) => a.locationId === balance.locationId,
        )?._sum;
        const ledger = new Quantity(balance.quantity.toString()),
          reserved = new Quantity(
            commitments?.reservedQuantity?.toString() ?? 0,
          ),
          applied = new Quantity(commitments?.appliedQuantity?.toString() ?? 0);
        return {
          code: balance.location.code,
          name: balance.location.name,
          active: operational.get(balance.locationId) ?? false,
          ledger,
          reserved,
          applied,
          physical: ledger.minus(applied),
          available: ledger.minus(applied).minus(reserved),
        };
      });
      const sum = (
        key: "ledger" | "reserved" | "applied" | "physical" | "available",
      ) => rows.reduce((total, row) => total.plus(row[key]), new Quantity(0));
      return {
        product,
        rows,
        ledger: sum("ledger"),
        reserved: sum("reserved"),
        applied: sum("applied"),
        physical: sum("physical"),
        available: sum("available"),
        usable: rows
          .filter((r) => r.active)
          .reduce(
            (n, r) => n.plus(Quantity.max(0, r.available)),
            new Quantity(0),
          ),
        at: new Date().toISOString(),
      };
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
      timeout: 10000,
    },
  );
}
export function orderReference(text: string) {
  const quoted = text.match(/\b(?:ordem|os|op)\s*["“]([^"”]{1,80})["”]/i);
  if (quoted) return quoted[1];
  const prefixed = text.match(
    /\b(?:os|op|o\.s\.?|o\.p\.?)\s*[-:#/]?\s*((?=[\p{L}\p{N}_-]*\d)[\p{L}\p{N}_-]{1,60})(?![\p{L}\p{N}_-])/iu,
  );
  if (prefixed) return prefixed[1];
  return text.match(
    /\bordem\s+(?:de\s+(?:servi[cç]o|produ[cç][aã]o)\s+)?([\p{L}\p{N}_-]*\d[\p{L}\p{N}_-]*)(?![\p{L}\p{N}_-])/iu,
  )?.[1];
}
export async function localOrderSnapshot(
  actor: StockActor,
  reference: string,
  kind?: "SERVICE" | "PRODUCTION",
) {
  return prisma.$transaction(
    async (tx) => {
      const where = {
        unitId: actor.unitId,
        ...(kind ? { kind } : {}),
        code: { contains: reference, mode: Prisma.QueryMode.insensitive },
      };
      const orders = await tx.workOrder.findMany({
        where,
        select: { id: true, code: true, kind: true, status: true },
        orderBy: { code: "asc" },
        take: 6,
      });
      const total = await tx.workOrder.count({ where });
      if (total !== 1) return { orders, total, checks: null };
      const order = orders[0];
      const [checks] = await tx.$queryRaw<
        Array<{
          lines: number;
          reserved: number;
          unfulfilled: number;
          returns: number;
          applied: number;
        }>
      >(Prisma.sql`
      SELECT count(*)::integer AS lines,
        count(*) FILTER(WHERE "reservedQuantity">0)::integer AS reserved,
        count(*) FILTER(WHERE "requestedQuantity" <> "appliedQuantity"+"consumedQuantity"-"returnedQuantity")::integer AS unfulfilled,
        count(*) FILTER(WHERE "pendingReturnQuantity">0)::integer AS returns,
        count(*) FILTER(WHERE "appliedQuantity">0)::integer AS applied
      FROM "OrderMaterial" WHERE "unitId"=${actor.unitId}::uuid AND "orderId"=${order.id}::uuid
    `);
      return { orders, total, checks };
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
      timeout: 10000,
    },
  );
}
