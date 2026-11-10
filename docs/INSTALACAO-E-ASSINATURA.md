# Instalação e assinatura · Almox ERP 2.7.2

## Baixar os arquivos Android e Windows

Compartilhe **https://almox-blush.vercel.app/instalar**. A página mantém a identidade U.C.A. e apresenta **Baixar para Android** (APK 1.0.0) e **Baixar para Windows** (EXE 2.6.0), com versões, tamanhos aproximados e requisitos. Os links apontam para os arquivos oficiais já publicados no GitHub; não passam os binários grandes pelo servidor Vercel.

O clique inicia o download. A pessoa abre o arquivo recebido e confirma a instalação no sistema operacional. Não há instalação silenciosa, permissão automática ou remoção dos avisos de origem. A página mostra o endereço da própria instalação do ERP e permite copiá-lo para o campo **Endereço do ERP** dos aplicativos. O APK publicado anteriormente vem com um domínio antigo; é necessário substituí-lo pelo endereço atual indicado na página.

Os arquivos nativos não foram recompilados nem receberam nova assinatura nessa revisão. O que mudou foi a página de distribuição. As evidências da navegação e dos links estão em [download-installation](../artifacts/download-installation/README.md).

## Instalar a versão hospedada

Na mesma página, abra **Outra opção: instalar pelo navegador** para instalar a aplicação web (PWA), com ícone e janela própria, no Android e Windows. O botão de instalar aparece quando o navegador fornece essa opção; há instruções para o menu quando ela não está disponível. Em um navegador sem suporte, o site continua utilizável pela aba.

- **Android:** abra no Chrome → menu ⋮ → Adicionar à tela inicial/Instalar aplicativo.
- **Windows:** abra no Edge → menu ⋯ → Aplicativos → Instalar este site como aplicativo. No Chrome, procure a instalação na barra de endereço ou no menu de salvar e compartilhar.

Essa opção é fornecida pelo navegador a partir do endereço HTTPS, em vez de usar os arquivos APK e EXE. Mantém as proteções do sistema e os avisos/consentimentos normais do navegador. Não é publicação na Google Play ou Microsoft Store.

Cada pessoa entra com a própria conta e suas permissões. Os dados continuam no mesmo servidor e na mesma unidade; o PC pode ficar desligado quando o ERP está hospedado na nuvem. É necessária internet para consultar ou movimentar estoque. Instalar a interface não comprova que as conexões de banco e o login estejam configurados.

## O que foi conferido nos arquivos existentes

O APK Android 1.0.0 mantém assinatura v2/v3 válida, com o certificado público esperado. Sua integridade coincide com a entrega previamente testada. Certificado próprio identifica as atualizações da mesma aplicação, mas não estabelece reputação perante a loja ou o Play Protect. Um aviso de download potencialmente nocivo ou de origem desconhecida pode continuar aparecendo fora da loja.

O EXE Windows 2.6.0 publicado não possui tabela de certificados Authenticode no cabeçalho PE. Assim, a identidade do editor não é certificada pelo Windows. Os testes anteriores de instalação e os checksums não substituem uma assinatura de editor.

Essas verificações não são uma análise antivírus e não demonstram ausência de código malicioso. Se houver detecção com nome de ameaça, interrompa a distribuição daquele arquivo e investigue o alerta específico; não o trate automaticamente como falso positivo.

## Distribuição nativa com reconhecimento de editor

Para o Android, prepare o aplicativo e a política de privacidade para a Google Play, com conta de desenvolvedor, verificação de identidade, assinatura e revisão pelos critérios vigentes. A aprovação e as mensagens apresentadas dependem da plataforma. A chave privada atual precisa ser preservada para manter a compatibilidade com as instalações diretas já existentes; a estratégia de assinatura na loja deve ser revisada antes do primeiro envio.

Para o Windows, use um serviço/certificado de assinatura de código aceito pelo Windows, com identidade verificada do responsável autorizado pelo projeto, e assine os executáveis e o instalador com carimbo de tempo. Outra opção é preparar a publicação na Microsoft Store. Uma assinatura válida não garante que o SmartScreen libere imediatamente um aplicativo novo: reputação e políticas do dispositivo também participam da decisão.

Essas etapas exigem conta/verificação do titular e, conforme o serviço, contratação. Não há certificado público de editor Windows nem acesso às contas de publicação disponíveis nesta sessão. Nenhum selo, aprovação de loja ou assinatura pública foi criado por esta alteração.

## Segurança da versão 2.7.1

- Atualização de `sharp` 0.34.5 para 0.35.5 para corrigir avisos conhecidos das bibliotecas de imagem subjacentes; dependências e lockfile atualizados sem `audit fix --force`.
- Auditoria de dependências de produção: zero vulnerabilidades conhecidas reportadas pelo npm no momento da verificação. Isso é uma consulta a uma base de avisos, não uma garantia de segurança.
- Permanecem sete avisos moderados na cadeia de ferramentas TypeScript/ESLint do projeto web e seis na cadeia de empacotamento desktop, associados ao `minimatch`. São registrados separadamente nos relatórios; não foi forçada uma troca de versão principal do empacotador para ocultar esses resultados.
- Service worker com atualização sem cache do script e política de execução/conexão restrita à própria origem. O cache armazena somente assets públicos; não guarda páginas autenticadas ou respostas da API. Offline, a aplicação não confirma movimentações.
- Instalação pelo navegador depende de consentimento. Cancelamento/recusa são tratados sem exceção JavaScript. A interface não afirma instalação concluída apenas porque o usuário abriu o diálogo.

Veja [evidências e limites dos testes](../artifacts/security-installation/README.md). Os APK e EXE anteriores não foram substituídos nem receberam uma nova assinatura nesta revisão.
