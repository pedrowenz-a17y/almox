import assert from "node:assert/strict";
import { test } from "node:test";
import {
  inspectConfiguration,
  databaseFailure,
} from "../scripts/config-diagnostics.mjs";

const config = {
  DATABASE_URL:
    "postgresql://fixture:only_fixture_password@localhost:5432/almox_test",
  DIRECT_URL:
    "postgresql://fixture:only_fixture_password@localhost:5432/almox_test",
  APP_URL: "http://localhost:3000",
  NEXT_PUBLIC_SUPABASE_URL: "https://project.example.invalid",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test_fixture",
};
test("diagnóstico vazio informa variáveis faltantes e chave administrativa opcional", () => {
  const result = inspectConfiguration({});
  assert.equal(result.filter((row) => row.status === "error").length, 5);
  assert.equal(
    result.find((row) => row.name === "SUPABASE_SERVICE_ROLE_KEY")?.status,
    "warning",
  );
});
test("configuração local válida não afirma autenticação ou conectividade e não imprime valores", () => {
  const result = inspectConfiguration(config);
  assert.equal(
    result.some((row) => row.status === "error"),
    false,
  );
  const output = JSON.stringify(result);
  for (const value of Object.values(config))
    assert.equal(output.includes(value), false);
  assert.equal(output.includes("only_fixture_password"), false);
});
test("chave administrativa na variável pública é recusada e não é exposta no resultado", () => {
  const secret = "sb_secret_test_fixture";
  const result = inspectConfiguration({
    ...config,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: secret,
  });
  assert.equal(
    result.find((row) => row.name === "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY")
      ?.status,
    "error",
  );
  assert.equal(JSON.stringify(result).includes(secret), false);
});
test("origens com caminho, credenciais ou wildcard são recusadas; produção exige HTTPS", () => {
  for (const origin of [
    "https://example.invalid/login",
    "https://user:pass@example.invalid",
    "https://*.example.invalid",
    "https://example.invalid?next=1",
  ]) {
    assert.equal(
      inspectConfiguration({ ...config, APP_URL: origin }).find(
        (row) => row.name === "APP_URL",
      )?.status,
      "error",
    );
  }
  assert.equal(
    inspectConfiguration(config, { production: true }).find(
      (row) => row.name === "APP_URL",
    )?.status,
    "error",
  );
});
test("erros de banco geram orientação específica sem reproduzir mensagem do provedor", () => {
  assert.match(databaseFailure("P1000"), /senha do banco/);
  assert.match(databaseFailure("P1001"), /Session pooler/);
  assert.match(databaseFailure("P1011"), /verificação habilitada/);
  assert.match(databaseFailure("P2021"), /backups/);
  assert.equal(
    databaseFailure("INTERNAL_MESSAGE_WITH_SECRET").includes(
      "INTERNAL_MESSAGE_WITH_SECRET",
    ),
    false,
  );
});
