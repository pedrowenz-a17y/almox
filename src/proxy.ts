import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { appOrigin, supabasePublicConfig } from '@/lib/auth-config';

/** Refresh cookies before Server Components render. Authorization remains in requireUser/API services. */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  try {
    const { url, key } = supabasePublicConfig();
    const secure = appOrigin().startsWith('https://');
    const supabase = createServerClient(url, key, {
      cookieOptions: { httpOnly: true, sameSite: 'lax', secure, path: '/' },
      global: { fetch: (input, init) => fetch(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(12000), cache: 'no-store' }) },
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: values => {
          for (const { name, value } of values) request.cookies.set(name, value);
          response = NextResponse.next({ request });
          for (const { name, value, options } of values) response.cookies.set(name, value, { ...options, httpOnly: true, sameSite: 'lax', secure, path: '/' });
        },
      },
    });
    await supabase.auth.getUser();
  } catch { /* A protected route returns the concrete availability/configuration error. */ }
  response.headers.set('Cache-Control', 'no-store');
  return response;
}
export const config = { matcher: ['/((?!api|auth|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|webp|gif|ico|css|js|webmanifest|html)$).*)'] };
