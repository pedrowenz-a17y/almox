import { requireUser } from "@/lib/auth";
import { api, json } from "@/lib/http";
import { createMovement } from "@/services/stock";

export const POST = api(async (request) => {
  const actor = await requireUser("stock:move");
  return json(await createMovement(actor, await request.json()), 201);
});
