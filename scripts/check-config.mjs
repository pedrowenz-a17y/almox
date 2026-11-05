import 'dotenv/config';

const errors = [];
const production = process.argv.includes('--production');
for (const name of ['DATABASE_URL', 'DIRECT_URL']) {
  try {
    const value = new URL(process.env[name] || '');
    if (!['postgres:', 'postgresql:'].includes(value.protocol) || !value.hostname || value.pathname.length < 2) throw new Error();
  } catch { errors.push(`${name}: configure uma URL PostgreSQL válida no ambiente protegido.`); }
}
for (const name of ['APP_URL', 'NEXT_PUBLIC_SUPABASE_URL']) {
  try {
    const value = new URL(process.env[name] || '');
    if (!['http:', 'https:'].includes(value.protocol) || value.username || value.password || value.search || value.hash || !['', '/'].includes(value.pathname) || (production && value.protocol !== 'https:')) throw new Error();
  } catch { errors.push(`${name}: configure uma origem completa${production ? ' HTTPS' : ''}, sem caminhos ou credenciais.`); }
}
const publicKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || '';
if (!publicKey) errors.push('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: chave pública ausente.');
if (publicKey.startsWith('sb_secret_')) errors.push('Uma chave secreta foi colocada na variável pública. Remova-a e faça a rotação no Supabase.');
try {
  const parts = publicKey.split('.');
  if (parts.length === 3 && JSON.parse(Buffer.from(parts[1], 'base64url').toString()).role === 'service_role') errors.push('service_role não pode ser usada como chave pública. Remova-a e faça a rotação no Supabase.');
} catch { errors.push('A chave pública JWT informada possui formato inválido.'); }
if (errors.length) { for (const message of errors) console.error(message); process.exitCode = 1; }
else console.log('Formato das configurações obrigatórias validado. Esta checagem não comprova acesso remoto, credenciais ou existência das tabelas.');
if (!process.env.SUPABASE_SERVICE_ROLE_KEY) console.log('Convites e provisionamento exigem SUPABASE_SERVICE_ROLE_KEY somente no servidor. Login comum não precisa dessa chave administrativa.');
