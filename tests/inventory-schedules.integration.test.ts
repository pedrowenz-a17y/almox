import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { before, beforeEach, after, afterEach, test } from "node:test";
import type { PrismaClient } from "@prisma/client";
import type { StockActor } from "../src/services/stock";

const testUrl = process.env.TEST_DATABASE_URL;
if (!testUrl)
  throw new Error(
    "TEST_DATABASE_URL é obrigatória; use uma base exclusiva de testes.",
  );
const url = new URL(testUrl);
const databaseName = decodeURIComponent(url.pathname.slice(1));
if (
  !["postgres:", "postgresql:"].includes(url.protocol) ||
  !/(^|[_-])tests?([_-]|$)/i.test(databaseName)
)
  throw new Error("O banco de integração precisa conter test no nome.");
process.env.DATABASE_URL = testUrl;
process.env.DIRECT_URL = testUrl;
let db: PrismaClient;
let schedules: typeof import("../src/services/inventory-schedules");
let inventories: typeof import("../src/services/inventory");
let stock: typeof import("../src/services/stock");
let fixture: {
  org: string;
  role: string;
  users: string[];
  units: string[];
  locations: string[];
  product: string;
  actor: StockActor;
  reviewer: StockActor;
  otherActor: StockActor;
};
const key = randomUUID;
const status = (expected: number) => (error: unknown) => {
  assert.equal((error as { status?: number }).status, expected);
  return true;
};
before(async () => {
  ({ prisma: db } = await import("../src/lib/db"));
  schedules = await import("../src/services/inventory-schedules");
  inventories = await import("../src/services/inventory");
  stock = await import("../src/services/stock");
  const actual = await db.$queryRaw<
    Array<{ name: string }>
  >`SELECT current_database()::text AS name`;
  assert.equal(actual[0]?.name, databaseName);
});
beforeEach(async () => {
  const suffix = key();
  const org = await db.organization.create({
    data: { name: `TEST-SCHEDULE-${suffix}` },
  });
  const role = await db.role.create({
    data: { name: `TEST-SCHEDULE-${suffix}` },
  });
  const users = await Promise.all(
    ["A", "B", "C"].map((letter) =>
      db.user.create({
        data: {
          roleId: role.id,
          name: `Usuário ${letter} teste`,
          email: `schedule-${letter}-${suffix}@example.invalid`,
        },
      }),
    ),
  );
  const units = await Promise.all(
    ["A", "B"].map((letter, index) =>
      db.operationalUnit.create({
        data: {
          organizationId: org.id,
          name: `Unidade teste ${letter}`,
          code: `TEST-SCHEDULE-${letter}-${suffix}`,
          memberships: { create: { userId: users[index].id, roleId: role.id } },
        },
      }),
    ),
  );
  const warehouses = await Promise.all(
    units.map((unit) =>
      db.warehouse.create({
        data: { unitId: unit.id, code: "ALM-TEST", name: "Almoxarifado teste" },
      }),
    ),
  );
  await db.unitMembership.create({ data: { userId: users[2].id, unitId: units[0].id, roleId: role.id } });
  const locations = await Promise.all(
    units.map((unit, index) =>
      db.location.create({
        data: {
          unitId: unit.id,
          warehouseId: warehouses[index].id,
          code: "LOC-TEST",
          name: "Local teste",
        },
      }),
    ),
  );
  const product = await db.product.create({
    data: {
      unitId: units[0].id,
      internalCode: "ITEM-TEST",
      name: "Material teste",
      unit: "UN",
    },
  });
  const actor = (index: number): StockActor => ({
    id: users[index].id,
    unitId: units[index].id,
    permissions: ["stock:move", "inventory:count", "inventory:adjust"],
  });
  fixture = {
    org: org.id,
    role: role.id,
    users: users.map((user) => user.id),
    units: units.map((unit) => unit.id),
    locations: locations.map((location) => location.id),
    product: product.id,
    actor: actor(0),
    reviewer: { ...actor(0), id: users[2].id },
    otherActor: actor(1),
  };
  await stock.createMovement(fixture.actor, {
    type: "ENTRY",
    productId: product.id,
    destinationId: locations[0].id,
    quantity: "10",
    idempotencyKey: key(),
  });
});
afterEach(async () => {
  if (!fixture) return;
  const where = { unitId: { in: fixture.units } };
  await db.$transaction(
    async (tx) => {
      await tx.idempotencyRecord.deleteMany({ where });
      await tx.auditLog.deleteMany({ where });
      await tx.stockMovement.deleteMany({ where });
      await tx.inventorySchedule.updateMany({
        where,
        data: { lastCountId: null },
      });
      await tx.inventoryCountItem.deleteMany({ where });
      await tx.inventoryCount.deleteMany({ where });
      await tx.inventorySchedule.deleteMany({ where });
      await tx.inventoryBalance.deleteMany({ where });
      await tx.product.deleteMany({ where });
      await tx.location.deleteMany({ where });
      await tx.warehouse.deleteMany({ where });
      await tx.unitMembership.deleteMany({ where });
      await tx.operationalUnit.deleteMany({
        where: { id: { in: fixture.units } },
      });
      await tx.user.deleteMany({ where: { id: { in: fixture.users } } });
      await tx.role.delete({ where: { id: fixture.role } });
      await tx.organization.delete({ where: { id: fixture.org } });
    },
    { timeout: 30000 },
  );
});
after(async () => {
  await db?.$disconnect();
});

