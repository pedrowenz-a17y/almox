import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, afterEach, before, beforeEach, test } from "node:test";
import type { PrismaClient } from "@prisma/client";
import { ZodError } from "zod";
import type { StockActor } from "../src/services/stock";
import { buildPurchaseDraft } from "../src/lib/purchase-draft";
let listReplenishment: typeof import("../src/services/replenishment").listReplenishment;
let resolveQr: typeof import("../src/services/qr").resolveQr;

const testUrl = process.env.TEST_DATABASE_URL;
if (!testUrl) throw new Error("Defina TEST_DATABASE_URL para uma base isolada de testes.");
const parsedUrl = new URL(testUrl);
const databaseName = decodeURIComponent(parsedUrl.pathname.slice(1));
if (!["postgres:", "postgresql:"].includes(parsedUrl.protocol) || !/(^|[_-])tests?([_-]|$)/i.test(databaseName))
  throw new Error("A base de integração deve ter test no nome e ser exclusiva de testes.");
process.env.DATABASE_URL = testUrl;
process.env.DIRECT_URL = testUrl;

let db: PrismaClient;
let stock: typeof import("../src/services/stock");
let orders: typeof import("../src/services/orders");
let purchases: typeof import("../src/services/purchases");
let inventories: typeof import("../src/services/inventory");
let fixture: { organizationId: string; roleId: string; userId: string; reviewerId: string; unitIds: string[];
  productIds: string[]; locationIds: string[]; supplierId: string; actor: StockActor; reviewer: StockActor; otherActor: StockActor };
const key = randomUUID;
const permissions = ["stock:move", "inventory:count", "inventory:adjust", "orders:read", "orders:write",
  "orders:apply", "orders:invoice", "purchases:read", "purchases:write", "purchases:receive", "costs:read"];
const status = (expected: number) => (error: unknown) => {
  assert.equal((error as { status?: number }).status, expected);
  return true;
};

before(async () => {
  ({ prisma: db } = await import("../src/lib/db"));
  stock = await import("../src/services/stock");
  orders = await import("../src/services/orders");
  purchases = await import("../src/services/purchases");
  inventories = await import("../src/services/inventory");
  ({ listReplenishment } = await import("../src/services/replenishment"));
  ({ resolveQr } = await import("../src/services/qr"));
  const actual = await db.$queryRaw<Array<{ name: string }>>`SELECT current_database()::text AS name`;
  assert.equal(actual[0].name, databaseName);
});

beforeEach(async () => {
  const suffix = key();
  const organization = await db.organization.create({ data: { name: `TEST-DOMAIN-${suffix}` } });
  const role = await db.role.create({ data: { name: `TEST-DOMAIN-${suffix}` } });
  const user = await db.user.create({ data: { name: "Responsável de teste", email: `${suffix}@example.invalid`, roleId: role.id } });
  const units = await Promise.all(["A", "B"].map(code => db.operationalUnit.create({ data: {
    organizationId: organization.id, code: `TEST-${code}-${suffix}`, name: `Unidade teste ${code}`,
    memberships: { create: { userId: user.id, roleId: role.id } },
  } })));
  const warehouses = await Promise.all(units.map(unit => db.warehouse.create({ data: { unitId: unit.id,
    code: "ALM-TEST", name: "Almoxarifado teste" } })));
  const locations = await Promise.all(warehouses.map((warehouse, index) => db.location.create({ data: {
    unitId: units[index].id, warehouseId: warehouse.id, code: "LOC-TEST", name: "Local de teste",
  } })));
  const products = await Promise.all(units.map(unit => db.product.create({ data: { unitId: unit.id,
    internalCode: "ITEM-TEST", name: "Material exclusivo de teste", unit: "UN" } })));
  const supplier = await db.supplier.create({ data: { unitId: units[0].id, legalName: "Fornecedor de teste" } });
  const reviewer = await db.user.create({ data: { name: "Revisor independente de teste", email: `reviewer-${suffix}@example.invalid`, roleId: role.id,
    memberships: { create: { unitId: units[0].id, roleId: role.id } } } });
  fixture = { organizationId: organization.id, roleId: role.id, userId: user.id, reviewerId: reviewer.id,
    unitIds: units.map(unit => unit.id), productIds: products.map(product => product.id),
    locationIds: locations.map(location => location.id), supplierId: supplier.id,
    actor: { id: user.id, unitId: units[0].id, permissions },
    reviewer: { id: reviewer.id, unitId: units[0].id, permissions },
    otherActor: { id: user.id, unitId: units[1].id, permissions } };
});

afterEach(async () => {
  if (!fixture) return;
  const where = { unitId: { in: fixture.unitIds } };
  await db.$transaction(async tx => {
    await tx.idempotencyRecord.deleteMany({ where });
    await tx.auditLog.deleteMany({ where });
    await tx.stockMovement.deleteMany({ where: { ...where, returnOfId: { not: null } } });
    await tx.stockMovement.deleteMany({ where });
    await tx.orderEvent.deleteMany({ where });
    await tx.orderMaterial.deleteMany({ where });
    await tx.workOrder.deleteMany({ where });
    await tx.receiptItem.deleteMany({ where });
    await tx.receipt.deleteMany({ where });
    await tx.purchaseOrderItem.deleteMany({ where });
    await tx.purchaseOrder.deleteMany({ where });
    await tx.inventoryCountItem.deleteMany({ where: { count: where } });
    await tx.inventoryCount.deleteMany({ where });
    await tx.inventoryBalance.deleteMany({ where });
    await tx.product.deleteMany({ where });
    await tx.supplier.deleteMany({ where });
    await tx.location.deleteMany({ where });
    await tx.warehouse.deleteMany({ where });
    await tx.unitMembership.deleteMany({ where });
    await tx.operationalUnit.deleteMany({ where: { id: { in: fixture.unitIds } } });
    await tx.user.deleteMany({ where: { id: { in: [fixture.userId, fixture.reviewerId] } } });
    await tx.role.delete({ where: { id: fixture.roleId } });
    await tx.organization.delete({ where: { id: fixture.organizationId } });
  });
});
after(async () => { await db?.$disconnect(); });

