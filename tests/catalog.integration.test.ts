import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, afterEach, before, beforeEach, test } from "node:test";
import type { PrismaClient } from "@prisma/client";
import type { SessionUser } from "../src/lib/auth";

const testUrl = process.env.TEST_DATABASE_URL;
if (!testUrl) throw new Error("TEST_DATABASE_URL é obrigatória; a suíte não usa DATABASE_URL.");
const parsed = new URL(testUrl);
const databaseName = decodeURIComponent(parsed.pathname.slice(1));
if (!["postgres:", "postgresql:"].includes(parsed.protocol) || !/(^|[_-])tests?([_-]|$)/i.test(databaseName)) {
  throw new Error("Use um banco PostgreSQL exclusivo cujo nome contenha test.");
}
process.env.DATABASE_URL = testUrl;

let db: PrismaClient;
let catalog: typeof import("../src/services/catalog");
let movement: typeof import("../src/services/stock").createMovement;
let fixture: {
  organizationId: string;
  units: string[];
  roleId: string;
  actor: SessionUser;
  otherActor: SessionUser;
  products: string[];
  warehouses: string[];
  locations: string[];
  categories: string[];
  suppliers: string[];
  foreignImage: string;
};
const status = (expected: number) => (error: unknown) => {
  assert.equal((error as { status?: number }).status, expected);
  return true;
};

before(async () => {
  ({ prisma: db } = await import("../src/lib/db"));
  catalog = await import("../src/services/catalog");
  ({ createMovement: movement } = await import("../src/services/stock"));
  const actual = await db.$queryRaw<Array<{ name: string }>>`SELECT current_database()::text AS name`;
  assert.equal(actual[0]?.name, databaseName);
});

beforeEach(async () => {
  const suffix = randomUUID();
  fixture = await db.$transaction(async (tx) => {
    const organization = await tx.organization.create({ data: { name: `TEST-CATALOG-${suffix}` } });
    const units = await Promise.all(["A", "B"].map(code => tx.operationalUnit.create({ data: { organizationId: organization.id, code: `TEST-CATALOG-${code}-${suffix}`, name: `Unidade ${code} de teste` } })));
    const role = await tx.role.create({ data: { name: `TEST-CATALOG-${suffix}` } });
    const user = await tx.user.create({ data: { name: "Usuário teste isolado", email: `catalog-${suffix}@example.invalid`, authUserId: randomUUID(), roleId: role.id, passwordHash: "disabled-test-only" } });
    await tx.unitMembership.createMany({ data: units.map(unit => ({ userId: user.id, unitId: unit.id, roleId: role.id })) });
    const warehouses = await Promise.all(units.map(unit => tx.warehouse.create({ data: { unitId: unit.id, code: "TEST-ALM", name: "Almoxarifado teste" } })));
    const locations = await Promise.all(units.map((unit, i) => tx.location.create({ data: { unitId: unit.id, warehouseId: warehouses[i].id, code: "TEST-LOCAL", name: "Local teste" } })));
    const categories = await Promise.all(units.map(unit => tx.category.create({ data: { unitId: unit.id, name: "Categoria teste" } })));
    const suppliers = await Promise.all(units.map(unit => tx.supplier.create({ data: { unitId: unit.id, legalName: "Fornecedor de teste", taxId: "TEST-IDENTIFICATION" } })));
    const products = await Promise.all(units.map(unit => tx.product.create({ data: { unitId: unit.id, internalCode: "TEST-MATERIAL", name: "Material teste", unit: "UN" } })));
    const foreignImage = await tx.imageAsset.create({ data: { unitId: units[1].id, userId: user.id, mimeType: "image/png", name: "test.png", data: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]) } });
    const actor = (unit: typeof units[number]): SessionUser => ({ id: user.id, authUserId: user.authUserId!, name: user.name, email: user.email, active: true, unitId: unit.id, organizationId: organization.id, roleId: role.id, role: { id: role.id, name: role.name }, permissions: ["catalog:write", "records:delete", "costs:read", "stock:move"], memberships: units.map(entry => ({ unitId: entry.id, unitName: entry.name, organizationId: organization.id, organizationName: organization.name, roleId: role.id, roleName: role.name })) });
    return { organizationId: organization.id, units: units.map(unit => unit.id), roleId: role.id, actor: actor(units[0]), otherActor: actor(units[1]), products: products.map(row => row.id), warehouses: warehouses.map(row => row.id), locations: locations.map(row => row.id), categories: categories.map(row => row.id), suppliers: suppliers.map(row => row.id), foreignImage: foreignImage.id };
  });
});

afterEach(async () => {
  if (!fixture) return;
  const unitId = { in: fixture.units };
  await db.$transaction(async tx => {
    await tx.auditLog.deleteMany({ where: { unitId } });
    await tx.idempotencyRecord.deleteMany({ where: { unitId } });
    await tx.stockMovement.deleteMany({ where: { unitId } });
    await tx.orderEvent.deleteMany({ where: { unitId } });
    await tx.orderMaterial.deleteMany({ where: { unitId } });
    await tx.workOrder.deleteMany({ where: { unitId } });
    await tx.inventoryBalance.deleteMany({ where: { unitId } });
    await tx.product.deleteMany({ where: { unitId } });
    await tx.category.deleteMany({ where: { unitId } });
    await tx.supplier.deleteMany({ where: { unitId } });
    await tx.location.deleteMany({ where: { unitId } });
    await tx.warehouse.deleteMany({ where: { unitId } });
    await tx.imageAsset.deleteMany({ where: { unitId } });
    await tx.unitMembership.deleteMany({ where: { unitId } });
    await tx.user.delete({ where: { id: fixture.actor.id } });
    await tx.role.delete({ where: { id: fixture.roleId } });
    await tx.operationalUnit.deleteMany({ where: { id: { in: fixture.units } } });
    await tx.organization.delete({ where: { id: fixture.organizationId } });
  });
});
after(async () => { await db?.$disconnect(); });

