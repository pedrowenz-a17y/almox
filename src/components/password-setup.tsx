"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Eye, EyeOff, CheckCircle2 } from "lucide-react";
import AuthShell from "@/components/auth-shell";
import { api, ApiError } from "@/lib/client";
export default function PasswordSetup({ firstAccess = false }: { firstAccess?: boolean }) {
  const [context, setContext] = useState<{ email: string; identityId: string; units: string[] } | null>(null), [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false), [show, setShow] = useState(false), [error, setError] = useState(""), [done, setDone] = useState(false);
  const [blocked, setBlocked] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void api<{ email: string; identityId: string; units: string[] }>("/api/auth/password-context", { signal: controller.signal })
      .then(value => { if (!controller.signal.aborted) setContext(value); })
      .catch(cause => { if (!controller.signal.aborted) {
        setError(cause instanceof ApiError && cause.code === "PASSWORD_LINK_REQUIRED" && firstAccess
          ? "Para criar sua primeira senha, abra o convite recebido por e-mail. Se ainda não recebeu, peça ao administrador para conferir seu cadastro."
          : cause instanceof Error ? cause.message : "Não foi possível conferir o acesso.");
        setBlocked(cause instanceof ApiError && ["ACCOUNT_DISABLED", "AUTH_IDENTITY_CHANGED"].includes(cause.code ?? ""));
      } }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [firstAccess]);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy || !context) return;
    const element = event.currentTarget, form = new FormData(element), password = String(form.get("password") ?? "");
    if (password !== form.get("confirmation")) { setError("As senhas precisam ser iguais."); return; }
    setBusy(true); setError("");
    try { await api("/api/auth/update-password", { method: "POST", body: JSON.stringify({ password, expectedIdentityId: context.identityId }) }); element.reset(); setDone(true); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível definir a senha.");
      if (cause instanceof ApiError && cause.code === "PASSWORD_LINK_REQUIRED") setContext(null);
      if (cause instanceof ApiError && cause.code === "PASSWORD_ACCOUNT_CHANGED") { setContext(null); setBlocked(true); } }
    finally { setBusy(false); }
  }
  return <AuthShell title={done ? "Sua senha está pronta" : firstAccess ? "Prepare seu primeiro acesso" : "Definir sua senha"}
    description={done ? "Entre no site ou no aplicativo com seu e-mail e a nova senha." : firstAccess ? "Confira sua conta e escolha uma senha pessoal para começar." : "Confira a conta antes de escolher a nova senha."}>
    {loading ? <p role="status">Conferindo seu acesso…</p> : done ? <div className="auth-result notice info" role="status"><CheckCircle2 size={22} /><strong>Senha atualizada com sucesso.</strong><p>Seu acesso às unidades continua conforme o perfil definido pelo administrador.</p></div> : <>
      {context && <div className="notice info password-identity"><small>Você está definindo a senha de</small><strong>{context.email}</strong><span>{context.units.join(" · ")}</span></div>}
      {error && <div className="notice error" role="alert">{error}</div>}
      {context && <form onSubmit={submit} aria-busy={busy}>
        <label><span id="access-password-label">Nova senha</span><div className="password-field"><input name="password" aria-labelledby="access-password-label" aria-describedby="access-password-guidance" type={show ? "text" : "password"} required minLength={12} maxLength={128} autoComplete="new-password" disabled={busy} />
          <button type="button" aria-label={show ? "Ocultar senha" : "Mostrar senha"} onClick={() => setShow(!show)}>{show ? <EyeOff size={19} /> : <Eye size={19} />}</button></div><small id="access-password-guidance">Use pelo menos 12 caracteres. Evite dados pessoais e senhas já utilizadas.</small></label>
        <label>Confirme a nova senha<input name="confirmation" type={show ? "text" : "password"} required minLength={12} maxLength={128} autoComplete="new-password" disabled={busy} /></label>
        <button className="button primary full" disabled={busy}>{busy ? "Salvando…" : firstAccess ? "Criar minha senha" : "Salvar nova senha"}</button>
      </form>}
    </>}
    <div className="auth-form-links">
      {done ? <Link className="button primary full" href="/login">Ir para o login</Link> : !loading && !blocked && <Link className="text-link auth-back-link" href="/esqueci-senha">Solicitar outro link</Link>}
      {!done && <Link className="text-link auth-back-link" href="/login">Voltar para o login</Link>}
    </div>
  </AuthShell>;
}
