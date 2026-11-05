import "dotenv/config";
import {
  inspectConfiguration,
  databaseFailure,
} from "./config-diagnostics.mjs";

const offline = process.argv.includes("--offline");
const json = process.argv.includes("--json");
const checks = inspectConfiguration(process.env, {
  production: process.argv.includes("--production"),
});
const add = (name, status, message) => checks.push({ name, status, message });

if (!offline && !checks.some((check) => check.status === "error")) {
  let db;
  try {
    const { PrismaClient } = await import("@prisma/client");
    const url = new URL(process.env.DATABASE_URL);
    if (!url.searchParams.has("connect_timeout"))
      url.searchParams.set("connect_timeout", "5");
    if (!url.searchParams.has("pool_timeout"))
      url.searchParams.set("pool_timeout", "5");
    db = new PrismaClient({
      datasourceUrl: url.toString(),
      errorFormat: "minimal",
      log: [],
    });
    await db.$queryRaw`SELECT 1`;
    add(
      "Conexão PostgreSQL",
      "ok",
      "O banco respondeu. Nenhuma escrita foi executada.",
    );
    const [tables] = await db.$queryRaw`SELECT
      to_regclass('public."User"') IS NOT NULL AND to_regclass('public."UnitMembership"') IS NOT NULL
      AND to_regclass('public."Product"') IS NOT NULL AND to_regclass('public."PurchaseOrder"') IS NOT NULL
      AND to_regclass('public."WorkOrder"') IS NOT NULL AS ready`;
    add(
      "Estrutura do ERP",
      tables?.ready ? "ok" : "error",
      tables?.ready
        ? "Tabelas essenciais encontradas. Isso não comprova migração ou reconciliação de dados existentes."
        : databaseFailure("P2021"),
    );
    if (tables?.ready) {
      const [access] = await db.$queryRaw`SELECT EXISTS (
        SELECT 1 FROM "UnitMembership" m JOIN "User" u ON u.id = m."userId"
        JOIN "OperationalUnit" unit ON unit.id = m."unitId" JOIN "Organization" org ON org.id = unit."organizationId"
        WHERE m.active AND u.active AND unit.active AND org.active AND u."authUserId" IS NOT NULL
      ) AS ready`;
      add(
        "Acesso inicial",
        access?.ready ? "ok" : "warning",
        access?.ready
          ? "Existe vínculo ativo com identidade Supabase. A conta específica ainda precisa autenticar."
          : "Nenhum vínculo ativo de acesso encontrado. Siga o primeiro administrador no README; o sistema não possui senha padrão.",
      );
    }
  } catch (error) {
    add("Conexão PostgreSQL", "error", databaseFailure(error?.code));
  } finally {
    if (db) await db.$disconnect().catch(() => {});
  }

  try {
    const response = await fetch(
      new URL("/auth/v1/settings", process.env.NEXT_PUBLIC_SUPABASE_URL),
      {
        headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY },
        signal: AbortSignal.timeout(8000),
      },
    );
    await response.body?.cancel();
    add(
      "Serviço de autenticação",
      response.ok ? "ok" : "error",
      response.ok
        ? "O serviço respondeu à chave pública. Esta checagem não tenta login nem envia e-mail."
        : "O Supabase não aceitou a consulta. Confira se a Project URL e a chave pública pertencem ao mesmo projeto ativo.",
    );
  } catch {
    add(
      "Serviço de autenticação",
      "error",
      "Não foi possível alcançar o Supabase Auth em até 8 segundos. Confira URL, rede e estado do projeto.",
    );
  }
}

const errors = checks.filter((check) => check.status === "error").length;
const report = {
  mode: offline ? "configuration-only" : "read-only",
  checks,
  errors,
};
if (json) console.log(JSON.stringify(report, null, 2));
else {
  console.log("\nAlmox ERP — diagnóstico local, sem alterar dados\n");
  for (const check of checks)
    console.log(
      `${{ ok: "OK", error: "FALHA", warning: "AVISO" }[check.status]} | ${check.name}\n  ${check.message}\n`,
    );
  if (offline)
    console.log(
      "Modo offline: conexão, tabelas e autenticação não foram consultadas.",
    );
  else if (errors)
    console.log(
      "Corrija os itens FALHA e execute npm run doctor novamente. Não compartilhe o arquivo .env ou valores de chaves.",
    );
  else
    console.log(
      "Checagens concluídas. O login do usuário e os fluxos reais ainda precisam ser conferidos.",
    );
}
if (errors) process.exitCode = 1;
