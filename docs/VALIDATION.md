# Validação da versão U.C.A. / Supabase

Este registro cobre a revisão atual do projeto fornecido. Os resultados da autenticação própria e da demonstração anterior estão preservados em [VALIDATION-LEGACY.md](VALIDATION-LEGACY.md); eles **não comprovam** o funcionamento da autenticação Supabase, das unidades ou dos novos fluxos de compras e ordens.

## Resultados e alcance

| Verificação | Estado | Alcance da evidência |
| --- | --- | --- |
| Origem HTTP, ocultação de custos/credenciais e segurança dos verificadores | Aprovado: 7 testes locais | [uca-unit-checks.json](../artifacts/uca-unit-checks.json). Estes casos também integram a suíte de 79 testes; não devem ser somados novamente. Não houve chamada a serviço externo nesta execução isolada. |
| Sintaxe dos quatro verificadores HTTP/navegador | Aprovado | `node --check` registrado no mesmo arquivo. |
| Migrações em base nova | Aprovado | Cinco migrations atuais aplicadas em banco exclusivo. Roles locais `anon`/`authenticated` receberam grants antes da aplicação, permitindo verificar a revogação; isso não equivale a testar um projeto Supabase remoto. |
| Regras de negócio, isolamento e permissões no PostgreSQL | 79/79 aprovados, sem skip | Execução final em base exclusiva, com Zod atualizado e custo desconhecido nullable. Nenhuma falha ou teste ignorado. |
| Seed e repetição | Aprovado | Duas execuções: 2 organizações, 2 unidades, 3 perfis, 16 permissões, 34 vínculos de permissão e 2 configurações; nenhum usuário ou registro operacional inventado. [uca-seed-checks.json](../artifacts/uca-seed-checks.json). |
| Preservação e classificação do legado | 17/17 aprovados em fixture local | IDs, saldo 85, versão, movimentos, auditorias e custos existentes preservados; quarentena; dry-run; recusa de classificação cruzada; reaplicação idempotente; custo desconhecido nullable e checksums SQL. [uca-migration-preservation.json](../artifacts/uca-migration-preservation.json). Não valida dados remotos desconhecidos. |
| TypeScript e lint | Aprovados | Verificação de tipos e ESLint sem erros após os ajustes finais. |
| Build final | Aprovado | Build Next.js standalone concluído; execução de produção usada nos testes HTTP autenticados. |
| Dependências de produção | Nenhuma vulnerabilidade informada pelo npm audit | [uca-dependency-audit.json](../artifacts/uca-dependency-audit.json). É um resultado do catálogo de advisories consultado, não um pentest. |
| Login público, responsividade e PWA | 11/11 aprovados | Chromium em 1440, 768, 390 e 320 px; ativos oficiais, movimento reduzido, recursos PWA, proteção de páginas e navegação offline. [uca-public-browser.json](../artifacts/uca-public-browser.json). |
| Supabase Auth oficial em ambiente local isolado | Aprovado | GoTrue v2.185.0 com PostgreSQL exclusivo; 3 identidades reais confirmadas; provisionamento administrativo executado duas vezes sem duplicar acessos. Sem simulação de sessão no código da aplicação. [uca-auth-local-setup.json](../artifacts/uca-auth-local-setup.json). |
| API autenticada no build de produção local | 26/26 aprovados | Execução final: login, cookies, RBAC, CRUD, QR, cenário 60 + 25 = 85, inventário, concorrência, limite de tentativas e logout contra GoTrue real local; limpeza concluída. [uca-api-checks.json](../artifacts/uca-api-checks.json). |
| Navegador autenticado, QR e operação mobile | 22 verificações aprovadas | Login real pela interface; 15 rotas, incluindo compras/O.S./O.P.; QR gerado no servidor e decodificado por câmera simulada; 4 rotas em 390 × 844 px; aviso offline e nenhum erro no console. [uca-browser-checks.json](../artifacts/uca-browser-checks.json). Não equivale à câmera física. |
| Fluxo de estoque e inventário pela interface | 8/8 aprovados | Cadastro do material e hierarquia; entrada de 100; saída de 15; transferência com dois códigos, resultando em 60 + 25 = 85; histórico/auditoria; contagem e aprovação. [uca-operations-checks.json](../artifacts/uca-operations-checks.json). O fluxo de dois códigos usou entrada manual; a câmera simulada foi verificada no roteiro de navegador. |
| Autenticação, autorização e recuperação locais | 13/13 aprovados | Identidade sem perfil, associação ausente/desativada, cookie de unidade forjado, senha incorreta, conta desativada, callback com token real, redefinição, recusa da senha anterior, recusa de reutilização do token e logout. [uca-auth-flows.json](../artifacts/uca-auth-flows.json). Tokens de recuperação foram gerados administrativamente; entrega por SMTP não foi testada. |
| Relatórios e etiquetas | 15/15 aprovados após correção de regressão | JSON/CSV/XLSX dos 11 relatórios, filtros/datas e impressão 50×30 mm/A4. A revisão corrigiu itens de inventário sem `unitId`; o teste final confere os itens contra a API, incluindo 4 linhas de inventário e 3 divergências. [uca-reports-labels-checks.json](../artifacts/uca-reports-labels-checks.json). Impressão validada em PDF/Chromium, sem impressora física. |
| Compras, recebimentos, O.S. e O.P. pela interface | 12 verificações aprovadas | Compra e recebimentos de 60 + 40; custo informado e desconhecido; requisição/reserva/aplicação; bloqueio de faturamento incompleto; devolução antes e depois da baixa; O.S. baixando 10, devolução 2 e O.P. consumindo 5, com saldo final 87; cancelamento, auditoria e mobile sem erros JavaScript. [uca-orders-ui-checks.json](../artifacts/uca-orders-ui-checks.json). |
| Autenticação no Supabase hospedado, recuperação por e-mail, expiração e cookies HTTPS de produção | Não executado | Projeto Supabase e contas de homologação externos não foram disponibilizados. A autenticação real local não substitui a validação da implantação remota. |
| Migração de banco remoto existente e reconciliação de saldos reais | Não executado | Não foi possível inventariar Neon/Supabase remotos. Nenhum dado remoto foi alterado. Seguir [MIGRATION-SUPABASE.md](MIGRATION-SUPABASE.md). |
| Vercel, domínio, SMTP e instalação PWA em produção | Não executado | Nenhum deployment ou conexão remota é declarado validado. |
| Câmera física, etiquetas e operação real em Android/iOS | Não executado nesta revisão | As evidências anteriores de Chromium/câmera simulada são históricas. Exige homologação atual por HTTPS. |

