import { createHash } from 'node:crypto';
import { cookies } from 'next/headers';
import { prisma } from '@/lib/db';
import { AppError } from '@/lib/http';
import { authServiceUnavailable } from '@/lib/auth-config';
import { supabaseServer } from '@/lib/supabase/server';

export const UNIT_COOKIE = 'almox_unit';
export type SessionMembership = { unitId: string; unitName: string; organizationId: string; organizationName: string; roleId: string; roleName: string };
export type SessionUser = {
  id: string; authUserId: string; name: string; email: string; active: boolean;
  unitId: string; organizationId: string; roleId: string;
  role: { id: string; name: string }; permissions: string[]; memberships: SessionMembership[];
};
export function tokenHash(token: string) { return createHash('sha256').update(token).digest('hex'); }

export async function getSession(): Promise<SessionUser | null> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.auth.getUser();
  if (error) {
    if (authServiceUnavailable(error)) throw new AppError('O serviço de autenticação está temporariamente indisponível. Tente novamente.', 503, 'AUTH_UNAVAILABLE');
    return null;
  }
  if (!data.user) return null;
  const user = await prisma.user.findUnique({
    where: { authUserId: data.user.id },
    include: { memberships: { where: { active: true, unit: { active: true, organization: { active: true } } }, include: { unit: { include: { organization: true } }, role: { include: { permissions: { include: { permission: true } } } } }, orderBy: { createdAt: 'asc' } } },
  });
  if (!user || !user.active) throw new AppError('Sua conta não está habilitada no ERP. Procure o administrador.', 403, 'ACCOUNT_DISABLED');
  const memberships = user.memberships;
  if (!memberships.length) throw new AppError('Sua conta não possui acesso a uma unidade ativa. Procure o administrador.', 403, 'NO_UNIT_ACCESS');
  const selectedId = (await cookies()).get(UNIT_COOKIE)?.value;
  const selected = selectedId ? memberships.find(m => m.unitId === selectedId) : memberships[0];
  if (!selected) throw new AppError('Você não tem acesso à unidade selecionada. Entre novamente para selecionar uma unidade autorizada.', 403, 'UNIT_FORBIDDEN');
  return {
    id: user.id, authUserId: data.user.id, name: user.name, email: user.email, active: user.active,
    unitId: selected.unitId, organizationId: selected.unit.organizationId,
    roleId: selected.roleId, role: { id: selected.role.id, name: selected.role.name },
    permissions: selected.role.permissions.map(link => link.permission.key),
    memberships: memberships.map(m => ({ unitId: m.unitId, unitName: m.unit.name, organizationId: m.unit.organizationId, organizationName: m.unit.organization.name, roleId: m.roleId, roleName: m.role.name })),
  };
}

export async function requireUser(permission?: string) {
  const user = await getSession();
  if (!user) throw new AppError('Sua sessão expirou. Entre novamente.', 401, 'SESSION_EXPIRED');
  if (permission && !user.permissions.includes(permission)) throw new AppError('Seu perfil não tem permissão para esta ação.', 403, 'PERMISSION_DENIED');
  return user;
}

export async function destroySession() {
  const supabase = await supabaseServer();
  const { error } = await supabase.auth.signOut({ scope: 'local' });
  if (error && authServiceUnavailable(error)) throw new AppError('Não foi possível encerrar a sessão no serviço de autenticação. Tente novamente.', 503);
  const jar = await cookies();
  jar.set(UNIT_COOKIE, '', { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 0 });
  jar.set('almox_session', '', { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 0 });
}

/** Financial fields and all legacy credential fields stay server-side. */
export function redactCosts<T>(value: T, user: Pick<SessionUser, 'permissions'>): T {
  const costs = user.permissions.includes('costs:read');
  function clean(item: unknown): unknown {
    if (Array.isArray(item)) return item.map(clean);
    if (item instanceof Date || item === null || typeof item !== 'object') return item;
    if ('toJSON' in item && typeof item.toJSON === 'function') return item;
    return Object.fromEntries(Object.entries(item).filter(([key]) => !['passwordHash', 'tokenHash', 'password', 'access_token', 'refresh_token'].includes(key) && (costs || !['unitCost', 'totalCost', 'unitPrice', 'totalPrice'].includes(key))).map(([key, val]) => [key, clean(val)]));
  }
  return clean(value) as T;
}
