import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { after, afterEach, before, beforeEach, test } from "node:test";
import type { PrismaClient } from "@prisma/client";
import type { SessionUser } from "../src/lib/auth";
import type { AccessIdentity, AccessProvider } from "../src/lib/access-provider";
import type { PasswordAuth } from "../src/services/password-access";

const testUrl = process.env.TEST_DATABASE_URL;
if (!testUrl) throw new Error("Use TEST_DATABASE_URL de uma base isolada.");
const parsed = new URL(testUrl), name = decodeURIComponent(parsed.pathname.slice(1));
if (!["postgres:", "postgresql:"].includes(parsed.protocol) || !/(^|[_-])tests?([_-]|$)/i.test(name)) throw new Error("Banco exclusivo de testes obrigatório.");
process.env.DATABASE_URL = testUrl; process.env.DIRECT_URL = testUrl;
const originalOrigin = process.env.APP_URL;
let db: PrismaClient, users: typeof import("../src/services/user-access"), emails: typeof import("../src/services/access-emails"), passwords: typeof import("../src/services/password-access");
let f: { org: string; units: string[]; roles: string[]; actor: SessionUser; target: SessionUser; external: SessionUser;
  identities: Map<string, AccessIdentity>; addresses: Set<string>; calls: string[]; provider: AccessProvider; failMail: boolean; signouts: number };
