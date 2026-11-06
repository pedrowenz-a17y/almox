import { requireUser } from "@/lib/auth";
import { api, json } from "@/lib/http";
import { rejectInventoryCount } from "@/services/inventory";

export const POST = api(async (request, context) => {
  const actor = await requireUser("inventory:adjust");
  const { id } = await context.params;
  return json(await rejectInventoryCount(actor, id, await request.json()));
});
