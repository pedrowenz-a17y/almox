import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/http";
import { canManageResponsibilities, canTakeWarehouseShift } from "@/lib/operational-responsibility";
import { activeMember, coordinationReady, requireCoordination, responsibilityCandidates } from "@/services/operational-coordination";
import { serializable, type StockActor } from "@/services/stock";

const person = { select: { id: true, name: true } } as const;
const include = { responsible: person, openedBy: person, endedBy: person, handoverTo: person } satisfies Prisma.WarehouseShiftInclude;
export type ShiftRecord = Omit<Prisma.WarehouseShiftGetPayload<{ include: typeof include }>, "startedAt" | "endedAt" | "handoverRequestedAt"> & {
  startedAt: string; endedAt: string | null; handoverRequestedAt: string | null;
};
export interface ShiftPage {
  ready: boolean; canTake: boolean; canManage: boolean; warehouseId: string;
  active: ShiftRecord | null; history: ShiftRecord[]; people: { id: string; name: string }[]; peopleTruncated: boolean;
}
const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("START"), warehouseId: z.string().uuid() }).strict(),
  ...(["REQUEST_HANDOVER", "ACCEPT_HANDOVER", "CANCEL_HANDOVER", "END"] as const).map(action => z.object({
    action: z.literal(action), warehouseId: z.string().uuid(), shiftId: z.string().uuid(), expectedVersion: z.number().int().positive(),
    toId: z.string().uuid().optional(), note: z.string().trim().min(5).max(1000),
  }).strict()),
]);
async function warehouse(actor: StockActor, warehouseId: string, db: Prisma.TransactionClient, active = false) {
  const result = await db.warehouse.findFirst({ where: { id: warehouseId, unitId: actor.unitId, ...(active ? { active: true } : {}) }, select: { id: true } });
  if (!result) throw new AppError("Almoxarifado não encontrado ou indisponível nesta unidade.", 404);
}
function authorize(actor: StockActor) {
  if (!actor.unitId || !(canTakeWarehouseShift(actor.permissions) || canManageResponsibilities(actor.permissions)
    || actor.permissions.includes("orders:read") || actor.permissions.includes("inventory:count") || actor.permissions.includes("inventory:read")))
    throw new AppError("Seu perfil não permite consultar os turnos do almoxarifado.", 403);
}
export async function listWarehouseShifts(actor: StockActor, rawWarehouseId: string): Promise<ShiftPage> {
  authorize(actor);
  const warehouseId = z.string().uuid().parse(rawWarehouseId);
  await warehouse(actor, warehouseId, prisma);
  const ready = await coordinationReady(), canTake = canTakeWarehouseShift(actor.permissions), canManage = canManageResponsibilities(actor.permissions);
  if (!ready) return { ready, canTake, canManage, warehouseId, active: null, history: [], people: [], peopleTruncated: false };
  const [current, history, candidates] = await Promise.all([
    prisma.warehouseShift.findFirst({ where: { unitId: actor.unitId, warehouseId, endedAt: null }, include }),
    prisma.warehouseShift.findMany({ where: { unitId: actor.unitId, warehouseId, endedAt: { not: null } }, include, orderBy: [{ endedAt: "desc" }, { id: "desc" }], take: 10 }),
    canTake || canManage ? responsibilityCandidates(actor) : Promise.resolve({ people: [], truncated: false }),
  ]);
  // The route serializes dates. Keep the same DTO shape for UI fixtures.
  return JSON.parse(JSON.stringify({ ready, canTake, canManage, warehouseId, active: current, history,
    people: candidates.people.filter(person => canTakeWarehouseShift(person.permissions)).map(({ id, name }) => ({ id, name })), peopleTruncated: candidates.truncated }));
}

