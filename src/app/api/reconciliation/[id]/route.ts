import { requireAnyUser } from "@/lib/auth";
import { api, json } from "@/lib/http";
import { getReconciliation } from "@/services/reconciliation";

export const GET = api(async (_request, context) =>
  json(
    await getReconciliation(
      await requireAnyUser(["reports:read", "reports:view"]),
      (await context.params).id,
    ),
  ),
);
