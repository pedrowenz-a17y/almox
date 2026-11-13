# Etapa 7 — central de alertas operacionais

Versão 2.13.0. Abra **Central de alertas** no menu ou use o sino no topo do ERP. O conteúdo acompanha a unidade selecionada e as áreas que a pessoa tem permissão para consultar.

## Uso na rotina

1. Consulte avisos de aplicação, reserva, faturamento, devolução, contagem e conferência vencida. São os mesmos registros da fila de Pendências, com leitura pessoal.
2. Filtre por **Sob minha responsabilidade**, **Em atraso**, **Vencem hoje**, **Sem responsável**, etapa e leitura. Responsáveis e prazos vêm dos cadastros existentes; a agenda só aparece na fila quando estiver vencida.
3. Use **Abrir registro** para acessar a ordem, contagem ou programação correspondente. As ações continuam exigindo suas permissões próprias.
4. Use **Marcar como lido** quando conferir o aviso. Isso registra somente sua leitura; não recebe materiais, fatura ordens, aprova contagens ou remove a pendência.
5. Em **Minhas leituras**, acompanhe até 50 leituras recentes da unidade nas áreas atualmente autorizadas.

O filtro de vencimentos do dia considera a data de Brasília; os horários exibidos seguem o dispositivo. O resumo mostra a posição atual da unidade, mesmo quando a lista está filtrada. Os números contam avisos por etapa: a mesma linha de material pode aparecer em mais de uma etapa e um aviso pode estar simultaneamente atrasado e com vencimento no dia. Não são quantidades de peças nem eventos gerados desde a meia-noite.

## Leitura e situação da operação

| Estado no histórico | Significado |
| --- | --- |
| Ainda pendente | Você leu o aviso e a mesma ocorrência continua na fila. |
| Aviso atualizado | Mudaram dados, prioridade ou ciclo. Consulte o aviso atual, que exige nova leitura. |
| Regularizado na origem | Há confirmação compatível: faturamento da ordem, recebimento da devolução, aprovação da contagem ou contagem aprovada no ciclo indicado da agenda. |
| Encerrado na origem | A origem foi cancelada, desativada ou saiu daquela etapa sem confirmação suficiente de regularização. Consulte seu histórico. |
| Origem indisponível | Não foi possível localizar a origem na unidade; a central não afirma que ela foi resolvida. |

Cancelar uma solicitação de devolução não equivale a receber o material. Desativar ou reprogramar uma conferência não equivale a concluir seu ciclo. Um novo pedido de devolução ou ciclo de agenda recebe identificação própria.

Alterações de quantidade, responsável, prazo, elegibilidade, identificação incompleta da entrega ou prioridade de prazo renovam a identidade do aviso. A mudança de prazo futuro para vencimento no dia e depois para atraso exige revisão. A leitura de outra pessoa não marca seu aviso como lido. O servidor recusa marcar uma versão antiga como se fosse a nova.

## Atualização e acesso

Há consulta ao abrir a central, ao voltar o foco para a janela e a cada minuto enquanto ela está visível. **Atualizar** consulta imediatamente. Falhas de consulta mostram uma mensagem e retiram os números antigos da tela, sem representar falha como pendências zeradas.

Os avisos ficam **dentro do aplicativo**. Esta etapa não envia e-mail, WhatsApp, SMS ou notificações push e não executa uma rotina enquanto o app está fechado. A leitura fica em auditoria individual, sem aparecer na consulta geral de auditoria de outras pessoas. Administradores do banco continuam tendo acesso técnico aos registros.

Consultas respeitam a unidade e as permissões de ordens/inventário existentes. Marcar leitura verifica novamente o vínculo ativo e a permissão no banco. Não foram criados cargos nem concedidos acessos automaticamente. A central não expõe custos.

## Atualização e limites

Não há nova migração SQL, tabela ou variável de ambiente. As leituras usam registros existentes de auditoria e repetição segura. Se a etapa 3 ainda não estiver preparada no banco, os avisos continuam disponíveis e a tela explica a limitação dos responsáveis e prazos das ordens. Para ativar esses campos, siga [a preparação da etapa 3](TURNOS-E-PENDENCIAS-2.9.md).

A identificação de ciclos usa os eventos registrados pelo ERP. Registros legados e alterações externas por SQL podem não conter os sinais necessários para reconstruir ciclos antigos; a central não inventa uma confirmação. A situação do histórico é consultada na origem no momento da abertura, não uma promessa de encerramento definitivo.

Os instaladores Android/Windows não foram recompilados. Quem usa o servidor atualizado recebe a interface ao reabrir ou atualizar o app. Esta entrega não altera o ERP oficial da empresa nem substitui a validação com materiais e responsáveis reais.

## Verificação

Evidências e resultados estão em [artifacts/operational-alerts](../artifacts/operational-alerts). A regressão usa PostgreSQL temporário isolado; a interface usa componentes reais com APIs fictícias e inclui testes das etapas anteriores. Não houve login de produção, envio de e-mail ou alteração de dados da empresa.

Para repetir a interface, configure uma instalação local isolada conforme `scripts/qa-config.mjs` e execute `npm run verify:alerts`. Para domínio, use `npm test` com `TEST_DATABASE_URL` apontando exclusivamente para um banco de testes. TypeScript, ESLint e compilação são verificações separadas.
