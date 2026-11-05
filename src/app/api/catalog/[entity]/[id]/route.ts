import { requireUser, redactCosts } from "@/lib/auth";
import { api, json } from "@/lib/http";
import { archiveCatalog, getCatalog, saveCatalog } from "@/services/catalog";
export const GET = api(async (_request, context) => {
  const user = await requireUser();
  const { entity, id } = await context.params;
  const row = await getCatalog(user, entity, id);
  return json(redactCosts(row, user));
});
export const PATCH = api(async (request, context) => {
  const user = await requireUser();
  const { entity, id } = await context.params;
  return json(
    redactCosts(
      await saveCatalog(user, entity, await request.json(), id),
      user,
    ),
  );
});
export const DELETE = api(async (_request, context) => {
  const user = await requireUser();
  const { entity, id } = await context.params;
  return json(redactCosts(await archiveCatalog(user, entity, id), user));
});
