import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, afterEach, before, beforeEach, test } from "node:test";
import type { PrismaClient } from "@prisma/client";
import type { StockActor } from "../src/services/stock";

const testUrl = process.env.TEST_DATABASE_URL;
if (!testUrl) throw new Error("Defina TEST_DATABASE_URL para uma base isolada de testes.");
const parsedUrl = new URL(testUrl);
const databaseName = decodeURIComponent(parsedUrl.pathname.slice(1));
if (!["postgres:", "postgresql:"].includes(parsedUrl.protocol) || !/(^|[_-])tests?([_-]|$)/i.test(databaseName)) {
  throw new Error("A base de integração deve ter test no nome e ser exclusiva de testes.");
}
process.env.DATABASE_URL = testUrl;
process.env.DIRECT_URL = testUrl;
let db: PrismaClient;
let listPending: typeof import("../src/services/operational-pending").listOperationalPending;
let fixture: {
  organizationId: string; roleId: string; userId: string; unitIds: string[];
  locationIds: string[]; productIds: string[]; actor: StockActor;
};
before(async () => {
  ({ prisma: db } = await import("../src/lib/db"));
  ({ listOperationalPending: listPending } = await import("../src/services/operational-pending"));
  const actual = await db.$queryRaw<Array<{ name: string }>>`SELECT current_database()::text AS name`;
  assert.equal(actual[0].name, databaseName);
});
beforeEach(async () => {
  const suffix = randomUUID();
  const organization = await db.organization.create({ data: { name: `TEST-PENDING-${suffix}` } });
  const role = await db.role.create({ data: { name: `TEST-PENDING-${suffix}` } });
  const user = await db.user.create({ data: { name: "Responsável de teste", email: `${suffix}@example.invalid`, roleId: role.id } });
  const units = await Promise.all(["A", "B"].map(code => db.operationalUnit.create({ data: {
    organizationId: organization.id, code: `TEST-PENDING-${code}-${suffix}`, name: `Unidade de teste ${code}`,
    memberships: { create: { userId: user.id, roleId: role.id } },
  } })));
  const warehouses = await Promise.all(units.map(unit => db.warehouse.create({ data: { unitId: unit.id, code: "ALM-PENDING", name: "Almoxarifado" } })));
  const locations = await Promise.all(warehouses.map((warehouse, index) => db.location.create({ data: {
    unitId: units[index].id, warehouseId: warehouse.id, code: "LOC-PENDING", name: "Local de teste",
  } })));
  const products = await Promise.all(units.map(unit => db.product.create({ data: {
    unitId: unit.id, internalCode: "ITEM-PENDING", name: "Material de teste", unit: "UN", unitCost: "9213.47",
  } })));
  fixture = { organizationId: organization.id, roleId: role.id, userId: user.id, unitIds: units.map(unit => unit.id),
    productIds: products.map(product => product.id), locationIds: locations.map(location => location.id),
    actor: { id: user.id, unitId: units[0].id, permissions: ["orders:read", "inventory:count"] } };
});
afterEach(async () => {
  if (!fixture) return;
  const where = { unitId: { in: fixture.unitIds } };
  await db.$transaction(async tx => {
    await tx.inventorySchedule.updateMany({ where, data: { lastCountId: null } });
    await tx.inventoryCount.deleteMany({ where });
    await tx.inventorySchedule.deleteMany({ where });
    await tx.orderEvent.deleteMany({ where });
    await tx.orderMaterial.deleteMany({ where });
    await tx.workOrder.deleteMany({ where });
    await tx.product.deleteMany({ where });
    await tx.location.deleteMany({ where });
    await tx.warehouse.deleteMany({ where });
    await tx.unitMembership.deleteMany({ where });
    await tx.operationalUnit.deleteMany({ where: { id: { in: fixture.unitIds } } });
    await tx.user.delete({ where: { id: fixture.userId } });
    await tx.role.delete({ where: { id: fixture.roleId } });
    await tx.organization.delete({ where: { id: fixture.organizationId } });
  });
});
after(async () => { await db?.$disconnect(); });

