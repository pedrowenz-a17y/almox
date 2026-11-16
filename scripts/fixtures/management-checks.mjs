import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { expect } from "@playwright/test";
import { id } from "./theme-data.mjs";

export async function verifyManagement({
  page,
  fixtureURL,
  data,
  user,
  check,
  output,
  noOverflow,
  contrast,
}) {
  const original = { user: data.user, permissions: data.permissions };
  const currentId = user.unitId,
    capId = id(1001),
    clock = "2026-11-16T13:00:00.000Z";
  const metricKeys = [
    "UNAPPLIED",
    "RESERVED",
    "AWAITING_INVOICE",
    "RETURN",
    "COUNT",
    "SCHEDULE",
    "RECEIPT_PENDING",
    "RECEIPT_DISPUTED",
    "RECEIPT_PROPOSED",
    "RECEIPT_UNLINKED",
  ];
  const areas = { orders: true, inventory: true };
  const bucket = (count, undated = 0) => ({
    count,
    dated: count - undated,
    undated,
    oldestAt: count > undated ? "2026-11-13T12:00:00.000Z" : null,
  });
  const measures = (invoice = 4) =>
    Object.fromEntries(
      metricKeys.map((key, index) => [
        key,
        bucket(
          key === "AWAITING_INVOICE"
            ? invoice
            : [5, 2, 4, 2, 1, 2, 3, 1, 1, 2][index],
          key === "AWAITING_INVOICE" ? 1 : 0,
        ),
      ]),
    );
  const sources = [
    {
      unit: {
        id: currentId,
        code: "UCA",
        name: "U.C.A. Implementos Agrícolas",
      },
      current: {
        schemaVersion: 1,
        capturedAt: clock,
        areas,
        coordinationReady: true,
        metrics: measures(),
      },
      history: [
        {
          id: id(1002),
          day: "2026-11-13",
          capturedAt: "2026-11-13T12:00:00.000Z",
          areas,
          metrics: measures(6),
        },
        {
          id: id(1003),
          day: "2026-11-15",
          capturedAt: "2026-11-15T12:00:00.000Z",
          areas,
          metrics: measures(4),
        },
      ],
    },
    {
      unit: { id: capId, code: "CAPACLE", name: "Capacle" },
      current: {
        schemaVersion: 1,
        capturedAt: clock,
        areas,
        coordinationReady: true,
        metrics: measures(7),
      },
      history: [
        {
          id: id(1004),
          day: "2026-11-13",
          capturedAt: "2026-11-13T16:00:00.000Z",
          areas,
          metrics: measures(8),
        },
        {
          id: id(1005),
          day: "2026-11-14",
          capturedAt: "2026-11-14T16:00:00.000Z",
          areas,
          metrics: measures(7),
        },
      ],
    },
  ];
  let posts = 0,
    reads = 0,
    fail = false,
    mismatch = false,
    restricted = false,
    unmeasured = false;
  let todayCapture = null;
  const mask = (metrics, allowed) =>
    Object.fromEntries(
      Object.entries(metrics).map(([key, value]) => [
        key,
        allowed[key === "COUNT" || key === "SCHEDULE" ? "inventory" : "orders"]
          ? value
          : null,
      ]),
    );
  const pattern = fixtureURL + "/api/**";
  const handler = async (route) => {
    const req = route.request(),
      url = new URL(req.url());
    if (url.pathname !== "/api/management") return route.fallback();
    if (req.method() === "POST") {
      const body = req.postDataJSON();
      posts++;
      assert.deepEqual(Object.keys(body).sort(), [
        "expectedUnitId",
        "idempotencyKey",
      ]);
      assert.equal(body.expectedUnitId, currentId);
      assert.ok(body.idempotencyKey);
      if (mismatch)
        return route.fulfill({
          status: 409,
          json: {
            error:
              "A unidade ativa mudou. Atualize o painel antes de registrar a posição.",
            code: "UNIT_CHANGED",
          },
        });
      if (!todayCapture) {
        todayCapture = { id: id(1006), capturedAt: clock };
        sources[0].history.push({
          ...todayCapture,
          day: "2026-11-16",
          areas,
          metrics: structuredClone(sources[0].current.metrics),
        });
      }
      return route.fulfill({
        json: { data: { ...todayCapture, day: "2026-11-16", created: true } },
      });
    }
    reads++;
    if (fail)
      return route.fulfill({
        status: 503,
        json: {
          error: "Não foi possível consultar o painel. Tente novamente.",
        },
      });
    const ids = url.searchParams.get("units")?.split(",") ?? [currentId];
    const from = url.searchParams.get("from") ?? "2026-11-03",
      to = url.searchParams.get("to") ?? "2026-11-16";
    const days = Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1;
    const canRecord =
      data.permissions.includes("reports:read") ||
      data.permissions.includes("reconciliation:write");
    const allowedFor = (unit) => ({
      orders:
        data.permissions.includes("orders:read") &&
        !(restricted && unit.id === capId),
      inventory: data.permissions.some((p) =>
        ["inventory:read", "inventory:count"].includes(p),
      ),
    });
    const units = sources
      .filter((u) => ids.includes(u.unit.id))
      .map((source) => {
        const allowed = allowedFor(source.unit);
        return {
          unit: source.unit,
          current: {
            ...source.current,
            areas: allowed,
            metrics: mask(source.current.metrics, allowed),
          },
          canRecord,
          todayCapture: source.unit.id === currentId ? todayCapture : null,
          historyTruncated: false,
          history: source.history
            .filter((p) => p.day >= from && p.day <= to)
            .map((p) => ({
              ...p,
              areas: {
                ...allowed,
                orders:
                  allowed.orders &&
                  !(unmeasured && source.unit.id === currentId),
              },
              metrics: mask(p.metrics, {
                ...allowed,
                orders:
                  allowed.orders &&
                  !(unmeasured && source.unit.id === currentId),
              }),
            })),
        };
      });
    return route.fulfill({
      json: {
        data: {
          generatedAt: clock,
          currentUnitId: currentId,
          today: "2026-11-16",
          period: { from, to, days, timezone: "America/Sao_Paulo" },
          availableUnits: sources.map((s) => ({
            ...s.unit,
            areas: allowedFor(s.unit),
          })),
          units,
        },
      },
    });
  };
  await page.route(pattern, handler);
  async function view(permissions = user.permissions) {
    data.user = { ...user, permissions };
    data.permissions = permissions;
    await page.goto(fixtureURL + "/gestao");
  }
  const matrix = () =>
    page.locator(".management-comparison .management-matrix");
  const history = () => page.locator(".management-history-table");
  const row = (text) => matrix().locator("tbody tr").filter({ hasText: text });
  const dialog = () => page.getByRole("dialog");
  try {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await check(
      "Gerencial abre a fila atual com espera conhecida e sem registrar posições automaticamente",
      async () => {
        await view();
        await expect(
          page.getByRole("heading", { name: "Visão da operação", exact: true }),
        ).toBeVisible();
        await expect(matrix().locator("tbody tr")).toHaveCount(10);
        await expect(row("Aplicações sem baixa no faturamento")).toContainText(
          "4",
        );
        await expect(row("Aplicações sem baixa no faturamento")).toContainText(
          "1 sem data de abertura",
        );
        assert.equal(posts, 0);
        await expect(
          page.getByRole("checkbox", { name: "UCA", exact: true }),
        ).toBeDisabled();
        await noOverflow(page);
      },
    );
    await check(
      "Comparação inclui Capacle sem trocar a unidade ativa e mantém as filas identificadas",
      async () => {
        await page
          .getByRole("checkbox", { name: "CAPACLE", exact: true })
          .check();
        await expect(matrix().locator("thead th")).toHaveCount(3);
        await expect(
          row("Aplicações sem baixa no faturamento").locator(
            ".management-value",
          ),
        ).toHaveText(["4", "7"]);
        await expect(page.locator("#operational-unit")).toHaveValue(currentId);
        await page.screenshot({
          animations: "disabled",
          path: path.join(output, "gerencial-desktop-dark.png"),
          fullPage: true,
        });
      },
    );
    await check(
      "Evolução mostra observações, horários e lacunas sem preencher dias não medidos com zero",
      async () => {
        await expect(history().locator("tbody tr")).toHaveCount(3);
        const missing = history()
          .locator("tbody tr")
          .filter({ hasText: "14/11/2026" });
        await expect(missing).toContainText("Sem registro");
        const before = reads;
        await page
          .getByLabel("Indicador do histórico")
          .selectOption("RECEIPT_PENDING");
        await expect(history()).toContainText("Registrada em");
        assert.equal(reads, before);
        await page
          .getByLabel("Indicador do histórico")
          .selectOption("AWAITING_INVOICE");
      },
    );
    await check(
      "Revogação de área por unidade mostra sem acesso; área não observada tem indicação própria",
      async () => {
        restricted = true;
        unmeasured = true;
        await page
          .getByRole("button", { name: "Atualizar", exact: true })
          .click();
        await expect(row("Aplicações sem baixa no faturamento")).toContainText(
          "Sem acesso",
        );
        await expect(history()).toContainText("Área não medida");
        restricted = false;
        unmeasured = false;
        await page
          .getByRole("button", { name: "Atualizar", exact: true })
          .click();
        await expect(
          row("Aplicações sem baixa no faturamento").locator(
            ".management-value",
          ),
        ).toHaveText(["4", "7"]);
      },
    );
    await check(
      "Período é aplicado explicitamente e consulta histórica não altera a posição atual",
      async () => {
        const before = reads;
        await page.getByLabel("De", { exact: true }).fill("2026-11-13");
        await page.getByLabel("Até", { exact: true }).fill("2026-11-15");
        assert.equal(reads, before);
        await page
          .getByRole("button", { name: "Aplicar período", exact: true })
          .click();
        await expect(page.locator(".management-window")).toContainText(
          "13/11/2026 a 15/11/2026",
        );
        await expect(
          row("Aplicações sem baixa no faturamento").locator(
            ".management-value",
          ),
        ).toHaveText(["4", "7"]);
        await page.getByLabel("Até", { exact: true }).fill("2026-11-16");
        await page
          .getByRole("button", { name: "Aplicar período", exact: true })
          .click();
        await expect(page.locator(".management-window")).toContainText(
          "16/11/2026",
        );
      },
    );
    await check(
      "Mudança da unidade ativa bloqueia o registro e não confirma uma posição inexistente",
      async () => {
        mismatch = true;
        await page
          .getByRole("button", {
            name: "Registrar posição de hoje",
            exact: true,
          })
          .click();
        await dialog()
          .getByRole("button", { name: "Confirmar registro", exact: true })
          .click();
        await expect(dialog().getByRole("alert")).toContainText(
          "A unidade ativa mudou",
        );
        assert.equal(todayCapture, null);
        mismatch = false;
        await dialog()
          .getByRole("button", { name: "Consultar posição", exact: true })
          .click();
        await expect(dialog()).toHaveCount(0);
      },
    );
    await check(
      "Registro exige confirmação e guarda somente a unidade atual com o primeiro retrato do dia",
      async () => {
        const before = posts;
        await page
          .getByRole("button", {
            name: "Registrar posição de hoje",
            exact: true,
          })
          .click();
        assert.equal(posts, before);
        await expect(dialog()).toContainText("U.C.A. Implementos Agrícolas");
        await expect(dialog()).toContainText("primeiro registro");
        await dialog().screenshot({
          animations: "disabled",
          path: path.join(output, "registrar-posicao-dark.png"),
        });
        await dialog()
          .getByRole("button", { name: "Confirmar registro", exact: true })
          .click();
        await expect(dialog()).toHaveCount(0);
        await expect(page.getByRole("status")).toContainText(
          "Posição de 16/11/2026 registrada",
        );
        await expect(
          page.getByRole("button", {
            name: "Posição de hoje registrada",
            exact: true,
          }),
        ).toBeDisabled();
        assert.equal(
          sources[1].history.some((p) => p.day === "2026-11-16"),
          false,
        );
        sources[0].current.metrics.AWAITING_INVOICE = bucket(9, 1);
        await page
          .getByRole("button", { name: "Atualizar", exact: true })
          .click();
        await expect(
          row("Aplicações sem baixa no faturamento").locator(
            ".management-value",
          ),
        ).toHaveText(["9", "7"]);
        const saved = history()
          .locator("tbody tr")
          .filter({ hasText: "16/11/2026" });
        await expect(saved.locator(".management-value")).toHaveText(["4"]);
        await expect(saved).toContainText("Sem registro");
      },
    );
    await check(
      "Exportação separa consulta atual de posições históricas, preservando lacunas",
      async () => {
        const pending = page.waitForEvent("download");
        await page
          .getByRole("button", { name: "Exportar posição", exact: true })
          .click();
        const download = await pending,
          body = await fs.readFile(await download.path(), "utf8");
        assert.ok(body.includes('"Consulta atual";"UCA"'));
        assert.ok(body.includes('"Posição registrada";"UCA"'));
        assert.ok(body.includes('"2026-11-16"'));
        assert.ok(body.includes('"Com data de abertura"'));
        assert.ok(body.includes('"9"'));
        assert.ok(body.includes('"4"'));
      },
    );
    await check(
      "Painel e tabelas cabem em 390 e 320 pixels nos dois temas",
      async () => {
        for (const width of [390, 320]) {
          await page.setViewportSize({ width, height: 844 });
          await noOverflow(page);
          for (const selector of [
            ".management-context h2",
            ".management-highlights strong",
            ".management-matrix tbody th",
            ".management-value",
          ])
            await contrast(page, selector);
          await page.screenshot({
            animations: "disabled",
            path: path.join(output, `gerencial-dark-${width}.png`),
            fullPage: true,
          });
        }
        await page
          .getByRole("button", { name: "Ativar modo claro", exact: true })
          .click();
        await contrast(page, ".management-matrix tbody th");
        await contrast(page, ".management-value");
        await noOverflow(page);
        await page.screenshot({
          animations: "disabled",
          path: path.join(output, "gerencial-mobile-light.png"),
          fullPage: true,
        });
        await page
          .getByRole("button", { name: "Ativar modo escuro", exact: true })
          .click();
      },
    );
    await check(
      "Falha remove os números antigos e oferece retorno à unidade atual",
      async () => {
        fail = true;
        await page
          .getByRole("button", { name: "Atualizar", exact: true })
          .click();
        await expect(page.getByRole("alert")).toContainText(
          "Não foi possível consultar",
        );
        await expect(page.locator(".management-highlights")).toHaveCount(0);
        await expect(page.locator(".management-value")).toHaveCount(0);
        await expect(
          page.getByRole("button", { name: "Exportar posição", exact: true }),
        ).toBeDisabled();
        fail = false;
        await page
          .getByRole("button", { name: "Voltar à unidade atual", exact: true })
          .click();
        await expect(matrix().locator("thead th")).toHaveCount(2);
      },
    );
    await check(
      "Auditor consulta sem registrar; perfil sem área autorizada não abre o gerencial",
      async () => {
        await page.setViewportSize({ width: 1440, height: 1000 });
        await view(["reports:view", "orders:read", "inventory:read"]);
        await expect(matrix()).toBeVisible();
        await expect(
          page.getByRole("button", {
            name: /Registrar posição|Posição de hoje registrada/,
          }),
        ).toHaveCount(0);
        const before = reads;
        await view(["reports:view"]);
        await expect(
          page.getByText(
            "Seu perfil não possui permissão para acessar este módulo.",
            { exact: true },
          ),
        ).toBeVisible();
        await expect(
          page.getByRole("link", { name: "Gerencial", exact: true }),
        ).toHaveCount(0);
        assert.equal(reads, before);
      },
    );
    await check(
      "Atalho abre a fila da unidade atual sem trocar o escopo de acesso",
      async () => {
        await view();
        await expect(matrix()).toBeVisible();
        await page
          .getByRole("button", {
            name: "Pendências da unidade atual",
            exact: true,
          })
          .click();
        await expect(page).toHaveURL(fixtureURL + "/pendencias");
        await expect(page.locator("#operational-unit")).toHaveValue(currentId);
      },
    );
  } finally {
    await page.unroute(pattern, handler);
    data.user = original.user;
    data.permissions = original.permissions;
  }
}
