# Etapa 9 — visão gerencial da operação

A versão 2.15.0 acrescenta **Gerencial → Visão da operação**. O painel reúne a posição atual das filas, a espera mais antiga conhecida e posições diárias registradas para acompanhamento. Usa os mesmos registros de Pendências e Recebimentos, sem criar uma segunda regra de cálculo.

## Consultar e comparar

O painel abre na unidade selecionada no ERP. Marque **UCA**, **CAPACLE** ou outras unidades autorizadas para comparar até quatro, sempre incluindo a atual. A comparação consulta todas na mesma transação e usa um único horário de referência. Marcar uma unidade na comparação não troca a unidade ativa do ERP.

| Grupo | O que é contado |
| --- | --- |
| Aplicação, reserva, faturamento e devolução | Linhas de material nas etapas da fila de Pendências, conforme a situação da ordem. |
| Contagem | Contagens pendentes de aprovação. |
| Conferência vencida | Programações ativas cujo vencimento já chegou. |
| Entrega sem confirmação | Entregas vinculadas a uma conta, ainda sem resposta. |
| Divergência e tratamento | Entregas no estado atual de divergência ou aguardando aceite, conforme a etapa 8. |
| Entrega sem conta vinculada | Entregas com identificação declarada ou registros antigos sem vínculo para confirmação autenticada. É uma medida de cobertura do registro; não afirma que o material não foi recebido. |

As linhas podem se sobrepor: uma linha de material pode estar reservada e também ter saldo de aplicação a regularizar. Não se somam como total de peças ou ocorrências únicas. Não são somadas quantidades físicas com unidades diferentes, nem apresentados valores financeiros.

Os atalhos **Pendências da unidade atual** e **Recebimentos da unidade atual** levam aos registros da unidade ativa. Para consultar detalhes de outra unidade comparada, selecione-a no menu do ERP.

## Tempo de espera

O painel mostra a espera mais antiga **entre os registros cuja data é conhecida**:

- Nas linhas de ordens, usa o evento que abriu a ocorrência atual. Reaberturas registradas pelo fluxo mantêm identidade própria.
- Nas contagens, usa sua abertura; nas conferências vencidas, usa o vencimento da agenda.
- Em entregas sem resposta ou sem conta, usa a data da entrega registrada.
- Em divergências e propostas, usa a resposta que abriu a etapa atual. Uma devolução do tratamento para revisão reinicia essa espera de etapa, preservando o histórico da entrega.

Quando a abertura não está disponível, isso aparece como **sem data de abertura**. A criação da ordem não substitui uma abertura desconhecida. Datas futuras também não geram tempos negativos. O tempo é apresentado em minutos, horas ou dias completos; não é um prazo de atendimento acordado com a empresa.

## Registrar posições e acompanhar evolução

1. Consulte a unidade e os números atuais.
2. Clique em **Registrar posição de hoje** e confira o resumo.
3. Confirme o registro. A posição será consultada novamente no momento da confirmação e guardada na unidade ativa, com data de Brasília e horário.
4. Em **Posições registradas**, escolha o período de até 31 dias e o indicador a comparar. O padrão é de 14 dias, incluindo hoje.

O **primeiro registro de cada dia e unidade é preservado**. Outra pessoa ou uma repetição da ação consulta esse registro, sem substituí-lo pelos números de uma fila que mudou depois. É uma observação gerencial, não um fechamento contábil. Se a unidade ativa tiver mudado, o registro é recusado e a tela pede atualização.

O painel não registra posições apenas por ser aberto. Não há rotina automática enquanto o app está fechado. Para formar uma série comparável, o responsável precisa registrar as unidades e combinar uma rotina de horários e critérios com a empresa. As observações anteriores não são reconstruídas a partir do estoque atual.

| Indicação no histórico | Significado |
| --- | --- |
| Um número, inclusive 0 | Houve uma observação daquele indicador naquela unidade, data e horário. |
| Sem registro | Não há posição registrada para a unidade naquele dia. |
| Área não medida | A posição foi registrada sem acesso àquela área; ampliar o acesso depois não cria um zero retroativo. |
| Sem acesso | O acesso atual não autoriza consultar aquela área da unidade. |

São exibidos somente os dias com alguma posição registrada nas unidades comparadas. Dias sem observação não são preenchidos nem conectados como uma sequência contínua. Horários diferentes, composição da fila e mudanças de acesso precisam ser considerados na análise. Uma redução de contagem, isoladamente, não comprova melhoria causada pelo ERP.

## Acesso e exportação

Consultar requer permissão de relatórios (`reports:read` ou `reports:view`) e acesso a ordens ou inventário. A unidade precisa estar ativa, com organização e vínculo ativos. A autorização é conferida no banco para cada unidade; o acesso em UCA não concede acesso a Capacle. Áreas restritas permanecem sem contagem, inclusive no histórico e no CSV.

Registrar uma posição exige ainda `reports:read` ou `reconciliation:write`. O Auditor pode consultar e exportar sem registrar posições. O registro guarda apenas indicadores agregados, sem nomes de recebedores, notas de tratamento, custos ou senhas. Os dados completos da posição não aparecem na auditoria geral, evitando contornar a autorização por área. Administradores do banco continuam tendo acesso técnico aos registros.

**Exportar posição** baixa um CSV com a consulta atual e as posições do intervalo, identificadas separadamente. São informados unidade, indicador, data, horário, contagem, cobertura de datas de abertura e disponibilidade. Uma área indisponível tem campo numérico vazio, enquanto o zero medido é exportado como zero. Os campos são protegidos contra interpretação de fórmulas em planilhas.

## Atualização e limites

Não há nova migração SQL, variável de ambiente ou concessão automática de permissões. As posições usam auditoria existente, trava por unidade/dia, versão de formato e repetição segura. O estoque, as ordens, as confirmações de recebimento e os custos não são alterados pelo registro gerencial.

As consultas permanecem disponíveis sem a preparação dos responsáveis da etapa 3. Registros legados podem não ter abertura conhecida; isso é informado, sem inventar uma data. O histórico traz até 65 registros por unidade na consulta, com aviso se esse limite for atingido. Aplicações normais geram apenas uma posição por dia/unidade. A janela de 31 dias mantém a comparação limitada e consultável.

Os instaladores Android/Windows não foram recompilados. Clientes que usam o servidor atualizado recebem a interface ao reabrir ou atualizar o app. O painel não integra automaticamente o ERP oficial nem comprova resultados da empresa sem coleta real.

As evidências ficam em [artifacts/management](../artifacts/management). Os testes usam PostgreSQL temporário e componentes reais com APIs fictícias. Nenhum dado da empresa foi alterado, nenhum e-mail foi enviado e nenhuma conta de produção foi autenticada durante essas verificações.

Para repetir a interface, configure uma instalação isolada conforme `scripts/qa-config.mjs` e execute `npm run verify:management`. A regressão usa `npm test` em banco exclusivo de testes. Build, TypeScript e ESLint são verificações separadas.
