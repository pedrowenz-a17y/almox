import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { api, json } from "@/lib/http";
import { prepareAccessProfiles } from "@/services/access-profiles";

export const maxDuration = 30;
export const POST = api(async request => {
  const actor = await requireUser("users:manage");
  z.object({}).strict().parse(await request.json());
  return json(await prepareAccessProfiles(actor));
});
