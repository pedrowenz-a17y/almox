import { requireUser } from "@/lib/auth";
import { api, json } from "@/lib/http";
import { receivePurchase } from "@/services/purchases";
export const POST = api(async (request, context) => json(await receivePurchase(await requireUser("purchases:receive"), (await context.params).id, await request.json()), 201));
