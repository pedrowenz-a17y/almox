import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, afterEach, before, beforeEach, test } from "node:test";
import type { Prisma, PrismaClient } from "@prisma/client";
import type { StockActor } from "../src/services/stock";

const testUrl = process.env.TEST_DATABASE_URL;
if (!testUrl)
  throw new Error("Defina TEST_DATABASE_URL para uma base isolada de testes.");
const parsedUrl = new URL(testUrl);
const databaseName = decodeURIComponent(parsedUrl.pathname.slice(1));
if (
  !["postgres:", "postgresql:"].includes(parsedUrl.protocol) ||
  !/(^|[_-])tests?([_-]|$)/i.test(databaseName)
) {
  throw new Error(
    "A base de integração deve ter test no nome e ser exclusiva de testes.",
  );
}
process.env.DATABASE_URL = testUrl;
process.env.DIRECT_URL = testUrl;
let db: PrismaClient;
let fixture: {
  organizationId: string;
  roleId: string;
  userId: string;
  unitIds: string[];
  locationIds: string[];
  productIds: string[];
  actor: StockActor;
};
before(async () => {
  ({ prisma: db } = await import("../src/lib/db"));
  const actual = await db.$queryRaw<
    Array<{ name: string }>
  >`SELECT current_database()::text AS name`;
  assert.equal(actual[0].name, databaseName);
});
beforeEach(async () => {
  const suffix = randomUUID();
  const organization = await db.organization.create({
    data: { name: `TEST-PENDING-${suffix}` },
  });
  const role = await db.role.create({
    data: { name: `TEST-PENDING-${suffix}` },
  });
  for (const key of [
    "orders:read",
    "inventory:count",
    "inventory:read",
    "orders:apply",
    "orders:invoice",
    "inventory:adjust",
  ]) {
    const permission = await db.permission.upsert({
      where: { key },
      create: { key },
      update: {},
    });
    await db.rolePermission.create({
      data: { roleId: role.id, permissionId: permission.id },
    });
  }
  const user = await db.user.create({
    data: {
      name: "Responsável de teste",
      email: `${suffix}@example.invalid`,
      roleId: role.id,
    },
  });
  const units = await Promise.all(
    ["A", "B"].map((code) =>
      db.operationalUnit.create({
        data: {
          organizationId: organization.id,
          code: `TEST-PENDING-${code}-${suffix}`,
          name: `Unidade de teste ${code}`,
          memberships: { create: { userId: user.id, roleId: role.id } },
        },
      }),
    ),
  );
  const warehouses = await Promise.all(
    units.map((unit) =>
      db.warehouse.create({
        data: { unitId: unit.id, code: "ALM-PENDING", name: "Almoxarifado" },
      }),
    ),
  );
  const locations = await Promise.all(
    warehouses.map((warehouse, index) =>
      db.location.create({
        data: {
          unitId: units[index].id,
          warehouseId: warehouse.id,
          code: "LOC-PENDING",
          name: "Local de teste",
        },
      }),
    ),
  );
  const products = await Promise.all(
    units.map((unit) =>
      db.product.create({
        data: {
          unitId: unit.id,
          internalCode: "ITEM-PENDING",
          name: "Material de teste",
          unit: "UN",
          unitCost: "9213.47",
        },
      }),
    ),
  );
  fixture = {
    organizationId: organization.id,
    roleId: role.id,
    userId: user.id,
    unitIds: units.map((unit) => unit.id),
    productIds: products.map((product) => product.id),
    locationIds: locations.map((location) => location.id),
    actor: {
      id: user.id,
      unitId: units[0].id,
      permissions: ["orders:read", "inventory:count"],
    },
  };
});
afterEach(async () => {
  if (!fixture) return;
  const where = { unitId: { in: fixture.unitIds } };
  await db.$transaction(async (tx) => {
    await tx.idempotencyRecord.deleteMany({ where });
    await tx.auditLog.deleteMany({ where });
    await tx.pendingAssignment.deleteMany({ where });
    await tx.inventorySchedule.updateMany({
      where,
      data: { lastCountId: null },
    });
    await tx.inventoryCount.deleteMany({ where });
    await tx.inventorySchedule.deleteMany({ where });
    await tx.orderEvent.deleteMany({ where });
    await tx.orderMaterial.deleteMany({ where });
    await tx.workOrder.deleteMany({ where });
    await tx.product.deleteMany({ where });
    await tx.location.deleteMany({ where });
    await tx.warehouse.deleteMany({ where });
    await tx.unitMembership.deleteMany({ where });
    await tx.operationalUnit.deleteMany({
      where: { id: { in: fixture.unitIds } },
    });
    await tx.user.deleteMany({ where: { roleId: fixture.roleId } });
    await tx.role.delete({ where: { id: fixture.roleId } });
    await tx.organization.delete({ where: { id: fixture.organizationId } });
  });
});
after(async () => {
  await db?.$disconnect();
});

