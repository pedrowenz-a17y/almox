# Almox ERP V6 · Manifesto de capturas

Origem das telas. Componentes e CSS reais do ERP 2.15.0, commit `87ea41bca37b338289da8209498492209d0fc4e5`, executados em Chromium no servidor de fixtures em loopback. Capturas PNG em DPR 2. O logo `public/etapa1/uca-oficial.png` é o arquivo `public/brand/uca-oficial.png` do ERP, conforme `src/lib/brand.ts`. As fontes Manrope e DM Sans e suas licenças vêm do projeto audiovisual anterior.

O JSON `public/etapa1/manifest.json` contém a rota e estado, seletor, viewport, zoom de dispositivo, scroll da janela, dimensões PNG, bounding boxes e regiões opcionais. As coordenadas de interface são CSS relativas ao viewport. Para recortar no raster, multiplique por DPR. Para posicionar na composição, use a transformação de ajuste ao recorte em `src/v6/geometry.ts`.

As camadas PNG em `public/etapa1/recortes/` foram extraídas sem reamostragem. O `index.json` mapeia cada recorte ao PNG completo e informa posição e tamanho em pixels e CSS. Áreas visíveis parcialmente e controles fora do viewport ficam registrados no manifesto sem coordenadas fabricadas. O cursor aponta apenas para controles cuja área está visível.

As capturas anteriores do GitHub, os MP4 V5 e as referências do pacote foram usados para comparação. Os PNGs abaixo vieram da sessão isolada. A coluna Estado especifica a operação que precedeu a captura.

