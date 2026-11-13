"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Download,
  FileUp,
  Plus,
  RefreshCw,
  ArrowRight,
  Check,
  ClipboardCheck,
} from "lucide-react";
import { api, ApiError, dateTime, money, qty } from "@/lib/client";
import { canSaveReconciliation } from "@/lib/access-profiles";
import { readReconciliationCsv, safeCsvCell } from "@/lib/reconciliation-csv";
import {
  REVIEW_CAUSES,
  REVIEW_LABELS,
  type ReconciliationInput,
  type ReconciliationReview,
  type ReconciliationReviewInput,
  type ReconciliationMapping,
  type ReviewStatus,
} from "@/lib/reconciliation-format";
import { Badge, Empty, Loading, Modal } from "@/components/ui";
import type { previewReconciliation } from "@/services/reconciliation";

type Comparison = Awaited<ReturnType<typeof previewReconciliation>>;
type Document = {
  id?: string;
  result: Comparison;
  createdAt?: string;
  createdBy?: { name: string };
  review?: ReconciliationReview;
  reused?: boolean;
};
type Batch = {
  id: string;
  kind: string;
  sourceName: string;
  referenceAt: string;
  createdAt: string;
  review: Pick<ReconciliationReview, "status" | "nextBatchId">;
  totals?: Comparison["totals"];
  revision?: number;
};
type Draft = Omit<ReconciliationInput, "context" | "mapping"> & {
  erpName: string;
  cutoffNote: string;
};
type Analysis = ReconciliationReviewInput["analyses"][number];
const rowKey = (row: { code: string; location: string | null }) =>
  JSON.stringify([row.code, row.location]);
const message = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "Não foi possível concluir a conferência.";
const nowLocal = () => {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
};
const initialDraft = (): Draft => ({
  kind: "STOCK",
  sourceName: "",
  referenceAt: nowLocal(),
  delimiter: ";",
  decimalFormat: "BR",
  csv: "",
  erpName: "",
  cutoffNote: "",
});
const reviewTone = (status: ReviewStatus) =>
  status === "MATCHED"
    ? "success"
    : status === "WITH_DIFFERENCES" || status === "RETURNED"
      ? "warning"
      : "";