async function createOrder(index = 0, invoiced = false) {
  const order = await db.workOrder.create({
    data: {
      unitId: fixture.unitIds[index],
      userId: fixture.userId,
      code: `ORDER-${randomUUID()}`,
      title: index ? "Destino secreto outra unidade" : "Aplicação de materiais",
      kind: "PRODUCTION",
      status: invoiced ? "INVOICED" : "OPEN",
      ...(invoiced
        ? { invoiceReference: "NF-TEST", invoicedAt: new Date() }
        : {}),
      materials: {
        create: {
          unitId: fixture.unitIds[index],
          productId: fixture.productIds[index],
          locationId: fixture.locationIds[index],
          requestedQuantity: invoiced ? "4" : "10",
          reservedQuantity: invoiced ? "0" : "2",
          appliedQuantity: invoiced ? "0" : "3",
          consumedQuantity: invoiced ? "4" : "0",
          returnedQuantity: invoiced ? "1" : "0",
          pendingReturnQuantity: invoiced ? "2" : "1",
        },
      },
    },
    include: { materials: true },
  });
  return order;
}
async function createInventory(index = 0) {
  const base = {
    unitId: fixture.unitIds[index],
    locationId: fixture.locationIds[index],
    createdById: fixture.userId,
    title: "Conferência semanal",
    intervalDays: 7,
  };
  await db.inventorySchedule.create({
    data: { ...base, nextDueAt: new Date("2020-01-01T00:00:00Z") },
  });
  await db.inventorySchedule.create({
    data: { ...base, nextDueAt: new Date("2090-01-01T00:00:00Z") },
  });
  await db.inventorySchedule.create({
    data: {
      ...base,
      nextDueAt: new Date("2020-01-01T00:00:00Z"),
      active: false,
    },
  });
  await db.inventoryCount.create({
    data: {
      unitId: fixture.unitIds[index],
      locationId: fixture.locationIds[index],
      userId: fixture.userId,
      note: "Contagem de teste",
      status: "PENDING",
    },
  });
}

const alerts = () => import("../src/services/operational-alerts");
const key = randomUUID;
async function queue() {
  return (await alerts()).listOperationalAlerts(fixture.actor, {});
}
async function receipt(
  item: Awaited<ReturnType<typeof queue>>["items"][number],
) {
  return { pendingId: item.id, alertKey: item.alertKey, idempotencyKey: key() };
}
async function otherPerson() {
  const user = await db.user.create({
    data: {
      name: "Outra pessoa",
      email: `${key()}@example.invalid`,
      roleId: fixture.roleId,
      memberships: {
        create: { unitId: fixture.unitIds[0], roleId: fixture.roleId },
      },
    },
  });
  return { ...fixture.actor, id: user.id };
}

test("central parte da fila real e não expõe custos, outra unidade ou responsáveis inventados", async () => {
  await createOrder();
  await createOrder(1);
  await createInventory();
  const page = await queue();
  assert.equal(page.items.length, 6);
  assert.equal(page.summary.unread, 6);
  assert.equal(page.summary.read, 0);
  assert.equal(page.summary.dueToday, 0);
  assert.ok(page.items.every((item) => /^[a-f0-9]{64}$/.test(item.alertKey)));
  assert.ok(page.items.every((item) => item.readAt === null));
  assert.equal(JSON.stringify(page).includes("9213.47"), false);
  assert.equal(JSON.stringify(page).includes("Destino secreto"), false);
  await assert.rejects(
    (await alerts()).listOperationalAlerts(
      { ...fixture.actor, permissions: [] },
      {},
    ),
    (error) => {
      assert.equal((error as { status: number }).status, 403);
      return true;
    },
  );
});

