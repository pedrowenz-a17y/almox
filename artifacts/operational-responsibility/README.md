# Evidências da etapa 3 · versão 2.9.0

- `tests.log`: 259 testes aprovados, nenhuma falha ou teste ignorado; 29 arquivos e sete migrações em PostgreSQL temporário exclusivo de testes. Sem conexão com o banco da empresa.
- `build.log`, `typecheck.log`, `lint.log`: compilação, TypeScript e ESLint concluídos.
- `checks.json`, `interface.log`: 39 verificações aprovadas, sem erros JavaScript ou chamadas inesperadas; páginas públicas do build local e componentes reais do ERP com respostas fictícias de API. Navegador em português, horário de São Paulo e larguras de 320/390 pixels para celular.
- Imagens: passagem de turno em espera, formulário de atribuição, painel no tema claro e cartões de pendências no celular.

Os testes de interface não enviam e-mails nem usam contas ou dados reais. Os testes de domínio verificam transações e permissões com PostgreSQL isolado. A função que entrega o SQL inclui a migração no rastreamento do build e exige sessão administrativa; ela não executa SQL.

Ativação na instalação: aplicar a migração `20261112180000_operational_responsibility` no banco correto. A consulta de pendências permanece disponível se a migração estiver ausente. O agente não aplicou a migração do banco da empresa nesta sessão.

[Ativar, usar e entender os limites](../../docs/TURNOS-E-PENDENCIAS-2.9.md).
