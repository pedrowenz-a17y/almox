"use client";
import { useState } from "react";
import Link from "next/link";
import AuthShell from "@/components/auth-shell";
import { api, ApiError } from "@/lib/client";
import { useAuthCooldown } from "@/components/auth-cooldown";
export default function RecoverPassword() {
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [sent, setSent] = useState(false);
  const cooldown = useAuthCooldown();
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy || cooldown.remaining) return;
    const email = new FormData(event.currentTarget).get("email");
    setBusy(true); setError(""); setSent(false);
    try {
      const result = await api<{ retryAfter?: number }>("/api/auth/recover", { method: "POST", body: JSON.stringify({ email }) });
      setSent(true); cooldown.wait(result.retryAfter ?? 60);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível solicitar a recuperação.");
      if (cause instanceof ApiError && cause.status === 429) cooldown.wait(cause.retryAfter ?? 60);
    } finally { setBusy(false); }
  }
  return <AuthShell title="Recuperar acesso" description="Informe seu e-mail para solicitar um link e definir uma nova senha.">
    {sent && <div className="auth-result notice info" role="status">Se houver uma conta habilitada para este e-mail, você receberá as instruções. Confira também o spam e abra a mensagem mais recente.</div>}
    <form onSubmit={submit} aria-busy={busy}>
      <label>E-mail<input name="email" type="email" required autoComplete="email" disabled={busy} onChange={() => { setSent(false); setError(""); }} /></label>
      {error && <div className="notice error" role="alert">{error}</div>}
      <button className="button primary full" disabled={busy || cooldown.remaining > 0}>{busy ? "Solicitando…" : cooldown.remaining ? `Nova tentativa em ${cooldown.label}` : sent ? "Solicitar outro link" : "Enviar link de recuperação"}</button>
      <p className="auth-form-help">O link não altera sua senha sozinho. Confira o e-mail da conta na tela seguinte antes de escolher a nova senha.</p>
    </form>
    <Link className="text-link auth-back-link" href="/login">Voltar para o login</Link>
  </AuthShell>;
}
