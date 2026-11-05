# Relatório de entrega — Almox ERP · U.C.A. v2.0.0

O projeto recebido foi atualizado no próprio código, preservando a base Next.js/React/TypeScript/Prisma e os módulos úteis. Supabase PostgreSQL é o destino operacional único e Supabase Auth é a autenticação ativa. O código contém fluxos de compras, recebimento, O.S./O.P., reservas, aplicações, consumo, devoluções e isolamento por unidade.

**A implantação e a migração remotas ainda dependem do responsável.** Não foram fornecidos acessos ao Supabase, Neon ou Vercel; não há declaração de sistema em produção, conta administrativa criada, SMTP entregue ou dados empresariais reais migrados. Os testes locais utilizam PostgreSQL e fixtures isoladas, sem habilitar login simulado na aplicação.

## 1. Problemas encontrados na auditoria

A inspeção inicial leu os 91 arquivos do ZIP e confirmou correspondência integral com a fonte antes das alterações. A origem está registrada em [AUDIT_2026-10.md](AUDIT_2026-10.md), com SHA-256 do arquivo recebido.

O projeto já tinha transações, saldos por localização, inventários, QR, impressão, relatórios e PWA. As principais lacunas eram autenticação própria sem recuperação, escopo global dos dados, ausência de compras/ordens/reservas/aplicações, seed demonstrativo ativo por padrão e verificadores antigos com pressupostos de sessão e escrita inadequados à nova arquitetura. O erro de login por origem era compatível com divergência entre domínio aberto e `APP_URL`; não justificava trocar senhas aleatoriamente. Não foi encontrada configuração específica de Neon no pacote, e o estado do banco remoto não pôde ser inferido.

## 2. Arquivos criados, alterados e removidos

O inventário de fontes comparadas ao ZIP está no fim deste documento. As principais áreas alteradas são:

- Schema/migration/seed e ferramentas de snapshot, comparação e classificação de dados.
- Autenticação Supabase, rotas de recuperação/confirmar convite, sessão e acesso por unidade.
- Serviços/APIs existentes escopados e novos serviços de compras/ordens.
- Interface de unidade, quantidades, compras/ordens, login U.C.A. e PWA.
- Testes de domínio, catálogo, banco, identidade e segurança dos verificadores.
- Configuração de ambiente, Vercel, Compose e documentação.

Artefatos da revisão antiga não são evidência da nova autenticação/fluxos; o registro histórico foi separado em `VALIDATION-LEGACY.md`. Não há exclusão intencional de dados empresariais nem reset de banco na atualização.

## 3. Funcionalidades preservadas e corrigidas

Preservados: CRUD de produtos/categorias/fornecedores/almoxarifados/locais, saldo por localização, entrada/saída/transferência, inventário aprovado, QR integrado, leitor/manual, etiquetas, auditoria, relatórios/exportações e PWA. Passaram a respeitar unidade, identidade e permissões atuais. Custos e credenciais são filtrados no servidor; falhas de consulta não devem aparecer como estoque vazio.

Foram acrescentados módulos operacionais de compras e O.S./O.P. com APIs/serviços reais. A interface continua dependendo de autenticação válida, não de dados simulados ou bypass para demonstração.

## 4. Alterações no banco

Novas organizações/unidades/vínculos, ordens/materiais/eventos, pedidos/recebimentos e relações rastreáveis com movimentações. O saldo permanece por produto/localização. FKs compostas e triggers impedem cruzamento/mudança indevida de escopo; constraints e unicidade de consumo complementam validação do servidor. Quantidades e valores são decimais.

A migration preserva IDs e valores legados. Adiciona `unitId` sem atribuir empresas por suposição e `authUserId` sem substituir `User.id`. Registros não classificados ficam em quarentena. Sessões/hashes antigos ficam inativos para autenticação. O bootstrap não cria dados operacionais. A migration adicional de custo opcional retira a obrigatoriedade/padrão zero do custo do produto, preservando todos os valores históricos; custo desconhecido passa a ser representado por nulo.

## 5. Estratégia Neon/PostgreSQL → Supabase

O guia [MIGRATION-SUPABASE.md](MIGRATION-SUPABASE.md) contém inventário, backup, restauração isolada, snapshots comparáveis, migrations, associação de contas, classificação aprovada por unidade e corte sem dois bancos ativos.

`scripts/migration-snapshot.mjs` é somente leitura; `migration-compare.mjs` recusa diferenças; `migration-map-units.mjs` usa plano explícito, dry-run padrão, confirmação administrativa e auditoria transacional. Não usa reset ou exclusão para conciliar totais. O banco anterior deve ser preservado até validação e autorização do responsável.

