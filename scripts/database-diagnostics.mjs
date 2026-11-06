import { Resolver } from "node:dns/promises";
import { createConnection, isIP } from "node:net";
import { databaseFailure } from "./config-diagnostics.mjs";

// Provider errors, addresses and URLs must never become report text.
const prismaCodes = new Set([
  "P1000",
  "P1001",
  "P1002",
  "P1003",
  "P1010",
  "P1011",
  "P1017",
  "P2021",
  "P2022",
  "P2024",
]);
export function databaseCode(error) {
  return [error?.code, error?.errorCode].find((code) => prismaCodes.has(code));
}
const check = (name, status, message, code) => ({
  name,
  status,
  message,
  ...(code ? { code } : {}),
});
const databaseError = (name, error) => {
  const code = databaseCode(error);
  return check(name, "error", databaseFailure(code), code);
};

async function resolveHost(host, timeoutMs) {
  const family = isIP(host);
  if (family) return [{ address: host, family }];
  if (host === "localhost")
    return [
      { address: "127.0.0.1", family: 4 },
      { address: "::1", family: 6 },
    ];
  const resolver = new Resolver();
  const timer = setTimeout(() => resolver.cancel(), timeoutMs);
  try {
    const results = await Promise.allSettled([
      resolver.resolve4(host),
      resolver.resolve6(host),
    ]);
    const addresses = results.flatMap((result, index) =>
      result.status === "fulfilled"
        ? result.value.map((address) => ({
            address,
            family: index === 0 ? 4 : 6,
          }))
        : [],
    );
    if (addresses.length) return addresses;
    const rejected = results.filter((result) => result.status === "rejected");
    const code = rejected.some((result) => result.reason?.code === "ECANCELLED")
      ? "DNS_TIMEOUT"
      : rejected.some((result) =>
            ["ENOTFOUND", "ENODATA"].includes(result.reason?.code),
          )
        ? "ENOTFOUND"
        : "DNS_FAILURE";
    throw Object.assign(new Error("DNS check failed"), { code });
  } finally {
    clearTimeout(timer);
  }
}
async function connectAddress({ address, family }, port, timeoutMs) {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: address, port, family });
    const finish = (error) => {
      socket.removeAllListeners();
      socket.destroy();
      if (error) reject(error);
      else resolve();
    };
    socket.setTimeout(timeoutMs, () =>
      finish(
        Object.assign(new Error("TCP check timed out"), { code: "ETIMEDOUT" }),
      ),
    );
    socket.once("connect", () => finish());
    socket.once("error", finish);
  });
}

/** DNS and TCP only: never authenticates or sends a PostgreSQL query. */
export async function inspectDatabaseNetwork(
  rawUrl,
  {
    label = "DATABASE_URL",
    timeoutMs = 3000,
    resolve = resolveHost,
    connect = connectAddress,
  } = {},
) {
  const checks = [];
  const url = new URL(rawUrl);
  const host = url.hostname.replace(/^\[|\]$/g, "");
  let addresses;
  try {
    addresses = await resolve(host, timeoutMs);
    if (!addresses.length) throw { code: "ENOTFOUND" };
  } catch (error) {
    const code = ["ENOTFOUND", "DNS_TIMEOUT"].includes(error?.code)
      ? error.code
      : "DNS_FAILURE";
    checks.push(
      check(
        `DNS (${label})`,
        "error",
        code === "ENOTFOUND"
          ? "O nome do servidor não foi localizado. Confira a conexão copiada de Connect e se o projeto Supabase está ativo."
          : "A consulta DNS não foi concluída. Confira o DNS e a rede deste computador; tente novamente após verificar o serviço.",
        code,
      ),
    );
    return { checks, reachable: false };
  }
  const ipv4 = addresses.some((address) => address.family === 4);
  const ipv6 = addresses.some((address) => address.family === 6);
  checks.push(
    check(
      `DNS (${label})`,
      "ok",
      `Nome resolvido: ${ipv4 && ipv6 ? "IPv4 e IPv6" : ipv4 ? "IPv4" : "IPv6"}. Isso ainda não comprova acesso ao banco.`,
    ),
  );
  const results = await Promise.allSettled(
    addresses
      .slice(0, 8)
      .map((address) => connect(address, Number(url.port || 5432), timeoutMs)),
  );
  const reachable = results.some((result) => result.status === "fulfilled");
  if (reachable) {
    checks.push(
      check(
        `TCP (${label})`,
        "ok",
        "A porta do servidor aceitou uma conexão TCP. Senha, TLS e tabelas ainda precisam ser conferidos.",
      ),
    );
  } else {
    const codes = results.map((result) => result.reason?.code);
    const code = codes.includes("ECONNREFUSED")
      ? "ECONNREFUSED"
      : codes.includes("ETIMEDOUT")
        ? "ETIMEDOUT"
        : "NETWORK_UNREACHABLE";
    const message =
      code === "ECONNREFUSED"
        ? "A conexão TCP foi recusada. Confira o projeto ativo e a porta fornecida em Connect; o serviço pode estar indisponível ou a rede pode recusá-lo."
        : "A porta do banco não foi alcançada. Isso pode ser rede, rota ou projeto indisponível; o resultado sozinho não confirma bloqueio da escola.";
    checks.push(
      check(
        `TCP (${label})`,
        "error",
        `${message}${
          !ipv4 && ipv6
            ? " O endereço oferece somente IPv6. Se a rede não tiver IPv6, copie a conexão Session pooler com IPv4 fornecida pelo Supabase."
            : " Peça à TI que verifique o acesso ao servidor e à porta informados em Connect, ou compare em outra rede autorizada."
        }`,
        code,
      ),
    );
  }
  return { checks, reachable };
}

