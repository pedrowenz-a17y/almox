import assert from "node:assert/strict";
import { test } from "node:test";
import { operationalDateInput, operationalDateISO } from "../src/lib/operational-time";

test("prazo informado em Brasília não muda com o fuso do dispositivo", () => {
  for (const zone of ["UTC", "America/Sao_Paulo", "Asia/Tokyo"]) {
    const original = process.env.TZ;
    try {
      process.env.TZ = zone;
      assert.equal(operationalDateISO("2090-11-20T15:00"), "2090-11-20T18:00:00.000Z");
      assert.equal(operationalDateInput("2090-11-20T18:00:00.000Z"), "2090-11-20T15:00");
    } finally { if (original === undefined) delete process.env.TZ; else process.env.TZ = original; }
  }
});
test("data inválida ou horário inexistente de mudança de fuso não vira outro prazo silenciosamente", () => {
  for (const value of ["", "senha", "2090-02-30T15:00", "2090-11-20T25:00", "2018-11-04T00:30", "2090-11-20T15:00Z"])
    assert.equal(operationalDateISO(value), null, value);
  assert.equal(operationalDateInput(null), ""); assert.equal(operationalDateInput("inválido"), "");
});
test("conversão respeita a virada do dia e as regras históricas de São Paulo", () => {
  assert.equal(operationalDateInput("2026-11-13T02:30:00.000Z"), "2026-11-12T23:30");
  assert.equal(operationalDateISO("2018-12-20T15:00"), "2018-12-20T17:00:00.000Z");
});
