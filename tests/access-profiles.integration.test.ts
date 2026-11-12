import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, afterEach, before, beforeEach, test } from "node:test";
import type { PrismaClient } from "@prisma/client";
import type { SessionUser } from "../src/lib/auth";
import { ACCESS_PROFILES, LEGACY_PERMISSION_KEYS } from "../src/lib/access-profiles";

const testUrl = process.env.TEST_DATABASE_URL;
if (!testUrl) throw new Error("Use TEST_DATABASE_URL de uma base exclusiva de testes.");
const databaseName = decodeURIComponent(new URL(testUrl).pathname.slice(1));
if (!/(^|[_-])tests?([_-]|$)/i.test(databaseName)) throw new Error("O nome do banco precisa conter test.");
process.env.DATABASE_URL = testUrl;
process.env.DIRECT_URL = testUrl;
let db: PrismaClient;
let profiles: typeof import("../src/services/access-profiles");
let stock: typeof import("../src/services/stock");
let orders: typeof import("../src/services/orders");
let purchases: typeof import("../src/services/purchases");
let inventory: typeof import("../src/services/inventory");
let schedules: typeof import("../src/services/inventory-schedules");
let reconcile: typeof import("../src/services/reconciliation");
let costs: typeof import("../src/services/order-costs");
let catalog: typeof import("../src/services/catalog");
let redactCosts: typeof import("../src/lib/auth").redactCosts;
let f: { orgId: string; roleId: string; units: string[]; unitCode: string; users: string[]; locations: string[]; productId: string; supplierId: string; admin: SessionUser; other: SessionUser };
const key = randomUUID;
const forbidden = (error: unknown) => { assert.equal((error as { status?: number }).status, 403); return true; };
const names = ACCESS_PROFILES.map(profile => profile.name);
before(async () => {
  ({ prisma: db } = await import("../src/lib/db"));
  profiles = await import("../src/services/access-profiles"); stock = await import("../src/services/stock");
  orders = await import("../src/services/orders"); purchases = await import("../src/services/purchases");
  inventory = await import("../src/services/inventory"); schedules = await import("../src/services/inventory-schedules");
  reconcile = await import("../src/services/reconciliation"); costs = await import("../src/services/order-costs"); catalog = await import("../src/services/catalog");
  ({ redactCosts } = await import("../src/lib/auth"));
  assert.equal((await db.$queryRaw<Array<{ name: string }>>`SELECT current_database()::text AS name`)[0].name, databaseName);
});
beforeEach(async () => {
  assert.equal(await db.role.count({ where: { name: { in: names } } }), 0, "Estes testes exigem uma base isolada sem modelos de acesso preexistentes.");
  const suffix = key();
  const org = await db.organization.create({ data: { name: `TEST-PROFILES-${suffix}` } });
  const units = await Promise.all(["A", "B"].map(letter => db.operationalUnit.create({ data: { organizationId: org.id, code: `TEST-PROFILE-${letter}-${suffix}`, name: `Unidade ${letter} teste` } })));
  await db.permission.createMany({ data: LEGACY_PERMISSION_KEYS.map(key => ({ key })), skipDuplicates: true });
  const keys = await db.permission.findMany({ where: { key: { in: [...LEGACY_PERMISSION_KEYS] } } });
  const role = await db.role.create({ data: { name: `TEST-LEGACY-${suffix}`, permissions: { createMany: { data: keys.map(permission => ({ permissionId: permission.id })) } } } });
  const users = await Promise.all(units.map((unit, i) => db.user.create({ data: { name: `Administrador ${i} de teste`, email: `${i}-${suffix}@example.invalid`, authUserId: key(), roleId: role.id, memberships: { create: { unitId: unit.id, roleId: role.id } } } })));
  const actor = (i: number): SessionUser => ({ id: users[i].id, authUserId: users[i].authUserId!, unitId: units[i].id, organizationId: org.id, roleId: role.id, role: { id: role.id, name: role.name }, active: true, name: users[i].name, email: users[i].email, permissions: [...LEGACY_PERMISSION_KEYS], memberships: [] });
  const warehouse = await db.warehouse.create({ data: { unitId: units[0].id, name: "Almoxarifado teste", code: "ALM-T" } });
  const locations = await Promise.all(["A", "B"].map(code => db.location.create({ data: { unitId: units[0].id, warehouseId: warehouse.id, code, name: `Local ${code}` } })));
  const product = await db.product.create({ data: { unitId: units[0].id, internalCode: "P-T", name: "Peça de teste", unitCost: "5.50" } });
  const supplier = await db.supplier.create({ data: { unitId: units[0].id, legalName: "Fornecedor teste" } });
  f = { orgId: org.id, roleId: role.id, units: units.map(unit => unit.id), unitCode: units[0].code, users: users.map(user => user.id), locations: locations.map(location => location.id), productId: product.id, supplierId: supplier.id, admin: actor(0), other: actor(1) };
  await stock.createMovement(f.admin, { type: "ENTRY", productId: f.productId, destinationId: f.locations[0], quantity: "100", idempotencyKey: key() });
});
afterEach(async () => {
  if (!f) return;
  const where = { unitId: { in: f.units } };
  const ownedProfiles = await db.role.findMany({ where: { name: { in: names } }, select: { id: true } });
  await db.$transaction(async tx => {
    await tx.idempotencyRecord.deleteMany({ where }); await tx.auditLog.deleteMany({ where });
    await tx.stockMovement.deleteMany({ where: { ...where, returnOfId: { not: null } } }); await tx.stockMovement.deleteMany({ where });
    await tx.orderEvent.deleteMany({ where }); await tx.orderMaterial.deleteMany({ where }); await tx.workOrder.deleteMany({ where });
    await tx.receiptItem.deleteMany({ where }); await tx.receipt.deleteMany({ where }); await tx.purchaseOrderItem.deleteMany({ where }); await tx.purchaseOrder.deleteMany({ where });
    await tx.inventorySchedule.updateMany({ where, data: { lastCountId: null } }); await tx.inventoryCountItem.deleteMany({ where }); await tx.inventoryCount.deleteMany({ where }); await tx.inventorySchedule.deleteMany({ where });
    await tx.reconciliationBatch.deleteMany({ where }); await tx.inventoryBalance.deleteMany({ where });
    await tx.product.deleteMany({ where }); await tx.supplier.deleteMany({ where }); await tx.location.deleteMany({ where }); await tx.warehouse.deleteMany({ where });
    await tx.appSettings.deleteMany({ where }); await tx.unitMembership.deleteMany({ where }); await tx.operationalUnit.deleteMany({ where: { id: { in: f.units } } });
    await tx.user.deleteMany({ where: { id: { in: f.users } } });
    const roleIds = [f.roleId, ...ownedProfiles.map(role => role.id)]; await tx.rolePermission.deleteMany({ where: { roleId: { in: roleIds } } }); await tx.role.deleteMany({ where: { id: { in: roleIds } } }); await tx.organization.delete({ where: { id: f.orgId } });
  }, { timeout: 30_000 });
});
after(async () => { await db?.$disconnect(); });
async function actorFor(name: string): Promise<SessionUser> {
  await profiles.prepareAccessProfiles(f.admin);
  const role = await db.role.findUniqueOrThrow({ where: { name }, include: { permissions: { include: { permission: true } } } });
  const user = await db.user.create({ data: { name: `${name} teste`, email: `${key()}@example.invalid`, authUserId: key(), roleId: role.id, memberships: { create: { unitId: f.units[0], roleId: role.id } } } });
  f.users.push(user.id);
  return { ...f.admin, id: user.id, authUserId: user.authUserId!, roleId: role.id, role: { id: role.id, name: role.name }, name: user.name, email: user.email, permissions: role.permissions.map(link => link.permission.key) };
}
const snapshot = async () => ({
  users: await db.user.findMany({ where: { id: { in: f.users } }, orderBy: { id: "asc" } }),
  memberships: await db.unitMembership.findMany({ where: { unitId: { in: f.units } }, orderBy: [{ unitId: "asc" }, { userId: "asc" }] }),
  legacy: await db.rolePermission.findMany({ where: { roleId: f.roleId }, orderBy: { permissionId: "asc" } }),
});
const booked = async () => (await stock.availability(db, f.productId, f.locations[0], f.units[0])).quantity.toFixed(3);
const proposal = () => inventory.createInventoryCount(f.admin, { locationId: f.locations[0], items: [{ productId: f.productId, expectedQuantity: "100", countedQuantity: "99" }], note: "Contagem de teste", idempotencyKey: key() });
const purchaseInput = () => ({ code: `PC-${key()}`, supplierId: f.supplierId, items: [{ productId: f.productId, quantity: "5", unitCost: "13.37" }], idempotencyKey: key() });
const stockInput = () => ({ kind: "STOCK", sourceName: "Arquivo teste", referenceAt: new Date().toISOString(), delimiter: ";", decimalFormat: "BR", csv: `unidade;produto;local;quantidade\n${f.unitCode};P-T;A;100` });
async function requestedOrder() {
  const order = await orders.createOrder(f.admin, { kind: "PRODUCTION", code: `OP-${key()}`, title: "Ordem de teste", idempotencyKey: key() });
  return orders.actOnOrder(f.admin, order.id, { action: "REQUEST", productId: f.productId, locationId: f.locations[0], quantity: "5", idempotencyKey: key() });
}

