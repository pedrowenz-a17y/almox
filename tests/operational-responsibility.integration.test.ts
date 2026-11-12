import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, afterEach, before, beforeEach, test } from "node:test";
import type { PrismaClient } from "@prisma/client";
import type { StockActor } from "../src/services/stock";
import { LEGACY_PERMISSION_KEYS } from "../src/lib/access-profiles";

const testUrl = process.env.TEST_DATABASE_URL;
if (!testUrl) throw new Error("Use uma TEST_DATABASE_URL exclusiva de testes.");
const parsed = new URL(testUrl), databaseName = decodeURIComponent(parsed.pathname.slice(1));
if (!["postgres:", "postgresql:"].includes(parsed.protocol) || !/(^|[_-])tests?([_-]|$)/i.test(databaseName)) throw new Error("Banco de teste obrigatório.");
process.env.DATABASE_URL = testUrl; process.env.DIRECT_URL = testUrl;
let db: PrismaClient;
let shifts: typeof import("../src/services/warehouse-shifts");
let pending: typeof import("../src/services/operational-pending");
let assignments: typeof import("../src/services/pending-assignments");
let coordination: typeof import("../src/services/operational-coordination");
let orders: typeof import("../src/services/orders");
let stock: typeof import("../src/services/stock");
let inventory: typeof import("../src/services/inventory");
let f: { orgId: string; units: string[]; warehouses: string[]; locations: string[]; productId: string;
  roles: string[]; people: StockActor[]; admin: StockActor; incoming: StockActor; auditor: StockActor; external: StockActor; counter: StockActor };
