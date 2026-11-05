import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { tokenHash } from '@/lib/auth';
import { AppError } from '@/lib/http';

export async function authRateLimit(action: 'login' | 'recovery', email: string) {
  const key = tokenHash(`${action}:${email.toLowerCase()}`);
  const since = new Date(Date.now() - 15 * 60 * 1000);
  const accepted = await prisma.$transaction(async tx => {
    await tx.$queryRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${key}))::text`);
    const bucket = await tx.loginAttempt.findUnique({ where: { key } });
    if (bucket?.blockedUntil && bucket.blockedUntil > new Date()) return false;
    const attempts = bucket && bucket.windowStart >= since ? bucket.attempts + 1 : 1;
    await tx.loginAttempt.upsert({ where: { key }, create: { key, attempts: 1 }, update: { attempts, windowStart: attempts === 1 ? new Date() : bucket?.windowStart, blockedUntil: attempts >= 5 ? new Date(Date.now() + 15 * 60 * 1000) : null } });
    return true;
  });
  if (!accepted) throw new AppError('Muitas tentativas. Aguarde 15 minutos antes de tentar novamente.', 429, 'AUTH_RATE_LIMIT');
  return key;
}
