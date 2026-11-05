import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { Prisma } from "@prisma/client";
import { redactCosts } from "../src/lib/auth";
import { AppError, assertOrigin } from "../src/lib/http";

describe("autenticação e fronteiras de acesso", () => {
  test("sem costs:read custos ficam ocultos também em relações e auditoria", () => {
    const date = new Date("2026-10-16T12:00:00Z");
    const data = {
      products: [
        {
          name: "Rolamento",
          unitCost: new Prisma.Decimal("45.90"),
          quantity: new Prisma.Decimal("2.5"),
        },
      ],
      balances: [
        {
          product: { name: "Rolamento", unitCost: "45.90" },
          totalCost: "114.75",
        },
      ],
      purchases: [{ unitPrice: "12.50", totalPrice: "25.00", quantity: "2" }],
      audit: [{ before: { unitCost: "40.00" }, after: { unitCost: "45.90" } }],
      createdAt: date,
    };
    const result = redactCosts(data, {
      permissions: ["stock:move", "reports:read"],
    });
    const serialized = JSON.stringify(result);
    assert.equal(serialized.includes("unitCost"), false);
    assert.equal(serialized.includes("totalCost"), false);
    assert.equal(serialized.includes("unitPrice"), false);
    assert.equal(serialized.includes("totalPrice"), false);
    assert.equal(result.products[0].quantity.toString(), "2.5");
    assert.equal(result.createdAt, date);
    assert.equal(
      data.products[0].unitCost.toString(),
      "45.9",
      "A sanitização não deve alterar o objeto original.",
    );
    assert.equal(
      redactCosts(data, {
        permissions: ["costs:read"],
      }).products[0].unitCost.toFixed(2),
      "45.90",
    );
  });

  test("campos de credenciais não são retornados nem para perfil autorizado a custos", () => {
    const value = {
      passwordHash: "legacy-hash-fixture", tokenHash: "legacy-token-fixture", password: "fixture",
      session: { access_token: "access-fixture", refresh_token: "refresh-fixture" },
      unitPrice: "12.50", quantity: "2",
    };
    const clean = redactCosts(value, { permissions: ["costs:read"] });
    assert.deepEqual(clean, { session: {}, unitPrice: "12.50", quantity: "2" });
  });
});

describe("proteção de origem das mutações", () => {
  let previous: string | undefined;
  before(() => {
    previous = process.env.APP_URL;
    process.env.APP_URL = "https://erp.example.invalid";
  });
  after(() => {
    if (previous === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = previous;
  });

  const request = (origin?: string, site?: string) =>
    new Request("https://erp.example.invalid/api/movements", {
      method: "POST",
      headers: {
        ...(origin ? { origin } : {}),
        ...(site ? { "sec-fetch-site": site } : {}),
      },
    });
  const forbidden = (error: unknown) =>
    error instanceof AppError && error.status === 403;

  test("origem correta pode enviar mutação", () => {
    assert.doesNotThrow(() =>
      assertOrigin(request("https://erp.example.invalid", "same-origin")),
    );
  });

  test("origem ausente, de outro domínio ou cross-site não pode enviar mutação", () => {
    assert.throws(() => assertOrigin(request()), forbidden);
    assert.throws(
      () => assertOrigin(request("https://malicious.example.invalid")),
      forbidden,
    );
    assert.throws(
      () => assertOrigin(request("https://erp.example.invalid", "cross-site")),
      forbidden,
    );
  });
});
