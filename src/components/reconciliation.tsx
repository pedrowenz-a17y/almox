"use client";
import { canViewReports, canSaveReconciliation } from "@/lib/access-profiles";

import { useCallback, useEffect, useRef, useState } from "react";
import { Download, FileCheck2, RefreshCw, Search } from "lucide-react";
import { api, dateTime, money, qty } from "@/lib/client";
import { safeCsvCell } from "@/lib/reconciliation-csv";
import { Badge, Empty, Loading, Modal } from "@/components/ui";
import type { listOrderCosts } from "@/services/order-costs";
import type { previewReconciliation } from "@/services/reconciliation";

type CostReport = Awaited<ReturnType<typeof listOrderCosts>>;
type Comparison = Awaited<ReturnType<typeof previewReconciliation>>;
type Batch = {
  id: string;
  kind: "STOCK" | "ORDER_COST";
  sourceName: string;
  referenceAt: string;
  createdAt: string;
};
type Draft = {
  kind: "STOCK" | "ORDER_COST";
  sourceName: string;
  referenceAt: string;
  delimiter: ";" | ",";
  decimalFormat: "BR" | "CANONICAL";
  csv: string;
};
const errorText = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "Não foi possível concluir a consulta.";
const localNow = () => {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
};
function download(name: string, text: string) {
  const url = URL.createObjectURL(
    new Blob(["\uFEFF", text], { type: "text/csv;charset=utf-8" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

export default function Reconciliation({
  permissions,
}: {
  permissions: string[];
}) {
  const costsAllowed = permissions.includes("costs:read");
  const reportsAllowed = canViewReports(permissions);
  const canSave = canSaveReconciliation(permissions);
  const [tab, setTab] = useState<"costs" | "reconcile">(
    reportsAllowed ? "reconcile" : "costs",
  );
  const [costs, setCosts] = useState<CostReport | null>(null);
  const [detail, setDetail] = useState<CostReport["orders"][number] | null>(
    null,
  );
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [history, setHistory] = useState<Batch[]>([]);
  const [setup, setSetup] = useState<{
    unitCode: string;
    unitName: string;
  } | null>(null);
  const [draft, setDraft] = useState<Draft>({
    kind: "STOCK",
    sourceName: "",
    referenceAt: localNow(),
    delimiter: ";",
    decimalFormat: "BR",
    csv: "",
  });
  const [comparison, setComparison] = useState<Comparison | null>(null);
  const [savedId, setSavedId] = useState("");
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const fileGeneration = useRef(0);
  const [fileReading, setFileReading] = useState(false);
  useEffect(
    () => () => {
      fileGeneration.current += 1;
    },
    [],
  );
  const load = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      setError("");
      const results = await Promise.allSettled([
        costsAllowed
          ? api<CostReport>(
              `/api/order-costs?${new URLSearchParams({ page: String(page), q: query })}`,
              { signal },
            )
          : Promise.resolve(null),
        reportsAllowed
          ? api<Batch[]>("/api/reconciliation", { signal })
          : Promise.resolve([]),
        reportsAllowed
          ? api<{ unitCode: string; unitName: string }>(
              "/api/reconciliation/setup",
              { signal },
            )
          : Promise.resolve(null),
      ]);
      if (signal?.aborted) return;
      const [costResult, historyResult, setupResult] = results;
      if (costResult.status === "fulfilled") setCosts(costResult.value);
      if (historyResult.status === "fulfilled") setHistory(historyResult.value);
      if (setupResult.status === "fulfilled") setSetup(setupResult.value);
      const failure = results.find((r) => r.status === "rejected");
      if (failure?.status === "rejected") setError(errorText(failure.reason));
      setLoading(false);
    },
    [costsAllowed, reportsAllowed, page, query],
  );
  useEffect(() => {
    const controller = new AbortController();
    void Promise.resolve().then(() => {
      if (!controller.signal.aborted) return load(controller.signal);
    });
    return () => controller.abort();
  }, [load]);
  function change(values: Partial<Draft>) {
    if (values.kind !== undefined) {
      fileGeneration.current += 1;
      setFileReading(false);
    }
    setDraft((current) => ({ ...current, ...values }));
    setComparison(null);
    setSavedId("");
    setKey("");
    setError("");
    setNotice("");
  }
  async function loadFile(file: File | undefined) {
    const generation = ++fileGeneration.current;
    change({ csv: "" });
    setFileReading(false);
    if (!file) return;
    if (file.size > 1_048_576) {
      setError("Envie um CSV de até 1 MB.");
      return;
    }
    setFileReading(true);
    try {
      const text = await file.text();
      if (generation === fileGeneration.current) change({ csv: text });
    } catch {
      if (generation === fileGeneration.current)
        setError("Não foi possível ler o arquivo selecionado.");
    } finally {
      if (generation === fileGeneration.current) setFileReading(false);
    }
  }
  function template() {
    if (!setup) return;
    const separator = draft.delimiter;
    const decimal = draft.decimalFormat === "BR" ? "," : ".";
    const header =
      draft.kind === "STOCK"
        ? ["unidade", "produto", "local", "quantidade"]
        : ["unidade", "ordem", "custo"];
    const example =
      draft.kind === "STOCK"
        ? [setup.unitCode, "CODIGO_PRODUTO", "CODIGO_LOCAL", `0${decimal}000`]
        : [setup.unitCode, "CODIGO_ORDEM", `0${decimal}00`];
    download(
      `modelo-${draft.kind.toLowerCase()}.csv`,
      [header, example]
        .map((row) => row.map(safeCsvCell).join(separator))
        .join("\r\n"),
    );
  }
  async function preview(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    setComparison(null);
    setSavedId("");
    try {
      const result = await api<Comparison>("/api/reconciliation/preview", {
        method: "POST",
        body: JSON.stringify({
          ...draft,
          referenceAt: new Date(draft.referenceAt).toISOString(),
        }),
      });
      setComparison(result);
      setKey(crypto.randomUUID());
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    if (!canSave || !comparison || savedId || !key) return;
    setBusy(true);
    setError("");
    try {
      const batch = await api<Batch & { result: Comparison }>(
        "/api/reconciliation",
        {
          method: "POST",
          body: JSON.stringify({
            ...draft,
            referenceAt: new Date(draft.referenceAt).toISOString(),
            idempotencyKey: key,
          }),
        },
      );
      setComparison(batch.result);
      setSavedId(batch.id);
      setHistory((current) =>
        [batch, ...current.filter((item) => item.id !== batch.id)].slice(0, 50),
      );
      setNotice(
        "Documento salvo. A comparação foi atualizada no momento da gravação; nenhum saldo foi alterado.",
      );
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  }
  async function openBatch(id: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const batch = await api<Batch & { result: Comparison }>(
        `/api/reconciliation/${id}`,
      );
      setComparison(batch.result);
      setSavedId(batch.id);
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  }
  function exportComparison() {
    if (!comparison) return;
    const lines = [
      [
        "unidade",
        "origem",
        "referencia_erp",
        "comparado_em",
        "tipo",
        "codigo",
        "local",
        "almox",
        "erp",
        "diferenca_almox_menos_erp",
        "situacao",
      ],
      ...comparison.rows.map((row) => [
        comparison.unitCode,
        comparison.sourceName,
        comparison.referenceAt,
        comparison.comparedAt,
        comparison.kind,
        row.code,
        row.location || "",
        row.localValue ?? "INCOMPLETO",
        row.externalValue,
        row.difference ?? "",
        row.status,
      ]),
    ];
    download(
      "conciliacao-para-revisao.csv",
      lines.map((row) => row.map(safeCsvCell).join(";")).join("\r\n"),
    );
  }
  if (!costsAllowed && !reportsAllowed)
    return (
      <Empty
        title="Acesso restrito"
        description="Seu perfil não possui acesso a relatórios ou custos."
      />
    );
  return (
    <div className="reconciliation-workspace">
      <div className="page-heading">
        <div>
          <span className="eyebrow">Controle e rastreabilidade</span>
          <h1>Custos e conciliação</h1>
          <p>
            Compare materiais por ordem e confira os dados exportados do ERP.
          </p>
        </div>
        <button
          className="button secondary"
          disabled={loading || busy}
          onClick={() => void load()}
        >
          <RefreshCw size={17} /> Atualizar
        </button>
      </div>
      <div className="toolbar">
        <div className="segmented">
          {reportsAllowed && (
            <button
              className={tab === "reconcile" ? "selected" : ""}
              onClick={() => setTab("reconcile")}
            >
              Conciliação com ERP
            </button>
          )}
          {costsAllowed && (
            <button
              className={tab === "costs" ? "selected" : ""}
              onClick={() => setTab("costs")}
            >
              Custos por ordem
            </button>
          )}
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
      {loading && !costs && !setup ? (
        <Loading />
      ) : tab === "costs" && costsAllowed ? (
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
                            ? "Snapshot completo"
                            : order.completeness === "MISSING_COST"
                              ? `${order.missingCostCount} material(is) sem custo`
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
      ) : reportsAllowed ? (
        <>
          <div className="notice info">
            <strong>Conciliação por arquivo, sem conector automático.</strong>{" "}
            Compare o saldo contábil ou o custo líquido de materiais com uma
            exportação da empresa. Os códigos e o critério de custo precisam ser
            validados com ela; este relatório não envia ajustes ao ERP.
          </div>
          <section className="panel">
            <div className="panel-heading">
              <div>
                <h2>Nova conferência de arquivo</h2>
                <p>
                  {setup
                    ? `${setup.unitName} · código obrigatório no CSV: ${setup.unitCode}`
                    : "Carregue a unidade para preparar o modelo."}
                </p>
              </div>
              <button
                className="button secondary"
                onClick={template}
                disabled={!setup || busy}
              >
                <Download size={16} /> Baixar modelo
              </button>
            </div>
            <form className="reconciliation-form" onSubmit={preview}>
              <fieldset
                disabled={busy}
                style={{ border: 0, padding: 0, margin: 0 }}
              >
                <div className="form-grid">
                  <label>
                    Comparar
                    <select
                      value={draft.kind}
                      onChange={(event) =>
                        change({
                          kind: event.target.value as Draft["kind"],
                          csv: "",
                        })
                      }
                    >
                      <option value="STOCK">
                        Saldo contábil por produto/local
                      </option>
                      {costsAllowed && (
                        <option value="ORDER_COST">
                          Custo de materiais por ordem faturada
                        </option>
                      )}
                    </select>
                  </label>
                  <label>
                    Origem do arquivo
                    <input
                      required
                      minLength={3}
                      maxLength={160}
                      placeholder="Ex.: exportação de estoque do ERP da empresa"
                      value={draft.sourceName}
                      onChange={(event) =>
                        change({ sourceName: event.target.value })
                      }
                    />
                  </label>
                  <label>
                    Data/hora de referência da exportação
                    <input
                      required
                      type="datetime-local"
                      value={draft.referenceAt}
                      onChange={(event) =>
                        change({ referenceAt: event.target.value })
                      }
                    />
                  </label>
                  <label>
                    Separador do CSV
                    <select
                      value={draft.delimiter}
                      onChange={(event) =>
                        change({
                          delimiter: event.target.value as Draft["delimiter"],
                        })
                      }
                    >
                      <option value=";">Ponto e vírgula (;)</option>
                      <option value=",">Vírgula (,)</option>
                    </select>
                  </label>
                  <label>
                    Formato dos decimais
                    <select
                      value={draft.decimalFormat}
                      onChange={(event) =>
                        change({
                          decimalFormat: event.target
                            .value as Draft["decimalFormat"],
                        })
                      }
                    >
                      <option value="BR">Vírgula decimal: 12,50</option>
                      <option value="CANONICAL">Ponto decimal: 12.50</option>
                    </select>
                  </label>
                  <label>
                    Arquivo CSV (até 1 MB / 1.000 linhas)
                    <input
                      key={draft.kind}
                      type="file"
                      accept=".csv,text/csv"
                      onChange={(event) =>
                        void loadFile(event.target.files?.[0])
                      }
                    />
                  </label>
                </div>
                <p className="workflow-help">
                  Use os códigos cadastrados, uma linha por produto/local ou
                  ordem, e números sem separador de milhar. Com separador
                  vírgula, coloque valores com vírgula decimal entre aspas.
                  Itens fora do arquivo não serão conciliados.
                </p>
                <button
                  className="button primary"
                  type="submit"
                  disabled={!draft.csv || !setup || fileReading}
                >
                  <FileCheck2 size={17} />
                  {fileReading
                    ? "Lendo arquivo…"
                    : busy
                      ? "Conferindo…"
                      : "Conferir e visualizar"}
                </button>
              </fieldset>
            </form>
          </section>
          {comparison && (
            <section className="panel">
              <div className="panel-heading">
                <div>
                  <h2>
                    {savedId ? "Documento registrado" : "Prévia da conciliação"}
                  </h2>
                  <p>
                    {comparison.sourceName} · Referência ERP:{" "}
                    {dateTime(comparison.referenceAt)}
                  </p>
                  <small>
                    Almox consultado em {dateTime(comparison.comparedAt)} ·{" "}
                    {comparison.unitCode}
                  </small>
                </div>
                <button className="button secondary" onClick={exportComparison}>
                  <Download size={16} /> Exportar diferenças
                </button>
              </div>
              <p className="workflow-help">{comparison.criterion}</p>
              <p className="workflow-help">
                {comparison.notice} {comparison.scope}
              </p>
              <div className="toolbar">
                <Badge tone="success">
                  {comparison.totals.matches} conferem
                </Badge>
                <Badge tone="danger">
                  {comparison.totals.differences} divergências
                </Badge>
                <Badge tone="warning">
                  {comparison.totals.incomplete} incompletos
                </Badge>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>
                        {comparison.kind === "STOCK" ? "Produto" : "Ordem"}
                      </th>
                      {comparison.kind === "STOCK" && <th>Local</th>}
                      <th>Almox</th>
                      <th>ERP</th>
                      <th>Diferença (Almox − ERP)</th>
                      <th>Situação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {comparison.rows.map((row) => {
                      const display = (value: string | null) =>
                        value === null
                          ? "Sem custo histórico"
                          : comparison.kind === "STOCK"
                            ? qty(value)
                            : money(value);
                      return (
                        <tr key={`${row.code}:${row.location}`}>
                          <td>
                            <strong>{row.code}</strong>
                          </td>
                          {comparison.kind === "STOCK" && (
                            <td>{row.location}</td>
                          )}
                          <td>{display(row.localValue)}</td>
                          <td>{display(row.externalValue)}</td>
                          <td>
                            {row.difference === null
                              ? "—"
                              : display(row.difference)}
                          </td>
                          <td>
                            <Badge
                              tone={
                                row.status === "MATCH"
                                  ? "success"
                                  : row.status === "INCOMPLETE"
                                    ? "warning"
                                    : "danger"
                              }
                            >
                              {row.status === "MATCH"
                                ? "Confere"
                                : row.status === "INCOMPLETE"
                                  ? "Incompleto"
                                  : "Revisar"}
                            </Badge>
                            {row.reason && <small>{row.reason}</small>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {!savedId && canSave && (
                <div className="form-actions">
                  <button
                    className="button primary"
                    disabled={busy}
                    onClick={() => void save()}
                  >
                    Salvar documento de conferência
                  </button>
                  <span>
                    Os valores serão consultados novamente ao salvar. Nenhum
                    saldo será corrigido.
                  </span>
                </div>
              )}
            </section>
          )}
          <section className="panel">
            <div className="panel-heading">
              <div>
                <h2>Últimas conferências</h2>
                <p>
                  Documentos imutáveis para revisão. Até 50 registros mais
                  recentes.
                </p>
              </div>
            </div>
            {!history.length ? (
              <Empty
                title="Nenhum arquivo conferido ainda"
                description="Importe uma exportação e revise as diferenças antes de salvar o documento."
              />
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Origem</th>
                      <th>Comparação</th>
                      <th>Referência ERP</th>
                      <th>Registrada em</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((batch) => (
                      <tr key={batch.id}>
                        <td>{batch.sourceName}</td>
                        <td>
                          {batch.kind === "STOCK"
                            ? "Saldo contábil"
                            : "Custo de materiais"}
                        </td>
                        <td>{dateTime(batch.referenceAt)}</td>
                        <td>{dateTime(batch.createdAt)}</td>
                        <td>
                          <button
                            className="text-button"
                            disabled={busy}
                            onClick={() => void openBatch(batch.id)}
                          >
                            Abrir
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      ) : null}
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
              ? `${detail.missingCostCount} material(is) sem custo histórico; total não consolidado.`
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
