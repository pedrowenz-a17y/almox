# Definir senha de uma conta existente sem recuperação por e-mail

Uso administrativo pontual, no computador do responsável. O comando chama a API oficial Supabase Auth Admin, confere UUID/e-mail e altera somente a senha da identidade existente. Não altera perfis, unidades, UUIDs ou tabelas do ERP; não cria outra conta nem solicita convite/recuperação por e-mail.

1. Atualize ou baixe o código da branch `main`. No CMD, abra a pasta que contém `package.json` e execute `npm ci` se ainda não instalou as dependências dessa cópia.
2. No `.env` protegido desse computador, configure `NEXT_PUBLIC_SUPABASE_URL` (a Project URL HTTPS com o domínio `.supabase.co`) e `SUPABASE_SERVICE_ROLE_KEY` do mesmo projeto. O utilitário recusa o domínio do site Vercel e outros hosts para evitar enviar a chave administrativa ao destino errado; domínios personalizados não são suportados por este utilitário. A chave administrativa deve ficar somente com o administrador; o amigo recebe apenas sua senha temporária. Não execute este utilitário em página pública, console do navegador ou SQL Editor.
3. Execute:

```bat
npm run user:password -- --email EMAIL_DA_CONTA --user-id UUID_DO_SUPABASE
```

O programa exige CMD/PowerShell interativo. Ele pede a senha e sua confirmação sem eco; as teclas não aparecem, nem como asteriscos. Use 12 a 128 caracteres. A senha não é recebida como argumento de linha de comando nem salva pelo utilitário. JavaScript não garante remoção física de strings da memória.

Se o e-mail ainda não estiver confirmado, o comando interrompe antes de escrever. Depois de verificar a identidade e o endereço do titular, o administrador pode optar por confirmação manual:

```bat
npm run user:password -- --email EMAIL_DA_CONTA --user-id UUID_DO_SUPABASE --confirm-email
```

`--confirm-email` também marca o e-mail como confirmado no Supabase, sem prova por link de e-mail. Essa opção deve refletir uma verificação real do titular pelo administrador. Não muda o e-mail nem substitui uma identidade por outra.

O utilitário não força a troca no primeiro login. Entregue a senha temporária ao titular por canal privado. Após entrar no site, ele pode abrir `/recuperar-senha` no mesmo navegador autenticado para definir a própria senha, respeitando as políticas do provedor. O salvamento encerra as sessões conforme o fluxo existente do ERP.

Uma mensagem de conexão interrompida após uma tentativa de escrita pode representar resultado incerto; confira a situação antes de repetir. Não há reversão automática da senha nem criação automática de permissões.

## Verificação local

```bat
npm run test:user-password
npm run user:password -- --help
```

Os testes usam respostas fictícias: conferem preservação da identidade, recusa de e-mail/UUID incompatíveis, validação de senha, confirmação explícita de e-mail e mensagens sanitizadas. O terminal oculto foi exercitado com SDK/fetch simulados, sem chamadas externas. Nenhuma senha real foi definida durante a preparação do utilitário.
