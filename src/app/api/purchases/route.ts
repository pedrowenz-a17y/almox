import { requireUser } from "@/lib/auth";
import { api, json } from "@/lib/http";
import { createPurchase, listPurchases } from "@/services/purchases";
export const GET = api(async request => json(await listPurchases(await requireUser("purchases:read"), Object.fromEntries(request.nextUrl.searchParams))));
export const POST = api(async request => json(await createPurchase(await requireUser("purchases:write"), await request.json()), 201));