const id = randomUUID;
const code = (expected: string) => (error: unknown) => (error as { code?: string }).code === expected;
const status = (expected: number) => (error: unknown) => (error as { status?: number }).status === expected;
before(async () => {
  ({ prisma: db } = await import("../src/lib/db")); users = await import("../src/services/user-access"); emails = await import("../src/services/access-emails"); passwords = await import("../src/services/password-access");
  assert.equal((await db.$queryRaw<Array<{ name: string }>>`SELECT current_database()::text AS name`)[0].name, name);
});
beforeEach(async () => {
  process.env.APP_URL = "https://almox.example.invalid";
  const suffix = id(), org = await db.organization.create({ data: { name: `TEST-ONBOARD-${suffix}` } });
  const units = await Promise.all([0, 1].map(i => db.operationalUnit.create({ data: { organizationId: org.id, code: `TEST-ONBOARD-${i}-${suffix}`, name: `Unidade ${i}` } })));
  const admin = await db.role.create({ data: { name: `TEST-ONBOARD-ADMIN-${suffix}` } }), operator = await db.role.create({ data: { name: `TEST-ONBOARD-OP-${suffix}` } });
  for (const key of ["users:manage", "records:delete"]) { const p = await db.permission.upsert({ where: { key }, create: { key }, update: {} }); await db.rolePermission.create({ data: { roleId: admin.id, permissionId: p.id } }); }
  const people: SessionUser[] = [];
  for (const i of [0, 1, 2]) {
    const unit = units[i === 2 ? 1 : 0], role = i === 0 ? admin : operator;
    const user = await db.user.create({ data: { name: `Pessoa ${i}`, email: `${i}-${suffix}@example.invalid`, roleId: role.id, authUserId: id(), memberships: { create: { unitId: unit.id, roleId: role.id } } } });
    people.push({ id: user.id, authUserId: user.authUserId!, unitId: unit.id, organizationId: org.id, roleId: role.id, role: { id: role.id, name: role.name },
      active: true, name: user.name, email: user.email, memberships: [], permissions: i === 0 ? ["users:manage", "records:delete"] : [] });
  }
  f = { org: org.id, units: units.map(u => u.id), roles: [admin.id, operator.id], actor: people[0], target: people[1], external: people[2],
    identities: new Map(people.map(p => [p.authUserId, { id: p.authUserId, email: p.email, email_confirmed_at: new Date().toISOString() }])),
    addresses: new Set(people.map(p => p.email)), calls: [], failMail: false, signouts: 0, provider: null! };
  f.provider = {
    getIdentity: async authId => { f.calls.push("get"); return { user: f.identities.get(authId) ?? null, error: f.identities.has(authId) ? null : { status: 404, code: "user_not_found" } }; },
    createIdentity: async (email) => { f.calls.push("create"); const identity = { id: id(), email }; f.identities.set(identity.id, identity); f.addresses.add(email); return { user: identity, error: null }; },
    deleteIdentity: async authId => { f.calls.push("delete"); f.identities.delete(authId); },
    invite: async email => { f.calls.push("invite"); const identity = [...f.identities.values()].find(p => p.email === email)!;
      if (f.failMail) return { user: null, error: { status: 429, code: "over_email_send_rate_limit" } };
      identity.invited_at = new Date().toISOString(); return { user: identity, error: null }; },
    recover: async () => { f.calls.push("recover"); return { error: f.failMail ? { status: 429, code: "over_email_send_rate_limit" } : null }; },
  };
});
afterEach(async () => {
  if (!f) return;
  const where = { unitId: { in: f.units } };
  const memberships = await db.unitMembership.findMany({ where, select: { userId: true } }); const userIds = [...new Set(memberships.map(m => m.userId))];
  const keys = [...f.addresses].map(email => createHash("sha256").update(`auth-mail:${email}`).digest("hex"));
  keys.push(createHash("sha256").update(`invitation:${f.actor.id}`).digest("hex"));
  await db.$transaction(async tx => {
    await tx.auditLog.deleteMany({ where }); await tx.loginAttempt.deleteMany({ where: { key: { in: keys } } });
    await tx.unitMembership.deleteMany({ where }); await tx.user.deleteMany({ where: { id: { in: userIds } } });
    await tx.operationalUnit.deleteMany({ where: { id: { in: f.units } } }); await tx.rolePermission.deleteMany({ where: { roleId: { in: f.roles } } });
    await tx.role.deleteMany({ where: { id: { in: f.roles } } }); await tx.organization.delete({ where: { id: f.org } });
  });
});
after(async () => { await db?.$disconnect(); if (originalOrigin === undefined) delete process.env.APP_URL; else process.env.APP_URL = originalOrigin; });
const input = () => ({ name: "Nova pessoa", email: `${id()}@example.invalid`, roleId: f.roles[1] });
async function unconfirmed() { f.identities.set(f.target.authUserId, { id: f.target.authUserId, email: f.target.email }); }
function passwordAuth(person = f.target, extra: Partial<PasswordAuth> = {}): PasswordAuth {
  const user = { id: person.authUserId, email: person.email };
  return { getUser: async () => ({ data: { user }, error: null }), updateUser: async () => ({ data: { user }, error: null }),
    signOut: async () => { f.signouts++; return { error: null }; },
    refreshSession: async () => ({ data: { user, session: { access_token: "fixture.valid.access", refresh_token: "fixture.valid.refresh" } }, error: null }),
    setSession: async () => ({ data: { user, session: { access_token: "fixture.valid.access", refresh_token: "fixture.valid.refresh" } }, error: null }), ...extra } as PasswordAuth;
}

