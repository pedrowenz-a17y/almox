import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import type { SessionUser } from '@/lib/auth';
import { AppError } from '@/lib/http';
import { AuthConfigurationError, authServiceUnavailable } from '@/lib/auth-config';
import { accessProvider, type AccessProvider } from '@/lib/access-provider';
import { accessProgress } from '@/services/access-progress';
import { assertActiveAccessManager } from '@/services/access-management';
import { sendAccessEmail } from '@/services/access-emails';
export { assertActiveAccessManager } from '@/services/access-management';

const createInput = z.object({
  name: z.string().trim().min(2).max(160),
  email: z.string().trim().email().max(254).transform(v => v.toLowerCase()),
  roleId: z.string().uuid(), authUserId: z.string().uuid().optional(), active: z.boolean().optional(),
}).strict();
const updateInput = z.object({ roleId: z.string().uuid().optional(), active: z.boolean().optional() }).strict();
const membershipInclude = { user: { select: { id: true, name: true, email: true, active: true, authUserId: true } }, role: { select: { id: true, name: true } } } as const;
type ManagedMembership = Prisma.UnitMembershipGetPayload<{ include: typeof membershipInclude }>;
function visible(m: ManagedMembership) { return { id: m.userId, name: m.user.name, email: m.user.email, roleId: m.roleId, role: m.role, active: m.active, identityActive: m.user.active, authLinked: !!m.user.authUserId, unitId: m.unitId }; }
type SavedAccess = ReturnType<typeof visible> & { accessNotice?: string; notification?: {
  state: "REQUESTED" | "PENDING"; message: string; kind?: "INVITE" | "RECOVERY"; retryAfter?: number; code?: string;
} };
function authorize(actor: SessionUser) {
  if (!actor.unitId || !actor.permissions.includes('users:manage')) throw new AppError('Seu perfil não permite gerenciar usuários nesta unidade.', 403);
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
  const progress = await accessProgress(records, actor.unitId);
  return records.map(record => ({ ...visible(record), ...progress.get(record.userId) }));
}
export async function getUserAccess(actor: SessionUser, id: string) {
  authorize(actor); z.string().uuid().parse(id);
  const record = await prisma.unitMembership.findUnique({ where: { userId_unitId: { userId: id, unitId: actor.unitId } }, include: membershipInclude });
  if (!record) throw new AppError('Usuário não encontrado nesta unidade.', 404);
  const progress = await accessProgress([record], actor.unitId);
  return { ...visible(record), ...progress.get(record.userId) };
}

