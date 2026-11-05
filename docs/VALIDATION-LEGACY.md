> HISTÓRICO DA VERSÃO ANTERIOR. Estes resultados não validam a versão U.C.A./Supabase atual.

# Registro de validação

Validação da implementação em 20/10/2026. O ambiente executado usa Next.js 16.4.2, Prisma 6.19.3 e PostgreSQL real, com uma base exclusiva `almox_test` para a suíte de integração. A API foi exercitada no servidor com build de produção em `http://localhost:3000`.

Este registro distingue testes automatizados da homologação no almoxarifado físico. A aprovação dos testes abaixo não representa validação de uma câmera, impressora ou infraestrutura de produção específica.

## Resultados confirmados

| Verificação | Resultado | Evidência / alcance |
| --- | --- | --- |
| TypeScript — `npm run typecheck` | Aprovado | Compilação de tipos sem erros. |
| ESLint — `npm run lint` | Aprovado | Análise do projeto sem erros. |
| Produção — `npm run build` | Aprovado | Next.js gera a aplicação com Prisma Client. O build mantém a verificação de tipos pela API do compilador, além da execução independente de `tsc`. |
| Migrations — `prisma migrate deploy` | Aprovado | As três migrations foram aplicadas sobre banco de testes limpo: modelo inicial, constraints/índices de busca e versão do saldo. |
| Seed e reexecução | Aprovado | Dados iniciais criados; nova execução não duplica registros ou movimentações. |
| Testes — `npm test` | **28 de 28 aprovados** | 23 testes de regras com PostgreSQL e cinco de autenticação, autorização de custos e origem HTTP. |
| HTTP — `npm run verify:api` | **26 de 26 aprovados** | [Resultado detalhado](../artifacts/legacy/api-checks.json), execução iniciada às 13:23:09 de Brasília. Limpeza das fixtures também concluída. |

Os comandos de banco e testes foram executados com variáveis de conexão configuradas no ambiente. Nenhuma senha, cookie de sessão ou hash de senha é necessária neste registro.

## Estoque e inventário

A suíte [stock.integration.test.ts](../tests/stock.integration.test.ts) verifica os serviços usados pela API, sem simular a persistência:

- Entrada de 100, retirada de 15 e transferência de 25: **60 na origem, 25 no destino, 85 no total**, com usuário, data, saldo anterior/posterior, histórico e auditoria.
- Saldo exclusivo por produto/localização e aritmética decimal de três casas.
- Recusa de retirada excessiva, quantidade inválida, ajuste direto pela rota de movimentos, produto/local inativo e transferência para a mesma origem.
- Transferência sem saldo ou com destino inexistente sem efeito parcial.
- Falha na gravação do destino por limite de capacidade numérica desfaz a retirada feita na mesma transação.
- Duas retiradas concorrentes de 80 sobre saldo 100 permitem apenas uma e deixam saldo 20.
- Requisições concorrentes com a mesma chave de idempotência criam apenas um movimento e uma auditoria; reutilizar a chave com outro usuário ou conteúdo é recusado.
- Estoque negativo bloqueado por padrão e permitido apenas quando a configuração está explicitamente habilitada.
- Contagem do operador fica pendente e preserva o saldo até aprovação autorizada; a aprovação registra o ajuste e sua auditoria.
- Repetir contagem ou aprovação não duplica registros ou ajustes.
- Contagem obsoleta é recusada, inclusive se o saldo sofreu movimentos e voltou ao número anterior; a versão do saldo detecta essa situação.
- Inventário com vários produtos é atômico quando um dos itens fica obsoleto.

## Autenticação, permissões e API

A suíte [security.test.ts](../tests/security.test.ts) verifica salt de senha, validação da senha correta, recusa de hashes inválidos, hash do token de sessão, remoção recursiva de custos e bloqueio de origens ausentes/externas.

O verificador HTTP percorreu login e logout reais, proteção de origem, CRUD com relações, unicidade, bloqueio de alteração de saldo pelo cadastro, prevenção de ciclos nas localizações, consulta de QR por UUID/código/URL e geração SVG. Também comprovou os perfis operador/supervisor/administrador, bloqueio de custos, proteção do próprio administrador, sessão revogada após redefinir senha, limite de tentativas de login e validação/autenticação de imagens.

