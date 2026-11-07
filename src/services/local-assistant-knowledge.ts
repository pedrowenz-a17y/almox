import type { AssistantLink } from "@/lib/assistant-contract";
import type { LocalIntent } from "@/lib/local-assistant-language";

export const localHelp =
  "Posso ajudar com estoque, localização de materiais, retiradas por O.S./O.P., devoluções, reposição e inventário. Escreva do seu jeito: “onde fica o rolamento?”, “posso tirar 5 do ROL-6204?” ou “por que o estoque não bate?”. Para consultar registros atuais, marque Consultar dados da unidade. Não registro operações pelo chat.";
export const knowledge: Record<
  Exclude<LocalIntent, "unknown" | "help">,
  { answer: string; links: AssistantLink[]; suggestions: string[] }
> = {
  stock: {
    answer:
      "O saldo contábil é o registrado no sistema. O físico esperado é o contábil menos o material aplicado em ordens abertas. O disponível desconta também as reservas. Para localizar uma peça, informe o código ou o nome e marque Consultar dados da unidade. O saldo registrado não comprova uma contagem física.",
    links: [
      { label: "Consultar produtos", href: "/consulta" },
      { label: "Ver estoque", href: "/estoque" },
    ],
    suggestions: [
      "Onde fica o rolamento?",
      "Qual a diferença entre físico e disponível?",
    ],
  },
  withdraw: {
    answer:
      "Para retirar material produtivo, abra uma O.S. ou O.P., requisite produto/local/quantidade e reserve o saldo disponível. Na retirada física, use Entregar e aplicar e identifique quem retirou; o usuário conectado fica como entregador. A baixa contábil acontece somente no faturamento da ordem. Não faça outra saída avulsa para o mesmo material. Exceções não produtivas exigem finalidade e justificativa.",
    links: [
      { label: "Ordens de serviço", href: "/ordens-servico" },
      { label: "Ordens de produção", href: "/ordens-producao" },
    ],
    suggestions: [
      "Posso retirar material sem O.S.?",
      "Como devolver uma sobra?",
    ],
  },
  return: {
    answer:
      "Abra a ordem e use Solicitar devolução para deixar o retorno pendente. Isso não libera saldo. Quem receber fisicamente o material deve usar Receber devolução, informando quantidade, motivo e identificação de quem devolveu. Antes do faturamento, o retorno desfaz a aplicação; depois, gera entrada vinculada à baixa original. Um pedido incorreto pode ser cancelado com justificativa, sem registrar entrada. Se a sobra não será mais usada, encerre o saldo solicitado ainda sem compromisso antes de faturar.",
    links: [
      { label: "Ver pendências", href: "/pendencias" },
      { label: "Ordens de serviço", href: "/ordens-servico" },
      { label: "Ordens de produção", href: "/ordens-producao" },
    ],
    suggestions: [
      "Quais devoluções estão pendentes?",
      "A ordem já foi faturada. Como devolvo?",
    ],
  },
  orders: {
    answer:
      "A O.S. acompanha materiais de um serviço; a O.P., de uma produção. A ordem só pode ser faturada após atender integralmente as requisições, sem reservas ou devoluções pendentes e com material aplicado para baixar. Libere reservas sem uso, receba devoluções reais e encerre saldos solicitados desnecessários com justificativa. Confirme o documento de faturamento na tela da ordem; o chat não fatura nem emite nota fiscal.",
    links: [
      { label: "Ver pendências", href: "/pendencias" },
      { label: "Ordens de serviço", href: "/ordens-servico" },
      { label: "Ordens de produção", href: "/ordens-producao" },
    ],
    suggestions: [
      "Quais pendências preciso resolver?",
      "A O.S. 42 pode ser faturada?",
    ],
  },
  inventory: {
    answer:
      "Se o físico não bate com o contábil, primeiro confira aplicações em ordens ainda não faturadas: elas já saíram fisicamente, mas ainda não tiveram baixa contábil. Depois confira reservas, devoluções e movimentações. Faça uma contagem real no Inventário. Um supervisor revisa a proposta e aprova ajustes; se o saldo mudou após a contagem, encerre a proposta obsoleta e reconte. Programe conferências por local para repetir a rotina. Divergência sozinha não prova perda ou culpa de alguém.",
    links: [
      { label: "Abrir inventário", href: "/inventario" },
      { label: "Conferências periódicas", href: "/conferencias" },
      { label: "Ver pendências", href: "/pendencias" },
    ],
    suggestions: [
      "Quais conferências estão vencidas?",
      "Qual a diferença entre físico e disponível?",
    ],
  },
  replenishment: {
    answer:
      "Abra Reposição para comparar disponível e estoque mínimo. A sugestão considera a meta de estoque e desconta compras abertas, para evitar pedir a mesma quantidade duas vezes. Revise quantidades e fornecedor antes de salvar uma compra. Isso é planejamento; o chat não compra nem aprova pedidos.",
    links: [
      { label: "Abrir reposição", href: "/reposicao" },
      { label: "Compras e recebimentos", href: "/compras" },
    ],
    suggestions: ["O que está abaixo do mínimo?", "Tenho compras em aberto?"],
  },
  purchase: {
    answer:
      "Abra uma compra com fornecedor, materiais e quantidades. Quando a mercadoria chegar, confira os itens e registre o recebimento parcial ou total com o documento e a localização. A entrada fica vinculada ao recebimento. Depois, a aplicação produtiva segue pela O.S./O.P.; sua baixa contábil ocorre no faturamento da ordem, sem saída duplicada.",
    links: [{ label: "Compras e recebimentos", href: "/compras" }],
    suggestions: [
      "Tenho compras em aberto?",
      "Como aplicar depois do recebimento?",
    ],
  },
  cost: {
    answer:
      "Custos e conciliação mostra uma estimativa dos materiais por ordem: o custo cadastral capturado no faturamento, menos devoluções pelo mesmo preço histórico. Não inclui mão de obra, frete ou rateios. Custo ausente deixa o total incompleto; não vira zero. A conciliação por CSV compara dados para revisão e não ajusta o ERP oficial. Valores exigem a permissão de custos.",
    links: [{ label: "Custos e conciliação", href: "/conciliacao" }],
    suggestions: [
      "Qual o custo da O.S. 42?",
      "Como conferir diferenças com o ERP?",
    ],
  },
  qr: {
    answer:
      "Cada produto cadastrado tem um QR Code na sua ficha. Imprima a etiqueta e escaneie em Consulta rápida ou na operação. A etiqueta de produto abre a peça; a de localização identifica a posição do estoque. Escanear não faz baixa sozinho: confirme a operação na tela apropriada, vinculando retiradas produtivas à ordem.",
    links: [
      { label: "Consultar produto", href: "/consulta" },
      { label: "Etiquetas de localização", href: "/qrcodes" },
    ],
    suggestions: ["Onde fica o rolamento?", "Como retirar usando O.S.?"],
  },
  access: {
    answer:
      "O acesso exige uma conta autorizada e um vínculo ativo com a unidade. Não há senha padrão. Use Esqueci minha senha no login para recuperar o acesso e peça ao administrador a liberação da unidade/permissão necessária. Não envie senha, chave de API ou arquivo .env na conversa.",
    links: [],
    suggestions: ["Como usar o estoque?", "O que você consegue fazer?"],
  },
  technical: {
    answer:
      "Para erros de banco ou configuração, rode npm run doctor na pasta do projeto. Ele separa formato, DNS, porta, conexão e estrutura, sem alterar dados. Se a porta3000 já estiver em uso, encerre o servidor anterior com Ctrl+C antes de iniciar outro. Neste modo local, o assistente não usa créditos nem chama a OpenAI; login e consultas aos registros ainda dependem do servidor e do banco do ERP. Nunca envie o .env ou chaves pelo chat.",
    links: [],
    suggestions: ["O que você consegue fazer?", "Por que o estoque não bate?"],
  },
};
