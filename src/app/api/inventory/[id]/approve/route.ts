import { requireUser } from "@/lib/auth";
import { api, json } from "@/lib/http";
import { approveInventoryCount } from "@/services/inventory";

export const POST = api(async (_request, context) => {
  const actor = await requireUser("inventory:adjust");
  const { id } = await context.params;
  return json(await approveInventoryCount(actor, id));
});
