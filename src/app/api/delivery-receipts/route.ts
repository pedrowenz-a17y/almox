import { requireUser } from "@/lib/auth";
import { api, json } from "@/lib/http";
import { listDeliveryReceipts } from "@/services/delivery-receipts";
export const GET = api(async (request) =>
  json(
    await listDeliveryReceipts(
      await requireUser(),
      Object.fromEntries(request.nextUrl.searchParams),
    ),
  ),
);
