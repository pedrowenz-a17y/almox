import { requireUser } from "@/lib/auth";
import { api, json } from "@/lib/http";
import { accessDetails, linkConfirmedAccount, sendAccessEmail } from "@/services/access-emails";
export const maxDuration = 60;
export const GET = api(async (_request, context) => json(await accessDetails(await requireUser("users:manage"), (await context.params).id)));
export const PATCH = api(async (request, context) => json(await linkConfirmedAccount(await requireUser("users:manage"), (await context.params).id, await request.json())));
export const POST = api(async (request, context) => json(await sendAccessEmail(await requireUser("users:manage"), (await context.params).id, await request.json())));
