# Publicar o servidor Almox na Vercel

## O que falta no endereço atual

Em 9/11/2026, `https://almox-e51d362d7bb7b9030e673ef18c99f.vercel.app/` retorna uma página estática “Sem conexão”, enquanto `/login` e `/api/assistant` retornam 404. Isso comprova que o endereço ainda não fornece essas rotas do ERP. Não comprova falha na senha ou no banco.

O repositório já contém `vercel.json` com framework **Next.js**, instalação `npm ci`, compilação `npm run build` e saída `.next`. O `.vercelignore` exclui instaladores, arquivos privados, dependências locais e `.env` do envio. A sessão de desenvolvimento conseguiu atualizar o GitHub, mas não teve autenticação na conta Vercel; vincular a conta ao ChatGPT não disponibilizou esse acesso aqui.

## Configuração do projeto

1. Na Vercel, abra o projeto existente e confira **Settings → Build and Deployment**. Se ele não estiver conectado ao Git, use **Add New → Project → Import Git Repository**, escolhendo **pedrowenz-a17y/almox**, branch `main`.
2. Configure **Root Directory** como a raiz do repositório (`./`, ou deixe o campo vazio). É a pasta que contém `package.json`, `src`, `prisma` e `vercel.json`. Não escolha `public`, `mobile`, `desktop`, `.next` ou uma pasta com apenas o conteúdo do site exportado.
3. Confira **Framework Preset: Next.js**, **Node.js: 24.x**, **Install Command: npm ci**, **Build Command: npm run build**, **Output Directory: .next**. O projeto usa servidor Node.js; não configure exportação estática.
4. Em **Settings → Environment Variables**, cadastre as variáveis abaixo em **Production**, copiando os valores do ambiente protegido e do painel Supabase. Depois faça um novo deploy da branch `main`; alterar uma variável não atualiza uma implantação que já terminou.

| Variável | Valor a configurar no painel, sem publicar no Git |
| --- | --- |
| `DATABASE_URL` | Conexão de execução PostgreSQL copiada de **Supabase → Connect**. Para serverless, use o pooler compatível com Prisma. |
| `DIRECT_URL` | Conexão direta ou pooler de sessão para ferramentas administrativas; não use o transaction pooler para migrations. |
| `NEXT_PUBLIC_SUPABASE_URL` | **Project URL** do Supabase, terminando em `.supabase.co`. |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Chave publicável/anon do mesmo projeto Supabase. |
| `APP_URL` | Origem HTTPS pública do ERP, sem caminhos, por exemplo `https://almox-e51d362d7bb7b9030e673ef18c99f.vercel.app`. |
| `SUPABASE_SERVICE_ROLE_KEY` | Opcional para login comum; necessária somente no servidor para convites e provisionamento. |
| `ASSISTANT_PROVIDER` | `local`, para usar o assistente gratuito sem créditos OpenAI. |

Não importe `APP_URL=http://localhost:3000` da configuração do PC para produção. Se não definir `APP_URL`, a versão 2.7.0 reconhece a origem de produção informada pela Vercel. Uma variável `APP_URL` explícita tem prioridade; remova valores antigos ou corrija-os.

Não envie o `.env` ao celular. Não coloque `DATABASE_URL`, chaves administrativas ou OpenAI em variáveis `NEXT_PUBLIC_*`. O servidor faz as consultas e aplica as permissões.

## Supabase e dados existentes

Em **Supabase → Authentication → URL Configuration**:

- **Site URL:** a origem HTTPS do ERP na Vercel.
- **Redirect URLs:** os endereços exatos `https://SEU-DOMINIO/auth/callback` e `https://SEU-DOMINIO/recuperar-senha`.

Isso não altera a **Project URL** usada em `NEXT_PUBLIC_SUPABASE_URL`. O login ainda exige conta autorizada e vínculo com a unidade, conforme [Primeiro administrador e login](../README.md#primeiro-administrador-e-login).

O build executa `prisma generate`, mas não aplica migrations automaticamente. Se a base atual já funciona e está atualizada, preserve-a. Caso faltem migrations, siga [MIGRATION-SUPABASE.md](MIGRATION-SUPABASE.md) com backup e ambiente administrativo antes de atualizar a base. Não execute reset nem crie uma base vazia por cima dos dados existentes.

## Verificar a publicação

1. Aguarde o deployment marcar **Ready** e abra `/login` no domínio de produção. Deve aparecer a tela U.C.A. com **Entrar no almoxarifado**, não a página “Sem conexão”.
2. Entre com sua conta e confira a unidade. Se houver mensagem sobre o banco, consulte os **Runtime Logs** da Vercel; se houver erro de build, consulte **Build Logs**. Não publique esses logs sem remover dados sensíveis.
3. Abra o Android e conecte à mesma origem HTTPS. Se um projeto novo recebeu outro domínio, altere o campo **Endereço do ERP** no aplicativo e atualize `APP_URL` e o Supabase Auth para esse domínio.
4. Com o login e uma consulta funcionando no celular, desligue o PC e repita a consulta pela internet do celular. O funcionamento passa a depender da Vercel e do Supabase, não do computador.

O plano de hospedagem e o banco precisam permanecer ativos. Custos, limites e adequação para uso real da empresa devem ser avaliados no plano contratado; o APK não elimina a necessidade desses serviços.