async function enter(quantity = "100") {
  return stock.createMovement(fixture.actor, { type: "ENTRY", productId: fixture.productIds[0],
    destinationId: fixture.locationIds[0], quantity, idempotencyKey: key() });
}

test("reposição considera reserva, aplicação e recebimento parcial sem expor custos ou outra unidade", async () => {
  await db.product.update({ where: { id: fixture.productIds[0] }, data: { minStock: '100', maxStock: '150', supplierId: fixture.supplierId } });
  await enter('20');
  const order = await orderWithRequest('5');
  await orders.actOnOrder(fixture.actor, order.id, { action: 'RESERVE', materialId: order.materials[0].id, quantity: '5', idempotencyKey: key() });
  await action(order.id, order.materials[0].id, 'APPLY', '2');
  const purchase = await purchases.createPurchase(fixture.actor, { code: `TEST-${key()}`, supplierId: fixture.supplierId,
    items: [{ productId: fixture.productIds[0], quantity: '30' }], idempotencyKey: key() });
  await purchases.receivePurchase(fixture.actor, purchase.id, { documentReference: 'DOC-TEST', items: [
    { purchaseOrderItemId: purchase.items[0].id, locationId: fixture.locationIds[0], quantity: '10' },
  ], idempotencyKey: key() });
  const rows = await listReplenishment({ ...fixture.actor, permissions: ['purchases:read'] });
  const row = rows.find(r => r.productId === fixture.productIds[0])!;
  assert.equal(row.available, '25.000'); assert.equal(row.incoming, '20.000'); assert.equal(row.suggested, '105.000');
  assert.equal(rows.some(r => r.productId === fixture.productIds[1]), false);
  assert.equal(JSON.stringify(rows).includes('unitCost'), false);
  await assert.rejects(listReplenishment({ ...fixture.actor, permissions: [] }), status(403));
});

test("QR resolve produto por URL/código sem cruzar unidades ou interferir no leitor de localizações", async () => {
  const url = `https://erp.example/produto/${fixture.productIds[0]}`;
  const result = await resolveQr(fixture.actor, url, 'https://erp.example', true);
  assert.equal(result.kind, 'product'); assert.equal(result.id, fixture.productIds[0]);
  assert.equal((await resolveQr(fixture.actor, 'ITEM-TEST', 'https://erp.example', true)).id, fixture.productIds[0]);
  assert.equal((await resolveQr(fixture.actor, 'LOC-TEST', 'https://erp.example')).kind, 'location');
  await assert.rejects(resolveQr(fixture.otherActor, url, 'https://erp.example', true), status(404));
  await assert.rejects(resolveQr(fixture.actor, url, 'https://erp.example'), status(400));
  await assert.rejects(resolveQr({ ...fixture.actor, unitId: '' }, url, 'https://erp.example', true), status(403));
});
async function amounts() {
  const result = await stock.availability(db, fixture.productIds[0], fixture.locationIds[0], fixture.unitIds[0]);
  return Object.fromEntries(Object.entries(result).map(([name, value]) => [name, value.toFixed(3)]));
}
async function orderWithRequest(quantity = "30", kind = "SERVICE") {
  const order = await orders.createOrder(fixture.actor, { code: `TEST-${key()}`, title: "Ordem de teste",
    kind, idempotencyKey: key() });
  return orders.actOnOrder(fixture.actor, order.id, { action: "REQUEST", productId: fixture.productIds[0],
    locationId: fixture.locationIds[0], quantity, unit: "UN", idempotencyKey: key() });
}
async function action(orderId: string, materialId: string, action: string, quantity: string, options: Record<string, unknown> = {}) {
  return orders.actOnOrder(fixture.actor, orderId, { action, materialId, quantity,
    note: "Operação de teste", idempotencyKey: key(),
    ...(action === "APPLY" ? { receivedByName: "Recebedor de teste", receivedByIdentifier: "MAT-TEST-1" } : {}),
    ...(action === "RETURN" ? { returnedByName: "Devolvente de teste", returnedByIdentifier: "MAT-TEST-1" } : {}),
    ...options });
}
async function count(expectedQuantity: string, countedQuantity: string) {
  return inventories.createInventoryCount(fixture.actor, { locationId: fixture.locationIds[0],
    items: [{ productId: fixture.productIds[0], expectedQuantity, countedQuantity }],
    note: "Conferência física teste", idempotencyKey: key() });
}
async function purchase(quantity = "100") {
  return purchases.createPurchase(fixture.actor, { code: `TEST-${key()}`, title: "Compra de teste",
    supplierId: fixture.supplierId, items: [{ productId: fixture.productIds[0], quantity, unitCost: "12.50" }], idempotencyKey: key() });
}

