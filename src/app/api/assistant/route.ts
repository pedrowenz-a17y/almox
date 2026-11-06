import { requireUser } from "@/lib/auth";
import { api, json } from "@/lib/http";
import {
  askAssistant,
  AssistantError,
  assistantLimit,
  readAssistantBody,
} from "@/services/assistant";
export const runtime = "nodejs";
export const maxDuration = 40;
export const POST = api(async (request) => {
  const actor = await requireUser();
  const body = await readAssistantBody(request);
  try {
    assistantLimit(actor);
    return json(await askAssistant(actor, body, { signal: request.signal }));
  } catch (error) {
    if (error instanceof AssistantError) return error.toResponse();
    throw error;
  }
});
