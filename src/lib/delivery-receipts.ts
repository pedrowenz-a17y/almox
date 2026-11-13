export const RECEIPT_LABELS = {
  PENDING: "Aguardando confirmação",
  CONFIRMED: "Recebimento confirmado",
  DISPUTED: "Divergência informada",
  PROPOSED: "Tratamento aguardando aceite",
  RESOLVED: "Tratamento aceito",
  UNLINKED: "Sem conta vinculada",
} as const;
export type ReceiptStatus = keyof typeof RECEIPT_LABELS;
/** A first-person confirmation must display the exact recorded decimal. */
export function receiptQuantity(value: string) {
  const match = /^(\d{1,15})(?:\.(\d{1,3}))?$/.exec(value);
  if (!match) return "—";
  const fraction = (match[2] ?? "").replace(/0+$/, "");
  return (
    BigInt(match[1]).toLocaleString("pt-BR") + (fraction ? `,${fraction}` : "")
  );
}
export const RECEIPT_EVENT_TYPES = [
  "DELIVERY_CONFIRMED",
  "DELIVERY_DISPUTED",
  "DELIVERY_TREATMENT_PROPOSED",
  "DELIVERY_TREATMENT_ACCEPTED",
  "DELIVERY_TREATMENT_REJECTED",
] as const;
export interface DeliveryReceipt {
  id: string;
  orderId: string;
  orderKind: "SERVICE" | "PRODUCTION";
  orderCode: string;
  orderTitle: string;
  orderStatus: string;
  materialId: string;
  productCode: string;
  productName: string;
  unit: string;
  locationCode: string;
  expectedQuantity: string;
  deliveredAt: string;
  deliveredById: string;
  deliveredByName: string;
  recipientId: string | null;
  recipientName: string | null;
  recipientActive: boolean;
  status: ReceiptStatus;
  version: number;
  receivedQuantity: string | null;
  materialMatches: boolean | null;
  note: string | null;
  reference: string | null;
  respondedAt: string | null;
  canRespond: boolean;
  canTreat: boolean;
}
export interface ReceiptHistory {
  id: string;
  type: string;
  createdAt: string;
  user: { id: string; name: string };
  note: string;
  reference: string;
  receivedQuantity: string | null;
  materialMatches: boolean | null;
}
