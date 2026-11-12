import { z } from "zod";
import { AppError } from "@/lib/http";
import { canManageResponsibilities, canOwnPending } from "@/lib/operational-responsibility";
import { activeMember, requireCoordination } from "@/services/operational-coordination";
import { pendingSnapshot } from "@/services/operational-pending";
import { serializable, type StockActor } from "@/services/stock";

const inputSchema = z.object({
  pendingId: z.string().regex(/^[0-9a-f-]{36}:(UNAPPLIED|RESERVED|AWAITING_INVOICE|RETURN|COUNT)$/),
  occurrenceKey: z.string().min(1).max(150),
  expectedVersion: z.number().int().min(0), assigneeId: z.string().uuid(),
  dueAt: z.string().datetime({ offset: true }), note: z.string().trim().min(5).max(1000),
}).strict();

export async function assignOperationalPending(actor: StockActor, rawInput: unknown) {
  if (!actor.unitId || !canManageResponsibilities(actor.permissions)) throw new AppError("Seu perfil não permite atribuir pendências.", 403);
  const input = inputSchema.parse(rawInput);
  return serializable(async tx => {
    await requireCoordination(tx);
    const manager = await activeMember(tx, actor);
    if (!canManageResponsibilities(manager.permissions)) throw new AppError("Sua permissão para atribuir pendências foi alterada.", 403);
    const current = await pendingSnapshot({ ...actor, permissions: manager.permissions }, { pageSize: 1 }, tx, { id: input.pendingId });
    const item = current.items[0];
    if (!item || item.occurrenceKey !== input.occurrenceKey)
      throw new AppError("Esta pendência foi resolvida ou mudou de ciclo. Atualize a lista.", 409, "PENDING_OCCURRENCE_CHANGED");
    const person = await activeMember(tx, actor, input.assigneeId);
    if (!canOwnPending(person.permissions, item.type, person.id, item.creatorId))
      throw new AppError(item.type === "COUNT" && person.id === item.creatorId
        ? "A aprovação precisa ser atribuída a outra pessoa autorizada, diferente de quem contou."
        : "O responsável não possui permissão para executar esta etapa na unidade.", 403, "INELIGIBLE_PENDING_ASSIGNEE");
    const dueAt = new Date(input.dueAt);
    if (dueAt.getTime() <= Date.now()) throw new AppError("Defina um prazo futuro para o acompanhamento.", 400);
    const where = { unitId_itemKey_occurrenceKey: { unitId: actor.unitId, itemKey: item.id, occurrenceKey: item.occurrenceKey } };
    const previous = await tx.pendingAssignment.findUnique({ where });
    if ((previous?.version ?? 0) !== input.expectedVersion)
      throw new AppError("Outra pessoa atualizou a atribuição. Reabra a pendência para conferir.", 409, "RESPONSIBILITY_VERSION_CONFLICT");
    const data = { assigneeId: person.id, dueAt, note: input.note, managedById: actor.id };
    const result = previous ? await tx.pendingAssignment.update({ where: { id: previous.id }, data: { ...data, version: { increment: 1 } } })
      : await tx.pendingAssignment.create({ data: { ...data, unitId: actor.unitId, itemKey: item.id, occurrenceKey: item.occurrenceKey } });
    await tx.auditLog.create({ data: { userId: actor.id, unitId: actor.unitId,
      action: previous ? "PENDING_REASSIGNED" : "PENDING_ASSIGNED", entity: "PendingAssignment", entityId: result.id,
      ...(previous ? { before: { assigneeId: previous.assigneeId, dueAt: previous.dueAt.toISOString(), note: previous.note, version: previous.version } } : {}),
      after: { itemKey: item.id, occurrenceKey: item.occurrenceKey, assigneeId: person.id, dueAt: dueAt.toISOString(), note: input.note, version: result.version },
    } });
    return { id: result.id, version: result.version };
  });
}
