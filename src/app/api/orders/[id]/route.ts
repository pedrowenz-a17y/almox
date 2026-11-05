import { requireUser } from "@/lib/auth";
import { api, json } from "@/lib/http";
import { getOrder } from "@/services/orders";
export const GET = api(async (_request, context) => json(await getOrder(await requireUser("orders:read"), (await context.params).id)));
