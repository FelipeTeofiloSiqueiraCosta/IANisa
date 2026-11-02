#!/usr/bin/env bash
# =============================================================================
# instalar.sh: instala a Ratoeira numa VPS Ubuntu 24.04 limpa.
#
# Multiusuário desde o começo (cada pessoa com login, usuário Linux e servidor de agentes próprios), login da
# própria Ratoeira, HTTPS (Caddy + Let's Encrypt) no nome que a VPS já tem, firewall, e no fim um link de
# primeiro acesso pra criar a conta de quem administra. A parte de conversa (escolher o nome, abrir o link,
# conectar a conta do Claude) fica na kit/instalador/RECEITA.md, que o agente do aluno conduz.
#
# Roda como root, de dentro do clone do produto (o normal é /opt/ratoeira/fonte):
#   bash /opt/ratoeira/fonte/instalar.sh --usuario maria
#
# É idempotente: rodar de novo conserta o que faltou. Nunca apaga config, contas, áreas nem dados; o núcleo é
# montado pelo mesmo atualizador das versões novas (kit/instalador/atualizar).
# =============================================================================
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive LANG=C.UTF-8 LC_ALL=C.UTF-8

# versões que andam juntas (AGENTS.md da Ratoeira, "Versões que andam juntas")
NODE_MAIOR=22
# Claude Code e Codex: agentes/clis.json (o publicar-core troca por eles a cada atualização)

FONTE=/opt/ratoeira/fonte
ETC=/etc/ratoeira
CONFIG=$ETC/gateway.config.json
DADOS=/var/lib/ratoeira
PORTA=6768
AREA_ID=trabalho
AREA=/srv/ratoeira/areas/$AREA_ID
GW_USER=ratoeira-gateway
GW_GRUPO=ratoeira-gw

USUARIO=dono
ENDERECO=""
PUBLICADOS=""
CANAL=beta
CHAVE=""
TOKEN=""
REPORTES_CHAVE=""
REPORTAR=1
# Beta: o Reportar de cada instalação manda pra caixa de entrada da equipe da Ratoeira (o app Reportes da DobraLabs).
# A instalação gera a chave desta Ratoeira, e a origem se cadastra sozinha lá no primeiro reporte, com o endereço e o
# e-mail de quem administra (17/10/2026). --sem-reportar deixa os reportes só nesta VPS.
REPORTES_URL=https://ratoeira.dobralabs.com.br/reportes/receber/reporte
COM_DITADO=1
COM_NAVEGADOR=1
COM_DOCKER=1
COM_FIREWALL=1
FORCAR_SO=0

ajuda(){ sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//'; cat <<'EOF'
Opções:
  --usuario <nome>      usuário Linux de quem administra (minúsculas; padrão: dono)
  --endereco <nome>     endereço do portal (padrão: o nome da VPS, se ele aponta pro IP dela; senão <ip>.sslip.io)
  --publicados <nome>   endereço dos Publicados (padrão: apps.<ip>.sslip.io); "nenhum" desliga
  --canal beta|estavel  canal de atualização (padrão: beta)
  --chave <arquivo>     chave SSH só de leitura do repositório do produto (suporte; o normal é a conta da
                        plataforma, que o baixar.sh liga antes: /etc/ratoeira/plataforma.chave)
  --token <arquivo>     ou um arquivo com um token de leitura do GitHub (padrão: o do gh logado, se tiver)
  --reportes-chave <arquivo>  chave de origem do Reportar já criada (padrão: a instalação gera uma, que se cadastra sozinha)
  --sem-reportar        o botão Reportar guarda os reportes só nesta VPS, sem mandar pra equipe da Ratoeira
  --sem-ditado          não instala o ditado local (~700 MB de download; dá pra ligar depois)
  --sem-navegador       não instala o Google Chrome e o Playwright dos agentes
  --sem-docker          não instala o Docker (os programas dos Publicados precisam dele)
  --sem-firewall        não mexe no firewall (ufw)
EOF
}
while [ $# -gt 0 ]; do
  case "$1" in
    --usuario) USUARIO="${2:?}"; shift 2;;
    --endereco) ENDERECO="${2:?}"; shift 2;;
    --publicados) PUBLICADOS="${2:?}"; PUBLICADOS_DA_OPCAO=1; shift 2;;
    --canal) CANAL="${2:?}"; shift 2;;
    --chave) CHAVE="${2:?}"; shift 2;;
    --token) TOKEN="${2:?}"; shift 2;;
    --reportes-chave) REPORTES_CHAVE="${2:?}"; shift 2;;
    --sem-reportar) REPORTAR=0; shift;;
    --sem-ditado) COM_DITADO=0; shift;;
    --sem-navegador) COM_NAVEGADOR=0; shift;;
    --sem-docker) COM_DOCKER=0; shift;;
    --sem-firewall) COM_FIREWALL=0; shift;;
    --forcar-sistema) FORCAR_SO=1; shift;;
    -h|--ajuda|--help) ajuda; exit 0;;
    *) echo "Opção desconhecida: $1 (bash instalar.sh --ajuda)"; exit 2;;
  esac
