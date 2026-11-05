import assert from "node:assert/strict";
import { test } from "node:test";
import { parseQrCode, qrTargetUrl } from "../src/lib/qr-code";
import { replenishmentAmounts } from "../src/lib/replenishment";
import {
  availableFor,
  physicalFor,
  totalFor,
  type DataSet,
} from "../src/lib/client";
import { isWorkspacePath } from "../src/lib/workspace-navigation";

const id = "123e4567-e89b-42d3-a456-426614174000";
test("QR do produto é estável e abre a ficha sem credenciais nem saldo na URL", () => {
  const url = qrTargetUrl("https://erp.example", { kind: "product", id });
  assert.equal(url, `https://erp.example/produto/${id}`);
  assert.deepEqual(parseQrCode(url, "https://erp.example", true), {
    kind: "product",
    code: id,
  });
  assert.deepEqual(
    parseQrCode(
      `https://erp.example/localizacao/${id}`,
      "https://erp.example",
      false,
    ),
    { kind: "location", code: id },
  );
  assert.throws(() =>
    qrTargetUrl("https://erp.example", { kind: "product", id: "invalid" }),
  );
});
test("QR externo, com credenciais, parâmetros ou produto usado como local é recusado", () => {
  for (const url of [
    `https://evil.example/produto/${id}`,
    `https://user@erp.example/produto/${id}`,
    `https://erp.example/produto/${id}?unit=other`,
    `https://erp.example/produto/${id}#other`,
    "https://erp.example/produto/invalid",
  ])
    assert.throws(() => parseQrCode(url, "https://erp.example", true));
  assert.throws(
    () =>
      parseQrCode(
        `https://erp.example/produto/${id}`,
        "https://erp.example",
        false,
      ),
    /localização/,
  );
  assert.deepEqual(parseQrCode(" ROL-6204 ", "https://erp.example", true), {
    code: "ROL-6204",
    kind: undefined,
  });
});
test("reposição desconta pedidos pendentes e respeita a meta, sem arredondar decimais", () => {
  assert.deepEqual(
    replenishmentAmounts({
      available: "2.125",
      minimum: "5",
      maximum: "10",
      incoming: "3.250",
    }),
    { needsAttention: true, target: "10.000", suggested: "4.625" },
  );
  assert.equal(
    replenishmentAmounts({ available: "2", minimum: "5", incoming: "20" })
      .suggested,
    "0.000",
  );
  assert.equal(
    replenishmentAmounts({
      available: "999999999999998.001",
      minimum: "999999999999999.999",
      incoming: "0.001",
    }).suggested,
    "1.997",
  );
  assert.equal(
    replenishmentAmounts({ available: "0", minimum: "0", incoming: "0" })
      .needsAttention,
    true,
  );
  assert.equal(
    replenishmentAmounts({ available: "5", minimum: "5", incoming: "0" })
      .needsAttention,
    false,
  );
});
test("índice de saldos preserva físico/disponível e não reutiliza dados de outra unidade/snapshot", () => {
  const data = {
    balances: [
      {
        productId: "a",
        quantity: "10",
        availableQuantity: "5",
        physicalQuantity: "8",
      },
      {
        productId: "a",
        quantity: "2",
        availableQuantity: "1",
        physicalQuantity: "2",
      },
      { productId: "b", quantity: "99" },
    ],
  } as DataSet;
  assert.equal(totalFor(data, "a"), 12);
  assert.equal(availableFor(data, "a"), 6);
  assert.equal(physicalFor(data, "a"), 10);
  assert.equal(availableFor(data, "missing"), 0);
  const next = {
    ...data,
    balances: [{ ...data.balances[0], quantity: "3", availableQuantity: "3" }],
  };
  assert.equal(availableFor(next, "a"), 3);
  assert.equal(availableFor(data, "a"), 6);
});
test("navegação instantânea fica limitada às telas do ERP, sem capturar login ou API", () => {
  for (const path of [
    "/reposicao",
    "/consulta",
    `/produto/${id}`,
    `/localizacao/${id}`,
  ])
    assert.equal(isWorkspacePath(path), true);
  for (const path of [
    "/login",
    "/api/data",
    "/auth/callback",
    "//evil.example",
    "/produto/invalid",
  ])
    assert.equal(isWorkspacePath(path), false);
});
