import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  after,
  afterEach,
  before,
  beforeEach,
  describe,
  test,
} from "node:test";
import type { PrismaClient } from "@prisma/client";
import { ZodError } from "zod";
import type { StockActor } from "../src/services/stock";

/** Never fall back to DATABASE_URL: this suite writes to a dedicated test database. */
const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (!testDatabaseUrl) {
  throw new Error(
    "Defina TEST_DATABASE_URL para um PostgreSQL exclusivo de testes (ex.: almox_test). A suíte não usa DATABASE_URL como alternativa.",
  );
}
const databaseUrl = new URL(testDatabaseUrl);
const databaseName = decodeURIComponent(databaseUrl.pathname.slice(1));
if (
  !["postgresql:", "postgres:"].includes(databaseUrl.protocol) ||
  !/(^|[_-])tests?([_-]|$)/i.test(databaseName)
) {
  throw new Error(
    "Por segurança, TEST_DATABASE_URL deve apontar para PostgreSQL cujo nome de banco contém test como palavra (ex.: almox_test).",
  );
}
process.env.DATABASE_URL = testDatabaseUrl;

let db: PrismaClient;
let createMovement: typeof import("../src/services/stock").createMovement;
let createInventoryCount: typeof import("../src/services/inventory").createInventoryCount;
let approveInventoryCount: typeof import("../src/services/inventory").approveInventoryCount;

type Fixture = {
  roleId: string;
  organizationId: string;
  unitId: string;
  otherUnitId: string;
  otherWarehouseId: string;
  otherLocationId: string;
  otherProductId: string;
  warehouseId: string;
  sectorId: string;
  sourceId: string;
  destinationId: string;
  productId: string;
  productIds: string[];
  admin: StockActor;
  operator: StockActor;
};
let f: Fixture;

const requestKey = () => randomUUID();
const statusIs = (status: number) => (error: unknown) => {
  assert.equal((error as { status?: number }).status, status);
  return true;
};

async function balance(locationId: string, productId = f.productId) {
  const row = await db.inventoryBalance.findUnique({
    where: { productId_locationId: { productId, locationId } },
  });
  return row?.quantity.toFixed(3) ?? "0.000";
}

async function enter(
  quantity: number | string,
  locationId = f.sourceId,
  productId = f.productId,
) {
  return createMovement(f.operator, {
    type: "ENTRY",
    productId,
    destinationId: locationId,
    quantity,
    idempotencyKey: requestKey(),
  });
}

async function count(
  expectedQuantity: number | string,
  countedQuantity: number | string,
  options: { productId?: string; idempotencyKey?: string } = {},
) {
  return createInventoryCount(f.operator, {
    locationId: f.sourceId,
    items: [
      {
        productId: options.productId ?? f.productId,
        expectedQuantity,
        countedQuantity,
      },
    ],
    note: "Conferência física de integração",
    idempotencyKey: options.idempotencyKey ?? requestKey(),
  });
}

before(async () => {
  // Imports occur after DATABASE_URL is replaced so the application's real client is isolated.
  ({ prisma: db } = await import("../src/lib/db"));
  ({ createMovement } = await import("../src/services/stock"));
  ({ createInventoryCount, approveInventoryCount } =
    await import("../src/services/inventory"));
  await db.$connect();
  const actual = await db.$queryRaw<
    Array<{ name: string }>
  >`SELECT current_database()::text AS name`;
  assert.equal(
    actual[0]?.name,
    databaseName,
    "A conexão deve usar exatamente o banco de testes autorizado.",
  );
});

