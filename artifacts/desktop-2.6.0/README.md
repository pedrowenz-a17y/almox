# Validação do aplicativo Windows 2.6.0

O instalador distribuído foi gerado e testado no Windows na [execução 42442820123](https://github.com/pedrowenz-a17y/almox/actions/runs/42442820123). `windows/` contém os relatórios da publicação, dez cenários da janela e seis verificações do aplicativo instalado, incluindo DPAPI real, componentes nativos, reabertura e desinstalação. Nenhum banco real foi utilizado.

`package-checks.json` e `SHA256SUMS.txt` correspondem ao executável publicado. Os arquivos com sufixo `-linux` preservam a primeira compilação cruzada. Os demais logs desta pasta registram a validação inicial em Linux:

- `build.log`: build Next.js de produção com configuração fictícia. Autenticação do servidor lê a configuração em tempo de execução.
- `tests.log`: 215 testes do ERP aprovados, sem testes ignorados, em PostgreSQL isolado.
- `desktop-tests.log`: oito testes de origem, importação, armazenamento cifrado, início e encerramento do servidor.
- `health-tests.log`: duas verificações específicas da sonda local e da configuração dinâmica; também estão na regressão completa.
- `electron.log`, `electron-checks.json`: dez cenários com Electron real, banco/provedor fictícios e Next.js de produção em Linux/Xvfb. A criptografia nativa Windows é substituída apenas no teste por AES. Não comprova instalação em Windows físico ou login no Supabase real.
- `package-checks-linux.json`: comparação dos recursos e do ASAR da primeira compilação cruzada. A versão Windows distribuída tem seu relatório correspondente em `windows/package-checks.json`.
- `installer.log`, `prepare-server.log`: empacotamento NSIS e preparação dos binários Windows, sem dados reais.
- `lint.log`, `typecheck.log`: verificações estáticas.
- As duas imagens são capturas da janela real da configuração e do login, sem credenciais de produção.

O instalador não possui certificado de assinatura digital. Os testes automatizados no runner Windows não substituem a homologação operacional da empresa nem comprovam acesso ao seu banco/Supabase.
