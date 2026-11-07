import type {
  AssistantProfile,
  AssistantReply,
} from "@/lib/assistant-contract";
import { hasSensitiveAssistantInput } from "@/lib/local-assistant-language";
import { AppError } from "@/lib/http";
import type { StockActor } from "@/services/stock";
import {
  askAssistant,
  assistantInput,
  assistantLimit,
} from "@/services/assistant";
import { askLocalAssistant } from "@/services/local-assistant";

type AssistantEnvironment = {
  ASSISTANT_PROVIDER?: string;
  OPENAI_API_KEY?: string;
  OPENAI_MODEL?: string;
};
export function assistantProfile(
  env: AssistantEnvironment = {
    ASSISTANT_PROVIDER: process.env.ASSISTANT_PROVIDER,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    OPENAI_MODEL: process.env.OPENAI_MODEL,
  },
): AssistantProfile {
  const configured = env.ASSISTANT_PROVIDER?.trim().toLowerCase() || "local";
  if (!["local", "openai"].includes(configured))
    throw new AppError(
      "Confira ASSISTANT_PROVIDER no servidor: local ou openai.",
      503,
      "AI_CONFIGURATION",
    );
  const remote = configured === "openai";
  return {
    mode: remote ? "openai" : "local",
    external: remote,
    configured: !remote || Boolean(env.OPENAI_API_KEY?.trim()),
    label: remote ? "OpenAI" : "Assistente local",
    description: remote
      ? "Consulta a OpenAI ao enviar. A API exige chave e faturamento próprios."
      : "Ajuda com frases simples sobre materiais, ordens e conferências. Se houver dúvida, peço o código ou um esclarecimento.",
  };
}
/** The server chooses the provider. A stale local screen can never silently send its history to OpenAI. */
export async function respondAssistant(
  actor: StockActor,
  raw: unknown,
  options: {
    env?: AssistantEnvironment;
    signal?: AbortSignal;
    local?: typeof askLocalAssistant;
    remote?: typeof askAssistant;
    now?: number;
  } = {},
): Promise<AssistantReply> {
  if (!actor.id || !actor.unitId)
    throw new AppError("Entre e selecione uma unidade autorizada.", 403);
  const input = assistantInput.parse(raw),
    profile = assistantProfile(options.env);
  if (input.mode !== profile.mode)
    throw new AppError(
      "O modo do assistente mudou. Atualize a página para iniciar uma conversa no modo atual.",
      409,
      "ASSISTANT_MODE_CHANGED",
    );
  if (
    [input.question, ...input.history.map((m) => m.content)].some(
      hasSensitiveAssistantInput,
    )
  )
    throw new AppError(
      "Não envie senhas, URLs de banco ou chaves. Remova esses dados e limpe a conversa antes de continuar. Se uma credencial foi exposta, substitua-a no serviço responsável.",
      400,
      "ASSISTANT_SENSITIVE_INPUT",
    );
  assistantLimit(actor, options.now, profile.mode === "local" ? 30 : 5);
  if (profile.mode === "local")
    return (options.local ?? askLocalAssistant)(actor, input);
  const result = await (options.remote ?? askAssistant)(actor, input, {
    env: options.env,
    signal: options.signal,
  });
  return { ...result, mode: "openai" };
}
