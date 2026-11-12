# Etapa 2 — perfis de acesso (2.8.0)

Regras e ativação: [PERFIS-DE-ACESSO-2.8.md](../../docs/PERFIS-DE-ACESSO-2.8.md).

A compilação de produção, TypeScript e ESLint concluíram. Passaram **234 testes de regressão**, sem falhas ou testes ignorados, usando Prisma/PostgreSQL reais em uma base temporária exclusiva. Passaram também **29 verificações de interface**, usando componentes reais e APIs fictícias.

`tests.log` registra a preparação dos modelos sem alteração de contas/vínculos/perfis antigos, preparação concorrente e repetida, conflito com configuração personalizada, gestão revogada e operações permitidas/negadas para cada perfil. O Comprador usa preços de compras sem receber acesso ao custo de produção. O Auditor consulta prévia de CSV, mas não salva documento. A aprovação independente do inventário permanece coberta pela suíte anterior.

`checks.json` e `browser.log` registram a interface. Os testes de perfil usam `scripts/fixtures/access-profile-checks.mjs`; a preparação dos modelos, a resposta de sucesso/recusa e a conciliação são simuladas e não atingem a instalação real. Os adaptadores locais de navegação do Next mantêm o router estável. A seleção de perfil no formulário não foi seguida de criação de usuário nem de envio de convite.

Nenhum login de produção foi utilizado, nenhum e-mail foi enviado a pessoa real, e nenhuma permissão de usuário foi alterada no Supabase de produção. Os modelos ainda precisam ser disponibilizados nessa instalação pelo administrador, através do botão da página de Usuários. Não há nova migração nem instalador nativo recompilado nesta entrega.

## Prévias com dados fictícios

- [Perfis disponibilizados no desktop](perfis-disponiveis-desktop.png)
- [Escolha de perfil com permissões reais](selecao-perfil-desktop.png)
- [Auditor consulta sem salvar documento](auditor-consulta-desktop.png)
- [Perfis no celular](perfis-mobile.png)

Para repetir: configure QA_ENVIRONMENT=isolated, QA_BASE_URL e QA_UNIT_ID de uma instalação local exclusiva de testes e execute `npm run verify:access-profiles`. Não execute verificadores contra produção.