done

N=0; TOTAL=14
passo(){ N=$((N+1)); printf '\n\033[1;33m==> %s/%s %s\033[0m\n' "$N" "$TOTAL" "$*"; }
info(){ printf '    %s\n' "$*"; }
aviso(){ printf '\033[0;33m    aviso: %s\033[0m\n' "$*"; }
falha(){ printf '\n\033[1;31mPAREI: %s\033[0m\n' "$*" >&2; exit 1; }
trap 'falha "o passo $N ($BASH_COMMAND) saiu com erro na linha $LINENO. Rodar de novo continua de onde parou."' ERR

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ORIGEM="$(cd "$AQUI/../.." && pwd)"
VERSAO="$(cat "$ORIGEM/VERSION" 2>/dev/null || echo '?')"

# ── 1. Conferir a máquina ────────────────────────────────────────────────────────────────────────────────────
passo "Conferindo a VPS (Ratoeira $VERSAO)"
[ "$(id -u)" = 0 ] || falha "rode como root (sudo bash instalar.sh …)."
[[ "$USUARIO" =~ ^[a-z][a-z0-9_-]{0,31}$ ]] || falha "--usuario inválido: minúsculas, números, - e _, começando com letra."
case "$USUARIO" in root|admin|sudo|adm|ratoeira*|"$GW_USER") falha "--usuario $USUARIO é reservado; escolha outro (ex.: o teu primeiro nome).";; esac
[[ "$CANAL" =~ ^(beta|estavel)$ ]] || falha "--canal tem que ser beta ou estavel."
. /etc/os-release
if [ "${ID:-}" != ubuntu ] || [ "${VERSION_ID:-}" != 24.04 ]; then
  [ "$FORCAR_SO" = 1 ] || falha "a Ratoeira foi testada só no Ubuntu 24.04 (esta é ${PRETTY_NAME:-?}). Reinstale a VPS com Ubuntu 24.04."
  aviso "sistema ${PRETTY_NAME:-?} sem teste (--forcar-sistema)"
fi
case "$(uname -m)" in
  x86_64) PLATAFORMA=linux-x64;;
  aarch64) PLATAFORMA=linux-arm64; aviso "processador ARM (aarch64): ainda em teste. O que falhar, manda pelo Reportar.";;
  *) falha "a Ratoeira precisa de um processador x86_64 ou ARM de 64 bits (esta VPS é $(uname -m)).";;
esac
[ -d /run/systemd/system ] || falha "esta máquina não roda o systemd (contêiner?). A Ratoeira precisa de uma VPS de verdade."
MEM_MB=$(( $(awk '/MemTotal/{print $2}' /proc/meminfo) / 1024 ))
[ "$MEM_MB" -ge 3500 ] || falha "a VPS tem ${MEM_MB} MB de memória; o mínimo é 4 GB (recomendado 8 GB)."
[ "$MEM_MB" -ge 7000 ] || aviso "${MEM_MB} MB de memória: dá pra uma ou duas pessoas. Pra um time, 8 GB."
LIVRE_GB=$(( $(df --output=avail -k / | tail -1) / 1024 / 1024 ))
[ "$LIVRE_GB" -ge 15 ] || falha "só ${LIVRE_GB} GB livres no disco; a Ratoeira precisa de 15 GB."
curl -fsS --max-time 15 -o /dev/null https://registry.npmjs.org/ || falha "a VPS não alcança a internet (registry.npmjs.org)."
for p in 80 443 "$PORTA"; do
  dono=$(ss -Htlnp "sport = :$p" 2>/dev/null | grep -o 'users:(("[^"]*' | head -1 | cut -d'"' -f2 || true)
  [ -z "$dono" ] || [ "$dono" = caddy ] || [ "$dono" = node ] || falha "a porta $p já está em uso por '$dono'. A Ratoeira precisa da 80, da 443 e da $PORTA livres (painel ou outro site nesta VPS?)."