test("recebimento parcial e total registra documentos reais e uma entrada por item", async () => {
  const initial = await purchase();
  const receive = (quantity: string, unitCost?: string) => purchases.receivePurchase(fixture.actor, initial.id, {
    documentReference: `DOC-TEST-${quantity}`, items: [{ purchaseOrderItemId: initial.items[0].id,
      locationId: fixture.locationIds[0], quantity, ...(unitCost ? { unitCost } : {}) }], idempotencyKey: key(),
  });
  const partial = await receive("40", "13.25");
  assert.equal(partial.status, "OPEN");
  assert.equal(partial.items[0].receivedQuantity.toFixed(3), "40.000");
  const completed = await receive("60");
  assert.equal(completed.status, "COMPLETED");
  assert.equal((await amounts()).quantity, "100.000");
  assert.equal(completed.receipts[0].items[0].unitCost?.toFixed(2), "13.25");
  assert.equal(completed.receipts[1].items[0].unitCost, null, "Custo da compra não pode virar custo documental implicitamente");
  const movements = await db.stockMovement.findMany({ where: { unitId: fixture.unitIds[0] } });
  assert.equal(movements.length, 2);
  assert.ok(movements.every(movement => movement.receiptItemId && movement.userId === fixture.userId));
  assert.equal(await db.auditLog.count({ where: { unitId: fixture.unitIds[0], action: "RECEIPT_APPROVED" } }), 2);
});

test("recebimento simultâneo com mesma chave só dá uma entrada e não expõe custos ao operador", async () => {
  const initial = await purchase("20");
  const input = { documentReference: "DOC-TEST", items: [{ purchaseOrderItemId: initial.items[0].id,
    locationId: fixture.locationIds[0], quantity: "20" }], idempotencyKey: key() };
  const results = await Promise.all([purchases.receivePurchase(fixture.actor, initial.id, input), purchases.receivePurchase(fixture.actor, initial.id, input)]);
  assert.equal(results[0].id, results[1].id);
  assert.equal((await amounts()).quantity, "20.000");
  assert.equal(await db.receipt.count({ where: { unitId: fixture.unitIds[0] } }), 1);
  const readOnlyCosts = { ...fixture.actor, permissions: fixture.actor.permissions.filter(permission => permission !== "costs:read") };
  const redacted = await purchases.getPurchase(readOnlyCosts, initial.id);
  assert.ok(!("unitCost" in redacted.items[0]));
  assert.ok(!("unitCost" in redacted.receipts[0].items[0]));
});

test("recebimento excedente ou em outra unidade é recusado sem gravar documento parcial", async () => {
  const initial = await purchase("10");
  for (const item of [
    { purchaseOrderItemId: initial.items[0].id, locationId: fixture.locationIds[0], quantity: "11" },
    { purchaseOrderItemId: initial.items[0].id, locationId: fixture.locationIds[1], quantity: "10" },
  ]) await assert.rejects(purchases.receivePurchase(fixture.actor, initial.id, { documentReference: "DOC-TEST",
    items: [item], idempotencyKey: key() }));
  assert.equal(await db.receipt.count({ where: { unitId: fixture.unitIds[0] } }), 0);
  assert.equal((await amounts()).quantity, "0.000");
});

test("O.S.: reserva e aplicação não baixam saldo; faturamento baixa uma única vez", async () => {
  await enter();
  const order = await orderWithRequest();
  const materialId = order.materials[0].id;
  await action(order.id, materialId, "RESERVE", "30");
  await action(order.id, materialId, "APPLY", "20");
  assert.deepEqual(await amounts(), { quantity: "100.000", reserved: "10.000", applied: "20.000", physical: "80.000", available: "70.000" });
  await assert.rejects(orders.actOnOrder(fixture.actor, order.id, { action: "INVOICE", reference: "FAT-TEST", idempotencyKey: key() }), status(409));
  await action(order.id, materialId, "RELEASE", "10");
  const input = { action: "INVOICE", reference: "FAT-TEST", idempotencyKey: key() };
  await assert.rejects(orders.actOnOrder(fixture.actor, order.id, input), status(409));
  assert.equal(await db.stockMovement.count({ where: { workOrderId: order.id, type: "EXIT" } }), 0);
  assert.equal(await db.idempotencyRecord.count({ where: { key: input.idempotencyKey } }), 0);
  assert.equal((await orders.getOrder(fixture.actor, order.id)).status, "OPEN");
  await action(order.id, materialId, "RESERVE", "10");
  await action(order.id, materialId, "APPLY", "10");
  const results = await Promise.all([orders.actOnOrder(fixture.actor, order.id, input), orders.actOnOrder(fixture.actor, order.id, input)]);
  assert.equal(results[0].status, "INVOICED");
  await orders.actOnOrder(fixture.actor, order.id, { ...input, idempotencyKey: key() });
  assert.deepEqual(await amounts(), { quantity: "70.000", reserved: "0.000", applied: "0.000", physical: "70.000", available: "70.000" });
  assert.equal(await db.stockMovement.count({ where: { workOrderId: order.id, type: "EXIT" } }), 1);
  assert.equal(results[0].materials[0].consumedQuantity.toFixed(3), "30.000");
  await assert.rejects(orders.actOnOrder(fixture.actor, order.id, { ...input, reference: "OUTRA-FAT", idempotencyKey: key() }), status(409));
});

