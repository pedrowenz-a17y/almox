# Auditoria funcional e tema — 2.7.3

Relatório: [AUDITORIA-ERP-2026-11-12.md](../../docs/AUDITORIA-ERP-2026-11-12.md).

A compilação de produção, TypeScript, ESLint e as **14 verificações de interface** concluíram com sucesso. O contraste foi amostrado em títulos, textos, rótulos, campos, tabelas, estados e avisos, com mínimo de 4,5:1 após as transições; isso não constitui uma certificação de acessibilidade de todas as telas.

As páginas públicas foram testadas no servidor de produção local. O script `scripts/verify-theme.mjs` também empacota os componentes reais do ERP para uma página temporária no loopback, com adaptadores de navegação do Next e APIs de leitura fictícias. Os registros vêm de `scripts/fixtures/theme-data.mjs`. Essa parte valida apresentação e interação do tema; não comprova autenticação real, autorização ou operações do banco. A câmera foi recusada de propósito no teste; nenhuma câmera real foi utilizada. A impressão foi conferida por emulação da mídia CSS, sem impressora física.

`checks.json` registra os resultados; `public-audit.json` resume somente as consultas públicas do site antes da atualização. Os logs registram as verificações desta entrega. Nenhum teste escreveu no banco da empresa, enviou e-mail ou alterou uma conta.

## Prévias com dados fictícios

- [Painel escuro no desktop](dashboard-dark-desktop.png)
- [Painel claro no desktop](dashboard-light-desktop.png)
- [Painel escuro no celular](dashboard-dark-390.png)
- [Tabela de produtos](produtos-dark-desktop.png)
- [Formulário](formulario-dark-desktop.png)
- [Assistente](assistente-dark-desktop.png)
- [Etiquetas](etiquetas-dark-desktop.png)
- [Leitor QR](scanner-dark-desktop.png)
- [Login](login-dark-1440.png)
- [Recuperação de acesso](recuperacao-dark-mobile.png)

Para repetir em instalação local exclusiva de testes, configure QA_ENVIRONMENT=isolated, QA_BASE_URL e QA_UNIT_ID conforme `scripts/qa-config.mjs`, e execute `npm run verify:theme`. Não execute verificadores em produção.
