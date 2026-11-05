import Link from "next/link";
import { redirect } from "next/navigation";
import ERP from "@/components/erp";
import { getSession } from "@/lib/auth";
import { AppError } from "@/lib/http";
import { AuthConfigurationError } from "@/lib/auth-config";

export const dynamic = "force-dynamic";
export default async function WorkspaceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  let user;
  try {
    user = await getSession();
  } catch (error) {
    const message =
      error instanceof AppError || error instanceof AuthConfigurationError
        ? error.message
        : "Não foi possível consultar o serviço de dados. Verifique a configuração e tente novamente.";
    return (
      <main className="login-form-wrap">
        <section className="login-form">
          <h1>Acesso ao ERP</h1>
          <p role="alert">{message}</p>
          <Link className="button primary" href="/login">
            Voltar ao login
          </Link>
        </section>
      </main>
    );
  }
  if (!user) redirect("/login");
  // API handlers still authorize every read/write. No user data is cached across sessions.
  return (
    <>
      <ERP initialUser={user} />
      {children}
    </>
  );
}
