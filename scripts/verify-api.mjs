import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";

import { qaConfig, qaCredentials, mergeResponseCookies, cookieHeader } from "./qa-config.mjs";

const { baseURL: base, unitId } = qaConfig({ writes: true });
const adminCredentials = qaCredentials("ADMIN");
const operatorCredentials = qaCredentials("OPERATOR");
const supervisorCredentials = qaCredentials("SUPERVISOR");
assert.equal(new Set([adminCredentials.email, operatorCredentials.email, supervisorCredentials.email]).size, 3, "Use três contas distintas de homologação.");
const run = randomUUID().slice(0, 8);
const tag = `QA-API-${run}`;
const evidence = {
  run,
  startedAt: new Date().toISOString(),
  base,
  unitId,
  environment: "isolated",
  checks: [],
  cleanup: [],
  result: "running",
};
const resources = {
  products: [],
  categories: [],
  suppliers: [],
  locations: [],
  warehouses: [],
  users: [],
};
let adminCookie = null;
async function request(
  path,
  { method = "GET", cookie = "", body, origin = true, form } = {},
) {
  const headers = {
    ...(cookie ? { Cookie: cookieHeader(cookie) } : {}),
    ...(origin ? { Origin: base } : {}),
  };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const response = await fetch(`${base}${path}`, {
    method,
    headers,
    body: form || (body === undefined ? undefined : JSON.stringify(body)),
    redirect: "manual",
    signal: AbortSignal.timeout(30000),
  });
  if (cookie instanceof Map) mergeResponseCookies(cookie, response.headers);
  const type = response.headers.get("content-type") || "";
  const content = type.includes("application/json")
    ? await response.json()
    : await response.text();
  return {
    status: response.status,
    data: content.data,
    error: content.error,
    content,
    headers: response.headers,
  };
}
async function check(name, work) {
  const start = performance.now();
  try {
    const detail = await work();
    evidence.checks.push({
      name,
      passed: true,
      durationMs: Math.round(performance.now() - start),
      ...(detail ? { detail } : {}),
    });
    console.log(`PASS ${name}`);
  } catch (error) {
    evidence.checks.push({
      name,
      passed: false,
      error: error.message,
      durationMs: Math.round(performance.now() - start),
    });
    console.error(`FAIL ${name}: ${error.message}`);
    throw error;
  }
}
function expectStatus(result, status) {
  assert.equal(
    result.status,
    status,
    result.error || `Expected ${status}, received ${result.status}`,
  );
  return result.data;
}
async function login(email, password) {
  const cookie = new Map();
  const result = await request("/api/auth/login", {
    method: "POST", cookie, body: { email, password },
  });
  expectStatus(result, 200);
  const setCookies = result.headers.getSetCookie();
  assert.ok(setCookies.length > 0);
  assert.ok(setCookies.every(value => /HttpOnly/i.test(value)));
  assert.ok(setCookies.every(value => /SameSite=lax/i.test(value)));
  assert.ok(cookie.size > 0, "Login precisa devolver cookies de sessão.");
  expectStatus(await request("/api/unit", { method: "POST", cookie, body: { unitId } }), 200);
  const me = expectStatus(await request("/api/me", { cookie }), 200);
  assert.equal(me.unitId, unitId, "A unidade de homologação deve estar ativa na sessão.");
  return cookie;
}

async function create(entity, body, cookie = adminCookie) {
  const record = expectStatus(
    await request(`/api/catalog/${entity}`, { method: "POST", cookie, body }),
    201,
  );
  resources[entity]?.push(record.id);
  return record;
}
async function move(cookie, body) {
  return request("/api/movements", {
    method: "POST",
    cookie,
    body: {
      ...body,
      idempotencyKey: body.idempotencyKey || randomUUID(),
      note: `Verificação HTTP ${run}`,
    },
  });
}
async function data(cookie = adminCookie) {
  const result = expectStatus(await request("/api/data", { cookie }), 200);
  assert.equal(result.unitId, unitId, "Os dados devem pertencer à unidade de homologação selecionada.");
  return result;
}
function quantity(dataset, productId, locationId) {
  return Number(
    dataset.balances.find(
      (b) => b.productId === productId && b.locationId === locationId,
    )?.quantity || 0,
  );
}

