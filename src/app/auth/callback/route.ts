import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { appOrigin } from "@/lib/auth-config";
import { authLinkFailure } from "@/lib/auth-links";
const headers = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };
export async function GET(request: NextRequest) {
  let origin: string;
  try { origin = appOrigin(); }
  catch { return NextResponse.redirect(new URL("/acesso-invalido?reason=configuration#", request.url), { headers }); }
  const code = request.nextUrl.searchParams.get("code");
  // Admin invitations and links opened on another device can carry a fragment,
  // which is never sent in an HTTP request. The browser completes that flow.
  if (!code) return NextResponse.redirect(new URL("/auth/retorno", origin), { headers });
  let reason = "expired";
  if (code.length <= 4096) {
    try {
      const supabase = await supabaseServer();
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (!error) return NextResponse.redirect(new URL("/recuperar-senha#", origin), { headers });
      reason = authLinkFailure(error);
    } catch { reason = "unavailable"; }
  }
  return NextResponse.redirect(new URL(`/acesso-invalido?reason=${reason}#`, origin), { headers });
}
