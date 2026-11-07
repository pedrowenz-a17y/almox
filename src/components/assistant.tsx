"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowRight, LoaderCircle, Send, Sparkles, Trash2 } from "lucide-react";
import { Modal } from "@/components/ui";
import Link from "@/components/workspace-link";
import { isWorkspacePath } from "@/lib/workspace-navigation";
import { api, ApiError } from "@/lib/client";
import type {
  AssistantProfile,
  AssistantReply,
} from "@/lib/assistant-contract";
import { hasSensitiveAssistantInput } from "@/lib/local-assistant-language";

type Message = {
  role: "user" | "assistant";
  content: string;
  response?: AssistantReply;
  referenceQuestion?: string;
};
const starters = [
  "Onde fica o rolamento?",
  "Posso retirar 5 do ROL-6204?",
  "Por que o estoque não bate?",
  "Quais devoluções estão pendentes?",
];
export default function Assistant({
  disabled = false,
}: {
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false),
    [profile, setProfile] = useState<AssistantProfile | null>(null),
    [preparing, setPreparing] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]),
    [question, setQuestion] = useState(""),
    [includeUnit, setIncludeUnit] = useState(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [errorCode, setErrorCode] = useState("");
  const [retryUntil, setRetryUntil] = useState(0),
    [clock, setClock] = useState(() => Date.now());
  const remaining = Math.max(0, Math.ceil((retryUntil - clock) / 1000));
  const controller = useRef<AbortController | null>(null),
    profileController = useRef<AbortController | null>(null),
    end = useRef<HTMLDivElement>(null),
    inputRef = useRef<HTMLTextAreaElement>(null);
  useEffect(
    () => () => {
      controller.current?.abort();
      profileController.current?.abort();
    },
    [],
  );
  useEffect(() => {
    if (!retryUntil) return;
    const interval = setInterval(() => {
      const now = Date.now();
      setClock(now);
      if (now >= retryUntil) clearInterval(interval);
    }, 1000);
    return () => clearInterval(interval);
  }, [retryUntil]);
  useEffect(() => {
    if (open) end.current?.scrollIntoView({ block: "nearest" });
  }, [messages, busy, open]);
  async function openAssistant() {
    setOpen(true);
    setPreparing(true);
    setError("");
    setErrorCode("");
    profileController.current?.abort();
    const abort = new AbortController();
    profileController.current = abort;
    try {
      const next = await api<AssistantProfile>("/api/assistant", {
        signal: abort.signal,
      });
      if (abort.signal.aborted) return;
      if (profile && next.mode !== profile.mode) {
        setMessages([]);
        setQuestion("");
        setIncludeUnit(false);
        setRetryUntil(0);
      }
      setProfile(next);
    } catch (cause) {
      if (!abort.signal.aborted) {
        setProfile(null);
        setError(
          cause instanceof Error
            ? cause.message
            : "Não foi possível preparar o assistente.",
        );
      }
    } finally {
      if (!abort.signal.aborted) setPreparing(false);
    }
  }
  function close() {
    controller.current?.abort();
    profileController.current?.abort();
    setBusy(false);
    setOpen(false);
  }
  function choose(text: string) {
    setQuestion(text);
    inputRef.current?.focus();
  }
  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = question.trim();
    if (
      busy ||
      preparing ||
      remaining > 0 ||
      text.length < 2 ||
      !profile?.configured
    )
      return;
    if (hasSensitiveAssistantInput(text)) {
      setError(
        "Não envie chaves, URLs de banco ou senhas. Remova esses dados da pergunta antes de continuar.",
      );
      setErrorCode("ASSISTANT_SENSITIVE_INPUT");
      return;
    }
    const history = messages
      .slice(-4)
      .map(({ role, content, referenceQuestion }) => ({
        role,
        content: (role === "user"
          ? referenceQuestion || content
          : content
        ).slice(0, 1800),
      }));
    const abort = new AbortController();
    controller.current = abort;
    setBusy(true);
    setError("");
    setErrorCode("");
    try {
      const result = await api<AssistantReply>("/api/assistant", {
        method: "POST",
        signal: abort.signal,
        body: JSON.stringify({
          question: text,
          history,
          includeUnit,
          mode: profile.mode,
        }),
      });
      if (abort.signal.aborted) return;
      if (result.mode !== profile.mode)
        throw new ApiError(
          "O modo mudou. Reabra o assistente para iniciar uma nova conversa.",
          409,
          "ASSISTANT_MODE_CHANGED",
        );
      setMessages((previous) => [
        ...previous.slice(-18),
        {
          role: "user",
          content: text,
          referenceQuestion:
            profile.mode === "local" ? result.referenceQuestion : undefined,
        },
        { role: "assistant", content: result.answer, response: result },
      ]);
      setQuestion("");
    } catch (cause) {
      if (!abort.signal.aborted) {
        if (cause instanceof ApiError) {
          setErrorCode(cause.code || "");
          if (cause.retryAfter) {
            const now = Date.now();
            setClock(now);
            setRetryUntil(now + cause.retryAfter * 1000);
          }
          if (cause.code === "ASSISTANT_MODE_CHANGED") {
            setMessages([]);
            setQuestion("");
            setIncludeUnit(false);
            setProfile(null);
          }
        }
        setError(
          cause instanceof Error
            ? cause.message
            : "Não foi possível consultar o assistente.",
        );
      }
    } finally {
      if (controller.current === abort) {
        controller.current = null;
        setBusy(false);
      }
    }
  }
  const last = messages.at(-1)?.response;
  return (
    <>
      <button
        type="button"
        className="icon-button ai-trigger"
        disabled={disabled}
        title="Assistente do almoxarifado"
        aria-label="Abrir assistente"
        onClick={() => void openAssistant()}
      >
        <Sparkles size={19} />
      </button>
      {open && (
        <Modal
          title="Assistente do almoxarifado"
          subtitle="Converse sobre materiais, ordens e a rotina da sua unidade."
          onClose={close}
          wide
        >
          <div className="ai-panel">
            {preparing ? (
              <p className="ai-loading">
                <LoaderCircle className="spin" size={17} />
                Preparando assistente…
              </p>
            ) : (
              profile && (
                <>
                  <div className="ai-mode">
                    <Sparkles size={15} />
                    <strong>
                      {profile.mode === "local"
                        ? "Local · sem créditos de API"
                        : "OpenAI · API externa"}
                    </strong>
                  </div>
                  <p className="ai-intro">{profile.description}</p>
                  {!profile.configured && (
                    <p className="notice info">
                      O administrador precisa configurar a chave da OpenAI neste
                      modo. O modo local funciona sem essa chave.
                    </p>
                  )}
                </>
              )
            )}
            {!messages.length && (
              <div
                className="ai-suggestions"
                aria-label="Sugestões de perguntas"
              >
                {starters.map((text) => (
                  <button
                    type="button"
                    key={text}
                    disabled={busy || preparing}
                    onClick={() => choose(text)}
                  >
                    {text}
                  </button>
                ))}
              </div>
            )}
            <label className="ai-data-option">
              <input
                type="checkbox"
                checked={includeUnit}
                disabled={busy || preparing || !profile}
                onChange={(e) => setIncludeUnit(e.target.checked)}
              />
              {profile?.external
                ? "Compartilhar resumo da unidade com a OpenAI"
                : "Consultar dados da unidade atual"}
            </label>
            <p className="ai-sharing">
              {profile?.external
                ? "Ao enviar, a pergunta e o histórico recente vão para a OpenAI. O resumo autorizado só é incluído se você marcar a opção; ele exclui custos e identificação de funcionários."
                : "Sem envio a provedores de IA. Marque a opção para consultar os registros permitidos da sua unidade; sem ela, ofereço orientações."}{" "}
              Não envie senhas ou chaves.
            </p>
            <div
              className="ai-conversation"
              role="log"
              aria-label="Conversa com o assistente"
              aria-live="polite"
              aria-busy={busy}
            >
              {!messages.length && (
                <p className="ai-empty">
                  Escreva uma frase curta ou escolha um exemplo. Informe o
                  código da peça se houver mais de um produto parecido.
                </p>
              )}
              {messages.map((message, index) => (
                <article
                  className={`ai-message ai-${message.role}`}
                  key={index}
                >
                  <strong>
                    {message.role === "user"
                      ? "Você"
                      : profile?.label || "Assistente"}
                  </strong>
                  <p>{message.content}</p>
                  {message.response?.scope && (
                    <small>{message.response.scope}</small>
                  )}
                  {!!message.response?.links?.length && (
                    <div className="ai-links">
                      {message.response.links
                        .filter(
                          (link) =>
                            link.href.startsWith("/") &&
                            !link.href.startsWith("//") &&
                            isWorkspacePath(link.href.split("?")[0]),
                        )
                        .map((link) => (
                          <Link
                            key={link.href}
                            href={link.href}
                            onClick={close}
                          >
                            {link.label}
                            <ArrowRight size={13} />
                          </Link>
                        ))}
                    </div>
                  )}
                </article>
              ))}
              {busy && (
                <p className="ai-loading">
                  <LoaderCircle className="spin" size={17} />
                  Conferindo sua pergunta…
                </p>
              )}
              <div ref={end} />
            </div>
            {!!last?.suggestions?.length && (
              <div className="ai-followups" aria-label="Continuar a conversa">
                {last.suggestions.slice(0, 4).map((text) => (
                  <button
                    type="button"
                    key={text}
                    disabled={busy}
                    onClick={() => choose(text)}
                  >
                    {text}
                  </button>
                ))}
              </div>
            )}
            {error && (
              <div className="notice error ai-error" role="alert">
                <p>{error}</p>
                {errorCode === "AI_QUOTA" && (
                  <a
                    href="https://platform.openai.com/settings/organization/billing/overview"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Conferir faturamento da API OpenAI
                  </a>
                )}
                {!profile && !preparing && (
                  <button
                    type="button"
                    className="button secondary"
                    onClick={() => void openAssistant()}
                  >
                    Preparar assistente novamente
                  </button>
                )}
              </div>
            )}
            {remaining > 0 && (
              <p className="ai-limit-status" role="status">
                Você poderá enviar outra pergunta em {remaining}s.
              </p>
            )}
            <form onSubmit={send} className="ai-composer">
              <label htmlFor="ai-question">Sua pergunta</label>
              <textarea
                ref={inputRef}
                id="ai-question"
                rows={3}
                maxLength={1600}
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                disabled={busy || preparing}
                placeholder="Ex.: posso tirar 5 do ROL-6204? E se forem 10?"
              />
              <div className="ai-actions">
                <button
                  type="button"
                  className="button"
                  disabled={busy || !messages.length}
                  onClick={() => {
                    setMessages([]);
                    setError("");
                    setErrorCode("");
                  }}
                >
                  <Trash2 size={15} />
                  Limpar conversa
                </button>
                <button
                  className="button primary"
                  disabled={
                    busy ||
                    preparing ||
                    !profile?.configured ||
                    remaining > 0 ||
                    question.trim().length < 2
                  }
                >
                  <Send size={15} />
                  {busy
                    ? "Conferindo…"
                    : remaining > 0
                      ? `Aguarde ${remaining}s`
                      : "Enviar pergunta"}
                </button>
              </div>
            </form>
            <p className="ai-footnote">
              {profile?.mode === "local"
                ? "Ajuda por regras do ERP e cálculos simples, sem IA generativa. Se não entender, peço esclarecimentos. "
                : "Revise as respostas da IA antes de agir. "}
              As respostas não reservam, retiram, compram nem faturam materiais.
              A conferência física e a decisão continuam com a equipe.
            </p>
          </div>
        </Modal>
      )}
    </>
  );
}
