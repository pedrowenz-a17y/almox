import { requireAnyUser } from "@/lib/auth";
import { api, json } from "@/lib/http";
import { readReconciliationBody } from "@/services/reconciliation";
import {
  listValidationRuns,
  startValidationRun,
} from "@/services/validation-report";
export const GET = api(async () =>
  json(
    await listValidationRuns(
      await requireAnyUser(["reports:read", "reports:view"]),
    ),
  ),
);
export const POST = api(async (request) =>
  json(
    await startValidationRun(
      await requireAnyUser(["reports:read", "reconciliation:write"]),
      await readReconciliationBody(request),
    ),
    201,
  ),
);
