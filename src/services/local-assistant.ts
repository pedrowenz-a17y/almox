import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { AssistantLink, AssistantReply } from "@/lib/assistant-contract";
import {
  interpretLocalQuestion,
  normalizePhrase,
  hasSensitiveAssistantInput,
} from "@/lib/local-assistant-language";
import type { StockActor } from "@/services/stock";
import { assistantInput } from "@/services/assistant";
import { AppError } from "@/lib/http";
import {
  displayQty,
  findLocalProducts,
  localOrderSnapshot,
  localProductSnapshot,
  orderReference,
  Quantity,
} from "@/services/local-assistant-data";
import { knowledge, localHelp } from "@/services/local-assistant-knowledge";
import { listOperationalPending } from "@/services/operational-pending";
import { listReplenishment } from "@/services/replenishment";
import { costOrderSelect, summarizeOrderCost } from "@/services/order-costs";

const orientationScope =
  "Orientação local pelas regras do ERP · nenhum registro consultado.";
const scope = (date = new Date().toISOString()) =>
  `Registros da unidade ativa consultados em ${new Date(date).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })} (Brasília). Não comprova contagem física ou sincronização com outro ERP.`;
function allowedLinks(actor: StockActor, links: AssistantLink[]) {
  const can = (p: string) => actor.permissions.includes(p);
  return links.filter((link) => {
    if (/^\/ordens-/.test(link.href)) return can("orders:read");
    if (["/compras", "/reposicao"].includes(link.href))
      return can("purchases:read");
    if (["/inventario", "/conferencias"].includes(link.href))
      return can("inventory:count");
    if (link.href === "/pendencias")
      return can("orders:read") || can("inventory:count");
    if (link.href === "/conciliacao")
      return can("costs:read") || can("reports:read");
    return /^\/(?:consulta|estoque|qrcodes|produto\/[0-9a-f-]{36})$/.test(
      link.href,
    );
  });
}
export async function askLocalAssistant(
  actor: StockActor,
  raw: unknown,
): Promise<AssistantReply> {
  if (!actor.id || !actor.unitId)
    throw new AppError("Entre e selecione uma unidade autorizada.", 403);
  const safeInput = assistantInput.parse(raw);
  if (
    [safeInput.question, ...safeInput.history.map((m) => m.content)].some(
      hasSensitiveAssistantInput,
    )
  )
    throw new AppError(
      "Remova chaves, senhas e URLs de banco antes de continuar.",
      400,
      "ASSISTANT_SENSITIVE_INPUT",
    );
  const input = safeInput,
    plan = interpretLocalQuestion(input.question, input.history);
  const reply = (
    answer: string,
    links: AssistantLink[] = [],
    suggestions: string[] = [],
    readAt?: string,
  ): AssistantReply => ({
    answer,
    mode: "local",
    scope: readAt ? scope(readAt) : orientationScope,
    links: allowedLinks(actor, links),
    suggestions: suggestions.slice(0, 4),
  });
  const can = (p: string) => actor.permissions.includes(p);
  if (plan.invalidQuantity)
    return reply(
      "Essa quantidade é inválida ou ambígua. Informe um número positivo, sem separador de milhar, com até três casas decimais. Por exemplo: 1000 peças ou 2,5 kg. Não fiz comparação de saldo com esse valor.",
    );
  if (plan.intent === "help")
    return reply(
      /^(obrigad|valeu)/.test(plan.normalized)
        ? "Por nada! Quando precisar, posso ajudar a conferir uma peça, uma ordem ou a rotina do estoque."
        : localHelp,
      [],
      [
        "Como retirar material pela O.S.?",
        "Por que o estoque não bate?",
        "O que está abaixo do mínimo?",
      ],
    );
  if (plan.intent === "unknown")
    return reply(
      "Ainda não entendi o que você quer conferir. Posso ajudar com estoque, retiradas, ordens, devoluções, reposição e inventário. Diga, por exemplo, “onde fica o rolamento?” ou informe o código da peça. Perguntas de outros assuntos ficam fora deste assistente local.",
      [],
      [
        "O que você consegue fazer?",
        "Como retirar material?",
        "Quais pendências preciso resolver?",
      ],
    );
  const guide = knowledge[plan.intent];
  if (
    !input.includeUnit ||
    !plan.wantsData ||
    ["qr", "access", "technical"].includes(plan.intent)
  ) {
    const needsReference =
      [
        "stock",
        "withdraw",
        "orders",
        "return",
        "inventory",
        "replenishment",
        "purchase",
        "cost",
      ].includes(plan.intent) && plan.wantsData;
    return reply(
      guide.answer +
        (needsReference
          ? "\n\nPara conferir registros atuais, marque Consultar dados da unidade e envie a pergunta novamente. Não consultei os saldos nesta resposta."
          : ""),
      guide.links,
      guide.suggestions,
    );
  }
  if (
    plan.intent === "stock" ||
    (plan.intent === "withdraw" && (plan.quantity || plan.terms.length))
  ) {
    if (plan.ambiguousReference || !plan.terms.length)
      return reply(
        "Qual material você quer conferir? Informe o código ou um nome, como “rolamento”. Se quiser verificar uma retirada, diga também a quantidade na unidade cadastrada.",
        guide.links,
        ["Onde fica o rolamento?", "Qual o saldo do parafuso?"],
      );
    const candidates = await findLocalProducts(actor, plan.terms);
    if (!candidates.length)
      return reply(
        "Não encontrei um produto ativo correspondente nesta unidade. Confira o código ou tente um nome mais curto. Isso não significa que o saldo seja zero.",
        [{ label: "Buscar na consulta", href: "/consulta" }],
      );
    if (candidates[0].total !== 1 || candidates[0].strength === 1)
      return reply(
        `Encontrei ${candidates[0].total} possibilidade(s) nesta unidade${candidates[0].strength === 1 ? " por aproximação do nome" : ""}. Qual código você quer conferir?\n${candidates.map((p) => `• ${p.code} — ${p.name} (${p.unit})`).join("\n")}${candidates[0].total > candidates.length ? "\nMostrei as seis primeiras; informe um código mais específico." : ""}`,
        [],
        candidates.slice(0, 4).map((p) => `Qual o saldo do ${p.code}?`),
        new Date().toISOString(),
      );
    const snapshot = await localProductSnapshot(actor, candidates[0].id);
    if (!snapshot)
      return reply(
        "Esse produto mudou ou não está ativo nesta unidade. Faça uma nova consulta; não considerei o saldo como zero.",
      );
    const { product } = snapshot;
    let rows = snapshot.rows;
    if (plan.location) {
      rows = rows.filter((r) =>
        [r.code, r.name].some(
          (n) => normalizePhrase(n) === normalizePhrase(plan.location!),
        ),
      );
      if (!rows.length)
        return reply(
          `Não encontrei a localização “${plan.location}” entre os registros desta peça. Informe um código de local mostrado na ficha; não usei o saldo de outro local para autorizar a retirada.`,
          [{ label: "Ver ficha do produto", href: `/produto/${product.id}` }],
          [],
          snapshot.at,
        );
    }
    const sum = (
      key: "ledger" | "physical" | "reserved" | "applied" | "available",
    ) => rows.reduce((n, r) => n.plus(r[key]), new Quantity(0));
    const unit = product.unit;
    const usable = rows
      .filter((r) => r.active)
      .reduce(
        (total, row) => total.plus(Quantity.max(0, row.available)),
        new Quantity(0),
      );
    const totals = `${product.internalCode} — ${product.name}${plan.location ? ` · local ${rows[0].code}` : ""}\nContábil: ${displayQty(sum("ledger"))} ${unit}. Físico esperado: ${displayQty(sum("physical"))} ${unit}.\nReservado: ${displayQty(sum("reserved"))} ${unit}. Aplicado sem baixa: ${displayQty(sum("applied"))} ${unit}.\nDisponível registrado: ${displayQty(sum("available"))} ${unit}.${rows.some((r) => !r.active) ? `\nDisponível em locais ativos: ${displayQty(usable)} ${unit}.` : ""}`;
    let analysis = "";
    if (plan.quantity) {
      if (plan.unit && plan.unit !== unit.toUpperCase())
        analysis = `Você informou ${plan.unit}, mas esta peça é controlada em ${unit}. Informe a quantidade em ${unit}; não fiz conversão entre unidades.`;
      else {
        const quantity = new Quantity(plan.quantity),
          active = rows.filter((r) => r.active),
          available = active.reduce(
            (n, r) => n.plus(Quantity.max(0, r.available)),
            new Quantity(0),
          );
        if (rows.some((r) => r.physical.lt(0) || r.available.lt(0)))
          analysis =
            "Há saldo negativo nos registros. Confira compromissos e faça uma contagem antes de planejar a retirada; não considerei essa situação como estoque confiável.";
        else if (available.lt(quantity))
          analysis = `Para retirar ${displayQty(quantity)} ${unit}, faltam ${displayQty(quantity.minus(available))} ${unit} no saldo disponível dos locais ativos consultados. Não use o contábil como se estivesse todo livre.`;
        else {
          const single = active.find((r) => r.available.gte(quantity));
          analysis = single
            ? `Pelos registros, ${single.code} tem saldo disponível para ${displayQty(quantity)} ${unit}.`
            : `Os locais ativos somam saldo suficiente para ${displayQty(quantity)} ${unit}, mas nenhum local sozinho cobre a quantidade. Confira as posições e requisite cada origem separadamente.`;
        }
        analysis +=
          " A retirada produtiva precisa de requisição e reserva na O.S./O.P.; registre a entrega na ordem. Esta consulta não reservou nem retirou material.";
      }
    } else if (sum("applied").gt(0) || sum("reserved").gt(0))
      analysis =
        "Parte do contábil está comprometida. A aplicação reduz o físico esperado e a reserva reduz o disponível; a baixa contábil ocorre no faturamento.";
    const positions = rows.length
      ? `\n\nLocais${rows.length > 5 ? " (cinco primeiros)" : ""}:\n${rows
          .slice(0, 5)
          .map(
            (r) =>
              `• ${r.code} — ${r.name}: ${displayQty(r.available)} ${unit} disponível${r.active ? "" : " (local ou hierarquia indisponível; não retire)"}`,
          )
          .join("\n")}`
      : "\nNenhuma posição de saldo cadastrada. O registro sem saldo não substitui conferência física.";
    const response = reply(
      `${totals}\n\n${analysis}${positions}`,
      [
        { label: "Abrir ficha do produto", href: `/produto/${product.id}` },
        ...guide.links,
      ],
      [
        `Posso retirar 5 do ${product.internalCode}?`,
        `Como aplicar ${product.internalCode} na O.S.?`,
      ],
      snapshot.at,
    );
    // Only a canonical product/quantity/local reference is remembered, never an old balance.
    const referenceQuestion = plan.quantity
      ? `Posso retirar ${plan.quantity.replace(".", ",")} ${plan.unit ?? unit} do ${product.internalCode}${plan.location ? ` no local ${rows[0].code}` : ""}?`
      : `Qual o saldo do ${product.internalCode}${plan.location ? ` no local ${rows[0].code}` : ""}?`;
    return { ...response, referenceQuestion };
  }
  if (["orders", "return", "inventory"].includes(plan.intent)) {
    const reference = orderReference(plan.referenceText);
    if (reference && plan.intent !== "inventory") {
      if (!can("orders:read"))
        return reply(
          "Seu perfil não permite consultar ordens. Peça ao administrador a permissão necessária. Não consultei dados de ordens.",
        );
      const result = await localOrderSnapshot(actor, reference, plan.orderKind);
      if (result.total !== 1)
        return reply(
          result.total
            ? `Há ${result.total} ordens correspondentes. Informe o código completo:\n${result.orders.map((o) => `• ${o.kind === "SERVICE" ? "O.S." : "O.P."} ${o.code}`).join("\n")}`
            : "Não encontrei essa ordem nesta unidade. Confira o código completo; nenhuma ordem de outra unidade foi consultada.",
          guide.links,
          result.orders
            .slice(0, 4)
            .map(
              (o) =>
                `A ${o.kind === "SERVICE" ? "O.S." : "O.P."} ${o.code} pode ser faturada?`,
            ),
          new Date().toISOString(),
        );
      const order = result.orders[0],
        checks = result.checks!;
      let answer = `${order.kind === "SERVICE" ? "O.S." : "O.P."} ${order.code}: `;
      if (order.status === "INVOICED")
        answer +=
          "o faturamento já foi registrado. Não faça outra baixa. Devoluções precisam de recebimento físico confirmado, com entrada vinculada à baixa original.";
      else if (order.status === "CANCELLED")
        answer +=
          "está cancelada; não é elegível para aplicação ou faturamento.";
      else if (
        checks.lines > 0 &&
        !checks.reserved &&
        !checks.unfulfilled &&
        !checks.returns &&
        checks.applied > 0
      )
        answer +=
          "não encontrei reservas, requisições sem atendimento nem devoluções pendentes. Há material aplicado. As quantidades consultadas estão conciliadas. Antes de confirmar, um usuário autorizado deve conferir o faturamento real e o documento na tela da ordem, que revalida saldos, cadastros ativos e permissões.";
      else
        answer += `ainda precisa de revisão antes do faturamento.\n• ${checks.reserved} linha(s) com reserva.\n• ${checks.unfulfilled} linha(s) com requisição ainda não atendida.\n• ${checks.returns} linha(s) com devolução pendente.\n${checks.applied ? "Há material aplicado aguardando baixa." : "Não há material aplicado para baixar."}\nAplique ou libere reservas, receba retornos reais e encerre saldos solicitados desnecessários com justificativa. Não registre uma devolução fictícia só para liberar a ordem.`;
      return reply(
        answer,
        [
          {
            label: "Abrir ordem",
            href: `/${order.kind === "SERVICE" ? "ordens-servico" : "ordens-producao"}?ordem=${order.id}`,
          },
        ],
        guide.suggestions,
        new Date().toISOString(),
      );
    }
    const type =
      plan.intent === "return"
        ? "RETURN"
        : plan.intent === "inventory"
          ? /\b(vencida|vencidas|periodica|periodicas|programada|programadas|agenda|conferencias)\b/.test(
              plan.normalized,
            )
            ? "SCHEDULE"
            : "COUNT"
          : "ALL";
    if (!(can("orders:read") || can("inventory:count")))
      return reply(
        "Seu perfil não permite consultar essas pendências. Posso explicar o procedimento, mas os registros precisam ser vistos por uma pessoa autorizada.\n\n" +
          guide.answer,
      );
    if (plan.intent === "inventory" && !can("inventory:count"))
      return reply(
        "Seu perfil não permite consultar conferências. Peça acesso ao responsável; não consultei os inventários.",
      );
    if (plan.intent === "return" && !can("orders:read"))
      return reply(
        "Seu perfil não permite consultar devoluções de ordens. Peça acesso ao responsável; não consultei essas ordens.",
      );
    const pending = await listOperationalPending(actor, { type, pageSize: 5 });
    const labels = {
      UNAPPLIED: "requisições a aplicar",
      RESERVED: "reservas a entregar",
      AWAITING_INVOICE: "aplicações a faturar",
      RETURN: "devoluções a receber",
      COUNT: "contagens a aprovar",
      SCHEDULE: "conferências vencidas",
    };
    const allowedTypes = (
      Object.keys(labels) as Array<keyof typeof labels>
    ).filter((t) =>
      type === "ALL"
        ? t === "COUNT" || t === "SCHEDULE"
          ? can("inventory:count")
          : can("orders:read")
        : t === type,
    );
    const summary = allowedTypes
      .map((t) => `• ${pending.totals[t]} ${labels[t]}`)
      .join("\n");
    return reply(
      `Na unidade atual, nas áreas permitidas ao seu perfil:\n${summary}\n${pending.total ? `\nPriorize a conferência destas pendências (até cinco):\n${pending.items.map((i) => `• ${i.orderKind === "SERVICE" ? "O.S. " : i.orderKind === "PRODUCTION" ? "O.P. " : ""}${i.code}${i.productCode ? ` · ${i.productCode}` : ""}: ${labels[i.type]}${i.quantity && i.unit ? ` — ${displayQty(i.quantity)} ${i.unit}` : ""}`).join("\n")}` : "\nNão há pendências nesta etapa autorizada. Isso não prova que o estoque físico foi contado."}\n\nOs números contam registros, não somam peças de unidades diferentes. A mesma linha pode aparecer em mais de uma etapa.`,
      guide.links,
      guide.suggestions,
      pending.serverTime,
    );
  }
  if (plan.intent === "replenishment") {
    if (!can("purchases:read"))
      return reply(
        "Seu perfil não permite consultar a reposição ligada a compras. Peça acesso ao responsável.\n\n" +
          guide.answer,
      );
    const rows = await listReplenishment(actor);
    return reply(
      rows.length
        ? `Há ${rows.length} materiais que precisam de atenção ao mínimo/disponível. Até cinco:\n${rows
            .slice(0, 5)
            .map(
              (p) =>
                `• ${p.code}: ${displayQty(p.available)} ${p.unit} disponível; mínimo ${displayQty(p.minimum)}; compra aberta ${displayQty(p.incoming)}; sugestão ${displayQty(p.suggested)} ${p.unit}.`,
            )
            .join(
              "\n",
            )}\n\nA sugestão já desconta compras abertas. Revise fornecedor e necessidade antes de salvar um pedido; nada foi comprado pelo chat.`
        : "Nenhum material ativo ficou abaixo do mínimo ou sem disponível neste planejamento. Ainda é necessário conferir o físico; não considerei itens não cadastrados.",
      guide.links,
      guide.suggestions,
      new Date().toISOString(),
    );
  }
  if (plan.intent === "purchase") {
    if (!can("purchases:read"))
      return reply(
        "Seu perfil não permite consultar compras. Peça acesso ao responsável; não consultei os pedidos.",
      );
    const total = await prisma.purchaseOrder.count({
      where: { unitId: actor.unitId, status: "OPEN" },
    });
    return reply(
      `Há ${total} compra(s) em aberto na unidade atual. Um pedido aberto não comprova a entrega nem a data de chegada. Confira os itens e o documento antes de registrar recebimento.`,
      guide.links,
      guide.suggestions,
      new Date().toISOString(),
    );
  }
  if (plan.intent === "cost") {
    if (!can("costs:read"))
      return reply(
        "Seu perfil não permite consultar valores financeiros. Não consultei custos; peça ao responsável a permissão necessária.",
      );
    const reference = orderReference(plan.referenceText);
    if (!reference)
      return reply(
        "Qual é o código da O.S. ou O.P.? Informe a ordem para conferir a estimativa de materiais. Não somo custos de ordens diferentes sem um critério.",
        guide.links,
        ["Qual o custo da O.S. 42?"],
      );
    const orders = await prisma.workOrder.findMany({
      where: {
        unitId: actor.unitId,
        ...(plan.orderKind ? { kind: plan.orderKind } : {}),
        code: { contains: reference, mode: Prisma.QueryMode.insensitive },
      },
      select: costOrderSelect,
      orderBy: { code: "asc" },
      take: 2,
    });
    if (orders.length !== 1)
      return reply(
        orders.length
          ? "Mais de uma ordem corresponde a esse trecho. Informe o código completo para evitar misturar valores."
          : "Não encontrei essa ordem na unidade atual. Confira o código.",
        guide.links,
      );
    const cost = summarizeOrderCost(orders[0]),
      money = (v: string) => {
        const [whole, fraction] = v.split(".");
        return `R$ ${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${fraction}`;
      };
    return reply(
      cost.completeness === "AWAITING_INVOICE"
        ? `${cost.code} ainda não possui consumo faturado consolidado. O custo histórico é capturado no faturamento.`
        : cost.netMaterialCost === null
          ? `${cost.code} tem ${cost.missingCostCount} material(is) sem custo histórico. O total está incompleto; subtotal com preço conhecido: ${money(cost.knownSubtotal)}. Não substituí custo ausente por zero ou pelo preço atual.`
          : `${cost.code}: estimativa líquida de materiais ${money(cost.netMaterialCost)}, após devoluções pelo custo histórico. Não é custo total de produção: mão de obra, frete, impostos e rateios não estão incluídos.`,
      guide.links,
      guide.suggestions,
      new Date().toISOString(),
    );
  }
  return reply(guide.answer, guide.links, guide.suggestions);
}
