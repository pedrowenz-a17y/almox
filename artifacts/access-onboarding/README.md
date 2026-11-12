# Evidências da etapa 4 · versão 2.10.0

- `tests.log`: 283 testes aprovados, sem falhas nem testes ignorados, em PostgreSQL temporário exclusivo de testes. As chamadas administrativas usam um provedor fictício controlado para exercitar erros, concorrência, escopo e efeitos parciais.
- `real-auth.json` e `real-auth.log`: 13 cenários aprovados com a imagem oficial Supabase Auth/GoTrue v2.185.0, PostgreSQL separado e SMTP de captura local. Convite e recuperação funcionaram em navegadores diferentes; duas mensagens foram capturadas localmente, sem destinatários externos. A fixture usa os endereços de retorno indicados pela interface, sem imprimir tokens ou senhas.
- `checks.json` e `interface.log`: 55 verificações aprovadas das etapas 1–4, usando páginas públicas do build local e os componentes reais do ERP com APIs fictícias. Inclui temas, celular, acompanhamento, cadastro salvo com envio pendente, limite de e-mail, vínculo existente, fragmentos, primeira senha e link expirado.
- `build.log`, `typecheck.log` e `lint.log`: compilação, TypeScript e ESLint concluídos.
- Quatro imagens mostram a lista de acesso, o acompanhamento em computador/celular e a definição da primeira senha. Nomes e e-mails são fictícios.

Nenhuma conta de produção foi usada e nenhum funcionário recebeu e-mail durante as verificações. A entrega não exige migração SQL nova. A configuração de domínio, redirecionamentos e SMTP do projeto remoto não foi alterada pelo agente.

[Procedimento, significados dos estados e limites](../../docs/PRIMEIRO-ACESSO-2.10.md).
