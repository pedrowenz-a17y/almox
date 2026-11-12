"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AuthShell from "@/components/auth-shell";
import { api, ApiError } from "@/lib/client";
import { readAuthFragment, type ImplicitAuthLink } from "@/lib/auth-return";
export default function AcceptAccessLink() {
  const router = useRouter(), captured = useRef(false), link = useRef<ImplicitAuthLink | null>(null);
  const [state, setState] = useState<"LOADING" | "READY" | "ERROR" | "BLOCKED">("LOADING");
  const [error, setError] = useState(""), [busy, setBusy] = useState(false);
  useEffect(() => {
    if (captured.current) return;
    captured.current = true;
    const value = readAuthFragment(window.location.hash);
    // Remove secrets before any API request; never copy them into storage or React state.
    window.history.replaceState(null, "", "/auth/retorno");
    link.current = value;
    queueMicrotask(() => {
      if (!value) { setState("ERROR"); setError("O link está incompleto, expirou ou já foi utilizado. Solicite um novo link."); }
      else setState("READY");
    });
  }, []);
  async function accept() {
    if (busy || !link.current) return;
    setBusy(true); setError("");
    try {
      const result = await api<{ next: string }>("/api/auth/complete-link", { method: "POST", body: JSON.stringify(link.current) });
      link.current = null;
      router.replace(result.next === "/primeiro-acesso" ? "/primeiro-acesso" : "/recuperar-senha"); router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível validar o link."); setBusy(false);
      if (cause instanceof ApiError && (cause.status === 0 || cause.status >= 500 || cause.status === 429)) setState("READY");
      else { setState(cause instanceof ApiError && ["ACCOUNT_DISABLED", "AUTH_IDENTITY_CHANGED"].includes(cause.code ?? "") ? "BLOCKED" : "ERROR"); link.current = null; }
    }
  }
  return <AuthShell title="Vamos preparar seu acesso" description="Confirme o link recebido por e-mail para continuar e definir sua senha.">
    {state === "LOADING" && <p role="status">Conferindo o link…</p>}
    {state === "READY" && <>
      <div className="notice info"><strong>Você vai definir sua própria senha.</strong><p>Na próxima tela, confira o e-mail da conta. Depois, use a nova senha para entrar no site ou no aplicativo.</p></div>
      <button className="button primary full" disabled={busy} onClick={() => void accept()}>{busy ? "Validando…" : "Validar link e continuar"}</button>
    </>}
    {error && <div className="notice error" role="alert">{error}</div>}
    {state === "ERROR" && <Link className="button primary full" href="/esqueci-senha">Solicitar novo link</Link>}
    <Link className="text-link auth-back-link" href="/login">Voltar para o login</Link>
  </AuthShell>;
}
