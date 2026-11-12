import assert from "node:assert/strict";
import { after, test } from "node:test";
import { readAuthFragment } from "../src/lib/auth-return";
import { accessState } from "../src/lib/access-status";
import { authEmailError, authEmailRedirect, authLinkFailure } from "../src/lib/auth-links";
import { AuthConfigurationError } from "../src/lib/auth-config";

const originalOrigin = process.env.APP_URL;
after(() => { if (originalOrigin === undefined) delete process.env.APP_URL; else process.env.APP_URL = originalOrigin; });

test("convite e recuperação aceitam somente os dois tipos de fragmento previstos", () => {
  for (const type of ["invite", "recovery"] as const) assert.deepEqual(readAuthFragment(`#access_token=fixture.access.token&refresh_token=fixture_refresh_token&type=${type}`),
    { type, accessToken: "fixture.access.token", refreshToken: "fixture_refresh_token" });
  for (const fragment of ["", "#code=code-only", "#access_token=fixture&refresh_token=fixture&type=signup", "#access_token=fixture&type=recovery", "#error=access_denied&error_code=otp_expired", "#" + "x".repeat(24000)])
    assert.equal(readAuthFragment(fragment), null);
});
test("origem dos e-mails vem da configuração exata e exige HTTPS fora do loopback", () => {
  process.env.APP_URL = "https://almox.example.invalid";
  assert.equal(authEmailRedirect(), "https://almox.example.invalid/auth/callback?next=/recuperar-senha");
  process.env.APP_URL = "http://127.0.0.1:3130"; assert.ok(authEmailRedirect().startsWith("http://127.0.0.1:3130/"));
  process.env.APP_URL = "http://almox.example.invalid"; assert.throws(authEmailRedirect, AuthConfigurationError);
  process.env.APP_URL = "https://almox.example.invalid/login"; assert.throws(authEmailRedirect, AuthConfigurationError);
});
test("limite do provedor, destinatário não autorizado e falha transitória têm respostas próprias sem conteúdo externo", () => {
  assert.equal(authEmailError({ status: 429, code: "over_email_send_rate_limit" }).code, "AUTH_EMAIL_LIMIT");
  assert.equal(authEmailError({ status: 403, code: "email_address_not_authorized" }).code, "AUTH_EMAIL_CONFIGURATION");
  assert.equal(authEmailError({ status: 500 }).status, 503);
  assert.equal(authLinkFailure({ code: "bad_code_verifier" }), "browser");
  assert.equal(authLinkFailure({ code: "otp_expired" }), "expired");
  assert.equal(authLinkFailure({ status: 503 }), "unavailable");
  assert.equal(authLinkFailure({ status: 429 }), "unavailable");
});
test("habilitado na unidade não presume senha nem primeiro login; histórico é um fato separado", () => {
  assert.equal(accessState({ active: true, identityActive: true, authLinked: true }), "PENDING");
  assert.equal(accessState({ active: true, authLinked: true, invitationAt: "2026-11-12T12:00:00Z" }), "INVITED");
  assert.equal(accessState({ active: true, authLinked: true, lastLoginAt: "2026-11-12T12:00:00Z" }), "ACTIVE");
  assert.equal(accessState({ active: false, authLinked: true, lastLoginAt: "2026-11-12T12:00:00Z" }), "DISABLED");
  assert.equal(accessState({ active: true, identityActive: false, authLinked: true }), "DISABLED");
  assert.equal(accessState({ active: true, authLinked: false }), "UNLINKED");
});
