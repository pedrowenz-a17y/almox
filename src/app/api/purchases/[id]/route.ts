import { requireUser } from "@/lib/auth";
import { api, json } from "@/lib/http";
import { getPurchase } from "@/services/purchases";
export const GET = api(async (_request, context) => json(await getPurchase(await requireUser("purchases:read"), (await context.params).id)));
