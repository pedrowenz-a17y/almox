import { requireUser } from "@/lib/auth";
import { api, json } from "@/lib/http";
import {
  managementReport,
  recordManagementPosition,
} from "@/services/management";
import { readReconciliationBody } from "@/services/reconciliation";
export const GET = api(async (request) =>
  json(
    await managementReport(
      await requireUser(),
      Object.fromEntries(request.nextUrl.searchParams),
    ),
  ),
);
export const POST = api(async (request) =>
  json(
    await recordManagementPosition(
      await requireUser(),
      await readReconciliationBody(request),
    ),
  ),
);
