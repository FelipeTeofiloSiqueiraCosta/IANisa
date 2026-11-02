---
name: playground-ratoeira
description: Cria, liga, desliga, expõe ou apaga um programa dos Publicados da Ratoeira (o que antes se chamava Playground), que é qualquer coisa que precisa de servidor rodando em Docker num endereço próprio (protótipo com banco, n8n, Metabase, API), fora do padrão de apps. Página HTML simples não é aqui: é a skill publicar-ratoeira. Use quando pedirem "sobe um experimento", "quero testar X num Docker", "roda um n8n/Metabase aqui", "faz um protótipo que abra num link", "expõe esse experimento pra fora", "põe um domínio nesse experimento", "desliga/liga/apaga o experimento X", ou quando vierem dos botões da seção Playground da tela de Apps. Pra sistema do time com login, papéis e chat da Ratoeira, use criar-app-ratoeira.
---

# Playground da Ratoeira

Esta skill vem com a Ratoeira e é atualizada com ela (não editar: a próxima versão troca).

**Página, programa ou app?** Página HTML (proposta, relatório) não precisa de Docker: skill `publicar-ratoeira`. Aqui é programa.

**App ou experimento?** App (criar-app-ratoeira) é sistema do time: abre em aba da Ratoeira, usa papéis e conversa pelo chat. Experimento é o resto: protótipo, demo, software de terceiro. Na dúvida, pergunta pra pessoa. Experimento que deu certo e virou ferramenta do time pode ser promovido a app depois.

## Como funciona

- Cada experimento é uma pasta `playground/<nome>/` na pasta de trabalho (nome: minúsculas, números e hífen), com `compose.yaml`, `ratoeira-play.json` e um `README.md` curto (o que é, quem pediu, como mexer).
- Os containers rodam no Docker da VPS, com a etiqueta `ratoeira.play: <nome>`, escutando só em `127.0.0.1`.
- Todos moram no endereço dos Publicados (Configurações › Publicados, ex.: `apps.exemplo.com`), cada um no seu caminho: `apps.exemplo.com/<nome>/`. **O caminho chega inteiro no container** (com o `/<nome>/`, e o cabeçalho `X-Forwarded-Prefix: /<nome>`): o experimento precisa funcionar debaixo dele (ver "Caminho" abaixo). Com um domínio só dele, abre na raiz desse domínio, e o caminho no endereço dos Publicados redireciona pra lá. Quem vê (`"acesso"`): `"time"` (padrão, login da Ratoeira), `"senha"` (com `"senha_sha256"`, ver `publicar-ratoeira`) ou `"publico"` (o antigo `"publico": true` ainda vale). No privado, o container recebe o cabeçalho `X-Ratoeira-Email` com quem está abrindo (dá pra usar, sem tela de login).
- A tela de Apps mostra cada experimento (ligado, memória, último acesso). **Ninguém abrindo por 7 dias, desliga sozinho** (não apaga). A etiqueta `ratoeira.manter: "sim"` deixa de fora (ex.: webhook que ninguém abre pelo navegador).
- Docker e sudo: nesta Ratoeira todo mundo tem `sudo` (modo confiança). Use `sudo docker …`. Se `sudo -n true` falhar, a Ratoeira está no modo restrito e o Playground precisa de quem administra.

## Criar

1. Combine com a pessoa: nome, o que roda e se é só pra ver por dentro (privado) ou pra mandar pra alguém de fora (público, decide depois).
2. **Porta:** uma livre entre 20000 e 29999 que nenhum outro `playground/*/ratoeira-play.json` use (`ss -tln` confirma).
3. **`playground/<nome>/ratoeira-play.json`:**
   ```json
   {"nome": "<nome>", "titulo": "Nome bonito", "descricao": "Pra que serve, em uma linha", "dono": "<e-mail de quem pediu>", "porta": 20123, "publico": false}
   ```
   `dominio` (opcional): um endereço só dele, ex.: `"demo.cliente.com"`.