test("leitura é individual, idempotente e não executa a operação", async () => {
  const order = await createOrder();
  const item = (await queue()).items.find((item) => item.type === "RETURN")!;
  const input = await receipt(item);
  const service = await alerts();
  const first = await service.markOperationalAlertRead(fixture.actor, input);
  const again = await service.markOperationalAlertRead(fixture.actor, input);
  assert.deepEqual(first, again);
  await Promise.all(
    [1, 2].map(() =>
      service.markOperationalAlertRead(fixture.actor, {
        ...input,
        idempotencyKey: key(),
      }),
    ),
  );
  assert.equal(
    await db.auditLog.count({
      where: { unitId: fixture.unitIds[0], entity: "OperationalAlert" },
    }),
    1,
  );
  const mine = await queue();
  assert.equal(mine.summary.read, 1);
  assert.equal(mine.summary.unread, 3);
  const readOnly = await service.listOperationalAlerts(fixture.actor, {
    read: "READ",
  });
  assert.equal(readOnly.total, 1);
  assert.equal(readOnly.items[0].id, item.id);
  const unreadOnly = await service.listOperationalAlerts(fixture.actor, {
    read: "UNREAD",
  });
  assert.equal(unreadOnly.total, 3);
  assert.ok(unreadOnly.items.every((entry) => entry.id !== item.id));
  assert.equal(unreadOnly.summary.read, 1);
  const other = await service.listOperationalAlerts(await otherPerson(), {});
  assert.equal(other.summary.read, 0);
  assert.equal(other.summary.unread, 4);
  assert.equal(
    (
      await db.orderMaterial.findUniqueOrThrow({
        where: { id: order.materials[0].id },
      })
    ).pendingReturnQuantity.toFixed(3),
    "1.000",
  );
  const { unitAuditScope } = await import("../src/lib/audit-scope");
  assert.equal(
    await db.auditLog.count({
      where: unitAuditScope(fixture.unitIds[0], ["reports:read", "costs:read"]),
    }),
    0,
  );
});

test("agenda reprogramada ou desativada não equivale a ciclo aprovado", async () => {
  await createInventory();
  const service = await alerts();
  const item = (await queue()).items.find((item) => item.type === "SCHEDULE")!;
  const scheduleId = item.id.split(":")[0];
  await service.markOperationalAlertRead(fixture.actor, await receipt(item));
  await db.inventorySchedule.update({
    where: { id: scheduleId },
    data: { nextDueAt: new Date("2090-01-01T00:00:00Z") },
  });
  assert.equal(
    (await service.operationalAlertHistory(fixture.actor)).items[0].status,
    "UPDATED",
  );
  await db.inventorySchedule.update({
    where: { id: scheduleId },
    data: { active: false },
  });
  assert.equal(
    (await service.operationalAlertHistory(fixture.actor)).items[0].status,
    "CLOSED",
  );
  const count = await db.inventoryCount.create({
    data: {
      unitId: fixture.unitIds[0],
      locationId: fixture.locationIds[0],
      userId: fixture.userId,
      status: "APPROVED",
      note: "Estado de origem simulado para conferir o histórico da agenda",
      scheduleId,
      scheduleDueAt: new Date("2019-12-01T00:00:00Z"),
    },
  });
  await db.inventorySchedule.update({
    where: { id: scheduleId },
    data: { active: true, lastCountId: count.id },
  });
  assert.equal(
    (await service.operationalAlertHistory(fixture.actor)).items[0].status,
    "UPDATED",
  );
  await db.inventoryCount.update({
    where: { id: count.id },
    data: { scheduleDueAt: new Date(item.dueAt!) },
  });
  assert.equal(
    (await service.operationalAlertHistory(fixture.actor)).items[0].status,
    "REGULARIZED",
  );
  await db.inventorySchedule.update({
    where: { id: scheduleId },
    data: { lastCountId: null },
  });
  assert.equal(
    (await service.operationalAlertHistory(fixture.actor)).items[0].status,
    "REGULARIZED",
  );
});

test("paginação de não lidos seleciona o filtro antes do limite e preserva total da unidade", async () => {
  for (let index = 0; index < 8; index++) await createOrder();
  const service = await alerts();
  const firstPage = await service.listOperationalAlerts(fixture.actor, {});
  assert.equal(firstPage.total, 32);
  assert.equal(firstPage.items.length, 25);
  const reads = firstPage.items.slice(0, 3);
  for (const item of reads)
    await service.markOperationalAlertRead(fixture.actor, await receipt(item));
  const page = await service.listOperationalAlerts(fixture.actor, {
    read: "UNREAD",
    page: 1,
  });
  const second = await service.listOperationalAlerts(fixture.actor, {
    read: "UNREAD",
    page: 2,
  });
  assert.equal(page.total, 29);
  assert.equal(page.items.length, 25);
  assert.equal(second.items.length, 4);
  assert.equal(page.summary.read, 3);
  assert.equal(
    new Set([...page.items, ...second.items].map((item) => item.id)).size,
    29,
  );
  assert.ok(
    [...page.items, ...second.items].every(
      (item) => !reads.some((read) => read.id === item.id),
    ),
  );
});

