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
let management: typeof import("../src/services/management");
let extraRoles: string[] = [];
let extraUsers: string[] = [];
let listPending: typeof import("../src/services/operational-pending").listOperationalPending;
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
  management = await import("../src/services/management");
  ({ listOperationalPending: listPending } = await import(
    "../src/services/operational-pending"
  ));
  const actual = await db.$queryRaw<
    Array<{ name: string }>
  >`SELECT current_database()::text AS name`;
  assert.equal(actual[0].name, databaseName);
});
beforeEach(async () => {
  extraRoles = [];
  extraUsers = [];
  const suffix = randomUUID();
  const organization = await db.organization.create({
    data: { name: `TEST-PENDING-${suffix}` },
  });
  const role = await db.role.create({
    data: { name: `TEST-PENDING-${suffix}` },
  });
  for (const key of [
    "reports:read",
    "orders:read",
    "inventory:read",
    "inventory:count",
    "orders:apply",
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
    await tx.user.deleteMany({
      where: { id: { in: [fixture.userId, ...extraUsers] } },
    });
    await tx.role.deleteMany({
      where: { id: { in: [fixture.roleId, ...extraRoles] } },
    });
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

const now = new Date("2026-11-16T15:00:00Z");
const report = (raw: object = {}) =>
  management.managementReport(fixture.actor, raw, now);
const record = (
  at = now,
  actor = fixture.actor,
  idempotencyKey = randomUUID(),
) =>
  management.recordManagementPosition(
    actor,
    { idempotencyKey, expectedUnitId: actor.unitId },
    at,
  );
const status = (expected: number) => (error: unknown) => {
  assert.equal((error as { status: number }).status, expected);
  return true;
};
async function roleFor(unit: number, permissions: string[]) {
  const role = await db.role.create({
    data: { name: `TEST-MANAGEMENT-${randomUUID()}` },
  });
  extraRoles.push(role.id);
  for (const key of permissions) {
    const permission = await db.permission.upsert({
      where: { key },
      create: { key },
      update: {},
    });
    await db.rolePermission.create({
      data: { roleId: role.id, permissionId: permission.id },
    });
  }
  await db.unitMembership.update({
    where: {
      userId_unitId: { userId: fixture.userId, unitId: fixture.unitIds[unit] },
    },
    data: { roleId: role.id },
  });
  return role;
}
async function receipt(
  order: Awaited<ReturnType<typeof createOrder>>,
  state: string | null,
  date = "2026-11-10T12:00:00Z",
  index = 0,
) {
  const event = await db.orderEvent.create({
    data: {
      unitId: fixture.unitIds[index],
      orderId: order.id,
      materialId: order.materials[0].id,
      userId: fixture.userId,
      type: "APPLIED",
      quantity: "1",
      createdAt: new Date(date),
      metadata: {
        handoff: {
          ...(state !== "UNLINKED" ? { receivedByUserId: randomUUID() } : {}),
          receivedByName: "Nome que não deve aparecer no painel",
          receivedByIdentifier: "SEGREDO-01",
        },
      },
    },
  });
  if (state && state !== "PENDING" && state !== "UNLINKED")
    await db.orderEvent.create({
      data: {
        unitId: fixture.unitIds[index],
        orderId: order.id,
        materialId: order.materials[0].id,
        userId: fixture.userId,
        type:
          state === "PROPOSED"
            ? "DELIVERY_TREATMENT_PROPOSED"
            : state === "CONFIRMED"
              ? "DELIVERY_CONFIRMED"
              : "DELIVERY_DISPUTED",
        createdAt: new Date("2026-11-14T12:00:00Z"),
        metadata: { deliveryEventId: event.id, status: state, version: 1 },
      },
    });
  return event;
}

test("painel vazio distingue contagem zero de histórico sem medição e não grava na consulta", async () => {
  const result = await report();
  assert.equal(result.units.length, 1);
  assert.equal(result.period.days, 14);
  assert.equal(result.units[0].current.metrics.AWAITING_INVOICE?.count, 0);
  assert.equal(result.units[0].current.metrics.RECEIPT_PENDING?.oldestAt, null);
  assert.deepEqual(result.units[0].history, []);
  assert.equal(result.units[0].todayCapture, null);
  assert.equal(
    await db.auditLog.count({ where: { unitId: fixture.unitIds[0] } }),
    0,
  );
});
test("idades usam a abertura da ocorrência e o vencimento da agenda, sem inventar data para legado", async () => {
  const identified = await createOrder();
  await createOrder();
  await createInventory();
  await db.orderEvent.create({
    data: {
      unitId: fixture.unitIds[0],
      orderId: identified.id,
      materialId: identified.materials[0].id,
      userId: fixture.userId,
      type: "REQUESTED",
      createdAt: new Date("2026-11-10T12:00:00Z"),
      metadata: {
        pendingOpened: ["UNAPPLIED", "RESERVED", "AWAITING_INVOICE", "RETURN"],
      },
    },
  });
  const result = (await report()).units[0].current;
  assert.deepEqual(result.metrics.RETURN, {
    count: 2,
    dated: 1,
    undated: 1,
    oldestAt: "2026-11-10T12:00:00.000Z",
  });
  assert.equal(result.metrics.SCHEDULE?.count, 1);
  assert.equal(result.metrics.SCHEDULE?.oldestAt, "2020-01-01T00:00:00.000Z");
  // This fixture creates its count at the real database clock, after the injected test time.
  assert.equal(result.metrics.COUNT?.count, 1);
  assert.equal(JSON.stringify(result).includes("9213.47"), false);
});
test("recebimentos seguem os estados da etapa 8 e a espera começa na etapa atual", async () => {
  const order = await createOrder();
  const pending = await receipt(order, "PENDING");
  const disputed = await receipt(order, "DISPUTED");
  await receipt(order, "PROPOSED");
  await receipt(order, "UNLINKED");
  await receipt(order, "CONFIRMED");
  await db.orderEvent.create({
    data: {
      unitId: fixture.unitIds[0],
      orderId: order.id,
      materialId: order.materials[0].id,
      userId: fixture.userId,
      type: "DELIVERY_TREATMENT_REJECTED",
      createdAt: new Date("2026-11-15T12:00:00Z"),
      metadata: {
        deliveryEventId: disputed.id,
        status: "DISPUTED",
        version: 2,
      },
    },
  });
  await receipt(order, "PENDING", "2026-11-17T12:00:00Z");
  const metrics = (await report()).units[0].current.metrics;
  assert.deepEqual(metrics.RECEIPT_PENDING, {
    count: 2,
    dated: 1,
    undated: 1,
    oldestAt: pending.createdAt.toISOString(),
  });
  assert.equal(metrics.RECEIPT_DISPUTED?.oldestAt, "2026-11-15T12:00:00.000Z");
  assert.equal(metrics.RECEIPT_PROPOSED?.oldestAt, "2026-11-14T12:00:00.000Z");
  assert.equal(metrics.RECEIPT_UNLINKED?.count, 1);
  assert.equal(JSON.stringify(metrics).includes("SEGREDO-01"), false);
});
test("comparação aplica a permissão de cada unidade e não transforma área bloqueada em zero", async () => {
  await createOrder();
  await createOrder(1);
  await createInventory(1);
  await roleFor(1, ["reports:view", "inventory:read"]);
  const result = await report({ units: fixture.unitIds.join(",") });
  assert.equal(result.units[0].current.metrics.RETURN?.count, 1);
  assert.equal(result.units[1].current.metrics.RETURN, null);
  assert.equal(result.units[1].current.metrics.RECEIPT_PENDING, null);
  assert.equal(result.units[1].current.metrics.SCHEDULE?.count, 1);
  assert.equal(result.units[1].canRecord, false);
  await assert.rejects(
    report({ units: [fixture.unitIds[0], randomUUID()].join(",") }),
    status(403),
  );
  await db.unitMembership.update({
    where: {
      userId_unitId: { userId: fixture.userId, unitId: fixture.unitIds[1] },
    },
    data: { active: false },
  });
  const single = await report();
  assert.equal(single.availableUnits.length, 1);
  assert.equal(JSON.stringify(single).includes(fixture.unitIds[1]), false);
});
test("acesso é consultado no banco; ator com permissões antigas não consulta nem registra", async () => {
  await roleFor(0, ["orders:read"]);
  await assert.rejects(report(), status(403));
  await assert.rejects(record(), status(403));
  await roleFor(0, ["reports:view"]);
  await assert.rejects(report(), status(403));
  assert.equal(
    await db.auditLog.count({ where: { unitId: fixture.unitIds[0] } }),
    0,
  );
});
test("posição diária é imutável e leitura não altera materiais, inventário ou estoque", async () => {
  const order = await createOrder();
  const before = await db.orderMaterial.findUniqueOrThrow({
    where: { id: order.materials[0].id },
  });
  const first = await record();
  assert.equal(first.created, true);
  await db.orderMaterial.update({
    where: { id: before.id },
    data: { pendingReturnQuantity: "0" },
  });
  const second = await record();
  assert.equal(second.created, false);
  assert.equal(second.id, first.id);
  const result = await report();
  assert.equal(result.units[0].current.metrics.RETURN?.count, 0);
  assert.equal(result.units[0].history[0].metrics.RETURN?.count, 1);
  assert.equal(result.units[0].todayCapture?.id, first.id);
  const after = await db.orderMaterial.findUniqueOrThrow({
    where: { id: before.id },
  });
  assert.equal(
    after.appliedQuantity.toString(),
    before.appliedQuantity.toString(),
  );
  assert.equal(
    after.consumedQuantity.toString(),
    before.consumedQuantity.toString(),
  );
  assert.equal(
    await db.stockMovement.count({ where: { unitId: fixture.unitIds[0] } }),
    0,
  );
  assert.equal(
    await db.auditLog.count({
      where: { unitId: fixture.unitIds[0], entity: "ManagementPosition" },
    }),
    1,
  );
});
test("virada do dia usa Brasília e repetição após meia-noite mantém a posição original", async () => {
  await createOrder();
  const key = randomUUID();
  const first = await record(
    new Date("2026-11-17T02:59:59Z"),
    fixture.actor,
    key,
  );
  const replay = await record(
    new Date("2026-11-17T03:00:00Z"),
    fixture.actor,
    key,
  );
  assert.equal(first.day, "2026-11-16");
  assert.equal(replay.id, first.id);
  const second = await record(new Date("2026-11-17T03:00:00Z"));
  assert.equal(second.day, "2026-11-17");
  assert.notEqual(second.id, first.id);
  const result = await management.managementReport(
    fixture.actor,
    {},
    new Date("2026-11-17T12:00:00Z"),
  );
  assert.deepEqual(
    result.units[0].history.map((p) => p.day),
    ["2026-11-16", "2026-11-17"],
  );
});
test("registros concorrentes de pessoas distintas preservam uma única posição por unidade e dia", async () => {
  await createOrder();
  const user = await db.user.create({
    data: {
      name: "Outra pessoa de teste",
      email: `${randomUUID()}@example.invalid`,
      roleId: fixture.roleId,
      memberships: {
        create: { unitId: fixture.unitIds[0], roleId: fixture.roleId },
      },
    },
  });
  extraUsers.push(user.id);
  const results = await Promise.all([
    record(),
    record(now, { ...fixture.actor, id: user.id }),
    record(),
  ]);
  assert.equal(new Set(results.map((r) => r.id)).size, 1);
  assert.equal(results.filter((r) => r.created).length, 1);
  assert.equal(
    await db.auditLog.count({
      where: { unitId: fixture.unitIds[0], entity: "ManagementPosition" },
    }),
    1,
  );
});
test("histórico e auditoria geral respeitam revogação de áreas sem alterar a observação salva", async () => {
  await createOrder();
  const saved = await record();
  await roleFor(0, ["reports:view", "inventory:read"]);
  const result = await report();
  assert.equal(result.units[0].history[0].metrics.RETURN, null);
  const raw = await db.auditLog.findUniqueOrThrow({ where: { id: saved.id } });
  assert.equal(
    (raw.after as { metrics: { RETURN: { count: number } } }).metrics.RETURN
      .count,
    1,
  );
  const { unitAuditScope } = await import("../src/lib/audit-scope");
  assert.equal(
    await db.auditLog.count({
      where: unitAuditScope(fixture.unitIds[0], ["reports:read", "costs:read"]),
    }),
    0,
  );
  await assert.rejects(record(), status(403));
});
test("área que não foi medida permanece indisponível ao ampliar acesso, sem preencher zero retroativo", async () => {
  await createOrder();
  await roleFor(0, ["reports:read", "inventory:read"]);
  await record();
  await db.unitMembership.update({
    where: {
      userId_unitId: { userId: fixture.userId, unitId: fixture.unitIds[0] },
    },
    data: { roleId: fixture.roleId },
  });
  const result = await report();
  assert.equal(result.units[0].current.metrics.RETURN?.count, 1);
  assert.equal(result.units[0].history[0].metrics.RETURN, null);
  assert.equal((await record()).created, false);
});
test("contagem gerencial usa toda a fila antes da paginação e coincide com a origem", async () => {
  for (let i = 0; i < 9; i++) await createOrder();
  const original = await listPending(fixture.actor, { pageSize: 1 });
  const current = (await report()).units[0].current;
  for (const type of [
    "UNAPPLIED",
    "RESERVED",
    "AWAITING_INVOICE",
    "RETURN",
  ] as const)
    assert.equal(current.metrics[type]?.count, original.totals[type]);
  assert.equal(current.metrics.UNAPPLIED?.count, 9);
});
test("intervalos e seleção são limitados; cliente não fornece data, métricas ou autor da posição", async () => {
  await assert.rejects(
    management.recordManagementPosition(
      fixture.actor,
      { idempotencyKey: randomUUID(), expectedUnitId: fixture.unitIds[1] },
      now,
    ),
    status(409),
  );
  await assert.rejects(
    report({ from: "2026-10-01", to: "2026-11-16" }),
    status(400),
  );
  await assert.rejects(
    report({ from: "2026-11-17", to: "2026-11-17" }),
    status(400),
  );
  await assert.rejects(report({ from: "2026-02-30", to: "2026-03-01" }));
  await assert.rejects(
    report({ units: [fixture.unitIds[0], fixture.unitIds[0]].join(",") }),
    status(400),
  );
  await assert.rejects(report({ units: fixture.unitIds[1] }), status(400));
  await assert.rejects(
    management.recordManagementPosition(
      fixture.actor,
      {
        idempotencyKey: randomUUID(),
        expectedUnitId: fixture.unitIds[0],
        capturedAt: "2000-01-01T00:00:00Z",
        metrics: {},
      },
      now,
    ),
  );
  assert.equal(
    await db.auditLog.count({ where: { unitId: fixture.unitIds[0] } }),
    0,
  );
});

test("agregação mantém a fila consultável quando a preparação de responsáveis ainda está ausente", async () => {
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
    management: true,
    now,
  });
  assert.equal(result.coordinationReady, false);
  assert.deepEqual(result.management?.RETURN, {
    count: 1,
    dated: 0,
    undated: 1,
    oldestAt: null,
  });
});
