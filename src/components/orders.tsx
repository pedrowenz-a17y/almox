"use client";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Plus, RefreshCw } from "lucide-react";
import { api, DataSet, dateTime, locationPath, qty } from "@/lib/client";
import { Badge, Empty, Loading, Modal } from "@/components/ui";

type OrderKind = "SERVICE" | "PRODUCTION";
type OrderAction =
  | "REQUEST"
  | "RESERVE"
  | "RELEASE"
  | "APPLY"
  | "RETURN"
  | "INVOICE"
  | "CANCEL";
interface Material {
  id: string;
  productId: string;
  locationId: string;
  requestedQuantity: string;
  reservedQuantity: string;
  appliedQuantity: string;
  consumedQuantity: string;
  returnedQuantity: string;
  product: { id: string; name: string; internalCode: string; unit: string };
  location: { id: string; name: string; code: string };
}
interface Order {
  id: string;
  code: string;
  title: string;
  kind: OrderKind;
  status: "OPEN" | "INVOICED" | "CANCELLED";
  description?: string;
  invoiceReference?: string;
  invoicedAt?: string;
  createdAt: string;
  user?: { id: string; name: string };
  materials: Material[];
  events: {
    id: string;
    type: string;
    quantity?: string;
    note?: string;
    reference?: string;
    createdAt: string;
    user?: { name: string };
  }[];
}
interface Page {
  items: Order[];
  total: number;
  page: number;
  pageSize: number;
}
const labels: Record<OrderAction, string> = {
  REQUEST: "Requisitar material",
  RESERVE: "Reservar",
  RELEASE: "Liberar reserva",
  APPLY: "Registrar aplicação",
  RETURN: "Registrar devolução",
  INVOICE: "Confirmar faturamento",
  CANCEL: "Cancelar ordem",
};
const stateLabels = {
  OPEN: "Em andamento",
  INVOICED: "Faturamento confirmado",
  CANCELLED: "Cancelada",
};
const eventLabels: Record<string, string> = {
  CREATED: "Ordem criada",
  REQUESTED: "Material requisitado",
  RESERVED: "Material reservado",
  RELEASED: "Reserva liberada",
  APPLIED: "Material aplicado",
  RETURNED: "Material devolvido",
  RETURNED_BEFORE_INVOICE: "Devolução antes do faturamento",
  RETURNED_AFTER_INVOICE: "Devolução após o faturamento",
  CONSUMED: "Consumo registrado",
  INVOICED: "Faturamento confirmado",
  CANCELLED: "Ordem cancelada",
};
const permissionFor = (action: OrderAction) =>
  action === "INVOICE"
    ? "orders:invoice"
    : ["APPLY", "RETURN"].includes(action)
      ? "orders:apply"
      : "orders:write";

