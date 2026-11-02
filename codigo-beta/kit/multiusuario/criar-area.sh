#!/usr/bin/env bash
# Transforma uma pasta (em geral um repo git) em ÁREA do time: a pasta que várias pessoas da
# Ratoeira usam ao mesmo tempo, cada uma com o próprio usuário Linux. Roda como root, uma vez.
#   sudo ./criar-area.sh <id> <caminho> [dono]
#   dono = quem roda o sync com o GitHub; segue lendo e escrevendo até nas pastas restritas
#   ex.: sudo ./criar-area.sh time /srv/ratoeira/areas/time ana
# - grupo ratoeira-area-<id>; o dono (quem roda o sync com o GitHub) entra nele
# - ACL: o grupo lê e escreve em tudo, inclusive no que for criado depois (ACL padrão, que vale
#   mesmo pros agentes, que rodam com umask 077); o grupo do gateway só lê (área Arquivos)
# - git: core.sharedRepository=group e safe.directory no /etc/gitconfig, pra todo mundo usar o
#   mesmo .git (branches e worktrees inclusive)
# - registra em /etc/ratoeira/areas.json, que o aplicar-acessos lê (o gateway não escreve aí)
# Quem entra na área e as pastas restritas: tela de Pessoas → aplicar-acessos.
set -euo pipefail
ID="${1:?uso: criar-area.sh <id> <caminho> [dono]}"; CAMINHO="${2:?uso: criar-area.sh <id> <caminho> [dono]}"; DONO="${3:-}"
GW="${RATOEIRA_GRUPO:-ratoeira-gw}"
[[ "$ID" =~ ^[a-z][a-z0-9-]{0,30}$ ]] || { echo "id inválido: $ID"; exit 1; }
[ "$(id -u)" = 0 ] || { echo "Rode com sudo."; exit 1; }
case "$CAMINHO" in /srv/ratoeira/areas/*) ;; *) echo "A área precisa ficar em /srv/ratoeira/areas/"; exit 1;; esac
[ -L "$CAMINHO" ] && { echo "$CAMINHO é um atalho; aponte pra pasta de verdade."; exit 1; }
command -v setfacl >/dev/null || DEBIAN_FRONTEND=noninteractive apt-get install -y -qq acl >/dev/null
G="ratoeira-area-$ID"
getent group "$G" >/dev/null || groupadd "$G"
getent group "$GW" >/dev/null || groupadd --system "$GW"
install -d -m 755 /srv/ratoeira /srv/ratoeira/areas
install -d -m 2770 -g "$G" "$CAMINHO"
[ -n "$DONO" ] && usermod -aG "$G" "$DONO"
echo "Aplicando permissões em $CAMINHO (pode levar alguns minutos numa pasta grande)…"
# "outros" sem nada: quem não é do grupo não precisa, e pasta restrita depende disso
# (sem o grupo da área, quem é da área cairia em "outros")
setfacl -R -m "g:$G:rwX,g:$GW:rX,m::rwx,o::---" "$CAMINHO"
find "$CAMINHO" -type d -exec setfacl -m "d:g:$G:rwX,d:g:$GW:rX,d:m::rwx,d:o::---" {} +
find "$CAMINHO" -type d -exec chmod g+s {} +
if [ -d "$CAMINHO/.git" ]; then
  git -C "$CAMINHO" -c safe.directory="$CAMINHO" config core.sharedRepository group
  # Nome de autor gravado no repo vale mais que o de cada pessoa: todo commit sairia no nome
  # de um só. Passa pro git do dono e tira do repo.
  for k in user.name user.email; do
    v="$(git -C "$CAMINHO" -c safe.directory="$CAMINHO" config --local --get "$k" || true)"
    [ -z "$v" ] && continue
    [ -n "$DONO" ] && [ -z "$(sudo -u "$DONO" git config --global --get "$k" || true)" ] && sudo -u "$DONO" git config --global "$k" "$v"
    git -C "$CAMINHO" -c safe.directory="$CAMINHO" config --local --unset "$k"
  done
  git config --system --get-all safe.directory | grep -qxF "$CAMINHO" || git config --system --add safe.directory "$CAMINHO"
fi
# registro das áreas (só root escreve): id, caminho, grupo
install -d -m 755 /etc/ratoeira
python3 - "$ID" "$CAMINHO" "$G" "$DONO" <<'PY'
import json, os, sys
p = "/etc/ratoeira/areas.json"
try: areas = json.load(open(p))
except FileNotFoundError: areas = []
nova = {"id": sys.argv[1], "caminho": sys.argv[2], "grupo": sys.argv[3]}
if sys.argv[4]: nova["dono"] = sys.argv[4]   # quem faz o sync: nunca perde acesso a pasta restrita
areas = [a for a in areas if a["id"] != sys.argv[1]] + [nova]
tmp = p + ".tmp"; json.dump(areas, open(tmp, "w"), indent=1); os.chmod(tmp, 0o644); os.replace(tmp, p)
PY
# rodar de novo abre tudo pro grupo, inclusive as pastas restritas: reaplica as restrições já
systemctl cat ratoeira-acessos.service >/dev/null 2>&1 && [ -f /var/lib/ratoeira-acessos/aplicado.json ] && systemctl start ratoeira-acessos.service || true
echo "Área $ID pronta: $CAMINHO (grupo $G)"
