"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Eye, EyeOff } from "lucide-react";
import { api } from "@/lib/client";
import AuthShell from "@/components/auth-shell";

export default function Login() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("error"))
      queueMicrotask(() =>
        setError(
          "O link de acesso expirou ou não pôde ser validado. Solicite um novo link ou entre com sua conta.",
        ),
      );
  }, []);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setError("");
    setBusy(true);
    const form = new FormData(event.currentTarget);
    try {
      await api("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({
          email: form.get("email"),
          password: form.get("password"),
        }),
      });
      const next = new URLSearchParams(window.location.search).get("next");
      router.replace(
        next?.startsWith("/") &&
          !next.startsWith("//") &&
          !next.includes("\\") &&
          !next.startsWith("/login")
          ? next
          : "/dashboard",
      );
      router.refresh();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Não foi possível entrar. Tente novamente.",
      );
      setBusy(false);
    }
  }
  return (
    <AuthShell
      fitScreen
      title="Seu almoxarifado começa aqui."
      description="Entre para continuar o trabalho da sua unidade."
    >
      <form onSubmit={submit} aria-busy={busy}>
        <label>
          E-mail
          <input
            name="email"
            type="email"
            placeholder="seu@email.com.br"
            required
            autoComplete="username"
            disabled={busy}
          />
        </label>
        <label>
          Senha
          <div className="password-field">
            <input
              name="password"
              type={show ? "text" : "password"}
              placeholder="Digite sua senha"
              required
              autoComplete="current-password"
              disabled={busy}
            />
            <button
              type="button"
              aria-label={show ? "Ocultar senha" : "Mostrar senha"}
              onClick={() => setShow(!show)}
            >
              {show ? <EyeOff size={19} /> : <Eye size={19} />}
            </button>
          </div>
        </label>
        <Link className="text-link auth-recovery-link" href="/esqueci-senha">
          Esqueci minha senha
        </Link>
        {error && (
          <div role="alert" className="notice error">
            {error}
          </div>
        )}
        <button className="button primary full login-submit" disabled={busy}>
          {busy ? "Entrando…" : "Entrar no almoxarifado"}
          <ArrowRight size={18} />
        </button>
      </form>
    </AuthShell>
  );
}
