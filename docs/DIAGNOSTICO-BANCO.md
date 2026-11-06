# Diagnóstico do banco no Windows

Execute os comandos no CMD, na pasta que contém `package.json` e o seu `.env`. Eles não aplicam migrations, não gravam dados, não tentam login e não enviam e-mail.

```bat
npm run doctor -- --offline
npm run doctor -- --network-only
npm run doctor
```

O primeiro verifica formatos sem acessar a rede. O segundo consulta DNS e abre uma conexão TCP curta para `DATABASE_URL` e `DIRECT_URL`, sem enviar senha ou consultas PostgreSQL. O terceiro verifica o banco usado pelo aplicativo, as tabelas e colunas básicas exigidas pela versão 2.4, a existência de um vínculo ativo e o serviço de autenticação. Essa verificação da estrutura não valida os dados nem todo o histórico de migrations. Configuração inválida de `APP_URL` não impede o diagnóstico independente do banco.

Para um relatório de texto estruturado, sem imprimir valores das variáveis:

```bat
npm run doctor -- --json
```

O teste deve ser executado no computador e na rede onde o erro ocorre. Um resultado nesta nuvem não comprova que o computador da escola consegue acessar o banco. A conexão externa precisa estar funcionando para testar o fluxo completo do ERP.

## Como interpretar

| Resultado                          | Significado e próximo passo                                                                                                                                                                                                   |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DNS falhou                         | Confira a conexão copiada de **Connect** no Supabase e se o projeto está ativo. Se persistir, peça à TI que confira o DNS do computador.                                                                                      |
| TCP recusado                       | O serviço ou a rede recusou a conexão. Confira projeto ativo e porta mostrada em **Connect**.                                                                                                                                 |
| TCP não alcançado / tempo esgotado | Pode ser rota, rede, projeto pausado ou serviço indisponível. Isso sozinho não comprova bloqueio da escola. Compare em outra rede autorizada ou peça à TI que verifique acesso ao servidor e à porta indicados pelo Supabase. |
| Somente IPv6 e TCP falhou          | Se a rede não tiver IPv6, copie a conexão **Session pooler** com suporte a IPv4 apresentada pelo Supabase. Use o host, usuário, porta e parâmetros dessa conexão completa; não invente um endereço substituto.                |
| `P1001`                            | O Prisma não alcançou o banco. Confira as etapas DNS/TCP, o estado do projeto e a conexão fornecida pelo Supabase.                                                                                                            |
| `P1000`                            | O banco recusou usuário/senha. A senha do banco é diferente da senha de login do ERP. Caracteres reservados na senha precisam de codificação na URL.                                                                          |
| `P1011`                            | Falha de TLS. Siga os parâmetros e certificados do provedor, mantendo a verificação habilitada.                                                                                                                               |
| `P2021` / `P2022`                  | O banco responde, mas falta uma tabela ou coluna necessária. Revise o histórico de migrations, a base correta e os backups antes de instalar ou atualizar a estrutura.                                                        |
| Acesso inicial em aviso            | O banco e as tabelas podem estar acessíveis, mas não foi encontrado vínculo ativo entre usuário Supabase e unidade. Siga o primeiro administrador do README. Não existe senha padrão.                                         |

**Auth OK não significa PostgreSQL OK.** A autenticação usa HTTPS; a conexão do banco usa o host e a porta da URL PostgreSQL. A rede pode permitir um serviço e impedir o outro. TCP OK também não confirma senha, TLS, estrutura ou login: essas são etapas seguintes.

## Configuração local

Mantenha a origem usada no navegador igual à configuração do aplicativo. Por exemplo, para abrir `http://localhost:3000`:

```dotenv
APP_URL=http://localhost:3000
```

Não acrescente `/login`, aspas incorporadas ao valor ou credenciais nessa origem. Após corrigir o `.env`, encerre o processo com `Ctrl+C` e inicie novamente conforme as instruções de instalação do README. Variáveis públicas compiladas podem exigir uma nova compilação quando forem alteradas.

`DATABASE_URL` é a conexão usada pelo aplicativo. `DIRECT_URL` é usada pelas ferramentas Prisma para operações de estrutura. Em uma rede sem IPv6, consulte a opção **Session pooler** apropriada ao seu projeto para essas operações; não use uma conexão de transações sem confirmar as limitações indicadas pelo Supabase. O modo de rede verifica o transporte de ambas, mas não autentica a `DIRECT_URL` nem aplica migrations.

Se o banco já tem dados da empresa, a criação de tabelas e a atualização da estrutura exigem revisar as migrations e os backups com o responsável. O diagnóstico informa o problema e não executa essa alteração automaticamente.

Compartilhe apenas o relatório do diagnóstico. Não envie `.env`, senhas, URLs de conexão completas ou chaves. Para pedir liberação à TI, consulte o host e a porta em **Connect** diretamente com o responsável, em canal apropriado. O diagnóstico não altera proxy, firewall ou políticas de rede.

## Alternativa para desenvolver com PostgreSQL local

Se o acesso externo ao PostgreSQL não estiver disponível, é possível desenvolver com uma base nova no próprio computador. Isso exige Docker Desktop instalado, iniciado e permitido pela instituição. Em um computador da escola, peça ao responsável uma máquina ou ambiente autorizado se Docker não estiver disponível.

Use uma cópia separada do projeto e um `.env` destinado exclusivamente ao desenvolvimento local. Preserve a configuração da base remota. Preencha as variáveis locais da `.env.example` e use a mesma senha local nas duas URLs:

```dotenv
POSTGRES_USER=almox
POSTGRES_DB=almox
POSTGRES_PASSWORD=SUA_SENHA_LOCAL
POSTGRES_PORT=5432
DATABASE_URL=postgresql://almox:SUA_SENHA_LOCAL@127.0.0.1:5432/almox
DIRECT_URL=postgresql://almox:SUA_SENHA_LOCAL@127.0.0.1:5432/almox
APP_URL=http://localhost:3000
```

Substitua `SUA_SENHA_LOCAL` por uma senha própria. Se contiver caracteres reservados, codifique-os na parte da senha das URLs. Mantenha as variáveis Supabase Auth configuradas com o projeto autorizado; a base PostgreSQL local não fornece autenticação Supabase. A conexão HTTPS ao Auth ainda será necessária.

No CMD, para essa base local nova:

```bat
npm run db:local
npm run doctor -- --network-only
npm run db:generate
npm run db:migrate
npm run doctor
```

`db:local` inicia o PostgreSQL persistente do Compose. `db:migrate` altera a estrutura da base apontada pelo `.env`: execute-o neste roteiro somente depois de conferir que **as duas URLs apontam para `127.0.0.1` e para a base local nova**. Não use esse comando para corrigir uma base empresarial sem revisão de migrations e backups. O provisionamento do primeiro administrador segue o README e precisa vincular uma identidade Supabase autorizada.

Essa alternativa permite testar o aplicativo com dados de desenvolvimento. Não importa dados da empresa, não integra o ERP oficial e não comprova que o acesso ao Supabase PostgreSQL foi resolvido. Para validar o cenário empresarial, ainda será necessário testar na rede autorizada e com as conexões corretas.
