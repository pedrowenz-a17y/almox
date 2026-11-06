import assert from "node:assert/strict";
import { test } from "node:test";
import { api, ApiError } from "../src/lib/client";

test("API cliente recebe cooldown de 429, limita valor e preserva códigos seguros", async () => {
  const previous = globalThis.fetch;
  try {
    for (const [json, header, seconds] of [
      [12, "9", 12],
      [undefined, "14", 14],
      [9999999, "8", 3600],
      [-1, null, undefined],
      ["bad", "6", 6],
    ] as const) {
      globalThis.fetch = (async () =>
        new Response(
          JSON.stringify({
            error: "Aguarde",
            code: "AI_PROVIDER_RATE_LIMIT",
            ...(json === undefined ? {} : { retryAfter: json }),
          }),
          { status: 429, headers: header ? { "Retry-After": header } : {} },
        )) as typeof fetch;
      await assert.rejects(api("/api/assistant"), (error) => {
        assert.ok(error instanceof ApiError);
        assert.equal(error.status, 429);
        assert.equal(error.code, "AI_PROVIDER_RATE_LIMIT");
        assert.equal(error.retryAfter, seconds);
        return true;
      });
    }
    globalThis.fetch = (async () =>
      new Response('{"error":"Indisponível","retryAfter":10}', {
        status: 503,
      })) as typeof fetch;
    await assert.rejects(
      api("/api/assistant"),
      (error) => error instanceof ApiError && error.retryAfter === undefined,
    );
  } finally {
    globalThis.fetch = previous;
  }
});

test("metadados de cooldown preservam saída da sessão expirada e credenciais same-origin", async () => {
  const previousFetch = globalThis.fetch;
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const redirects: string[] = [];
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      location: {
        pathname: "/dashboard",
        search: "",
        assign: (path: string) => redirects.push(path),
      },
    },
  });
  try {
    globalThis.fetch = (async (_path, init) => {
      assert.equal(init?.credentials, "same-origin");
      assert.equal(init?.cache, "no-store");
      return new Response(
        '{"error":"Sessão expirada","code":"SESSION_EXPIRED"}',
        { status: 401 },
      );
    }) as typeof fetch;
    await assert.rejects(
      api("/api/assistant"),
      (error) => error instanceof ApiError && error.status === 401,
    );
    assert.deepEqual(redirects, ["/login?reason=expired&next=%2Fdashboard"]);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousWindow)
      Object.defineProperty(globalThis, "window", previousWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
});