test("novo cadastro salva vínculo antes do convite e registra o estado convidado sem escolher senha", async () => {
  const data = input(); const result = await users.saveUserAccess(f.actor, data, undefined, () => f.provider);
  assert.equal(result.notification?.state, "REQUESTED"); assert.equal(f.calls.filter(x => x === "invite").length, 1);
  const member = (await users.listUserAccess(f.actor)).find(p => p.email === data.email)!; assert.equal(member.accessState, "INVITED"); assert.equal(member.passwordDefinedAt, null);
  const identity = [...f.identities.values()].find(p => p.email === data.email)!; assert.equal(identity.email_confirmed_at, undefined);
  const audits = await db.auditLog.findMany({ where: { unitId: f.units[0] } }); assert.equal(JSON.stringify(audits).includes("password"), false);
});
test("limite de e-mail preserva cadastro pendente e retorno explícito, sem duplicar acesso ao tentar salvar de novo", async () => {
  f.failMail = true; const data = input(); const first = await users.saveUserAccess(f.actor, data, undefined, () => f.provider);
  assert.equal(first.notification?.state, "PENDING"); assert.match(first.accessNotice ?? "", /Acesso cadastrado/);
  const member = (await users.listUserAccess(f.actor)).find(p => p.id === first.id)!; assert.equal(member.accessState, "PENDING"); assert.equal(member.lastMailState, "FAILED");
  const second = await users.saveUserAccess(f.actor, data, undefined, () => f.provider); assert.equal(second.id, first.id);
  assert.equal(await db.unitMembership.count({ where: { userId: first.id, unitId: f.units[0] } }), 1); assert.equal(f.calls.filter(x => x === "invite").length, 1);
});
test("administrador revogado não cria identidade nem envia e-mail", async () => {
  await db.unitMembership.update({ where: { userId_unitId: { userId: f.actor.id, unitId: f.units[0] } }, data: { roleId: f.roles[1] } });
  await assert.rejects(users.saveUserAccess(f.actor, input(), undefined, () => f.provider), status(403)); assert.equal(f.calls.length, 0);
});
test("identidade existente confirmada pode ser vinculada sem mensagem e sem alterar a outra unidade", async () => {
  const before = await db.unitMembership.findMany({ where: { unitId: f.units[1] } });
  const result = await users.saveUserAccess(f.actor, { name: f.external.name, email: f.external.email, roleId: f.roles[1], authUserId: f.external.authUserId }, undefined, () => f.provider);
  assert.equal(result.id, f.external.id); assert.equal(f.calls.includes("invite"), false); assert.equal(f.calls.includes("recover"), false);
  assert.deepEqual(await db.unitMembership.findMany({ where: { unitId: f.units[1] } }), before);
});
test("UUID de outro e-mail e identidade não confirmada são recusados no vínculo explícito", async () => {
  await assert.rejects(users.saveUserAccess(f.actor, { ...input(), authUserId: f.target.authUserId }, undefined, () => f.provider), status(400));
  await unconfirmed(); await assert.rejects(users.saveUserAccess(f.actor, { name: f.target.name, email: f.target.email, roleId: f.roles[1], authUserId: f.target.authUserId }, undefined, () => f.provider), status(400));
});
test("envio administrativo exige pessoa da unidade, acesso ativo e a identidade atual", async () => {
  await assert.rejects(emails.sendAccessEmail(f.actor, f.external.id, { authUserId: f.external.authUserId }, () => f.provider), status(404));
  await assert.rejects(emails.sendAccessEmail(f.actor, f.target.id, { authUserId: id() }, () => f.provider), code("AUTH_IDENTITY_CHANGED"));
  await db.unitMembership.update({ where: { userId_unitId: { userId: f.target.id, unitId: f.units[0] } }, data: { active: false } });
  await assert.rejects(emails.sendAccessEmail(f.actor, f.target.id, { authUserId: f.target.authUserId }, () => f.provider), code("ACCESS_DISABLED")); assert.equal(f.calls.length, 0);
});
test("consulta de estado não envia mensagens e identifica vínculo ausente ou desatualizado", async () => {
  const ready = await emails.accessDetails(f.actor, f.target.id, () => f.provider); assert.equal(ready.providerState, "READY"); assert.equal(ready.canSend, true); assert.equal(f.calls.includes("recover"), false);
  f.identities.delete(f.target.authUserId); assert.equal((await emails.accessDetails(f.actor, f.target.id, () => f.provider)).providerState, "MISSING");
  f.identities.set(f.target.authUserId, { id: f.target.authUserId, email: "wrong@example.invalid" });
  assert.equal((await emails.accessDetails(f.actor, f.target.id, () => f.provider)).providerState, "MISMATCH");
  await assert.rejects(emails.sendAccessEmail(f.actor, f.target.id, { authUserId: f.target.authUserId }, () => f.provider), code("AUTH_IDENTITY_CHANGED"));
});
test("reenvios simultâneos compartilham espera no banco e apenas um chega ao provedor", async () => {
  const result = await Promise.allSettled([0, 1].map(() => emails.sendAccessEmail(f.actor, f.target.id, { authUserId: f.target.authUserId }, () => f.provider)));
  assert.equal(result.filter(r => r.status === "fulfilled").length, 1); assert.equal(f.calls.filter(x => x === "recover").length, 1);
  const denied = result.find(r => r.status === "rejected") as PromiseRejectedResult; assert.equal(denied.reason.code, "AUTH_EMAIL_COOLDOWN"); assert.ok(denied.reason.retryAfter > 0 && denied.reason.retryAfter <= 60);
});
test("e-mail confirmado recebe recuperação; não confirmado recebe convite sem recriar a identidade", async () => {
  await unconfirmed(); await emails.sendAccessEmail(f.actor, f.target.id, { authUserId: f.target.authUserId }, () => f.provider);
  assert.equal(f.calls.filter(x => x === "invite").length, 1); assert.equal(f.calls.includes("create"), false);
  assert.equal((await users.listUserAccess(f.actor)).find(p => p.id === f.target.id)?.accessState, "INVITED");
});
test("histórico antigo e identidade substituída não confirmam primeiro acesso de outro UUID", async () => {
  await db.auditLog.createMany({ data: [
    { userId: f.target.id, unitId: f.units[0], action: "LOGIN", entity: "User", entityId: f.target.id },
    { userId: f.target.id, unitId: f.units[0], action: "LOGIN", entity: "User", entityId: f.target.id, after: { authUserId: id() } },
  ] });
  assert.equal((await users.listUserAccess(f.actor)).find(p => p.id === f.target.id)?.accessState, "PENDING");
  await db.auditLog.create({ data: { userId: f.target.id, unitId: f.units[0], action: "LOGIN", entity: "User", entityId: f.target.id, after: { authUserId: f.target.authUserId } } });
  assert.equal((await users.listUserAccess(f.actor)).find(p => p.id === f.target.id)?.accessState, "ACTIVE");
});
test("contexto de senha exige identidade validada e pelo menos uma unidade ativa", async () => {
  assert.equal((await passwords.passwordContext(passwordAuth())).email, f.target.email);
  await db.unitMembership.update({ where: { userId_unitId: { userId: f.target.id, unitId: f.units[0] } }, data: { active: false } });
  await assert.rejects(passwords.passwordContext(passwordAuth()), code("ACCOUNT_DISABLED"));
});
test("troca de senha registra sucesso sem armazenar segredo e pede encerramento das sessões", async () => {
  const secret = "Fixture-only-password-987654";
  const result = await passwords.changeAccessPassword({ password: secret }, passwordAuth()); assert.equal(result.ok, true); assert.equal(f.signouts, 1);
  const audit = await db.auditLog.findFirstOrThrow({ where: { action: "PASSWORD_UPDATED", entityId: f.target.id } }); assert.equal(JSON.stringify(audit).includes(secret), false);
  assert.equal((await users.listUserAccess(f.actor)).find(p => p.id === f.target.id)?.passwordDefinedAt !== null, true);
});
test("senha rejeitada não registra conclusão nem encerra a sessão como se tivesse funcionado", async () => {
  const auth = passwordAuth(f.target, { updateUser: async () => ({ data: { user: null }, error: { status: 422, code: "same_password" } }) } as unknown as Partial<PasswordAuth>);
  await assert.rejects(passwords.changeAccessPassword({ password: "Fixture-only-password-987654" }, auth), code("PASSWORD_UNCHANGED"));
  assert.equal(await db.auditLog.count({ where: { action: "PASSWORD_UPDATED", entityId: f.target.id } }), 0); assert.equal(f.signouts, 0);
});
test("falha no encerramento externo não informa que a senha já alterada foi recusada", async () => {
  const auth = passwordAuth(f.target, { signOut: async () => ({ error: { status: 503 } }) } as unknown as Partial<PasswordAuth>);
  assert.equal((await passwords.changeAccessPassword({ password: "Fixture-only-password-987654" }, auth)).ok, true);
});
test("fragmento precisa de dois tokens válidos da mesma pessoa antes de persistir sessão", async () => {
  let persisted = 0;
  const input = { type: "invite", accessToken: "fixture.access.token12345", refreshToken: "fixture.refresh.token" };
  const standalone = passwordAuth(), server = passwordAuth(f.target, { setSession: async () => { persisted++; return { data: { user: { id: f.target.authUserId, email: f.target.email } }, error: null }; } } as unknown as Partial<PasswordAuth>);
  assert.equal((await passwords.completeImplicitLink(input, standalone, server)).next, "/primeiro-acesso"); assert.equal(persisted, 1);
  const mismatched = passwordAuth(f.target, { refreshSession: async () => ({ data: { user: { id: f.external.authUserId }, session: { access_token: "fixture", refresh_token: "fixture" } }, error: null }) } as unknown as Partial<PasswordAuth>);
  await assert.rejects(passwords.completeImplicitLink(input, mismatched, server), code("PASSWORD_LINK_REQUIRED")); assert.equal(persisted, 1);
});
test("fragmento de identidade sem acesso ao ERP não persiste sessão", async () => {
  let persisted = 0;
  await db.unitMembership.update({ where: { userId_unitId: { userId: f.target.id, unitId: f.units[0] } }, data: { active: false } });
  const server = passwordAuth(f.target, { setSession: async () => { persisted++; return { data: { user: null, session: null }, error: null }; } } as unknown as Partial<PasswordAuth>);
  await assert.rejects(passwords.completeImplicitLink({ type: "recovery", accessToken: "fixture.access.token12345", refreshToken: "fixture.refresh.token" }, passwordAuth(), server), code("ACCOUNT_DISABLED")); assert.equal(persisted, 0);
});

