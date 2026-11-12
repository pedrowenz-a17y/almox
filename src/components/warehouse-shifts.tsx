"use client";
import { useCallback, useEffect, useState } from "react";
import { ArrowRightLeft, Clock3, RefreshCw, UserCheck } from "lucide-react";
import { api, dateTime, type Warehouse } from "@/lib/client";
import { Badge, Loading, Modal } from "@/components/ui";
import type { ShiftPage } from "@/services/warehouse-shifts";

type Action = "REQUEST_HANDOVER" | "ACCEPT_HANDOVER" | "CANCEL_HANDOVER" | "END";
const actionLabels: Record<Action, string> = {
  REQUEST_HANDOVER: "Passar turno", ACCEPT_HANDOVER: "Aceitar e assumir turno", CANCEL_HANDOVER: "Cancelar passagem", END: "Encerrar turno",
};
export default function WarehouseShifts({ warehouses, userId }: { warehouses: Warehouse[]; userId: string }) {
  const [warehouseId, setWarehouseId] = useState(warehouses.find(item => item.active)?.id ?? warehouses[0]?.id ?? "");
  const [result, setResult] = useState<ShiftPage | null>(null), [loading, setLoading] = useState(true);
  const [error, setError] = useState(""), [notice, setNotice] = useState(""), [busy, setBusy] = useState(false);
  const [action, setAction] = useState<Action | null>(null), [note, setNote] = useState(""), [toId, setToId] = useState("");
  const load = useCallback(async (signal?: AbortSignal) => {
    if (!warehouseId) { setLoading(false); return; }
    setLoading(true);
    try {
      const next = await api<ShiftPage>(`/api/warehouse-shifts?${new URLSearchParams({ warehouseId })}`, { signal });
      if (!signal?.aborted) { setResult(next); setError(""); }
    } catch (cause) {
      if (!signal?.aborted) { setResult(null); setError(cause instanceof Error ? cause.message : "Não foi possível consultar o turno."); }
    } finally { if (!signal?.aborted) setLoading(false); }
  }, [warehouseId]);
  useEffect(() => {
    const controller = new AbortController();
    void Promise.resolve().then(() => { if (!controller.signal.aborted) return load(controller.signal); });
    return () => controller.abort();
  }, [load]);
  const current = result?.active, owner = current?.responsibleId === userId;
  const open = (next: Action) => { setAction(next); setNote(""); setToId(""); setError(""); setNotice(""); };
  async function perform(next: Action | "START") {
    if (busy || !result || result.warehouseId !== warehouseId) return;
    setBusy(true); setError(""); setNotice("");
    try {
      await api("/api/warehouse-shifts", { method: "POST", body: JSON.stringify({ action: next, warehouseId,
        ...(next !== "START" && current ? { shiftId: current.id, expectedVersion: current.version, note, ...(next === "REQUEST_HANDOVER" ? { toId } : {}) } : {}) }) });
      setAction(null); setNotice(next === "REQUEST_HANDOVER" ? "Passagem solicitada. O responsável atual continua no turno até o aceite." : "Turno atualizado e registrado no histórico.");
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível registrar o turno."); }
    finally { setBusy(false); }
  }
  if (!warehouses.length) return <section className="panel shift-panel"><strong>Responsável pelo almoxarifado</strong><p>Cadastre um almoxarifado para registrar os turnos.</p></section>;
  return <section className="panel shift-panel" aria-label="Responsável pelo almoxarifado">
    <div className="shift-heading"><div><span className="eyebrow">QUEM ESTÁ NO TURNO</span><h2>Responsável pelo almoxarifado</h2></div>
      <div className="shift-controls"><label>Almoxarifado<select aria-label="Almoxarifado do turno" value={warehouseId} disabled={busy} onChange={event => { setResult(null); setWarehouseId(event.target.value); setNotice(""); setError(""); }}>
        {warehouses.map(item => <option key={item.id} value={item.id}>{item.code} · {item.name}{!item.active ? " (inativo)" : ""}</option>)}
      </select></label><button className="icon-button" aria-label="Atualizar turno" disabled={loading || busy} onClick={() => void load()}><RefreshCw size={17} /></button></div>
    </div>
    {notice && <div className="notice success" role="status">{notice}</div>}
    {error && !action && <div className="notice error" role="alert">{error}</div>}
    {loading ? <Loading /> : result && (result.ready ? <>
      <div className="shift-current"><span className="shift-icon"><UserCheck size={23} /></span><div><strong>{current?.responsible.name ?? "Sem responsável no turno"}</strong>
        <p>{current ? `Em atividade desde ${dateTime(current.startedAt)}` : "Quem estiver no almoxarifado pode assumir com seu próprio acesso autorizado."}</p></div>
        {!current && result.canTake && warehouses.find(item => item.id === warehouseId)?.active && <button className="button primary" disabled={busy} onClick={() => void perform("START")}>Assumir turno</button>}
      </div>
      {current?.handoverTo && <div className="notice shift-handover"><ArrowRightLeft size={19} /><div><strong>Aguardando aceite de {current.handoverTo.name}</strong><p>{current.handoverNote}</p><small>Solicitado em {dateTime(current.handoverRequestedAt!)}. {current.responsible.name} permanece responsável até a confirmação.</small></div></div>}
      {current && <div className="shift-actions">
        {current.handoverToId === userId && result.canTake && <button className="button primary" disabled={busy} onClick={() => open("ACCEPT_HANDOVER")}>Aceitar e assumir turno</button>}
        {(owner || result.canManage) && <>
          <button className="button secondary" disabled={busy} onClick={() => open("REQUEST_HANDOVER")}>Passar turno</button>
          {current.handoverToId && <button className="button secondary" disabled={busy} onClick={() => open("CANCEL_HANDOVER")}>Cancelar passagem</button>}
          <button className="button secondary" disabled={busy} onClick={() => open("END")}>Encerrar turno</button>
        </>}
      </div>}
      <p className="muted shift-guidance">A passagem registra a responsabilidade pelo almoxarifado. As pendências abaixo mantêm seus responsáveis e prazos até a conclusão de cada operação.</p>
      <details className="shift-history"><summary><Clock3 size={16} /> Últimos turnos encerrados <Badge>{result.history.length}</Badge></summary>
        {result.history.length ? <ol>{result.history.map(shift => <li key={shift.id}><strong>{shift.responsible.name}</strong><span>{dateTime(shift.startedAt)} → {dateTime(shift.endedAt!)}</span>
          <small>Encerrado por {shift.endedBy?.name}. {shift.closeNote}</small>{shift.handoverTo && <small>Indicado na passagem: {shift.handoverTo.name}. {shift.handoverNote}</small>}</li>)}</ol> : <p className="muted">Os turnos encerrados aparecerão aqui.</p>}
      </details>
    </> : <p className="muted">Os turnos estarão disponíveis depois da migração da etapa 3.</p>)}
    {action && current && <Modal title={actionLabels[action]} onClose={() => { if (!busy) setAction(null); }} subtitle={`${current.responsible.name} · ${warehouses.find(item => item.id === warehouseId)?.code}`}>
      <form className="modal-body form-grid responsibility-form" onSubmit={event => { event.preventDefault(); void perform(action); }}>
        {action === "REQUEST_HANDOVER" && <label className="span-2">Quem vai assumir<select required value={toId} onChange={event => setToId(event.target.value)} disabled={busy}><option value="">Selecione uma pessoa autorizada</option>
          {result?.people.filter(person => person.id !== current.responsibleId).map(person => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label>}
        {action === "REQUEST_HANDOVER" && result?.peopleTruncated && <p className="span-2 muted">Lista limitada aos primeiros 1.000 acessos ativos. Procure o administrador se o responsável não aparecer.</p>}
        {action === "ACCEPT_HANDOVER" && <div className="notice span-2"><strong>Confira antes de assumir</strong><p>{current.handoverNote}</p><p>Seu aceite encerra o turno anterior e inicia o seu. As pendências continuam na lista para acompanhamento.</p></div>}
        {action === "END" && <p className="span-2 muted">O almoxarifado ficará sem responsável ativo até que outra pessoa assuma.</p>}
        <label className="span-2">{action === "REQUEST_HANDOVER" ? "Orientações e pendências para o próximo turno" : "Observação do registro"}<textarea required minLength={5} maxLength={1000} rows={4} value={note} disabled={busy} onChange={event => setNote(event.target.value)} /></label>
        {error && <div className="notice error span-2" role="alert">{error}</div>}
        <div className="form-actions span-2"><button type="button" className="button secondary" disabled={busy} onClick={() => setAction(null)}>Voltar</button><button className="button primary" disabled={busy}>{busy ? "Registrando…" : actionLabels[action]}</button></div>
      </form>
    </Modal>}
  </section>;
}
