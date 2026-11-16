"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, Check, Download, RefreshCw, Save } from "lucide-react";
import { api, dateTime } from "@/lib/client";
import { safeCsvCell } from "@/lib/reconciliation-csv";
import {
  MANAGEMENT_METRICS,
  waitingTime,
  type ManagementMetric,
  type QueueAge,
} from "@/lib/management";
import { Empty, Loading, Modal } from "@/components/ui";
import type { ManagementReport } from "@/services/management";
const errorText = (e: unknown) =>
  e instanceof Error
    ? e.message
    : "Não foi possível consultar a visão da operação.";
const dayLabel = (day: string) => day.split("-").reverse().join("/");

export default function ManagementDashboard({
  unitId,
  permissions,
  onOpen,
}: {
  unitId: string;
  permissions: string[];
  onOpen: (path: string) => void;
}) {
  const [units, setUnits] = useState([unitId]),
    [range, setRange] = useState<{ from: string; to: string } | null>(null),
    [draft, setDraft] = useState({ from: "", to: "" });
  const [metric, setMetric] = useState<ManagementMetric>(
    permissions.includes("orders:read") ? "AWAITING_INVOICE" : "SCHEDULE",
  );
  const [report, setReport] = useState<ManagementReport | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [capture, setCapture] = useState(false),
    [busy, setBusy] = useState(false),
    [captureError, setCaptureError] = useState("");
  const generation = useRef(0),
    commands = useRef(new Map<string, string>());
  const unitsKey = units.join(","),
    from = range?.from,
    to = range?.to;
  const load = useCallback(
    async (signal?: AbortSignal) => {
      const request = ++generation.current;
      setLoading(true);
      setError("");
      try {
        const params = new URLSearchParams({ units: unitsKey });
        if (from && to) {
          params.set("from", from);
          params.set("to", to);
        }
        const result = await api<ManagementReport>(
          `/api/management?${params}`,
          { signal },
        );
        if (signal?.aborted || request !== generation.current) return;
        setReport(result);
        setDraft((old) =>
          old.from && old.to
            ? old
            : { from: result.period.from, to: result.period.to },
        );
      } catch (cause) {
        if (!signal?.aborted && request === generation.current) {
          setReport(null);
          setError(errorText(cause));
        }
      } finally {
        if (!signal?.aborted && request === generation.current)
          setLoading(false);
      }
    },
    [unitsKey, from, to],
  );
  useEffect(() => {
    const controller = new AbortController(),
      version = generation;
    void Promise.resolve().then(() => {
      if (!controller.signal.aborted) return load(controller.signal);
    });
    return () => {
      controller.abort();
      version.current++;
    };
  }, [load]);
  const current = report?.units.find((u) => u.unit.id === unitId);
  const metrics = MANAGEMENT_METRICS.filter((m) =>
    report?.units.some((u) => u.current.areas[m.area]),
  );
  const activeMetric = metrics.find((m) => m.key === metric) ?? metrics[0];
  const days = [
    ...new Set(report?.units.flatMap((u) => u.history.map((p) => p.day)) ?? []),
  ]
    .sort()
    .reverse();
  const highlights = (
    [
      "RECEIPT_PENDING",
      "RECEIPT_DISPUTED",
      "SCHEDULE",
      "AWAITING_INVOICE",
      "COUNT",
    ] as ManagementMetric[]
  )
    .filter((key) => current?.current.metrics[key] != null)
    .slice(0, 3);
  function toggle(id: string) {
    setUnits((old) =>
      old.includes(id)
        ? old.filter((v) => v !== id)
        : old.length < 4
          ? [...old, id]
          : old,
    );
    setNotice("");
  }
  function reset() {
    if (unitsKey === unitId && !range) void load();
    else {
      setUnits([unitId]);
      setRange(null);
      setDraft({ from: "", to: "" });
    }
  }
  async function record() {
    if (!report || !current || busy) return;
    const key = commands.current.get(report.today) ?? crypto.randomUUID();
    commands.current.set(report.today, key);
    setBusy(true);
    setCaptureError("");
    setNotice("");
    try {
      const saved = await api<{
        day: string;
        capturedAt: string;
        created: boolean;
      }>("/api/management", {
        method: "POST",
        body: JSON.stringify({
          idempotencyKey: key,
          expectedUnitId: report.currentUnitId,
        }),
      });
      setCapture(false);
      await load();
      setNotice(
        saved.created
          ? `Posição de ${dayLabel(saved.day)} registrada em ${dateTime(saved.capturedAt)}.`
          : "A posição deste dia já estava registrada. O primeiro registro foi preservado.",
      );
    } catch (cause) {
      setCaptureError(errorText(cause));
    } finally {
      setBusy(false);
    }
  }
  function exportData() {
    if (!report) return;
    const rows: string[][] = [
      [
        "Fonte",
        "Unidade",
        "Ponto de atenção",
        "Data",
        "Horário da posição",
        "Contagem",
        "Com data de abertura",
        "Sem data de abertura",
        "Abertura mais antiga",
        "Disponibilidade",
      ],
    ];
    for (const unit of report.units) {
      for (const m of MANAGEMENT_METRICS) {
        const bucket = unit.current.metrics[m.key];
        rows.push([
          "Consulta atual",
          unit.unit.code,
          m.label,
          report.today,
          report.generatedAt,
          ...csvBucket(bucket),
          bucket ? "Medido" : "Sem acesso",
        ]);
      }
      for (const point of unit.history)
        for (const m of MANAGEMENT_METRICS) {
          const bucket = point.metrics[m.key];
          rows.push([
            "Posição registrada",
            unit.unit.code,
            m.label,
            point.day,
            point.capturedAt,
            ...csvBucket(bucket),
            !unit.current.areas[m.area]
              ? "Sem acesso"
              : bucket
                ? "Medido"
                : "Área não medida",
          ]);
        }
      if (!unit.history.length)
        rows.push([
          "Histórico",
          unit.unit.code,
          "",
          `${report.period.from} a ${report.period.to}`,
          "",
          "",
          "",
          "",
          "",
          "Sem registros no período",
        ]);
    }
    const blob = new Blob(
      [
        "\uFEFF" +
          rows.map((row) => row.map(safeCsvCell).join(";")).join("\r\n"),
      ],
      { type: "text/csv;charset=utf-8" },
    );
    const url = URL.createObjectURL(blob),
      anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `operacao-${report.period.to}.csv`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <div className="management-workspace" aria-busy={loading}>
      <div className="page-heading">
        <div>
          <h1>Visão da operação</h1>
          <p>O que está parado, há quanto tempo e onde precisa de atenção.</p>
        </div>
        <div className="heading-actions">
          <button
            className="button secondary"
            onClick={() => void load()}
            disabled={loading || busy}
          >
            <RefreshCw size={16} /> Atualizar
          </button>
          <button
            className="button secondary"
            onClick={exportData}
            disabled={!report || loading || busy}
          >
            <Download size={16} /> Exportar posição
          </button>
        </div>
      </div>
      {error && (
        <div className="notice error" role="alert">
          {error}
          <button className="text-button" onClick={reset}>
            Voltar à unidade atual
          </button>
        </div>
      )}
      {notice && (
        <div className="notice info" role="status">
          {notice}
        </div>
      )}
      {loading && !report && <Loading />}
      {report && current && (
        <>
          <section className="management-context">
            <div>
              <span>UNIDADE ATUAL</span>
              <h2>{current.unit.name}</h2>
              <p>
                Consulta de {dateTime(report.generatedAt)} · posições por dia de
                Brasília
              </p>
            </div>
            <div>
              {current.canRecord && (
                <button
                  className="button primary"
                  disabled={busy || loading || !!current.todayCapture}
                  onClick={() => {
                    setCaptureError("");
                    setCapture(true);
                  }}
                >
                  {current.todayCapture ? (
                    <>
                      <Check size={17} /> Posição de hoje registrada
                    </>
                  ) : (
                    <>
                      <Save size={17} /> Registrar posição de hoje
                    </>
                  )}
                </button>
              )}
              {current.todayCapture && (
                <small>
                  Guardada em {dateTime(current.todayCapture.capturedAt)}
                </small>
              )}
              {!current.canRecord && (
                <small>Seu perfil permite consultar as posições.</small>
              )}
            </div>
          </section>
          <div className="management-highlights">
            {highlights.map((key) => (
              <div key={key}>
                <strong>{current.current.metrics[key]?.count ?? 0}</strong>
                <span>
                  {MANAGEMENT_METRICS.find((m) => m.key === key)!.label}
                </span>
              </div>
            ))}
          </div>
          <section className="panel management-comparison">
            <div className="panel-heading">
              <div>
                <h2>Fila de agora</h2>
                <p>
                  Compare até quatro unidades às quais sua conta tem acesso.
                </p>
              </div>
            </div>
            <fieldset className="management-units">
              <legend>Unidades na comparação</legend>
              {report.availableUnits.map((unit) => (
                <label key={unit.id}>
                  <input
                    type="checkbox"
                    aria-label={unit.code}
                    checked={units.includes(unit.id)}
                    disabled={
                      unit.id === unitId ||
                      busy ||
                      (!units.includes(unit.id) && units.length >= 4)
                    }
                    onChange={() => toggle(unit.id)}
                  />
                  <span>
                    {unit.code}
                    {unit.id === unitId && <small>Atual</small>}
                  </span>
                </label>
              ))}
            </fieldset>
            <div className="table-wrap">
              <table className="management-matrix">
                <thead>
                  <tr>
                    <th>Ponto de atenção</th>
                    {report.units.map((unit) => (
                      <th key={unit.unit.id}>{unit.unit.code}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {metrics.map((m) => (
                    <tr key={m.key}>
                      <th scope="row">
                        {m.label}
                        <small>
                          {m.source === "RECEIPT"
                            ? "Entregas"
                            : m.key === "SCHEDULE"
                              ? "Programações"
                              : m.key === "COUNT"
                                ? "Contagens"
                                : "Linhas de material nas ordens"}
                        </small>
                      </th>
                      {report.units.map((unit) => (
                        <td key={unit.unit.id} data-label={unit.unit.code}>
                          <QueueCell
                            bucket={unit.current.metrics[m.key]}
                            now={report.generatedAt}
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="management-source-actions">
              <button
                className="text-button"
                onClick={() => onOpen("/pendencias")}
              >
                Pendências da unidade atual <ArrowRight size={15} />
              </button>
              {current.current.areas.orders && (
                <button
                  className="text-button"
                  onClick={() => onOpen("/recebimentos")}
                >
                  Recebimentos da unidade atual <ArrowRight size={15} />
                </button>
              )}
            </div>
            <p className="management-caption">
              As linhas contam etapas diferentes e podem se sobrepor. Não some
              como total de peças ou ocorrências únicas. Para consultar os
              registros de outra unidade, selecione-a no menu do ERP.
            </p>
          </section>
          <section className="panel management-history">
            <div className="panel-heading">
              <div>
                <h2>Posições registradas</h2>
                <p>
                  Evolução observada, com o primeiro registro de cada dia
                  preservado.
                </p>
              </div>
            </div>
            <form
              className="management-period"
              onSubmit={(event) => {
                event.preventDefault();
                setRange({ ...draft });
                setNotice("");
              }}
            >
              <label>
                De
                <input
                  type="date"
                  required
                  value={draft.from}
                  max={report.today}
                  onChange={(e) =>
                    setDraft((old) => ({ ...old, from: e.target.value }))
                  }
                />
              </label>
              <label>
                Até
                <input
                  type="date"
                  required
                  value={draft.to}
                  max={report.today}
                  onChange={(e) =>
                    setDraft((old) => ({ ...old, to: e.target.value }))
                  }
                />
              </label>
              <button className="button secondary" disabled={loading || busy}>
                Aplicar período
              </button>
              <label className="management-metric">
                Comparar
                <select
                  aria-label="Indicador do histórico"
                  value={activeMetric?.key ?? ""}
                  onChange={(e) =>
                    setMetric(e.target.value as ManagementMetric)
                  }
                >
                  {metrics.map((m) => (
                    <option key={m.key} value={m.key}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </label>
            </form>
            <p className="management-window">
              {dayLabel(report.period.from)} a {dayLabel(report.period.to)} ·{" "}
              {days.length} dia(s) com posições registradas de{" "}
              {report.period.days} no intervalo.
            </p>
            {days.length && activeMetric ? (
              <div className="table-wrap">
                <table className="management-matrix management-history-table">
                  <thead>
                    <tr>
                      <th>Data da posição</th>
                      {report.units.map((unit) => (
                        <th key={unit.unit.id}>{unit.unit.code}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {days.map((day) => (
                      <tr key={day}>
                        <th scope="row">{dayLabel(day)}</th>
                        {report.units.map((unit) => {
                          const point = unit.history.find((p) => p.day === day),
                            value = point?.metrics[activeMetric.key];
                          return (
                            <td key={unit.unit.id} data-label={unit.unit.code}>
                              {!unit.current.areas[activeMetric.area] ? (
                                <span className="management-missing">
                                  Sem acesso
                                </span>
                              ) : !point ? (
                                <span className="management-missing">
                                  Sem registro
                                </span>
                              ) : value == null ? (
                                <span className="management-missing">
                                  Área não medida
                                </span>
                              ) : (
                                <>
                                  <strong className="management-value">
                                    {value.count}
                                  </strong>
                                  <small>
                                    Registrada em {dateTime(point.capturedAt)}
                                  </small>
                                </>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty
                title="Ainda não há posições neste período"
                description="Registre a posição da unidade para começar o acompanhamento. Dias sem registro não são tratados como zero."
              />
            )}
            {report.units.some((u) => u.historyTruncated) && (
              <div className="notice warning">
                O histórico atingiu o limite de consulta de uma unidade. Reduza
                o período para conferir os registros.
              </div>
            )}
            <p className="management-caption">
              A consulta atual não é gravada automaticamente. Horários
              diferentes, dias sem medição e mudanças de acesso limitam a
              comparação; as posições não comprovam, sozinhas, melhora no
              processo.
            </p>
          </section>
          <details className="management-criteria">
            <summary>Como ler estes números</summary>
            <p>
              Aplicações e devoluções usam a mesma fila de Pendências.
              Recebimentos seguem a situação registrada pelo destinatário e pelo
              responsável pelo tratamento. As quantidades físicas e os valores
              financeiros não são somados aqui.
            </p>
            <p>
              O tempo mostra a espera mais antiga com data conhecida: abertura
              da ocorrência, vencimento da agenda, entrega sem confirmação ou
              resposta que abriu a etapa atual. Registros sem essa data ficam
              sinalizados. Uma etapa encerrada deixa a fila atual; os registros
              diários anteriores continuam preservados.
            </p>
            <p>
              Entregas sem conta vinculada incluem registros antigos com
              identificação declarada. Esse número não afirma que o material
              deixou de ser recebido.
            </p>
          </details>
        </>
      )}
      {capture && current && report && (
        <Modal
          title="Registrar posição de hoje"
          subtitle={current.unit.name}
          onClose={() => {
            if (!busy) setCapture(false);
          }}
        >
          <div className="modal-body management-capture">
            <p>
              Será guardada a posição desta unidade no momento da confirmação. O
              primeiro registro do dia de Brasília será preservado, mesmo se a
              fila mudar depois.
            </p>
            <dl>
              {MANAGEMENT_METRICS.filter(
                (m) => current.current.areas[m.area],
              ).map((m) => (
                <div key={m.key}>
                  <dt>{m.label}</dt>
                  <dd>{current.current.metrics[m.key]?.count ?? "—"}</dd>
                </div>
              ))}
            </dl>
            <small>
              A operação registra uma observação gerencial e não movimenta
              estoque.
            </small>
            {captureError && (
              <div className="notice error" role="alert">
                {captureError}
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={() => {
                    setCapture(false);
                    void load();
                  }}
                >
                  Consultar posição
                </button>
              </div>
            )}
            <div className="modal-actions">
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => setCapture(false)}
              >
                Cancelar
              </button>
              <button
                className="button primary"
                disabled={busy}
                onClick={() => void record()}
              >
                {busy ? "Registrando…" : "Confirmar registro"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
function QueueCell({ bucket, now }: { bucket: QueueAge | null; now: string }) {
  if (!bucket) return <span className="management-missing">Sem acesso</span>;
  return (
    <>
      <strong className="management-value">{bucket.count}</strong>
      {bucket.count > 0 && (
        <small>
          {bucket.oldestAt
            ? `Mais antiga: ${waitingTime(bucket.oldestAt, now)}`
            : "Sem data de abertura conhecida"}
        </small>
      )}
      {bucket.undated > 0 && bucket.oldestAt && (
        <small>{bucket.undated} sem data de abertura</small>
      )}
    </>
  );
}
function csvBucket(bucket: QueueAge | null) {
  return bucket
    ? [
        String(bucket.count),
        String(bucket.dated),
        String(bucket.undated),
        bucket.oldestAt ?? "",
      ]
    : ["", "", "", ""];
}
