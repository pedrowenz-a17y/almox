# Etapa 2 — perfis de acesso por responsabilidade

A versão 2.8.0 adiciona cinco modelos de acesso: **Almoxarife, Conferente de estoque, Comprador, Analista de custos e Auditor**. Os perfis atuais e os acessos das pessoas são preservados. Não há nova tabela nem migração de estrutura nesta etapa.

## Como usar na instalação existente

1. Reabra o aplicativo conectado ao servidor atualizado e entre como administrador da unidade.
2. Abra **Usuários** e, na seção **Perfis por responsabilidade**, clique em **Disponibilizar perfis padrão**.
3. Confira as permissões de cada perfil. O botão cria apenas os modelos que faltam; ele não associa nem altera nenhum usuário.
4. Para atribuir um perfil, edite o usuário desejado e selecione **Perfil nesta unidade**. Confira as permissões exibidas e salve. O acesso em outra unidade permanece separado.

Essa preparação é feita pelo servidor, com a conta administrativa autenticada, sem executar SQL e sem configurar novamente o arquivo `.env`. Apenas selecionar um perfil no formulário não salva o acesso nem envia convite. Criar uma identidade nova continua sujeito ao fluxo de convite e ao serviço de e-mail existentes; a melhoria de primeiro acesso permanece na etapa 4.

A preparação não foi executada com uma conta de produção durante o desenvolvimento. O botão permite ao administrador disponibilizar os modelos no banco de sua instalação.

## Matriz dos novos modelos

| Perfil | Pode fazer | Não pode fazer |
| --- | --- | --- |
| Almoxarife | Entradas, transferências e saídas não produtivas justificadas; recebimentos de compras; reservas, entregas/aplicações e devoluções em ordens existentes; contagens | Aprovar inventário, registrar perda/descarte sem autorização de ajuste, criar/faturar ordens, editar catálogo, ver custos ou gerenciar usuários |
| Conferente de estoque | Consultar estoque e conferências; registrar propostas de contagem | Movimentar estoque, aprovar ou encerrar ajustes, comprar, salvar conciliações, ver custos ou gerenciar usuários |
| Comprador | Cadastrar/editar fornecedores; consultar, criar e cancelar compras conforme as regras existentes; informar e consultar preços dessas compras | Receber fisicamente, movimentar estoque, editar produtos/locais, arquivar fornecedores, ver custo cadastral ou custo de produção, gerenciar usuários |
| Analista de custos | Consultar custos, ordens, compras, inventários e relatórios; salvar documentos de conciliação | Movimentar ou ajustar estoque, registrar contagens, criar compras/ordens, faturar, editar catálogo ou gerenciar usuários |
| Auditor | Consultar relatórios, histórico, ordens, compras, inventários e conferências; visualizar prévias e exportar informações autorizadas | Consultar valores financeiros ou alterar cadastros, estoque, ordens, contagens e documentos de conciliação |

Os acessos ativos da unidade já dispõem da consulta operacional básica de materiais, saldos e histórico carregado pelo painel. As permissões dos modelos definem as operações adicionais e os módulos protegidos. Não foi criada restrição por ordem própria ou setor: todos os dados autorizados continuam limitados à unidade selecionada.

Cargo da empresa e perfil do sistema não são a mesma coisa. Estes modelos organizam permissões; não foi acrescentado um módulo de RH ou folha de pagamento. Os três perfis preexistentes — Administrador, Supervisor e Operador — continuam disponíveis. A etapa 1 continua impedindo a aprovação da própria contagem, inclusive para administradores.

## Separação aplicada no servidor

As permissões novas são positivas e específicas. As APIs e os serviços verificam o tipo de ação, além de identidade e unidade; esconder o botão não é a proteção principal.

