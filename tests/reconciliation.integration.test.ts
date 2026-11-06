import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, afterEach, before, beforeEach, test } from "node:test";
import type { PrismaClient } from "@prisma/client";
import type { StockActor } from "../src/services/stock";

const testUrl = process.env.TEST_DATABASE_URL;
if (!testUrl)
  throw new Error("Defina TEST_DATABASE_URL para uma base isolada de testes.");
const parsed = new URL(testUrl);
const databaseName = decodeURIComponent(parsed.pathname.slice(1));
if (
  !["postgres:", "postgresql:"].includes(parsed.protocol) ||
  !/(^|[_-])tests?([_-]|$)/i.test(databaseName)
)
  throw new Error("Use somente uma base isolada com test no nome.");
process.env.DATABASE_URL = testUrl;
process.env.DIRECT_URL = testUrl;

let db: PrismaClient;
let reconciliation: typeof import("../src/services/reconciliation");
let costs: typeof import("../src/services/order-costs");
let fixture: {
  orgId: string;
  roleId: string;
  userId: string;
  unitIds: string[];
  unitCodes: string[];
  productIds: string[];
  locationIds: string[];
  actor: StockActor;
  other: StockActor;
};
const key = randomUUID;
const status = (expected: number) => (error: unknown) => {
  assert.equal((error as { status?: number }).status, expected);
  return true;
};

before(async () => {
  ({ prisma: db } = await import("../src/lib/db"));
  reconciliation = await import("../src/services/reconciliation");
  costs = await import("../src/services/order-costs");
  const result = await db.$queryRaw<
    Array<{ name: string }>
  >`SELECT current_database()::text AS name`;
  assert.equal(result[0].name, databaseName);
});
beforeEach(async () => {
  const suffix = key();
  const org = await db.organization.create({
    data: { name: `TEST-RECON-${suffix}` },
  });
  const role = await db.role.create({ data: { name: `TEST-RECON-${suffix}` } });
  const user = await db.user.create({
    data: {
      name: "Conferente teste",
      email: `${suffix}@example.invalid`,
      roleId: role.id,
    },
  });
  const units = await Promise.all(
    ["A", "B"].map((label) =>
      db.operationalUnit.create({
        data: {
          organizationId: org.id,
          code: `TEST-RECON-${label}-${suffix}`,
          name: `Unidade teste ${label}`,
          memberships: { create: { userId: user.id, roleId: role.id } },
        },
      }),
    ),
  );
  const warehouses = await Promise.all(
    units.map((unit) =>
      db.warehouse.create({
        data: { unitId: unit.id, code: "ALM", name: "Almox teste" },
      }),
    ),
  );
  const locations = await Promise.all(
    warehouses.map((warehouse, i) =>
      db.location.create({
        data: {
          unitId: units[i].id,
          warehouseId: warehouse.id,
          code: "L-1",
          name: "Local teste",
        },
      }),
    ),
  );
  const products = await Promise.all(
    units.map((unit) =>
      db.product.create({
        data: {
          unitId: unit.id,
          internalCode: "P-1",
          name: "Peça teste",
          unit: "UN",
          unitCost: "2.50",
        },
      }),
    ),
  );
  await Promise.all(
    units.map((unit, i) =>
      db.inventoryBalance.create({
        data: {
          unitId: unit.id,
          productId: products[i].id,
          locationId: locations[i].id,
          quantity: i === 0 ? "50.125" : "999",
        },
      }),
    ),
  );
  const permissions = ["reports:read", "costs:read"];
  fixture = {
    orgId: org.id,
    roleId: role.id,
    userId: user.id,
    unitIds: units.map((u) => u.id),
    unitCodes: units.map((u) => u.code),
    productIds: products.map((p) => p.id),
    locationIds: locations.map((l) => l.id),
    actor: { id: user.id, unitId: units[0].id, permissions },
    other: { id: user.id, unitId: units[1].id, permissions },
  };
});
afterEach(async () => {
  if (!fixture) return;
  const where = { unitId: { in: fixture.unitIds } };
  await db.$transaction(async (tx) => {
    await tx.idempotencyRecord.deleteMany({ where });
    await tx.auditLog.deleteMany({ where });
    await tx.reconciliationBatch.deleteMany({ where });
    await tx.orderMaterial.deleteMany({ where });
    await tx.workOrder.deleteMany({ where });
    await tx.inventoryBalance.deleteMany({ where });
    await tx.product.deleteMany({ where });
    await tx.location.deleteMany({ where });
    await tx.warehouse.deleteMany({ where });
    await tx.unitMembership.deleteMany({ where });
    await tx.operationalUnit.deleteMany({
      where: { id: { in: fixture.unitIds } },
    });
    await tx.user.delete({ where: { id: fixture.userId } });
    await tx.role.delete({ where: { id: fixture.roleId } });
    await tx.organization.delete({ where: { id: fixture.orgId } });
  });
});
after(async () => {
  await db?.$disconnect();
});

