# Etapa 6 — validação do processo e indicadores

A versão 2.12.0 acrescenta **Relatórios → Validação e indicadores**. A consulta acompanha os registros de cada unidade e permite documentar um roteiro de validação com resultados, referências e responsáveis. Não exige nova migração e não altera automaticamente estoque, ordens ou permissões.

## Indicadores

O período usa dias completos em UTC−03:00, com limite de 93 dias, encerrado até hoje. As consultas do período selecionado e da janela anterior de mesma duração são feitas na mesma transação. As datas das duas janelas ficam disponíveis nos critérios e na exportação.

| Indicador | Numerador / denominador | Interpretação |
| --- | --- | --- |
| Baixas vinculadas a ordens | Saídas contábeis com O.S./O.P. na mesma unidade / todas as saídas contábeis da janela | Saídas avulsas podem ter finalidade legítima. A taxa não classifica automaticamente toda saída avulsa como erro ou toda baixa vinculada como aplicação correta. |
| Entregas documentadas | Aplicações com entregador correspondente ao autor do evento, recebedor com nome e identificação / aplicações em ordens da unidade | Recebimento declarado pelo operador; não é aceite digital do recebedor. A aplicação física e a baixa no faturamento são eventos distintos e não são somadas na mesma base. |
| Itens contados com diferença | Itens com diferença diferente de zero / itens de contagens aprovadas na janela, pela data da aprovação | Observação registrada na contagem. Não é a divergência física atual nem uma medida de valor perdido. |

Sem denominador, a taxa aparece como **Sem base**, inclusive quando não há dados na janela anterior. Não se exibe 100% nem zero como se fossem resultados observados. Percentuais usam duas casas decimais; os números das bases continuam visíveis.

O quadro **Pendências atuais** conta linhas de materiais com aplicação a regularizar, aplicação aguardando faturamento ou devolução pendente, em ordens abertas/faturadas conforme o tipo. Não soma quantidades de produtos com unidades de medida diferentes. Os três grupos podem se sobrepor e não devem ser somados como total de ocorrências únicas. São uma fotografia da consulta atual, independentemente do período selecionado; não são reconstruídos para a janela anterior.

As consultas usam exclusivamente o `unitId` autorizado. Não entregam valores financeiros, identificações de recebedores ou detalhes de usuários nos indicadores. A janela anterior é uma comparação descritiva, não uma linha de base comprovadamente anterior ao uso do sistema nem evidência causal de melhoria.

## Roteiro e evidências

1. Consulte a unidade e o período desejados e clique em **Iniciar validação**.
2. Informe título, objetivo e a origem declarada: **Demonstração** ou **Piloto com a empresa**. O sistema preserva os indicadores consultados na abertura, com período e horário.
3. Abra cada etapa do roteiro. Confira a responsabilidade prevista, o comportamento esperado e a evidência que deve ser observada.
4. Registre **Passou** ou **Falhou**, descreva o que foi observado e informe uma referência: O.S./O.P., contagem, conciliação ou outro registro de observação.
5. Ao corrigir uma anotação, use **Atualizar resultado**. O último resultado aparece no roteiro, e o histórico preserva os registros anteriores e seus autores.
6. Registre as sete etapas e uma conclusão de pelo menos 20 caracteres. Se algum último resultado for Falhou, o encerramento fica com falhas relatadas. Um roteiro sem falhas no último resultado fica com etapas aprovadas, sem certificação automática.
7. Exporte o CSV ou baixe **o relatório para o TCC em HTML**. Abra o arquivo no navegador e use **Imprimir → Salvar como PDF**. O relatório contém o retrato da abertura, critérios, objetivo, origem, resultados, referências e conclusão. Não depende de scripts, fontes ou serviços externos.

O roteiro não executa as operações descritas nem verifica automaticamente se uma referência externa é autêntica. Demonstrações devem usar uma unidade/base isolada de testes. Pilotos em uma unidade real precisam de autorização e observação da empresa. Escolher a origem no formulário é uma declaração, não cria uma base isolada nem concede autorização corporativa.

