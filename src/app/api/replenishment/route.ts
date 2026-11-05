import { requireUser } from "@/lib/auth";
import { api, json } from "@/lib/http";
import { listReplenishment } from "@/services/replenishment";

export const GET = api(async () =>
  json(await listReplenishment(await requireUser("purchases:read"))),
);