function stockInput(csv?: string) {
  return {
    kind: "STOCK",
    sourceName: "Exportação ERP teste",
    referenceAt: new Date().toISOString(),
    delimiter: ";",
    decimalFormat: "BR",
    csv:
      csv ??
      `unidade;produto;local;quantidade\n${fixture.unitCodes[0]};P-1;L-1;48,125`,
  };
}
async function order(
  code: string,
  unitIndex = 0,
  unitCost: string | null = "2.50",
  consumed = "10",
  returned = "2",
) {
  return db.workOrder.create({
    data: {
      unitId: fixture.unitIds[unitIndex],
      userId: fixture.userId,
      code,
      title: "Ordem de teste",
      kind: "PRODUCTION",
      status: "INVOICED",
      invoicedAt: new Date(),
      invoiceReference: `NF-${code}`,
      materials: {
        create: {
          unitId: fixture.unitIds[unitIndex],
          productId: fixture.productIds[unitIndex],
          locationId: fixture.locationIds[unitIndex],
          requestedQuantity: consumed,
          consumedQuantity: consumed,
          returnedQuantity: returned,
          invoicedUnitCost: unitCost,
        },
      },
    },
  });
}

test("conciliação compara ledger, mantém saldos e persiste documento/auditoria uma vez", async () => {
  const input = stockInput();
  const preview = await reconciliation.previewReconciliation(
    fixture.actor,
    input,
  );
  assert.equal(preview.rows[0].localValue, "50.125");
  assert.equal(preview.rows[0].externalValue, "48.125");
  assert.equal(preview.rows[0].difference, "2.000");
  assert.equal(preview.totals.differences, 1);
  assert.equal(
    await db.reconciliationBatch.count({
      where: { unitId: fixture.unitIds[0] },
    }),
    0,
  );
  const idempotencyKey = key();
  const batch = await reconciliation.saveReconciliation(fixture.actor, {
    ...input,
    idempotencyKey,
  });
  assert.equal(
    (
      await reconciliation.saveReconciliation(fixture.actor, {
        ...input,
        idempotencyKey,
      })
    ).id,
    batch.id,
  );
  assert.equal(await db.auditLog.count({ where: { entityId: batch.id } }), 1);
  assert.equal(
    (
      await db.inventoryBalance.findUniqueOrThrow({
        where: {
          productId_locationId: {
            productId: fixture.productIds[0],
            locationId: fixture.locationIds[0],
          },
        },
      })
    ).quantity.toFixed(3),
    "50.125",
  );
  assert.equal(
    await db.stockMovement.count({ where: { unitId: fixture.unitIds[0] } }),
    0,
  );
  await assert.rejects(
    reconciliation.saveReconciliation(fixture.actor, {
      ...input,
      sourceName: "Outro arquivo ERP",
      idempotencyKey,
    }),
    status(409),
  );
  await assert.rejects(
    reconciliation.getReconciliation(fixture.other, batch.id),
    status(404),
  );
});

