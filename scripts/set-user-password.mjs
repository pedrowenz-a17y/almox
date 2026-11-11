import { createClient } from '@supabase/supabase-js';
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { PasswordSetupError, setUserPassword, adminProjectOrigin } from './user-password-core.mjs';

const help = 'Uso: npm run user:password -- --email EMAIL --user-id UUID [--confirm-email]\nA senha é solicitada sem eco e não entra no histórico do terminal.\n--confirm-email confirma manualmente a titularidade do e-mail; use após verificar o titular.\nNão cria conta, não solicita convite/recuperação por e-mail e não altera perfis/unidades do ERP.';

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help')) { console.log(help); return; }
  const options = {};
  while (args.length) {
    const flag = args.shift();
    if (flag === '--confirm-email' && !options.confirmEmail) options.confirmEmail = true;
    else if (['--email', '--user-id'].includes(flag) && args[0] && !args[0].startsWith('--')) {
      const key = flag === '--email' ? 'email' : 'userId';
      if (options[key]) throw new PasswordSetupError('Argumento duplicado. ' + help);
      options[key] = args.shift();
    } else throw new PasswordSetupError(help);
  }
  if (!options.email || !options.userId) throw new PasswordSetupError(help);
  const url = adminProjectOrigin(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key || key.startsWith('sb_publishable_')) throw new PasswordSetupError('Configure SUPABASE_SERVICE_ROLE_KEY no .env protegido do administrador.');
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new PasswordSetupError('Execute em um terminal interativo (CMD ou PowerShell), sem redirecionar a entrada.');
  console.log(`Conta selecionada: ${options.email} | ID: ${options.userId}`);
  if (options.confirmEmail) console.log('Você escolheu confirmar manualmente o e-mail, além de definir a senha.');
  const output = new Writable({ write(_chunk, _encoding, done) { done(); } });
  const input = createInterface({ input: process.stdin, output, terminal: true });
  const abort = new AbortController();
  input.on('SIGINT', () => abort.abort());
  let password, confirmation;
  try {
    process.stdout.write('Nova senha (12 a 128 caracteres; digitação oculta): ');
    password = await input.question('', { signal: abort.signal });
    process.stdout.write('\nRepita a senha (digitação oculta): ');
    confirmation = await input.question('', { signal: abort.signal });
    process.stdout.write('\n');
  } finally { input.close(); }
  if (password !== confirmation) throw new PasswordSetupError('As senhas não coincidem. Nenhuma alteração foi solicitada.');
  const client = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    global: { fetch: (request, init) => fetch(request, { ...init, signal: init?.signal ?? AbortSignal.timeout(15000) }) },
  });
  try {
    await setUserPassword(client.auth.admin, { ...options, password });
  } finally { password = undefined; confirmation = undefined; }
  console.log('Senha definida. Entre no Almox com o e-mail e a nova senha. Perfis e unidades foram preservados.');
}

main().catch(error => {
  console.error(error instanceof PasswordSetupError ? error.message : 'Operação não concluída. Confira a configuração e a conexão. Nenhum detalhe do provedor ou credencial foi registrado.');
  process.exitCode = 1;
});
