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
let validation: typeof import("../src/services/validation-report");
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
  validation = await import("../src/services/validation-report");
  const result = await db.$queryRaw<
    Array<{ name: string }>
  >`SELECT current_database()::text AS name`;
  assert.equal(result[0].name, databaseName);
});
beforeEach(async () => {
  const suffix = key();
  const org = await db.organization.create({
    data: { name: `TEST-VALIDATION-${suffix}` },
  });
  const role = await db.role.create({
    data: { name: `TEST-VALIDATION-${suffix}` },
  });
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
          code: `TEST-VALIDATION-${label}-${suffix}`,
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
    await tx.stockMovement.deleteMany({ where });
    await tx.orderEvent.deleteMany({ where });
    await tx.inventoryCountItem.deleteMany({ where });
    await tx.inventoryCount.deleteMany({ where });
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

const period = { from: "2026-01-04", to: "2026-01-05" };
const reviewer = () => ({ ...fixture.actor, id: fixture.reviewerId });
const start = (origin = "DEMONSTRATION") =>
  validation.startValidationRun(fixture.actor, {
    ...period,
    origin,
    title: "Validação do fluxo de materiais",
    objective:
      "Conferir o processo com evidências em uma unidade isolada de testes.",
    idempotencyKey: key(),
  });
const step = (version: number, stepId = "ORDER", outcome = "PASS") => ({
  action: "STEP",
  stepId,
  outcome,
  note: "Observação registrada durante o cenário de teste.",
  reference: "OP-TEST-01",
  expectedVersion: version,
  idempotencyKey: key(),
});

test("indicadores vazios não inventam percentuais e validam datas e permissões", async () => {
  const report = await validation.validationIndicators(fixture.actor, period);
  assert.equal(report.current.exits, 0);
  assert.equal(report.current.linkedPercent, null);
  assert.equal(report.current.handoffPercent, null);
  assert.equal(report.current.divergentPercent, null);
  assert.equal(report.period.previousFrom, "2026-01-02T03:00:00.000Z");
  assert.equal(
    report.period.previousUntilExclusive,
    "2026-01-04T03:00:00.000Z",
  );
  for (const input of [
    { from: "2026-02-30", to: "2026-03-01" },
    { from: "2026-01-10", to: "2026-01-01" },
    { from: "2026-01-01", to: "2026-12-31" },
    { from: "9999-01-01", to: "9999-01-02" },
  ])
    await assert.rejects(validation.validationIndicators(fixture.actor, input));
  await assert.rejects(
    validation.validationIndicators(
      { ...fixture.actor, permissions: [] },
      period,
    ),
    status(403),
  );
});

test("baixas e entregas usam bases distintas, datas de Brasília e escopo da unidade", async () => {
  const order = await db.workOrder.create({
    data: {
      unitId: fixture.unitIds[0],
      userId: fixture.userId,
      code: "OP-1",
      title: "Teste",
      kind: "PRODUCTION",
    },
  });
  for (const [unitIndex, orderId, at] of [
    [0, order.id, "2026-01-04T03:00:00Z"],
    [0, null, "2026-01-04T04:00:00Z"],
    [1, null, "2026-01-04T04:00:00Z"],
    [0, null, "2026-01-06T03:00:00Z"],
  ] as const)
    await db.stockMovement.create({
      data: {
        unitId: fixture.unitIds[unitIndex],
        productId: fixture.productIds[unitIndex],
        sourceId: fixture.locationIds[unitIndex],
        userId: fixture.userId,
        type: "EXIT",
        quantity: "1",
        workOrderId: orderId,
        createdAt: new Date(at),
      },
    });
  for (const metadata of [
    {
      handoff: {
        deliveredById: fixture.userId,
        receivedByName: "Pessoa teste",
        receivedByIdentifier: "001",
      },
    },
    {
      handoff: {
        deliveredById: fixture.userId,
        receivedByName: "Sem identificação",
      },
    },
    {
      handoff: {
        deliveredById: fixture.reviewerId,
        receivedByName: "Outra pessoa",
        receivedByIdentifier: "002",
      },
    },
  ])
    await db.orderEvent.create({
      data: {
        unitId: fixture.unitIds[0],
        orderId: order.id,
        userId: fixture.userId,
        type: "APPLIED",
        metadata,
        createdAt: new Date("2026-01-04T04:00:00Z"),
      },
    });
  const report = await validation.validationIndicators(fixture.actor, period);
  assert.equal(report.current.exits, 2);
  assert.equal(report.current.linked, 1);
  assert.equal(report.current.linkedPercent, 50);
  assert.equal(report.current.deliveries, 3);
  assert.equal(report.current.handoffs, 1);
  assert.equal(report.current.handoffPercent, 33.33);
  assert.equal(JSON.stringify(report).includes("receivedByIdentifier"), false);
  assert.equal(JSON.stringify(report).includes("unitCost"), false);
});

test("contagens medem observações aprovadas e pendências continuam atuais sem somar quantidades", async () => {
  for (const status of ["APPROVED", "PENDING", "REJECTED"] as const)
    await db.inventoryCount.create({
      data: {
        unitId: fixture.unitIds[0],
        locationId: fixture.locationIds[0],
        userId: fixture.userId,
        status,
        note: "Contagem de teste",
        approvedAt: new Date("2026-01-04T03:00:00Z"),
        items: {
          create: {
            unitId: fixture.unitIds[0],
            productId: fixture.productIds[0],
            expectedQuantity: "10",
            countedQuantity: "8",
            difference: "-2",
          },
        },
      },
    });
  await db.workOrder.create({
    data: {
      unitId: fixture.unitIds[0],
      userId: fixture.userId,
      code: "PENDENTE",
      title: "Teste",
      kind: "SERVICE",
      createdAt: new Date("2026-04-01"),
      materials: {
        create: {
          unitId: fixture.unitIds[0],
          productId: fixture.productIds[0],
          locationId: fixture.locationIds[0],
          requestedQuantity: "10",
          appliedQuantity: "3",
          pendingReturnQuantity: "1",
        },
      },
    },
  });
  const report = await validation.validationIndicators(fixture.actor, period);
  assert.equal(report.current.counted, 1);
  assert.equal(report.current.divergent, 1);
  assert.equal(report.current.divergentPercent, 100);
  assert.deepEqual(report.pending, {
    unapplied: 1,
    awaitingInvoice: 1,
    returns: 1,
  });
});

test("abertura preserva retrato e repetição segura não cria outro roteiro", async () => {
  const input = {
    ...period,
    title: "Roteiro de demonstração",
    objective: "Verificar a rastreabilidade das operações nesta unidade.",
    origin: "DEMONSTRATION",
    idempotencyKey: key(),
  };
  const first = await validation.startValidationRun(fixture.actor, input);
  const same = await validation.startValidationRun(fixture.actor, input);
  assert.equal(first.id, same.id);
  await db.workOrder.create({
    data: {
      unitId: fixture.unitIds[0],
      userId: fixture.userId,
      code: "NOVA",
      title: "Nova",
      kind: "SERVICE",
      materials: {
        create: {
          unitId: fixture.unitIds[0],
          productId: fixture.productIds[0],
          locationId: fixture.locationIds[0],
          requestedQuantity: "10",
        },
      },
    },
  });
  assert.equal(
    (await validation.validationIndicators(fixture.actor, period)).pending
      .unapplied,
    1,
  );
  assert.equal(
    (await validation.getValidationRun(fixture.actor, first.id)).snapshot
      .pending.unapplied,
    0,
  );
  assert.equal(
    await db.auditLog.count({
      where: { entityId: first.id, action: "VALIDATION_STARTED" },
    }),
    1,
  );
  await assert.rejects(
    validation.getValidationRun(fixture.other, first.id),
    status(404),
  );
});

test("sete evidências são obrigatórias e falha relatada determina conclusão sem alterar estoque", async () => {
  let run = await start();
  await assert.rejects(
    validation.recordValidation(fixture.actor, run.id, {
      action: "CLOSE",
      expectedVersion: 0,
      conclusion: "Conclusão de teste com evidências suficientes.",
      idempotencyKey: key(),
    }),
    status(409),
  );
  for (const [index, stepId] of [
    "ORDER",
    "RESERVE",
    "DELIVERY",
    "INVOICE",
    "RETURN",
    "COUNT",
    "RECONCILE",
  ].entries())
    run = await validation.recordValidation(
      fixture.actor,
      run.id,
      step(run.version, stepId, index === 4 ? "FAIL" : "PASS"),
    );
  const close = {
    action: "CLOSE",
    expectedVersion: run.version,
    conclusion:
      "O teste encontrou uma falha na devolução e requer outra execução após a correção.",
    idempotencyKey: key(),
  };
  run = await validation.recordValidation(fixture.actor, run.id, close);
  assert.equal(run.status, "ISSUES");
  assert.equal(run.canRecord, false);
  assert.equal(
    (await validation.recordValidation(fixture.actor, run.id, close)).version,
    run.version,
  );
  await assert.rejects(
    validation.recordValidation(fixture.actor, run.id, step(run.version)),
    status(409),
  );
  assert.equal(
    await db.stockMovement.count({ where: { unitId: fixture.unitIds[0] } }),
    0,
  );
  assert.equal(
    (
      await db.inventoryBalance.findFirstOrThrow({
        where: { unitId: fixture.unitIds[0] },
      })
    ).quantity.toFixed(3),
    "50.125",
  );
});

test("piloto com a empresa exige outra pessoa no encerramento, mesmo para administrador", async () => {
  let run = await start("COMPANY_PILOT");
  for (const stepId of [
    "ORDER",
    "RESERVE",
    "DELIVERY",
    "INVOICE",
    "RETURN",
    "COUNT",
    "RECONCILE",
  ])
    run = await validation.recordValidation(
      fixture.actor,
      run.id,
      step(run.version, stepId),
    );
  const input = {
    action: "CLOSE",
    expectedVersion: run.version,
    conclusion: "As sete etapas foram conferidas com as referências de teste.",
    idempotencyKey: key(),
  };
  await assert.rejects(
    validation.recordValidation(fixture.actor, run.id, input),
    status(403),
  );
  const done = await validation.recordValidation(reviewer(), run.id, input);
  assert.equal(done.status, "REPORTED_PASS");
  assert.equal(done.closedByName, "Revisor teste");
});

test("gravações concorrentes não perdem evidência e revisões antigas são recusadas", async () => {
  const run = await start();
  const command = step(0);
  const duplicate = await Promise.all(
    [1, 2].map(() =>
      validation.recordValidation(fixture.actor, run.id, command),
    ),
  );
  assert.equal(duplicate[0].version, 1);
  assert.equal(duplicate[1].version, 1);
  const attempts = await Promise.allSettled([
    validation.recordValidation(fixture.actor, run.id, step(1, "COUNT")),
    validation.recordValidation(reviewer(), run.id, step(1, "RESERVE")),
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
});

test("auditor e acesso revogado não registram evidência ou conclusão; campos extras são recusados", async () => {
  const run = await start();
  const auditor = { ...fixture.actor, permissions: ["reports:view"] };
  assert.equal(
    (await validation.getValidationRun(auditor, run.id)).canRecord,
    false,
  );
  await assert.rejects(
    validation.recordValidation(auditor, run.id, step(0)),
    status(403),
  );
  await assert.rejects(validation.startValidationRun(auditor, {}), status(403));
  await assert.rejects(
    validation.recordValidation(fixture.actor, run.id, {
      ...step(0),
      recordedByName: "Outra pessoa",
    }),
  );
  await db.unitMembership.update({
    where: {
      userId_unitId: { userId: fixture.userId, unitId: fixture.unitIds[0] },
    },
    data: { active: false },
  });
  await assert.rejects(
    validation.recordValidation(fixture.actor, run.id, step(0)),
    status(403),
  );
});

test("relatório para o TCC escapa conteúdo, inclui critérios e não inventa conclusão", async () => {
  const run = await start();
  run.title = '<script>alert("x")</script>';
  run.objective = '<img src=x onerror="x">';
  const { validationHtml } = await import("../src/lib/validation-export");
  const document = validationHtml(run);
  assert.equal(document.includes("<script>"), false);
  assert.equal(document.includes("<img"), false);
  assert.ok(document.includes("&lt;script&gt;"));
  assert.ok(document.includes("Validação em andamento"));
  assert.ok(document.includes("Indicadores preservados"));
  assert.ok(document.includes("não comprova"));
  assert.equal(document.includes("href="), false);
});

test("atualização de resultado preserva a observação anterior no histórico", async () => {
  const run = await start();
  const failed = await validation.recordValidation(
    fixture.actor,
    run.id,
    step(0, "ORDER", "FAIL"),
  );
  const corrected = await validation.recordValidation(
    fixture.actor,
    run.id,
    step(failed.version, "ORDER", "PASS"),
  );
  assert.equal(corrected.steps.length, 1);
  assert.equal(corrected.steps[0].outcome, "PASS");
  assert.equal(corrected.history.length, 2);
  assert.equal(corrected.history[0].outcome, "FAIL");
  assert.equal(corrected.history[1].outcome, "PASS");
  assert.deepEqual(corrected.snapshot, run.snapshot);
});
