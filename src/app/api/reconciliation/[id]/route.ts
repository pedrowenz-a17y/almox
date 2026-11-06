import { requireUser } from "@/lib/auth";
import { api, json } from "@/lib/http";
import { getReconciliation } from "@/services/reconciliation";

export const GET = api(async (_request, context) =>
  json(
    await getReconciliation(
      await requireUser("reports:read"),
      (await context.params).id,
    ),
  ),
);
