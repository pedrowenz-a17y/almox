# Auditoria funcional do Almox ERP e plano de evolução

Revisão de 12/11/2026, sobre a versão 2.7.2 e a alteração visual 2.7.3.

Atualizações posteriores: a versão 2.7.4 implementa a aprovação independente de contagens; a versão 2.8.0 entrega os [modelos de acesso por responsabilidade](PERFIS-DE-ACESSO-2.8.md). A versão 2.9.0 acrescenta [turnos, responsáveis e prazos](TURNOS-E-PENDENCIAS-2.9.md), cuja ativação exige a nova migração no banco. A versão 2.10.0 entrega [convites, primeiro acesso e recuperação](PRIMEIRO-ACESSO-2.10.md), com configuração externa de domínio/e-mail ainda necessária. O achado abaixo descreve a situação na data da auditoria; consulte a [etapa 1 concluída e o plano de evolução](EVOLUCAO-POR-ETAPAS.md).

## Conclusão para o TCC

O Almox tem recursos compatíveis com o problema relatado pelo Grupo Capacle/U.C.A.: controlar a saída, identificar a ordem e os responsáveis, acompanhar pendências e comparar o estoque. A prioridade é validar esse processo com a empresa e medir as divergências. Acrescentar financeiro, folha de pagamento ou CRM agora aumentaria o escopo sem atacar a principal falha descrita.

A empresa já possui um ERP. O Almox deve ser apresentado como um sistema de apoio ao controle de materiais e à conciliação com esse ERP, até que sejam definidos os limites e a integração entre os dois. Duas bases com baixa independente podem criar novas divergências. A política atual de baixa no faturamento precisa ser confirmada pelo responsável da empresa; retirar fisicamente um material e baixá-lo contabilmente são eventos distintos.

## Alcance e limites desta revisão

Foram inspecionados o código de autenticação e autorização por unidade, perfis iniciais, serviços de estoque/ordens/inventário, painel de pendências, custos, conciliação, navegação e estilos. As páginas públicas de login e instalação responderam HTTP 200. O endpoint público `/api/health` respondeu `{"status":"ok"}`: o teste `SELECT 1` do servidor alcançou o PostgreSQL naquele momento. Isso não valida todas as tabelas, o cadastro de um usuário ou uma operação completa.

As telas internas foram examinadas com os componentes reais e respostas de API fictícias, em ambiente local. Nenhuma conta real foi utilizada, nenhum e-mail foi enviado e nenhum estoque, perfil ou configuração remota do Supabase/Vercel foi alterado por esta auditoria. Esta é uma revisão funcional e de interface, não um teste de invasão nem uma homologação da operação empresarial.

## O que já existe e o que ainda falta validar

| Necessidade da empresa | Recurso encontrado | Limite ou validação pendente |
| --- | --- | --- |
| Identificar o destino da retirada | Requisições, reservas e aplicações em O.S./O.P.; retirada produtiva exige ordem | Conferir os códigos das ordens e treinar a equipe para registrar no momento da saída |
| Saber quem entregou e retirou | Entregador autenticado e nome/identificação do recebedor no evento | Nome digitado é um registro feito pelo entregador; não equivale a uma confirmação independente do recebedor |
| Regularizar aplicações e devoluções | Painel com requisições, reservas, aplicações a faturar e devoluções a receber | Falta prazo/responsável por pendência de ordem e escalonamento automático |
| Conferir o estoque com frequência | Inventário com aprovação, proteção contra contagem obsoleta e agenda recorrente | A equipe ainda deve executar as contagens; não há um serviço de notificações periódicas fora do app |
| Comparar o sistema com o ERP oficial | Conciliação por CSV com prévia, diferenças e histórico | Não é integração automática e não corrige saldos; falta homologar o arquivo e os critérios com a empresa |
| Apurar materiais por ordem | Custo cadastral capturado no faturamento e devoluções vinculadas | É estimativa de materiais; não inclui mão de obra, perdas rateadas, impostos, frete nem método de custeio oficial |
| Acesso por unidade | Perfis associados a UCA/CAPACLE e autorização no servidor | Criar a identidade no Supabase não basta: ela deve estar vinculada ao usuário e ao acesso ativo na unidade |
| Compartilhar informações entre aparelhos | Base de dados no servidor, atualização após operações e ao retornar ao app após 30 segundos | Uma tela já aberta em outro aparelho não recebe atualização contínua em tempo real |

## Achados e recomendações por prioridade

### Prioridade 1 — responsabilidades e confiabilidade operacional

