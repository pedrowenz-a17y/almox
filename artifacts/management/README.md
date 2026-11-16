# Etapa 9 — visão gerencial

Versão 2.15.0. As imagens usam dados fictícios e não representam os resultados da empresa.

- **346 testes de regressão aprovados**, sem falhas ou testes ignorados, em PostgreSQL temporário com as sete migrações existentes. Consulte `tests.log`.
- **114 verificações de interface aprovadas**, incluindo as etapas anteriores, sem erros JavaScript nem chamadas inesperadas. Consulte `checks.json` e `interface.log`.
- Compilação de produção, TypeScript e ESLint concluídos. Consulte os logs correspondentes.

Os novos testes verificam contagem e idade na fonte, legado sem abertura conhecida, agenda pelo vencimento, estados de recebimento, comparação por unidade, áreas sem acesso, permissões revogadas, posição diária preservada, concorrência, repetição segura após a virada de Brasília, histórico filtrado, área não medida e recusa de autoria/métricas/data enviadas pelo cliente. Verificam também a mudança da unidade ativa e a consulta com a preparação de responsáveis ausente. Registrar uma posição não modifica materiais nem cria movimentações de estoque.

A interface usa componentes reais com APIs fictícias. Verifica a comparação sem trocar unidade ativa, lacunas, distinção entre área não medida e sem acesso, filtros, confirmação antes do registro, posição preservada após a fila mudar, exportação, acesso de consulta, falha de rede e proteção da unidade esperada. As cinco imagens mostram o painel em desktop, o registro da posição e a adaptação a 320/390 pixels nos dois temas.

Nenhuma conta de produção foi autenticada, nenhum dado da empresa foi alterado e nenhum e-mail foi enviado. Não há nova migração SQL. As posições são observações registradas pelo responsável; não há série histórica anterior inventada, agendamento automático nem comprovação causal de melhoria. Consulte [uso e limites](../../docs/GERENCIAL-2.15.md).
