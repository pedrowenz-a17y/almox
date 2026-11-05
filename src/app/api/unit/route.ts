import { cookies } from 'next/headers';
import { z } from 'zod';
import { requireUser, UNIT_COOKIE } from '@/lib/auth';
import { api, AppError, json } from '@/lib/http';
import { appOrigin } from '@/lib/auth-config';
import { prisma } from '@/lib/db';
export const POST = api(async request => {
  const user = await requireUser();
  const { unitId } = z.object({ unitId: z.string().uuid() }).strict().parse(await request.json());
  if (!user.memberships.some(m => m.unitId === unitId)) throw new AppError('Você não tem acesso a esta unidade.', 403);
  await prisma.auditLog.create({ data: { userId: user.id, unitId, action: 'UNIT_SELECTED', entity: 'OperationalUnit', entityId: unitId } });
  (await cookies()).set(UNIT_COOKIE, unitId, { httpOnly: true, sameSite: 'lax', secure: appOrigin().startsWith('https://'), path: '/', maxAge: 60 * 60 * 24 * 30 });
  return json({ unitId });
});