Os logs finais de testes, lint e build estão vinculados em [uca-release-checks.json](../artifacts/uca-release-checks.json).

As suítes de integração usam PostgreSQL real, com fixtures exclusivas e nomes de banco contendo `test`. Não usam o banco da demonstração original. As identidades das fixtures de serviços são registros internos e **não constituem uma simulação de login habilitada na aplicação**. Separadamente, o roteiro HTTP usa três identidades reais de um contêiner oficial GoTrue local e associações internas provisionadas. O servidor de produção continua exigindo uma identidade Supabase validada e associação ativa à unidade.

## Cobertura automatizada disponível

- [stock.integration.test.ts](../tests/stock.integration.test.ts): entrada 100, saída 15 e transferência 25 resultam em 60 + 25 = 85; precisão decimal; saldo exclusivo por local; bloqueio de negativo; atomicidade; concorrência; idempotência; unidade incorreta; legado não classificado; inventário pendente, aprovação autorizada e snapshots obsoletos.
- [domain.integration.test.ts](../tests/domain.integration.test.ts): recebimento parcial/total e documento informado; reservas concorrentes; requisição, aplicação e faturamento; baixa única; devoluções compensatórias; cancelamentos; disponibilidade; inventário físico com aplicações; permissões; isolamento; unidades de medida incompatíveis; custos e rollback integral.
- [catalog.integration.test.ts](../tests/catalog.integration.test.ts): consulta/edição/arquivamento entre unidades; referências de categoria, fornecedor, imagem, almoxarifado e pai; unicidade por unidade; unidade de medida preservada após uso; bloqueio de arquivamento com compromissos.
- [user-access.integration.test.ts](../tests/user-access.integration.test.ts): administração limitada à associação na unidade; identidade global preservada; proteção do próprio/último administrador; revogação de permissão; concorrência; recusa de senha e identidade enviadas na edição.
- [database-security.integration.test.ts](../tests/database-security.integration.test.ts): RLS habilitada nas tabelas do Prisma; ausência de políticas amplas da Data API; FKs e triggers de unidade; unicidade da baixa por material/ordem; ausência de grants diretos a `anon` e `authenticated`, quando essas roles existem no banco testado. Roles criadas como fixtures locais não validam a configuração do projeto Supabase remoto.
- [auth-config.test.ts](../tests/auth-config.test.ts): origens explícitas; deployment Vercel atual; recusa de configurações inseguras e chaves administrativas na variável pública; redirecionamento interno; classificação de indisponibilidade do provedor.
- [security.test.ts](../tests/security.test.ts) e [qa-safety.test.ts](../tests/qa-safety.test.ts): recusa de origem ausente/externa; ocultação de credenciais e campos financeiros; destino de homologação explícito; bloqueio de gravações não autorizadas; processamento dos cookies Supabase fragmentados.
- [validation-limits.test.ts](../tests/validation-limits.test.ts): coleções excessivas de inventário, compra e recebimento são recusadas antes de expandir a validação de cada item; entradas inválidas continuam recebendo erros de validação.

## Reprodução local segura

Instale as dependências com `npm ci` e use Node.js 22 ou superior. Crie uma base PostgreSQL **exclusiva**, cujo nome contenha `test`. Configure `TEST_DATABASE_URL` para essa base. Antes de aplicar as migrations, configure `DATABASE_URL` e `DIRECT_URL` para a mesma base de testes; confira os três destinos sem imprimir senhas. Não reutilize a base empresarial nem execute reset.

```bash
npm run db:generate
npm run db:migrate
npm test
npm run typecheck
npm run lint
npm run build
```

