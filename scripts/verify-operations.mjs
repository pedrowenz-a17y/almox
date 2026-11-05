import "dotenv/config";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { chromium } from "@playwright/test";
import { qaConfig, qaCredentials } from "./qa-config.mjs";
const { baseURL: base, unitId } = qaConfig({ writes: true });
const credentials = qaCredentials("ADMIN");
assert.ok(process.env.QA_LOCATION_ID, "Defina QA_LOCATION_ID de um local pai na unidade exclusiva de testes.");
await fs.mkdir("artifacts", { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
  headless: true,
  args: ["--no-sandbox"],
});
const context = await browser.newContext({
  viewport: { width: 1280, height: 900 },
});
const page = await context.newPage();
const tag = `ACEITE-${Date.now()}`;
const checks = [];
const data = async () => {
  const r = await context.request.get(`${base}/api/data`);
  assert.equal(r.status(), 200);
  const result = (await r.json()).data;
  assert.equal(result.unitId, unitId);
  return result;
};
try {
  await page.goto(`${base}/login`);
  await page
    .getByLabel("E-mail", { exact: true })
    .fill(credentials.email);
  await page
    .getByLabel("Senha", { exact: true })
    .fill(credentials.password);
  await page.getByRole("button", { name: "Entrar no almoxarifado" }).click();
  await page.waitForURL("**/dashboard");
  const selection = await context.request.post(`${base}/api/unit`, { headers: { Origin: base }, data: { unitId } });
  assert.equal(selection.status(), 200, await selection.text());
  const initial = await data();
  const sector = initial.locations.find((l) => l.id === process.env.QA_LOCATION_ID);
  assert.ok(sector, "Localização pai ausente ou fora da unidade de homologação.");
  await page.goto(`${base}/produtos`);
  await page.getByRole("button", { name: "Novo produto", exact: true }).click();
  let dialog = page.getByRole("dialog");
  await dialog.locator("input[name=name]").fill("Rolamento 6204");
  await dialog.locator("input[name=internalCode]").fill(`${tag}-ROL`);
  await dialog.locator("input[name=minStock]").fill("10");
  await dialog.getByRole("button", { name: "Salvar cadastro" }).click();
  await dialog.waitFor({ state: "hidden" });
  let all = await data();
  const product = all.products.find((p) => p.internalCode === `${tag}-ROL`);
  assert.ok(product);
  checks.push("Cadastro do Rolamento 6204 pela UI");
  async function createLocation(name, code, parentId) {
    await page.goto(`${base}/localizacoes`);
    await page
      .getByRole("button", { name: "Nova localização", exact: true })
      .click();
    const d = page.getByRole("dialog");
    await d.locator("input[name=name]").fill(name);
    await d.locator("input[name=code]").fill(code);
    await d
      .locator("select[name=warehouseId]")
      .selectOption(sector.warehouseId);
    await d.locator("select[name=parentId]").selectOption(parentId);
    await d.getByRole("button", { name: "Salvar cadastro" }).click();
    await d.waitFor({ state: "hidden" });
    const record = (await data()).locations.find((l) => l.code === code);
    assert.ok(record);
    return record;
  }
  const rack = await createLocation("Estante 02", `${tag}-E02`, sector.id);
  const source = await createLocation("Prateleira 03", `${tag}-P03`, rack.id);
  const destination = await createLocation(
    "Prateleira 04",
    `${tag}-P04`,
    rack.id,
  );
  checks.push(
    "Cadastro hierárquico Setor A / Estante 02 / Prateleiras 03 e 04",
  );
  await page.goto(`${base}/localizacao/${source.id}`);
  const move = async (action, quantity) => {
    await page.getByRole("button", { name: action, exact: true }).click();
    const d = page.getByRole("dialog");
    await d
      .locator("label")
      .filter({ hasText: "Produto / material" })
      .locator("select")
      .selectOption(product.id);
    await d.getByRole("spinbutton").fill(quantity);
    await d.getByRole("button", { name: "Revisar movimentação" }).click();
    await d.getByRole("button", { name: "Confirmar movimentação" }).click();
    await d.waitFor({ state: "hidden" });
  };
  await move("Entrada", "100");
  assert.equal(
    (await data()).balances.find(
      (b) => b.productId === product.id && b.locationId === source.id,
    ).quantity,
    "100",
  );
  checks.push("Entrada de 100 pela UI");
  await move("Retirar material", "15");
  assert.equal(
    (await data()).balances.find(
      (b) => b.productId === product.id && b.locationId === source.id,
    ).quantity,
    "85",
  );
  checks.push("Retirada de 15 pela UI");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${base}/operacao`);
  await page
    .getByRole("button", { name: "Transferência via QR", exact: true })
    .click();
  dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("Ou digite o código da localização")
    .fill(source.code);
  await dialog.getByRole("button", { name: "Localizar", exact: true }).click();
  await dialog
    .locator("label")
    .filter({ hasText: "Produto / material" })
    .locator("select")
    .selectOption(product.id);
  await dialog.getByRole("spinbutton").fill("25");
  await dialog.getByRole("button", { name: "Escanear destino" }).click();
  await dialog
    .getByLabel("Ou digite o código da localização")
    .fill(destination.code);
  await dialog.getByRole("button", { name: "Localizar", exact: true }).click();
  await dialog.getByRole("button", { name: "Revisar movimentação" }).click();
  await dialog.getByRole("button", { name: "Confirmar movimentação" }).click();
  await dialog.waitFor({ state: "hidden" });
  all = await data();
  const balances = all.balances.filter((b) => b.productId === product.id);
  assert.equal(
    Number(balances.find((b) => b.locationId === source.id).quantity),
    60,
  );
  assert.equal(
    Number(balances.find((b) => b.locationId === destination.id).quantity),
    25,
  );
  assert.equal(
    balances.reduce((s, b) => s + Number(b.quantity), 0),
    85,
  );
  checks.push("Transferência com dois códigos no celular: 60 + 25 = 85");
  const movements = all.movements.filter((m) => m.productId === product.id);
  assert.equal(movements.length, 3);
  for (const m of movements)
    assert.ok(all.audit.find((a) => a.entityId === m.id));
  checks.push(
    "Três movimentações e eventos de auditoria conferidos no banco via API",
  );
  await page.goto(`${base}/localizacao/${source.id}`);
  await page.getByRole("button", { name: "Inventário", exact: true }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Contagem de Rolamento 6204").fill("60");
  await dialog
    .getByLabel("Motivo / observação da contagem")
    .fill("Conferência de aceite pela interface");
  await dialog.getByRole("button", { name: "Revisar contagem" }).click();
  await dialog
    .getByRole("button", { name: "Confirmar contagem", exact: true })
    .click();
  await dialog.waitFor({ state: "hidden" });
  checks.push("Contagem física enviada para aprovação pela UI");
  await page.goto(`${base}/inventario`);
  const row = page.getByRole("row").filter({ hasText: source.code });
  await row.getByRole("button", { name: "Conferir" }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: /Confirmar aprovação/ }).click();
  await dialog.waitFor({ state: "hidden" });
  checks.push("Aprovação de inventário pela UI");
  await page.goto(`${base}/localizacao/${source.id}`);
  await page.locator(".loading-state").waitFor({ state: "hidden" });
  await page.screenshot({
    path: "artifacts/uca-aceite-mobile.png",
    fullPage: true,
  });
  await fs.writeFile(
    "artifacts/uca-operations-checks.json",
    JSON.stringify(
      {
        at: new Date().toISOString(),
        checks,
        unitId,
        environment: "isolated",
        productId: product.id,
        sourceId: source.id,
        destinationId: destination.id,
        expected: { source: 60, destination: 25, total: 85 },
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ passed: checks.length, checks }));
} catch (error) {
  await page.screenshot({
    path: "artifacts/uca-operations-failure.png",
    fullPage: true,
  });
  console.error({ completed: checks, url: page.url() });
  throw error;
} finally {
  await browser.close();
}
