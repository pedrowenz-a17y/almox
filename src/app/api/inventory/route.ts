import { requireUser } from "@/lib/auth";
import { api, json } from "@/lib/http";
import { createInventoryCount } from "@/services/inventory";

export const POST = api(async (request) => {
  const actor = await requireUser("inventory:count");
  return json(await createInventoryCount(actor, await request.json()), 201);
});
