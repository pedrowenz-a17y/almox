import { createClient } from '@supabase/supabase-js';
import { AuthConfigurationError, supabasePublicConfig } from '@/lib/auth-config';

/** Service role is never imported into client components or returned by an API. */
export function supabaseAdmin() {
  if (typeof window !== 'undefined') throw new Error('Server-only operation');
  const { url } = supabasePublicConfig();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new AuthConfigurationError('O provisionamento de usuários precisa ser configurado pelo administrador do servidor.');
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    global: { fetch: (input, init) => fetch(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(12000), cache: 'no-store' }) },
  });
}
