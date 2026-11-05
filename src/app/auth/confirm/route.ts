import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';
import { appOrigin } from '@/lib/auth-config';

/** Supabase email templates link here with TokenHash; never send raw session tokens in query strings. */
export async function GET(request: NextRequest) {
  const origin = appOrigin();
  const token_hash = request.nextUrl.searchParams.get('token_hash');
  const type = request.nextUrl.searchParams.get('type');
  if (token_hash && /^[A-Za-z0-9_-]{20,512}$/.test(token_hash) && (type === 'recovery' || type === 'invite')) {
    try {
      const supabase = await supabaseServer();
      const { error } = await supabase.auth.verifyOtp({ token_hash, type });
      if (!error) return NextResponse.redirect(new URL('/recuperar-senha', origin), { headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
    } catch { /* Invalid/expired links share one safe response. */ }
  }
  return NextResponse.redirect(new URL('/login?error=recovery_expired', origin), { headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
}