`npm test` executa os arquivos sequencialmente. As suítes limpam somente os registros das próprias fixtures. O teste de RLS ignora apenas a verificação de grants quando o PostgreSQL local não possui as roles do Supabase; um skip deve ser informado, nunca contado como aprovação.

## Homologação autenticada com Supabase

Os quatro scripts existentes foram adaptados à sessão oficial Supabase e à unidade selecionada. Eles não aceitam credenciais antigas de seed, não criam contas automaticamente e não usam `APP_URL` como destino implícito.

Prepare uma instalação isolada com banco, projeto Supabase e contas de teste próprios. Provisione as identidades e as associações de administrador, supervisor e operador conforme o [README](../README.md). Configure, sem salvar valores secretos no repositório:

| Variável | Uso |
| --- | --- |
| `QA_ENVIRONMENT=isolated` | Confirma que a instalação é dedicada à homologação. Obrigatória. |
| `QA_BASE_URL` | Origem explícita da instalação. Sem caminho, credenciais ou parâmetros. |
| `QA_ALLOWED_REMOTE_ORIGIN` | Para destino remoto, deve ser exatamente a origem HTTPS autorizada. Não permite wildcard. Não é necessária em localhost. |
| `QA_UNIT_ID` | UUID da unidade de teste à qual as contas têm acesso. Todos os scripts selecionam e conferem a unidade. |
| `QA_LOCATION_ID` | Local de teste existente; necessário nos roteiros de navegador e operações. |
| `QA_ADMIN_EMAIL`, `QA_ADMIN_PASSWORD` | Conta Supabase real de administrador de homologação. |
| `QA_OPERATOR_EMAIL`, `QA_OPERATOR_PASSWORD` | Conta real de operador, distinta das demais; necessária em `verify:api`. |
| `QA_SUPERVISOR_EMAIL`, `QA_SUPERVISOR_PASSWORD` | Conta real de supervisor, distinta das demais; necessária em `verify:api`. |
| `ALLOW_QA_WRITES=1` | Obrigatória para `verify:api`, `verify:operations`, `verify:orders` e `verify:auth`, que gravam fixtures no ambiente isolado. |

```bash
npm start
# Em outro terminal com as variáveis de homologação já configuradas:
ALLOW_QA_WRITES=1 npm run verify:api
npm run verify:browser
npm run verify:reports
ALLOW_QA_WRITES=1 npm run verify:operations
ALLOW_QA_WRITES=1 npm run verify:orders
npm run verify:public
```

O roteiro de navegador requer Playwright/Chromium e FFmpeg para a câmera simulada. Os relatórios/etiquetas exigem pelo menos três localizações preparadas na unidade de teste. Os registros criados pelos roteiros de operações preservam movimentos e auditoria; não representam dados empresariais reais e não devem ser criados em produção. Resultados atuais, quando executados, usam os nomes `uca-api-checks.json`, `uca-browser-checks.json`, `uca-reports-labels-checks.json` e `uca-operations-checks.json` em `artifacts/`.

`verify:orders` exercita os novos formulários de compras/O.S./O.P. com fixtures próprias e a conta administrativa de QA. `verify:public` verifica login, recursos públicos e PWA sem autenticar. O roteiro avançado `ALLOW_QA_WRITES=1 npm run verify:auth` é restrito ao laboratório local: aplicação em localhost:3001, PostgreSQL de testes em localhost:55439, GoTrue local e `SUPABASE_SERVICE_ROLE_KEY` exclusivamente local. Ele cria e remove somente sua identidade de teste, verifica vínculos no banco e usa tokens reais gerados pelo provedor; não testa envio de e-mail. Não deve ser apontado para o projeto Supabase empresarial.

Após executar os verificadores, validar no Supabase hospedado: convite e primeiro acesso; recuperação por e-mail e troca de senha; senha incorreta/usuário inexistente; conta e associação desativadas; refresh/expiração; logout; troca de unidade e tentativa de acesso cruzado; Data API sem privilégios; ausência de chaves administrativas no bundle. Conferir a origem final e as URLs permitidas de redirecionamento após o deployment na Vercel.

## Limites de validação e decisões operacionais

Não foram realizados teste de carga com volume empresarial, pentest externo, restauração de backup real ou migração de dados remotos. Nenhuma evidência de login, câmera ou impressão da versão anterior foi reutilizada como aprovação da revisão atual.

A aplicação mantém o estoque mínimo por produto/unidade; não há mínimo independente por localização. Conversões entre unidades de medida não estão configuradas: o backend recusa divergências, em vez de converter silenciosamente. Faturamento é uma confirmação manual autorizada e auditável, sem emissão fiscal ou integração externa. A valoração de consumo por ordem não é calculada automaticamente; os custos documentais informados são preservados conforme a permissão de acesso.

A homologação final no almoxarifado deve conferir leitura e impressão de etiquetas reais, uso com uma mão, conexão instável e instalação PWA nos aparelhos utilizados. O service worker não armazena respostas da API nem páginas autenticadas; operações críticas dependem de confirmação do servidor. Nenhum fluxo offline de movimentação é implementado.
