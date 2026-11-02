#!/usr/bin/env bash
# gerar-slide.sh — wrapper Nano Banana Pro (engine A) — usa o script local da skill
#
# Uso:
#   ./gerar-slide.sh <slug> <numero-slide> <prompt> [--template caminho.jpg] [--resolution 1K|2K|4K]
#
# Exemplos:
#   ./gerar-slide.sh "demissao-social-media" 01 "capa fotorrealista de empresário com tablet em escritório clean"
#   ./gerar-slide.sh "demissao-social-media" 02 "fundo dark com elemento gráfico sutil" --resolution 4K
#   ./gerar-slide.sh "demissao-social-media" 03 "template apple notes" --template assets/templates/template-bege-classico.jpg

set -euo pipefail

SLUG="${1:?Falta o slug do tema (ex: demissao-social-media)}"
NUMERO="${2:?Falta o numero do slide (ex: 01)}"
PROMPT="${3:?Falta o prompt do slide}"
shift 3

TEMPLATE=""
RESOLUTION="2K"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --template) TEMPLATE="$2"; shift 2 ;;
    --resolution) RESOLUTION="$2"; shift 2 ;;
    *) echo "Argumento desconhecido: $1" >&2; exit 1 ;;
  esac
done

if [[ -z "${GEMINI_API_KEY:-}" ]]; then
  echo "❌ GEMINI_API_KEY não configurado no ambiente." >&2
  echo "   Configure com: export GEMINI_API_KEY=sua-chave" >&2
  exit 2
fi

# Resolve script local da skill (este wrapper fica em scripts/ ao lado do .py)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$SCRIPT_DIR/generate_image_nano_banana.py"
if [[ ! -f "$SCRIPT" ]]; then
  echo "❌ Script local não encontrado: $SCRIPT" >&2
  exit 3
fi

TIMESTAMP=$(date +"%Y-%m-%d-%H-%M-%S")
FILENAME="${TIMESTAMP}-${SLUG}-slide-${NUMERO}.png"

ARGS=(
  --prompt "$PROMPT"
  --filename "$FILENAME"
  --resolution "$RESOLUTION"
)

if [[ -n "$TEMPLATE" ]]; then
  if [[ ! -f "$TEMPLATE" ]]; then
    echo "❌ Template não encontrado: $TEMPLATE" >&2
    exit 4
  fi
  ARGS+=(--input-image "$TEMPLATE")
fi

echo "🎨 Gerando slide ${NUMERO} de '${SLUG}' (resolução ${RESOLUTION})..."
[[ -n "$TEMPLATE" ]] && echo "   Template base: $TEMPLATE"

uv run "$SCRIPT" "${ARGS[@]}"

echo "✓ Slide salvo: $FILENAME"
