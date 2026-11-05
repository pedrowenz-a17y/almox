"use client";
import { useCallback, useEffect, useState } from "react";
import {
  Download,
  RefreshCw,
  ShoppingCart,
  Search,
  ArrowUpRight,
} from "lucide-react";
import Link from "@/components/workspace-link";
import { api, qty, number } from "@/lib/client";
import type { listReplenishment } from "@/services/replenishment";
import { Badge, Empty, Loading } from "@/components/ui";

type Rows = Awaited<ReturnType<typeof listReplenishment>>;
const csvCell = (value: string) =>
  `"${(/^[\s\u0000-\u001f]*[=+\-@]/.test(value) ? "'" : "") + value.replaceAll('"', '""')}"`;
export default function Replenishment() {
  const [rows, setRows] = useState<Rows | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [supplier, setSupplier] = useState("");
  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError("");
    try {
      const result = await api<Rows>("/api/replenishment", { signal });
      if (!signal?.aborted) setRows(result);
    } catch (cause) {
      if (!signal?.aborted) {
        setRows(null);
        setError(
          cause instanceof Error
            ? cause.message
            : "Não foi possível consultar a reposição.",
        );
      }
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void Promise.resolve().then(() => {
      if (!controller.signal.aborted) return load(controller.signal);
    });
    return () => controller.abort();
  }, [load]);
  const filtered = (rows ?? []).filter(
    (r) =>
      (!supplier ||
        r.supplierId === supplier ||
        (supplier === "none" && !r.supplierId)) &&
      `${r.name} ${r.code}`
        .toLocaleLowerCase("pt-BR")
        .includes(query.toLocaleLowerCase("pt-BR")),
  );
  const suppliers = [
    ...new Map(
      (rows ?? []).map((r) => [r.supplierId ?? "none", r.supplierName]),
    ).entries(),
  ];
  function exportCsv() {
    const header = [
      "Código",
      "Material",
      "Fornecedor",
      "Unidade",
      "Disponível",
      "Mínimo",
      "Meta",
      "Em compra",
      "Sugestão",
    ];
    const lines = filtered.map((r) => [
      r.code,
      r.name,
      r.supplierName,
      r.unit,
      r.available,
      r.minimum,
      r.target,
      r.incoming,
      r.suggested,
    ]);
    const url = URL.createObjectURL(
      new Blob(
        [
          "\ufeff" +
            [header, ...lines]
              .map((row) => row.map(csvCell).join(";"))
              .join("\r\n"),
        ],
        { type: "text/csv;charset=utf-8;" },
      ),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "reposicao-almox.csv";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Reposição de materiais</h1>
          <p>O que falta, o que já foi pedido e o que ainda precisa comprar.</p>
        </div>
        <div className="row-actions">
          <button
            className="button secondary"
            disabled={loading}
            onClick={() => void load()}
          >
            <RefreshCw size={16} className={loading ? "spin" : ""} /> Atualizar
          </button>
          <button
            className="button primary"
            disabled={!filtered.length || loading}
            onClick={exportCsv}
          >
            <Download size={17} /> Exportar lista
          </button>
        </div>
      </div>
      <div className="replenishment-brief">
        <ShoppingCart size={27} />
        <div>
          <strong>
            {rows ? rows.filter((r) => number(r.suggested) > 0).length : "—"}{" "}
            materiais com compra sugerida
          </strong>
          <p>
            A sugestão repõe até o máximo cadastrado, ou até o mínimo quando não
            há máximo, descontando os pedidos em aberto.
          </p>
        </div>
        <Link href="/compras" className="button secondary">
          Consultar compras <ArrowUpRight size={16} />
        </Link>
      </div>
      {error && (
        <div className="notice error" role="alert">
          {error}{" "}
          <button className="text-button" onClick={() => void load()}>
            Tentar novamente
          </button>
        </div>
      )}
      {!rows && loading ? (
        <Loading />
      ) : (
        rows && (
          <section className="panel">
            <div className="replenishment-tools">
              <label className="table-search">
                <Search size={16} />
                <input
                  aria-label="Buscar material na reposição"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Buscar material ou código"
                />
              </label>
              <select
                aria-label="Filtrar por fornecedor"
                value={supplier}
                onChange={(e) => setSupplier(e.target.value)}
              >
                <option value="">Todos os fornecedores</option>
                {suppliers.map(([id, name]) => (
                  <option value={id} key={id}>
                    {name}
                  </option>
                ))}
              </select>
              <span className="muted">{filtered.length} materiais</span>
            </div>
            {filtered.length ? (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Material / fornecedor</th>
                      <th className="numeric">Disponível</th>
                      <th className="numeric">Mínimo</th>
                      <th className="numeric">Em compra</th>
                      <th className="numeric">Comprar até a meta</th>
                      <th>Situação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((r) => (
                      <tr key={r.productId}>
                        <td>
                          <Link
                            className="material-link"
                            href={`/produto/${r.productId}`}
                          >
                            <strong>{r.name}</strong>
                            <small>
                              {r.code} · {r.supplierName}
                            </small>
                          </Link>
                        </td>
                        <td className="numeric">
                          {qty(r.available)} {r.unit}
                        </td>
                        <td className="numeric">{qty(r.minimum)}</td>
                        <td className="numeric">{qty(r.incoming)}</td>
                        <td className="numeric">
                          <strong>
                            {qty(r.suggested)} {r.unit}
                          </strong>
                          <small>Meta: {qty(r.target)}</small>
                        </td>
                        <td>
                          <Badge
                            tone={
                              number(r.suggested) > 0
                                ? "warning"
                                : number(r.target) === 0
                                  ? ""
                                  : "info"
                            }
                          >
                            {number(r.suggested) > 0
                              ? "Repor"
                              : number(r.target) === 0
                                ? "Definir mínimo"
                                : "Em compra"}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty
                title={
                  rows.length
                    ? "Nenhum material com esses filtros"
                    : "Os mínimos estão atendidos"
                }
                description={
                  rows.length
                    ? "Escolha outro fornecedor ou revise a busca."
                    : "Os materiais ativos desta unidade estão com saldo disponível acima de zero e atendem ao mínimo cadastrado."
                }
              />
            )}
          </section>
        )
      )}
      <p className="workflow-help">
        Esta lista ajuda a preparar a compra. Ela não cria pedidos nem movimenta
        o estoque.
      </p>
    </>
  );
}
