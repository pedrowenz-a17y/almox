# Etapa 7 — central de alertas

Versão 2.13.0. As imagens contêm somente registros fictícios.

- **320 testes de regressão aprovados**, sem falhas ou testes ignorados, em PostgreSQL temporário com as sete migrações existentes. Consulte `tests.log`.
- **90 verificações de interface aprovadas**, incluindo as etapas anteriores, sem erros JavaScript ou chamadas inesperadas. Consulte `checks.json` e `interface.log`.
- Compilação de produção, TypeScript e ESLint concluídos. Consulte os logs correspondentes.

Os novos testes de domínio verificam escopo por unidade/área, leitura individual, repetição segura, concorrência, permissões revogadas, dados sem custos, renovação de avisos, virada de data em Brasília, filtragem antes da paginação, cancelamento versus recebimento e contagem aprovada versus reprogramação. Verificam também o comportamento quando a preparação da etapa 3 está ausente. Os estados de origem usados nesses testes são construídos em banco isolado; as ações operacionais continuam cobertas na regressão existente.

A interface usa componentes reais com respostas de API fictícias: sino, resumo, filtros, leitura sem encerrar a operação, conflito de atualização, estados do histórico, abertura da agenda, erro de consulta, permissões, temas e larguras de 320/390 pixels. As cinco imagens preservadas mostram a central no computador/celular e o histórico de leituras.

Nenhum dado da empresa foi alterado, nenhuma conta de produção foi autenticada e nenhum e-mail foi enviado. Não foi criada migração SQL. A validação com a empresa continua dependendo da operação e das evidências reais. Consulte [uso e limites](../../docs/ALERTAS-OPERACIONAIS-2.13.md).