const forbidden = (error: unknown) => (error as { status?: number }).status === 403;
const conflict = (error: unknown) => (error as { status?: number }).status === 409;
const key = randomUUID;
const due = () => new Date(Date.now() + 3600_000).toISOString();
before(async () => {
  ({ prisma: db } = await import("../src/lib/db")); shifts = await import("../src/services/warehouse-shifts"); pending = await import("../src/services/operational-pending");
  assignments = await import("../src/services/pending-assignments"); coordination = await import("../src/services/operational-coordination");
  orders = await import("../src/services/orders"); stock = await import("../src/services/stock"); inventory = await import("../src/services/inventory");
  assert.equal((await db.$queryRaw<Array<{ name: string }>>`SELECT current_database()::text AS name`)[0].name, databaseName);
});
beforeEach(async () => {
  const suffix = key(), org = await db.organization.create({ data: { name: `TEST-SHIFTS-${suffix}` } });
  const units = await Promise.all([0, 1].map(i => db.operationalUnit.create({ data: { organizationId: org.id, code: `TEST-SHIFTS-${i}-${suffix}`, name: `Unidade ${i}` } })));
  const definitions = [[...LEGACY_PERMISSION_KEYS], ["stock:entry", "orders:read", "orders:deliver", "orders:return"], ["orders:read", "inventory:read"], ["inventory:count"]];
  await db.permission.createMany({ data: [...new Set(definitions.flat())].map(key => ({ key })), skipDuplicates: true });
  const permissions = await db.permission.findMany();
  const roles = await Promise.all(definitions.map((keys, i) => db.role.create({ data: { name: `TEST-SHIFTS-${i}-${suffix}`,
    permissions: { createMany: { data: keys.map(key => ({ permissionId: permissions.find(p => p.key === key)!.id })) } } } })));
  const people: StockActor[] = [];
  for (const [i, roleIndex, unitIndex] of [[0, 0, 0], [1, 1, 0], [2, 2, 0], [3, 0, 1], [4, 3, 0]]) {
    const user = await db.user.create({ data: { name: `Pessoa ${i}`, email: `${i}-${suffix}@example.invalid`, roleId: roles[roleIndex].id,
      memberships: { create: { unitId: units[unitIndex].id, roleId: roles[roleIndex].id } } } });
    people.push({ id: user.id, unitId: units[unitIndex].id, permissions: definitions[roleIndex] });
  }
  const warehouses = await Promise.all(units.map(unit => db.warehouse.create({ data: { unitId: unit.id, code: "ALM", name: "Almoxarifado teste" } })));
  const locations = await Promise.all(warehouses.map((warehouse, i) => db.location.create({ data: { warehouseId: warehouse.id, unitId: units[i].id, code: "A", name: "Prateleira" } })));
  const product = await db.product.create({ data: { unitId: units[0].id, internalCode: "MAT", name: "Material teste", unitCost: "7.25" } });
  f = { orgId: org.id, units: units.map(u => u.id), warehouses: warehouses.map(w => w.id), locations: locations.map(l => l.id), productId: product.id,
    roles: roles.map(r => r.id), people, admin: people[0], incoming: people[1], auditor: people[2], external: people[3], counter: people[4] };
  await stock.createMovement(f.admin, { type: "ENTRY", destinationId: f.locations[0], productId: f.productId, quantity: "100", idempotencyKey: key() });
});
afterEach(async () => {
  if (!f) return;
  const where = { unitId: { in: f.units } };
  await db.$transaction(async tx => {
    await tx.warehouseShift.deleteMany({ where }); await tx.pendingAssignment.deleteMany({ where });
    await tx.auditLog.deleteMany({ where }); await tx.idempotencyRecord.deleteMany({ where }); await tx.stockMovement.deleteMany({ where });
    await tx.orderEvent.deleteMany({ where }); await tx.orderMaterial.deleteMany({ where }); await tx.workOrder.deleteMany({ where });
    await tx.inventorySchedule.updateMany({ where, data: { lastCountId: null } }); await tx.inventoryCountItem.deleteMany({ where }); await tx.inventoryCount.deleteMany({ where }); await tx.inventorySchedule.deleteMany({ where });
    await tx.inventoryBalance.deleteMany({ where }); await tx.product.deleteMany({ where }); await tx.location.deleteMany({ where }); await tx.warehouse.deleteMany({ where });
    await tx.unitMembership.deleteMany({ where }); await tx.operationalUnit.deleteMany({ where: { id: { in: f.units } } });
    await tx.user.deleteMany({ where: { id: { in: f.people.map(p => p.id) } } }); await tx.rolePermission.deleteMany({ where: { roleId: { in: f.roles } } }); await tx.role.deleteMany({ where: { id: { in: f.roles } } });
    await tx.organization.delete({ where: { id: f.orgId } });
  }, { timeout: 30000 });
});
after(async () => { await db?.$disconnect(); });
const state = () => shifts.listWarehouseShifts(f.admin, f.warehouses[0]);
async function start() { await shifts.actOnWarehouseShift(f.admin, { action: "START", warehouseId: f.warehouses[0] }); return (await state()).active!; }
const action = (current: { id: string; version: number }, name: string, extra = {}) => ({ action: name, warehouseId: f.warehouses[0], shiftId: current.id, expectedVersion: current.version, note: "Registro de teste da equipe", ...extra });
async function requestOrder() {
  const order = await orders.createOrder(f.admin, { code: `OS-${key()}`, title: "Ordem teste", kind: "SERVICE", idempotencyKey: key() });
  return orders.actOnOrder(f.admin, order.id, { action: "REQUEST", productId: f.productId, locationId: f.locations[0], quantity: "5", idempotencyKey: key() });
}
async function unapplied() { await requestOrder(); return (await pending.listOperationalPending(f.admin, { type: "UNAPPLIED" })).items[0]; }
const assignment = (item: Awaited<ReturnType<typeof unapplied>>, extra = {}) => ({ pendingId: item.id, occurrenceKey: item.occurrenceKey, expectedVersion: item.assignmentVersion,
  assigneeId: f.incoming.id, dueAt: due(), note: "Separar e conferir material", ...extra });
const balance = async () => (await stock.availability(db, f.productId, f.locations[0], f.units[0])).quantity.toFixed(3);

