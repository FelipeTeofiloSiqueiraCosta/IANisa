#!/usr/bin/env bash
# gerar-slide-gpt.sh — wrapper gpt-image-2 (engine B) — usa o script local da skill
#
# Uso:
#   ./gerar-slide-gpt.sh <slug> <numero-slide> <prompt> [--quality low|medium|high] [--size 1024x1536|portrait|tall]
#
# Exemplos:
#   ./gerar-slide-gpt.sh "tese-juro-zero" 01 "capa com gráfico de juros caindo, texto 'A queda do juro'" --quality high
#   ./gerar-slide-gpt.sh "tese-juro-zero" 02 "comparativo lado-a-lado: 2020 vs 2026" --quality medium

set -euo pipefail

SLUG="${1:?Falta o slug do tema}"
NUMERO="${2:?Falta o numero do slide}"
PROMPT="${3:?Falta o prompt do slide}"
shift 3

QUALITY="high"
SIZE="1024x1536"  # 4:5 vertical default

while [[ $# -gt 0 ]]; do
  case "$1" in
    --quality) QUALITY="$2"; shift 2 ;;
    --size) SIZE="$2"; shift 2 ;;
    *) echo "Argumento desconhecido: $1" >&2; exit 1 ;;
  esac
done

if [[ -z "${OPENAI_API_KEY:-}" ]]; then
  echo "❌ OPENAI_API_KEY não configurado no ambiente." >&2
  exit 2
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$SCRIPT_DIR/generate_image_gpt.py"
if [[ ! -f "$SCRIPT" ]]; then
  echo "❌ Script local não encontrado: $SCRIPT" >&2
  exit 3
fi

TIMESTAMP=$(date +"%Y-%m-%d-%H-%M-%S")
FILENAME="${TIMESTAMP}-${SLUG}-slide-${NUMERO}.png"

case "$QUALITY" in
  low)    COST="~\$0.011" ;;
  medium) COST="~\$0.042" ;;
  high)   COST="~\$0.167" ;;
esac

echo "🎨 Gerando slide ${NUMERO} via gpt-image-2 (quality=${QUALITY}, ${COST}/slide)..."

uv run "$SCRIPT" \
  --prompt "$PROMPT" \
  --filename "$FILENAME" \
  --size "$SIZE" \
  --quality "$QUALITY"

echo "✓ Slide salvo: $FILENAME"
