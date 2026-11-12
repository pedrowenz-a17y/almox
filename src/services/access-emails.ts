import { randomUUID } from "node:crypto";
import { z } from "zod";
import { prisma } from "@/lib/db";
import type { SessionUser } from "@/lib/auth";
import { tokenHash } from "@/lib/auth";
import { AppError } from "@/lib/http";
import { appOrigin } from "@/lib/auth-config";
import { authEmailError, authEmailRedirect } from "@/lib/auth-links";
import { authRateLimit, claimAuthEmail } from "@/lib/auth-rate-limit";
import { accessProvider, type AccessProvider } from "@/lib/access-provider";
import { assertActiveAccessManager } from "@/services/access-management";
import { accessProgress } from "@/services/access-progress";

const include = { user: { select: { id: true, name: true, email: true, active: true, authUserId: true } }, role: { select: { id: true, name: true } } } as const;
async function scopedAccess(actor: SessionUser, id: string) {
  if (!actor.unitId || !actor.permissions.includes("users:manage")) throw new AppError("Seu perfil não permite gerenciar acessos.", 403);
  z.string().uuid().parse(id);
  return prisma.$transaction(async tx => {
    await assertActiveAccessManager(tx, actor);
    const member = await tx.unitMembership.findUnique({ where: { userId_unitId: { userId: id, unitId: actor.unitId } }, include });
    if (!member) throw new AppError("Usuário não encontrado nesta unidade.", 404);
    return member;
  });
}
export async function accessEmailSetup(actor: SessionUser) {
  if (!actor.permissions.includes("users:manage")) throw new AppError("Seu perfil não permite consultar esta configuração.", 403);
  await assertActiveAccessManager(prisma, actor);
  const redirectTo = authEmailRedirect();
  return { origin: appOrigin(), redirectUrls: [redirectTo, `${appOrigin()}/auth/confirm`],
    administrativeKeyPresent: !!process.env.SUPABASE_SERVICE_ROLE_KEY };
}
export async function accessDetails(actor: SessionUser, id: string, providerFactory?: () => AccessProvider) {
  const member = await scopedAccess(actor, id);
  const progress = (await accessProgress([member], actor.unitId)).get(member.userId)!;
  const bucket = await prisma.loginAttempt.findUnique({ where: { key: tokenHash(`auth-mail:${member.user.email.toLowerCase()}`) } });
  let providerState: "READY" | "MISSING" | "MISMATCH" | "UNAVAILABLE" | "CONFIGURATION" | "UNLINKED" = "UNLINKED";
  let identity: { emailConfirmed: boolean; invitedAt: string | null; lastSignInAt: string | null; blocked: boolean } | null = null;
  if (member.user.authUserId) {
    if (!providerFactory && !process.env.SUPABASE_SERVICE_ROLE_KEY) providerState = "CONFIGURATION";
    else {
      const result = await (providerFactory ?? accessProvider)().getIdentity(member.user.authUserId);
      if (result.error?.status === 404 || result.error?.code === "user_not_found") providerState = "MISSING";
      else if (result.error || !result.user) providerState = result.error?.status === 401 || result.error?.status === 403 ? "CONFIGURATION" : "UNAVAILABLE";
      else if (result.user.id !== member.user.authUserId || result.user.email?.toLowerCase() !== member.user.email.toLowerCase()) providerState = "MISMATCH";
      else { providerState = "READY"; identity = { emailConfirmed: !!result.user.email_confirmed_at, invitedAt: result.user.invited_at ?? null,
        lastSignInAt: result.user.last_sign_in_at ?? null, blocked: !!result.user.banned_until && new Date(result.user.banned_until) > new Date() }; }
    }
  }
  return { id: member.userId, name: member.user.name, email: member.user.email, authUserId: member.user.authUserId,
    active: member.active, identityActive: member.user.active, ...progress, providerState, identity,
    canSend: member.active && member.user.active && providerState === "READY" && !identity?.blocked,
    nextAttemptAt: bucket?.blockedUntil && bucket.blockedUntil > new Date() ? bucket.blockedUntil.toISOString() : null };
}
export type AccessDetails = Awaited<ReturnType<typeof accessDetails>>;
export interface AccessMailResult { message: string; kind: "INVITE" | "RECOVERY"; retryAfter: number }
const sendInput = z.object({ authUserId: z.string().uuid() }).strict();