A validação local de preservação usa fixture isolada e não substitui o inventário/migração dos dados empresariais remotos desconhecidos.

## 6. Autenticação Supabase Auth

Implementados login/logout, cookies de servidor, validação de identidade, rotas privadas, recuperação, confirmação de convite e mensagens de erro próprias. Não há cadastro público que conceda administração nem autenticação local paralela.

O primeiro administrador é provisionado por `npm run admin:provision`, a partir de identidade real confirmada, UUID, e-mail e unidades autorizadas. O procedimento é idempotente e preserva vínculos existentes. **Não existe login/senha padrão na versão nova.** Login remoto, expiração, recuperação por e-mail e cookies de produção continuam sujeitos à homologação do projeto real.

## 7. Permissões e RLS

Permissões são lidas de `UnitMembership` na unidade selecionada e validadas no servidor. Consultas, mutações, arquivos, QR e relatórios usam esse escopo. Não basta alterar um identificador no formulário.

A migration habilita RLS nas tabelas ERP e revoga acesso de `PUBLIC`, `anon` e `authenticated`, sem policies amplas. Dados operacionais passam pela API Next.js com Prisma e credencial protegida de servidor. Testes locais verificam constraints/RLS/grants; é necessário confirmar Data API e privilégios efetivos no projeto Supabase real.

## 8. Estoque, O.S. e O.P.

Fórmulas implementadas: registrado `Q`; reservado `R`; aplicado não faturado `A`; físico na localização `Q − A`; disponível `Q − R − A`.

Compra recebida gera entrada e documento na mesma transação. Requisitar/reservar/aplicar são eventos distintos do consumo. Aplicar transfere reserva para aplicação; faturar baixa `Q` e `A` juntos uma vez. **Regra confirmada: bloquear faturamento enquanto qualquer material requisitado estiver pendente.** O faturamento é manual autorizado, com referência real, sem integração fiscal inventada.

Devolução pré-faturamento libera aplicação; pós-faturamento gera entrada ligada à saída, limitada ao consumido. Cancelamento não abandona aplicações pendentes. Inventário compara físico e ajusta com aprovação, preservando compromissos e recusando contagem obsoleta. Transações serializáveis, idempotência e constraints protegem concorrência/duplicidade; disponível negativo é bloqueado.

## 9. Remoção de dados fictícios

O seed atual cria somente nomes institucionais confirmados, unidades, perfis/permissões/configurações. Não cria usuário, fornecedor, material, nota, ordem, quantidade ou custo fictício; `SEED_DEMO=true` é rejeitado. Testes mantêm suas próprias fixtures em bases isoladas.

Dados já existentes em banco anterior **não foram apagados por suposição**. O responsável precisa identificar demonstrações versus registros empresariais durante a migração. Não há prova de remoção de dados de uma base remota sem acesso a ela.

## 10. Identidade visual e login

Logo e fotografia reais U.C.A. foram obtidas das referências institucionais autorizadas e incluídas localmente. As fontes estão em [BRAND_ASSETS.md](BRAND_ASSETS.md). Não foi criada uma falsa logo oficial ou afirmada uma paleta institucional certificada.

Login dividido em desktop, adaptado ao celular, com parallax discreto na área visual, sem mover o formulário. Motion reduzido/touch possuem tratamento. As verificações de browser/imagens efetivamente executadas constam em `VALIDATION.md`; apreciação visual local não substitui ergonomia em operação real.

## 11. PWA

Manifesto, ícones, nome/cores e cache foram atualizados. Mantém modo standalone e recursos públicos/fallback offline. Não armazena respostas autenticadas nem confirma movimentações offline. Instalação e câmera dependem de HTTPS, navegador e aparelho; não há promessa de instalação universal ou distribuição como APK.

## 12. Testes e evidências

[VALIDATION.md](VALIDATION.md) é o registro atualizado de comandos, resultados reais, evidências e testes não executados. Cobre migrações limpas, integração PostgreSQL, concorrência, escopo, permissões, seed idempotente, preservação/mapeamento local, TypeScript, lint, build e verificações de navegador conforme efetivamente concluídas.

Não reutilize capturas antigas como prova de novos fluxos. Testes de serviço com usuários internos de fixture não são testes de login Supabase. Configuração/compilação aprovadas não comprovam SMTP, sessão real, RLS remoto, deployment ou câmera física.

## 13. Comandos para executar

