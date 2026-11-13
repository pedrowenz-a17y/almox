import assert from "node:assert/strict";
import path from "node:path";
import { expect } from "@playwright/test";
import { id } from "./theme-data.mjs";

// Real components with isolated API responses; no company data or e-mail service.
export async function verifyOperationalAlerts({
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
  data.user = user;
  data.permissions = user.permissions;
  const now = "2026-11-13T13:00:00Z";
  const base = {
    occurrenceKey: id(801),
    orderId: id(802),
    orderKind: "PRODUCTION",
    code: "OP-2026-048",
    title: "Montagem do conjunto de transmissão",
    productCode: "ROL-6204",
    productName: "Rolamento rígido 6204",
    locationCode: "A-P02",
    quantity: "3",
    unit: "UN",
    assigneeId: user.id,
    assigneeName: "Equipe de demonstração",
    assigneeEligible: true,
    dueAt: "2026-11-13T12:00:00Z",
    overdue: true,
    missingHandoff: false,
    assignmentVersion: 1,
    readAt: null,
  };
  let items = [
    {
      ...base,
      id: id(803) + ":RETURN",
      type: "RETURN",
      alertKey: "a".repeat(64),
    },
    {
      ...base,
      id: id(804) + ":AWAITING_INVOICE",
      type: "AWAITING_INVOICE",
      alertKey: "b".repeat(64),
      code: "OP-2026-051",
      overdue: false,
      dueAt: "2026-11-13T20:00:00Z",
      quantity: "8",
      productCode: "PAR-M12",
      productName: "Parafuso sextavado M12",
      assigneeId: null,
      assigneeName: null,
    },
    {
      ...base,
      id: id(805) + ":SCHEDULE",
      type: "SCHEDULE",
      alertKey: "c".repeat(64),
      title: "Conferência semanal da estante A",
      orderId: null,
      orderKind: null,
      code: "A-P02",
      productCode: null,
      productName: null,
      quantity: null,
      unit: null,
      dueAt: "2026-11-12T12:00:00Z",
    },
  ];
  let history = [],
    posts = 0,
    stale = false,
    fail = false,
    ready = true,
    reads = 0;
  const pattern = fixtureURL + "/api/**";
  const handler = async (route) => {
    const req = route.request(),
      url = new URL(req.url());
    let value;
    if (url.pathname === "/api/alerts" && req.method() === "GET") {
      reads++;
      if (fail)
        return route.fulfill({
          status: 503,
          json: {
            error: "Não foi possível consultar a central. Tente novamente.",
          },
        });
      const allowed = items.filter((item) =>
        ["COUNT", "SCHEDULE"].includes(item.type)
          ? data.permissions.some((p) =>
              ["inventory:read", "inventory:count"].includes(p),
            )
          : data.permissions.includes("orders:read"),
      );
      const filter = url.searchParams,
        result = allowed.filter(
          (item) =>
            (filter.get("read") !== "UNREAD" || !item.readAt) &&
            (filter.get("read") !== "READ" || item.readAt) &&
            (filter.get("type") === "ALL" ||
              filter.get("type") === item.type) &&
            (filter.get("focus") !== "MINE" ||
              item.assigneeId === data.user.id) &&
            (filter.get("focus") !== "UNASSIGNED" || !item.assigneeId) &&
            (filter.get("focus") !== "OVERDUE" || item.overdue) &&
            (filter.get("focus") !== "TODAY" ||
              item.dueAt?.startsWith("2026-11-13")),
        );
      value = {
        items: result,
        total: result.length,
        page: 1,
        pageSize: 25,
        serverTime: now,
        coordinationReady: ready,
        totals: {},
        unassignedTotal: allowed.filter((item) => !item.assigneeId).length,
        overdueTotal: allowed.filter((item) => item.overdue).length,
        mineTotal: allowed.filter((item) => item.assigneeId === data.user.id)
          .length,
        summary: {
          unread: allowed.filter((item) => !item.readAt).length,
          read: allowed.filter((item) => item.readAt).length,
          dueToday: allowed.filter((item) =>
            item.dueAt?.startsWith("2026-11-13"),
          ).length,
          ineligible: 0,
        },
      };
    } else if (url.pathname === "/api/alerts/history")
      value = { items: history, truncated: false, serverTime: now };
    else if (url.pathname === "/api/alerts/read" && req.method() === "POST") {
      const input = req.postDataJSON();
      assert.ok(input.idempotencyKey);
      assert.deepEqual(Object.keys(input).sort(), [
        "alertKey",
        "idempotencyKey",
        "pendingId",
      ]);
      posts++;
      if (stale) {
        items[0] = {
          ...items[0],
          alertKey: "d".repeat(64),
          quantity: "4",
          readAt: null,
        };
        return route.fulfill({
          status: 409,
          json: {
            error:
              "O aviso mudou. Atualize a central antes de marcar a leitura.",
            code: "ALERT_CHANGED",
          },
        });
      }
      const item = items.find((item) => item.id === input.pendingId);
      assert.equal(input.alertKey, item.alertKey);
      item.readAt = now;
      value = { readAt: now, alertKey: item.alertKey };
    } else if (url.pathname === "/api/inventory-schedules")
      value = {
        items: [],
        assignees: [],
        total: 0,
        truncated: false,
        serverTime: now,
      };
    else return route.fallback();
    return route.fulfill({ json: { data: value } });
  };
  await page.route(pattern, handler);
  const cards = () => page.locator(".alerts-cards > li");
  const refresh = () =>
    page.getByRole("button", { name: "Atualizar", exact: true }).click();
  try {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await check(
      "Sino abre a central sem leituras automáticas e mostra resumo da unidade",
      async () => {
        await page.goto(fixtureURL + "/dashboard");
        await page.locator(".stats-grid").waitFor();
        assert.equal(reads, 0);
        await page
          .getByRole("link", { name: "Abrir central de alertas", exact: true })
          .click();
        await expect(cards()).toHaveCount(3);
        await expect(page.locator(".alerts-summary")).toContainText(
          "Não lidos",
        );
        await expect(page.locator(".alerts-summary strong").first()).toHaveText(
          "3",
        );
        assert.equal(posts, 0);
        await noOverflow(page);
        await page.screenshot({
          animations: "disabled",
          path: path.join(output, "alertas-desktop-dark.png"),
          fullPage: true,
        });
      },
    );
    await check(
      "Leitura pessoal preserva a pendência e separa lidos e não lidos",
      async () => {
        await cards()
          .first()
          .getByRole("button", { name: "Marcar como lido", exact: true })
          .click();
        await expect(cards().first()).toContainText("Lido por você");
        await expect(cards()).toHaveCount(3);
        await expect(page.getByRole("status")).toContainText(
          "A operação continua pendente",
        );
        assert.equal(posts, 1);
        await page.getByLabel("Filtrar leitura").selectOption("UNREAD");
        await expect(cards()).toHaveCount(2);
        await page.getByLabel("Filtrar leitura").selectOption("READ");
        await expect(cards()).toHaveCount(1);
        await expect(cards().first()).toContainText("Devolução a receber");
        await page.getByLabel("Filtrar leitura").selectOption("ALL");
        await expect(cards()).toHaveCount(3);
      },
    );
    await check(
      "Filtros de responsável, etapa e vencimento mantêm resumo geral separado",
      async () => {
        await page
          .getByLabel("Filtrar acompanhamento de alertas")
          .selectOption("UNASSIGNED");
        await expect(cards()).toHaveCount(1);
        await expect(page.locator(".alerts-summary strong").first()).toHaveText(
          "2",
        );
        await page
          .getByLabel("Filtrar acompanhamento de alertas")
          .selectOption("MINE");
        await expect(cards()).toHaveCount(2);
        await page
          .getByLabel("Filtrar acompanhamento de alertas")
          .selectOption("TODAY");
        await expect(cards()).toHaveCount(2);
        await page
          .getByLabel("Filtrar etapa dos alertas")
          .selectOption("RETURN");
        await expect(cards()).toHaveCount(1);
        await page
          .getByLabel("Filtrar acompanhamento de alertas")
          .selectOption("ALL");
        await page.getByLabel("Filtrar etapa dos alertas").selectOption("ALL");
        await expect(cards()).toHaveCount(3);
      },
    );
    await check(
      "Conflito mantém leitura sem confirmação e a atualização recebe a nova quantidade",
      async () => {
        items[0].readAt = null;
        await refresh();
        await expect(
          cards().first().getByRole("button", { name: "Marcar como lido" }),
        ).toBeVisible();
        stale = true;
        await cards()
          .first()
          .getByRole("button", { name: "Marcar como lido" })
          .click();
        await expect(page.locator('.notice[role="alert"]')).toContainText(
          "O aviso mudou",
        );
        assert.equal(items[0].readAt, null);
        stale = false;
        await refresh();
        await expect(cards().first()).toContainText("4 UN");
        await expect(cards().first()).toContainText("Não lido");
      },
    );
    await check(
      "Histórico distingue operação pendente, atualização, regularização e encerramento",
      async () => {
        history = [
          "PENDING",
          "UPDATED",
          "REGULARIZED",
          "CLOSED",
          "UNAVAILABLE",
        ].map((status, index) => ({
          id: id(820 + index),
          alertKey: String(index).repeat(64),
          readAt: now,
          item: items[0],
          status,
          reason: [
            "A leitura foi registrada, mas a operação continua pendente.",
            "Os dados ou a prioridade mudaram. Confira o aviso atual.",
            "O recebimento do material foi registrado.",
            "A solicitação foi encerrada sem recebimento.",
            "A origem não está disponível nesta unidade.",
          ][index],
        }));
        await page
          .getByRole("button", { name: "Minhas leituras", exact: true })
          .click();
        await expect(cards()).toHaveCount(5);
        for (const text of [
          "Ainda pendente",
          "Aviso atualizado",
          "Regularizado na origem",
          "Encerrado na origem",
          "Origem indisponível",
        ])
          await expect(page.locator(".alerts-history")).toContainText(text);
        await expect(
          cards().last().getByRole("button", { name: "Abrir registro" }),
        ).toBeDisabled();
        await page.screenshot({
          animations: "disabled",
          path: path.join(output, "leituras-desktop-dark.png"),
          fullPage: true,
        });
        await page
          .getByRole("button", { name: "Ver avisos atuais", exact: true })
          .click();
        await expect(cards()).toHaveCount(3);
        await expect(page.getByLabel("Filtrar leitura")).toHaveValue("UNREAD");
      },
    );
    await check(
      "Aviso da agenda abre a programação existente sem marcar como lido",
      async () => {
        const before = posts;
        await cards()
          .filter({ hasText: "Conferência semanal da estante A" })
          .getByRole("button", { name: "Abrir registro" })
          .click();
        await expect(page).toHaveURL(fixtureURL + "/conferencias");
        assert.equal(posts, before);
        await page.goto(fixtureURL + "/alertas");
        await expect(cards()).toHaveCount(3);
      },
    );
    await check(
      "Celular em 390 e 320 pixels mantém cartões e ações legíveis nos dois temas",
      async () => {
        for (const width of [390, 320]) {
          await page.setViewportSize({ width, height: 844 });
          await noOverflow(page);
          for (const selector of [
            ".alerts-summary strong",
            ".alerts-cards h2",
            ".alerts-facts dd",
            ".alerts-read-state",
          ])
            await contrast(page, selector);
          await page.screenshot({
            animations: "disabled",
            path: path.join(output, `alertas-mobile-dark-${width}.png`),
            fullPage: true,
          });
        }
        await page
          .getByRole("button", { name: "Ativar modo claro", exact: true })
          .click();
        for (const selector of [
          ".alerts-summary strong",
          ".alerts-cards h2",
          ".alerts-facts dd",
        ])
          await contrast(page, selector);
        await noOverflow(page);
        await page.screenshot({
          animations: "disabled",
          path: path.join(output, "alertas-mobile-light.png"),
          fullPage: true,
        });
        await page
          .getByRole("button", { name: "Ativar modo escuro", exact: true })
          .click();
      },
    );
    await check(
      "Falha de consulta remove os números antigos e permite tentar novamente",
      async () => {
        fail = true;
        await refresh();
        await expect(page.locator('.notice[role="alert"]')).toContainText(
          "Não foi possível consultar",
        );
        await expect(page.locator(".alerts-summary")).toHaveCount(0);
        await expect(cards()).toHaveCount(0);
        fail = false;
        await refresh();
        await expect(cards()).toHaveCount(3);
      },
    );
    await check(
      "Preparação pendente da etapa 3 mantém avisos e orienta responsáveis e prazos",
      async () => {
        ready = false;
        await refresh();
        await expect(
          page.locator(".alerts-workspace .notice.warning"),
        ).toContainText("preparação da etapa 3");
        await expect(cards()).toHaveCount(3);
        ready = true;
      },
    );
    await check(
      "Perfil de conferência consulta sua área; perfil sem escopo não carrega alertas",
      async () => {
        await page.setViewportSize({ width: 1440, height: 1000 });
        data.user = {
          ...user,
          permissions: ["inventory:read"],
          role: { id: id(830), name: "CONFERENTE" },
        };
        data.permissions = data.user.permissions;
        await page.goto(fixtureURL + "/alertas");
        await expect(cards()).toHaveCount(1);
        await expect(cards().first()).toContainText("Conferência semanal");
        data.user = { ...user, permissions: ["catalog:write"] };
        data.permissions = data.user.permissions;
        const before = reads;
        await page.goto(fixtureURL + "/alertas");
        await expect(
          page.getByText(
            "Seu perfil não possui permissão para acessar este módulo.",
            { exact: true },
          ),
        ).toBeVisible();
        assert.equal(reads, before);
        await expect(
          page.getByRole("link", { name: "Central de alertas", exact: true }),
        ).toHaveCount(0);
      },
    );
  } finally {
    await page.unroute(pattern, handler);
    data.user = original.user;
    data.permissions = original.permissions;
  }
}
