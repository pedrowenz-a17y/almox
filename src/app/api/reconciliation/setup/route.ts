import { requireAnyUser } from "@/lib/auth";
import { api, json } from "@/lib/http";
import { reconciliationSetup } from "@/services/reconciliation";

export const GET = api(async () =>
  json(await reconciliationSetup(await requireAnyUser(["reports:read", "reports:view"]))),
);
