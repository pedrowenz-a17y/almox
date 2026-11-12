export interface Role {
  id: string;
  name: string;
  permissions?: { permission: { key: string } }[];
}
export interface UnitMembership {
  unitId: string;
  unitName: string;
  organizationId: string;
  organizationName: string;
  roleId: string;
  roleName: string;
}
export interface SessionUser {
  id: string;
  authUserId: string;
  unitId: string;
  organizationId: string;
  memberships: UnitMembership[];
  roleId: string;
  active: boolean;
  name: string;
  email: string;
  permissions: string[];
  role?: Role;
}
export interface Category {
  id: string;
  name: string;
  description?: string;
}
export interface Supplier {
  id: string;
  legalName: string;
  tradeName?: string;
  taxId?: string;
  phone?: string;
  whatsapp?: string;
  email?: string;
  address?: string;
  contact?: string;
  notes?: string;
  active?: boolean;
}
export interface Warehouse {
  id: string;
  name: string;
  code: string;
  description?: string;
  active?: boolean;
}
export interface Location {
  id: string;
  code: string;
  name: string;
  description?: string;
  parentId?: string | null;
  warehouseId: string;
  active: boolean;
  notes?: string;
  parent?: Location;
  warehouse?: Warehouse;
}
export interface Product {
  id: string;
  internalCode: string;
  sku?: string;
  name: string;
  description?: string;
  categoryId?: string;
  category?: Category;
  unit: string;
  manufacturer?: string;
  supplierId?: string;
  supplier?: Supplier;
  barcode?: string;
  minStock: string | number;
  maxStock?: string | number;
  unitCost?: string | number | null;
  imageUrl?: string;
  active: boolean;
  notes?: string;
  createdAt: string;
}
export interface Balance {
  id: string;
  bookQuantity?: string | number;
  physicalQuantity?: string | number;
  reservedQuantity?: string | number;
  appliedQuantity?: string | number;
  availableQuantity?: string | number;
  productId: string;
  locationId: string;
  quantity: string | number;
  product?: Product;
  location?: Location;
}
export interface Movement {
  id: string;
  type: string;
  productId: string;
  product?: Product;
  quantity: string | number;
  sourceId?: string;
  destinationId?: string;
  source?: Location;
  destination?: Location;
  user?: { name: string };
  userId?: string;
  createdAt: string;
  note?: string;
  reference?: string;
  sourceBefore?: string;
  sourceAfter?: string;
  destinationBefore?: string;
  destinationAfter?: string;
}
export interface CountItem {
  id: string;
  productId: string;
  product?: Product;
  expectedQuantity: string | number;
  countedQuantity: string | number;
}
export interface InventoryCount {
  id: string;
  userId: string;
  locationId: string;
  location?: Location;
  status: string;
  user?: { name: string };
  createdBy?: { name: string };
  createdAt: string;
  note?: string;
  items: CountItem[];
}
export interface Audit {
  id: string;
  action: string;
  user?: { name: string };
  entity?: string;
  entityId?: string;
  createdAt: string;
  before?: unknown;
  after?: unknown;
}
export interface ManagedUser {
  id: string;
  authUserId?: string | null;
  identityActive?: boolean;
  name: string;
  email: string;
  roleId?: string;
  role?: Role;
  active?: boolean;
}
export interface DashboardData {
  totalProducts: number;
  totalItems: string;
  totalPhysical?: string;
  totalReserved?: string;
  totalApplied?: string;
  totalAvailable?: string;
  lowStock: number;
  outOfStock: number;
  today: Record<string, number>;
  dailyActivity: {
    date: string;
    type: string;
    operations: number;
    quantity: string;
  }[];
  topProducts: {
    productId: string;
    name: string;
    internalCode: string;
    operations: number;
    quantity: string;
  }[];
  timezone: string;
}
export interface DataSet {
  user?: SessionUser;
  unitId?: string;
  organizationId?: string;
  dashboard?: DashboardData;
  limits?: { movements: number; counts: number; audit: number };
  products: Product[];
  categories: Category[];
  suppliers: Supplier[];
  warehouses: Warehouse[];
  locations: Location[];
  balances: Balance[];
  movements: Movement[];
  counts: InventoryCount[];
  settings: { companyName?: string; allowNegativeStock?: boolean };
  users?: ManagedUser[];
  audit?: Audit[];
  permissions?: string[];
  roles?: Role[];
}
export class ApiError extends Error {
  constructor(message: string, public status: number, public code?: string, public retryAfter?: number) {
    super(message);
    this.name = "ApiError";
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  let response: Response;
  try {
    response = await fetch(path, { ...init, headers, credentials: "same-origin", cache: "no-store" });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw error;
    const offline = typeof navigator !== "undefined" && !navigator.onLine;
    throw new ApiError(offline
      ? "Sem conexão. Não é possível registrar operações no momento."
      : "Não foi possível acessar o servidor. Verifique a conexão e tente novamente.", 0, offline ? "OFFLINE" : "NETWORK_ERROR");
  }
  let result: { data?: T; error?: string; code?: string; retryAfter?: unknown };
  try {
    result = await response.json();
    if (!result || typeof result !== "object") throw new Error("Invalid response");
  } catch {
    throw new ApiError("O servidor retornou uma resposta inválida. Atualize a página; se continuar, informe o responsável pelo sistema.", response.ok ? 502 : response.status, "INVALID_RESPONSE");
  }
  if (!response.ok) {
    if (response.status === 401 && !path.startsWith("/api/auth/") && typeof window !== "undefined") {
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- Discard authenticated in-memory state when the verified server session expires.
      window.location.assign(`/login?reason=expired&next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
    }
    const rawRetry = typeof result.retryAfter === "number" ? result.retryAfter : Number(response.headers.get("retry-after"));
    const retryAfter = response.status === 429 && Number.isFinite(rawRetry) && rawRetry > 0
      ? Math.min(3600, Math.ceil(rawRetry)) : undefined;
    throw new ApiError(result.error || (response.status >= 500
      ? "Serviço temporariamente indisponível. Tente novamente em instantes."
      : "Não foi possível concluir a operação."), response.status, result.code, retryAfter);
  }
  if (!("data" in result)) {
    throw new ApiError("A resposta do servidor está incompleta. Nenhuma operação deve ser considerada confirmada.", 502, "INVALID_RESPONSE");
  }
  return result.data as T;
}
export const number = (value: string | number | undefined) =>
  Number(value || 0);
export const qty = (value: string | number | undefined) =>
  number(value).toLocaleString("pt-BR", { maximumFractionDigits: 3 });
export const money = (value: string | number | undefined) =>
  number(value).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
export const dateTime = (value: string) =>
  new Date(value).toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    dateStyle: "short",
    timeStyle: "short",
  });
export const date = (value: string) =>
  new Date(value).toLocaleDateString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "short",
  });
// Datasets are immutable snapshots. Build the index once per snapshot, not once per row/render.
const stockIndexes = new WeakMap<DataSet, Map<string, { total: number; available: number; physical: number }>>();
function stockIndex(data: DataSet) {
  let index = stockIndexes.get(data);
  if (!index) {
    index = new Map();
    for (const b of data.balances) {
      const current = index.get(b.productId) ?? { total: 0, available: 0, physical: 0 };
      current.total += number(b.quantity);
      current.available += number(b.availableQuantity ?? b.quantity);
      current.physical += number(b.physicalQuantity ?? b.quantity);
      index.set(b.productId, current);
    }
    stockIndexes.set(data, index);
  }
  return index;
}
export const totalFor = (data: DataSet, productId: string) => stockIndex(data).get(productId)?.total ?? 0;
export const availableFor = (data: DataSet, productId: string) => stockIndex(data).get(productId)?.available ?? 0;
export const physicalFor = (data: DataSet, productId: string) => stockIndex(data).get(productId)?.physical ?? 0;
export function locationPath(
  data: Pick<DataSet, "locations">,
  id: string,
): string {
  const parts: string[] = [];
  const seen = new Set<string>();
  let current = data.locations.find((l) => l.id === id);
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    parts.unshift(current.name);
    current = data.locations.find((l) => l.id === current?.parentId);
  }
  return parts.join(" / ");
}
export const movementLabels: Record<string, string> = {
  ENTRY: "Entrada",
  EXIT: "Saída",
  TRANSFER: "Transferência",
  ADJUSTMENT: "Ajuste",
};
export function stockState(product: Product, balance: number) {
  if (balance <= 0) return { label: "Sem estoque", className: "danger" };
  if (balance < number(product.minStock) * 0.5)
    return { label: "Crítico", className: "danger" };
  if (balance < number(product.minStock))
    return { label: "Baixo", className: "warning" };
  return { label: "Normal", className: "success" };
}
