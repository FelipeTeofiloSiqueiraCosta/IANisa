---
name: publicar-ratoeira
description: Publica algo da Ratoeira pra abrir fora dela, num link (seção Publicados): uma página HTML, proposta, relatório, slides, um protótipo ou um programa (n8n, Metabase). Escolhe sozinha o jeito (página, programa em Docker ou app da Ratoeira) e só pergunta quem vê (só o time, com senha ou qualquer um). Use quando pedirem "publica isso", "quero um link pro cliente", "manda essa página pra fora", "publica essa proposta", "deixa público", "põe senha nessa página", "tira do ar", "muda quem vê", ou quando vierem do botão Publicar da Mesa ou da seção Publicados da tela de Apps.
---

# Publicar na Ratoeira

Esta skill vem com a Ratoeira e é atualizada com ela (não editar: a próxima versão troca).

Tudo que é publicado mora no endereço dos Publicados (Configurações › Publicados; ele está em `sudo cat /var/lib/ratoeira/gateway-estado/playground.json`, campo `base`), cada item no seu caminho: `https://<base>/<nome>/`. Cada item é uma pasta `playground/<nome>/` na pasta de trabalho com um `ratoeira-play.json`. A tela de Apps mostra todos na seção Publicados.

## 1. Escolha o jeito (a pessoa não precisa saber disso; diga em uma linha o que vai fazer)

| É… | Vira |
|---|---|
| HTML, página, proposta, relatório, slides, arquivos pra baixar | **página** (abaixo): sem servidor, sem Docker, não gasta nada |
| precisa de servidor rodando: banco, formulário que grava, login próprio, software de terceiro, API | **programa**: siga a skill `playground-ratoeira` |
| ferramenta do time que usa os dados com o chat, com papéis | **app**: siga a skill `criar-app-ratoeira` |

## 2. Pergunte só quem vê

- **Só o time** (`"acesso": "time"`, o padrão): quem tem login na Ratoeira.
- **Com senha** (`"acesso": "senha"`): pro cliente, que não tem login. O time entra sem a senha.
- **Qualquer um com o link** (`"acesso": "publico"`).

Tudo sai com `noindex` (não aparece no Google), a não ser com `"indexar": true`.

## Página

**Pra um arquivo só (HTML, PDF, imagem, markdown), o caminho mais curto é o diálogo Publicar** (o globo na barra do arquivo aberto na Mesa, no menu da árvore ou do lado de um caminho no chat): a pessoa escolhe o link, quem vê, o que vai junto e se atualiza sozinho, e publica sem agente. Se ela pediu pra ti, faz pelos passos abaixo, com os mesmos campos que o diálogo grava (`origem`, `entrada`, `junto`, `modo`), pra que o diálogo e o aviso de "mudou desde a publicação" funcionem depois:
- `origem`: o arquivo original, relativo à raiz do repositório; `entrada`: o nome do arquivo servido no `/`; `junto`: nomes (do lado da origem) que foram junto; `modo`: `"foto"` (cópia, atualiza quando mandar) ou `"aovivo"` (sem cópia: `"pasta"` aponta pra pasta da origem e só `entrada` + `junto` saem dela); `publicado_em` (ISO) e `publicado_por` (e-mail).

1. **Nome:** minúsculas, números e hífen, curto e sem dado sensível (vira o link): ex. `acme-vitrines`. Confira que `playground/<nome>/` não existe.
2. **Arquivos:** copie pra `playground/<nome>/` só o que vai pra fora: o HTML principal como `index.html` e o que ele usa (imagens, CSS, subpastas). **Nunca** script, planilha, referência interna, `.env` ou anotação. **Tudo que fica na pasta de uma página vai pro ar** (menos oculto e o manifesto): nada de README ou nota ali dentro. Links do HTML precisam ser relativos (`img/a.png`, nunca `/img/a.png`).
   - Pasta que já tem só o que vai pra fora e muda sempre (ex.: um relatório que o agente regenera): em vez de copiar, aponte com `"pasta": "<caminho/relativo/à/raiz>"` no manifesto, e a página mostra sempre o que está lá. Arquivo oculto e o manifesto nunca são servidos, e atalho que sai do repositório também não.
3. **`playground/<nome>/ratoeira-play.json`:**
   ```json
   {"nome": "<nome>", "tipo": "pagina", "titulo": "Nome bonito", "descricao": "Pra quê, em uma linha", "dono": "<e-mail de quem pediu>", "acesso": "time"}
   ```
   Com senha: `"acesso": "senha"` e `"senha_sha256"` com o sha256 da senha (`printf %s 'a-senha' | sha256sum`). A senha mesmo **não** vai pro arquivo: combine com a pessoa (ou gere uma, 10+ caracteres, fácil de ditar) e diga pra ela no fim.
4. Commita a pasta. Vale em até 5 s, sem reiniciar nada.
5. **Confira** abrindo `https://<base>/<nome>/` (com `curl -sI`, só o time devolve 302 pro login; senha devolve 401 com o formulário; público, 200) e mande o link pra pessoa, com a senha se tiver.

**Atualizar:** mudou o HTML original, copie de novo (ou, com `"pasta"`, já está no ar). **Trocar quem vê:** muda o `acesso` (e a `senha_sha256`) e commita; trocar a senha desloga quem já tinha entrado. **Tirar do ar:** mostra o que vai sumir e apaga a pasta `playground/<nome>/` (com `"pasta"`, só o manifesto e o que for dela; os arquivos originais ficam). **Domínio próprio:** como na `playground-ratoeira`, seção "Domínio próprio" (pra página não precisa reconfigurar nada).
