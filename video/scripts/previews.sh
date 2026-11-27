#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p out/previews

export_preview() {
  local source="$1" start="$2" duration="$3" filename="$4"
  ffmpeg -nostdin -hide_banner -loglevel error -y -ss "$start" -i "out/final/$source" -t "$duration" \
    -vf scale=960:540 -c:v libx264 -preset veryfast -crf 20 -c:a aac -b:a 128k -movflags +faststart \
    "out/previews/$filename.mp4"
}

export_preview Almox-ERP-Launch.mp4 0 35 Almox-ERP-Launch-Preview
export_preview Almox-ERP-Full.mp4 0 5 01-Abertura
export_preview Almox-ERP-Full.mp4 11 8 02-QR-Code
export_preview Almox-ERP-Full.mp4 19 10 03-Assistente
export_preview Almox-ERP-Full.mp4 41 7 04-Entrega-e-recebimento
export_preview Almox-ERP-Full.mp4 73 5 05-Encerramento
