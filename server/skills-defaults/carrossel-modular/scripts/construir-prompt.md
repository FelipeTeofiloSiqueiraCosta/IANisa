# Construir prompts de slide

Guia rápido de como escrever prompts pros engines de imagem. Use junto com `references/05-render-nano-banana-pro.md` (engine A) e `references/06-render-alternativas.md` (B/C/E).

---

## Princípio chave: tamanhos RELATIVOS, não absolutos

⚠️ Engines de imagem (Nano Banana Pro, gpt-image-2) **ignoram medidas em px/pt**. Não escreva "fonte 60pt" ou "margem 100px" — o modelo gera o que acha que cabe.

**Use tamanhos relativos:**
- `grande / médio / pequeno`
- `maior que X / menor que Y`
- `ocupando ~70% da largura`
- `bastante espaço em branco / margens generosas`

**E descreva hierarquia:**
- *"o número precisa ser o item de maior destaque visual"*
- *"título maior que o corpo de texto"*

Isso vale pros 4 engines (A/B/C/D).

## Mantenha o prompt < 200 palavras

Prompts longos confundem o modelo. Se passou de 200 palavras, divide em 2 slides ou simplifica.

---

## Estrutura universal (qualquer engine)

```
[FORMATO] [ESTILO] [CENA] [PALETA] [COMPOSIÇÃO] [NÃO INCLUIR]
```

---

## Template para CAPA (com imagem realista)

### Engine A (Nano Banana Pro) — fotorrealismo + texto na mesma imagem

```
Imagem 1080x1350 vertical, fotográfica editorial.

CENA: [descrição concreta — quem/o quê/onde/quando/luz]
Exemplo: "empresário de 40 anos olhando tela de notebook em escritório minimalista
com luz natural lateral da janela, terno casual sem gravata, expressão focada"

TEXTO NO SLIDE (renderizar EXATAMENTE como escrito, mantendo acentos):
"[HEADLINE LITERAL ENTRE ASPAS]"
Tipografia: sans-serif Black, tamanho grande, alinhado à esquerda, cor [preto/branco].

PALETA: cor predominante [HEX], detalhes em [HEX_ACCENT], fundo [LIGHT_BG ou DARK_BG].

COMPOSIÇÃO: terço inferior livre pra texto. Espaço negativo abundante.

REFERÊNCIAS VISUAIS PERMITIDAS: logos das marcas citadas no briefing
(Apple, OpenAI, Google, etc), pessoas reconhecíveis se relevantes ao tema,
produtos reais, cidades/ambientes específicos. Imagem rica > genérica.

EVITAR: watermark da IA, elementos de UI do Instagram (chrome do app),
logos aleatórios não pedidos.

ESTILO: [Clássico cinemático | Moderno tech | Minimalista | Bold saturado].
```

### Engine B (gpt-image-2) — tipografia densa / infográfico

```
Pôster 4:5, fundo [HEX], texto centralizado:

"[TÍTULO EXATO AQUI]"

Tipografia: [fonte] [peso] [tamanho relativo]. Alinhamento: esquerda/centro.

ELEMENTOS PERMITIDOS: logos das marcas citadas, ícones de apoio,
infográficos simples (gráfico de barras, timeline horizontal).
Foco principal continua sendo o texto.
```

### Engine D (template base) — Apple Notes style

```
Usar a imagem base fornecida EXATAMENTE como está (não modificar nada).

ADICIONAR apenas no centro da área editável:
- Título: "[TÍTULO]" em Helvetica Neue Black, preto, tamanho [72-90]pt,
  alinhado à esquerda, margem 100px das laterais.

RESPEITAR área editável (entre topo UI e assinatura).
NÃO SOBREPOR elementos fixos.
Composição clean com espaço em branco.
```

---

## Template para SLIDE INTERNO

### Slide com 1 número grande de destaque

```
[ÂNCORA DE ESTILO]. Adicionar no centro:
- Número '[NÚMERO]' em [COR_DESTAQUE], sans-serif Black, tamanho GRANDE
  (item de maior destaque visual), alinhado à esquerda.
- Abaixo: legenda curta em sans-serif Regular preto, tamanho MÉDIO.
  "[LEGENDA - máx 8 palavras]"

Centralizado verticalmente. Margens laterais generosas.
```

### Slide com lista numerada (1., 2., 3.)

```
[ÂNCORA DE ESTILO]. Adicionar lista de [N] itens:
1. [item 1 - máx 7 palavras]
2. [item 2 - máx 7 palavras]
3. [item 3 - máx 7 palavras]

Tipografia:
- Números (1./2./3.) em COR SÓLIDA DOURADA #C5A572 (sem gradiente),
  sans-serif Black, tamanho GRANDE.
- Texto dos itens em sans-serif Black preto, tamanho MÉDIO-GRANDE.

Número e texto de cada item NA MESMA LINHA (lado a lado horizontalmente,
nunca empilhados). Alinhamento esquerda. Centralizado verticalmente.
Espaçamento confortável entre itens.
```

