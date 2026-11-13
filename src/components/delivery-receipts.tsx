"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, RefreshCw, PackageCheck } from "lucide-react";
import { api, dateTime } from "@/lib/client";
import { Badge, Empty, Loading, Modal } from "@/components/ui";
import {
  RECEIPT_LABELS,
  receiptQuantity as qty,
  type DeliveryReceipt,
} from "@/lib/delivery-receipts";
import type {
  listDeliveryReceipts,
  getDeliveryReceipt,
} from "@/services/delivery-receipts";
type Page = Awaited<ReturnType<typeof listDeliveryReceipts>>;
type Detail = Awaited<ReturnType<typeof getDeliveryReceipt>>;
type Action = "CONFIRM" | "DISPUTE" | "PROPOSE" | "ACCEPT" | "REJECT";
const actionLabels: Record<Action, string> = {
  CONFIRM: "Confirmar recebimento",
  DISPUTE: "Informar divergência",
  PROPOSE: "Registrar tratamento",
  ACCEPT: "Aceitar tratamento",
  REJECT: "Devolver para revisão",
};
const eventLabels: Record<string, string> = {
  DELIVERY_CONFIRMED: "Recebimento confirmado",
  DELIVERY_DISPUTED: "Divergência informada",
  DELIVERY_TREATMENT_PROPOSED: "Tratamento proposto",
  DELIVERY_TREATMENT_ACCEPTED: "Tratamento aceito",
  DELIVERY_TREATMENT_REJECTED: "Tratamento devolvido para revisão",
};
const errorText = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "Não foi possível consultar os recebimentos.";
const tone = (status: string) =>
  ["DISPUTED", "PROPOSED"].includes(status)
    ? "warning"
    : ["CONFIRMED", "RESOLVED"].includes(status)
      ? "success"
      : "";

