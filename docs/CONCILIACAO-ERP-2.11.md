# Conciliação com o ERP — versão 2.11.0

A etapa 5 organiza a conferência entre o Almox e uma exportação do ERP da empresa. O arquivo pode usar nomes próprios para as colunas, cada diferença recebe uma análise e a revisão fica registrada com o nome da pessoa responsável. A entrega mantém os custos de materiais por ordem e separa a comparação de estoque da comparação financeira.

O fluxo de conferência está implementado. A homologação pela empresa e a conexão automática com o ERP continuam dependendo do sistema utilizado, de arquivos reais e dos critérios fornecidos pelo responsável. Não foi declarada uma integração com um produto que a empresa ainda não identificou.

## Como usar

1. Abra **Custos e conciliação → Conciliação com ERP → Importar arquivo** na unidade correta.
2. Escolha estoque por local ou materiais por ordem faturada. Informe o ERP, o nome e a data/hora do relatório.
3. Selecione o CSV e associe as colunas de unidade, produto/ordem, local e quantidade/custo. Há um modelo para baixar. As colunas extras ficam fora da conferência.
4. Descreva o corte dos lançamentos e confirme o critério do relatório. Visualize as diferenças antes de registrar.
5. Outra pessoa autorizada abre o documento e escolhe **Revisar documento**. Cada diferença precisa de causa, análise e referência, como uma O.S., O.P., nota ou registro de conferência.
6. O revisor conclui a conferência, conclui com ressalvas ou devolve para análise. O histórico e a exportação incluem o parecer e as referências.

**Nova conferência** reaproveita o arquivo e a data/hora original do ERP em um formulário para rever os critérios. Ao visualizar, consulta os valores atuais do Almox; ao salvar, cria outra revisão. O documento anterior permanece acessível e indica a revisão seguinte. É possível rever o corte e os critérios em uma revisão explícita; a exportação repetida não substitui silenciosamente o documento existente.

| Situação | Significado |
| --- | --- |
| Em revisão | Documento registrado, aguardando outra pessoa autorizada |
| Conferido | Linhas comparadas sem diferenças e revisão concluída |
| Com ressalvas | Diferenças analisadas, com referências registradas; os valores permanecem diferentes |
| Devolvido para análise | O revisor registrou o que precisa ser conferido ou corrigido |
| Registro anterior | Documento criado antes deste acompanhamento, preservado sem confirmação retroativa |

Uma conferência com custos históricos ausentes pode ser devolvida, mas não concluída como completa. Se os valores do Almox mudarem depois do registro, o servidor exige uma nova conferência antes de aceitar a conclusão. O parecer analisa o documento; eventuais correções devem ocorrer no processo de origem, com a autorização correspondente.

## Regras do arquivo e dos valores

- Até 1 MB, 1.000 linhas de dados e 32 colunas quando há associação explícita. Cabeçalhos precisam ser preenchidos e diferentes. Não é feita escolha automática por nomes parecidos.
- Cada campo usa uma coluna diferente. Arquivos sem associação continuam aceitando os cabeçalhos anteriores: `unidade;produto;local;quantidade` e `unidade;ordem;custo`.
- A coluna de unidade precisa corresponder ao código da unidade selecionada. Produtos, locais e ordens precisam existir nela. Cada produto/local ou ordem aparece uma vez; nenhuma linha é importada parcialmente quando há erro.
- Quantidades devem usar a unidade de medida do cadastro. Não há conversão automática de caixas para peças, quilogramas para gramas ou códigos diferentes entre sistemas.
- Separador e formato decimal são explícitos. Não use separadores de milhar. Estoque aceita três casas decimais; custo, duas.
- Estoque compara o **saldo contábil**, antes de descontar reservas e aplicações ainda abertas. Faturamento e retirada física são eventos diferentes.
- Custos comparam apenas **materiais de ordens faturadas, em reais**. O custo cadastral capturado no faturamento é mantido como histórico; devoluções usam o mesmo valor. Mão de obra, frete e custos indiretos não compõem esse total. O preço atual não substitui um histórico ausente.
- A diferença é **Almox − ERP**. A comparação abrange somente as linhas do arquivo. Uma linha ausente não é considerada conferida.
- A consulta usa o estado atual do Almox, com data/hora registrada. A referência do ERP não reconstrói o estoque ou o custo em uma data passada. A empresa precisa definir como alinhar os cortes.

