import assert from "node:assert/strict";
import { test } from "node:test";
import { qaConfig, qaCredentials, mergeResponseCookies, cookieHeader } from "../scripts/qa-config.mjs";

const isolated = { QA_ENVIRONMENT: "isolated", QA_BASE_URL: "http://localhost:3000", QA_UNIT_ID: "00000000-0000-4000-8000-000000000001" };

test("verificadores não usam APP_URL/credenciais de seed e não gravam sem autorização explícita", () => {
  assert.throws(() => qaConfig({ env: { APP_URL: "https://production.invalid" } }));
  assert.throws(() => qaConfig({ writes: true, env: isolated }));
  assert.equal(qaConfig({ writes: true, env: { ...isolated, ALLOW_QA_WRITES: "1" } }).baseURL, isolated.QA_BASE_URL);
  assert.throws(() => qaCredentials("ADMIN", { SEED_ADMIN_EMAIL: "unused@example.invalid", SEED_ADMIN_PASSWORD: "unused" }));
});

test("homologação remota exige origem exata e HTTPS, sem credenciais ou parâmetros na URL", () => {
  const remote = { ...isolated, QA_BASE_URL: "https://test.example.invalid" };
  assert.throws(() => qaConfig({ env: remote }));
  assert.equal(qaConfig({ env: { ...remote, QA_ALLOWED_REMOTE_ORIGIN: remote.QA_BASE_URL } }).baseURL, remote.QA_BASE_URL);
  for (const value of ["http://test.example.invalid", "https://a:b@test.example.invalid", "https://test.example.invalid/path", "https://test.example.invalid?secret=x"]) {
    assert.throws(() => qaConfig({ env: { ...remote, QA_BASE_URL: value, QA_ALLOWED_REMOTE_ORIGIN: value } }));
  }
});

test("cookie jar preserva múltiplos fragmentos Supabase e remove cookies expirados", () => {
  const jar = new Map<string, string>();
  const headers = new Headers();
  headers.append("set-cookie", "sb-test-auth-token.0=first; Path=/; HttpOnly; SameSite=Lax");
  headers.append("set-cookie", "sb-test-auth-token.1=second; Path=/; HttpOnly; SameSite=Lax");
  mergeResponseCookies(jar, headers);
  assert.equal(jar.size, 2);
  assert.equal(cookieHeader(jar), "sb-test-auth-token.0=first; sb-test-auth-token.1=second");
  const logout = new Headers();
  logout.append("set-cookie", "sb-test-auth-token.0=; Max-Age=0; Path=/");
  logout.append("set-cookie", "sb-test-auth-token.1=; Max-Age=0; Path=/");
  mergeResponseCookies(jar, logout);
  assert.equal(jar.size, 0);
});