test("falha de vínculo remove somente a identidade criada nesta operação e não envia convite", async () => {
  const role = await db.role.create({ data: { name: `TEST-ONBOARD-ROLLBACK-${id()}` } }); f.roles.push(role.id);
  const data = { ...input(), roleId: role.id }, originalCreate = f.provider.createIdentity;
  f.provider.createIdentity = async (email, name) => { const result = await originalCreate(email, name); await db.role.delete({ where: { id: role.id } }); return result; };
  await assert.rejects(users.saveUserAccess(f.actor, data, undefined, () => f.provider));
  assert.equal(await db.user.count({ where: { email: data.email } }), 0); assert.equal(f.calls.filter(call => call === "delete").length, 1);
  assert.equal(f.calls.includes("invite"), false); assert.ok(f.identities.has(f.target.authUserId));
});
test("resposta sem confirmação de identidade não é registrada como senha atualizada", async () => {
  const auth = passwordAuth(f.target, { updateUser: async () => ({ data: { user: null }, error: null }) } as unknown as Partial<PasswordAuth>);
  await assert.rejects(passwords.changeAccessPassword({ password: "Fixture-only-password-987654" }, auth), code("PASSWORD_UPDATE_UNCONFIRMED"));
  assert.equal(await db.auditLog.count({ where: { entityId: f.target.id, action: "PASSWORD_UPDATED" } }), 0);
});

