"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { LoaderCircle, Send, Sparkles, Trash2 } from "lucide-react";
import { Modal } from "@/components/ui";
import { api } from "@/lib/client";

type Message = { role: "user" | "assistant"; content: string; scope?: string };
const suggestions = [
  "Como retirar e aplicar um material em uma O.S. ou O.P.?",
  "Quais pendências nas ordens da unidade merecem atenção?",
  "Como conferir divergências entre saldo e estoque físico?",
  "Como usar compras, reposição, QR Codes e relatórios?",
];

export default function Assistant({
  disabled = false,
}: {
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [question, setQuestion] = useState("");
  const [includeUnit, setIncludeUnit] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const controller = useRef<AbortController | null>(null);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    if (open) end.current?.scrollIntoView({ block: "nearest" });
  }, [messages, busy, open]);
  function close() {
    controller.current?.abort();
    setBusy(false);
    setOpen(false);
  }
  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = question.trim();
    if (busy || text.length < 2) return;
    const history = messages
      .slice(-4)
      .map(({ role, content }) => ({ role, content: content.slice(0, 1800) }));
    const abort = new AbortController();
    controller.current = abort;
    setBusy(true);
    setError("");
    try {
      const result = await api<{ answer: string; scope: string }>(
        "/api/assistant",
        {
          method: "POST",
          signal: abort.signal,
          body: JSON.stringify({ question: text, history, includeUnit }),
        },
      );
      if (!abort.signal.aborted) {
        setMessages((previous) => [
          ...previous.slice(-18),
          { role: "user", content: text },
          { role: "assistant", content: result.answer, scope: result.scope },
        ]);
        setQuestion("");
      }
    } catch (cause) {
      if (!abort.signal.aborted)
        setError(
          cause instanceof Error
            ? cause.message
            : "Não foi possível consultar o assistente.",
        );
    } finally {
      if (controller.current === abort) {
        controller.current = null;
        setBusy(false);
      }
    }
  }
  return (
    <>
      <button
        type="button"
        className="icon-button ai-trigger"
        disabled={disabled}
        title="Assistente IA"
        aria-label="Abrir assistente IA"
        onClick={() => setOpen(true)}
      >
        <Sparkles size={19} />
      </button>
      {open && (
        <Modal
          title="Assistente do almoxarifado"
          subtitle="Orientação, análise e sugestões para revisar com a equipe."
          onClose={close}
          wide
        >
          <div className="ai-panel">
            <p className="ai-intro">
              Pergunte sobre O.S./O.P., estoque e outras telas. As respostas
              orientam a equipe; nenhuma operação é registrada pela IA.
            </p>
            {!messages.length && (
              <div
                className="ai-suggestions"
                aria-label="Sugestões de perguntas"
              >
                {suggestions.map((text) => (
                  <button
                    type="button"
                    key={text}
                    disabled={busy}
                    onClick={() => setQuestion(text)}
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
                disabled={busy}
                onChange={(event) => setIncludeUnit(event.target.checked)}
              />{" "}
              Incluir resumo da unidade atual
            </label>
            <p className="ai-sharing">
              Suas perguntas e o histórico recente vão para a OpenAI. Ao incluir
              o resumo, também enviamos uma amostra autorizada da unidade, sem
              custos ou dados pessoais de funcionários. Não envie senhas ou
              chaves.
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
                  Escolha uma sugestão ou escreva sua pergunta. Para analisar os
                  registros atuais, ative o resumo da unidade.
                </p>
              )}
              {messages.map((message, index) => (
                <article
                  className={`ai-message ai-${message.role}`}
                  key={index}
                >
                  <strong>
                    {message.role === "user" ? "Você" : "Assistente"}
                  </strong>
                  <p>{message.content}</p>
                  {message.scope && <small>{message.scope}</small>}
                </article>
              ))}
              {busy && (
                <p className="ai-loading">
                  <LoaderCircle className="spin" size={17} /> Consultando o
                  assistente…
                </p>
              )}
              <div ref={end} />
            </div>
            {error && (
              <p className="notice error" role="alert">
                {error}
              </p>
            )}
            <form onSubmit={send} className="ai-composer">
              <label htmlFor="ai-question">Sua pergunta</label>
              <textarea
                id="ai-question"
                rows={3}
                maxLength={1600}
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                disabled={busy}
                placeholder="Ex.: como conferir materiais aplicados em ordens ainda não faturadas?"
              />
              <div className="ai-actions">
                <button
                  type="button"
                  className="button"
                  disabled={busy || !messages.length}
                  onClick={() => {
                    setMessages([]);
                    setError("");
                  }}
                >
                  <Trash2 size={15} /> Limpar conversa
                </button>
                <button
                  className="button primary"
                  disabled={busy || question.trim().length < 2}
                >
                  <Send size={15} /> {busy ? "Consultando…" : "Enviar pergunta"}
                </button>
              </div>
            </form>
            <p className="ai-footnote">
              Revise antes de agir. O resumo é parcial e não confirma contagem
              física, custos reais ou sincronização com outro ERP.
            </p>
          </div>
        </Modal>
      )}
    </>
  );
}
