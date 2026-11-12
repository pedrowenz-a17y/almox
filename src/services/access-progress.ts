import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { accessState, type AccessProgress } from "@/lib/access-status";

type Member = { userId: string; active: boolean; user: { active: boolean; authUserId: string | null } };
/** Only current identities count. A recreated Supabase account cannot inherit an old login's status. */
export async function accessProgress(records: Member[], unitId: string, db: Prisma.TransactionClient = prisma) {
  if (!records.length) return new Map<string, AccessProgress>();
  const rows = await db.$queryRaw<Array<{ id: string; lastLoginAt: Date | null; passwordDefinedAt: Date | null; invitationAt: Date | null;
    lastMailAction: string | null }>>(Prisma.sql`
    SELECT u.id::text,
      (SELECT max(a."createdAt") FROM "AuditLog" a WHERE a.entity = 'User' AND a."entityId" = u.id::text
        AND a.action = 'LOGIN' AND a."unitId" = ${unitId}::uuid AND a.after ->> 'authUserId' = u."authUserId"::text) AS "lastLoginAt",
      (SELECT max(a."createdAt") FROM "AuditLog" a WHERE a.entity = 'User' AND a."entityId" = u.id::text
        AND a.action = 'PASSWORD_UPDATED' AND a.after ->> 'authUserId' = u."authUserId"::text) AS "passwordDefinedAt",
      (SELECT max(a."createdAt") FROM "AuditLog" a WHERE a.entity = 'User' AND a."entityId" = u.id::text
        AND a.action = 'USER_INVITATION_SENT' AND a.after ->> 'authUserId' = u."authUserId"::text) AS "invitationAt",
      (SELECT a.action FROM "AuditLog" a WHERE a.entity = 'User' AND a."entityId" = u.id::text
        AND a.action IN ('USER_ACCESS_MAIL_REQUESTED','USER_INVITATION_SENT','USER_RECOVERY_SENT','USER_ACCESS_MAIL_FAILED')
        AND a.after ->> 'authUserId' = u."authUserId"::text ORDER BY a."createdAt" DESC, a.id DESC LIMIT 1) AS "lastMailAction"
    FROM "User" u WHERE u.id IN (${Prisma.join(records.map(record => Prisma.sql`${record.userId}::uuid`))})
  `);
  return new Map(records.map(member => {
    const row = rows.find(row => row.id === member.userId);
    const dates = { lastLoginAt: row?.lastLoginAt?.toISOString() ?? null, passwordDefinedAt: row?.passwordDefinedAt?.toISOString() ?? null,
      invitationAt: row?.invitationAt?.toISOString() ?? null };
    return [member.userId, { ...dates,
      accessState: accessState({ ...dates, active: member.active, identityActive: member.user.active, authLinked: !!member.user.authUserId }),
      lastMailState: row?.lastMailAction === "USER_ACCESS_MAIL_FAILED" ? "FAILED" : row?.lastMailAction === "USER_ACCESS_MAIL_REQUESTED" ? "UNCONFIRMED"
        : row?.lastMailAction ? "ACCEPTED" : null } satisfies AccessProgress];
  }));
}
