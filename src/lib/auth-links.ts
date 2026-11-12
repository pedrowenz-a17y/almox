import { appOrigin, AuthConfigurationError, authServiceUnavailable } from "@/lib/auth-config";
import { AppError } from "@/lib/http";

export type AuthProviderError = { status?: number; name?: string; code?: string } | null | undefined;
export function authEmailRedirect() {
  const origin = appOrigin(), url = new URL(origin);
  if (url.protocol !== "https:" && !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
    throw new AuthConfigurationError("Configure APP_URL com o endereço HTTPS oficial antes de enviar links de acesso.");
  return `${origin}/auth/callback?next=/recuperar-senha`;
}
/** Never forward provider messages: they may contain URLs or personal information. */
export function authEmailError(error: AuthProviderError): AppError {
  if (error?.status === 429 || ["over_email_send_rate_limit", "over_request_rate_limit"].includes(error?.code ?? ""))
    return new AppError("O serviço de e-mail atingiu o limite de envio. Aguarde e, se continuar, procure o administrador.", 429, "AUTH_EMAIL_LIMIT");
  if (["email_address_not_authorized", "email_address_invalid", "email_provider_disabled"].includes(error?.code ?? ""))
    return new AppError("O serviço de e-mail não autorizou o envio para este destinatário. O administrador deve conferir a configuração de e-mail do Supabase.", 503, "AUTH_EMAIL_CONFIGURATION");
  return new AppError("O serviço não confirmou o envio do link. Tente novamente mais tarde ou procure o administrador.",
    authServiceUnavailable(error) ? 503 : 502, "AUTH_EMAIL_UNAVAILABLE");
}
export function authLinkFailure(error: AuthProviderError): "expired" | "browser" | "unavailable" {
  if (authServiceUnavailable(error) || error?.status === 429) return "unavailable";
  if (["bad_code_verifier", "flow_state_not_found", "flow_state_expired"].includes(error?.code ?? "")) return "browser";
  return "expired";
}
