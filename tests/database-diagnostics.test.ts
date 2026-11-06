import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { test } from "node:test";
import {
  databaseCode,
  inspectDatabase,
  inspectDatabaseNetwork,
} from "../scripts/database-diagnostics.mjs";

const connection =
  "postgresql://fixture_user:private_password@db.private.invalid:6543/private_database?application_name=private_query";
const secretError = (code: string) =>
  Object.assign(new Error(connection), {
    code,
    meta: { connection, secret: "private_meta" },
  });
function assertSafe(value: unknown) {
  const output = JSON.stringify(value);
  for (const secret of [
    connection,
    "fixture_user",
    "private_password",
    "db.private.invalid",
    "private_database",
    "private_query",
    "private_meta",
  ])
    assert.equal(output.includes(secret), false, `Report leaked ${secret}`);
}
const ipv4 = async () => [{ address: "192.0.2.1", family: 4 }];

test("Prisma initialization errorCode is retained; arbitrary provider codes are not printed", () => {
  assert.equal(
    databaseCode({ errorCode: "P1001", message: connection }),
    "P1001",
  );
  assert.equal(databaseCode({ code: "P2022" }), "P2022");
  assert.equal(
    databaseCode({ code: connection, errorCode: connection }),
    undefined,
  );
});
test("DNS error identifies the failed step without echoing connection or provider text", async () => {
  const result = await inspectDatabaseNetwork(connection, {
    resolve: async () => {
      throw secretError("ENOTFOUND");
    },
    connect: async () => assert.fail("TCP must not run after DNS failure"),
  });
  assert.equal(result.reachable, false);
  assert.equal(result.checks[0].code, "ENOTFOUND");
  assert.match(result.checks[0].name, /DNS/);
  assertSafe(result);
});
test("TCP refusal and timeout produce distinct safe diagnostics", async () => {
  for (const code of ["ECONNREFUSED", "ETIMEDOUT"]) {
    const result = await inspectDatabaseNetwork(connection, {
      resolve: ipv4,
      connect: async () => {
        throw secretError(code);
      },
    });
    assert.equal(result.reachable, false);
    assert.equal(result.checks.at(-1)?.code, code);
    assertSafe(result);
  }
});
test("IPv6-only unreachable endpoint recommends the official pooler without claiming firewall diagnosis", async () => {
  const result = await inspectDatabaseNetwork(connection, {
    resolve: async () => [{ address: "2001:db8::1", family: 6 }],
    connect: async () => {
      throw secretError("ENETUNREACH");
    },
  });
  assert.match(result.checks.at(-1)?.message ?? "", /Session pooler/);
  assert.match(result.checks.at(-1)?.message ?? "", /não confirma bloqueio/);
  assertSafe(result);
});
test("one reachable address is sufficient, but TCP success does not claim valid credentials", async () => {
  const result = await inspectDatabaseNetwork(connection, {
    resolve: async () => [
      ...(await ipv4()),
      { address: "2001:db8::1", family: 6 },
    ],
    connect: async ({ family }: { family: number }) => {
      if (family === 6) throw secretError("ENETUNREACH");
    },
  });
  assert.equal(result.reachable, true);
  assert.match(
    result.checks.at(-1)?.message ?? "",
    /Senha, TLS e tabelas ainda/,
  );
  assertSafe(result);
});
test("native TCP probe connects to an isolated loopback listener and closes the socket", async () => {
  const server = createServer((socket) => socket.end());
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const result = await inspectDatabaseNetwork(
      `postgresql://fixture_user:private_password@127.0.0.1:${address.port}/private_database`,
    );
    assert.equal(result.reachable, true);
    assert.equal(result.checks.at(-1)?.status, "ok");
    assertSafe(result);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
function databaseWith(results: unknown[]) {
  let calls = 0;
  return {
    get calls() {
      return calls;
    },
    async $queryRaw() {
      const next = results[calls++];
      if (next instanceof Error) throw next;
      return next;
    },
  };
}
test("initialization code P1001 is visible and no structure queries follow a connection failure", async () => {
  const error = Object.assign(new Error(connection), { errorCode: "P1001" });
  const db = databaseWith([error]);
  const checks = await inspectDatabase(db);
  assert.equal(db.calls, 1);
  assert.equal(checks[0].code, "P1001");
  assert.match(checks[0].message, /Session pooler/);
  assertSafe(checks);
});
test("missing tables fail the structure phase, preserve connection success and skip membership query", async () => {
  const db = databaseWith([[{ ok: 1 }], [{ ready: false }]]);
  const checks = await inspectDatabase(db);
  assert.equal(db.calls, 2);
  assert.equal(checks[0].status, "ok");
  assert.equal(checks[1].name, "Estrutura do ERP");
  assert.equal(checks[1].code, "P2021");
  assertSafe(checks);
});
test("missing version 2.4 columns fail the structure phase before inspecting membership", async () => {
  const db = databaseWith([[{ ok: 1 }], [{ ready: true }], [{ ready: false }]]);
  const checks = await inspectDatabase(db);
  assert.equal(db.calls, 3);
  assert.equal(checks[0].status, "ok");
  assert.equal(checks.at(-1)?.name, "Estrutura do ERP");
  assert.equal(checks.at(-1)?.code, "P2022");
  assertSafe(checks);
});
test("missing columns during access inspection are attributed to access, not connection", async () => {
  const checks = await inspectDatabase(
    databaseWith([
      [{ ok: 1 }],
      [{ ready: true }],
      [{ ready: true }],
      secretError("P2022"),
    ]),
  );
  assert.equal(checks[0].status, "ok");
  assert.equal(checks.at(-1)?.name, "Acesso inicial");
  assert.equal(checks.at(-1)?.code, "P2022");
  assertSafe(checks);
});
test("a schema failure with an unknown provider error never prints provider details", async () => {
  const checks = await inspectDatabase(
    databaseWith([[{ ok: 1 }], secretError(connection)]),
  );
  assert.equal(checks.at(-1)?.name, "Estrutura do ERP");
  assert.equal(checks.at(-1)?.code, undefined);
  assertSafe(checks);
});
test("missing membership is a warning and does not imply an available default login", async () => {
  const checks = await inspectDatabase(
    databaseWith([
      [{ ok: 1 }],
      [{ ready: true }],
      [{ ready: true }],
      [{ ready: false }],
    ]),
  );
  assert.equal(checks[1].status, "ok");
  assert.match(checks[1].message, /Estrutura básica 2\.4/);
  assert.match(checks[1].message, /não valida os dados/);
  assert.equal(checks.at(-1)?.status, "warning");
  assert.match(checks.at(-1)?.message ?? "", /não possui senha padrão/);
});
test("CLI offline emits valid JSON without secrets and performs no provider calls", () => {
  const publicKey = "sb_publishable_private_fixture";
  const adminKey = "sb_secret_private_fixture";
  const execution = spawnSync(
    process.execPath,
    ["scripts/doctor.mjs", "--offline", "--json"],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        DOTENV_CONFIG_PATH: "/tmp/almox-doctor-nonexistent-env",
        DATABASE_URL: connection,
        DIRECT_URL: connection,
        APP_URL: "http://localhost:3000",
        NEXT_PUBLIC_SUPABASE_URL: "https://auth.private.invalid",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: publicKey,
        SUPABASE_SERVICE_ROLE_KEY: adminKey,
      },
    },
  );
  assert.equal(execution.status, 0, execution.stderr);
  const report = JSON.parse(execution.stdout);
  assert.equal(report.mode, "configuration-only");
  assert.equal(report.errors, 0);
  assertSafe(report);
  for (const secret of [publicKey, adminKey, "auth.private.invalid"])
    assert.equal(execution.stdout.includes(secret), false);
});
