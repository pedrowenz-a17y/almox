/** These views share one authenticated workspace and do not need a new RSC render. */
const views = new Set([
  "/",
  "/dashboard",
  "/pendencias",
  "/alertas",
  "/conferencias",
  "/conciliacao",
  "/produtos",
  "/estoque",
  "/localizacoes",
  "/movimentacoes",
  "/qrcodes",
  "/fornecedores",
  "/inventario",
  "/ordens-servico",
  "/ordens-producao",
  "/compras",
  "/relatorios",
  "/usuarios",
  "/auditoria",
  "/configuracoes",
  "/operacao",
  "/imprimir-etiquetas",
  "/reposicao",
  "/consulta",
]);

export function isWorkspacePath(path: string) {
  return (
    views.has(path) || /^\/(?:localizacao|produto)\/[0-9a-f-]{36}$/i.test(path)
  );
}

export function navigateWorkspace(path: string, replace = false) {
  const target = new URL(path, window.location.origin);
  if (
    target.origin !== window.location.origin ||
    !isWorkspacePath(target.pathname)
  ) {
    throw new Error("Destino fora do espaço de trabalho.");
  }
  window.history[replace ? "replaceState" : "pushState"](null, "", target.href);
  window.scrollTo({ top: 0, behavior: "instant" });
}