test("chave antiga após mudança de quantidade não marca o aviso novo como lido", async () => {
  const order = await createOrder();
  const item = (await queue()).items.find((item) => item.type === "RETURN")!;
  await (
    await alerts()
  ).markOperationalAlertRead(fixture.actor, await receipt(item));
  await db.orderMaterial.update({
    where: { id: order.materials[0].id },
    data: { pendingReturnQuantity: "2" },
  });
  const next = (await queue()).items.find((item) => item.type === "RETURN")!;
  assert.notEqual(next.alertKey, item.alertKey);
  assert.equal(next.readAt, null);
  await assert.rejects(
    (await alerts()).markOperationalAlertRead(
      fixture.actor,
      await receipt(item),
    ),
    (error) => {
      assert.equal((error as { code: string }).code, "ALERT_CHANGED");
      return true;
    },
  );
  assert.equal(
    (await (await alerts()).operationalAlertHistory(fixture.actor)).items[0]
      .status,
    "UPDATED",
  );
});

test("responsável, prazo e passagem para hoje/atraso renovam a identidade do aviso", async () => {
  await createOrder();
  const item = (await queue()).items.find((item) => item.type === "RETURN")!;
  await (
    await alerts()
  ).markOperationalAlertRead(fixture.actor, await receipt(item));
  const person = await otherPerson();
  await db.pendingAssignment.create({
    data: {
      unitId: fixture.unitIds[0],
      itemKey: item.id,
      occurrenceKey: item.occurrenceKey,
      assigneeId: person.id,
      managedById: fixture.userId,
      dueAt: new Date("2026-11-17T18:00:00Z"),
      note: "Prazo de teste",
    },
  });
  const { pendingSnapshot } = await import(
    "../src/services/operational-pending"
  );
  const at = async (now: string) =>
    await pendingSnapshot(fixture.actor, { pageSize: 1 }, db, {
      id: item.id,
      now: new Date(now),
      alerts: { read: "ALL" },
    });
  const future = await at("2026-11-16T12:00:00Z"),
    today = await at("2026-11-17T12:00:00Z"),
    late = await at("2026-11-17T19:00:00Z");
  assert.notEqual(future.items[0].alertKey, item.alertKey);
  assert.notEqual(future.items[0].alertKey, today.items[0].alertKey);
  assert.notEqual(today.items[0].alertKey, late.items[0].alertKey);
  assert.equal(today.alertSummary?.dueToday, 1);
  assert.equal(late.items[0].overdue, true);
});

test("faturamento confirmado regulariza; cancelar a ordem apenas encerra", async () => {
  const order = await createOrder();
  const service = await alerts();
  const item = (await queue()).items.find(
    (item) => item.type === "AWAITING_INVOICE",
  )!;
  await service.markOperationalAlertRead(fixture.actor, await receipt(item));
  await db.orderMaterial.update({
    where: { id: order.materials[0].id },
    data: {
      reservedQuantity: "0",
      appliedQuantity: "0",
      consumedQuantity: "3",
    },
  });
  await db.workOrder.update({
    where: { id: order.id },
    data: {
      status: "INVOICED",
      invoicedAt: new Date(),
      invoiceReference: "NF-TEST",
    },
  });
  assert.equal(
    (await service.operationalAlertHistory(fixture.actor)).items[0].status,
    "REGULARIZED",
  );
  const another = await createOrder();
  const second = (await queue()).items.find(
    (item) => item.orderId === another.id && item.type === "UNAPPLIED",
  )!;
  await service.markOperationalAlertRead(fixture.actor, await receipt(second));
  await db.workOrder.update({
    where: { id: another.id },
    data: { status: "CANCELLED" },
  });
  assert.equal(
    (await service.operationalAlertHistory(fixture.actor)).items.find(
      (entry) => entry.item.orderId === another.id,
    )?.status,
    "CLOSED",
  );
});

