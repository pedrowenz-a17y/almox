# Etapa 3 — turnos, responsáveis e prazos

A versão 2.9.0 organiza a responsabilidade pelo almoxarifado e o acompanhamento das saídas/aplicações. A tela **Pendências** reúne o turno do almoxarifado selecionado e a fila de regularização da unidade. O tema escuro e a opção de tema claro continuam disponíveis em computador e celular.

## Ativar no banco da instalação

Esta etapa cria duas tabelas: `WarehouseShift` e `PendingAssignment`, com vínculos, índices, proteção contra dois turnos ativos e bloqueio de acesso direto pela Data API. A migração é [20261112180000_operational_responsibility](../prisma/migrations/20261112180000_operational_responsibility/migration.sql). Não altera contas, permissões, saldos ou ordens existentes. Não configura senhas nem envia e-mails.

O build da Vercel gera o cliente Prisma, mas **não executa migrações**. Se o banco ainda não estiver preparado, a consulta de pendências permanece disponível; o sistema mostra o aviso de preparação e mantém os novos comandos indisponíveis. A disponibilidade é consultada novamente ao atualizar, sem exigir recompilar o aplicativo.

Para quem administra pelo celular/Supabase:

1. Entre como administrador no endereço oficial e abra **Pendências**. No aviso da etapa 3, use **Baixar SQL da etapa 3**. O download exige sessão e `users:manage`; o servidor entrega um arquivo fixo e não executa o conteúdo.
2. No projeto Supabase que atende esta implantação, revise o arquivo e execute-o **uma única vez** em **SQL Editor → New query**. O script usa uma transação: uma falha desfaz sua aplicação. Não cole credenciais no arquivo e não escolha um projeto apenas pelo nome.
3. Volte a **Pendências** e clique em **Atualizar**. Os controles de turno e atribuição aparecem quando as tabelas e o índice de turno ativo existem.

Para manutenção com o repositório e histórico Prisma compatível, use a conexão direta/session correta e `npm run db:migrate` no procedimento administrativo da instalação. Após execução manual do SQL, a estrutura precisa ser conferida e esta migração conciliada com o histórico pelo responsável antes do próximo `migrate deploy`. Com o schema e o histórico anteriores verificados, o comando é `npx prisma migrate resolve --applied 20261112180000_operational_responsibility`. Ele apenas registra uma aplicação já conferida; não deve ser usado para ocultar falhas ou marcar migrações antigas por tentativa. Veja o [procedimento de migração](MIGRATION-SUPABASE.md).

A entrega foi validada em PostgreSQL temporário. Nesta sessão não havia conexão administrativa autenticada com o Supabase da empresa; a migração desse ambiente não foi aplicada pelo agente.

## Usar os turnos

- **Assumir turno:** uma pessoa com permissão operacional assume com seu próprio acesso. O registro identifica usuário, unidade, almoxarifado e início real. Cada almoxarifado pode ter apenas um turno ativo; outros almoxarifados e unidades têm turnos independentes.
- **Passar turno:** o titular ou um supervisor indica outra pessoa ativa e autorizada na unidade e registra orientações. O titular permanece responsável até o aceite.
- **Aceitar e assumir turno:** somente a pessoa indicada, autenticada com sua própria conta, pode aceitar. A transação encerra o turno anterior e inicia o seguinte. O supervisor não pode aceitar em nome de outra pessoa.
- **Cancelar passagem:** titular ou supervisor cancela a indicação com observação. Um aceite antigo deixa de ser válido.
- **Encerrar turno:** titular ou supervisor registra o motivo do encerramento. A tela passa a mostrar **Sem responsável no turno**, até alguém assumir. Encerrar não exige inventar um sucessor.
- **Histórico:** a tela mostra os últimos dez turnos encerrados do almoxarifado escolhido. A auditoria conserva os eventos e identifica intervenções do supervisor, passagem, aceite e encerramento.

Perfil operacional significa permissão de movimentação de estoque ou de entrega/devolução nas ordens. Supervisor, nesta etapa, significa possuir `inventory:adjust` ou `users:manage`. Um perfil exclusivamente de consulta não altera turnos. Um gestor que não tem permissão operacional pode intervir, mas não assumir para si. A função não cria permissões para ninguém, não registra ponto e não presume horários fixos de trabalho.

