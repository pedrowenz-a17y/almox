const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const npm = process.env.npm_execpath;
if (!npm) throw new Error('Execute npm run desktop:dist na pasta do projeto.');
const env = { ...process.env, NEXT_PUBLIC_SUPABASE_URL: 'https://desktop-build.example.invalid',
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_desktop_build_only',
  DATABASE_URL: 'postgresql://build:build@127.0.0.1:5432/almox_build', DIRECT_URL: 'postgresql://build:build@127.0.0.1:5432/almox_build',
  APP_URL: 'http://127.0.0.1:3000', APP_ALLOWED_ORIGINS: '', NEXT_TELEMETRY_DISABLED: '1', CSC_IDENTITY_AUTO_DISCOVERY: 'false' };
for (const args of [['run', 'build'], ['--prefix', 'desktop', 'run', 'prepare:server'], ['--prefix', 'desktop', 'run', 'dist:win']]) {
  const result = spawnSync(process.execPath, [npm, ...args], { cwd: root, env, stdio: 'inherit', shell: false });
  if (result.status !== 0) { process.exitCode = result.status || 1; break; }
}