test("cancelamento de devolução não é recebimento; novo ciclo tem leitura própria", async () => {
  const order = await createOrder(0, true);
  const service = await alerts();
  const first = (await queue()).items.find((item) => item.type === "RETURN")!;
  await service.markOperationalAlertRead(fixture.actor, await receipt(first));
  await db.orderMaterial.update({
    where: { id: order.materials[0].id },
    data: { pendingReturnQuantity: "0" },
  });
  await db.orderEvent.create({
    data: {
      unitId: fixture.unitIds[0],
      orderId: order.id,
      materialId: order.materials[0].id,
      userId: fixture.userId,
      type: "RETURN_REQUEST_CANCELLED",
    },
  });
  assert.equal(
    (await service.operationalAlertHistory(fixture.actor)).items[0].status,
    "CLOSED",
  );
  await db.orderMaterial.update({
    where: { id: order.materials[0].id },
    data: { pendingReturnQuantity: "2" },
  });
  await db.orderEvent.create({
    data: {
      unitId: fixture.unitIds[0],
      orderId: order.id,
      materialId: order.materials[0].id,
      userId: fixture.userId,
      type: "RETURN_REQUESTED",
      metadata: { pendingOpened: ["RETURN"] },
    },
  });
  const next = (await queue()).items.find((item) => item.type === "RETURN")!;
  assert.notEqual(next.occurrenceKey, first.occurrenceKey);
  assert.equal(next.readAt, null);
  await service.markOperationalAlertRead(fixture.actor, await receipt(next));
  await db.orderMaterial.update({
    where: { id: order.materials[0].id },
    data: { pendingReturnQuantity: "0", returnedQuantity: "3" },
  });
  await db.orderEvent.create({
    data: {
      unitId: fixture.unitIds[0],
      orderId: order.id,
      materialId: order.materials[0].id,
      userId: fixture.userId,
      type: "RETURNED_AFTER_INVOICE",
    },
  });
  const history = (await service.operationalAlertHistory(fixture.actor)).items;
  assert.equal(
    history.find((entry) => entry.item.occurrenceKey === first.occurrenceKey)
      ?.status,
    "CLOSED",
  );
  assert.equal(
    history.find((entry) => entry.item.occurrenceKey === next.occurrenceKey)
      ?.status,
    "REGULARIZED",
  );
});

test("contagem aprovada e contagem encerrada têm estados distintos; origem removida fica indisponível", async () => {
  await createInventory();
  const service = await alerts();
  const item = (await queue()).items.find((item) => item.type === "COUNT")!;
  await service.markOperationalAlertRead(fixture.actor, await receipt(item));
  await db.inventoryCount.update({
    where: { id: item.id.split(":")[0] },
    data: { status: "REJECTED" },
  });
  assert.equal(
    (await service.operationalAlertHistory(fixture.actor)).items[0].status,
    "CLOSED",
  );
  await db.inventoryCount.update({
    where: { id: item.id.split(":")[0] },
    data: { status: "APPROVED", approvedAt: new Date() },
  });
  assert.equal(
    (await service.operationalAlertHistory(fixture.actor)).items[0].status,
    "REGULARIZED",
  );
  await db.inventoryCount.delete({ where: { id: item.id.split(":")[0] } });
  assert.equal(
    (await service.operationalAlertHistory(fixture.actor)).items[0].status,
    "UNAVAILABLE",
  );
});

test("histórico e leituras não atravessam unidade nem área com permissão revogada", async () => {
  await createOrder();
  const item = (await queue()).items.find((item) => item.type === "RETURN")!;
  const input = await receipt(item);
  const service = await alerts();
  await service.markOperationalAlertRead(fixture.actor, input);
  const otherUnit = { ...fixture.actor, unitId: fixture.unitIds[1] };
  assert.equal(
    (await service.operationalAlertHistory(otherUnit)).items.length,
    0,
  );
  await assert.rejects(
    service.markOperationalAlertRead(otherUnit, {
      ...input,
      idempotencyKey: key(),
    }),
  );
  const permission = await db.permission.findUniqueOrThrow({
    where: { key: "orders:read" },
  });
  await db.rolePermission.delete({
    where: {
      roleId_permissionId: {
        roleId: fixture.roleId,
        permissionId: permission.id,
      },
    },
  });
  const inventoryOnly = { ...fixture.actor, permissions: ["inventory:read"] };
  assert.equal(
    (await service.operationalAlertHistory(inventoryOnly)).items.length,
    0,
  );
  await assert.rejects(
    service.markOperationalAlertRead(inventoryOnly, input),
    (error) => {
      assert.equal((error as { status: number }).status, 403);
      return true;
    },
  );
});

test("coordenação ainda não ativada preserva avisos e leitura sem inventar prazo", async () => {
  await createOrder();
  const { pendingSnapshot } = await import(
    "../src/services/operational-pending"
  );
  const proxy = new Proxy(db, {
    get(target, property) {
      if (property === "$queryRaw")
        return async (query: Prisma.Sql) =>
          query.strings.join("").includes("to_regclass")
            ? [{ ready: false }]
            : target.$queryRaw(query);
      return Reflect.get(target, property);
    },
  });
  const result = await pendingSnapshot(fixture.actor, {}, proxy, {
    alerts: { read: "ALL" },
  });
  assert.equal(result.coordinationReady, false);
  assert.equal(result.items.length, 4);
  assert.ok(
    result.items.every(
      (item) =>
        item.dueAt === null && item.assigneeId === null && !!item.alertKey,
    ),
  );
});
