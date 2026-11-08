const fs = require('node:fs/promises');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const desktop = path.join(root, 'desktop');
const target = process.argv.includes('--linux') ? 'linux' : 'windows';
const output = path.join(desktop, 'server');

function run(file, args, env = {}) {
  const result = spawnSync(file, args, { cwd: root, stdio: 'inherit', env: { ...process.env, ...env }, shell: false });
  if (result.status !== 0) throw new Error('Não foi possível preparar as dependências do servidor.');
}
async function walk(directory, visit) {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (await visit(file, entry) === false) continue;
    if (entry.isDirectory()) await walk(file, visit);
  }
}
async function prepare() {
  await fs.access(path.join(root, '.next/standalone/server.js'));
  await fs.rm(output, { recursive: true, force: true });
  await fs.cp(path.join(root, '.next/standalone'), output, { recursive: true, dereference: true,
    filter: file => !path.basename(file).startsWith('.env') && !file.includes(`${path.sep}.cache${path.sep}`) });
  await fs.cp(path.join(root, 'public'), path.join(output, 'public'), { recursive: true });
  await fs.cp(path.join(root, '.next/static'), path.join(output, '.next/static'), { recursive: true });
  // Runtime image optimization needs a writable cache, not Program Files.
  await fs.rm(path.join(output, '.next/cache'), { recursive: true, force: true });
  if (target === 'windows') {
    const sharpPackages = [];
    await walk(path.join(output, 'node_modules'), async (file, entry) => {
      if (entry.isDirectory() && /^(sharp-(linux|linuxmusl)|sharp-libvips-(linux|linuxmusl)|swc-linux)/.test(entry.name)) {
        await fs.rm(file, { recursive: true, force: true }); return false;
      }
      if (!entry.isDirectory() && /\.(node|so)(\.[0-9]+)*$/.test(entry.name)) await fs.rm(file);
      if (entry.name === 'package.json' && path.basename(path.dirname(file)) === 'sharp') {
        sharpPackages.push({ directory: path.dirname(file), version: JSON.parse(await fs.readFile(file, 'utf8')).version });
      }
    });
    const schema = await fs.readFile(path.join(root, 'prisma/schema.prisma'), 'utf8');
    const cache = path.join(desktop, '.cache');
    await fs.mkdir(cache, { recursive: true });
    const client = path.join(output, 'node_modules/.prisma/client');
    const generated = schema.replace(/generator client\s*\{[\s\S]*?\}/, `generator client {\n provider = "prisma-client-js"\n binaryTargets = ["windows"]\n output = ${JSON.stringify(client)}\n}`);
    const schemaFile = path.join(cache, 'schema.prisma');
    await fs.writeFile(schemaFile, generated);
    await fs.rm(client, { recursive: true, force: true });
    run(process.execPath, [path.join(root, 'node_modules/prisma/build/index.js'), 'generate', '--schema', schemaFile], {
      DATABASE_URL: 'postgresql://build:build@127.0.0.1:5432/almox_build', DIRECT_URL: 'postgresql://build:build@127.0.0.1:5432/almox_build', PRISMA_CLI_BINARY_TARGETS: 'windows',
    });
    for (const item of sharpPackages) {
      const native = path.join(cache, `sharp-${item.version}`);
      await fs.mkdir(native, { recursive: true });
      await fs.writeFile(path.join(native, 'package.json'), JSON.stringify({ private: true, dependencies: { '@img/sharp-win32-x64': item.version } }));
      const npm = path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
      const fallbackNpm = process.env.npm_execpath;
      let npmScript = npm;
      try { await fs.access(npm); } catch { npmScript = fallbackNpm; }
      if (!npmScript) throw new Error('Execute a preparação pelo npm run desktop:prepare.');
      // This cache contains only official Windows native packages; no lifecycle scripts run.
      run(process.execPath, [npmScript, 'install', '--prefix', native, '--force', '--os=win32', '--cpu=x64', '--include=optional', '--ignore-scripts', '--no-audit', '--no-fund']);
      const destination = path.join(path.dirname(item.directory), '@img');
      await fs.mkdir(destination, { recursive: true });
      await fs.cp(path.join(native, 'node_modules/@img'), destination, { recursive: true });
    }
    await fs.access(path.join(client, 'query_engine-windows.dll.node'));
  }
  const privateFiles = [];
  await walk(output, async (file, entry) => { if (!entry.isDirectory() && path.basename(file).startsWith('.env')) privateFiles.push(file); });
  if (privateFiles.length) throw new Error('O pacote não pode conter arquivos .env.');
  await fs.writeFile(path.join(output, 'desktop-server.json'), JSON.stringify({ version: require('../package.json').version, target }));
  console.log(`Servidor ${target} preparado sem arquivos .env.`);
}
prepare().catch(() => { console.error('Falha ao preparar servidor desktop. Confira a compilação e as dependências da plataforma.'); process.exitCode = 1; });