done
IP=$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i=="src"){print $(i+1); exit}}')
[ -n "$IP" ] || falha "não achei o IP da VPS."
case "$IP" in 10.*|172.1[6-9].*|172.2[0-9].*|172.3[01].*|192.168.*) aviso "o IP da VPS ($IP) é de rede interna; o HTTPS só funciona se o nome abaixo apontar pro IP público.";; esac
IP_HIFEN=${IP//./-}
# Pergunta ao DNS público (DNS sobre HTTPS da Cloudflare): o /etc/hosts da Hostinger aponta o nome da VPS pra
# 127.0.1.1, então getent e ping dizem que ele resolve, mas pro lugar errado.
aponta_pra_mim(){ curl -fsS --max-time 8 -H 'accept: application/dns-json' "https://cloudflare-dns.com/dns-query?name=$1&type=A" 2>/dev/null \
  | python3 -c 'import json,sys; print("\n".join(a["data"] for a in json.load(sys.stdin).get("Answer",[]) if a.get("type")==1))' 2>/dev/null | grep -qxF "$IP"; }
# Reinstalação sem --endereco/--publicados: fica o que já está na config e no estado do gateway (a pessoa pode ter
# trocado por um domínio dela; recalcular pelo DNS mudaria o endereço por baixo dela).
json_campo(){ [ -f "$1" ] && [ ! -L "$1" ] && python3 -c 'import json,sys; v=json.load(open(sys.argv[1])).get(sys.argv[2]); print(v if isinstance(v,str) else "")' "$1" "$2" 2>/dev/null || true; }
JA_ENDERECO=0
if [ -z "$ENDERECO" ]; then
  ENDERECO=$(json_campo "$CONFIG" hostname)
  if [ -n "$ENDERECO" ] && [[ "$ENDERECO" =~ ^[A-Za-z0-9.-]+$ ]]; then
    JA_ENDERECO=1
    aponta_pra_mim "$ENDERECO" || aviso "$ENDERECO (da config que já existe) não aponta pro IP desta VPS ($IP) no DNS público; sigo com ele."
  else ENDERECO=""; fi
fi
if [ -z "$PUBLICADOS" ] && [ "$JA_ENDERECO" = 1 ]; then
  if [ -f "$DADOS/gateway-estado/playground.json" ] || [ -L "$DADOS/gateway-estado/playground.json" ]; then
    PUBLICADOS=$(json_campo "$DADOS/gateway-estado/playground.json" base)
    [[ "$PUBLICADOS" =~ ^[A-Za-z0-9.-]+$ ]] || PUBLICADOS=nenhum  # o arquivo existe sem base: Publicados desligados
  fi
fi
if [ "$JA_ENDERECO" = 1 ]; then :
elif [ -z "$ENDERECO" ]; then
  NOME=$(hostname -f 2>/dev/null || hostname)
  if [ -n "$NOME" ] && [[ "$NOME" == *.* ]] && aponta_pra_mim "$NOME"; then ENDERECO=$NOME
  else ENDERECO="$IP_HIFEN.sslip.io"; fi
elif ! aponta_pra_mim "$ENDERECO"; then
  falha "$ENDERECO não aponta pro IP desta VPS ($IP) no DNS público. Cria o registro A (e espera propagar) ou roda sem --endereco."
fi
# Publicados: apps.<endereço> quando o nome tem curinga (o da Hostinger tem, e o hstgr.cloud está na Public Suffix
# List, então o limite do Let's Encrypt é de cada VPS); senão apps.<ip>.sslip.io.
if [ -z "$PUBLICADOS" ]; then
  if aponta_pra_mim "apps.$ENDERECO"; then PUBLICADOS="apps.$ENDERECO"; else PUBLICADOS="apps.$IP_HIFEN.sslip.io"; fi
elif [ "$PUBLICADOS" != nenhum ] && [ "$JA_ENDERECO" = 1 ] && [ -z "${PUBLICADOS_DA_OPCAO:-}" ]; then
  aponta_pra_mim "$PUBLICADOS" || aviso "$PUBLICADOS (Publicados que já estavam) não aponta pro IP desta VPS ($IP); sigo com ele."
elif [ "$PUBLICADOS" != nenhum ] && ! aponta_pra_mim "$PUBLICADOS"; then
  falha "$PUBLICADOS (Publicados) não aponta pro IP desta VPS ($IP) no DNS público."
fi
[ "$PUBLICADOS" = nenhum ] && PUBLICADOS=""
info "IP $IP · portal https://$ENDERECO${PUBLICADOS:+ · Publicados https://$PUBLICADOS} · ${MEM_MB} MB · ${LIVRE_GB} GB livres"

# ── 2. Pacotes do sistema ────────────────────────────────────────────────────────────────────────────────────
passo "Pacotes do sistema (Node $NODE_MAIOR, Caddy, git, acl…)"
apt_instalar(){ apt-get install -y -q --no-install-recommends "$@" >/dev/null; }
apt-get update -q >/dev/null
apt_instalar ca-certificates curl gnupg git jq acl python3 python3-venv sqlite3 cron polkitd dnsutils ufw fail2ban restic \
  unattended-upgrades xvfb xauth debian-keyring debian-archive-keyring apt-transport-https
install -d -m 755 /etc/apt/keyrings
if ! node --version 2>/dev/null | grep -q "^v$NODE_MAIOR\."; then
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor --yes -o /etc/apt/keyrings/nodesource.gpg
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_$NODE_MAIOR.x nodistro main" > /etc/apt/sources.list.d/nodesource.list
  apt-get update -q >/dev/null && apt_instalar nodejs
fi
node --version | grep -q "^v$NODE_MAIOR\." || falha "o Node $NODE_MAIOR não ficou instalado."
if ! command -v caddy >/dev/null; then
  curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -q >/dev/null && apt_instalar caddy
fi
if [ "$COM_DOCKER" = 1 ] && ! command -v docker >/dev/null; then apt_instalar docker.io docker-compose-v2; fi
info "node $(node --version) · npm $(npm --version) · $(caddy version | cut -d' ' -f1)${COM_DOCKER:+ · $(docker --version 2>/dev/null | cut -d, -f1)}"

# ── 3. Memória extra, firewall e atualizações de segurança ──────────────────────────────────────────────────
passo "Swap, firewall e atualizações de segurança"
if ! swapon --show=NAME --noheadings | grep -q .; then
  fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  info "swap de 4 GB ligada"
fi
echo 'vm.swappiness=10' > /etc/sysctl.d/99-ratoeira.conf && sysctl -q -p /etc/sysctl.d/99-ratoeira.conf
if [ "$COM_FIREWALL" = 1 ]; then
  # a porta de verdade do SSH (pode não ser a 22, ou ser mais de uma): ligar o ufw sem ela tranca a pessoa fora
  PORTAS_SSH=$(sshd -T 2>/dev/null | awk '/^port /{print $2}' | grep -xE '[0-9]{1,5}' | sort -un | tr '\n' ' ' || true)
  [ -n "$PORTAS_SSH" ] || PORTAS_SSH=22
  for p in $PORTAS_SSH; do ufw allow "$p/tcp" >/dev/null; done
  ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null
  ufw --force enable >/dev/null
  info "firewall: só SSH ($(echo $PORTAS_SSH)), 80 e 443 abertas"
fi
systemctl enable --now fail2ban >/dev/null 2>&1 || aviso "o fail2ban não ligou"
# SSH sem repasse de tela (X11), que ninguém usa aqui. Senha e root ficam como estão: o agente do computador da
# pessoa entra como root por chave, e fechar a senha é passo opcional em Configurações › Segurança.
# 10- pra vir antes do 50-cloud-init dos provedores (no sshd vale o primeiro que define).
if [ -d /etc/ssh/sshd_config.d ] && [ ! -f /etc/ssh/sshd_config.d/10-ratoeira.conf ]; then
  echo 'X11Forwarding no' > /etc/ssh/sshd_config.d/10-ratoeira.conf
  if sshd -t 2>/dev/null; then systemctl reload ssh >/dev/null 2>&1 || systemctl reload sshd >/dev/null 2>&1 || true
  else rm -f /etc/ssh/sshd_config.d/10-ratoeira.conf; aviso "não mexi no SSH (a configuração dele não passou no teste)"; fi
fi
printf 'APT::Periodic::Update-Package-Lists "1";\nAPT::Periodic::Unattended-Upgrade "1";\n' > /etc/apt/apt.conf.d/20auto-upgrades

# ── 4. Usuários, grupos e pastas do sistema ──────────────────────────────────────────────────────────────────
passo "Usuários e pastas do sistema"
for g in "$GW_GRUPO" ratoeira-pessoas; do getent group "$g" >/dev/null || groupadd --system "$g"; done
id "$GW_USER" >/dev/null 2>&1 || useradd --system --user-group --home-dir "$DADOS/gateway-estado" --no-create-home --shell /usr/sbin/nologin "$GW_USER"
usermod -aG "$GW_GRUPO" "$GW_USER"
install -d -m 755 /opt/ratoeira /opt/ratoeira/bin /opt/ratoeira/apps /opt/ratoeira/versoes /usr/local/lib/ratoeira "$ETC" "$ETC/apps" "$DADOS" "$DADOS/core"
install -d -m 750 -o root -g "$GW_GRUPO" "$ETC/apps.d"
install -d -m 700 -o "$GW_USER" -g "$GW_USER" "$DADOS/gateway-estado" "$DADOS/reportes" "$DADOS/claude-home"
install -d -m 755 "$DADOS/pages"

# ── 5. Claude Code e Codex ───────────────────────────────────────────────────────────────────────────────────
CLAUDE_CODE=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["claude"])' "$ORIGEM/agentes/clis.json")
CODEX=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["codex"])' "$ORIGEM/agentes/clis.json")
[[ "$CLAUDE_CODE" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ && "$CODEX" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || falha "agentes/clis.json sem as versões do Claude Code e do Codex."
passo "Claude Code $CLAUDE_CODE e Codex $CODEX"
if ! /opt/ratoeira/bin/claude --version 2>/dev/null | grep -qF "$CLAUDE_CODE"; then
  # binário oficial na versão fixa, conferido pelo sha256 do manifesto. Não usa o install.sh: como root ele põe no
  # ~/.local do root e liga a atualização sozinha; aqui quem troca a versão é a atualização da Ratoeira.
  B=https://downloads.claude.ai/claude-code-releases/$CLAUDE_CODE
  SOMA=$(curl -fsSL "$B/manifest.json" | python3 -c 'import json,sys; print(json.load(sys.stdin)["platforms"][sys.argv[1]]["checksum"])' "$PLATAFORMA")
  [[ "$SOMA" =~ ^[0-9a-f]{64}$ ]] || falha "não consegui ler o manifesto do Claude Code $CLAUDE_CODE."
  curl -fsSL -o /opt/ratoeira/bin/claude.novo "$B/$PLATAFORMA/claude"
  echo "$SOMA  /opt/ratoeira/bin/claude.novo" | sha256sum -c --quiet - || { rm -f /opt/ratoeira/bin/claude.novo; falha "o binário do Claude Code baixado não confere com o manifesto."; }
  chmod 755 /opt/ratoeira/bin/claude.novo && chown root:root /opt/ratoeira/bin/claude.novo && mv -f /opt/ratoeira/bin/claude.novo /opt/ratoeira/bin/claude
fi
if ! /opt/ratoeira/bin/codex --version 2>/dev/null | grep -qF "$CODEX"; then
  npm install -g --prefix /opt/ratoeira --no-audit --no-fund --loglevel=error "@openai/codex@$CODEX" >/dev/null
fi
info "$(/opt/ratoeira/bin/claude --version 2>/dev/null | head -1) · $(/opt/ratoeira/bin/codex --version 2>/dev/null | head -1)"

# ── 6. Fonte do produto e de onde vêm as atualizações ────────────────────────────────────────────────────────
passo "Fonte da Ratoeira em $FONTE (canal $CANAL)"
REMOTO=$(git -C "$ORIGEM" remote get-url origin 2>/dev/null || true)
if [ "$ORIGEM" != "$FONTE" ]; then
  if [ ! -d "$FONTE/.git" ]; then git clone -q "$ORIGEM" "$FONTE"; fi
  [ -n "$REMOTO" ] && git -C "$FONTE" remote set-url origin "$REMOTO"
  git -C "$FONTE" -c advice.detachedHead=false checkout -q --detach "$(git -C "$ORIGEM" rev-parse HEAD)" 2>/dev/null \
    || falha "o clone em $FONTE não tem o commit de $ORIGEM; apague $FONTE e rode de novo."
fi
chown -R root:root "$FONTE"; chmod -R u+rwX,go+rX,go-w "$FONTE"
git config --system --get-all safe.directory 2>/dev/null | grep -qxF "$FONTE" || git config --system --add safe.directory "$FONTE"
if [ -n "$CHAVE" ]; then install -m 600 -o root -g root "$CHAVE" "$ETC/fonte.chave"; rm -f "$ETC/fonte.token"
elif [ -n "$TOKEN" ]; then install -m 600 -o root -g root "$TOKEN" "$ETC/fonte.token"; rm -f "$ETC/fonte.chave"
elif [ -s "$ETC/plataforma.chave" ]; then
  info "atualizações pela conta da plataforma (Comunidade ativa)"
elif [ ! -f "$ETC/fonte.chave" ] && [ ! -f "$ETC/fonte.token" ] && command -v gh >/dev/null && gh auth token >/dev/null 2>&1; then
  (umask 077; gh auth token > "$ETC/fonte.token"); info "atualizações com o login do GitHub desta VPS (gh)"
fi
python3 - "$ETC/fonte.json" "${REMOTO:-$(git -C "$FONTE" remote get-url origin 2>/dev/null || true)}" "$CANAL" <<'PY'
import json, os, sys
arq, remoto, canal = sys.argv[1:4]
try: cfg = json.load(open(arq))
except (OSError, ValueError): cfg = {}
if remoto: cfg["remoto"] = remoto
cfg["canal"] = canal
tmp = arq + ".tmp"; json.dump(cfg, open(tmp, "w"), indent=1); os.chmod(tmp, 0o644); os.replace(tmp, arq)
PY
info "versão $(cat "$FONTE/VERSION") · atualiza de ${REMOTO:-(sem remoto: só local)}"

# ── 7. Pessoa que administra e a área de trabalho ────────────────────────────────────────────────────────────
passo "Usuário $USUARIO e a pasta de trabalho ($AREA)"
SAIDA_PESSOA=$(RATOEIRA_GRUPO=$GW_GRUPO bash "$FONTE/kit/multiusuario/adicionar-pessoa.sh" "$USUARIO" 2>&1) \
  || falha "não consegui criar o usuário $USUARIO: $(printf '%s' "$SAIDA_PESSOA" | tail -5)"
# O repositório nasce antes da área: o criar-area.sh só liga o git compartilhado (grupo, safe.directory) se o .git
# já existe quando ele roda.
install -d -m 755 /srv/ratoeira /srv/ratoeira/areas; install -d "$AREA"
[ -d "$AREA/.git" ] || git init -q -b main "$AREA"
if ! git -c safe.directory="$AREA" -C "$AREA" rev-parse -q --verify HEAD >/dev/null 2>&1 && [ ! -f "$AREA/README.md" ]; then
  cat > "$AREA/README.md" <<'EOF2'
# Pasta de trabalho

Tudo que tu e o teu time guardam na Ratoeira mora aqui: documentos, projetos, aplicações (`apps/`), páginas pra
publicar (`playground/`) e o contexto do time (`_contexto/`). Cada mudança vira um commit no nome de quem fez.
EOF2
fi
RATOEIRA_GRUPO=$GW_GRUPO bash "$FONTE/kit/multiusuario/criar-area.sh" "$AREA_ID" "$AREA" "$USUARIO" >/dev/null
if ! git -C "$AREA" rev-parse -q --verify HEAD >/dev/null 2>&1; then
  runuser -u "$USUARIO" -- git -C "$AREA" add README.md
  runuser -u "$USUARIO" -- git -C "$AREA" -c user.name="Ratoeira" -c user.email="ratoeira@localhost" commit -q -m "Pasta de trabalho"
fi
info "área $AREA_ID pronta (git local; ligar no GitHub fica pra depois)"

# ── 8. Configuração (só na primeira vez: depois é da pessoa) ─────────────────────────────────────────────────
passo "Configuração em $ETC"
CONFIG_NOVA=0
if [ ! -f "$CONFIG" ]; then
  CONFIG_NOVA=1
  node "$FONTE/kit/instalador/config-inicial.mjs" --endereco "$ENDERECO" --porta "$PORTA" --area "$AREA_ID:$AREA" \
    $([ "$REPORTAR" = 1 ] && echo --reportes-url "$REPORTES_URL") > "$CONFIG.novo"
  chown root:"$GW_USER" "$CONFIG.novo"; chmod 640 "$CONFIG.novo"; mv -f "$CONFIG.novo" "$CONFIG"
  info "config nova (endereço $ENDERECO)"
else
  info "config já existe: fica como está"
fi
[ -f "$ETC/pacotes-permitidos" ] || install -m 644 "$FONTE/kit/instalador/pacotes-permitidos" "$ETC/pacotes-permitidos"
if [ "$REPORTAR" = 1 ]; then
  if [ -n "$REPORTES_CHAVE" ]; then install -m 640 -o root -g "$GW_USER" "$REPORTES_CHAVE" "$ETC/reportes.chave"
  elif [ ! -s "$ETC/reportes.chave" ]; then
    # a chave desta Ratoeira (mesmo formato do app Reportes); reinstalar mantém a que já existe
    (umask 027; python3 -c 'import secrets; print("rep_" + secrets.token_urlsafe(24))' > "$ETC/reportes.chave")
    chown root:"$GW_USER" "$ETC/reportes.chave"; chmod 640 "$ETC/reportes.chave"
  fi
  if [ "$CONFIG_NOVA" = 1 ] || python3 -c 'import json,sys; sys.exit(0 if (json.load(open(sys.argv[1])).get("portal",{}).get("reportes") or {}).get("enviar") else 1)' "$CONFIG" 2>/dev/null; then
    info "Reportar: vai pra equipe da Ratoeira (chave em $ETC/reportes.chave)"
  else
    aviso "a chave do Reportar ficou em $ETC/reportes.chave, mas o envio NÃO foi ligado: a config já existia sem \"enviar\" (portal.reportes.enviar). Os reportes seguem guardados só nesta VPS até alguém ligar o envio na config."
  fi
fi
# endereço dos Publicados: mora no estado do gateway (Configurações › Publicados muda depois); só na primeira vez
# (a pasta é do usuário do gateway: grava como ele, e não segue symlink)
PG="$DADOS/gateway-estado/playground.json"
if [ -n "$PUBLICADOS" ] && [ ! -e "$PG" ] && [ ! -L "$PG" ]; then
  printf '{"base":"%s"}\n' "$PUBLICADOS" | runuser -u "$GW_USER" -- sh -c 'umask 077; set -C; cat > "$1"' sh "$PG"
fi
# caminhos e grupo desta máquina pros ajudantes de root (os mesmos da nossa instância)
dropin(){ install -d "/etc/systemd/system/$1.d"; printf '[Service]\n%s\n' "$2" > "/etc/systemd/system/$1.d/local.conf"; }
dropin ratoeira-adicionar@.service "Environment=RATOEIRA_GRUPO=$GW_GRUPO"
dropin ratoeira-acessos.service "Environment=RATOEIRA_GRUPO=$GW_GRUPO
Environment=RATOEIRA_ACESSOS=$DADOS/gateway-estado/contas/acessos.json"
dropin ratoeira-automacoes.service "Environment=RATOEIRA_GRUPO=$GW_GRUPO
Environment=RATOEIRA_AUTOMACOES_PEDIDO=$DADOS/gateway-estado/automacoes-pedido.json"
dropin ratoeira-backup-tela.service "Environment=RATOEIRA_GRUPO=$GW_GRUPO
Environment=RATOEIRA_BACKUP_PEDIDO=$DADOS/gateway-estado/backup-pedido.json"
dropin ratoeira-agentes@.service "# mesmo Claude Code que o resto da máquina usa
Environment=DISABLE_AUTOUPDATER=1"

# ── 9. Núcleo: o mesmo caminho das atualizações ──────────────────────────────────────────────────────────────
passo "Núcleo da Ratoeira (scripts de root, texto dos agentes, servidor de agentes e portal)"
info "monta pelo atualizador: npm ci do portal e do servidor de agentes, uns minutos"
python3 "$FONTE/kit/instalador/atualizar" aplicar --local || falha "o núcleo não subiu (log acima). Rodar de novo tenta outra vez."
systemctl enable ratoeira-gateway.service ratoeira-automacoes.timer >/dev/null 2>&1
systemctl start ratoeira-automacoes.timer

# ── 10. Modo confiança: cada pessoa com sudo (e o agente dela) ──────────────────────────────────────────────
passo "Modo confiança (sudo pra quem tem ambiente)"
RATOEIRA_FONTE=$FONTE bash "$FONTE/kit/receitas/modo-confianca" ligar >/dev/null

# ── 11. Navegador, ditado e Publicados ───────────────────────────────────────────────────────────────────────
passo "Navegador dos agentes, ditado local e Publicados"
receita(){ local nome=$1; shift; info "receita $nome…"; RATOEIRA_FONTE=$FONTE bash "$FONTE/kit/receitas/$nome" "$@" > "$DADOS/core/receita-$nome.log" 2>&1 \
  || aviso "a receita $nome falhou (log em $DADOS/core/receita-$nome.log); o resto segue. Dá pra rodar de novo depois: sudo bash $FONTE/kit/receitas/$nome"; }
[ "$COM_NAVEGADOR" = 1 ] && receita playwright
[ "$COM_DITADO" = 1 ] && receita ditado-local
if [ "$COM_DOCKER" = 1 ] && [ -n "$PUBLICADOS" ]; then receita playground; fi

# ── 12. HTTPS ────────────────────────────────────────────────────────────────────────────────────────────────
passo "HTTPS em https://$ENDERECO (Caddy + Let's Encrypt)"
node "$FONTE/kit/instalador/caddyfile.mjs" --endereco "$ENDERECO" --porta "$PORTA" ${PUBLICADOS:+--publicados "$PUBLICADOS"} > /etc/caddy/Caddyfile.novo
caddy validate --config /etc/caddy/Caddyfile.novo --adapter caddyfile >/dev/null 2>&1 || falha "o Caddyfile gerado não passou na conferência do Caddy."
mv -f /etc/caddy/Caddyfile.novo /etc/caddy/Caddyfile
systemctl enable caddy >/dev/null 2>&1; systemctl reload-or-restart caddy
OK_HTTPS=0
for i in $(seq 1 60); do
  if curl -fsS --max-time 5 -o /dev/null "https://$ENDERECO/_ratoeira/health"; then OK_HTTPS=1; break; fi
  sleep 3
done
[ "$OK_HTTPS" = 1 ] || falha "o HTTPS não respondeu em https://$ENDERECO (certificado? o nome aponta pra $IP? journalctl -u caddy)."

# ── 13. Conferência ──────────────────────────────────────────────────────────────────────────────────────────
passo "Conferindo"
systemctl is-active --quiet ratoeira-gateway || falha "o ratoeira-gateway não está no ar (journalctl -u ratoeira-gateway)."
CODIGO=$(curl -s -o /dev/null -w '%{http_code}' "https://$ENDERECO/portal/")
case "$CODIGO" in 200|302|303|401) ;; *) falha "o portal respondeu $CODIGO sem login (esperava a tela de entrar).";; esac
# nada escutando pra fora além de SSH, HTTP e HTTPS (o resto fica em 127.0.0.1)
ABERTAS=$(ss -Htlnu | awk '{print $5}' | grep -vE '^(127\.|\[::1\]|\[::ffff:127\.)' | sed -E 's/.*:([0-9]+)$/\1/' | sort -un | grep -vxE "22|80|443|53${PORTAS_SSH:+|$(echo $PORTAS_SSH | tr ' ' '|')}" || true)
[ -z "$ABERTAS" ] || aviso "porta(s) escutando pra fora: $(echo $ABERTAS) (o firewall segura, mas confira)."
info "portal, login e HTTPS ok"