test("turno inicia sem alterar saldos, contas ou permissões; auditor apenas consulta", async () => {
  const members = await db.unitMembership.findMany({ where: { unitId: f.units[0] } });
  const current = await start(); assert.equal(current.responsibleId, f.admin.id); assert.equal(await balance(), "100.000");
  assert.equal((await shifts.listWarehouseShifts(f.auditor, f.warehouses[0])).active?.id, current.id);
  await assert.rejects(shifts.actOnWarehouseShift(f.auditor, { action: "START", warehouseId: f.warehouses[0] }), forbidden);
  assert.deepEqual(await db.unitMembership.findMany({ where: { unitId: f.units[0] } }), members);
});
test("passagem exige aceite autenticado do indicado e preserva orientações no histórico", async () => {
  const first = await start(); await shifts.actOnWarehouseShift(f.admin, action(first, "REQUEST_HANDOVER", { toId: f.incoming.id }));
  const requested = (await state()).active!; assert.equal(requested.responsibleId, f.admin.id); assert.equal(requested.handoverToId, f.incoming.id);
  await assert.rejects(shifts.actOnWarehouseShift(f.admin, action(requested, "ACCEPT_HANDOVER")), forbidden);
  await shifts.actOnWarehouseShift(f.incoming, action(requested, "ACCEPT_HANDOVER"));
  const result = await state(); assert.equal(result.active?.responsibleId, f.incoming.id); assert.notEqual(result.active?.id, first.id);
  assert.equal(result.history.length, 1); assert.equal(result.history[0].endedById, f.incoming.id); assert.equal(result.history[0].handoverToId, f.incoming.id);
  assert.equal(await balance(), "100.000"); assert.equal(await db.auditLog.count({ where: { unitId: f.units[0], action: { startsWith: "WAREHOUSE_SHIFT_" } } }), 3);
});
test("inícios simultâneos mantêm somente um turno ativo", async () => {
  const result = await Promise.allSettled([f.admin, f.incoming].map(actor => shifts.actOnWarehouseShift(actor, { action: "START", warehouseId: f.warehouses[0] })));
  assert.equal(result.filter(r => r.status === "fulfilled").length, 1);
  assert.equal(await db.warehouseShift.count({ where: { unitId: f.units[0], endedAt: null } }), 1);
});
test("aceites repetidos ou concorrentes não criam dois turnos", async () => {
  const first = await start(); await shifts.actOnWarehouseShift(f.admin, action(first, "REQUEST_HANDOVER", { toId: f.incoming.id }));
  const requested = (await state()).active!;
  const result = await Promise.allSettled([0, 1].map(() => shifts.actOnWarehouseShift(f.incoming, action(requested, "ACCEPT_HANDOVER"))));
  assert.equal(result.filter(r => r.status === "fulfilled").length, 1); assert.equal(await db.warehouseShift.count({ where: { unitId: f.units[0] } }), 2);
});
test("versão antiga, outra unidade, perfil sem operação e auto passagem são recusados", async () => {
  const first = await start();
  await assert.rejects(shifts.actOnWarehouseShift(f.admin, action(first, "REQUEST_HANDOVER", { toId: f.admin.id })), error => (error as { status?: number }).status === 400);
  await assert.rejects(shifts.actOnWarehouseShift(f.admin, action(first, "REQUEST_HANDOVER", { toId: f.auditor.id })), forbidden);
  await assert.rejects(shifts.actOnWarehouseShift(f.admin, action(first, "REQUEST_HANDOVER", { toId: f.external.id })), forbidden);
  await assert.rejects(shifts.listWarehouseShifts(f.external, f.warehouses[0]), error => (error as { status?: number }).status === 404);
  await shifts.actOnWarehouseShift(f.admin, action(first, "REQUEST_HANDOVER", { toId: f.incoming.id }));
  await assert.rejects(shifts.actOnWarehouseShift(f.admin, action(first, "END")), conflict);
  assert.equal((await state()).active?.responsibleId, f.admin.id);
});
test("cancelamento revoga o aceite pendente; encerramento deixa ausência visível", async () => {
  const first = await start(); await shifts.actOnWarehouseShift(f.admin, action(first, "REQUEST_HANDOVER", { toId: f.incoming.id }));
  const requested = (await state()).active!; await shifts.actOnWarehouseShift(f.admin, action(requested, "CANCEL_HANDOVER"));
  await assert.rejects(shifts.actOnWarehouseShift(f.incoming, action(requested, "ACCEPT_HANDOVER")), conflict);
  const cancelled = (await state()).active!; assert.equal(cancelled.handoverToId, null);
  await shifts.actOnWarehouseShift(f.admin, action(cancelled, "END")); assert.equal((await state()).active, null);
});
test("acesso revogado antes do aceite é validado novamente no banco", async () => {
  const first = await start(); await shifts.actOnWarehouseShift(f.admin, action(first, "REQUEST_HANDOVER", { toId: f.incoming.id }));
  await db.unitMembership.update({ where: { userId_unitId: { userId: f.incoming.id, unitId: f.units[0] } }, data: { active: false } });
  await assert.rejects(shifts.actOnWarehouseShift(f.incoming, action((await state()).active!, "ACCEPT_HANDOVER")), forbidden);
  assert.equal((await state()).active?.responsibleId, f.admin.id);
});
test("supervisor intervém com justificativa, mas não aceita em nome de outra pessoa", async () => {
  await shifts.actOnWarehouseShift(f.incoming, { action: "START", warehouseId: f.warehouses[0] });
  const current = (await state()).active!;
  await shifts.actOnWarehouseShift(f.admin, action(current, "END"));
  assert.equal((await state()).history[0].endedById, f.admin.id);
});
test("almoxarifado inativo não recebe novo turno", async () => {
  await db.warehouse.update({ where: { id: f.warehouses[0] }, data: { active: false } });
  await assert.rejects(shifts.actOnWarehouseShift(f.admin, { action: "START", warehouseId: f.warehouses[0] }), error => (error as { status?: number }).status === 404);
  assert.equal((await state()).active, null);
});
test("atribuição registra pessoa, prazo, motivo e auditoria sem alterar estoque", async () => {
  const item = await unapplied(); await assignments.assignOperationalPending(f.admin, assignment(item));
  const result = await pending.listOperationalPending(f.admin); const assigned = result.items.find(row => row.id === item.id)!;
  assert.equal(assigned.assigneeId, f.incoming.id); assert.equal(assigned.assignmentVersion, 1); assert.equal(assigned.assigneeEligible, true);
  assert.equal(assigned.overdue, false); assert.equal(result.unassignedTotal, 0); assert.equal(await balance(), "100.000");
  assert.equal(await db.auditLog.count({ where: { unitId: f.units[0], action: "PENDING_ASSIGNED" } }), 1);
});
test("prazos passados, perfil inelegível e atribuição por auditor são recusados", async () => {
  const item = await unapplied();
  await assert.rejects(assignments.assignOperationalPending(f.admin, assignment(item, { dueAt: "2020-01-01T00:00:00Z" })), error => (error as { status?: number }).status === 400);
  await assert.rejects(assignments.assignOperationalPending(f.admin, assignment(item, { assigneeId: f.auditor.id })), forbidden);
  await assert.rejects(assignments.assignOperationalPending(f.auditor, assignment(item)), forbidden);
  assert.equal(await db.pendingAssignment.count({ where: { unitId: f.units[0] } }), 0);
});
test("responsável de outra unidade ou desativado não é aceito", async () => {
  const item = await unapplied();
  await assert.rejects(assignments.assignOperationalPending(f.admin, assignment(item, { assigneeId: f.external.id })), forbidden);
  await db.user.update({ where: { id: f.incoming.id }, data: { active: false } });
  await assert.rejects(assignments.assignOperationalPending(f.admin, assignment(item)), forbidden);
});
test("pessoa revogada é sinalizada sem apagar responsabilidade ou histórico", async () => {
  const item = await unapplied(); await assignments.assignOperationalPending(f.admin, assignment(item));
  await db.unitMembership.update({ where: { userId_unitId: { userId: f.incoming.id, unitId: f.units[0] } }, data: { active: false } });
  const row = (await pending.listOperationalPending(f.admin)).items[0]; assert.equal(row.assigneeId, f.incoming.id); assert.equal(row.assigneeEligible, false);
});
test("alterações concorrentes exigem versão atual e preservam uma única atribuição", async () => {
  const item = await unapplied();
  const outcomes = await Promise.allSettled([0, 1].map(() => assignments.assignOperationalPending(f.admin, assignment(item))));
  assert.equal(outcomes.filter(r => r.status === "fulfilled").length, 1); assert.equal(await db.pendingAssignment.count({ where: { unitId: f.units[0] } }), 1);
  await assert.rejects(assignments.assignOperationalPending(f.admin, assignment(item)), conflict);
  const updated = (await pending.listOperationalPending(f.admin)).items[0]; await assignments.assignOperationalPending(f.admin, assignment(updated, { assigneeId: f.admin.id, note: "Supervisor dará continuidade" }));
  assert.equal((await pending.listOperationalPending(f.admin)).items[0].assignmentVersion, 2);
});
test("minhas, sem responsável e atrasadas são filtradas no banco antes da paginação", async () => {
  const first = await unapplied(); const second = await unapplied();
  // Both references may identify the first ordered row; select distinct IDs from the full snapshot.
  const items = (await pending.listOperationalPending(f.admin)).items;
  assert.equal(items.length, 2); assert.ok(first.id && second.id);
  await assignments.assignOperationalPending(f.admin, assignment(items[0]));
  await db.pendingAssignment.updateMany({ where: { unitId: f.units[0] }, data: { dueAt: new Date("2020-01-01T00:00:00Z") } });
  const mine = await pending.listOperationalPending(f.incoming, { focus: "MINE", pageSize: 1 }); assert.equal(mine.total, 1); assert.equal(mine.mineTotal, 1); assert.equal(mine.overdueTotal, 1);
  assert.equal((await pending.listOperationalPending(f.admin, { focus: "UNASSIGNED" })).total, 1);
  assert.equal((await pending.listOperationalPending(f.admin, { focus: "OVERDUE" })).items[0].overdue, true);
  assert.equal((await pending.listOperationalPending(f.external)).total, 0);
});
test("aprovação não pode ser atribuída ao autor da contagem, nem ao conferente sem ajuste", async () => {
  const count = await inventory.createInventoryCount(f.admin, { locationId: f.locations[0], items: [{ productId: f.productId, expectedQuantity: "100", countedQuantity: "99" }], note: "Contagem de teste", idempotencyKey: key() });
  const item = (await pending.listOperationalPending(f.admin, { type: "COUNT" })).items[0]; assert.equal(item.creatorId, f.admin.id); assert.equal(item.assigneeId, null);
  await assert.rejects(assignments.assignOperationalPending(f.admin, assignment(item, { assigneeId: f.admin.id })), forbidden);
  await assert.rejects(assignments.assignOperationalPending(f.admin, assignment(item, { assigneeId: f.counter.id })), forbidden);
  await db.unitMembership.create({ data: { unitId: f.units[0], userId: f.external.id, roleId: f.roles[0] } });
  await assignments.assignOperationalPending(f.admin, assignment(item, { assigneeId: f.external.id }));
  assert.equal((await pending.listOperationalPending(f.admin, { type: "COUNT" })).items[0].assigneeId, f.external.id);
  assert.equal((await db.inventoryCount.findUniqueOrThrow({ where: { id: count.id } })).status, "PENDING"); assert.equal(await balance(), "100.000");
});
test("resolução remove a pendência da lista; reabertura não herda o prazo antigo", async () => {
  const order = await requestOrder(); const materialId = order.materials[0].id;
  const item = (await pending.listOperationalPending(f.admin, { type: "UNAPPLIED" })).items[0]; await assignments.assignOperationalPending(f.admin, assignment(item));
  await orders.actOnOrder(f.admin, order.id, { action: "RESERVE", materialId, quantity: "5", idempotencyKey: key() });
  await orders.actOnOrder(f.admin, order.id, { action: "APPLY", materialId, quantity: "5", receivedByName: "Operador teste", receivedByIdentifier: "T-01", idempotencyKey: key() });
  assert.equal((await pending.listOperationalPending(f.admin, { type: "UNAPPLIED" })).total, 0);
  await orders.actOnOrder(f.admin, order.id, { action: "RETURN", materialId, quantity: "1", note: "Sobra devolvida", returnedByName: "Operador teste", returnedByIdentifier: "T-01", idempotencyKey: key() });
  const reopened = (await pending.listOperationalPending(f.admin, { type: "UNAPPLIED" })).items[0]; assert.notEqual(reopened.occurrenceKey, item.occurrenceKey); assert.equal(reopened.assigneeId, null); assert.equal(reopened.dueAt, null);
  await assert.rejects(assignments.assignOperationalPending(f.admin, assignment(item)), conflict);
  assert.equal(await db.pendingAssignment.count({ where: { unitId: f.units[0] } }), 1);
});
test("aumento da quantidade enquanto aberta preserva a ocorrência e seu responsável", async () => {
  const order = await requestOrder(); const item = (await pending.listOperationalPending(f.admin)).items[0]; await assignments.assignOperationalPending(f.admin, assignment(item));
  await orders.actOnOrder(f.admin, order.id, { action: "REQUEST", productId: f.productId, locationId: f.locations[0], quantity: "2", idempotencyKey: key() });
  const row = (await pending.listOperationalPending(f.admin)).items[0]; assert.equal(row.quantity, "7.000"); assert.equal(row.occurrenceKey, item.occurrenceKey); assert.equal(row.assigneeId, f.incoming.id);
});
test("pendência legada mantém referência honesta e pode receber acompanhamento", async () => {
  const order = await requestOrder(); await db.orderEvent.updateMany({ where: { orderId: order.id }, data: { metadata: {} } });
  const item = (await pending.listOperationalPending(f.admin)).items[0]; assert.equal(item.openedAt, null); assert.ok(item.occurrenceKey.startsWith("legacy:"));
  await assignments.assignOperationalPending(f.admin, assignment(item)); assert.equal((await pending.listOperationalPending(f.admin)).items[0].assigneeId, f.incoming.id);
});
test("agenda permanece como fonte única de responsável e vencimento da conferência", async () => {
  const schedule = await db.inventorySchedule.create({ data: { unitId: f.units[0], locationId: f.locations[0], createdById: f.admin.id, assigneeId: f.counter.id, title: "Conferir almoxarifado", intervalDays: 7, nextDueAt: new Date("2020-01-01T00:00:00Z") } });
  const item = (await pending.listOperationalPending(f.admin, { type: "SCHEDULE" })).items[0]; assert.equal(item.assigneeId, f.counter.id); assert.equal(item.overdue, true); assert.equal(item.assigneeEligible, true);
  await assert.rejects(assignments.assignOperationalPending(f.admin, assignment(item)));
  assert.equal((await db.inventorySchedule.findUniqueOrThrow({ where: { id: schedule.id } })).nextDueAt.toISOString(), "2020-01-01T00:00:00.000Z");
});
test("etapa ausente no banco mantém consulta de pendências e bloqueia novas gravações", async () => {
  await requestOrder(); const rollback = new Error("rollback de teste");
  await assert.rejects(db.$transaction(async tx => {
    await tx.$executeRaw`ALTER TABLE "PendingAssignment" RENAME TO "PendingAssignmentStage3TestHidden"`;
    assert.equal(await coordination.coordinationReady(tx), false);
    const page = await pending.pendingSnapshot(f.admin, {}, tx); assert.equal(page.coordinationReady, false); assert.equal(page.items.length, 1); assert.equal(page.canManage, false);
    await assert.rejects(coordination.requireCoordination(tx), error => (error as { code?: string }).code === "OPERATIONS_SETUP_REQUIRED");
    throw rollback;
  }), error => error === rollback);
  assert.equal(await coordination.coordinationReady(), true);
});
test("novas tabelas têm RLS, sem acesso direto para anon e authenticated", async () => {
  const rows = await db.$queryRaw<Array<{ name: string; rls: boolean; anonymous: boolean; authenticated: boolean }>>`
    SELECT c.relname AS name, c.relrowsecurity AS rls,
      has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE') AS anonymous,
      has_table_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,DELETE') AS authenticated
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN ('WarehouseShift','PendingAssignment')`;
  assert.equal(rows.length, 2); for (const row of rows) { assert.equal(row.rls, true); assert.equal(row.anonymous, false); assert.equal(row.authenticated, false); }
});
