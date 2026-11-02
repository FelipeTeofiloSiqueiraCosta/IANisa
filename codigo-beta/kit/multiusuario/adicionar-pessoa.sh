#!/usr/bin/env bash
# Cria (ou acerta) uma pessoa na Ratoeira multiusuário. Roda como root, uma vez por pessoa.
#   sudo ./adicionar-pessoa.sh <usuário Linux> [pasta de trabalho]
#   sudo RATOEIRA_MEMORIA=2500M ./adicionar-pessoa.sh <usuário>   (limite só dela; ver a unit)
# - usuário Linux sem sudo, home 750 (ninguém lê a home de ninguém)
# - o grupo do gateway atravessa a home (x, sem listar) e lê a pasta de trabalho (área Arquivos)
# O servidor de agentes dela (ratoeira-agentes@<usuário>: chat, terminal, Contas de IA) o gateway liga
# quando ela abre o chat. Desde 09/10/2026 não tem mais Paseo por pessoa.
set -euo pipefail
U="${1:?uso: adicionar-pessoa.sh <usuário> [pasta]}"
GRUPO="${RATOEIRA_GRUPO:-ratoeira-gw}"
[[ "$U" =~ ^[a-z_][a-z0-9_-]{0,31}$ ]] || { echo "Usuário inválido: $U"; exit 1; }
[ "$(id -u)" = 0 ] || { echo "Rode com sudo."; exit 1; }
[ -z "${RATOEIRA_MEMORIA:-}" ] || [[ "$RATOEIRA_MEMORIA" =~ ^[0-9]+[MG]$ ]] || { echo "RATOEIRA_MEMORIA inválida (ex.: 2500M ou 3G)"; exit 1; }
command -v setfacl >/dev/null || DEBIAN_FRONTEND=noninteractive apt-get install -y -qq acl >/dev/null
getent group "$GRUPO" >/dev/null || groupadd --system "$GRUPO"
# marca de "pessoa da Ratoeira": o aplicar-acessos só mexe em quem está aqui
getent group ratoeira-pessoas >/dev/null || groupadd --system ratoeira-pessoas
# Nunca dar o ambiente de alguém pra um usuário que já manda na máquina: usuário de sistema
# (UID < 1000) ou com sudo. Pelo convite (RATOEIRA_SO_NOVO=1, na unit ratoeira-adicionar@),
# só usuário novo: um admin que digitasse "ana" daria o terminal da ana pra outra pessoa.
if id "$U" >/dev/null 2>&1; then
  [ "${RATOEIRA_SO_NOVO:-0}" = 1 ] && { echo "O usuário $U já existe nesta máquina. Escolha outro nome."; exit 1; }
  [ "$(id -u "$U")" -ge 1000 ] || { echo "$U é usuário de sistema. Recusado."; exit 1; }
  id -nG "$U" | tr ' ' '\n' | grep -qxE 'sudo|wheel|admin|root' && { echo "$U tem sudo. Recusado."; exit 1; }
else
  useradd --create-home --shell /bin/bash "$U"
fi
gpasswd -a "$U" ratoeira-pessoas >/dev/null
H="$(getent passwd "$U" | cut -d: -f6)"
PASTA="${2:-$H/trabalho}"
case "$PASTA" in "$H"/*) ;; *) echo "A pasta precisa ficar dentro de $H"; exit 1;; esac
chmod 750 "$H"
install -d -o "$U" -g "$U" -m 750 "$PASTA"
# Gateway: atravessa a home e o caminho até a pasta, lê a pasta. O "d:" vale pros arquivos novos,
# inclusive os que o agente cria com umask 077.
D="$PASTA"; while [ "$D" != "$H" ]; do D="$(dirname "$D")"; setfacl -m "g:$GRUPO:x" "$D"; done
setfacl -R -m "g:$GRUPO:rX" "$PASTA"
setfacl -R -d -m "g:$GRUPO:rX" "$PASTA"
# Memória só desta pessoa (servidor de agentes + agentes dela juntos). Sem a variável, vale o da unit.
if [ -n "${RATOEIRA_MEMORIA:-}" ]; then
  install -d "/etc/systemd/system/ratoeira-agentes@$U.service.d"
  printf '[Service]\nMemoryMax=%s\n' "$RATOEIRA_MEMORIA" > "/etc/systemd/system/ratoeira-agentes@$U.service.d/memoria.conf"
  systemctl daemon-reload
fi
# Texto da Ratoeira e skills do produto (atalhos em ~/.claude/skills, criados como ela)
[ -x /usr/local/lib/ratoeira/ratoeira-instrucoes ] && /usr/local/lib/ratoeira/ratoeira-instrucoes >/dev/null || true
echo "Pronto: $U, pasta $PASTA"
