import "dotenv/config";
import { LEGACY_PERMISSION_KEYS, ALL_PERMISSION_KEYS, ACCESS_PROFILES } from "../src/lib/access-profiles";
import { Prisma, PrismaClient } from "@prisma/client";

const db = new PrismaClient();
class BootstrapError extends Error {}
const permissions = LEGACY_PERMISSION_KEYS;
const roles: Record<string, readonly string[]> = {
  ADMINISTRADOR: permissions,
  SUPERVISOR: [
    "catalog:write", "stock:move", "inventory:count", "inventory:adjust", "reports:read",
    "orders:read", "orders:write", "orders:apply", "orders:invoice",
    "purchases:read", "purchases:write", "purchases:receive",
  ],
  OPERADOR: ["stock:move", "inventory:count", "orders:read", "orders:apply", "purchases:read", "purchases:receive"],
  ...Object.fromEntries(ACCESS_PROFILES.map(profile => [profile.name, profile.permissions])),
};
const institutions = [
  { code: "UCA", name: "U.C.A. Implementos Agrícolas" },
  { code: "CAPACLE", name: "Grupo Capacle" },
];

async function main() {
  if (process.env.SEED_DEMO === "true") {
    throw new BootstrapError("O bootstrap não cria demonstrações. Remova SEED_DEMO=true; dados de teste pertencem somente à base isolada de testes.");
  }
  const extendRoles = process.env.BOOTSTRAP_EXTEND_ROLE_PERMISSIONS === "true";
  const result = await db.$transaction(async (tx) => {
    await tx.$queryRaw(Prisma.sql`SELECT pg_advisory_xact_lock(728546210)::text`);
    const storedPermissions = await Promise.all(ALL_PERMISSION_KEYS.map((key) =>
      tx.permission.upsert({ where: { key }, update: {}, create: { key } }),
    ));
    let existingRolesPreserved = 0;
    for (const [name, keys] of Object.entries(roles)) {
      const existing = await tx.role.findUnique({ where: { name } });
      const role = existing ?? await tx.role.create({ data: { name } });
      if (existing && !extendRoles) {
        existingRolesPreserved += 1;
        continue;
      }
      await tx.rolePermission.createMany({
        data: storedPermissions.filter((permission) => keys.includes(permission.key))
          .map((permission) => ({ roleId: role.id, permissionId: permission.id })),
        skipDuplicates: true,
      });
    }
    for (const institution of institutions) {
      const organization = await tx.organization.upsert({
        where: { name: institution.name }, update: {}, create: { name: institution.name },
      });
      const existing = await tx.operationalUnit.findUnique({ where: { code: institution.code } });
      if (existing && (existing.organizationId !== organization.id || existing.name !== institution.name)) {
        throw new BootstrapError("Um código institucional já está associado a outro cadastro. Revise o mapeamento antes de executar o bootstrap.");
      }
      const unit = existing ?? await tx.operationalUnit.create({ data: {
        organizationId: organization.id, name: institution.name, code: institution.code,
      } });
      await tx.appSettings.upsert({
        where: { unitId: unit.id }, update: {},
        create: { id: unit.id, unitId: unit.id, companyName: institution.name, allowNegativeStock: false },
      });
    }
    return { existingRolesPreserved };
  }, { maxWait: 15_000, timeout: 60_000 });
  console.log("Estruturas institucionais e permissões preparadas. Nenhum usuário, material, saldo ou ordem foi criado.");
  if (result.existingRolesPreserved) {
    console.log("Perfis existentes preservados. Para estender conscientemente os perfis padrão, revise as permissões e utilize BOOTSTRAP_EXTEND_ROLE_PERMISSIONS=true uma única vez.");
  }
  console.log("Próximo passo: provisionar o administrador autorizado usando o procedimento documentado de Supabase Auth.");
}

main().catch((error: unknown) => {
  if (error instanceof BootstrapError) {
    console.error(error.message);
  } else {
    console.error("Falha ao preparar as estruturas. Confira conectividade, migrações e permissões do PostgreSQL; nenhum segredo foi registrado.");
  }
  process.exitCode = 1;
}).finally(async () => { await db.$disconnect(); });
