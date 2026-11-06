import { requireUser } from "@/lib/auth";
import { api, json } from "@/lib/http";
import {
  askAssistant,
  assistantLimit,
  readAssistantBody,
} from "@/services/assistant";
export const runtime = "nodejs";
export const maxDuration = 40;
export const POST = api(async (request) => {
  const actor = await requireUser();
  const body = await readAssistantBody(request);
  assistantLimit(actor);
  return json(await askAssistant(actor, body, { signal: request.signal }));
});
