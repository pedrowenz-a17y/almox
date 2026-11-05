import { requireUser } from "@/lib/auth";
import { api, json } from "@/lib/http";
import { createOrder, listOrders } from "@/services/orders";
export const GET = api(async request => json(await listOrders(await requireUser("orders:read"), Object.fromEntries(request.nextUrl.searchParams))));
export const POST = api(async request => json(await createOrder(await requireUser("orders:write"), await request.json()), 201));
