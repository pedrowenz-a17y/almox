import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { inventorySchema } from '../src/services/inventory';
import { purchaseSchema, receiptSchema } from '../src/services/purchases';

/** Regression for GHSA-mrhx-c7xc-m3w5: oversized payloads must not collect one nested error per item. */
for (const [name, schema, input] of [
  ['inventário', inventorySchema, { locationId: randomUUID(), note: 'Conferência de teste', idempotencyKey: randomUUID() }],
  ['pedido de compra', purchaseSchema, { code: 'TEST-LIMIT', supplierId: randomUUID(), idempotencyKey: randomUUID() }],
  ['recebimento', receiptSchema, { documentReference: 'Documento de teste', idempotencyKey: randomUUID() }],
] as const) {
  test(`${name}: recusa coleção muito acima do limite antes de expandir erros dos itens`, () => {
    const result = schema.safeParse({ ...input, items: Array(20000).fill(null) });
    assert.equal(result.success, false);
    if (result.success) return;
    assert.ok(result.error.issues.some(issue => issue.code === 'too_big' && issue.path[0] === 'items'));
    assert.ok(result.error.issues.length < 10, 'A validação não deve criar milhares de erros para uma coleção já recusada pelo tamanho.');
  });
}