test("devolução após faturamento compensa a baixa original e nunca supera consumo", async () => {
  await enter();
  const order = await orderWithRequest("20", "PRODUCTION");
  const materialId = order.materials[0].id;
  await action(order.id, materialId, "RESERVE", "20");
  await action(order.id, materialId, "APPLY", "20");
  await orders.actOnOrder(fixture.actor, order.id, { action: "INVOICE", reference: "FAT-TEST", idempotencyKey: key() });
  const sameKey = key();
  await action(order.id, materialId, "RETURN", "5", { idempotencyKey: sameKey });
  await action(order.id, materialId, "RETURN", "5", { idempotencyKey: sameKey });
  assert.equal((await amounts()).quantity, "85.000");
  const returned = await db.stockMovement.findMany({ where: { workOrderId: order.id, type: "ENTRY" } });
  assert.equal(returned.length, 1);
  assert.ok(returned[0].returnOfId);
  await assert.rejects(action(order.id, materialId, "RETURN", "16"), status(409));
  assert.equal((await amounts()).quantity, "85.000");
});

test("devolução antes do faturamento libera aplicação e cancelamento devolve reservas", async () => {
  await enter();
  const order = await orderWithRequest("30");
  const materialId = order.materials[0].id;
  await action(order.id, materialId, "RESERVE", "30");
  await action(order.id, materialId, "APPLY", "20");
  const cancel = { action: "CANCEL", note: "Ordem cancelada no teste", idempotencyKey: key() };
  await assert.rejects(orders.actOnOrder(fixture.actor, order.id, cancel), status(409));
  await action(order.id, materialId, "RETURN", "20");
  const cancelled = await orders.actOnOrder(fixture.actor, order.id, cancel);
  assert.equal(cancelled.status, "CANCELLED");
  assert.equal((await amounts()).available, "100.000");
  assert.equal(await db.stockMovement.count({ where: { workOrderId: order.id } }), 0);
  assert.ok(cancelled.events.some(event => event.type === "RETURNED_BEFORE_INVOICE"));
});

test("reservas concorrentes não consomem duas vezes a mesma disponibilidade", async () => {
  await enter();
  const first = await orderWithRequest("80");
  const second = await orderWithRequest("80");
  const results = await Promise.allSettled([
    action(first.id, first.materials[0].id, "RESERVE", "80"),
    action(second.id, second.materials[0].id, "RESERVE", "80"),
  ]);
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  assert.equal((await amounts()).available, "20.000");
});

test("aplicação duplicada é idempotente e novas chaves não ultrapassam reserva", async () => {
  await enter();
  const order = await orderWithRequest("20");
  const id = order.materials[0].id;
  await action(order.id, id, "RESERVE", "20");
  const sameKey = key();
  await Promise.all([action(order.id, id, "APPLY", "20", { idempotencyKey: sameKey }),
    action(order.id, id, "APPLY", "20", { idempotencyKey: sameKey })]);
  await assert.rejects(action(order.id, id, "APPLY", "1"), status(409));
  assert.equal((await amounts()).applied, "20.000");
  assert.equal(await db.orderEvent.count({ where: { orderId: order.id, type: "APPLIED" } }), 1);
});

test("saída avulsa e transferência não consomem estoque reservado ou aplicado", async () => {
  await enter();
  const order = await orderWithRequest("80");
  const id = order.materials[0].id;
  await action(order.id, id, "RESERVE", "80");
  await action(order.id, id, "APPLY", "40");
  await assert.rejects(stock.createMovement(fixture.actor, { type: "EXIT", productId: fixture.productIds[0],
    sourceId: fixture.locationIds[0], quantity: "21", purpose: "LOSS", note: "Perda justificada no teste", idempotencyKey: key() }), status(409));
  await assert.rejects(stock.createMovement(fixture.actor, { type: "TRANSFER", productId: fixture.productIds[0],
    sourceId: fixture.locationIds[0], destinationId: fixture.locationIds[1], quantity: "1", idempotencyKey: key() }), status(404));
  assert.equal((await amounts()).quantity, "100.000");
});

test("inventário compara físico sem baixar aplicações e impede ajuste que invalida reservas", async () => {
  await enter();
  const order = await orderWithRequest("30");
  const id = order.materials[0].id;
  await action(order.id, id, "RESERVE", "30");
  await action(order.id, id, "APPLY", "30");
  const proposal = await count("70", "67");
  assert.equal(proposal.items[0].expectedAppliedQuantity.toFixed(3), "30.000");
  await inventories.approveInventoryCount(fixture.reviewer, proposal.id);
  assert.deepEqual(await amounts(), { quantity: "97.000", reserved: "0.000", applied: "30.000", physical: "67.000", available: "67.000" });
  const second = await orderWithRequest("60");
  await action(second.id, second.materials[0].id, "RESERVE", "60");
  const invalid = await count("67", "59");
  await assert.rejects(inventories.approveInventoryCount(fixture.reviewer, invalid.id), status(409));
  assert.equal((await amounts()).quantity, "97.000");
});

test("alterar reserva invalida snapshot do inventário mesmo com mesmo saldo físico", async () => {
  await enter();
  const proposal = await count("100", "99");
  const order = await orderWithRequest("10");
  await action(order.id, order.materials[0].id, "RESERVE", "10");
  await action(order.id, order.materials[0].id, "RELEASE", "10");
  await assert.rejects(inventories.approveInventoryCount(fixture.reviewer, proposal.id), status(409));
});

test("ordens e compras de outra unidade são inacessíveis e identificadores forjados são rejeitados", async () => {
  const order = await orderWithRequest();
  const bought = await purchase();
  await assert.rejects(orders.getOrder(fixture.otherActor, order.id), status(404));
  await assert.rejects(purchases.getPurchase(fixture.otherActor, bought.id), status(404));
  await assert.rejects(orders.actOnOrder(fixture.otherActor, order.id, { action: "CANCEL", note: "Tentativa entre unidades", idempotencyKey: key() }), status(404));
  await assert.rejects(orders.actOnOrder(fixture.actor, order.id, { action: "REQUEST", productId: fixture.productIds[1],
    locationId: fixture.locationIds[0], quantity: "1", idempotencyKey: key() }), status(404));
  await assert.rejects(orders.createOrder(fixture.actor, { code: "INVALID", title: "Ordem inválida", kind: "SERVICE",
    unitId: fixture.unitIds[1], idempotencyKey: key() }), ZodError);
  assert.equal((await orders.listOrders(fixture.otherActor)).total, 0);
  assert.equal((await purchases.listPurchases(fixture.otherActor)).total, 0);
});

