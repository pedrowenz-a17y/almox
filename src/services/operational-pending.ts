import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/http";
import type { StockActor } from "@/services/stock";

export const pendingTypes = ["UNAPPLIED", "RESERVED", "AWAITING_INVOICE", "RETURN", "COUNT", "SCHEDULE"] as const;
export type PendingType = (typeof pendingTypes)[number];
export interface PendingItem {
  id: string;
  type: PendingType;
  orderId: string | null;
  orderKind: "SERVICE" | "PRODUCTION" | null;
  code: string;
  title: string;
  productCode: string | null;
  productName: string | null;
  unit: string | null;
  locationCode: string;
  quantity: string | null;
  createdAt: string;
  dueAt: string | null;
  missingHandoff: boolean;
  assigneeName: string | null;
}
export interface PendingPage {
  items: PendingItem[];
  totals: Record<PendingType, number>;
  total: number;
  page: number;
  pageSize: number;
  serverTime: string;
}
const querySchema = z.object({
  type: z.enum(["ALL", ...pendingTypes]).default("ALL"),
  page: z.coerce.number().int().min(1).max(1000000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
}).strict();

/** Counts and the selected page share one database snapshot; quantities never pass through JS numbers. */
export async function listOperationalPending(actor: StockActor, rawQuery: Record<string, unknown> = {}): Promise<PendingPage> {
  const orders = actor.permissions.includes("orders:read");
  const inventory = actor.permissions.includes("inventory:count");
  if (!orders && !inventory) throw new AppError("Seu perfil não permite consultar pendências operacionais.", 403);
  const { type, page, pageSize } = querySchema.parse(rawQuery);
  const unitId = actor.unitId;
  const now = new Date();
  const [result] = await prisma.$queryRaw<Array<{ items: PendingItem[] | null; totals: Partial<Record<PendingType, number>> | null; total: number }>>(Prisma.sql`
    WITH pending AS (
      SELECT m.id::text || ':' || signal.type AS id, signal.type,
        o.id::text AS "orderId", o.kind::text AS "orderKind", o.code, o.title,
        p."internalCode" AS "productCode", p.name AS "productName", p.unit,
        l.code AS "locationCode", signal.quantity::text AS quantity,
        o."createdAt" AS "createdAt", NULL::timestamp AS "dueAt",
        ((m."appliedQuantity" > 0 OR m."consumedQuantity" > m."returnedQuantity") AND (
          NOT EXISTS (SELECT 1 FROM "OrderEvent" e WHERE e."unitId" = ${unitId}::uuid AND e."materialId" = m.id AND e.type = 'APPLIED')
          OR EXISTS (SELECT 1 FROM "OrderEvent" e WHERE e."unitId" = ${unitId}::uuid AND e."materialId" = m.id AND e.type = 'APPLIED'
            AND (NULLIF(e.metadata #>> '{handoff,receivedByName}', '') IS NULL OR NULLIF(e.metadata #>> '{handoff,receivedByIdentifier}', '') IS NULL))
        )) AS "missingHandoff", NULL::text AS "assigneeName"
      FROM "OrderMaterial" m
      JOIN "WorkOrder" o ON o.id = m."orderId" AND o."unitId" = m."unitId"
      JOIN "Product" p ON p.id = m."productId" AND p."unitId" = m."unitId"
      JOIN "Location" l ON l.id = m."locationId" AND l."unitId" = m."unitId"
      CROSS JOIN LATERAL (VALUES
        ('UNAPPLIED', CASE WHEN o.status = 'OPEN' THEN m."requestedQuantity" - m."appliedQuantity" - m."consumedQuantity" + m."returnedQuantity" ELSE 0 END),
        ('RESERVED', CASE WHEN o.status = 'OPEN' THEN m."reservedQuantity" ELSE 0 END),
        ('AWAITING_INVOICE', CASE WHEN o.status = 'OPEN' THEN m."appliedQuantity" ELSE 0 END),
        ('RETURN', CASE WHEN o.status IN ('OPEN', 'INVOICED') THEN m."pendingReturnQuantity" ELSE 0 END)
      ) AS signal(type, quantity)
      WHERE m."unitId" = ${unitId}::uuid AND ${orders} AND signal.quantity > 0
      UNION ALL
      SELECT c.id::text || ':COUNT', 'COUNT', NULL, NULL, c.id::text,
        'Contagem aguardando aprovação', NULL, NULL, NULL, l.code, NULL,
        c."createdAt", NULL, false, u.name
      FROM "InventoryCount" c
      JOIN "Location" l ON l.id = c."locationId" AND l."unitId" = c."unitId"
      JOIN "User" u ON u.id = c."userId"
      WHERE c."unitId" = ${unitId}::uuid AND ${inventory} AND c.status = 'PENDING'
      UNION ALL
      SELECT s.id::text || ':SCHEDULE', 'SCHEDULE', NULL, NULL, l.code,
        s.title, NULL, NULL, NULL, l.code, NULL, s."createdAt", s."nextDueAt", false, u.name
      FROM "InventorySchedule" s
      JOIN "Location" l ON l.id = s."locationId" AND l."unitId" = s."unitId"
      LEFT JOIN "User" u ON u.id = s."assigneeId"
      WHERE s."unitId" = ${unitId}::uuid AND ${inventory} AND s.active AND s."nextDueAt" <= ${now}
    ), filtered AS (SELECT * FROM pending WHERE ${type} = 'ALL' OR type = ${type}),
    selected AS (SELECT * FROM filtered
      ORDER BY CASE type WHEN 'RETURN' THEN 0 WHEN 'SCHEDULE' THEN 1 WHEN 'COUNT' THEN 2 ELSE 3 END,
        COALESCE("dueAt", "createdAt") ASC, id ASC
      LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}),
    totals AS (SELECT type, count(*)::integer AS total FROM pending GROUP BY type)
    SELECT (SELECT jsonb_agg(to_jsonb(selected)) FROM selected) AS items,
      (SELECT jsonb_object_agg(type, total) FROM totals) AS totals,
      (SELECT count(*)::integer FROM filtered) AS total
  `);
  // Prisma timestamps are stored as UTC without a PostgreSQL time-zone suffix.
  // jsonb_agg otherwise returns an ambiguous local date to the browser.
  const utc = (value: string) => new Date(/[zZ]|[+-]\d{2}:?\d{2}$/.test(value) ? value : `${value}Z`).toISOString();
  return {
    items: (result?.items ?? []).map(item => ({ ...item, createdAt: utc(item.createdAt), dueAt: item.dueAt ? utc(item.dueAt) : null })),
    totals: Object.fromEntries(pendingTypes.map(key => [key, result?.totals?.[key] ?? 0])) as Record<PendingType, number>,
    total: result?.total ?? 0, page, pageSize, serverTime: now.toISOString(),
  };
}
