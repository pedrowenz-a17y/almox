"use client";
import { useCallback, useEffect, useState } from "react";
import { ArrowRight, RefreshCw } from "lucide-react";
import { api, dateTime, qty, type Warehouse } from "@/lib/client";
import { Badge, Empty, Loading } from "@/components/ui";
import WarehouseShifts from "@/components/warehouse-shifts";
import PendingAssignment from "@/components/pending-assignment";
import type { PendingItem, PendingPage, PendingType } from "@/services/operational-pending";

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
  onOpenOrder, onInventory, onSchedules, warehouses, userId, canSetup,
}: {
  warehouses: Warehouse[];
  userId: string;
  canSetup: boolean;
  onOpenOrder: (id: string, kind: "SERVICE" | "PRODUCTION") => void;
  onInventory?: (countId?: string) => void;
  onSchedules?: () => void;
}) {
  const [type, setType] = useState<"ALL" | PendingType>("ALL");
  const [focus, setFocus] = useState("ALL");
  const [assignment, setAssignment] = useState<PendingItem | null>(null);
  const [notice, setNotice] = useState("");
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<PendingPage | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError("");
    try {
      const next = await api<PendingPage>(`/api/operational-pending?${new URLSearchParams({ type, focus, page: String(page), pageSize: "25" })}`, { signal });
      if (!signal?.aborted) setResult(next);
    } catch (cause) {
      if (!signal?.aborted) {
        setResult(null);
        setError(cause instanceof Error ? cause.message : "Não foi possível consultar as pendências.");
      }
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [type, focus, page]);
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
    {notice && <div className="notice success" role="status">{notice}</div>}
    {result?.coordinationReady === false && <section className="panel operations-setup"><strong>Etapa 3: preparar o banco</strong>
      <p>A lista de pendências continua disponível. Os turnos, responsáveis e prazos serão ativados depois que a migração for aplicada no banco desta instalação.</p>
      {canSetup && <a className="button secondary" href="/api/operations-setup" download>Baixar SQL da etapa 3</a>}
      <small>O responsável pelo banco deve revisar e executar o arquivo uma vez no SQL Editor do Supabase. Depois, clique em Atualizar.</small>
    </section>}
    {result?.coordinationReady && <WarehouseShifts warehouses={warehouses} userId={userId} />}
    {result && <section className="panel workflow-summary">
      <div>
        <strong>Priorize os atrasos e as devoluções.</strong>
        <p>Uma mesma linha de material pode aparecer em mais de uma etapa. Os indicadores contam registros, sem somar quantidades de produtos diferentes.</p>
        <small>Atualizado em {dateTime(result.serverTime)}. Exibimos somente as áreas permitidas ao seu perfil.</small>
      </div>
    </section>}
    {result?.coordinationReady && <div className="responsibility-filters" aria-label="Acompanhamento de pendências">
      {[["ALL", "Todas", result.total], ["MINE", "Minhas", result.mineTotal], ["UNASSIGNED", "Sem responsável", result.unassignedTotal], ["OVERDUE", "Atrasadas", result.overdueTotal]].map(([value, label, count]) =>
        <button key={value} className={`responsibility-filter ${focus === value ? "active" : ""}`} aria-pressed={focus === value} onClick={() => { setFocus(String(value)); setPage(1); }}><span>{label}</span>{value !== "ALL" && <strong>{count}</strong>}</button>)}
    </div>}
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
          <table className="pending-table">
            <thead><tr><th>Pendência</th><th>Destino e material</th><th>Local / quantidade</th><th>Responsável e prazo</th><th>Ação</th></tr></thead>
            <tbody>{result.items.map(item => <tr key={item.id}>
              <td data-label="Etapa"><Badge tone={item.type === "RETURN" || item.type === "SCHEDULE" ? "warning" : "info"}>{labels[item.type]}</Badge><small>{guidance[item.type]}</small>{item.missingHandoff && <small>Histórico de entrega sem identificação completa.</small>}</td>
              <td data-label="Destino e material"><strong>{item.orderKind ? `${item.orderKind === "SERVICE" ? "O.S." : "O.P."} ${item.code}` : item.title}</strong>{item.orderId && <small>{item.title}</small>}{item.productName && <small>{item.productCode} · {item.productName}</small>}{item.creatorName && <small>Contagem por {item.creatorName}</small>}</td>
              <td data-label="Local / quantidade"><strong>{item.locationCode}</strong><small>{item.quantity !== null ? `${qty(item.quantity)} ${item.unit ?? ""}` : "Conferência do local"}</small></td>
              <td data-label="Responsável e prazo" className="pending-responsibility"><strong>{item.assigneeName ?? "Sem responsável definido"}</strong>
                {item.assigneeId && !item.assigneeEligible && <small className="responsibility-warning">Reatribuir: acesso ou permissão indisponível.</small>}
                {item.dueAt ? <><Badge tone={item.overdue ? "warning" : "info"}>{item.overdue ? "Em atraso" : "Prazo definido"}</Badge><small>{dateTime(item.dueAt)}</small></> : <small>Sem prazo definido</small>}
                {item.openedAt ? <small>Etapa aberta em {dateTime(item.openedAt)}</small> : <small>{item.orderId ? "Ordem" : "Programação"} criada em {dateTime(item.createdAt)}</small>}
                {item.assignmentNote && <details><summary>Orientação</summary><p>{item.assignmentNote}</p></details>}
                {result.canManage && item.type !== "SCHEDULE" && <button className="button secondary" onClick={() => { setAssignment(item); setNotice(""); }}>{item.assigneeId ? "Reatribuir" : "Definir responsável"}</button>}
                {item.type === "SCHEDULE" && <small>Responsável e vencimento definidos na agenda.</small>}
              </td>
              <td data-label="Ação">{item.orderId && item.orderKind ? <button className="button secondary" onClick={() => onOpenOrder(item.orderId!, item.orderKind!)}>Abrir ordem <ArrowRight size={15} /></button> : item.type === "SCHEDULE" && onSchedules ? <button className="button secondary" onClick={onSchedules}>Ver agenda <ArrowRight size={15} /></button> : item.type === "COUNT" && onInventory ? <button className="button secondary" onClick={() => onInventory(item.id.split(":")[0])}>Ver inventário <ArrowRight size={15} /></button> : "—"}</td>
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
    {assignment && <PendingAssignment item={assignment} onClose={() => setAssignment(null)} onSaved={() => { setAssignment(null); setNotice("Responsável e prazo registrados. A operação continua pendente até sua regularização."); void load(); }} />}
  </>;
}
