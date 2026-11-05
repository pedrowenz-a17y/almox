/**
 * Verification tools may only target an explicitly selected isolated environment.
 * @param {{writes?: boolean, env?: Record<string, string | undefined>}} [options]
 */
export function qaConfig({ writes = false, env = process.env } = {}) {
  if (env.QA_ENVIRONMENT !== "isolated") {
    throw new Error("Defina QA_ENVIRONMENT=isolated somente para uma instalação exclusiva de testes. Não execute verificadores contra produção.");
  }
  if (!env.QA_BASE_URL) throw new Error("Defina QA_BASE_URL explicitamente. APP_URL não é utilizado como destino de testes.");
  const url = new URL(env.QA_BASE_URL);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error("QA_BASE_URL deve ser uma origem HTTP(S) sem credenciais, caminho, parâmetros ou fragmento.");
  }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (!local && (url.protocol !== "https:" || env.QA_ALLOWED_REMOTE_ORIGIN !== url.origin)) {
    throw new Error("Para homologação remota, configure HTTPS e QA_ALLOWED_REMOTE_ORIGIN exatamente igual à origem isolada autorizada.");
  }
  if (writes && env.ALLOW_QA_WRITES !== "1") {
    throw new Error("Este roteiro grava estoque e auditoria. Exige ALLOW_QA_WRITES=1, além do ambiente exclusivo de testes.");
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(env.QA_UNIT_ID || "")) {
    throw new Error("Defina QA_UNIT_ID com o UUID da unidade exclusiva de homologação, já autorizada às contas de teste.");
  }
  return { baseURL: url.origin, unitId: env.QA_UNIT_ID };
}

/** @param {string} [role] @param {Record<string, string | undefined>} [env] */
export function qaCredentials(role = "ADMIN", env = process.env) {
  const email = env[`QA_${role}_EMAIL`];
  const password = env[`QA_${role}_PASSWORD`];
  if (!email || !password) throw new Error(`Defina QA_${role}_EMAIL e QA_${role}_PASSWORD de uma conta Supabase real de homologação. Nenhum usuário é provisionado automaticamente pelos verificadores.`);
  return { email, password };
}

/** Supabase SSR may emit several chunked auth cookies in one response. */
export function mergeResponseCookies(jar, headers) {
  if (typeof headers.getSetCookie !== "function") throw new Error("Execute os verificadores com Node.js 22 ou superior para processar todos os cookies de sessão.");
  for (const cookie of headers.getSetCookie()) {
    const pair = cookie.split(";", 1)[0];
    const separator = pair.indexOf("=");
    if (separator < 1) continue;
    const name = pair.slice(0, separator);
    const value = pair.slice(separator + 1);
    if (/;\s*max-age=0(?:;|$)/i.test(cookie) || !value) jar.delete(name);
    else jar.set(name, value);
  }
  return jar;
}

export function cookieHeader(jar) {
  return jar instanceof Map ? [...jar].map(([name, value]) => `${name}=${value}`).join("; ") : jar;
}
