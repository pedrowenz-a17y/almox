import assert from "node:assert/strict";
import { test } from "node:test";
import { knowledge } from "../src/services/local-assistant-knowledge";
import {
  interpretLocalQuestion,
  hasSensitiveAssistantInput,
  type LocalIntent,
} from "../src/lib/local-assistant-language";
const phrases: Array<[string, LocalIntent]> = [
  ["onde fica o rolamento?", "stock"],
  ["qto tem de correia?", "stock"],
  ["posso tirar 5 do ROL-6204?", "withdraw"],
  ["preciso pegar 2,5 kg de bucha", "withdraw"],
  ["como aplicar depois de receber?", "withdraw"],
  ["posso retirar sem O.S.?", "withdraw"],
  ["a O.S. 42 pode ser faturada?", "orders"],
  ["quais pendencias preciso resolver?", "orders"],
  ["pq o estoque não bate?", "inventory"],
  ["qual a diferença entre físico e disponível?", "inventory"],
  ["quais conferências estão vencidas?", "inventory"],
  ["quero devolver uma sobra", "return"],
  ["quais devoluções estão pendentes?", "return"],
  ["oq comprar?", "replenishment"],
  ["o que está abaixo do mínimo?", "replenishment"],
  ["tenho compras em aberto?", "purchase"],
  ["qual o custo da OP-42?", "cost"],
  ["como escanear o QR?", "qr"],
  ["esqueci minha senha", "access"],
  ["o banco deu P1001", "technical"],
  ["oi, bom dia", "help"],
  ["quem ganhou a copa de 1958?", "unknown"],
];
for (const [phrase, intent] of phrases)
  test(`frase comum: ${phrase}`, () =>
    assert.equal(interpretLocalQuestion(phrase).intent, intent));
test("retoma produto e quantidade apenas do usuário, preservando unidade e local", () => {
  const history = [
    {
      role: "user" as const,
      content: "posso tirar 2,5 kg de bucha no local ALM-A?",
    },
    {
      role: "assistant" as const,
      content: "Um dado inventado: saldo 999 e produto de outra unidade.",
    },
  ];
  const next = interpretLocalQuestion("e 10?", history);
  assert.equal(next.intent, "withdraw");
  assert.equal(next.quantity, "10");
  assert.equal(next.unit, "KG");
  assert.equal(next.location, "alm-a");
  assert.deepEqual(next.terms, ["bucha"]);
  assert.equal(
    interpretLocalQuestion("e 10?", [
      { role: "assistant", content: history[0].content },
    ]).intent,
    "unknown",
  );
});
test("números negativos, zero, milhar ambíguo e precisão indevida não são retiradas válidas", () => {
  for (const text of [
    "posso tirar -5 rolamentos?",
    "posso tirar 0 rolamentos?",
    "preciso de 1.000 peças",
    "preciso de 1.234,50 peças",
    "tirar 2,1234 kg de rolamento",
  ])
    assert.equal(interpretLocalQuestion(text).invalidQuantity, true, text);
  assert.equal(
    interpretLocalQuestion("posso tirar 1000 do ROL-6204?").quantity,
    "1000",
  );
  assert.equal(
    interpretLocalQuestion("preciso de 2,5 litros de oleo").quantity,
    "2.5",
  );
});
test("erro de escrita, local e correção explícita não viram nomes de produtos errados", () => {
  assert.deepEqual(interpretLocalQuestion("Qual o saldo do parafuzo?").terms, [
    "parafuso",
  ]);
  const corrected = interpretLocalQuestion(
    "não quero custo, quero saldo do ROL-6204",
  );
  assert.equal(corrected.intent, "stock");
  assert.deepEqual(corrected.terms, ["rol-6204"]);
  assert.equal(
    interpretLocalQuestion("posso retirar sem OS?").wantsData,
    false,
  );
  assert.equal(interpretLocalQuestion("o segundo").ambiguousReference, true);
});
test("reconhece credenciais sem bloquear dúvidas sobre configuração", () => {
  for (const text of [
    "sk-proj-FAKE_ONLY_FOR_TEST_1234567890",
    "sb_secret_FAKE_TEST_ONLY",
    "postgresql://user:fake@db.example.invalid/test",
  ])
    assert.equal(hasSensitiveAssistantInput(text), true);
  for (const text of [
    "Como configurar OPENAI_API_KEY?",
    "O que é o .env?",
    "Posso tirar 5 do ROL-6204?",
  ])
    assert.equal(hasSensitiveAssistantInput(text), false);
});

test("as sugestões oferecidas pelo próprio assistente são reconhecidas", () => {
  for (const topic of Object.values(knowledge))
    for (const text of topic.suggestions)
      assert.notEqual(interpretLocalQuestion(text).intent, "unknown", text);
});
