# Almox ERP · U.C.A. — versão 2.2.1

**Correção 2.2.1:** versões dos pacotes opcionais `@emnapi/core` e `@emnapi/wasi-threads` fixadas para evitar o conflito de resolução relatado pelo `npm ci`.

**Versão 2.2.0:** abertura que reage ao mouse e ao toque, fotografia 3D, pontos interativos, partículas, letras elásticas e botões magnéticos. [Veja as interações e como atualizar](docs/INTERACOES-2.2.md).

**Revisão 2.1:** vermelho vivo, novas animações, compra assistida pela reposição e diagnóstico local. Consulte [a revisão e o roteiro de evolução](docs/REVISAO-2.1.md).

A revisão anterior de navegação, QR e reposição está registrada em [MELHORIAS-2026-11.md](docs/MELHORIAS-2026-11.md).

ERP de almoxarifado em português para controlar materiais por localização, QR Codes, entradas, saídas, transferências, inventários, compras e materiais de O.S./O.P. A interface consulta dados do PostgreSQL; não injeta demonstrações nem simula operações.

Esta versão utiliza **Supabase PostgreSQL e Supabase Auth**, com Next.js implantável na Vercel ou em servidor Node.js. O pacote contém código-fonte e migrations. Ele não é um instalador de Windows/Android: para compartilhar o ERP em funcionamento, configure os serviços e compartilhe a URL HTTPS da implantação.

**Não existe login ou senha padrão nesta versão.** O administrador precisa de uma identidade autorizada no Supabase Auth e de um vínculo explícito com a unidade do ERP. Credenciais de demonstração de versões anteriores não autenticam aqui. O procedimento de primeiro acesso está abaixo.

## Funcionalidades

- Produtos, categorias, fornecedores, almoxarifados e árvore flexível de localizações.
- Saldo por produto/localização, com quantidades registrada, física, reservada, aplicada e disponível.
- Entradas, retiradas e transferências transacionais, histórico, auditoria e idempotência.
- QR Code de localização, câmera ou código manual, etiquetas e impressão em lote.
- Inventário físico com proposta, aprovação autorizada e rejeição de contagem obsoleta.
- Compras com recebimentos parciais/completos e entradas vinculadas ao documento recebido.
- O.S./O.P. com requisição, reserva, aplicação, consumo no faturamento e devoluções rastreáveis.
- Organizações, unidades operacionais e permissões por vínculo do usuário com cada unidade.
- Relatórios operacionais, CSV, Excel e impressão para PDF.
- Interface responsiva, identidade U.C.A., recuperação de senha pelo Supabase e PWA sem movimentação offline.

O faturamento de uma O.S./O.P. fica **bloqueado até todos os materiais requisitados serem atendidos**, conforme a regra confirmada pelo responsável. A referência é informada por usuário autorizado; não há emissão automática de nota fiscal.

## Tecnologias e estrutura

Next.js 16 App Router, React 19, TypeScript, CSS responsivo, PostgreSQL 16+, Prisma 6, Zod, Supabase Auth com cookies de servidor, `qrcode`, `html5-qrcode` e ExcelJS. As versões exatas estão em `package-lock.json`. Quantidades usam `Decimal(18,3)`; valores monetários, `Decimal(18,2)`. Requer runtime Node.js, não Edge.

```text
prisma/                 schema, migrations e bootstrap institucional
src/app/                páginas, autenticação e API
src/components/         interface, leitor QR e etiquetas
src/lib/                banco, sessão, validações HTTP e tipos
src/services/           catálogo, acesso, estoque, inventário, ordens e compras
scripts/                configuração, provisionamento, migração e verificações
tests/                  testes de integração e regras
public/brand/           logo e fotografia reais da U.C.A.
docs/                   arquitetura, migração, operação e validação
```

Consulte [arquitetura](docs/ARCHITECTURE.md), [migração](docs/MIGRATION-SUPABASE.md), [operações](docs/OPERATIONS.md), [validação executada](docs/VALIDATION.md) e [relatório de entrega](docs/DELIVERY.md). A origem das imagens está em [BRAND_ASSETS.md](docs/BRAND_ASSETS.md).

