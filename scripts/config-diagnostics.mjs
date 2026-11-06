/** Read-only configuration checks. Messages never include supplied values or provider errors. */
const result = (name, status, message) => ({ name, status, message });
function origin(value, production = false) {
  try {
    const url = new URL(value || "");
    return (
      ["http:", "https:"].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      ["", "/"].includes(url.pathname) &&
      !url.hostname.includes("*") &&
      (!production || url.protocol === "https:")
    );
  } catch {
    return false;
  }
}
function keyRole(value) {
  if (value.startsWith("sb_secret_")) return "secret";
  if (value.startsWith("sb_publishable_")) return "public";
  const parts = value.split(".");
  if (parts.length !== 3) return "unknown";
  try {
    return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"))
      .role === "anon"
      ? "public"
      : "secret";
  } catch {
    return "unknown";
  }
}
export function inspectConfiguration(env, { production = false } = {}) {
  const checks = [];
  for (const name of ["DATABASE_URL", "DIRECT_URL"]) {
    let valid = false;
    try {
      const url = new URL(env[name] || "");
      valid =
        ["postgres:", "postgresql:"].includes(url.protocol) &&
        !!url.hostname &&
        url.pathname.length > 1;
    } catch {
      /* The next message is deliberately independent of the supplied URL. */
    }
    checks.push(
      result(
        name,
        valid ? "ok" : "error",
        valid
          ? "Formato PostgreSQL reconhecido; a conexão ainda precisa ser testada."
          : "Preencha no .env com a conexão copiada de Connect no Supabase. A senha é a do banco de dados.",
      ),
    );
  }
  for (const name of ["APP_URL", "NEXT_PUBLIC_SUPABASE_URL"]) {
    const valid = origin(env[name], production);
    checks.push(
      result(
        name,
        valid ? "ok" : "error",
        valid
          ? "Formato de origem reconhecido."
          : name === "APP_URL"
            ? "No desenvolvimento local, use http://localhost:3000 (ou a porta escolhida), sem caminho /login. Em produção, use HTTPS."
            : "Preencha com a Project URL do Supabase, sem caminho /auth ou credenciais.",
      ),
    );
  }
  const extras = (env.APP_ALLOWED_ORIGINS || "")
    .split(",")
    .filter((value) => value.trim());
  if (extras.some((value) => !origin(value.trim(), production)))
    checks.push(
      result(
        "APP_ALLOWED_ORIGINS",
        "error",
        "Use origens completas separadas por vírgula, sem caminhos nem curingas.",
      ),
    );
  const publicKey = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "";
  const role = keyRole(publicKey);
  checks.push(
    result(
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
      role === "public" ? "ok" : "error",
      role === "public"
        ? "Formato de chave pública reconhecido; a validade será consultada no serviço de autenticação."
        : role === "secret"
          ? "Esta variável contém uma chave administrativa. Substitua pela Publishable/anon e faça a rotação da chave exposta no Supabase."
          : "Copie a chave Publishable (ou anon legada) do mesmo projeto Supabase.",
    ),
  );
  checks.push(
    result(
      "SUPABASE_SERVICE_ROLE_KEY",
      env.SUPABASE_SERVICE_ROLE_KEY ? "ok" : "warning",
      env.SUPABASE_SERVICE_ROLE_KEY
        ? "Chave administrativa presente somente no processo do servidor; seu valor não será exibido."
        : "Opcional para login comum. Necessária no servidor para provisionar o administrador e enviar convites.",
    ),
  );
  return checks;
}

export function databaseFailure(code) {
  const messages = {
    P1000:
      "O banco recusou usuário/senha. Confira a senha do banco no Supabase; ela não é a senha de login do ERP. Codifique caracteres reservados na URL.",
    P1001:
      "O servidor do banco não foi alcançado. Confira projeto ativo, rede e host. Em rede sem IPv6, use a conexão Session pooler fornecida pelo Supabase.",
    P1002:
      "A conexão com o banco excedeu o tempo de espera. Confira a rede e o estado do projeto Supabase.",
    P1003:
      "O banco informado não existe neste servidor. Copie a conexão completa de Connect no Supabase, sem alterar o nome da base manualmente.",
    P1010:
      "O usuário do banco não possui acesso à base informada. Confira o usuário e as permissões fornecidos pelo administrador.",
    P1011:
      "A conexão TLS com o banco falhou. Confira os parâmetros e certificados indicados pelo provedor; mantenha a verificação habilitada.",
    P1017:
      "O servidor encerrou a conexão. Confira o estado do projeto, o pooler e os limites de conexões antes de tentar novamente.",
    P2021:
      "As tabelas do ERP não foram encontradas. Revise a instalação/migração desta base antes de aplicar migrations; preserve dados e backups existentes.",
    P2022:
      "A estrutura do banco está diferente da versão do aplicativo: uma coluna necessária não foi encontrada. Revise as migrations e preserve dados e backups existentes.",
    P2024:
      "O tempo de espera por uma conexão do pool foi excedido. Revise os limites e o modo de conexão indicado pelo Supabase; reinicie processos locais que não estão em uso.",
  };
  return (
    messages[code] ||
    "Não foi possível consultar o banco. Confira DATABASE_URL, projeto ativo e acesso de rede. Nenhum dado foi alterado."
  );
}