| PNG | Rota de teste | Tema | Raster | Seletor | Estado |
| --- | --- | --- | --- | --- | --- |
| `dashboard.png` | `/dashboard` | dark | 2880 × 2000 | `.stats-grid` | Painel autenticado com dados fictícios |
| `consulta-inicial.png` | `/consulta` | dark | 2880 × 2000 | `.lookup-desk` | Consulta rápida antes de digitar |
| `consulta-digitando.png` | `/consulta` | dark | 2880 × 2000 | `.lookup-desk` | Prefixo ROL filtra a lista |
| `consulta-resultado.png` | `/consulta` | dark | 2880 × 2000 | `.lookup-material` | Resultado ROL-6204 com quantidade e estado |
| `produto-localizacoes.png` | `/produto/123e4567-e89b-42d3-a456-000000000010` | dark | 2880 × 2000 | `.material-locations` | Ficha real com saldo detalhado por localização |
| `scanner-mobile.png` | `/consulta` | dark | 780 × 1688 | `.scanner-card` | Scanner inicial, câmera fechada |
| `localizacao-manual.png` | `/localizacao/123e4567-e89b-42d3-a456-000000000008` | dark | 780 × 1688 | `.page-heading` | Localização aberta após consulta de código fictício |
| `etiqueta-mobile.png` | `/produto/123e4567-e89b-42d3-a456-000000000010` | dark | 780 × 1688 | `.product-qr-panel` | Etiqueta gerada para a fixture em localhost |
| `produto-mobile.png` | `/produto/123e4567-e89b-42d3-a456-000000000010` | dark | 780 × 1688 | `.material-locations` | Ficha de material com distribuição por localização |
| `assistente-local.png` | `/dashboard` | dark | 2880 × 2000 | `.ai-panel` | Modo local e composer reais |
| `assistente-resposta.png` | `/dashboard` | dark | 2880 × 2000 | `.ai-panel` | Orientação do motor local para QR, com consulta da unidade desativada |
| `reposicao.png` | `/reposicao` | dark | 2880 × 2000 | `tbody tr` | Linha de reposição, disponível 7 UN e mínimo 10 UN |
| `inventario-autor.png` | `/inventario` | dark | 2880 × 2000 | `[role=dialog]` | Autor da mesma contagem impedido de autoaprovar |
| `inventario-revisor.png` | `/inventario` | dark | 2880 × 2000 | `[role=dialog]` | Revisor independente em Inventário |
| `entrega-revisao.png` | `/ordens-producao?ordem=123e4567-e89b-42d3-a456-000000000902` | dark | 2880 × 2000 | `[role=dialog]` | Operador revisa entrega para conta do ERP |
| `recebimento-aguardando.png` | `/recebimentos?entrega=123e4567-e89b-42d3-a456-000000000904` | dark | 2880 × 2000 | `.receipt-detail` | Consulta do operador, antes do aceite |
| `recebimento-consentimento.png` | `/recebimentos` | dark | 780 × 1688 | `[role=dialog]` | Destinatário confere quantidade e confirma |
| `recebimento-confirmado.png` | `/recebimentos` | dark | 780 × 1688 | `.receipt-detail` | Destinatário após aceite |
| `recebimentos-unidade.png` | `/recebimentos` | dark | 2880 × 2000 | `.receipt-cards` | Consulta por unidade, com permissão |
| `recebimentos-lista-mobile.png` | `/recebimentos` | dark | 780 × 1688 | `.receipt-cards` | Recebimentos em viewport de 390 px |
| `turno-aguardando.png` | `/pendencias` | dark | 2880 × 2000 | `.shift-handover` | Titular anterior permanece até o aceite |
| `turno-aceitar.png` | `/pendencias` | dark | 2880 × 2000 | `[role=dialog]` | Aceite explícito pela pessoa indicada |
| `turno-assumido.png` | `/pendencias` | dark | 2880 × 2000 | `.shift-current` | Novo titular após aceite |
| `csv-importar.png` | `/conciliacao` | dark | 2880 × 2000 | `.recon-import` | Arquivo com colunas e critérios associados |
| `csv-revisao.png` | `/conciliacao` | dark | 2880 × 2000 | `[role=dialog]` | Revisão independente e parecer antes da conclusão |
| `alertas.png` | `/alertas` | dark | 2880 × 2000 | `.alerts-filters` | Filtros da Central de alertas |
| `alertas-leituras.png` | `/alertas` | dark | 2880 × 2000 | `.alerts-cards` | Histórico de leituras da Central de alertas |
| `gerencial.png` | `/gestao` | dark | 2880 × 2000 | `.management-matrix` | Visão da operação com unidades autorizadas |
| `gerencial-mobile.png` | `/gestao` | light | 780 × 1688 | `.page-heading` | Comparação de unidades no celular |
| `inventario-aprovado.png` | `/inventario` | dark | 2880 × 2000 | `tbody tr:has-text("Conferente de demonstração")` | Resultado Aprovado após ação do revisor |
| `csv-previa.png` | `/conciliacao` | dark | 2880 × 2000 | `.recon-lines` | Prévia com linhas que conferem e divergências antes de registrar |

## Capturas acrescentadas na etapa 2

| Arquivo | Componente e função | Estado validado |
| --- | --- | --- |
| `dashboard-montagem.png` | `dashboard.tsx`, `.stats-grid` | Três cards e banner com âncoras separadas. |
| `consulta-motion.png` | `quick-lookup.tsx`, `.lookup-desk` | Campo real e resultado ROL-6204. |
| `produto-qr-motion.png` | `product-overview.tsx`, `.product-qr-panel` | Imagem QR e código na mesma captura móvel. |
| `assistente-digitado.png` | `assistant.tsx`, diálogo | Pergunta digitada antes de enviar. |
| `recebimento-sem-aceite.png` | `delivery-receipts.tsx`, diálogo | Conferência integral por declarar. |
| `recebimento-com-aceite.png` | `delivery-receipts.tsx`, diálogo | Conferência integral declarada antes de confirmar. |
| `alertas-pendentes.png` | `operational-alerts.tsx`, cartões | Dois alertas e botão “Marcar como lido” do primeiro. |
| `alerta-lido.png` | `operational-alerts.tsx`, cartão | O mesmo aviso lido com pendência preservada. |

O manifesto JSON registra as 39 capturas e os retângulos de todas as âncoras. As verificações dos estados adicionais estão em `public/etapa1/checks-motion.json`. Para reproduzir, execute `node scripts/etapa1/capture.mjs "$erp_ref" motion` e `python scripts/etapa1/crops.py` com a cópia do ERP preparada de acordo com o handoff.
