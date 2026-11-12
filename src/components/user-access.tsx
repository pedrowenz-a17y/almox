"use client";
import { useEffect, useState } from "react";
import { Copy, Mail, RefreshCw } from "lucide-react";
import { api, ApiError, dateTime, type ManagedUser } from "@/lib/client";
import { accessState, accessStateLabels, type AccessState } from "@/lib/access-status";
import { profileTitle } from "@/lib/access-profiles";
import { Badge, Empty, Loading, Modal } from "@/components/ui";
import { useAuthCooldown } from "@/components/auth-cooldown";
import type { AccessDetails, AccessMailResult } from "@/services/access-emails";

const stateOf = (user: ManagedUser) => user.accessState ?? accessState({ active: user.active, identityActive: user.identityActive,
  authLinked: !!user.authUserId || user.authLinked === true, lastLoginAt: user.lastLoginAt, invitationAt: user.invitationAt });
export default function UserAccessTable({ users, currentId, actions, onChanged }: {
  users: ManagedUser[]; currentId: string; actions: (user: ManagedUser) => React.ReactNode; onChanged: () => void;
}) {
  const [selected, setSelected] = useState<string | null>(null), [query, setQuery] = useState(""), [state, setState] = useState("ALL");
  const filtered = users.filter(user => (state === "ALL" || stateOf(user) === state) && `${user.name} ${user.email}`.toLocaleLowerCase("pt-BR").includes(query.trim().toLocaleLowerCase("pt-BR")));
  return <>
    <section className="panel user-access-panel">
      <div className="toolbar"><label>Buscar pessoa<input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Nome ou e-mail" /></label>
        <label>Primeiro acesso<select aria-label="Filtrar primeiro acesso" value={state} onChange={event => setState(event.target.value)}><option value="ALL">Todos os estados</option>
          {(Object.keys(accessStateLabels) as AccessState[]).map(key => <option key={key} value={key}>{accessStateLabels[key]}</option>)}
        </select></label><span className="muted">{filtered.length} de {users.length} pessoas</span></div>
      {filtered.length ? <div className="table-wrap"><table className="users-access-table"><thead><tr><th>Pessoa</th><th>Perfil na unidade</th><th>Acesso</th><th>Primeiro acesso</th><th>Ações</th></tr></thead>
        <tbody>{filtered.map(user => { const status = stateOf(user); return <tr key={user.id}>
          <td data-label="Pessoa"><strong>{user.name}</strong><small>{user.email}</small>{user.id === currentId && <small>Você</small>}</td>
          <td data-label="Perfil na unidade"><Badge tone={user.role?.name === "ADMINISTRADOR" ? "purple" : "info"}>{profileTitle(user.role?.name ?? "Perfil")}</Badge></td>
          <td data-label="Acesso"><Badge tone={user.active !== false && user.identityActive !== false ? "success" : ""}>{user.identityActive === false ? "Identidade desativada" : user.active === false ? "Desativado nesta unidade" : "Habilitado na unidade"}</Badge></td>
          <td data-label="Primeiro acesso"><Badge tone={status === "ACTIVE" ? "success" : status === "DISABLED" ? "" : "warning"}>{accessStateLabels[status]}</Badge>
            {user.lastMailState === "FAILED" && <small>O último envio não foi confirmado.</small>}{user.lastMailState === "UNCONFIRMED" && <small>Envio aguardando confirmação.</small>}
            {user.lastLoginAt && <small>Última entrada: {dateTime(user.lastLoginAt)}</small>}</td>
          <td data-label="Ações"><div className="user-access-actions"><button className="button secondary" aria-label={`Acompanhar acesso de ${user.name}`} onClick={() => setSelected(user.id)}><Mail size={15} /> Acesso</button>{actions(user)}</div></td>
        </tr>; })}</tbody></table></div> : <Empty title="Nenhuma pessoa neste filtro" description="Confira o nome, o e-mail ou o estado selecionado." />}
      <p className="user-access-footnote">Habilitar o acesso à unidade não define a senha. A pessoa precisa concluir o convite ou usar uma identidade de login já confirmada.</p>
    </section>
    {selected && <AccessHelp id={selected} onClose={() => setSelected(null)} onChanged={onChanged} />}
  </>;
}
const providerGuidance: Record<AccessDetails["providerState"], string> = {
  READY: "O vínculo corresponde ao e-mail cadastrado. Enviar um link não muda o perfil nem a senha automaticamente.",
  MISSING: "A identidade vinculada não foi encontrada. O administrador precisa revisar o vínculo no Supabase; reenviar e-mail não corrige um identificador antigo.",
  MISMATCH: "O identificador de login não corresponde ao e-mail cadastrado. Revise o vínculo antes de enviar qualquer link.",
  UNAVAILABLE: "Não foi possível consultar o serviço de login. Tente atualizar mais tarde.",
  CONFIGURATION: "A administração de convites precisa ser conferida na configuração do servidor. O acesso comum pode continuar disponível.",
  UNLINKED: "Este cadastro não tem identidade de login vinculada. Revise o provisionamento antes de solicitar o primeiro acesso.",
};
function AccessHelp({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const [result, setResult] = useState<AccessDetails | null>(null), [loading, setLoading] = useState(true), [error, setError] = useState("");
  const [notice, setNotice] = useState(""), [busy, setBusy] = useState(false);
  const cooldown = useAuthCooldown();
  async function load(signal?: AbortSignal) {
    setLoading(true); setError("");
    try { const next = await api<AccessDetails>(`/api/user-access/${id}`, { signal });
      if (!signal?.aborted) { setResult(next); if (next.nextAttemptAt) cooldown.wait(Math.max(0, Math.ceil((new Date(next.nextAttemptAt).getTime() - Date.now()) / 1000))); } }
    catch (cause) { if (!signal?.aborted) setError(cause instanceof Error ? cause.message : "Não foi possível conferir o acesso."); }
    finally { if (!signal?.aborted) setLoading(false); }
  }
  useEffect(() => {
    const controller = new AbortController();
    void Promise.resolve().then(() => { if (!controller.signal.aborted) return load(controller.signal); });
    return () => controller.abort();
    // Loading a different person recreates this modal; cooldown updates must not trigger new requests.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  async function send() {
    if (!result?.canSend || !result.authUserId || busy || cooldown.remaining) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const sent = await api<AccessMailResult>(`/api/user-access/${id}`, { method: "POST", body: JSON.stringify({ authUserId: result.authUserId }) });
      setNotice(sent.message); cooldown.wait(sent.retryAfter); await load(); onChanged();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível solicitar o envio.");
      if (cause instanceof ApiError && cause.status === 429) cooldown.wait(cause.retryAfter ?? 60); }
    finally { setBusy(false); }
  }
  const sendLabel = result?.identity?.emailConfirmed ? "Enviar link para definir senha" : result?.invitationAt || result?.identity?.invitedAt ? "Reenviar convite" : "Enviar convite";
  return <Modal title="Acompanhar acesso" subtitle={result?.name} onClose={() => { if (!busy) onClose(); }}>
    <div className="modal-body access-help">
      {notice && <div className="notice success" role="status">{notice}</div>}{error && <div className="notice error" role="alert">{error}</div>}
      {loading ? <Loading /> : result && <>
        <div className="access-help-identity"><strong>{result.email}</strong><Badge tone={result.accessState === "ACTIVE" ? "success" : "warning"}>{accessStateLabels[result.accessState]}</Badge></div>
        <p className="muted">{providerGuidance[result.providerState]}</p>
        <dl className="access-facts"><div><dt>Acesso à unidade</dt><dd>{result.active && result.identityActive ? "Habilitado" : "Desativado"}</dd></div>
          <div><dt>E-mail confirmado no serviço de login</dt><dd>{result.identity ? result.identity.emailConfirmed ? "Sim" : "Aguardando confirmação" : "Não foi possível verificar"}</dd></div>
          <div><dt>Definição de senha pelo ERP</dt><dd>{result.passwordDefinedAt ? dateTime(result.passwordDefinedAt) : "Ainda sem confirmação registrada"}</dd></div>
          <div><dt>Última entrada nesta unidade</dt><dd>{result.lastLoginAt ? dateTime(result.lastLoginAt) : "Ainda sem confirmação registrada"}</dd></div>
          {result.invitationAt && <div><dt>Último convite solicitado</dt><dd>{dateTime(result.invitationAt)}</dd></div>}
        </dl>
        <details className="access-first-steps"><summary>Como a pessoa começa</summary><ol><li>Abra a mensagem mais recente de convite ou recuperação.</li><li>Valide o link, confira seu e-mail e defina uma senha pessoal.</li><li>Entre no aplicativo com esse e-mail e a nova senha.</li></ol></details>
        {result.identity?.blocked && <div className="notice error">A identidade está bloqueada no serviço de login.</div>}
        {!result.active && <p className="muted">O acesso precisa ser reativado por uma pessoa autorizada antes do envio.</p>}
        <p className="muted">Sem registro não significa sem senha. Contas antigas serão confirmadas no próximo login.</p>
        <div className="access-help-actions"><button className="button secondary" disabled={busy} onClick={() => void load()}><RefreshCw size={16} /> Atualizar estado</button>
          <button className="button primary" disabled={busy || !result.canSend || cooldown.remaining > 0} onClick={() => void send()}><Mail size={16} />{busy ? "Solicitando…" : cooldown.remaining ? `Nova tentativa em ${cooldown.label}` : sendLabel}</button></div>
      </>}
      {!loading && !result && <button className="button secondary" onClick={() => void load()}>Tentar consultar novamente</button>}
    </div>
  </Modal>;
}
export function AccessEmailSettings() {
  const [result, setResult] = useState<{ origin: string; redirectUrls: string[]; administrativeKeyPresent: boolean } | null>(null);
  const [error, setError] = useState(""), [loading, setLoading] = useState(false), [copied, setCopied] = useState("");
  async function load() {
    if (loading) return; setLoading(true); setError("");
    try { setResult(await api("/api/user-access/setup")); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível consultar a configuração."); }
    finally { setLoading(false); }
  }
  async function copy(text: string) { try { await navigator.clipboard.writeText(text); setCopied("Endereço copiado."); } catch { setCopied("Selecione o endereço para copiar."); } }
  return <section className="panel access-email-settings"><details onToggle={event => { if (event.currentTarget.open && !result && !loading) void load(); }}>
    <summary>Endereços dos convites e recuperação</summary><p>Confira estes endereços no Supabase em Authentication → URL Configuration. A tela mostra o que o ERP espera; não confirma as configurações do painel externo.</p>
    {error && <div className="notice error" role="alert">{error}</div>}{loading && <Loading />}
    {result && <>
      {typeof window !== "undefined" && window.location.origin !== result.origin && <div className="notice warning">Você abriu o ERP por um endereço diferente do usado nos convites. Os links serão enviados para {result.origin}. Confira APP_URL na hospedagem se esse endereço não for o oficial.</div>}
      {!result.administrativeKeyPresent && <div className="notice error">A chave administrativa para convites ainda precisa ser configurada no servidor da hospedagem.</div>}
      <label>Site URL<div className="access-copy"><input readOnly value={result.origin} /><button className="icon-button" aria-label="Copiar Site URL" onClick={() => void copy(result.origin)}><Copy size={17} /></button></div></label>
      {result.redirectUrls.map((url, index) => <label key={url}>Redirect URL {index + 1}<div className="access-copy"><input readOnly value={url} /><button className="icon-button" aria-label={`Copiar Redirect URL ${index + 1}`} onClick={() => void copy(url)}><Copy size={17} /></button></div></label>)}
      <p className="muted">Mantenha o modelo padrão de e-mail. Se o provedor limitar os envios ou não autorizar destinatários, o responsável precisa configurar um serviço SMTP no Supabase.</p>
    </>}
    {copied && <p role="status">{copied}</p>}
  </details></section>;
}
