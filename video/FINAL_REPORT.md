# Relatório de entrega

## Arquivos verificados

| Arquivo | Duração de vídeo | Quadros | Tamanho | Loudness integrado | Pico verdadeiro |
| --- | --- | --- | --- | --- | --- |
| `out/final/Almox-ERP-Full.mp4` | 78 s | 2340 | 16,7 MB | -15,4 LUFS | -3,1 dBTP |
| `out/final/Almox-ERP-Launch.mp4` | 35 s | 1050 | 8,8 MB | -15,4 LUFS | -2,8 dBTP |

Os dois MP4 usam 1920 × 1080, 30 fps, H.264 e AAC estéreo de 48 kHz. A capa `out/final/Almox-ERP-Thumbnail.png` tem 1920 × 1080. A pasta `out/previews/` reúne a versão institucional em 540p e clipes de abertura, QR, assistente, recebimento e encerramento. As folhas de contato e os quadros em PNG ficam em `out/frames/`.

## Implementação

A montagem completa tem 12 cenas. A versão de 35 s tem 8 cenas com blocos próprios para estoque e operação. O encerramento institucional começa com desktop e celular e termina com a marca U.C.A. e a assinatura «Do estoque à operação». Em ambas, a entrega passa do registro à resposta no telefone e à consulta do status pelo desktop.

A implementação usa Remotion 4.0.547, React 19, TypeScript, CSS 2.5D, Lucide e arquivos de áudio locais. Os componentes reutilizáveis incluem palco, tipografia animada, marca, janelas desktop e celular, cursor, tabelas, cartões, estados de confirmação e indicadores. A timeline é editável no Remotion Studio e as cenas estão registradas para revisão individual.

As telas foram reconstruídas com campos e fluxos verificados no ERP e dados demonstrativos. A trilha instrumental e os efeitos foram criados para o filme. A entrega prioriza as duas composições horizontais, com assinatura de marca e sem locução.

## Verificação executada

- TypeScript executado com checagem de importações e parâmetros sem uso.
- Remotion Studio aberto em Chromium via Playwright, com inspeção do carregamento da composição institucional.
- Quadros representativos das 12 cenas, capa e sequência de recebimento revisados, incluindo registro, ação no celular e confirmação consultada no desktop.
- FFprobe confirmou codec, quadros, dimensão, taxa de quadros e trilha nos arquivos finais.
- FFmpeg decodificou os dois filmes completos e mediu loudness e pico verdadeiro. A detecção não identificou trechos pretos com pelo menos 0,1 segundo.
- Exportações executadas com `npm run render:launch`, `npm run render:full` e Chromium local. Clipes em 540p foram derivados com FFmpeg.

A auditoria do original está em [AUDIT.md](AUDIT.md). A procedência e licenças dos materiais estão em [ASSET_MANIFEST.md](ASSET_MANIFEST.md).