- **Estoque:** `stock:entry`, `stock:exit` e `stock:transfer` limitam o tipo de movimentação. Perda/descarte continua exigindo `inventory:adjust`. Retirada produtiva continua pela O.S./O.P., com reserva, entrega e identificação do recebedor.
- **Ordens:** `orders:reserve`, `orders:deliver` e `orders:return` permitem apenas as respectivas etapas. Não autorizam criar ordens, requisitar novos materiais, encerrar saldo solicitado, cancelar a ordem ou faturar.
- **Fornecedores:** `suppliers:write` não libera os demais cadastros. Arquivamento continua exigindo uma permissão adicional, ausente do modelo Comprador.
- **Compras:** `purchases:prices` permite consultar/informar preços nos documentos de compra. Informar um preço também exige a permissão da operação de compra/recebimento. Essa chave não libera custo cadastral do produto nem custo de ordens; esses valores continuam exigindo `costs:read`.
- **Inventário:** `inventory:read` consulta o registro e a agenda, sem permitir nova contagem. `inventory:count` continua necessário para registrar uma proposta, e `inventory:adjust` para aprovar/encerrar ou gerenciar a agenda.
- **Relatórios e conciliação:** `reports:view` permite consulta. `reconciliation:write` permite salvar o documento de conferência, acompanhado da permissão de leitura e, quando necessário, de custos. Uma prévia de CSV é uma consulta e não grava um documento nem ajusta estoque.

As chaves amplas já existentes mantêm seu significado. Por compatibilidade, `stock:move`, `orders:write`, `orders:apply` e `reports:read` continuam autorizando suas operações anteriores. Em particular, `reports:read` preexistente também autoriza registrar conciliações; o novo Auditor usa `reports:view`, que não autoriza essa gravação. Os modelos novos não recebem as chaves amplas desnecessárias.

## Perfis personalizados e preservação dos acessos

As definições de perfis são compartilhadas pelo sistema, e a associação de cada pessoa a um perfil continua sendo **por unidade**. Disponibilizar modelos não concede acesso a uma segunda unidade nem muda vínculos existentes.

Se já existir um perfil com o mesmo nome e permissões diferentes, o servidor o preserva integralmente. A interface o identifica como **Personalizado — preservado**, exibe suas permissões reais e sinaliza a opção correspondente no formulário. Nesse caso, o nome do perfil não garante que ele tenha os limites do modelo sugerido: confira a configuração antes de atribuí-lo.

A preparação usa uma transação e o mesmo bloqueio de preparação de perfis do bootstrap. Pedidos simultâneos não duplicam nomes nem vínculos. Apenas um administrador com acesso ainda ativo na unidade pode executar a ação; o servidor consulta novamente esse vínculo durante a transação. Cada perfil criado recebe um registro `ROLE_PROFILE_PREPARED` na auditoria. Repetir a preparação preserva os registros existentes e não duplica esse evento.

O bootstrap de instalação nova também inclui os modelos. Atualizar a instalação existente pela tela evita reexecutar o seed ou ampliar permissões de perfis antigos.

## Validação desta etapa

- Compilação de produção, TypeScript e ESLint concluídos.
- **234 testes de regressão passaram**, sem falhas ou testes ignorados, em PostgreSQL temporário isolado. As seis migrações existentes foram aplicadas somente nessa base de teste; não foi adicionada migração.
- Os testes incluem preparação repetida/concorrente entre unidades, preservação das contas e das permissões antigas, conflito com perfil personalizado, acesso administrativo revogado, preços de compra separados dos custos de produção, gravação de conciliação separada da consulta e recusa de operações por outro tipo de permissão.
- **29 verificações de interface passaram**: os testes anteriores de tema/navegação e aprovação independente, mais os cenários de preparação, escolha e uso dos novos perfis, inclusive no celular.

As verificações de interface usam os componentes reais com respostas de API fictícias. A preparação de perfis e a gravação de conciliação feitas nessa simulação não atingem o banco da empresa. As regras de estoque e de autorização foram testadas separadamente com Prisma/PostgreSQL reais isolados. Não foi utilizado login de produção nem enviado e-mail a uma pessoa real.

Os instaladores APK/EXE não foram recompilados nesta etapa. O aplicativo que acessa o servidor atualizado recebe a interface e as regras novas; uma instalação que executa seu próprio servidor local precisa atualizar esse servidor.

Veja as [evidências e prévias](../artifacts/access-profiles) e o [plano por etapas](EVOLUCAO-POR-ETAPAS.md). Para repetir a interface numa instalação local exclusiva de testes, configure as variáveis de QA de `scripts/qa-config.mjs` e execute `npm run verify:access-profiles`.
