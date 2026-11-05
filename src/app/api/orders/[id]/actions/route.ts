import { requireUser } from "@/lib/auth";
import { api, json } from "@/lib/http";
import { actOnOrder } from "@/services/orders";
export const POST = api(async (request, context) => json(await actOnOrder(await requireUser(), (await context.params).id, await request.json())));
