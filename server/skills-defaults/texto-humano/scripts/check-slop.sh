#!/usr/bin/env bash
# Aponta os vícios óbvios de texto com cara de IA.
# Saída limpa não quer dizer texto bom — ler em voz alta continua sendo o teste.
# uso: check-slop.sh arquivo [arquivo...]   |   sai 1 se achou algo

set -uo pipefail

if [ "$#" -eq 0 ]; then
  echo "uso: $(basename "$0") arquivo [arquivo...]" >&2
  exit 2
fi

BANIDAS='crucial|fundamental|essencial|robusto|poderoso|transformador|revolucionári|inovador|otimiz|potencializ|alavanc|desvend|mergulh|cenário|jornada|universo|nos dias de hoje|cada vez mais|vale ressaltar|é importante destacar|em um mundo onde|no fim das contas|a verdade é que|simples assim|spoiler|deixa eu te explicar|vamos por partes|não para por aí|isso muda tudo'
ESTRUTURA='não é [^.!?]{1,60}, é |não se trata de|nunca foi sobre|mais do que |não apenas |não só |não somente '
NEGRITO='^[[:space:]]*[-*+][[:space:]]+\*\*[^*]+\*\*[[:space:]]*:'

achou_algo=0

report() { # rótulo padrão arquivo
  local out
  out=$(grep -inE "$2" "$3") || return 0
  printf '  [%s]\n' "$1"
  printf '    %s\n' "$out"
  achou_algo=1
}

for f in "$@"; do
  if [ ! -f "$f" ]; then
    echo "sem arquivo: $f" >&2
    achou_algo=1
    continue
  fi
  printf '== %s\n' "$f"

  report 'palavra banida'        "$BANIDAS"  "$f"
  report 'estrutura proibida'    "$ESTRUTURA" "$f"
  report 'lista Termo: explicação' "$NEGRITO" "$f"

  travessoes=$(grep -o '—' "$f" | wc -l | tr -d ' ')
  if [ "$travessoes" -gt 1 ]; then
    printf '  [travessão] %s no texto, o limite é 1\n' "$travessoes"
    grep -n '—' "$f" | sed 's/^/    /'
    achou_algo=1
  fi
done

if [ "$achou_algo" -eq 0 ]; then
  echo "nada óbvio. agora lê em voz alta."
fi
exit "$achou_algo"
