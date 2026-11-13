import { requireAnyUser } from "@/lib/auth";
import { api, json } from "@/lib/http";
import { readReconciliationBody } from "@/services/reconciliation";
import {
  getValidationRun,
  recordValidation,
} from "@/services/validation-report";
export const GET = api(async (_request, context) =>
  json(
    await getValidationRun(
      await requireAnyUser(["reports:read", "reports:view"]),
      (await context.params).id,
    ),
  ),
);
export const POST = api(async (request, context) =>
  json(
    await recordValidation(
      await requireAnyUser(["reports:read", "reconciliation:write"]),
      (await context.params).id,
      await readReconciliationBody(request),
    ),
  ),
);
