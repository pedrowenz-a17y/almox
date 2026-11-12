import Link from "next/link";
import AuthShell from "@/components/auth-shell";
const messages: Record<string, string> = {
  expired: "O link expirou, está incompleto ou já foi utilizado. Solicite um novo link e abra a mensagem mais recente.",
  browser: "Este link pertence a uma solicitação antiga que não pôde ser validada neste navegador. Solicite um novo link de acesso.",
  unavailable: "O serviço de login está temporariamente indisponível. Aguarde e tente novamente mais tarde.",
  configuration: "O endereço de acesso precisa ser conferido pelo administrador. Entre em contato com o responsável pelo ERP.",
};
export default async function InvalidAccess({ searchParams }: { searchParams: Promise<{ reason?: string }> }) {
  const reason = (await searchParams).reason ?? "expired";
  return <AuthShell title="Não foi possível validar o link" description={Object.hasOwn(messages, reason) ? messages[reason] : messages.expired}>
    <p className="notice info">Se você acabou de receber um convite, peça ao administrador para conferir seu acesso na unidade e reenviar o link, se necessário.</p>
    <Link className="button primary full" href="/esqueci-senha">Solicitar novo link</Link>
    <Link className="text-link auth-back-link" href="/login">Voltar para o login</Link>
  </AuthShell>;
}
