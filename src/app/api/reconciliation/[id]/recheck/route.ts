import { requireAnyUser } from "@/lib/auth";
import { api, json } from "@/lib/http";
import { getReconciliationRecheck } from "@/services/reconciliation-review";

export const GET = api(async (_request, context) => {
  const actor = await requireAnyUser(["reports:read", "reconciliation:write"]);
  return json(await getReconciliationRecheck(actor, (await context.params).id));
});