test("permissões específicas impedem faturamento, recebimento e leitura não autorizados", async () => {
  const actor = { ...fixture.actor, permissions: ["orders:read", "orders:apply"] };
  const order = await orderWithRequest();
  const bought = await purchase();
  await assert.rejects(orders.actOnOrder(actor, order.id, { action: "INVOICE", reference: "SEM-PERMISSAO", idempotencyKey: key() }), status(403));
  await assert.rejects(purchases.receivePurchase(actor, bought.id, { documentReference: "SEM-PERMISSAO",
    items: [{ purchaseOrderItemId: bought.items[0].id, locationId: fixture.locationIds[0], quantity: "1" }], idempotencyKey: key() }), status(403));
  await assert.rejects(purchases.listPurchases(actor), status(403));
});

test("unidades de medida incompatíveis não são convertidas silenciosamente", async () => {
  const order = await orderWithRequest();
  await assert.rejects(orders.actOnOrder(fixture.actor, order.id, { action: "REQUEST", productId: fixture.productIds[0],
    locationId: fixture.locationIds[0], quantity: "1", unit: "KG", idempotencyKey: key() }), status(400));
  const bought = await purchase();
  await assert.rejects(purchases.receivePurchase(fixture.actor, bought.id, { documentReference: "DOC-TEST",
    items: [{ purchaseOrderItemId: bought.items[0].id, locationId: fixture.locationIds[0], quantity: "1", unit: "CX" }], idempotencyKey: key() }), status(400));
});

test("cancelar compra vazia é auditável e compras recebidas preservam os documentos", async () => {
  const bought = await purchase("10");
  const cancelled = await purchases.cancelPurchase(fixture.actor, bought.id, { note: "Compra cancelada no teste", idempotencyKey: key() });
  assert.equal(cancelled.status, "CANCELLED");
  const second = await purchase("10");
  await purchases.receivePurchase(fixture.actor, second.id, { documentReference: "DOC-TEST", items: [{
    purchaseOrderItemId: second.items[0].id, locationId: fixture.locationIds[0], quantity: "1" }], idempotencyKey: key() });
  await assert.rejects(purchases.cancelPurchase(fixture.actor, second.id, { note: "Cancelamento indevido", idempotencyKey: key() }), status(409));
  assert.equal((await amounts()).quantity, "1.000");
});

test("custos documentais rejeitam precisão inválida e exigem permissão financeira", async () => {
  const bought = await purchase("10");
  const input = { documentReference: "DOC-CUSTO", items: [{ purchaseOrderItemId: bought.items[0].id,
    locationId: fixture.locationIds[0], quantity: "1", unitCost: "1.001" }], idempotencyKey: key() };
  await assert.rejects(purchases.receivePurchase(fixture.actor, bought.id, input), ZodError);
  const withoutCosts = { ...fixture.actor, permissions: fixture.actor.permissions.filter(value => value !== "costs:read") };
  await assert.rejects(purchases.receivePurchase(withoutCosts, bought.id, { ...input,
    items: [{ ...input.items[0], unitCost: "1.01" }] }), status(403));
  assert.equal((await amounts()).quantity, "0.000");
  assert.equal(await db.receipt.count({ where: { purchaseOrderId: bought.id } }), 0);
});

test("falha em um material desfaz toda baixa e faturamento da ordem", async () => {
  await enter();
  const order = await orderWithRequest("10");
  const firstId = order.materials[0].id;
  await action(order.id, firstId, "RESERVE", "10");
  await action(order.id, firstId, "APPLY", "10");
  const product = await db.product.create({ data: { unitId: fixture.unitIds[0], internalCode: `EXTRA-${key()}`,
    name: "Segundo material exclusivo de teste" } });
  await stock.createMovement(fixture.actor, { type: "ENTRY", productId: product.id,
    destinationId: fixture.locationIds[0], quantity: "10", idempotencyKey: key() });
  const withSecond = await orders.actOnOrder(fixture.actor, order.id, { action: "REQUEST", productId: product.id,
    locationId: fixture.locationIds[0], quantity: "10", idempotencyKey: key() });
  const secondId = withSecond.materials.find(item => item.productId === product.id)!.id;
  await action(order.id, secondId, "RESERVE", "10");
  await action(order.id, secondId, "APPLY", "10");
  await db.product.update({ where: { id: product.id }, data: { active: false } });
  const input = { action: "INVOICE", reference: "FAT-COM-FALHA", idempotencyKey: key() };
  await assert.rejects(orders.actOnOrder(fixture.actor, order.id, input), status(409));
  const unchanged = await orders.getOrder(fixture.actor, order.id);
  assert.equal(unchanged.status, "OPEN");
  assert.ok(unchanged.materials.every(item => item.appliedQuantity.eq(10) && item.consumedQuantity.eq(0)));
  assert.equal(await db.stockMovement.count({ where: { workOrderId: order.id } }), 0);
  assert.equal(await db.idempotencyRecord.count({ where: { key: input.idempotencyKey } }), 0);
  assert.equal((await amounts()).quantity, "100.000");
});

