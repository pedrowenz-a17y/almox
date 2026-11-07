import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { AppError } from "../src/lib/http";
import {
  assistantProfile,
  respondAssistant,
} from "../src/services/assistant-router";
import { askLocalAssistant } from "../src/services/local-assistant";
const actor = () => ({
  id: randomUUID(),
  unitId: randomUUID(),
  permissions: [],
});
const never = async () => {
  throw new Error("Unexpected paid provider call");
};
test("modo gratuito é padrão mesmo quando existe chave antiga", async () => {
  assert.equal(assistantProfile({}).mode, "local");
  assert.equal(
    assistantProfile({ OPENAI_API_KEY: "fake-test-key" }).external,
    false,
  );
  const result = await respondAssistant(
    actor(),
    { question: "Como retirar material?", mode: "local" },
    { env: { OPENAI_API_KEY: "fake-test-key" }, remote: never },
  );
  assert.equal(result.mode, "local");
  assert.match(result.answer, /O\.S\./);
  assert.match(result.scope, /nenhum registro consultado/);
});
test("OpenAI só é escolhida por configuração explícita e conversa de modo compatível", async () => {
  let calls = 0;
  const user = actor(),
    remote = async () => {
      calls++;
      return {
        answer: "Simulada",
        scope: "Sem banco",
        generatedAt: new Date().toISOString(),
      };
    };
  const env = { ASSISTANT_PROVIDER: "openai", OPENAI_API_KEY: "fake-test-key" };
  for (const mode of [undefined, "local"])
    await assert.rejects(
      respondAssistant(user, { question: "Ajuda", mode }, { env, remote }),
      (e) => e instanceof AppError && e.code === "ASSISTANT_MODE_CHANGED",
    );
  assert.equal(calls, 0);
  const result = await respondAssistant(
    user,
    { question: "Ajuda", mode: "openai" },
    { env, remote },
  );
  assert.equal(result.mode, "openai");
  assert.equal(calls, 1);
  await assert.rejects(
    respondAssistant(
      user,
      { question: "Ajuda", mode: "openai" },
      { env: {}, remote },
    ),
    (e) => e instanceof AppError && e.status === 409,
  );
  assert.throws(
    () => assistantProfile({ ASSISTANT_PROVIDER: "inventado" }),
    (e) => e instanceof AppError && e.status === 503,
  );
});
test("nenhuma pergunta ou histórico contendo credencial é encaminhado", async () => {
  const fake = "sk-proj-FAKE_ONLY_FOR_TEST_1234567890";
  let calls = 0;
  const local = async () => {
    calls++;
    return { answer: "Simulado", scope: "", mode: "local" as const };
  };
  for (const payload of [
    { question: fake },
    { question: "Oi", history: [{ role: "user", content: fake }] },
    { question: "Oi", history: [{ role: "assistant", content: fake }] },
  ])
    await assert.rejects(
      respondAssistant(
        actor(),
        { ...payload, mode: "local" },
        { env: {}, local, remote: never },
      ),
      (e) => e instanceof AppError && e.code === "ASSISTANT_SENSITIVE_INPUT",
    );
  assert.equal(calls, 0);
});
test("ajuda e limites locais não dependem de credenciais externas e não simulam treinamento geral", async () => {
  const result = await askLocalAssistant(actor(), {
    question: "quem ganhou a copa de 1958?",
    includeUnit: false,
  });
  assert.match(result.answer, /não entendi/);
  assert.doesNotMatch(result.answer, /Brasil/);
  assert.equal(result.mode, "local");
  const guide = await askLocalAssistant(actor(), {
    question: "Onde fica o rolamento?",
    includeUnit: false,
  });
  assert.match(guide.answer, /Não consultei os saldos/);
  assert.deepEqual(
    guide.links?.map((l) => l.href),
    ["/consulta", "/estoque"],
  );
  await assert.rejects(
    askLocalAssistant({ ...actor(), unitId: "" }, { question: "Oi" }),
    (e) => e instanceof AppError && e.status === 403,
  );
});
test("proteção gratuita permite conversa simples e mantém espera limitada sem chamar a OpenAI", async () => {
  const user = actor(),
    now = Date.now();
  let calls = 0;
  const local = async () => {
    calls++;
    return { answer: "Simulado", scope: "", mode: "local" as const };
  };
  for (let i = 0; i < 30; i++)
    await respondAssistant(
      user,
      { question: "Oi", mode: "local" },
      { env: {}, local, remote: never, now },
    );
  await assert.rejects(
    respondAssistant(
      user,
      { question: "Oi", mode: "local" },
      { env: {}, local, remote: never, now: now + 1000 },
    ),
    (e) =>
      e instanceof AppError &&
      e.status === 429 &&
      /30 mensagens/.test(e.message),
  );
  assert.equal(calls, 30);
  await respondAssistant(
    user,
    { question: "Oi", mode: "local" },
    { env: {}, local, now: now + 60000 },
  );
  assert.equal(calls, 31);
});
