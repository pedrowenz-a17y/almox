import { appOrigin } from "@/lib/auth-config";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { api, json } from "@/lib/http";
import { resolveQr } from "@/services/qr";

export const GET = api(async (request) => {
  const actor = await requireUser();
  const code = z
    .string()
    .trim()
    .min(1)
    .max(500)
    .parse(request.nextUrl.searchParams.get("code"));
  const scope = z
    .enum(["location", "any"])
    .parse(request.nextUrl.searchParams.get("scope") || "location");
  return json(await resolveQr(actor, code, appOrigin(), scope === "any"));
});
