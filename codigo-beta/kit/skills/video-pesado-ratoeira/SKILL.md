---
name: video-pesado-ratoeira
description: Edita, corta, junta, converte, comprime ou renderiza vídeo (e áudio longo) na Ratoeira sem travar a VPS, decidindo entre não recodificar, rodar aqui com freio ou mandar o render pra fora (Rendi, ffmpeg por API). Use antes de qualquer ffmpeg em vídeo, quando pedirem "corta esse vídeo", "junta esses vídeos", "comprime", "converte pra mp4", "tira o áudio", "queima a legenda", "renderiza", "edita esse vídeo", "faz os cortes", "redimensiona pra vertical", quando um ffmpeg estiver lento ou travando a máquina, ou quando pedirem pra ligar o Rendi.
---

# Vídeo pesado na Ratoeira

Esta skill vem com a Ratoeira e é atualizada com ela (não editar: a próxima versão troca).

**Por que precisa dela:** a VPS é uma só pra todo mundo. Recodificar vídeo é o trabalho mais pesado que um agente faz aqui: um ffmpeg solto pega todos os núcleos por minutos, o chat de todo mundo trava e o provedor da VPS pode penalizar a máquina por uso alto sustentado. A Ratoeira põe um teto de CPU nos agentes (60% da máquina pra todo mundo junto), então um render grande aqui também fica lento. A ordem é: **não recodificar → recodificar aqui com freio → mandar pra fora.**

## Regras

- **Mede antes de rodar:** `bash $S/estimar arquivo.mp4` (duração, resolução, codecs, tamanho).
- **Nunca** ffmpeg recodificando sem o `ffmpeg-leve` (ou `nice -n 19 ionice -c 3` e `-threads` de no máximo metade dos núcleos). Um render por vez, nunca vários em paralelo.
- **Nunca** fugir do teto (`sudo systemd-run`, `sudo nice -n -…`, rodar como outro usuário). O teto existe pra máquina não cair.
- Render que passa de 1 minuto: roda em segundo plano (Bash com `run_in_background`) e segue a conversa; não prende o turno esperando.
- **Não apaga o original** e não sobrescreve a entrada: a saída vai com outro nome.
- **Disco:** confere `df -h .` antes; a saída pode ser do tamanho da entrada. Arquivo de vídeo não vai pro git: o que passa de 50 MB a Ratoeira já tira das versões sozinha, mas vídeo menor também não deveria entrar; deixa numa pasta que o `.gitignore` cobre (`git check-ignore -v pasta/arquivo.mp4`) e, se não tiver, pergunta à pessoa onde pôr.
- Mandar pra fora sobe o vídeo pra um serviço de terceiro: **pergunta antes** se o vídeo for de cliente, interno ou tiver gente que não autorizou.

Os scripts ficam na pasta desta skill (o Claude mostra o caminho ao carregar; na Ratoeira é `/usr/local/lib/ratoeira/skills/video-pesado-ratoeira`):

```sh
S=/usr/local/lib/ratoeira/skills/video-pesado-ratoeira/scripts   # ou a pasta que o Claude mostrou
```

## 1. Dá pra não recodificar? (segundos, quase sem CPU)

Muita edição só copia os dados (`-c copy`). Tenta isso primeiro:

| Pedido | Comando |
|---|---|
| Cortar um trecho | `ffmpeg -ss 00:01:10 -to 00:03:45 -i in.mp4 -c copy -avoid_negative_ts make_zero corte.mp4` |
| Juntar vídeos do mesmo formato | `lista.txt` com `file 'a.mp4'` por linha, e `ffmpeg -f concat -safe 0 -i lista.txt -c copy junto.mp4` |
| Trocar o contêiner (mov/mkv → mp4) | `ffmpeg -i in.mov -c copy -movflags +faststart out.mp4` |
| Tirar o áudio | `ffmpeg -i in.mp4 -vn -c:a copy audio.m4a` (o codec do áudio dita a extensão: `estimar` mostra) |
| Tirar o som do vídeo | `ffmpeg -i in.mp4 -an -c:v copy mudo.mp4` |
| Trocar a trilha de áudio | `ffmpeg -i video.mp4 -i audio.m4a -map 0:v -map 1:a -c copy -shortest out.mp4` |
| Legenda que liga e desliga (sem queimar) | `ffmpeg -i in.mp4 -i leg.srt -c copy -c:s mov_text out.mp4` |

O corte com `-c copy` cai no quadro-chave mais próximo (pode sobrar até uns 2 s). Se a pessoa precisa do corte no quadro exato, recodifica só aquele trecho, não o vídeo inteiro.

Juntar vídeos de câmeras ou formatos diferentes não dá com `-c copy`: aí é recodificar.

## 2. Recodificar aqui, com freio

Precisa recodificar quando muda a imagem ou o formato: redimensionar, vertical 9:16, queimar legenda, sobrepor logo, filtro, comprimir, mudar codec, juntar formatos diferentes.

1. **Estima** com as mesmas opções que vai usar (roda 20 s de amostra com freio e extrapola):
   ```sh
   bash $S/estimar bruto.mp4 -vf scale=-2:1080 -c:v libx264 -preset veryfast -crf 23 -c:a aac -b:a 128k
   ```
