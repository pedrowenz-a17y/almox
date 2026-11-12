import { Prisma } from "@prisma/client";
import { ACCESS_PROFILES, matchesProfile } from "@/lib/access-profiles";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/http";
import type { SessionUser } from "@/lib/auth";
import { assertActiveAccessManager } from "@/services/user-access";

/** Create missing templates only. No existing role, membership or user is edited. */
export async function prepareAccessProfiles(actor: SessionUser) {
  if (!actor.unitId || !actor.permissions.includes("users:manage"))
    throw new AppError("Seu perfil não permite disponibilizar perfis de acesso.", 403);
  return prisma.$transaction(async tx => {
    // Shared with bootstrap: global role names must be prepared atomically across units.
    await tx.$queryRaw(Prisma.sql`SELECT pg_advisory_xact_lock(728546210)::text`);
    await assertActiveAccessManager(tx, actor);
    const existing = await tx.role.findMany({
      where: { name: { in: ACCESS_PROFILES.map(profile => profile.name) } },
      include: { permissions: { include: { permission: true } } },
    });
    const missing = ACCESS_PROFILES.filter(profile => !existing.some(role => role.name === profile.name));
    const needed = [...new Set(missing.flatMap(profile => [...profile.permissions]))];
    if (needed.length) await tx.permission.createMany({ data: needed.map(key => ({ key })), skipDuplicates: true });
    const permissions = await tx.permission.findMany({ where: { key: { in: needed } } });
    const created: string[] = [];
    for (const profile of missing) {
      const role = await tx.role.create({ data: {
        name: profile.name,
        permissions: { createMany: { data: profile.permissions.map(key => ({
          permissionId: permissions.find(permission => permission.key === key)!.id,
        })) } },
      } });
      await tx.auditLog.create({ data: {
        userId: actor.id, unitId: actor.unitId, action: "ROLE_PROFILE_PREPARED", entity: "Role", entityId: role.id,
        after: { name: profile.name, permissions: [...profile.permissions] },
      } });
      created.push(profile.name);
    }
    return {
      created,
      preserved: existing.map(role => role.name),
      customized: existing.filter(role => !matchesProfile(role.name, role.permissions.map(link => link.permission.key))).map(role => role.name),
    };
  }, { maxWait: 10_000, timeout: 30_000 });
}
