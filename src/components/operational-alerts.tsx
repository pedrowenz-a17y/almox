"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, Check, RefreshCw, Clock, MailOpen } from "lucide-react";
import Link from "next/link";
import { api, dateTime, qty } from "@/lib/client";
import { Badge, Empty, Loading } from "@/components/ui";
import {
  ALERT_LABELS,
  ALERT_HISTORY_LABELS,
  type AlertSnapshot,
} from "@/lib/operational-alerts";
import type {
  listOperationalAlerts,
  operationalAlertHistory,
} from "@/services/operational-alerts";
type Queue = Awaited<ReturnType<typeof listOperationalAlerts>>;
type History = Awaited<ReturnType<typeof operationalAlertHistory>>;
const errorText = (e: unknown) =>
  e instanceof Error
    ? e.message
    : "Não foi possível consultar a central de alertas.";
export default function OperationalAlerts({
  onOpenOrder,
  onInventory,
  onSchedules,
}: {
  onOpenOrder: (id: string, kind: "SERVICE" | "PRODUCTION") => void;
  onInventory: (id: string) => void;
  onSchedules: () => void;
}) {
  const [view, setView] = useState<"ACTIVE" | "HISTORY">("ACTIVE"),
    [read, setRead] = useState("ALL"),
    [focus, setFocus] = useState("ALL"),
    [type, setType] = useState("ALL"),
    [page, setPage] = useState(1);
  const [queue, setQueue] = useState<Queue | null>(null),
    [history, setHistory] = useState<History | null>(null),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const generation = useRef(0),
    busyRef = useRef(false),
    commands = useRef(new Map<string, string>());
  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);
  const load = useCallback(
    async (signal?: AbortSignal, background = false) => {
      const request = ++generation.current;
      if (!background) setLoading(true);
      setError("");
      try {
        const [result, readHistory] = await Promise.all([
          api<Queue>(
            `/api/alerts?${new URLSearchParams({ read, focus, type, page: String(page) })}`,
            { signal },
          ),
          view === "HISTORY"
            ? api<History>("/api/alerts/history", { signal })
            : Promise.resolve(null),
        ]);
        if (signal?.aborted || generation.current !== request) return;
        setQueue(result);
        setHistory(readHistory);
      } catch (cause) {
        if (!signal?.aborted && generation.current === request) {
          setError(errorText(cause));
          setQueue(null);
          setHistory(null);
        }
      } finally {
        if (!signal?.aborted && generation.current === request)
          setLoading(false);
      }
    },
    [read, focus, type, page, view],
  );
  useEffect(() => {
    const controller = new AbortController();
    const version = generation;
    void Promise.resolve().then(() => {
      if (!controller.signal.aborted) return load(controller.signal);
    });
    const refresh = () => {
      if (document.visibilityState === "visible" && !busyRef.current)
        void load(controller.signal, true);
    };
    const timer = setInterval(refresh, 60000);
    window.addEventListener("focus", refresh);
    return () => {
      controller.abort();
      version.current++;
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, [load]);
  async function mark(item: Queue["items"][number]) {
    if (item.readAt || busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    const key = commands.current.get(item.alertKey) ?? crypto.randomUUID();
    commands.current.set(item.alertKey, key);
    try {
      await api("/api/alerts/read", {
        method: "POST",
        body: JSON.stringify({
          pendingId: item.id,
          alertKey: item.alertKey,
          idempotencyKey: key,
        }),
      });
      setNotice(
        "Leitura registrada para você. A operação continua pendente até ser tratada na origem.",
      );
      await load();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  }
  function open(
    item: Pick<AlertSnapshot, "id" | "type" | "orderId" | "orderKind">,
  ) {
    if (item.orderId && item.orderKind)
      onOpenOrder(item.orderId, item.orderKind);
    else if (item.type === "COUNT") onInventory(item.id.split(":")[0]);
    else if (item.type === "SCHEDULE") onSchedules();
  }
  function choose(next: string, target: "read" | "focus" | "type") {
    setPage(1);
    setNotice("");
    if (target === "read") setRead(next);
    else if (target === "focus") setFocus(next);
    else setType(next);
  }
  return (
    <div className="alerts-workspace">
      <div className="page-heading">
        <div>
          <h1>Central de alertas</h1>
          <p>
            O que precisa de atenção, com responsável e caminho para tratar.
          </p>
        </div>
        <div className="heading-actions">
          <Link className="button secondary" href="/pendencias">
            Gerenciar pendências <ArrowRight size={16} />
          </Link>
          <button
            className="button secondary"
            disabled={loading || busy}
            onClick={() => void load()}
          >
            <RefreshCw size={17} /> Atualizar
          </button>
        </div>
      </div>
      {error && (
        <div className="notice error" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div className="notice info" role="status">
          {notice}
        </div>
      )}
      {queue && (
        <>
          <div className="alerts-caption">
            <strong>Resumo da unidade agora</strong>
            <small>
              {dateTime(queue.serverTime)} · horários exibidos no seu
              dispositivo
            </small>
          </div>
          <div className="alerts-summary">
            {[
              ["Não lidos", queue.summary.unread],
              ["Em atraso", queue.overdueTotal],
              ["Vencem hoje", queue.summary.dueToday],
              ["Sem responsável", queue.unassignedTotal],
            ].map(([label, count]) => (
              <div key={label}>
                <strong>{count}</strong>
                <span>{label}</span>
              </div>
            ))}
          </div>
          <p className="alerts-scope">
            Os números contam avisos por etapa; uma linha de material pode
            aparecer em mais de uma etapa. A leitura é individual. Atualização a
            cada minuto com a central visível.
          </p>
          {!queue.coordinationReady && (
            <div className="notice warning">
              Responsáveis e prazos das ordens dependem da preparação da etapa
              3. Os avisos continuam disponíveis; confira a orientação em
              Pendências.
            </div>
          )}
          {queue.summary.ineligible > 0 && (
            <div className="notice warning">
              {queue.summary.ineligible} aviso(s) com responsável sem permissão
              atual para executar a etapa. Revise a atribuição em Pendências.
            </div>
          )}
        </>
      )}
      <div className="toolbar">
        <div className="segmented" aria-label="Área da central">
          <button
            aria-pressed={view === "ACTIVE"}
            className={view === "ACTIVE" ? "selected" : ""}
            onClick={() => {
              setView("ACTIVE");
              setNotice("");
            }}
          >
            Avisos atuais
          </button>
          <button
            aria-pressed={view === "HISTORY"}
            className={view === "HISTORY" ? "selected" : ""}
            onClick={() => {
              setView("HISTORY");
              setNotice("");
            }}
          >
            Minhas leituras
          </button>
        </div>
      </div>
      {view === "ACTIVE" && (
        <section className="panel alerts-list">
          <div className="alerts-filters">
            <label>
              Leitura
              <select
                aria-label="Filtrar leitura"
                value={read}
                onChange={(e) => choose(e.target.value, "read")}
              >
                <option value="ALL">Todos</option>
                <option value="UNREAD">Não lidos</option>
                <option value="READ">Lidos e ainda pendentes</option>
              </select>
            </label>
            <label>
              Acompanhamento
              <select
                aria-label="Filtrar acompanhamento de alertas"
                value={focus}
                onChange={(e) => choose(e.target.value, "focus")}
              >
                <option value="ALL">Toda a unidade</option>
                <option value="MINE">Sob minha responsabilidade</option>
                <option value="OVERDUE">Em atraso</option>
                <option value="TODAY">Vencem hoje</option>
                <option value="UNASSIGNED">Sem responsável</option>
              </select>
            </label>
            <label>
              Etapa
              <select
                aria-label="Filtrar etapa dos alertas"
                value={type}
                onChange={(e) => choose(e.target.value, "type")}
              >
                <option value="ALL">Todas as etapas</option>
                {Object.entries(ALERT_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {loading ? (
            <Loading />
          ) : queue?.items.length ? (
            <>
              <ul className="alerts-cards">
                {queue.items.map((item) => (
                  <li
                    key={item.alertKey}
                    className={item.readAt ? "is-read" : ""}
                  >
                    <div className="alerts-card-heading">
                      <Badge
                        tone={
                          item.overdue || item.type === "RETURN"
                            ? "warning"
                            : ""
                        }
                      >
                        {ALERT_LABELS[item.type]}
                      </Badge>
                      <span className="alerts-read-state">
                        {item.readAt ? (
                          <>
                            <Check size={14} /> Lido por você
                          </>
                        ) : (
                          "Não lido"
                        )}
                      </span>
                    </div>
                    <h2>
                      {item.orderKind
                        ? `${item.orderKind === "SERVICE" ? "O.S." : "O.P."} ${item.code}`
                        : item.title}
                    </h2>
                    {item.orderId && <p>{item.title}</p>}
                    {item.productName && (
                      <p>
                        {item.productCode} · {item.productName}
                      </p>
                    )}
                    <dl className="alerts-facts">
                      <div>
                        <dt>Local e quantidade</dt>
                        <dd>
                          {item.locationCode}
                          {item.quantity !== null
                            ? ` · ${qty(item.quantity)} ${item.unit ?? ""}`
                            : ""}
                        </dd>
                      </div>
                      <div>
                        <dt>Responsável</dt>
                        <dd>
                          {item.assigneeName ?? "Sem responsável definido"}
                        </dd>
                      </div>
                      <div>
                        <dt>Prazo</dt>
                        <dd>
                          {item.dueAt ? (
                            <>
                              <Clock size={13} /> {dateTime(item.dueAt)}
                              {item.overdue && <strong> · Em atraso</strong>}
                            </>
                          ) : (
                            "Sem prazo definido"
                          )}
                        </dd>
                      </div>
                    </dl>
                    {item.assigneeId && !item.assigneeEligible && (
                      <small className="alerts-warning">
                        O responsável precisa de reatribuição ou revisão de
                        acesso.
                      </small>
                    )}
                    {item.missingHandoff && (
                      <small className="alerts-warning">
                        Há histórico de entrega sem identificação completa.
                      </small>
                    )}
                    <div className="alerts-card-actions">
                      <button
                        className="button secondary"
                        onClick={() => open(item)}
                      >
                        Abrir registro <ArrowRight size={15} />
                      </button>
                      {!item.readAt ? (
                        <button
                          className="text-button"
                          disabled={busy}
                          onClick={() => void mark(item)}
                        >
                          Marcar como lido
                        </button>
                      ) : (
                        <small>Lido em {dateTime(item.readAt)}</small>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
              <div className="toolbar">
                <button
                  className="button secondary"
                  disabled={page <= 1 || busy}
                  onClick={() => setPage(page - 1)}
                >
                  Anterior
                </button>
                <span>
                  {queue.total} avisos neste filtro · página {page}
                </span>
                <button
                  className="button secondary"
                  disabled={page * queue.pageSize >= queue.total || busy}
                  onClick={() => setPage(page + 1)}
                >
                  Próxima
                </button>
              </div>
            </>
          ) : (
            queue &&
            !error && (
              <Empty
                title="Nenhum aviso neste filtro"
                description="Ajuste a etapa, a leitura ou o acompanhamento para consultar os outros avisos."
              />
            )
          )}
        </section>
      )}
      {view === "HISTORY" && (
        <section className="panel alerts-history">
          <div className="panel-heading">
            <div>
              <h2>Leituras e acompanhamento</h2>
              <p>
                Até 50 leituras recentes feitas por você nesta unidade e nas
                áreas que seu perfil pode consultar.
              </p>
            </div>
          </div>
          {loading ? (
            <Loading />
          ) : history?.items.length ? (
            <ul className="alerts-cards">
              {history.items.map((entry) => (
                <li key={entry.id}>
                  <div className="alerts-card-heading">
                    <Badge
                      tone={
                        entry.status === "REGULARIZED"
                          ? "success"
                          : entry.status === "UPDATED"
                            ? "warning"
                            : ""
                      }
                    >
                      {ALERT_HISTORY_LABELS[entry.status]}
                    </Badge>
                    <small>Lido em {dateTime(entry.readAt)}</small>
                  </div>
                  <h2>
                    {entry.item.orderKind
                      ? `${entry.item.orderKind === "SERVICE" ? "O.S." : "O.P."} ${entry.item.code}`
                      : entry.item.title}
                  </h2>
                  <p>
                    {ALERT_LABELS[entry.item.type]} ·{" "}
                    {entry.item.productCode ?? entry.item.locationCode}
                  </p>
                  <p>{entry.reason}</p>
                  <div className="alerts-card-actions">
                    <button
                      className="button secondary"
                      disabled={entry.status === "UNAVAILABLE"}
                      onClick={() => open(entry.item)}
                    >
                      Abrir registro <ArrowRight size={15} />
                    </button>
                    {entry.status === "UPDATED" && (
                      <button
                        className="text-button"
                        onClick={() => {
                          setView("ACTIVE");
                          setRead("UNREAD");
                          setFocus("ALL");
                          setType("ALL");
                          setPage(1);
                        }}
                      >
                        Ver avisos atuais
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            history &&
            !error && (
              <Empty
                title="Nenhuma leitura registrada ainda"
                description="Marque um aviso como lido para acompanhar a situação do registro de origem."
              />
            )
          )}
          {history?.truncated && (
            <p className="alerts-footnote">
              Há leituras anteriores fora deste recorte.
            </p>
          )}
        </section>
      )}
      <p className="alerts-footnote">
        <MailOpen size={14} /> Marcar leitura não recebe material, não fatura
        ordens e não aprova contagens. A situação é consultada no registro de
        origem. Avisos ficam disponíveis dentro do app.
      </p>
    </div>
  );
}