## Instalação e variáveis

Use Node.js 22 LTS (ou 24 compatível), npm e projeto Supabase. Separe desenvolvimento, homologação e produção.

```bash
npm ci
cp .env.example .env
```

Preencha `.env` com valores reais. Não versione esse arquivo.

| Variável | Finalidade |
| --- | --- |
| `DATABASE_URL` | Conexão Prisma de execução. Copie do painel Connect do Supabase; para serverless, escolha o pooler compatível com Prisma 6. |
| `DIRECT_URL` | Conexão direta ou pooler em modo de sessão para migrations. Não use transaction pooling para tarefas que dependem de sessão. |
| `APP_URL` | Origem exata, sem caminho, como `http://localhost:3000` no desenvolvimento ou a URL HTTPS pública em produção. |
| `APP_ALLOWED_ORIGINS` | Origens adicionais explicitamente autorizadas, separadas por vírgula, sem curingas. |
| `NEXT_PUBLIC_SUPABASE_URL` | URL do projeto Supabase usado pela autenticação. |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Chave publicável do projeto. Nunca coloque chave secreta ou `service_role` aqui. |
| `SUPABASE_SERVICE_ROLE_KEY` | Chave administrativa exclusiva do servidor, necessária para convites/provisionamento. Não é retornada ao navegador. |

