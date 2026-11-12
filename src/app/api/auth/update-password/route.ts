import { api, json } from "@/lib/http";
import { clearPasswordSessionCookies } from "@/lib/auth-cookie-cleanup";
import { changeAccessPassword } from "@/services/password-access";
export const POST = api(async request => {
  const result = await changeAccessPassword(await request.json());
  await clearPasswordSessionCookies();
  return json(result);
});
