import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { tokenHash } from '@/lib/auth';
import { AppError } from '@/lib/http';

export async function authRateLimit(action: 'login' | 'recovery' | 'invitation', email: string) {
  const key = tokenHash(`${action}:${email.toLowerCase()}`);
  const since = new Date(Date.now() - 15 * 60 * 1000);
  const accepted = await prisma.$transaction(async tx => {
    await tx.$queryRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${key}))::text`);
    const bucket = await tx.loginAttempt.findUnique({ where: { key } });
    if (bucket?.blockedUntil && bucket.blockedUntil > new Date()) return Math.max(1, Math.ceil((bucket.blockedUntil.getTime() - Date.now()) / 1000));
    const attempts = bucket && bucket.windowStart >= since ? bucket.attempts + 1 : 1;
    await tx.loginAttempt.upsert({ where: { key }, create: { key, attempts: 1 }, update: { attempts, windowStart: attempts === 1 ? new Date() : bucket?.windowStart, blockedUntil: attempts >= 5 ? new Date(Date.now() + 15 * 60 * 1000) : null } });
    return 0;
  });
  if (accepted) throw new AppError('Muitas tentativas. Aguarde antes de tentar novamente.', 429, 'AUTH_RATE_LIMIT', accepted);
  return key;
}

/** Shared across invitations/recovery, deployments and units. Claim before contacting the mail provider. */
export async function claimAuthEmail(email: string) {
  const key = tokenHash(`auth-mail:${email.toLowerCase()}`);
  await prisma.$transaction(async tx => {
    await tx.$queryRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${key}))::text`);
    const current = await tx.loginAttempt.findUnique({ where: { key } });
    const now = new Date();
    if (current?.blockedUntil && current.blockedUntil > now) throw new AppError(
      'Já houve uma solicitação recente para este e-mail. Aguarde antes de pedir outro link.', 429, 'AUTH_EMAIL_COOLDOWN',
      Math.max(1, Math.ceil((current.blockedUntil.getTime() - now.getTime()) / 1000)),
    );
    const data = { attempts: 1, windowStart: now, blockedUntil: new Date(now.getTime() + 60_000) };
    await tx.loginAttempt.upsert({ where: { key }, create: { key, ...data }, update: data });
  });
}