test("catálogos e IDs isolados entre unidades, incluindo atualização e exclusão lógica", async () => {
  for (const [entity, ids] of Object.entries({ products: fixture.products, categories: fixture.categories, suppliers: fixture.suppliers, warehouses: fixture.warehouses, locations: fixture.locations })) {
    const rows = await catalog.listCatalog(fixture.actor, entity) as Array<{ id: string }>;
    assert.deepEqual(rows.map(row => row.id), [ids[0]]);
    await assert.rejects(catalog.getCatalog(fixture.actor, entity, ids[1]), status(404));
    await assert.rejects(catalog.saveCatalog(fixture.actor, entity, { active: false }, ids[1]));
    await assert.rejects(catalog.archiveCatalog(fixture.actor, entity, ids[1]));
    const other = await catalog.getCatalog(fixture.otherActor, entity, ids[1]) as { active: boolean };
    assert.equal(other.active, true);
  }
});

test("referências de categoria, fornecedor, imagem, almoxarifado e pai não cruzam unidades", async () => {
  for (const data of [{ categoryId: fixture.categories[1] }, { supplierId: fixture.suppliers[1] }, { imageUrl: `/api/files/${fixture.foreignImage}` }]) {
    await assert.rejects(catalog.saveCatalog(fixture.actor, "products", data, fixture.products[0]), status(400));
  }
  await assert.rejects(catalog.saveCatalog(fixture.actor, "locations", { name: "Local teste", code: "NOVO", warehouseId: fixture.warehouses[1] }), status(400));
  await assert.rejects(catalog.saveCatalog(fixture.actor, "locations", { parentId: fixture.locations[1] }, fixture.locations[0]), status(400));
});

test("mesmo código é permitido entre unidades e recusado dentro da mesma unidade", async () => {
  await catalog.saveCatalog(fixture.actor, "products", { internalCode: "NOVO-CODIGO", name: "Novo material teste" });
  await catalog.saveCatalog(fixture.otherActor, "products", { internalCode: "NOVO-CODIGO", name: "Novo material teste" });
  await assert.rejects(catalog.saveCatalog(fixture.actor, "products", { internalCode: "NOVO-CODIGO", name: "Duplicado teste" }), error => (error as { code?: string }).code === "P2002");
});

test("unidade de medida é imutável após entrada e auditoria fica na unidade da operação", async () => {
  await movement(fixture.actor, { type: "ENTRY", productId: fixture.products[0], destinationId: fixture.locations[0], quantity: "2", idempotencyKey: randomUUID() });
  await assert.rejects(catalog.saveCatalog(fixture.actor, "products", { unit: "KG" }, fixture.products[0]), status(409));
  await catalog.saveCatalog(fixture.actor, "products", { notes: "Conferência de catálogo" }, fixture.products[0]);
  const audit = await db.auditLog.findFirstOrThrow({ where: { entity: "products", entityId: fixture.products[0], action: "UPDATE" } });
  assert.equal(audit.unitId, fixture.units[0]);
  assert.equal(audit.userId, fixture.actor.id);
});

test("cadastros com reservas ou aplicação pendente não podem ser arquivados", async () => {
  const order = await db.workOrder.create({ data: { unitId: fixture.units[0], userId: fixture.actor.id, code: `TEST-${randomUUID()}`, title: "Ordem teste", kind: "SERVICE" } });
  await db.orderMaterial.create({ data: { unitId: fixture.units[0], orderId: order.id, productId: fixture.products[0], locationId: fixture.locations[0], requestedQuantity: "1", reservedQuantity: "1" } });
  await assert.rejects(catalog.archiveCatalog(fixture.actor, "products", fixture.products[0]), status(409));
  await assert.rejects(catalog.archiveCatalog(fixture.actor, "locations", fixture.locations[0]), status(409));
});

test("escopo ausente falha fechado e operador não altera catálogo", async () => {
  const missingUnit = { ...fixture.actor, unitId: "" };
  await assert.rejects(catalog.listCatalog(missingUnit, "products"));
  await assert.rejects(catalog.getCatalog(missingUnit, "products", fixture.products[0]));
  await assert.rejects(catalog.saveCatalog(missingUnit, "products", { name: "Inválido" }, fixture.products[0]));
  await assert.rejects(catalog.saveCatalog({ ...fixture.actor, permissions: ["stock:move"] }, "products", { name: "Não autorizado" }, fixture.products[0]), status(403));
});

test("custo não informado permanece nulo e custo zero explícito é preservado", async () => {
  const created = await catalog.saveCatalog(fixture.actor, "products", { internalCode: "SEM-CUSTO", name: "Material de teste sem custo" });
  assert.equal((await db.product.findUniqueOrThrow({ where: { id: created.id } })).unitCost, null);
  await catalog.saveCatalog(fixture.actor, "products", { unitCost: "0" }, created.id);
  assert.equal((await db.product.findUniqueOrThrow({ where: { id: created.id } })).unitCost?.toFixed(2), "0.00");
  await catalog.saveCatalog(fixture.actor, "products", { unitCost: "" }, created.id);
  assert.equal((await db.product.findUniqueOrThrow({ where: { id: created.id } })).unitCost, null);
  await catalog.saveCatalog(fixture.actor, "products", { unitCost: "12.34" }, created.id);
  await catalog.saveCatalog(fixture.actor, "products", { unitCost: null }, created.id);
  assert.equal((await db.product.findUniqueOrThrow({ where: { id: created.id } })).unitCost, null);
});
