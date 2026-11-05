import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { api, AppError, json } from "@/lib/http";
const settingsInput = z
  .object({
    companyName: z.string().trim().min(2).max(160).optional(),
    allowNegativeStock: z.boolean().optional(),
  })
  .strict();
export const GET = api(async () => {
  const actor = await requireUser();
  return json(
    await prisma.appSettings.findUnique({ where: { unitId: actor.unitId } }),
  );
});
export const PATCH = api(async (request) => {
  const actor = await requireUser("settings:manage");
  const input = settingsInput.parse(await request.json());
  if (input.allowNegativeStock === true) {
    throw new AppError("Estoque negativo permanece bloqueado. A política operacional desta versão exige saldo disponível suficiente.", 400, "NEGATIVE_STOCK_BLOCKED");
  }
  const result = await prisma.$transaction(
    async (tx) => {
      const before = await tx.appSettings.findUnique({
        where: { unitId: actor.unitId },
      });
      const after = await tx.appSettings.upsert({
        where: { unitId: actor.unitId },
        update: input,
        create: { id: actor.unitId, unitId: actor.unitId, ...input },
      });
      await tx.auditLog.create({
        data: {
          userId: actor.id,
          unitId: actor.unitId,
          action: "SETTINGS_UPDATE",
          entity: "AppSettings",
          entityId: after.id,
          before: before
            ? (JSON.parse(JSON.stringify(before)) as Prisma.InputJsonValue)
            : Prisma.JsonNull,
          after: JSON.parse(JSON.stringify(after)) as Prisma.InputJsonValue,
        },
      });
      return after;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
  return json(result);
});