test("limite temporário de validação não é apresentado como link expirado e não persiste sessão", async () => {
  let persisted = 0;
  const unavailable = passwordAuth(f.target, { getUser: async () => ({ data: { user: null }, error: { status: 429 } }) } as unknown as Partial<PasswordAuth>);
  const server = passwordAuth(f.target, { setSession: async () => { persisted++; return { data: { user: null, session: null }, error: null }; } } as unknown as Partial<PasswordAuth>);
  await assert.rejects(passwords.completeImplicitLink({ type: "recovery", accessToken: "fixture.access.token12345", refreshToken: "fixture.refresh.token" }, unavailable, server), code("AUTH_UNAVAILABLE"));
  assert.equal(persisted, 0);
});

test("troca de conta em outra aba não altera a senha de uma identidade diferente da exibida", async () => {
  let updates = 0;
  const auth = passwordAuth(f.target, { updateUser: async () => { updates++; return { data: { user: { id: f.target.authUserId } }, error: null }; } } as unknown as Partial<PasswordAuth>);
  await assert.rejects(passwords.changeAccessPassword({ password: "Fixture-only-password-987654", expectedIdentityId: f.actor.authUserId }, auth), code("PASSWORD_ACCOUNT_CHANGED"));
  assert.equal(updates, 0); assert.equal(await db.auditLog.count({ where: { entityId: f.target.id, action: "PASSWORD_CHANGE_REQUESTED" } }), 0);
});
