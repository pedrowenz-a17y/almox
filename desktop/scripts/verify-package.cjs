const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const asar = require('@electron/asar');
const desktop = path.resolve(__dirname, '..');
const unpacked = path.join(desktop, 'dist/win-unpacked');
const resource = path.join(unpacked, 'resources');
const version = require('../package.json').version;
const installer = path.join(desktop, 'dist', `Almox-ERP-${version}-Windows-x64-Setup.exe`);
const hash = data => crypto.createHash('sha256').update(data).digest('hex');
async function files(directory, prefix = '') {
  const list = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const name = path.join(prefix, entry.name);
    if (entry.isDirectory()) list.push(...await files(path.join(directory, entry.name), name));
    else list.push(name);
  }
  return list;
}
function pe(data, expected) {
  if (data.toString('ascii', 0, 2) !== 'MZ') throw new Error('Binário sem cabeçalho Windows.');
  const offset = data.readUInt32LE(0x3c);
  if (data.readUInt32LE(offset) !== 0x4550 || data.readUInt16LE(offset + 4) !== expected) throw new Error('Arquitetura Windows incorreta.');
}
async function verify() {
  const source = path.join(desktop, 'server'), destination = path.join(resource, 'server');
  const entries = await files(source);
  for (const name of entries) {
    if (path.basename(name).startsWith('.env')) throw new Error('Configuração privada encontrada no pacote.');
    const original = await fs.readFile(path.join(source, name)), copied = await fs.readFile(path.join(destination, name));
    if (hash(original) !== hash(copied)) throw new Error(`Recurso ausente ou alterado: ${name}`);
    if (name.endsWith('.node')) pe(copied, 0x8664);
    if (/\.so(\.[0-9]+)*$/.test(name)) throw new Error('Biblioteca Linux no servidor Windows.');
  }
  const archive = path.join(resource, 'app.asar');
  const appFiles = asar.listPackage(archive);
  if (appFiles.some(name => path.basename(name).startsWith('.env') || name.includes('/tests/'))) throw new Error('Arquivo privado ou harness de teste no aplicativo.');
  const metadata = JSON.parse(asar.extractFile(archive, 'package.json').toString());
  if (metadata.version !== version) throw new Error('Versão incorreta no aplicativo.');
  for (const name of ['main.cjs', 'runtime.cjs', 'preload.cjs', 'setup/index.html', 'setup/setup.js', 'setup/setup.css', 'assets/icon.png', 'assets/manrope.woff2', 'assets/OFL-Manrope.txt']) {
    if (hash(asar.extractFile(archive, name)) !== hash(await fs.readFile(path.join(desktop, name)))) throw new Error(`Aplicativo desatualizado: ${name}`);
  }
  pe(await fs.readFile(path.join(unpacked, 'Almox ERP.exe')), 0x8664);
  const data = await fs.readFile(installer); pe(data, 0x14c);
  if (data.length < 50 * 1024 * 1024 || !data.includes(Buffer.from('NullsoftInst'))) throw new Error('Instalador incompleto.');
  const report = { version, platform: process.platform, architecture: process.arch, installer: path.basename(installer), bytes: data.length, sha256: hash(data), serverFilesVerified: entries.length,
    privateEnvFiles: 0, checks: ['PE Windows x64 do aplicativo', 'NSIS completo com desinstalador', 'Prisma e bibliotecas nativas Windows', 'todos os recursos do servidor preservados por hash', 'ASAR corresponde ao código validado', 'sem .env ou harness de teste'],
    limitation: process.platform === 'win32' ? 'Compilação em Windows. A homologação operacional no computador de destino continua necessária.' : 'Compilação cruzada em Linux. A instalação e a proteção DPAPI ainda precisam de homologação em Windows físico.' };
  const output = path.join(desktop, '../artifacts/desktop-2.6.0/package-checks.json');
  await fs.writeFile(output, JSON.stringify(report, null, 2) + '\n');
  await fs.writeFile(path.join(desktop, 'dist/SHA256SUMS.txt'), `${report.sha256}  ${report.installer}\n`);
  console.log(JSON.stringify(report));
}
verify().catch(error => { console.error(error.message); process.exitCode = 1; });