test("salvar recalcula prévia e valida unidade/códigos/duplicatas de forma integral", async () => {
  const input = stockInput();
  await reconciliation.previewReconciliation(fixture.actor, input);
  await db.inventoryBalance.update({
    where: {
      productId_locationId: {
        productId: fixture.productIds[0],
        locationId: fixture.locationIds[0],
      },
    },
    data: { quantity: "51.125" },
  });
  const batch = await reconciliation.saveReconciliation(fixture.actor, {
    ...input,
    idempotencyKey: key(),
  });
  assert.equal(
    (batch.result as { rows: { difference: string }[] }).rows[0].difference,
    "3.000",
  );
  const rows = [
    `${fixture.unitCodes[1]};P-1;L-1;2`,
    `${fixture.unitCodes[0]};UNKNOWN;L-1;2`,
    `${fixture.unitCodes[0]};P-1;UNKNOWN;2`,
    `${fixture.unitCodes[0]};P-1;L-1;2\n${fixture.unitCodes[0]};P-1;L-1;3`,
    `${fixture.unitCodes[0]};P-1;L-1;1.234,50`,
  ];
  for (const row of rows) {
    await assert.rejects(
      reconciliation.saveReconciliation(fixture.actor, {
        ...stockInput(`unidade;produto;local;quantidade\n${row}`),
        idempotencyKey: key(),
      }),
      status(400),
    );
  }
  assert.equal(
    await db.reconciliationBatch.count({
      where: { unitId: fixture.unitIds[0] },
    }),
    1,
  );
});

test("csv aceita decimal BR entre aspas com delimitador vírgula e números canônicos explícitos", async () => {
  const csv = `unidade,produto,local,quantidade\r\n${fixture.unitCodes[0]},P-1,L-1,"50,125"`;
  assert.equal(
    (
      await reconciliation.previewReconciliation(fixture.actor, {
        ...stockInput(csv),
        delimiter: ",",
      })
    ).rows[0].status,
    "MATCH",
  );
  assert.equal(
    (
      await reconciliation.previewReconciliation(fixture.actor, {
        ...stockInput(
          `unidade;produto;local;quantidade\n${fixture.unitCodes[0]};P-1;L-1;50.125`,
        ),
        decimalFormat: "CANONICAL",
      })
    ).rows[0].status,
    "MATCH",
  );
  await assert.rejects(
    reconciliation.previewReconciliation(fixture.actor, {
      ...stockInput(csv),
      delimiter: ";",
    }),
    status(400),
  );
});

test("custo histórico usa consumo líquido, não muda com preço atual e não inventa preço ausente", async () => {
  const known = await order("OP-KNOWN");
  await order("OP-MISSING", 0, null);
  await order("OP-ZERO-NET", 0, null, "2", "2");
  await order("OP-OTHER", 1, "99.00");
  await db.product.update({
    where: { id: fixture.productIds[0] },
    data: { unitCost: "777.00" },
  });
  const report = await costs.listOrderCosts(fixture.actor);
  assert.equal(report.total, 3);
  assert.equal(
    report.orders.find((o) => o.code === "OP-KNOWN")?.netMaterialCost,
    "20.00",
  );
  assert.equal(
    report.orders.find((o) => o.code === "OP-KNOWN")?.materials[0]
      .invoicedUnitCost,
    "2.50",
  );
  assert.equal(
    report.orders.find((o) => o.code === "OP-MISSING")?.netMaterialCost,
    null,
  );
  assert.equal(
    report.orders.find((o) => o.code === "OP-MISSING")?.missingCostCount,
    1,
  );
  assert.equal(
    report.orders.find((o) => o.code === "OP-ZERO-NET")?.netMaterialCost,
    "0.00",
  );
  assert.equal(
    report.orders.some((o) => o.code === "OP-OTHER"),
    false,
  );
  const material = await db.orderMaterial.findFirstOrThrow({
    where: { orderId: known.id },
  });
  await assert.rejects(
    db.orderMaterial.update({
      where: { id: material.id },
      data: { invoicedUnitCost: "99.00" },
    }),
  );
  await assert.rejects(
    costs.listOrderCosts({ ...fixture.actor, permissions: ["reports:read"] }),
    status(403),
  );
});

