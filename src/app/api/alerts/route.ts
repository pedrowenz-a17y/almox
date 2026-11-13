import { requireUser } from "@/lib/auth";
import { api, json } from "@/lib/http";
import { listOperationalAlerts } from "@/services/operational-alerts";
export const GET = api(async (request) =>
  json(
    await listOperationalAlerts(
      await requireUser(),
      Object.fromEntries(request.nextUrl.searchParams),
    ),
  ),
);
