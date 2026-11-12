import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import type { SessionUser } from '@/lib/auth';
import { AppError } from '@/lib/http';
import { appOrigin, authServiceUnavailable } from '@/lib/auth-config';
import { supabaseAdmin } from '@/lib/supabase/admin';

const createInput = z.object({
  name: z.string().trim().min(2).max(160),
  email: z.string().trim().email().max(254).transform(v => v.toLowerCase()),
  roleId: z.string().uuid(), authUserId: z.string().uuid().optional(), active: z.boolean().optional(),
}).strict();
const updateInput = z.object({ roleId: z.string().uuid().optional(), active: z.boolean().optional() }).strict();
const membershipInclude = { user: { select: { id: true, name: true, email: true, active: true, authUserId: true } }, role: { select: { id: true, name: true } } } as const;
type ManagedMembership = Prisma.UnitMembershipGetPayload<{ include: typeof membershipInclude }>;
function visible(m: ManagedMembership) { return { id: m.userId, name: m.user.name, email: m.user.email, roleId: m.roleId, role: m.role, active: m.active, identityActive: m.user.active, authLinked: !!m.user.authUserId, unitId: m.unitId }; }
function authorize(actor: SessionUser) {
  if (!actor.unitId || !actor.permissions.includes('users:manage')) throw new AppError('Seu perfil não permite gerenciar usuários nesta unidade.', 403);
}
export async function assertActiveAccessManager(tx: Prisma.TransactionClient, actor: SessionUser) {
  const membership = await tx.unitMembership.findUnique({ where: { userId_unitId: { userId: actor.id, unitId: actor.unitId } }, include: { user: true, unit: { include: { organization: true } }, role: { include: { permissions: { include: { permission: true } } } } } });
  if (!membership?.active || !membership.user.active || !membership.unit.active || !membership.unit.organization.active || !membership.role.permissions.some(p => p.permission.key === 'users:manage')) throw new AppError('Seu acesso administrativo à unidade foi alterado. Entre novamente.', 403);
}
async function transaction<T>(work: (tx: Prisma.TransactionClient) => Promise<T>) {
  for (let i = 0; ; i++) {
    try { return await prisma.$transaction(work, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }); }
    catch (error) { if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2034' || i >= 3) throw error; }
  }
}
export async function listUserAccess(actor: SessionUser) {
  authorize(actor);
  const records = await prisma.unitMembership.findMany({ where: { unitId: actor.unitId }, include: membershipInclude, orderBy: { user: { name: 'asc' } } });
  return records.map(visible);
}
export async function getUserAccess(actor: SessionUser, id: string) {
  authorize(actor); z.string().uuid().parse(id);
  const record = await prisma.unitMembership.findUnique({ where: { userId_unitId: { userId: id, unitId: actor.unitId } }, include: membershipInclude });
  if (!record) throw new AppError('Usuário não encontrado nesta unidade.', 404);
  return visible(record);
}