test("custos na conciliação exigem permissão e histórico não vaza no acesso de estoque", async () => {
  await order("OP-1");
  const input = {
    ...stockInput(),
    kind: "ORDER_COST",
    csv: `unidade;ordem;custo\n${fixture.unitCodes[0]};OP-1;20,00`,
  };
  const comparison = await reconciliation.previewReconciliation(
    fixture.actor,
    input,
  );
  assert.equal(comparison.rows[0].status, "MATCH");
  const batch = await reconciliation.saveReconciliation(fixture.actor, {
    ...input,
    idempotencyKey: key(),
  });
  const stockOnly = { ...fixture.actor, permissions: ["reports:read"] };
  await assert.rejects(
    reconciliation.previewReconciliation(stockOnly, input),
    status(403),
  );
  await assert.rejects(
    reconciliation.getReconciliation(stockOnly, batch.id),
    status(404),
  );
  assert.deepEqual(await reconciliation.listReconciliations(stockOnly), []);
  assert.equal(
    (await reconciliation.listReconciliations(fixture.actor)).length,
    1,
  );
  await assert.rejects(
    reconciliation.previewReconciliation(
      { ...fixture.actor, permissions: ["costs:read"] },
      input,
    ),
    status(403),
  );
});

test("ordem sem custo fica incompleta e ordem aberta não é conciliada como faturada", async () => {
  await order("OP-MISSING", 0, null);
  const input = {
    ...stockInput(),
    kind: "ORDER_COST",
    csv: `unidade;ordem;custo\n${fixture.unitCodes[0]};OP-MISSING;0,00`,
  };
  const comparison = await reconciliation.previewReconciliation(
    fixture.actor,
    input,
  );
  assert.equal(comparison.rows[0].status, "INCOMPLETE");
  assert.equal(comparison.rows[0].localValue, null);
  assert.equal(comparison.rows[0].difference, null);
  await db.workOrder.create({
    data: {
      unitId: fixture.unitIds[0],
      userId: fixture.userId,
      code: "OPEN-1",
      title: "Aberta teste",
      kind: "SERVICE",
    },
  });
  await assert.rejects(
    reconciliation.previewReconciliation(fixture.actor, {
      ...input,
      csv: `unidade;ordem;custo\n${fixture.unitCodes[0]};OPEN-1;0,00`,
    }),
    status(400),
  );
});

test("limites, datas e permissão de relatório são checados antes de salvar", async () => {
  await assert.rejects(
    reconciliation.previewReconciliation(
      { ...fixture.actor, permissions: [] },
      stockInput(),
    ),
    status(403),
  );
  await assert.rejects(
    reconciliation.saveReconciliation(fixture.actor, {
      ...stockInput(),
      referenceAt: new Date(Date.now() + 3600000).toISOString(),
      idempotencyKey: key(),
    }),
    status(400),
  );
  await assert.rejects(
    reconciliation.previewReconciliation(
      fixture.actor,
      stockInput("é".repeat(600000)),
    ),
    status(400),
  );
  const request = new Request("http://localhost/api/reconciliation", {
    method: "POST",
    headers: { "content-length": "2300000" },
    body: "{}",
  });
  await assert.rejects(
    reconciliation.readReconciliationBody(request),
    status(413),
  );
  assert.equal(
    await db.reconciliationBatch.count({
      where: { unitId: fixture.unitIds[0] },
    }),
    0,
  );
});