4. **`playground/<nome>/compose.yaml`**, com as quatro regras em todo serviço que fica de pé:
   ```yaml
   services:
     web:
       build: .            # ou image: n8nio/n8n:1.x (versão fixa)
       ports: ["127.0.0.1:20123:3000"]   # SEMPRE com 127.0.0.1: sem o IP, o Docker abre a porta pra internet e fura o firewall
       labels: {ratoeira.play: "<nome>"}
       mem_limit: 512m     # até 1g sem perguntar; mais que isso, pergunta (a VPS é de todo mundo)
       restart: unless-stopped
   ```
   Banco ou serviço auxiliar: mesma etiqueta e `mem_limit`, **sem** `ports` (fala com o `web` pela rede do compose). Dado que precisa sobreviver vai em volume nomeado, nunca dentro da pasta do repo.
5. **Segredos:** nada de chave no `compose.yaml` nem no repo. `env_file: .env` com o `.env` no `.gitignore` da pasta, ou referência `op://` se o time usa 1Password.
6. **Caminho:** configura o experimento pra rodar debaixo de `/<nome>/` antes de subir. Quase todo framework tem a opção: Vite `base: '/<nome>/'`, Next `basePath: '/<nome>'`, n8n `N8N_PATH=/<nome>/`, Streamlit `--server.baseUrlPath <nome>`, FastAPI `root_path`, Flask atrás de proxy com `SCRIPT_NAME`, Metabase `MB_SITE_URL=https://<endereço>/<nome>`. Página estática: links relativos (`./app.js`, nunca `/app.js`). Software que não aceita caminho de jeito nenhum: dá um domínio só dele (seção "Domínio próprio").
7. **Subir:** `cd playground/<nome> && sudo docker compose -p play-<nome> up -d --build`. Confere com `curl -sI http://127.0.0.1:<porta>/`.
8. **Endereço:** o do Playground está em `sudo cat /var/lib/ratoeira/gateway-estado/playground.json` (`base`). O experimento já abre em `https://<base>/<nome>/` sem mexer em DNS. Confere abrindo (o privado passa pelo login da Ratoeira).
9. Commita a pasta (sem `.env`, `node_modules` nem dado) e manda o link pra pessoa. O primeiro acesso no privado passa pelo login da Ratoeira e volta sozinho.

## Expor pra fora (público)

Antes, confere com a pessoa e no código: painel de admin, banco, API sem senha, arquivo de configuração, chave em variável que a tela mostra. **Nada disso pode ficar aberto.** Se o software tem login próprio (n8n, Metabase), confirma que está ligado e com senha forte. Aí `"publico": true` no `ratoeira-play.json` e commita (vale em até 5 s, sem reiniciar nada). Voltar pra privado é o mesmo, com `false`.

## Domínio próprio

Quando a pessoa quer um endereço só do experimento (`demo.exemplo.com`), ou o software não aceita caminho:
1. `"dominio": "demo.exemplo.com"` no `ratoeira-play.json`.
2. Reconfigura o experimento pra rodar na raiz (tira o `base`/`basePath`/`N8N_PATH` do passo 6) e sobe de novo.
3. O domínio precisa apontar pra esta Ratoeira, e isso é da instalação: **se a pasta de trabalho tem `_contexto/playground.md`, segue o que está lá.** Sem ele, diz pra pessoa qual registro DNS criar (o domínio apontando pra esta VPS, como o endereço da Ratoeira).
4. Commita. O caminho antigo (`<base>/<nome>/`) passa a redirecionar pro domínio.

## Ligar, desligar, apagar

- Desligar: `sudo docker compose -p play-<nome> stop` (dentro da pasta). Ligar: `… start` (ou `up -d` se mudou o compose).
- **Apagar** tem volta só pelo git: mostra pra pessoa o que vai sumir (containers, volumes com dados, a pasta, o DNS) e espera o ok. Aí `sudo docker compose -p play-<nome> down -v --rmi local`, apaga a pasta, commita, e, se tinha domínio próprio, tira o registro DNS dele (o `_contexto/playground.md` diz como).
- Container que aparece na tela como "sem pasta" é experimento cuja pasta sumiu: `sudo docker ps -a --filter label=ratoeira.play=<nome>` mostra, e o mesmo `down`/`rm` limpa.
