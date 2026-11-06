import { requireUser } from "@/lib/auth";
import { api, json } from "@/lib/http";
import {
  listReconciliations,
  readReconciliationBody,
  saveReconciliation,
} from "@/services/reconciliation";

export const GET = api(async () =>
  json(await listReconciliations(await requireUser("reports:read"))),
);
export const POST = api(async (request) => {
  const actor = await requireUser("reports:read");
  return json(
    await saveReconciliation(actor, await readReconciliationBody(request)),
    201,
  );
});
