const fs = require('node:fs/promises');
const path = require('node:path');
const net = require('node:net');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const dotenv = require('dotenv');
const { fileURLToPath } = require('node:url');
const realpathSync = require('node:fs').realpathSync;

const ENV_KEYS = ['DATABASE_URL', 'DIRECT_URL', 'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'ASSISTANT_PROVIDER', 'OPENAI_API_KEY', 'OPENAI_MODEL'];

function serverOrigin(value) {
  try {
    const url = new URL(value.trim());
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (url.username || url.password || url.search || url.hash || url.pathname !== '/' ||
      !(url.protocol === 'https:' || local && url.protocol === 'http:')) throw new Error();
    return url.origin;
  } catch { throw new Error('Informe o endereço HTTPS completo do ERP, sem caminhos. HTTP é aceito somente neste computador.'); }
}

function importEnvironment(content) {
  if (Buffer.byteLength(content, 'utf8') > 64 * 1024) throw new Error('O arquivo de configuração é muito grande.');
  return validateEnvironment(dotenv.parse(content));
}

function validateEnvironment(parsed) {
  const env = Object.fromEntries(ENV_KEYS.filter(key => parsed[key]?.trim()).map(key => [key, parsed[key].trim()]));
  for (const key of ['DATABASE_URL', 'DIRECT_URL']) {
    try { if (!['postgres:', 'postgresql:'].includes(new URL(env[key]).protocol)) throw new Error(); }
    catch { throw new Error(`Confira ${key} no arquivo de configuração.`); }
  }
  try { env.NEXT_PUBLIC_SUPABASE_URL = serverOrigin(env.NEXT_PUBLIC_SUPABASE_URL); }
  catch { throw new Error('Confira NEXT_PUBLIC_SUPABASE_URL no arquivo de configuração.'); }
  const key = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || '';
  let administrative = key.startsWith('sb_secret_');
  if (key.split('.').length === 3) {
    try { administrative ||= JSON.parse(Buffer.from(key.split('.')[1], 'base64url')).role === 'service_role'; } catch { /* Provider validates public keys. */ }
  }
  if (!key || administrative) throw new Error('Configure uma chave pública Publishable ou anon para o Supabase.');
  env.ASSISTANT_PROVIDER ||= 'local';
  if (!['local', 'openai'].includes(env.ASSISTANT_PROVIDER)) throw new Error('ASSISTANT_PROVIDER deve ser local ou openai.');
  if (env.ASSISTANT_PROVIDER === 'local') delete env.OPENAI_API_KEY;
  return env;
}

function isWithinOrigin(value, origin) {
  try { return new URL(value).origin === origin; } catch { return false; }
}

function cameraAllowed(requestingOrigin, origin, details = {}) {
  // Chromium may serialize a permission origin without a trailing slash.
  return isWithinOrigin(requestingOrigin, origin) && details.isMainFrame !== false;
}

function isSetupFile(value, expected, platform = process.platform, resolve = realpathSync) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'file:' || url.hostname || url.search || url.hash) return false;
    const actualPath = resolve(fileURLToPath(url, { windows: platform === 'win32' }));
    const expectedPath = resolve(expected);
    // Windows may expose an expanded path rather than the 8.3 alias used by os.tmpdir().
    return platform === 'win32' ? actualPath.toLowerCase() === expectedPath.toLowerCase() : actualPath === expectedPath;
  } catch { return false; }
}

async function saveConfiguration(file, config, secureStorage) {
  let saved;
  if (config.mode === 'local') {
    if (!secureStorage.isEncryptionAvailable() || secureStorage.getSelectedStorageBackend?.() === 'basic_text')
      throw new Error('A proteção de credenciais do sistema não está disponível. Use a conexão com o ERP hospedado.');
    saved = { schema: 1, mode: 'local', encryptedEnv: secureStorage.encryptString(JSON.stringify(config.env)).toString('base64') };
  } else saved = { schema: 1, mode: 'remote', origin: serverOrigin(config.origin) };
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomBytes(6).toString('hex')}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(saved), { mode: 0o600 });
  try { await fs.rename(temporary, file); } finally { await fs.rm(temporary, { force: true }); }
}

async function loadConfiguration(file, secureStorage) {
  let saved;
  try { saved = JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw new Error('Não foi possível ler a configuração. Configure a conexão novamente.'); }
  if (saved.schema !== 1) throw new Error('A configuração tem uma versão incompatível. Configure a conexão novamente.');
  if (saved.mode === 'remote') return { mode: 'remote', origin: serverOrigin(saved.origin) };
  if (saved.mode !== 'local') throw new Error('Escolha novamente o tipo de conexão.');
  try {
    if (!secureStorage.isEncryptionAvailable()) throw new Error();
    const decrypted = JSON.parse(secureStorage.decryptString(Buffer.from(saved.encryptedEnv, 'base64')));
    return { mode: 'local', env: validateEnvironment(decrypted) };
  } catch { throw new Error('Não foi possível abrir as credenciais desta conta Windows. Importe o arquivo novamente.'); }
}

async function availablePort() {
  return new Promise((resolve, reject) => {
    const socket = net.createServer();
    socket.once('error', reject);
    socket.listen(0, '127.0.0.1', () => { const port = socket.address().port; socket.close(error => error ? reject(error) : resolve(port)); });
  });
}

function probe(origin, token) {
  return new Promise(resolve => {
    const request = http.get(`${origin}/api/desktop-health`, { headers: { 'x-almox-desktop-token': token }, timeout: 1500 }, response => {
      let text = '';
      response.on('data', chunk => { text += chunk; if (text.length > 4096) request.destroy(); });
      response.on('end', () => {
        try { resolve(response.statusCode === 200 && JSON.parse(text).token === token); } catch { resolve(false); }
      });
    });
    request.on('timeout', () => request.destroy());
    request.on('error', () => resolve(false));
  });
}

async function startLocalServer({ executable, serverDirectory, env, inheritedEnv = process.env, timeout = 45000 }) {
  const port = await availablePort(), origin = `http://127.0.0.1:${port}`, token = randomBytes(32).toString('hex');
  // Never inherit a developer's database, Node injection flags or migration/admin switches.
  const systemKeys = ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'TMPDIR', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'LANG', 'LC_ALL', 'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'no_proxy', 'NODE_EXTRA_CA_CERTS', 'SSL_CERT_FILE'];
  const system = Object.fromEntries(systemKeys.filter(key => inheritedEnv[key]).map(key => [key, inheritedEnv[key]]));
  const child = spawn(executable, [path.join(serverDirectory, 'server.js')], {
    cwd: serverDirectory, windowsHide: true, stdio: ['ignore', 'ignore', 'ignore'],
    env: { ...system, ...env, ELECTRON_RUN_AS_NODE: '1', NODE_ENV: 'production', HOSTNAME: '127.0.0.1', PORT: String(port),
      APP_URL: origin, APP_ALLOWED_ORIGINS: '', NEXT_TELEMETRY_DISABLED: '1', ALMOX_DESKTOP_TOKEN: token },
  });
  let spawnError;
  child.on('error', () => { spawnError = true; });
  const stop = () => { if (child.exitCode === null && !child.killed) child.kill(); };
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    if (spawnError || child.exitCode !== null) break;
    if (await probe(origin, token)) return { origin, child, stop };
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  stop();
  throw new Error('O servidor local não iniciou. Use Configurar conexão para importar o arquivo novamente ou conectar ao ERP hospedado.');
}

module.exports = { serverOrigin, importEnvironment, isWithinOrigin, cameraAllowed, isSetupFile, saveConfiguration, loadConfiguration, startLocalServer, availablePort };
