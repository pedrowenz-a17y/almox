"use client";
import { useCallback, useEffect, useState } from "react";
import { Search, RefreshCw } from "lucide-react";
import { api, money, qty } from "@/lib/client";
import { Badge, Empty, Loading, Modal } from "@/components/ui";
import type { listOrderCosts } from "@/services/order-costs";
type CostReport = Awaited<ReturnType<typeof listOrderCosts>>;
export default function OrderCostReport() {
  const [costs, setCosts] = useState<CostReport | null>(null);
  const [detail, setDetail] = useState<CostReport["orders"][number] | null>(
    null,
  );
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const load = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      setError("");
      try {
        const report = await api<CostReport>(
          `/api/order-costs?${new URLSearchParams({ page: String(page), q: query })}`,
          { signal },
        );
        if (!signal?.aborted) setCosts(report);
      } catch (cause) {
        if (!signal?.aborted)
          setError(
            cause instanceof Error
              ? cause.message
              : "Não foi possível consultar os custos.",
          );
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [page, query],
  );
  useEffect(() => {
    const controller = new AbortController();
    void Promise.resolve().then(() => {
      if (!controller.signal.aborted) return load(controller.signal);
    });
    return () => controller.abort();
  }, [load]);
  return (
    <div className="recon-costs">
      <div className="recon-section-heading">
        <h2>Materiais por ordem</h2>
        <button
          className="button secondary"
          onClick={() => void load()}
          disabled={loading}
        >
          <RefreshCw size={16} /> Atualizar
        </button>
      </div>
      {error && (
        <div className="notice error" role="alert">
          {error}
        </div>
      )}
      {loading && !costs ? (
        <Loading />
      ) : (
        <>
          <div className="notice info">
            {costs?.criterion ||
              "Estimativa de materiais pelo custo registrado no faturamento."}{" "}
            Moeda: BRL. Valores ausentes permanecem incompletos.
          </div>
          <form
            className="toolbar"
            onSubmit={(event) => {
              event.preventDefault();
              setPage(1);
              setQuery(search.trim());
            }}
          >
            <label className="table-search">
              <Search size={17} />
              <input
                aria-label="Buscar ordem por código ou título"
                placeholder="Buscar ordem por código ou título"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
            <button className="button secondary" type="submit">
              Buscar
            </button>
          </form>
          <section className="panel">
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Ordem</th>
                    <th>Situação</th>
                    <th>Custo líquido de materiais</th>
                    <th>Conferência</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {(costs?.orders ?? []).map((order) => (
                    <tr key={order.id}>
                      <td>
                        <strong>
                          {order.kind === "SERVICE" ? "O.S." : "O.P."}{" "}
                          {order.code}
                        </strong>
                        <small>{order.title}</small>
                      </td>
                      <td>
                        {order.status === "INVOICED"
                          ? "Faturada"
                          : order.status === "CANCELLED"
                            ? "Cancelada"
                            : "Em andamento"}
                      </td>
                      <td>
                        {order.netMaterialCost === null
                          ? "Não consolidado"
                          : money(order.netMaterialCost)}
                      </td>
                      <td>
                        <Badge
                          tone={
                            order.completeness === "COMPLETE"
                              ? "success"
                              : "warning"
                          }
                        >
                          {order.completeness === "COMPLETE"
                            ? "Custo histórico completo"
                            : order.completeness === "MISSING_COST"
                              ? `${order.missingCostCount} sem custo registrado`
                              : "Aguarda faturamento"}
                        </Badge>
                      </td>
                      <td>
                        <button
                          className="text-button"
                          onClick={() => setDetail(order)}
                        >
                          Ver materiais
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!costs?.orders.length && (
              <Empty
                title="Nenhuma ordem nesta consulta"
                description="Os custos ficam disponíveis após o faturamento, quando o preço é registrado no histórico."
              />
            )}
          </section>
          {costs && costs.total > costs.pageSize && (
            <div className="toolbar">
              <button
                className="button secondary"
                disabled={page <= 1 || loading}
                onClick={() => setPage((current) => current - 1)}
              >
                Anterior
              </button>
              <span>
                Página {page} de {Math.ceil(costs.total / costs.pageSize)}
              </span>
              <button
                className="button secondary"
                disabled={page * costs.pageSize >= costs.total || loading}
                onClick={() => setPage((current) => current + 1)}
              >
                Próxima
              </button>
            </div>
          )}
        </>
      )}
      {detail && (
        <Modal
          title={`Materiais da ${detail.kind === "SERVICE" ? "O.S." : "O.P."} ${detail.code}`}
          subtitle="Custo cadastral capturado no faturamento; devoluções usam esse mesmo valor."
          onClose={() => setDetail(null)}
          wide
        >
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Material</th>
                  <th>Consumido</th>
                  <th>Devolvido</th>
                  <th>Líquido</th>
                  <th>Custo unitário histórico</th>
                  <th>Custo líquido</th>
                </tr>
              </thead>
              <tbody>
                {detail.materials.map((material) => (
                  <tr key={material.id}>
                    <td>
                      {material.productCode}
                      <small>{material.productName}</small>
                    </td>
                    <td>
                      {qty(material.consumedQuantity)} {material.unit}
                    </td>
                    <td>{qty(material.returnedQuantity)}</td>
                    <td>{qty(material.netQuantity)}</td>
                    <td>
                      {material.invoicedUnitCost === null
                        ? "Não registrado"
                        : money(material.invoicedUnitCost)}
                    </td>
                    <td>
                      {material.netMaterialCost === null
                        ? "Incompleto"
                        : money(material.netMaterialCost)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            Subtotal com custo conhecido:{" "}
            <strong>{money(detail.knownSubtotal)}</strong>.{" "}
            {detail.missingCostCount
              ? `${detail.missingCostCount} sem custo histórico. O total permanece incompleto.`
              : ""}
          </p>
          {detail.status !== "INVOICED" && (
            <p className="notice warning">
              Esta ordem ainda não possui consolidação de consumo faturado.
            </p>
          )}
        </Modal>
      )}
    </div>
  );
}
