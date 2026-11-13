import { requireUser } from "@/lib/auth";
import { api, json } from "@/lib/http";
import { operationalAlertHistory } from "@/services/operational-alerts";
export const GET = api(async () =>
  json(await operationalAlertHistory(await requireUser())),
);
