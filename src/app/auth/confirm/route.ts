import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { appOrigin } from "@/lib/auth-config";
import { authLinkFailure } from "@/lib/auth-links";
const headers = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };
/** Compatibility with customized templates using TokenHash. Standard templates also work through /auth/callback. */
export async function GET(request: NextRequest) {
  let origin: string;
  try { origin = appOrigin(); }
  catch { return NextResponse.redirect(new URL("/acesso-invalido?reason=configuration#", request.url), { headers }); }
  const token_hash = request.nextUrl.searchParams.get("token_hash"), type = request.nextUrl.searchParams.get("type");
  let reason = "expired";
  if (token_hash && /^[A-Za-z0-9_-]{20,512}$/.test(token_hash) && (type === "recovery" || type === "invite")) {
    try {
      const supabase = await supabaseServer();
      const { error } = await supabase.auth.verifyOtp({ token_hash, type });
      if (!error) return NextResponse.redirect(new URL(type === "invite" ? "/primeiro-acesso#" : "/recuperar-senha#", origin), { headers });
      reason = authLinkFailure(error);
    } catch { reason = "unavailable"; }
  }
  return NextResponse.redirect(new URL(`/acesso-invalido?reason=${reason}#`, origin), { headers });
}
