import { requireUser } from "@/lib/auth";
import { api, json } from "@/lib/http";
import { listOperationalPending } from "@/services/operational-pending";

export const GET = api(async request => json(await listOperationalPending(
  await requireUser(), Object.fromEntries(request.nextUrl.searchParams),
)));