beforeEach(async () => {
  const suffix = randomUUID();
  const organization = await db.organization.create({ data: { name: `TEST-${suffix}` } });
  const unit = await db.operationalUnit.create({ data: { organizationId: organization.id, code: `TEST-A-${suffix}`, name: "Unidade A teste" } });
  const otherUnit = await db.operationalUnit.create({ data: { organizationId: organization.id, code: `TEST-B-${suffix}`, name: "Unidade B teste" } });
  await db.appSettings.create({ data: { id: unit.id, unitId: unit.id, allowNegativeStock: false } });
  const role = await db.role.create({ data: { name: `TEST-${suffix}` } });
  const admin = await db.user.create({
    data: {
      name: "Administrador teste",
      email: `admin-${suffix}@example.invalid`,
      passwordHash: "not-a-login-hash",
      authUserId: randomUUID(),
      roleId: role.id,
    },
  });
  const operator = await db.user.create({
    data: {
      name: "Operador teste",
      email: `operator-${suffix}@example.invalid`,
      passwordHash: "not-a-login-hash",
      authUserId: randomUUID(),
      roleId: role.id,
    },
  });
  await db.unitMembership.createMany({ data: [
    { userId: admin.id, unitId: unit.id, roleId: role.id },
    { userId: operator.id, unitId: unit.id, roleId: role.id },
  ] });
  const warehouse = await db.warehouse.create({
    data: { code: `TEST-${suffix}`, name: "Almoxarifado de teste", unitId: unit.id },
  });
  const sector = await db.location.create({
    data: {
      code: `TEST-A-${suffix}`,
      name: "Setor A",
      warehouseId: warehouse.id,
      unitId: unit.id,
    },
  });
  const source = await db.location.create({
    data: {
      code: `TEST-P03-${suffix}`,
      name: "Estante 02 / Prateleira 03",
      parentId: sector.id,
      warehouseId: warehouse.id,
      unitId: unit.id,
    },
  });
  const destination = await db.location.create({
    data: {
      code: `TEST-P04-${suffix}`,
      name: "Estante 02 / Prateleira 04",
      parentId: sector.id,
      warehouseId: warehouse.id,
      unitId: unit.id,
    },
  });
  const product = await db.product.create({
    data: {
      internalCode: `TEST-${suffix}`,
      sku: `SKU-${suffix}`,
      name: "Rolamento 6204",
      minStock: 10,
      unitId: unit.id,
    },
  });
  const otherWarehouse = await db.warehouse.create({ data: { code: warehouse.code, name: "Almoxarifado outra unidade", unitId: otherUnit.id } });
  const otherLocation = await db.location.create({ data: { code: source.code, name: "Local outra unidade", unitId: otherUnit.id, warehouseId: otherWarehouse.id } });
  const otherProduct = await db.product.create({ data: { internalCode: product.internalCode, name: "Produto outra unidade", unitId: otherUnit.id } });
  f = {
    roleId: role.id,
    organizationId: organization.id,
    unitId: unit.id,
    otherUnitId: otherUnit.id,
    otherWarehouseId: otherWarehouse.id,
    otherLocationId: otherLocation.id,
    otherProductId: otherProduct.id,
    warehouseId: warehouse.id,
    sectorId: sector.id,
    sourceId: source.id,
    destinationId: destination.id,
    productId: product.id,
    productIds: [product.id],
    admin: {
      id: admin.id,
      unitId: unit.id,
      permissions: ["stock:move", "inventory:count", "inventory:adjust"],
    },
    operator: {
      id: operator.id,
      unitId: unit.id,
      permissions: ["stock:move", "inventory:count"],
    },
  };
});

afterEach(async () => {
  if (!f) return;
  const userIds = [f.admin.id, f.operator.id];
  const locationIds = [f.sectorId, f.sourceId, f.destinationId];
  // Delete only rows owned by this test; never truncate a database or delete unrelated data.
  await db.$transaction(async (tx) => {
    await tx.idempotencyRecord.deleteMany({
      where: { actorId: { in: userIds } },
    });
    await tx.auditLog.deleteMany({ where: { userId: { in: userIds } } });
    await tx.stockMovement.deleteMany({
      where: { productId: { in: f.productIds } },
    });
    await tx.inventoryCountItem.deleteMany({
      where: { count: { locationId: { in: locationIds } } },
    });
    await tx.inventoryCount.deleteMany({
      where: { locationId: { in: locationIds } },
    });
    await tx.inventoryBalance.deleteMany({
      where: { productId: { in: f.productIds } },
    });
    await tx.product.deleteMany({ where: { id: { in: [...f.productIds, f.otherProductId] } } });
    await tx.location.deleteMany({
      where: { id: { in: [f.sourceId, f.destinationId, f.otherLocationId] } },
    });
    await tx.location.delete({ where: { id: f.sectorId } });
    await tx.warehouse.delete({ where: { id: f.warehouseId } });
    await tx.warehouse.delete({ where: { id: f.otherWarehouseId } });
    await tx.unitMembership.deleteMany({ where: { userId: { in: userIds } } });
    await tx.user.deleteMany({ where: { id: { in: userIds } } });
    await tx.role.delete({ where: { id: f.roleId } });
    await tx.appSettings.delete({ where: { id: f.unitId } });
    await tx.operationalUnit.deleteMany({ where: { id: { in: [f.unitId, f.otherUnitId] } } });
    await tx.organization.delete({ where: { id: f.organizationId } });
  });
});

