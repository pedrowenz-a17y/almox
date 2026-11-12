import { requireUser } from "@/lib/auth";
import { api, json } from "@/lib/http";
import { assignOperationalPending } from "@/services/pending-assignments";
export const POST = api(async request => json(await assignOperationalPending(await requireUser(), await request.json())));
