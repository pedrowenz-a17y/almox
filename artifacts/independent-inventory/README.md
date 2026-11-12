# Etapa 1 — aprovação independente de inventário (2.7.4)

A regra e o plano de evolução estão em [EVOLUCAO-POR-ETAPAS.md](../../docs/EVOLUCAO-POR-ETAPAS.md).

## Resultado

- Compilação de produção, TypeScript e ESLint concluídos.
- **221 testes de regressão passaram**, sem falhas ou testes ignorados, usando PostgreSQL temporário exclusivo de testes. As seis migrações existentes foram aplicadas somente a essa base isolada; esta etapa não adiciona migração.
- **20 verificações de interface passaram**: as 14 de tema/navegação e seis cenários específicos de aprovação independente. Não houve erro JavaScript ou chamada inesperada nas verificações.

`tests.log` registra os testes de serviços, concorrência e permissões com Prisma e PostgreSQL reais isolados. O teste novo verifica que a tentativa do autor preserva o registro, o saldo, a versão e a auditoria; outra pessoa com permissão pode aprovar. Os casos incluem diferença zero, disputa entre autor/revisor e avanço da agenda somente após aprovação válida.

`checks.json` e `browser.log` registram a verificação da interface com componentes reais e APIs fictícias. As duas solicitações de aprovação dessa simulação foram interceptadas pelo Playwright: uma resposta de sucesso e uma recusa HTTP 403. Elas não alcançaram uma API de produção nem um banco real. Os adaptadores locais de navegação mantêm a identidade estável do router, reproduzindo o comportamento necessário do Next.js para os efeitos de atualização da tela.

Os testes públicos da interface usaram o servidor de produção local. Não foi realizado login em uma conta da empresa, não houve alteração em acessos e nenhum e-mail foi enviado. Nenhum ajuste de estoque foi realizado no Supabase de produção. A câmera foi recusada no teste e a impressão foi emulada por CSS.

## Prévias com dados fictícios

- [Autor bloqueado no desktop](autoaprovacao-bloqueada-1440.png)
- [Autor bloqueado no celular](autoaprovacao-bloqueada-390.png)
- [Revisor autorizado](aprovacao-independente-desktop.png)

Para repetir as verificações de interface, configure QA_ENVIRONMENT=isolated, QA_BASE_URL e QA_UNIT_ID para uma instalação local exclusiva de testes e execute `npm run verify:inventory-approval`.
