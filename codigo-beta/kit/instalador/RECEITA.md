# Receita: instalar a Ratoeira numa VPS

Pro agente (Claude Code ou Codex) que roda no computador da pessoa e vai conduzir a instalação com ela. A parte
mecânica é o `instalar.sh`, que é sempre igual; a tua parte é a conversa: conferir o que ela tem, pedir o que
falta, rodar os comandos pela SSH e explicar o que está acontecendo em linguagem simples.

**Regras pra ti:**
- Nunca escreve senha, token ou chave no chat nem em arquivo do repositório dela. Quando ela precisar digitar
  uma senha, ela digita no terminal dela.
- Nunca desliga o firewall, nunca abre porta além de 22, 80 e 443, nunca muda o SSH da VPS sem ela pedir.
- Se um passo der erro, lê a mensagem (as linhas `PAREI:` dizem o que fazer), tenta o conserto óbvio e roda
  de novo: o instalador continua de onde parou. Se não for óbvio, para e mostra pra ela o fim da saída.
- Um passo de cada vez. Diz o que vai fazer antes de fazer.

## 1. Conferir o que ela tem

- **VPS com Ubuntu 24.04** e acesso de root. Recomendada: KVM 2 da Hostinger (2 vCPU, 8 GB, 100 GB). Se ela
  ainda não tem, ajuda a comprar e a escolher o sistema "Ubuntu 24.04" (sem painel, sem aplicativo).
  VPS com outro sistema: reinstala com Ubuntu 24.04 pelo painel do provedor (apaga tudo, confirma com ela).
- **Só no beta: a chave de leitura da Ratoeira**, um arquivo que a equipe da Ratoeira manda pra ela (só baixa a
  Ratoeira, não abre mais nada). Pergunta onde ela salvou no computador. Sem a chave, ela pede pra equipe e espera.
  Não precisa de conta no GitHub. (Quando a Ratoeira for pública, esse item e o passo 3 saem.)
- **Conta do Claude** (Pro ou Max). Do ChatGPT pro Codex é opcional.
- **Domínio próprio (opcional).** Pergunta se ela já tem um domínio e quer abrir a Ratoeira nele (ex.:
  `ratoeira.empresa.com.br`). Se quiser, ajuda a criar no DNS um registro A desse nome pro IP da VPS (na
  Cloudflare, com a nuvem cinza, só DNS) e usa `--endereco` no passo 4. Se não, segue com o endereço que a VPS já
  tem: dá pra trocar depois, pela própria Ratoeira (Configurações › Endereços).

## 2. Entrar na VPS por SSH

Se ela ainda não tem chave SSH no computador, cria uma (`ssh-keygen -t ed25519`) e põe na VPS: pelo painel da
Hostinger (VPS › Configurações › Chaves SSH) ou com `ssh-copy-id root@<IP>` (ela digita a senha de root). Depois
cria um apelido no `~/.ssh/config` dela:

```
Host ratoeira
  HostName <IP da VPS>
  User root
  IdentityFile ~/.ssh/<a chave>
```

Confere com `ssh ratoeira 'lsb_release -ds; free -h | head -2'`.

## 3. Baixar a Ratoeira (só no beta: o repositório é privado)

Manda a chave pra VPS (troca o caminho pelo que ela disse no passo 1) e baixa com ela:

```sh
scp <caminho da chave> ratoeira:/root/ratoeira-leitura
ssh ratoeira 'chmod 600 /root/ratoeira-leitura && apt-get update -qq && apt-get install -y -qq git'
ssh ratoeira 'GIT_SSH_COMMAND="ssh -i /root/ratoeira-leitura -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new" git clone --branch beta git@github.com:dobralabs/ratoeira.git /opt/ratoeira/fonte'
```

No passo 4, a instalação leva `--chave /root/ratoeira-leitura`: é com ela que a Ratoeira busca as atualizações
depois. A chave não vai no chat nem em arquivo de repositório.

## 4. Instalar

Pergunta a ela:
- **o nome do usuário dela no Linux** (minúsculas, sem espaço, ex.: `maria`): aparece no terminal da Ratoeira;
- **ditado** (microfone no chat sem chave nenhuma): baixa uns 700 MB; recomenda deixar;
- **Docker** (pros programas dos Publicados, como um n8n): recomenda deixar.

E roda (leva uns 15 minutos; deixa a saída aparecer pra ela acompanhar):

```sh
ssh ratoeira 'bash /opt/ratoeira/fonte/instalar.sh --usuario maria --chave /root/ratoeira-leitura'
```

Opções que podem servir: `--sem-ditado`, `--sem-docker`, `--endereco <domínio próprio>` (se ela escolheu um
no passo 1; o DNS já tem que apontar pro IP da VPS, senão o instalador para e avisa), `--ajuda`.

## 5. Primeiro acesso

No fim, o instalador mostra o endereço (`https://srvNNNNNNN.hstgr.cloud` na Hostinger) e um **link de primeiro
acesso**, que vale 1 hora. Ela abre o link, põe e-mail, nome e uma senha: essa é a conta de quem administra.
Se o link vencer:

```sh
ssh ratoeira 'runuser -u ratoeira-gateway -- env RATOEIRA_CONFIG=/etc/ratoeira/gateway.config.json node /opt/ratoeira/gateway/conta.mjs primeiro-acesso --usuario maria'
```

## 6. Daqui pra frente, quem mostra é a Ratoeira

