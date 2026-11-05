import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, afterEach, before, beforeEach, describe, test } from 'node:test';
import type { PrismaClient, User } from '@prisma/client';
import type { SessionUser } from '../src/lib/auth';
import { ZodError } from 'zod';

const database = process.env.TEST_DATABASE_URL;
if (!database) throw new Error('TEST_DATABASE_URL é obrigatório para testes isolados de acesso.');
const parsed = new URL(database);
const databaseName = decodeURIComponent(parsed.pathname.slice(1));
if (!['postgresql:', 'postgres:'].includes(parsed.protocol) || !/(^|[_-])tests?([_-]|$)/i.test(databaseName)) throw new Error('O banco de integração deve conter test no nome.');
process.env.DATABASE_URL = database;
let db: PrismaClient;
let service: typeof import('../src/services/user-access');
let fixture: { organizationId: string; unitId: string; otherUnitId: string; userIds: string[]; roleIds: string[]; admin: SessionUser; second: SessionUser; externalId: string; operatorRoleId: string };

before(async () => {
  ({ prisma: db } = await import('../src/lib/db'));
  service = await import('../src/services/user-access');
  const actual = await db.$queryRaw<Array<{ name: string }>>`SELECT current_database()::text AS name`;
  assert.equal(actual[0].name, databaseName);
});
beforeEach(async () => {
  const key = randomUUID();
  const organization = await db.organization.create({ data: { name: `TEST-ACCESS-${key}` } });
  const unit = await db.operationalUnit.create({ data: { organizationId: organization.id, code: `TEST-A-${key}`, name: 'Unidade de testes A' } });
  const other = await db.operationalUnit.create({ data: { organizationId: organization.id, code: `TEST-B-${key}`, name: 'Unidade de testes B' } });
  const role = await db.role.create({ data: { name: `TEST-ADMIN-${key}` } });
  const operator = await db.role.create({ data: { name: `TEST-OPERATOR-${key}` } });
  for (const permissionKey of ['users:manage', 'records:delete']) {
    const permission = await db.permission.upsert({ where: { key: permissionKey }, create: { key: permissionKey }, update: {} });
    await db.rolePermission.create({ data: { roleId: role.id, permissionId: permission.id } });
  }
  const users: User[] = [];
  for (let i = 0; i < 3; i++) users.push(await db.user.create({ data: { name: `Usuário de teste ${i}`, email: `test-${i}-${key}@example.invalid`, authUserId: randomUUID(), roleId: role.id } }));
  await db.unitMembership.createMany({ data: [
    { userId: users[0].id, unitId: unit.id, roleId: role.id },
    { userId: users[1].id, unitId: unit.id, roleId: role.id },
    { userId: users[1].id, unitId: other.id, roleId: operator.id },
    { userId: users[2].id, unitId: other.id, roleId: operator.id },
  ] });
  const actor = (u: typeof users[number]): SessionUser => ({ id: u.id, authUserId: u.authUserId!, name: u.name, email: u.email, active: true, unitId: unit.id, organizationId: organization.id, roleId: role.id, role: { id: role.id, name: role.name }, permissions: ['users:manage', 'records:delete'], memberships: [{ unitId: unit.id, unitName: unit.name, organizationId: organization.id, organizationName: organization.name, roleId: role.id, roleName: role.name }] });
  fixture = { organizationId: organization.id, unitId: unit.id, otherUnitId: other.id, userIds: users.map(u => u.id), roleIds: [role.id, operator.id], admin: actor(users[0]), second: actor(users[1]), externalId: users[2].id, operatorRoleId: operator.id };
});
afterEach(async () => {
  if (!fixture) return;
  await db.$transaction(async tx => {
    await tx.auditLog.deleteMany({ where: { userId: { in: fixture.userIds } } });
    await tx.unitMembership.deleteMany({ where: { userId: { in: fixture.userIds } } });
    await tx.user.deleteMany({ where: { id: { in: fixture.userIds } } });
    await tx.operationalUnit.deleteMany({ where: { id: { in: [fixture.unitId, fixture.otherUnitId] } } });
    await tx.organization.delete({ where: { id: fixture.organizationId } });
    await tx.rolePermission.deleteMany({ where: { roleId: { in: fixture.roleIds } } });
    await tx.role.deleteMany({ where: { id: { in: fixture.roleIds } } });
  });
});
after(async () => { await db?.$disconnect(); });
const status = (expected: number) => (error: unknown) => { assert.equal((error as { status?: number }).status, expected); return true; };

describe('administração de acesso por unidade', () => {
  test('listagem e detalhes não expõem usuários exclusivos de outra unidade', async () => {
    const list = await service.listUserAccess(fixture.admin);
    assert.equal(list.length, 2);
    assert.equal(list.some(user => user.id === fixture.externalId), false);
    assert.equal(JSON.stringify(list).includes('passwordHash'), false);
    await assert.rejects(service.getUserAccess(fixture.admin, fixture.externalId), status(404));
    await assert.rejects(service.saveUserAccess(fixture.admin, { active: false }, fixture.externalId), status(404));
  });
  test('desativação limita-se à associação atual e preserva identidade e acesso da outra unidade', async () => {
    await service.archiveUserAccess(fixture.admin, fixture.second.id);
    const memberships = await db.unitMembership.findMany({ where: { userId: fixture.second.id } });
    assert.equal(memberships.find(m => m.unitId === fixture.unitId)?.active, false);
    assert.equal(memberships.find(m => m.unitId === fixture.otherUnitId)?.active, true);
    assert.equal((await db.user.findUniqueOrThrow({ where: { id: fixture.second.id } })).active, true);
    const audit = await db.auditLog.findFirstOrThrow({ where: { action: 'USER_ACCESS_UPDATED', userId: fixture.admin.id } });
    assert.equal(audit.unitId, fixture.unitId);
  });
  test('próprio administrador não pode se desativar ou rebaixar', async () => {
    await assert.rejects(service.saveUserAccess(fixture.admin, { active: false }, fixture.admin.id), status(400));
    await assert.rejects(service.saveUserAccess(fixture.admin, { roleId: fixture.operatorRoleId }, fixture.admin.id), status(400));
  });
  test('uma permissão revogada no banco impede a gravação mesmo com ator previamente autorizado', async () => {
    await db.unitMembership.update({ where: { userId_unitId: { userId: fixture.admin.id, unitId: fixture.unitId } }, data: { roleId: fixture.operatorRoleId } });
    await assert.rejects(service.saveUserAccess(fixture.admin, { active: false }, fixture.second.id), status(403));
  });
  test('revogações concorrentes não deixam a unidade sem administrador', async () => {
    const results = await Promise.allSettled([
      service.archiveUserAccess(fixture.admin, fixture.second.id),
      service.archiveUserAccess(fixture.second, fixture.admin.id),
    ]);
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    assert.equal(await db.unitMembership.count({ where: { unitId: fixture.unitId, active: true, roleId: fixture.admin.roleId } }), 1);
  });
  test('edição de acesso não aceita senha, identidade nem campos globais enviados pelo cliente', async () => {
    for (const input of [{ password: 'Senha de teste' }, { name: 'Nome global alterado' }, { authUserId: randomUUID() }, { email: 'other@example.invalid' }, { unitId: fixture.otherUnitId }]) {
      await assert.rejects(service.saveUserAccess(fixture.admin, input, fixture.second.id), ZodError);
    }
  });
});
