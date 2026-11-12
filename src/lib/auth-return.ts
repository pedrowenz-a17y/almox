export type ImplicitAuthLink = { accessToken: string; refreshToken: string; type: "invite" | "recovery" };
export function readAuthFragment(fragment: string): ImplicitAuthLink | null {
  if (!fragment || fragment.length > 24000) return null;
  const query = new URLSearchParams(fragment.replace(/^#/, ""));
  if (query.has("error") || query.has("error_code")) return null;
  const accessToken = query.get("access_token"), refreshToken = query.get("refresh_token"), type = query.get("type");
  if (!accessToken || accessToken.length > 16384 || !refreshToken || refreshToken.length > 4096 || (type !== "invite" && type !== "recovery")) return null;
  return { accessToken, refreshToken, type };
}
