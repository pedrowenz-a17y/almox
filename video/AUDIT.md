# Auditoria do filme original

O arquivo analisado foi `Almox-ERP (3).mp4`, anexado como referência. O FFprobe identificou 78,00 s, 1920 × 1080, 30 fps, H.264 a 2,00 Mb/s e AAC estéreo a 48 kHz. A inspeção visual usou 13 quadros representativos. A detecção de mudanças de cena com FFmpeg identificou cortes ou mudanças fortes aos 29,4 s, 34,9 s, 48,0 s, 53,5 s, 60,7 s, 66,2 s e 72,6 s. A amostragem visual identificou também mudanças graduais.

## Sequência observada

Abertura com fotografia de implemento, consulta de materiais, QR Code no celular, assistente, reposição, inventário, recebimento, passagem de turno, conferência por CSV, alertas, comparação de unidades e tela de instalação.

## Decisões de montagem

- A alternância entre fundos claros e escuros e a posição repetida da interface davam um ritmo semelhante a várias cenas. A nova montagem usa grafite com vermelho localizado, movimentos em perspectiva, detalhes amplificados e variação de composição entre cenas.
- As telas de inventário, assistência e conciliação continham bastante texto em área reduzida. A recriação prioriza campos, valores e mensagens centrais, com suporte em texto de cena.
- A cena de recebimento original mostrava a interface desktop no quadro amostrado. O filme novo acompanha a mesma entrega entre desktop e celular, com o refresh explícito na visão da unidade.
- A tela de instalação ocupava o final. O novo encerramento usa a marca U.C.A., o nome do produto e a assinatura. A versão de 35 s abre o encerramento com a composição dos dois dispositivos.

## Materiais e verificação

O clone local corresponde ao commit `98db567`. O ERP usa Next.js 16, React 19 e TypeScript. Foram consultados o README, a documentação de marca e fluxos e os componentes em `src/components/` e `src/services/`. As capturas das pastas `theme-audit`, `refresh`, `independent-inventory`, `delivery-receipts`, `operational-responsibility`, `erp-reconciliation`, `operational-alerts` e `management` serviram de referência de interface.

- A documentação do recebimento confirma o aceite autenticado do destinatário e a consulta do desktop por **Atualizar**.
- As telas e serviços confirmam aprovação independente do inventário, consulta local do assistente, revisão das diferenças de CSV e acompanhamento de alertas com estado de leitura.
- O sistema documenta instalação em Android, Windows e navegador. A seleção editorial concentra a cena final na assinatura da marca.
- O README do ERP registra a versão 2.15.0. As peças audiovisuais usam a marca Almox ERP sem selo numérico de versão.
- O material de trabalho inclui a gravação original, as referências visuais do briefing, o logo U.C.A., as fontes locais e as capturas do repositório. O filme usa trilha original gerada para esta montagem e dados demonstrativos em todas as telas operacionais.

O projeto roda localmente, em diretório independente do ERP, com fontes e imagens empacotadas.
