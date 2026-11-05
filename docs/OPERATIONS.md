# Operação e implantação — Almox ERP · U.C.A. v2

Produção utiliza um único PostgreSQL Supabase e Supabase Auth. Este guia orienta operação; não comprova serviços remotos, contas, SMTP ou dispositivos configurados. Evidências executadas estão em `VALIDATION.md`.

## Preparação

Separe projetos/credenciais de desenvolvimento, homologação e produção. Use Node.js 22 LTS, HTTPS e URLs do painel Supabase. `DATABASE_URL` atende execução; `DIRECT_URL`, migrations por conexão direta/sessão. Dimensione pool conforme capacidade do PostgreSQL/instâncias serverless. Não use transaction pooling para tarefas administrativas que dependem de sessão.

`APP_URL` deve ser a origem pública exata: determina cookies, validação HTTP, links e etiquetas. Extras são explícitas em `APP_ALLOWED_ORIGINS`; não remova validação por divergência de domínio. Mudar domínio exige preservar o endereço antigo ou regenerar etiquetas e revisar redirects.

Guarde URLs de banco e chave administrativa em secret manager. `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` aceita apenas chave pública. Se houver exposição de chave administrativa, faça rotação e revise acessos. Não registre senha, cookie, token, URL completa de banco ou link de recuperação.

Em instalação existente, identifique a base ativa e teste backup/restauração antes de mudanças. Siga `MIGRATION-SUPABASE.md`. Ausência de registros na interface não prova banco vazio: pode existir legado preservado sem unidade.

## Implantação inicial

1. Instale com `npm ci` e configure as variáveis do README.
2. Execute `npm run config:check -- --production`. Formato válido não comprova acesso remoto.
3. Revise SQL e execute `npm run db:migrate` administrativamente. A extensão `pg_trgm` exige privilégio adequado.
4. Execute `npm run db:seed`: somente instituições, unidades, perfis/permissões/configurações, sem dados operacionais ou usuário padrão.
5. Configure conta Supabase autorizada e execute `npm run admin:provision`, com UUID/e-mail confirmado/unidades explícitas.
6. Configure Site URL, redirects, templates de convite/recuperação e SMTP; teste entrega real.
7. Implante. Build/inicialização não migram nem semeiam o banco.
8. Homologue em ambiente isolado e concilie inventário inicial real antes da operação.

Na Vercel, `vercel.json` declara Next.js, `npm ci` e `npm run build`. Configure variáveis por Development/Preview/Production; gere novo deployment após alterá-las. Não conecte preview de testes à base real. Exibir login publicado não comprova banco/acesso/estoque funcional.

Em servidor próprio, execute `npm run build` e `npm start`. O script prepara recursos públicos/estáticos do Next standalone. Runtime precisa alcançar PostgreSQL e Supabase Auth; configure gerenciador de processos, proxy TLS e logs restritos.

Com Docker:

```bash
docker compose --profile tools run --rm --build migrate
docker compose --profile tools run --rm --build seed
docker compose up -d --build app
docker compose ps
```

Migrate/seed usam imagem de ferramentas; app é standalone sem privilégios, sem Prisma CLI/tsx para administração. As URLs são explícitas, e o Compose não inicia banco alternativo automaticamente.

O perfil `local-db` fornece PostgreSQL isolado de teste, não Supabase Auth. Preencha senha/URLs antes de `docker compose --profile local-db up -d db`. Host usa `127.0.0.1:POSTGRES_PORT`; containers usam `db:5432`. Volume persistente não é backup nem substitui produção Supabase.

## Homologação

Use contas individuais e dados de teste isolados. Registre ambiente, versão, responsável e evidências. Valide:

- Login/logout, convite/recuperação/link expirado, rejeição de conta sem vínculo/desativada.
- Separação entre duas unidades em UUID, QR, imagem, relatório, documento e escrita; troca da unidade descartando tela anterior.
- Operador sem custos, gestão de acesso, configuração, faturamento ou aprovação de ajuste.
- Entrada 100, saída 15, transferência 25: origem 60, destino 25, total 85, com histórico/auditoria. Excedente deve falhar.
- Repetição da mesma solicitação e concorrência sem dupla baixa ou disponível negativo.
- Compra parcial/completa, recusa de excedente e entradas ligadas a documento real.
- O.S./O.P.: requisição/reserva/aplicação, bloqueio de faturamento se houver pendência, consumo único após atendimento completo, devoluções limitadas.
- Contagem física com material aplicado, aprovação correta e recusa de snapshot alterado.
- RLS/privilégios: Data API anônima/autenticada recusa acesso direto às tabelas; API Next só permite escopo autorizado.
- QR impresso, câmera Android/iOS reais, entrada manual, exportação, impressão e instalação PWA.
- Perda de conexão sem falsa confirmação de operação e restauração de backup em destino separado.

Scripts `verify:*` efetuam operações reais e exigem configuração explícita de homologação/credenciais. Não use produção para testar botões. Item não executado continua pendente.

## Atualização e corte

Antes do rollout, faça backup verificável, revise migrations e teste em homologação representativa. Preserve release anterior/configuração protegida para recuperação. Não execute `migrate reset`, `db push --force-reset` ou exclusões para fazer uma migration passar.

Execute migration uma vez em etapa administrativa serializada; depois disponibilize a versão compatível e confira saúde, acesso e consultas. Seed não é reposição de saldo ou recuperação de senha e não roda a cada inicialização.

