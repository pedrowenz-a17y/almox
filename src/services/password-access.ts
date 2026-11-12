import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/http";
import { authServiceUnavailable } from "@/lib/auth-config";
import { authMailClient } from "@/lib/access-provider";
import { supabaseServer } from "@/lib/supabase/server";

export type PasswordAuth = Pick<SupabaseClient["auth"], "getUser" | "updateUser" | "signOut" | "setSession" | "refreshSession">;
async function enabledAccount(authUserId: string, email?: string) {
  const user = await prisma.user.findUnique({ where: { authUserId }, select: { id: true, email: true, active: true, authUserId: true,
    memberships: { where: { active: true, unit: { active: true, organization: { active: true } } },
      select: { unitId: true, unit: { select: { name: true } } }, orderBy: { unitId: "asc" } } } });
  if (!user?.active || !user.memberships.length) throw new AppError("Sua identidade foi reconhecida, mas o acesso ao ERP precisa ser habilitado pelo administrador.", 403, "ACCOUNT_DISABLED");
  if (!email || user.email.toLowerCase() !== email.toLowerCase()) throw new AppError("O e-mail da identidade não corresponde ao cadastro. Peça ao administrador para revisar o vínculo.", 409, "AUTH_IDENTITY_CHANGED");
  return user;
}
export async function passwordContext(auth?: PasswordAuth) {
  auth ??= (await supabaseServer()).auth;
  const { data, error } = await auth.getUser();
  if (authServiceUnavailable(error)) throw new AppError("O serviço de login está temporariamente indisponível. Tente novamente mais tarde.", 503, "AUTH_UNAVAILABLE");
  if (error || !data.user) throw new AppError("Abra um link válido de convite ou recuperação para definir sua senha.", 401, "PASSWORD_LINK_REQUIRED");
  const user = await enabledAccount(data.user.id, data.user.email);
  return { email: user.email, identityId: data.user.id, units: user.memberships.map(member => member.unit.name) };
}
const linkSchema = z.object({ type: z.enum(["invite", "recovery"]), accessToken: z.string().min(20).max(16384), refreshToken: z.string().min(8).max(4096) }).strict();
export async function completeImplicitLink(rawInput: unknown, standalone?: PasswordAuth, server?: PasswordAuth) {
  const input = linkSchema.parse(rawInput);
  standalone ??= authMailClient().auth; server ??= (await supabaseServer()).auth;
  const verified = await standalone.getUser(input.accessToken);
  if (authServiceUnavailable(verified.error) || verified.error?.status === 429) throw new AppError(
    "O serviço de login está temporariamente indisponível. Aguarde e tente validar este link novamente.", 503, "AUTH_UNAVAILABLE");
  if (verified.error || !verified.data.user) throw new AppError("O link expirou ou não pôde ser validado. Solicite outro link.",
    authServiceUnavailable(verified.error) ? 503 : 401, authServiceUnavailable(verified.error) ? "AUTH_UNAVAILABLE" : "PASSWORD_LINK_REQUIRED");
  await enabledAccount(verified.data.user.id, verified.data.user.email);
  // Validate and rotate the refresh token as well. Never persist an unverified token pair.
  const refreshed = await standalone.refreshSession({ refresh_token: input.refreshToken });
  if (authServiceUnavailable(refreshed.error) || refreshed.error?.status === 429) throw new AppError(
    "O serviço de login não confirmou a validação. Aguarde antes de tentar novamente.", 503, "AUTH_UNAVAILABLE");
  if (refreshed.error || !refreshed.data.session || refreshed.data.user?.id !== verified.data.user.id)
    throw new AppError("O link não pôde ser concluído. Solicite um novo link de acesso.", authServiceUnavailable(refreshed.error) ? 503 : 401,
      authServiceUnavailable(refreshed.error) ? "AUTH_UNAVAILABLE" : "PASSWORD_LINK_REQUIRED");
  const stored = await server.setSession({ access_token: refreshed.data.session.access_token, refresh_token: refreshed.data.session.refresh_token });
  if (stored.error || stored.data.user?.id !== verified.data.user.id) {
    try { await server.signOut({ scope: "local" }); } catch { /* The route still refuses this session. */ }
    throw new AppError("Não foi possível concluir a validação do link. Solicite outro link.", 401, "PASSWORD_LINK_REQUIRED");
  }
  return { next: input.type === "invite" ? "/primeiro-acesso" : "/recuperar-senha" };
}
const passwordSchema = z.object({ password: z.string().min(12, "Use pelo menos 12 caracteres.").max(128), expectedIdentityId: z.string().uuid().optional() }).strict();
export async function changeAccessPassword(rawInput: unknown, auth?: PasswordAuth) {
  const { password, expectedIdentityId } = passwordSchema.parse(rawInput);
  auth ??= (await supabaseServer()).auth;
  const identity = await auth.getUser();
  if (identity.error || !identity.data.user) throw new AppError("O link expirou ou a sessão terminou. Solicite um novo link.",
    authServiceUnavailable(identity.error) ? 503 : 401, authServiceUnavailable(identity.error) ? "AUTH_UNAVAILABLE" : "PASSWORD_LINK_REQUIRED");
  if (expectedIdentityId && expectedIdentityId !== identity.data.user.id) throw new AppError(
    "A sessão mudou. Atualize esta página e confira o e-mail antes de definir a senha.", 409, "PASSWORD_ACCOUNT_CHANGED");
  const user = await enabledAccount(identity.data.user.id, identity.data.user.email), auditId = randomUUID();
  await prisma.auditLog.create({ data: { id: auditId, userId: user.id, unitId: user.memberships[0].unitId, action: "PASSWORD_CHANGE_REQUESTED",
    entity: "User", entityId: user.id, after: { authUserId: identity.data.user.id } } });
  const result = await auth.updateUser({ password });
  if (result.error) {
    const same = result.error.code === "same_password";
    throw new AppError(authServiceUnavailable(result.error) ? "Não foi possível acessar o serviço de login. Tente mais tarde."
      : same ? "Escolha uma senha diferente da atual." : "A senha não foi aceita. Use pelo menos 12 caracteres e confira a política de senhas com o administrador.",
    authServiceUnavailable(result.error) ? 503 : 400, same ? "PASSWORD_UNCHANGED" : "PASSWORD_POLICY");
  }
  if (result.data.user?.id !== identity.data.user.id) throw new AppError(
    "O serviço não confirmou a alteração da senha. Confira seu acesso antes de solicitar outra mudança.", 502, "PASSWORD_UPDATE_UNCONFIRMED");
  // The provider has committed the new password. Do not report a false rollback if the local audit is unavailable.
  try { await prisma.auditLog.update({ where: { id: auditId }, data: { action: "PASSWORD_UPDATED", after: { authUserId: identity.data.user.id } } }); }
  catch { console.error("PASSWORD_AUDIT_PENDING"); }
  try { const signout = await auth.signOut({ scope: "global" }); if (signout.error) console.error("PASSWORD_SIGNOUT_UNCONFIRMED"); }
  catch { console.error("PASSWORD_SIGNOUT_UNCONFIRMED"); }
  return { ok: true, message: "Senha atualizada. Entre novamente com seu e-mail e a nova senha." };
}