test("disponibiliza cinco perfis sem modificar contas, vínculos, permissões antigas ou saldos", async () => {
  const before = await snapshot();
  const result = await profiles.prepareAccessProfiles(f.admin);
  assert.equal(result.created.length, 5); assert.deepEqual(await snapshot(), before); assert.equal(await booked(), "100.000");
  const roles = await db.role.findMany({ where: { name: { in: names } }, include: { permissions: { include: { permission: true } } } });
  for (const model of ACCESS_PROFILES) assert.deepEqual(roles.find(role => role.name === model.name)!.permissions.map(link => link.permission.key).sort(), [...model.permissions].sort());
  assert.equal(await db.auditLog.count({ where: { unitId: f.units[0], userId: f.admin.id, action: "ROLE_PROFILE_PREPARED" } }), 5);
  assert.equal((await profiles.prepareAccessProfiles(f.admin)).created.length, 0);
  assert.equal(await db.auditLog.count({ where: { action: "ROLE_PROFILE_PREPARED", unitId: f.units[0] } }), 5);
});
test("preparação concorrente entre unidades não duplica perfis nem associa usuários", async () => {
  const before = await snapshot();
  const results = await Promise.all([profiles.prepareAccessProfiles(f.admin), profiles.prepareAccessProfiles(f.other)]);
  assert.equal(results.reduce((total, result) => total + result.created.length, 0), 5);
  assert.equal(await db.role.count({ where: { name: { in: names } } }), 5); assert.deepEqual(await snapshot(), before);
});
test("preserva perfil personalizado homônimo e sinaliza o conflito sem ampliar permissões", async () => {
  const permission = await db.permission.findUniqueOrThrow({ where: { key: "stock:move" } });
  const custom = await db.role.create({ data: { name: "AUDITOR", permissions: { create: { permissionId: permission.id } } } });
  const before = await db.rolePermission.findMany({ where: { roleId: custom.id } });
  const result = await profiles.prepareAccessProfiles(f.admin);
  assert.equal(result.created.length, 4); assert.deepEqual(result.customized, ["AUDITOR"]);
  assert.deepEqual(await db.rolePermission.findMany({ where: { roleId: custom.id } }), before);
});
test("gestão revogada ou unidade sem vínculo bloqueia a preparação antes de gravar", async () => {
  await assert.rejects(profiles.prepareAccessProfiles({ ...f.admin, unitId: f.units[1] }), forbidden);
  await db.unitMembership.update({ where: { userId_unitId: { userId: f.admin.id, unitId: f.units[0] } }, data: { active: false } });
  await assert.rejects(profiles.prepareAccessProfiles(f.admin), forbidden);
  assert.equal(await db.role.count({ where: { name: { in: names } } }), 0);
  assert.equal(await db.auditLog.count({ where: { action: "ROLE_PROFILE_PREPARED", unitId: { in: f.units } } }), 0);
});
test("almoxarife reserva, entrega e recebe devolução sem criar ou faturar ordens nem ajustar inventário", async () => {
  const actor = await actorFor("ALMOXARIFE"); const order = await requestedOrder(); const materialId = order.materials[0].id;
  await orders.actOnOrder(actor, order.id, { action: "RESERVE", materialId, quantity: "5", idempotencyKey: key() });
  await orders.actOnOrder(actor, order.id, { action: "APPLY", materialId, quantity: "5", receivedByName: "Recebedor teste", receivedByIdentifier: "M-001", idempotencyKey: key() });
  await assert.rejects(orders.actOnOrder(actor, order.id, { action: "INVOICE", reference: "NF-TEST", idempotencyKey: key() }), forbidden);
  await assert.rejects(orders.createOrder(actor, { kind: "PRODUCTION", code: "FORGED", title: "Teste", idempotencyKey: key() }), forbidden);
  await orders.actOnOrder(actor, order.id, { action: "REQUEST_RETURN", materialId, quantity: "2", note: "Sobra de material identificada", idempotencyKey: key() });
  await orders.actOnOrder(actor, order.id, { action: "RETURN", materialId, quantity: "2", note: "Recebimento físico", returnedByName: "Devolvente teste", returnedByIdentifier: "M-002", idempotencyKey: key() });
  assert.equal(await booked(), "100.000");
  await assert.rejects(stock.createMovement(actor, { type: "EXIT", purpose: "LOSS", note: "Descarte de material avariado", productId: f.productId, sourceId: f.locations[0], quantity: "1", idempotencyKey: key() }), forbidden);
  await assert.rejects(catalog.saveCatalog(actor, "products", { name: "Alteração indevida" }, f.productId), forbidden);
  const receiptOrder = await purchases.createPurchase(f.admin, purchaseInput());
  await purchases.receivePurchase(actor, receiptOrder.id, { documentReference: "NF-TEST", items: [{ purchaseOrderItemId: receiptOrder.items[0].id, locationId: f.locations[0], quantity: "5" }], idempotencyKey: key() });
  assert.equal(await booked(), "105.000");
  assert.equal(JSON.stringify(await purchases.getPurchase(actor, receiptOrder.id)).includes('"unitCost"'), false);
});
test("comprador edita fornecedores e preços de compras, sem custo cadastral, recebimento ou estoque", async () => {
  const actor = await actorFor("COMPRADOR");
  await catalog.saveCatalog(actor, "suppliers", { legalName: "Fornecedor atualizado" }, f.supplierId);
  const purchase = await purchases.createPurchase(actor, purchaseInput());
  assert.equal(purchase.items[0].unitCost!.toFixed(2), "13.37");
  assert.equal((await purchases.getPurchase(actor, purchase.id)).items[0].unitCost!.toFixed(2), "13.37");
  const product = redactCosts(await catalog.getCatalog(actor, "products", f.productId), actor);
  assert.equal(JSON.stringify(product).includes('"unitCost"'), false);
  await assert.rejects(costs.listOrderCosts(actor), forbidden);
  await assert.rejects(catalog.saveCatalog(actor, "products", { name: "Alteração indevida" }, f.productId), forbidden);
  await assert.rejects(catalog.archiveCatalog(actor, "suppliers", f.supplierId), forbidden);
  await assert.rejects(purchases.receivePurchase(actor, purchase.id, { documentReference: "NF-TEST", items: [{ purchaseOrderItemId: purchase.items[0].id, locationId: f.locations[0], quantity: "1" }], idempotencyKey: key() }), forbidden);
  await assert.rejects(stock.createMovement(actor, { type: "ENTRY", productId: f.productId, destinationId: f.locations[0], quantity: "1", idempotencyKey: key() }), forbidden);
  await assert.rejects(inventory.createInventoryCount(actor, {}), forbidden);
  await assert.rejects(profiles.prepareAccessProfiles(actor), forbidden);
  assert.equal(await booked(), "100.000");
});
test("conferente registra proposta, mas não aprova, movimenta, compra ou concilia", async () => {
  const actor = await actorFor("CONFERENTE");
  const count = await inventory.createInventoryCount(actor, { locationId: f.locations[0], items: [{ productId: f.productId, expectedQuantity: "100", countedQuantity: "99" }], note: "Contagem conferente", idempotencyKey: key() });
  await assert.rejects(inventory.approveInventoryCount(actor, count.id), forbidden);
  await assert.rejects(stock.createMovement(actor, { type: "ENTRY", productId: f.productId, destinationId: f.locations[0], quantity: "1", idempotencyKey: key() }), forbidden);
  await assert.rejects(purchases.createPurchase(actor, purchaseInput()), forbidden);
  await assert.rejects(reconcile.saveReconciliation(actor, {}), forbidden);
  assert.equal(await booked(), "100.000");
  await inventory.approveInventoryCount(f.admin, count.id); assert.equal(await booked(), "99.000");
});
test("analista salva conferência de conciliação e consulta custos, sem ações operacionais", async () => {
  const actor = await actorFor("ANALISTA_CUSTOS"); const before = await booked();
  const saved = await reconcile.saveReconciliation(actor, { ...stockInput(), idempotencyKey: key() });
  assert.equal(saved.kind, "STOCK"); assert.equal(await booked(), before);
  assert.ok((await costs.listOrderCosts(actor)).criterion);
  assert.equal((await reconcile.listReconciliations(actor)).length, 1);
  await assert.rejects(stock.createMovement(actor, { type: "ENTRY", productId: f.productId, destinationId: f.locations[0], quantity: "1", idempotencyKey: key() }), forbidden);
  await assert.rejects(inventory.createInventoryCount(actor, {}), forbidden);
  await assert.rejects(purchases.createPurchase(actor, purchaseInput()), forbidden);
  await assert.rejects(catalog.saveCatalog(actor, "products", { unitCost: "10" }, f.productId), forbidden);
  await assert.rejects(profiles.prepareAccessProfiles(actor), forbidden);
});
test("auditor consulta ordens, compras, contagens e conferências sem custos nem gravações", async () => {
  const actor = await actorFor("AUDITOR"); const order = await requestedOrder(); const purchase = await purchases.createPurchase(f.admin, purchaseInput());
  const count = await proposal();
  await assert.rejects(costs.listOrderCosts(actor), forbidden);
  await schedules.createInventorySchedule(f.admin, { title: "Conferência teste", locationId: f.locations[0], intervalDays: 7, nextDueAt: new Date().toISOString(), idempotencyKey: key() });
  assert.equal((await inventory.getInventoryCount(actor, count.id)).id, count.id);
  assert.equal((await schedules.listInventorySchedules(actor)).items.length, 1);
  assert.equal((await orders.getOrder(actor, order.id)).id, order.id);
  assert.equal(JSON.stringify(await purchases.getPurchase(actor, purchase.id)).includes('"unitCost"'), false);
  assert.equal((await reconcile.previewReconciliation(actor, stockInput())).kind, "STOCK");
  await assert.rejects(reconcile.saveReconciliation(actor, { ...stockInput(), idempotencyKey: key() }), forbidden);
  await assert.rejects(inventory.createInventoryCount(actor, {}), forbidden);
  await assert.rejects(inventory.approveInventoryCount(actor, count.id), forbidden);
  await assert.rejects(orders.actOnOrder(actor, order.id, { action: "RESERVE", materialId: order.materials[0].id, quantity: "1", idempotencyKey: key() }), forbidden);
  await assert.rejects(catalog.saveCatalog(actor, "suppliers", { legalName: "Indevido" }, f.supplierId), forbidden);
  await assert.rejects(stock.createMovement(actor, { type: "TRANSFER", productId: f.productId, sourceId: f.locations[0], destinationId: f.locations[1], quantity: "1", idempotencyKey: key() }), forbidden);
  assert.equal(await booked(), "100.000"); assert.equal(await db.reconciliationBatch.count({ where: { unitId: f.units[0] } }), 0);
});
test("permissão específica de entrada não autoriza transferência ou retirada por requisição direta", async () => {
  const actor = { ...f.admin, permissions: ["stock:entry"] };
  await stock.createMovement(actor, { type: "ENTRY", productId: f.productId, destinationId: f.locations[0], quantity: "1", idempotencyKey: key() });
  await assert.rejects(stock.createMovement(actor, { type: "TRANSFER", productId: f.productId, sourceId: f.locations[0], destinationId: f.locations[1], quantity: "1", idempotencyKey: key() }), forbidden);
  await assert.rejects(stock.createMovement(actor, { type: "EXIT", purpose: "OTHER", note: "Uso administrativo de teste", receivedByName: "Recebedor teste", receivedByIdentifier: "M-001", productId: f.productId, sourceId: f.locations[0], quantity: "1", idempotencyKey: key() }), forbidden);
  assert.equal(await booked(), "101.000");
});