async function createOrder(index = 0, invoiced = false) {
  const order = await db.workOrder.create({ data: {
    unitId: fixture.unitIds[index], userId: fixture.userId, code: `ORDER-${randomUUID()}`, title: index ? "Destino secreto outra unidade" : "Aplicação de materiais",
    kind: "PRODUCTION", status: invoiced ? "INVOICED" : "OPEN",
    ...(invoiced ? { invoiceReference: "NF-TEST", invoicedAt: new Date() } : {}),
    materials: { create: { unitId: fixture.unitIds[index], productId: fixture.productIds[index], locationId: fixture.locationIds[index],
      requestedQuantity: invoiced ? "4" : "10", reservedQuantity: invoiced ? "0" : "2", appliedQuantity: invoiced ? "0" : "3",
      consumedQuantity: invoiced ? "4" : "0", returnedQuantity: invoiced ? "1" : "0", pendingReturnQuantity: invoiced ? "2" : "1" } },
  }, include: { materials: true } });
  return order;
}
async function createInventory(index = 0) {
  const base = { unitId: fixture.unitIds[index], locationId: fixture.locationIds[index], createdById: fixture.userId, title: "Conferência semanal", intervalDays: 7 };
  await db.inventorySchedule.create({ data: { ...base, nextDueAt: new Date("2020-01-01T00:00:00Z") } });
  await db.inventorySchedule.create({ data: { ...base, nextDueAt: new Date("2090-01-01T00:00:00Z") } });
  await db.inventorySchedule.create({ data: { ...base, nextDueAt: new Date("2020-01-01T00:00:00Z"), active: false } });
  await db.inventoryCount.create({ data: { unitId: fixture.unitIds[index], locationId: fixture.locationIds[index], userId: fixture.userId, note: "Contagem de teste", status: "PENDING" } });
}

test("pendências separam etapas, mostram devolução faturada e não expõem outra unidade ou custos", async () => {
  const open = await createOrder();
  const invoiced = await createOrder(0, true);
  await createOrder(1);
  await createInventory();
  await createInventory(1);
  const result = await listPending(fixture.actor);
  assert.deepEqual(result.totals, { UNAPPLIED: 1, RESERVED: 1, AWAITING_INVOICE: 1, RETURN: 2, COUNT: 1, SCHEDULE: 1 });
  assert.equal(result.total, 7);
  assert.equal(result.items.find(item => item.orderId === open.id && item.type === "UNAPPLIED")?.quantity, "7.000");
  assert.equal(result.items.find(item => item.orderId === invoiced.id)?.quantity, "2.000");
  assert.equal(result.items.some(item => item.type === "SCHEDULE" && item.dueAt?.startsWith("2020-01-01")), true);
  assert.equal(result.items.every(item => item.createdAt.endsWith("Z")), true);
  assert.equal(result.items.filter(item => item.dueAt).every(item => item.dueAt?.endsWith("Z")), true);
  assert.equal(result.items.find(item => item.orderId === open.id)?.createdAt, open.createdAt.toISOString());
  assert.equal(JSON.stringify(result).includes("Destino secreto"), false);
  assert.equal(JSON.stringify(result).includes("9213.47"), false);
  assert.equal(JSON.stringify(result).includes("unitCost"), false);
});

test("permissões isolam ordens de inventário dentro do painel", async () => {
  await createOrder();
  await createInventory();
  const inventory = await listPending({ ...fixture.actor, permissions: ["inventory:count"] });
  assert.equal(inventory.total, 2);
  assert.equal(inventory.items.every(item => !item.orderId), true);
  assert.equal(inventory.totals.RETURN, 0);
  const orders = await listPending({ ...fixture.actor, permissions: ["orders:read"] });
  assert.equal(orders.total, 4);
  assert.equal(orders.totals.COUNT, 0);
  assert.equal(orders.totals.SCHEDULE, 0);
  await assert.rejects(listPending({ ...fixture.actor, permissions: [] }), error => (error as { status?: number }).status === 403);
});

test("totais completos permanecem estáveis durante paginação e filtro", async () => {
  for (let index = 0; index < 9; index++) await createOrder();
  const first = await listPending(fixture.actor, { pageSize: 7 });
  const second = await listPending(fixture.actor, { pageSize: 7, page: 2 });
  assert.equal(first.total, 36);
  assert.equal(first.items.length, 7);
  assert.equal(first.totals.UNAPPLIED, 9);
  assert.equal(second.items.some(item => first.items.some(previous => previous.id === item.id)), false);
  const filtered = await listPending(fixture.actor, { type: "RETURN", pageSize: 5, page: 2 });
  assert.equal(filtered.total, 9);
  assert.equal(filtered.items.length, 4);
  assert.equal(filtered.items.every(item => item.type === "RETURN"), true);
  assert.equal(filtered.totals.UNAPPLIED, 9);
});

test("identificação ausente é sinalizada sem inventar o histórico", async () => {
  const legacy = await createOrder();
  const identified = await createOrder();
  await db.orderEvent.create({ data: { unitId: fixture.unitIds[0], orderId: identified.id,
    materialId: identified.materials[0].id, userId: fixture.userId, type: "APPLIED", quantity: "3", metadata: {
      handoff: { deliveredById: fixture.userId, receivedByName: "Pessoa de teste", receivedByIdentifier: "TEST-01", confirmation: "DECLARED_BY_OPERATOR" },
    } } });
  const result = await listPending(fixture.actor, { type: "AWAITING_INVOICE" });
  assert.equal(result.items.find(item => item.orderId === legacy.id)?.missingHandoff, true);
  assert.equal(result.items.find(item => item.orderId === identified.id)?.missingHandoff, false);
});