async function schedule(options: Record<string, unknown> = {}) {
  return schedules.createInventorySchedule(fixture.actor, {
    title: "Conferência semanal",
    locationId: fixture.locations[0],
    intervalDays: 7,
    nextDueAt: new Date(Date.now() - 86400000).toISOString(),
    assigneeId: fixture.users[0],
    idempotencyKey: key(),
    ...options,
  });
}
async function count(
  scheduleId: string,
  options: Record<string, unknown> = {},
) {
  return inventories.createInventoryCount(fixture.actor, {
    locationId: fixture.locations[0],
    scheduleId,
    note: "Contagem periódica de teste",
    items: [
      {
        productId: fixture.product,
        expectedQuantity: "10",
        countedQuantity: "10",
      },
    ],
    idempotencyKey: key(),
    ...options,
  });
}

test("tentativa de autoaprovação não ajusta o saldo nem conclui a conferência periódica", async () => {
  const initial = await schedule();
  const pending = await count(initial.id, {
    items: [{ productId: fixture.product, expectedQuantity: "10", countedQuantity: "9" }],
  });
  const movements = await db.stockMovement.count({ where: { unitId: fixture.units[0] } });
  const audit = await db.auditLog.count({ where: { unitId: fixture.units[0] } });
  await assert.rejects(inventories.approveInventoryCount(fixture.actor, pending.id), (error: unknown) => {
    assert.equal((error as { status?: number }).status, 403);
    assert.equal((error as { code?: string }).code, "INVENTORY_SELF_APPROVAL");
    return true;
  });
  const stored = await db.inventorySchedule.findUniqueOrThrow({ where: { id: initial.id } });
  assert.equal(stored.lastCountId, null);
  assert.equal(stored.nextDueAt.getTime(), initial.nextDueAt.getTime());
  assert.equal((await db.inventoryCount.findUniqueOrThrow({ where: { id: pending.id } })).status, "PENDING");
  assert.equal((await stock.availability(db, fixture.product, fixture.locations[0], fixture.units[0])).quantity.toFixed(3), "10.000");
  assert.equal(await db.stockMovement.count({ where: { unitId: fixture.units[0] } }), movements);
  assert.equal(await db.auditLog.count({ where: { unitId: fixture.units[0] } }), audit);
  await inventories.approveInventoryCount(fixture.reviewer, pending.id);
  assert.equal((await db.inventorySchedule.findUniqueOrThrow({ where: { id: initial.id } })).lastCountId, pending.id);
});