test("faturamento exige todos os materiais atendidos mesmo quando não há reserva pendente", async () => {
  await enter();
  const order = await orderWithRequest("10");
  const firstId = order.materials[0].id;
  await action(order.id, firstId, "RESERVE", "10");
  await action(order.id, firstId, "APPLY", "10");
  const product = await db.product.create({ data: { unitId: fixture.unitIds[0], internalCode: `PENDING-${key()}`,
    name: "Material pendente exclusivo de teste" } });
  await stock.createMovement(fixture.actor, { type: "ENTRY", productId: product.id,
    destinationId: fixture.locationIds[0], quantity: "10", idempotencyKey: key() });
  const withPending = await orders.actOnOrder(fixture.actor, order.id, { action: "REQUEST", productId: product.id,
    locationId: fixture.locationIds[0], quantity: "10", idempotencyKey: key() });
  const pendingId = withPending.materials.find(item => item.productId === product.id)!.id;
  const invoice = { action: "INVOICE", reference: "FAT-ATENDIMENTO-INTEGRAL", idempotencyKey: key() };
  await assert.rejects(orders.actOnOrder(fixture.actor, order.id, invoice), error => {
    assert.equal((error as { status?: number }).status, 409);
    assert.match((error as Error).message, /atenda integralmente todos os materiais/);
    return true;
  });
  assert.equal((await orders.getOrder(fixture.actor, order.id)).status, "OPEN");
  assert.equal(await db.stockMovement.count({ where: { workOrderId: order.id } }), 0);
  assert.equal(await db.idempotencyRecord.count({ where: { key: invoice.idempotencyKey } }), 0);
  await action(order.id, pendingId, "RESERVE", "10");
  await action(order.id, pendingId, "APPLY", "10");
  const completed = await orders.actOnOrder(fixture.actor, order.id, invoice);
  await orders.actOnOrder(fixture.actor, order.id, invoice);
  await orders.actOnOrder(fixture.actor, order.id, { ...invoice, idempotencyKey: key() });
  assert.equal(completed.status, "INVOICED");
  assert.ok(completed.materials.every(item => item.consumedQuantity.eq(item.requestedQuantity)));
  assert.equal(await db.stockMovement.count({ where: { workOrderId: order.id, type: "EXIT" } }), 2);
});


test("reposição informa fornecedor inativo e impede usá-lo no preenchimento assistido", async () => {
  await db.product.update({ where: { id: fixture.productIds[0] }, data: {
    minStock: "5", maxStock: "10", supplierId: fixture.supplierId,
  } });
  await db.supplier.update({ where: { id: fixture.supplierId }, data: { active: false } });
  const rows = await listReplenishment(fixture.actor);
  const row = rows.find(item => item.productId === fixture.productIds[0])!;
  assert.equal(row.supplierActive, false);
  assert.throws(() => buildPurchaseDraft(fixture.unitIds[0], rows, [fixture.productIds[0]]), /fornecedor ativo/);
  assert.equal(await db.purchaseOrder.count({ where: { unitId: fixture.unitIds[0] } }), 0);
});

test("aplicação exige recebedor identificado e distingue declaração do operador de confirmação independente", async () => {
  await enter();
  const order = await orderWithRequest("10");
  const materialId = order.materials[0].id;
  await action(order.id, materialId, "RESERVE", "10");
  const input = { action: "APPLY", materialId, quantity: "10", idempotencyKey: key() };
  await assert.rejects(orders.actOnOrder(fixture.actor, order.id, input), ZodError);
  await assert.rejects(orders.actOnOrder(fixture.actor, order.id, { ...input,
    receivedByName: "Funcionário de teste", receivedByIdentifier: "MAT-1", deliveredById: key() }), ZodError);
  assert.equal((await amounts()).applied, "0.000");
  const applied = await action(order.id, materialId, "APPLY", "10", {
    idempotencyKey: input.idempotencyKey, receivedByName: "Funcionário de teste", receivedByIdentifier: "MAT-1",
  });
  const event = applied.events.find(event => event.type === "APPLIED")!;
  assert.deepEqual((event.metadata as Record<string, unknown>).handoff, {
    deliveredById: fixture.userId, deliveredByName: "Responsável de teste",
    receivedByName: "Funcionário de teste", receivedByIdentifier: "MAT-1", confirmation: "DECLARED_BY_OPERATOR",
  });
  await assert.rejects(action(order.id, materialId, "APPLY", "10", {
    idempotencyKey: input.idempotencyKey, receivedByName: "Outra pessoa", receivedByIdentifier: "MAT-2",
  }), status(409));
  assert.equal(await db.stockMovement.count({ where: { workOrderId: order.id } }), 0);
});

