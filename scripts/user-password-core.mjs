export class PasswordSetupError extends Error {}

export function adminProjectOrigin(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !/^[a-z0-9]{20}\.supabase\.co$/i.test(url.hostname) || (url.port && url.port !== '443') || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error();
    return url.origin;
  } catch { throw new PasswordSetupError('Configure NEXT_PUBLIC_SUPABASE_URL com a Project URL HTTPS do projeto (.supabase.co), no .env protegido.'); }
}

export async function setUserPassword(admin, { userId, email, password, confirmEmail = false }) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId || '')) throw new PasswordSetupError('Informe um identificador Supabase válido.');
  email = (email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new PasswordSetupError('Informe o e-mail da conta.');
  if (typeof password !== 'string' || password.length < 12 || password.length > 128) throw new PasswordSetupError('Use uma senha de 12 a 128 caracteres.');
  const identity = await admin.getUserById(userId);
  if (identity.error || !identity.data?.user) throw new PasswordSetupError('Não foi possível consultar a conta. Confira projeto, chave administrativa e identificador.');
  const user = identity.data.user;
  if (user.id !== userId || user.email?.toLowerCase() !== email) throw new PasswordSetupError('O identificador não corresponde ao e-mail. Nenhuma senha foi alterada.');
  if (!user.email_confirmed_at && !confirmEmail) throw new PasswordSetupError('O e-mail ainda não está confirmado. Após verificar o titular, use --confirm-email para confirmar manualmente.');
  const result = await admin.updateUserById(userId, { password, ...(confirmEmail ? { email_confirm: true } : {}) });
  if (result.error || !result.data?.user) throw new PasswordSetupError('A alteração não foi confirmada pelo Supabase. Confira a política de senha e a conexão antes de tentar novamente.');
  return { userId, email, emailConfirmed: !!result.data.user.email_confirmed_at };
}
