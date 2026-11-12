import { requireAnyUser } from "@/lib/auth";
import { api, json } from "@/lib/http";
import { getInventoryCount } from "@/services/inventory";

export const GET = api(async (_request, context) => {
  const actor = await requireAnyUser(["inventory:count", "inventory:read"]);
  const { id } = await context.params;
  return json(await getInventoryCount(actor, id));
});
