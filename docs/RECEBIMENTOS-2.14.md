# Etapa 8 — confirmação de recebimento de materiais

A versão 2.14.0 acrescenta **Recebimentos** ao menu. O destinatário indicado pode confirmar o recebimento na própria conta ou informar uma diferença. A pessoa responsável pela entrega acompanha a unidade e registra o tratamento para revisão do destinatário.

## Registrar uma entrega

Na O.S./O.P., escolha **Entregar e aplicar**. A opção inicial é **Conta do ERP — confirmação pelo destinatário**. Selecione a conta de quem recebeu, confira quantidade e material na revisão e registre a entrega.

A conta precisa estar ativa, com identidade de login vinculada e acesso à mesma unidade. Quem entrega não pode indicar a própria conta para obter confirmação independente. O nome é copiado do cadastro no servidor; informar um nome no pedido não substitui a identidade escolhida. A indicação fica preservada na entrega.

Quando a pessoa não tiver conta, escolha explicitamente **Pessoa sem conta — identificação declarada**, com nome e matrícula/identificação. Essa entrega continuará sendo uma declaração do operador, sem confirmação autenticada. Entregas anteriores também não são vinculadas automaticamente por nome ou e-mail.

Selecionar uma conta ainda não confirma o recebimento. A aplicação e a baixa no faturamento mantêm suas regras anteriores.

## Responder na própria conta

1. Entre no ERP, selecione a unidade e abra **Recebimentos → Para mim**.
2. Abra **Conferir entrega** e compare ordem, material, quantidade, local e pessoa que entregou.
3. Se tudo corresponder, escolha **Confirmar recebimento** e confirme que conferiu e recebeu integralmente a quantidade exibida.
4. Havendo diferença, escolha **Informar divergência**. Informe a quantidade efetivamente recebida, se o material confere e descreva a diferença. Zero, recebimento parcial e excesso podem ser relatados; há até três casas decimais, sem conversão automática de unidades.

Somente a conta indicada pode responder. Cada pessoa deve usar sua própria conta. Um administrador ou entregador não confirma no lugar dela. Confirmar é uma declaração da pessoa autenticada: não comprova automaticamente a conferência física nem substitui procedimentos definidos pela empresa.

## Tratar uma divergência

Quem pode consultar ordens encontra **Acompanhar unidade**, com filtros de situação e busca por ordem/material. A lista inclui entregas sem conta vinculada, contas indicadas sem acesso ativo e confirmações pendentes. Os totais correspondem ao escopo escolhido e não mudam com os filtros da lista.

Para **Registrar tratamento**, a pessoa precisa também de permissão para entregar/aplicar materiais. Ela descreve a conferência e as providências realizadas e informa uma referência verificável. A referência é declarada; o sistema não verifica automaticamente documentos externos nem executa correções de estoque.

O destinatário vê **Tratamento aguardando aceite** e pode:

- **Aceitar tratamento**, descrevendo o que conferiu. O acompanhamento fica como **Tratamento aceito**.
- **Devolver para revisão**, explicando o que ainda falta. A divergência volta a aguardar tratamento, preservando as propostas e respostas anteriores.

O aceite de tratamento não transforma retroativamente uma entrega divergente em recebimento integral. Se foram relatadas 8 unidades de uma entrega declarada de 10, o relato de 8 permanece. Ajustes, devoluções e demais correções seguem seus próprios fluxos autorizados; sua referência pode ser informada no tratamento.

## Situações e histórico

| Situação | Significado |
| --- | --- |
| Aguardando confirmação | Há uma conta indicada e ainda não existe resposta do destinatário. |
| Recebimento confirmado | O destinatário declarou recebimento integral e material correto. |
| Divergência informada | O destinatário registrou diferença ou devolveu o tratamento para revisão. |
| Tratamento aguardando aceite | Uma pessoa autorizada registrou providências; falta a resposta do destinatário. |
| Tratamento aceito | O destinatário aceitou o tratamento. O relato original continua preservado. |
| Sem conta vinculada | Há somente identificação declarada ou registro legado, sem aceite autenticado. |

O histórico mostra até 100 respostas recentes, com autores, horários, relatos e referências. A identificação do material/local é preservada nas novas entregas; registros antigos usam os dados disponíveis no cadastro. Os eventos também aparecem no histórico da ordem, com acesso ao acompanhamento pela entrega original.

## Acesso, atualização e estoque

Qualquer conta ativa da unidade pode consultar e responder **somente às entregas indicadas para ela**, sem ganhar permissão para abrir ordens completas, consultar custos ou movimentar estoque. A consulta de toda a unidade exige `orders:read`; propor tratamento exige ainda `orders:apply` ou `orders:deliver`. A resposta do destinatário é uma declaração pessoal, inclusive quando seu perfil não executa operações de estoque.

As permissões e o vínculo ativo são conferidos novamente no banco ao responder. Alterações simultâneas usam versão esperada, transação serializável e repetição segura. Uma resposta antiga não sobrescreve a nova; atualize a entrega quando houver aviso de conflito. As quantidades são exibidas sem perder milésimos na confirmação.

Use **Atualizar** para consultar respostas de outras pessoas. A tela também consulta ao abrir e após suas próprias respostas. Não há notificações externas, envio de e-mail ou execução offline nesta etapa.

Confirmação, divergência, proposta e aceite **não alteram saldos, reservas, aplicações, baixa no faturamento nem devoluções**. O faturamento não passou a exigir esse aceite. Uma ordem faturada continua mostrando o acompanhamento da entrega histórica. O estoque só muda pelas operações já previstas no ERP.

Não há nova migração SQL ou variável de ambiente. As respostas são novos eventos da ordem, acompanhados de auditoria e recibos de repetição segura. Administradores do banco continuam tendo acesso técnico aos registros; esta funcionalidade não é uma assinatura digital certificada. Os instaladores Android/Windows não foram recompilados; clientes que usam o servidor atualizado recebem a interface ao reabrir ou atualizar o app.

As evidências de desenvolvimento ficam em [artifacts/delivery-receipts](../artifacts/delivery-receipts). Não foram autenticadas contas de produção, enviados e-mails ou alterados dados da empresa nos testes. O uso e a validação com pessoas e materiais reais continuam dependendo da rotina acordada com a empresa.

Para repetir as verificações de interface, configure a instalação isolada conforme `scripts/qa-config.mjs` e execute `npm run verify:receipts`. A regressão usa `npm test` com PostgreSQL exclusivo de testes. Build, TypeScript e ESLint são verificados separadamente.
