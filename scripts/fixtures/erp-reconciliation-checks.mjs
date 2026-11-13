import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs/promises";
import { expect } from "@playwright/test";
import { id } from "./theme-data.mjs";

export async function verifyErpReconciliation({
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
  data.user = original.user;
  data.permissions = original.permissions;
  const timestamp = "2026-11-12T13:00:00.123Z";
  const context = {
    erpName: "ERP da demonstração",
    cutoffNote:
      "Relatório encerrado às 10h. Conferir as aplicações do turno da manhã.",
    basis: "LEDGER_BALANCE",
  };
  const source = {
    ...context,
    fingerprint: "b".repeat(64),
    revision: 1,
    previousBatchId: null,
    mapping: null,
  };
  const base = {
    schemaVersion: 2,
    kind: "STOCK",
    unitCode: "UCA",
    sourceName: "Posição de estoque · novembro",
    referenceAt: timestamp,
    comparedAt: timestamp,
    snapshotHash: "a".repeat(64),
    source,
    scope: "Somente as linhas informadas no arquivo.",
    criterion: "Saldo contábil do Almox menos saldo do ERP.",
    notice:
      "A conferência usa os valores atuais do Almox e preserva os documentos anteriores.",
    totals: { rows: 2, matches: 1, differences: 1, incomplete: 0 },
    rows: [
      {
        code: "ROL-6204",
        location: "A-P02",
        localValue: "50.125",
        externalValue: "45.125",
        difference: "5.000",
        status: "DIFFERENCE",
        reason: null,
      },
      {
        code: "PAR-M12",
        location: "B-P01",
        localValue: "20.000",
        externalValue: "20.000",
        difference: "0.000",
        status: "MATCH",
        reason: null,
      },
    ],
  };
  const reviewState = (
    status = "PENDING",
    canReview = true,
    reason = null,
  ) => ({
    status,
    canReview,
    reason,
    note: null,
    analyses: [],
    reviewerName: null,
    reviewedAt: null,
    nextBatchId: null,
  });
  const docs = new Map([
    [
      id(601),
      {
        id: id(601),
        result: structuredClone(base),
        createdAt: timestamp,
        createdBy: { name: "Marina Souza" },
        review: reviewState(),
      },
    ],
    [
      id(602),
      {
        id: id(602),
        result: {
          ...structuredClone(base),
          sourceName: "Estoque conferido",
          totals: { rows: 1, matches: 1, differences: 0, incomplete: 0 },
          rows: [base.rows[1]],
        },
        createdAt: timestamp,
        createdBy: { name: "Marina Souza" },
        review: {
          ...reviewState("MATCHED", false),
          note: "Quantidades conferidas com os documentos do turno.",
          reviewerName: "Renato Lima",
          reviewedAt: timestamp,
        },
      },
    ],
    [
      id(603),
      {
        id: id(603),
        result: {
          ...structuredClone(base),
          kind: "ORDER_COST",
          sourceName: "Custos de ordens",
          source: { ...source, basis: "INVOICED_MATERIALS" },
          totals: { rows: 1, matches: 0, differences: 0, incomplete: 1 },
          rows: [
            {
              code: "OP-2026-042",
              location: null,
              localValue: null,
              externalValue: "450.00",
              difference: null,
              status: "INCOMPLETE",
              reason: "Custo histórico ausente no material.",
            },
          ],
        },
        createdAt: timestamp,
        createdBy: { name: "Marina Souza" },
        review: reviewState(),
      },
    ],
    [
      id(604),
      {
        id: id(604),
        result: {
          ...structuredClone(base),
          sourceName: "Registro de outubro",
          source: null,
        },
        createdAt: timestamp,
        createdBy: { name: "Renato Lima" },
        review: reviewState(
          "LEGACY",
          false,
          "Este registro é anterior ao acompanhamento. Importe o arquivo com a origem e os critérios.",
        ),
      },
    ],
    [
      id(605),
      {
        id: id(605),
        result: { ...structuredClone(base), sourceName: "Documento anterior" },
        createdAt: timestamp,
        createdBy: { name: "Marina Souza" },
        review: {
          ...reviewState(
            "PENDING",
            false,
            "Há uma conferência mais recente deste arquivo.",
          ),
          nextBatchId: id(602),
        },
      },
    ],
  ]);
  let previews = 0,
    saves = 0,
    reviews = 0,
    costReads = 0,
    stale = false,
    duplicate = false,
    invalidMapping = false,
    lastInput;
  const pattern = fixtureURL + "/api/**";
  const handler = async (route) => {
    const request = route.request(),
      url = new URL(request.url());
    let value;
    if (url.pathname === "/api/reconciliation/setup")
      value = { unitCode: "UCA", unitName: "U.C.A. Implementos Agrícolas" };
    else if (
      url.pathname === "/api/reconciliation" &&
      request.method() === "GET"
    )
      value = [...docs.values()].map((doc) => ({
        ...doc,
        kind: doc.result.kind,
        sourceName: doc.result.sourceName,
        referenceAt: doc.result.referenceAt,
        totals: doc.result.totals,
        revision: doc.result.source?.revision,
      }));
    else if (
      url.pathname === "/api/reconciliation/preview" &&
      request.method() === "POST"
    ) {
      previews++;
      lastInput = request.postDataJSON();
      assert.equal(lastInput.context.erpName, context.erpName);
      if (invalidMapping)
        return route.fulfill({
          status: 400,
          json: {
            error: "Associe uma coluna diferente a cada campo da conferência.",
          },
        });
      value = {
        ...structuredClone(base),
        sourceName: lastInput.sourceName,
        source: {
          ...source,
          ...lastInput.context,
          revision: lastInput.recheckOf ? 2 : 1,
          previousBatchId: lastInput.recheckOf ?? null,
        },
      };
    } else if (
      url.pathname === "/api/reconciliation" &&
      request.method() === "POST"
    ) {
      saves++;
      const input = request.postDataJSON();
      assert.ok(input.idempotencyKey);
      assert.equal(input.context.erpName, context.erpName);
      value = duplicate
        ? { ...docs.get(id(601)), reused: true }
        : {
            id: id(606),
            createdAt: timestamp,
            createdBy: { name: user.name },
            result: { ...base, sourceName: input.sourceName },
            review: reviewState(
              "PENDING",
              false,
              "Outra pessoa autorizada precisa concluir a conferência que você registrou.",
            ),
            reused: false,
          };
      docs.set(value.id, value);
    } else if (/\/api\/reconciliation\/[^/]+\/review$/.test(url.pathname)) {
      reviews++;
      const input = request.postDataJSON(),
        doc = docs.get(url.pathname.split("/")[3]);
      assert.ok(doc);
      assert.equal(input.snapshotHash, base.snapshotHash);
      assert.ok(input.idempotencyKey);
      if (stale)
        return route.fulfill({
          status: 409,
          json: {
            error:
              "Os valores do Almox mudaram depois deste documento. Use Nova conferência para consultar os valores atuais.",
            code: "RECONCILIATION_CHANGED",
          },
        });
      if (input.decision === "ACCEPT" && doc.result.totals.differences) {
        assert.equal(input.analyses.length, 1);
        assert.equal(input.analyses[0].code, "ROL-6204");
        assert.equal(input.analyses[0].reference, "OP-2026-042");
      }
      doc.review = {
        ...reviewState(
          input.decision === "RETURN"
            ? "RETURNED"
            : input.analyses.length
              ? "WITH_DIFFERENCES"
              : "MATCHED",
          false,
        ),
        note: input.note,
        analyses: input.analyses,
        reviewerName: "Pedro da conferência",
        reviewedAt: timestamp,
      };
      value = doc;
    } else if (/\/api\/reconciliation\/[^/]+\/recheck$/.test(url.pathname)) {
      value = {
        kind: "STOCK",
        sourceName: base.sourceName,
        referenceAt: timestamp,
        delimiter: ";",
        decimalFormat: "CANONICAL",
        context,
        recheckOf: url.pathname.split("/")[3],
        csv: "unidade;produto;local;quantidade\nUCA;ROL-6204;A-P02;45.125\nUCA;PAR-M12;B-P01;20.000",
      };
    } else if (/\/api\/reconciliation\/[^/]+$/.test(url.pathname)) {
      value = docs.get(url.pathname.split("/")[3]);
      assert.ok(value);
    } else if (url.pathname === "/api/order-costs") {
      costReads++;
      value = {
        page: 1,
        pageSize: 25,
        total: 1,
        criterion:
          "Custo de materiais capturado no faturamento, descontadas as devoluções.",
        currency: "BRL",
        orders: [
          {
            id: id(610),
            code: "OP-2026-042",
            title: "Montagem de implemento",
            kind: "PRODUCTION",
            status: "INVOICED",
            invoiceReference: "NF-100",
            invoicedAt: timestamp,
            completeness: "COMPLETE",
            missingCostCount: 0,
            knownSubtotal: "125.50",
            netMaterialCost: "125.50",
            materials: [
              {
                id: id(611),
                productCode: "ROL-6204",
                productName: "Rolamento",
                unit: "UN",
                consumedQuantity: "3.000",
                returnedQuantity: "1.000",
                netQuantity: "2.000",
                invoicedUnitCost: "62.75",
                netMaterialCost: "125.50",
              },
            ],
          },
        ],
      };
    } else return route.fallback();
    return route.fulfill({ json: { data: value } });
  };
  await page.route(pattern, handler);
  const dialog = () => page.getByRole("dialog");
  const open = async (name) => {
    await page
      .getByRole("button", { name: "Abrir conferência " + name, exact: true })
      .click();
    await dialog().waitFor();
  };
  const noDocumentClipping = async () => {
    await noOverflow(page);
    const sizes = await dialog().evaluate((element) => {
      const content = element.querySelector(".recon-document");
      const frame = element.getBoundingClientRect();
      const controls = [
        ...content.querySelectorAll("button, input, select, textarea"),
      ].filter((node) => node.getBoundingClientRect().width > 0);
      return {
        contentFits: content.scrollWidth <= content.clientWidth + 1,
        controlsFit: controls.every((node) => {
          const rect = node.getBoundingClientRect();
          return rect.left >= frame.left - 1 && rect.right <= frame.right + 1;
        }),
      };
    });
    assert.ok(
      sizes.contentFits,
      "O documento não pode cortar o conteúdo horizontalmente.",
    );
    assert.ok(
      sizes.controlsFit,
      "As ações precisam caber dentro do documento.",
    );
  };
  const close = async () => {
    const button = dialog().getByRole("button", {
      name: "Fechar",
      exact: true,
    });
    await expect(button).toBeEnabled();
    await button.click();
    await expect(dialog()).toHaveCount(0);
  };
  const fillImport = async (
    csv = "Filial;Material;Depósito;Saldo;Descrição\nUCA;ROL-6204;A-P02;45,125;Rolamento",
  ) => {
    await page
      .getByRole("button", { name: "Importar arquivo", exact: true })
      .click();
    await page
      .getByLabel("ERP de origem", { exact: true })
      .fill(context.erpName);
    await page
      .getByLabel("Nome do relatório", { exact: true })
      .fill(base.sourceName);
    await page
      .getByLabel("Corte e observações", { exact: true })
      .fill(context.cutoffNote);
    await page.getByLabel("Arquivo CSV", { exact: true }).setInputFiles({
      name: "estoque.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(csv),
    });
  };
  const map = async () => {
    await page.getByLabel("Unidade", { exact: true }).selectOption("Filial");
    await page
      .getByLabel("Código do produto", { exact: true })
      .selectOption("Material");
    await page
      .getByLabel("Código do local", { exact: true })
      .selectOption("Depósito");
    await page.getByLabel("Quantidade", { exact: true }).selectOption("Saldo");
  };
  const analysis = async () => {
    await dialog()
      .getByRole("button", { name: "Registrar análise", exact: true })
      .click();
    await dialog()
      .getByLabel("Referência da análise", { exact: true })
      .fill("OP-2026-042");
    await dialog()
      .getByLabel("O que foi verificado", { exact: true })
      .fill(
        "Aplicação do turno ainda pendente no ERP, conforme a ordem de produção.",
      );
    await dialog()
      .getByRole("button", { name: "Usar análise", exact: true })
      .click();
  };
  try {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await check(
      "Conciliação mostra situação e revisões sem carregar custos desnecessariamente",
      async () => {
        await page.goto(fixtureURL + "/conciliacao");
        await page
          .getByRole("heading", { name: "Conferências do ERP", exact: true })
          .waitFor();
        await expect(
          page.getByText("Posição de estoque · novembro", { exact: true }),
        ).toBeVisible();
        assert.equal(previews, 0);
        assert.equal(costReads, 0);
        await noOverflow(page);
        await page.evaluate(() => scrollTo(0, 0));
        await page.evaluate(() => scrollTo(0, 0));
        await page.screenshot({
          animations: "disabled",
          path: path.join(output, "conferencias-desktop-dark.png"),
          fullPage: true,
        });
      },
    );
    await check(
      "Busca e situação localizam conferências antigas e pendentes",
      async () => {
        await page
          .getByLabel("Situação da conferência", { exact: true })
          .selectOption("LEGACY");
        await expect(page.locator(".recon-history tbody tr")).toHaveCount(1);
        await page
          .getByLabel("Situação da conferência", { exact: true })
          .selectOption("ALL");
        await page
          .getByLabel("Buscar conferência", { exact: true })
          .fill("novembro");
        await expect(page.locator(".recon-history tbody tr")).toHaveCount(1);
        await page.getByLabel("Buscar conferência", { exact: true }).fill("");
      },
    );
    await check(
      "Importação exige origem, corte e confirmação do critério e associa colunas explicitamente",
      async () => {
        await fillImport();
        await expect(
          page.getByRole("button", {
            name: "Visualizar conferência",
            exact: true,
          }),
        ).toBeDisabled();
        await map();
        await page
          .getByRole("checkbox", {
            name: /O relatório contém o saldo contábil/,
          })
          .check();
        await expect(
          page.getByRole("button", {
            name: "Visualizar conferência",
            exact: true,
          }),
        ).toBeEnabled();
        await page.evaluate(() => scrollTo(0, 0));
        await page.evaluate(() => scrollTo(0, 0));
        await page.screenshot({
          animations: "disabled",
          path: path.join(output, "importacao-desktop-dark.png"),
          fullPage: true,
        });
        await page
          .getByRole("button", { name: "Visualizar conferência", exact: true })
          .click();
        await dialog().waitFor();
        assert.deepEqual(lastInput.mapping, {
          unit: "Filial",
          code: "Material",
          location: "Depósito",
          value: "Saldo",
        });
        assert.equal(lastInput.context.basis, "LEDGER_BALANCE");
      },
    );
    await check(
      "Prévia separa diferenças e linhas que conferem antes de salvar",
      async () => {
        await expect(dialog().locator(".recon-lines tbody tr")).toHaveCount(1);
        await expect(dialog()).toContainText("45,125");
        await dialog()
          .getByLabel("Linhas da conferência", { exact: true })
          .selectOption("ALL");
        await expect(dialog().locator(".recon-lines tbody tr")).toHaveCount(2);
        await dialog()
          .getByLabel("Buscar linha da conferência", { exact: true })
          .fill("PAR-M12");
        await expect(dialog().locator(".recon-lines tbody tr")).toHaveCount(1);
        await dialog()
          .getByLabel("Buscar linha da conferência", { exact: true })
          .fill("");
        assert.equal(saves, 0);
        await noOverflow(page);
      },
    );
    await check(
      "Arquivo repetido abre documento existente e não apresenta novo registro como criado",
      async () => {
        duplicate = true;
        await dialog()
          .getByRole("button", { name: "Registrar conferência", exact: true })
          .click();
        await expect(dialog().getByRole("status")).toContainText(
          "Este arquivo já foi registrado",
        );
        assert.equal(saves, 1);
        await expect(
          dialog().getByRole("button", {
            name: "Registrar conferência",
            exact: true,
          }),
        ).toHaveCount(0);
        await close();
        duplicate = false;
      },
    );
    await check(
      "Autor recebe orientação para revisão independente e não vê aprovação própria",
      async () => {
        await fillImport(
          "unidade;produto;local;quantidade\nUCA;ROL-6204;A-P02;44,125",
        );
        await page
          .getByLabel("Nome do relatório", { exact: true })
          .fill("Conferência registrada pelo autor");
        await page
          .getByRole("checkbox", {
            name: /O relatório contém o saldo contábil/,
          })
          .check();
        await page
          .getByRole("button", { name: "Visualizar conferência", exact: true })
          .click();
        await dialog()
          .getByRole("button", { name: "Registrar conferência", exact: true })
          .click();
        await expect(dialog()).toContainText(
          "Outra pessoa autorizada precisa concluir",
        );
        await expect(
          dialog().getByRole("button", {
            name: "Revisar documento",
            exact: true,
          }),
        ).toHaveCount(0);
        await close();
      },
    );
    await check(
      "Revisor analisa cada diferença com causa e documento antes de concluir com ressalvas",
      async () => {
        await open(base.sourceName);
        await dialog()
          .getByRole("button", { name: "Revisar documento", exact: true })
          .click();
        await expect(
          dialog().getByRole("button", {
            name: "Concluir com ressalvas",
            exact: true,
          }),
        ).toBeDisabled();
        await analysis();
        await dialog()
          .getByLabel("Parecer geral", { exact: true })
          .fill(
            "Diferença analisada com a ordem do turno; lançamento no ERP ainda pendente.",
          );
        await expect(
          dialog().getByRole("button", {
            name: "Concluir com ressalvas",
            exact: true,
          }),
        ).toBeEnabled();
        await noOverflow(page);
        await dialog().screenshot({
          animations: "disabled",
          path: path.join(output, "revisao-desktop-dark.png"),
        });
        await dialog()
          .getByRole("button", { name: "Concluir com ressalvas", exact: true })
          .click();
        await expect(dialog()).toContainText("Com ressalvas");
        await expect(dialog()).toContainText("Parecer da revisão");
        assert.equal(reviews, 1);
      },
    );
    await check(
      "Exportação inclui parecer e referências e protege células interpretadas como fórmulas",
      async () => {
        docs.get(id(601)).review.note = '=HYPERLINK("teste")';
        await close();
        await open(base.sourceName);
        const pendingDownload = page.waitForEvent("download");
        await dialog()
          .getByRole("button", { name: "Exportar conferência", exact: true })
          .click();
        const downloaded = await pendingDownload,
          payload = await fs.readFile(await downloaded.path(), "utf8");
        assert.ok(payload.includes("OP-2026-042"));
        assert.ok(payload.includes("\"'=HYPERLINK"));
        assert.ok(payload.includes("Com ressalvas"));
        await close();
      },
    );
    await check(
      "Mudança no Almox interrompe revisão e oferece nova consulta sem sobrescrever documento",
      async () => {
        docs.get(id(601)).review = reviewState();
        stale = true;
        await open(base.sourceName);
        await dialog()
          .getByRole("button", { name: "Revisar documento", exact: true })
          .click();
        await analysis();
        await dialog()
          .getByLabel("Parecer geral", { exact: true })
          .fill("Conferência para verificar alteração concorrente.");
        await dialog()
          .getByRole("button", { name: "Concluir com ressalvas", exact: true })
          .click();
        await expect(dialog().locator('.notice[role="alert"]')).toContainText(
          "valores do Almox mudaram",
        );
        await expect(
          dialog().getByRole("button", {
            name: "Nova conferência",
            exact: true,
          }),
        ).toBeVisible();
        stale = false;
        await dialog()
          .getByRole("button", { name: "Nova conferência", exact: true })
          .click();
        await expect(dialog()).toHaveCount(0);
        await expect(
          page.getByRole("heading", { name: "Rever conferência", exact: true }),
        ).toBeVisible();
        await expect(
          page.getByLabel("Data e hora do relatório", { exact: true }),
        ).toBeDisabled();
        await expect(
          page.getByLabel("Conferir", { exact: true }),
        ).toBeDisabled();
        await page
          .getByLabel("Corte e observações", { exact: true })
          .fill(
            "Corte revisto com os documentos do turno, preservando a mesma exportação.",
          );
        await page
          .getByRole("checkbox", {
            name: /O relatório contém o saldo contábil/,
          })
          .check();
        await page
          .getByRole("button", { name: "Visualizar conferência", exact: true })
          .click();
        await expect(dialog()).toContainText("revisão 2");
        assert.equal(
          lastInput.context.cutoffNote,
          "Corte revisto com os documentos do turno, preservando a mesma exportação.",
        );
        assert.equal(lastInput.recheckOf, id(601));
        assert.equal(lastInput.referenceAt, timestamp);
        await expect(
          dialog().getByRole("button", {
            name: "Registrar conferência",
            exact: true,
          }),
        ).toBeEnabled();
        await close();
        await page
          .getByRole("button", { name: "Fechar importação", exact: true })
          .click();
      },
    );
    await check(
      "Custo histórico ausente bloqueia conclusão e permite devolver para análise",
      async () => {
        await open("Custos de ordens");
        await dialog()
          .getByRole("button", { name: "Revisar documento", exact: true })
          .click();
        await expect(
          dialog().getByLabel("Resultado", { exact: true }),
        ).toHaveValue("RETURN");
        await expect(
          dialog().getByRole("option", {
            name: "Concluir conferência",
            exact: true,
          }),
        ).toHaveAttribute("disabled", "");
        await dialog()
          .getByLabel("Parecer geral", { exact: true })
          .fill("Verificar o custo histórico da ordem antes de consolidar.");
        await dialog()
          .getByRole("button", { name: "Devolver para análise", exact: true })
          .click();
        await expect(
          dialog().locator(".recon-document-heading .badge"),
        ).toHaveText("Devolvido para análise");
        await close();
      },
    );
    await check(
      "Registro anterior permanece consultável e revisão seguinte tem navegação explícita",
      async () => {
        await open("Registro de outubro");
        await expect(dialog()).toContainText("Registro anterior");
        await expect(
          dialog().getByRole("button", {
            name: "Revisar documento",
            exact: true,
          }),
        ).toHaveCount(0);
        await close();
        await open("Documento anterior");
        await dialog()
          .getByRole("button", { name: "Abrir revisão seguinte", exact: false })
          .click();
        await expect(dialog()).toContainText("Estoque conferido");
        await close();
      },
    );
    await check(
      "Arquivo grande ou CSV malformado é recusado antes da consulta",
      async () => {
        const before = previews;
        await fillImport(
          'unidade;produto;local;quantidade\nUCA;"aspas quebradas',
        );
        await expect(
          page.locator(".recon-import").getByRole("alert"),
        ).toContainText("aspas não fechadas");
        await page.getByLabel("Arquivo CSV", { exact: true }).setInputFiles({
          name: "grande.csv",
          mimeType: "text/csv",
          buffer: Buffer.alloc(1048577, 65),
        });
        await expect(
          page.locator('.recon-workbench > .notice[role="alert"]'),
        ).toContainText("até 1 MB");
        assert.equal(previews, before);
        await page
          .getByRole("button", { name: "Fechar importação", exact: true })
          .click();
      },
    );
    await check(
      "Associação inválida enviada ao servidor mantém arquivo e mostra correção necessária",
      async () => {
        await fillImport();
        await map();
        await page
          .getByRole("checkbox", {
            name: /O relatório contém o saldo contábil/,
          })
          .check();
        invalidMapping = true;
        await page
          .getByRole("button", { name: "Visualizar conferência", exact: true })
          .click();
        await expect(
          page.locator('.recon-workbench > .notice[role="alert"]'),
        ).toContainText("coluna diferente");
        await expect(
          page.getByText("estoque.csv", { exact: true }),
        ).toBeVisible();
        invalidMapping = false;
        await page
          .getByRole("button", { name: "Fechar importação", exact: true })
          .click();
      },
    );
    await check(
      "Documentos e importação cabem em 390 e 320 pixels no modo escuro",
      async () => {
        for (const width of [390, 320]) {
          await page.setViewportSize({ width, height: 844 });
          await noOverflow(page);
          await open(base.sourceName);
          await noDocumentClipping();
          for (const selector of [
            ".recon-dates dt",
            ".recon-totals span",
            ".recon-document-heading .text-button",
          ])
            await contrast(page, selector);
          await dialog().screenshot({
            animations: "disabled",
            path: path.join(output, `documento-dark-${width}.png`),
          });
          await close();
        }
      },
    );
    await check(
      "Modo claro mantém contraste e a mesma hierarquia da conferência",
      async () => {
        await page.setViewportSize({ width: 1440, height: 1000 });
        await page
          .getByRole("button", { name: "Ativar modo claro", exact: true })
          .click();
        await open("Estoque conferido");
        await noDocumentClipping();
        for (const selector of [
          ".recon-dates dt",
          ".recon-totals span",
          ".recon-document-heading .text-button",
        ])
          await contrast(page, selector);
        await dialog().screenshot({
          animations: "disabled",
          path: path.join(output, "documento-desktop-light.png"),
        });
        await close();
        await page
          .getByRole("button", { name: "Ativar modo escuro", exact: true })
          .click();
      },
    );
    await check(
      "Custos continuam consultáveis por ordem com detalhes históricos dos materiais",
      async () => {
        await page
          .getByRole("button", { name: "Custos por ordem", exact: true })
          .click();
        await expect(
          page
            .locator(".recon-costs tbody tr")
            .filter({ hasText: "OP-2026-042" }),
        ).toBeVisible();
        assert.ok(costReads > 0);
        await page
          .getByRole("button", { name: "Ver materiais", exact: true })
          .click();
        await expect(dialog()).toContainText("62,75");
        await expect(dialog()).toContainText("125,50");
        await close();
      },
    );
    await check(
      "Auditor visualiza conferência sem botão de revisão e sem aba de custos",
      async () => {
        data.user = {
          ...user,
          roleId: id(699),
          role: { id: id(699), name: "AUDITOR" },
          permissions: ["reports:view"],
        };
        data.permissions = data.user.permissions;
        docs.get(id(601)).review = reviewState(
          "PENDING",
          false,
          "Seu perfil permite consultar esta conferência.",
        );
        await page.goto(fixtureURL + "/conciliacao");
        await open(base.sourceName);
        await expect(
          dialog().getByRole("button", {
            name: "Revisar documento",
            exact: true,
          }),
        ).toHaveCount(0);
        await expect(
          dialog().getByRole("button", {
            name: "Nova conferência",
            exact: true,
          }),
        ).toHaveCount(0);
        await close();
        await expect(
          page.getByRole("button", { name: "Custos por ordem", exact: true }),
        ).toHaveCount(0);
      },
    );
  } finally {
    await page.unroute(pattern, handler);
    data.user = original.user;
    data.permissions = original.permissions;
  }
}
