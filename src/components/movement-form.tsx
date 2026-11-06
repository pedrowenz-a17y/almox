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
import { navigateWorkspace } from "@/lib/workspace-navigation";
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
  const [purpose, setPurpose] = useState("");
  const [receivedByName, setReceivedByName] = useState("");
  const [receivedByIdentifier, setReceivedByIdentifier] = useState("");
  const [review, setReview] = useState(false);
  const [scanner, setScanner] = useState<"source" | "destination" | null>(
    qrTransfer ? "source" : null,
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState(() => crypto.randomUUID());
  const canDiscard = data.permissions?.includes("inventory:adjust") ?? false;
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
    if (type === "EXIT") {
      if (!purpose) return "Classifique a finalidade da saída.";
      if (purpose === "PRODUCTIVE")
        return "Retiradas produtivas precisam ser registradas na O.S. ou O.P., pela entrega e aplicação.";
      if (purpose === "LOSS" && !canDiscard)
        return "Seu perfil não permite registrar perda ou descarte. Solicite a conferência de um supervisor.";
      if (note.trim().length < 10)
        return "Justifique a saída com pelo menos 10 caracteres.";
      if (
        purpose === "OTHER" &&
        (receivedByName.trim().length < 3 || !receivedByIdentifier.trim())
      )
        return "Identifique quem retirou o material e sua matrícula ou identificação.";
    }
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
          purpose: type === "EXIT" ? purpose : undefined,
          receivedByName:
            type === "EXIT" && purpose === "OTHER" ? receivedByName : undefined,
          receivedByIdentifier:
            type === "EXIT" && purpose === "OTHER"
              ? receivedByIdentifier
              : undefined,
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
              {type === "EXIT" && (
                <>
                  <label>
                    Finalidade da saída
                    <select
                      required
                      value={purpose}
                      onChange={(event) => setPurpose(event.target.value)}
                    >
                      <option value="">Selecione a finalidade</option>
                      <option value="PRODUCTIVE">
                        Aplicação produtiva em O.S. / O.P.
                      </option>
                      <option value="OTHER">Uso não produtivo</option>
                      {canDiscard && (
                        <option value="LOSS">Perda ou descarte</option>
                      )}
                    </select>
                  </label>
                  {purpose === "PRODUCTIVE" ? (
                    <div className="notice warning">
                      <p>
                        Vincule a retirada à ordem e registre a entrega e
                        aplicação. A baixa definitiva ocorre no faturamento.
                      </p>
                      <div className="workflow-row-actions">
                        <button
                          type="button"
                          className="button secondary small"
                          onClick={() => {
                            onClose();
                            navigateWorkspace("/ordens-servico");
                          }}
                        >
                          Abrir O.S.
                        </button>
                        <button
                          type="button"
                          className="button secondary small"
                          onClick={() => {
                            onClose();
                            navigateWorkspace("/ordens-producao");
                          }}
                        >
                          Abrir O.P.
                        </button>
                      </div>
                    </div>
                  ) : (
                    <p className="workflow-help">
                      Saídas avulsas são exceções justificadas. Seu usuário
                      ficará registrado como responsável.
                    </p>
                  )}
                </>
              )}
              {!(type === "EXIT" && purpose === "PRODUCTIVE") && (
                <>
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
                  {type === "EXIT" && purpose === "OTHER" && (
                    <>
                      <label>
                        Quem retirou o material
                        <input
                          value={receivedByName}
                          onChange={(event) =>
                            setReceivedByName(event.target.value)
                          }
                          required
                          minLength={3}
                          maxLength={120}
                          autoComplete="off"
                        />
                      </label>
                      <label>
                        Matrícula ou identificação da pessoa
                        <input
                          value={receivedByIdentifier}
                          onChange={(event) =>
                            setReceivedByIdentifier(event.target.value)
                          }
                          required
                          minLength={1}
                          maxLength={80}
                          autoComplete="off"
                        />
                      </label>
                      <p className="workflow-help">
                        A identificação de quem retira é declarada pelo operador
                        conectado.
                      </p>
                    </>
                  )}
                  <label>
                    Documento ou referência{" "}
                    <span className="optional">opcional</span>
                    <input
                      value={reference}
                      onChange={(e) => setReference(e.target.value)}
                      placeholder="Ex.: NF 002486 / Protocolo"
                      maxLength={150}
                    />
                  </label>
                  <label>
                    {type === "EXIT" ? (
                      "Justificativa da saída (obrigatória)"
                    ) : (
                      <>
                        Observação <span className="optional">opcional</span>
                      </>
                    )}
                    <textarea
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder="Detalhes da movimentação"
                      required={type === "EXIT"}
                      minLength={type === "EXIT" ? 10 : undefined}
                      rows={2}
                      maxLength={2000}
                    />
                  </label>
                </>
              )}
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
              {type === "EXIT" && (
                <p className="muted">
                  Finalidade:{" "}
                  {purpose === "LOSS"
                    ? "Perda ou descarte"
                    : "Uso não produtivo"}
                </p>
              )}
              {type === "EXIT" && purpose === "OTHER" && (
                <p className="muted">
                  Retirou: {receivedByName} · {receivedByIdentifier}
                </p>
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
              <button
                type="submit"
                className="button primary"
                disabled={type === "EXIT" && purpose === "PRODUCTIVE"}
              >
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
