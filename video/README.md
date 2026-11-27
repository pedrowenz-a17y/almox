# Almox ERP · Filme de produto

Projeto Remotion independente, em português, com interfaces reconstruídas a partir do código, da documentação e das capturas do ERP. Todos os registros mostrados foram criados para a demonstração.

| Composição | Duração | Conteúdo |
| --- | --- | --- |
| AlmoxERP-Full | 78 s | Demonstração em 12 cenas |
| AlmoxERP-Launch | 35 s | Montagem institucional em 8 cenas |
| AlmoxERP-Thumbnail | Quadro | Capa com painel em perspectiva e marca U.C.A. |

As duas composições de vídeo usam 1920 × 1080, 30 fps e áudio instrumental estéreo com efeitos sincronizados.

## Editar e exportar

Use Node.js 22 ou 24 e npm. A validação de arquivos exportados usa FFprobe.

```bash
npm ci
npm run studio
npm run typecheck
npm run preview
npm run thumbnail
npm run render:full
npm run render:launch
npm run validate
```

O Studio abre em http://localhost:3000. Escolha a composição desejada ou uma cena na pasta **Cenas**. Os cortes e suas durações estão em `src/Film.tsx`. Títulos e interações ficam em `src/scenes`. A paleta, os componentes de interface e a iluminação ficam em `src/design.tsx` e `src/film.css`. A propriedade `sound` permite desativar a trilha nas duas composições.

Em uma máquina com Chromium instalado, defina `ALMOX_CHROMIUM` com o caminho do executável se o Remotion não conseguir baixar o navegador. A produção deste filme usou `ALMOX_CHROMIUM=/usr/bin/chromium`.

## Exportações

| Pasta | Conteúdo |
| --- | --- |
| `out/final/` | MP4 completo, MP4 institucional e capa Full HD |
| `out/previews/` | Institucional em 540p e clipes das cenas-chave |
| `out/frames/` | Quadros de revisão em PNG |

`npm run render:all` exporta os dois vídeos. O roteiro mantém 12 cenas no filme completo. A montagem institucional combina reposição com inventário, alertas com visão gerencial e uma transição dos dispositivos para a assinatura do produto.

## Áudio e QR Code

As duas faixas já estão incluídas para edição e renderização. Para reconstruir o áudio, instale Python 3, NumPy e FFmpeg e execute `python scripts/soundtrack.py`. Para reconstruir a etiqueta, execute `node scripts/qr.mjs`.

A origem dos materiais está em [ASSET_MANIFEST.md](ASSET_MANIFEST.md). [AUDIT.md](AUDIT.md) registra a análise do filme original. [FINAL_REPORT.md](FINAL_REPORT.md) descreve as exportações verificadas.

## Licença do Remotion

O Remotion 4 distingue avaliação, uso individual e organizações. A licença distribuída com a versão usada inclui empresas com até três funcionários entre os casos elegíveis para uso gratuito e prevê licença empresarial para organizações fora das condições de gratuidade. [Licença do Remotion](https://www.remotion.dev/docs/license)
