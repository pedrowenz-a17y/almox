import { requireUser } from "@/lib/auth";
import { api, json } from "@/lib/http";
import { listOrderCosts } from "@/services/order-costs";

export const GET = api(async (request) =>
  json(
    await listOrderCosts(
      await requireUser("costs:read"),
      Object.fromEntries(request.nextUrl.searchParams),
    ),
  ),
);
