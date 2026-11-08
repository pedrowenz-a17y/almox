import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { allowedOrigins, appOrigin, authServiceUnavailable, AuthConfigurationError, exactOrigin, safeReturnPath, supabasePublicConfig } from '../src/lib/auth-config';

describe('configuração e redirecionamento de autenticação', () => {
  const keys = ['APP_URL', 'APP_ALLOWED_ORIGINS', 'VERCEL', 'VERCEL_URL', 'VERCEL_ENV', 'VERCEL_PROJECT_PRODUCTION_URL', 'NODE_ENV', 'NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'] as const;
  let previous: Record<string, string | undefined>;
  before(() => { previous = Object.fromEntries(keys.map(key => [key, process.env[key]])); });
  after(() => { for (const key of keys) { if (previous[key] === undefined) delete process.env[key]; else Object.assign(process.env, { [key]: previous[key] }); } });
  test('origens explícitas e o deployment Vercel atual são permitidos, sem wildcard', () => {
    process.env.APP_URL = 'https://estoque.example.invalid';
    process.env.APP_ALLOWED_ORIGINS = 'https://preview.example.invalid';
    process.env.VERCEL = '1'; process.env.VERCEL_URL = 'almox-preview.vercel.app';
    assert.deepEqual([...allowedOrigins()].sort(), ['https://almox-preview.vercel.app', 'https://estoque.example.invalid', 'https://preview.example.invalid'].sort());
    assert.equal(allowedOrigins().has('https://outra-app.vercel.app'), false);
  });
  test('configuração inválida não amplia a origem autorizada', () => {
    for (const value of ['https://*.example.invalid', 'https://erp.example.invalid/login', 'https://user:secret@erp.example.invalid', 'https://erp.example.invalid?token=secret', 'javascript:alert(1)']) {
      assert.throws(() => exactOrigin(value), AuthConfigurationError);
    }
  });
  test('produção sem origem configurada falha de forma explícita', () => {
    delete process.env.APP_URL; delete process.env.VERCEL; delete process.env.VERCEL_URL;
    Object.assign(process.env, { NODE_ENV: 'production' });
    assert.throws(() => appOrigin(), AuthConfigurationError);
  });
  test('Vercel usa o domínio de produção do próprio projeto sem confiar no Host da requisição', () => {
    delete process.env.APP_URL; delete process.env.APP_ALLOWED_ORIGINS;
    Object.assign(process.env, { VERCEL: '1', VERCEL_ENV: 'production', VERCEL_URL: 'almox-deployment.vercel.app', VERCEL_PROJECT_PRODUCTION_URL: 'almox-empresa.vercel.app' });
    assert.equal(appOrigin(), 'https://almox-empresa.vercel.app');
    assert.deepEqual([...allowedOrigins()].sort(), ['https://almox-deployment.vercel.app', 'https://almox-empresa.vercel.app'].sort());
    process.env.VERCEL_ENV = 'preview';
    assert.equal(appOrigin(), 'https://almox-deployment.vercel.app');
    assert.equal(allowedOrigins().has('https://almox-empresa.vercel.app'), false);
    process.env.VERCEL_ENV = 'production'; process.env.VERCEL_PROJECT_PRODUCTION_URL = 'almox.vercel.app.evil.invalid';
    assert.equal(appOrigin(), 'https://almox-deployment.vercel.app');
    process.env.APP_URL = 'https://erp.example.invalid';
    assert.equal(appOrigin(), 'https://erp.example.invalid');
    delete process.env.VERCEL_ENV; delete process.env.VERCEL_PROJECT_PRODUCTION_URL;
  });
  test('redirecionamentos externos, barras invertidas e loops de login são recusados', () => {
    for (const value of ['//malicious.invalid', 'https://malicious.invalid', '/\\malicious.invalid', '/login', '/auth/callback?code=x', '/\nmalicious.invalid']) assert.equal(safeReturnPath(value), '/dashboard');
    assert.equal(safeReturnPath('/recuperar-senha'), '/recuperar-senha');
    assert.equal(safeReturnPath('/localizacao/123?view=stock'), '/localizacao/123?view=stock');
  });
  test('chaves administrativas são recusadas na variável pública', () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://supabase.example.invalid';
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'sb_secret_fixture_not_a_real_key';
    assert.throws(() => supabasePublicConfig(), AuthConfigurationError);
    const payload = Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url');
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = `fixture.${payload}.not-a-signature`;
    assert.throws(() => supabasePublicConfig(), AuthConfigurationError);
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_fixture_not_a_real_key';
    assert.equal(supabasePublicConfig().url, 'https://supabase.example.invalid');
  });
  test('indisponibilidade do provedor é distinta de credenciais inválidas', () => {
    assert.equal(authServiceUnavailable({ status: 503 }), true);
    assert.equal(authServiceUnavailable({ name: 'AuthRetryableFetchError' }), true);
    assert.equal(authServiceUnavailable({ status: 400 }), false);
    assert.equal(authServiceUnavailable({ status: 401 }), false);
  });
});
