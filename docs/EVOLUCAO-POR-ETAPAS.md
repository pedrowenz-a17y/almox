# Evolução do Almox ERP por etapas

A partir da auditoria de 12/11/2026, as melhorias serão entregues em versões separadas. Cada etapa terá regra no servidor, orientação na tela e validação antes da publicação. A aprovação do plano não cria permissões nem concede acesso a contas existentes.

| Etapa | Entrega | Situação |
| --- | --- | --- |
| 1 | Aprovação independente das contagens de estoque | Implementada na versão 2.7.4; validação desta entrega em `artifacts/independent-inventory` |
| 2 | Perfis de acesso por responsabilidade | Próxima etapa: separar permissões e testar os limites antes de disponibilizar novos perfis |
| 3 | Responsável por turno e responsável/prazo nas pendências | Planejada; precisa de um fluxo de atribuição e passagem de turno definido e de migração validada |
| 4 | Convites, primeiro acesso e recuperação | Planejada; melhorias na interface devem acompanhar a configuração do domínio e do provedor de e-mail |
| 5 | Conciliação homologada com o ERP oficial | O CSV já existe; automatizar depende dos dados, do ERP e das regras disponibilizadas pela empresa |

## Etapa 1 — aprovação independente de inventário

Quem registrou uma contagem não pode aprová-la enquanto ela estiver pendente, mesmo que tenha a permissão de ajuste ou seja administrador. A aprovação exige outra pessoa autorizada **na mesma unidade**. Isso vale também para contagens sem divergência: a conferência continua sendo independente, mesmo quando não há ajuste de saldo.

O servidor aplica o bloqueio dentro da transação e retorna HTTP 403 com o código `INVENTORY_SELF_APPROVAL`. A interface identifica o autor pelo ID do usuário do ERP, mostra a orientação e desabilita o botão para a própria contagem. Um nome ou e-mail parecido não determina a autoria. Se a interface não receber o identificador do responsável, ela mantém a aprovação bloqueada e orienta a atualização dos dados.

Outra pessoa continua precisando de permissão de ajuste e acesso à unidade. Continuam valendo a proteção contra estoque alterado depois da contagem, a validação das reservas, a transação atômica e a prevenção de ajustes duplicados. A aprovação registra separadamente o autor da contagem e a pessoa que aprovou.

Nenhuma exceção automática foi criada para administradores. Se só houver uma pessoa autorizada na unidade, será necessário disponibilizar um segundo revisor pelo procedimento administrativo existente. Não foi concedida nenhuma permissão automaticamente.

### Histórico, encerramento e atualização

- Não há migração de banco nesta etapa. Contagens, saldos, acessos e aprovações anteriores são preservados.
- Uma consulta/repetição de uma aprovação já concluída continua idempotente: retorna o registro existente, sem aplicar o ajuste novamente. A nova regra não reescreve o histórico de aprovações antigas.
- Encerrar uma proposta sem ajuste continua exigindo a permissão e a justificativa existentes. O próprio autor autorizado pode encerrar sua proposta incorreta para refazê-la; esse encerramento não aprova estoque, não altera saldo e não conclui o ciclo da agenda.
- A agenda periódica só avança quando uma aprovação válida conclui o ciclo. A tentativa bloqueada não ajusta o saldo nem muda o vencimento.
- Os instaladores Android/Windows não foram recompilados. O aplicativo que acessa o servidor atualizado recebe a nova interface; o bloqueio do servidor vale inclusive se alguma tela antiga ainda exibir o botão.

### Verificação

A suíte de regressão passou com **221 testes**, sem falhas ou testes ignorados, em um PostgreSQL temporário exclusivo de testes. Foram verificados bloqueio do autor com permissão administrativa, contagem com e sem diferença, preservação de saldo/versão/auditoria na recusa, revisão por outra pessoa, falta de permissão, escopo da unidade, concorrência e avanço correto das conferências periódicas. Os testes antigos que aprovavam contagens com o mesmo usuário passaram a usar um revisor separado.

A compilação de produção, TypeScript e ESLint concluíram, e as **20 verificações de interface passaram**. A verificação de interface reutiliza os componentes reais do ERP com APIs fictícias. Ela cobre o botão bloqueado com explicação, ausência de autoria, consulta ao histórico, aprovação por revisor, recusa do servidor e perfil sem ajuste; também confere o tema e a navegação. As confirmações nesse teste são simuladas e não escrevem no banco da empresa. Os invariantes do estoque são verificados separadamente com PostgreSQL real isolado. Não foi realizado login em uma conta de produção.

Para repetir as verificações de interface, use uma instalação local exclusiva de testes, configure `QA_ENVIRONMENT=isolated`, `QA_BASE_URL` e `QA_UNIT_ID` conforme `scripts/qa-config.mjs` e execute:

```sh
npm run verify:inventory-approval
```

Consulte as [evidências desta etapa](../artifacts/independent-inventory) e a [auditoria funcional original](AUDITORIA-ERP-2026-11-12.md).
