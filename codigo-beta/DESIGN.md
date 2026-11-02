# Design system da Ratoeira: "Ilha"

Adotado em 08/10/2026. Toda tela nova da Ratoeira (área do portal, página de aplicação, kit) sai neste padrão. Os tokens moram no começo de `gateway/public/portal.css`; aqui fica o porquê e as regras de uso.

A Ilha ganhou de Neutro (Linear), Aba (navegador) e Fino (Pipeline).

## A ideia

O fundo é um **palco** cinza-quente. Tudo que se lê ou se usa fica numa **ilha** branca solta sobre ele, com canto de 14px e uma sombra quase invisível. Não há borda dura separando áreas: o vão de 8px entre as ilhas faz esse papel (e é por ele que se arrasta pra mudar a largura das colunas).

Referências: Arc (ilhas sobre fundo tingido) e o próprio Paseo (cantos redondos).

## Regras

1. **Pequeno e sutil.** Corpo 13.5px. Abas de 28px. Botões de 32px. No celular tudo sobe pra 44px de toque.
2. **Seleção é troca de fundo, nunca contorno.** Aba ativa ganha o cinza de campo (`--surface`). Item ativo da árvore, que fica no palco, vira uma pílula branca (`--island` + `--shadow`). Nada de borda amarela em volta.
3. **Botão de ícone não tem borda.** Classe `.ib`: transparente, fundo cinzinha só no hover. Botão com texto tem borda de 1px na cor de linha. O principal (`.primary`) é escuro (`--primary`), não amarelo.
4. **Amarelo é ponto de luz.** Foco, agente rodando, anel de contexto, pedido de permissão, avatar. Nunca fundo de bloco grande nem botão comum.
5. **Três fontes, cada uma com um papel.** Geist no texto de interface. Bricolage só em título de página (`h1`) e na marca. Geist Mono em caminho, comando e código. As três são servidas pelo gateway (o CSP do portal não deixa buscar fonte de fora).
6. **Campo dentro de ilha é cinza; campo no palco é branco.** `input` usa `--surface`; a busca da árvore, que está no palco, usa `--island`.
7. **Ícones de traço**, 1.6 de espessura, herdando a cor do texto. Nada de emoji na interface.
8. **Escuro é o mesmo desenho.** Só os tokens mudam (`:root[data-theme=dark]`). Tela nova não escreve cor solta: usa os tokens.

## Tokens

| Token | Claro | Escuro | Uso |
|---|---|---|---|
| `--bg` | `#ecebe6` | `#141412` | palco |
| `--island` | `#fff` | `#1e1e1b` | ilhas, cards, popovers |
| `--surface` | `#f4f3ef` | `#272723` | campo, aba ativa, balão do usuário |
| `--hover` / `--hover-stage` | `#f1f0ec` / 6% preto | `#2a2a26` / 5% branco | hover dentro da ilha / no palco |
| `--ink` / `--ink2` / `--muted` | `#1f1e1b` / `#3d3c37` / `#67655d` | `#eeece4` / `#cfccc2` / `#9d9a90` | texto forte, corpo, apoio |
| `--line` / `--line-soft` | `#e4e2dc` / `#efeeea` | `#33322d` / `#2a2925` | borda de botão / divisória dentro da ilha |
| `--accent` | `#ffd600` | `#ffd600` | ponto de luz |
| `--accent-soft` / `--accent-line` / `--accent-text` | `#fff8d6` / `#efd977` / `#7a5d00` | `#2c2911` / `#5b5217` / `#ffd600` | pedido de permissão, foco de campo, chip forte |
| `--primary` | `#1f1e1b` | `#eeece4` | botão principal, tooltip, toast |
| `--shadow` / `--shadow-up` | | | ilha parada / ilha em destaque (hover, popover) |
| `--r-island` / `--r` / `--r-sm` | 14 / 8 / 6px | | ilha / botão, aba, campo / detalhe |
| `--gap` | 8px | | vão entre ilhas |

`--muted` sobre `--bg` passa 4.5:1. Não clarear.

## Peças prontas (classes em `portal.css`)

- **Estrutura:** `.rail` (barra da esquerda: aberta nas telas de conteúdo, 212px com ícone e nome; recolhida sempre na Mesa, 56px só com ícones e o nome como dica `.tip`; sem botão de recolher, quem decide é a tela (`data-barra` no `<html>`); vira faixa no topo no celular, igual em todas as telas: rato que abre a gaveta `#eu-pop`, alternador `.mesa-seg` em colunas iguais, conversa nova e sino, tudo com 44px de altura), `main` (o palco), `.content-view` (página com largura máxima de 1160px).
- **Ilhas:** `.card` (card de painel), `.app-card` (aplicação), `.editor` (formulário), `.app-list`/`.provider-list` (lista em ilha), `.frame-view` (quadro com iframe).
- **Grade de painéis (área Arquivos, `grid.js`):** `.painel` (ilha solta, posicionada pelo JS), `.tabsbar` + `.tab` (aba de arquivo ou conversa; `.ativa`, `.rodando`), `.painel-acoes` (botões de ícone + menu ⋯ `.menu-painel`), `.grade-divisor` (vão arrastável), `.grade-alvo` (onde a aba vai cair), `.aba-corpo` (conteúdo da aba, na camada por cima).
- **Alternador:** `.seg` (dois ou três estados). Na coluna da Mesa, `.coluna-seg` (Arquivos · Conversas, largura toda, com o contador `.coluna-n`).
- **Lista de conversas (coluna da Mesa):** `.conv-lista` com `.cl-grupo` (título do grupo, com `.dot` quando tem luz) e `.cl-item` (`.cl-av` ícone do agente ou rosto, `.cl-t` título, `.cl-h` hora, `.cl-sub` apoio, `.cl-n` não lidas, `.cl-resp` Responder; `.ativa` pílula branca, `.espera` fundo amarelo), `.cl-mais` (Ver todas), `.mesa-sinal` (aviso do pé em Arquivos). Itens com `flex-shrink:0`: lista que rola não pode espremer.
- **Autoria na conversa compartilhada:** `.msg-rosto` (iniciais com o tom `.t0`…`.t5` do nome), `.msg-autor`, `.seguida` (junta mensagens da mesma pessoa), `.msg-agente-cab` + `.msg-agente-av` (quem é o agente e pra quem responde).
- **Listas:** `.lista` + `.linha` (linha clicável com título `.t` e apoio `.w`), `.dot.ok`/`.dot.acc` (status).
- **Ícone de aplicação:** `.appic` com tom `.t0`…`.t5` escolhido pelo nome (`tom()` no `portal.js`), `.appic.vazio` pra "nova".
- **Compositor:** `.composer` com `.pilula` (modelo, esforço, permissão, pasta), `.anel` (contexto) e `.enviar`.
- **Botões:** `button`, `button.primary`, `.ib`.

## Pra quem faz página de aplicação (`pages/`)

As páginas de Aplicações abrem num quadro isolado e não herdam o `portal.css`. Pra parecer parte da Ratoeira: copiar o bloco `:root` de tokens, usar fundo `--bg` com o conteúdo em ilhas `--island` de canto 14px, e as mesmas regras acima.