Ao entrar pela primeira vez, a Ratoeira abre as **boas-vindas**: conectar o Claude, trazer o trabalho, o que os
agentes já alcançam e uma volta pela tela. Não precisa explicar as telas por aqui; diz só que é por lá que segue.

Fica por perto, porque um caminho das boas-vindas volta pra ti: em "Onde mora o teu trabalho?", se ela escolher
**"No meu computador"**, a Ratoeira dá um texto pra ela colar aqui, contigo. Ou é pra mandar a pasta dela pra
VPS (rsync pelo apelido `ratoeira`, sem `.env` nem `node_modules`, acertando o dono no fim), ou pra subir a pasta
pra um repositório privado do GitHub antes. O texto diz o caminho exato; segue ele, um passo de cada vez.

## 7. Trazer o que o teu Claude já usa (opcional)

Quando ela terminar as boas-vindas, oferece: "Quer levar pra Ratoeira o que eu já uso aqui no teu computador?
Skills, integrações (MCPs), tuas instruções gerais e as chaves de API que elas usam." Só segue com o sim dela.

**1. Faz a lista, sem copiar nada ainda.** No computador dela:
- **Skills pessoais:** `~/.claude/skills/` (e `~/.codex/skills/` ou `~/.agents/skills/`, se ela usa o Codex).
  Pula as que terminam em `-ratoeira`: já vêm com a Ratoeira.
- **Integrações (MCPs) do escopo de usuário:** `claude mcp list` e o `mcpServers` do `~/.claude.json` (no Codex,
  o `[mcp_servers]` do `~/.codex/config.toml`). As do escopo de projeto (`.mcp.json`) vão junto com a pasta.
- **Instruções gerais:** `~/.claude/CLAUDE.md` (no Codex, `~/.codex/AGENTS.md`).
- **Chaves de API soltas** que as skills ou integrações usam e que não estão dentro delas (variável no
  `~/.zshrc`, um `.env` à parte). Mostra só o **nome** de cada chave, nunca o valor.

Mostra a lista agrupada, com uma linha do que cada item faz, já marcando o que não dá pra levar (abaixo). Ela
escolhe item por item.

**2. O que não leva, e o que fazer no lugar:**
- **Login do Claude e do ChatGPT:** ela conecta na própria Ratoeira (Configurações › Contas de IA).
- **Conectores do claude.ai** (Gmail, Drive, Canva…): vêm sozinhos com a conta do Claude.
- **Integração com login próprio (OAuth):** o login fica guardado no computador (no Mac, no Chaveiro) e não vale
  em outra máquina. Leva a configuração e ela entra de novo na Ratoeira (no terminal da Ratoeira: `claude`, `/mcp`).
- **O que depende do computador:** caminho dele (`/Users/...`, `C:\...`), app aberto nele (navegador logado, app
  de desktop). Não funciona na VPS: diz o que é e segue sem.
- **Hooks e o `settings.json`:** ficam. A Ratoeira tem os dela.

**3. Copia o escolhido** pela SSH, pra home do usuário dela na VPS (nunca pro root). Valor de chave passa só por
arquivo e SSH, nunca pelo chat.

- **Skills:**
  ```sh
  ssh ratoeira 'mkdir -p /home/maria/.claude/skills'
  rsync -r --no-perms --exclude node_modules --exclude .git ~/.claude/skills/<skill> ratoeira:/home/maria/.claude/skills/
  ```
- **Instruções gerais:** antes, mostra pra ela o que no texto fala do computador (caminhos, apps) e tira com o ok
  dela. Depois: `scp ~/.claude/CLAUDE.md ratoeira:/home/maria/.claude/CLAUDE.md`.
- **Integrações (MCP)**, uma por vez, com a configuração inteira (comando, argumentos e chaves vão juntos; sem
  `jq` no computador, tira o trecho com `python3`):
  ```sh
  jq '.mcpServers["<nome>"]' ~/.claude.json > /tmp/mcp.json && scp /tmp/mcp.json ratoeira:/home/maria/.mcp-novo.json && rm /tmp/mcp.json
  ssh ratoeira 'chown maria: /home/maria/.mcp-novo.json && chmod 600 /home/maria/.mcp-novo.json && runuser -l maria -c "/opt/ratoeira/bin/claude mcp add-json --scope user <nome> \"\$(cat ~/.mcp-novo.json)\"" ; rm -f /home/maria/.mcp-novo.json'
  ```
  Integração que roda por `npx` ou `uvx` funciona se o pacote rodar no Linux; a que aponta pra um programa do
  computador não.
- **Chaves soltas:** num arquivo `NOME=valor` (uma por linha) feito no computador dela, mandado pra
  `/home/maria/.config/ratoeira/chaves.env` (`ssh ratoeira 'mkdir -p /home/maria/.config/ratoeira'` antes; se o
  arquivo já existe, junta sem apagar o que tem). Apaga a cópia local no fim.
- **No fim, o dono:**
  ```sh
  ssh ratoeira 'chown -R maria: /home/maria/.claude /home/maria/.config/ratoeira 2>/dev/null; chmod 600 /home/maria/.config/ratoeira/chaves.env /home/maria/.claude/skills/*/.env 2>/dev/null; true'
  ```

**4. Confere com ela:** conversa nova na Ratoeira (as abertas não veem o que chegou), olha Habilidades e
Integrações, e pede pro agente de lá usar uma skill e uma integração que vieram.