O criador pode encerrar uma demonstração, sempre identificada como tal. O encerramento de um **piloto com a empresa exige outra conta autorizada na mesma unidade**. O documento não substitui aprovação formal da empresa. Após o encerramento, novos testes exigem outro roteiro; o histórico anterior permanece disponível.

## Cenário de demonstração sugerido

Os números abaixo são **dados de exemplo para executar em testes**, não resultados alcançados pela empresa.

| Etapa | Ação de teste | Resultado a conferir |
| --- | --- | --- |
| Preparação | Material de teste com saldo inicial de 10 unidades | Registrar o saldo e o local antes de iniciar. |
| Ordem e reserva | Requisitar e reservar 6 unidades na O.S./O.P. | Saldo contábil 10; reservado 6; disponível 4. |
| Entrega | Aplicar as 6 unidades, com entregador e recebedor identificados | Saldo contábil ainda 10; físico calculado 4; aplicado sem baixa 6. |
| Faturamento | Confirmar a referência de faturamento | Uma única baixa de 6; saldo contábil 4. Repetir a mesma operação não duplica a baixa. |
| Devolução | Solicitar e receber 1 unidade de sobra | Saldo 5 e consumo líquido 5; a pendência da devolução fica regularizada. |
| Contagem | Contar 5 unidades e pedir aprovação a outra pessoa | Conferir o registro sem diferença; o autor não aprova sua própria contagem. |
| Conciliação | Usar arquivo de demonstração com o mesmo código/local e saldo 5 | Conferir os critérios e a revisão por outra pessoa. Identificar a origem como demonstração. |

Se a execução produzir outro resultado, registre a diferença, a referência e o que foi observado. Não marque uma etapa como Passou apenas por seguir este roteiro. Na rotina real, as quantidades, o corte do ERP e o tratamento de sobras precisam seguir o processo autorizado pela empresa.

As responsabilidades previstas seguem os perfis existentes: responsável pela ordem, almoxarife/pessoa que retira, pessoa autorizada a faturar, conferente e revisor, analista ou responsável pela conciliação. A designação de pessoas e turnos deve ser definida na unidade. Este roteiro não cria atribuições nem amplia as permissões de execução.

## Coleta para o TCC

Defina com a empresa o período, a unidade, os materiais e as ordens observadas. Registre a fonte, os responsáveis e os critérios usados. Para discutir antes/depois, reúna uma linha de base real com critérios e escopo comparáveis; volumes e composição da amostra diferentes podem mudar as taxas sem que o sistema tenha causado a diferença.

Quando não houver coleta anterior, informe **não disponível**. A comparação automática com a janela anterior só usa registros presentes no Almox. Não comprova, por si, redução de perdas, economia, precisão global de estoque, redução de tempo ou adesão de funcionários. Esses resultados precisam de observação específica, contagens físicas e/ou critérios da empresa. A conexão com o ERP oficial continua dependendo dos dados e regras disponibilizados por ela.

## Acesso e armazenamento

Consultar exige `reports:read` ou `reports:view`. Documentar uma validação exige `reports:read` ou `reconciliation:write`, além da permissão de consulta no vínculo ativo da unidade; o acesso é verificado novamente no banco antes de gravar. O Auditor pode consultar/exportar, sem registrar resultados. Nenhuma permissão foi concedida automaticamente.

Documentos e resultados usam recibos no `AuditLog`, com ações `VALIDATION_STARTED`, `VALIDATION_STEP_RECORDED` e `VALIDATION_CLOSED`. O retrato inicial fica preservado. Atualizações usam versão esperada, transação serializável, trava por documento e repetição segura. Escritas simultâneas com a mesma versão não perdem observações silenciosamente; a interface orienta reabrir/atualizar. Há limite de 100 atualizações de etapa, e o encerramento continua possível nesse limite. A lista traz os 20 roteiros mais recentes da unidade.

Não foi aplicado SQL na instalação, alterado estoque da empresa ou enviado e-mail a usuários nesta entrega. As evidências de desenvolvimento ficam em [artifacts/validation-pilot](../artifacts/validation-pilot); a validação com a empresa só será comprovada pela execução e pelas evidências reais coletadas.
