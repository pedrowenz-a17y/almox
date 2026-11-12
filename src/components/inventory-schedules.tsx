"use client";
import { useCallback, useEffect, useState } from "react";
import { CalendarClock, Plus, RefreshCw } from "lucide-react";
import { api, DataSet, dateTime, locationPath } from "@/lib/client";
import { Badge, Empty, Loading, Modal } from "@/components/ui";

interface Schedule {
  id: string;
  title: string;
  locationId: string;
  intervalDays: number;
  nextDueAt: string;
  active: boolean;
  assigneeId?: string | null;
  assignee?: { id: string; name: string } | null;
  location: { id: string; name: string; code: string };
  lastCount?: { id: string; approvedAt?: string | null } | null;
  pendingCount?: { id: string; createdAt: string } | null;
}
interface Result {
  items: Schedule[];
  assignees: { id: string; name: string }[];
  serverTime: string;
  total: number;
  truncated: boolean;
  assigneesTruncated?: boolean;
}
function localDate(value: string) {
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
}

export default function InventorySchedules({
  data,
  permissions,
  onStart,
  onViewInventory,
}: {
  data: DataSet;
  permissions: string[];
  onStart: (locationId: string, scheduleId: string) => void;
  onViewInventory?: (countId?: string) => void;
}) {
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<{ schedule?: Schedule; key: string } | null>(
    null,
  );
  const canManage = permissions.includes("inventory:adjust");
  const countVersion = data.counts
    .map((count) => `${count.id}:${count.status}`)
    .join("|");
  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await api<Result>("/api/inventory-schedules", {
        signal,
      });
      if (!signal?.aborted) {
        setResult(response);
        setError("");
      }
    } catch (cause) {
      if (!signal?.aborted)
        setError(
          cause instanceof Error
            ? cause.message
            : "Não foi possível consultar as conferências.",
        );
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
  }, [load, countVersion]);
  const now = new Date(result?.serverTime ?? 0).getTime();
  const overdue =
    result?.items.filter(
      (item) => item.active && new Date(item.nextDueAt).getTime() <= now,
    ).length ?? 0;
  return (
    <section className="panel inventory-schedules">
      <div className="panel-heading">
        <div>
          <h2>
            <CalendarClock size={18} aria-hidden="true" /> Conferências
            periódicas
          </h2>
          <p>
            Conte o estoque físico. O próximo ciclo começa após a aprovação.
          </p>
        </div>
        <div className="workflow-actions">
          <button
            className="button secondary square"
            type="button"
            aria-label="Atualizar conferências"
            onClick={() => void load()}
          >
            <RefreshCw size={17} />
          </button>
          {canManage && (
            <button
              className="button primary"
              type="button"
              onClick={() => setForm({ key: crypto.randomUUID() })}
            >
              <Plus size={17} /> Programar conferência
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
        <div className="notice success" role="status">
          {notice}
        </div>
      )}
      {loading ? (
        <Loading />
      ) : (
        <>
          <div className="summary-strip">
            <span>
              <strong>{overdue}</strong> aguardando conferência
            </span>
            <span>
              <strong>
                {result?.items.filter((item) => item.active).length ?? 0}
              </strong>{" "}
              programações ativas
            </span>
          </div>
          {result?.truncated && (
            <div className="notice warning">
              Exibindo {result.items.length} de {result.total} programações. Os
              indicadores resumem esta lista.
            </div>
          )}
          {result?.assigneesTruncated && (
            <div className="notice warning">
              A seleção mostra os primeiros 1.000 responsáveis ativos da
              unidade.
            </div>
          )}
          {result?.items.length ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Conferência / local</th>
                    <th>Responsável</th>
                    <th>Vencimento</th>
                    <th>Última aprovação</th>
                    <th>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {result.items.map((schedule) => {
                    const due = new Date(schedule.nextDueAt).getTime() <= now;
                    return (
                      <tr key={schedule.id}>
                        <td>
                          <strong>{schedule.title}</strong>
                          <small>
                            {schedule.location.code} · a cada{" "}
                            {schedule.intervalDays} dias
                          </small>
                        </td>
                        <td>
                          {schedule.assignee?.name ?? "Equipe da unidade"}
                        </td>
                        <td>
                          <Badge
                            tone={
                              !schedule.active
                                ? ""
                                : due
                                  ? "warning"
                                  : "success"
                            }
                          >
                            {!schedule.active
                              ? "Pausada"
                              : schedule.pendingCount
                                ? "Aguardando aprovação"
                                : due
                                  ? "Conferir agora"
                                  : "Programada"}
                          </Badge>
                          <small>{dateTime(schedule.nextDueAt)}</small>
                        </td>
                        <td>
                          {schedule.lastCount?.approvedAt
                            ? dateTime(schedule.lastCount.approvedAt)
                            : "Ainda não aprovada"}
                        </td>
                        <td>
                          <div className="workflow-actions">
                            {schedule.pendingCount && onViewInventory && (
                              <button
                                className="button secondary"
                                type="button"
                                onClick={() =>
                                  onViewInventory(schedule.pendingCount?.id)
                                }
                              >
                                Ver contagem pendente
                              </button>
                            )}
                            {permissions.includes("inventory:count") && schedule.active &&
                              due &&
                              !schedule.pendingCount && (
                                <button
                                  className="button primary"
                                  type="button"
                                  onClick={() =>
                                    onStart(schedule.locationId, schedule.id)
                                  }
                                >
                                  Iniciar contagem
                                </button>
                              )}
                            {canManage && (
                              <button
                                className="button secondary"
                                type="button"
                                onClick={() =>
                                  setForm({
                                    schedule,
                                    key: crypto.randomUUID(),
                                  })
                                }
                              >
                                Editar programação
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty
              title="Seu próximo inventário pode ter data certa"
              description="Programe conferências por localização e acompanhe as que aguardam contagem."
            />
          )}
        </>
      )}
      {form && (
        <ScheduleForm
          data={data}
          assignees={result?.assignees ?? []}
          schedule={form.schedule}
          idempotencyKey={form.key}
          onClose={() => setForm(null)}
          onDone={async () => {
            setForm(null);
            setNotice(
              "Programação salva. O estoque só muda após a contagem aprovada.",
            );
            await load();
          }}
        />
      )}
    </section>
  );
}

function ScheduleForm({
  data,
  assignees,
  schedule,
  idempotencyKey,
  onClose,
  onDone,
}: {
  data: DataSet;
  assignees: Result["assignees"];
  schedule?: Schedule;
  idempotencyKey: string;
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const [title, setTitle] = useState(
    schedule?.title ?? "Conferência periódica",
  );
  const [locationId, setLocationId] = useState(schedule?.locationId ?? "");
  const [intervalDays, setIntervalDays] = useState(
    String(schedule?.intervalDays ?? 7),
  );
  const [nextDueAt, setNextDueAt] = useState(
    localDate(schedule?.nextDueAt ?? new Date().toISOString()),
  );
  const [assigneeId, setAssigneeId] = useState(schedule?.assigneeId ?? "");
  const [active, setActive] = useState(schedule?.active ?? true);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      const common = {
        intervalDays: Number(intervalDays),
        nextDueAt: new Date(nextDueAt).toISOString(),
        assigneeId: assigneeId || null,
      };
      await api(
        schedule
          ? `/api/inventory-schedules/${schedule.id}`
          : "/api/inventory-schedules",
        {
          method: schedule ? "PATCH" : "POST",
          body: JSON.stringify(
            schedule
              ? { ...common, active, note }
              : { ...common, title, locationId, idempotencyKey },
          ),
        },
      );
      await onDone();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Não foi possível salvar a programação.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={schedule ? "Editar conferência" : "Programar conferência"}
      subtitle="Uma rotina simples para encontrar diferenças antes que virem problemas."
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form className="modal-body" onSubmit={submit}>
        <label>
          Nome
          <input
            required
            minLength={3}
            maxLength={160}
            value={title}
            disabled={Boolean(schedule)}
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        <label>
          Localização
          <select
            required
            value={locationId}
            disabled={Boolean(schedule)}
            onChange={(event) => setLocationId(event.target.value)}
          >
            <option value="">Selecione</option>
            {data.locations
              .filter((location) => location.active)
              .map((location) => (
                <option value={location.id} key={location.id}>
                  {locationPath(data, location.id)}
                </option>
              ))}
          </select>
        </label>
        <div className="form-grid">
          <label>
            Repetir a cada (dias)
            <input
              type="number"
              required
              min={1}
              max={365}
              step={1}
              value={intervalDays}
              onChange={(event) => setIntervalDays(event.target.value)}
            />
          </label>
          <label>
            Próxima conferência
            <input
              type="datetime-local"
              required
              value={nextDueAt}
              onChange={(event) => setNextDueAt(event.target.value)}
            />
          </label>
        </div>
        <label>
          Responsável
          <select
            value={assigneeId}
            onChange={(event) => setAssigneeId(event.target.value)}
          >
            <option value="">Equipe da unidade</option>
            {assignees.map((person) => (
              <option key={person.id} value={person.id}>
                {person.name}
              </option>
            ))}
          </select>
        </label>
        {schedule && (
          <>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={active}
                onChange={(event) => setActive(event.target.checked)}
              />{" "}
              Programação ativa
            </label>
            <label>
              Motivo da alteração
              <textarea
                required
                minLength={3}
                maxLength={1000}
                rows={2}
                value={note}
                onChange={(event) => setNote(event.target.value)}
              />
            </label>
          </>
        )}
        <div className="notice info">
          Salvar uma contagem não encerra a pendência. A aprovação do supervisor
          conclui o ciclo e agenda a próxima conferência.
        </div>
        {error && (
          <div className="notice error" role="alert">
            {error}
          </div>
        )}
        <div className="modal-actions">
          <button
            type="button"
            className="button secondary"
            disabled={busy}
            onClick={onClose}
          >
            Cancelar
          </button>
          <button className="button primary" disabled={busy}>
            {busy ? "Salvando…" : "Salvar programação"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
