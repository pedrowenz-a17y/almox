"use client";
import { useEffect, useMemo, useState } from "react";
import { Download, Printer, RefreshCw } from "lucide-react";
import { api, DataSet, dateTime, qty } from "@/lib/client";
import { Badge, Empty, Loading } from "@/components/ui";
interface Report {
  columns: { key: string; label: string }[];
  rows: Record<string, string | number>[];
  title: string;
  generatedAt: string;
}
const reportTypes: [string, string][] = [
  ["position", "Posição atual de estoque"],
  ["low", "Abaixo do estoque mínimo"],
  ["zero", "Produtos sem estoque"],
  ["entry", "Entradas"],
  ["exit", "Saídas"],
  ["transfer", "Transferências"],
  ["adjustments", "Ajustes de inventário"],
  ["by-user", "Movimentações por usuário"],
  ["by-location", "Estoque por localização"],
  ["counts", "Inventários"],
  ["divergences", "Divergências de inventário"],
];
export default function Reports({ data }: { data: DataSet }) {
  const [now] = useState(() => Date.now());
  const [type, setType] = useState("position");
  const [period, setPeriod] = useState("30");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [userId, setUserId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const query = useMemo(() => {
    const params = new URLSearchParams({ type });
    if (locationId) params.set("locationId", locationId);
    if (userId && type === "by-user") params.set("userId", userId);
    const today = new Date(now).toLocaleDateString("en-CA", {
      timeZone: "America/Sao_Paulo",
    });
    if (period === "custom") {
      if (from) params.set("from", from);
      if (to) params.set("to", to);
    } else {
      const start =
        period === "today"
          ? today
          : new Date(now - (Number(period) - 1) * 86400000).toLocaleDateString(
              "en-CA",
              { timeZone: "America/Sao_Paulo" },
            );
      params.set("from", start);
      params.set("to", today);
    }
    return params.toString();
  }, [type, period, from, to, userId, locationId, now]);
  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) {
        setLoading(true);
        setError("");
      }
    });
    api<Report>(`/api/reports?${query}&format=json`)
      .then((result) => {
        if (!cancelled) setReport(result);
      })
      .catch((cause) => {
        if (!cancelled) {
          setError(
            cause instanceof Error
              ? cause.message
              : "Não foi possível carregar o relatório.",
          );
          setReport(null);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [query, revision]);
  async function download(format: string) {
    setBusy(format);
    setError("");
    try {
      const response = await fetch(`/api/reports?${query}&format=${format}`, {
        cache: "no-store",
      });
      if (!response.ok) {
        const body = await response.json();
        throw new Error(body.error || "Falha na exportação.");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `almox-${type}-${new Date().toISOString().slice(0, 10)}.${format}`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha na exportação.");
    } finally {
      setBusy("");
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">DADOS PARA DECIDIR MELHOR</span>
          <h1>Relatórios</h1>
          <p>Consulte a operação e exporte os dados do almoxarifado.</p>
        </div>
        <div className="heading-actions no-print">
          <button
            className="button secondary"
            disabled={loading || !report}
            onClick={() => window.print()}
          >
            <Printer size={17} />
            PDF / Imprimir
          </button>
          <button
            className="button secondary"
            disabled={!!busy || loading}
            onClick={() => void download("csv")}
          >
            <Download size={17} />
            {busy === "csv" ? "Gerando…" : "CSV"}
          </button>
          <button
            className="button primary"
            disabled={!!busy || loading}
            onClick={() => void download("xlsx")}
          >
            <Download size={17} />
            {busy === "xlsx" ? "Gerando…" : "Excel"}
          </button>
        </div>
      </div>
      <section className="panel">
        <div className="report-filters no-print">
          <label>
            Relatório
            <select value={type} onChange={(e) => setType(e.target.value)}>
              {reportTypes.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Período
            <select value={period} onChange={(e) => setPeriod(e.target.value)}>
              <option value="today">Hoje</option>
              <option value="7">Últimos 7 dias</option>
              <option value="30">Últimos 30 dias</option>
              <option value="custom">Período personalizado</option>
            </select>
          </label>
          {period === "custom" && (
            <>
              <label>
                Data inicial
                <input
                  type="date"
                  value={from}
                  max={to || undefined}
                  onChange={(e) => setFrom(e.target.value)}
                />
              </label>
              <label>
                Data final
                <input
                  type="date"
                  value={to}
                  min={from || undefined}
                  onChange={(e) => setTo(e.target.value)}
                />
              </label>
            </>
          )}
          <label>
            Localização
            <select
              value={locationId}
              onChange={(e) => setLocationId(e.target.value)}
            >
              <option value="">Todas as localizações</option>
              {data.locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.code}
                </option>
              ))}
            </select>
          </label>
          {type === "by-user" && (
            <label>
              Usuário
              <select
                value={userId}
                onChange={(e) => setUserId(e.target.value)}
              >
                <option value="">Todos os usuários</option>
                {Array.from(
                  new Map(
                    data.movements.map((m) => [m.userId, m.user?.name]),
                  ).entries(),
                ).map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <button
            className="button secondary"
            onClick={() => setRevision((r) => r + 1)}
            aria-label="Atualizar relatório"
            disabled={loading}
          >
            <RefreshCw size={17} />
          </button>
        </div>
        {error && (
          <div className="notice error" role="alert">
            {error}
          </div>
        )}
        {loading ? (
          <Loading />
        ) : (
          report && (
            <>
              <div className="panel-heading">
                <div>
                  <h2>{report.title}</h2>
                  <p>
                    {["position", "low", "zero", "by-location"].includes(type)
                      ? "Saldo atual"
                      : "Registros no período selecionado"}{" "}
                    · {dateTime(report.generatedAt)}
                  </p>
                </div>
                <Badge tone="info">{qty(report.rows.length)} registros</Badge>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      {report.columns.map((column) => (
                        <th key={column.key}>{column.label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {report.rows.map((row, index) => (
                      <tr key={index}>
                        {report.columns.map((column) => (
                          <td key={column.key}>
                            {typeof row[column.key] === "number"
                              ? qty(row[column.key])
                              : (row[column.key] ?? "—")}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!report.rows.length && (
                  <Empty
                    title="Nenhum registro no filtro selecionado"
                    description="Ajuste o período ou a localização para consultar outros registros."
                  />
                )}
              </div>
              <div className="table-footer">
                {report.rows.length} registros
                <span>
                  A exportação utiliza os mesmos filtros desta consulta.
                </span>
              </div>
            </>
          )
        )}
      </section>
    </>
  );
}
