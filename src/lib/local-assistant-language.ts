/** Small, explainable Portuguese intent matcher. No model, eval or remote service. */
export type LocalIntent =
  | "help"
  | "stock"
  | "withdraw"
  | "return"
  | "orders"
  | "inventory"
  | "replenishment"
  | "purchase"
  | "cost"
  | "qr"
  | "access"
  | "technical"
  | "unknown";
export type ConversationTurn = { role: "user" | "assistant"; content: string };
export function normalizePhrase(text: string) {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\bo\s*\.\s*([sp])\.?/g, "o$1")
    .replace(/[^a-z0-9,.\-\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
const aliases: Record<string, string> = {
  qto: "quanto",
  qnt: "quanto",
  qts: "quantos",
  qtd: "quantidade",
  vc: "voce",
  vcs: "voces",
  pq: "porque",
  oq: "oque",
  ta: "esta",
  pra: "para",
  precisso: "preciso",
  estoqe: "estoque",
  estque: "estoque",
  devolussao: "devolucao",
  inventaro: "inventario",
  reposisao: "reposicao",
  rolamnto: "rolamento",
  parafuzo: "parafuso",
};
export function hasSensitiveAssistantInput(text: string) {
  return /sk-(?:proj-)?[A-Za-z0-9_-]{16,}|sb_secret_[A-Za-z0-9_-]+|postgres(?:ql)?:\/\/|(?:OPENAI_API_KEY|SUPABASE_SERVICE_ROLE_KEY)\s*=\s*["']?[^"'\s]{12,}/i.test(
    text,
  );
}
function words(text: string) {
  return normalizePhrase(text)
    .split(" ")
    .map((w) => aliases[w] || w)
    .join(" ");
}
const stop = new Set(
  "oi ola bom boa dia tarde noite obrigado obrigada valeu ajuda ajude me por favor pode posso poder consegue quero queria preciso gostaria saber tenho temos tem ter ha esta estar muito quanto quantos quantas quantidade porque por que qual quais onde fica ficam achar encontra encontrar encontre procurar procure mostra mostre mostrar consultar consulta consulte ver veja verificar conferir confira estoque saldo saldos disponivel disponiveis fisico contabil reservado reservas reserva aplicado aplicada aplicados material materiais produto produtos peca pecas unidade unidades un kg litro litros l m de do da dos das no na nos nas um uma uns umas o a os as e ou em com sem para pro ao aos esse essa este esta desses dessas dele dela disso sobre agora hoje hoje aqui sim nao mais menos mesmo mesma voce voces pegar pega pego pegue retire retira retirar retiro retirada tirada tirar tire tira baixa baixar baixe entrada movimentar movimente movimentacao transferencia transferir aplicar aplique aplicacao como funciona fazer faz feito nosso nossa meu minha se eu ordem ordens servico producao op custo custos preco valor gasto total pendencia pendencias devolver devolvo devolucao devolucoes voltou sobrou comprar compra compras repor reposicao minimo minimos maximo nota fiscal ainda ja entao tambem poderia seria consigo so isto isto e ai agora pode ser favor obrigado matricula recebimento recebido entregar entrega recebedor tenho preciso codigo cod local localizacao localizacoes estante prateleira armazem almoxarifado almox neste nesse nessa nessa nao acho quer dizer desse dessa disso outro outra segundo primeira ultimo ultima primeiro".split(
    " ",
  ),
);
function locationRef(text: string) {
  return (
    words(text).match(
      /\b(?:no|na)\s+(?:local(?:izacao)?|estante|prateleira)\s+([a-z0-9][a-z0-9._-]*)/,
    )?.[1] ?? words(text).match(/\b(?:no|na)\s+([a-z]{1,10}-[a-z0-9_-]+)/)?.[1]
  );
}
export function productTerms(text: string) {
  const location = locationRef(text);
  return words(text)
    .replace(location ?? "$^never-match", " ")
    .replace(/\b\d+(?:[,.]\d+)?\s*(?:unidades?|pecas?|un|kg|litros?)\b/g, " ")
    .replace(
      /\b(?:pegar|pega|pegue|retire|retira|retirar|tirar|preciso|quero|tire|tira)\s+(?:de\s+)?\d+(?:[,.]\d+)?/g,
      " ",
    )
    .split(/[\s,]+/)
    .map((t) => t.replace(/^[.\-]+|[.\-]+$/g, ""))
    .filter((t) => t.length >= 2 && !stop.has(t))
    .slice(0, 8);
}
function intentFor(t: string): LocalIntent {
  // Entity codes such as OS-42 or CUSTO-01 are data, not topic keywords.
  t = t.replace(/\b[a-z0-9]+(?:[-_][a-z0-9]+)+\b/g, " ");
  if (
    /\b(banco|p1001|prisma|localhost|eaddrinuse|api|creditos?|limite|chave|erro de conexao)\b/.test(
      t,
    )
  )
    return "technical";
  if (/\b(custo|custos|preco|valor|custa|custam|custou|gasto|gastou)\b/.test(t))
    return "cost";
  if (
    /\b(conciliacao|conciliar|erp oficial)\b|\b(?:diferencas|conferir).*\berp\b/.test(
      t,
    )
  )
    return "cost";
  if (
    /\b(devolver|devolvo|devolucao|devolucoes|devolvido|sobrou|voltou|retorno)\b/.test(
      t,
    )
  )
    return "return";
  if (
    /\b(nao bate|divergencia|divergencias|diferenca|diferencas|inventario|contagem|contar|conferencia|conferencias)\b/.test(
      t,
    )
  )
    return "inventory";
  if (/\b(?:o que|oque)\b.*\b(falta|faltando|comprar|repor)\b/.test(t))
    return "replenishment";
  if (
    /\b(repor|reposicao|acabando|acabou|minimo|minimos|o que comprar|oque comprar|o que falta|falta material)\b/.test(
      t,
    )
  )
    return "replenishment";
  if (/\b(qr|etiqueta|escanear|scanear|camera)\b/.test(t)) return "qr";
  if (
    /\b(login|senha|acesso|usuario|convite|permissao|administrador)\b/.test(t)
  )
    return "access";
  if (
    /\b(aplicar|aplicacao|aplique|reservar|reserva|entregar|entrega|entregou)\b/.test(
      t,
    ) ||
    /\bsem\s+(os|op|ordem)\b/.test(t)
  )
    return "withdraw";
  if (
    /\b(pendencia|pendencias|faturar|faturamento|faturada|pronta|ordem|ordens|os|op)\b/.test(
      t,
    )
  )
    return "orders";
  if (
    /\b(pegar|pega|pego|pegue|retirar|retirada|retire|retirei|retirou|tirar|tira|tire|aplicar|aplicacao|aplique|reservar|reserva|baixar|baixa|entregar|entrega|entregou|responsavel)\b/.test(
      t,
    )
  )
    return "withdraw";
  if (
    /\b(comprar|compra|compras|fornecedor|receber|recebimento|nota fiscal)\b/.test(
      t,
    )
  )
    return "purchase";
  if (
    /\b(estoque|saldo|saldos|fisico|disponivel|disponiveis|onde|quantos|quantas|quanto|quantidade|tem|procure|procura|encontre|localizacao|cade|acho|preciso)\b/.test(
      t,
    )
  )
    return "stock";
  if (
    /^(oi|ola|bom dia|boa tarde|boa noite|obrigad[oa]|valeu)\b/.test(t) ||
    /\b(ajuda|ajude|ajudar|o que faz|oque faz|o que voce sabe|o que voce consegue fazer|como funciona|pode fazer)\b/.test(
      t,
    )
  )
    return "help";
  return "unknown";
}
function amount(text: string): {
  value?: string;
  unit?: string;
  invalid: boolean;
} {
  const t = words(text);
  const cue = t.match(
    /\b(?:pegar|pega|pegue|retire|retira|retirar|tirar|preciso|quero|tire|tira|retire)\s+(?:de\s+)?(-?\d[\d.,]*)/,
  );
  const withUnit = t.match(
    /(?<![a-z0-9.\-])(-?\d[\d.,]*)\s*(kg|unidades?|pecas?|un|litros?|l|m)\b/,
  );
  const alone = t.match(/^(?:e\s+)?(-?\d[\d.,]*)$/);
  const raw = cue?.[1] ?? withUnit?.[1] ?? alone?.[1];
  if (!raw) return { invalid: false };
  // A dot followed by three digits is ambiguous in Portuguese (decimal or thousands).
  if (
    !/^\d{1,15}(?:[,.]\d{1,3})?$/.test(raw) ||
    /^\d{1,3}\.\d{3}$/.test(raw) ||
    /^0(?:[,.]0+)?$/.test(raw)
  )
    return { invalid: true };
  const u = withUnit?.[2];
  const unit = u
    ? u.startsWith("litro") || u === "l"
      ? "L"
      : /^(un|unidade|peca)/.test(u)
        ? "UN"
        : u.toUpperCase()
    : undefined;
  return { value: raw.replace(",", "."), unit, invalid: false };
}
export function interpretLocalQuestion(
  question: string,
  history: ConversationTurn[] = [],
) {
  const correction = question.match(
    /(?:,|;|\bmas\b)\s*(?:quero|preciso|e sim|na verdade)\s+(.+)$/i,
  );
  const current = correction?.[1] ?? question;
  const normalized = words(current);
  let topic = intentFor(normalized);
  let source = current;
  const parsedAmount = amount(current);
  let quantity = parsedAmount.value;
  const shortFollowUp =
    /^(e\b|esse\b|essa\b|isso\b|e agora|quanto|quantos|tem mais|posso|pode ser|sim\b|nao[,\s])/.test(
      normalized,
    ) || /^\d+(?:[,.]\d+)?$/.test(normalized);
  const last = history.filter((turn) => turn.role === "user").at(-1)?.content;
  if (last && shortFollowUp) {
    const previous = words(last),
      previousIntent = intentFor(previous);
    if (
      topic === "unknown" ||
      topic === "help" ||
      /^(e\s+)?\d+(?:[,.]\d+)?$/.test(normalized)
    )
      topic = previousIntent;
    // Follow-up quantities can reuse only a previous USER's reference, never the assistant's assertions.
    if (
      (productTerms(question).length === 0 ||
        productTerms(question).every((t) => /^\d+(?:[,.]\d+)?$/.test(t))) &&
      !/\b(outro|outra|segundo|primeiro)\b/.test(normalized)
    )
      source = last;
    if (
      !quantity &&
      /^(e agora|e esse|e essa|isso|sim|pode ser)/.test(normalized)
    )
      quantity = amount(last).value;
  }
  if (
    topic === "unknown" &&
    /\b(rolamento|parafuso|correia|mancal|bucha)\b|\b[a-z]{2,}-\d/.test(
      normalized,
    )
  )
    topic = "stock";
  const unit =
    parsedAmount.unit ?? (source !== current ? amount(source).unit : undefined);
  const withoutOrder = /\bsem\s+(os|op|ordem)\b/.test(normalized);
  const procedure =
    /\b(como|explique|explica|diferenca|significa|o que e|porque|por que|motivo)\b/.test(
      normalized,
    );
  const definition = /\b(diferenca|significa|o que e)\b/.test(normalized);
  return {
    intent: topic,
    normalized,
    referenceText: source,
    terms: productTerms(source),
    quantity,
    invalidQuantity: parsedAmount.invalid,
    unit,
    location: locationRef(question) ?? locationRef(source),
    wantsData:
      !withoutOrder &&
      (!procedure ||
        (!definition &&
          /\b(qual|quais|quanto|quantos|pendencias|saldo|posso|consigo|tem)\b/.test(
            normalized,
          ))),
    orderKind: /\bop\b/.test(normalized)
      ? ("PRODUCTION" as const)
      : /\bos\b/.test(normalized)
        ? ("SERVICE" as const)
        : undefined,
    ambiguousReference:
      /\b(outro|outra|segundo|primeiro)\b/.test(normalized) &&
      productTerms(question).every((t) =>
        /^(outro|outra|segundo|primeiro)$/.test(t),
      ),
  };
}
