import { canViewInventory } from "@/lib/access-profiles";
import { canManageResponsibilities, canOwnPending } from "@/lib/operational-responsibility";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/http";
import type { StockActor } from "@/services/stock";
import { coordinationReady, responsibilityCandidates, type CoordinationDB } from "@/services/operational-coordination";

export const pendingTypes = ["UNAPPLIED", "RESERVED", "AWAITING_INVOICE", "RETURN", "COUNT", "SCHEDULE"] as const;
export type PendingType = (typeof pendingTypes)[number];
export interface PendingItem {
  id: string; type: PendingType; orderId: string | null; orderKind: "SERVICE" | "PRODUCTION" | null;
  code: string; title: string; productCode: string | null; productName: string | null; unit: string | null;
  warehouseId: string; locationCode: string; quantity: string | null; createdAt: string; openedAt: string | null;
  dueAt: string | null; missingHandoff: boolean; creatorId: string | null; creatorName: string | null;
  occurrenceKey: string; assigneeName: string | null; assigneeId: string | null; assignmentVersion: number;
  assignmentNote: string | null; overdue: boolean; assigneeEligible: boolean;
}
export interface PendingPage {
  items: PendingItem[]; totals: Record<PendingType, number>; total: number; page: number; pageSize: number; serverTime: string;
  coordinationReady: boolean; canManage: boolean; overdueTotal: number; unassignedTotal: number; mineTotal: number;
}
export interface PendingPeople { people: { id: string; name: string; types: PendingType[] }[]; truncated: boolean }
const querySchema = z.object({
  type: z.enum(["ALL", ...pendingTypes]).default("ALL"),
  focus: z.enum(["ALL", "MINE", "UNASSIGNED", "OVERDUE"]).default("ALL"),
  page: z.coerce.number().int().min(1).max(1000000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
}).strict();

/** The page, responsibility filters and indicators share one database snapshot. */
export async function pendingSnapshot(actor: StockActor, rawQuery: Record<string, unknown> = {}, db: CoordinationDB = prisma,
  selection?: { id?: string; warehouseId?: string }): Promise<PendingPage> {
  const orders = actor.permissions.includes("orders:read"), inventory = canViewInventory(actor.permissions);
  if (!actor.unitId || (!orders && !inventory)) throw new AppError("Seu perfil não permite consultar pendências operacionais.", 403);
  const { type, focus, page, pageSize } = querySchema.parse(rawQuery);
  const unitId = actor.unitId, now = new Date(), ready = await coordinationReady(db);
  const assignmentJoin = ready ? Prisma.sql`LEFT JOIN "PendingAssignment" a ON a."unitId" = ${unitId}::uuid AND a."itemKey" = p.id AND a."occurrenceKey" = p."occurrenceKey"
    LEFT JOIN "User" assigned ON assigned.id = a."assigneeId"` : Prisma.empty;
  const assignmentFields = ready ? Prisma.sql`COALESCE(a."assigneeId"::text, p."scheduleAssigneeId") AS "assigneeId",
    COALESCE(assigned.name, p."scheduleAssigneeName") AS "assigneeName", COALESCE(a."dueAt", p."scheduleDueAt") AS "dueAt",
    COALESCE(a.version, 0) AS "assignmentVersion", a.note AS "assignmentNote"` : Prisma.sql`
    p."scheduleAssigneeId" AS "assigneeId", p."scheduleAssigneeName" AS "assigneeName", p."scheduleDueAt" AS "dueAt",
    0 AS "assignmentVersion", NULL::text AS "assignmentNote"`;
  const [result] = await db.$queryRaw<Array<{ items: PendingItem[] | null; totals: Partial<Record<PendingType, number>> | null;
    total: number; overdueTotal: number; unassignedTotal: number; mineTotal: number }>>(Prisma.sql`
    WITH pending AS (
      SELECT m.id::text || ':' || signal.type AS id, signal.type,
        o.id::text AS "orderId", o.kind::text AS "orderKind", o.code, o.title,
        p."internalCode" AS "productCode", p.name AS "productName", p.unit,
        l."warehouseId"::text AS "warehouseId", l.code AS "locationCode", signal.quantity::text AS quantity,
        o."createdAt" AS "createdAt", opening."createdAt" AS "openedAt",
        COALESCE(opening.id::text, 'legacy:' || m.id::text || ':' || signal.type) AS "occurrenceKey",
        NULL::text AS "creatorId", NULL::text AS "creatorName",
        NULL::timestamp AS "scheduleDueAt", NULL::text AS "scheduleAssigneeId", NULL::text AS "scheduleAssigneeName",
        ((m."appliedQuantity" > 0 OR m."consumedQuantity" > m."returnedQuantity") AND (
          NOT EXISTS (SELECT 1 FROM "OrderEvent" e WHERE e."unitId" = ${unitId}::uuid AND e."materialId" = m.id AND e.type = 'APPLIED')
          OR EXISTS (SELECT 1 FROM "OrderEvent" e WHERE e."unitId" = ${unitId}::uuid AND e."materialId" = m.id AND e.type = 'APPLIED'
            AND (NULLIF(e.metadata #>> '{handoff,receivedByName}', '') IS NULL OR NULLIF(e.metadata #>> '{handoff,receivedByIdentifier}', '') IS NULL))
        )) AS "missingHandoff"
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
      LEFT JOIN LATERAL (SELECT e.id, e."createdAt" FROM "OrderEvent" e
        WHERE e."unitId" = ${unitId}::uuid AND e."materialId" = m.id AND e.metadata -> 'pendingOpened' ? signal.type
        ORDER BY e."createdAt" DESC, e.id DESC LIMIT 1) opening ON true
      WHERE m."unitId" = ${unitId}::uuid AND ${orders} AND signal.quantity > 0
      UNION ALL
      SELECT c.id::text || ':COUNT', 'COUNT', NULL, NULL, c.id::text,
        'Contagem aguardando aprovação', NULL, NULL, NULL, l."warehouseId"::text, l.code, NULL,
        c."createdAt", c."createdAt", c.id::text, c."userId"::text, u.name, NULL, NULL, NULL, false
      FROM "InventoryCount" c
      JOIN "Location" l ON l.id = c."locationId" AND l."unitId" = c."unitId"
      JOIN "User" u ON u.id = c."userId"
      WHERE c."unitId" = ${unitId}::uuid AND ${inventory} AND c.status = 'PENDING'
      UNION ALL
      SELECT s.id::text || ':SCHEDULE', 'SCHEDULE', NULL, NULL, l.code,
        s.title, NULL, NULL, NULL, l."warehouseId"::text, l.code, NULL, s."createdAt", NULL,
        s.id::text || ':' || s."nextDueAt"::text, NULL, NULL, s."nextDueAt", s."assigneeId"::text, u.name, false
      FROM "InventorySchedule" s
      JOIN "Location" l ON l.id = s."locationId" AND l."unitId" = s."unitId"
      LEFT JOIN "User" u ON u.id = s."assigneeId"
      WHERE s."unitId" = ${unitId}::uuid AND ${inventory} AND s.active AND s."nextDueAt" <= ${now}
    ), assigned AS (SELECT p.*, ${assignmentFields} FROM pending p ${assignmentJoin}
      WHERE ${selection?.id ? Prisma.sql`p.id = ${selection.id}` : Prisma.sql`true`}
        AND ${selection?.warehouseId ? Prisma.sql`p."warehouseId" = ${selection.warehouseId}` : Prisma.sql`true`}),
    enriched AS (SELECT p.*, (p."dueAt" IS NOT NULL AND p."dueAt" < ${now}) AS overdue,
      EXISTS (SELECT 1 FROM "UnitMembership" member
        JOIN "User" person ON person.id = member."userId" AND person.active
        JOIN "RolePermission" rp ON rp."roleId" = member."roleId"
        JOIN "Permission" perm ON perm.id = rp."permissionId"
        WHERE member."unitId" = ${unitId}::uuid AND member."userId"::text = p."assigneeId" AND member.active
          AND CASE p.type
            WHEN 'COUNT' THEN perm.key = 'inventory:adjust' AND member."userId"::text <> p."creatorId"
            WHEN 'SCHEDULE' THEN perm.key = 'inventory:count'
            WHEN 'AWAITING_INVOICE' THEN perm.key = 'orders:invoice'
            WHEN 'RETURN' THEN perm.key IN ('orders:apply', 'orders:return')
            ELSE perm.key IN ('orders:apply', 'orders:deliver') END) AS "assigneeEligible"
      FROM assigned p),
    filtered AS (SELECT * FROM enriched WHERE (${type} = 'ALL' OR type = ${type})
      AND (${focus} = 'ALL' OR (${focus} = 'MINE' AND "assigneeId" = ${actor.id})
        OR (${focus} = 'UNASSIGNED' AND "assigneeId" IS NULL) OR (${focus} = 'OVERDUE' AND overdue))),
    selected AS (SELECT * FROM filtered
      ORDER BY overdue DESC, CASE type WHEN 'RETURN' THEN 0 WHEN 'SCHEDULE' THEN 1 WHEN 'COUNT' THEN 2 ELSE 3 END,
        COALESCE("dueAt", "openedAt", "createdAt") ASC, id ASC
      LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}),
    totals AS (SELECT type, count(*)::integer AS total FROM enriched GROUP BY type)
    SELECT (SELECT jsonb_agg(to_jsonb(selected)) FROM selected) AS items,
      (SELECT jsonb_object_agg(type, total) FROM totals) AS totals,
      (SELECT count(*)::integer FROM filtered) AS total,
      (SELECT count(*)::integer FROM enriched WHERE overdue) AS "overdueTotal",
      (SELECT count(*)::integer FROM enriched WHERE "assigneeId" IS NULL) AS "unassignedTotal",
      (SELECT count(*)::integer FROM enriched WHERE "assigneeId" = ${actor.id}) AS "mineTotal"
  `);
  const utc = (value: string) => new Date(/[zZ]|[+-]\d{2}:?\d{2}$/.test(value) ? value : `${value}Z`).toISOString();
  return {
    items: (result?.items ?? []).map(item => ({ ...item, createdAt: utc(item.createdAt),
      openedAt: item.openedAt ? utc(item.openedAt) : null, dueAt: item.dueAt ? utc(item.dueAt) : null })),
    totals: Object.fromEntries(pendingTypes.map(key => [key, result?.totals?.[key] ?? 0])) as Record<PendingType, number>,
    total: result?.total ?? 0, page, pageSize, serverTime: now.toISOString(), coordinationReady: ready,
    canManage: ready && canManageResponsibilities(actor.permissions), overdueTotal: result?.overdueTotal ?? 0,
    unassignedTotal: result?.unassignedTotal ?? 0, mineTotal: result?.mineTotal ?? 0,
  };
}
export const listOperationalPending = pendingSnapshot;

export async function listPendingPeople(actor: StockActor): Promise<PendingPeople> {
  if (!canManageResponsibilities(actor.permissions)) throw new AppError("Seu perfil não permite atribuir pendências.", 403);
  const result = await responsibilityCandidates(actor);
  return { people: result.people.map(person => ({ id: person.id, name: person.name,
    types: pendingTypes.filter(type => canOwnPending(person.permissions, type, person.id, null)) })), truncated: result.truncated };
}
