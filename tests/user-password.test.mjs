import test from 'node:test';
import assert from 'node:assert/strict';
import { setUserPassword, adminProjectOrigin } from '../scripts/user-password-core.mjs';
const userId = '11111111-1111-4111-8111-111111111111';
const input = { userId, email: 'member@example.invalid', password: 'Password-fixture-123' };
function client(user, updateError = null) {
  const calls = [];
  return { calls, getUserById: async () => ({ data: { user }, error: null }), updateUserById: async (...args) => { calls.push(args); return { data: { user }, error: updateError }; } };
}
test('verifica identidade e altera somente senha, preservando a conta', async () => {
  const admin = client({ id: userId, email: input.email, email_confirmed_at: '2026-01-01' });
  await setUserPassword(admin, input);
  assert.deepEqual(admin.calls, [[userId, { password: input.password }]]);
});
test('e-mail diferente e senha curta nunca disparam escrita', async () => {
  const admin = client({ id: userId, email: 'other@example.invalid' });
  await assert.rejects(setUserPassword(admin, input), /não corresponde/);
  await assert.rejects(setUserPassword(admin, { ...input, password: 'short' }), /12 a 128/);
  assert.deepEqual(admin.calls, []);
  const otherId = client({ id: '22222222-2222-4222-8222-222222222222', email: input.email });
  await assert.rejects(setUserPassword(otherId, input), /não corresponde/);
  assert.deepEqual(otherId.calls, []);
});
test('confirmar e-mail é uma escolha administrativa explícita', async () => {
  const admin = client({ id: userId, email: input.email });
  await assert.rejects(setUserPassword(admin, input), /--confirm-email/);
  assert.deepEqual(admin.calls, []);
  await setUserPassword(admin, { ...input, confirmEmail: true });
  assert.deepEqual(admin.calls, [[userId, { password: input.password, email_confirm: true }]]);
});
test('erro do provedor não revela conteúdo, chave ou senha', async () => {
  const admin = client({ id: userId, email: input.email, email_confirmed_at: '2026-01-01' }, { message: 'PRIVATE_PROVIDER_DETAIL' });
  await assert.rejects(setUserPassword(admin, input), error => !error.message.includes('PRIVATE_') && /não foi confirmada/.test(error.message));
});
test('CLI recusa enviar a chave administrativa para um site que não é a Project URL', () => {
  assert.equal(adminProjectOrigin('https://aaaaaaaaaaaaaaaaaaaa.supabase.co/'), 'https://aaaaaaaaaaaaaaaaaaaa.supabase.co');
  for (const url of ['https://website.example.invalid', 'http://aaaaaaaaaaaaaaaaaaaa.supabase.co', 'https://aaaaaaaaaaaaaaaaaaaa.supabase.co:444', 'https://aaaaaaaaaaaaaaaaaaaa.supabase.co/auth']) {
    assert.throws(() => adminProjectOrigin(url), /Project URL/);
  }
});
