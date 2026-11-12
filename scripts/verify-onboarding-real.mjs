import assert from 'node:assert/strict';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { PrismaClient } from '@prisma/client';
import { createClient } from '@supabase/supabase-js';
import { chromium, expect } from '@playwright/test';
import { qaConfig, mergeResponseCookies, cookieHeader } from './qa-config.mjs';

const { baseURL: base, unitId } = qaConfig({ writes: true });
const loopback = value => ['localhost', '127.0.0.1', '[::1]'].includes(value);
const providerUrl = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL), databaseUrl = new URL(process.env.DATABASE_URL);
const mailbox = new URL(process.env.QA_MAILBOX_ORIGIN), name = decodeURIComponent(databaseUrl.pathname.slice(1));
assert.ok([new URL(base), providerUrl, databaseUrl, mailbox].every(url => loopback(url.hostname)), 'Somente serviços locais isolados.');
assert.ok(/(^|[_-])tests?([_-]|$)/i.test(name), 'A base deve conter test no nome.');
assert.equal(new URL(base).port, '3130'); assert.equal(databaseUrl.port, '55450'); assert.equal(providerUrl.port, '10098'); assert.equal(mailbox.port, '10097');
assert.ok(process.env.QA_ADMIN_EMAIL?.endsWith('@example.invalid') && process.env.QA_ADMIN_PASSWORD && process.env.SUPABASE_SERVICE_ROLE_KEY);
const db = new PrismaClient(), admin = createClient(providerUrl.origin, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const email = `onboarding-${randomUUID()}@example.invalid`, password = 'Fixture!' + randomBytes(20).toString('hex'), nextPassword = 'Updated!' + randomBytes(20).toString('hex');
const evidence = { scope: 'Isolated local PostgreSQL, official Supabase Auth and local SMTP capture; no external recipients or production accounts.', provider: 'supabase/gotrue:v2.185.0', checks: [], result: 'running' };
const jar = new Map(); let browser, memberId, identityId;
async function request(path, { method = 'GET', body, cookies = jar, origin = base } = {}) {
  const response = await fetch(base + path, { method, headers: { Origin: origin, Cookie: cookieHeader(cookies), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined, redirect: 'manual', signal: AbortSignal.timeout(60000) });
  mergeResponseCookies(cookies, response.headers);
  return { status: response.status, data: await response.json(), headers: response.headers };
}
const unwrap = (response, status = 200) => { assert.equal(response.status, status); return response.data.data; };
async function check(name, work) {
  const start = performance.now();
  try { await work(); evidence.checks.push({ name, passed: true, durationMs: Math.round(performance.now() - start) }); console.log('PASS', name); }
  catch { evidence.checks.push({ name, passed: false }); throw new Error('Falha na etapa de homologação indicada, sem registrar credenciais.'); }
}
async function messages() { const response = await fetch(new URL('/messages?to=' + encodeURIComponent(email), mailbox)); return response.json(); }
async function latestLink(type) {
  for (let attempt = 0; attempt < 30; attempt++) {
    const items = await messages();
    const source = items.at(-1)?.source?.replace(/=\r?\n/g, '').replace(/=([a-f0-9]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16))) ?? '';
    const links = (source.match(/https?:\/\/[^\s"'<>]+/g) ?? []).map(value => value.replaceAll('&amp;', '&'));
    const result = links.find(value => { try { const parsed = new URL(value); return parsed.origin === providerUrl.origin && parsed.pathname === '/auth/v1/verify' && parsed.searchParams.get('type') === type; } catch { return false; } });
    if (result) return result;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error('O capturador SMTP local não recebeu o tipo de mensagem esperado.');
}
async function openLink(url, expectedPage) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' });
  const page = await context.newPage(); page.setDefaultTimeout(15000);
  await page.goto(url); await page.getByRole('button', { name: 'Validar link e continuar', exact: true }).waitFor();
  assert.equal(new URL(page.url()).hash, ''); assert.equal(new URL(page.url()).search, '');
  await page.getByRole('button', { name: 'Validar link e continuar', exact: true }).click();
  await page.waitForURL(base + expectedPage); await expect(page.locator('.password-identity')).toContainText(email);
  const stored = await context.cookies(); assert.ok(stored.filter(cookie => cookie.name.startsWith('sb-')).every(cookie => cookie.httpOnly && cookie.sameSite === 'Lax'));
  assert.equal(await page.evaluate(() => Object.keys(localStorage).some(key => key.startsWith('sb-'))), false);
  return { page, context };
}
try {
  assert.equal((await db.$queryRaw`SELECT current_database()::text AS name`)[0].name, name);
  const role = await db.role.findFirstOrThrow({ where: { name: { startsWith: 'TEST-REAL-ONBOARD-OP-' } } });
  await check('Administrador entra no ERP local com cookies HttpOnly', async () => {
    const result = await request('/api/auth/login', { method: 'POST', body: { email: process.env.QA_ADMIN_EMAIL, password: process.env.QA_ADMIN_PASSWORD } }); unwrap(result);
    assert.ok(result.headers.getSetCookie().filter(value => value.startsWith('sb-')).every(value => /HttpOnly/i.test(value)));
  });
  await check('Cadastro cria acesso autorizado antes de solicitar convite ao SMTP local', async () => {
    const data = unwrap(await request('/api/catalog/users', { method: 'POST', body: { name: 'Pessoa fictícia de homologação', email, roleId: role.id } }), 201);
    memberId = data.id; assert.equal(data.notification.state, 'REQUESTED');
    const user = await db.user.findUniqueOrThrow({ where: { id: memberId } }); identityId = user.authUserId;
    assert.ok(await db.unitMembership.findUnique({ where: { userId_unitId: { userId: memberId, unitId } } }));
    assert.ok((await latestLink('invite')).startsWith(providerUrl.origin));
  });
  await check('Estado consultado distingue convite de senha e login ainda não confirmados', async () => {
    const detail = unwrap(await request('/api/user-access/' + memberId)); assert.equal(detail.accessState, 'INVITED'); assert.equal(detail.identity.emailConfirmed, false);
    assert.equal(detail.passwordDefinedAt, null); assert.equal(detail.lastLoginAt, null);
    const snapshot = unwrap(await request('/api/data')); assert.equal(snapshot.users.find(person => person.id === memberId).accessState, 'INVITED');
  });
  await check('Reenvio imediato retorna espera sem gerar outra mensagem', async () => {
    const before = (await messages()).length;
    const result = await request('/api/user-access/' + memberId, { method: 'POST', body: { authUserId: identityId } }); assert.equal(result.status, 429); assert.equal(result.data.code, 'AUTH_EMAIL_COOLDOWN');
    assert.ok(Number(result.headers.get('retry-after')) > 0); assert.equal((await messages()).length, before);
  });
  browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  const inviteUrl = await latestLink('invite'); let invited;
  await check('Convite padrão abre em outro navegador, limpa tokens da URL e identifica a conta', async () => { invited = await openLink(inviteUrl, '/primeiro-acesso'); });
  await check('Senhas divergentes são recusadas antes de chamar o servidor', async () => {
    await invited.page.getByLabel('Nova senha', { exact: true }).fill(password);
    await invited.page.getByLabel('Confirme a nova senha', { exact: true }).fill('Different!' + randomBytes(12).toString('hex'));
    await invited.page.getByRole('button', { name: 'Criar minha senha', exact: true }).click(); await expect(invited.page.locator('.notice[role="alert"]')).toHaveText('As senhas precisam ser iguais.');
    assert.equal(await db.auditLog.count({ where: { entityId: memberId, action: 'PASSWORD_UPDATED' } }), 0);
  });
  await check('Primeira senha é gravada no Supabase Auth e a sessão local é encerrada', async () => {
    await invited.page.getByLabel('Confirme a nova senha', { exact: true }).fill(password); await invited.page.getByRole('button', { name: 'Criar minha senha', exact: true }).click();
    await invited.page.getByRole('heading', { name: 'Sua senha está pronta' }).waitFor();
    assert.equal((await invited.context.cookies()).some(cookie => cookie.name.startsWith('sb-') && cookie.name.includes('auth-token')), false);
    const result = await request('/api/auth/login', { method: 'POST', body: { email, password }, cookies: new Map() }); unwrap(result);
  });
  await invited.context.close();
  await check('Login confirmado e definição de senha aparecem no acompanhamento da unidade', async () => {
    const detail = unwrap(await request('/api/user-access/' + memberId)); assert.equal(detail.accessState, 'ACTIVE'); assert.ok(detail.passwordDefinedAt && detail.lastLoginAt);
    const snapshot = unwrap(await request('/api/data')); assert.equal(snapshot.users.find(person => person.id === memberId).accessState, 'ACTIVE');
  });
  const key = createHash('sha256').update(`auth-mail:${email}`).digest('hex');
  // Advance only this isolated fixture's mail clock; never sleep through the real cooldown or alter a live database.
  await db.loginAttempt.updateMany({ where: { key }, data: { blockedUntil: new Date(Date.now() - 1000) } });
  await check('Recuperação pública solicita mensagem sem criar sessão no navegador solicitante', async () => {
    const requester = new Map(); unwrap(await request('/api/auth/recover', { method: 'POST', body: { email }, cookies: requester })); assert.equal(requester.size, 0);
    assert.ok(await latestLink('recovery'));
  });
  let recovery;
  await check('Recuperação também funciona em um terceiro navegador sem o cookie de quem pediu', async () => { recovery = await openLink(await latestLink('recovery'), '/recuperar-senha'); });
  await check('Nova senha substitui a anterior e não muda o perfil da unidade', async () => {
    await recovery.page.getByLabel('Nova senha', { exact: true }).fill(nextPassword); await recovery.page.getByLabel('Confirme a nova senha', { exact: true }).fill(nextPassword);
    await recovery.page.getByRole('button', { name: 'Salvar nova senha', exact: true }).click(); await recovery.page.getByRole('heading', { name: 'Sua senha está pronta' }).waitFor();
    assert.equal((await request('/api/auth/login', { method: 'POST', body: { email, password }, cookies: new Map() })).status, 401);
    unwrap(await request('/api/auth/login', { method: 'POST', body: { email, password: nextPassword }, cookies: new Map() }));
    assert.equal((await db.unitMembership.findUniqueOrThrow({ where: { userId_unitId: { userId: memberId, unitId } } })).roleId, role.id);
  });
  await recovery.context.close();
  await check('Link consumido exibe orientação e não envia e-mail automaticamente', async () => {
    const before = (await messages()).length, context = await browser.newContext(), page = await context.newPage();
    await page.goto(inviteUrl); await page.locator('.notice[role="alert"]').waitFor(); assert.equal(new URL(page.url()).hash, '');
    assert.equal((await messages()).length, before); await context.close();
  });
  await check('Origem forjada é recusada antes do envio e a configuração mostra apenas endereços públicos', async () => {
    const before = (await messages()).length; assert.equal((await request('/api/auth/recover', { method: 'POST', body: { email }, origin: 'https://forged.example.invalid', cookies: new Map() })).status, 403);
    assert.equal((await messages()).length, before);
    const setup = unwrap(await request('/api/user-access/setup')); assert.equal(setup.origin, base); assert.ok(setup.redirectUrls.every(url => url.startsWith(base + '/auth/')));
    assert.equal(JSON.stringify(setup).includes(process.env.SUPABASE_SERVICE_ROLE_KEY), false);
  });
  evidence.result = 'passed';
} catch { evidence.result = 'failed'; process.exitCode = 1; console.error('A homologação não concluiu a etapa indicada; nenhum token ou senha foi registrado.'); }
finally {
  await browser?.close();
  try {
    if (memberId) await db.$transaction(async tx => { await tx.auditLog.deleteMany({ where: { entityId: memberId } }); await tx.auditLog.deleteMany({ where: { userId: memberId } }); await tx.unitMembership.deleteMany({ where: { userId: memberId } }); await tx.user.deleteMany({ where: { id: memberId } }); });
    if (identityId) await admin.auth.admin.deleteUser(identityId);
    const keys = ['login', 'recovery', 'auth-mail'].map(action => createHash('sha256').update(`${action}:${email}`).digest('hex'));
    await db.loginAttempt.deleteMany({ where: { key: { in: keys } } });
  } catch { evidence.cleanupFailed = true; process.exitCode = 1; }
  await db.$disconnect(); await mkdir('artifacts/access-onboarding', { recursive: true });
  await writeFile('artifacts/access-onboarding/real-auth.json', JSON.stringify(evidence, null, 2) + '\n');
}