O fluxo 100 → 85 → 60 + 25 foi repetido pela API autenticada. O mesmo roteiro verificou contagem, aprovação por supervisor, retirada concorrente, histórico e auditoria. Os cadastros temporários foram arquivados; seus movimentos e auditorias continuam preservados, conforme as regras do produto.

## Verificações em navegador e relatórios

**19 de 19 verificações do navegador aprovadas**, sem erros no console após remover a dependência de fonte externa. Incluem login, todas as páginas operacionais, QR gerado pelo servidor decodificado por câmera simulada, abertura da localização correta, quatro páginas a 390 px sem transbordamento horizontal e aviso offline. Evidência: [browser-checks.json](../artifacts/legacy/browser-checks.json).

**8 de 8 verificações de operação pela interface aprovadas**: cadastro de Rolamento 6204 e hierarquia Setor A → Estante 02 → Prateleiras 03/04; entrada de 100; retirada de 15; transferência de 25 pelo fluxo de dois códigos no celular; confirmação dos saldos **60 + 25 = 85**, histórico e auditoria; contagem física e aprovação de inventário. A câmera é coberta pelo roteiro anterior; no fluxo de dois códigos foi utilizada a entrada manual dos códigos. Evidência: [operations-checks.json](../artifacts/legacy/operations-checks.json).

**15 de 15 verificações de relatórios e etiquetas aprovadas**: os 11 tipos de relatório foram comparados em JSON, CSV e XLSX, incluindo cabeçalhos, linhas e ausência de fórmulas inesperadas; filtros e datas inválidas foram testados. As etiquetas de 50×30 mm e A4 carregaram todos os QR Codes, passaram nas medições de conteúdo sem cortes e geraram PDFs válidos. Evidência: [reports-labels-checks.json](../artifacts/legacy/reports-labels-checks.json). Exemplos: [50×30 mm](../artifacts/legacy/etiquetas-50x30.pdf) e [A4](../artifacts/legacy/etiquetas-A4.pdf).

As capturas estão em `artifacts/`. Esses testes foram executados em Chromium automatizado; não equivalem à validação de câmera ou impressora física. O servidor final foi iniciado por `npm start`, usando o pacote Next standalone com os arquivos públicos e estáticos copiados pelo script de inicialização.

## Homologação física e limites

Continuam necessários no ambiente da empresa:

- Acesso por HTTPS, permissão de câmera e leitura de etiqueta real em Android/iOS usados pelos operadores.
- Leitura dos dois QR Codes da transferência no trajeto físico e uso com uma mão.
- Impressão real nos formatos escolhidos, escala de 100%, margens e legibilidade sob a iluminação do local.
- Instalação da PWA nos navegadores utilizados e comportamento de conexão instável.
- Medição com volume real, política de backup/restauração e implantação do banco com os acessos adequados.

Não foi executado um teste de carga de grande volume nem uma avaliação externa de segurança. O dashboard carrega catálogo e saldos em uma consulta agregada; as listas iniciais de movimentos, contagens e auditoria são limitadas a 2.000, 500 e 1.000 registros. Os relatórios consultam o banco com filtros e recusam exportações acima de 50.000 linhas. A evolução de paginação e capacidade deve seguir o tamanho da operação.

## Reproduzir

Consulte [README](../README.md#verificação-e-build) para configurar as variáveis e preparar o banco exclusivo de testes. Com a base migrada e o servidor de homologação disponível:

```bash
npm run typecheck
npm run lint
npm test
npm run build
npm start
# Em outro terminal, com APP_URL e credenciais de homologação configuradas:
npm run verify:api
npm run verify:browser
npm run verify:reports
# Somente em homologação: cria produtos, localizações e movimentos reais
ALLOW_QA_WRITES=1 npm run verify:operations
```

Os verificadores de API e navegador exigem uma instalação de homologação; o primeiro realiza movimentações reais e preserva a auditoria. O verificador de câmera usa Chromium, FFmpeg e uma imagem QR real convertida em vídeo simulado. Ele não substitui a homologação física acima.
