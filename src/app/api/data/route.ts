import { canViewReports } from "@/lib/access-profiles";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireUser, redactCosts } from "@/lib/auth";
import { api, json } from "@/lib/http";
const publicUser = { id: true, name: true, email: true } as const;
export const GET = api(async () => {
  const actor = await requireUser();
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
  }).format(new Date());
  const todayStart = new Date(`${today}T00:00:00-03:00`);
  const periodStart = new Date(todayStart.getTime() - 29 * 86400000);
  const result = await prisma.$transaction(
    async (tx) => {
      const [
        products,
        categories,
        suppliers,
        warehouses,
        locations,
        balances,
        movements,
        counts,
        settings,
        users,
        audit,
        roles,
        todayCounts,
        dailyActivity,
        topProducts,
        stockSummary,
        commitments,
      ] = await Promise.all([
        tx.product.findMany({
          where: { unitId: actor.unitId },
          include: { category: true, supplier: true },
          orderBy: { name: "asc" },
        }),
        tx.category.findMany({ where: { unitId: actor.unitId }, orderBy: { name: "asc" } }),
        tx.supplier.findMany({ where: { unitId: actor.unitId }, orderBy: { legalName: "asc" } }),
        tx.warehouse.findMany({ where: { unitId: actor.unitId }, orderBy: { name: "asc" } }),
        tx.location.findMany({
          where: { unitId: actor.unitId },
          include: { warehouse: true, parent: true },
          orderBy: { code: "asc" },
        }),
        tx.inventoryBalance.findMany({
          where: { unitId: actor.unitId, product: { unitId: actor.unitId }, location: { unitId: actor.unitId } },
          include: {
            product: { include: { category: true, supplier: true } },
            location: true,
          },
        }),
        tx.stockMovement.findMany({
          where: { unitId: actor.unitId },
          take: 2000,
          orderBy: { createdAt: "desc" },
          include: {
            product: true,
            user: { select: publicUser },
            source: true,
            destination: true,
          },
        }),
        tx.inventoryCount.findMany({
          where: { unitId: actor.unitId },
          take: 500,
          orderBy: { createdAt: "desc" },
          include: {
            location: true,
            user: { select: publicUser },
            approvedBy: { select: publicUser },
            items: { include: { product: true } },
          },
        }),
        tx.appSettings.findUnique({ where: { unitId: actor.unitId } }),
        actor.permissions.includes("users:manage")
          ? tx.unitMembership.findMany({
              where: { unitId: actor.unitId },
              include: { user: { select: { ...publicUser, authUserId: true, active: true, createdAt: true } }, role: { select: { id: true, name: true } } },
              orderBy: { user: { name: "asc" } },
            })
          : Promise.resolve(undefined),
        canViewReports(actor.permissions)
          ? tx.auditLog.findMany({
              where: { unitId: actor.unitId },
              take: 1000,
              orderBy: { createdAt: "desc" },
              include: { user: { select: publicUser } },
            })
          : Promise.resolve(undefined),
        actor.permissions.includes("users:manage")
          ? tx.role.findMany({
              include: { permissions: { include: { permission: true } } },
              orderBy: { name: "asc" },
            })
          : Promise.resolve(undefined),
        tx.stockMovement.groupBy({
          by: ["type"],
          where: { unitId: actor.unitId, createdAt: { gte: todayStart } },
          _count: { _all: true },
        }),
        tx.$queryRaw<
          Array<{
            date: string;
            type: string;
            operations: number;
            quantity: string;
          }>
        >(Prisma.sql`
        SELECT to_char("createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD') AS date,
          type::text AS type, count(*)::integer AS operations, sum(quantity)::text AS quantity
        FROM "StockMovement" WHERE "unitId" = ${actor.unitId}::uuid AND "createdAt" >= ${periodStart}
        GROUP BY date, type ORDER BY date ASC`),
        tx.$queryRaw<
          Array<{
            productId: string;
            name: string;
            internalCode: string;
            operations: number;
            quantity: string;
          }>
        >(Prisma.sql`
        SELECT p.id AS "productId", p.name, p."internalCode", count(*)::integer AS operations, sum(m.quantity)::text AS quantity
        FROM "StockMovement" m JOIN "Product" p ON p.id = m."productId"
        WHERE m."unitId" = ${actor.unitId}::uuid AND p."unitId" = ${actor.unitId}::uuid AND m."createdAt" >= ${periodStart}
        GROUP BY p.id, p.name, p."internalCode" ORDER BY operations DESC LIMIT 5`),
        tx.$queryRaw<
          Array<{
            totalProducts: number;
            totalItems: string;
            totalPhysical: string;
            totalReserved: string;
            totalApplied: string;
            totalAvailable: string;
            lowStock: number;
            outOfStock: number;
          }>
        >(Prisma.sql`
        WITH held AS (
          SELECT "productId", sum("reservedQuantity") AS reserved, sum("appliedQuantity") AS applied
          FROM "OrderMaterial" WHERE "unitId" = ${actor.unitId}::uuid GROUP BY "productId"
        ), stock AS (
          SELECT p.id, p."minStock", coalesce(sum(b.quantity), 0) AS quantity,
            coalesce(held.reserved, 0) AS reserved, coalesce(held.applied, 0) AS applied
          FROM "Product" p
          LEFT JOIN "InventoryBalance" b ON b."productId" = p.id AND b."unitId" = ${actor.unitId}::uuid
          LEFT JOIN held ON held."productId" = p.id
          WHERE p.active = true AND p."unitId" = ${actor.unitId}::uuid
          GROUP BY p.id, p."minStock", held.reserved, held.applied
        ) SELECT count(*)::integer AS "totalProducts", coalesce(sum(quantity), 0)::text AS "totalItems",
          coalesce(sum(quantity-applied), 0)::text AS "totalPhysical",
          coalesce(sum(reserved), 0)::text AS "totalReserved",
          coalesce(sum(applied), 0)::text AS "totalApplied",
          coalesce(sum(quantity-reserved-applied), 0)::text AS "totalAvailable",
          count(*) FILTER (WHERE quantity-reserved-applied > 0 AND quantity-reserved-applied < "minStock")::integer AS "lowStock",
          count(*) FILTER (WHERE quantity-reserved-applied <= 0)::integer AS "outOfStock" FROM stock`),
        tx.orderMaterial.groupBy({ by: ["productId", "locationId"], where: { unitId: actor.unitId }, _sum: { reservedQuantity: true, appliedQuantity: true } }),
      ]);
      const commitmentMap = new Map(commitments.map((item) => [
        `${item.productId}:${item.locationId}`, item._sum,
      ]));
      const scopedBalances = balances.map((balance) => {
        const pending = commitmentMap.get(`${balance.productId}:${balance.locationId}`);
        const reserved = pending?.reservedQuantity ?? new Prisma.Decimal(0);
        const applied = pending?.appliedQuantity ?? new Prisma.Decimal(0);
        return { ...balance, bookQuantity: balance.quantity.toString(), reservedQuantity: reserved.toString(), appliedQuantity: applied.toString(), physicalQuantity: balance.quantity.minus(applied).toString(), availableQuantity: balance.quantity.minus(reserved).minus(applied).toString() };
      });
      return {
        user: actor,
        unitId: actor.unitId,
        organizationId: actor.organizationId,
        products,
        categories,
        suppliers,
        warehouses,
        locations,
        balances: scopedBalances,
        movements,
        counts,
        settings: settings ?? {
          companyName: actor.memberships.find((membership) => membership.unitId === actor.unitId)?.unitName ?? "",
          allowNegativeStock: false,
        },
        users: users?.map((membership) => ({ ...membership.user, identityActive: membership.user.active, active: membership.active, roleId: membership.roleId, role: membership.role })),
        audit,
        roles,
        dashboard: {
          ...stockSummary[0],
          today: Object.fromEntries(
            todayCounts.map((item) => [item.type, item._count._all]),
          ),
          dailyActivity,
          topProducts,
          timezone: "America/Sao_Paulo",
        },
        permissions: actor.permissions,
        limits: { movements: 2000, counts: 500, audit: 1000 },
      };
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
      timeout: 20000,
    },
  );
  return json(redactCosts(result, actor));
});
