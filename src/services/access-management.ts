import type { Prisma } from "@prisma/client";
import type { SessionUser } from "@/lib/auth";
import { AppError } from "@/lib/http";

export async function assertActiveAccessManager(tx: Prisma.TransactionClient, actor: SessionUser) {
  const membership = await tx.unitMembership.findUnique({ where: { userId_unitId: { userId: actor.id, unitId: actor.unitId } },
    include: { user: true, unit: { include: { organization: true } }, role: { include: { permissions: { include: { permission: true } } } } } });
  if (!membership?.active || !membership.user.active || !membership.unit.active || !membership.unit.organization.active
    || !membership.role.permissions.some(link => link.permission.key === "users:manage"))
    throw new AppError("Seu acesso administrativo à unidade foi alterado. Entre novamente.", 403);
}
