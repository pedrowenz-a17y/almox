export const VALIDATION_STEPS = [
  {
    id: "ORDER",
    title: "Identificar a ordem",
    role: "Responsável pela O.S./O.P.",
    check:
      "Criar a ordem e requisitar o material, com produto, local e quantidade identificados.",
    evidence: "Código da O.S./O.P. e item requisitado.",
  },
  {
    id: "RESERVE",
    title: "Reservar o material",
    role: "Almoxarife",
    check:
      "Reservar a quantidade e conferir a disponibilidade. A reserva não deve baixar o saldo contábil.",
    evidence: "Ordem, reserva e saldo antes/depois.",
  },
  {
    id: "DELIVERY",
    title: "Entregar e aplicar",
    role: "Almoxarife e pessoa que retira",
    check:
      "Aplicar na ordem e registrar quem entregou e quem recebeu. O físico diminui; a baixa contábil aguarda o faturamento.",
    evidence: "Evento de aplicação, identificação do recebedor e quantidades.",
  },
  {
    id: "INVOICE",
    title: "Confirmar o faturamento",
    role: "Pessoa autorizada a faturar",
    check:
      "Confirmar a referência de faturamento e verificar uma única baixa. Repetir a mesma operação não pode duplicá-la.",
    evidence: "Referência de faturamento e movimentação vinculada.",
  },
  {
    id: "RETURN",
    title: "Regularizar uma devolução",
    role: "Almoxarife",
    check:
      "Solicitar e receber uma sobra do cenário de teste. Conferir a pendência e a compensação da baixa, sem devolver além do consumo.",
    evidence:
      "Solicitação, recebimento da devolução e movimentação correspondente.",
  },
  {
    id: "COUNT",
    title: "Conferir o estoque",
    role: "Conferente e revisor independente",
    check:
      "Contar o material e pedir aprovação a outra pessoa autorizada. Conferir a diferença registrada e o saldo resultante.",
    evidence: "Número da contagem, autor, aprovador e resultado.",
  },
  {
    id: "RECONCILE",
    title: "Comparar com o ERP",
    role: "Analista de custos ou responsável autorizado",
    check:
      "Importar a exportação, conferir o corte, analisar as diferenças e registrar a revisão por outra pessoa.",
    evidence: "Documento da conciliação e parecer do revisor.",
  },
] as const;
export type ValidationStepId = (typeof VALIDATION_STEPS)[number]["id"];
export const VALIDATION_ORIGINS = {
  DEMONSTRATION: "Demonstração",
  COMPANY_PILOT: "Piloto com a empresa",
} as const;
export const VALIDATION_STATUS = {
  OPEN: "Em andamento",
  REPORTED_PASS: "Concluído com etapas aprovadas",
  ISSUES: "Concluído com falhas relatadas",
} as const;
export type ValidationState = {
  id: string;
  title: string;
  origin: keyof typeof VALIDATION_ORIGINS;
  objective: string;
  createdAt: string;
  createdById: string;
  createdByName: string;
  version: number;
  status: keyof typeof VALIDATION_STATUS;
  closedAt: string | null;
  closedByName: string | null;
  conclusion: string | null;
  canRecord: boolean;
  canClose: boolean;
  steps: Array<{
    id: ValidationStepId;
    outcome: "PASS" | "FAIL";
    note: string;
    reference: string;
    recordedByName: string;
    recordedAt: string;
  }>;
};