after(async () => {
  await db?.$disconnect();
});

describe("movimentações reais no PostgreSQL", () => {
  test("aceitação: entrada 100, saída 15, transferência 25 resultam em 60 + 25 = 85 com histórico e auditoria", async () => {
    const entry = await enter(100);
    const exit = await createMovement(f.operator, {
      type: "EXIT",
      productId: f.productId,
      sourceId: f.sourceId,
      quantity: 15,
      reference: "OS-2026-001",
      idempotencyKey: requestKey(),
    });
    const transfer = await createMovement(f.operator, {
      type: "TRANSFER",
      productId: f.productId,
      sourceId: f.sourceId,
      destinationId: f.destinationId,
      quantity: 25,
      idempotencyKey: requestKey(),
    });
    assert.equal(await balance(f.sourceId), "60.000");
    assert.equal(await balance(f.destinationId), "25.000");
    const total = await db.inventoryBalance.aggregate({
      where: { productId: f.productId },
      _sum: { quantity: true },
    });
    assert.equal(total._sum.quantity?.toFixed(3), "85.000");
    const history = await db.stockMovement.findMany({
      where: { productId: f.productId },
      orderBy: { createdAt: "asc" },
    });
    assert.deepEqual(
      history.map((row) => row.type),
      ["ENTRY", "EXIT", "TRANSFER"],
    );
    assert.equal(history[0].destinationBefore?.toFixed(3), "0.000");
    assert.equal(history[0].destinationAfter?.toFixed(3), "100.000");
    assert.equal(history[1].sourceBefore?.toFixed(3), "100.000");
    assert.equal(history[1].sourceAfter?.toFixed(3), "85.000");
    assert.equal(history[1].reference, "OS-2026-001");
    assert.equal(history[2].sourceAfter?.toFixed(3), "60.000");
    assert.equal(history[2].destinationAfter?.toFixed(3), "25.000");
    for (const movement of [entry, exit, transfer]) {
      assert.equal(movement.userId, f.operator.id);
      const audit = await db.auditLog.findFirst({
        where: { entityId: movement.id, userId: f.operator.id },
      });
      assert.ok(
        audit,
        `Movimentação ${movement.id} precisa constar na auditoria`,
      );
      assert.ok(audit.after);
      assert.ok(audit.createdAt instanceof Date);
    }
  });

  test("saldos são exclusivos por produto/local e preservam precisão decimal", async () => {
    await enter("0.100");
    await enter("0.200");
    await enter("0.005", f.destinationId);
    assert.equal(await balance(f.sourceId), "0.300");
    assert.equal(await balance(f.destinationId), "0.005");
    assert.equal(
      await db.inventoryBalance.count({ where: { productId: f.productId } }),
      2,
    );
  });

  test("retirada maior que o saldo falha sem alterar saldo, histórico ou idempotência", async () => {
    await enter(10);
    const key = requestKey();
    await assert.rejects(
      createMovement(f.operator, {
        type: "EXIT",
        productId: f.productId,
        sourceId: f.sourceId,
        quantity: 11,
        idempotencyKey: key,
      }),
      statusIs(409),
    );
    assert.equal(await balance(f.sourceId), "10.000");
    assert.equal(
      await db.stockMovement.count({ where: { productId: f.productId } }),
      1,
    );
    assert.equal(await db.idempotencyRecord.count({ where: { key } }), 0);
  });

  test("zero, negativos, precisão excessiva e campos de ajuste direto são rejeitados no backend", async () => {
    for (const quantity of [
      0,
      -1,
      "1.0001",
      "1e2",
      "NaN",
      "1000000000000000",
    ]) {
      await assert.rejects(
        createMovement(f.operator, {
          type: "ENTRY",
          productId: f.productId,
          destinationId: f.sourceId,
          quantity,
          idempotencyKey: requestKey(),
        }),
        ZodError,
      );
    }
    await assert.rejects(
      createMovement(f.admin, {
        type: "ADJUSTMENT",
        productId: f.productId,
        destinationId: f.sourceId,
        quantity: 10,
        idempotencyKey: requestKey(),
      }),
      ZodError,
    );
    assert.equal(
      await db.stockMovement.count({ where: { productId: f.productId } }),
      0,
    );
  });

  test("transferência para destino inexistente não retira material da origem", async () => {
    await enter(100);
    await assert.rejects(
      createMovement(f.operator, {
        type: "TRANSFER",
        productId: f.productId,
        sourceId: f.sourceId,
        destinationId: randomUUID(),
        quantity: 25,
        idempotencyKey: requestKey(),
      }),
    );
    assert.equal(await balance(f.sourceId), "100.000");
    assert.equal(
      await db.stockMovement.count({ where: { productId: f.productId } }),
      1,
    );
    assert.equal(
      await db.inventoryBalance.count({ where: { productId: f.productId } }),
      1,
    );
  });

  test("transferência com saldo insuficiente mantém ambos os locais", async () => {
    await enter(10);
    await enter(5, f.destinationId);
    await assert.rejects(
      createMovement(f.operator, {
        type: "TRANSFER",
        productId: f.productId,
        sourceId: f.sourceId,
        destinationId: f.destinationId,
        quantity: 11,
        idempotencyKey: requestKey(),
      }),
      statusIs(409),
    );
    assert.equal(await balance(f.sourceId), "10.000");
    assert.equal(await balance(f.destinationId), "5.000");
    assert.equal(
      await db.stockMovement.count({
        where: { productId: f.productId, type: "TRANSFER" },
      }),
      0,
    );
  });

  test("falha ao gravar o destino desfaz a retirada já feita na transação", async () => {
    await enter(10);
    await enter("999999999999999.999", f.destinationId);
    await assert.rejects(
      createMovement(f.operator, {
        type: "TRANSFER",
        productId: f.productId,
        sourceId: f.sourceId,
        destinationId: f.destinationId,
        quantity: 1,
        idempotencyKey: requestKey(),
      }),
      statusIs(400),
    );
    assert.equal(await balance(f.sourceId), "10.000");
    assert.equal(await balance(f.destinationId), "999999999999999.999");
    assert.equal(
      await db.stockMovement.count({ where: { productId: f.productId } }),
      2,
    );
  });

  test("transferência para a própria origem é rejeitada", async () => {
    await enter(10);
    await assert.rejects(
      createMovement(f.operator, {
        type: "TRANSFER",
        productId: f.productId,
        sourceId: f.sourceId,
        destinationId: f.sourceId,
        quantity: 5,
        idempotencyKey: requestKey(),
      }),
      ZodError,
    );
    assert.equal(await balance(f.sourceId), "10.000");
  });

  test("produto e localização inativos não recebem movimentações", async () => {
    await db.product.update({
      where: { id: f.productId },
      data: { active: false },
    });
    await assert.rejects(enter(10));
    await db.product.update({
      where: { id: f.productId },
      data: { active: true },
    });
    await db.location.update({
      where: { id: f.sourceId },
      data: { active: false },
    });
    await assert.rejects(enter(10));
    assert.equal(
      await db.inventoryBalance.count({ where: { productId: f.productId } }),
      0,
    );
  });

  test("perfil sem stock:move recebe 403 e não altera o banco", async () => {
    await assert.rejects(
      createMovement(
        { id: f.operator.id, unitId: f.unitId, permissions: ["inventory:count"] },
        {
          type: "ENTRY",
          productId: f.productId,
          destinationId: f.sourceId,
          quantity: 100,
          idempotencyKey: requestKey(),
        },
      ),
      statusIs(403),
    );
    assert.equal(
      await db.stockMovement.count({ where: { productId: f.productId } }),
      0,
    );
  });

  test("duas requisições simultâneas com a mesma chave aplicam uma única entrada", async () => {
    const payload = {
      type: "ENTRY",
      productId: f.productId,
      destinationId: f.sourceId,
      quantity: 100,
      idempotencyKey: requestKey(),
    };
    const results = await Promise.all([
      createMovement(f.operator, payload),
      createMovement(f.operator, payload),
    ]);
    assert.equal(results[0].id, results[1].id);
    assert.equal(await balance(f.sourceId), "100.000");
    assert.equal(
      await db.stockMovement.count({ where: { productId: f.productId } }),
      1,
    );
    assert.equal(
      await db.auditLog.count({ where: { entityId: results[0].id } }),
      1,
    );
  });

  test("chave reutilizada com quantidade ou usuário diferente é rejeitada", async () => {
    const payload = {
      type: "ENTRY",
      productId: f.productId,
      destinationId: f.sourceId,
      quantity: 100,
      idempotencyKey: requestKey(),
    };
    await createMovement(f.operator, payload);
    await assert.rejects(
      createMovement(f.operator, { ...payload, quantity: 200 }),
      statusIs(409),
    );
    await assert.rejects(createMovement(f.admin, payload), statusIs(409));
    assert.equal(await balance(f.sourceId), "100.000");
  });

  test("duas retiradas concorrentes de 80 sobre saldo 100 permitem somente uma", async () => {
    await enter(100);
    const results = await Promise.allSettled(
      [1, 2].map(() =>
        createMovement(f.operator, {
          type: "EXIT",
          productId: f.productId,
          sourceId: f.sourceId,
          quantity: 80,
          idempotencyKey: requestKey(),
        }),
      ),
    );
    assert.equal(
      results.filter((result) => result.status === "fulfilled").length,
      1,
    );
    const rejected = results.find((result) => result.status === "rejected");
    assert.equal((rejected as PromiseRejectedResult).reason.status, 409);
    assert.equal(await balance(f.sourceId), "20.000");
    assert.equal(
      await db.stockMovement.count({
        where: { productId: f.productId, type: "EXIT" },
      }),
      1,
    );
  });

  test("configuração legada de negativo não permite disponível negativo no fluxo atual", async () => {
    await db.appSettings.update({
      where: { unitId: f.unitId },
      data: { allowNegativeStock: true },
    });
    await assert.rejects(createMovement(f.operator, {
      type: "EXIT",
      productId: f.productId,
      sourceId: f.sourceId,
      quantity: 2,
      idempotencyKey: requestKey(),
    }), statusIs(409));
    assert.equal(await balance(f.sourceId), "0.000");
    assert.equal(await db.stockMovement.count({ where: { productId: f.productId } }), 0);
  });

  test("códigos podem repetir em unidades distintas sem permitir movimentação cruzada", async () => {
    const own = await db.product.findUniqueOrThrow({ where: { id: f.productId } });
    const foreign = await db.product.findUniqueOrThrow({ where: { id: f.otherProductId } });
    assert.equal(own.internalCode, foreign.internalCode);
    await assert.rejects(enter(1, f.sourceId, f.otherProductId), statusIs(404));
    await assert.rejects(enter(1, f.otherLocationId), statusIs(404));
    assert.equal(await db.stockMovement.count({ where: { userId: f.operator.id } }), 0);
    assert.equal(await db.inventoryBalance.count({ where: { productId: f.otherProductId } }), 0);
  });

  test("transferência entre unidades é recusada integralmente", async () => {
    await enter(100);
    await assert.rejects(createMovement(f.operator, {
      type: "TRANSFER", productId: f.productId, quantity: "25",
      sourceId: f.sourceId, destinationId: f.otherLocationId,
      idempotencyKey: requestKey(),
    }), statusIs(404));
    assert.equal(await balance(f.sourceId), "100.000");
    assert.equal(await db.stockMovement.count({ where: { productId: f.productId } }), 1);
    assert.equal(await db.inventoryBalance.count({ where: { locationId: f.otherLocationId } }), 0);
  });

  test("idempotência inclui a unidade e não revela operação de outro escopo", async () => {
    const payload = { type: "ENTRY", productId: f.productId, destinationId: f.sourceId, quantity: "5", idempotencyKey: requestKey() };
    await createMovement(f.operator, payload);
    await assert.rejects(createMovement({ ...f.operator, unitId: f.otherUnitId }, payload), statusIs(409));
    assert.equal(await balance(f.sourceId), "5.000");
  });

  test("registro legado sem unidade permanece inacessível pelo fluxo operacional", async () => {
    const legacy = await db.product.create({ data: { internalCode: `TEST-LEGACY-${randomUUID()}`, name: "Legado sem classificação" } });
    f.productIds.push(legacy.id);
    await assert.rejects(enter(1, f.sourceId, legacy.id), statusIs(404));
    assert.equal(await db.inventoryBalance.count({ where: { productId: legacy.id } }), 0);
  });

  test("operação sem unidade autorizada falha antes de qualquer gravação", async () => {
    await assert.rejects(createMovement({ ...f.operator, unitId: "" }, {
      type: "ENTRY", productId: f.productId, destinationId: f.sourceId, quantity: "5", idempotencyKey: requestKey(),
    }), statusIs(403));
    assert.equal(await db.stockMovement.count({ where: { productId: f.productId } }), 0);
  });
});

