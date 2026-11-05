import { requireUser } from "@/lib/auth";
import { api, json } from "@/lib/http";
export const GET = api(async () => json(await requireUser()));
