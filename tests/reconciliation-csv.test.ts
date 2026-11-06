import assert from "node:assert/strict";
import { test } from "node:test";
import {
  readReconciliationCsv,
  safeCsvCell,
} from "../src/lib/reconciliation-csv";

test("CSV lê BOM, CRLF, delimitadores e aspas escapadas sem adivinhar formato", () => {
  assert.deepEqual(
    readReconciliationCsv(
      '\uFEFFunidade;produto;local;quantidade\r\nUCA;"A;B";"L""1";"12,500"\r\n',
      ";",
    ),
    [
      ["unidade", "produto", "local", "quantidade"],
      ["UCA", "A;B", 'L"1', "12,500"],
    ],
  );
  assert.deepEqual(
    readReconciliationCsv('unidade,ordem,custo\nUCA,OS-1,"12,50"', ","),
    [
      ["unidade", "ordem", "custo"],
      ["UCA", "OS-1", "12,50"],
    ],
  );
  assert.deepEqual(readReconciliationCsv('"uma\nlinha";x', ";"), [
    ["uma\nlinha", "x"],
  ]);
});

test("CSV rejeita aspas quebradas, campo excessivo e mais de mil linhas", () => {
  for (const bad of ['a;"ab', 'a;x"y', 'a;"x"y'])
    assert.throws(() => readReconciliationCsv(bad, ";"));
  assert.throws(() => readReconciliationCsv("x".repeat(4001), ";"), /limite/);
  assert.throws(
    () =>
      readReconciliationCsv(
        ["header", ...Array(1001).fill("x")].join("\n"),
        ";",
      ),
    /1.000/,
  );
});

test("exportação para revisão escapa fórmulas e aspas de planilhas", () => {
  assert.equal(safeCsvCell('=HYPERLINK("x")'), '"\'=HYPERLINK(""x"")"');
  assert.equal(safeCsvCell("  +1"), '"\'  +1"');
  assert.equal(safeCsvCell("PROD-1"), '"PROD-1"');
});