Para base nova, após preencher `.env` com valores reais e revisar os destinos:

```bash
npm ci
npm run config:check
npm run db:generate
npm run db:migrate
npm run db:seed
npm run admin:provision
npm run dev
```

`admin:provision` exige identidade confirmada e variáveis descritas no README. Para produção: `npm run build` e `npm start`, ou deployment Vercel. Para base existente, siga o guia de migração antes de executar bootstrap/classificação. Testes exigem `TEST_DATABASE_URL` exclusivo com nome contendo `test`.

## 14. Configuração pelo responsável

No Supabase: projeto/banco, URLs adequadas de execução/migration, credenciais protegidas, Auth/Site URL/redirects/templates, SMTP, contas autorizadas, privilégios/RLS efetivos, backups e regras de infraestrutura.

Na Vercel: repositório, Node.js 22, variáveis separadas por Development/Preview/Production, domínio/`APP_URL`, chave pública correta, segredos exclusivos do servidor e novo deployment após alterações. Migrations acontecem fora do build, de maneira serializada. As variáveis e procedimentos exatos estão no README e `.env.example`.

## 15. Migração e implantação pendentes

Identificar o banco remoto ativo; inventariar registros; fazer/testar backup; classificar unidades e contas; restaurar/migrar/reconciliar; configurar Supabase Auth/SMTP; homologar acessos e fluxos pela interface; validar Data API; implantar Vercel; testar celular/impressora/PWA; aprovar corte e conciliar estoque inicial real.

Nenhuma dessas etapas é declarada concluída por apenas entregar código. O pacote não contém credenciais de produção nem uma conta pública para contornar a configuração.

## 16. Limitações e decisões

| Item | Situação |
| --- | --- |
| Estoque, compras, ordens, inventário, escopo e permissões no servidor | Implementados; cobertura local descrita em `VALIDATION.md`. |
| Supabase Auth e integração PostgreSQL/Vercel | Implementados; autenticação oficial validada em laboratório local. Supabase hospedado e deployment Vercel pendentes. |
| Migração de legado | Ferramentas e procedimento implementados; preservação local testada; dados remotos dependem do responsável. |
| Faturamento com material pendente | Regra confirmada e implementada: bloqueado até atender todos. |
| Dashboard/relatórios | Dados reais de estoque/movimentos/inventário; painel analítico completo de custos/ordens não implementado. |
| Mínimo por localização | Não implementado; mínimo atual é por produto da unidade. |
| Conversão de unidades | Não implementada; exige quantidade na unidade cadastrada e rejeita divergência. |
| Custo automático por ordem | Não implementado; valores reais podem ser registrados nos campos autorizados, sem custo fiscal/contábil presumido. |
| Integração fiscal/financeira, emissão de NF-e | Não implementada; faturamento usa confirmação manual e referência. |
| Devolução de compra ao fornecedor | Sem módulo fiscal específico; não se cancela recebimento para apagar histórico. |
| Transferência entre empresas | Não implementada; transferências existentes são internas à unidade. |
| Organizações/unidades e RBAC | Estrutura/escopo implementados; sem editor visual completo para novas estruturas/políticas. |
| MFA/SSO | Sem fluxo próprio homologado. |
| Catálogo de grande volume | Carregamento inicial completo; paginação/desempenho exigem evolução/teste de carga. |
| QR/PWA/câmera física | Código integrado; dispositivo/HTTPS/impressão/instalação reais dependem de homologação. |

Antes de ampliar, confirme responsáveis por unidade e faturamento, conversões, mínimos locais, regras de custos e transferências entre empresas. Nenhuma dessas decisões foi presumida como autorizada. Não há dados societários/fiscais inventados.

## 17. Projeto final e utilização

A pasta de fonte é `almoxarifado/`, com `package.json`, lockfile, `.env.example`, Prisma, serviços, interface, testes, scripts, assets e documentação. O ZIP de entrega deve conter essa fonte e evidências atuais selecionadas, sem `.env`, `node_modules`, `.next`, dumps ou segredos.

Extraia, leia o README e siga a configuração. Para outra pessoa operar pelo celular, publique a instalação configurada e compartilhe a URL HTTPS; o ZIP é destinado a quem instala/mantém o sistema. Login será o da conta Supabase autorizada, não um usuário padrão embutido. O link/arquivo final e seu checksum são fornecidos junto à entrega.

## Inventário de fontes versus o ZIP recebido

Comparação final de código, configuração, documentação e recursos públicos, excluindo dependências, caches, `.env` e evidências de execução. O manifesto incluído no ZIP contém o hash de cada arquivo entregue.

