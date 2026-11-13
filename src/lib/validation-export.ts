import {
  VALIDATION_STEPS,
  VALIDATION_ORIGINS,
  VALIDATION_STATUS,
} from "@/lib/validation-plan";
import type { getValidationRun } from "@/services/validation-report";
type Run = Awaited<ReturnType<typeof getValidationRun>>;
const html = (value: unknown) =>
  String(value ?? "—")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
const when = (value: string | null) =>
  value
    ? new Date(value).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })
    : "Não registrado";
/** Standalone, script-free report. User content is always escaped, including title and evidence. */
export function validationHtml(run: Run) {
  const data = run.snapshot;
  const steps = VALIDATION_STEPS.map((step) => {
    const saved = run.steps.find((s) => s.id === step.id);
    return `<section><h2>${html(step.title)}</h2><p><b>Responsabilidade prevista:</b> ${html(step.role)}</p><p>${html(step.check)}</p><p><b>Resultado relatado:</b> ${saved?.outcome === "PASS" ? "Passou" : saved ? "Falhou" : "Não registrado"}</p><p class="prose">${html(saved?.note)}</p><p><b>Referência:</b> ${html(saved?.reference)}</p><p class="subtle">${html(saved?.recordedByName)} · ${html(saved ? when(saved.recordedAt) : "Não registrado")}</p></section>`;
  }).join("");
  return `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${html(run.title)} · Almox ERP</title><style>body{font:15px/1.6 system-ui,sans-serif;color:#242630;max-width:900px;margin:40px auto;padding:0 22px}header{border-bottom:3px solid #e9123d;padding-bottom:20px}h1{font-size:28px;line-height:1.2}h2{font-size:18px}section{border-top:1px solid #ddd;padding:16px 0;break-inside:avoid}table{border-collapse:collapse;width:100%;margin:16px 0}th,td{text-align:left;border-bottom:1px solid #ddd;padding:10px}.subtle,small{color:#555b68}.prose{white-space:pre-wrap;overflow-wrap:anywhere}footer{border-top:2px solid #ddd;padding-top:20px;margin-top:20px}@media print{body{margin:0;max-width:none;font-size:11pt}header{break-after:avoid}}</style><header><small>Almox ERP · U.C.A. / Grupo Capacle</small><h1>Relatório de validação de materiais</h1><h2>${html(run.title)}</h2><p><b>Unidade:</b> ${html(data.unit.name)} (${html(data.unit.code)})<br><b>Origem declarada:</b> ${html(VALIDATION_ORIGINS[run.origin])}<br><b>Situação:</b> ${html(VALIDATION_STATUS[run.status])}</p><p class="prose"><b>Objetivo:</b> ${html(run.objective)}</p><p>Aberto por ${html(run.createdByName)} em ${html(when(run.createdAt))}.<br>Encerrado por ${html(run.closedByName)} em ${html(when(run.closedAt))}.</p></header><section><h2>Indicadores preservados na abertura</h2><p>Período: ${html(data.period.from)} a ${html(data.period.to)} · UTC−03. Consulta: ${html(when(data.generatedAt))}.</p><table><thead><tr><th>Indicador</th><th>Registros</th><th>Base</th></tr></thead><tbody><tr><td>Baixas vinculadas a ordens</td><td>${data.current.linked}</td><td>${data.current.exits} saídas contábeis</td></tr><tr><td>Entregas documentadas</td><td>${data.current.handoffs}</td><td>${data.current.deliveries} aplicações</td></tr><tr><td>Itens contados com diferença</td><td>${data.current.divergent}</td><td>${data.current.counted} itens aprovados</td></tr></tbody></table><p>Pendências na consulta de abertura, em linhas de materiais: aplicação ${data.pending.unapplied}; faturamento ${data.pending.awaitingInvoice}; devolução ${data.pending.returns}.</p>${data.definitions.map((definition) => `<p class="subtle">${html(definition)}</p>`).join("")}</section>${steps}<section><h2>Conclusão relatada</h2><p class="prose">${html(run.conclusion ?? "Validação em andamento. Ainda não há conclusão registrada.")}</p></section><footer><p>Resultados, referências e origem declarados pelas pessoas. Os documentos externos não são autenticados automaticamente. Este relatório não certifica a empresa nem comprova ganho causal sem uma coleta comparável.</p><small>Documento ${html(run.id)} · revisão ${run.version} · abertura ${html(when(run.createdAt))}. As atualizações posteriores do estoque não alteram o retrato preservado.</small><p class="subtle">Para gerar um PDF, abra este arquivo no navegador e use Imprimir → Salvar como PDF.</p></footer></html>`;
}
