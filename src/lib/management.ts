import { canViewInventory, canViewReports } from "@/lib/access-profiles";

export const canViewManagement = (p: readonly string[]) =>
  canViewReports(p) && (p.includes("orders:read") || canViewInventory(p));
export const canRecordManagement = (p: readonly string[]) =>
  canViewManagement(p) &&
  (p.includes("reports:read") || p.includes("reconciliation:write"));
export interface QueueAge {
  count: number;
  dated: number;
  undated: number;
  oldestAt: string | null;
}
export const MANAGEMENT_METRICS = [
  {
    key: "UNAPPLIED",
    area: "orders",
    label: "Aplicação a regularizar",
    source: "PENDING",
  },
  {
    key: "RESERVED",
    area: "orders",
    label: "Reservas a entregar",
    source: "PENDING",
  },
  {
    key: "AWAITING_INVOICE",
    area: "orders",
    label: "Aplicações sem baixa no faturamento",
    source: "PENDING",
  },
  {
    key: "RETURN",
    area: "orders",
    label: "Devoluções a receber",
    source: "PENDING",
  },
  {
    key: "COUNT",
    area: "inventory",
    label: "Contagens aguardando aprovação",
    source: "PENDING",
  },
  {
    key: "SCHEDULE",
    area: "inventory",
    label: "Conferências vencidas",
    source: "PENDING",
  },
  {
    key: "RECEIPT_PENDING",
    area: "orders",
    label: "Entregas sem confirmação",
    source: "RECEIPT",
  },
  {
    key: "RECEIPT_DISPUTED",
    area: "orders",
    label: "Divergências aguardando tratamento",
    source: "RECEIPT",
  },
  {
    key: "RECEIPT_PROPOSED",
    area: "orders",
    label: "Tratamentos aguardando aceite",
    source: "RECEIPT",
  },
  {
    key: "RECEIPT_UNLINKED",
    area: "orders",
    label: "Entregas sem conta vinculada",
    source: "RECEIPT",
  },
] as const;
export type ManagementMetric = (typeof MANAGEMENT_METRICS)[number]["key"];
export type ManagementMetrics = Record<ManagementMetric, QueueAge | null>;
export type ManagementAreas = { orders: boolean; inventory: boolean };
export function waitingTime(since: string | null, now: string) {
  if (!since) return "Data de abertura indisponível";
  const minutes = Math.floor((Date.parse(now) - Date.parse(since)) / 60000);
  if (!Number.isFinite(minutes) || minutes < 0)
    return "Data de abertura indisponível";
  if (minutes < 1) return "Menos de 1 min";
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)} h`;
  return `${Math.floor(minutes / 1440)} d`;
}
