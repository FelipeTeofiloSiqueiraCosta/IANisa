#!/bin/bash
# Baixa e instala a Ratoeira numa VPS Ubuntu 24.04 limpa, como root (é o instalar.sh do link do beta):
#   curl -fsSL <este endereço> -o /root/instalar-ratoeira.sh && bash /root/instalar-ratoeira.sh --usuario maria
#
# Não leva chave nenhuma (desde 29/10/2026): liga esta VPS à conta da pessoa na plataforma Ratos de IA (um código
# pra digitar em plataforma.ratosdeia.com.br/ratoeira/conectar), pede à plataforma um token do GitHub de 1 hora,
# que só sai com a Comunidade Ratos ativa, baixa o canal beta e roda o instalador com as opções que vierem
# (--usuario, --sem-ditado, --sem-docker, --endereco, --ajuda...). As versões novas seguem pelo mesmo caminho
# (kit/instalador/atualizar). Rodar de novo continua de onde parou.
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "PAREI: roda como root (sudo -i e de novo)."; exit 1; }
export PLATAFORMA="${RATOEIRA_PLATAFORMA:-https://plataforma.ratosdeia.com.br}"
REPO=https://github.com/dobralabs/ratoeira.git
FONTE=/opt/ratoeira/fonte

if [ -d "$FONTE/.git" ]; then
  echo "A Ratoeira já foi baixada aqui: sigo com ela (as versões novas vêm pelo botão Atualizar)."
  exec bash "$FONTE/instalar.sh" "$@"
fi

for p in git python3 curl; do
  command -v "$p" >/dev/null || { apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq git python3 curl; break; }
done
install -d -m 755 /etc/ratoeira

# A conta e o token: a parte que conversa vai pro terminal (stderr); só o token sai no stdout.
TOKEN=$(python3 - <<'PY'
import json, os, re, sys, time, urllib.error, urllib.request, uuid
P = os.environ["PLATAFORMA"].rstrip("/")
CHAVE, ID = "/etc/ratoeira/plataforma.chave", "/etc/ratoeira/instalacao.id"
diz = lambda t: print(t, file=sys.stderr, flush=True)

def pare(t):
    diz("PAREI: " + t)
    sys.exit(3)

def post(caminho, corpo, chave=None):
    req = urllib.request.Request(P + caminho, data=json.dumps(corpo).encode(), method="POST",
                                 headers={"Content-Type": "application/json", "User-Agent": "ratoeira-instalar",
                                          **({"Authorization": "Bearer " + chave} if chave else {})})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read() or b"{}")
        except ValueError:
            return e.code, {}
    except (urllib.error.URLError, OSError) as e:
        return 0, {"erro": str(getattr(e, "reason", e))}

def ler(c):
    try:
        return open(c).read().strip() or None
    except OSError:
        return None

inst = ler(ID)
if not (inst and re.fullmatch(r"[a-f0-9-]{16,64}", inst)):
    inst = str(uuid.uuid4())
    open(ID, "w").write(inst + "\n")
    os.chmod(ID, 0o644)
endereco = os.uname().nodename

chave = ler(CHAVE)
if not chave:
    s, d = post("/api/ratoeira/dispositivo", {"instalacao": inst, "endereco": endereco})
    if s != 200 or not d.get("segredo"):
        pare("não consegui falar com a plataforma (" + str(d.get("erro") or "HTTP %s" % s) + "). Tenta de novo daqui a pouco.")
    diz("")
    diz("  Pra baixar a Ratoeira, liga esta VPS à tua conta da plataforma Ratos de IA.")
    diz("  Abre, logada na tua conta:  " + d["url_curta"])
    diz("  e digita o código:          " + d["codigo"])
    diz("  (link direto: " + d["url"] + " · vale 15 minutos)")
    diz("")
    fim = time.time() + 15 * 60 + 30
    while time.time() < fim:
        time.sleep(max(2, int(d.get("intervalo") or 5)))
        s2, r = post("/api/ratoeira/dispositivo/chave", {"segredo": d["segredo"]})
        if s2 == 0 or r.get("estado") == "esperando":
            continue
        if r.get("estado") == "conectada" and str(r.get("chave", "")).startswith("rat_"):
            fd = os.open(CHAVE + ".tmp", os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
            with os.fdopen(fd, "w") as f:
                f.write(r["chave"] + "\n")
            os.replace(CHAVE + ".tmp", CHAVE)
            chave = r["chave"]
            diz("Conectada à conta " + str(r.get("email") or "") + ".")
            break
        break
    if not chave:
        pare("o código venceu sem ninguém digitar. Roda o mesmo comando de novo pra pegar outro.")

s, d = post("/api/ratoeira/atualizacao", {"endereco": endereco}, chave=chave)
if d.get("ok") and d.get("token"):
    print(d["token"])
    sys.exit(0)
if s == 401:
    os.remove(CHAVE)
pare(d.get("mensagem") or "a plataforma não liberou o download (HTTP %s)." % s)
PY
)

echo "Baixando a Ratoeira (canal beta)…"
mkdir -p /opt/ratoeira
# o token vai pelo ambiente, não na linha de comando nem na URL (no ps os outros veriam; na URL ficaria no .git/config)
GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=http.https://github.com/.extraheader \
GIT_CONFIG_VALUE_0="Authorization: Basic $(printf 'x-access-token:%s' "$TOKEN" | base64 -w0)" \
  git clone -q --branch beta "$REPO" "$FONTE" || { echo "PAREI: não consegui baixar a Ratoeira do GitHub. Roda de novo."; exit 1; }
unset TOKEN
exec bash "$FONTE/instalar.sh" "$@"