export async function saveUserAccess(actor: SessionUser, input: unknown, id?: string) {
  authorize(actor);
  if (id) {
    z.string().uuid().parse(id);
    const data = updateInput.parse(input);
    if (!Object.keys(data).length) throw new AppError('Informe o perfil ou a situação de acesso à unidade.');
    if (data.active === false && !actor.permissions.includes('records:delete')) throw new AppError('Seu perfil não pode desativar acessos.', 403);
    return transaction(async tx => {
      await assertActiveAccessManager(tx, actor);
      const previous = await tx.unitMembership.findUnique({ where: { userId_unitId: { userId: id, unitId: actor.unitId } }, include: { ...membershipInclude, role: { include: { permissions: { include: { permission: true } } } } } });
      if (!previous) throw new AppError('Usuário não encontrado nesta unidade.', 404);
      if (id === actor.id && (data.active === false || (data.roleId && data.roleId !== previous.roleId))) throw new AppError('Você não pode desativar ou alterar seu próprio perfil de acesso.');
      const role = data.roleId ? await tx.role.findUnique({ where: { id: data.roleId }, include: { permissions: { include: { permission: true } } } }) : previous.role;
      if (!role) throw new AppError('Perfil de acesso inexistente.');
      const wasAdmin = previous.active && previous.user.active && previous.role.permissions.some(p => p.permission.key === 'users:manage');
      const remainsAdmin = (data.active ?? previous.active) && role.permissions.some(p => p.permission.key === 'users:manage');
      if (wasAdmin && !remainsAdmin && await tx.unitMembership.count({ where: { unitId: actor.unitId, userId: { not: id }, active: true, user: { active: true }, role: { permissions: { some: { permission: { key: 'users:manage' } } } } } }) === 0) throw new AppError('A unidade deve manter ao menos um administrador ativo.', 409);
      const updated = await tx.unitMembership.update({ where: { userId_unitId: { userId: id, unitId: actor.unitId } }, data, include: membershipInclude });
      await tx.auditLog.create({ data: { unitId: actor.unitId, userId: actor.id, action: 'USER_ACCESS_UPDATED', entity: 'UnitMembership', entityId: `${id}:${actor.unitId}`, before: { roleId: previous.roleId, active: previous.active }, after: { roleId: updated.roleId, active: updated.active } } });
      return visible(updated);
    });
  }
  const data = createInput.parse(input);
  if (data.active === false && !actor.permissions.includes('records:delete')) throw new AppError('Seu perfil não pode criar acessos desativados.', 403);
  const [role, existing] = await Promise.all([
    prisma.role.findUnique({ where: { id: data.roleId } }),
    prisma.user.findUnique({ where: { email: data.email } }),
  ]);
  if (!role) throw new AppError('Perfil de acesso inexistente.');
  if (existing && !existing.active) throw new AppError('Esta identidade está desativada globalmente. Procure o responsável pelo provisionamento.', 409);
  const admin = supabaseAdmin();
  let invitedId: string | undefined;
  let authUserId = data.authUserId || existing?.authUserId || undefined;
  if (authUserId) {
    const { data: identity, error } = await admin.auth.admin.getUserById(authUserId);
    if (error || !identity.user || !identity.user.email_confirmed_at || identity.user.email?.toLowerCase() !== data.email) throw new AppError(authServiceUnavailable(error) ? 'O serviço de autenticação está indisponível.' : 'O identificador Supabase não corresponde ao e-mail informado.', authServiceUnavailable(error) ? 503 : 400);
  } else {
    const { data: invitation, error } = await admin.auth.admin.inviteUserByEmail(data.email, { redirectTo: `${appOrigin()}/auth/callback?next=/recuperar-senha`, data: { name: data.name } });
    if (error || !invitation.user) throw new AppError(authServiceUnavailable(error) ? 'O serviço de convites está indisponível.' : 'Não foi possível enviar o convite. Se a conta já existe no Supabase, informe seu identificador autorizado.', authServiceUnavailable(error) ? 503 : 409);
    invitedId = invitation.user.id;
    authUserId = invitation.user.id;
  }
  try {
    const result = await transaction(async tx => {
      await assertActiveAccessManager(tx, actor);
      const byEmail = await tx.user.findUnique({ where: { email: data.email } });
      const byIdentity = await tx.user.findUnique({ where: { authUserId } });
      if ((byEmail?.authUserId && byEmail.authUserId !== authUserId) || (byIdentity && byEmail && byIdentity.id !== byEmail.id) || (byIdentity && byIdentity.email !== data.email)) throw new AppError('A identidade já possui um vínculo diferente. O provisionamento deve ser revisado.', 409);
      const current = byIdentity || byEmail;
      if (current && !current.active) throw new AppError('Esta identidade está desativada globalmente.', 409);
      const user = current ? await tx.user.update({ where: { id: current.id }, data: { authUserId } }) : await tx.user.create({ data: { name: data.name, email: data.email, authUserId, roleId: data.roleId } });
      const membership = await tx.unitMembership.findUnique({ where: { userId_unitId: { userId: user.id, unitId: actor.unitId } }, include: membershipInclude });
      if (membership) {
        if (membership.roleId !== data.roleId || membership.active !== (data.active ?? true)) throw new AppError('O usuário já possui acesso à unidade. Use a edição para alterar o perfil.', 409);
        return visible(membership);
      }
      const created = await tx.unitMembership.create({ data: { userId: user.id, unitId: actor.unitId, roleId: data.roleId, active: data.active ?? true }, include: membershipInclude });
      await tx.auditLog.create({ data: { unitId: actor.unitId, userId: actor.id, action: 'USER_ACCESS_CREATED', entity: 'UnitMembership', entityId: `${user.id}:${actor.unitId}`, after: { roleId: data.roleId, active: created.active, invitation: !!invitedId } } });
      return visible(created);
    });
    return result;
  } catch (error) {
    if (invitedId) {
      try {
        const linked = await prisma.user.findUnique({ where: { authUserId: invitedId }, select: { id: true } });
        if (!linked) await admin.auth.admin.deleteUser(invitedId);
      } catch { console.error('New invitation requires administrative reconciliation; no credentials were logged.'); }
    }
    throw error;
  }
}

export async function archiveUserAccess(actor: SessionUser, id: string) {
  return saveUserAccess(actor, { active: false }, id);
}