/** Separates transport/authentication, schema and membership failures. Read-only. */
export async function inspectDatabase(db) {
  const checks = [];
  try {
    await db.$queryRaw`SELECT 1`;
    checks.push(
      check(
        "Conexão PostgreSQL",
        "ok",
        "O banco respondeu. Nenhuma escrita foi executada.",
      ),
    );
  } catch (error) {
    return [databaseError("Conexão PostgreSQL", error)];
  }
  try {
    const [tables] = await db.$queryRaw`SELECT
      to_regclass('public."User"') IS NOT NULL AND to_regclass('public."UnitMembership"') IS NOT NULL
      AND to_regclass('public."Product"') IS NOT NULL AND to_regclass('public."PurchaseOrder"') IS NOT NULL
      AND to_regclass('public."WorkOrder"') IS NOT NULL AND to_regclass('public."OperationalUnit"') IS NOT NULL
      AND to_regclass('public."Organization"') IS NOT NULL AND to_regclass('public."InventorySchedule"') IS NOT NULL
      AND to_regclass('public."ReconciliationBatch"') IS NOT NULL AND to_regclass('public."OrderMaterial"') IS NOT NULL
      AND to_regclass('public."InventoryCount"') IS NOT NULL AS ready`;
    if (!tables?.ready) {
      checks.push(databaseError("Estrutura do ERP", { code: "P2021" }));
      return checks;
    }
    const [columns] = await db.$queryRaw`SELECT COUNT(*) = 4 AS ready
      FROM information_schema.columns
      WHERE table_schema = 'public' AND (
        (table_name = 'OrderMaterial' AND column_name IN ('pendingReturnQuantity', 'invoicedUnitCost'))
        OR (table_name = 'InventoryCount' AND column_name IN ('scheduleId', 'scheduleDueAt'))
      )`;
    if (!columns?.ready) {
      checks.push(databaseError("Estrutura do ERP", { code: "P2022" }));
      return checks;
    }
    checks.push(
      check(
        "Estrutura do ERP",
        "ok",
        "Estrutura básica 2.4 encontrada. Isso não valida os dados, todo o histórico de migrations ou a reconciliação de dados existentes.",
      ),
    );
  } catch (error) {
    checks.push(databaseError("Estrutura do ERP", error));
    return checks;
  }
  try {
    const [access] = await db.$queryRaw`SELECT EXISTS (
      SELECT 1 FROM "UnitMembership" m JOIN "User" u ON u.id = m."userId"
      JOIN "OperationalUnit" unit ON unit.id = m."unitId" JOIN "Organization" org ON org.id = unit."organizationId"
      WHERE m.active AND u.active AND unit.active AND org.active AND u."authUserId" IS NOT NULL
    ) AS ready`;
    checks.push(
      check(
        "Acesso inicial",
        access?.ready ? "ok" : "warning",
        access?.ready
          ? "Existe vínculo ativo com identidade Supabase. A conta específica ainda precisa autenticar."
          : "Nenhum vínculo ativo de acesso encontrado. Siga o primeiro administrador no README; o sistema não possui senha padrão.",
      ),
    );
  } catch (error) {
    checks.push(databaseError("Acesso inicial", error));
  }
  return checks;
}
