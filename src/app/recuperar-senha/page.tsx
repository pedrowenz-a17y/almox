"use client";
import { useState } from "react";
import Link from "next/link";
import AuthShell from "@/components/auth-shell";
import { api } from "@/lib/client";
export default function UpdatePassword() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") || "");
    if (password !== form.get("confirmation")) {
      setError("As senhas precisam ser iguais.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await api("/api/auth/update-password", {
        method: "POST",
        body: JSON.stringify({ password }),
      });
      setDone(true);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Não foi possível definir a senha. Solicite um novo link.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <AuthShell
      title="Definir sua senha"
      description="Use o link recebido por e-mail para cadastrar uma nova senha."
    >
      {done ? (
        <div className="auth-result notice info" role="status">
          Senha atualizada. Entre novamente com seu e-mail e a nova senha.
        </div>
      ) : (
        <form onSubmit={submit} aria-busy={busy}>
          <label>
            Nova senha
            <input
              name="password"
              type="password"
              required
              minLength={12}
              maxLength={128}
              autoComplete="new-password"
              disabled={busy}
            />
            <small>Use pelo menos 12 caracteres.</small>
          </label>
          <label>
            Confirme a nova senha
            <input
              name="confirmation"
              type="password"
              required
              minLength={12}
              maxLength={128}
              autoComplete="new-password"
              disabled={busy}
            />
          </label>
          {error && (
            <div className="notice error" role="alert">
              {error}
            </div>
          )}
          <button className="button primary full" disabled={busy}>
            {busy ? "Atualizando…" : "Salvar nova senha"}
          </button>
        </form>
      )}
      <Link
        className="text-link auth-back-link"
        href={done ? "/login" : "/esqueci-senha"}
      >
        {done ? "Ir para o login" : "Solicitar outro link"}
      </Link>
    </AuthShell>
  );
}