test("programação valida permissão, localização e responsável ativo da unidade", async () => {
  await assert.rejects(
    schedules.createInventorySchedule(
      { ...fixture.actor, permissions: ["inventory:count"] },
      {},
    ),
    status(403),
  );
  await assert.rejects(
    schedule({ locationId: fixture.locations[1] }),
    status(404),
  );
  await assert.rejects(schedule({ assigneeId: fixture.users[1] }), status(400));
  await db.unitMembership.update({
    where: {
      userId_unitId: { userId: fixture.users[0], unitId: fixture.units[0] },
    },
    data: { active: false },
  });
  await assert.rejects(schedule(), status(400));
});

test("criação de programação é idempotente e leitura não cruza unidades", async () => {
  const idempotencyKey = key();
  const input = { idempotencyKey, nextDueAt: "2026-01-01T12:00:00.000Z" };
  const first = await schedule(input);
  const again = await schedule(input);
  assert.equal(again.id, first.id);
  assert.equal(
    (await schedules.listInventorySchedules(fixture.actor)).items.length,
    1,
  );
  assert.equal(
    (await schedules.listInventorySchedules(fixture.otherActor)).items.length,
    0,
  );
  assert.equal(
    (
      await schedules.listInventorySchedules({
        ...fixture.actor,
        permissions: ["inventory:count"],
      })
    ).assignees.length,
    0,
  );
  await assert.rejects(
    schedules.updateInventorySchedule(fixture.otherActor, first.id, {
      active: false,
      note: "Teste de isolamento",
    }),
    status(404),
  );
  await assert.rejects(
    schedules.listInventorySchedules({ ...fixture.actor, permissions: [] }),
    status(403),
  );
});

test("contagem pendente não encerra ciclo e aprovação agenda apenas uma nova conferência", async () => {
  const initial = await schedule();
  const first = await count(initial.id);
  await assert.rejects(count(initial.id), status(409));
  const pendingList = await schedules.listInventorySchedules(fixture.actor);
  assert.equal(pendingList.items[0].pendingCount?.id, first.id);
  assert.equal(
    (
      await db.inventorySchedule.findUniqueOrThrow({
        where: { id: initial.id },
      })
    ).nextDueAt.getTime(),
    initial.nextDueAt.getTime(),
  );
  assert.equal(first.scheduleDueAt?.getTime(), initial.nextDueAt.getTime());
  await assert.rejects(
    inventories.approveInventoryCount(
      { ...fixture.actor, permissions: ["inventory:count"] },
      first.id,
    ),
    status(403),
  );
  const approved = await inventories.approveInventoryCount(
    fixture.reviewer,
    first.id,
  );
  const advanced = await db.inventorySchedule.findUniqueOrThrow({
    where: { id: initial.id },
  });
  assert.equal(advanced.lastCountId, first.id);
  assert.equal(
    advanced.nextDueAt.getTime(),
    approved.approvedAt!.getTime() + 7 * 86400000,
  );
  await inventories.approveInventoryCount(fixture.reviewer, first.id);
  const final = await db.inventorySchedule.findUniqueOrThrow({
    where: { id: initial.id },
  });
  assert.equal(final.lastCountId, first.id);
  assert.equal(final.nextDueAt.getTime(), advanced.nextDueAt.getTime());
  assert.equal(
    await db.auditLog.count({
      where: {
        unitId: fixture.units[0],
        action: "INVENTORY_SCHEDULE_COMPLETED",
      },
    }),
    1,
  );
});

test("consulta direta encontra contagem da unidade com autorização e isola IDs externos", async () => {
  const initial = await schedule();
  const pending = await count(initial.id);
  const result = await inventories.getInventoryCount(
    { ...fixture.actor, permissions: ["inventory:count"] },
    pending.id,
  );
  assert.equal(result.id, pending.id);
  assert.equal(result.items[0].product.id, fixture.product);
  assert.equal(result.location.id, fixture.locations[0]);
  await assert.rejects(
    inventories.getInventoryCount(
      { ...fixture.actor, permissions: [] },
      pending.id,
    ),
    status(403),
  );
  await assert.rejects(
    inventories.getInventoryCount(fixture.otherActor, pending.id),
    status(404),
  );
  await assert.rejects(
    inventories.getInventoryCount(fixture.actor, key()),
    status(404),
  );
});

