import { requireUser } from "@/lib/auth";
import { api, json } from "@/lib/http";
import { listPendingPeople } from "@/services/operational-pending";
export const GET = api(async () => json(await listPendingPeople(await requireUser())));
