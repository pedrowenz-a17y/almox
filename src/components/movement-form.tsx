"use client";
import { useMemo, useState } from "react";
import {
  ArrowDownLeft,
  ArrowRight,
  CheckCircle2,
  ScanLine,
  ShieldCheck,
} from "lucide-react";
import {
  api,
  DataSet,
  locationPath,
  movementLabels,
  number,
  qty,
} from "@/lib/client";
import { Scanner } from "@/components/scanner";
import { Modal } from "@/components/ui";
export default function MovementForm({
  data,
  initialType = "ENTRY",
  initialLocation,
  initialProduct,
  qrTransfer = false,
  onClose,
  onDone,
}: {
  data: DataSet;
  initialType?: string;
  initialLocation?: string;
  initialProduct?: string;
  qrTransfer?: boolean;
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const [type, setType] = useState(initialType);
  const [productId, setProduct] = useState(initialProduct || "");
  const [sourceId, setSource] = useState(
    initialType !== "ENTRY" ? initialLocation || "" : "",
  );
  const [destinationId, setDestination] = useState(
    initialType === "ENTRY" ? initialLocation || "" : "",
  );
  const [quantity, setQuantity] = useState("");
  const [note, setNote] = useState("");
  const [reference, setReference] = useState("");
  const [review, setReview] = useState(false);
  const [scanner, setScanner] = useState<"source" | "destination" | null>(
    qrTransfer ? "source" : null,
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState(() => crypto.randomUUID());
  const product = data.products.find((p) => p.id === productId);
  const amount = number(quantity);
  const locationBalance = (id: string) =>
    data.balances.find((b) => b.productId === productId && b.locationId === id);
  const balance = (id: string) =>
    number(
      locationBalance(id)?.physicalQuantity ?? locationBalance(id)?.quantity,
    );
  const available = (id: string) =>
    number(
      locationBalance(id)?.availableQuantity ?? locationBalance(id)?.quantity,
    );
  const availableProducts = useMemo(
    () =>
      data.products.filter(
        (p) =>
          p.active &&
          (type === "ENTRY" ||
            !sourceId ||
            data.balances.some(
              (b) => b.productId === p.id && b.locationId === sourceId,
            )),
      ),
    [data, sourceId, type],
  );
  function validate() {
    if (!navigator.onLine)
      return "Sem conexão. Não é possível registrar movimentações no momento.";
    if (!productId || amount <= 0 || !Number.isFinite(amount))
      return "Selecione um produto e informe uma quantidade maior que zero.";
    if (type !== "ENTRY" && !sourceId)
      return "Selecione a localização de origem.";
    if (type !== "EXIT" && !destinationId)
      return "Selecione a localização de destino.";
    if (type === "TRANSFER" && sourceId === destinationId)
      return "Origem e destino precisam ser diferentes.";
    if (type !== "ENTRY" && amount > available(sourceId))
      return "Quantidade maior que o saldo disponível nesta localização.";
    return "";
  }
  function prepare(event: React.FormEvent) {
    event.preventDefault();
    const message = validate();
    setError(message);
    if (!message) setReview(true);
  }
  async function submit() {
    const message = validate();
    if (message) {
      setError(message);
      return;
    }
    setBusy(true);
    setError("");
    try {
      await api("/api/movements", {
        method: "POST",
        body: JSON.stringify({
          type,
          productId,
          quantity,
          sourceId: type !== "ENTRY" ? sourceId : undefined,
          destinationId: type !== "EXIT" ? destinationId : undefined,
          note,
          reference,
          idempotencyKey: key,
        }),
      });
      await onDone();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Falha ao registrar movimentação.",
      );
    } finally {
      setBusy(false);
    }
  }
  function changeType(value: string) {
    setType(value);
    setReview(false);
    setKey(crypto.randomUUID());
  }
  return (
    <Modal
      title={
        qrTransfer
          ? "Transferência via QR Code"
          : review
            ? "Confirmar movimentação"
            : "Nova movimentação"
      }
      subtitle={
        qrTransfer
          ? "Leia a origem, escolha o material e leia o destino."
          : "Todo movimento fica registrado no histórico."
      }
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      {scanner ? (
        <Scanner
          title={
            scanner === "source"
              ? "1. Escaneie a localização de origem"
              : "2. Escaneie a localização de destino"
          }
          onResolved={(location) => {
            if (scanner === "source") {
              setSource(location.id);
              setProduct("");
            } else setDestination(location.id);
            setScanner(null);
          }}
          onClose={() => setScanner(null)}
        />
      ) : (
        <form onSubmit={prepare} className="modal-body">
          {!review ? (
            <>
              <div className="segmented">
                {["ENTRY", "EXIT", "TRANSFER"].map((value) => (
                  <button
                    type="button"
                    key={value}
                    className={type === value ? "selected" : ""}
                    onClick={() => changeType(value)}
                  >
                    {movementLabels[value]}
                  </button>
                ))}
              </div>
              {type !== "ENTRY" && (
                <label>
                  Localização de origem
                  <div className="input-action">
                    <select
                      required
                      value={sourceId}
                      onChange={(e) => {
                        setSource(e.target.value);
                        setProduct("");
                      }}
                    >
                      <option value="">Selecione a origem</option>
                      {data.locations
                        .filter((l) => l.active)
                        .map((l) => (
                          <option value={l.id} key={l.id}>
                            {locationPath(data, l.id)} · {l.code}
                          </option>
                        ))}
                    </select>
                    <button
                      className="button secondary square"
                      type="button"
                      onClick={() => setScanner("source")}
                      aria-label="Escanear origem"
                    >
                      <ScanLine size={20} />
                    </button>
                  </div>
                </label>
              )}
              <label>
                Produto / material
                <select
                  required
                  value={productId}
                  onChange={(e) => setProduct(e.target.value)}
                >
                  <option value="">Selecione o produto</option>
                  {availableProducts.map((p) => (
                    <option value={p.id} key={p.id}>
                      {p.internalCode} · {p.name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="form-grid">
                <label>
                  Quantidade {product && `(${product.unit})`}
                  <input
                    value={quantity}
                    onChange={(e) => setQuantity(e.target.value)}
                    required
                    type="number"
                    min="0.001"
                    step="0.001"
                    inputMode="decimal"
                    placeholder="0"
                  />
                </label>
                <div className="field-info">
                  <span>Saldo disponível na origem</span>
                  <strong>
                    {type !== "ENTRY" && productId && sourceId
                      ? `${qty(available(sourceId))} ${product?.unit || ""}`
                      : "—"}
                  </strong>
                </div>
              </div>
              {type !== "EXIT" && (
                <label>
                  Localização de destino
                  <div className="input-action">
                    <select
                      required
                      value={destinationId}
                      onChange={(e) => setDestination(e.target.value)}
                    >
                      <option value="">Selecione o destino</option>
                      {data.locations
                        .filter((l) => l.active && l.id !== sourceId)
                        .map((l) => (
                          <option value={l.id} key={l.id}>
                            {locationPath(data, l.id)} · {l.code}
                          </option>
                        ))}
                    </select>
                    <button
                      className="button secondary square"
                      type="button"
                      onClick={() => setScanner("destination")}
                      aria-label="Escanear destino"
                    >
                      <ScanLine size={20} />
                    </button>
                  </div>
                </label>
              )}
              <label>
                Documento ou referência{" "}
                <span className="optional">opcional</span>
                <input
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  placeholder="Ex.: NF 002486 / Ordem de serviço"
                  maxLength={150}
                />
              </label>
              <label>
                Observação <span className="optional">opcional</span>
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Detalhes da movimentação"
                  rows={2}
                  maxLength={2000}
                />
              </label>
            </>
          ) : (
            <>
              <div className="review-product">
                <span className="review-icon">
                  <ArrowDownLeft size={24} />
                </span>
                <div>
                  <small>{movementLabels[type]}</small>
                  <h3>{product?.name}</h3>
                  <p>
                    {product?.internalCode} · {qty(amount)} {product?.unit}
                  </p>
                </div>
              </div>
              {type !== "ENTRY" && (
                <div className="review-balance">
                  <small>ORIGEM · {locationPath(data, sourceId)}</small>
                  <div>
                    <span>
                      Físico antes<strong>{qty(balance(sourceId))}</strong>
                    </span>
                    <ArrowRight size={20} />
                    <span>
                      Físico depois
                      <strong>{qty(balance(sourceId) - amount)}</strong>
                    </span>
                  </div>
                </div>
              )}
              {type !== "EXIT" && (
                <div className="review-balance">
                  <small>DESTINO · {locationPath(data, destinationId)}</small>
                  <div>
                    <span>
                      Físico antes<strong>{qty(balance(destinationId))}</strong>
                    </span>
                    <ArrowRight size={20} />
                    <span>
                      Físico depois
                      <strong>{qty(balance(destinationId) + amount)}</strong>
                    </span>
                  </div>
                </div>
              )}
              {type === "TRANSFER" && (
                <div className="notice info">
                  <ShieldCheck size={18} />O estoque total do produto será
                  preservado.
                </div>
              )}
              {reference && <p className="muted">Referência: {reference}</p>}
              {note && <p className="muted">{note}</p>}
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
              onClick={() => (review ? setReview(false) : onClose())}
              disabled={busy}
            >
              {review ? "Voltar e editar" : "Cancelar"}
            </button>
            {review ? (
              <button
                type="button"
                className="button primary"
                disabled={busy}
                onClick={submit}
              >
                <CheckCircle2 size={18} />
                {busy ? "Registrando…" : "Confirmar movimentação"}
              </button>
            ) : (
              <button type="submit" className="button primary">
                Revisar movimentação
                <ArrowRight size={18} />
              </button>
            )}
          </div>
        </form>
      )}
    </Modal>
  );
}
