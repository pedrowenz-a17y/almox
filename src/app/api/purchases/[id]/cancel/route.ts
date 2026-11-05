import { requireUser } from "@/lib/auth";
import { api, json } from "@/lib/http";
import { cancelPurchase } from "@/services/purchases";
export const POST = api(async (request, context) => json(await cancelPurchase(await requireUser("purchases:write"), (await context.params).id, await request.json())));