/** Explicit admin action only; recipient and unit always come from scoped stored data. */
export async function sendAccessEmail(actor: SessionUser, id: string, rawInput: unknown, providerFactory: () => AccessProvider = accessProvider): Promise<AccessMailResult> {
  const input = sendInput.parse(rawInput), member = await scopedAccess(actor, id);
  if (!member.active || !member.user.active) throw new AppError("Reative o acesso autorizado antes de enviar um link.", 403, "ACCESS_DISABLED");
  if (!member.user.authUserId || member.user.authUserId !== input.authUserId)
    throw new AppError("O vínculo de login mudou ou está ausente. Confira o cadastro antes de reenviar.", 409, "AUTH_IDENTITY_CHANGED");
  const redirectTo = authEmailRedirect(), provider = providerFactory();
  const { user, error } = await provider.getIdentity(member.user.authUserId);
  if (error || !user) throw new AppError("Não foi possível conferir a identidade de login. O administrador deve revisar o vínculo no Supabase.",
    error?.status === 404 ? 409 : 503, "AUTH_IDENTITY_UNAVAILABLE");
  if (user.id !== member.user.authUserId || user.email?.toLowerCase() !== member.user.email.toLowerCase())
    throw new AppError("A identidade não corresponde ao e-mail cadastrado. Nenhum link foi solicitado.", 409, "AUTH_IDENTITY_CHANGED");
  if (user.banned_until && new Date(user.banned_until) > new Date()) throw new AppError("A identidade está bloqueada no serviço de login.", 403, "ACCESS_DISABLED");
  await authRateLimit("invitation", actor.id);
  await claimAuthEmail(member.user.email);
  const kind = user.email_confirmed_at ? "RECOVERY" : "INVITE";
  const auditId = randomUUID();
  await prisma.$transaction(async tx => {
    await assertActiveAccessManager(tx, actor);
    const fresh = await tx.unitMembership.findUnique({ where: { userId_unitId: { userId: id, unitId: actor.unitId } }, include });
    if (!fresh?.active || !fresh.user.active || fresh.user.authUserId !== input.authUserId || fresh.user.email !== member.user.email)
      throw new AppError("O acesso mudou. Reabra o cadastro antes de enviar um link.", 409, "AUTH_IDENTITY_CHANGED");
    await tx.auditLog.create({ data: { id: auditId, userId: actor.id, unitId: actor.unitId, action: "USER_ACCESS_MAIL_REQUESTED", entity: "User", entityId: id,
      after: { authUserId: input.authUserId, kind } } });
  });
  try {
    if (kind === "INVITE") {
      const result = await provider.invite(member.user.email, member.user.name, redirectTo);
      if (result.error || !result.user) throw authEmailError(result.error);
      if (result.user.id !== input.authUserId) throw new AppError("O serviço retornou um vínculo diferente. O envio precisa de revisão administrativa.", 409, "AUTH_IDENTITY_CHANGED");
    } else {
      const result = await provider.recover(member.user.email, redirectTo);
      if (result.error) throw authEmailError(result.error);
    }
  } catch (cause) {
    const error = cause instanceof AppError ? cause : authEmailError({ status: 503 });
    try { await prisma.auditLog.update({ where: { id: auditId }, data: { action: "USER_ACCESS_MAIL_FAILED", after: { authUserId: input.authUserId, kind, code: error.code ?? "AUTH_EMAIL_UNAVAILABLE" } } }); }
    catch { console.error("AUTH_MAIL_AUDIT_PENDING"); }
    throw error;
  }
  // A provider-accepted send cannot be rolled back if audit finalization fails.
  try { await prisma.auditLog.update({ where: { id: auditId }, data: { action: kind === "INVITE" ? "USER_INVITATION_SENT" : "USER_RECOVERY_SENT", after: { authUserId: input.authUserId, kind } } }); }
  catch { console.error("AUTH_MAIL_AUDIT_PENDING"); }
  return { kind, retryAfter: 60, message: kind === "INVITE" ? "Convite solicitado ao serviço de e-mail. A pessoa deve abrir o link e definir a própria senha."
    : "Link de recuperação solicitado ao serviço de e-mail. Confira a caixa de entrada e o spam." };
}
