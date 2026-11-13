import { requireUser } from "@/lib/auth";
import { api, json } from "@/lib/http";
import {
  getDeliveryReceipt,
  respondToDelivery,
} from "@/services/delivery-receipts";
import { readReconciliationBody } from "@/services/reconciliation";
export const GET = api(async (_request, context) =>
  json(
    await getDeliveryReceipt(await requireUser(), (await context.params).id),
  ),
);
export const POST = api(async (request, context) =>
  json(
    await respondToDelivery(
      await requireUser(),
      (await context.params).id,
      await readReconciliationBody(request),
    ),
  ),
);
