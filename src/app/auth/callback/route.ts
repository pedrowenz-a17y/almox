import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';
import { appOrigin, safeReturnPath } from '@/lib/auth-config';

export async function GET(request: NextRequest) {
  const origin = appOrigin();
  const code = request.nextUrl.searchParams.get('code');
  const next = safeReturnPath(request.nextUrl.searchParams.get('next'));
  if (code && code.length <= 4096) {
    try {
      const supabase = await supabaseServer();
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (!error) return NextResponse.redirect(new URL(next, origin), { headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
    } catch { /* Never expose tokens or provider details in URLs. */ }
  }
  return NextResponse.redirect(new URL('/login?error=recovery_expired', origin), { headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
}
