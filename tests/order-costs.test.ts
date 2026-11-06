import assert from "node:assert/strict";
import { test } from "node:test";
import { Prisma } from "@prisma/client";
import { CostDecimal, summarizeOrderCost } from "../src/services/order-costs";

test("custo e diferença mantêm centavos além de 20 dígitos significativos sem alterar precisão global", () => {
  const originalPrecision = Prisma.Decimal.precision;
  const result = summarizeOrderCost({
    id: "order-test",
    code: "OP-LIMIT",
    title: "Limite de precisão",
    kind: "PRODUCTION",
    status: "INVOICED",
    invoiceReference: "NF-TEST",
    invoicedAt: new Date("2026-11-06T00:00:00Z"),
    materials: [
      {
        id: "material-test",
        consumedQuantity: new Prisma.Decimal("999999999999999.999"),
        returnedQuantity: new Prisma.Decimal(0),
        invoicedUnitCost: new Prisma.Decimal("999999999999.99"),
        product: { internalCode: "P-1", name: "Peça", unit: "UN" },
      },
    ],
  });
  assert.equal(result.netMaterialCost, "999999999999989999000000000.00");
  assert.equal(
    new CostDecimal(result.netMaterialCost!).minus("0.01").toFixed(2),
    "999999999999989998999999999.99",
  );
  assert.equal(Prisma.Decimal.precision, originalPrecision);
});
