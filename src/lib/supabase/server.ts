import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { appOrigin, supabasePublicConfig } from '@/lib/auth-config';

export async function supabaseServer() {
  const { url, key } = supabasePublicConfig();
  const jar = await cookies();
  return createServerClient(url, key, {
    cookieOptions: { httpOnly: true, sameSite: 'lax', secure: appOrigin().startsWith('https://'), path: '/' },
    global: { fetch: (input, init) => fetch(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(12000), cache: 'no-store' }) },
    cookies: {
      getAll: () => jar.getAll(),
      setAll: (values) => {
        try { for (const { name, value, options } of values) jar.set(name, value, { ...options, httpOnly: true, sameSite: 'lax', secure: appOrigin().startsWith('https://'), path: '/' }); }
        catch { /* Server Components cannot write cookies; proxy refreshes them before rendering. */ }
      },
    },
  });
}
