import type { PendingItem, PendingType } from "@/services/operational-pending";
export const ALERT_LABELS: Record<PendingType, string> = {
  UNAPPLIED: "Aplicação a regularizar",
  RESERVED: "Reserva a entregar",
  AWAITING_INVOICE: "Aplicação aguardando faturamento",
  RETURN: "Devolução a receber",
  COUNT: "Contagem aguardando aprovação",
  SCHEDULE: "Conferência vencida",
};
export const ALERT_HISTORY_LABELS = {
  PENDING: "Ainda pendente",
  UPDATED: "Aviso atualizado",
  REGULARIZED: "Regularizado na origem",
  CLOSED: "Encerrado na origem",
  UNAVAILABLE: "Origem indisponível",
} as const;
export type AlertHistoryStatus = keyof typeof ALERT_HISTORY_LABELS;
export type AlertSnapshot = Pick<
  PendingItem,
  | "id"
  | "type"
  | "occurrenceKey"
  | "orderId"
  | "orderKind"
  | "code"
  | "title"
  | "productCode"
  | "productName"
  | "locationCode"
  | "quantity"
  | "unit"
  | "assigneeId"
  | "assigneeName"
  | "dueAt"
>;