try {
  await check("Anonymous data access rejected", async () =>
    expectStatus(await request("/api/data"), 401),
  );
  await check("Login without Origin rejected", async () =>
    expectStatus(
      await request("/api/auth/login", {
        method: "POST",
        origin: false,
        body: {
          email: adminCredentials.email,
          password: adminCredentials.password,
        },
      }),
      403,
    ),
  );
  await check(
    "Administrator login creates HttpOnly SameSite session",
    async () => {
      adminCookie = await login(
        adminCredentials.email,
        adminCredentials.password,
      );
    },
  );
  const me = expectStatus(
    await request("/api/me", { cookie: adminCookie }),
    200,
  );
  assert.ok(me.permissions.includes("users:manage"));
  let dataset;
  await check(
    "Authenticated database data and dashboard aggregates load",
    async () => {
      dataset = await data();
      assert.ok(
        Array.isArray(dataset.products) &&
          Array.isArray(dataset.locations) &&
          Array.isArray(dataset.dashboard.dailyActivity),
      );
      assert.equal(typeof dataset.dashboard.totalProducts, "number");
      assert.ok(Number.isFinite(Number(dataset.dashboard.totalItems)));
      assert.equal(JSON.stringify(dataset).includes("passwordHash"), false);
      assert.equal(JSON.stringify(dataset).includes("tokenHash"), false);
      return {
        products: dataset.products.length,
        totalProducts: dataset.dashboard.totalProducts,
        totalItems: dataset.dashboard.totalItems,
      };
    },
  );
  await check("Mutation without Origin rejected", async () =>
    expectStatus(
      await request("/api/catalog/categories", {
        method: "POST",
        cookie: adminCookie,
        origin: false,
        body: { name: tag },
      }),
      403,
    ),
  );
  await check("Prototype entity rejected as unknown catalog", async () =>
    expectStatus(
      await request("/api/catalog/toString", { cookie: adminCookie }),
      404,
    ),
  );
  const category = await create("categories", { name: `${tag} Categoria` });
  await check("Unique category constraint rejects duplicate", async () =>
    expectStatus(
      await request("/api/catalog/categories", {
        method: "POST",
        cookie: adminCookie,
        body: { name: category.name },
      }),
      409,
    ),
  );
  const supplier = await create("suppliers", {
    legalName: `${tag} Fornecedor`,
    email: `supplier-${run}@example.test`,
  });
  const product = await create("products", {
    internalCode: `${tag}-ROL`,
    sku: `${tag}-SKU`,
    name: `${tag} Rolamento 6204`,
    categoryId: category.id,
    supplierId: supplier.id,
    unit: "UN",
    minStock: "10",
    maxStock: "1000",
    unitCost: "12.50",
  });
  await check("Product CRUD persists relationships and cost", async () => {
    const actual = expectStatus(
      await request(`/api/catalog/products/${product.id}`, {
        cookie: adminCookie,
      }),
      200,
    );
    assert.equal(actual.supplier.id, supplier.id);
    assert.equal(actual.category.id, category.id);
    assert.equal(Number(actual.unitCost), 12.5);
    expectStatus(
      await request(`/api/catalog/products/${product.id}`, {
        method: "PATCH",
        cookie: adminCookie,
        body: { description: "Cadastro validado por HTTP" },
      }),
      200,
    );
  });
  await check("Duplicate internal code rejected", async () =>
    expectStatus(
      await request("/api/catalog/products", {
        method: "POST",
        cookie: adminCookie,
        body: { internalCode: product.internalCode, name: "Duplicado" },
      }),
      409,
    ),
  );
  await check("Product rejects direct stock quantity mutation", async () =>
    expectStatus(
      await request(`/api/catalog/products/${product.id}`, {
        method: "PATCH",
        cookie: adminCookie,
        body: { quantity: 500 },
      }),
      400,
    ),
  );
  const warehouse = await create("warehouses", {
    code: `${tag}-W`,
    name: `${tag} Almoxarifado`,
  });
  const sector = await create("locations", {
    code: `${tag}-A`,
    name: "Setor A QA",
    warehouseId: warehouse.id,
  });
  const source = await create("locations", {
    code: `${tag}-A-P03`,
    name: "Prateleira 03 QA",
    warehouseId: warehouse.id,
    parentId: sector.id,
  });
  const target = await create("locations", {
    code: `${tag}-A-P04`,
    name: "Prateleira 04 QA",
    warehouseId: warehouse.id,
    parentId: sector.id,
  });
  await check("Location cycle rejected transactionally", async () =>
    expectStatus(
      await request(`/api/catalog/locations/${sector.id}`, {
        method: "PATCH",
        cookie: adminCookie,
        body: { parentId: source.id },
      }),
      400,
    ),
  );
  await check("QR resolves UUID, printed code and trusted URL", async () => {
    for (const value of [
      source.id,
      source.code,
      `${base}/localizacao/${source.id}`,
    ]) {
      assert.equal(
        expectStatus(
          await request(`/api/resolve?code=${encodeURIComponent(value)}`, {
            cookie: adminCookie,
          }),
          200,
        ).id,
        source.id,
      );
    }
    expectStatus(
      await request(
        `/api/resolve?code=${encodeURIComponent(`https://evil.invalid/localizacao/${source.id}`)}`,
        { cookie: adminCookie },
      ),
      400,
    );
    const svg = await request(`/api/qr/${source.id}?format=svg`, {
      cookie: adminCookie,
    });
    assert.equal(svg.status, 200);
    assert.ok(svg.content.includes("<svg"));
  });
  const roles = expectStatus(
    await request("/api/catalog/roles", { cookie: adminCookie }),
    200,
  );
  const keys = (r) => r.permissions.map((p) => p.permission.key);
  const operatorRole = roles.find(
    (r) => keys(r).includes("stock:move") && !keys(r).includes("catalog:write"),
  );
  const supervisorRole = roles.find(
    (r) => keys(r).includes("catalog:write") && !keys(r).includes("costs:read"),
  );
  assert.ok(
    operatorRole && supervisorRole,
    "Seed must provide operator and supervisor roles",
  );
  const operatorCookie = await login(operatorCredentials.email, operatorCredentials.password);
  const supervisorCookie = await login(supervisorCredentials.email, supervisorCredentials.password);
  const operator = expectStatus(await request("/api/me", { cookie: operatorCookie }), 200);
  const supervisor = expectStatus(await request("/api/me", { cookie: supervisorCookie }), 200);
  assert.ok(operator.permissions.includes("stock:move") && !operator.permissions.includes("catalog:write"));
  assert.ok(supervisor.permissions.includes("catalog:write") && !supervisor.permissions.includes("costs:read"));
  await check(
    "Operator cannot manage catalog, settings, users or costs",
    async () => {
      expectStatus(
        await request("/api/catalog/products", {
          method: "POST",
          cookie: operatorCookie,
          body: { name: "Proibido", internalCode: tag },
        }),
        403,
      );
      expectStatus(
        await request("/api/settings", {
          method: "PATCH",
          cookie: operatorCookie,
          body: { allowNegativeStock: true },
        }),
        403,
      );
      expectStatus(
        await request("/api/catalog/users", { cookie: operatorCookie }),
        403,
      );
      const operatorData = await data(operatorCookie);
      assert.equal(operatorData.users, undefined);
      assert.equal(operatorData.audit, undefined);
      assert.equal(JSON.stringify(operatorData).includes("unitCost"), false);
      assert.equal(
        expectStatus(
          await request(`/api/catalog/products/${product.id}`, {
            cookie: operatorCookie,
          }),
          200,
        ).unitCost,
        undefined,
      );
    },
  );
  await check(
    "Supervisor can create catalog but cannot write costs or archive",
    async () => {
      await create(
        "products",
        { internalCode: `${tag}-SUP`, name: `${tag} Cadastro supervisor` },
        supervisorCookie,
      );
      expectStatus(
        await request(`/api/catalog/products/${product.id}`, {
          method: "PATCH",
          cookie: supervisorCookie,
          body: { unitCost: "99" },
        }),
        403,
      );
      expectStatus(
        await request(`/api/catalog/products/${product.id}`, {
          method: "PATCH",
          cookie: supervisorCookie,
          body: { active: false },
        }),
        403,
      );
      assert.equal(
        JSON.stringify(await data(supervisorCookie)).includes("unitCost"),
        false,
      );
    },
  );
  await check(
    "Administrator cannot deactivate or demote own account",
    async () => {
      expectStatus(
        await request(`/api/catalog/users/${me.id}`, {
          method: "PATCH",
          cookie: adminCookie,
          body: { active: false },
        }),
        400,
      );
      expectStatus(
        await request(`/api/catalog/users/${me.id}`, {
          method: "PATCH",
          cookie: adminCookie,
          body: { roleId: operatorRole.id },
        }),
        400,
      );
    },
  );
  const entryKey = randomUUID();
  await check(
    "Entry of 100 and duplicate submission are idempotent",
    async () => {
      const payload = {
        type: "ENTRY",
        productId: product.id,
        quantity: "100",
        destinationId: source.id,
        idempotencyKey: entryKey,
      };
      const first = expectStatus(await move(operatorCookie, payload), 201);
      const retry = expectStatus(await move(operatorCookie, payload), 201);
      assert.equal(first.id, retry.id);
      assert.equal(quantity(await data(), product.id, source.id), 100);
    },
  );
  await check(
    "Withdrawal of 15 yields 85 and blocks negative stock",
    async () => {
      expectStatus(
        await move(operatorCookie, {
          type: "EXIT",
          productId: product.id,
          quantity: "15",
          sourceId: source.id,
        }),
        201,
      );
      assert.equal(quantity(await data(), product.id, source.id), 85);
      expectStatus(
        await move(operatorCookie, {
          type: "EXIT",
          productId: product.id,
          quantity: "1000",
          sourceId: source.id,
        }),
        409,
      );
      assert.equal(quantity(await data(), product.id, source.id), 85);
    },
  );
  await check("Transfer of 25 preserves total 85 as 60 + 25", async () => {
    expectStatus(
      await move(operatorCookie, {
        type: "TRANSFER",
        productId: product.id,
        quantity: "25",
        sourceId: source.id,
        destinationId: target.id,
      }),
      201,
    );
    const current = await data();
    assert.equal(quantity(current, product.id, source.id), 60);
    assert.equal(quantity(current, product.id, target.id), 25);
    assert.equal(
      current.balances
        .filter((b) => b.productId === product.id)
        .reduce((sum, b) => sum + Number(b.quantity), 0),
      85,
    );
    return { source: 60, destination: 25, total: 85 };
  });
  await check("Products with balance cannot be archived", async () =>
    expectStatus(
      await request(`/api/catalog/products/${product.id}`, {
        method: "DELETE",
        cookie: adminCookie,
      }),
      409,
    ),
  );
  await check(
    "Count requires supervisor approval and generates adjustment",
    async () => {
      const count = expectStatus(
        await request("/api/inventory", {
          method: "POST",
          cookie: operatorCookie,
          body: {
            locationId: source.id,
            items: [
              {
                productId: product.id,
                expectedQuantity: "60",
                countedQuantity: "57",
              },
            ],
            note: `Contagem QA ${run}`,
            idempotencyKey: randomUUID(),
          },
        }),
        201,
      );
      assert.equal(count.status, "PENDING");
      assert.equal(quantity(await data(), product.id, source.id), 60);
      expectStatus(
        await request(`/api/inventory/${count.id}/approve`, {
          method: "POST",
          cookie: operatorCookie,
        }),
        403,
      );
      assert.equal(
        expectStatus(
          await request(`/api/inventory/${count.id}/approve`, {
            method: "POST",
            cookie: supervisorCookie,
          }),
          200,
        ).status,
        "APPROVED",
      );
      assert.equal(quantity(await data(), product.id, source.id), 57);
    },
  );
  await check("Concurrent withdrawals cannot oversell location", async () => {
    const responses = await Promise.all(
      [1, 2].map(() =>
        move(operatorCookie, {
          type: "EXIT",
          productId: product.id,
          quantity: "40",
          sourceId: source.id,
        }),
      ),
    );
    assert.deepEqual(responses.map((r) => r.status).sort(), [201, 409]);
    assert.equal(quantity(await data(), product.id, source.id), 17);
  });
  await check(
    "Stock history and audit retain confirmed operations",
    async () => {
      const current = await data();
      const history = current.movements.filter(
        (m) => m.productId === product.id,
      );
      assert.deepEqual([...new Set(history.map((m) => m.type))].sort(), [
        "ADJUSTMENT",
        "ENTRY",
        "EXIT",
        "TRANSFER",
      ]);
      const ids = new Set(history.map((m) => m.id));
      assert.ok(current.audit.some((a) => ids.has(a.entityId)));
      assert.ok(
        current.dashboard.today.ENTRY >= 1 &&
          current.dashboard.today.EXIT >= 1 &&
          current.dashboard.today.TRANSFER >= 1,
      );
    },
  );
  await check(
    "Image upload checks content and authenticates retrieval",
    async () => {
      const png = Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aI7sAAAAASUVORK5CYII=",
        "base64",
      );
      const form = new FormData();
      form.set("file", new Blob([png], { type: "image/png" }), "pixel.png");
      const uploaded = expectStatus(
        await request("/api/upload", {
          method: "POST",
          cookie: adminCookie,
          form,
        }),
        201,
      );
      assert.equal(
        (await request(uploaded.url, { cookie: operatorCookie })).status,
        200,
      );
      expectStatus(await request(uploaded.url), 401);
      const invalid = new FormData();
      invalid.set(
        "file",
        new Blob(["<script>alert(1)</script>"], { type: "image/png" }),
        "fake.png",
      );
      expectStatus(
        await request("/api/upload", {
          method: "POST",
          cookie: adminCookie,
          form: invalid,
        }),
        400,
      );
    },
  );
  await check("Catálogo não aceita redefinição de senha fora do Supabase Auth", async () => {
    expectStatus(await request(`/api/catalog/users/${operator.id}`, {
      method: "PATCH", cookie: adminCookie, body: { password: "nao-deve-ser-aceita-2026" },
    }), 400);
    expectStatus(await request("/api/me", { cookie: operatorCookie }), 200);
  });
  await check(
    "Login rate limit persists and blocks sixth failed attempt",
    async () => {
      const email = `nonexistent-${run}@example.invalid`;
      for (let attempt = 0; attempt < 5; attempt++)
        expectStatus(
          await request("/api/auth/login", {
            method: "POST",
            body: { email, password: "invalid-password" },
          }),
          401,
        );
      expectStatus(
        await request("/api/auth/login", {
          method: "POST",
          body: { email, password: "invalid-password" },
        }),
        429,
      );
    },
  );
  await check("Logout removes session cookies and denies the next protected request", async () => {
    expectStatus(
      await request("/api/auth/logout", {
        method: "POST",
        cookie: operatorCookie,
      }),
      200,
    );
    expectStatus(await request("/api/me", { cookie: operatorCookie }), 401);
  });
  evidence.result = "passed";
} catch (error) {
  evidence.result = "failed";
  evidence.error = error.message;
  process.exitCode = 1;
} finally {
  if (adminCookie) {
    try {
      const current = await data();
      for (const balance of current.balances.filter(
        (b) =>
          resources.products.includes(b.productId) && Number(b.quantity) > 0,
      )) {
        const result = await move(adminCookie, {
          type: "EXIT",
          productId: balance.productId,
          quantity: balance.quantity,
          sourceId: balance.locationId,
          reference: `Limpeza verificação ${run}`,
        });
        evidence.cleanup.push({
          operation: "zero-test-balance",
          ok: result.status === 201,
        });
      }
      for (const entity of [
        "products",
        "locations",
        "warehouses",
        "suppliers",
        "categories",
      ]) {
        for (const id of [...resources[entity]].reverse()) {
          const result = await request(`/api/catalog/${entity}/${id}`, {
            method: "DELETE",
            cookie: adminCookie,
          });
          evidence.cleanup.push({
            operation: `archive-${entity}`,
            ok: result.status === 200,
          });
        }
      }
      await request("/api/auth/logout", {
        method: "POST",
        cookie: adminCookie,
      });
    } catch (error) {
      evidence.cleanup.push({
        operation: "cleanup",
        ok: false,
        error: error.message,
      });
    }
  }
  evidence.finishedAt = new Date().toISOString();
  await mkdir("artifacts", { recursive: true });
  await writeFile(
    "artifacts/uca-api-checks.json",
    `${JSON.stringify(evidence, null, 2)}\n`,
  );
  console.log(
    `API verification: ${evidence.result}; ${evidence.checks.filter((c) => c.passed).length}/${evidence.checks.length} checks passed. Evidence: artifacts/uca-api-checks.json`,
  );
}
