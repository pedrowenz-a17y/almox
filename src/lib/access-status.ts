export type AccessState = "DISABLED" | "UNLINKED" | "INVITED" | "PENDING" | "ACTIVE";
export interface AccessProgress {
  accessState: AccessState; lastLoginAt: string | null; passwordDefinedAt: string | null;
  invitationAt: string | null; lastMailState: "ACCEPTED" | "FAILED" | "UNCONFIRMED" | null;
}
export const accessStateLabels: Record<AccessState, string> = {
  DISABLED: "Acesso desativado", UNLINKED: "Sem vínculo de login", INVITED: "Convite solicitado",
  PENDING: "Primeiro acesso pendente", ACTIVE: "Acesso confirmado",
};
export function accessState(input: { active?: boolean; identityActive?: boolean; authLinked: boolean; lastLoginAt?: string | null;
  invitationAt?: string | null }): AccessState {
  if (input.active === false || input.identityActive === false) return "DISABLED";
  if (!input.authLinked) return "UNLINKED";
  if (input.lastLoginAt) return "ACTIVE";
  return input.invitationAt ? "INVITED" : "PENDING";
}
