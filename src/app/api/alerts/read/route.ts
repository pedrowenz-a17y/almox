import { requireUser } from "@/lib/auth";
import { api, json } from "@/lib/http";
import { readReconciliationBody } from "@/services/reconciliation";
import { markOperationalAlertRead } from "@/services/operational-alerts";
export const POST = api(async (request) =>
  json(
    await markOperationalAlertRead(
      await requireUser(),
      await readReconciliationBody(request),
    ),
  ),
);
