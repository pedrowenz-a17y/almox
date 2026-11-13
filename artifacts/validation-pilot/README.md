# Etapa 6 — validação e indicadores

Versão 2.12.0. Dados, nomes e resultados das imagens são fictícios; não representam desempenho da empresa.

- **309 testes de regressão aprovados**, sem falhas ou testes ignorados, em PostgreSQL temporário com as sete migrações existentes do projeto. Consulte `tests.log`.
- **80 verificações de interface aprovadas**, incluindo as etapas anteriores. Sem erros JavaScript ou chamadas inesperadas. Consulte `checks.json` e `interface.log`.
- Compilação de produção, TypeScript e ESLint concluídos. Consulte os logs correspondentes.

Os testes verificam escopo por unidade, janela de Brasília e janela anterior, bases distintas de baixa/aplicação, taxa sem denominador, contagens aprovadas, pendências atuais, retrato preservado, repetição segura, evidências obrigatórias, concorrência, acesso revogado, encerramento por outra pessoa no piloto, histórico de alterações e escape de conteúdo no relatório HTML.

A interface usa componentes reais com APIs fictícias. Verifica o roteiro completo, resultado, evidência, conflito de atualização, exportações, relatório do TCC, acesso de consulta e temas/larguras de 320/390 pixels. A regressão de domínio usa PostgreSQL real isolado. Nenhum dado da empresa foi alterado e nenhum e-mail foi enviado.

As cinco imagens mantidas mostram indicadores nos dois temas e o roteiro no computador e no celular. A homologação com a empresa e qualquer comprovação de melhoria dependem de coleta e evidências reais. Veja [o procedimento e os limites](../../docs/VALIDACAO-E-INDICADORES-2.12.md).