function download(name: string, rows: string[][]) {
  const url = URL.createObjectURL(
    new Blob(
      [
        "\uFEFF",
        rows.map((row) => row.map(safeCsvCell).join(";")).join("\r\n"),
      ],
      { type: "text/csv;charset=utf-8" },
    ),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

export default function ErpReconciliation({
  permissions,
}: {
  permissions: string[];
}) {
  const canWrite = canSaveReconciliation(permissions),
    costsAllowed = permissions.includes("costs:read");
  const [setup, setSetup] = useState<{
    unitCode: string;
    unitName: string;
  } | null>(null);
  const [history, setHistory] = useState<Batch[]>([]);
  const [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [reading, setReading] = useState(false);
  const [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [showImport, setShowImport] = useState(false),
    [draft, setDraft] = useState<Draft>(initialDraft);
  const [selection, setSelection] = useState<Partial<ReconciliationMapping>>(
    {},
  );
  const [confirmed, setConfirmed] = useState(false),
    [fileName, setFileName] = useState("");
  const [document, setDocument] = useState<Document | null>(null);
  const [filter, setFilter] = useState("ALL"),
    [historySearch, setHistorySearch] = useState("");
  const [lineFilter, setLineFilter] = useState("ALL"),
    [lineSearch, setLineSearch] = useState(""),
    [page, setPage] = useState(1);
  const [reviewing, setReviewing] = useState(false),
    [decision, setDecision] = useState<"ACCEPT" | "RETURN">("ACCEPT"),
    [note, setNote] = useState("");
  const [analyses, setAnalyses] = useState<Record<string, Analysis>>({}),
    [editing, setEditing] = useState<Analysis | null>(null);
  const readGeneration = useRef(0),
    saveKey = useRef(""),
    reviewCommand = useRef<{ body: string; key: string } | null>(null);
  const previewInput = useRef<ReconciliationInput | null>(null);
  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const [batches, unit] = await Promise.all([
        api<Batch[]>("/api/reconciliation", { signal }),
        api<{ unitCode: string; unitName: string }>(
          "/api/reconciliation/setup",
          { signal },
        ),
      ]);
      if (!signal?.aborted) {
        setHistory(batches);
        setSetup(unit);
      }
    } catch (cause) {
      if (!signal?.aborted) setError(message(cause));
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    const generation = readGeneration;
    void Promise.resolve().then(() => {
      if (!controller.signal.aborted) return load(controller.signal);
    });
    return () => {
      controller.abort();
      generation.current++;
    };
  }, [load]);

  const parsed = useMemo(() => {
    if (!draft.csv) return { header: [] as string[], error: "" };
    try {
      const rows = readReconciliationCsv(draft.csv, draft.delimiter, 32);
      const header = rows[0] ?? [];
      if (
        header.some((h) => !h || h.length > 200) ||
        new Set(header).size !== header.length
      )
        throw new Error(
          "Use nomes diferentes e preenchidos no cabeçalho do arquivo.",
        );
      if (rows.length < 2)
        throw new Error("O arquivo precisa de pelo menos uma linha de dados.");
      return { header, error: "" };
    } catch (cause) {
      return { header: [] as string[], error: message(cause) };
    }
  }, [draft.csv, draft.delimiter]);
  const fields: Array<{
    key: keyof ReconciliationMapping;
    title: string;
    canonical: string;
  }> = [
    { key: "unit", title: "Unidade", canonical: "unidade" },
    {
      key: "code",
      title: draft.kind === "STOCK" ? "Código do produto" : "Código da ordem",
      canonical: draft.kind === "STOCK" ? "produto" : "ordem",
    },
    ...(draft.kind === "STOCK"
      ? [
          {
            key: "location" as const,
            title: "Código do local",
            canonical: "local",
          },
        ]
      : []),
    {
      key: "value",
      title: draft.kind === "STOCK" ? "Quantidade" : "Custo de materiais",
      canonical: draft.kind === "STOCK" ? "quantidade" : "custo",
    },
  ];
  const mapped = Object.fromEntries(
    fields.map((field) => [
      field.key,
      selection[field.key] ??
        (parsed.header.includes(field.canonical) ? field.canonical : ""),
    ]),
  ) as ReconciliationMapping;
  function change(values: Partial<Draft>) {
    setDraft((current) => ({ ...current, ...values }));
    setError("");
    setNotice("");
    if (values.kind) {
      readGeneration.current++;
      setReading(false);
      setConfirmed(false);
      setSelection({});
      setFileName("");
      setDraft((current) => ({ ...current, csv: "", recheckOf: undefined }));
    }
    if (values.delimiter) setSelection({});
  }
  function open(next: Document) {
    setDocument(next);
    setReviewing(false);
    setEditing(null);
    setAnalyses({});
    setNote("");
    reviewCommand.current = null;
    setLineFilter(
      next.result.totals.differences || next.result.totals.incomplete
        ? "PENDING"
        : "ALL",
    );
    setLineSearch("");
    setPage(1);
    setError("");
    setDecision(next.result.totals.incomplete ? "RETURN" : "ACCEPT");
  }
  async function readFile(file?: File) {
    const generation = ++readGeneration.current;
    change({ csv: "", recheckOf: undefined });
    setSelection({});
    setFileName("");
    setReading(false);
    if (!file) return;
    if (file.size > 1_048_576) {
      setError("Envie um CSV de até 1 MB.");
      return;
    }
    setReading(true);
    try {
      const csv = await file.text();
      if (generation === readGeneration.current) {
        change({ csv });
        setFileName(file.name);
      }
    } catch {
      if (generation === readGeneration.current)
        setError("Não foi possível ler o arquivo.");
    } finally {
      if (generation === readGeneration.current) setReading(false);
    }
  }
  async function preview(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!confirmed || !setup) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const { erpName, cutoffNote, ...rest } = draft;
      const input: ReconciliationInput = {
        ...rest,
        referenceAt: new Date(draft.referenceAt).toISOString(),
        mapping: mapped,
        context: {
          erpName,
          cutoffNote,
          basis:
            draft.kind === "STOCK" ? "LEDGER_BALANCE" : "INVOICED_MATERIALS",
        },
      };
      const result = await api<Comparison>("/api/reconciliation/preview", {
        method: "POST",
        body: JSON.stringify(input),
      });
      previewInput.current = input;
      saveKey.current = crypto.randomUUID();
      open({ result });
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    if (!canWrite || !previewInput.current || document?.id) return;
    setBusy(true);
    setError("");
    try {
      const batch = await api<Document>("/api/reconciliation", {
        method: "POST",
        body: JSON.stringify({
          ...previewInput.current,
          idempotencyKey: saveKey.current,
        }),
      });
      open(batch);
      setShowImport(false);
      setNotice(
        batch.reused
          ? "Este arquivo já foi registrado. A conferência existente foi aberta."
          : "Conferência registrada. A revisão deve ser feita por outra pessoa autorizada.",
      );
      await load();
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  }
  async function openBatch(id: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      open(await api<Document>(`/api/reconciliation/${id}`));
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  }
  async function recheck() {
    if (!document?.id || !canWrite) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const input = await api<ReconciliationInput>(
        `/api/reconciliation/${document.id}/recheck`,
      );
      const reference = new Date(input.referenceAt);
      setDraft({
        kind: input.kind,
        sourceName: input.sourceName,
        referenceAt: new Date(
          reference.getTime() - reference.getTimezoneOffset() * 60_000,
        )
          .toISOString()
          .slice(0, -1),
        delimiter: input.delimiter,
        decimalFormat: input.decimalFormat,
        csv: input.csv,
        erpName: input.context!.erpName,
        cutoffNote: input.context!.cutoffNote,
        recheckOf: input.recheckOf,
      });
      readGeneration.current++;
      setReading(false);
      setSelection({});
      setConfirmed(false);
      setFileName("Arquivo da conferência anterior");
      setShowImport(true);
      setDocument(null);
      setReviewing(false);
      setEditing(null);
      setNotice(
        "O arquivo e a referência do ERP foram preservados. Revise os critérios e visualize a nova conferência antes de registrar.",
      );
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  }
  async function submitReview(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!document?.id || !document.review?.canReview) return;
    const command = {
      decision,
      note,
      analyses: decision === "ACCEPT" ? Object.values(analyses) : [],
      snapshotHash: document.result.snapshotHash,
    };
    const body = JSON.stringify(command);
    if (reviewCommand.current?.body !== body)
      reviewCommand.current = { body, key: crypto.randomUUID() };
    setBusy(true);
    setError("");
    try {
      const batch = await api<Document>(
        `/api/reconciliation/${document.id}/review`,
        {
          method: "POST",
          body: JSON.stringify({
            ...command,
            idempotencyKey: reviewCommand.current.key,
          }),
        },
      );
      open(batch);
      setNotice("Revisão registrada no histórico da conferência.");
      await load();
    } catch (cause) {
      setError(message(cause));
      if (
        cause instanceof ApiError &&
        cause.code === "RECONCILIATION_CHANGED"
      ) {
        setReviewing(false);
        setEditing(null);
      }
    } finally {
      setBusy(false);
    }
  }
  function exportDocument() {
    if (!document) return;
    const { result, review } = document;
    const analysisMap = new Map(
      (review?.analyses ?? []).map((a) => [rowKey(a), a]),
    );
    download(
      `conferencia-${result.unitCode}-${result.kind.toLowerCase()}${result.source ? `-r${result.source.revision}` : ""}.csv`,
      [
        [
          "documento",
          "unidade",
          "erp",
          "origem",
          "referencia_erp",
          "consulta_almox",
          "criterio",
          "corte",
          "revisao",
          "revisor",
          "revisado_em",
          "parecer",
          "codigo",
          "local",
          "almox",
          "erp_valor",
          "diferenca_almox_menos_erp",
          "situacao_linha",
          "causa",
          "analise",
          "referencia_analise",
        ],
        ...result.rows.map((row) => {
          const analysis = analysisMap.get(rowKey(row));
          return [
            document.id ?? "PREVIA",
            result.unitCode,
            result.source?.erpName ?? "",
            result.sourceName,
            result.referenceAt,
            result.comparedAt,
            result.criterion,
            result.source?.cutoffNote ?? "",
            review ? REVIEW_LABELS[review.status] : "Prévia",
            review?.reviewerName ?? "",
            review?.reviewedAt ?? "",
            review?.note ?? "",
            row.code,
            row.location ?? "",
            row.localValue ?? "INCOMPLETO",
            row.externalValue,
            row.difference ?? "",
            row.status,
            analysis ? REVIEW_CAUSES[analysis.cause] : "",
            analysis?.note ?? "",
            analysis?.reference ?? "",
          ];
        }),
      ],
    );
  }
  const filteredHistory = history.filter(
    (batch) =>
      (filter === "ALL" ||
        (batch.review?.status === filter &&
          (filter !== "PENDING" || !batch.review.nextBatchId))) &&
      batch.sourceName
        .toLowerCase()
        .includes(historySearch.trim().toLowerCase()),
  );
  const result = document?.result;
  const lines =
    result?.rows.filter(
      (row) =>
        (lineFilter === "ALL" ||
          (lineFilter === "PENDING"
            ? row.status !== "MATCH"
            : row.status === lineFilter)) &&
        `${row.code} ${row.location ?? ""}`
          .toLowerCase()
          .includes(lineSearch.trim().toLowerCase()),
    ) ?? [];
  const pageCount = Math.max(1, Math.ceil(lines.length / 25)),
    currentPage = Math.min(page, pageCount);
  const display = (value: string | null) =>
    value === null
      ? "Sem custo histórico"
      : result?.kind === "STOCK"
        ? qty(value)
        : money(value);
  const differences =
    result?.rows.filter((row) => row.status === "DIFFERENCE") ?? [];
  const allAnalysed = differences.every((row) => !!analyses[rowKey(row)]);
  const pendingCount = history.filter(
    (batch) => batch.review?.status === "PENDING" && !batch.review.nextBatchId,
  ).length;

  return (
    <div className="recon-workbench">
      {!document && error && (
        <div className="notice error" role="alert">
          {error}
        </div>
      )}
      {!document && notice && (
        <div className="notice info" role="status">
          {notice}
        </div>
      )}
      <div className="recon-section-heading">
        <div>
          <h2>Conferências do ERP</h2>
          <p>
            {setup?.unitName ?? "Unidade selecionada"}
            {pendingCount ? ` · ${pendingCount} aguardando revisão` : ""}
          </p>
        </div>
        <div className="recon-actions">
          <button
            className="icon-button"
            aria-label="Atualizar conferências"
            disabled={loading || busy}
            onClick={() => void load()}
          >
            <RefreshCw size={18} />
          </button>
          <button
            className="button primary"
            disabled={busy}
            onClick={() => {
              if (!showImport) {
                setDraft(initialDraft());
                setSelection({});
                setConfirmed(false);
                setFileName("");
              }
              setShowImport(!showImport);
              setError("");
            }}
          >
            <Plus size={17} />{" "}
            {showImport ? "Fechar importação" : "Importar arquivo"}
          </button>
        </div>
      </div>
      {showImport && (
        <section className="panel recon-import">
          <div className="panel-heading">
            <div>
              <h2>
                {draft.recheckOf ? "Rever conferência" : "Importar exportação"}
              </h2>
              <p>
                Use os códigos cadastrados nesta unidade e a mesma unidade de
                medida dos materiais.
              </p>
            </div>
            <button
              className="text-button"
              disabled={!setup}
              onClick={() => {
                if (!setup) return;
                download(
                  `modelo-${draft.kind.toLowerCase()}.csv`,
                  draft.kind === "STOCK"
                    ? [
                        ["unidade", "produto", "local", "quantidade"],
                        [
                          setup.unitCode,
                          "CODIGO_PRODUTO",
                          "CODIGO_LOCAL",
                          "0,000",
                        ],
                      ]
                    : [
                        ["unidade", "ordem", "custo"],
                        [setup.unitCode, "CODIGO_ORDEM", "0,00"],
                      ],
                );
              }}
            >
              <Download size={15} /> Baixar modelo
            </button>
          </div>
          <form onSubmit={(event) => void preview(event)}>
            <fieldset disabled={busy || reading} className="recon-fieldset">
              <div className="form-grid">
                <label>
                  Conferir
                  <select
                    aria-label="Conferir"
                    disabled={!!draft.recheckOf}
                    value={draft.kind}
                    onChange={(event) =>
                      change({ kind: event.target.value as Draft["kind"] })
                    }
                  >
                    <option value="STOCK">Saldo de estoque por local</option>
                    {costsAllowed && (
                      <option value="ORDER_COST">
                        Materiais por ordem faturada
                      </option>
                    )}
                  </select>
                </label>
                <label>
                  ERP de origem
                  <input
                    required
                    minLength={2}
                    maxLength={100}
                    value={draft.erpName}
                    placeholder="Nome do sistema usado pela empresa"
                    onChange={(event) =>
                      change({ erpName: event.target.value })
                    }
                  />
                </label>
                <label>
                  Nome do relatório
                  <input
                    required
                    minLength={3}
                    maxLength={160}
                    value={draft.sourceName}
                    placeholder="Ex.: posição de estoque de novembro"
                    onChange={(event) =>
                      change({ sourceName: event.target.value })
                    }
                  />
                </label>
                <label>
                  Data e hora do relatório
                  <input
                    required
                    type="datetime-local"
                    step="0.001"
                    disabled={!!draft.recheckOf}
                    value={draft.referenceAt}
                    onChange={(event) =>
                      change({ referenceAt: event.target.value })
                    }
                  />
                </label>
              </div>
              <label className="recon-file">
                <FileUp size={24} />
                <span>
                  <strong>{fileName || "Escolher arquivo CSV"}</strong>
                  <small>
                    {reading ? "Lendo arquivo…" : "Até 1 MB · até 1.000 linhas"}
                  </small>
                </span>
                <input
                  aria-label="Arquivo CSV"
                  key={draft.kind}
                  type="file"
                  accept=".csv,text/csv"
                  onChange={(event) => void readFile(event.target.files?.[0])}
                />
              </label>
              <details className="recon-details">
                <summary>Formato do arquivo</summary>
                <div className="form-grid">
                  <label>
                    Separador
                    <select
                      aria-label="Separador"
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
                    Decimais
                    <select
                      aria-label="Decimais"
                      value={draft.decimalFormat}
                      onChange={(event) =>
                        change({
                          decimalFormat: event.target
                            .value as Draft["decimalFormat"],
                        })
                      }
                    >
                      <option value="BR">Vírgula — 12,50</option>
                      <option value="CANONICAL">Ponto — 12.50</option>
                    </select>
                  </label>
                </div>
                <p className="workflow-help">
                  Use números sem separador de milhar. Cada produto/local ou
                  ordem deve aparecer uma vez.
                </p>
              </details>
              {parsed.error && (
                <p className="notice error" role="alert">
                  {parsed.error}
                </p>
              )}
              {!!parsed.header.length && (
                <div className="recon-mapping">
                  <h3>Colunas do arquivo</h3>
                  <p className="workflow-help">
                    Indique qual coluna corresponde a cada campo. As demais
                    ficam fora da conferência.
                  </p>
                  <div className="form-grid">
                    {fields.map((field) => (
                      <label key={field.key}>
                        {field.title}
                        <select
                          aria-label={field.title}
                          required
                          value={mapped[field.key]}
                          onChange={(event) =>
                            setSelection((current) => ({
                              ...current,
                              [field.key]: event.target.value,
                            }))
                          }
                        >
                          <option value="">Selecionar coluna</option>
                          {parsed.header.map((header) => (
                            <option key={header} value={header}>
                              {header}
                            </option>
                          ))}
                        </select>
                      </label>
                    ))}
                  </div>
                </div>
              )}
              <label>
                Corte e observações
                <textarea
                  aria-label="Corte e observações"
                  required
                  minLength={10}
                  maxLength={1000}
                  rows={2}
                  value={draft.cutoffNote}
                  placeholder="Informe até quando os lançamentos do relatório foram feitos e o que precisa ser considerado na comparação."
                  onChange={(event) =>
                    change({ cutoffNote: event.target.value })
                  }
                />
              </label>
              <label className="recon-confirm">
                <input
                  required
                  type="checkbox"
                  checked={confirmed}
                  onChange={(event) => setConfirmed(event.target.checked)}
                />
                <span>
                  {draft.kind === "STOCK"
                    ? "O relatório contém o saldo contábil, antes de descontar reservas e aplicações ainda abertas."
                    : "O relatório contém apenas o custo de materiais de ordens faturadas, em reais, sem mão de obra ou custos indiretos."}
                </span>
              </label>
              <div className="form-actions">
                <button
                  className="button primary"
                  disabled={
                    !draft.csv ||
                    !parsed.header.length ||
                    !!parsed.error ||
                    !setup ||
                    !confirmed
                  }
                  type="submit"
                >
                  <ClipboardCheck size={17} />{" "}
                  {busy ? "Conferindo…" : "Visualizar conferência"}
                </button>
                <span>Os valores do Almox serão consultados agora.</span>
              </div>
            </fieldset>
          </form>
        </section>
      )}
      {loading && !setup ? (
        <Loading />
      ) : (
        <section className="panel recon-history">
          <div className="toolbar">
            <label className="table-search">
              <input
                aria-label="Buscar conferência"
                placeholder="Buscar relatório"
                value={historySearch}
                onChange={(event) => setHistorySearch(event.target.value)}
              />
            </label>
            <select
              aria-label="Situação da conferência"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
            >
              <option value="ALL">Todas as situações</option>
              {Object.entries(REVIEW_LABELS).map(([value, label]) => (
                <option value={value} key={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          {!filteredHistory.length ? (
            <Empty
              title={
                history.length
                  ? "Nenhuma conferência neste filtro"
                  : "A primeira conferência começa pelo arquivo"
              }
              description={
                history.length
                  ? "Busque outro relatório ou altere a situação."
                  : "Exporte o estoque ou os custos do ERP e importe o CSV para conferir os valores."
              }
            />
          ) : (
            <div className="table-wrap">
              <table className="recon-history-table">
                <thead>
                  <tr>
                    <th>Relatório</th>
                    <th>Referência ERP</th>
                    <th>Consulta Almox</th>
                    <th>Situação</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredHistory.map((batch) => (
                    <tr key={batch.id}>
                      <td data-label="Relatório">
                        <strong>{batch.sourceName}</strong>
                        <small>
                          {batch.kind === "STOCK"
                            ? "Estoque por local"
                            : "Materiais por ordem"}
                          {batch.revision ? ` · revisão ${batch.revision}` : ""}
                        </small>
                      </td>
                      <td data-label="Referência ERP">
                        {dateTime(batch.referenceAt)}
                      </td>
                      <td data-label="Consulta Almox">
                        {dateTime(batch.createdAt)}
                      </td>
                      <td data-label="Situação">
                        <Badge
                          tone={reviewTone(batch.review?.status ?? "LEGACY")}
                        >
                          {REVIEW_LABELS[batch.review?.status ?? "LEGACY"]}
                        </Badge>
                        {batch.review?.nextBatchId && (
                          <small>Há revisão mais recente</small>
                        )}
                      </td>
                      <td>
                        <button
                          className="text-button"
                          disabled={busy}
                          onClick={() => void openBatch(batch.id)}
                          aria-label={`Abrir conferência ${batch.sourceName}`}
                        >
                          Abrir <ArrowRight size={15} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="workflow-help">
            Até 50 registros recentes. U.C.A. e Capacle são conferidas
            separadamente.
          </p>
        </section>
      )}
      {document && result && (
        <Modal
          wide
          closeDisabled={busy}
          title={
            result.kind === "STOCK"
              ? "Conferência de estoque"
              : "Conferência de materiais por ordem"
          }
          subtitle={result.sourceName}
          onClose={() => {
            if (!busy) {
              setDocument(null);
              setError("");
            }
          }}
        >
          <div className="recon-document">
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
            <div className="recon-document-heading">
              <div>
                <Badge
                  tone={
                    document.review ? reviewTone(document.review.status) : ""
                  }
                >
                  {document.review
                    ? REVIEW_LABELS[document.review.status]
                    : "Prévia"}
                </Badge>
                <span>
                  {result.unitCode}
                  {result.source ? ` · revisão ${result.source.revision}` : ""}
                </span>
              </div>
              <button className="text-button" onClick={exportDocument}>
                <Download size={16} /> Exportar conferência
              </button>
            </div>
            <dl className="recon-dates">
              <div>
                <dt>Referência do ERP</dt>
                <dd>{dateTime(result.referenceAt)}</dd>
              </div>
              <div>
                <dt>Almox consultado em</dt>
                <dd>{dateTime(result.comparedAt)}</dd>
              </div>
              {document.createdBy && (
                <div>
                  <dt>Registrado por</dt>
                  <dd>{document.createdBy.name}</dd>
                </div>
              )}
            </dl>
            <div
              className={`recon-totals ${result.kind === "STOCK" ? "stock" : ""}`}
            >
              <div>
                <strong>{result.totals.matches}</strong>
                <span>Conferem</span>
              </div>
              <div
                className={result.totals.differences ? "has-difference" : ""}
              >
                <strong>{result.totals.differences}</strong>
                <span>Diferenças</span>
              </div>
              {result.kind === "ORDER_COST" && (
                <div>
                  <strong>{result.totals.incomplete}</strong>
                  <span>Sem custo histórico</span>
                </div>
              )}
            </div>
            <details className="recon-details">
              <summary>Origem e critérios</summary>
              {result.source && (
                <>
                  <p>
                    <strong>{result.source.erpName}</strong>
                  </p>
                  <p>{result.source.cutoffNote}</p>
                </>
              )}
              <p>{result.criterion}</p>
              <p>{result.notice}</p>
              <p>{result.scope}</p>
              {document.id && <small>Documento {document.id}</small>}
            </details>
            {result.totals.incomplete > 0 && (
              <p className="notice warning">
                Há ordens sem custo histórico. Elas precisam de análise antes de
                concluir a conferência.
              </p>
            )}
            <div className="toolbar">
              <label className="table-search">
                <input
                  aria-label="Buscar linha da conferência"
                  placeholder="Buscar código ou local"
                  value={lineSearch}
                  onChange={(event) => {
                    setLineSearch(event.target.value);
                    setPage(1);
                  }}
                />
              </label>
              <select
                aria-label="Linhas da conferência"
                value={lineFilter}
                onChange={(event) => {
                  setLineFilter(event.target.value);
                  setPage(1);
                }}
              >
                <option value="ALL">Todas as linhas</option>
                <option value="PENDING">Diferenças e incompletos</option>
                <option value="MATCH">Só o que confere</option>
                <option value="DIFFERENCE">Só diferenças</option>
                <option value="INCOMPLETE">Sem custo histórico</option>
              </select>
            </div>
            <div className="table-wrap">
              <table className="recon-lines">
                <thead>
                  <tr>
                    <th>
                      {result.kind === "STOCK" ? "Produto / local" : "Ordem"}
                    </th>
                    <th>Almox</th>
                    <th>ERP</th>
                    <th>Diferença</th>
                    <th>Situação</th>
                  </tr>
                </thead>
                <tbody>
                  {lines
                    .slice((currentPage - 1) * 25, currentPage * 25)
                    .map((row) => (
                      <tr key={rowKey(row)}>
                        <td
                          data-label={
                            result.kind === "STOCK"
                              ? "Produto / local"
                              : "Ordem"
                          }
                        >
                          <strong>{row.code}</strong>
                          {row.location && <small>{row.location}</small>}
                        </td>
                        <td data-label="Almox">{display(row.localValue)}</td>
                        <td data-label="ERP">{display(row.externalValue)}</td>
                        <td data-label="Almox − ERP">
                          {row.difference === null
                            ? "—"
                            : display(row.difference)}
                        </td>
                        <td data-label="Situação">
                          <Badge
                            tone={
                              row.status === "MATCH" ? "success" : "warning"
                            }
                          >
                            {row.status === "MATCH"
                              ? "Confere"
                              : row.status === "DIFFERENCE"
                                ? "Diferença"
                                : "Incompleto"}
                          </Badge>
                          {row.reason && <small>{row.reason}</small>}
                          {reviewing && row.status === "DIFFERENCE" && (
                            <button
                              className="text-button"
                              onClick={() =>
                                setEditing(
                                  analyses[rowKey(row)] ?? {
                                    code: row.code,
                                    location: row.location,
                                    cause: "POSTING",
                                    note: "",
                                    reference: "",
                                  },
                                )
                              }
                            >
                              {analyses[rowKey(row)]
                                ? "Editar análise"
                                : "Registrar análise"}
                            </button>
                          )}
                          {!!analyses[rowKey(row)] && reviewing && (
                            <small className="recon-ready">
                              <Check size={12} /> Análise pronta
                            </small>
                          )}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            {!lines.length && (
              <p className="workflow-help">Nenhuma linha neste filtro.</p>
            )}
            {pageCount > 1 && (
              <div className="pagination">
                <button
                  className="button secondary"
                  disabled={currentPage <= 1}
                  onClick={() => setPage(currentPage - 1)}
                >
                  Anterior
                </button>
                <span>
                  {currentPage} de {pageCount} · {lines.length} linhas
                </span>
                <button
                  className="button secondary"
                  disabled={currentPage >= pageCount}
                  onClick={() => setPage(currentPage + 1)}
                >
                  Próxima
                </button>
              </div>
            )}
            {editing && reviewing && (
              <form
                className="recon-analysis"
                onSubmit={(event) => {
                  event.preventDefault();
                  setAnalyses((current) => ({
                    ...current,
                    [rowKey(editing)]: editing,
                  }));
                  setEditing(null);
                }}
              >
                <h3>
                  Análise · {editing.code}
                  {editing.location ? ` / ${editing.location}` : ""}
                </h3>
                <div className="form-grid">
                  <label>
                    Causa
                    <select
                      aria-label="Causa"
                      value={editing.cause}
                      onChange={(event) =>
                        setEditing(
                          (current) =>
                            current && {
                              ...current,
                              cause: event.target.value as Analysis["cause"],
                            },
                        )
                      }
                    >
                      {Object.entries(REVIEW_CAUSES).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Referência da análise
                    <input
                      required
                      minLength={3}
                      maxLength={200}
                      value={editing.reference}
                      placeholder="Nº da ordem, nota ou registro de conferência"
                      onChange={(event) =>
                        setEditing(
                          (current) =>
                            current && {
                              ...current,
                              reference: event.target.value,
                            },
                        )
                      }
                    />
                  </label>
                </div>
                <label>
                  O que foi verificado
                  <textarea
                    required
                    minLength={10}
                    maxLength={600}
                    rows={2}
                    value={editing.note}
                    onChange={(event) =>
                      setEditing(
                        (current) =>
                          current && { ...current, note: event.target.value },
                      )
                    }
                  />
                </label>
                <div className="form-actions">
                  <button type="submit" className="button secondary">
                    Usar análise
                  </button>
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => setEditing(null)}
                  >
                    Cancelar
                  </button>
                </div>
              </form>
            )}
            {document.review?.note && (
              <section className="recon-receipt">
                <h3>Parecer da revisão</h3>
                <p className="recon-prose">{document.review.note}</p>
                <small>
                  {document.review.reviewerName} ·{" "}
                  {dateTime(document.review.reviewedAt!)}
                </small>
                {document.review.analyses.map((analysis) => (
                  <details className="recon-details" key={rowKey(analysis)}>
                    <summary>
                      {analysis.code}
                      {analysis.location
                        ? ` / ${analysis.location}`
                        : ""} · {REVIEW_CAUSES[analysis.cause]}
                    </summary>
                    <p className="recon-prose">{analysis.note}</p>
                    <small>Referência: {analysis.reference}</small>
                  </details>
                ))}
              </section>
            )}
            {document.review?.reason &&
              document.review.status === "PENDING" && (
                <p className="workflow-help">{document.review.reason}</p>
              )}
            {document.review?.status === "LEGACY" && (
              <p className="workflow-help">{document.review.reason}</p>
            )}
            {reviewing && document.review?.canReview && (
              <form
                className="recon-review-form"
                onSubmit={(event) => void submitReview(event)}
              >
                <h3>Revisar documento</h3>
                <fieldset className="recon-fieldset" disabled={busy}>
                  <label>
                    Resultado
                    <select
                      aria-label="Resultado"
                      value={decision}
                      onChange={(event) =>
                        setDecision(event.target.value as "ACCEPT" | "RETURN")
                      }
                    >
                      <option
                        value="ACCEPT"
                        disabled={result.totals.incomplete > 0}
                      >
                        Concluir conferência
                        {differences.length ? " com ressalvas" : ""}
                      </option>
                      <option value="RETURN">Devolver para análise</option>
                    </select>
                  </label>
                  {decision === "ACCEPT" && differences.length > 0 && (
                    <p className="workflow-help">
                      {Object.keys(analyses).length} de {differences.length}{" "}
                      diferenças analisadas. Use Registrar análise nas linhas
                      acima. As análises serão salvas ao concluir.
                    </p>
                  )}
                  <label>
                    Parecer geral
                    <textarea
                      required
                      minLength={10}
                      maxLength={2000}
                      rows={3}
                      value={note}
                      placeholder={
                        decision === "RETURN"
                          ? "Descreva o que precisa ser conferido ou corrigido."
                          : "Registre o resultado da conferência."
                      }
                      onChange={(event) => setNote(event.target.value)}
                    />
                  </label>
                  <p className="workflow-help">
                    O parecer registra a conferência. Correções devem ser feitas
                    no processo de origem.
                  </p>
                  <div className="form-actions">
                    <button
                      className="button primary"
                      type="submit"
                      disabled={
                        !!editing ||
                        (decision === "ACCEPT" &&
                          (!allAnalysed || result.totals.incomplete > 0))
                      }
                    >
                      {busy
                        ? "Registrando…"
                        : decision === "RETURN"
                          ? "Devolver para análise"
                          : differences.length
                            ? "Concluir com ressalvas"
                            : "Concluir conferência"}
                    </button>
                    <button
                      className="text-button"
                      type="button"
                      onClick={() => {
                        setReviewing(false);
                        setEditing(null);
                      }}
                    >
                      Cancelar revisão
                    </button>
                  </div>
                </fieldset>
              </form>
            )}
            <div className="recon-document-actions">
              {!document.id && canWrite && (
                <button
                  className="button primary"
                  disabled={busy}
                  onClick={() => void save()}
                >
                  {busy ? "Registrando…" : "Registrar conferência"}
                </button>
              )}
              {document.review?.canReview && !reviewing && (
                <button
                  className="button primary"
                  onClick={() => {
                    setReviewing(true);
                    setLineFilter(
                      result.totals.differences || result.totals.incomplete
                        ? "PENDING"
                        : "ALL",
                    );
                    setPage(1);
                  }}
                >
                  Revisar documento
                </button>
              )}
              {document.id &&
                result.source &&
                canWrite &&
                !document.review?.nextBatchId &&
                !reviewing && (
                  <button
                    className="button secondary"
                    disabled={busy}
                    onClick={() => void recheck()}
                  >
                    <RefreshCw size={16} /> Nova conferência
                  </button>
                )}
              {document.review?.nextBatchId && (
                <button
                  className="button secondary"
                  disabled={busy}
                  onClick={() => void openBatch(document.review!.nextBatchId!)}
                >
                  Abrir revisão seguinte <ArrowRight size={15} />
                </button>
              )}
              {!document.id && !canWrite && (
                <p className="workflow-help">
                  Seu perfil permite visualizar a prévia. O registro exige
                  permissão de conciliação.
                </p>
              )}
            </div>
            <p className="recon-footnote">
              A comparação abrange somente as linhas do arquivo. Diferença =
              Almox − ERP.
            </p>
          </div>
        </Modal>
      )}
    </div>
  );
}
