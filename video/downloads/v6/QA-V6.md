# Almox ERP V6 · Revisão de produção

A V6 continua o projeto Remotion da etapa 1. As composições V5 e as bases V6 permanecem no Studio. As telas vêm do ERP 2.15.0, commit `87ea41bca37b338289da8209498492209d0fc4e5`, com dados e contas fictícios. O repositório do ERP foi usado para leitura e para executar o harness isolado local. [Fonte de verdade](https://github.com/pedrowenz-a17y/almox/tree/87ea41bca37b338289da8209498492209d0fc4e5)

## Referências e aplicação

O Passo de 13,4 s foi reproduzido até o fim a 1×. Sua sequência foi amostrada a cada 0,5 s. Nos primeiros segundos, a interação curta e o campo de busca dirigem o olhar. Por volta de 3–5 s, a entrada escalonada muda o ritmo. Entre 5–7 s, elementos saem do celular e retornam. Entre 7–10 s, um objeto físico ancora a interface em perspectiva. O fechamento dá tempo à marca. Na V6, esses princípios orientam respectivamente o cursor e a busca, os recortes da abertura e do inventário, a etiqueta, a caixa demonstrativa e a assinatura final.

O HTML foi aberto em Chromium e conferido em seis instantes do ciclo de 5 s. Foram inspecionados `alm-type` (degraus), `alm-result` (expansão), `alm-explode` (saída, repouso, retorno), `alm-card` e `alm-progress` (defasagem) e `alm-transfer` e `alm-check` (fluxo e resposta). Em Remotion, o cursor usa o retângulo do controle, a máscara acompanha o recorte e a confirmação depende de um estado capturado depois da ação. O vídeo histórico foi consultado para conteúdo.

Foram tentadas 46 URLs externas da lista V6, com a instalação em produção deixada de fora. Houve 35 respostas HTTP 200, uma resposta 202 do Dribbble sem conteúdo útil e dez bloqueios 403, entre eles Figma, a busca do Behance e as buscas do YouTube. As páginas acessíveis e as imagens de apresentação disponíveis foram usadas como referência de contraste, hierarquia e composição. A gradação de luz de Raycast e Vercel complementou o uso de grafite, o mosaico do Framer informou o escalonamento, e o tratamento de cor e espaço na passagem de marca foi estudado com Stripe e Apple. Nenhum material de marca externo foi incorporado aos vídeos. O movimento foi guiado principalmente pelo Passo e pelo HTML do kit. [Raycast](https://www.raycast.com/) · [Vercel](https://vercel.com/) · [Framer](https://www.framer.com/) · [Stripe](https://stripe.com/) · [Apple](https://www.apple.com/)

## Escopo de fidelidade

Foram preservadas as cenas e as evidências da primeira etapa, com oito capturas adicionais para âncoras e estados de ação. As capturas são PNG em DPR 2. O código da trilha remonta fragmentos da própria captura em vez de desenhar controles. O registro de ativos tem seletor, bounding box, condição, tema, rota, viewport e commit. O manifesto de cenas relaciona esses arquivos a intervalos, quadros de ação e amostras. As 27 verificações adicionais de navegador passaram, sem erros de página ou requisições inesperadas.

O QR do objeto e o do telefone vêm da mesma captura de interface. A leitura por ZXing encontrou a mesma rota fictícia em loopback no recorte e no quadro em movimento. A demonstração no ERP usa o caminho manual para abrir a localização. A etiqueta e a linha que liga os dispositivos são elementos editoriais.

## Inspeção por cena

Os tempos nesta tabela são do Full. Quadros em `out/qa/stills` e nas pranchas permitem comparar tela, ação, resultado e saída. As tomadas reutilizadas no Launch mantêm o mesmo significado, com durações e pontos de ação reeditados.

| Cena | Verificação e decisão de acabamento |
| --- | --- |
| Abertura · 00–05 | Dashboard e logotipo oficiais. As três regiões das métricas são retiradas da base enquanto flutuam e se encaixam ao final da máscara. A câmera estabiliza o painel para leitura. |
| Consulta · 05–11 | Uso dos estados de placeholder, digitação e busca ROL-6204. A ficha posterior mostra “Onde encontrar” e 24 UN em localização. O campo e o resultado mantêm a origem real. Revisão ampliou o recorte vertical para mostrar o cabeçalho da localização e restringiu o cursor à parte visível da máscara. |
| QR · 11–19 | Etiqueta na caixa conceitual e no painel verdadeiro. A localização abre após a entrada manual. A primeira versão do recorte secundário pegou a barra móvel. O recorte foi trocado pelo código do próprio painel e ocorre retorno à origem antes da abertura do detalhe lateral. |
| Assistente · 19–29 | Pergunta e envio têm estados distintos. O recorte da resposta vem do motor local e volta ao painel. A frase em destaque fica fora da interface. |
| Reposição · 29–35 | Consulta dos critérios da linha real. A linha se destaca mantendo a escala da captura e volta para o mesmo retângulo. |
| Inventário · 35–41 | 24 no sistema, 23 contadas, diferença de −1. A faixa editorial apenas repete os números capturados. Vê-se o bloqueio do autor, revisão do mesmo registro por outra conta e resultado aprovado. |
| Entrega · 41–48 | Primeiro o operador registra para a conta indicada. O último estado de espera fica visível enquanto o destinatário atesta a quantidade. Foram acrescentadas capturas reais com e sem conferência marcada. O painel pendente sai antes da tela confirmada. |
| Turno · 48–54 | O titular permanece até o aceite. A animação de cursor coincide com o acionamento de “Aceitar e assumir turno”. O novo titular entra em um estado capturado depois da ação. |
| CSV · 54–61 | O objeto CSV fica fora do aplicativo. A associação de colunas e a prévia são as capturas reais. As linhas entram em máscaras coordenadas. O parecer fica na etapa de revisão independente. |
| Alertas · 61–67 | Dois recortes dos alertas reais se recompõem. O botão de leitura tem âncora no primeiro aviso verificado. A indicação lida preserva a pendência. |
| Gerencial · 67–73 | Três colunas da matriz são recompostas. A comparação por unidade foi mantida sem mudança da unidade ativa. O afastamento abre espaço para o celular com a captura móvel clara. |
| Encerramento · 73–78 | Notebook e celular exibem screenshots do ERP no próprio tema. O logotipo usa o PNG oficial. O movimento se encerra antes do último trecho para dar tempo à assinatura. |

O Launch dá tempo a consulta, QR, orientação, inventário e recebimento, seguido de Alertas e Gerencial. A cartela cinética em vermelho entra aos 29 s. A assinatura ocupa 32–35 s. O corte curto tem pontos de ação próprios para a confirmação.

## Ciclos de QA

1. Protótipo de 14 s reproduzido até o fim. Inspeção por ordem de quadros antes e depois da correção de QR, aceite e estado de espera.
2. MotionLab de 32,1 s reproduzido até o fim. Inclui montagem do dashboard, expansão de busca, saída e retorno do QR e do código, números escalonados, confirmação, gerencial, tipografia e marca.
3. Inspeção prévia de 64 PNGs a 960 × 540 nas duas montagens. Títulos começaram a entrar antes no quadro local para eliminar as cartelas quase vazias nas trocas, e o cursor ficou preso ao recorte mostrado.
4. As decodificações dos quatro MP4 passaram. Foram extraídos 492 quadros do Full, 324 do Launch, 129 do protótipo e 265 do MotionLab para pranchas de revisão. A extração amostrou os estados a cada segundo e os arredores das ações a cada 7–8 quadros. As pranchas de resumo mostram a sequência dos estados.
5. A varredura FFmpeg não encontrou quadros pretos. O detector de imagem estável marcou pausas de leitura, como os resultados da consulta, a pergunta e a resposta do assistente e os estados de turno e alertas. A assinatura final fica estável por aproximadamente 1,9 s no Full e 2,1 s no Launch. Os textos secundários ficam menores nos planos de contexto. A leitura principal usa os recortes e títulos.
6. Os masters têm 1920 × 1080, 30 fps e H.264, com trilha instrumental e efeitos em AAC estéreo. O Full mediu −15,6 LUFS e −2,4 dBTP. O Launch mediu −15,3 LUFS e −3,4 dBTP. A verificação mediu os arquivos exportados.

7. Full, Launch e as duas prévias finais foram reproduzidos até o fim a 1× em Chromium. As contagens de quadros decodificados coincidem com o FFprobe. O navegador registrou descartes pontuais de exibição no teste local e a decodificação integral via FFmpeg confirmou a presença de todos os quadros nos arquivos.

## Entrega e narração

| Arquivo | Resultado |
| --- | --- |
| `out/final/Almox-ERP-Full-V6.mp4` | 78 s de imagem, 2.340 quadros. |
| `out/final/Almox-ERP-Launch-V6.mp4` | 35 s de imagem, 1.050 quadros. |
| `out/qa/Almox-ERP-MotionLab-V6.mp4` | 32,1 s, prévia de animação a 960 × 540. |
| `out/qa/Almox-ERP-MotionPrototype-V6.mp4` | 14 s, prévia de consulta, QR e recebimento a 960 × 540. |
| `Almox-ERP-Narrated-V6.mp4` | Condicionado à locução ElevenLabs aprovada. |

O pacote veio com roteiro e janelas-alvo. A biblioteca conectada do ElevenLabs não retornou áudio de Almox. Os WAVs encontrados no diretório de testes V5 são sinais de 0,4 s, identificados pela duração e pela igualdade do arquivo de teste. O relatório V5 registrou estimativa de créditos e uma validação com esses sinais. Não há evidência de uma tomada de voz produzida. Nenhuma geração paga foi acionada. O validador da V6 bloqueou entrada ausente, sinal de teste curto e trecho silencioso. Os SRT finais dependem dos tempos da fala e ainda não foram gerados.

O roteiro e as janelas corrigidas ficam em `narracao/`. Os scripts de importação local, prévia de custo e masterização estão em `scripts/generate-narration.mjs` e `scripts/validate-narration.mjs`. O README do projeto registra os comandos. O código Remotion, os MP4, os manifestos e as pranchas foram preparados para entrega local em `/workspace/output/Almox-ERP-V6/`. Nenhuma versão foi publicada.
