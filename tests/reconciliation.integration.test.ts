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
let review: typeof import("../src/services/reconciliation-review");
let fixture: {
  orgId: string;
  roleId: string;
  userId: string;
  reviewerId: string;
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
  review = await import("../src/services/reconciliation-review");
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
  for (const permissionKey of ["reports:read", "costs:read"]) {
    const permission = await db.permission.upsert({
      where: { key: permissionKey },
      create: { key: permissionKey },
      update: {},
    });
    await db.rolePermission.create({
      data: { roleId: role.id, permissionId: permission.id },
    });
  }
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
  const reviewer = await db.user.create({
    data: {
      name: "Revisor teste",
      email: `reviewer-${suffix}@example.invalid`,
      roleId: role.id,
      memberships: { create: { unitId: units[0].id, roleId: role.id } },
    },
  });
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
    reviewerId: reviewer.id,
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
    await tx.user.deleteMany({
      where: { id: { in: [fixture.userId, fixture.reviewerId] } },
    });
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

function controlledInput(value = "50,125") {
  return {
    ...stockInput(
      `unidade;produto;local;quantidade\n${fixture.unitCodes[0]};P-1;L-1;${value}`,
    ),
    context: {
      erpName: "ERP de teste",
      cutoffNote: "Lançamentos encerrados antes da exportação de teste.",
      basis: "LEDGER_BALANCE",
    },
  };
}
function reviewer(): StockActor {
  return { ...fixture.actor, id: fixture.reviewerId };
}
async function controlledBatch(value = "50,125") {
  return reconciliation.saveReconciliation(fixture.actor, {
    ...controlledInput(value),
    idempotencyKey: key(),
  });
}
function reviewInput(
  batch: { result: unknown },
  overrides: Record<string, unknown> = {},
) {
  return {
    decision: "ACCEPT",
    note: "Conferência concluída com os documentos de teste.",
    analyses: [],
    snapshotHash: (batch.result as { snapshotHash: string }).snapshotHash,
    idempotencyKey: key(),
    ...overrides,
  };
}

test("associação explícita aceita colunas do ERP e descarta colunas sem uso", async () => {
  const input = {
    ...controlledInput(),
    mapping: {
      unit: "Filial",
      code: "Item",
      location: "Depósito",
      value: "Saldo",
    },
    csv: `Filial;Descrição;Item;Depósito;Saldo;Observação\n${fixture.unitCodes[0]};Texto não importado;P-1;L-1;50,125;DADO EXTRA PRIVADO`,
  };
  const result = await reconciliation.previewReconciliation(
    fixture.actor,
    input,
  );
  assert.equal(result.rows[0].status, "MATCH");
  assert.ok(result.source?.fingerprint);
  assert.equal(result.source?.erpName, "ERP de teste");
  assert.equal(JSON.stringify(result).includes("DADO EXTRA PRIVADO"), false);
  const batch = await reconciliation.saveReconciliation(fixture.actor, {
    ...input,
    idempotencyKey: key(),
  });
  assert.equal(batch.review.status, "PENDING");
  assert.equal(batch.review.canReview, false);
  const opened = await reconciliation.getReconciliation(reviewer(), batch.id);
  assert.equal(opened.review.canReview, true);
  for (const mapping of [
    { ...input.mapping, code: "Inexistente" },
    { ...input.mapping, code: "Filial" },
  ]) {
    await assert.rejects(
      reconciliation.previewReconciliation(fixture.actor, {
        ...input,
        mapping,
      }),
      status(400),
    );
  }
});

test("exportação repetida por outra pessoa ou outro formato abre o mesmo documento", async () => {
  const input = controlledInput();
  const first = await reconciliation.saveReconciliation(fixture.actor, {
    ...input,
    idempotencyKey: key(),
  });
  await db.inventoryBalance.update({
    where: {
      productId_locationId: {
        productId: fixture.productIds[0],
        locationId: fixture.locationIds[0],
      },
    },
    data: { quantity: "60" },
  });
  const duplicate = await reconciliation.saveReconciliation(reviewer(), {
    ...input,
    decimalFormat: "CANONICAL",
    delimiter: ",",
    csv: `unidade,produto,local,quantidade\r\n${fixture.unitCodes[0]},P-1,L-1,050.125`,
    idempotencyKey: key(),
  });
  assert.equal(duplicate.id, first.id);
  assert.equal("reused" in duplicate && duplicate.reused, true);
  assert.equal(
    (duplicate.result as { rows: { localValue: string }[] }).rows[0].localValue,
    "50.125",
  );
  assert.equal(
    await db.reconciliationBatch.count({
      where: { unitId: fixture.unitIds[0] },
    }),
    1,
  );
  assert.equal(
    await db.auditLog.count({
      where: { unitId: fixture.unitIds[0], action: "RECONCILIATION_CREATED" },
    }),
    1,
  );
  await assert.rejects(
    reconciliation.saveReconciliation(fixture.actor, {
      ...input,
      context: {
        ...input.context,
        cutoffNote: "Outro critério de corte de teste.",
      },
      idempotencyKey: key(),
    }),
    status(409),
  );
});

test("importações concorrentes do mesmo arquivo criam um só documento", async () => {
  const input = controlledInput();
  const docs = await Promise.all(
    [fixture.actor, reviewer()].map((actor) =>
      reconciliation.saveReconciliation(actor, {
        ...input,
        idempotencyKey: key(),
      }),
    ),
  );
  assert.equal(docs[0].id, docs[1].id);
  assert.equal(
    await db.reconciliationBatch.count({
      where: { unitId: fixture.unitIds[0] },
    }),
    1,
  );
});

test("revisão independente confere valores e preserva documento, saldo e auditoria única", async () => {
  const batch = await controlledBatch();
  const input = reviewInput(batch);
  await assert.rejects(
    review.reviewReconciliation(fixture.actor, batch.id, input),
    status(403),
  );
  const done = await review.reviewReconciliation(reviewer(), batch.id, input);
  assert.equal(done.review.status, "MATCHED");
  assert.equal(done.review.reviewerName, "Revisor teste");
  assert.deepEqual(done.result, batch.result);
  assert.equal(
    (await review.reviewReconciliation(reviewer(), batch.id, input)).review
      .status,
    "MATCHED",
  );
  assert.equal(
    await db.auditLog.count({
      where: { entityId: batch.id, action: "RECONCILIATION_REVIEWED" },
    }),
    1,
  );
  await assert.rejects(
    review.reviewReconciliation(reviewer(), batch.id, reviewInput(batch)),
    status(409),
  );
  await assert.rejects(
    review.reviewReconciliation(fixture.other, batch.id, reviewInput(batch)),
    status(404),
  );
  assert.equal(
    await db.stockMovement.count({ where: { unitId: fixture.unitIds[0] } }),
    0,
  );
  const balance = await db.inventoryBalance.findFirstOrThrow({
    where: { unitId: fixture.unitIds[0] },
  });
  assert.equal(balance.quantity.toFixed(3), "50.125");
});

test("todas as diferenças exigem causa, análise e referência antes de concluir com ressalvas", async () => {
  const batch = await controlledBatch("48,125");
  await assert.rejects(
    review.reviewReconciliation(reviewer(), batch.id, reviewInput(batch)),
    status(400),
  );
  const analysis = {
    code: "P-1",
    location: "L-1",
    cause: "POSTING",
    note: "Aplicação da ordem de teste não foi lançada no ERP.",
    reference: "OP-TEST-1",
  };
  await assert.rejects(
    review.reviewReconciliation(
      reviewer(),
      batch.id,
      reviewInput(batch, { analyses: [analysis, analysis] }),
    ),
    status(400),
  );
  await assert.rejects(
    review.reviewReconciliation(
      reviewer(),
      batch.id,
      reviewInput(batch, { analyses: [{ ...analysis, code: "OUTRO" }] }),
    ),
    status(400),
  );
  const done = await review.reviewReconciliation(
    reviewer(),
    batch.id,
    reviewInput(batch, { analyses: [analysis] }),
  );
  assert.equal(done.review.status, "WITH_DIFFERENCES");
  assert.equal(done.review.analyses[0].reference, "OP-TEST-1");
  assert.equal(
    (done.result as { rows: { difference: string }[] }).rows[0].difference,
    "2.000",
  );
  assert.equal(
    await db.stockMovement.count({ where: { unitId: fixture.unitIds[0] } }),
    0,
  );
});

test("custo ausente bloqueia conclusão e permite devolver com orientação registrada", async () => {
  await order("OP-SEM-CUSTO", 0, null);
  const input = {
    ...controlledInput(),
    kind: "ORDER_COST",
    context: { ...controlledInput().context, basis: "INVOICED_MATERIALS" },
    csv: `unidade;ordem;custo\n${fixture.unitCodes[0]};OP-SEM-CUSTO;0,00`,
  };
  const batch = await reconciliation.saveReconciliation(fixture.actor, {
    ...input,
    idempotencyKey: key(),
  });
  await assert.rejects(
    review.reviewReconciliation(reviewer(), batch.id, reviewInput(batch)),
    status(409),
  );
  const done = await review.reviewReconciliation(
    reviewer(),
    batch.id,
    reviewInput(batch, {
      decision: "RETURN",
      note: "Verificar o custo histórico no documento da ordem.",
    }),
  );
  assert.equal(done.review.status, "RETURNED");
  assert.equal(done.review.canReview, false);
});

test("saldo alterado exige nova conferência, com vínculo e preservação da revisão anterior", async () => {
  const batch = await controlledBatch();
  await db.inventoryBalance.update({
    where: {
      productId_locationId: {
        productId: fixture.productIds[0],
        locationId: fixture.locationIds[0],
      },
    },
    data: { quantity: "49" },
  });
  await assert.rejects(
    review.reviewReconciliation(reviewer(), batch.id, reviewInput(batch)),
    (error) => {
      assert.equal((error as { code: string }).code, "RECONCILIATION_CHANGED");
      return true;
    },
  );
  assert.equal(
    await db.auditLog.count({
      where: { entityId: batch.id, action: "RECONCILIATION_REVIEWED" },
    }),
    0,
  );
  const input = await review.getReconciliationRecheck(reviewer(), batch.id);
  const revisions = await Promise.all(
    [fixture.actor, reviewer()].map((actor) =>
      reconciliation.saveReconciliation(actor, {
        ...input,
        idempotencyKey: key(),
      }),
    ),
  );
  assert.equal(revisions[0].id, revisions[1].id);
  assert.notEqual(revisions[0].id, batch.id);
  const snapshot = revisions[0].result as {
    source: { revision: number; previousBatchId: string };
    rows: { localValue: string }[];
  };
  assert.equal(snapshot.source.revision, 2);
  assert.equal(snapshot.source.previousBatchId, batch.id);
  assert.equal(snapshot.rows[0].localValue, "49.000");
  const original = await reconciliation.getReconciliation(reviewer(), batch.id);
  assert.deepEqual(original.result, batch.result);
  assert.equal(original.review.nextBatchId, revisions[0].id);
  assert.equal(original.review.canReview, false);
  await assert.rejects(
    review.reviewReconciliation(reviewer(), batch.id, reviewInput(batch)),
    status(409),
  );
});

test("revisões concorrentes têm um único parecer e repetição segura da mesma operação", async () => {
  const batch = await controlledBatch();
  const input = reviewInput(batch);
  const both = await Promise.all(
    [1, 2].map(() => review.reviewReconciliation(reviewer(), batch.id, input)),
  );
  assert.equal(both[0].review.status, "MATCHED");
  assert.equal(both[1].review.status, "MATCHED");
  assert.equal(
    await db.auditLog.count({
      where: { entityId: batch.id, action: "RECONCILIATION_REVIEWED" },
    }),
    1,
  );
});

test("acesso revogado no banco bloqueia criação e revisão mesmo com permissões antigas na sessão", async () => {
  const batch = await controlledBatch();
  await db.unitMembership.update({
    where: {
      userId_unitId: { userId: fixture.reviewerId, unitId: fixture.unitIds[0] },
    },
    data: { active: false },
  });
  await assert.rejects(
    review.reviewReconciliation(reviewer(), batch.id, reviewInput(batch)),
    status(403),
  );
  await assert.rejects(
    reconciliation.saveReconciliation(reviewer(), {
      ...controlledInput(),
      idempotencyKey: key(),
    }),
    status(403),
  );
  assert.equal(
    await db.auditLog.count({
      where: { entityId: batch.id, action: "RECONCILIATION_REVIEWED" },
    }),
    0,
  );
});

test("registro anterior permanece consultável e não ganha confirmação retroativa", async () => {
  const batch = await reconciliation.saveReconciliation(fixture.actor, {
    ...stockInput(),
    idempotencyKey: key(),
  });
  assert.equal(batch.review.status, "LEGACY");
  assert.equal(batch.review.canReview, false);
  await assert.rejects(
    review.reviewReconciliation(reviewer(), batch.id, reviewInput(batch)),
    status(409),
  );
  await assert.rejects(
    review.getReconciliationRecheck(reviewer(), batch.id),
    status(400),
  );
  const prior = JSON.parse(JSON.stringify(batch.result));
  delete prior.source;
  delete prior.schemaVersion;
  delete prior.snapshotHash;
  await db.reconciliationBatch.update({
    where: { id: batch.id },
    data: { result: prior },
  });
  assert.equal(
    (await reconciliation.getReconciliation(reviewer(), batch.id)).review
      .status,
    "LEGACY",
  );
});

test("critérios incompatíveis, hash adulterado e extensão da unidade são recusados", async () => {
  await assert.rejects(
    reconciliation.previewReconciliation(fixture.actor, {
      ...controlledInput(),
      context: { ...controlledInput().context, basis: "INVOICED_MATERIALS" },
    }),
    status(400),
  );
  const batch = await controlledBatch();
  await assert.rejects(
    review.reviewReconciliation(
      reviewer(),
      batch.id,
      reviewInput(batch, { snapshotHash: "f".repeat(64) }),
    ),
    status(409),
  );
  await assert.rejects(
    reconciliation.saveReconciliation(fixture.other, {
      ...controlledInput(),
      recheckOf: batch.id,
      idempotencyKey: key(),
    }),
    status(400),
  );
  await assert.rejects(
    review.reviewReconciliation(
      { ...reviewer(), permissions: ["reports:view"] },
      batch.id,
      reviewInput(batch),
    ),
    status(403),
  );
});

test("pareceres financeiros não aparecem na auditoria de perfis sem custos", async () => {
  await order("OP-CUSTO");
  const input = {
    ...controlledInput(),
    kind: "ORDER_COST",
    context: { ...controlledInput().context, basis: "INVOICED_MATERIALS" },
    csv: `unidade;ordem;custo\n${fixture.unitCodes[0]};OP-CUSTO;20,00`,
  };
  const batch = await reconciliation.saveReconciliation(fixture.actor, {
    ...input,
    idempotencyKey: key(),
  });
  await review.reviewReconciliation(
    reviewer(),
    batch.id,
    reviewInput(batch, {
      note: "Dados financeiros reservados: teste R$ 20,00.",
    }),
  );
  const stock = await controlledBatch();
  await db.auditLog.create({
    data: {
      unitId: fixture.unitIds[0],
      userId: fixture.userId,
      entity: "Product",
      entityId: fixture.productIds[0],
      action: "TEST_PUBLIC_AUDIT",
    },
  });
  const { unitAuditScope } = await import("../src/lib/audit-scope");
  const logs = await db.auditLog.findMany({
    where: unitAuditScope(fixture.unitIds[0], ["reports:view"]),
  });
  assert.ok(logs.some((log) => log.entityId === stock.id));
  assert.ok(logs.some((log) => log.action === "TEST_PUBLIC_AUDIT"));
  assert.equal(
    logs.some((log) => log.entityId === batch.id),
    false,
  );
  assert.equal(JSON.stringify(logs).includes("R$ 20,00"), false);
  await assert.rejects(
    review.getReconciliationRecheck(
      { ...reviewer(), permissions: ["reports:read"] },
      batch.id,
    ),
    status(404),
  );
  await assert.rejects(
    review.reviewReconciliation(
      { ...reviewer(), permissions: ["reports:read"] },
      batch.id,
      reviewInput(batch),
    ),
    status(404),
  );
});

test("nova conferência preserva códigos com sinais e quantidades negativas do arquivo", async () => {
  await db.product.update({
    where: { id: fixture.productIds[0] },
    data: { internalCode: "-P-1" },
  });
  const input = {
    ...controlledInput(),
    csv: `unidade;produto;local;quantidade\n${fixture.unitCodes[0]};-P-1;L-1;-1,125`,
  };
  const first = await reconciliation.saveReconciliation(fixture.actor, {
    ...input,
    idempotencyKey: key(),
  });
  const nextInput = await review.getReconciliationRecheck(
    fixture.actor,
    first.id,
  );
  const next = await reconciliation.saveReconciliation(fixture.actor, {
    ...nextInput,
    idempotencyKey: key(),
  });
  assert.equal(
    (next.result as { rows: { code: string; externalValue: string }[] }).rows[0]
      .code,
    "-P-1",
  );
  assert.equal(
    (next.result as { rows: { externalValue: string }[] }).rows[0]
      .externalValue,
    "-1.125",
  );
});

test("pareceres diferentes concorrentes não encerram a mesma conferência duas vezes", async () => {
  const batch = await controlledBatch();
  const attempts = await Promise.allSettled([
    review.reviewReconciliation(reviewer(), batch.id, reviewInput(batch)),
    review.reviewReconciliation(
      reviewer(),
      batch.id,
      reviewInput(batch, {
        decision: "RETURN",
        note: "Conferir novamente os documentos do turno.",
      }),
    ),
  ]);
  assert.equal(
    attempts.filter((attempt) => attempt.status === "fulfilled").length,
    1,
  );
  assert.equal(
    attempts.filter(
      (attempt) =>
        attempt.status === "rejected" && attempt.reason.status === 409,
    ).length,
    1,
  );
  assert.equal(
    await db.auditLog.count({
      where: { entityId: batch.id, action: "RECONCILIATION_REVIEWED" },
    }),
    1,
  );
});

test("histórico traz situação sem copiar linhas ou pareceres completos para a lista", async () => {
  const batch = await controlledBatch();
  await review.reviewReconciliation(
    reviewer(),
    batch.id,
    reviewInput(batch, {
      note: "Parecer reservado para consulta no documento completo.",
    }),
  );
  const list = await reconciliation.listReconciliations(reviewer());
  assert.equal(list[0].review.status, "MATCHED");
  assert.equal(list[0].revision, 1);
  assert.equal("analyses" in list[0].review, false);
  assert.equal("result" in list[0], false);
  assert.equal(JSON.stringify(list).includes("Parecer reservado"), false);
  assert.equal(
    (await reconciliation.getReconciliation(reviewer(), batch.id)).review.note,
    "Parecer reservado para consulta no documento completo.",
  );
});
