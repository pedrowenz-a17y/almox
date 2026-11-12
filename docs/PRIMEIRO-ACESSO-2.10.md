# Etapa 4 — convites, primeiro acesso e recuperação

A versão 2.10.0 melhora o acompanhamento das contas e os links de definição de senha. **Esta etapa não exige nova migração SQL.** Usa os vínculos, a auditoria e o controle de tentativas que já existem no ERP. A migração da etapa 3 continua necessária apenas para seus turnos e atribuições.

## Onde usar

Entre como administrador e abra **Usuários** na unidade desejada. Cada pessoa tem um botão **Acesso**. A consulta mostra o e-mail, a habilitação na unidade, a confirmação no serviço de login, as definições de senha registradas pelo ERP e a última entrada nessa unidade. Consultar a tela não envia mensagens.

| Estado | Significado |
| --- | --- |
| Acesso desativado | O vínculo na unidade ou a identidade global do ERP está desativado |
| Sem vínculo de login | O cadastro ainda não tem um identificador Supabase associado |
| Convite solicitado | O provedor aceitou uma solicitação de convite para a identidade atual; isso não comprova entrega na caixa de entrada |
| Primeiro acesso pendente | Há vínculo de login, mas falta confirmação de entrada desta identidade na unidade; pode existir senha definida fora do ERP |
| Acesso confirmado | O ERP registrou um login por senha da identidade atual nesta unidade |

**Habilitado na unidade** indica uma autorização configurada. O acompanhamento do primeiro acesso é um fato separado e não redefine permissões. Uma conta antiga pode aparecer sem confirmação até entrar novamente. Os registros novos identificam o UUID Supabase: recriar uma identidade não faz o novo UUID herdar a confirmação de login do anterior. A definição de senha pertence à identidade compartilhada; a entrada registrada é apresentada por unidade.

A consulta ao serviço de login ocorre ao abrir o acompanhamento de uma pessoa. Identidade ausente, e-mail incompatível, bloqueio no provedor ou configuração indisponível são explicados nessa tela. Esses casos não são corrigidos automaticamente pela troca de UUID, nem por reenvio indiscriminado de mensagens.

## Cadastrar e acompanhar

Em **Novo usuário**, escolha uma das opções:

- **Preparar acesso e enviar convite:** cria uma identidade sem senha e sem confirmar o e-mail, salva a associação autorizada no ERP e só então solicita o convite. A pessoa define a própria senha. Se o serviço de e-mail não confirmar o envio, o cadastro permanece salvo e a tela orienta acompanhar pelo botão **Acesso**. A resposta distingue cadastro salvo de envio aceito.
- **Vincular identidade existente:** informa-se o UUID de uma identidade com e-mail confirmado. O servidor confere que o identificador pertence ao e-mail informado. Não solicita um novo e-mail. Se a pessoa já existe no ERP em outra unidade, seu ID, histórico e demais vínculos são preservados.

A preparação de identidades e a consulta administrativa precisam da chave de servidor do Supabase configurada na hospedagem. A chave nunca aparece na interface. Se a identidade não puder ser preparada, o cadastro não é apresentado como concluído. Se uma identidade nova foi criada, mas o vínculo não concluiu, o serviço tenta remover somente essa identidade recém-criada, nunca uma conta preexistente.

Repetir um cadastro já salvo com a mesma associação não gera outro convite. Alterar perfil ou situação continua sendo uma ação explícita, limitada à unidade. O próprio administrador não pode desativar ou rebaixar seu acesso; a unidade deve manter um administrador ativo.

No acompanhamento, **Enviar/Reenviar convite** atende identidades cujo e-mail ainda não foi confirmado. Para e-mail confirmado, **Enviar link para definir senha** solicita recuperação. O destinatário vem do cadastro da unidade; o servidor verifica o vínculo atual, a atividade e a permissão administrativa novamente. O administrador não escolhe a senha da outra pessoa. Um reenvio não muda senha, cargo ou acesso automaticamente.

## O que a pessoa recebe

O modelo padrão do Supabase pode usar `{{ .ConfirmationURL }}`. Ao abrir o convite, a pessoa valida o link, confere o e-mail mostrado pelo ERP e cria uma senha de pelo menos 12 caracteres, respeitando também a política do projeto Supabase. A confirmação deve ser igual à nova senha. A nova tela vincula a solicitação à identidade exibida e recusa a alteração se a sessão mudou para outra conta em uma segunda aba. Depois da alteração, ela entra no site ou no aplicativo com o e-mail e a senha escolhida.

Os links padrão de convite e os novos links de recuperação podem ser abertos em outro aparelho, sem depender dos cookies do navegador de quem solicitou o envio. O ERP trata o fragmento devolvido pelo Supabase, remove os tokens da barra de endereço antes da requisição e confirma os dois tokens da mesma identidade no provedor. A sessão é mantida em cookies HTTP-only, com `Secure` em HTTPS e `SameSite=Lax`; não é gravada no armazenamento local do navegador.

`/auth/callback` mantém suporte a códigos PKCE anteriores. `/auth/confirm` mantém suporte a modelos personalizados com `TokenHash` e tipo `invite`/`recovery`. Em uma falha temporária ou de conexão durante a validação, a tela conserva o link apenas em memória para permitir nova tentativa, sem solicitar outro e-mail automaticamente. O primeiro acesso usa `/primeiro-acesso`; a recuperação usa `/recuperar-senha`. Links expirados, consumidos, incompletos ou indisponíveis recebem orientação para solicitar outro link ou procurar o administrador, sem reproduzir dados do provedor na URL.