## Repetição, revisão e acesso

Uma identificação SHA-256 considera a unidade, o tipo, a referência normalizada e os códigos/valores usados na comparação. Ordem das linhas, separador, representação decimal equivalente e colunas descartadas não criam outra conferência. Repetir a exportação abre o documento existente, inclusive se outra pessoa o importou. Critérios divergentes exigem uma revisão explícita.

O documento de comparação permanece imutável. O parecer é um recibo separado em `AuditLog`, com ação `RECONCILIATION_REVIEWED`, dentro da mesma transação do registro de repetição segura. Não é necessário criar tabelas nesta etapa. Consultas derivam a situação do recibo e do vínculo com a revisão seguinte; a lista carrega resumos, enquanto o documento completo traz linhas e análises.

O servidor verifica novamente o acesso ativo da pessoa à unidade e as permissões do perfil antes de gravar. Criar e revisar exigem `reports:read` ou `reconciliation:write`, além de acesso a relatórios. Custos exigem também `costs:read`. O autor não conclui sua própria conferência, inclusive se for administrador. O Auditor continua podendo consultar e visualizar prévias, sem registrar ou revisar documentos. Nenhum perfil ou vínculo existente recebe permissões automaticamente.

Os pareceres de custos podem conter valores no texto livre. Por isso, documentos financeiros e seus recibos também ficam fora da auditoria geral de perfis sem acesso a custos. A proteção vale no servidor, não apenas na aba visível.

Importações e revisões simultâneas usam transações serializáveis, trava por arquivo/documento e repetição segura. Uma revisão concluída recebe um único parecer. Uma nova revisão preserva a anterior. Nenhuma dessas operações altera o saldo, dá baixa, aplica materiais ou envia lançamentos ao ERP oficial.

## O que confirmar com a empresa

Para a homologação, é preciso validar uma exportação real de cada unidade e um conjunto conhecido de saldos/ordens. O responsável deve confirmar os códigos equivalentes, as unidades de medida, o corte dos lançamentos, a política de baixa no faturamento e a composição dos custos. Também precisa definir quem revisa e quem corrige cada tipo de divergência.

A integração automática só deve ser configurada quando houver identificação do ERP, documentação da API/exportação, acesso autorizado e exemplos de eventos. Identificadores externos, tratamento de reenvios e fila de falhas precisam seguir esse contrato. O fluxo por CSV desta versão não presume essa conexão nem movimenta o ERP da empresa.

## Validação

A regressão utiliza PostgreSQL temporário com as migrações do projeto e dados exclusivos de teste. Ela cobre associação de colunas, descarte de campos extras, repetição entre pessoas e formatos, concorrência, revisão independente, justificativa de todas as diferenças, histórico incompleto, alteração de saldo, revisões encadeadas, acesso revogado, documentos antigos e restrição de pareceres financeiros.

A verificação de interface usa os componentes reais com respostas fictícias de API, incluindo os fluxos das etapas anteriores. Confere importação, prévia, repetição, revisão, devolução, arquivo inválido, exportação, custos, temas e larguras de 320/390 pixels. Não realiza operações no banco da empresa.

Para repetir a interface, use um servidor **local exclusivo de testes**, configure `QA_ENVIRONMENT=isolated`, `QA_BASE_URL` e `QA_UNIT_ID` conforme `scripts/qa-config.mjs` e execute `npm run verify:reconciliation`.

Os resultados e imagens desta entrega ficam em [artifacts/erp-reconciliation](../artifacts/erp-reconciliation). Não foi realizada homologação com dados da empresa nem login em uma conta de produção.
