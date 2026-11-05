import 'dotenv/config';
import { Prisma, PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { supabaseAdmin } from '../src/lib/supabase/admin';

/** Run only in a trusted administrative terminal; Supabase owns passwords and identity. */
const db = new PrismaClient();
const inputSchema = z.object({
  authUserId: z.string().uuid(),
  email: z.string().trim().email().transform(v => v.toLowerCase()),
  name: z.string().trim().min(2).max(160).optional(),
  unitCodes: z.array(z.string().trim().min(1).max(80)).min(1),
});
async function main() {
  const parsed = inputSchema.safeParse({
    authUserId: process.env.PROVISION_AUTH_USER_ID,
    email: process.env.PROVISION_ADMIN_EMAIL,
    name: process.env.PROVISION_ADMIN_NAME || undefined,
    unitCodes: (process.env.PROVISION_UNIT_CODES || '').split(',').map(v => v.trim()).filter(Boolean),
  });
  if (!parsed.success) throw new Error('Configure PROVISION_AUTH_USER_ID, PROVISION_ADMIN_EMAIL e PROVISION_UNIT_CODES; PROVISION_ADMIN_NAME é opcional.');
  const input = parsed.data;
  input.unitCodes = [...new Set(input.unitCodes)];
  const supabase = supabaseAdmin();
  const { data, error } = await supabase.auth.admin.getUserById(input.authUserId);
  if (error || !data.user || data.user.email?.toLowerCase() !== input.email || !data.user.email_confirmed_at) throw new Error('A identidade autorizada não pôde ser validada. Confira o ID, e-mail confirmado e o projeto Supabase.');
  const result = await db.$transaction(async tx => {
    await tx.$queryRaw(Prisma.sql`SELECT pg_advisory_xact_lock(728546211)::text`);
    const role = await tx.role.findUnique({ where: { name: 'ADMINISTRADOR' }, include: { permissions: { include: { permission: true } } } });
    if (!role || !role.permissions.some(p => p.permission.key === 'users:manage')) throw new Error('Execute o bootstrap institucional e confira o perfil ADMINISTRADOR antes de provisionar.');
    const units = await tx.operationalUnit.findMany({ where: { code: { in: input.unitCodes }, active: true, organization: { active: true } } });
    if (units.length !== input.unitCodes.length) throw new Error('Uma unidade informada não existe ou está inativa. Revise PROVISION_UNIT_CODES.');
    const byEmail = await tx.user.findUnique({ where: { email: input.email } });
    const byIdentity = await tx.user.findUnique({ where: { authUserId: input.authUserId } });
    if ((byEmail?.authUserId && byEmail.authUserId !== input.authUserId) || (byIdentity && byIdentity.email !== input.email) || (byEmail && byIdentity && byEmail.id !== byIdentity.id)) throw new Error('O vínculo de identidade conflita com um cadastro existente. Nenhum identificador foi substituído.');
    const existing = byIdentity || byEmail;
    if (existing && !existing.active) throw new Error('O usuário existente está desativado. A inicialização não reativa contas automaticamente.');
    const previousMemberships = existing ? await tx.unitMembership.findMany({ where: { userId: existing.id, unitId: { in: units.map(unit => unit.id) } } }) : [];
    if (previousMemberships.some(m => m.roleId !== role.id || !m.active)) throw new Error('Há permissões já configuradas para esta conta. O provisionamento não redefine perfis nem reativa acessos existentes.');
    const user = existing ? await tx.user.update({ where: { id: existing.id }, data: existing.authUserId ? {} : { authUserId: input.authUserId } }) : await tx.user.create({ data: { name: input.name || input.email, email: input.email, authUserId: input.authUserId, roleId: role.id } });
    let created = 0;
    for (const unit of units) {
      if (previousMemberships.some(m => m.unitId === unit.id)) continue;
      await tx.unitMembership.create({ data: { userId: user.id, unitId: unit.id, roleId: role.id } });
      await tx.auditLog.create({ data: { userId: user.id, unitId: unit.id, action: 'ADMIN_PROVISIONED', entity: 'UnitMembership', entityId: `${user.id}:${unit.id}`, after: { role: role.name, source: 'trusted-administrative-provisioning' } } });
      created += 1;
    }
    return { created, total: units.length };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30000 });
  console.log(`Provisionamento concluído: ${result.created} novo(s) acesso(s), ${result.total} unidade(s) autorizada(s). Identificadores e permissões existentes foram preservados. Nenhuma senha foi criada ou redefinida.`);
}
main().catch(error => {
  // No provider/driver message is logged: those can contain connection strings or tokens.
  if (error instanceof Error && !(error instanceof Prisma.PrismaClientKnownRequestError) && !(error instanceof Prisma.PrismaClientInitializationError) && (error.message.startsWith('Configure PROVISION_') || error.message.startsWith('A identidade autorizada') || error.message.startsWith('Execute o bootstrap') || error.message.startsWith('Uma unidade') || error.message.startsWith('O vínculo') || error.message.startsWith('O usuário existente') || error.message.startsWith('Há permissões'))) console.error(error.message);
  else console.error('Falha no provisionamento. Confira a configuração protegida, a conectividade e as migrações. Nenhuma credencial foi registrada.');
  process.exitCode = 1;
}).finally(() => db.$disconnect());