Uma identidade autenticada continua precisando de usuário ativo e associação ativa a uma unidade do ERP. A confirmação do link não cria vínculos nem concede permissões.

## Conferir os endereços e o envio

Em **Usuários → Endereços dos convites e recuperação**, o ERP mostra os valores esperados a partir de `APP_URL` do servidor. A consulta não acessa nem confirma as configurações do painel externo. Se a tela foi aberta por outro endereço, mostra a diferença para o administrador conferir.

Na implantação oficial atual, o procedimento esperado é:

1. Na Vercel, conferir `APP_URL=https://almox-blush.vercel.app` para Production e publicar novamente se esse valor tiver sido alterado. Usar somente a origem completa, sem `/login` ou outro caminho.
2. No Supabase do mesmo projeto, em **Authentication → URL Configuration**, conferir **Site URL** e adicionar os **Redirect URLs** exibidos pelo ERP. O retorno usado nos e-mails é `https://almox-blush.vercel.app/auth/callback?next=/recuperar-senha`; o retorno para modelos com `TokenHash` é `/auth/confirm` na mesma origem.
3. Conferir o modelo de e-mail utilizado. Um domínio antigo escrito diretamente no HTML precisa ser revisado no próprio provedor. Para o fluxo padrão, manter o modelo com `ConfirmationURL`.
4. Em caso de limite de envio ou destinatário não autorizado, o responsável configura o serviço SMTP do projeto em **Authentication → Emails/SMTP** conforme o provedor escolhido. Chaves e senhas permanecem nos painéis protegidos, sem serem colocadas no aplicativo ou no chat.

O envio de links tem espera compartilhada no banco, inclusive entre unidades e instâncias da aplicação. A interface mostra a espera antes de permitir nova tentativa. O limite local não elimina a cota, as restrições de destinatários nem os erros do serviço de e-mail. Uma tentativa liberada localmente não garante que a cota externa já foi liberada.

A recuperação pública mantém uma resposta genérica para contas ausentes e não informa vínculos do ERP. Limites e indisponibilidade do serviço são apresentados com mensagens próprias. O público não consulta os estados administrativos da conta.

## Auditoria e limites

Solicitações e resultados de envio registram ator, unidade, pessoa, identidade e tipo de mensagem. Não armazenam senha, link de recuperação, tokens de sessão ou chave administrativa. A mudança de senha registra uma intenção antes de consultar o provedor e a conclusão quando confirmada. Se a senha já foi alterada no Supabase, uma falha posterior ao concluir a auditoria não é apresentada como se a senha tivesse sido recusada; a intenção permanece para conferência e o servidor registra um código de diagnóstico.

Após a alteração confirmada, o ERP solicita o encerramento global das sessões ao provedor e limpa os cookies locais. O comportamento e a validade dos demais tokens seguem o Supabase. Essa rotina não altera as permissões nem garante revogação instantânea de um token de acesso já emitido.

Nesta sessão, a configuração privada da Vercel/Supabase de produção não estava disponível ao agente. Nenhum e-mail foi enviado a funcionários, nenhum acesso de produção foi criado ou alterado e não houve tentativa de modificar Site URL, SMTP ou credenciais do projeto remoto. Os instaladores nativos não foram recompilados; recebem a interface do servidor ao acessarem a implantação atualizada.

## Validação

- **283 testes** de regressão em PostgreSQL temporário e exclusivo de testes, sem falhas ou testes ignorados. Incluem cadastro salvo com falha de e-mail, preservação de vínculos, recusa de administrador revogado, escopo, UUID incompatível, reenvio concorrente, histórico vinculado à identidade atual, senha rejeitada, confirmação do resultado e par de tokens incompatível.
- **13 cenários** com a imagem oficial `supabase/gotrue:v2.185.0`, PostgreSQL separado e SMTP de captura local. Foram exercitados o convite padrão, a senha real, login, recuperação em um terceiro navegador, recusa da senha anterior, link consumido, espera entre envios, cookies HTTP-only, ausência de tokens no armazenamento local e recusa de origem forjada. Houve duas mensagens capturadas localmente e nenhum destinatário externo.
- **55 verificações de interface**, incluindo as etapas anteriores, temas claro/escuro, estados administrativos, cadastro pendente, reenvio, primeiro acesso, recuperação e telas de 320/390 pixels, com APIs fictícias.
- Build de produção, TypeScript e ESLint concluídos. As verificações públicas da implantação não substituem um login autorizado ou uma conferência de entrega real de e-mail.

Veja [as evidências](../artifacts/access-onboarding). `npm run verify:onboarding` verifica a interface em ambiente isolado, conforme `scripts/qa-config.mjs`. `npm run verify:onboarding-real` exige a fixture local exclusiva com PostgreSQL na porta 55450, Supabase Auth no gateway 10098, captura SMTP 10097, app 3130, nomes de banco de teste, credenciais fictícias e `ALLOW_QA_WRITES=1`; o roteiro recusa hosts remotos. Não execute roteiros de escrita no banco da empresa.