1. **Definir responsável por turno na UCA.** Como não há almoxarife fixo, registrar o responsável de cada turno e oferecer um encerramento com pendências e passagem para o próximo responsável. Aceite: toda entrega possui autor, recebedor, ordem e horário, e pendências não desaparecem na troca de turno. Exige uma regra operacional da empresa, além da tela.
2. **Separar contagem de aprovação.** Hoje `approveInventoryCount` exige `inventory:adjust`, mas não impede que um usuário com essa permissão aprove uma contagem criada por ele. Supervisor e administrador possuem contagem e ajuste nos perfis iniciais. Implementar regra no servidor para aprovações independentes, com eventual exceção administrativa justificada conforme política da empresa. Aceite: o próprio autor não aprova sua contagem pelo fluxo comum; outra pessoa autorizada pode aprovar, com histórico preservado. Essa regra ainda não foi alterada nesta entrega.
3. **Melhorar o ciclo de convite e primeiro acesso.** Exibir estados verificáveis de identidade vinculada, acesso na unidade, convite e ativação; distinguir autenticação, conta inativa, origem não autorizada e indisponibilidade do envio. Configurar o endereço canônico e um provedor SMTP adequado. Aceite: um novo colaborador recebe um link válido, define sua senha e entra somente nas unidades autorizadas. O limite 429 de envio é do serviço de e-mail e não se resolve trocando a senha do banco.
4. **Homologar a conciliação com o ERP oficial.** Definir o ERP utilizado, API/exportação disponível, códigos de produto/ordem/local, janela de corte e responsável pela baixa. Começar pelo CSV existente. Uma futura integração precisa de identificador externo, repetição segura, fila de erros e revisão de divergências. Aceite: importar novamente o mesmo evento não duplica baixa nem aplicação.

### Prioridade 2 — acompanhamento e novas funções

5. **Fila de pendências com prazo e responsável.** Acrescentar responsável, vencimento, motivo e idade de cada etapa. Hoje as pendências de materiais usam a criação da ordem como referência e não têm vencimento próprio. Aceite: identificar há quanto tempo uma entrega aguarda aplicação ou faturamento, sem confundir esse tempo com a idade da ordem.
6. **Indicadores de resultado para o TCC.** Medir retiradas produtivas vinculadas a ordem, entregas identificadas, pendências por faixa de atraso, conferências realizadas no prazo e acurácia por produto/local. Usar comparação física com tolerância aprovada; não somar unidades incompatíveis nem confundir saldo contábil com físico. Aceite: cada indicador informa período, unidade, numerador, denominador e origem dos dados, com possibilidade de abrir os registros.
7. **Confirmação independente de recebimento.** Permitir que o recebedor autorizado confirme a entrega e que divergências de quantidade sejam encaminhadas para revisão. Um QR pode localizar a entrega, mas não deve substituir autenticação nem permitir aprovar em nome de outra pessoa. Aceite: armazenar quem confirmou e quando, além do registro do entregador.
8. **Atualização entre aparelhos.** Adotar consulta periódica moderada quando a tela estiver visível ou notificações de alteração por unidade; manter a API como fonte autorizada. Aceite: a operação registrada em um aparelho aparece no outro dentro de um prazo definido, preservando rascunhos e a separação entre unidades.
9. **Inventário orientado ao risco.** Classificar materiais por criticidade, movimentação e valor quando autorizado; definir frequências diferentes e, se aprovado, contagem cega. Aceite: materiais críticos vencidos aparecem primeiro e o mesmo registro não gera duas conferências da mesma ocorrência.

### Prioridade 3 — somente após o piloto

10. **Lista de materiais por O.P. e consumo previsto versus realizado.** Requer composição técnica validada, unidade de medida e versão da lista; acompanhar desvios e sobras. Não pressupor que o custo cadastral atual é o custo de produção.
11. **Reposição por consumo e prazo do fornecedor.** Evoluir a reposição por mínimo já existente com histórico confiável, prazo e estoque de segurança. Não apresentar previsão estatística como certeza.
12. **Lotes, número de série, validade e quarentena.** Implementar se os materiais utilizados exigirem essa rastreabilidade. Não adicionar campos obrigatórios sem uma necessidade operacional confirmada.

## Cargos e perfis propostos

Cargo é uma função da empresa; perfil é o conjunto de permissões no sistema. Uma pessoa pode ter perfis diferentes em UCA e CAPACLE. O código hoje inicializa **ADMINISTRADOR, SUPERVISOR e OPERADOR**. A proposta abaixo ainda não cria perfis nem altera o acesso das contas existentes.