# ── 14. Primeiro acesso ──────────────────────────────────────────────────────────────────────────────────────
passo "Primeiro acesso"
conta(){ runuser -u "$GW_USER" -- env RATOEIRA_CONFIG="$CONFIG" node /opt/ratoeira/gateway/conta.mjs "$@"; }
TEM_ADMIN=0; conta tem-admin >/dev/null 2>&1 || TEM_ADMIN=$?
[ "$TEM_ADMIN" -le 1 ] || falha "não consegui conferir as contas (sudo -u $GW_USER env RATOEIRA_CONFIG=$CONFIG node /opt/ratoeira/gateway/conta.mjs tem-admin)."
if [ "$TEM_ADMIN" = 0 ]; then
  LINK="(já tem administrador: pra uma senha nova, sudo -u $GW_USER env RATOEIRA_CONFIG=$CONFIG node /opt/ratoeira/gateway/conta.mjs redefinir <email>)"
else
  LINK=$(conta primeiro-acesso --usuario "$USUARIO" | grep -o 'https\?://[^ ]*' | tail -1)
fi
cat <<EOF

  ┌──────────────────────────────────────────────────────────────────────────┐
     Ratoeira $(cat "$FONTE/VERSION") instalada.

     Endereço:  https://$ENDERECO
     Primeiro acesso (vale 1 hora, cria a conta de quem administra):
     $LINK

     Depois: abre o link; a Ratoeira mostra as boas-vindas (Claude, trabalho e o resto).
     Atualizar: Configurações › Atualizações (ou sudo ratoeira-atualizar).
  └──────────────────────────────────────────────────────────────────────────┘
EOF