### Criados (56)

- `.nvmrc`
- `AGENTS.md`
- `LEIA-PRIMEIRO.txt`
- `docs/AUDIT_2026-10.md`
- `docs/BRAND_ASSETS.md`
- `docs/DELIVERY.md`
- `docs/MIGRATION-SUPABASE.md`
- `docs/VALIDATION-LEGACY.md`
- `prisma/migrations/20261026120000_uca_units_orders_supabase/migration.sql`
- `prisma/migrations/20261029190000_optional_product_cost/migration.sql`
- `public/brand/implemento-uca.jpg`
- `public/brand/uca-oficial.png`
- `scripts/check-config.mjs`
- `scripts/migration-compare.mjs`
- `scripts/migration-map-units.mjs`
- `scripts/migration-snapshot.mjs`
- `scripts/provision-admin.ts`
- `scripts/qa-config.mjs`
- `scripts/verify-auth-flows.mjs`
- `scripts/verify-orders-ui.mjs`
- `scripts/verify-public.mjs`
- `src/app/api/auth/recover/route.ts`
- `src/app/api/auth/update-password/route.ts`
- `src/app/api/orders/[id]/actions/route.ts`
- `src/app/api/orders/[id]/route.ts`
- `src/app/api/orders/route.ts`
- `src/app/api/purchases/[id]/cancel/route.ts`
- `src/app/api/purchases/[id]/receive/route.ts`
- `src/app/api/purchases/[id]/route.ts`
- `src/app/api/purchases/route.ts`
- `src/app/api/unit/route.ts`
- `src/app/auth/callback/route.ts`
- `src/app/auth/confirm/route.ts`
- `src/app/esqueci-senha/page.tsx`
- `src/app/recuperar-senha/page.tsx`
- `src/app/uca.css`
- `src/components/auth-shell.tsx`
- `src/components/orders.tsx`
- `src/components/purchases.tsx`
- `src/lib/auth-config.ts`
- `src/lib/auth-rate-limit.ts`
- `src/lib/brand.ts`
- `src/lib/supabase/admin.ts`
- `src/lib/supabase/server.ts`
- `src/proxy.ts`
- `src/services/orders.ts`
- `src/services/purchases.ts`
- `src/services/user-access.ts`
- `tests/auth-config.test.ts`
- `tests/catalog.integration.test.ts`
- `tests/database-security.integration.test.ts`
- `tests/domain.integration.test.ts`
- `tests/qa-safety.test.ts`
- `tests/user-access.integration.test.ts`
- `tests/validation-limits.test.ts`
- `vercel.json`

### Alterados (49)

- `.env.example`
- `README.md`
- `compose.yml`
- `docs/ARCHITECTURE.md`
- `docs/OPERATIONS.md`
- `docs/VALIDATION.md`
- `package-lock.json`
- `package.json`
- `prisma/schema.prisma`
- `prisma/seed.ts`
- `public/icon-192.png`
- `public/icon-512.png`
- `public/icon.svg`
- `public/manifest.webmanifest`
- `public/offline.html`
- `public/sw.js`
- `scripts/local-db.mjs`
- `scripts/verify-api.mjs`
- `scripts/verify-browser.mjs`
- `scripts/verify-operations.mjs`
- `scripts/verify-reports.mjs`
- `src/app/[[...slug]]/page.tsx`
- `src/app/api/auth/login/route.ts`
- `src/app/api/auth/logout/route.ts`
- `src/app/api/data/route.ts`
- `src/app/api/files/[id]/route.ts`
- `src/app/api/qr/[id]/route.ts`
- `src/app/api/reports/route.ts`
- `src/app/api/resolve/route.ts`
- `src/app/api/search/route.ts`
- `src/app/api/settings/route.ts`
- `src/app/api/upload/route.ts`
- `src/app/layout.tsx`
- `src/app/login/page.tsx`
- `src/components/catalog-form.tsx`
- `src/components/dashboard.tsx`
- `src/components/erp.tsx`
- `src/components/inventory-form.tsx`
- `src/components/movement-form.tsx`
- `src/components/pwa.tsx`
- `src/components/scanner.tsx`
- `src/lib/auth.ts`
- `src/lib/client.ts`
- `src/lib/http.ts`
- `src/services/catalog.ts`
- `src/services/inventory.ts`
- `src/services/stock.ts`
- `tests/security.test.ts`
- `tests/stock.integration.test.ts`

### Removidos (0)

Nenhum arquivo neste grupo.

