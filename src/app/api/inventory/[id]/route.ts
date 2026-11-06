import { requireUser } from "@/lib/auth";
import { api, json } from "@/lib/http";
import { getInventoryCount } from "@/services/inventory";

export const GET = api(async (_request, context) => {
  const actor = await requireUser("inventory:count");
  const { id } = await context.params;
  return json(await getInventoryCount(actor, id));
});
