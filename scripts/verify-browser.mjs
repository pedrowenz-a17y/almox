import "dotenv/config";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { chromium, request } from "@playwright/test";
import sharp from "sharp";

import { qaConfig, qaCredentials } from "./qa-config.mjs";
const { baseURL, unitId } = qaConfig();
const credentials = qaCredentials("ADMIN");
const out = path.resolve("artifacts");
await fs.mkdir(out, { recursive: true });
const api = await request.newContext({
  baseURL,
  extraHTTPHeaders: { Origin: baseURL },
});
const login = await api.post("/api/auth/login", {
  data: {
    email: credentials.email,
    password: credentials.password,
  },
});
assert.equal(login.status(), 200, await login.text());
const selection = await api.post("/api/unit", { data: { unitId } });
assert.equal(selection.status(), 200, await selection.text());
const datasetResponse = await api.get("/api/data");
assert.equal(datasetResponse.status(), 200);
const dataset = await datasetResponse.json();
assert.equal(dataset.data.unitId, unitId);
assert.ok(process.env.QA_LOCATION_ID, "Defina QA_LOCATION_ID de uma localização real da unidade isolada de testes.");
const location = dataset.data.locations.find(location => location.id === process.env.QA_LOCATION_ID);
assert.ok(location, "Localização de teste inexistente ou fora do escopo autorizado.");
const qr = await api.get(`/api/qr/${location.id}`);
assert.equal(qr.status(), 200);
await sharp(await qr.body())
  .resize(180, 180)
  .extend({
    top: 150,
    bottom: 150,
    left: 230,
    right: 230,
    background: "#ffffff",
  })
  .png()
  .toFile(path.join(out, "uca-camera-qr.png"));
const capture = path.join(out, "uca-camera-fixture.y4m");
const ffmpeg = spawnSync(
  "ffmpeg",
  [
    "-y",
    "-loop",
    "1",
    "-i",
    path.join(out, "uca-camera-qr.png"),
    "-t",
    "2",
    "-r",
    "15",
    "-pix_fmt",
    "yuv420p",
    capture,
  ],
  { encoding: "utf8" },
);
assert.equal(ffmpeg.status, 0, ffmpeg.stderr);
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
  headless: true,
  args: [
    "--no-sandbox",
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
    `--use-file-for-fake-video-capture=${capture}`,
  ],
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  permissions: ["camera"],
});
const page = await context.newPage();
const errors = [];
const checks = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("console", (message) => {
  if (message.type() === "error") errors.push(message.text());
});
try {
  await page.goto(`${baseURL}/login`);
  await page
    .getByLabel("E-mail", { exact: true })
    .fill(credentials.email);
  await page
    .getByLabel("Senha", { exact: true })
    .fill(credentials.password);
  await page.getByRole("button", { name: "Entrar no almoxarifado" }).click();
  await page.waitForURL("**/dashboard");
  const selection = await context.request.post(`${baseURL}/api/unit`, { headers: { Origin: baseURL }, data: { unitId } });
  assert.equal(selection.status(), 200, await selection.text());
  await page.goto(`${baseURL}/dashboard`);
  await page
    .getByRole("heading", {
      name: /Bom dia|Boa tarde|Boa noite|Visão geral|Dashboard/,
    })
    .first()
    .waitFor({ timeout: 30000 });
  await page.screenshot({
    path: path.join(out, "uca-dashboard-desktop.png"),
    fullPage: true,
  });
  checks.push("Login real pela interface");
  const routes = [
    "produtos",
    "estoque",
    "localizacoes",
    "movimentacoes",
    "qrcodes",
    "fornecedores",
    "inventario",
    "relatorios",
    "usuarios",
    "configuracoes",
    "auditoria",
    "operacao",
    "ordens-servico",
    "ordens-producao",
    "compras",
  ];
  for (const route of routes) {
    await page.goto(`${baseURL}/${route}`);
    await page.locator(".loading-state").waitFor({ state: "hidden" });
    await page.locator("h1").first().waitFor();
    assert.equal(
      await page.locator(".notice.error").count(),
      0,
      `Erro em ${route}`,
    );
    checks.push(`Página ${route}`);
  }
  await page.goto(`${baseURL}/dashboard`);
  await page
    .getByRole("button", { name: /escanear qr code/i })
    .first()
    .click();
  await page.getByRole("button", { name: "Abrir câmera", exact: true }).click();
  await page.waitForURL(`**/localizacao/${location.id}`, { timeout: 25000 });
  await page.getByText(location.code, { exact: true }).first().waitFor();
  checks.push(
    "Câmera simulada: QR SVG real decodificado e localização correta aberta",
  );
  await page.screenshot({
    path: path.join(out, "uca-localizacao-desktop.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  for (const route of ["dashboard", "produtos", "localizacoes", "operacao"]) {
    await page.goto(`${baseURL}/${route}`);
    await page.locator(".loading-state").waitFor({ state: "hidden" });
    await page.locator("h1").first().waitFor();
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
      `Overflow horizontal ${route}`,
    );
    await page.screenshot({
      path: path.join(out, `uca-${route}-mobile.png`),
      fullPage: true,
    });
    checks.push(`Responsividade 390px: ${route}`);
  }
  await context.setOffline(true);
  await page
    .getByText(
      "Sem conexão. Não é possível registrar movimentações no momento.",
      { exact: true },
    )
    .waitFor();
  checks.push("Aviso offline");
  await context.setOffline(false);
  assert.deepEqual(errors, [], "Erros no navegador");
  await fs.writeFile(
    path.join(out, "uca-browser-checks.json"),
    JSON.stringify(
      {
        at: new Date().toISOString(),
        checks,
        unitId,
        environment: "isolated",
        errors,
        limitation:
          "Câmera física e impressora reais exigem validação no dispositivo.",
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ passed: checks.length, checks }));
} finally {
  await browser.close();
  await api.dispose();
}
