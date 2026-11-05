import assert from 'node:assert/strict';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { PrismaClient } from '@prisma/client';
import { createClient } from '@supabase/supabase-js';
import { qaConfig, mergeResponseCookies, cookieHeader } from './qa-config.mjs';

// This advanced fixture runner is deliberately restricted to the isolated local provider.
const { baseURL: base, unitId } = qaConfig({ writes: true });
const providerUrl = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL);
const databaseUrl = new URL(process.env.DATABASE_URL);
const databaseName = decodeURIComponent(databaseUrl.pathname.slice(1));
assert.ok(['postgres:', 'postgresql:'].includes(databaseUrl.protocol) && /(^|[_-])tests?([_-]|$)/i.test(databaseName), 'Use uma base PostgreSQL exclusiva cujo nome contenha test.');
const loopback = value => ['localhost', '127.0.0.1', '[::1]'].includes(value);
assert.ok(loopback(new URL(base).hostname) && loopback(providerUrl.hostname) && loopback(databaseUrl.hostname), 'Este roteiro aceita somente serviços locais isolados.');
assert.equal(new URL(base).port, '3001', 'Use o app de homologação local autorizado.');
assert.equal(databaseUrl.port, '55439', 'Use o PostgreSQL isolado autorizado.');
assert.ok(process.env.SUPABASE_SERVICE_ROLE_KEY, 'Configure a credencial administrativa local sem registrá-la.');
const db = new PrismaClient();
const admin = createClient(providerUrl.origin, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const suffix = randomUUID();
const email = `auth-flow-${suffix}@example.invalid`;
const password = `Auth-Test!${randomBytes(20).toString('hex')}`;
const nextPassword = `New-Test!${randomBytes(20).toString('hex')}`;
const evidence = { startedAt: new Date().toISOString(), environment: 'isolated-local', provider: 'official Supabase Auth / GoTrue', checks: [], cleanup: [], result: 'running', limitations: ['Tokens de recuperação gerados administrativamente; entrega de e-mail/SMTP não foi testada.', 'Nenhum projeto Supabase remoto nem deployment Vercel foi acessado.'] };
let authId;
let userId;
let session = new Map();
async function request(path, { method = 'GET', body, jar = new Map() } = {}) {
  const response = await fetch(base + path, { method, headers: { Origin: base, Cookie: cookieHeader(jar), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, redirect: 'manual', signal: AbortSignal.timeout(15000) });
  mergeResponseCookies(jar, response.headers);
  const data = (response.headers.get('content-type') || '').includes('application/json') ? await response.json() : null;
  return { status: response.status, data, headers: response.headers };
}
function status(result, expected) { assert.equal(result.status, expected, `Status inesperado: ${result.status}; esperado ${expected}.`); return result.data?.data; }
async function login(secret = password, jar = new Map()) { const result = await request('/api/auth/login', { method: 'POST', body: { email, password: secret }, jar }); return { ...result, jar }; }
async function check(name, work) {
  const start = performance.now();
  try { await work(); evidence.checks.push({ name, passed: true, durationMs: Math.round(performance.now() - start) }); console.log(`PASS ${name}`); }
  catch { evidence.checks.push({ name, passed: false }); console.error(`FAIL ${name}`); throw new Error('Falha de validação; consulte apenas a etapa indicada no artefato.'); }
}
try {
  const [database] = await db.$queryRaw`SELECT current_database() AS name`;
  assert.equal(database.name, databaseName, 'A conexão deve usar exatamente o banco de testes selecionado.');
  status(await request('/api/health'), 200);
  const unit = await db.operationalUnit.findUniqueOrThrow({ where: { id: unitId } });
  assert.ok(unit.active);
  const role = await db.role.findUniqueOrThrow({ where: { name: 'OPERADOR' } });
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  assert.ok(!created.error && created.data.user, 'Falha ao criar somente a identidade de teste.');
  authId = created.data.user.id;
  await check('Identidade Supabase real sem perfil ERP não obtém acesso', async () => {
    const result = await login(); status(result, 403); assert.equal(result.data.code, 'ACCOUNT_DISABLED');
    status(await request('/api/me', { jar: result.jar }), 401);
  });
  const user = await db.user.create({ data: { authUserId: authId, name: 'Fixture de autenticação local', email, roleId: role.id } });
  userId = user.id;
  await check('Perfil ERP sem associação a unidade não obtém acesso', async () => {
    const result = await login(); status(result, 403); assert.equal(result.data.code, 'NO_UNIT_ACCESS');
  });
  await db.unitMembership.create({ data: { userId, unitId, roleId: role.id } });
  await check('Associação autorizada permite login real com cookies seguros', async () => {
    const result = await login(); status(result, 200); session = result.jar;
    assert.ok(result.headers.getSetCookie().every(c => /HttpOnly/i.test(c) && /SameSite=lax/i.test(c)));
    const me = status(await request('/api/me', { jar: session }), 200);
    assert.equal(me.id, userId); assert.equal(me.unitId, unitId); assert.equal(me.authUserId, authId);
  });
  await check('Senha incorreta é rejeitada pelo provedor real', async () => {
    status(await login(`Wrong!${randomBytes(16).toString('hex')}`), 401);
  });
  await check('Unidade forjada no cookie não amplia acesso', async () => {
    const forged = new Map(session); forged.set('almox_unit', randomUUID());
    const result = await request('/api/me', { jar: forged }); status(result, 403); assert.equal(result.data.code, 'UNIT_FORBIDDEN');
  });
  await db.unitMembership.update({ where: { userId_unitId: { userId, unitId } }, data: { active: false } });
  await check('Associação desativada bloqueia sessão existente e novo login', async () => {
    const current = await request('/api/me', { jar: session }); status(current, 403); assert.equal(current.data.code, 'NO_UNIT_ACCESS');
    const result = await login(); status(result, 403); assert.equal(result.data.code, 'NO_UNIT_ACCESS');
  });
  await db.unitMembership.update({ where: { userId_unitId: { userId, unitId } }, data: { active: true } });
  await check('Reativação explícita da fixture permite novo login', async () => { const result = await login(); status(result, 200); session = result.jar; });
  const recovery = await admin.auth.admin.generateLink({ type: 'recovery', email, options: { redirectTo: `${base}/auth/callback?next=/recuperar-senha` } });
  assert.ok(!recovery.error && recovery.data.properties.hashed_token, 'Não foi possível gerar o token de recuperação de teste.');
  const recoveryToken = recovery.data.properties.hashed_token;
  const recoveryJar = new Map();
  await check('TokenHash real de recuperação é confirmado no callback do ERP', async () => {
    const result = await request(`/auth/confirm?type=recovery&token_hash=${encodeURIComponent(recoveryToken)}`, { jar: recoveryJar });
    assert.equal(result.status, 307);
    assert.equal(new URL(result.headers.get('location')).pathname, '/recuperar-senha');
    status(await request('/api/me', { jar: recoveryJar }), 200);
  });
  await check('Redefinição grava a senha no provedor e encerra a sessão atual', async () => {
    status(await request('/api/auth/update-password', { method: 'POST', jar: recoveryJar, body: { password: nextPassword } }), 200);
    status(await request('/api/me', { jar: recoveryJar }), 401);
    const audit = await db.auditLog.findFirst({ where: { userId, action: 'PASSWORD_UPDATED' } });
    assert.ok(audit); assert.equal(audit.unitId, unitId);
  });
  await check('Senha anterior deixa de autenticar e nova senha autentica', async () => {
    status(await login(password), 401);
    const result = await login(nextPassword); status(result, 200); session = result.jar;
  });
  await check('Token de recuperação consumido não pode ser reutilizado', async () => {
    const result = await request(`/auth/confirm?type=recovery&token_hash=${encodeURIComponent(recoveryToken)}`);
    assert.equal(result.status, 307);
    assert.equal(new URL(result.headers.get('location')).searchParams.get('error'), 'recovery_expired');
  });
  await check('Logout remove sessão autenticada do navegador de teste', async () => {
    status(await request('/api/auth/logout', { method: 'POST', jar: session }), 200);
    status(await request('/api/me', { jar: session }), 401);
  });
  await db.user.update({ where: { id: userId }, data: { active: false } });
  await check('Identidade ERP desativada globalmente não autentica', async () => {
    const result = await login(nextPassword); status(result, 403); assert.equal(result.data.code, 'ACCOUNT_DISABLED');
  });
  evidence.result = 'passed';
} catch {
  evidence.result = 'failed'; process.exitCode = 1;
  console.error('O roteiro não concluiu todas as verificações. Nenhum segredo foi registrado.');
} finally {
  try {
    if (userId) await db.$transaction(async tx => {
      await tx.auditLog.deleteMany({ where: { userId } });
      await tx.unitMembership.deleteMany({ where: { userId } });
      await tx.user.deleteMany({ where: { id: userId } });
    });
    const keys = ['login', 'recovery'].map(action => createHash('sha256').update(`${action}:${email}`).digest('hex'));
    await db.loginAttempt.deleteMany({ where: { key: { in: keys } } });
    evidence.cleanup.push({ operation: 'own-erp-fixture-only', passed: true });
  } catch { evidence.cleanup.push({ operation: 'own-erp-fixture-only', passed: false }); process.exitCode = 1; }
  if (authId) {
    const removed = await admin.auth.admin.deleteUser(authId);
    evidence.cleanup.push({ operation: 'own-auth-fixture-only', passed: !removed.error });
    if (removed.error) process.exitCode = 1;
  }
  await db.$disconnect();
  await mkdir('artifacts', { recursive: true });
  await writeFile('artifacts/uca-auth-flows.json', JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify({ passed: evidence.checks.filter(c => c.passed).length, total: evidence.checks.length, result: evidence.result }));
}