| Perfil proposto | Trabalho permitido | Limite a implementar ou manter |
| --- | --- | --- |
| Administrador do sistema | Contas, acessos e configurações da unidade | Não deve ser o perfil padrão de todos os colaboradores; decisões de estoque seguem a política de aprovação |
| Almoxarife / responsável do turno | Receber, entregar, registrar aplicação/devolução e consultar estoque | Sem gestão de usuários, custo gerencial ou aprovação da própria contagem |
| Solicitante da produção | Solicitar materiais para suas ordens e confirmar o que recebeu | Exige vínculo de pessoa/equipe à ordem e autorização por registro; não liberar todas as ordens apenas pelo nome do perfil |
| Conferente de estoque | Executar contagens e acompanhar suas ocorrências | Sem efetivar ajustes; avaliar contagem cega com a empresa |
| Supervisor da unidade | Rever pendências, autorizar ajustes e exceções documentadas | Aprovação independente e escopo da unidade; faturamento somente se fizer parte de sua função |
| Comprador | Compras, fornecedores e acompanhamento dos recebimentos | Não aplicar material em ordem ou ajustar estoque por consequência desse perfil |
| Analista de custos / controlador | Custos por ordem, relatórios e conciliação | Sem saída de material nem aprovação de inventário; restringir dados financeiros explicitamente |
| Auditor / consulta gerencial | Leitura de relatórios e trilhas da unidade autorizada | Sem escrita, gestão de contas ou acesso financeiro por padrão |

Algumas dessas separações não cabem nas permissões atuais. Por exemplo, `stock:move` agrupa tipos de movimentação, `orders:apply` cobre mais de uma ação e a leitura depende também das respostas de `/api/data`. Antes de cadastrar novos perfis, revisar cada endpoint, separar permissões necessárias e testar chamadas diretas à API, além de esconder os botões. Alterar o seed sozinho não aplica uma política de segregação completa.

## Modo escuro entregue nesta revisão

- Escuro como padrão, com superfícies grafite, texto claro e vermelho UCA preservado. Foto do implemento no painel e logomarca continuam com suas cores.
- Botão de sol/lua na barra superior do ERP e troca de tema no login, recuperação de senha e instalação. O tema claro continua disponível.
- Preferência salva no navegador/dispositivo e sincronizada entre abas da mesma origem; não é uma preferência de conta sincronizada entre aparelhos.
- A preferência é aplicada antes da hidratação para evitar a abertura com o tema errado. Se o armazenamento estiver bloqueado, a troca funciona na página atual.
- Tabelas, modais, formulários, busca, avisos, assistente e navegação móvel adaptados; QR mantém fundo branco e impressão usa cores claras.
- Não requer migração de banco nem uma nova permissão. Os APK/EXE já distribuídos não foram recompilados: o conteúdo web usa o tema quando aponta para o servidor atualizado.

## Roteiro de validação com a empresa

1. Selecionar uma unidade e um conjunto pequeno de materiais, ordens e colaboradores autorizados.
2. Registrar o estoque físico inicial e o saldo do ERP com o mesmo horário de corte.
3. Executar recebimento, reserva, entrega identificada, aplicação, devolução e faturamento; testar também exceções e tentativas repetidas.
4. Realizar contagem independente e conferir a conciliação com o ERP oficial.
5. Comparar as mesmas métricas antes e depois do piloto; registrar adesão ao processo e limitações dos dados. Metas e tolerâncias devem ser aprovadas pela empresa, sem inventar percentuais de melhoria.

## Referências consultadas

- [TOTVS — O que é ERP?](https://www.totvs.com/blog/erp/o-que-e-erp/), acesso em 12/11/2026. Fundamenta integração de módulos, centralização dos dados e escolha do escopo por necessidade operacional.
- [IBM — Planejamento de recursos empresariais](https://www.ibm.com/br-pt/think/topics/enterprise-resource-planning), acesso em 12/11/2026. Fundamenta integração de processos, fonte de informação consistente e seleção de módulos conforme o negócio.

Os artigos contextualizam o conceito de ERP; não comprovam requisitos, integração ou resultados desta empresa. As recomendações acima cruzam esses conceitos com o problema relatado e com a inspeção do código.

A compilação de produção, TypeScript, ESLint e 14 verificações de interface passaram. As medições de contraste cobrem amostras das telas e não certificam toda a acessibilidade do produto. A impressão foi verificada por emulação CSS; não houve teste em impressora física.

Evidências visuais e de verificação: [artifacts/theme-audit](../artifacts/theme-audit). As prévias internas usam dados fictícios e não representam o estoque da empresa.
