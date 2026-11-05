"use client";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Plus, RefreshCw, Trash2 } from "lucide-react";
import { api, DataSet, dateTime, locationPath, money, qty } from "@/lib/client";
import { Badge, Empty, Loading, Modal } from "@/components/ui";

interface PurchaseItem {
  id: string;
  productId: string;
  orderedQuantity: string;
  receivedQuantity: string;
  unitCost?: string | null;
  product: { name: string; internalCode: string; unit: string };
}
interface Purchase {
  id: string;
  code: string;
  title?: string;
  description?: string;
  status: "OPEN" | "COMPLETED" | "CANCELLED";
  createdAt: string;
  supplier: { legalName: string; tradeName?: string };
  items: PurchaseItem[];
  receipts: {
    id: string;
    documentReference: string;
    note?: string;
    createdAt: string;
    user?: { name: string };
    items: {
      id: string;
      quantity: string;
      locationId: string;
      productId: string;
    }[];
  }[];
}
interface Page {
  items: Purchase[];
  total: number;
  page: number;
  pageSize: number;
}
const statuses = {
  OPEN: "Em recebimento",
  COMPLETED: "Recebido",
  CANCELLED: "Cancelado",
};

export default function Purchases({
  data,
  permissions,
  onRefresh,
}: {
  data: DataSet;
  permissions: string[];
  onRefresh: () => Promise<void>;
}) {
  const [result, setResult] = useState<Page | null>(null);
  const [selected, setSelected] = useState<Purchase | null>(null);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [creating, setCreating] = useState(false);
  const [action, setAction] = useState<"receive" | "cancel" | null>(null);
  const can = (permission: string) => permissions.includes(permission);
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
        `/api/purchases?${new URLSearchParams({ q: query, page: String(page), pageSize: "25" })}`,
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
                : "Não foi possível consultar as compras.",
            );
          }
        })
        .finally(() => {
          if (!signal?.aborted) setLoading(false);
        });
    },
    [query, page],
  );
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);
  async function open(id: string) {
    setError("");
    try {
      setSelected(await api<Purchase>(`/api/purchases/${id}`));
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Não foi possível abrir o pedido.",
      );
    }
  }
  async function changed(purchase: Purchase, message: string) {
    setSelected(purchase);
    setCreating(false);
    setAction(null);
    setNotice(message);
    await load();
    await onRefresh();
  }
  if (!can("purchases:read"))
    return (
      <Empty
        title="Acesso restrito"
        description="Seu perfil não permite consultar compras nesta unidade."
      />
    );
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">COMPRAS E CONFERÊNCIA DE MATERIAIS</span>
          <h1>{selected ? selected.code : "Compras e recebimentos"}</h1>
          <p>
            {selected
              ? selected.title || "Pedido de compra"
              : "Documentos recebidos, quantidades conferidas e entradas rastreáveis."}
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
              Todos os pedidos
            </button>
          ) : (
            can("purchases:write") && (
              <button
                className="button primary"
                onClick={() => setCreating(true)}
              >
                <Plus size={17} />
                Novo pedido
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
                  selected.status === "COMPLETED"
                    ? "success"
                    : selected.status === "CANCELLED"
                      ? "danger"
                      : "info"
                }
              >
                {statuses[selected.status]}
              </Badge>
              <h2>
                {selected.supplier.tradeName || selected.supplier.legalName}
              </h2>
              <p>{selected.description || "Sem observação complementar."}</p>
              <small>Pedido registrado em {dateTime(selected.createdAt)}</small>
            </div>
            <div className="workflow-actions">
              {selected.status === "OPEN" && (
                <>
                  {can("purchases:receive") && (
                    <button
                      className="button primary"
                      onClick={() => setAction("receive")}
                    >
                      Conferir recebimento
                    </button>
                  )}
                  {can("purchases:write") && !selected.receipts.length && (
                    <button
                      className="button secondary"
                      onClick={() => setAction("cancel")}
                    >
                      Cancelar pedido
                    </button>
                  )}
                </>
              )}
            </div>
          </section>
          <section className="panel">
            <div className="panel-heading">
              <h2>Itens do pedido</h2>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Material</th>
                    <th className="numeric">Pedido</th>
                    <th className="numeric">Recebido</th>
                    {can("costs:read") && (
                      <th className="numeric">Custo unitário informado</th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {selected.items.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <strong>{item.product.name}</strong>
                        <small>
                          {item.product.internalCode} · {item.product.unit}
                        </small>
                      </td>
                      <td className="numeric">{qty(item.orderedQuantity)}</td>
                      <td className="numeric">{qty(item.receivedQuantity)}</td>
                      {can("costs:read") && (
                        <td className="numeric">
                          {item.unitCost == null
                            ? "Não informado"
                            : money(item.unitCost)}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <section className="panel">
            <div className="panel-heading">
              <h2>Recebimentos conferidos</h2>
            </div>
            {selected.receipts.map((receipt) => (
              <div className="receipt-record" key={receipt.id}>
                <div className="receipt-heading">
                  <strong>{receipt.documentReference}</strong>
                  <span>
                    {dateTime(receipt.createdAt)} · {receipt.user?.name || "—"}
                  </span>
                </div>
                {receipt.note && <p>{receipt.note}</p>}
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Material</th>
                        <th>Destino</th>
                        <th className="numeric">Quantidade recebida</th>
                      </tr>
                    </thead>
                    <tbody>
                      {receipt.items.map((item) => (
                        <tr key={item.id}>
                          <td>
                            {data.products.find(
                              (product) => product.id === item.productId,
                            )?.name || item.productId}
                          </td>
                          <td>{locationPath(data, item.locationId)}</td>
                          <td className="numeric">{qty(item.quantity)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
            {!selected.receipts.length && (
              <Empty
                title="Nenhum recebimento confirmado"
                description="Confira o material e informe o documento recebido para registrar a entrada no estoque."
              />
            )}
          </section>
        </>
      ) : (
        <section className="panel">
          <div className="toolbar">
            <div className="table-search">
              <input
                aria-label="Buscar pedidos de compra"
                placeholder="Código, descrição ou fornecedor"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
            <button
              className="button secondary"
              aria-label="Atualizar compras"
              disabled={loading}
              onClick={() => {
                setLoading(true);
                setError("");
                void load();
              }}
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
                        <th>Pedido</th>
                        <th>Fornecedor</th>
                        <th>Situação</th>
                        <th>Cadastro</th>
                        <th>Ações</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.items.map((purchase) => (
                        <tr key={purchase.id}>
                          <td>
                            <strong>{purchase.code}</strong>
                            <small>{purchase.title}</small>
                          </td>
                          <td>
                            {purchase.supplier.tradeName ||
                              purchase.supplier.legalName}
                          </td>
                          <td>
                            <Badge
                              tone={
                                purchase.status === "COMPLETED"
                                  ? "success"
                                  : purchase.status === "CANCELLED"
                                    ? "danger"
                                    : "info"
                              }
                            >
                              {statuses[purchase.status]}
                            </Badge>
                          </td>
                          <td>{dateTime(purchase.createdAt)}</td>
                          <td>
                            <button
                              className="button secondary small"
                              onClick={() => void open(purchase.id)}
                            >
                              Abrir pedido
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
                          ? "Nenhum pedido corresponde à busca"
                          : "Nenhum pedido de compra nesta unidade"
                      }
                      description={
                        query
                          ? "Revise os filtros de pesquisa."
                          : "Cadastre fornecedores e materiais reais antes de registrar o primeiro pedido."
                      }
                    />
                  )}
                </div>
                <div className="table-footer pagination">
                  <span>
                    {result.total} pedidos · página {result.page}
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
        <CreatePurchase
          data={data}
          canCost={can("costs:read")}
          onClose={() => setCreating(false)}
          onDone={(purchase) =>
            changed(
              purchase,
              "Pedido registrado. O estoque será atualizado após a conferência do recebimento.",
            )
          }
        />
      )}
      {action && selected && (
        <PurchaseAction
          mode={action}
          purchase={selected}
          data={data}
          canCost={can("costs:read")}
          onClose={() => setAction(null)}
          onDone={(purchase) =>
            changed(
              purchase,
              action === "receive"
                ? "Recebimento confirmado e entradas registradas no estoque."
                : "Pedido cancelado com registro de auditoria.",
            )
          }
        />
      )}
    </>
  );
}

function CreatePurchase({
  data,
  canCost,
  onClose,
  onDone,
}: {
  data: DataSet;
  canCost: boolean;
  onClose: () => void;
  onDone: (purchase: Purchase) => Promise<void>;
}) {
  const [items, setItems] = useState([
    { key: crypto.randomUUID(), productId: "", quantity: "", unitCost: "" },
  ]);
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
      const purchase = await api<Purchase>("/api/purchases", {
        method: "POST",
        body: JSON.stringify({
          code: form.get("code"),
          title: form.get("title"),
          supplierId: form.get("supplierId"),
          description: form.get("description"),
          items: items.map((item) => ({
            productId: item.productId,
            quantity: item.quantity,
            ...(canCost && item.unitCost ? { unitCost: item.unitCost } : {}),
          })),
          idempotencyKey: key,
        }),
      });
      await onDone(purchase);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Não foi possível salvar o pedido.",
      );
    } finally {
      setBusy(false);
    }
  }
  const update = (
    index: number,
    field: "productId" | "quantity" | "unitCost",
    value: string,
  ) =>
    setItems((items) =>
      items.map((item, i) =>
        i === index ? { ...item, [field]: value } : item,
      ),
    );
  return (
    <Modal
      wide
      title="Novo pedido de compra"
      subtitle="Informe somente materiais, valores e documentos reais."
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form className="modal-body" onSubmit={submit}>
        <div className="form-grid">
          <label>
            Código do pedido
            <input name="code" required maxLength={80} />
          </label>
          <label>
            Fornecedor
            <select name="supplierId" required>
              <option value="">Selecione</option>
              {data.suppliers
                .filter((supplier) => supplier.active !== false)
                .map((supplier) => (
                  <option key={supplier.id} value={supplier.id}>
                    {supplier.tradeName || supplier.legalName}
                  </option>
                ))}
            </select>
          </label>
          <label className="span-2">
            Descrição resumida
            <input name="title" maxLength={200} />
          </label>
        </div>
        <h3>Materiais solicitados</h3>
        {items.map((item, index) => (
          <div className="purchase-item-form" key={item.key}>
            <label>
              Material
              <select
                value={item.productId}
                required
                onChange={(event) =>
                  update(index, "productId", event.target.value)
                }
              >
                <option value="">Selecione</option>
                {data.products
                  .filter((product) => product.active)
                  .map((product) => (
                    <option key={product.id} value={product.id}>
                      {product.internalCode} · {product.name} ({product.unit})
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Quantidade
              <input
                value={item.quantity}
                onChange={(event) =>
                  update(index, "quantity", event.target.value)
                }
                type="number"
                min="0.001"
                step="0.001"
                inputMode="decimal"
                required
              />
            </label>
            {canCost && (
              <label>
                Custo unitário (opcional)
                <input
                  value={item.unitCost}
                  onChange={(event) =>
                    update(index, "unitCost", event.target.value)
                  }
                  type="number"
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                />
              </label>
            )}
            <button
              type="button"
              className="icon-button"
              aria-label={`Remover item ${index + 1}`}
              disabled={items.length === 1 || busy}
              onClick={() => setItems(items.filter((_, i) => i !== index))}
            >
              <Trash2 size={18} />
            </button>
          </div>
        ))}
        <button
          type="button"
          className="button secondary"
          disabled={busy}
          onClick={() =>
            setItems([
              ...items,
              {
                key: crypto.randomUUID(),
                productId: "",
                quantity: "",
                unitCost: "",
              },
            ])
          }
        >
          <Plus size={17} />
          Adicionar material
        </button>
        <label>
          Observação
          <textarea name="description" maxLength={2000} rows={2} />
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
            {busy ? "Registrando…" : "Salvar pedido"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function PurchaseAction({
  mode,
  purchase,
  data,
  canCost,
  onClose,
  onDone,
}: {
  mode: "receive" | "cancel";
  purchase: Purchase;
  data: DataSet;
  canCost: boolean;
  onClose: () => void;
  onDone: (purchase: Purchase) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [review, setReview] = useState<Record<string, unknown> | null>(null);
  const [draft, setDraft] = useState<Record<string, FormDataEntryValue>>({});
  const [key] = useState(() => crypto.randomUUID());
  const remaining = purchase.items.filter(
    (item) => Number(item.receivedQuantity) < Number(item.orderedQuantity),
  );
  function prepare(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setDraft(Object.fromEntries(form.entries()));
    setError("");
    const items = remaining.flatMap((item) => {
      const quantity = String(form.get(`quantity-${item.id}`) || "");
      return quantity && Number(quantity) > 0
        ? [
            {
              purchaseOrderItemId: item.id,
              quantity,
              locationId: String(form.get(`location-${item.id}`) || ""),
              ...(canCost && form.get(`cost-${item.id}`)
                ? { unitCost: String(form.get(`cost-${item.id}`)) }
                : {}),
            },
          ]
        : [];
    });
    if (
      mode === "receive" &&
      (!items.length || items.some((item) => !item.locationId))
    ) {
      setError(
        "Informe uma quantidade recebida e o local de destino para cada item selecionado.",
      );
      return;
    }
    setReview({
      note: form.get("note"),
      ...(mode === "receive"
        ? { documentReference: form.get("documentReference"), items }
        : {}),
      idempotencyKey: key,
    });
  }
  async function confirm() {
    if (!review || busy) return;
    setBusy(true);
    setError("");
    try {
      const updated = await api<Purchase>(
        `/api/purchases/${purchase.id}/${mode}`,
        { method: "POST", body: JSON.stringify(review) },
      );
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
      wide
      title={mode === "receive" ? "Conferir recebimento" : "Cancelar pedido"}
      subtitle={purchase.code}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form className="modal-body" onSubmit={prepare}>
        {review ? (
          <>
            <div className="notice warning">
              {mode === "receive"
                ? "Confirme somente as quantidades físicas conferidas. As entradas serão gravadas junto ao documento e ao responsável."
                : "O pedido será cancelado. O registro e o histórico serão preservados."}
            </div>
            {mode === "receive" && (
              <>
                <p>
                  Documento: <strong>{String(review.documentReference)}</strong>
                </p>
                {(
                  review.items as {
                    purchaseOrderItemId: string;
                    quantity: string;
                    locationId: string;
                  }[]
                ).map((item) => (
                  <div
                    className="review-balance"
                    key={item.purchaseOrderItemId}
                  >
                    <strong>
                      {
                        purchase.items.find(
                          (line) => line.id === item.purchaseOrderItemId,
                        )?.product.name
                      }
                    </strong>
                    <p>
                      {item.quantity} · {locationPath(data, item.locationId)}
                    </p>
                  </div>
                ))}
              </>
            )}
            <p>Motivo / observação: {String(review.note || "—")}</p>
          </>
        ) : (
          <>
            {mode === "receive" ? (
              <>
                <label>
                  Documento efetivamente recebido
                  <input
                    name="documentReference"
                    defaultValue={String(draft.documentReference || "")}
                    required
                    minLength={3}
                    maxLength={150}
                    placeholder="Identificação da nota ou documento de entrega"
                  />
                </label>
                <p className="workflow-help">
                  Deixe a quantidade em branco nos itens que não chegaram. Use a
                  unidade de medida do material.
                </p>
                {remaining.map((item) => (
                  <div key={item.id} className="receipt-item-form">
                    <div>
                      <strong>{item.product.name}</strong>
                      <small>
                        Pedido: {qty(item.orderedQuantity)} · Recebido:{" "}
                        {qty(item.receivedQuantity)} {item.product.unit}
                      </small>
                    </div>
                    <label>
                      Quantidade conferida ({item.product.unit})
                      <input
                        name={`quantity-${item.id}`}
                        defaultValue={String(
                          draft[`quantity-${item.id}`] || "",
                        )}
                        type="number"
                        inputMode="decimal"
                        min="0.001"
                        step="0.001"
                      />
                    </label>
                    <label>
                      Local de destino
                      <select
                        name={`location-${item.id}`}
                        defaultValue={String(
                          draft[`location-${item.id}`] || "",
                        )}
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
                    {canCost && (
                      <label>
                        Custo unitário no documento (opcional)
                        <input
                          name={`cost-${item.id}`}
                          defaultValue={String(draft[`cost-${item.id}`] || "")}
                          type="number"
                          min="0"
                          step="0.01"
                          inputMode="decimal"
                        />
                      </label>
                    )}
                  </div>
                ))}
              </>
            ) : (
              <div className="notice warning">
                O cancelamento está disponível somente antes de qualquer
                recebimento.
              </div>
            )}
            <label>
              Motivo / observação
              <textarea
                name="note"
                defaultValue={String(draft.note || "")}
                required={mode === "cancel"}
                minLength={mode === "cancel" ? 3 : undefined}
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
            className="button secondary"
            type="button"
            disabled={busy}
            onClick={() => (review ? setReview(null) : onClose())}
          >
            {review ? "Voltar" : "Cancelar"}
          </button>
          {review ? (
            <button
              className="button primary"
              type="button"
              disabled={busy}
              onClick={() => void confirm()}
            >
              {busy
                ? "Registrando…"
                : mode === "receive"
                  ? "Confirmar recebimento"
                  : "Confirmar cancelamento"}
            </button>
          ) : (
            <button className="button primary">Revisar operação</button>
          )}
        </div>
      </form>
    </Modal>
  );
}
