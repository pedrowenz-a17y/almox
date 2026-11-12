import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/http";
import type { StockActor } from "@/services/stock";

export type CoordinationDB = Prisma.TransactionClient;

/** Checked without querying new tables, so an older database can still serve the ERP. */
export async function coordinationReady(db: CoordinationDB = prisma) {
  const [result] = await db.$queryRaw<Array<{ ready: boolean }>>(Prisma.sql`
    SELECT to_regclass('public."WarehouseShift"') IS NOT NULL
      AND to_regclass('public."PendingAssignment"') IS NOT NULL
      AND to_regclass('public."WarehouseShift_one_active_idx"') IS NOT NULL AS ready
  `);
  return result?.ready === true;
}

export async function requireCoordination(db: CoordinationDB) {
  if (!await coordinationReady(db)) throw new AppError(
    "A etapa 3 aguarda a migração do banco. O administrador encontra o arquivo em Pendências.",
    503, "OPERATIONS_SETUP_REQUIRED",
  );
}

export async function activeMember(db: CoordinationDB, actor: StockActor, userId = actor.id) {
  const member = await db.unitMembership.findUnique({
    where: { userId_unitId: { userId, unitId: actor.unitId } },
    include: { user: true, unit: { include: { organization: true } },
      role: { include: { permissions: { include: { permission: true } } } } },
  });
  if (!member?.active || !member.user.active || !member.unit.active || !member.unit.organization.active)
    throw new AppError("O responsável precisa ter acesso ativo a esta unidade.", 403, "INACTIVE_UNIT_MEMBER");
  return { id: member.userId, name: member.user.name, permissions: member.role.permissions.map(link => link.permission.key) };
}

export async function responsibilityCandidates(actor: StockActor, db: CoordinationDB = prisma) {
  const members = await db.unitMembership.findMany({
    where: { unitId: actor.unitId, active: true, user: { active: true }, unit: { active: true, organization: { active: true } } },
    select: { user: { select: { id: true, name: true } }, role: { select: { permissions: { select: { permission: { select: { key: true } } } } } } },
    orderBy: [{ user: { name: "asc" } }, { userId: "asc" }], take: 1001,
  });
  return { people: members.slice(0, 1000).map(member => ({ ...member.user, permissions: member.role.permissions.map(link => link.permission.key) })),
    truncated: members.length > 1000 };
}