test("encerrar contagem obsoleta mantém estoque e ciclo, libera recontagem e preserva auditoria", async () => {
  const initial = await schedule();
  const pending = await count(initial.id);
  await stock.createMovement(fixture.actor, {
    type: "ENTRY",
    productId: fixture.product,
    destinationId: fixture.locations[0],
    quantity: "1",
    idempotencyKey: key(),
  });
  await assert.rejects(
    inventories.approveInventoryCount(fixture.reviewer, pending.id),
    status(409),
  );
  await assert.rejects(
    inventories.rejectInventoryCount(
      { ...fixture.actor, permissions: ["inventory:count"] },
      pending.id,
      { note: "Contagem desatualizada pelo recebimento" },
    ),
    status(403),
  );
  await assert.rejects(
    inventories.rejectInventoryCount(fixture.otherActor, pending.id, {
      note: "Tentativa em outra unidade",
    }),
    status(404),
  );
  const rejected = await inventories.rejectInventoryCount(
    fixture.actor,
    pending.id,
    { note: "Contagem desatualizada pelo recebimento" },
  );
  assert.equal(rejected.status, "REJECTED");
  await inventories.rejectInventoryCount(fixture.actor, pending.id, {
    note: "Contagem desatualizada pelo recebimento",
  });
  assert.equal(
    await db.auditLog.count({
      where: { unitId: fixture.units[0], action: "INVENTORY_REJECTED" },
    }),
    1,
  );
  await assert.rejects(
    inventories.approveInventoryCount(fixture.reviewer, pending.id),
    status(409),
  );
  const sameCycle = await db.inventorySchedule.findUniqueOrThrow({
    where: { id: initial.id },
  });
  assert.equal(sameCycle.lastCountId, null);
  assert.equal(sameCycle.nextDueAt.getTime(), initial.nextDueAt.getTime());
  assert.equal(
    (await schedules.listInventorySchedules(fixture.actor)).items[0]
      .pendingCount,
    null,
  );
  const recount = await count(initial.id, {
    items: [
      {
        productId: fixture.product,
        expectedQuantity: "11",
        countedQuantity: "11",
      },
    ],
  });
  await inventories.approveInventoryCount(fixture.reviewer, recount.id);
  await assert.rejects(
    inventories.rejectInventoryCount(fixture.actor, recount.id, {
      note: "Não pode rejeitar contagem aprovada",
    }),
    status(409),
  );
  const balance = await stock.availability(
    db,
    fixture.product,
    fixture.locations[0],
    fixture.units[0],
  );
  assert.equal(balance.quantity.toFixed(3), "11.000");
});

test("contagem antiga respeita reprogramação e antecipação exige confirmação", async () => {
  const initial = await schedule();
  const pending = await count(initial.id);
  const due = new Date(Date.now() + 10 * 86400000).toISOString();
  await schedules.updateInventorySchedule(fixture.actor, initial.id, {
    nextDueAt: due,
    note: "Reprogramação aprovada para teste",
  });
  assert.equal(
    (await schedules.listInventorySchedules(fixture.actor)).items[0]
      .pendingCount,
    null,
    "Contagem do ciclo antigo não pode bloquear o ciclo reprogramado",
  );
  await inventories.approveInventoryCount(fixture.reviewer, pending.id);
  const kept = await db.inventorySchedule.findUniqueOrThrow({
    where: { id: initial.id },
  });
  assert.equal(kept.nextDueAt.toISOString(), due);
  assert.equal(kept.lastCountId, null);
  await assert.rejects(count(initial.id), status(409));
  assert.ok((await count(initial.id, { allowEarly: true })).id);
  await schedules.updateInventorySchedule(fixture.actor, initial.id, {
    active: false,
    note: "Pausa autorizada no teste",
  });
  await assert.rejects(count(initial.id), status(409));
});

test("programação de outra unidade não pode ser usada em contagem", async () => {
  const foreign = await schedules.createInventorySchedule(fixture.otherActor, {
    title: "Local de outra unidade",
    locationId: fixture.locations[1],
    intervalDays: 1,
    nextDueAt: "2026-01-01T12:00:00.000Z",
    idempotencyKey: key(),
  });
  await assert.rejects(count(foreign.id), status(409));
});
