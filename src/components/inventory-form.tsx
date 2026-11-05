"use client";
import { useState } from "react";
import { ArrowRight, Check, Plus, ScanLine } from "lucide-react";
import { api, DataSet, locationPath, number, qty } from "@/lib/client";
import { Modal, Empty } from "@/components/ui";
import { Scanner } from "@/components/scanner";
export default function InventoryForm({
  data,
  initialLocation,
  onClose,
  onDone,
}: {
  data: DataSet;
  initialLocation?: string;
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const snapshot = (locationId: string) =>
    data.balances
      .filter(
        (b) =>
          b.locationId === locationId &&
          (number(b.physicalQuantity ?? b.quantity) !== 0 ||
            data.products.find((p) => p.id === b.productId)?.active),
      )
      .map((b) => ({
        productId: b.productId,
        expectedQuantity: String(b.physicalQuantity ?? b.quantity),
        countedQuantity: String(b.physicalQuantity ?? b.quantity),
      }));
  const [locationId, setLocation] = useState(initialLocation || "");
  const [items, setItems] = useState(snapshot(initialLocation || ""));
  const [note, setNote] = useState("");
  const [newProduct, setNewProduct] = useState("");
  const [scanning, setScanning] = useState(false);
  const [review, setReview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [key] = useState(() => crypto.randomUUID());
  function select(id: string) {
    setLocation(id);
    setItems(snapshot(id));
    setReview(false);
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    if (!navigator.onLine) {
      setError(
        "Sem conexão. Não é possível registrar movimentações no momento.",
      );
      return;
    }
    if (!review) {
      setReview(true);
      return;
    }
    setBusy(true);
    try {
      await api("/api/inventory", {
        method: "POST",
        body: JSON.stringify({ locationId, items, note, idempotencyKey: key }),
      });
      await onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao salvar inventário.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      wide
      title={review ? "Confirmar contagem" : "Nova contagem de inventário"}
      subtitle="O saldo é ajustado somente após a aprovação de um supervisor."
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      {scanning ? (
        <Scanner
          onResolved={(location) => {
            select(location.id);
            setScanning(false);
          }}
          onClose={() => setScanning(false)}
        />
      ) : (
        <form className="modal-body" onSubmit={submit}>
          <label>
            Localização
            <div className="input-action">
              <select
                required
                value={locationId}
                disabled={review}
                onChange={(e) => select(e.target.value)}
              >
                <option value="">Selecione a localização</option>
                {data.locations
                  .filter((l) => l.active)
                  .map((l) => (
                    <option value={l.id} key={l.id}>
                      {locationPath(data, l.id)}
                    </option>
                  ))}
              </select>
              {!review && (
                <button
                  type="button"
                  className="button secondary square"
                  aria-label="Escanear localização"
                  onClick={() => setScanning(true)}
                >
                  <ScanLine size={20} />
                </button>
              )}
            </div>
          </label>
          <div className="table-wrap count-table">
            <table>
              <thead>
                <tr>
                  <th>Produto</th>
                  <th className="numeric">Sistema</th>
                  <th className="numeric">Contagem física</th>
                  <th className="numeric">Diferença</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, index) => {
                  const product = data.products.find(
                    (p) => p.id === item.productId,
                  );
                  const diff =
                    number(item.countedQuantity) -
                    number(item.expectedQuantity);
                  return (
                    <tr key={item.productId}>
                      <td>
                        <strong>{product?.name}</strong>
                        <small>{product?.internalCode}</small>
                      </td>
                      <td className="numeric">{qty(item.expectedQuantity)}</td>
                      <td className="numeric">
                        {review ? (
                          qty(item.countedQuantity)
                        ) : (
                          <input
                            required
                            aria-label={`Contagem de ${product?.name}`}
                            type="number"
                            min="0"
                            step="0.001"
                            inputMode="decimal"
                            value={item.countedQuantity}
                            onChange={(e) =>
                              setItems((current) =>
                                current.map((i, n) =>
                                  n === index
                                    ? { ...i, countedQuantity: e.target.value }
                                    : i,
                                ),
                              )
                            }
                          />
                        )}
                      </td>
                      <td
                        className={`numeric ${diff ? "text-warning" : "text-success"}`}
                      >
                        {diff > 0 ? "+" : ""}
                        {qty(diff)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {!items.length && (
              <Empty
                title="Nenhum material nesta contagem"
                description="Escolha a localização ou adicione um produto encontrado."
              />
            )}
          </div>
          {!review && locationId && (
            <div className="input-action">
              <select
                aria-label="Produto encontrado no inventário"
                value={newProduct}
                onChange={(e) => setNewProduct(e.target.value)}
              >
                <option value="">Adicionar outro produto encontrado</option>
                {data.products
                  .filter(
                    (p) => p.active && !items.some((i) => i.productId === p.id),
                  )
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.internalCode} · {p.name}
                    </option>
                  ))}
              </select>
              <button
                type="button"
                className="button secondary"
                disabled={!newProduct}
                onClick={() => {
                  setItems((current) => [
                    ...current,
                    {
                      productId: newProduct,
                      expectedQuantity: "0",
                      countedQuantity: "0",
                    },
                  ]);
                  setNewProduct("");
                }}
              >
                <Plus size={18} />
                <span>Adicionar</span>
              </button>
            </div>
          )}
          <label>
            Motivo / observação da contagem
            <textarea
              required
              minLength={3}
              maxLength={2000}
              value={note}
              disabled={review}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              placeholder="Ex.: Inventário mensal da prateleira"
            />
          </label>
          {review && (
            <div className="notice info">
              Confira as quantidades. A contagem será enviada para aprovação,
              mantendo o saldo atual até a aprovação.
            </div>
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
              onClick={() => (review ? setReview(false) : onClose())}
              disabled={busy}
            >
              {review ? "Voltar e editar" : "Cancelar"}
            </button>
            <button className="button primary" disabled={!items.length || busy}>
              {review ? <Check size={18} /> : <ArrowRight size={18} />}{" "}
              {busy
                ? "Salvando…"
                : review
                  ? "Confirmar contagem"
                  : "Revisar contagem"}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
