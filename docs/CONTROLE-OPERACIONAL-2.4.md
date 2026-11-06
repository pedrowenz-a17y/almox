# Controle de saídas e aplicação de materiais — versão 2.4

Esta revisão atende ao problema de rastreabilidade apresentado pela U.C.A./Grupo Capacle. O Almox complementa o controle operacional; o ERP oficial continua dependendo dos dados e critérios que a empresa disponibilizar. Não foi implantado um conector com um fornecedor desconhecido.

## Retirada produtiva

1. Abrir a O.S. ou O.P. e requisitar produto, localização e quantidade.
2. Reservar o material disponível.
3. Na entrega física, registrar a aplicação na ordem e informar nome e matrícula/identificação de quem retirou. O usuário autenticado fica registrado como entregador.
4. Conferir a ordem. O faturamento exige as requisições atendidas e nenhuma reserva ou devolução pendente. A confirmação autorizada registra a baixa contábil uma única vez.

A identificação do recebedor é uma declaração do operador com histórico. Ela não representa assinatura digital nem uma autenticação independente do funcionário. Registros antigos permanecem sem identificação quando ela não existia; nenhum participante foi inventado retroativamente.

Retirada produtiva não é permitida no formulário de saída avulsa. Exceções não produtivas exigem finalidade e justificativa; outras retiradas também identificam o destinatário. Perda/descarte exige autorização de ajuste de inventário. Classificar corretamente a finalidade continua sendo responsabilidade da equipe.

## Devoluções e pendências

Solicitar devolução cria uma pendência e não altera saldo. O recebimento físico confirmado identifica quem devolveu e quem recebeu: antes do faturamento desfaz a aplicação; depois do faturamento registra entrada vinculada à baixa original. O valor devolvido nunca ultrapassa o consumo elegível.

Um pedido incorreto pode ser cancelado com justificativa, sem registrar entrada. Se uma devolução anterior ao faturamento reduzir a necessidade real da ordem, encerre o saldo solicitado ainda sem compromisso, também com justificativa. Materiais reservados precisam ser liberados antes dessa redução.

O painel **Pendências** separa requisições a aplicar, reservas a entregar, aplicações a faturar, devoluções a receber, contagens a aprovar e conferências vencidas. Os indicadores contam registros; não somam unidades diferentes. A mesma linha pode estar em mais de uma etapa. Cada perfil vê apenas as áreas autorizadas da unidade ativa.

## Conferências periódicas

Em **Conferências periódicas**, um supervisor escolhe localização, periodicidade, primeiro vencimento e responsável ativo da unidade. A contagem usa o inventário existente e inclui os materiais com saldo no local. A agenda não faz contagem automática nem envia notificações externas.

Registrar a contagem não encerra o ciclo: a próxima data avança somente na aprovação. Contagens antigas não podem sobrescrever uma reprogramação nem avançar a mesma ocorrência duas vezes. Se o estoque mudou após a contagem, ela deve ser refeita. O supervisor pode encerrar uma proposta incorreta/obsoleta com justificativa, preservando saldos e histórico.

## Custos e conciliação

**Custos por ordem** usa uma estimativa de materiais: custo cadastral capturado no faturamento, menos devoluções pelo mesmo custo. O preço posterior do produto não altera o histórico. Preços ausentes permanecem desconhecidos e o total fica incompleto; não se convertem em zero. Mão de obra, impostos, frete, rateios e custo médio/PEPS do ERP não estão incluídos. O critério precisa ser homologado pela empresa.

A conciliação aceita CSV de saldo contábil por produto/local ou custo de materiais por ordem faturada. Baixe o modelo na tela, use os códigos da unidade e selecione separador e formato decimal. A prévia valida o arquivo inteiro e mostra diferenças; salvar gera um documento de conferência com auditoria. Nenhuma importação corrige estoque nem envia alterações ao ERP. Itens ausentes do arquivo não são considerados conferidos.

A referência do arquivo não reconstrói o passado: a comparação usa o estado atual do Almox, identificado com data/hora. Movimentações entre a exportação e a comparação devem ser investigadas na revisão. Custos exigem a permissão específica; relatórios de estoque não liberam valores financeiros.

## Atualizar e executar no CMD

Extraia esta versão em uma nova pasta. Preserve o `.env` protegido da sua instalação e seus arquivos próprios antes de substituir qualquer versão. Abra o CMD na pasta de `package.json`:

```bat
npm ci
npm run config:check
npm run doctor -- --network-only
```

Se DNS/TCP falhar, siga [o diagnóstico do banco](DIAGNOSTICO-BANCO.md). Alterar o código não libera uma porta bloqueada na rede. A autenticação HTTPS responder não comprova acesso ao PostgreSQL. Esta entrega foi validada com PostgreSQL isolado; não recebeu as credenciais empresariais para afirmar que sua conexão Supabase foi corrigida.

Com a conexão disponível, revise a migration `20261106160000_operational_controls`, faça backup e aplique primeiro em homologação. Ela adiciona campos, agenda, documentos de conciliação e estado de contagem encerrada; não inventa preços nem identifica saídas antigas. Na base correta e autorizada:

```bat
npm run db:migrate
npm run doctor
npm run build
npm start
```

Mantenha o CMD aberto. Se `APP_URL=http://localhost:3000`, abra exatamente essa origem. Para um banco novo, siga o bootstrap e o provisionamento administrativo do README; não há senha padrão. Atualizar uma base existente não exige recriar usuários nem executar seed indiscriminadamente.

## Validação com a empresa

Ainda precisam ser acordados: códigos das ordens/produtos/locais no ERP, momento e responsável pelo faturamento, tratamento de exceções, cadastro de funcionários, método de custeio, campos da exportação, política de aprovação e frequência de inventários. Faça um piloto com ordens reais autorizadas e compare a contagem física, o saldo contábil, o material aplicado e os custos. O sistema registra o processo; a empresa precisa executá-lo no momento da retirada.

## Verificação desta entrega

Em 6 de novembro de 2026, a instalação limpa (`npm ci`), a compilação de produção, TypeScript e ESLint concluíram sem erro. A suíte completa passou com **157 testes**, sem testes ignorados, em PostgreSQL isolado. Não foram usadas credenciais nem dados da empresa.

Também passaram oito verificações de interface com componentes reais e APIs fictícias, duas de concorrência na leitura do CSV, dez de bloqueio de acesso anônimo/origem externa no servidor de produção local e quatro de atualização de uma base fictícia com registros legados. Esses testes não comprovam login no Supabase real, acesso a partir da escola ou integração com o ERP oficial.

As evidências estão em [artifacts/operational-controls](../artifacts/operational-controls). Prévias com dados fictícios:

- [Painel de pendências](../artifacts/operational-controls/pendencias-desktop.png)
- [Entrega identificada](../artifacts/operational-controls/entrega-identificada.png)
- [Conferências periódicas](../artifacts/operational-controls/conferencias-desktop.png)
- [Custos por ordem](../artifacts/operational-controls/custos-desktop.png)
- [Conciliação por arquivo](../artifacts/operational-controls/conciliacao-desktop.png)
- [Formulário no celular](../artifacts/operational-controls/conciliacao-mobile.png)
