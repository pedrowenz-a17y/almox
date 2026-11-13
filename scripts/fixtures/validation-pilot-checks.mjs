import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { expect } from "@playwright/test";
import { id } from "./theme-data.mjs";
export async function verifyValidationPilot({
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
  const report = {
    unit: {
      id: user.unitId,
      code: "UCA",
      name: "U.C.A. Implementos Agrícolas",
    },
    generatedAt: "2026-11-13T10:00:00Z",
    period: {
      from: "2026-11-01",
      to: "2026-11-13",
      timezone: "UTC-03:00",
      previousFrom: "2026-10-19T03:00:00Z",
      previousUntilExclusive: "2026-11-01T03:00:00Z",
    },
    current: {
      exits: 10,
      linked: 8,
      linkedPercent: 80,
      deliveries: 5,
      handoffs: 4,
      handoffPercent: 80,
      counted: 4,
      divergent: 1,
      divergentPercent: 25,
    },
    previous: {
      exits: 0,
      linked: 0,
      linkedPercent: null,
      deliveries: 0,
      handoffs: 0,
      handoffPercent: null,
      counted: 0,
      divergent: 0,
      divergentPercent: null,
    },
    pending: { unapplied: 3, awaitingInvoice: 2, returns: 1 },
    definitions: [
      "Aplicação e baixa são contadas separadamente.",
      "O recebimento é declarado pelo operador.",
      "Pendências são atuais, não uma reconstrução histórica.",
      "Sem registros, não há taxa. Comparação descritiva não comprova melhoria causal.",
    ],
  };
  let run = null,
    posts = 0,
    indicatorReads = 0,
    stale = false;
  const pattern = fixtureURL + "/api/**";
  const handler = async (route) => {
    const req = route.request(),
      url = new URL(req.url());
    let value;
    if (url.pathname === "/api/reports")
      value = {
        title: "Posição atual de estoque",
        columns: [{ key: "code", label: "Código" }],
        rows: [],
        generatedAt: report.generatedAt,
      };
    else if (url.pathname === "/api/validation/indicators") {
      indicatorReads++;
      value = report;
    } else if (url.pathname === "/api/validation" && req.method() === "GET")
      value = run ? [{ ...run, completedSteps: run.steps.length }] : [];
    else if (url.pathname === "/api/validation" && req.method() === "POST") {
      posts++;
      const input = req.postDataJSON();
      assert.equal(input.from, report.period.from);
      assert.equal(input.to, report.period.to);
      assert.ok(input.idempotencyKey);
      run = {
        id: id(750),
        title: input.title,
        objective: input.objective,
        origin: input.origin,
        createdById: user.id,
        createdByName: "Pessoa da demonstração",
        createdAt: report.generatedAt,
        version: 0,
        status: "OPEN",
        closedAt: null,
        closedByName: null,
        conclusion: null,
        canRecord: true,
        canClose: true,
        steps: [],
        history: [],
        snapshot: structuredClone(report),
      };
      value = run;
    } else if (url.pathname === "/api/validation/" + id(750)) {
      if (req.method() === "POST") {
        posts++;
        const input = req.postDataJSON();
        assert.equal(input.expectedVersion, run.version);
        assert.ok(input.idempotencyKey);
        if (stale)
          return route.fulfill({
            status: 409,
            json: {
              error:
                "Outra pessoa atualizou o roteiro. Reabra a validação antes de registrar.",
              code: "VALIDATION_CHANGED",
            },
          });
        run.version++;
        if (input.action === "STEP") {
          run.steps = run.steps.filter((step) => step.id !== input.stepId);
          run.steps.push({
            id: input.stepId,
            outcome: input.outcome,
            note: input.note,
            reference: input.reference,
            recordedByName: "Pessoa da demonstração",
            recordedAt: report.generatedAt,
          });
        } else {
          assert.equal(run.steps.length, 7);
          run.status = "REPORTED_PASS";
          run.conclusion = input.conclusion;
          run.closedAt = report.generatedAt;
          run.closedByName = "Pessoa da demonstração";
          run.canRecord = false;
          run.canClose = false;
        }
        run.history.push({
          version: run.version,
          action:
            input.action === "STEP"
              ? "VALIDATION_STEP_RECORDED"
              : "VALIDATION_CLOSED",
          recordedAt: report.generatedAt,
          recordedByName: "Pessoa da demonstração",
          stepId: input.stepId ?? null,
          outcome: input.outcome ?? null,
          note: input.note ?? input.conclusion,
          reference: input.reference ?? null,
        });
      }
      value = {
        ...run,
        ...(data.user.permissions.includes("reports:read")
          ? {}
          : { canRecord: false, canClose: false }),
      };
    } else return route.fallback();
    return route.fulfill({ json: { data: value } });
  };
  await page.route(pattern, handler);
  const dialog = () => page.getByRole("dialog");
  const close = async () => {
    const button = dialog().getByRole("button", {
      name: "Fechar",
      exact: true,
    });
    await expect(button).toBeEnabled();
    await button.click();
  };
  try {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await check(
      "Relatórios preservam consulta de estoque e abrem indicadores somente ao selecionar a nova área",
      async () => {
        await page.goto(fixtureURL + "/relatorios");
        await page
          .getByRole("heading", { name: "Relatórios", exact: true })
          .waitFor();
        assert.equal(indicatorReads, 0);
        await page
          .getByRole("button", { name: "Validação e indicadores", exact: true })
          .click();
        await expect(page.locator(".validation-metrics article")).toHaveCount(
          3,
        );
        await expect(
          page
            .locator(".validation-metrics")
            .getByText("Sem base", { exact: false }),
        ).toHaveCount(3);
        await expect(page.locator(".validation-pending")).toContainText(
          "Fotografia da consulta de agora",
        );
        await noOverflow(page);
        await page.screenshot({
          animations: "disabled",
          path: path.join(output, "indicadores-desktop-dark.png"),
          fullPage: true,
        });
      },
    );
    await check(
      "Exportação identifica a janela anterior sem inventar percentuais",
      async () => {
        const pending = page.waitForEvent("download");
        await page
          .getByRole("button", { name: "Exportar indicadores", exact: true })
          .click();
        const download = await pending,
          body = await fs.readFile(await download.path(), "utf8");
        assert.ok(body.includes("2026-10-19"));
        assert.ok(body.includes("2026-10-31"));
        assert.ok(body.includes("Sem base"));
        assert.equal(posts, 0);
      },
    );
    await check(
      "Demonstração exige objetivo e origem e não executa operações de estoque",
      async () => {
        await page
          .getByRole("button", { name: "Iniciar validação", exact: true })
          .click();
        await dialog()
          .getByLabel("Título", { exact: true })
          .fill("Demonstração do fluxo de materiais");
        await dialog()
          .getByLabel("Objetivo", { exact: true })
          .fill(
            "Conferir o roteiro completo com documentos de uma unidade de teste.",
          );
        await dialog()
          .getByRole("button", { name: "Criar roteiro", exact: true })
          .click();
        await expect(dialog()).toContainText("0 de 7 etapas");
        assert.equal(posts, 1);
        await expect(
          dialog().getByRole("button", {
            name: "Encerrar validação",
            exact: false,
          }),
        ).toBeDisabled();
      },
    );
    await check(
      "Cada etapa registra resultado, responsável e referência antes do encerramento",
      async () => {
        for (const [index, title] of [
          "Identificar a ordem",
          "Reservar o material",
          "Entregar e aplicar",
          "Confirmar o faturamento",
          "Regularizar uma devolução",
          "Conferir o estoque",
          "Comparar com o ERP",
        ].entries()) {
          const item = dialog()
            .locator(".validation-steps li")
            .filter({ hasText: title });
          await item.locator("summary").click();
          await item
            .getByRole("button", { name: "Registrar resultado", exact: true })
            .click();
          await dialog()
            .getByLabel("O que foi observado", { exact: true })
            .fill("O comportamento foi conferido no cenário isolado de teste.");
          await dialog()
            .getByLabel("Referência da evidência", { exact: true })
            .fill("OP-TEST-01");
          await dialog()
            .getByRole("button", { name: "Salvar resultado", exact: true })
            .click();
          await expect(dialog()).toContainText(`${index + 1} de 7 etapas`);
          await expect(
            dialog().getByRole("button", { name: "Fechar", exact: true }),
          ).toBeEnabled();
        }
        await expect(
          dialog().getByRole("button", {
            name: "Encerrar validação",
            exact: false,
          }),
        ).toBeEnabled();
        await noOverflow(page);
        await dialog().screenshot({
          animations: "disabled",
          path: path.join(output, "roteiro-desktop-dark.png"),
        });
      },
    );
    await check(
      "Conflito de atualização é visível e não confirma conclusão",
      async () => {
        stale = true;
        await dialog()
          .getByLabel("Conclusão relatada", { exact: true })
          .fill(
            "As sete etapas foram verificadas conforme os registros do cenário.",
          );
        await dialog()
          .getByRole("button", { name: "Encerrar validação", exact: false })
          .click();
        await expect(dialog().locator('.notice[role="alert"]')).toContainText(
          "Outra pessoa atualizou",
        );
        assert.equal(run.status, "OPEN");
        stale = false;
        await dialog()
          .getByRole("button", { name: "Encerrar validação", exact: false })
          .click();
        await expect(
          dialog().locator(".validation-document-heading .badge"),
        ).toContainText("Concluído");
      },
    );
    await check(
      "Relatório do TCC preserva retrato, origem e evidências e contém instrução para PDF",
      async () => {
        const pending = page.waitForEvent("download");
        await dialog()
          .getByRole("button", {
            name: "Baixar relatório para o TCC",
            exact: true,
          })
          .click();
        const download = await pending,
          body = await fs.readFile(await download.path(), "utf8");
        assert.ok(body.includes("Relatório de validação de materiais"));
        assert.ok(body.includes("Demonstração"));
        assert.ok(body.includes("OP-TEST-01"));
        assert.ok(body.includes("Salvar como PDF"));
        assert.equal(body.includes("<script"), false);
        await close();
      },
    );
    await check(
      "Indicadores e roteiro cabem em 390 e 320 pixels com contraste no tema escuro",
      async () => {
        for (const width of [390, 320]) {
          await page.setViewportSize({ width, height: 844 });
          await noOverflow(page);
          await contrast(page, ".validation-metrics article h2");
          await page
            .getByRole("button", {
              name: "Abrir validação " + run.title,
              exact: true,
            })
            .click();
          await expect(dialog()).toBeVisible();
          await noOverflow(page);
          assert.ok(
            await dialog()
              .locator(".validation-document")
              .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
          );
          await dialog().screenshot({
            animations: "disabled",
            path: path.join(output, `roteiro-dark-${width}.png`),
          });
          await close();
        }
      },
    );
    await check(
      "Tema claro mantém indicadores legíveis e auditor consulta sem criar validação",
      async () => {
        await page.setViewportSize({ width: 1440, height: 1000 });
        await page
          .getByRole("button", { name: "Ativar modo claro", exact: true })
          .click();
        await contrast(page, ".validation-metrics article h2");
        await page.screenshot({
          animations: "disabled",
          path: path.join(output, "indicadores-desktop-light.png"),
          fullPage: true,
        });
        data.user = {
          ...user,
          permissions: ["reports:view"],
          role: { id: id(751), name: "AUDITOR" },
        };
        data.permissions = data.user.permissions;
        await page.goto(fixtureURL + "/relatorios");
        await page
          .getByRole("button", { name: "Validação e indicadores", exact: true })
          .click();
        await expect(page.locator(".validation-metrics article")).toHaveCount(
          3,
        );
        await expect(
          page.getByRole("button", { name: "Iniciar validação", exact: true }),
        ).toHaveCount(0);
        await page
          .getByRole("button", { name: "Ativar modo escuro", exact: true })
          .click();
      },
    );
  } finally {
    await page.unroute(pattern, handler);
    data.user = original.user;
    data.permissions = original.permissions;
  }
}
