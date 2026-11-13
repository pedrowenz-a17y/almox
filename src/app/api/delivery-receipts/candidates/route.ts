import { requireUser } from "@/lib/auth";
import { api, json } from "@/lib/http";
import { receiptCandidates } from "@/services/delivery-receipts";
export const GET = api(async () =>
  json(await receiptCandidates(await requireUser())),
);