test("pedido de devolução não libera material e recebimento parcial exige identificação antes de encerrar a solicitação", async () => {
  await enter();
  const order = await orderWithRequest("10");
  const materialId = order.materials[0].id;
  await action(order.id, materialId, "RESERVE", "10");
  await action(order.id, materialId, "APPLY", "10");
  const before = await amounts();
  const requestKey = key();
  await Promise.all([1, 2].map(() => action(order.id, materialId, "REQUEST_RETURN", "4", { idempotencyKey: requestKey })));
  assert.deepEqual(await amounts(), before);
  assert.equal((await orders.getOrder(fixture.actor, order.id)).materials[0].pendingReturnQuantity.toFixed(3), "4.000");
  await assert.rejects(action(order.id, materialId, "REQUEST_RETURN", "7"), status(409));
  await assert.rejects(orders.actOnOrder(fixture.actor, order.id, {
    action: "INVOICE", reference: "FAT-TEST", idempotencyKey: key(),
  }), status(409));
  await assert.rejects(orders.actOnOrder(fixture.actor, order.id, {
    action: "RETURN", materialId, quantity: "2", note: "Retorno sem identificação", idempotencyKey: key(),
  }), ZodError);
  const receiptKey = key();
  const partial = await action(order.id, materialId, "RETURN", "2", { idempotencyKey: receiptKey });
  await action(order.id, materialId, "RETURN", "2", { idempotencyKey: receiptKey });
  assert.equal(partial.materials[0].pendingReturnQuantity.toFixed(3), "2.000");
  assert.equal((await amounts()).quantity, "100.000");
  assert.equal((await amounts()).physical, "92.000");
  const receipt = partial.events.find(event => event.type === "RETURNED_BEFORE_INVOICE")!;
  assert.deepEqual((receipt.metadata as Record<string, unknown>).returnReceipt, {
    receivedById: fixture.userId, receivedByName: "Responsável de teste", returnedByName: "Devolvente de teste",
    returnedByIdentifier: "MAT-TEST-1", confirmation: "DECLARED_BY_OPERATOR",
  });
  const completed = await action(order.id, materialId, "RETURN", "2");
  assert.equal(completed.materials[0].pendingReturnQuantity.toFixed(3), "0.000");
  await action(order.id, materialId, "REDUCE_REQUEST", "4");
  await orders.actOnOrder(fixture.actor, order.id, { action: "INVOICE", reference: "FAT-TEST", idempotencyKey: key() });
  assert.equal((await amounts()).quantity, "94.000");
  assert.equal(await db.stockMovement.count({ where: { workOrderId: order.id, type: "EXIT" } }), 1);
});

test("redução de requisição só encerra saldo descomprometido e exige justificativa", async () => {
  await enter();
  const order = await orderWithRequest("10");
  const materialId = order.materials[0].id;
  await action(order.id, materialId, "RESERVE", "8");
  await assert.rejects(action(order.id, materialId, "REDUCE_REQUEST", "3"), status(409));
  await assert.rejects(action(order.id, materialId, "REDUCE_REQUEST", "2", { note: "curto" }), ZodError);
  const reduced = await action(order.id, materialId, "REDUCE_REQUEST", "2");
  assert.equal(reduced.materials[0].requestedQuantity.toFixed(3), "8.000");
  await assert.rejects(action(order.id, materialId, "REDUCE_REQUEST", "1"), status(409));
  assert.equal((await amounts()).reserved, "8.000");
  assert.equal((await amounts()).quantity, "100.000");
  assert.ok(reduced.events.some(event => event.type === "REQUEST_REDUCED" && event.quantity?.eq(2)));
});

test("devolução solicitada após faturamento só repõe saldo quando o operador recebe fisicamente", async () => {
  await enter();
  const order = await orderWithRequest("10");
  const materialId = order.materials[0].id;
  await action(order.id, materialId, "RESERVE", "10");
  await action(order.id, materialId, "APPLY", "10");
  await orders.actOnOrder(fixture.actor, order.id, { action: "INVOICE", reference: "FAT-TEST", idempotencyKey: key() });
  const requested = await action(order.id, materialId, "REQUEST_RETURN", "3");
  assert.equal(requested.materials[0].pendingReturnQuantity.toFixed(3), "3.000");
  assert.equal((await amounts()).quantity, "90.000");
  const keyOfReceipt = key();
  await Promise.all([1, 2].map(() => action(order.id, materialId, "RETURN", "4", { idempotencyKey: keyOfReceipt })));
  const returned = await orders.getOrder(fixture.actor, order.id);
  assert.equal(returned.materials[0].pendingReturnQuantity.toFixed(3), "0.000");
  assert.equal(returned.materials[0].returnedQuantity.toFixed(3), "4.000");
  assert.equal((await amounts()).quantity, "94.000");
  assert.equal(await db.stockMovement.count({ where: { workOrderId: order.id, type: "ENTRY" } }), 1);
  await assert.rejects(action(order.id, materialId, "REQUEST_RETURN", "7"), status(409));
});

test("faturamento congela estimativa cadastral e não expõe custo em consultas ou mutações sem permissão", async () => {
  await db.product.update({ where: { id: fixture.productIds[0] }, data: { unitCost: "12.34" } });
  await enter();
  const order = await orderWithRequest("10");
  const materialId = order.materials[0].id;
  await action(order.id, materialId, "RESERVE", "10");
  await action(order.id, materialId, "APPLY", "10");
  const invoice = { action: "INVOICE", reference: "FAT-TEST", idempotencyKey: key() };
  const operator = { ...fixture.actor, permissions: fixture.actor.permissions.filter(permission => permission !== "costs:read") };
  const result = await orders.actOnOrder(operator, order.id, invoice);
  assert.ok(!("invoicedUnitCost" in result.materials[0]));
  assert.equal((await orders.getOrder(fixture.actor, order.id)).materials[0].invoicedUnitCost?.toFixed(2), "12.34");
  await db.product.update({ where: { id: fixture.productIds[0] }, data: { unitCost: "99.99" } });
  await action(order.id, materialId, "RETURN", "2");
  assert.equal((await orders.getOrder(fixture.actor, order.id)).materials[0].invoicedUnitCost?.toFixed(2), "12.34");
  assert.equal(JSON.stringify(await orders.getOrder(operator, order.id)).includes("invoicedUnitCost"), false);
  assert.equal(JSON.stringify(await orders.listOrders(operator)).includes("invoicedUnitCost"), false);
  assert.equal(JSON.stringify(await orders.actOnOrder(operator, order.id, invoice)).includes("invoicedUnitCost"), false);
});