export default function DeliveryReceipts({
  permissions,
  initialDeliveryId,
  onOpenOrder,
}: {
  permissions: string[];
  initialDeliveryId?: string;
  onOpenOrder: (id: string, kind: "SERVICE" | "PRODUCTION") => void;
}) {
  const canMonitor = permissions.includes("orders:read");
  const [scope, setScope] = useState(
      initialDeliveryId && canMonitor ? "UNIT" : "MINE",
    ),
    [status, setStatus] = useState("ALL"),
    [page, setPage] = useState(1),
    [query, setQuery] = useState("");
  const [result, setResult] = useState<Page | null>(null),
    [detail, setDetail] = useState<Detail | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [action, setAction] = useState<Action | null>(null);
  const generation = useRef(0),
    detailGeneration = useRef(0);
  const load = useCallback(
    async (signal?: AbortSignal) => {
      const request = ++generation.current;
      setLoading(true);
      setError("");
      try {
        const next = await api<Page>(
          `/api/delivery-receipts?${new URLSearchParams({ scope, status, page: String(page), q: query })}`,
          { signal },
        );
        if (!signal?.aborted && request === generation.current) setResult(next);
      } catch (cause) {
        if (!signal?.aborted && request === generation.current) {
          setResult(null);
          setError(errorText(cause));
        }
      } finally {
        if (!signal?.aborted && request === generation.current)
          setLoading(false);
      }
    },
    [scope, status, page, query],
  );
  const open = useCallback(async (id: string, signal?: AbortSignal) => {
    const request = ++detailGeneration.current;
    setError("");
    setDetail(null);
    try {
      const next = await api<Detail>(
        `/api/delivery-receipts/${encodeURIComponent(id)}`,
        { signal },
      );
      if (!signal?.aborted && request === detailGeneration.current)
        setDetail(next);
    } catch (cause) {
      if (!signal?.aborted && request === detailGeneration.current)
        setError(errorText(cause));
    }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    const requestCounter = generation;
    void Promise.resolve().then(() => {
      if (!controller.signal.aborted) return load(controller.signal);
    });
    return () => {
      controller.abort();
      requestCounter.current++;
    };
  }, [load]);
  useEffect(() => {
    const controller = new AbortController();
    const requestCounter = detailGeneration;
    if (initialDeliveryId)
      void Promise.resolve().then(() => {
        if (!controller.signal.aborted)
          return open(initialDeliveryId, controller.signal);
      });
    return () => {
      controller.abort();
      requestCounter.current++;
    };
  }, [initialDeliveryId, open]);
  function back() {
    detailGeneration.current++;
    setDetail(null);
    setError("");
    setNotice("");
  }
  const item = detail?.item;
  return (
    <div className="receipts-workspace">
      <div className="page-heading">
        <div>
          <h1>Recebimentos de materiais</h1>
          <p>
            Confira o que chegou até você e acompanhe as diferenças na entrega.
          </p>
        </div>
        <div className="heading-actions">
          {item && (
            <button className="button secondary" onClick={back}>
              <ArrowLeft size={16} /> Todas as entregas
            </button>
          )}
          <button
            className="button secondary"
            disabled={loading || !!action}
            onClick={() => {
              void load();
              if (item) void open(item.id);
            }}
          >
            <RefreshCw size={16} /> Atualizar
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
      {!item && (
        <>
          <div className="toolbar">
            <div className="segmented" aria-label="Escopo dos recebimentos">
              {[
                ["MINE", "Para mim"],
                ...(canMonitor ? [["UNIT", "Acompanhar unidade"]] : []),
              ].map(([value, label]) => (
                <button
                  key={value}
                  aria-pressed={scope === value}
                  className={scope === value ? "selected" : ""}
                  onClick={() => {
                    setScope(value);
                    setPage(1);
                    setNotice("");
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          {result && (
            <>
              <div className="receipt-summary">
                {[
                  "PENDING",
                  "DISPUTED",
                  "PROPOSED",
                  scope === "UNIT" ? "UNLINKED" : "CONFIRMED",
                ].map((key) => (
                  <div key={key}>
                    <strong>
                      {result.summary[key as keyof typeof result.summary]}
                    </strong>
                    <span>
                      {RECEIPT_LABELS[key as keyof typeof RECEIPT_LABELS]}
                    </span>
                  </div>
                ))}
              </div>
              <p className="receipt-caption">
                Resumo deste escopo · consultado em{" "}
                {dateTime(result.serverTime)}. Os filtros abaixo afetam somente
                a lista.
              </p>
            </>
          )}
          <section className="panel">
            <form
              className="receipt-filters"
              onSubmit={(event) => {
                event.preventDefault();
                setPage(1);
                setQuery(
                  String(
                    new FormData(event.currentTarget).get("q") ?? "",
                  ).trim(),
                );
              }}
            >
              <label>
                Situação
                <select
                  aria-label="Filtrar situação dos recebimentos"
                  value={status}
                  onChange={(event) => {
                    setStatus(event.target.value);
                    setPage(1);
                  }}
                >
                  <option value="ALL">Todas as situações</option>
                  {Object.entries(RECEIPT_LABELS).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Ordem ou material
                <input
                  name="q"
                  maxLength={100}
                  placeholder="Buscar código ou material"
                />
              </label>
              <button className="button secondary">Buscar</button>
            </form>
            {loading ? (
              <Loading />
            ) : result?.items.length ? (
              <>
                <ul className="receipt-cards">
                  {result.items.map((row) => (
                    <li key={row.id}>
                      <div className="receipt-card-heading">
                        <Badge tone={tone(row.status)}>
                          {RECEIPT_LABELS[row.status]}
                        </Badge>
                        <small>{dateTime(row.deliveredAt)}</small>
                      </div>
                      <h2>
                        {row.productCode} · {row.productName}
                      </h2>
                      <p>
                        {row.orderKind === "SERVICE" ? "O.S." : "O.P."}{" "}
                        {row.orderCode} · {row.orderTitle}
                      </p>
                      <dl className="receipt-facts">
                        <div>
                          <dt>Entrega registrada</dt>
                          <dd>
                            {qty(row.expectedQuantity)} {row.unit} ·{" "}
                            {row.locationCode}
                          </dd>
                        </div>
                        <div>
                          <dt>Quem entregou</dt>
                          <dd>{row.deliveredByName}</dd>
                        </div>
                        <div>
                          <dt>Destinatário</dt>
                          <dd>
                            {row.recipientName ??
                              "Não identificado no registro"}
                          </dd>
                        </div>
                      </dl>
                      {row.recipientId && !row.recipientActive && (
                        <p className="receipt-warning">
                          A conta indicada não tem acesso ativo a esta unidade.
                          Revise o acesso com o administrador.
                        </p>
                      )}
                      <button
                        className="button secondary"
                        onClick={() => void open(row.id)}
                      >
                        Conferir entrega <ArrowRight size={15} />
                      </button>
                    </li>
                  ))}
                </ul>
                <div className="toolbar">
                  <button
                    className="button secondary"
                    disabled={page <= 1}
                    onClick={() => setPage(page - 1)}
                  >
                    Anterior
                  </button>
                  <span>
                    {result.total} entregas · página {page}
                  </span>
                  <button
                    className="button secondary"
                    disabled={page * 25 >= result.total}
                    onClick={() => setPage(page + 1)}
                  >
                    Próxima
                  </button>
                </div>
              </>
            ) : (
              result &&
              !error && (
                <Empty
                  title="Nenhuma entrega neste filtro"
                  description="Uma entrega vinculada à sua conta aparecerá aqui. As entregas sem conta vinculada ficam disponíveis no acompanhamento da unidade."
                />
              )
            )}
          </section>
        </>
      )}
      {item && (
        <section className="panel receipt-detail">
          <div className="receipt-card-heading">
            <Badge tone={tone(item.status)}>
              {RECEIPT_LABELS[item.status]}
            </Badge>
            <small>Entrega de {dateTime(item.deliveredAt)}</small>
          </div>
          <h2>
            {item.productCode} · {item.productName}
          </h2>
          <p>
            {item.orderKind === "SERVICE" ? "O.S." : "O.P."} {item.orderCode} ·{" "}
            {item.orderTitle}
          </p>
          <dl className="receipt-facts">
            <div>
              <dt>Quantidade declarada na entrega</dt>
              <dd>
                {qty(item.expectedQuantity)} {item.unit}
              </dd>
            </div>
            <div>
              <dt>Local de retirada</dt>
              <dd>{item.locationCode}</dd>
            </div>
            <div>
              <dt>Quem entregou</dt>
              <dd>{item.deliveredByName}</dd>
            </div>
            <div>
              <dt>Destinatário indicado</dt>
              <dd>{item.recipientName ?? "Sem identificação"}</dd>
            </div>
          </dl>
          {item.receivedQuantity !== null && (
            <div className="receipt-observation">
              <h3>Quantidade informada pelo destinatário</h3>
              <strong>
                {qty(item.receivedQuantity)} {item.unit}
              </strong>
              <p>
                Material confere: {item.materialMatches ? "sim" : "não"}. O
                relato permanece no histórico, inclusive após o aceite de um
                tratamento.
              </p>
            </div>
          )}
          {item.note && (
            <div className="receipt-observation">
              <h3>Último registro</h3>
              <p className="receipt-prose">{item.note}</p>
              {item.reference && <p>Referência: {item.reference}</p>}
            </div>
          )}
          {item.status === "UNLINKED" && (
            <div className="notice warning">
              Esta entrega não tem uma conta do ERP vinculada ao destinatário. A
              identificação continua sendo uma declaração do operador; não há
              confirmação autenticada. Entregas anteriores não são vinculadas
              automaticamente.
            </div>
          )}
          {item.recipientId && !item.recipientActive && (
            <div className="notice warning">
              A conta indicada precisa de acesso ativo nesta unidade para
              responder.
            </div>
          )}
          <div className="receipt-actions">
            {item.canRespond && item.status === "PENDING" && (
              <>
                <button
                  className="button primary"
                  onClick={() => setAction("CONFIRM")}
                >
                  Confirmar recebimento
                </button>
                <button
                  className="button secondary"
                  onClick={() => setAction("DISPUTE")}
                >
                  Informar divergência
                </button>
              </>
            )}
            {item.canTreat && item.status === "DISPUTED" && (
              <button
                className="button primary"
                onClick={() => setAction("PROPOSE")}
              >
                Registrar tratamento
              </button>
            )}
            {item.canRespond && item.status === "PROPOSED" && (
              <>
                <button
                  className="button primary"
                  onClick={() => setAction("ACCEPT")}
                >
                  Aceitar tratamento
                </button>
                <button
                  className="button secondary"
                  onClick={() => setAction("REJECT")}
                >
                  Devolver para revisão
                </button>
              </>
            )}
            {canMonitor && (
              <button
                className="button secondary"
                onClick={() => onOpenOrder(item.orderId, item.orderKind)}
              >
                Abrir ordem <ArrowRight size={15} />
              </button>
            )}
          </div>
          {!item.canRespond && item.status === "PENDING" && (
            <p className="receipt-caption">
              A resposta deve ser feita pelo destinatário indicado, na própria
              conta.
            </p>
          )}
          <div className="receipt-history">
            <h3>Histórico de respostas</h3>
            {detail.history.length ? (
              <ol>
                {detail.history.map((entry) => (
                  <li key={entry.id}>
                    <strong>{eventLabels[entry.type] ?? entry.type}</strong>
                    <small>
                      {entry.user.name} · {dateTime(entry.createdAt)}
                    </small>
                    {entry.receivedQuantity !== null && (
                      <p>
                        Relato de recebimento: {qty(entry.receivedQuantity)}{" "}
                        {item.unit} · material confere:{" "}
                        {entry.materialMatches ? "sim" : "não"}
                      </p>
                    )}
                    <p className="receipt-prose">{entry.note}</p>
                    {entry.reference && <p>Referência: {entry.reference}</p>}
                  </li>
                ))}
              </ol>
            ) : (
              <p>Aguardando a primeira resposta do destinatário.</p>
            )}
            {detail.truncated && (
              <small>Exibindo os 100 registros mais recentes.</small>
            )}
          </div>
        </section>
      )}
      <p className="receipt-footnote">
        <PackageCheck size={17} /> Confirmar ou relatar uma diferença registra
        sua declaração. As quantidades da ordem, a baixa no faturamento e as
        devoluções continuam nos respectivos fluxos. Nenhum recebimento é
        confirmado automaticamente.
      </p>
      {action && item && (
        <ResponseForm
          key={`${item.id}:${item.version}:${action}`}
          item={item}
          action={action}
          onClose={() => setAction(null)}
          onRefresh={() => {
            setAction(null);
            void open(item.id);
            void load();
          }}
          onDone={async () => {
            setAction(null);
            await Promise.all([open(item.id), load()]);
            setNotice(
              "Resposta registrada no histórico. O estoque não foi movimentado por esta confirmação.",
            );
          }}
        />
      )}
    </div>
  );
}

function ResponseForm({
  item,
  action,
  onClose,
  onDone,
  onRefresh,
}: {
  item: DeliveryReceipt;
  action: Action;
  onClose: () => void;
  onDone: () => Promise<void>;
  onRefresh: () => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const commands = useRef(new Map<string, string>());
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = new FormData(event.currentTarget);
    const body = {
      action,
      expectedVersion: item.version,
      ...(action === "DISPUTE"
        ? {
            receivedQuantity: String(
              form.get("receivedQuantity") ?? "",
            ).replace(",", "."),
            materialMatches: form.get("materialMatches") === "true",
          }
        : {}),
      ...(action !== "CONFIRM" ? { note: String(form.get("note") ?? "") } : {}),
      ...(action === "PROPOSE"
        ? { reference: String(form.get("reference") ?? "") }
        : {}),
    };
    const signature = JSON.stringify(body),
      key = commands.current.get(signature) ?? crypto.randomUUID();
    commands.current.set(signature, key);
    setBusy(true);
    setError("");
    try {
      await api(`/api/delivery-receipts/${item.id}`, {
        method: "POST",
        body: JSON.stringify({ ...body, idempotencyKey: key }),
      });
      await onDone();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={actionLabels[action]}
      subtitle={`${item.orderCode} · ${item.productCode}`}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form className="modal-body receipt-response-form" onSubmit={submit}>
        <div className="receipt-observation">
          <strong>{item.productName}</strong>
          <p>
            Entrega declarada: {qty(item.expectedQuantity)} {item.unit} ·{" "}
            {item.locationCode}
          </p>
          <p>
            Entregou: {item.deliveredByName} · Destinatário:{" "}
            {item.recipientName}
          </p>
        </div>
        {action === "DISPUTE" && (
          <>
            <label>
              Quantidade que você recebeu
              <input
                name="receivedQuantity"
                required
                inputMode="decimal"
                pattern="[0-9]+([.,][0-9]{1,3})?"
                maxLength={19}
                placeholder="Pode ser zero"
              />
            </label>
            <label>
              O material corresponde ao indicado?
              <select
                name="materialMatches"
                aria-label="O material corresponde ao indicado?"
                required
                defaultValue=""
              >
                <option value="">Selecione</option>
                <option value="true">Sim, o material confere</option>
                <option value="false">Não, recebi outro material</option>
              </select>
            </label>
          </>
        )}
        {action === "PROPOSE" && (
          <>
            <div className="notice info">
              Descreva a conferência e as providências realizadas. Se houver
              correção de estoque, registre-a no fluxo autorizado e indique sua
              referência. O destinatário ainda precisará aceitar este
              tratamento.
            </div>
            <label>
              Referência da conferência ou providência
              <input
                name="reference"
                required
                minLength={3}
                maxLength={200}
                placeholder="Ordem, contagem ou outro registro verificável"
              />
            </label>
          </>
        )}
        {action !== "CONFIRM" && (
          <label>
            {action === "DISPUTE"
              ? "O que veio diferente"
              : action === "PROPOSE"
                ? "Como a divergência foi tratada"
                : action === "ACCEPT"
                  ? "O que você conferiu para aceitar o tratamento"
                  : "O que ainda precisa ser revisto"}
            <textarea
              name="note"
              required
              minLength={10}
              maxLength={2000}
              rows={4}
            />
          </label>
        )}
        {action === "ACCEPT" && (
          <p className="receipt-caption">
            O aceite encerra este acompanhamento. A divergência original e a
            quantidade que você informou permanecem registradas; o aceite não
            declara recebimento integral retroativo.
          </p>
        )}
        <label className="receipt-check">
          <input type="checkbox" required />
          {action === "CONFIRM"
            ? `Conferi o material e recebi integralmente ${qty(item.expectedQuantity)} ${item.unit}.`
            : "Conferi os dados e quero registrar esta resposta na minha conta."}
        </label>
        {error && (
          <div className="notice error" role="alert">
            {error}
            <button
              type="button"
              className="text-button"
              disabled={busy}
              onClick={onRefresh}
            >
              Fechar e atualizar
            </button>
          </div>
        )}
        <div className="modal-actions">
          <button
            type="button"
            className="button secondary"
            disabled={busy}
            onClick={onClose}
          >
            Cancelar
          </button>
          <button className="button primary" disabled={busy}>
            {busy ? "Registrando…" : actionLabels[action]}
          </button>
        </div>
      </form>
    </Modal>
  );
}
