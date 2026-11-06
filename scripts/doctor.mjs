import "dotenv/config";
import {
  inspectConfiguration,
  databaseFailure,
} from "./config-diagnostics.mjs";
import {
  databaseCode,
  inspectDatabase,
  inspectDatabaseNetwork,
} from "./database-diagnostics.mjs";

const offline = process.argv.includes("--offline");
const networkOnly = process.argv.includes("--network-only") && !offline;
const json = process.argv.includes("--json");
const configuration = inspectConfiguration(process.env, {
  production: process.argv.includes("--production"),
});
const checks = networkOnly
  ? configuration.filter((check) =>
      ["DATABASE_URL", "DIRECT_URL"].includes(check.name),
    )
  : [...configuration];
const valid = (name) =>
  configuration.find((check) => check.name === name)?.status === "ok";

if (!offline) {
  // Independent checks still run when APP_URL or another unrelated setting is invalid.
  for (const name of networkOnly
    ? ["DATABASE_URL", "DIRECT_URL"]
    : ["DATABASE_URL"]) {
    if (!valid(name)) continue;
    const network = await inspectDatabaseNetwork(process.env[name], {
      label: name,
    });
    checks.push(...network.checks);
    if (networkOnly) continue;
    if (!network.reachable) {
      checks.push({
        name: "Conexão PostgreSQL",
        status: "warning",
        message:
          "Consulta não executada porque DNS/TCP falhou. Corrija essa etapa e rode o diagnóstico novamente; senha e tabelas ainda não foram verificadas.",
      });
      continue;
    }
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
      checks.push(...(await inspectDatabase(db)));
    } catch (error) {
      const code = databaseCode(error);
      checks.push({
        name: "Cliente PostgreSQL",
        status: "error",
        message: code
          ? databaseFailure(code)
          : "Não foi possível inicializar o cliente do banco. Confira a instalação das dependências e execute npm run db:generate. Nenhuma migração foi aplicada.",
        ...(code ? { code } : {}),
      });
    } finally {
      if (db) await db.$disconnect().catch(() => {});
    }
  }
  if (
    !networkOnly &&
    valid("NEXT_PUBLIC_SUPABASE_URL") &&
    valid("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY")
  ) {
    try {
      const response = await fetch(
        new URL("/auth/v1/settings", process.env.NEXT_PUBLIC_SUPABASE_URL),
        {
          headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY },
          signal: AbortSignal.timeout(8000),
        },
      );
      await response.body?.cancel();
      checks.push({
        name: "Serviço de autenticação",
        status: response.ok ? "ok" : "error",
        message: response.ok
          ? "O serviço respondeu à chave pública via HTTPS. Isso não confirma acesso ao PostgreSQL. Esta checagem não tenta login nem envia e-mail."
          : "O Supabase não aceitou a consulta. Confira se a Project URL e a chave pública pertencem ao mesmo projeto ativo.",
      });
    } catch {
      checks.push({
        name: "Serviço de autenticação",
        status: "error",
        message:
          "Não foi possível alcançar o Supabase Auth em até 8 segundos. Confira URL, rede e estado do projeto.",
      });
    }
  }
}

const errors = checks.filter((check) => check.status === "error").length;
const report = {
  mode: offline
    ? "configuration-only"
    : networkOnly
      ? "network-only"
      : "read-only",
  checks,
  errors,
};
if (json) console.log(JSON.stringify(report, null, 2));
else {
  console.log("\nAlmox ERP — diagnóstico local, sem alterar dados\n");
  for (const check of checks)
    console.log(
      `${{ ok: "OK", error: "FALHA", warning: "AVISO" }[check.status]} | ${check.name}${check.code ? ` [${check.code}]` : ""}\n  ${check.message}\n`,
    );
  if (offline)
    console.log(
      "Modo offline: conexão, tabelas e autenticação não foram consultadas.",
    );
  else if (networkOnly)
    console.log(
      "Modo rede: somente DNS/TCP foram testados. Senha, TLS, tabelas e login não foram consultados. Rode npm run doctor para o diagnóstico completo.",
    );
  else if (!errors)
    console.log(
      "Checagens concluídas. O login do usuário e os fluxos reais ainda precisam ser conferidos.",
    );
  if (errors)
    console.log(
      "Corrija os itens FALHA e execute npm run doctor novamente. Não compartilhe o arquivo .env ou valores de chaves.",
    );
}
if (errors) process.exitCode = 1;