export default function Orders({
  kind,
  data,
  permissions,
  onRefresh,
}: {
  kind: OrderKind;
  data: DataSet;
  permissions: string[];
  onRefresh: () => Promise<void>;
}) {
  const [result, setResult] = useState<Page | null>(null);
  const [selected, setSelected] = useState<Order | null>(null);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [creating, setCreating] = useState(false);
  const [action, setAction] = useState<{
    type: OrderAction;
    material?: Material;
    key: string;
  } | null>(null);
  const can = (permission: string) => permissions.includes(permission);
  const pendingRequest =
    selected?.materials.some(
      (material) =>
        Math.round(
          (Number(material.requestedQuantity) -
            Number(material.appliedQuantity) -
            Number(material.consumedQuantity) +
            Number(material.returnedQuantity)) *
            1000,
        ) > 0,
    ) ?? false;
  const title = kind === "SERVICE" ? "Ordens de Serviço" : "Ordens de Produção";
  useEffect(() => {
    const timer = setTimeout(() => {
      if (query !== search.trim()) {
        setLoading(true);
        setError("");
        setQuery(search.trim());
        setPage(1);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [search, query]);
  const load = useCallback(
    (signal?: AbortSignal) => {
      return api<Page>(
        `/api/orders?${new URLSearchParams({ kind, q: query, page: String(page), pageSize: "25" })}`,
        { signal },
      )
        .then((next) => {
          if (!signal?.aborted) {
            setResult(next);
            setError("");
          }
        })
        .catch((cause) => {
          if (!signal?.aborted) {
            setResult(null);
            setError(
              cause instanceof Error
                ? cause.message
                : "Não foi possível consultar as ordens.",
            );
          }
        })
        .finally(() => {
          if (!signal?.aborted) setLoading(false);
        });
    },
    [kind, query, page],
  );
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);
  async function open(order: Order) {
    setError("");
    try {
      setSelected(await api<Order>(`/api/orders/${order.id}`));
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Não foi possível abrir a ordem.",
      );
    }
  }
  const begin = (type: OrderAction, material?: Material) =>
    setAction({ type, material, key: crypto.randomUUID() });
  async function changed(order: Order, message: string) {
    setSelected(order);
    setAction(null);
    setCreating(false);
    setNotice(message);
    await load();
    await onRefresh();
  }
  if (!can("orders:read"))
    return (
      <Empty
        title="Acesso restrito"
        description="Seu perfil não permite consultar ordens nesta unidade."
      />
    );
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">MATERIAIS VINCULADOS À OPERAÇÃO</span>
          <h1>{selected ? selected.code : title}</h1>
          <p>
            {selected
              ? selected.title
              : "Requisições, reservas, aplicações e baixas rastreáveis por ordem."}
          </p>
        </div>
        <div className="heading-actions">
          {selected ? (
            <button
              className="button secondary"
              onClick={() => {
                setSelected(null);
                setNotice("");
              }}
            >
              <ArrowLeft size={17} />
              Todas as ordens
            </button>
          ) : (
            can("orders:write") && (
              <button
                className="button primary"
                onClick={() => setCreating(true)}
              >
                <Plus size={17} />
                Nova {kind === "SERVICE" ? "O.S." : "O.P."}
              </button>
            )
          )}
        </div>
      </div>
      {error && (
        <div className="notice error" role="alert">
          {error}
          <button
            className="text-button"
            onClick={() => {
              setLoading(true);
              setError("");
              void load();
            }}
          >
            Tentar novamente
          </button>
        </div>
      )}
      {notice && (
        <div className="notice info" role="status">
          {notice}
        </div>
      )}
      {selected ? (
        <>
          <section className="panel workflow-summary">
            <div>
              <Badge
                tone={
                  selected.status === "OPEN"
                    ? "info"
                    : selected.status === "CANCELLED"
                      ? "danger"
                      : "success"
                }
              >
                {stateLabels[selected.status]}
              </Badge>
              <p>{selected.description || "Sem descrição complementar."}</p>
              <small>
                Criada em {dateTime(selected.createdAt)} ·{" "}
                {selected.user?.name || "Responsável registrado no histórico"}
              </small>
              {selected.invoiceReference && (
                <p>
                  Documento de faturamento:{" "}
                  <strong>{selected.invoiceReference}</strong>
                </p>
              )}
            </div>
            <div className="workflow-actions">
              {selected.status === "OPEN" && (
                <>
                  {can("orders:write") && (
                    <button
                      className="button primary"
                      onClick={() => begin("REQUEST")}
                    >
                      Requisitar material
                    </button>
                  )}
                  {can("orders:invoice") && (
                    <button
                      className="button secondary"
                      disabled={
                        pendingRequest ||
                        !selected.materials.some(
                          (material) => Number(material.appliedQuantity) > 0,
                        )
                      }
                      onClick={() => begin("INVOICE")}
                    >
                      Confirmar faturamento
                    </button>
                  )}
                  {can("orders:write") && (
                    <button
                      className="button secondary"
                      onClick={() => begin("CANCEL")}
                    >
                      Cancelar ordem
                    </button>
                  )}
                </>
              )}
            </div>
          </section>
          {selected.status === "OPEN" && pendingRequest && (
            <div className="notice warning">
              Faturamento bloqueado: todos os materiais requisitados precisam
              estar integralmente aplicados. Reservas liberadas continuam
              pendentes de atendimento.
            </div>
          )}
          <p className="workflow-help">
            A reserva compromete a disponibilidade. A aplicação retira o
            material do local físico e mantém a baixa definitiva pendente até a
            confirmação do faturamento.
          </p>
          <section className="panel">
            <div className="panel-heading">
              <h2>Materiais da ordem</h2>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Material / localização</th>
                    <th className="numeric">Requisitado</th>
                    <th className="numeric">Reservado</th>
                    <th className="numeric">Aplicado, sem baixa</th>
                    <th className="numeric">Baixado</th>
                    <th className="numeric">Devolvido</th>
                    <th>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {selected.materials.map((material) => (
                    <tr key={material.id}>
                      <td>
                        <strong>{material.product.name}</strong>
                        <small>
                          {material.product.internalCode} ·{" "}
                          {material.location.code} · {material.product.unit}
                        </small>
                      </td>
                      <td className="numeric">
                        {qty(material.requestedQuantity)}
                      </td>
                      <td className="numeric">
                        {qty(material.reservedQuantity)}
                      </td>
                      <td className="numeric">
                        {qty(material.appliedQuantity)}
                      </td>
                      <td className="numeric">
                        {qty(material.consumedQuantity)}
                      </td>
                      <td className="numeric">
                        {qty(material.returnedQuantity)}
                      </td>
                      <td>
                        <div className="workflow-row-actions">
                          {(selected.status === "OPEN"
                            ? ([
                                "RESERVE",
                                "RELEASE",
                                "APPLY",
                                "RETURN",
                              ] as OrderAction[])
                            : selected.status === "INVOICED"
                              ? (["RETURN"] as OrderAction[])
                              : []
                          )
                            .filter((type) => can(permissionFor(type)))
                            .map((type) => (
                              <button
                                key={type}
                                className="button secondary small"
                                onClick={() => begin(type, material)}
                              >
                                {labels[type]}
                              </button>
                            ))}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!selected.materials.length && (
                <Empty
                  title="Nenhum material requisitado"
                  description="Adicione os materiais e os locais de retirada para iniciar o atendimento desta ordem."
                />
              )}
            </div>
          </section>
          <section className="panel">
            <div className="panel-heading">
              <h2>Histórico da ordem</h2>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Data</th>
                    <th>Evento</th>
                    <th>Quantidade</th>
                    <th>Responsável</th>
                    <th>Documento / motivo</th>
                  </tr>
                </thead>
                <tbody>
                  {selected.events.map((event) => (
                    <tr key={event.id}>
                      <td>{dateTime(event.createdAt)}</td>
                      <td>{eventLabels[event.type] || event.type}</td>
                      <td>
                        {event.quantity == null ? "—" : qty(event.quantity)}
                      </td>
                      <td>{event.user?.name || "—"}</td>
                      <td>
                        {event.reference || "—"}
                        <small>{event.note}</small>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!selected.events.length && (
                <Empty title="Nenhum evento registrado" />
              )}
            </div>
          </section>
        </>
      ) : (
        <section className="panel">
          <div className="toolbar">
            <div className="table-search">
              <input
                aria-label="Buscar ordens"
                placeholder="Código ou descrição da ordem"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
            <button
              className="button secondary"
              aria-label="Atualizar ordens"
              onClick={() => {
                setLoading(true);
                setError("");
                void load();
              }}
              disabled={loading}
            >
              <RefreshCw size={17} />
            </button>
          </div>
          {loading ? (
            <Loading />
          ) : (
            result && (
              <>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Código / ordem</th>
                        <th>Situação</th>
                        <th>Responsável</th>
                        <th>Cadastro</th>
                        <th>Ações</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.items.map((order) => (
                        <tr key={order.id}>
                          <td>
                            <strong>{order.code}</strong>
                            <small>{order.title}</small>
                          </td>
                          <td>
                            <Badge
                              tone={
                                order.status === "OPEN"
                                  ? "info"
                                  : order.status === "CANCELLED"
                                    ? "danger"
                                    : "success"
                              }
                            >
                              {stateLabels[order.status]}
                            </Badge>
                          </td>
                          <td>{order.user?.name || "—"}</td>
                          <td>{dateTime(order.createdAt)}</td>
                          <td>
                            <button
                              className="button secondary small"
                              onClick={() => void open(order)}
                            >
                              Abrir ordem
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!result.items.length && (
                    <Empty
                      title={
                        query
                          ? "Nenhuma ordem corresponde à busca"
                          : "Nenhuma ordem nesta unidade"
                      }
                      description={
                        query
                          ? "Revise o código ou a descrição pesquisada."
                          : "Cadastre uma O.S. ou O.P. real para rastrear a aplicação dos materiais."
                      }
                    />
                  )}
                </div>
                <div className="table-footer pagination">
                  <span>
                    {result.total} ordens · página {result.page}
                  </span>
                  <div>
                    <button
                      className="button secondary small"
                      disabled={page <= 1}
                      onClick={() => {
                        setLoading(true);
                        setPage(page - 1);
                      }}
                    >
                      Anterior
                    </button>
                    <button
                      className="button secondary small"
                      disabled={page * result.pageSize >= result.total}
                      onClick={() => {
                        setLoading(true);
                        setPage(page + 1);
                      }}
                    >
                      Próxima
                    </button>
                  </div>
                </div>
              </>
            )
          )}
        </section>
      )}
      {creating && (
        <CreateOrder
          kind={kind}
          onClose={() => setCreating(false)}
          onDone={(order) => changed(order, "Ordem registrada.")}
        />
      )}
      {action && selected && (
        <ActionForm
          action={action}
          order={selected}
          data={data}
          onClose={() => setAction(null)}
          onDone={(order) =>
            changed(order, "Operação registrada no histórico da ordem.")
          }
        />
      )}
    </>
  );
}

function CreateOrder({
  kind,
  onClose,
  onDone,
}: {
  kind: OrderKind;
  onClose: () => void;
  onDone: (order: Order) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [key] = useState(() => crypto.randomUUID());
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      const order = await api<Order>("/api/orders", {
        method: "POST",
        body: JSON.stringify({
          code: form.get("code"),
          title: form.get("title"),
          description: form.get("description"),
          kind,
          idempotencyKey: key,
        }),
      });
      await onDone(order);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Não foi possível registrar a ordem.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={`Nova ${kind === "SERVICE" ? "Ordem de Serviço" : "Ordem de Produção"}`}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form className="modal-body" onSubmit={submit}>
        <label>
          Código da ordem
          <input name="code" required maxLength={80} />
        </label>
        <label>
          Descrição resumida
          <input name="title" required minLength={2} maxLength={200} />
        </label>
        <label>
          Detalhes
          <textarea name="description" maxLength={2000} rows={3} />
        </label>
        {error && (
          <div className="notice error" role="alert">
            {error}
          </div>
        )}
        <div className="modal-actions">
          <button
            className="button secondary"
            type="button"
            disabled={busy}
            onClick={onClose}
          >
            Cancelar
          </button>
          <button className="button primary" disabled={busy}>
            {busy ? "Registrando…" : "Criar ordem"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function ActionForm({
  action,
  order,
  data,
  onClose,
  onDone,
}: {
  action: { type: OrderAction; material?: Material; key: string };
  order: Order;
  data: DataSet;
  onClose: () => void;
  onDone: (order: Order) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [review, setReview] = useState<Record<
    string,
    FormDataEntryValue
  > | null>(null);
  const [draft, setDraft] = useState<Record<string, FormDataEntryValue>>({});
  const [productId, setProductId] = useState("");
  const product = data.products.find((product) => product.id === productId);
  const quantityAction = !["INVOICE", "CANCEL"].includes(action.type);
  async function confirm() {
    if (!review || busy) return;
    setBusy(true);
    setError("");
    try {
      const updated = await api<Order>(`/api/orders/${order.id}/actions`, {
        method: "POST",
        body: JSON.stringify({
          ...review,
          action: action.type,
          materialId: action.material?.id,
          idempotencyKey: action.key,
        }),
      });
      await onDone(updated);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Não foi possível registrar a operação.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={labels[action.type]}
      subtitle={`${order.code} · ${action.material?.product.name || order.title}`}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form
        className="modal-body"
        onSubmit={(event) => {
          event.preventDefault();
          setError("");
          const values = Object.fromEntries(
            new FormData(event.currentTarget).entries(),
          );
          setDraft(values);
          setReview(values);
        }}
      >
        {review ? (
          <>
            <div className="review-balance">
              <h3>Confira antes de confirmar</h3>
              <p>
                {labels[action.type]} · {order.code}
              </p>
              {review.quantity && (
                <p>
                  Quantidade:{" "}
                  <strong>
                    {String(review.quantity)}{" "}
                    {action.material?.product.unit || product?.unit}
                  </strong>
                </p>
              )}
              {review.productId && (
                <p>
                  Material:{" "}
                  {
                    data.products.find(
                      (product) => product.id === review.productId,
                    )?.name
                  }
                </p>
              )}
              {review.locationId && (
                <p>Local: {locationPath(data, String(review.locationId))}</p>
              )}
              {review.reference && <p>Documento: {String(review.reference)}</p>}
              <p>{String(review.note || "Sem observação complementar.")}</p>
            </div>
            <div className="notice info">
              A operação será confirmada pelo servidor e ficará registrada no
              histórico.
            </div>
          </>
        ) : (
          <>
            {action.type === "REQUEST" && (
              <>
                <label>
                  Material
                  <select
                    name="productId"
                    required
                    value={productId}
                    onChange={(event) => setProductId(event.target.value)}
                  >
                    <option value="">Selecione</option>
                    {data.products
                      .filter((product) => product.active)
                      .map((product) => (
                        <option key={product.id} value={product.id}>
                          {product.internalCode} · {product.name}
                        </option>
                      ))}
                  </select>
                </label>
                <label>
                  Local de retirada
                  <select
                    name="locationId"
                    required
                    defaultValue={String(draft.locationId || "")}
                  >
                    <option value="">Selecione</option>
                    {data.locations
                      .filter((location) => location.active)
                      .map((location) => (
                        <option key={location.id} value={location.id}>
                          {locationPath(data, location.id)}
                        </option>
                      ))}
                  </select>
                </label>
              </>
            )}
            {quantityAction && (
              <label>
                Quantidade{" "}
                {action.material
                  ? `(${action.material.product.unit})`
                  : product
                    ? `(${product.unit})`
                    : ""}
                <input
                  name="quantity"
                  defaultValue={String(draft.quantity || "")}
                  type="number"
                  inputMode="decimal"
                  min="0.001"
                  step="0.001"
                  required
                />
              </label>
            )}
            {action.type === "INVOICE" && (
              <>
                <div className="notice warning">
                  Confirmação manual do faturamento. Os materiais aplicados
                  receberão a baixa definitiva uma única vez. Esta operação não
                  emite nota fiscal. Todos os materiais requisitados precisam
                  estar integralmente aplicados antes de confirmar.
                </div>
                <label>
                  Documento / referência do faturamento
                  <input
                    name="reference"
                    defaultValue={String(draft.reference || "")}
                    required
                    minLength={3}
                    maxLength={150}
                  />
                </label>
              </>
            )}
            {action.type === "CANCEL" && (
              <div className="notice warning">
                As reservas serão liberadas. Materiais aplicados precisam ser
                devolvidos antes do cancelamento.
              </div>
            )}
            {action.type === "RETURN" && (
              <div className="notice info">
                Antes do faturamento, a devolução reverte a aplicação. Depois do
                faturamento, gera uma entrada de compensação vinculada à baixa
                original.
              </div>
            )}
            {action.type === "APPLY" && (
              <div className="notice info">
                A aplicação usa a quantidade reservada. A baixa definitiva
                permanece pendente até a confirmação do faturamento.
              </div>
            )}
            <label>
              Motivo / observação
              {action.type === "CANCEL" ? " (obrigatório)" : ""}
              <textarea
                name="note"
                defaultValue={String(draft.note || "")}
                required={action.type === "CANCEL"}
                minLength={action.type === "CANCEL" ? 3 : undefined}
                maxLength={2000}
                rows={3}
              />
            </label>
          </>
        )}
        {error && (
          <div className="notice error" role="alert">
            {error}
          </div>
        )}
        <div className="modal-actions">
          <button
            type="button"
            className="button secondary"
            disabled={busy}
            onClick={() => (review ? setReview(null) : onClose())}
          >
            {review ? "Voltar" : "Cancelar"}
          </button>
          {review ? (
            <button
              type="button"
              className="button primary"
              disabled={busy}
              onClick={() => void confirm()}
            >
              {busy ? "Registrando…" : "Confirmar operação"}
            </button>
          ) : (
            <button className="button primary">Revisar operação</button>
          )}
        </div>
      </form>
    </Modal>
  );
}