test("custo ausente continua desconhecido no faturamento e ordens antigas não recebem estimativa retroativa", async () => {
  await enter();
  const order = await orderWithRequest("2");
  const materialId = order.materials[0].id;
  assert.equal(order.materials[0].invoicedUnitCost, null);
  await action(order.id, materialId, "RESERVE", "2");
  await action(order.id, materialId, "APPLY", "2");
  const invoiced = await orders.actOnOrder(fixture.actor, order.id, {
    action: "INVOICE", reference: "FAT-SEM-CUSTO", idempotencyKey: key(),
  });
  assert.equal(invoiced.materials[0].invoicedUnitCost, null);
});

test("saída manual exige exceção justificada; aplicação produtiva segue pela ordem e destinatário integra idempotência", async () => {
  await enter();
  const base = { type: "EXIT", productId: fixture.productIds[0], sourceId: fixture.locationIds[0],
    quantity: "3", note: "Material destinado à manutenção interna", idempotencyKey: key() };
  for (const fields of [{}, { purpose: "PRODUCTIVE" }, { purpose: "OTHER" }, { purpose: "LOSS", note: "curto" }])
    await assert.rejects(stock.createMovement(fixture.actor, { ...base, ...fields }), ZodError);
  assert.equal((await amounts()).quantity, "100.000");
  const input = { ...base, purpose: "OTHER", receivedByName: "Funcionário de teste", receivedByIdentifier: "MAT-1" };
  const movement = await stock.createMovement(fixture.actor, input);
  await stock.createMovement(fixture.actor, input);
  const audit = await db.auditLog.findFirstOrThrow({ where: { entityId: movement.id, action: "EXIT" } });
  assert.equal((audit.after as Record<string, unknown>).purpose, "OTHER");
  assert.deepEqual((audit.after as Record<string, unknown>).handoff, {
    deliveredById: fixture.userId, deliveredByName: "Responsável de teste", receivedByName: "Funcionário de teste",
    receivedByIdentifier: "MAT-1", confirmation: "DECLARED_BY_OPERATOR",
  });
  await assert.rejects(stock.createMovement(fixture.actor, { ...input, receivedByIdentifier: "MAT-2" }), status(409));
  assert.equal((await amounts()).quantity, "97.000");
  await stock.createMovement(fixture.actor, { ...base, purpose: "LOSS", note: "Perda de material identificada em conferência", idempotencyKey: key() });
  assert.equal((await amounts()).quantity, "94.000");
});

test("cancelar pedido incorreto de devolução é auditável e não simula entrada física", async () => {
  await enter();
  const order = await orderWithRequest("10");
  const materialId = order.materials[0].id;
  await action(order.id, materialId, "RESERVE", "10");
  await action(order.id, materialId, "APPLY", "10");
  await action(order.id, materialId, "REQUEST_RETURN", "3");
  const before = await amounts();
  const balanceBefore = await db.inventoryBalance.findUniqueOrThrow({ where: {
    productId_locationId: { productId: fixture.productIds[0], locationId: fixture.locationIds[0] },
  } });
  await assert.rejects(action(order.id, materialId, "CANCEL_RETURN", "4"), status(409));
  await assert.rejects(action(order.id, materialId, "CANCEL_RETURN", "1", { note: "curto" }), ZodError);
  const operator = { ...fixture.actor, permissions: ["orders:read", "orders:apply"] };
  const cancelKey = key();
  const cancel = { action: "CANCEL_RETURN", materialId, quantity: "3", note: "Solicitação aberta por engano", idempotencyKey: cancelKey };
  await Promise.all([1, 2].map(() => orders.actOnOrder(operator, order.id, cancel)));
  const completed = await orders.getOrder(fixture.actor, order.id);
  assert.equal(completed.materials[0].pendingReturnQuantity.toFixed(3), "0.000");
  assert.equal(completed.materials[0].appliedQuantity.toFixed(3), "10.000");
  assert.equal(completed.events.filter(event => event.type === "RETURN_REQUEST_CANCELLED").length, 1);
  assert.deepEqual(await amounts(), before);
  const balanceAfter = await db.inventoryBalance.findUniqueOrThrow({ where: { id: balanceBefore.id } });
  assert.equal(balanceAfter.version, balanceBefore.version);
  assert.equal(await db.stockMovement.count({ where: { workOrderId: order.id } }), 0);
  await orders.actOnOrder(fixture.actor, order.id, { action: "INVOICE", reference: "FAT-TEST", idempotencyKey: key() });
  await action(order.id, materialId, "REQUEST_RETURN", "1");
  await action(order.id, materialId, "CANCEL_RETURN", "1");
  assert.equal((await amounts()).quantity, "90.000");
});

test("perda exige aprovação de ajuste além da permissão operacional e não baixa saldo quando recusada", async () => {
  await enter();
  const operator = { ...fixture.actor, permissions: ["stock:move"] };
  const input = { type: "EXIT", purpose: "LOSS", productId: fixture.productIds[0], sourceId: fixture.locationIds[0],
    quantity: "2", note: "Perda identificada em conferência física", idempotencyKey: key() };
  await assert.rejects(stock.createMovement(operator, input), status(403));
  assert.equal((await amounts()).quantity, "100.000");
  assert.equal(await db.idempotencyRecord.count({ where: { key: input.idempotencyKey } }), 0);
  await stock.createMovement(fixture.actor, input);
  assert.equal((await amounts()).quantity, "98.000");
});
