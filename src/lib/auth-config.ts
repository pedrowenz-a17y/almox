/** Authentication configuration is intentionally resolved on the server only. */
export class AuthConfigurationError extends Error {
  constructor(message = "Autenticação indisponível: a configuração do servidor precisa ser concluída.") {
    super(message);
    this.name = "AuthConfigurationError";
  }
}

export function exactOrigin(value: string): string {
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || url.hostname.includes('*') || url.username || url.password || url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) throw new Error();
    return url.origin;
  } catch {
    throw new AuthConfigurationError('APP_URL e APP_ALLOWED_ORIGINS devem conter somente origens HTTP/HTTPS completas, sem caminhos.');
  }
}

function vercelOrigin(): string | undefined {
  const host = process.env.VERCEL_URL;
  if (process.env.VERCEL === '1' && host && /^[a-z0-9.-]+\.vercel\.app$/i.test(host)) return `https://${host.toLowerCase()}`;
}

export function appOrigin(): string {
  if (process.env.APP_URL?.trim()) return exactOrigin(process.env.APP_URL.trim());
  const deployment = vercelOrigin();
  if (deployment) return deployment;
  if (process.env.NODE_ENV !== 'production') return 'http://localhost:3000';
  throw new AuthConfigurationError('Configure APP_URL com o endereço HTTPS desta instalação.');
}

export function allowedOrigins(): Set<string> {
  const origins = new Set([appOrigin()]);
  for (const value of (process.env.APP_ALLOWED_ORIGINS || '').split(',').filter(v => v.trim())) origins.add(exactOrigin(value.trim()));
  const deployment = vercelOrigin();
  if (deployment) origins.add(deployment);
  return origins;
}

export function safeReturnPath(value: string | null | undefined, fallback = '/dashboard'): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || /[\\\u0000-\u0020]/.test(value)) return fallback;
  try {
    const url = new URL(value, 'https://return.example.invalid');
    if (url.origin !== 'https://return.example.invalid' || /^\/(?:login|auth\/callback|auth\/confirm)(?:\/|$)/.test(url.pathname)) return fallback;
    return url.pathname + url.search;
  } catch { return fallback; }
}

export function supabasePublicConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new AuthConfigurationError();
  let secretKey = key.startsWith('sb_secret_');
  if (key.split('.').length === 3) {
    try {
      const payload = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString('utf8')) as { role?: string };
      secretKey ||= payload.role === 'service_role';
    } catch { /* The provider validates malformed credentials; no token is logged. */ }
  }
  if (secretKey) throw new AuthConfigurationError('A chave pública configurada não pode ser uma chave administrativa. Corrija a variável pública e revogue qualquer chave exposta.');
  try {
    const parsed = new URL(url);
    if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error();
  } catch { throw new AuthConfigurationError('A URL do Supabase configurada no servidor é inválida.'); }
  return { url, key };
}

export function authServiceUnavailable(error: { status?: number; name?: string } | null | undefined) {
  return !!error && (error.name === 'AuthRetryableFetchError' || error.status === 0 || (error.status !== undefined && error.status >= 500));
}