2. **Decide pela estimativa:**
   - Até uns **15 min**: roda aqui, em segundo plano, com o `ffmpeg-leve`.
   - Mais que isso, 4K, ou vários vídeos em lote: oferece o **Rendi** (seção 3) se estiver ligado; se não estiver, diz o tempo estimado e pergunta se roda aqui mesmo (fica lento, mas não trava) ou se a pessoa quer ligar o Rendi.
3. **Roda:** igual ao ffmpeg, com a saída por último:
   ```sh
   bash $S/ffmpeg-leve -i bruto.mp4 -vf scale=-2:1080 -c:v libx264 -preset veryfast -crf 23 \
     -c:a aac -b:a 128k -movflags +faststart -progress pasta/render.log saida.mp4
   ```
   O `-progress` deixa o andamento num arquivo (`out_time=`) pra tu conferir e contar pra pessoa.

**Pra ficar leve:**
- `-preset veryfast` (ou `faster`) e `-crf 23` dão um bom equilíbrio; `slow`, `veryslow` e `libx265` pesam muito mais, então só no Rendi.
- Testa o visual antes num pedaço (`-t 15` ou `-ss … -t 15`) e só depois renderiza o vídeo inteiro, uma vez só.
- Vários cortes do mesmo vídeo: corta com `-c copy` primeiro e recodifica só os pedaços, não o vídeo inteiro várias vezes.
- Não tem placa de vídeo na VPS: `-hwaccel`, `nvenc` e `qsv` não funcionam.

## 3. Mandar pra fora: Rendi (opcional)

O [Rendi](https://rendi.dev) roda o mesmo comando ffmpeg na nuvem dele, com mais núcleos, e devolve o arquivo. O script `rendi` sobe o que for arquivo local, roda, espera, baixa a saída pra pasta e apaga tudo de lá (o link deles é público por padrão):

```sh
python3 $S/rendi rodar \
  --entrada in_1=bruto.mp4 --saida out_1=final.mp4 --pasta videos/ --max 600 \
  --comando '-i {{in_1}} -vf scale=-2:1080 -c:v libx264 -preset medium -crf 22 -c:a aac -b:a 128k -movflags +faststart {{out_1}}'
```

- O comando vai **sem a palavra `ffmpeg`**, com `{{in_1}}`, `{{out_1}}` (e `in_2`, `out_2`… quando tiver mais) no lugar dos arquivos. Nome de saída só com letras, números, `_`, `-` e `.`.
- A entrada pode ser arquivo da pasta (o script sobe) ou uma URL pública (Drive, Dropbox, S3).
- Roda em segundo plano: ele escreve o andamento e no fim imprime os arquivos baixados e quanto gastou da cota.
- `--max` é o tempo máximo do ffmpeg lá, em segundos.
- `python3 $S/rendi estado <command_id>` mostra um comando que ficou pela metade.

**Os planos (conferidos em 10/2026; confirma em rendi.dev/pricing antes de recomendar):**
- **Grátis:** 50 GB por mês (entrada + saída), mas **cada comando roda no máximo 1 minuto**. Serve pra corte, compressão e conversão de vídeo curto. Render longo não cabe, e o envio de arquivo local pode não estar liberado no grátis (o script avisa com 403): aí a entrada vai por URL pública.
- **Pro (a partir de US$ 25/mês):** 250 GB, comando de até 10 min, 4 vCPUs. É o que resolve render pesado de verdade.
- Passou da cota ou o plano não permite: o script para com 403 e diz o motivo. Não insiste e não troca de plano: conta pra pessoa.

### Ligar o Rendi

Só oferece quando fizer falta (render longo, lote, máquina já carregada), sem insistir.

1. A pessoa cria a conta em `app.rendi.dev/sign-up` (pede cartão só pra verificar) e copia a chave no painel.
2. Pergunta se a chave é **só dela ou do time**:
   - **Só dela:** pede a chave (não repete na resposta) e grava `RENDI_API_KEY=…` em `~/.config/ratoeira/chaves.env`, com `chmod 600`.
   - **Do time:** se o cofre está ligado (`OP_SERVICE_ACCOUNT_TOKEN` no ambiente), a chave mora no 1Password e o `.env` da raiz da pasta de trabalho recebe só a referência (`RENDI_API_KEY=op://Vault/item/CAMPO`). Sem cofre, vai no `.env` da raiz, que **tem que estar no `.gitignore`** (`git check-ignore .env`). Registra em `_contexto/integracoes.md` (integração, pra quê, como o agente alcança, onde mora a chave, nunca o valor).
3. Opcional: o MCP de documentação deles ajuda o agente a montar comandos (`claude mcp add --scope user --transport http rendi https://www.rendi.dev/docs/mcp`). Ele só ensina, não roda nada.
4. Confere: `bash $S/chave RENDI_API_KEY >/dev/null && echo tem`.

O `chave` procura nesta ordem: variável de ambiente, `~/.config/ratoeira/chaves.env`, `.env` na raiz da pasta de trabalho. Valor cru ou `op://`.

## Se a máquina já está pesada

`uptime` com carga perto do número de núcleos (`nproc`), ou o chat lento: não começa render novo. Diz pra pessoa, mostra o que está rodando (`ps -eo pid,user,pcpu,etime,args --sort=-pcpu | head`) e pergunta se espera, se manda pro Rendi ou se para um processo **dela**. Processo de outra pessoa não se mata: avisa quem é o dono.
