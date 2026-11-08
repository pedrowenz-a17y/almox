/* Integration check for the real desktop shell. No credentials or production login. */
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { _electron: electron, expect } = require('../../node_modules/@playwright/test');

const root = path.resolve(__dirname, '../..'), desktop = path.join(root, 'desktop');
const evidence = path.join(root, 'artifacts/desktop-2.6.0');
const checks = [];
let application, origin, temporary, fixture, authenticationCalls = 0;
function record(text) { checks.push(text); console.log('PASS', text); }
async function windowsFor(app, predicate) {
  let result;
  await expect.poll(async () => {
    for (const page of app.windows()) if (!page.isClosed() && await predicate(page)) { result = page; return true; }
    return false;
  }, { timeout: 60000 }).toBe(true);
  return result;
}
async function launch(directory) {
  const app = await electron.launch({ executablePath: require('../node_modules/electron'), args: [...(process.platform === 'linux' ? ['--no-sandbox'] : []), directory],
    env: { ...process.env, ALMOX_TEST_PROFILE: path.join(directory, 'profile') }, timeout: 60000 });
  return app;
}
async function verify() {
  await fs.mkdir(evidence, { recursive: true });
  temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'almox-electron-'));
  for (const file of ['main.cjs', 'runtime.cjs', 'preload.cjs', 'package.json']) await fs.copyFile(path.join(desktop, file), path.join(temporary, file));
  await fs.writeFile(path.join(temporary, 'package.json'), JSON.stringify({ ...require('../package.json'), main: 'launch.cjs' }));
  for (const directory of ['assets', 'setup']) await fs.cp(path.join(desktop, directory), path.join(temporary, directory), { recursive: true });
  await fs.symlink(path.join(desktop, 'node_modules'), path.join(temporary, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  await fs.writeFile(path.join(temporary, 'launch.cjs'), `
    const {app,dialog,safeStorage}=require('electron');
    app.setPath('userData',process.env.ALMOX_TEST_PROFILE);
    app.testSecureImport = file => {
      dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});
      if (process.platform === 'win32') return;
      const {randomBytes,createCipheriv,createDecipheriv}=require('node:crypto'), key=randomBytes(32);
      safeStorage.isEncryptionAvailable=()=>true; safeStorage.getSelectedStorageBackend=()=>'test_encryption';
      safeStorage.encryptString=text=>{const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv),data=Buffer.concat([cipher.update(text),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),data]);};
      safeStorage.decryptString=bytes=>{const decipher=createDecipheriv('aes-256-gcm',key,bytes.subarray(0,12));decipher.setAuthTag(bytes.subarray(12,28));return Buffer.concat([decipher.update(bytes.subarray(28)),decipher.final()]).toString();};
    };
    require('./main.cjs');`);
  fixture = http.createServer((req, res) => {
    if (req.url.startsWith('/auth/v1/')) {
      authenticationCalls++; res.writeHead(400, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'invalid_grant', error_description: 'Fictional authentication fixture' })); return;
    }
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<!doctype html><title>Fictional ERP</title><h1>Painel de teste</h1><button onclick="const w=window.open(\'\',\'_blank\');w.document.write(\'<h1>Etiqueta de teste</h1>\');w.document.close()">Imprimir etiqueta</button>');
  });
  fixture.listen(0, '127.0.0.1'); await once(fixture, 'listening'); origin = `http://127.0.0.1:${fixture.address().port}`;
  application = await launch(temporary);
  let setup = await windowsFor(application, page => page.url().endsWith('/setup/index.html'));
  await expect(setup.getByRole('heading', { name: 'Como vamos conectar?' })).toBeVisible();
  await expect(setup.getByRole('button', { name: 'Escolher arquivo de configuração' })).toBeVisible();
  await setup.screenshot({ path: path.join(evidence, 'configuracao-desktop.png') });
  assert.equal(await setup.evaluate(() => typeof require), 'undefined');
  assert.equal(await setup.evaluate(() => typeof process), 'undefined');
  record('primeira abertura mostra configuração com preload limitado e sem Node no renderer');
  await setup.getByLabel('Endereço do ERP').fill('http://untrusted.example.invalid');
  await setup.getByRole('button', { name: 'Conectar ao ERP' }).click();
  await expect(setup.getByRole('status')).toContainText('HTTPS');
  record('configuração recusa HTTP externo');
  await setup.getByLabel('Endereço do ERP').fill(origin);
  await setup.getByRole('button', { name: 'Conectar ao ERP' }).click();
  let workspace = await windowsFor(application, page => page.url().startsWith(origin));
  await expect(workspace.getByRole('heading', { name: 'Painel de teste' })).toBeVisible();
  assert.deepEqual(await workspace.evaluate(() => [typeof require, typeof process, typeof window.almoxSetup]), ['undefined', 'undefined', 'undefined']);
  const preferences = await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter(win => win.webContents.getURL().startsWith('http:')).map(win => {
    const prefs = win.webContents.getLastWebPreferences(); return [prefs.sandbox, prefs.contextIsolation, prefs.nodeIntegration];
  }));
  assert.deepEqual(preferences, [[true, true, false]]);
  record('ERP abre em janela com sandbox e sem preload privilegiado');
  await workspace.getByRole('button', { name: 'Imprimir etiqueta' }).click();
  const printWindow = await windowsFor(application, async page => page !== workspace && await page.getByRole('heading', { name: 'Etiqueta de teste' }).count() > 0);
  assert.equal(await printWindow.evaluate(() => typeof require), 'undefined');
  await printWindow.close();
  record('janela de etiqueta preserva impressão e isolamento de Node');
  await workspace.evaluate(() => { location.href = 'https://outside.example.invalid'; });
  await expect.poll(() => workspace.url()).toMatch(new RegExp(`^${origin.replaceAll('.', '\\.')}`));
  record('navegação principal não abandona a origem autorizada');
  await application.close(); application = null;
  application = await launch(temporary);
  workspace = await windowsFor(application, page => page.url().startsWith(origin));
  await expect(workspace.getByRole('heading', { name: 'Painel de teste' })).toBeVisible();
  record('reabertura usa conexão salva sem configuração nem CMD');
  await application.evaluate(({ Menu }) => Menu.getApplicationMenu().items[0].submenu.items[0].click());
  setup = await windowsFor(application, page => page.url().endsWith('/setup/index.html'));
  // Server contains the real Next production build and the native engine for this test host.
  await fs.cp(path.join(root, '.next/standalone'), path.join(temporary, 'server'), { recursive: true, dereference: true, filter: file => !path.basename(file).startsWith('.env') });
  await fs.cp(path.join(root, 'public'), path.join(temporary, 'server/public'), { recursive: true });
  await fs.cp(path.join(root, '.next/static'), path.join(temporary, 'server/.next/static'), { recursive: true });
  const envFile = path.join(temporary, 'fictional.env');
  await fs.writeFile(envFile, `DATABASE_URL="postgresql://fixture:fake@127.0.0.1:5432/desktop_test"\nDIRECT_URL="postgresql://fixture:fake@127.0.0.1:5432/desktop_test"\nNEXT_PUBLIC_SUPABASE_URL="${origin}"\nNEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY="sb_publishable_fictional_desktop_test"`);
  // Linux headless has no Windows DPAPI. The test launcher installs an AES adapter.
  await application.evaluate(({ app }, file) => app.testSecureImport(file), envFile);
  await setup.getByRole('button', { name: 'Escolher arquivo de configuração' }).click();
  const login = await windowsFor(application, page => page.url().startsWith('http://127.0.0.1:') && !page.url().startsWith(origin) && page.url().includes('/login'));
  await expect(login.getByRole('heading', { name: 'Seu almoxarifado começa aqui.' })).toBeVisible();
  await expect(login.getByRole('button', { name: 'Entrar no almoxarifado' })).toBeVisible();
  const localOrigin = new URL(login.url()).origin;
  await login.screenshot({ path: path.join(evidence, 'login-desktop.png') });
  record('importação inicia o servidor real automaticamente em porta livre e abre o login UCA');
  const stored = await fs.readFile(path.join(temporary, 'profile/connection.json'), 'utf8');
  assert.ok(!stored.includes('postgresql:') && !stored.includes('sb_publishable_'));
  record('arquivo de conexão não armazena credenciais em texto simples');
  const callback = await fetch(`${localOrigin}/auth/callback?code=fictional`, { redirect: 'manual', headers: { Cookie: 'sb-127-auth-token-code-verifier=%22fictional-verifier%22' } });
  assert.equal(callback.status, 307);
  assert.ok(callback.headers.get('location').startsWith(localOrigin));
  assert.ok(authenticationCalls > 0);
  record('build usa Supabase e APP_URL definidos na instalação, conferidos por provedor HTTP fictício');
  await application.close(); application = null;
  await expect.poll(async () => { try { await fetch(`${localOrigin}/login`); return false; } catch { return true; } }, { timeout: 10000 }).toBe(true);
  record('fechar o aplicativo encerra o servidor local');
  await fs.writeFile(path.join(evidence, 'electron-checks.json'), JSON.stringify({ scope: 'Electron real em Linux/Xvfb, Next de produção e provedor fictício. DPAPI substituída apenas no teste por AES. Não comprova instalação em Windows físico nem login no Supabase real.', passed: checks.length, checks }, null, 2) + '\n');
}
verify().catch(async error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  await application?.close().catch(() => {}); fixture?.close();
  if (temporary) await fs.rm(temporary, { recursive: true, force: true }).catch(() => {});
});
