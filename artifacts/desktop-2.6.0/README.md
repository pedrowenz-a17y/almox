# Validação do aplicativo Windows 2.6.0

- `build.log`: build Next.js de produção com configuração fictícia. Autenticação do servidor lê a configuração em tempo de execução.
- `tests.log`: 215 testes do ERP aprovados, sem testes ignorados, em PostgreSQL isolado.
- `desktop-tests.log`: oito testes de origem, importação, armazenamento cifrado, início e encerramento do servidor.
- `health-tests.log`: duas verificações específicas da sonda local e da configuração dinâmica; também estão na regressão completa.
- `electron.log`, `electron-checks.json`: dez cenários com Electron real, banco/provedor fictícios e Next.js de produção em Linux/Xvfb. A criptografia nativa Windows é substituída apenas no teste por AES. Não comprova instalação em Windows físico ou login no Supabase real.
- `package-checks.json`: comparação por hash de todos os recursos do servidor, bibliotecas PE Windows x64, versão e conteúdo do ASAR, ausência de `.env`/harness e checksum do instalador completo.
- `installer.log`, `prepare-server.log`: empacotamento NSIS e preparação dos binários Windows, sem dados reais.
- `lint.log`, `typecheck.log`: verificações estáticas.
- As duas imagens são capturas da janela real da configuração e do login, sem credenciais de produção.

O instalador não possui certificado de assinatura digital. A compilação e os testes desta pasta foram feitos no Linux; a instalação e a DPAPI devem ser homologadas em Windows.
