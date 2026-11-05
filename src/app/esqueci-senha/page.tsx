"use client";
import { useState } from "react";
import Link from "next/link";
import AuthShell from "@/components/auth-shell";
import { api } from "@/lib/client";
export default function RecoverPassword() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const email = new FormData(event.currentTarget).get("email");
    setBusy(true);
    setError("");
    try {
      await api("/api/auth/recover", {
        method: "POST",
        body: JSON.stringify({ email }),
      });
      setSent(true);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Não foi possível solicitar a recuperação.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <AuthShell
      title="Recuperar acesso"
      description="Informe o e-mail da sua conta para solicitar um link de recuperação."
    >
      {sent ? (
        <div className="auth-result notice info" role="status">
          Se a conta estiver habilitada para recuperação, você receberá as
          instruções por e-mail. Confira também a pasta de spam.
        </div>
      ) : (
        <form onSubmit={submit} aria-busy={busy}>
          <label>
            E-mail
            <input
              name="email"
              type="email"
              required
              autoComplete="email"
              disabled={busy}
            />
          </label>
          {error && (
            <div className="notice error" role="alert">
              {error}
            </div>
          )}
          <button className="button primary full" disabled={busy}>
            {busy ? "Solicitando…" : "Enviar link de recuperação"}
          </button>
        </form>
      )}
      <Link className="text-link auth-back-link" href="/login">
        Voltar para o login
      </Link>
    </AuthShell>
  );
}
