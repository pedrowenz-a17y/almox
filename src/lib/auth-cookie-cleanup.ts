import { cookies } from "next/headers";
import { appOrigin, supabasePublicConfig } from "@/lib/auth-config";
import { UNIT_COOKIE } from "@/lib/auth";

export async function clearPasswordSessionCookies() {
  const jar = await cookies(), { url } = supabasePublicConfig();
  const prefix = `sb-${new URL(url).hostname.split(".")[0]}-auth-token`;
  for (const cookie of jar.getAll()) if (cookie.name === prefix || cookie.name.startsWith(prefix + ".") || cookie.name.startsWith(prefix + "-"))
    jar.set(cookie.name, "", { httpOnly: true, secure: appOrigin().startsWith("https:"), sameSite: "lax", path: "/", maxAge: 0 });
  jar.set(UNIT_COOKIE, "", { httpOnly: true, secure: appOrigin().startsWith("https:"), sameSite: "lax", path: "/", maxAge: 0 });
}