### Slide com citação grande

```
[ÂNCORA DE ESTILO]. Adicionar no centro:
- Aspas grandes '"' em [COR_DESTAQUE], tamanho GRANDE, no topo da citação.
- Citação: "[CITAÇÃO - máx 15 palavras]" em sans-serif Black preto,
  tamanho MÉDIO-GRANDE, line-height confortável, alinhado à esquerda.
- Atribuição abaixo: "— [NOME, CARGO]" em sans-serif Regular cinza escuro,
  tamanho PEQUENO.

Centralizado verticalmente. Margens laterais generosas.
```

### Slide com timeline / sequência

```
[ÂNCORA DE ESTILO]. Criar timeline horizontal simples com 3 pontos:
[2024] ────● [2025] ────● [2026]

- Linha em preto fino.
- Pontos em [COR_DESTAQUE] preenchidos, tamanho médio.
- Anos em sans-serif Black preto, tamanho MÉDIO.
- Valor abaixo de cada ponto em sans-serif Black [COR_DESTAQUE], tamanho GRANDE:
  "[VALOR_1]" "[VALOR_2]" "[VALOR_3]"

Centralizado verticalmente. Visual clean, sem cores chamativas.
```

### Slide com checklist (✅ benefícios)

```
[ÂNCORA DE ESTILO]. Adicionar lista de [N] itens com check verde:
✅ [item 1]
✅ [item 2]
✅ [item 3]

Tipografia:
- ✅ em verde #00C853, tamanho proporcional ao texto.
- Texto em sans-serif Black preto, tamanho MÉDIO-GRANDE.

Negrito na palavra-chave de cada item. Alinhamento esquerda.
Centralizado verticalmente. Margens laterais generosas.
```

---

## Template para CTA FINAL

```
Usar imagem base.

ADICIONAR no centro:
- CTA principal: "[FRASE CTA]" em Helvetica Neue Black preto, 60pt,
  alinhado à esquerda, margem 100px.
- Linha de ação abaixo, com ícone: "[Ação]? 🔖 [Continuação]! 💬"
  em Helvetica Neue Roman preto, 42pt (30% menor que CTA principal).

Ícones nativos do Instagram:
- 🔖 (salvar) para "Salvou?"
- ❤️ (curtir) para "Curtiu?"
- 💬 (comentário) para "Comenta!"
- ↗️ (compartilhar) para "Compartilha!"

Composição limpa e impactante.
```

---

## Dicas pra evitar erro do engine

### Nano Banana Pro (A) — fotorrealismo

- ✅ Descreve cena visualmente, não conceitualmente ("homem de óculos olhando notebook" > "produtividade")
- ✅ Especifica iluminação ("luz natural lateral" / "estúdio com softbox" / "golden hour")
- ❌ Não pede texto longo dentro da imagem — vai sair errado
- ❌ Não pede composição complexa (gráficos, tabelas) — use B ou template

### gpt-image-2 (B) — tipografia

- ✅ Coloca texto **entre aspas** no prompt — modelo respeita literalmente
- ✅ Pede tipografia específica ("Helvetica Black 80pt esquerda")
- ❌ Não pede fotorrealismo extremo — usa A pra isso
- ❌ Não pede mais de 30 palavras de texto na imagem — fica apertado

### Template base (D) — consistência

- ✅ Sempre repete "usar imagem base exatamente como está"
- ✅ Especifica margem (sempre 100px)
- ✅ Aponta área editável (centro, entre topo e rodapé)
- ❌ Nunca pede pra "modificar o template" — só ADICIONAR conteúdo
- ❌ Nunca usa Gemini pra editar template — se errar, deleta e refaz

---

## Iteração rápida

Mantenha um arquivo `~/.carrossel-prompts.md` com prompts que funcionaram. Quando um slide saiu perfeito, copia o prompt pra esse arquivo como template reutilizável.

Exemplo:
```
## Capa estilo Folha (calibrado)
Imagem 1080x1350 vertical, fotográfica editorial Folha de S.Paulo.
CENA: [VARIÁVEL]
TEXTO NO SLIDE: "[HEADLINE LITERAL]" em sans-serif Black, alinhado à esquerda no terço inferior.
PALETA: tons terrosos, off-white #F5F1E8, accent dourado #C9A84C.
COMPOSIÇÃO: terço inferior — texto. Terço superior livre, espaço negativo.
REFERÊNCIAS PERMITIDAS: pessoas reais, logos das marcas citadas, produtos.
EVITAR: chrome do Instagram, watermark da IA.
ESTILO: minimalismo editorial cinemático.
```

A cada 5-10 carrosséis, revisa esse arquivo e cristaliza padrões.
