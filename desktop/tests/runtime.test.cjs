const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { once } = require('node:events');
const { randomBytes, createCipheriv, createDecipheriv } = require('node:crypto');
const { serverOrigin, importEnvironment, isWithinOrigin, cameraAllowed, saveConfiguration, loadConfiguration, startLocalServer } = require('../runtime.cjs');

const source = [
  'DATABASE_URL="postgresql://fixture:fake%23@127.0.0.1:5432/desktop_test"',
  'DIRECT_URL="postgresql://fixture:fake%23@127.0.0.1:5432/desktop_test"',
  'NEXT_PUBLIC_SUPABASE_URL="https://fictional.example.invalid"',
  'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY="sb_publishable_fictional_test_only"',
  'APP_URL="http://localhost:3000"', 'APP_ALLOWED_ORIGINS="https://untrusted.example.invalid"',
  'SUPABASE_SERVICE_ROLE_KEY="not-to-import"', 'NODE_OPTIONS="not-to-import"',
  'MIGRATION_APPLY_APPROVED="true"', 'OPENAI_API_KEY="not-to-import"',
].join('\n');

function secureStorage() {
  const key = randomBytes(32);
  return {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => 'test_encryption',
    encryptString: text => { const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv); const data = Buffer.concat([cipher.update(text), cipher.final()]); return Buffer.concat([iv, cipher.getAuthTag(), data]); },
    decryptString: bytes => { const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12)); decipher.setAuthTag(bytes.subarray(12, 28)); return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString(); },
  };
}

