import { requireUser } from "@/lib/auth";
import { api, json } from "@/lib/http";
import { AssistantError, readAssistantBody } from "@/services/assistant";
import {
  assistantProfile,
  respondAssistant,
} from "@/services/assistant-router";
export const runtime = "nodejs";
export const maxDuration = 40;
export const GET = api(async () => {
  await requireUser();
  return json(assistantProfile());
});
export const POST = api(async (request) => {
  const actor = await requireUser();
  const body = await readAssistantBody(request);
  try {
    return json(
      await respondAssistant(actor, body, { signal: request.signal }),
    );
  } catch (error) {
    if (error instanceof AssistantError) return error.toResponse();
    throw error;
  }
});
