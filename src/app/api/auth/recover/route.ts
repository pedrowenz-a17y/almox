import { z } from "zod";
import { api, json } from "@/lib/http";
import { authEmailError, authEmailRedirect } from "@/lib/auth-links";
import { authRateLimit, claimAuthEmail } from "@/lib/auth-rate-limit";
import { authMailClient } from "@/lib/access-provider";
const inputSchema = z.object({ email: z.string().trim().email().max(254).transform(value => value.toLowerCase()) }).strict();
export const POST = api(async request => {
  const { email } = inputSchema.parse(await request.json());
  const redirectTo = authEmailRedirect();
  await authRateLimit("recovery", email);
  await claimAuthEmail(email);
  const { error } = await authMailClient().auth.resetPasswordForEmail(email, { redirectTo });
  if (error && (error.status === 429 || error.status === 0 || (error.status ?? 0) >= 500
    || ["email_address_not_authorized", "email_provider_disabled"].includes(error.code ?? ""))) throw authEmailError(error);
  // Same answer for missing, disabled and unregistered accounts. Never disclose ERP membership here.
  return json({ message: "Se houver uma conta habilitada para este e-mail, você receberá as instruções. Confira também o spam.", retryAfter: 60 });
});