describe("inventário e aprovação", () => {
  test("contagem e aprovação não atravessam o escopo da unidade", async () => {
    await assert.rejects(createInventoryCount(f.operator, {
      locationId: f.otherLocationId,
      items: [{ productId: f.otherProductId, expectedQuantity: "0", countedQuantity: "1" }],
      note: "Teste de escopo", idempotencyKey: requestKey(),
    }), statusIs(404));
    await enter(10);
    const inventory = await count(10, 9);
    await assert.rejects(approveInventoryCount({ ...f.admin, unitId: f.otherUnitId }, inventory.id), statusIs(404));
    assert.equal(await balance(f.sourceId), "10.000");
    assert.equal((await db.inventoryCount.findUniqueOrThrow({ where: { id: inventory.id } })).status, "PENDING");
  });
  test("operador registra contagem pendente sem sobrescrever o saldo", async () => {
    await enter(100);
    const inventory = await count(100, 97);
    assert.equal(inventory.status, "PENDING");
    assert.equal(inventory.unitId, f.unitId);
    assert.ok(inventory.items.every((item) => item.unitId === f.unitId), "Itens precisam do escopo para aparecer nos relatórios de inventário e divergências.");
    assert.equal(await balance(f.sourceId), "100.000");
    const item = await db.inventoryCountItem.findFirstOrThrow({
      where: { countId: inventory.id },
    });
    assert.equal(item.unitId, f.unitId);
    assert.equal(await db.inventoryCountItem.count({ where: { countId: inventory.id, unitId: f.unitId } }), 1);
    assert.equal(item.difference.toFixed(3), "-3.000");
    assert.equal(
      await db.stockMovement.count({
        where: { inventoryCountId: inventory.id },
      }),
      0,
    );
  });

  test("operador não aprova ajustes e usuário sem inventory:count não conta", async () => {
    await enter(100);
    const inventory = await count(100, 97);
    await assert.rejects(
      approveInventoryCount(f.operator, inventory.id),
      statusIs(403),
    );
    await assert.rejects(
      createInventoryCount(
        { id: f.operator.id, unitId: f.unitId, permissions: ["stock:move"] },
        {
          locationId: f.sourceId,
          items: [
            {
              productId: f.productId,
              expectedQuantity: 100,
              countedQuantity: 97,
            },
          ],
          note: "Contagem sem permissão",
          idempotencyKey: requestKey(),
        },
      ),
      statusIs(403),
    );
    assert.equal(await balance(f.sourceId), "100.000");
  });

  test("aprovação registra ajuste -3, responsável, antes/depois e auditoria", async () => {
    await enter(100);
    const inventory = await count(100, 97);
    const approved = await approveInventoryCount(f.admin, inventory.id);
    assert.equal(approved.status, "APPROVED");
    assert.equal(approved.approvedById, f.admin.id);
    assert.ok(approved.approvedAt);
    assert.equal(await balance(f.sourceId), "97.000");
    const movement = await db.stockMovement.findFirstOrThrow({
      where: { inventoryCountId: inventory.id },
    });
    assert.equal(movement.type, "ADJUSTMENT");
    assert.equal(movement.userId, f.admin.id);
    assert.equal(movement.quantity.abs().toFixed(3), "3.000");
    assert.ok(
      await db.auditLog.findFirst({
        where: { entityId: movement.id, userId: f.admin.id },
      }),
    );
    assert.ok(
      await db.auditLog.findFirst({
        where: { entityId: inventory.id, userId: f.admin.id },
      }),
    );
  });

  test("aprovação repetida não aplica a divergência duas vezes", async () => {
    await enter(100);
    const inventory = await count(100, 97);
    const results = await Promise.all([
      approveInventoryCount(f.admin, inventory.id),
      approveInventoryCount(f.admin, inventory.id),
    ]);
    assert.equal(results[0].id, results[1].id);
    assert.equal(await balance(f.sourceId), "97.000");
    assert.equal(
      await db.stockMovement.count({
        where: { inventoryCountId: inventory.id },
      }),
      1,
    );
  });

  test("contagem repetida com mesma chave não duplica inventário", async () => {
    await enter(100);
    const key = requestKey();
    const first = await count(100, 97, { idempotencyKey: key });
    const repeated = await count(100, 97, { idempotencyKey: key });
    assert.equal(first.id, repeated.id);
    assert.equal(
      await db.inventoryCount.count({ where: { locationId: f.sourceId } }),
      1,
    );
  });

  test("snapshot já obsoleto no envio não cria contagem", async () => {
    await enter(100);
    await assert.rejects(count(99, 97), statusIs(409));
    assert.equal(
      await db.inventoryCount.count({ where: { locationId: f.sourceId } }),
      0,
    );
    assert.equal(await balance(f.sourceId), "100.000");
  });

  test("movimentação posterior à contagem impede aprovação e mantém histórico original", async () => {
    await enter(100);
    const inventory = await count(100, 97);
    await enter(1);
    await assert.rejects(
      approveInventoryCount(f.admin, inventory.id),
      statusIs(409),
    );
    assert.equal(await balance(f.sourceId), "101.000");
    assert.equal(
      (
        await db.inventoryCount.findUniqueOrThrow({
          where: { id: inventory.id },
        })
      ).status,
      "PENDING",
    );
    assert.equal(
      await db.stockMovement.count({
        where: { inventoryCountId: inventory.id },
      }),
      0,
    );
  });

  test("saldo que mudou e voltou ao valor inicial também invalida a contagem", async () => {
    await enter(100);
    const inventory = await count(100, 97);
    await enter(1);
    await createMovement(f.operator, {
      type: "EXIT",
      productId: f.productId,
      sourceId: f.sourceId,
      quantity: 1,
      idempotencyKey: requestKey(),
    });
    assert.equal(await balance(f.sourceId), "100.000");
    await assert.rejects(
      approveInventoryCount(f.admin, inventory.id),
      statusIs(409),
    );
    assert.equal(await balance(f.sourceId), "100.000");
    assert.equal(
      await db.stockMovement.count({
        where: { inventoryCountId: inventory.id },
      }),
      0,
    );
  });

  test("falha no segundo item desfaz integralmente ajustes de um inventário com vários produtos", async () => {
    const product = await db.product.create({
      data: { internalCode: `TEST-${randomUUID()}`, name: "Porca M8", unitId: f.unitId },
    });
    f.productIds.push(product.id);
    await enter(100);
    await enter(20, f.sourceId, product.id);
    const inventory = await createInventoryCount(f.operator, {
      locationId: f.sourceId,
      items: [
        { productId: f.productId, expectedQuantity: 100, countedQuantity: 97 },
        { productId: product.id, expectedQuantity: 20, countedQuantity: 18 },
      ],
      note: "Conferência física conjunta",
      idempotencyKey: requestKey(),
    });
    await enter(1, f.sourceId, product.id);
    await assert.rejects(
      approveInventoryCount(f.admin, inventory.id),
      statusIs(409),
    );
    assert.equal(await balance(f.sourceId), "100.000");
    assert.equal(await balance(f.sourceId, product.id), "21.000");
    assert.equal(
      await db.stockMovement.count({
        where: { inventoryCountId: inventory.id },
      }),
      0,
    );
    assert.equal(
      (
        await db.inventoryCount.findUniqueOrThrow({
          where: { id: inventory.id },
        })
      ).status,
      "PENDING",
    );
  });
});
