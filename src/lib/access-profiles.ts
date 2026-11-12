/** Positive permissions shared by the server and presentation. Existing keys retain their meaning. */
export const LEGACY_PERMISSION_KEYS = [
  "catalog:write", "stock:move", "inventory:count", "inventory:adjust",
  "reports:read", "costs:read", "users:manage", "settings:manage", "records:delete",
  "orders:read", "orders:write", "orders:apply", "orders:invoice",
  "purchases:read", "purchases:write", "purchases:receive",
] as const;
export const SPECIALIZED_PERMISSION_KEYS = [
  "stock:entry", "stock:exit", "stock:transfer", "suppliers:write",
  "orders:reserve", "orders:deliver", "orders:return", "purchases:prices",
  "inventory:read", "reports:view", "reconciliation:write",
] as const;
export const ALL_PERMISSION_KEYS = [...LEGACY_PERMISSION_KEYS, ...SPECIALIZED_PERMISSION_KEYS];
type Permissions = readonly string[];
export const canViewReports = (p: Permissions) => p.includes("reports:read") || p.includes("reports:view");
export const canSaveReconciliation = (p: Permissions) => p.includes("reports:read") || p.includes("reconciliation:write");
export const canViewInventory = (p: Permissions) => p.includes("inventory:count") || p.includes("inventory:read");
export const canViewPurchasePrices = (p: Permissions) => p.includes("costs:read") || p.includes("purchases:prices");
export function canWriteCatalog(p: Permissions, entity: string) {
  if (entity === "users") return p.includes("users:manage");
  if (!["products", "categories", "suppliers", "warehouses", "locations"].includes(entity)) return false;
  return p.includes("catalog:write") || (entity === "suppliers" && p.includes("suppliers:write"));
}
export function canMoveStock(p: Permissions, type: string) {
  if (type === "ENTRY") return p.includes("stock:move") || p.includes("stock:entry");
  if (type === "EXIT") return p.includes("stock:move") || p.includes("stock:exit");
  if (type === "TRANSFER") return p.includes("stock:move") || p.includes("stock:transfer");
  return false;
}
export const canMoveAnyStock = (p: Permissions) => ["ENTRY", "EXIT", "TRANSFER"].some(type => canMoveStock(p, type));
export function canActOnOrder(p: Permissions, action: string) {
  switch (action) {
    case "INVOICE": return p.includes("orders:invoice");
    case "REQUEST": case "REDUCE_REQUEST": case "CANCEL": return p.includes("orders:write");
    case "RESERVE": case "RELEASE": return p.includes("orders:write") || p.includes("orders:reserve");
    case "APPLY": return p.includes("orders:apply") || p.includes("orders:deliver");
    case "RETURN": case "REQUEST_RETURN": case "CANCEL_RETURN": return p.includes("orders:apply") || p.includes("orders:return");
    default: return false;
  }
}

export const ACCESS_PROFILES = [
  { name: "ALMOXARIFE", title: "Almoxarife", description: "Recebe, transfere e entrega materiais; reserva e aplica nas ordens, registra devoluções e faz contagens. Sem aprovar ajustes, faturar ordens ou consultar custos.", permissions: ["stock:entry", "stock:exit", "stock:transfer", "orders:read", "orders:reserve", "orders:deliver", "orders:return", "inventory:count", "purchases:read", "purchases:receive"] },
  { name: "CONFERENTE", title: "Conferente de estoque", description: "Consulta o estoque e registra contagens para revisão independente. Sem movimentar materiais, aprovar ajustes ou consultar custos.", permissions: ["inventory:count"] },
  { name: "COMPRADOR", title: "Comprador", description: "Cadastra e edita fornecedores, prepara compras e consulta seus preços. Sem receber fisicamente, movimentar estoque ou consultar custos de produção.", permissions: ["suppliers:write", "purchases:read", "purchases:write", "purchases:prices"] },
  { name: "ANALISTA_CUSTOS", title: "Analista de custos", description: "Consulta custos, ordens, compras, inventários e relatórios; salva documentos de conciliação. Sem ajustar estoque, faturar ordens ou gerenciar usuários.", permissions: ["reports:view", "costs:read", "orders:read", "purchases:read", "inventory:read", "reconciliation:write"] },
  { name: "AUDITOR", title: "Auditor", description: "Consulta relatórios, histórico, inventários, ordens e compras. Sem valores financeiros e sem alterar cadastros, estoque, ordens ou documentos de conciliação.", permissions: ["reports:view", "inventory:read", "orders:read", "purchases:read"] },
] as const;

export const PERMISSION_LABELS: Record<string, string> = {
  "catalog:write": "Cadastrar e editar catálogo", "stock:move": "Entradas, saídas e transferências",
  "inventory:count": "Registrar contagens", "inventory:adjust": "Aprovar ajustes e gerenciar conferências",
  "reports:read": "Relatórios e registro de conciliações", "costs:read": "Consultar custos e valores financeiros",
  "users:manage": "Gerenciar acessos da unidade", "settings:manage": "Alterar configurações", "records:delete": "Arquivar cadastros",
  "orders:read": "Consultar ordens", "orders:write": "Criar ordens, requisições e reservas", "orders:apply": "Entregar e devolver materiais nas ordens", "orders:invoice": "Confirmar faturamento de ordens",
  "purchases:read": "Consultar compras", "purchases:write": "Criar e cancelar compras", "purchases:receive": "Registrar recebimentos de compras",
  "stock:entry": "Registrar entradas", "stock:exit": "Registrar saídas não produtivas justificadas", "stock:transfer": "Transferir materiais",
  "suppliers:write": "Cadastrar e editar fornecedores", "orders:reserve": "Reservar e liberar materiais", "orders:deliver": "Entregar e aplicar materiais",
  "orders:return": "Solicitar e receber devoluções", "purchases:prices": "Consultar e informar preços das compras", "inventory:read": "Consultar inventários e conferências",
  "reports:view": "Consultar relatórios e histórico", "reconciliation:write": "Salvar documentos de conciliação",
};
const legacyTitles = new Map([["ADMINISTRADOR", "Administrador"], ["SUPERVISOR", "Supervisor"], ["OPERADOR", "Operador"]]);
export const profileTitle = (name: string) => ACCESS_PROFILES.find(p => p.name === name)?.title ?? legacyTitles.get(name) ?? name;
export const permissionLabel = (key: string) => Object.hasOwn(PERMISSION_LABELS, key) ? PERMISSION_LABELS[key] : key;
export const roleKeys = (role: { permissions?: { permission: { key: string } }[] }) => role.permissions?.map(link => link.permission.key) ?? [];
export function roleLabel(role: { name: string; permissions?: { permission: { key: string } }[] }) {
  const standard = ACCESS_PROFILES.some(profile => profile.name === role.name);
  return profileTitle(role.name) + ((standard && !matchesProfile(role.name, roleKeys(role))) || (!standard && !legacyTitles.has(role.name)) ? " (personalizado)" : "");
}
export function matchesProfile(name: string, permissions: Permissions) {
  const profile = ACCESS_PROFILES.find(p => p.name === name);
  return !!profile && profile.permissions.length === new Set(permissions).size && profile.permissions.every(key => permissions.includes(key));
}