Para migrar ao Supabase: backup → restauração isolada → comparação de snapshots → migration → bootstrap → identidades → classificação por unidade → reconciliação. Siga o guia específico. Interrompa gravações durante o corte; não deixe app antigo escrevendo em outro provedor e app novo no Supabase.

Legado sem unidade fica preservado/invisível operacionalmente. Classifique toda a cadeia relacional com aprovação registrada. Configurações globais antigas exigem revisão; não propague negativo. Não comece operação com saldo escondido nessa quarentena sem reconciliação.

Rollback do código não desfaz migration. Se houve gravações depois do corte, não volte a snapshot antigo ignorando os movimentos novos. Suspenda operação, preserve evidências e concilie antes do retorno aprovado.

## Backup e recuperação

Defina RPO (perda máxima aceitável) e RTO (tempo de recuperação). Configure backups automáticos e recuperação point-in-time quando o plano exigir/permitir. Mantenha cópia protegida fora do ambiente principal e teste restauração.

Cubra catálogo, saldos, imagens, histórico e metadados necessários. Supabase Auth possui esquema/operação próprios: siga a estratégia de backup do provedor e preserve a associação `User.authUserId`. Dump apenas de `public` não equivale a restauração integral do Supabase.

Para backup operacional, use perfil `pg_service.conf` e credenciais protegidas, evitando senha nos argumentos/logs:

```bash
mkdir -p backups
PGSERVICE=almox_producao pg_dump --format=custom --schema=public --no-owner --no-acl --file=backups/almox-public.dump
pg_restore --list backups/almox-public.dump > backups/restore.list
```

`almox_producao` é perfil a configurar, não credencial fornecida. Proteja dumps/snapshots/listas; não inclua no ZIP. Registre data, release, migrations, checksum e teste de recuperação.

Restaure primeiro em base isolada vazia conforme guia. Não use `--clean` por tentativa no Supabase: há schemas/objetos do provedor. Revise lista e compare IDs, contagens, saldos/histórico. Após incidente, concilie movimentos físicos posteriores ao backup antes de reabrir.

## Monitoramento

`GET /api/health` verifica HTTP e consulta simples PostgreSQL. Não comprova Auth, SMTP, integridade de todos os dados ou capacidade operacional.

Monitore 5xx, latência, conexões/pool, bloqueios/conflitos persistentes, espaço, imagens e backups. Acompanhe falhas/limites de autenticação e convite. A limitação de login/recuperação usa registros no PostgreSQL e bloqueio transacional por identificador, compartilhados pelas instâncias. Ela complementa os controles de abuso do Supabase e da infraestrutura; acompanhe ambos.

Disponibilidade, retenção, e-mail e conexões dependem do plano contratado. Antes de importar volume grande, meça queries/payloads: catálogo/saldo inicial ainda não é paginado. Relatórios exigem filtros além de 50.000 linhas.

Logs devem ter acesso restrito e não conter credenciais. Acompanhe devoluções, ajustes, cancelamentos, faturamentos e mudanças de acesso. A API não exclui movimentos, mas superusuários do banco mantêm poder técnico; retenção imutável exige controle externo/separação de funções.

## Acesso e incidentes

Gerencie vínculo da unidade e conta Supabase. Desativar vínculo bloqueia aquele escopo; desativar usuário interno bloqueia seus acessos ao ERP. Use contas individuais e preserve histórico de pessoas desligadas.

Senhas pertencem ao Supabase: recuperação por e-mail, nunca seed ou edição de hash. Logout encerra sessão local; tokens/revogação seguem o Supabase. Não prometa revogação global instantânea sem validar configuração. Em incidente, desative acesso ERP, use controles Supabase e revise operações.

Convite envolve chamada externa seguida de vínculo no banco. Se o vínculo falhar, o serviço tenta remover a identidade recém-convidada ainda não vinculada. Falha nessa compensação exige reconciliação administrativa. E-mail entregue não concede acesso sem vínculo ativo.

Se houver autenticação incompleta, corrija variáveis/serviço; não habilite fallback ou login demonstrativo. Para erro de origem, alinhe domínio e `APP_URL`/origens explícitas e reimplante.

## Integridade e contingência

Não edite `InventoryBalance` por SQL/Prisma Studio. Entrada, saída, transferência, compra, consumo, devolução e inventário possuem serviços com histórico. Investigue divergência comparando físico, reservado, aplicado, movimentos e contagens; corrija com nova operação sem apagar a anterior.

Faturamento exige todos os materiais atendidos. Material aplicado não está na prateleira. Devolução pós-faturamento compensa consumo com entrada ligada à saída; não reabre ordem. Emissão fiscal permanece no processo/sistema fiscal da empresa.

Após falha de rede, consulte histórico antes de iniciar outra solicitação. Commit pode preceder perda da resposta. Repetir a mesma chave/conteúdo não duplica; abrir novo formulário pode criar outra operação.

PWA não opera estoque offline. Sem conexão, suspenda registros e siga contingência da empresa, conciliando depois com responsáveis/referências. Não acumule ações físicas sem identificação.

Câmera requer HTTPS e permissão no navegador. Navegadores embutidos de mensageiros podem limitar câmera/instalação; abra o domínio no navegador compatível. Teste QR em escala real, distância e iluminação da operação antes do lote.
