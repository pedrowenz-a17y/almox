import "dotenv/config";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { chromium, expect } from "@playwright/test";
import { qaConfig, qaCredentials } from "./qa-config.mjs";

// This writes only to the explicitly authorized isolated installation. No session mocks or auth bypass.
const { baseURL, unitId } = qaConfig({ writes: true });
const credentials = qaCredentials("ADMIN");
const tag = `UI-ORD-${Date.now()}`;
const checks = [];
const errors = [];
const fixtures = {};
const participant = {
  name: "Pessoa de homologação UI",
  identifier: `QA-${tag}`,
};
await fs.mkdir("artifacts", { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
  headless: true,
  args: ["--no-sandbox"],
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
});
const page = await context.newPage();
page.setDefaultTimeout(20000);
page.on("pageerror", (error) => errors.push(error.message));
const pass = (message) => {
  checks.push(message);
  console.log(`PASS ${message}`);
};
async function call(path, body) {
  const response =
    body === undefined
      ? await context.request.get(`${baseURL}${path}`)
      : await context.request.post(`${baseURL}${path}`, {
          headers: { Origin: baseURL },
          data: body,
        });
  const payload = await response.json();
  assert.ok(
    response.ok(),
    `${path}: ${response.status()} ${payload.error || "Falha na operação"}`,
  );
  return payload.data;
}
async function mutate(path, click, inspectPayload) {
  const pending = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === path &&
      response.request().method() === "POST",
  );
  await click();
  const response = await pending;
  if (inspectPayload) inspectPayload(response.request().postDataJSON());
  const body = await response.json();
  assert.ok(
    response.ok(),
    `${path}: ${response.status()} ${body.error || "Falha na operação"}`,
  );
  await expect(page.getByRole("dialog")).toBeHidden();
  return body.data;
}
async function stock(expected) {
  const data = await call("/api/data");
  assert.equal(data.unitId, unitId);
  const balance = data.balances.find(
    (item) =>
      item.productId === fixtures.product.id &&
      item.locationId === fixtures.location.id,
  );
  assert.ok(balance, "Saldo do material de teste deve existir");
  for (const [key, quantity] of Object.entries(expected))
    assert.equal(Number(balance[key]), quantity, key);
  return data;
}
async function noPageOverflow() {
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
    "A página não deve transbordar horizontalmente; tabelas têm rolagem própria",
  );
}
async function createOrder(kind, suffix) {
  await page.goto(
    `${baseURL}/${kind === "SERVICE" ? "ordens-servico" : "ordens-producao"}`,
  );
  await page
    .getByRole("button", {
      name: kind === "SERVICE" ? "Nova O.S." : "Nova O.P.",
      exact: true,
    })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("Código da ordem", { exact: true })
    .fill(`${tag}-${suffix}`);
  await dialog
    .getByLabel("Descrição resumida", { exact: true })
    .fill(`Ordem exclusiva de homologação ${suffix}`);
  return mutate("/api/orders", () =>
    dialog.getByRole("button", { name: "Criar ordem", exact: true }).click(),
  );
}
async function requestMaterial(order, quantity) {
  await page
    .getByRole("button", { name: "Requisitar material", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByRole("combobox", { name: /^Material/ })
    .selectOption(fixtures.product.id);
  await dialog
    .getByRole("combobox", { name: /^Local de retirada/ })
    .selectOption(fixtures.location.id);
  await dialog.locator("input[name=quantity]").fill(quantity);
  await dialog
    .getByRole("button", { name: "Revisar operação", exact: true })
    .click();
  return mutate(`/api/orders/${order.id}/actions`, () =>
    dialog
      .getByRole("button", { name: "Confirmar operação", exact: true })
      .click(),
  );
}
async function materialAction(order, action, quantity) {
  const names = {
    RESERVE: "Reservar",
    RELEASE: "Liberar reserva",
    APPLY: "Entregar e aplicar",
    RETURN: "Receber devolução",
    REQUEST_RETURN: "Solicitar devolução",
    CANCEL_RETURN: "Cancelar pedido de devolução",
    REDUCE_REQUEST: "Encerrar saldo solicitado",
  };
  const row = page.getByRole("row").filter({ hasText: fixtures.product.name });
  await row.getByRole("button", { name: names[action], exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.locator("input[name=quantity]").fill(quantity);
  if (["APPLY", "RETURN"].includes(action)) {
    const prefix = action === "APPLY" ? "receivedBy" : "returnedBy";
    await dialog.locator(`input[name=${prefix}Name]`).fill(participant.name);
    await dialog
      .locator(`input[name=${prefix}Identifier]`)
      .fill(participant.identifier);
  }
  await dialog
    .locator("textarea[name=note]")
    .fill(`Homologação isolada: ${action}`);
  await dialog
    .getByRole("button", { name: "Revisar operação", exact: true })
    .click();
  const updated = await mutate(
    `/api/orders/${order.id}/actions`,
    () =>
      dialog
        .getByRole("button", { name: "Confirmar operação", exact: true })
        .click(),
    (body) => {
      assert.equal(body.action, action);
      assert.equal(Number(body.quantity), Number(quantity));
      assert.ok(body.materialId && body.idempotencyKey);
      assert.equal(
        body.deliveredById,
        undefined,
        "O cliente não escolhe o entregador autenticado.",
      );
      assert.equal(
        body.receivedById,
        undefined,
        "O cliente não escolhe quem confirma o recebimento.",
      );
      if (["APPLY", "RETURN"].includes(action)) {
        const prefix = action === "APPLY" ? "receivedBy" : "returnedBy";
        assert.equal(body[`${prefix}Name`], participant.name);
        assert.equal(body[`${prefix}Identifier`], participant.identifier);
      }
      if (
        ["REQUEST_RETURN", "CANCEL_RETURN", "REDUCE_REQUEST"].includes(action)
      )
        assert.ok(body.note.trim().length >= 10);
    },
  );
  if (["APPLY", "RETURN"].includes(action)) {
    const type =
      action === "APPLY"
        ? "APPLIED"
        : updated.status === "INVOICED"
          ? "RETURNED_AFTER_INVOICE"
          : "RETURNED_BEFORE_INVOICE";
    const event = updated.events.filter((item) => item.type === type).at(-1);
    assert.ok(event, "A entrega ou recebimento precisa gerar evento.");
    assert.equal(event.user.id, fixtures.actor.id);
    const handoff =
      action === "APPLY"
        ? event.metadata.handoff
        : event.metadata.returnReceipt;
    const prefix = action === "APPLY" ? "receivedBy" : "returnedBy";
    assert.equal(handoff[`${prefix}Name`], participant.name);
    assert.equal(handoff[`${prefix}Identifier`], participant.identifier);
    assert.equal(
      handoff[action === "APPLY" ? "deliveredById" : "receivedById"],
      fixtures.actor.id,
    );
    assert.equal(handoff.confirmation, "DECLARED_BY_OPERATOR");
    await expect(
      page.getByText(participant.identifier, { exact: false }).last(),
    ).toBeVisible();
  }
  return updated;
}
async function invoice(order) {
  await expect(
    page.getByRole("button", { name: "Confirmar faturamento", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Confirmar faturamento", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog
    .locator("input[name=reference]")
    .fill(`${tag}-DOC-${order.code.slice(-2)}`);
  await dialog
    .getByRole("button", { name: "Revisar operação", exact: true })
    .click();
  return mutate(`/api/orders/${order.id}/actions`, () =>
    dialog
      .getByRole("button", { name: "Confirmar operação", exact: true })
      .click(),
  );
}
async function receive(purchase, quantity, reference, cost) {
  await page
    .getByRole("button", { name: "Conferir recebimento", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("Documento efetivamente recebido", { exact: true })
    .fill(reference);
  await dialog
    .getByLabel("Quantidade conferida (UN)", { exact: true })
    .fill(quantity);
  await dialog
    .getByRole("combobox", { name: /^Local de destino/ })
    .selectOption(fixtures.location.id);
  if (cost)
    await dialog
      .getByLabel("Custo unitário no documento (opcional)", { exact: true })
      .fill(cost);
  await dialog
    .getByRole("button", { name: "Revisar operação", exact: true })
    .click();
  // Review/back must retain the operator's draft.
  await dialog.getByRole("button", { name: "Voltar", exact: true }).click();
  await expect(
    dialog.getByLabel("Documento efetivamente recebido", { exact: true }),
  ).toHaveValue(reference);
  await expect(
    dialog.getByLabel("Quantidade conferida (UN)", { exact: true }),
  ).toHaveValue(quantity);
  await dialog
    .getByRole("button", { name: "Revisar operação", exact: true })
    .click();
  return mutate(`/api/purchases/${purchase.id}/receive`, () =>
    dialog
      .getByRole("button", { name: "Confirmar recebimento", exact: true })
      .click(),
  );
}
try {
  await page.goto(`${baseURL}/login`);
  await page.getByLabel("E-mail", { exact: true }).fill(credentials.email);
  await page.getByLabel("Senha", { exact: true }).fill(credentials.password);
  await page
    .getByRole("button", { name: "Entrar no almoxarifado", exact: true })
    .click();
  await page.waitForURL("**/dashboard");
  await call("/api/unit", { unitId });
  fixtures.actor = await call("/api/me");
  pass("Login real e seleção da unidade de homologação");
  fixtures.supplier = await call("/api/catalog/suppliers", {
    legalName: `${tag} fornecedor exclusivo QA`,
  });
  fixtures.product = await call("/api/catalog/products", {
    internalCode: `${tag}-MAT`,
    name: `${tag} material de teste`,
    unit: "UN",
    minStock: "2",
    unitCost: null,
  });
  fixtures.warehouse = await call("/api/catalog/warehouses", {
    code: `${tag}-ALM`,
    name: `${tag} depósito QA`,
  });
  fixtures.location = await call("/api/catalog/locations", {
    code: `${tag}-LOC`,
    name: `${tag} local QA`,
    warehouseId: fixtures.warehouse.id,
  });
  assert.equal(fixtures.product.unitCost, null);
  pass(
    "Fixtures identificadas e isoladas; custo desconhecido preservado como null",
  );

  await page.goto(`${baseURL}/compras`);
  await page.getByRole("button", { name: "Novo pedido", exact: true }).click();
  let dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("Código do pedido", { exact: true })
    .fill(`${tag}-PC`);
  await dialog
    .getByRole("combobox", { name: /^Fornecedor/ })
    .selectOption(fixtures.supplier.id);
  await dialog
    .getByLabel("Descrição resumida", { exact: true })
    .fill("Pedido exclusivo de homologação UI");
  await dialog
    .getByRole("combobox", { name: /^Material/ })
    .selectOption(fixtures.product.id);
  await dialog.getByLabel("Quantidade", { exact: true }).fill("100");
  await dialog
    .getByLabel("Custo unitário (opcional)", { exact: true })
    .fill("12.50");
  fixtures.purchase = await mutate("/api/purchases", () =>
    dialog.getByRole("button", { name: "Salvar pedido", exact: true }).click(),
  );
  assert.equal(fixtures.purchase.status, "OPEN");
  pass(
    "Pedido de compra criado pela interface com material, fornecedor e custo informado",
  );
  let purchase = await receive(
    fixtures.purchase,
    "60",
    `${tag}-ENTREGA-1`,
    "13.40",
  );
  assert.equal(purchase.status, "OPEN");
  assert.equal(Number(purchase.items[0].receivedQuantity), 60);
  assert.equal(Number(purchase.receipts[0].items[0].unitCost), 13.4);
  await stock({
    quantity: 60,
    physicalQuantity: 60,
    reservedQuantity: 0,
    appliedQuantity: 0,
    availableQuantity: 60,
  });
  pass(
    "Recebimento parcial de 60 e custo real do documento, distinto do pedido",
  );
  purchase = await receive(fixtures.purchase, "40", `${tag}-ENTREGA-2`);
  assert.equal(purchase.status, "COMPLETED");
  assert.equal(purchase.receipts.length, 2);
  assert.equal(purchase.receipts[1].items[0].unitCost, null);
  await stock({ quantity: 100, physicalQuantity: 100, availableQuantity: 100 });
  await noPageOverflow();
  await page.screenshot({
    path: "artifacts/uca-compras-ui-desktop.png",
    fullPage: true,
  });
  pass(
    "Recebimento completo 60+40, documento sem custo mantém null e histórico com dois recebimentos",
  );

  fixtures.service = await createOrder("SERVICE", "OS");
  await requestMaterial(fixtures.service, "10");
  await expect(
    page.getByRole("button", { name: "Confirmar faturamento", exact: true }),
  ).toBeDisabled();
  await materialAction(fixtures.service, "RESERVE", "10");
  await stock({
    quantity: 100,
    physicalQuantity: 100,
    reservedQuantity: 10,
    appliedQuantity: 0,
    availableQuantity: 90,
  });
  await materialAction(fixtures.service, "APPLY", "4");
  await stock({
    quantity: 100,
    physicalQuantity: 96,
    reservedQuantity: 6,
    appliedQuantity: 4,
    availableQuantity: 90,
  });
  await expect(
    page.getByRole("button", { name: "Confirmar faturamento", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByText("Faturamento bloqueado:", { exact: false }),
  ).toBeVisible();
  await page.screenshot({
    path: "artifacts/uca-os-parcial-ui-desktop.png",
    fullPage: true,
  });
  pass(
    "O.S. com requisição 10, reserva 10 e aplicação parcial 4; faturamento bloqueado e saldos corretos",
  );
  await materialAction(fixtures.service, "RETURN", "1");
  await stock({
    quantity: 100,
    physicalQuantity: 97,
    reservedQuantity: 6,
    appliedQuantity: 3,
    availableQuantity: 91,
  });
  const reduced = await materialAction(fixtures.service, "REDUCE_REQUEST", "1");
  assert.equal(Number(reduced.materials[0].requestedQuantity), 9);
  await stock({
    quantity: 100,
    physicalQuantity: 97,
    reservedQuantity: 6,
    appliedQuantity: 3,
    availableQuantity: 91,
  });
  await requestMaterial(fixtures.service, "1");
  pass(
    "Saldo devolvido encerrado com justificativa, sem movimentar estoque; nova requisição recompõe o atendimento planejado",
  );
  await materialAction(fixtures.service, "RELEASE", "6");
  await expect(
    page.getByRole("button", { name: "Confirmar faturamento", exact: true }),
  ).toBeDisabled();
  pass(
    "Devolução antes do faturamento reverte aplicação; liberar reserva não libera faturamento incompleto",
  );
  await materialAction(fixtures.service, "RESERVE", "7");
  await materialAction(fixtures.service, "APPLY", "7");
  await stock({
    quantity: 100,
    physicalQuantity: 90,
    reservedQuantity: 0,
    appliedQuantity: 10,
    availableQuantity: 90,
  });
  let service = await materialAction(fixtures.service, "REQUEST_RETURN", "2");
  assert.equal(Number(service.materials[0].pendingReturnQuantity), 2);
  await stock({ quantity: 100, physicalQuantity: 90, availableQuantity: 90 });
  await expect(
    page.getByRole("button", { name: "Confirmar faturamento", exact: true }),
  ).toBeDisabled();
  service = await materialAction(fixtures.service, "CANCEL_RETURN", "2");
  assert.equal(Number(service.materials[0].pendingReturnQuantity), 0);
  assert.equal(Number(service.materials[0].appliedQuantity), 10);
  assert.ok(
    service.events.some((event) => event.type === "RETURN_REQUEST_CANCELLED"),
  );
  await stock({ quantity: 100, physicalQuantity: 90, availableQuantity: 90 });
  pass(
    "Pedido de devolução bloqueia faturamento; cancelamento justificado do pedido mantém material aplicado e não libera estoque",
  );
  service = await invoice(fixtures.service);
  assert.equal(service.status, "INVOICED");
  assert.equal(Number(service.materials[0].consumedQuantity), 10);
  await stock({
    quantity: 90,
    physicalQuantity: 90,
    reservedQuantity: 0,
    appliedQuantity: 0,
    availableQuantity: 90,
  });
  pass(
    "Faturamento manual da O.S. integralmente atendida baixa exatamente 10 uma vez",
  );
  service = await materialAction(fixtures.service, "REQUEST_RETURN", "2");
  assert.equal(Number(service.materials[0].pendingReturnQuantity), 2);
  await stock({ quantity: 90, physicalQuantity: 90, availableQuantity: 90 });
  service = await materialAction(fixtures.service, "RETURN", "2");
  assert.equal(Number(service.materials[0].pendingReturnQuantity), 0);
  assert.equal(Number(service.materials[0].returnedQuantity), 2);
  await stock({ quantity: 92, physicalQuantity: 92, availableQuantity: 92 });
  await page.setViewportSize({ width: 390, height: 844 });
  await noPageOverflow();
  await page.screenshot({
    path: "artifacts/uca-os-ui-mobile.png",
    fullPage: true,
  });
  pass(
    "Devolução pós-faturamento gera entrada de 2, com O.S. e histórico legíveis no celular",
  );

  fixtures.production = await createOrder("PRODUCTION", "OP");
  await requestMaterial(fixtures.production, "5");
  await materialAction(fixtures.production, "RESERVE", "5");
  await materialAction(fixtures.production, "APPLY", "5");
  const production = await invoice(fixtures.production);
  assert.equal(production.status, "INVOICED");
  await stock({
    quantity: 87,
    physicalQuantity: 87,
    reservedQuantity: 0,
    appliedQuantity: 0,
    availableQuantity: 87,
  });
  await page.screenshot({
    path: "artifacts/uca-op-ui-mobile.png",
    fullPage: true,
  });
  pass(
    "O.P. criada e atendida integralmente no celular; consumo de 5 mantém saldo final 87",
  );

  fixtures.cancelled = await createOrder("PRODUCTION", "CANCEL");
  await requestMaterial(fixtures.cancelled, "3");
  await materialAction(fixtures.cancelled, "RESERVE", "3");
  await page
    .getByRole("button", { name: "Cancelar ordem", exact: true })
    .click();
  dialog = page.getByRole("dialog");
  await dialog
    .locator("textarea[name=note]")
    .fill("Cancelamento exclusivo da homologação UI");
  await dialog
    .getByRole("button", { name: "Revisar operação", exact: true })
    .click();
  const cancelled = await mutate(
    `/api/orders/${fixtures.cancelled.id}/actions`,
    () =>
      dialog
        .getByRole("button", { name: "Confirmar operação", exact: true })
        .click(),
  );
  assert.equal(cancelled.status, "CANCELLED");
  assert.equal(Number(cancelled.materials[0].reservedQuantity), 0);
  const finalData = await stock({
    quantity: 87,
    physicalQuantity: 87,
    reservedQuantity: 0,
    appliedQuantity: 0,
    availableQuantity: 87,
  });
  pass(
    "Cancelamento da O.P. libera reserva sem alterar físico e mantém o histórico",
  );
  const movements = finalData.movements.filter(
    (item) => item.productId === fixtures.product.id,
  );
  assert.equal(movements.filter((item) => item.type === "ENTRY").length, 3);
  assert.equal(movements.filter((item) => item.type === "EXIT").length, 2);
  for (const movement of movements)
    assert.ok(finalData.audit.some((event) => event.entityId === movement.id));
  for (const order of [
    fixtures.service,
    fixtures.production,
    fixtures.cancelled,
  ])
    assert.ok(finalData.audit.some((event) => event.entityId === order.id));
  assert.equal(errors.length, 0, errors.join("\n"));
  pass(
    "Cinco movimentações finais, auditorias de ordens e movimentações, sem erros JavaScript",
  );
  await fs.writeFile(
    "artifacts/uca-orders-ui-checks.json",
    JSON.stringify(
      {
        at: new Date().toISOString(),
        environment: "isolated",
        unitId,
        checks,
        expectedFinalStock: 87,
        productId: fixtures.product.id,
        locationId: fixtures.location.id,
        orderIds: [
          fixtures.service.id,
          fixtures.production.id,
          fixtures.cancelled.id,
        ],
        purchaseId: fixtures.purchase.id,
        consoleErrors: errors,
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ passed: checks.length, checks }));
} catch (error) {
  await page.screenshot({
    path: "artifacts/uca-orders-ui-failure.png",
    fullPage: true,
  });
  await fs.writeFile(
    "artifacts/uca-orders-ui-failure.json",
    JSON.stringify(
      {
        at: new Date().toISOString(),
        checks,
        url: page.url(),
        error: error.message,
        consoleErrors: errors,
      },
      null,
      2,
    ),
  );
  console.error(
    JSON.stringify({
      completed: checks,
      url: page.url(),
      error: error.message,
    }),
  );
  throw error;
} finally {
  await browser.close();
}
