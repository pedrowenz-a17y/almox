Aplicativo Almox ERP para Windows 10/11 x64, com instalador, atalhos, janela própria e desinstalador.

Baixe **Almox-ERP-2.6.0-Windows-x64-Setup.exe** nos arquivos desta entrega. Não é necessário instalar Node.js ou abrir CMD para usar.

Na primeira abertura, escolha **Escolher arquivo de configuração** para importar o .env do seu projeto e iniciar o servidor local automaticamente, ou informe o endereço HTTPS do ERP hospedado. A configuração fica salva para as próximas aberturas. Login e operações continuam exigindo banco e Supabase Auth configurados.

A configuração local usa a proteção da conta Windows (DPAPI). O instalador não contém credenciais do projeto e não importa a chave administrativa Supabase. Base de dados, migrations e contas precisam estar previamente configuradas.

O arquivo desta entrega é gerado pelo workflow manual **Instalador Windows**, em um runner Windows. A publicação ocorre depois dos testes de runtime, do empacotamento e dos cenários com a janela Electron real. Configuração, banco e provedor de autenticação dos testes são fictícios. O SHA-256 está em `SHA256SUMS.txt`; os relatórios estão anexados.

O instalador ainda não possui certificado de assinatura digital. Valide a instalação no computador de destino antes de distribuir para a empresa. Os testes automatizados não substituem a homologação do fluxo operacional com os usuários.

[Guia completo de instalação e configuração](https://github.com/pedrowenz-a17y/almox/blob/main/docs/APLICATIVO-WINDOWS.md).
