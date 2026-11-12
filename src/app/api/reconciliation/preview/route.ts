import { requireAnyUser } from "@/lib/auth";
import { api, json } from "@/lib/http";
import {
  previewReconciliation,
  readReconciliationBody,
} from "@/services/reconciliation";

export const POST = api(async (request) => {
  const actor = await requireAnyUser(["reports:read", "reports:view"]);
  return json(
    await previewReconciliation(actor, await readReconciliationBody(request)),
  );
});
