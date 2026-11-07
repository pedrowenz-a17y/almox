# Evidências — assistente local 2.5.0

Validação com dados fictícios e PostgreSQL isolado. Nenhuma credencial empresarial ou chave enviada pelo usuário foi utilizada. Nenhuma chamada a provedor externo de IA foi realizada nesta verificação.

- `build.log`, `lint.log`, `typecheck.log`: compilação de produção e verificações do código.
- `focused-tests.log`: 49 testes aprovados de linguagem, seleção de modo, privacidade e consultas reais do assistente em banco descartável.
- `tests.log`: regressão completa do ERP, com 213 testes aprovados e nenhum ignorado.
- `ui-checks.json`, `browser.log`: nove cenários de interface com componentes e motor local reais e banco de teste. Autenticação HTTP da prévia simulada; não comprova login no Supabase real.
- `conversa-saldo-desktop.png`, `conversa-continuacao.png`, `assistente-local-mobile.png`: capturas da conversa com catálogo fictício.
- `auth-gates.json`: sete verificações aprovadas de acesso anônimo e origem no build de produção, usando apenas configuração pública fictícia. Não comprova login no Supabase real.

O assistente usa regras e consultas determinísticas. Não houve treinamento ou execução de modelo generativo local. Os testes verificam linguagem do domínio e cálculos, não compreensão geral de qualquer assunto.
