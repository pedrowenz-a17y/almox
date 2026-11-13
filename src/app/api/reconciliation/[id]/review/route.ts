import { requireAnyUser } from "@/lib/auth";
import { api, json } from "@/lib/http";
import { readReconciliationBody } from "@/services/reconciliation";
import { reviewReconciliation } from "@/services/reconciliation-review";

export const POST = api(async (request, context) => {
  const actor = await requireAnyUser(["reports:read", "reconciliation:write"]);
  return json(
    await reviewReconciliation(
      actor,
      (await context.params).id,
      await readReconciliationBody(request),
    ),
  );
});
