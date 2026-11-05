import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildPurchaseDraft,
  hasSuggestedQuantity,
} from "../src/lib/purchase-draft";

const unit = "123e4567-e89b-42d3-a456-426614174000";
const supplier = "123e4567-e89b-42d3-a456-426614174001";
const material = "123e4567-e89b-42d3-a456-426614174002";
const second = "123e4567-e89b-42d3-a456-426614174003";
const row = {
  productId: material,
  supplierId: supplier,
  supplierActive: true,
  suggested: "12.375",
};

test("sugestões viram preenchimento editável sem perda de casas decimais ou cópia de custos", () => {
  const input = { ...row, unitCost: "500.00", incoming: "4" };
  const draft = buildPurchaseDraft(unit, [input], [material, material]);
  assert.deepEqual(draft, {
    unitId: unit,
    supplierId: supplier,
    source: "replenishment",
    items: [{ productId: material, quantity: "12.375" }],
  });
  assert.equal(input.suggested, "12.375");
  assert.equal(JSON.stringify(draft).includes("unitCost"), false);
});
test("pedido assistido exige unidade válida, seleção presente e no máximo 200 materiais", () => {
  assert.throws(
    () => buildPurchaseDraft("other", [row], [material]),
    /unidade/,
  );
  assert.throws(() => buildPurchaseDraft(unit, [row], []), /Selecione/);
  assert.throws(() => buildPurchaseDraft(unit, [row], [second]), /Atualize/);
  assert.throws(
    () =>
      buildPurchaseDraft(
        unit,
        [row],
        Array.from({ length: 201 }, (_, i) => `id-${i}`),
      ),
    /200/,
  );
});
test("seleção não mistura fornecedores ou aceita fornecedor ausente/inativo", () => {
  const other = { ...row, productId: second, supplierId: unit };
  assert.throws(
    () => buildPurchaseDraft(unit, [row, other], [material, second]),
    /mesmo fornecedor/,
  );
  assert.throws(
    () => buildPurchaseDraft(unit, [{ ...row, supplierId: null }], [material]),
    /fornecedor ativo/,
  );
  assert.throws(
    () =>
      buildPurchaseDraft(unit, [{ ...row, supplierActive: false }], [material]),
    /fornecedor ativo/,
  );
});
test("sugestão zero, negativa, malformada ou com precisão excessiva não prepara compra", () => {
  for (const quantity of [
    "0",
    "0.000",
    "-1",
    "1.0001",
    "1e3",
    "NaN",
    "",
    "1000000000000000",
  ]) {
    assert.equal(hasSuggestedQuantity(quantity), false, quantity);
    assert.throws(() =>
      buildPurchaseDraft(unit, [{ ...row, suggested: quantity }], [material]),
    );
  }
  assert.equal(hasSuggestedQuantity("0.001"), true);
  assert.equal(hasSuggestedQuantity("999999999999999.999"), true);
});
