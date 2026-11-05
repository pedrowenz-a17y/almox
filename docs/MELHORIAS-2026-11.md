# Navegação, visual e novas ferramentas do almoxarifado

Revisão de 5 de novembro de 2026, realizada a partir do pacote Almox-UCA-ERP-v2_0_0.zip. As alterações estão no código-fonte deste pacote. Nenhum ambiente ou site foi publicado.

## O que mudou

### Navegação

A interface principal passou da página dinâmica para um layout persistente. Antes, cada troca de rota remontava o ERP e repetia a consulta do catálogo/estoque e da sessão. Os links internos agora usam a integração oficial da History API com o Next.js, preservando o painel e atualizando a tela pelo pathname. Login, logout, endpoints e destinos externos continuam fora dessa navegação.

O carregamento inicial do cliente passou de `/api/me` + `/api/data` + consulta adicional de perfis para uma chamada a `/api/data`, que retorna também o contexto autorizado do usuário e os perfis já consultados. As APIs continuam verificando identidade, unidade e permissão em cada requisição; nenhuma sessão foi tornada pública ou armazenada em cache global.

Formulários, compras, ordens, relatórios, etiquetas e scanner são carregados sob demanda. O cálculo repetido de saldo por produto passou a usar um índice por snapshot, em vez de percorrer todos os saldos para cada linha e indicador. A lista de produtos usa o valor diferido da busca para evitar bloquear a digitação.

O botão Atualizar permanece disponível. Ao retornar à janela depois de 30 segundos, o ERP atualiza os dados. Não há atualização em tempo real entre computadores: a navegação reaproveita o último snapshot e novas escritas ou atualização explícita consultam o servidor. Erros de sessão/permissão limpam o conjunto de dados do cliente.

### Visual e animações

Foram preservadas a marca e as imagens oficiais U.C.A. A revisão usa grafite, vermelho da marca, superfícies de trabalho claras e tipografia de título Barlow Semi Condensed, hospedada no próprio projeto. A licença da fonte está em `public/fonts/OFL-Barlow.txt`.

O dashboard ganhou atalhos de consulta, reposição e contagens pendentes, com textos ligados à rotina de materiais. Foram acrescentadas transições de tela, abertura de diálogos, confirmação, resposta dos botões, crescimento das barras do gráfico, progresso de atualização e linha de leitura da câmera. A preferência de movimento reduzido desliga essas animações.

Skills públicas consultadas e aplicadas:

- [Frontend Design — Anthropic](https://github.com/anthropics/skills/tree/main/skills/frontend-design): identidade específica, hierarquia, textos diretos e movimento com finalidade.
- [React Best Practices — Vercel](https://github.com/vercel-labs/agent-skills/tree/main/skills/react-best-practices): imports dinâmicos, redução de consultas repetidas e índices para buscas recorrentes.

As skills foram lidas como orientação de desenvolvimento. Não foi instalado plugin nem executado código desses repositórios.

### QR Code automático por produto

Ao cadastrar um produto, o ERP abre sua ficha em `/produto/UUID`, com QR Code pronto para leitura, download PNG e impressão de etiqueta de 60 × 40 mm. O código é derivado do UUID já existente; não depende de nova coluna, migration ou saldo e permanece estável quando o nome ou código interno é editado.

Produtos já cadastrados também têm QR: abra seus detalhes e selecione **Abrir ficha e QR Code** ou use **Consulta rápida**. A ficha mostra disponibilidade e locais de armazenamento. O endpoint `/api/products/UUID/qr` verifica a sessão e a unidade antes de gerar SVG/PNG.

O leitor geral aceita produto ou localização. O leitor usado para escolher origem/destino de movimentação continua aceitando somente localização, para evitar usar um produto como endereço físico. A leitura nunca concede permissão nem troca a unidade automaticamente. URLs de outro sistema, com credenciais ou parâmetros inesperados são recusadas.

Para escanear em outro aparelho, configure `APP_URL` com uma origem HTTPS alcançável por ele e alinhe a configuração do Supabase. Uma etiqueta apontando para localhost só identifica o próprio dispositivo que a abre.

### Consulta rápida

Nova tela `/consulta`, disponível na navegação. Busca por nome, código interno, SKU, código de barras e fabricante, ignorando acentos no texto. Cada resultado informa o disponível e abre a ficha com saldo por localização e QR. A busca usa o snapshot autorizado da unidade, sem requisição a cada tecla. Exibe até 40 resultados e pede refinamento quando necessário.

A busca global permanece disponível e pode receber foco com Ctrl K ou Cmd K; Escape fecha a busca.

### Lista de reposição

Nova tela `/reposicao` e endpoint `/api/replenishment`, com permissão `purchases:read`. A lista considera produtos ativos abaixo do mínimo ou com disponível zerado. Calcula valores exatos com Decimal:

```text
disponível = registrado − reservado − aplicado
pendente de compra = soma de pedido − recebido, somente em pedidos OPEN
meta = máximo cadastrado, ou mínimo se não há máximo
sugestão = máximo entre zero e (meta − disponível − pendente de compra)
```

Exemplo: meta 30, disponível 3 e 12 ainda em compra resultam em sugestão de 15. Recebimentos parciais não são descontados duas vezes. Pedidos concluídos/cancelados não entram como pendência. Produto zerado sem mínimo/meta aparece para parametrização, sem inventar uma quantidade a comprar.

É possível filtrar por fornecedor ou material e exportar a seleção em CSV. A exportação trata campos que poderiam ser interpretados como fórmula em planilhas. A lista não expõe custos, não cria pedidos automaticamente e não altera o estoque. O usuário pode consultar Compras para registrar o pedido revisado.

## Como atualizar e executar localmente

Preserve sua configuração `.env` e seu banco. O ZIP novo não contém credenciais e não deve substituir os valores reais. Esta revisão não acrescenta migrations nem altera o schema do banco; não use reset ou seed de demonstração.

Com as variáveis já configuradas conforme o README:

```bash
npm ci
npm run db:generate
npm run build
npm start
```

Para desenvolver, use `npm run dev`. Esse modo compila código e pode demorar na primeira abertura de um módulo. Compare a experiência normal com build de produção (`npm run build` e `npm start`). O primeiro acesso ainda depende da conexão ao Supabase/PostgreSQL e do volume do catálogo; a revisão elimina consultas/renderizações repetidas na navegação, mas não elimina latência dos serviços externos.

## Validação desta revisão

| Verificação | Resultado e alcance |
| --- | --- |
| TypeScript e ESLint | Aprovados após as alterações. |
| Compilação Next.js | Aprovada, com as novas rotas, layout e componentes. Foi executado `next build` após gerar o cliente sem engines; o fluxo completo `npm run build` com download da engine nativa permanece bloqueado pela rede desta nuvem. |
| Regras e integração | 86 testes aprovados, zero falhas e zero skips em PostgreSQL 18.6 exclusivo de testes. Inclui estoque, concorrência, inventário, compras, ordens, acesso, QR e reposição. As cinco migrations SQL foram aplicadas nessa base. |
| Driver usado nos testes | Adaptador oficial `@prisma/adapter-pg` 6.19.3 com cliente Prisma JavaScript gerado somente no laboratório. Um hook externo selecionou esse cliente nas instâncias dos testes; consultas, transações e saldos atingiram PostgreSQL real, sem simulação de SQL. O schema e as dependências de produção do ERP foram preservados. |
| Compatibilidade dos testes | Consultas de metadados passaram a converter explicitamente o tipo PostgreSQL `name` para `text`, compatível com os dois drivers. Nenhuma asserção foi removida. |
| Interface no Chromium | 10 verificações aprovadas em laboratório separado, usando os componentes reais com respostas de API fictícias. Inclui navegação, pesquisa, scanner manual de produto, download PNG, exportação, cadastro seguido de QR, voltar/avançar e responsividade. |
| Navegação | Após a carga inicial, quatro trocas de tela não fizeram novas chamadas a `/api/data` nem buscaram novos documentos/RSC. Esse resultado mede requisições no laboratório, não promete um tempo fixo na máquina do usuário. |
| Acessibilidade/responsividade | Verificados 1440, 768, 390 e 320 px, ausência de transbordamento horizontal e respeito a movimento reduzido. |
| Supabase hospedado e equipamentos | Não homologados nesta revisão: login real na instalação da empresa, e-mail, dados reais, câmera física e impressora dependem do ambiente do usuário. O laboratório visual não valida autenticação de produção. |

Evidências atuais: `artifacts/workshop/domain-tests.log`, `artifacts/workshop/ui-checks.json`, screenshots e registros de lint/tipos/build. Os artefatos antigos foram preservados como históricos e não devem ser confundidos com os desta revisão.

## Restrição de rede encontrada

O proxy desta nuvem recusou o domínio oficial `binaries.prisma.sh`, necessário à instalação normal das engines do Prisma. Não foi desativada validação de checksum/TLS. Foram usadas ferramentas oficiais de geração sem binário e o adaptador JavaScript apenas para ampliar a validação isolada.

Foi salvo no rascunho de rede somente o acréscimo de `binaries.prisma.sh`, preservando os presets existentes. Isso não aplicou a mudança ao runtime nem publicou o ambiente. A inicialização normal com engine nativa nesta nuvem permanece pendente de acesso a esse destino. A configuração e os comandos normais do aplicativo foram preservados para o ambiente local.
