/* Installs/uninstalls only inside the disposable Windows GitHub runner. */
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { _electron: electron, expect } = require('../../node_modules/@playwright/test');
const execute = promisify(execFile);
const root = path.resolve(__dirname, '../..');
const evidence = path.join(root, 'artifacts/desktop-2.6.0');
const version = require('../package.json').version;
const checks = [];
let temporary, installed, profile, application, fixture;
function record(message) { checks.push(message); console.log('PASS', message); }
async function pageWith(predicate) {
  let result;
  await expect.poll(async () => {
    for (const page of application.windows()) if (!page.isClosed() && predicate(page.url())) { result = page; return true; }
    return false;
  }, { timeout: 60000 }).toBe(true);
  return result;
}
async function launch() {
  application = await electron.launch({ executablePath: path.join(installed, 'Almox ERP.exe'), args: [`--user-data-dir=${profile}`], timeout: 60000 });
}
async function verify() {
  if (process.platform !== 'win32' || process.env.GITHUB_ACTIONS !== 'true' || process.env.RUNNER_OS !== 'Windows')
    throw new Error('Este teste de instalação só pode executar no runner Windows descartável do GitHub.');
  temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'almox-installed-'));
  installed = path.join(temporary, 'Almox'); profile = path.join(temporary, 'profile');
  await fs.mkdir(profile);
  const installer = path.join(root, 'desktop/dist', `Almox-ERP-${version}-Windows-x64-Setup.exe`);
  await execute(installer, ['/S', `/D=${installed}`], { timeout: 120000, windowsHide: true });
  await expect.poll(async () => { try { await fs.access(path.join(installed, 'Almox ERP.exe')); return true; } catch { return false; } }, { timeout: 60000 }).toBe(true);
  record('instalador NSIS instala o aplicativo Windows sem Node.js externo');
  // Exercise the real bundled Node runtime, Prisma engine and Sharp, without a real database.
  const probe = `
    const path=require('node:path'),fs=require('node:fs');
    const modules=path.join(${JSON.stringify(installed)},'resources','server','node_modules');
    const {PrismaClient}=require(path.join(modules,'@prisma/client'));
    const db=new PrismaClient({datasourceUrl:'postgresql://fixture:fake@127.0.0.1:1/desktop_test?connect_timeout=2'});
    (async()=>{
      let code;try{await db.$connect();}catch(e){code=e.errorCode||e.code;}finally{await db.$disconnect();}
      if(code!=='P1001')throw new Error('Prisma engine test failed');
      const nested=path.join(modules,'next','node_modules','sharp');
      const sharp=require(fs.existsSync(nested)?nested:path.join(modules,'sharp'));
      const png=await sharp({create:{width:1,height:1,channels:3,background:'#ff003d'}}).png().toBuffer();
      if(!png.length)throw new Error('Sharp test failed');
      console.log('WINDOWS_NATIVE_RUNTIME_OK');
    })().catch(()=>{console.error('Native runtime check failed');process.exitCode=1;});`;
  const result = await execute(path.join(installed, 'Almox ERP.exe'), ['-e', probe], {
    timeout: 45000, windowsHide: true, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  });
  assert.ok(result.stdout.includes('WINDOWS_NATIVE_RUNTIME_OK'));
  record('runtime empacotado carrega os binários nativos Windows do Prisma e do Sharp');
  fixture = http.createServer((request, response) => {
    response.writeHead(400, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: 'invalid_grant', error_description: 'Fictional test provider' }));
  });
  fixture.listen(0, '127.0.0.1'); await once(fixture, 'listening');
  const fakeOrigin = `http://127.0.0.1:${fixture.address().port}`;
  const envFile = path.join(temporary, 'fictional.env');
  await fs.writeFile(envFile, `DATABASE_URL="postgresql://fixture:fake@127.0.0.1:1/desktop_test"\nDIRECT_URL="postgresql://fixture:fake@127.0.0.1:1/desktop_test"\nNEXT_PUBLIC_SUPABASE_URL="${fakeOrigin}"\nNEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY="sb_publishable_fictional_installed_test"`);
  await launch();
  const setup = await pageWith(url => url.endsWith('/setup/index.html'));
  await expect(setup.getByRole('heading', { name: 'Como vamos conectar?' })).toBeVisible();
  const metadata = await application.evaluate(({ app, safeStorage }) => ({ version: app.getVersion(), encrypted: safeStorage.isEncryptionAvailable(), userData: app.getPath('userData') }));
  assert.equal(metadata.version, version);
  assert.equal(metadata.encrypted, true);
  assert.equal(path.resolve(metadata.userData).toLowerCase(), path.resolve(profile).toLowerCase());
  record('executável instalado abre a configuração com proteção nativa Windows disponível');
  await application.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, envFile);
  await setup.getByRole('button', { name: 'Escolher arquivo de configuração' }).click();
  let login = await pageWith(url => url.startsWith('http://127.0.0.1:') && url.includes('/login'));
  await expect(login.getByRole('heading', { name: 'Seu almoxarifado começa aqui.' })).toBeVisible();
  const firstOrigin = new URL(login.url()).origin;
  await login.screenshot({ path: path.join(evidence, 'login-instalado-windows.png') });
  const saved = await fs.readFile(path.join(profile, 'connection.json'), 'utf8');
  assert.ok(!saved.includes('postgresql:') && !saved.includes('sb_publishable_'));
  record('instalação inicia servidor, abre login e salva configuração cifrada por DPAPI');
  await application.close(); application = null;
  await expect.poll(async () => { try { await fetch(`${firstOrigin}/login`); return false; } catch { return true; } }, { timeout: 10000 }).toBe(true);
  await launch();
  login = await pageWith(url => url.startsWith('http://127.0.0.1:') && url.includes('/login'));
  await expect(login.getByRole('button', { name: 'Entrar no almoxarifado' })).toBeVisible();
  record('reabrir executável instalado recupera configuração DPAPI e inicia novamente sem CMD');
  await application.close(); application = null;
  const uninstaller = (await fs.readdir(installed)).find(name => /^Uninstall.*\.exe$/i.test(name));
  assert.ok(uninstaller);
  await execute(path.join(installed, uninstaller), ['/S'], { timeout: 120000, windowsHide: true });
  await expect.poll(async () => { try { await fs.access(path.join(installed, 'Almox ERP.exe')); return false; } catch { return true; } }, { timeout: 60000 }).toBe(true);
  assert.equal(await fs.readFile(path.join(profile, 'connection.json'), 'utf8'), saved);
  record('desinstalador remove o aplicativo e preserva a configuração da conta');
  await fs.writeFile(path.join(evidence, 'installed-checks.json'), JSON.stringify({
    scope: 'Instalação NSIS real, executável instalado, runtime, DPAPI, reabertura e desinstalação em runner Windows descartável. Banco e autenticação fictícios; não comprova homologação no PC da empresa.',
    platform: process.platform, passed: checks.length, checks,
  }, null, 2) + '\n');
}
verify().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  await application?.close().catch(() => {}); fixture?.closeAllConnections(); fixture?.close();
  if (temporary) await fs.rm(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }).catch(() => {});
});
