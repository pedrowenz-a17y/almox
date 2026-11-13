# Etapa 5 — evidências da conciliação

Versão 2.11.0. Todos os dados e nomes das imagens são fictícios.

- **299 testes de regressão aprovados**, sem falhas ou testes ignorados, em PostgreSQL temporário com as sete migrações do projeto. Consulte `tests.log`.
- **72 verificações de interface aprovadas**, incluindo as etapas anteriores, sem erros JavaScript ou chamadas inesperadas. Consulte `checks.json` e `interface.log`.
- Compilação de produção, TypeScript e ESLint concluídos. Consulte `build.log`, `typecheck.log` e `lint.log`.

A interface utiliza os componentes reais com respostas fictícias de API. A regressão de domínio usa PostgreSQL real isolado. Não foram usados dados de estoque, credenciais ou sessões da empresa, nem enviados e-mails aos usuários.

As verificações cobrem associação de colunas, exportações repetidas, concorrência, revisão independente, causa/análise/referência de todas as diferenças, custos históricos ausentes, saldo alterado, reconsulta sem alterar o arquivo nem a referência original, revisão dos critérios, documentos antigos e restrição de pareceres financeiros.

As imagens mantidas mostram a lista, a importação, a análise das diferenças, a conferência em 320/390 pixels e o documento no modo claro. Largura do conteúdo e posição das ações foram conferidas para evitar recortes; o contraste de textos importantes foi medido nos dois temas.

O resultado valida o fluxo do Almox. A homologação com arquivos reais e a integração automática com o ERP ainda dependem dos dados e critérios fornecidos pela empresa. Veja [o procedimento e os limites](../../docs/CONCILIACAO-ERP-2.11.md).
