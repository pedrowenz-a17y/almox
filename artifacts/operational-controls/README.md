# Evidências de controle operacional 2.4

Validação em 06/11/2026. Bases, pessoas e documentos fictícios. Nenhum acesso ao banco empresarial, nenhum envio ao ERP oficial e nenhuma implantação pública.

- `npm-ci.log`, `build.log`, `lint.log`, `typecheck.log`: instalação e verificações da entrega.
- `tests.log`: 157 testes de regras e integração, PostgreSQL isolado.
- `ui-checks.json`, `browser.log`: oito fluxos de interface, componentes reais e API fictícia, incluindo celular e contagem fora do resumo de 500 registros.
- `csv-race-ui.json`: dois cenários de leitura concorrente de arquivo.
- `auth-gates.json`: dez verificações de recusa de acesso anônimo/origem externa no servidor de produção local; configuração pública Supabase fictícia, sem login no provedor.
- `upgrade-checks.json`: quatro verificações da migração em uma segunda base fictícia com ordens e contagem anteriores à versão2.4.
- `database-checks.json`: conexão/estrutura2.4 na base descartável. Ausência de vínculo de acesso é esperada nessa base vazia após limpeza dos testes.

As capturas são prévias do aplicativo com dados de teste. Os servidores e a base usados na verificação não fazem parte de uma implantação. O diagnóstico `npm run doctor` precisa ser executado também na máquina/rede do usuário.
