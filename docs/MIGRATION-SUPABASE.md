# Migração preservando dados: PostgreSQL existente → Supabase

## Situação e arquitetura

O ZIP auditado usa Next.js 16, Prisma 6 e PostgreSQL. Não contém driver Neon, URL Neon, integração Supabase anterior, exportação do banco nem uma configuração da Vercel que comprove implantação remota. O estado de qualquer banco Neon/Supabase da empresa **não foi verificado**. A ausência de registros na interface não é evidência de banco vazio.

A aplicação mantém Prisma como único acesso aos dados operacionais e passa a utilizar Supabase Auth como única autenticação ativa. O PostgreSQL do projeto Supabase será a única fonte de verdade após o corte aprovado. Não há sincronização nem escrita simultânea Neon/Supabase.

Os IDs internos de `User`, materiais, locais, movimentos e inventários são preservados. `User.authUserId` associa explicitamente a identidade validada no Supabase. `User.passwordHash`, `User.roleId` e a tabela `Session` legados são preservados para migração e rastreabilidade, mas não autenticam nem concedem acesso na aplicação nova. As permissões operacionais vêm de `UnitMembership` e do perfil associado à unidade atual.

## Conexões Prisma 6

Configure, com os valores reais fornecidos pelo painel **Connect** do Supabase:

- `DATABASE_URL`: conexão do Prisma durante a execução da aplicação. Para Vercel, utilize o pooler apropriado ao modo serverless informado pelo Supabase e pela versão Prisma 6 adotada. Se utilizar o endpoint de transaction pooling, siga a orientação oficial vigente sobre prepared statements/`pgbouncer=true`; não acrescente parâmetros sem relação com o endpoint escolhido.
- `DIRECT_URL`: conexão administrativa para migrations, usando conexão direta ou pooler em modo de sessão quando a conectividade IPv4 exigir. Não use o endpoint de transaction pooling para ferramentas que dependem de sessão.
- `MIGRATION_DATABASE_URL`: conexão explícita usada apenas pelos scripts de snapshot/mapeamento. Eles não usam `DATABASE_URL` como alternativa, evitando executar migração em uma base escolhida por engano.

Use TLS e mantenha os segredos em variáveis protegidas. Separe projetos/bases de Development, Preview e Production. Migrações são uma etapa administrativa serializada, fora do build da Vercel. `prisma generate` não aplica migrations nem altera dados.

