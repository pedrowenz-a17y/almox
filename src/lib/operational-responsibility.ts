import { canActOnOrder, canMoveAnyStock } from "@/lib/access-profiles";

export const canManageResponsibilities = (permissions: readonly string[]) =>
  permissions.includes("users:manage") || permissions.includes("inventory:adjust");

export const canTakeWarehouseShift = (permissions: readonly string[]) =>
  canMoveAnyStock(permissions) || canActOnOrder(permissions, "APPLY") || canActOnOrder(permissions, "RETURN");

/** Assignments identify responsibility; they never grant permission to execute a task. */
export function canOwnPending(permissions: readonly string[], type: string, userId: string, creatorId: string | null) {
  if (type === "COUNT") return permissions.includes("inventory:adjust") && userId !== creatorId;
  if (type === "SCHEDULE") return permissions.includes("inventory:count");
  if (type === "RETURN") return canActOnOrder(permissions, "RETURN");
  if (type === "AWAITING_INVOICE") return canActOnOrder(permissions, "INVOICE");
  return ["UNAPPLIED", "RESERVED"].includes(type) && canActOnOrder(permissions, "APPLY");
}
