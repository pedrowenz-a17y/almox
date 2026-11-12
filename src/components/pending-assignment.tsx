"use client";
import { useEffect, useState } from "react";
import { api, dateTime } from "@/lib/client";
import { operationalDateInput, operationalDateISO } from "@/lib/operational-time";
import { Loading, Modal } from "@/components/ui";
import type { PendingItem, PendingPeople } from "@/services/operational-pending";

export default function PendingAssignment({ item, onClose, onSaved }: { item: PendingItem; onClose: () => void; onSaved: () => void }) {
  const [candidates, setCandidates] = useState<PendingPeople | null>(null), [error, setError] = useState("");
  const [assigneeId, setAssigneeId] = useState(item.assigneeId ?? ""), [due, setDue] = useState(operationalDateInput(item.dueAt));
  const [note, setNote] = useState(""), [busy, setBusy] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void api<PendingPeople>("/api/operational-pending/people", { signal: controller.signal })
      .then(value => { if (!controller.signal.aborted) setCandidates(value); })
      .catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Não foi possível consultar os responsáveis."); });
    return () => controller.abort();
  }, []);
  async function save(event: React.FormEvent) {
    event.preventDefault(); if (busy) return;
    setBusy(true); setError("");
    try {
      const dueAt = operationalDateISO(due);
      if (!dueAt) throw new Error("Informe uma data e hora válidas no horário de Brasília.");
      await api("/api/operational-pending/assignment", { method: "POST", body: JSON.stringify({ pendingId: item.id, occurrenceKey: item.occurrenceKey,
        expectedVersion: item.assignmentVersion, assigneeId, dueAt, note }) });
      onSaved();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível salvar a atribuição."); }
    finally { setBusy(false); }
  }
  const people = candidates?.people.filter(person => person.types.includes(item.type) && (item.type !== "COUNT" || person.id !== item.creatorId)) ?? [];
  return <Modal title={item.assigneeId ? "Reatribuir pendência" : "Definir responsável e prazo"} subtitle={`${item.code} · ${item.productName ?? item.title}`} onClose={() => { if (!busy) onClose(); }}>
    {item.assigneeName && <div className="notice assignment-current"><strong>Atual: {item.assigneeName}</strong><p>Prazo: {dateTime(item.dueAt!)}</p>{item.assignmentNote && <p>{item.assignmentNote}</p>}</div>}
    {error && <div className="notice error assignment-current" role="alert">{error}</div>}
    {!candidates && !error ? <Loading /> : <form className="modal-body form-grid responsibility-form" onSubmit={save}>
      <label className="span-2">Responsável pela etapa<select required disabled={busy || !candidates} value={assigneeId} onChange={event => setAssigneeId(event.target.value)}>
        <option value="">Selecione uma pessoa autorizada</option>{people.map(person => <option key={person.id} value={person.id}>{person.name}</option>)}
      </select></label>
      {item.type === "COUNT" && <p className="span-2 muted">A aprovação exige outra pessoa com permissão de ajuste, diferente de quem registrou a contagem.</p>}
      {candidates && !people.length && <p className="span-2 notice">Não há responsável elegível nesta unidade. O administrador precisa conferir os perfis de acesso.</p>}
      {candidates?.truncated && <p className="span-2 muted">Lista limitada aos primeiros 1.000 acessos ativos.</p>}
      <label className="span-2">Prazo para regularização<input type="datetime-local" required value={due} disabled={busy} onChange={event => setDue(event.target.value)} /><small>Horário de Brasília (São Paulo). Defina um prazo acordado com a equipe.</small></label>
      <label className="span-2">Orientação ou motivo da alteração<textarea required minLength={5} maxLength={1000} rows={3} value={note} disabled={busy} onChange={event => setNote(event.target.value)} /></label>
      <p className="span-2 muted">A atribuição não conclui a pendência. Ela sai da lista quando a operação correspondente for regularizada.</p>
      <div className="form-actions span-2"><button className="button secondary" type="button" disabled={busy} onClick={onClose}>Voltar</button><button className="button primary" disabled={busy || !people.length}>{busy ? "Salvando…" : "Salvar responsável e prazo"}</button></div>
    </form>}
  </Modal>;
}
