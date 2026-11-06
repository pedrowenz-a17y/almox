import { requireUser } from "@/lib/auth";
import { api, json } from "@/lib/http";
import { reconciliationSetup } from "@/services/reconciliation";

export const GET = api(async () =>
  json(await reconciliationSetup(await requireUser("reports:read"))),
);