export async function saveUserAccess(actor: SessionUser, input: unknown, id?: string, providerFactory: () => AccessProvider = accessProvider): Promise<SavedAccess> {
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
  // Revoked administrators must not create external identities or trigger mail.
  await assertActiveAccessManager(prisma, actor);
  const [role, existing] = await Promise.all([
    prisma.role.findUnique({ where: { id: data.roleId } }), prisma.user.findUnique({ where: { email: data.email } }),
  ]);
  if (!role) throw new AppError('Perfil de acesso inexistente.');
  if (existing && !existing.active) throw new AppError('Esta identidade está desativada globalmente. Procure o responsável pelo provisionamento.', 409);
  const provider = providerFactory();
  let createdIdentityId: string | undefined;
  let authUserId = data.authUserId || existing?.authUserId || undefined;
  if (authUserId) {
    const result = await provider.getIdentity(authUserId);
    if (result.error || !result.user || result.user.id !== authUserId || result.user.email?.toLowerCase() !== data.email
      || (data.authUserId && !result.user.email_confirmed_at))
      throw new AppError(authServiceUnavailable(result.error) ? 'O serviço de autenticação está indisponível.'
        : 'O identificador Supabase deve pertencer ao e-mail informado e a uma identidade confirmada.', authServiceUnavailable(result.error) ? 503 : 400);
  } else {
    // Save the authorized ERP association before sending any message. A mail limit
    // leaves a visible pending account instead of losing the registration.
    const result = await provider.createIdentity(data.email, data.name);
    if (result.error || !result.user || result.user.email?.toLowerCase() !== data.email) throw new AppError(
      ['email_exists', 'user_already_exists'].includes(result.error?.code ?? '')
        ? 'Esta identidade já existe no Supabase. Escolha Vincular identidade existente e informe seu UUID confirmado.'
        : 'Não foi possível preparar a identidade de login. Confira o serviço de autenticação.',
      authServiceUnavailable(result.error) ? 503 : 409, 'AUTH_IDENTITY_CREATION_FAILED');
    createdIdentityId = result.user.id; authUserId = result.user.id;
  }
  let result;
  try {
    result = await transaction(async tx => {
      await assertActiveAccessManager(tx, actor);
      const byEmail = await tx.user.findUnique({ where: { email: data.email } });
      const byIdentity = await tx.user.findUnique({ where: { authUserId } });
      if ((byEmail?.authUserId && byEmail.authUserId !== authUserId) || (byIdentity && byEmail && byIdentity.id !== byEmail.id)
        || (byIdentity && byIdentity.email !== data.email)) throw new AppError('A identidade já possui um vínculo diferente. O provisionamento deve ser revisado.', 409);
      const current = byIdentity || byEmail;
      if (current && !current.active) throw new AppError('Esta identidade está desativada globalmente.', 409);
      const user = current ? await tx.user.update({ where: { id: current.id }, data: { authUserId } })
        : await tx.user.create({ data: { name: data.name, email: data.email, authUserId, roleId: data.roleId } });
      const membership = await tx.unitMembership.findUnique({ where: { userId_unitId: { userId: user.id, unitId: actor.unitId } }, include: membershipInclude });
      if (membership) {
        if (membership.roleId !== data.roleId || membership.active !== (data.active ?? true)) throw new AppError('O usuário já possui acesso à unidade. Use a edição para alterar o perfil.', 409);
        return visible(membership);
      }
      const created = await tx.unitMembership.create({ data: { userId: user.id, unitId: actor.unitId, roleId: data.roleId, active: data.active ?? true }, include: membershipInclude });
      await tx.auditLog.create({ data: { unitId: actor.unitId, userId: actor.id, action: 'USER_ACCESS_CREATED', entity: 'UnitMembership',
        entityId: `${user.id}:${actor.unitId}`, after: { roleId: data.roleId, active: created.active, authUserId: authUserId! } } });
      return visible(created);
    });
  } catch (error) {
    if (createdIdentityId) {
      try {
        const linked = await prisma.user.findUnique({ where: { authUserId: createdIdentityId }, select: { id: true } });
        if (!linked) await provider.deleteIdentity(createdIdentityId);
      } catch { console.error('AUTH_IDENTITY_RECONCILIATION_REQUIRED'); }
    }
    throw error;
  }
  if (createdIdentityId && result.active) {
    try {
      const mail = await sendAccessEmail(actor, result.id, { authUserId }, () => provider);
      return { ...result, notification: { state: 'REQUESTED' as const, ...mail }, accessNotice: `Acesso cadastrado. ${mail.message}` };
    } catch (cause) {
      const error = cause instanceof AppError || cause instanceof AuthConfigurationError ? cause.message : 'O envio não foi confirmado.';
      return { ...result, notification: { state: 'PENDING' as const, message: error,
        ...(cause instanceof AppError ? { code: cause.code, retryAfter: cause.retryAfter } : {}) },
        accessNotice: `Acesso cadastrado; o envio do convite não foi confirmado. ${error} Acompanhe pelo botão Acesso do usuário.` };
    }
  }
  return { ...result, accessNotice: result.active ? 'Acesso à unidade salvo. A identidade existente foi preservada; nenhum novo e-mail foi solicitado.'
    : 'Acesso salvo como desativado. Nenhum convite foi solicitado.' };
}

export async function archiveUserAccess(actor: SessionUser, id: string) {
  return saveUserAccess(actor, { active: false }, id);
}
