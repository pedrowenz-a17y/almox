import assert from "node:assert/strict";
import { test } from "node:test";
import { receiptQuantity } from "../src/lib/delivery-receipts";
test("quantidade na confirmação preserva milésimos além da precisão de Number", () => {
  assert.equal(
    receiptQuantity("999999999999999.999"),
    "999.999.999.999.999,999",
  );
  assert.equal(
    receiptQuantity("999999999999999.001"),
    "999.999.999.999.999,001",
  );
  assert.equal(receiptQuantity("0.125"), "0,125");
  assert.equal(receiptQuantity("0.000"), "0");
});
test("quantidade malformada não aparece como zero na declaração do destinatário", () => {
  for (const value of ["", "NaN", "1e3", "1,5", "1.0001", "-1"])
    assert.equal(receiptQuantity(value), "—");
});
