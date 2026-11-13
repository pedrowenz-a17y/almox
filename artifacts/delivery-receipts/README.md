# Etapa 8 — recebimentos de materiais

Versão 2.14.0. As imagens usam somente dados fictícios.

- **333 testes de regressão aprovados**, sem falhas ou testes ignorados, em PostgreSQL temporário com as sete migrações existentes. Consulte `tests.log`.
- **102 verificações de interface aprovadas**, incluindo as etapas anteriores, sem erros JavaScript nem chamadas inesperadas. Consulte `checks.json` e `interface.log`.
- Compilação de produção, TypeScript e ESLint concluídos. Consulte os logs correspondentes.

Os testes novos verificam seleção de identidade ativa, separação entre entregador e destinatário, declaração pelo operador versus confirmação autenticada, confirmação e faturamento sem baixa duplicada, relato de quantidade zero/parcial/excesso, material diferente, tratamento e aceite, histórico preservado, autoria, escopo, permissões revogadas, concorrência, repetição segura e paginação. Também verificam a exibição exata de milésimos em quantidades grandes e a recusa de quantidade malformada.

A interface usa componentes reais com APIs fictícias para o percurso completo: indicar a conta na aplicação, confirmar recebimento, relatar diferença, propor tratamento, devolver para revisão e aceitar sem apagar a diferença original. Inclui entrega sem conta, filtros, falha de consulta, conflito de versão e ausência de contas disponíveis. As cinco imagens mantidas mostram acompanhamento e divergência no computador, lista em 320/390 pixels e tratamento no tema claro no celular.

Os testes de domínio usam operações reais somente no banco isolado. Nenhuma conta de produção foi autenticada, nenhum dado da empresa foi alterado e nenhum e-mail foi enviado. Não há nova migração SQL. Referências e aceite de tratamento são declarações das pessoas, não prova automática de ajuste de estoque ou homologação com a empresa. Veja [uso e limites](../../docs/RECEBIMENTOS-2.14.md).
