import { requireUser, redactCosts } from "@/lib/auth";
import { api, json } from "@/lib/http";
import { listCatalog, saveCatalog } from "@/services/catalog";
export const GET = api(async (_request, context) => {
  const user = await requireUser();
  const { entity } = await context.params;
  return json(redactCosts(await listCatalog(user, entity), user));
});
export const POST = api(async (request, context) => {
  const user = await requireUser();
  const { entity } = await context.params;
  return json(
    redactCosts(await saveCatalog(user, entity, await request.json()), user),
    201,
  );
});
