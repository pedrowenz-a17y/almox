import { z } from 'zod';
import { cookies } from 'next/headers';
import { prisma } from '@/lib/db';
import { api, AppError, json } from '@/lib/http';
import { requireUser, UNIT_COOKIE } from '@/lib/auth';
import { authRateLimit } from '@/lib/auth-rate-limit';
import { authServiceUnavailable } from '@/lib/auth-config';
import { supabaseServer } from '@/lib/supabase/server';

export const runtime = 'nodejs';
const credentials = z.object({ email: z.string().trim().email().max(254).transform(v => v.toLowerCase()), password: z.string().min(1).max(128) }).strict();
export const POST = api(async request => {
  const input = credentials.parse(await request.json());
  const key = await authRateLimit('login', input.email);
  const supabase = await supabaseServer();
  const { error } = await supabase.auth.signInWithPassword(input);
  if (error) {
    if (authServiceUnavailable(error)) throw new AppError('O serviço de autenticação está temporariamente indisponível. Tente novamente.', 503, 'AUTH_UNAVAILABLE');
    if (error.status === 429) throw new AppError('Muitas tentativas de acesso. Aguarde antes de tentar novamente.', 429);
    throw new AppError('E-mail ou senha inválidos, ou conta ainda não confirmada.', 401, 'INVALID_CREDENTIALS');
  }
  (await cookies()).set(UNIT_COOKIE, '', { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 0 });
  try {
    const user = await requireUser();
    await prisma.$transaction([
      prisma.auditLog.create({ data: { userId: user.id, unitId: user.unitId, action: 'LOGIN', entity: 'User', entityId: user.id } }),
      prisma.loginAttempt.deleteMany({ where: { key } }),
    ]);
  } catch (error) {
    await supabase.auth.signOut({ scope: 'local' });
    throw error;
  }
  return json({ ok: true });
});