## Acompanhar as pendências

O supervisor com acesso de leitura à área pode usar **Definir responsável** ou **Reatribuir** nas pendências de requisição, reserva, aplicação a faturar, devolução e aprovação de contagem. É obrigatório escolher pessoa elegível, prazo futuro e orientação/motivo. O prazo é informado no horário de Brasília (`America/Sao_Paulo`), como as demais datas exibidas no ERP, e armazenado em UTC. A conversão independe do fuso do dispositivo. Não há prazo padrão inventado para a empresa.

| Etapa | Requisito do responsável |
| --- | --- |
| Requisição a aplicar / reserva a entregar | Permissão para aplicar/entregar material |
| Aplicação a faturar | Permissão para faturar a ordem |
| Devolução a receber | Permissão para receber a devolução |
| Contagem a aprovar | Permissão de ajuste e pessoa diferente do autor da contagem |
| Conferência periódica vencida | Responsável e vencimento permanecem na agenda existente |

A verificação de unidade, atividade e permissões é refeita no banco ao gravar; a interface não autoriza operações por conta própria. Uma atribuição existente cujo responsável perdeu acesso/permissão recebe aviso para reatribuição. O autor da contagem aparece como autor, sem ser apresentado automaticamente como aprovador.

Os filtros **Minhas**, **Sem responsável** e **Atrasadas** são aplicados no banco antes da paginação. Os indicadores abrangem a fila autorizada da unidade, mesmo que a página mostre apenas parte dela. Uma linha de material pode aparecer em várias etapas; os indicadores contam registros e não somam unidades de produtos diferentes. A agenda preserva sua própria programação, evitando um segundo prazo conflitante para a mesma conferência.

Atribuir, reatribuir e passar turno não regulariza materiais. A pendência desaparece quando o fluxo correspondente a resolve. As atribuições e suas alterações ficam na auditoria. Se o mesmo material voltar a gerar uma pendência depois de regularizado, essa nova ocorrência começa sem herdar o responsável/prazo antigo. Aumentar a quantidade de uma pendência ainda aberta preserva seu acompanhamento.

As novas transições das ordens registram o início da etapa. Para linhas antigas sem esse registro, a interface identifica a **criação da ordem** como referência e não afirma que essa é a data exata de abertura da pendência. Contagens usam seu próprio início; conferências mostram o vencimento da agenda.

## Limites e validação

- O aceite do turno identifica quem assumiu o almoxarifado. A confirmação de recebimento de cada material continua com as regras existentes; o aceite não prova retrospectivamente uma entrega.
- A lista de pendências abrange a unidade selecionada. O seletor do turno altera somente o almoxarifado cujo turno está sendo consultado, sem filtrar a fila da unidade.
- A passagem não transfere automaticamente as tarefas de uma pessoa para outra. O supervisor reatribui as tarefas necessárias, preservando o motivo de cada alteração.
- Os avisos são exibidos na tela, com consulta/atualização. Não há envio de e-mail, push, prazo automático ou sincronização contínua em segundo plano nesta etapa.
- Os instaladores Android e Windows não foram recompilados. Aplicativos conectados ao servidor publicado recebem a interface web atualizada. O servidor e o banco continuam necessários; não há gravação operacional offline.

A suíte completa passou com **259 testes** em PostgreSQL temporário e exclusivo de testes, aplicando as sete migrações. Cobriu concorrência, aceite autenticado, unidade, revogação de acesso, supervisão, prazo, aprovação independente, filtros/paginação, reabertura, preservação de estoque e disponibilidade com migração ausente. TypeScript, ESLint e build de produção concluíram. As **39 verificações de interface passaram**, incluindo cartões sem rolagem lateral em 320/390 pixels e conversão do prazo no horário de Brasília. As evidências e verificações visuais ficam em [artifacts/operational-responsibility](../artifacts/operational-responsibility). As verificações de tela usam os componentes reais e APIs fictícias; não realizam login nem gravações no banco da empresa.

Para repetir a verificação visual numa instalação isolada, configure `QA_ENVIRONMENT=isolated`, `QA_BASE_URL` e `QA_UNIT_ID` conforme `scripts/qa-config.mjs`, e execute `npm run verify:responsibilities`.
