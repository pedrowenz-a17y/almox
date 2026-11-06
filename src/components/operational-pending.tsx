"use client";
import { useCallback, useEffect, useState } from "react";
import { ArrowRight, RefreshCw } from "lucide-react";
import { api, dateTime, qty } from "@/lib/client";
import { Badge, Empty, Loading } from "@/components/ui";
import type { PendingPage, PendingType } from "@/services/operational-pending";

const labels: Record<PendingType, string> = {
  UNAPPLIED: "Requisições a aplicar",
  RESERVED: "Reservas a entregar",
  AWAITING_INVOICE: "Aplicações a faturar",
  RETURN: "Devoluções a receber",
  COUNT: "Contagens a aprovar",
  SCHEDULE: "Conferências vencidas",
};
const guidance: Record<PendingType, string> = {
  UNAPPLIED: "Aplicar na ordem ou encerrar o saldo solicitado com justificativa.",
  RESERVED: "Conferir a retirada e registrar a aplicação com o responsável.",
  AWAITING_INVOICE: "Conferir as aplicações antes de confirmar o faturamento.",
  RETURN: "Receber e conferir o material antes de confirmar a devolução.",
  COUNT: "Supervisor deve conferir e aprovar a contagem.",
  SCHEDULE: "Executar a contagem do local e encaminhar para aprovação.",
};

export default function OperationalPending({
  onOpenOrder, onInventory, onSchedules,
}: {
  onOpenOrder: (id: string, kind: "SERVICE" | "PRODUCTION") => void;
  onInventory?: (countId?: string) => void;
  onSchedules?: () => void;
}) {
  const [type, setType] = useState<"ALL" | PendingType>("ALL");
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<PendingPage | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError("");
    try {
      const next = await api<PendingPage>(`/api/operational-pending?${new URLSearchParams({ type, page: String(page), pageSize: "25" })}`, { signal });
      if (!signal?.aborted) setResult(next);
    } catch (cause) {
      if (!signal?.aborted) {
        setResult(null);
        setError(cause instanceof Error ? cause.message : "Não foi possível consultar as pendências.");
      }
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [type, page]);
  useEffect(() => {
    const controller = new AbortController();
    void Promise.resolve().then(() => {
      if (!controller.signal.aborted) return load(controller.signal);
    });
    return () => controller.abort();
  }, [load]);
  const choose = (next: "ALL" | PendingType) => { setType(next); setPage(1); };
  return <>
    <div className="page-heading">
      <div>
        <span className="eyebrow">ROTINA SOB CONTROLE</span>
        <h1>Pendências da operação</h1>
        <p>O que precisa de conferência, aplicação ou regularização nesta unidade.</p>
      </div>
      <button className="button secondary" disabled={loading} onClick={() => void load()}><RefreshCw size={17} /> Atualizar</button>
    </div>
    {error && <div className="notice error" role="alert">{error}</div>}
    {result && <section className="panel workflow-summary">
      <div>
        <strong>Comece pelas devoluções e conferências vencidas.</strong>
        <p>Uma mesma linha de material pode aparecer em mais de uma etapa. Os indicadores contam registros, sem somar quantidades de produtos diferentes.</p>
        <small>Atualizado em {dateTime(result.serverTime)}. Exibimos somente as áreas permitidas ao seu perfil.</small>
      </div>
    </section>}
    <section className="panel">
      <div className="toolbar">
        <label>Etapa
          <select aria-label="Filtrar pendências por etapa" value={type} onChange={event => choose(event.target.value as typeof type)}>
            <option value="ALL">Todas as pendências</option>
            {(Object.keys(labels) as PendingType[]).map(key => <option key={key} value={key}>{labels[key]}{result ? ` (${result.totals[key]})` : ""}</option>)}
          </select>
        </label>
        {result && <span className="muted">{result.total} registros · página {result.page} de {Math.max(1, Math.ceil(result.total / result.pageSize))}</span>}
      </div>
      {loading ? <Loading /> : result?.items.length ? <>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Pendência</th><th>Destino e material</th><th>Local / quantidade</th><th>Referência</th><th>Ação</th></tr></thead>
            <tbody>{result.items.map(item => <tr key={item.id}>
              <td><Badge tone={item.type === "RETURN" || item.type === "SCHEDULE" ? "warning" : "info"}>{labels[item.type]}</Badge><small>{guidance[item.type]}</small>{item.missingHandoff && <small>Histórico de entrega sem identificação completa.</small>}</td>
              <td><strong>{item.orderKind ? `${item.orderKind === "SERVICE" ? "O.S." : "O.P."} ${item.code}` : item.title}</strong>{item.orderId && <small>{item.title}</small>}{item.productName && <small>{item.productCode} · {item.productName}</small>}{item.assigneeName && <small>Responsável: {item.assigneeName}</small>}</td>
              <td><strong>{item.locationCode}</strong><small>{item.quantity !== null ? `${qty(item.quantity)} ${item.unit ?? ""}` : "Conferência do local"}</small></td>
              <td>{item.dueAt ? <>Venceu em<small>{dateTime(item.dueAt)}</small></> : <>Abertura {item.orderId ? "da ordem" : "da contagem"}<small>{dateTime(item.createdAt)}</small></>}</td>
              <td>{item.orderId && item.orderKind ? <button className="button secondary" onClick={() => onOpenOrder(item.orderId!, item.orderKind!)}>Abrir ordem <ArrowRight size={15} /></button> : item.type === "SCHEDULE" && onSchedules ? <button className="button secondary" onClick={onSchedules}>Ver agenda <ArrowRight size={15} /></button> : item.type === "COUNT" && onInventory ? <button className="button secondary" onClick={() => onInventory(item.id.split(":")[0])}>Ver inventário <ArrowRight size={15} /></button> : "—"}</td>
            </tr>)}</tbody>
          </table>
        </div>
        <div className="toolbar">
          <button className="button secondary" disabled={page <= 1} onClick={() => setPage(value => value - 1)}>Anterior</button>
          <span>Página {page}</span>
          <button className="button secondary" disabled={page * result.pageSize >= result.total} onClick={() => setPage(value => value + 1)}>Próxima</button>
        </div>
      </> : !error && <Empty title="Nenhuma pendência nesta etapa" description="Continue registrando retiradas, aplicações e conferências para manter o controle em dia." />}
    </section>
  </>;
}
