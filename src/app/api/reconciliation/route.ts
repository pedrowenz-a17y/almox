import { requireAnyUser } from "@/lib/auth";
import { api, json } from "@/lib/http";
import {
  listReconciliations,
  readReconciliationBody,
  saveReconciliation,
} from "@/services/reconciliation";

export const GET = api(async () =>
  json(await listReconciliations(await requireAnyUser(["reports:read", "reports:view"]))),
);
export const POST = api(async (request) => {
  const actor = await requireAnyUser(["reports:read", "reconciliation:write"]);
  return json(
    await saveReconciliation(actor, await readReconciliationBody(request)),
    201,
  );
});
