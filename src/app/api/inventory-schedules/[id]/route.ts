import { requireUser } from "@/lib/auth";
import { api, json } from "@/lib/http";
import { updateInventorySchedule } from "@/services/inventory-schedules";

export const PATCH = api(async (request, context) => {
  const actor = await requireUser("inventory:adjust");
  const { id } = await context.params;
  return json(await updateInventorySchedule(actor, id, await request.json()));
});
