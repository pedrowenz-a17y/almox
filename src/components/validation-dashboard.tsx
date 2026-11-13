"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Plus,
  Download,
  Printer,
  RefreshCw,
  ClipboardCheck,
} from "lucide-react";
import { api, dateTime } from "@/lib/client";
import { validationHtml } from "@/lib/validation-export";
import { safeCsvCell } from "@/lib/reconciliation-csv";
import { canSaveReconciliation } from "@/lib/access-profiles";
import {
  VALIDATION_STEPS,
  VALIDATION_ORIGINS,
  VALIDATION_STATUS,
  type ValidationState,
  type ValidationStepId,
} from "@/lib/validation-plan";
import { Modal, Loading, Empty, Badge } from "@/components/ui";
import type {
  ValidationIndicators,
  getValidationRun,
  listValidationRuns,
} from "@/services/validation-report";
type Run = Awaited<ReturnType<typeof getValidationRun>>;
const text = (e: unknown) =>
  e instanceof Error ? e.message : "Não foi possível consultar a validação.";
const rate = (v: number | null) =>
  v === null
    ? "Sem base"
    : `${v.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;
function csv(name: string, rows: string[][]) {
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
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export default function ValidationDashboard({
  permissions,
}: {
  permissions: string[];
}) {
  const writable = canSaveReconciliation(permissions);
  const [report, setReport] = useState<ValidationIndicators | null>(null),
    [runs, setRuns] = useState<Awaited<ReturnType<typeof listValidationRuns>>>(
      [],
    );
  const [filters, setFilters] = useState({ from: "", to: "" }),
    [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [creating, setCreating] = useState(false),
    [run, setRun] = useState<Run | null>(null);
  const [draft, setDraft] = useState({
    title: "",
    objective: "",
    origin: "DEMONSTRATION" as ValidationState["origin"],
  });
  const [editing, setEditing] = useState<ValidationStepId | null>(null),
    [outcome, setOutcome] = useState<"PASS" | "FAIL">("PASS"),
    [note, setNote] = useState(""),
    [reference, setReference] = useState(""),
    [conclusion, setConclusion] = useState("");
  const command = useRef<{ payload: string; key: string } | null>(null);
  const load = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      try {
        const [data, history] = await Promise.all([
          api<ValidationIndicators>(
            `/api/validation/indicators${query ? `?${query}` : ""}`,
            { signal },
          ),
          api<Awaited<ReturnType<typeof listValidationRuns>>>(
            "/api/validation",
            { signal },
          ),
        ]);
        if (!signal?.aborted) {
          setReport(data);
          setRuns(history);
          setFilters({ from: data.period.from, to: data.period.to });
        }
      } catch (e) {
        if (!signal?.aborted) {
          setError(text(e));
          setReport(null);
        }
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [query],
  );
  useEffect(() => {
    const controller = new AbortController();
    void Promise.resolve().then(() => {
      if (!controller.signal.aborted) return load(controller.signal);
    });
    return () => controller.abort();
  }, [load]);
  function keyFor(payload: unknown) {
    const value = JSON.stringify(payload);
    if (command.current?.payload !== value)
      command.current = { payload: value, key: crypto.randomUUID() };
    return command.current.key;
  }
  async function open(id: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      setRun(await api<Run>(`/api/validation/${id}`));
      setEditing(null);
      setConclusion("");
      command.current = null;
    } catch (e) {
      setError(text(e));
    } finally {
      setBusy(false);
    }
  }
  async function create(event: React.FormEvent) {
    event.preventDefault();
    if (!report || !writable) return;
    setBusy(true);
    setError("");
    try {
      const payload = {
        ...draft,
        from: report.period.from,
        to: report.period.to,
      };
      const saved = await api<Run>("/api/validation", {
        method: "POST",
        body: JSON.stringify({ ...payload, idempotencyKey: keyFor(payload) }),
      });
      setCreating(false);
      setRun(saved);
      setEditing(null);
      setConclusion("");
      command.current = null;
      await load();
    } catch (e) {
      setError(text(e));
    } finally {
      setBusy(false);
    }
  }
  async function record(event: React.FormEvent, close = false) {
    event.preventDefault();
    if (!run) return;
    setBusy(true);
    setError("");
    const payload = close
      ? { action: "CLOSE", conclusion, expectedVersion: run.version }
      : {
          action: "STEP",
          stepId: editing,
          outcome,
          note,
          reference,
          expectedVersion: run.version,
        };
    try {
      const saved = await api<Run>(`/api/validation/${run.id}`, {
        method: "POST",
        body: JSON.stringify({
          ...payload,
          idempotencyKey: keyFor({ id: run.id, ...payload }),
        }),
      });
      setRun(saved);
      setEditing(null);
      command.current = null;
      setNotice(
        close
          ? "Validação encerrada com os resultados relatados."
          : "Resultado e evidência registrados.",
      );
      await load();
    } catch (e) {
      setError(text(e));
    } finally {
      setBusy(false);
    }
  }
  function exportIndicators(data: ValidationIndicators) {
    csv(`indicadores-${data.unit.code}.csv`, [
      [
        "unidade",
        "inicio",
        "fim",
        "consulta",
        "indicador",
        "numerador",
        "denominador",
        "taxa",
        "janela",
      ],
      ...[
        [
          "Baixas vinculadas",
          data.current.linked,
          data.current.exits,
          data.current.linkedPercent,
          "Selecionada",
        ],
        [
          "Entregas documentadas",
          data.current.handoffs,
          data.current.deliveries,
          data.current.handoffPercent,
          "Selecionada",
        ],
        [
          "Itens com diferença",
          data.current.divergent,
          data.current.counted,
          data.current.divergentPercent,
          "Selecionada",
        ],
        [
          "Baixas vinculadas",
          data.previous.linked,
          data.previous.exits,
          data.previous.linkedPercent,
          "Anterior",
        ],
        [
          "Entregas documentadas",
          data.previous.handoffs,
          data.previous.deliveries,
          data.previous.handoffPercent,
          "Anterior",
        ],
        [
          "Itens com diferença",
          data.previous.divergent,
          data.previous.counted,
          data.previous.divergentPercent,
          "Anterior",
        ],
      ].map((row) => [
        data.unit.code,
        row[4] === "Anterior"
          ? data.period.previousFrom.slice(0, 10)
          : data.period.from,
        row[4] === "Anterior"
          ? new Date(Date.parse(data.period.previousUntilExclusive) - 86400000)
              .toISOString()
              .slice(0, 10)
          : data.period.to,
        data.generatedAt,
        ...row.map((value) => (value === null ? "Sem base" : String(value))),
      ]),
      [
        data.unit.code,
        "",
        "",
        data.generatedAt,
        "Pendência atual: devoluções",
        String(data.pending.returns),
        "",
        "",
        "Atual",
      ],
      [
        data.unit.code,
        "",
        "",
        data.generatedAt,
        "Pendência atual: aplicação",
        String(data.pending.unapplied),
        "",
        "",
        "Atual",
      ],
      [
        data.unit.code,
        "",
        "",
        data.generatedAt,
        "Pendência atual: faturamento",
        String(data.pending.awaitingInvoice),
        "",
        "",
        "Atual",
      ],
      ...data.definitions.map((definition) => ["Critério", definition]),
    ]);
  }
  function downloadReport() {
    if (!run) return;
    const url = URL.createObjectURL(
      new Blob([validationHtml(run)], { type: "text/html;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `validacao-${run.id.slice(0, 8)}.html`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function exportRun() {
    if (!run) return;
    csv(`validacao-${run.id.slice(0, 8)}.csv`, [
      [
        "documento",
        "unidade",
        "origem_declarada",
        "titulo",
        "objetivo",
        "situacao",
        "criador",
        "criado_em",
        "encerrado_por",
        "encerrado_em",
        "conclusao",
        "etapa",
        "responsabilidade_prevista",
        "resultado_relatado",
        "evidencia_relatada",
        "referencia",
        "registrado_por",
        "registrado_em",
      ],
      ...VALIDATION_STEPS.map((step) => {
        const saved = run.steps.find((s) => s.id === step.id);
        return [
          run.id,
          run.snapshot.unit.code,
          VALIDATION_ORIGINS[run.origin],
          run.title,
          run.objective,
          VALIDATION_STATUS[run.status],
          run.createdByName,
          run.createdAt,
          run.closedByName ?? "",
          run.closedAt ?? "",
          run.conclusion ?? "",
          step.title,
          step.role,
          saved?.outcome === "PASS"
            ? "Passou"
            : saved?.outcome === "FAIL"
              ? "Falhou"
              : "Não registrado",
          saved?.note ?? "",
          saved?.reference ?? "",
          saved?.recordedByName ?? "",
          saved?.recordedAt ?? "",
        ];
      }),
      [
        "Limite",
        "Resultados declarados pelas pessoas. A referência é informada manualmente; o sistema não autentica documentos externos nem comprova ganho causal.",
      ],
    ]);
  }
  const errors = error && (
    <div className="notice error" role="alert">
      {error}
    </div>
  );
  return (
    <div className="validation-workspace">
      <div className="page-heading">
        <div>
          <h1>Validação e indicadores</h1>
          <p>Acompanhe os registros e documente a conferência do processo.</p>
        </div>
        <div className="heading-actions no-print">
          <button
            className="button secondary"
            disabled={!report || loading || !!run}
            onClick={() => window.print()}
          >
            <Printer size={16} /> Imprimir relatório
          </button>
          <button
            className="button secondary"
            disabled={!report || loading}
            onClick={() => report && exportIndicators(report)}
          >
            <Download size={16} /> Exportar indicadores
          </button>
        </div>
      </div>
      {!run && !creating && errors}
      <form
        className="panel validation-filter no-print"
        onSubmit={(event) => {
          event.preventDefault();
          setError("");
          setQuery(new URLSearchParams(filters).toString());
        }}
      >
        <label>
          Data inicial
          <input
            required
            type="date"
            value={filters.from}
            max={filters.to || undefined}
            onChange={(e) => setFilters({ ...filters, from: e.target.value })}
          />
        </label>
        <label>
          Data final
          <input
            required
            type="date"
            value={filters.to}
            min={filters.from || undefined}
            onChange={(e) => setFilters({ ...filters, to: e.target.value })}
          />
        </label>
        <button className="button secondary" disabled={loading} type="submit">
          Consultar período
        </button>
        <button
          type="button"
          className="icon-button"
          disabled={loading}
          aria-label="Atualizar indicadores"
          onClick={() => void load()}
        >
          <RefreshCw size={17} />
        </button>
      </form>
      {loading && !report ? (
        <Loading />
      ) : (
        report && (
          <>
            <div className="validation-caption">
              <strong>
                {report.unit.name} · {report.unit.code}
              </strong>
              <span>
                {report.period.from} a {report.period.to} · Brasília (UTC−03)
              </span>
              <small>
                Consultado em {dateTime(report.generatedAt)}. Somente registros
                desta unidade no Almox.
              </small>
            </div>
            <div className="validation-metrics">
              {[
                {
                  title: "Baixas vinculadas a ordens",
                  value: rate(report.current.linkedPercent),
                  detail: `${report.current.linked} de ${report.current.exits} saídas contábeis`,
                  previous: rate(report.previous.linkedPercent),
                },
                {
                  title: "Entregas documentadas",
                  value: rate(report.current.handoffPercent),
                  detail: `${report.current.handoffs} de ${report.current.deliveries} aplicações com recebedor identificado`,
                  previous: rate(report.previous.handoffPercent),
                },
                {
                  title: "Itens contados com diferença",
                  value: rate(report.current.divergentPercent),
                  detail: `${report.current.divergent} de ${report.current.counted} itens de contagens aprovadas`,
                  previous: rate(report.previous.divergentPercent),
                },
              ].map((metric) => (
                <article key={metric.title}>
                  <h2>{metric.title}</h2>
                  <strong>{metric.value}</strong>
                  <p>{metric.detail}</p>
                  <small>Janela anterior: {metric.previous}</small>
                </article>
              ))}
            </div>
            <section className="panel validation-pending">
              <h2>Pendências atuais</h2>
              <p>
                Fotografia da consulta de agora, independente do período acima.
                Contagem de linhas de materiais.
              </p>
              <dl>
                <div>
                  <dt>Aplicação a regularizar</dt>
                  <dd>{report.pending.unapplied}</dd>
                </div>
                <div>
                  <dt>Aguardando faturamento</dt>
                  <dd>{report.pending.awaitingInvoice}</dd>
                </div>
                <div>
                  <dt>Devolução a regularizar</dt>
                  <dd>{report.pending.returns}</dd>
                </div>
              </dl>
            </section>
            <details className="panel validation-definitions">
              <summary>Como os indicadores são calculados</summary>
              <p>
                Janela anterior: {dateTime(report.period.previousFrom)} até{" "}
                {dateTime(report.period.previousUntilExclusive)}, sem incluir o
                instante final.
              </p>
              {report.definitions.map((definition) => (
                <p key={definition}>{definition}</p>
              ))}
            </details>
          </>
        )
      )}
      <section className="panel validation-runs">
        <div className="panel-heading">
          <div>
            <h2>Roteiros de validação</h2>
            <p>
              Sete etapas, com responsável, resultado e referência da evidência.
            </p>
          </div>
          {writable && (
            <button
              className="button primary no-print"
              disabled={busy || !report || loading}
              onClick={() => {
                setCreating(true);
                setError("");
                command.current = null;
                setDraft({ title: "", objective: "", origin: "DEMONSTRATION" });
              }}
            >
              <Plus size={17} /> Iniciar validação
            </button>
          )}
        </div>
        {!runs.length ? (
          <Empty
            title="Nenhuma validação registrada"
            description="Registre uma demonstração ou um piloto autorizado. Resultados não são preenchidos automaticamente."
          />
        ) : (
          <div className="table-wrap">
            <table className="validation-run-table">
              <thead>
                <tr>
                  <th>Validação</th>
                  <th>Origem declarada</th>
                  <th>Progresso</th>
                  <th>Situação</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {runs.map((item) => (
                  <tr key={item.id}>
                    <td data-label="Validação">
                      <strong>{item.title}</strong>
                      <small>{dateTime(item.createdAt)}</small>
                    </td>
                    <td data-label="Origem">
                      {VALIDATION_ORIGINS[item.origin]}
                    </td>
                    <td data-label="Progresso">{item.completedSteps} de 7</td>
                    <td data-label="Situação">
                      <Badge
                        tone={
                          item.status === "ISSUES"
                            ? "warning"
                            : item.status === "REPORTED_PASS"
                              ? "success"
                              : ""
                        }
                      >
                        {VALIDATION_STATUS[item.status]}
                      </Badge>
                    </td>
                    <td>
                      <button
                        className="text-button"
                        aria-label={`Abrir validação ${item.title}`}
                        disabled={busy}
                        onClick={() => void open(item.id)}
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
        <p className="validation-footnote">
          Até 20 roteiros recentes. A conclusão registra os resultados
          relatados; não certifica a empresa nem comprova melhoria sem uma
          coleta comparável.
        </p>
      </section>
      {creating && (
        <Modal
          title="Iniciar validação"
          closeDisabled={busy}
          onClose={() => {
            if (!busy) setCreating(false);
          }}
        >
          <form
            className="modal-body validation-form"
            onSubmit={(event) => void create(event)}
          >
            {errors}
            <fieldset disabled={busy}>
              <label>
                Título
                <input
                  required
                  minLength={5}
                  maxLength={150}
                  value={draft.title}
                  onChange={(e) =>
                    setDraft({ ...draft, title: e.target.value })
                  }
                />
              </label>
              <label>
                Origem declarada
                <select
                  aria-label="Origem declarada"
                  value={draft.origin}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      origin: e.target.value as ValidationState["origin"],
                    })
                  }
                >
                  {Object.entries(VALIDATION_ORIGINS).map(([value, label]) => (
                    <option value={value} key={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Objetivo
                <textarea
                  aria-label="Objetivo"
                  required
                  minLength={10}
                  maxLength={1500}
                  value={draft.objective}
                  onChange={(e) =>
                    setDraft({ ...draft, objective: e.target.value })
                  }
                />
              </label>
              <p>
                O roteiro não executa movimentações. Demonstrações devem usar
                uma unidade de testes isolada; pilotos na empresa exigem sua
                autorização.
              </p>
              <p>
                Os indicadores do período consultado serão preservados na
                abertura.
              </p>
              <button className="button primary" type="submit">
                {busy ? "Registrando…" : "Criar roteiro"}
              </button>
            </fieldset>
          </form>
        </Modal>
      )}
      {run && (
        <Modal
          wide
          title={run.title}
          closeDisabled={busy}
          subtitle={`${run.snapshot.unit.code} · ${VALIDATION_ORIGINS[run.origin]}`}
          onClose={() => {
            if (!busy) {
              setRun(null);
              setError("");
              setNotice("");
            }
          }}
        >
          <div className="validation-document">
            {errors}
            {notice && (
              <div className="notice info" role="status">
                {notice}
              </div>
            )}
            <div className="validation-document-heading">
              <Badge
                tone={
                  run.status === "ISSUES"
                    ? "warning"
                    : run.status === "REPORTED_PASS"
                      ? "success"
                      : ""
                }
              >
                {VALIDATION_STATUS[run.status]}
              </Badge>
              <button
                className="text-button"
                disabled={busy}
                onClick={() => void open(run.id)}
              >
                Atualizar roteiro
              </button>
              <button className="text-button" onClick={downloadReport}>
                Baixar relatório para o TCC
              </button>
              <button className="text-button" onClick={exportRun}>
                <Download size={16} /> Exportar validação
              </button>
            </div>
            <p className="validation-prose">{run.objective}</p>
            <small>
              Aberto por {run.createdByName} em {dateTime(run.createdAt)} ·{" "}
              {run.steps.length} de 7 etapas registradas
            </small>
            <details className="validation-evidence">
              <summary>Indicadores na abertura</summary>
              <p>
                Consulta: {dateTime(run.snapshot.generatedAt)} ·{" "}
                {run.snapshot.period.from} a {run.snapshot.period.to}
              </p>
              <p>
                Baixas vinculadas: {run.snapshot.current.linked}/
                {run.snapshot.current.exits} · Entregas documentadas:{" "}
                {run.snapshot.current.handoffs}/
                {run.snapshot.current.deliveries} · Itens contados com
                diferença: {run.snapshot.current.divergent}/
                {run.snapshot.current.counted}.
              </p>
              <p>
                Devoluções pendentes na abertura: {run.snapshot.pending.returns}{" "}
                linhas. Este retrato não muda com os indicadores atuais.
              </p>
            </details>
            <ol className="validation-steps">
              {VALIDATION_STEPS.map((step) => {
                const saved = run.steps.find((s) => s.id === step.id);
                return (
                  <li key={step.id}>
                    <details>
                      <summary>
                        <span>{step.title}</span>
                        <Badge
                          tone={
                            saved?.outcome === "FAIL"
                              ? "warning"
                              : saved
                                ? "success"
                                : ""
                          }
                        >
                          {saved?.outcome === "PASS"
                            ? "Passou"
                            : saved
                              ? "Falhou"
                              : "A registrar"}
                        </Badge>
                      </summary>
                      <p>
                        <strong>Responsabilidade prevista:</strong> {step.role}
                      </p>
                      <p>{step.check}</p>
                      <p>
                        <strong>Evidência esperada:</strong> {step.evidence}
                      </p>
                      {saved && (
                        <div className="validation-evidence">
                          <p className="validation-prose">{saved.note}</p>
                          <p>Referência: {saved.reference}</p>
                          <small>
                            {saved.recordedByName} ·{" "}
                            {dateTime(saved.recordedAt)}
                          </small>
                        </div>
                      )}
                      {run.canRecord && (
                        <button
                          className="text-button"
                          onClick={() => {
                            setEditing(step.id);
                            setOutcome(saved?.outcome ?? "PASS");
                            setNote(saved?.note ?? "");
                            setReference(saved?.reference ?? "");
                            setError("");
                          }}
                        >
                          {saved
                            ? "Atualizar resultado"
                            : "Registrar resultado"}
                        </button>
                      )}
                    </details>
                  </li>
                );
              })}
            </ol>
            {editing && run.canRecord && (
              <form
                className="validation-evidence validation-form"
                onSubmit={(event) => void record(event)}
              >
                <h3>{VALIDATION_STEPS.find((s) => s.id === editing)?.title}</h3>
                <fieldset disabled={busy}>
                  <label>
                    Resultado relatado
                    <select
                      aria-label="Resultado relatado"
                      value={outcome}
                      onChange={(e) =>
                        setOutcome(e.target.value as "PASS" | "FAIL")
                      }
                    >
                      <option value="PASS">Passou na conferência</option>
                      <option value="FAIL">Falhou na conferência</option>
                    </select>
                  </label>
                  <label>
                    O que foi observado
                    <textarea
                      aria-label="O que foi observado"
                      required
                      minLength={10}
                      maxLength={1500}
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                    />
                  </label>
                  <label>
                    Referência da evidência
                    <input
                      required
                      minLength={3}
                      maxLength={200}
                      value={reference}
                      onChange={(e) => setReference(e.target.value)}
                      placeholder="Ordem, contagem, conciliação ou registro da observação"
                    />
                  </label>
                  <div className="form-actions">
                    <button className="button primary" type="submit">
                      Salvar resultado
                    </button>
                    <button
                      className="text-button"
                      type="button"
                      onClick={() => setEditing(null)}
                    >
                      Cancelar
                    </button>
                  </div>
                </fieldset>
              </form>
            )}
            {run.status === "OPEN" && writable && (
              <form
                className="validation-form"
                onSubmit={(event) => void record(event, true)}
              >
                <h3>Encerramento</h3>
                <p>
                  Registre as sete etapas. No piloto com a empresa, outra pessoa
                  autorizada precisa encerrar o roteiro.
                </p>
                <fieldset disabled={busy || !run.canClose}>
                  <label>
                    Conclusão relatada
                    <textarea
                      aria-label="Conclusão relatada"
                      required
                      minLength={20}
                      maxLength={3000}
                      value={conclusion}
                      onChange={(e) => setConclusion(e.target.value)}
                    />
                  </label>
                  <button
                    className="button primary"
                    disabled={run.steps.length !== 7 || !!editing}
                    type="submit"
                  >
                    <ClipboardCheck size={16} /> Encerrar validação
                  </button>
                </fieldset>
                {!run.canClose && (
                  <p className="workflow-help">
                    {writable
                      ? "O encerramento deste piloto deve ser feito por outra pessoa autorizada."
                      : "Seu perfil permite consultar esta validação."}
                  </p>
                )}
              </form>
            )}
            {run.conclusion && (
              <section className="validation-evidence">
                <h3>Conclusão relatada</h3>
                <p className="validation-prose">{run.conclusion}</p>
                <small>
                  {run.closedByName} · {dateTime(run.closedAt!)}
                </small>
              </section>
            )}
            {!!run.history?.length && (
              <details className="validation-evidence">
                <summary>Histórico de registros</summary>
                {run.history.map((item) => (
                  <div key={item.version}>
                    <p>
                      <strong>Revisão {item.version}</strong> ·{" "}
                      {item.recordedByName} · {dateTime(item.recordedAt)}
                      {item.stepId
                        ? ` · ${VALIDATION_STEPS.find((step) => step.id === item.stepId)?.title}`
                        : " · Encerramento"}
                      {item.outcome
                        ? ` · ${item.outcome === "PASS" ? "Passou" : "Falhou"}`
                        : ""}
                    </p>
                    <p className="validation-prose">{item.note}</p>
                    {item.reference && (
                      <small>Referência: {item.reference}</small>
                    )}
                  </div>
                ))}
              </details>
            )}
            <p className="validation-footnote">
              As evidências e a origem são declaradas pelas pessoas. Referências
              externas não são verificadas automaticamente. Documento {run.id} ·
              revisão {run.version}.
            </p>
          </div>
        </Modal>
      )}
    </div>
  );
}
