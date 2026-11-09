# Almox ERP para Android · 1.0.0

Aplicativo instalável para Android 8.0 ou superior, com Android System WebView atualizado. O servidor ERP é a versão 2.7.0; a versão do instalador Android é independente.

## Instalar e conectar

1. Baixe [Almox ERP Android 1.0.0](https://github.com/pedrowenz-a17y/almox/raw/refs/tags/android-v1.0.0/android-distribution/Almox-ERP-Android-1.0.0.apk) no celular. Esse arquivo é o instalador, não um ZIP de código-fonte.
2. Abra o APK e autorize a instalação desse arquivo pelo navegador ou gerenciador de arquivos, se o Android solicitar. Não é necessário desativar o Play Protect.
3. Abra **Almox ERP**. O campo já vem preenchido com o endereço informado pelo autor do projeto. Toque em **Conectar à minha unidade**.
4. Entre com sua conta autorizada do ERP. A conexão é lembrada nas próximas aberturas. A câmera só é solicitada ao utilizar a leitura de QR.

O menu **⋮ → Conexão** permite trocar o endereço depois, sem reinstalar. Ele precisa ser uma origem HTTPS completa, sem `/login` no final. A primeira conexão verifica se existe uma página de login do Almox naquele endereço antes de salvar.

**Situação do endereço fornecido em 9/11/2026:** a página inicial responde com “Sem conexão”, e `/login` retorna 404. O aplicativo identifica essa situação e pede a publicação do servidor. Instalar o APK sozinho não corrige o servidor. Siga [Publicar na Vercel](PUBLICAR-VERCEL.md).

## Como funciona

O Android é um cliente nativo com WebView: tem ícone, janela, navegação e integração com recursos do celular; as telas e operações são fornecidas pelo mesmo servidor Next.js do site. Não é uma implementação separada das regras de estoque. PC, celular e navegador consultam a mesma base e respeitam a unidade e as permissões da conta.

As atualizações de dados aparecem ao consultar ou atualizar a tela; não há sincronização instantânea garantida entre telas já abertas. Mudanças nas telas do site chegam pela hospedagem. Mudanças no código Android exigem um novo APK assinado com a mesma chave e com `versionCode` maior.

O computador pode ficar desligado **quando o servidor estiver publicado na nuvem**. É necessária internet para autenticar, consultar e registrar operações. Não há movimentações offline nem armazenamento local de uma cópia do estoque.

## Recursos do celular

- Câmera para o leitor QR existente no ERP; sem acesso ao microfone.
- Escolha de imagens pelo seletor do Android, sem acesso geral aos arquivos do dispositivo.
- Exportações CSV, Excel, PDF e imagens, até 10 MB por arquivo, pelo diálogo **Salvar** do Android.
- Etiquetas e relatórios com a opção de impressão do Android, inclusive salvar como PDF quando disponível.
- Botão Voltar, atualização da página e confirmação antes de abrir links externos no navegador.

O APK não contém chaves de banco, chave administrativa Supabase ou chave OpenAI. Essas variáveis ficam no servidor. A sessão autenticada é mantida pelo WebView; o backup automático dos dados do aplicativo está desativado. O assistente gratuito continua sendo a opção padrão do ERP.

## Conferência do instalador e testes

O pacote de distribuição acompanha `SHA256SUMS.txt`, o certificado público e `VALIDACAO.json`. No Windows:

```bat
certutil -hashfile Almox-ERP-Android-1.0.0.apk SHA256
```

Compare o resultado com `SHA256SUMS.txt`. A assinatura própria do projeto usa APK Signature Scheme v2/v3; ela permite atualizar a instalação com a mesma chave. Não representa publicação ou verificação pela Google Play.

Os testes automatizados de Android usam um emulador e páginas fictícias isoladas para verificar configuração, proteção da integração nativa e abertura/encerramento da câmera. Não tentam login na conta real nem movimentam o estoque da empresa. As evidências e os limites estão em [artifacts/android-1.0.0](../artifacts/android-1.0.0/README.md).

O APK assinado desta entrega também foi instalado e reaberto com sucesso no emulador Android 15, com a tela de conexão verificada. Isso não comprova disponibilidade do servidor nem substitui o teste no seu aparelho.

## Compilar uma nova versão

Use JDK 21 e Android SDK 36, ou execute o workflow manual **Aplicativo Android** no GitHub Actions. O wrapper Gradle está versionado e tem checksum fixado.

```bat
cd mobile
gradlew.bat testDebugUnitTest lintRelease assembleRelease assembleDebug assembleDebugAndroidTest
```

O resultado padrão em `app/build/outputs/apk/release/app-release-unsigned.apk` **ainda não é instalável**: falta a assinatura. O workflow não recebe a chave de distribuição. A ferramenta `mobile/tools/SignApk.java` assina localmente usando o pacote oficial `com.android.tools.build:apksig:8.13.2`, um keystore JKS de alias `almox` e um arquivo de senha. Mantenha esses arquivos fora do Git e do APK.

O certificado público desta versão está em `mobile/signing-certificate.pem`; sua impressão SHA-256 está em `mobile/signing-certificate.sha256`. Guarde o backup privado de assinatura em local protegido: sem essa chave, uma versão futura não atualiza a instalação existente. A chave privada não é necessária para instalar ou usar o aplicativo.

O workflow manual **Verificar instalador Android** inspeciona a assinatura e instala o APK já assinado existente em `android-distribution/`. Execute-o na branch de distribuição candidata antes de criar a tag de uma entrega; o workflow não publica arquivos nem usa chaves privadas.