export async function actOnWarehouseShift(actor: StockActor, rawInput: unknown) {
  authorize(actor);
  if (!canTakeWarehouseShift(actor.permissions) && !canManageResponsibilities(actor.permissions))
    throw new AppError("Seu perfil só permite consultar os turnos.", 403);
  const input = actionSchema.parse(rawInput);
  return serializable(async tx => {
    await requireCoordination(tx);
    await tx.$queryRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${actor.unitId + ":" + input.warehouseId}, 1))::text`);
    const person = await activeMember(tx, actor), manager = canManageResponsibilities(person.permissions);
    if (!canTakeWarehouseShift(person.permissions) && !manager) throw new AppError("Sua permissão para operar os turnos foi alterada.", 403);
    await warehouse(actor, input.warehouseId, tx, input.action === "START" || input.action === "ACCEPT_HANDOVER");
    const current = await tx.warehouseShift.findFirst({ where: { unitId: actor.unitId, warehouseId: input.warehouseId, endedAt: null } });
    let id: string;
    if (input.action === "START") {
      if (!canTakeWarehouseShift(person.permissions)) throw new AppError("É necessário um perfil operacional para assumir o almoxarifado.", 403);
      if (current) throw new AppError("Este almoxarifado já tem um responsável. Solicite a passagem de turno.", 409, "SHIFT_ALREADY_ACTIVE");
      const next = await tx.warehouseShift.create({ data: { unitId: actor.unitId, warehouseId: input.warehouseId, responsibleId: actor.id, openedById: actor.id } });
      id = next.id;
    } else {
      if (!current || current.id !== input.shiftId || current.version !== input.expectedVersion)
        throw new AppError("O turno foi atualizado. Confira o responsável atual antes de continuar.", 409, "SHIFT_VERSION_CONFLICT");
      const owner = current.responsibleId === actor.id;
      id = current.id;
      if (input.action === "ACCEPT_HANDOVER") {
        if (current.handoverToId !== actor.id || !canTakeWarehouseShift(person.permissions))
          throw new AppError("Somente a pessoa indicada, com seu próprio acesso, pode aceitar este turno.", 403, "SHIFT_ACCEPT_IDENTITY");
        await tx.warehouseShift.update({ where: { id }, data: { endedAt: new Date(), endedById: actor.id, closeNote: input.note, version: { increment: 1 } } });
        const next = await tx.warehouseShift.create({ data: { unitId: actor.unitId, warehouseId: input.warehouseId, responsibleId: actor.id, openedById: actor.id } });
        id = next.id;
      } else {
        if (!owner && !manager) throw new AppError("Somente o responsável atual ou um supervisor pode alterar este turno.", 403);
        if (input.action === "REQUEST_HANDOVER") {
          if (!input.toId || input.toId === current.responsibleId) throw new AppError("Escolha outra pessoa para receber o turno.", 400);
          const incoming = await activeMember(tx, actor, input.toId);
          if (!canTakeWarehouseShift(incoming.permissions)) throw new AppError("A pessoa indicada precisa ter um perfil operacional nesta unidade.", 403);
          await tx.warehouseShift.update({ where: { id }, data: { handoverToId: incoming.id, handoverNote: input.note, handoverRequestedAt: new Date(), version: { increment: 1 } } });
        } else if (input.action === "CANCEL_HANDOVER") {
          if (!current.handoverToId) throw new AppError("Não há passagem de turno aguardando aceite.", 409);
          await tx.warehouseShift.update({ where: { id }, data: { handoverToId: null, handoverNote: "", handoverRequestedAt: null, version: { increment: 1 } } });
        } else {
          await tx.warehouseShift.update({ where: { id }, data: { endedAt: new Date(), endedById: actor.id, closeNote: input.note, version: { increment: 1 } } });
        }
      }
    }
    await tx.auditLog.create({ data: { userId: actor.id, unitId: actor.unitId, action: `WAREHOUSE_SHIFT_${input.action}`, entity: "WarehouseShift", entityId: id,
      ...(current ? { before: { shiftId: current.id, responsibleId: current.responsibleId, handoverToId: current.handoverToId, version: current.version } } : {}),
      after: { warehouseId: input.warehouseId, shiftId: id, actorId: actor.id,
        ...(input.action !== "START" ? { note: input.note, toId: input.toId ?? null } : {}) } } });
    return { id };
  });
}