URLs de banco exigem codificação dos caracteres reservados de usuário/senha. Utilize TLS conforme o provedor. Não invente host, porta ou parâmetros; siga o painel Connect e a [documentação Prisma/Supabase](https://supabase.com/docs/guides/database/prisma). O guia de migração detalha pooling.

```bash
npm run config:check
npm run db:generate
```

`config:check` verifica formato e separação de chaves; **não comprova conectividade, validade de credenciais ou existência de tabelas**. Para exigir origens HTTPS, use `npm run config:check -- --production`.

## Banco novo e bootstrap

Para base nova, com URLs revisadas:

```bash
npm run db:migrate
npm run db:seed
```

O seed cria somente **U.C.A. Implementos Agrícolas** e **Grupo Capacle**, cada uma com organização e unidade operacional inicial independente, códigos internos `UCA` e `CAPACLE`. Cria perfis, permissões e configurações. Isso não afirma vínculo societário, CNPJ, endereço ou estrutura de filiais.

Não cria usuários, materiais, fornecedores, estoque, documentos ou ordens. `SEED_DEMO=true` é recusado. O bootstrap é idempotente e preserva perfis existentes. Para acrescentar conscientemente novas permissões aos perfis padrão de uma base anterior, revise `prisma/seed.ts` e execute uma vez com `BOOTSTRAP_EXTEND_ROLE_PERMISSIONS=true`.

**Se já existem dados, siga primeiro [MIGRATION-SUPABASE.md](docs/MIGRATION-SUPABASE.md).** Não execute reset, não recrie o banco e não substitua migrations por `db push`. O procedimento inclui backup/restauração testados, snapshots comparáveis e classificação explícita do legado por unidade. Registros sem classificação ficam preservados fora das consultas operacionais até a reconciliação aprovada.

## Primeiro administrador e login

1. Crie ou identifique no Supabase Auth a conta real autorizada a administrar o ERP; confirme a titularidade do e-mail.
2. Copie o UUID dessa identidade e configure, apenas no ambiente administrativo protegido:

```dotenv
PROVISION_AUTH_USER_ID="UUID_REAL_DA_IDENTIDADE_SUPABASE"
PROVISION_ADMIN_EMAIL="EMAIL_REAL_DO_ADMINISTRADOR"
PROVISION_ADMIN_NAME="Nome do responsável"
PROVISION_UNIT_CODES="UCA"
```

Use `UCA,CAPACLE` somente se a pessoa estiver autorizada em ambas. Esses valores são campos a preencher, não credenciais fornecidas.

3. Com chave administrativa, banco e bootstrap configurados, execute:

```bash
npm run admin:provision
npm run dev
```

4. Abra a origem de `APP_URL` e entre com e-mail e senha da conta Supabase. O provisionamento verifica UUID/e-mail confirmado, preserva o ID interno existente e não cria/redefine senhas ou sobrescreve permissões já configuradas.

Em **Usuários**, o administrador convida pessoas ou vincula identidade Supabase existente, escolhendo o perfil da unidade atual. A mesma pessoa pode ter perfis diferentes em unidades diferentes. Desativar o acesso nessa tela afeta o vínculo da unidade.

Se aparecer **“Origem da solicitação não autorizada”**, confira se o endereço do navegador corresponde exatamente a `APP_URL` ou a uma origem de `APP_ALLOWED_ORIGINS`. `localhost`, `127.0.0.1`, IP da rede e domínio público são distintos. Corrija a configuração e reinicie/reimplante; não desative a proteção.

## Convites e recuperação

Configure Site URL do Supabase Auth com a origem do ERP e permita os destinos exatos utilizados por `/auth/callback` e `/recuperar-senha`. Revise URLs por ambiente; previews não devem reutilizar a base/contas de produção. Configure estes links nos templates de e-mail:

```text
Convite:
{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite

Recuperação:
{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery
```

Configure SMTP/remetente e limites antes do uso real. O usuário solicita recuperação em **Esqueci minha senha**, abre o link e define a senha. Links expirados são tratados; a resposta não revela se um e-mail possui conta. Confirme envio/recebimento real em homologação. A entrega do código não comprova configuração remota ou de e-mail.

Supabase Auth é o único provedor ativo. `Session` e hashes antigos permanecem apenas para preservar o legado, sem autenticar. A duração/renovação dos tokens segue o Supabase. Desativar o usuário ou vínculo no ERP bloqueia novas requisições desse escopo.

## Estoque, compras e ordens

Selecione a unidade, cadastre materiais e estrutura física, gere etiquetas e registre o inventário inicial aprovado por entradas/ajustes auditados. Nunca preencha saldo arbitrário nem altere quantidades no cadastro de produto ou diretamente no banco.

| Quantidade | Significado |
| --- | --- |
| Registrada (`Q`) | Saldo de entradas menos saídas/ajustes, ainda incluindo materiais aplicados não faturados. |
| Reservada (`R`) | Material separado para ordem, ainda na prateleira. |
| Aplicada (`A`) | Material entregue à ordem, aguardando consumo no faturamento. |
| Física | `Q − A`: quantidade esperada na localização para contagem. |
| Disponível | `Q − R − A`: quantidade que outra operação pode usar. |

Saídas/transferências exigem disponível suficiente e não consomem reservas/aplicações. Transferências redistribuem na mesma unidade sem alterar o total. **Estoque negativo permanece bloqueado nesta versão**, inclusive diante de configuração legada diferente.

Em **Compras**, crie pedido com fornecedor/itens. Cada recebimento informa quantidade efetiva, destino e documento real; pode ser parcial, nunca acima do pendente. Recebimento e entradas confirmam na mesma transação. O custo efetivo, quando autorizado/conhecido, é informado no recebimento; ausência permanece nula, sem copiar estimativa como custo real. Custo de produto não informado também permanece nulo, em vez de virar zero. Valores antigos são preservados para revisão pelo responsável. Pedido recebido não pode ser cancelado para desfazer histórico.

Em **O.S./O.P.**, crie ordem, requisite produto/localização, reserve e aplique. Aplicar transfere a reserva para material fora da prateleira, sem baixa definitiva. Faturar exige todos os materiais atendidos e referência real; baixa os aplicados uma única vez. Devolução antes do faturamento libera a aplicação; depois, cria entrada compensatória vinculada à saída original, limitada ao consumido. Para cancelar, devolva aplicações pendentes; reservas remanescentes são liberadas com auditoria.

No **Inventário**, conte a quantidade física. A proposta fica pendente para quem tem `inventory:adjust` aprovar. O ajuste preserva materiais aplicados fora da prateleira e recusa saldo/comprometimentos alterados depois da leitura. Não sobrescreve saldos silenciosamente.

## Perfis padrão

| Ação | Administrador | Supervisor | Operador |
| --- | --- | --- | --- |
| Consultar catálogo/saldo e QR | Sim | Sim | Sim |
| Movimentar e contar inventário | Sim | Sim | Sim |
| Aprovar inventário/gerenciar catálogo | Sim | Sim | Não |
| Consultar ordens/compras | Sim | Sim | Sim |
| Criar ordem, requisitar/reservar/liberar, faturar/cancelar | Sim | Sim | Não |
| Aplicar/devolver em ordem | Sim | Sim | Sim |
| Criar/cancelar compra | Sim | Sim | Não |
| Receber compra | Sim | Sim | Sim |
| Relatórios | Sim | Sim | Não |
| Custos, usuários, configurações e exclusões autorizadas | Sim | Não | Não |

Permissões são verificadas no backend; custos são removidos de retornos sem autorização. O modelo aceita expansão, mas não há editor visual completo de políticas. Conta Supabase sem vínculo ativo não concede acesso ao ERP.

## QR, impressão e PWA

O QR contém `APP_URL/localizacao/UUID`, sem senha/saldo. A leitura resolve a localização da unidade autorizada, mostra materiais e permite ações do perfil. Código, UUID ou URL também podem ser digitados. Etiqueta não substitui autenticação nem autoriza cruzar unidades.

Câmera no celular requer HTTPS, certificado confiável e permissão. A exceção `http://localhost` vale só no dispositivo que executa o servidor; IP HTTP aberto em outro aparelho normalmente não habilita câmera. Valide etiqueta e aparelhos reais da operação.

Etiquetas: 50×30, 60×40, 100×50 mm e A4. Imprima a 100%, preserve margem branca e confira uma antes do lote. PDF usa **Imprimir / Salvar como PDF** do navegador.

A PWA pode ser adicionada à tela inicial em navegadores compatíveis. O service worker guarda recursos públicos/fallback offline, sem respostas autenticadas ou fila de movimentações. Sem conexão, interrompa os registros. Se a resposta se perder, confira o histórico antes de iniciar outra operação: o commit pode ter ocorrido. Reenvio da mesma solicitação/chave não duplica movimento.

## Relatórios e volume

Relatórios respeitam unidade/permissão e cobrem posição atual, mínimo/zerado, movimentos por tipo/usuário/período, locais, contagens e divergências. CSV/Excel vêm do banco; PDF usa impressão. Datas sem horário usam dia de Brasília. Exportação recusa consultas acima de 50.000 linhas e pede filtros menores.

O carregamento inicial consulta catálogo/saldos completos e até 2.000 movimentos, 500 contagens e 1.000 auditorias recentes. Compras/ordens têm paginação de servidor. Avalie carga/paginação antes de grandes importações; não há comprovação de desempenho em volume de produção.

## Testes e build

Prepare base exclusiva cujo nome contenha `test` e configure `TEST_DATABASE_URL` no ambiente. A suíte nunca usa `DATABASE_URL` como alternativa. Aplique migrations explicitamente nessa base; nunca use produção.

```bash
DATABASE_URL="$TEST_DATABASE_URL" DIRECT_URL="$TEST_DATABASE_URL" npm run db:migrate
npm run typecheck
npm run lint
npm test
npm run build
npm start
```

Testes cobrem estoque, concorrência, inventário, compras, ordens, isolamento, permissões e segurança. Resultados executados estão em [VALIDATION.md](docs/VALIDATION.md); instrução de teste não equivale a homologação remota.

`verify:api`, `verify:browser`, `verify:reports` e `verify:operations` dependem de instalação isolada, Supabase configurado e contas reais de homologação. Configure `QA_ENVIRONMENT=isolated`, `QA_BASE_URL`, `QA_UNIT_ID` e credenciais `QA_ADMIN_*`, `QA_OPERATOR_*`, `QA_SUPERVISOR_*` conforme o roteiro. Escritas exigem `ALLOW_QA_WRITES=1`; destino remoto exige `QA_ALLOWED_REMOTE_ORIGIN`. Leia `scripts/qa-config.mjs`. Câmera simulada requer Chromium/FFmpeg. Nunca execute esses roteiros na operação real.

`verify:orders` testa compras e O.S./O.P. pela interface; `verify:public` verifica acesso público e PWA. `verify:auth` testa recuperação e autorização no laboratório local isolado, com os requisitos específicos documentados em [VALIDATION.md](docs/VALIDATION.md). Esse último comando não aceita um Supabase remoto.

## Vercel

1. Importe o repositório como Next.js, com Node.js 22 e lockfile.
2. Configure variáveis por Development/Preview/Production. Proteja chaves/URLs; alinhe `APP_URL` e destinos Supabase Auth ao domínio real.
3. Execute migrations revisadas, bootstrap e provisionamento em etapa administrativa separada. Para base existente, conclua migração/reconciliação antes do corte.
4. Faça deployment. `vercel.json` executa `npm ci` e `npm run build`; o build gera Prisma, mas não migra, limpa ou semeia o banco.
5. Homologue acesso, recuperação, unidades, permissões, estoque, compras, ordens, QR, Data API/RLS e backups antes de liberar a operação.

O banco operacional de produção deve ser o PostgreSQL Supabase escolhido. Não mantenha versões antigas gravando simultaneamente em outro provedor. O pacote não contém credenciais Vercel/Supabase, não cria esses serviços e não comprova deployment remoto. Alterações de variáveis exigem novo deployment.

## Docker e banco local isolado

Docker é opcional para servidor próprio ou PostgreSQL de teste. O Compose utiliza URLs explícitas; não fornece Supabase Auth. O serviço `db` pertence ao perfil `local-db`:

```bash
docker compose --profile local-db up -d db
```

Preencha `POSTGRES_PASSWORD`; `npm run db:local` é um atalho. Para comandos no host, a URL usa `127.0.0.1` e `POSTGRES_PORT`; entre serviços Compose, `db:5432`. O Compose exige `DATABASE_URL`/`DIRECT_URL` preenchidas ao validar configuração. Esta base isolada não substitui produção Supabase.

Com URLs remotas/autenticação configuradas, para servidor próprio:

```bash
docker compose --profile tools run --rm --build migrate
docker compose --profile tools run --rm --build seed
docker compose up -d --build app
```

O app usa imagem Next standalone, usuário sem privilégios e loopback por padrão. Configure proxy HTTPS. Provisionamento é explícito; iniciar servidor não altera banco. Consulte [OPERATIONS.md](docs/OPERATIONS.md).

## Limitações e homologação

- Supabase/Vercel, SMTP, contas, migração remota, câmera física, impressora e instalação PWA dependem do ambiente real. Consulte as evidências antes de considerar essas etapas concluídas.
- Faturamento registra confirmação autorizada com referência; não emite NF-e, consulta SEFAZ ou integra contas a pagar/receber.
- Não há conversão automática de unidades, custo contábil automático por ordem, mínimos por localização, lotes, séries ou validade.
- Mínimo é definido por produto da unidade; fornecedor principal por produto, sem catálogo completo de múltiplos fornecedores.
- Transferências são internas à unidade. Fluxo entre empresas não está implementado.
- Não há movimentação offline. MFA/SSO não têm fluxo próprio homologado nesta entrega.
- Histórico protegido pela aplicação continua acessível tecnicamente a administradores do banco; retenção imutável exige controles externos.
- Unidades adicionais/perfis personalizados exigem configuração administrativa; não há editor visual completo de organizações/unidades/RBAC.

Nenhum dado real foi migrado somente por existir neste pacote. O uso operacional depende da configuração e validação documentadas pelos responsáveis pelos dados e acessos.
