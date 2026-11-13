import assert from "node:assert/strict";
import path from "node:path";
import { expect } from "@playwright/test";
import { id } from "./theme-data.mjs";

export async function verifyDeliveryReceipts({
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
  const recipient = {
    ...user,
    id: id(901),
    name: "Pessoa que recebeu",
    permissions: [],
  };
  let fail = false,
    stale = false,
    candidateFailure = false,
    posts = 0;
  const order = {
    id: id(902),
    code: "OP-2026-064",
    title: "Montagem de transmissão",
    kind: "PRODUCTION",
    status: "OPEN",
    createdAt: "2026-11-13T12:00:00Z",
    user: { id: user.id, name: "Equipe de demonstração" },
    events: [],
    materials: [
      {
        id: id(903),
        productId: data.products[0].id,
        locationId: data.locations[0].id,
        product: data.products[0],
        location: data.locations[0],
        requestedQuantity: "10",
        reservedQuantity: "10",
        appliedQuantity: "0",
        consumedQuantity: "0",
        returnedQuantity: "0",
        pendingReturnQuantity: "0",
      },
    ],
  };
  const base = {
    orderId: order.id,
    orderCode: order.code,
    orderKind: "PRODUCTION",
    orderTitle: order.title,
    orderStatus: "OPEN",
    materialId: id(903),
    productCode: "ROL-6204",
    productName: "Rolamento rígido 6204",
    unit: "UN",
    locationCode: "A-P02",
    expectedQuantity: "10.000",
    deliveredAt: "2026-11-13T13:00:00Z",
    deliveredById: user.id,
    deliveredByName: "Equipe de demonstração",
    recipientId: recipient.id,
    recipientName: recipient.name,
    recipientActive: true,
    status: "PENDING",
    version: 0,
    receivedQuantity: null,
    materialMatches: null,
    note: null,
    reference: null,
    respondedAt: null,
  };
  const entries = [
    { ...base, id: id(904) },
    {
      ...base,
      id: id(905),
      productCode: "PAR-M12",
      productName: "Parafuso sextavado M12",
    },
    {
      ...base,
      id: id(906),
      recipientId: null,
      status: "UNLINKED",
      recipientActive: false,
    },
  ];
  const histories = new Map(entries.map((item) => [item.id, []]));
  const dto = (item) => ({
    ...item,
    canRespond:
      item.recipientId === data.user.id &&
      item.deliveredById !== data.user.id &&
      item.recipientActive,
    canTreat:
      data.permissions.includes("orders:read") &&
      data.permissions.includes("orders:apply") &&
      item.recipientId !== data.user.id,
  });
  const pattern = fixtureURL + "/api/**";
  const handler = async (route) => {
    const req = route.request(),
      url = new URL(req.url());
    let value;
    if (url.pathname === "/api/delivery-receipts/candidates") {
      if (candidateFailure)
        return route.fulfill({
          status: 503,
          json: { error: "Consulta temporariamente indisponível." },
        });
      value = {
        people: [{ id: recipient.id, name: recipient.name }],
        truncated: false,
      };
    } else if (url.pathname === "/api/orders")
      value = { items: [order], total: 1, page: 1, pageSize: 25 };
    else if (url.pathname === "/api/orders/" + order.id) value = order;
    else if (url.pathname === "/api/orders/" + order.id + "/actions") {
      const body = req.postDataJSON();
      assert.equal(body.action, "APPLY");
      assert.equal(body.recipientUserId, recipient.id);
      assert.equal(body.receivedByName, undefined);
      assert.equal(body.deliveredById, undefined);
      assert.ok(body.idempotencyKey);
      order.materials[0].reservedQuantity = "0";
      order.materials[0].appliedQuantity = "10";
      order.events.push({
        id: id(904),
        type: "APPLIED",
        quantity: "10",
        createdAt: base.deliveredAt,
        user: { id: user.id, name: base.deliveredByName },
        metadata: {
          handoff: {
            deliveredByName: base.deliveredByName,
            receivedByName: recipient.name,
            receivedByIdentifier: "Conta do ERP",
            receivedByUserId: recipient.id,
          },
        },
      });
      value = order;
    } else if (url.pathname === "/api/delivery-receipts") {
      if (fail)
        return route.fulfill({
          status: 503,
          json: {
            error:
              "Não foi possível consultar os recebimentos. Tente novamente.",
          },
        });
      const scope = url.searchParams.get("scope"),
        status = url.searchParams.get("status"),
        q = url.searchParams.get("q")?.toLowerCase() ?? "";
      const allowed = entries.filter(
          (item) => scope === "UNIT" || item.recipientId === data.user.id,
        ),
        filtered = allowed.filter(
          (item) =>
            (status === "ALL" || item.status === status) &&
            (item.productCode + item.orderCode + item.productName)
              .toLowerCase()
              .includes(q),
        );
      value = {
        items: filtered.map(dto),
        total: filtered.length,
        page: 1,
        pageSize: 25,
        summary: Object.fromEntries(
          [
            "PENDING",
            "DISPUTED",
            "PROPOSED",
            "RESOLVED",
            "CONFIRMED",
            "UNLINKED",
          ].map((status) => [
            status,
            allowed.filter((item) => item.status === status).length,
          ]),
        ),
        canMonitor: data.permissions.includes("orders:read"),
        serverTime: base.deliveredAt,
      };
    } else if (url.pathname.startsWith("/api/delivery-receipts/")) {
      const item = entries.find(
        (item) => item.id === url.pathname.split("/").at(-1),
      );
      assert.ok(item);
      if (req.method() === "POST") {
        const body = req.postDataJSON();
        posts++;
        assert.equal(body.expectedVersion, item.version);
        assert.ok(body.idempotencyKey);
        assert.equal(body.userId, undefined);
        if (stale) {
          item.version++;
          return route.fulfill({
            status: 409,
            json: {
              error:
                "Esta entrega recebeu outra resposta. Atualize antes de continuar.",
              code: "DELIVERY_CHANGED",
            },
          });
        }
        const events = {
          CONFIRM: ["CONFIRMED", "DELIVERY_CONFIRMED"],
          DISPUTE: ["DISPUTED", "DELIVERY_DISPUTED"],
          PROPOSE: ["PROPOSED", "DELIVERY_TREATMENT_PROPOSED"],
          ACCEPT: ["RESOLVED", "DELIVERY_TREATMENT_ACCEPTED"],
          REJECT: ["DISPUTED", "DELIVERY_TREATMENT_REJECTED"],
        };
        if (body.action === "CONFIRM") {
          item.receivedQuantity = item.expectedQuantity;
          item.materialMatches = true;
        }
        if (body.action === "DISPUTE") {
          item.receivedQuantity = body.receivedQuantity;
          item.materialMatches = body.materialMatches;
        }
        [item.status] = events[body.action];
        item.version++;
        item.note = body.note ?? "Recebimento confirmado na própria conta.";
        item.reference = body.reference ?? "";
        item.respondedAt = base.deliveredAt;
        histories.get(item.id).unshift({
          id: id(920 + posts),
          type: events[body.action][1],
          createdAt: base.deliveredAt,
          user: { id: data.user.id, name: data.user.name },
          note: item.note,
          reference: item.reference,
          receivedQuantity: item.receivedQuantity,
          materialMatches: item.materialMatches,
        });
        value = {
          eventId: id(920 + posts),
          status: item.status,
          version: item.version,
        };
      } else
        value = {
          item: dto(item),
          history: histories.get(item.id),
          truncated: false,
        };
    } else return route.fallback();
    return route.fulfill({ json: { data: value } });
  };
  await page.route(pattern, handler);
  async function as(person, target = "/recebimentos") {
    data.user = person;
    data.permissions = person.permissions;
    await page.goto(fixtureURL + target);
  }
  const detail = () => page.locator(".receipt-detail"),
    dialog = () => page.getByRole("dialog");
  async function respond(label, fields = {}) {
    await page.getByRole("button", { name: label, exact: true }).click();
    if ("quantity" in fields)
      await dialog()
        .getByLabel("Quantidade que você recebeu", { exact: true })
        .fill(fields.quantity);
    if ("matches" in fields)
      await dialog()
        .getByLabel("O material corresponde ao indicado?", { exact: true })
        .selectOption(fields.matches);
    if ("note" in fields)
      await dialog().locator('textarea[name="note"]').fill(fields.note);
    if ("reference" in fields)
      await dialog()
        .getByLabel("Referência da conferência ou providência", { exact: true })
        .fill(fields.reference);
    await dialog().getByRole("checkbox").check();
    await dialog().getByRole("button", { name: label, exact: true }).click();
    await expect(dialog()).toHaveCount(0);
  }
  try {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await check(
      "Entrega seleciona conta ativa e a revisão não confirma pelo destinatário",
      async () => {
        await as(user, "/ordens-producao?ordem=" + order.id);
        await page
          .getByRole("button", { name: "Entregar e aplicar", exact: true })
          .click();
        await expect(
          dialog().getByLabel("Identificação do destinatário", { exact: true }),
        ).toHaveValue("ACCOUNT");
        await dialog().locator('input[name="quantity"]').fill("10");
        await dialog()
          .getByLabel("Conta de quem recebeu", { exact: true })
          .selectOption(recipient.id);
        await dialog()
          .getByRole("button", { name: "Revisar operação", exact: true })
          .click();
        await expect(dialog()).toContainText("A confirmação será feita depois");
        await dialog()
          .getByRole("button", { name: "Confirmar operação", exact: true })
          .click();
        await expect(dialog()).toHaveCount(0);
        await expect(
          page.getByRole("link", {
            name: "Acompanhar recebimento",
            exact: true,
          }),
        ).toBeVisible();
        assert.equal(posts, 0);
      },
    );
    await check(
      "Administrador acompanha a entrega e não responde no lugar do destinatário",
      async () => {
        await page
          .getByRole("link", { name: "Acompanhar recebimento", exact: true })
          .click();
        await expect(detail()).toContainText("Aguardando confirmação");
        await expect(
          page.getByRole("button", {
            name: "Confirmar recebimento",
            exact: true,
          }),
        ).toHaveCount(0);
        await expect(detail()).toContainText(
          "A resposta deve ser feita pelo destinatário",
        );
      },
    );
    await check(
      "Destinatário sem permissão de ordens consulta somente suas entregas e confirma após conferir",
      async () => {
        await as(recipient);
        await expect(page.locator(".receipt-cards > li")).toHaveCount(2);
        await expect(
          page.getByRole("button", { name: "Acompanhar unidade", exact: true }),
        ).toHaveCount(0);
        await page
          .locator(".receipt-cards > li")
          .first()
          .getByRole("button", { name: "Conferir entrega" })
          .click();
        await page
          .getByRole("button", { name: "Confirmar recebimento", exact: true })
          .click();
        assert.equal(posts, 0);
        await expect(dialog()).toContainText("10 UN");
        await dialog().getByRole("checkbox").check();
        await dialog()
          .getByRole("button", { name: "Confirmar recebimento", exact: true })
          .click();
        await expect(dialog()).toHaveCount(0);
        await expect(detail()).toContainText("Recebimento confirmado");
        await expect(page.getByRole("status")).toContainText(
          "O estoque não foi movimentado",
        );
        await expect(
          page.getByRole("button", { name: "Abrir ordem", exact: true }),
        ).toHaveCount(0);
      },
    );
    await check(
      "Diferença de quantidade preserva o relato e abre tratamento independente",
      async () => {
        await as(recipient, "/recebimentos?entrega=" + id(905));
        await expect(detail()).toBeVisible();
        await respond("Informar divergência", {
          quantity: "8",
          matches: "true",
          note: "Recebi oito unidades, faltaram duas nesta entrega.",
        });
        await expect(detail()).toContainText("Divergência informada");
        await expect(detail()).toContainText("8 UN");
        await page.screenshot({
          animations: "disabled",
          path: path.join(output, "divergencia-desktop-dark.png"),
          fullPage: true,
        });
      },
    );
    await check(
      "Tratamento exige referência e continua aguardando aceite do destinatário",
      async () => {
        await as(user, "/recebimentos?entrega=" + id(905));
        await expect(detail()).toBeVisible();
        await respond("Registrar tratamento", {
          note: "Conferência registrada para revisão do destinatário.",
          reference: "CONT-2026-015",
        });
        await expect(detail()).toContainText("Tratamento aguardando aceite");
        await expect(
          page.getByRole("button", { name: "Aceitar tratamento", exact: true }),
        ).toHaveCount(0);
      },
    );
    await check(
      "Destinatário pode devolver tratamento e aceitar nova proposta sem apagar a diferença",
      async () => {
        await as(recipient, "/recebimentos?entrega=" + id(905));
        await expect(detail()).toBeVisible();
        await respond("Devolver para revisão", {
          note: "Ainda precisamos conferir a diferença no local.",
        });
        await expect(detail()).toContainText("Divergência informada");
        await as(user, "/recebimentos?entrega=" + id(905));
        await expect(detail()).toBeVisible();
        await respond("Registrar tratamento", {
          note: "Providências conferidas e registradas para consulta.",
          reference: "CONT-2026-016",
        });
        await as(recipient, "/recebimentos?entrega=" + id(905));
        await expect(detail()).toBeVisible();
        await respond("Aceitar tratamento", {
          note: "Conferi o documento e aceito o tratamento realizado.",
        });
        await expect(detail()).toContainText("Tratamento aceito");
        await expect(detail()).toContainText("8 UN");
        await expect(page.locator(".receipt-history li")).toHaveCount(5);
        assert.equal(entries[1].receivedQuantity, "8");
      },
    );
    await check(
      "Entrega sem conta permanece declarada e não permite confirmação autenticada",
      async () => {
        await as(user, "/recebimentos?entrega=" + id(906));
        await expect(detail()).toContainText("Sem conta vinculada");
        await expect(detail()).toContainText("não há confirmação autenticada");
        await expect(
          page.getByRole("button", {
            name: "Confirmar recebimento",
            exact: true,
          }),
        ).toHaveCount(0);
      },
    );
    await check(
      "Filtros da unidade não mudam os totais de acompanhamento",
      async () => {
        await as(user);
        await page
          .getByRole("button", { name: "Acompanhar unidade", exact: true })
          .click();
        await expect(page.locator(".receipt-cards > li")).toHaveCount(3);
        await page
          .getByLabel("Filtrar situação dos recebimentos")
          .selectOption("UNLINKED");
        await expect(page.locator(".receipt-cards > li")).toHaveCount(1);
        await expect(page.locator(".receipt-summary")).toContainText(
          "Sem conta vinculada",
        );
        await page
          .getByLabel("Filtrar situação dos recebimentos")
          .selectOption("ALL");
        await expect(page.locator(".receipt-cards > li")).toHaveCount(3);
        await page.screenshot({
          animations: "disabled",
          path: path.join(output, "recebimentos-desktop-dark.png"),
          fullPage: true,
        });
      },
    );
    await check(
      "Recebimentos e histórico cabem em 390 e 320 pixels nos temas claro e escuro",
      async () => {
        for (const width of [390, 320]) {
          await page.setViewportSize({ width, height: 844 });
          await noOverflow(page);
          for (const selector of [
            ".receipt-summary strong",
            ".receipt-cards h2",
            ".receipt-facts dd",
          ])
            await contrast(page, selector);
          await page.screenshot({
            animations: "disabled",
            path: path.join(output, `recebimentos-dark-${width}.png`),
            fullPage: true,
          });
        }
        await as(recipient, "/recebimentos?entrega=" + id(905));
        await expect(detail()).toBeVisible();
        await noOverflow(page);
        await page
          .getByRole("button", { name: "Ativar modo claro", exact: true })
          .click();
        await contrast(page, ".receipt-detail h2");
        await contrast(page, ".receipt-observation strong");
        await page.screenshot({
          animations: "disabled",
          path: path.join(output, "tratamento-mobile-light.png"),
          fullPage: true,
        });
        await page
          .getByRole("button", { name: "Ativar modo escuro", exact: true })
          .click();
      },
    );
    await check(
      "Falha de consulta retira os números anteriores e permite atualizar",
      async () => {
        await as(recipient);
        await expect(page.locator(".receipt-cards > li")).toHaveCount(2);
        fail = true;
        await page
          .getByRole("button", { name: "Atualizar", exact: true })
          .click();
        await expect(page.getByRole("alert")).toContainText(
          "Não foi possível consultar",
        );
        await expect(page.locator(".receipt-summary")).toHaveCount(0);
        fail = false;
        await page
          .getByRole("button", { name: "Atualizar", exact: true })
          .click();
        await expect(page.locator(".receipt-cards > li")).toHaveCount(2);
      },
    );
    await check(
      "Resposta desatualizada mantém erro visível e exige consultar a versão atual",
      async () => {
        entries[0].status = "PENDING";
        entries[0].version = 0;
        entries[0].receivedQuantity = null;
        histories.set(entries[0].id, []);
        await as(recipient, "/recebimentos?entrega=" + id(904));
        await expect(detail()).toBeVisible();
        stale = true;
        await page
          .getByRole("button", { name: "Confirmar recebimento", exact: true })
          .click();
        await dialog().getByRole("checkbox").check();
        await dialog()
          .getByRole("button", { name: "Confirmar recebimento", exact: true })
          .click();
        await expect(dialog().getByRole("alert")).toContainText(
          "Atualize antes de continuar",
        );
        assert.equal(entries[0].status, "PENDING");
        stale = false;
        await dialog()
          .getByRole("button", { name: "Fechar e atualizar", exact: true })
          .click();
        await expect(dialog()).toHaveCount(0);
        await expect(detail()).toContainText("Aguardando confirmação");
      },
    );
    await check(
      "Consulta de contas indisponível não inventa destinatário e mantém declaração como escolha explícita",
      async () => {
        await page.setViewportSize({ width: 1440, height: 1000 });
        candidateFailure = true;
        order.materials[0].reservedQuantity = "10";
        order.materials[0].appliedQuantity = "0";
        await as(user, "/ordens-producao?ordem=" + order.id);
        await page
          .getByRole("button", { name: "Entregar e aplicar", exact: true })
          .click();
        await expect(dialog()).toContainText(
          "Não foi possível consultar as contas",
        );
        await dialog()
          .getByLabel("Identificação do destinatário", { exact: true })
          .selectOption("DECLARED");
        await expect(
          dialog().getByLabel("Quem retirou o material", { exact: true }),
        ).toBeVisible();
        await expect(dialog()).toContainText("declarada por você");
        await dialog()
          .getByRole("button", { name: "Cancelar", exact: true })
          .click();
      },
    );
  } finally {
    await page.unroute(pattern, handler);
    data.user = original.user;
    data.permissions = original.permissions;
  }
}
