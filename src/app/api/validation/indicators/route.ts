import { requireAnyUser } from "@/lib/auth";
import { api, json } from "@/lib/http";
import { validationIndicators } from "@/services/validation-report";
export const GET = api(async (request) =>
  json(
    await validationIndicators(
      await requireAnyUser(["reports:read", "reports:view"]),
      Object.fromEntries(request.nextUrl.searchParams),
    ),
  ),
);