Consulte [Prisma com Supabase](https://supabase.com/docs/guides/database/prisma) e [conexões PostgreSQL do Supabase](https://supabase.com/docs/guides/database/connecting-to-postgres). O painel do projeto é a fonte das URLs; o repositório não fornece credenciais de produção.

## Fronteira de segurança e RLS

Todas as tabelas do ERP recebem `ENABLE ROW LEVEL SECURITY`. A migration revoga os privilégios de `PUBLIC`, `anon` e `authenticated` (quando esses papéis existem) e não cria policies de leitura/escrita para a Data API. Assim, a chave pública e o JWT de um navegador não autorizam consultar essas tabelas pelo PostgREST. Não habilite policies amplas para fazer a interface funcionar.

O acesso aos dados ocorre exclusivamente pelo servidor Next.js, que verifica Supabase Auth, usuário ativo, vínculo ativo com a unidade e permissão da operação. O papel PostgreSQL usado por Prisma precisa ter os privilégios de servidor necessários e acesso fora dessas policies, como um papel dedicado com `BYPASSRLS` provisionado pelo administrador do banco. A credencial nunca pode chegar ao navegador. Um papel `BYPASSRLS` **não oferece isolamento automático por usuário**: o isolamento por unidade depende das verificações obrigatórias no backend, complementadas por chaves estrangeiras de mesma unidade. Não use a conexão privilegiada em aplicações cliente ou ferramentas compartilhadas com operadores.

Não é aplicado `FORCE ROW LEVEL SECURITY` aos proprietários das tabelas. Isso evita bloquear migrations/backup e mantém explícito o acesso administrativo. O PostgreSQL gerenciado e seus administradores continuam fora da fronteira de autorização da interface.

Após migrar, o responsável deve verificar:

```sql
SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relkind='r'
ORDER BY c.relname;

SELECT tablename, policyname, roles, cmd
FROM pg_policies WHERE schemaname='public';
```

Confira todas as tabelas do ERP, as permissões efetivas dos papéis da API e se não existem policies externas antigas. Teste uma chamada anônima e uma autenticada à Data API: ambas devem ser recusadas para as tabelas do ERP. Valide separadamente que a API Next.js permite apenas o escopo e as ações autorizadas. Esses testes remotos dependem do acesso ao projeto Supabase.

## Inventário e backup antes de qualquer alteração

1. Identifique a implantação realmente ativa, seu projeto de banco, schema e migrations aplicadas. Não imprima URLs completas ou senhas em logs.
2. Catalogue tabelas, extensões, índices, constraints, usuários, funções, triggers e quaisquer integrações que escrevam no banco. Verifique se o schema corresponde ao ZIP; uma divergência exige revisão antes de aplicar migrations.
3. Registre a janela de manutenção, responsáveis, referência da mudança, RPO/RTO e destino de restauração. Interrompa gravações no corte e confira que não há outro deployment escrevendo no Neon.
4. Faça backup completo compatível com PostgreSQL 16 e teste a restauração em uma base isolada. O dump contém dados empresariais e credenciais legadas: proteja-o e nunca inclua no ZIP de entrega.
5. Capture os registros e saldos com o script somente leitura.

Exemplo de backup usando um perfil PostgreSQL configurado pelo responsável em `pg_service.conf` e credenciais em armazenamento protegido (`.pgpass` com permissão restrita, quando aplicável):

```bash
mkdir -p backups
PGSERVICE=origem_almox pg_dump --format=custom --schema=public --no-owner --no-acl --file=backups/almox-public.dump
pg_restore --list backups/almox-public.dump > backups/restore.list
```

Os nomes `origem_almox` e `destino_almox` representam perfis locais definidos pelo responsável, não contas fornecidas pelo projeto. Não coloque senhas nos argumentos do shell. Inclua outras extensões/schemas realmente utilizados em um plano específico; este projeto não deve sobrescrever schemas administrados pelo Supabase, como `auth` e `storage`.

Com `MIGRATION_DATABASE_URL` apontando para a origem e protegido no ambiente:

```bash
node scripts/migration-snapshot.mjs --output backups/origem-antes.json
```

O snapshot abre uma transação somente leitura e consistente, calcula contagens e SHA-256 por tabela e grava os saldos por produto/localização como texto decimal. Não inclui senhas, hashes de senha nem tokens. As imagens são comparadas por impressão digital. O arquivo é criado com permissão restrita e não sobrescreve um snapshot anterior. Ele complementa o backup; não é um arquivo de restauração.

## Restauração e comparação

Restaure primeiro em destino isolado e sem tabelas operacionais do ERP. O Supabase já possui schemas e objetos próprios: revise `restore.list`, retirando **somente** entradas administrativas já existentes e confirmadas, como a criação do schema `public`. Preserve todas as tabelas, dados, índices e constraints do ERP e `_prisma_migrations`. Não restaure o dump por cima de dados existentes e não use `--clean` para contornar conflitos.

```bash
PGSERVICE=destino_almox pg_restore --use-list=backups/restore.list --no-owner --no-acl --single-transaction --exit-on-error backups/almox-public.dump
```

Com `MIGRATION_DATABASE_URL` agora apontando explicitamente para o destino:

```bash
node scripts/migration-snapshot.mjs --output backups/destino-restaurado.json
node scripts/migration-compare.mjs backups/origem-antes.json backups/destino-restaurado.json
```

Uma divergência gera saída diferente de zero e deve bloquear o corte. Preserve o banco antigo. Não execute `DROP DATABASE`, `prisma migrate reset`, `db push --force-reset` ou exclusões de histórico para fazer os totais coincidirem.

O comparador não interpreta divergências como autorizadas: até alterações esperadas de bootstrap devem ser feitas **depois** desta comparação. Não compare snapshots gerados enquanto a aplicação continua gravando e conclua que uma diferença é erro de migração sem analisar a janela de captura.

## Aplicação das migrations novas

Depois de restaurar e comparar, configure `DIRECT_URL` para o destino e aplique:

```bash
npm run db:generate
npm run db:migrate
node scripts/migration-snapshot.mjs --output backups/destino-migrado.json
node scripts/migration-compare.mjs backups/destino-restaurado.json backups/destino-migrado.json
```

A migration `20261026120000_uca_units_orders_supabase` cria organizações, unidades, vínculos, ordens, requisições, eventos, compras e recebimentos. Adiciona `unitId` aos registros existentes sem atribuir uma organização por suposição. Adiciona a associação Supabase ao usuário, preservando seu ID e hash legado inativo. Não altera quantidades nem apaga registros. Os campos novos de escopo e vínculo são excluídos das impressões digitais dos registros legados para permitir a comparação antes/depois dessa etapa.

As unicidades de códigos/categorias/fornecedores tornam-se locais à unidade. Chaves estrangeiras compostas impedem relacionamentos entre unidades, e o escopo de um registro já classificado torna-se imutável. A unicidade de consumo por item de ordem complementa a idempotência da API. Novas constraints validam quantidades, devoluções e estados de faturamento.

A migration `20261029190000_optional_product_cost` permite custo de produto nulo e remove o valor padrão zero. Não modifica os valores já gravados: um zero histórico é preservado para revisão pelo responsável, sem inferir se significava custo gratuito ou não informado.

Se o destino já tem um schema existente sem histórico Prisma compatível, **não marque migrations como aplicadas por tentativa**. Faça o baseline com revisão do SQL e comparação do schema real, em homologação, antes de continuar.

## Bootstrap institucional e primeiro administrador

```bash
npm run db:seed
```

O seed cria apenas os nomes confirmados **U.C.A. Implementos Agrícolas** e **Grupo Capacle**, cada um como organização e escopo operacional inicial independente. Não afirma relação societária, endereço, CNPJ ou estrutura de filiais. Os códigos `UCA` e `CAPACLE` são identificadores internos do aplicativo. A estrutura física será cadastrada pelo responsável.

São criados os perfis/permissões iniciais e configurações com estoque negativo bloqueado. Nenhum usuário, fornecedor, material, saldo, documento, O.S. ou O.P. é inventado. `SEED_DEMO=true` é recusado explicitamente. Não há senha administrativa padrão.

Perfis existentes são preservados. Para adicionar conscientemente as novas permissões aos perfis padrão já existentes, revise o conjunto em `prisma/seed.ts` e execute uma vez com `BOOTSTRAP_EXTEND_ROLE_PERMISSIONS=true`. Essa opção apenas adiciona permissões previstas; não redefine contas, não troca senhas, não move usuários de perfil e não remove permissões personalizadas. Registre essa decisão na mudança.

Provisione o administrador pelo procedimento de `scripts/provision-admin.ts` descrito no README, com uma conta autorizada no Supabase Auth e os escopos explicitamente selecionados. Depois migre as demais contas, associando `authUserId` ao **mesmo `User.id`** utilizado pelo histórico. Não importe o hash scrypt como se fosse uma senha Supabase compatível e não faça autovinculação no login apenas porque os e-mails coincidem. Quando necessário, envie convite/recuperação por Supabase Auth e confirme a titularidade da conta. Senhas antigas não são recuperadas do banco.

## Classificação aprovada dos dados legados

Até serem classificados, registros antigos permanecem com `unitId=NULL`, fora das consultas operacionais. Isso é uma quarentena de migração, não exclusão nem estoque zero. Não comece a operação da empresa com registros ainda não reconciliados escondidos nessa quarentena.

Gere o plano:

```bash
node scripts/migration-map-units.mjs --generate backups/plano-unidades.json
```

O arquivo contém os IDs legados e unidades disponíveis, sem atribuições automáticas. Preencha cada alvo com o UUID aprovado e a `changeReference`. Remova do plano qualquer registro que ainda não possa ser classificado. O responsável deve verificar a cadeia inteira: produto, categoria, fornecedor, almoxarifado, localização, saldo, movimento, inventário, itens, imagem e auditoria. Registros relacionados não podem ser classificados em unidades diferentes.

Valide sem escrever:

```bash
node scripts/migration-map-units.mjs --plan backups/plano-unidades.json
```

Para efetivar, configure no ambiente protegido `MIGRATION_APPLY_APPROVED=true` e `MIGRATION_APPROVER_USER_ID` com o ID interno de um administrador ativo, já vinculado ao Supabase Auth e autorizado com `settings:manage` em todas as unidades do plano:

```bash
node scripts/migration-map-units.mjs --plan backups/plano-unidades.json --apply
```

O script aplica somente `unitId`, em uma transação serializável, valida as FKs antes do commit e registra auditoria por unidade. IDs, quantidades, documentos e movimentos originais permanecem inalterados. Reexecutar o mesmo plano não reaplica classificações já concluídas. Um registro já classificado não pode ser transferido para outra unidade pelo script.

`AppSettings` legado exige revisão especial: o bootstrap já cria uma configuração por unidade. Não atribua o registro global antigo a uma unidade que já possui configurações; preserve o legado e aplique conscientemente os valores aprovados pela tela Configurações, com auditoria. Também não propague uma antiga permissão de saldo negativo automaticamente.

Se um produto legado foi utilizado de fato em mais de uma empresa, o catálogo local exige um plano explícito de separação dos cadastros e reconciliação do histórico. O script recusa cruzamentos; não duplica produtos nem reescreve históricos automaticamente. Essa decisão depende do responsável pelos dados.

Confira ao final as quantidades ainda em quarentena, por exemplo:

```sql
SELECT 'Product' AS tabela, count(*) AS sem_unidade FROM "Product" WHERE "unitId" IS NULL
UNION ALL SELECT 'InventoryBalance', count(*) FROM "InventoryBalance" WHERE "unitId" IS NULL
UNION ALL SELECT 'StockMovement', count(*) FROM "StockMovement" WHERE "unitId" IS NULL
UNION ALL SELECT 'InventoryCount', count(*) FROM "InventoryCount" WHERE "unitId" IS NULL;
```

Os snapshots posteriores ao bootstrap/mapeamento devem apresentar as mudanças aprovadas em permissões, configurações e auditoria; não se espera que sejam idênticos aos anteriores. Os saldos por produto/localização devem permanecer exatamente iguais até uma movimentação operacional autorizada.

## Corte, validação e retorno

Antes de trocar `DATABASE_URL` da produção na Vercel: valide acesso real, recuperação de senha, unidades, negativas de permissão, RLS/Data API, todas as migrations, contagens e saldos conciliados, operação de compra/recebimento e O.S./O.P., idempotência e backups. Use usuários e dados de homologação isolados para testes de escrita.

Mantenha a origem sem novas gravações durante a captura final e restauração. Atualize uma única implantação para o destino, gere novo deployment e confirme que não existe uma instância antiga ainda escrevendo no banco anterior. Não descarte o Neon nem o backup até validação e autorização explícita do responsável.

O retorno precisa considerar gravações feitas no Supabase após o corte. Nunca aponte novamente para um snapshot antigo ignorando esses movimentos. Se houver falha, suspenda operações, reconcilie os eventos novos e execute o plano de recuperação aprovado.

## Dependências ainda externas

Este documento não comprova uma migração remota executada. Permanecem dependentes de acesso e decisão do responsável: identificação do banco atual, existência e qualidade de dados empresariais, backup/restauração remotos, classificação das unidades, contas autorizadas, URLs e políticas do Supabase Auth, SMTP, configuração Vercel, reconciliação final e liberação para uso real. Resultados de testes locais devem ser consultados separadamente em `docs/VALIDATION.md`.
