# Assistente do almoxarifado — versão 2.5.0

O assistente aceita mensagens curtas em português e ajuda com as regras e os registros do ERP. O modo padrão é **local, sem créditos de API**. Ele reconhece temas, trata algumas abreviações/erros de escrita, faz comparações numéricas e pede esclarecimento quando encontra mais de uma peça. A interpretação usa regras do domínio; não houve treinamento de um modelo generativo.

## Usar sem pagar uma API de IA

Abra o botão **Assistente** na barra superior. Você pode perguntar:

- “Onde fica o rolamento?”
- “Posso tirar 5 do ROL-6204?”
- “E 10?” e, depois, “e 20?”
- “Por que o estoque não bate?”
- “Quais devoluções estão pendentes?”
- “O que está abaixo do mínimo?”
- “A O.S. 42 pode ser faturada?”
- “Qual o custo da O.S. 42?”

Os códigos acima são exemplos. Use os códigos cadastrados na sua unidade. Ao haver várias correspondências, o assistente apresenta opções e pede o código. Uma correspondência apenas aproximada também precisa ser confirmada. As sugestões preenchem a pergunta; enviar continua sendo uma ação explícita.

Sem marcar **Consultar dados da unidade atual**, ele oferece orientação, sem consultar registros. Ao marcar, consulta os dados autorizados da unidade selecionada. Cada resposta informa se consultou registros e quando isso ocorreu.

Para deixar o modo local explícito, salve no `.env`, pelo Bloco de Notas:

```dotenv
ASSISTANT_PROVIDER="local"
```

A ausência dessa variável também escolhe o modo local, mesmo se existir uma chave OpenAI antiga no ambiente. O modo local não usa a chave para responder nem chama um provedor de IA. O servidor do ERP, Supabase Auth e PostgreSQL continuam necessários para login e acesso aos dados; isso não é um chat que funciona com o servidor desligado.

## O que ele compara

**Estoque e retirada:** contábil, físico esperado, reservado, aplicado sem baixa e disponível, por produto/local. Uma quantidade de retirada é comparada com os locais ativos. Se a quantidade só puder ser atendida por várias posições, isso aparece na resposta. Local, setor ancestral ou almoxarifado inativo não é tratado como origem livre. kg e unidades não são convertidos automaticamente. Quantidades negativas, zero, precisão indevida ou milhar ambíguo como “1.000” pedem esclarecimento.

**Ordens:** identifica reservas, requisições ainda não atendidas e devoluções pendentes. A análise das quantidades não substitui a validação final na tela da ordem: cadastro ativo, saldo, documento, permissões e faturamento real continuam sendo conferidos. Nenhuma baixa é realizada no chat.

**Reposição e compras:** compara disponível, mínimo e meta, descontando compras abertas. Não compra ou aprova pedidos. Um pedido aberto não comprova entrega nem data de chegada.

**Inventário e devoluções:** orienta a rotina e consulta as pendências autorizadas. Divergência entre físico e contábil pode envolver aplicações ainda sem baixa, não prova perda. Só o recebimento físico confirmado registra uma devolução.

**Custos:** apenas para perfil com `costs:read`, consulta a estimativa de materiais da ordem, usando o preço capturado no faturamento e as devoluções pelo mesmo preço histórico. Custo ausente permanece incompleto. Mão de obra, frete, impostos e rateios não são calculados como custo total.

## Conversa, limites e privacidade

O histórico fica na memória da interface, até 20 mensagens. O envio usa até quatro turnos recentes. Para continuar uma consulta de peça, guarda uma referência curta de código, quantidade e local; **não guarda um saldo como verdade para a pergunta seguinte**. O saldo é consultado novamente. Os valores escritos no histórico pelo usuário ou pela resposta anterior não substituem os registros do banco.

Limpar conversa, recarregar ou trocar conta/unidade/permissões descarta esse contexto. Fechar cancela a requisição pendente. Trocar o modo no servidor exige uma nova conversa; uma tela antiga em modo local não pode enviar silenciosamente seu histórico à OpenAI.

Não há gravação de conversa no banco. O chat não tem funções de cadastro, movimentação, faturamento, aprovação ou ajuste. Os links abrem as telas em que um usuário autorizado pode revisar e registrar a operação. Solicitações que não entende ou assuntos fora do domínio recebem pedido de esclarecimento, sem inventar uma resposta geral.

A proteção do modo local é de **30 mensagens por minuto por usuário/unidade, por processo**. Isso limita carga do servidor e do banco; não é cota de créditos. Em múltiplas instâncias, esse contador não é global. Perguntas com padrões de chaves ou URLs PostgreSQL são recusadas; ainda assim, não envie senhas, credenciais ou dados pessoais.

## OpenAI opcional

Use este modo somente se quiser a API externa e tiver chave/faturamento próprios. No `.env` do servidor:

```dotenv
ASSISTANT_PROVIDER="openai"
OPENAI_API_KEY="sua_chave_privada"
OPENAI_MODEL="gpt-4.1-mini"
```

Não use `NEXT_PUBLIC_` para essas configurações. Reinicie o servidor após alterar o modo. A interface mostra **OpenAI · API externa** e informa o envio antes da consulta. Pergunta e histórico recente vão para o provedor ao enviar. O resumo só é compartilhado se marcar a opção; ele contém uma amostra limitada e autorizada, sem custos ou identificação de funcionários. Números inseridos manualmente nas suas perguntas podem aparecer no histórico enviado.

O resumo mantém até 30 produtos por código e 15 ordens abertas mais antigas, com até 15 materiais por ordem. Não representa uma auditoria completa. A requisição usa `store: false`; a retenção do provedor segue as políticas e configurações da conta. A assinatura do ChatGPT é separada dos créditos da API.

Há proteção de cinco requisições por minuto no modo OpenAI, resposta limitada a 1.200 tokens e tempo de 25 segundos para o provedor. Os erros distinguem espera temporária, `insufficient_quota` e um erro 429 sem causa identificada. O aplicativo não adiciona créditos, muda orçamento nem repete chamadas automaticamente. Uma nova chave do mesmo projeto não cria créditos.

## Atualizar no CMD

Copie seu `.env` protegido para a pasta da nova versão, junto do `package.json`. Encerre a execução anterior com **Ctrl+C**, para liberar a porta 3000. No CMD:

```bat
npm ci
npm run build
npm start
```

Não há nova migration de banco nesta revisão. Uma base anterior à versão 2.4 precisa primeiro seguir o [guia de controle operacional](CONTROLE-OPERACIONAL-2.4.md). As evidências e prévias desta versão estão em [artifacts/local-assistant-2.5.0](../artifacts/local-assistant-2.5.0).

## Validação desta versão

Compilação de produção, lint e TypeScript passaram. A regressão completa passou em 213 testes, incluindo 49 testes específicos de linguagem, privacidade, escolha do modo e consultas do assistente. Também passaram nove cenários de interface e sete verificações de acesso no servidor de produção.

As consultas foram verificadas com PostgreSQL isolado e dados fictícios. A prévia de interface usa autenticação simulada; não comprova login no Supabase da empresa. Nenhuma chamada à OpenAI foi feita nesta validação.