test('aceita HTTPS e loopback, recusa credenciais, caminhos e protocolos externos', () => {
  assert.equal(serverOrigin('https://erp.example.invalid/'), 'https://erp.example.invalid');
  assert.equal(serverOrigin('http://127.0.0.1:3010'), 'http://127.0.0.1:3010');
  for (const value of ['http://example.invalid', 'https://user:pass@example.invalid', 'file:///tmp/test', 'javascript:alert(1)', 'https://example.invalid/login', 'https://example.invalid/?x=1', 'http://localhost.evil.invalid', 'http://192.168.1.1']) assert.throws(() => serverOrigin(value));
});
test('importa só configuração de execução, ignora credenciais administrativas e comandos', () => {
  const env = importEnvironment(source);
  assert.equal(env.ASSISTANT_PROVIDER, 'local');
  for (const key of ['APP_URL', 'APP_ALLOWED_ORIGINS', 'SUPABASE_SERVICE_ROLE_KEY', 'NODE_OPTIONS', 'MIGRATION_APPLY_APPROVED', 'OPENAI_API_KEY']) assert.equal(env[key], undefined);
  assert.equal(env.NEXT_PUBLIC_SUPABASE_URL, 'https://fictional.example.invalid');
});
test('recusa configuração ausente, chave administrativa e arquivo excessivo sem mostrar valores', () => {
  assert.throws(() => importEnvironment(''), /DATABASE_URL/);
  assert.throws(() => importEnvironment(source.replace('sb_publishable_fictional_test_only', 'sb_secret_fictional_test_only')), /chave pública/);
  const jwt = `header.${Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url')}.signature`;
  assert.throws(() => importEnvironment(source.replace('sb_publishable_fictional_test_only', jwt)), /chave pública/);
  assert.throws(() => importEnvironment('x'.repeat(65537)), /muito grande/);
});
test('câmera fica limitada à origem autorizada e ao quadro principal', () => {
  assert.equal(cameraAllowed('https://erp.example.invalid', 'https://erp.example.invalid'), true);
  assert.equal(cameraAllowed('https://erp.example.invalid', 'https://erp.example.invalid', { isMainFrame: false }), false);
  assert.equal(cameraAllowed('https://outside.example.invalid', 'https://erp.example.invalid'), false);
  assert.equal(isWithinOrigin('https://erp.example.invalid.evil.invalid', 'https://erp.example.invalid'), false);
  assert.equal(cameraAllowed('https://erp.example.invalid', undefined), false);
});
test('configuração local é cifrada; leitura e substituição preservam caracteres da credencial', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'almox-desktop-config-'));
  const file = path.join(directory, 'connection.json'), storage = secureStorage();
  try {
    assert.equal(await loadConfiguration(file, storage), null);
    const env = importEnvironment(source + '\nOPENAI_MODEL="modelo-com-apóstrofo\'á"');
    await saveConfiguration(file, { mode: 'local', env }, storage);
    const text = await fs.readFile(file, 'utf8');
    assert.ok(!text.includes('postgresql:') && !text.includes('sb_publishable_'));
    assert.deepEqual(await loadConfiguration(file, storage), { mode: 'local', env });
    await saveConfiguration(file, { mode: 'remote', origin: 'https://erp.example.invalid' }, storage);
    assert.deepEqual(await loadConfiguration(file, storage), { mode: 'remote', origin: 'https://erp.example.invalid' });
    assert.ok(!(await fs.readFile(file, 'utf8')).includes('encryptedEnv'));
    await fs.writeFile(file, '{invalid');
    await assert.rejects(loadConfiguration(file, storage), /ler a configuração/);
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});
test('recusa salvar segredos quando a proteção do sistema não está disponível', async () => {
  for (const storage of [{ isEncryptionAvailable: () => false }, { isEncryptionAvailable: () => true, getSelectedStorageBackend: () => 'basic_text' }])
    await assert.rejects(saveConfiguration('/tmp/not-written-connection.json', { mode: 'local', env: {} }, storage), /proteção de credenciais/);
});
test('servidor inicia em loopback, usa porta própria e encerra sem CMD nem variáveis perigosas herdadas', { timeout: 15000 }, async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'almox-desktop-server-'));
  const fixture = `const http = require('node:http'); const fs = require('node:fs'); fs.writeFileSync('observed.json', JSON.stringify({app:process.env.APP_URL, allowed:process.env.APP_ALLOWED_ORIGINS, host:process.env.HOSTNAME, injected:process.env.INJECTED, admin:process.env.SUPABASE_SERVICE_ROLE_KEY, options:process.env.NODE_OPTIONS})); http.createServer((req,res)=>{const valid=req.headers['x-almox-desktop-token']===process.env.ALMOX_DESKTOP_TOKEN; res.writeHead(valid?200:404,{'content-type':'application/json'});res.end(JSON.stringify(valid?{token:process.env.ALMOX_DESKTOP_TOKEN}:{}));}).listen(Number(process.env.PORT),process.env.HOSTNAME);`;
  await fs.writeFile(path.join(directory, 'server.js'), fixture);
  let server;
  try {
    server = await startLocalServer({ executable: process.execPath, serverDirectory: directory, env: importEnvironment(source), inheritedEnv: { ...process.env, APP_URL: 'https://bad.example.invalid', INJECTED: 'bad', NODE_OPTIONS: '--require=missing', SUPABASE_SERVICE_ROLE_KEY: 'bad' } });
    const observed = JSON.parse(await fs.readFile(path.join(directory, 'observed.json')));
    assert.equal(observed.app, server.origin);
    assert.equal(observed.host, '127.0.0.1');
    assert.equal(observed.allowed, '');
    for (const key of ['injected', 'admin', 'options']) assert.equal(observed[key], undefined);
    assert.match(server.origin, /^http:\/\/127\.0\.0\.1:\d+$/);
    assert.equal((await fetch(server.origin)).status, 404);
    const exited = once(server.child, 'exit'); server.stop(); await exited;
    await assert.rejects(fetch(server.origin));
  } finally { server?.stop(); await fs.rm(directory, { recursive: true, force: true }); }
});
test('falha de inicialização resulta em erro legível, sem vazar saída do processo', { timeout: 5000 }, async () => {
  await assert.rejects(startLocalServer({ executable: process.execPath, serverDirectory: path.join(os.tmpdir(), 'nonexistent-almox-desktop'), env: {}, timeout: 1000 }), /servidor local não iniciou/);
});
