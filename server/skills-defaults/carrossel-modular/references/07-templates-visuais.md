# 07 · Templates visuais (engine D)

Módulo lido quando: engine `D` escolhido. Aluno usa um template base fixo (PNG/JPG) e adiciona conteúdo por cima.

Este é o modo **estilo Samuel / Apple Notes** — identidade visual consistente entre carrosséis.

---

## Princípio fundamental

**SEMPRE usar o template base como fundo fixo.**

❌ **NUNCA** tentar recriar/gerar a imagem base com IA
✅ **SEMPRE** usar `assets/templates/template-base.jpg` (ou caminho fornecido pelo usuário) como input
✅ **ADICIONAR** conteúdo por cima (título, textos, imagens, CTA)

---

## Onde fica o template base

Default da skill: `assets/templates/template-base.jpg`

Se o usuário disser `usa template X` → ele aponta o caminho. Ex:
- `usa template /Users/foo/templates/clean-bege.jpg`
- `usa template ~/Desktop/template-marca-azul.png`

Se não tem template salvo, peça pra ele:
- Criar 1 no Canva (1080×1350, fundo bege/branco/cor da marca, sem texto)
- Exportar como JPG
- Apontar o caminho

---

## Especificações do template base

| Item | Recomendado |
|---|---|
| Formato | 1080×1350px (4:5 vertical) |
| Tipo de arquivo | JPG ou PNG |
| Conteúdo fixo | Apenas elementos de identidade visual (topo: nome do perfil + ícone iCloud; rodapé: handle + ícone seta próxima) |
| Área editável | Centro da imagem — entre topo e rodapé |
| Cor de fundo | Sólida ou textura sutil (bege #F5F1E8, off-white #FAF5F0, preto #0A0A0A, etc) |
| Margem lateral interna | Mínimo 100px |

**O template é INTOCÁVEL.** Toda criação de slide preserva o template como está e adiciona conteúdo por cima.

---

## Tipografia padrão (estilo Apple Notes)

| Slot | Fonte | Cor | Tamanho relativo |
|---|---|---|---|
| Capa (título principal) | Sans-serif Black | #000000 | grande |
| Texto interno | Sans-serif Regular | #000000 ou #3C3C3C | médio |
| CTA (último slide) | Sans-serif Black | #000000 | grande (menor que capa) |
| Números de tópicos | Sans-serif Black | **#C5A572 (dourado, cor sólida, SEM gradiente)** | grande |

⚠️ **Use tamanhos relativos (grande/médio/pequeno) em prompts pro Gemini, não absolutos (pt/px).** Modelo de imagem não respeita medida exata — ignora "60pt" e gera o que acha que cabe. Tamanhos relativos + descrição da hierarquia ("o número precisa ser visualmente o item de maior destaque") funcionam melhor.

**Margem lateral:** generosa (texto não ultrapassa ~75% da largura).
**Alinhamento:** esquerda (default), centro só pra CTAs curtos.

## Regras visuais críticas (Apple Notes)

1. **Centralizado verticalmente** na zona editável — espaço equilibrado acima e abaixo, nunca empurrado pra cima ou pra baixo. Pedido explícito no prompt: *"Todo o conteúdo deve ficar CENTRALIZADO VERTICALMENTE na área editável, com espaço equilibrado acima e abaixo."*

2. **Número e título na MESMA LINHA** — em slides numerados, número (ex: "3.") fica à esquerda + título à direita, lado a lado horizontalmente. **NUNCA empilhar verticalmente** (número em cima, título embaixo). Pedido explícito: *"o número e o título lado a lado horizontalmente na mesma linha, nunca empilhados verticalmente"*.

3. **NUNCA duplicar o handle** no texto do slide — ele já está na assinatura fixa do template.

4. **NUNCA gradiente nos números dourados** — cor sólida `#C5A572` flat.

5. **NUNCA repetir frases ou elementos** entre slides — cada slide tem conteúdo único.

---

## Quantidade de slides (estilo Samuel)

| Complexidade do tema | Slides |
|---|---|
| Simples/direto | 7-8 |
| Médio | 8-9 |
| Complexo/completo | 9-10 |
| **Máximo absoluto** | 10 |

---

## Âncora de estilo (prefixo padrão de prompt)

**Use o mesmo prefixo em TODOS os prompts** do carrossel — não só descreve o template em cada prompt, fixa uma "âncora" que o modelo segue.

Prefixo padrão (cole no início de todo prompt):

```
Manter esta imagem de fundo estilo Apple Notes completamente intacta — preservar
a barra superior e a seção inferior (com o handle do perfil) exatamente como
estão. Todo o conteúdo deve ficar CENTRALIZADO VERTICALMENTE na área editável,
com espaço equilibrado acima e abaixo — nunca empurrado para cima ou para baixo.
```

Depois do prefixo, escreva só o que muda (título, lista, citação, CTA).

## Estratégia "Adaptação ao resultado real"

Quando gera o slide 1, o Gemini produz uma estética específica que **pode diferir do que você pediu**. Mantenha consistência entre slides assim:

1. Gere o **slide 1** (capa).
2. Examine o resultado: cor exata do fundo, tom do título, escala real do texto, espaçamento real.
3. Ajuste os prompts dos **slides 2+** pra **combinar com o resultado real do slide 1**, não com a especificação original.

> **Consistência entre slides > perfeição individual de cada slide.**

Exemplo: se o slide 1 saiu com texto preto puro e bem ao centro, todos os slides seguintes devem pedir preto puro + centralizado — mesmo que o briefing original falava em "cinza escuro".

## Regeneração, nunca edição

Se um slide saiu fora do padrão, **delete e regere** com prompt ajustado. Gemini **não faz edições cirúrgicas** — sempre gera do zero. Pedir "ajusta a margem" não funciona; gera o slide inteiro de novo com a margem certa.

## Limite de prompt

Mantenha **abaixo de 200 palavras**. Prompts longos confundem o modelo e fazem ele ignorar parte das instruções. Se passou de 200 palavras, divide em 2 slides ou simplifica.

---

## Geração de slide via Nano Banana Pro com template base

### Capa

```bash
uv run ~/.claude/skills/carrossel-modular/scripts/generate_image_nano_banana.py \
  --prompt "[PREFIXO ÂNCORA DE ESTILO acima]. Adicionar APENAS um título grande
  em fonte sans-serif preta e bold: \"[TÍTULO DA CAPA]\". Alinhado à esquerda com
  margens laterais generosas. Abaixo do título, uma imagem ilustrativa pequena
  relacionada ao tema (logo, ícone ou ilustração simples). Design limpo,
  minimalista e premium com bastante espaço em branco. Não adicionar bordas,
  sombras ou elementos decorativos." \
  -i [caminho-do-template-base.jpg] \
  --filename "yyyy-mm-dd-hh-mm-capa-[slug].png" \
  --resolution 2K
```

### Slide interno (lista numerada)

```bash
uv run ~/.claude/skills/carrossel-modular/scripts/generate_image_nano_banana.py \
  --prompt "[PREFIXO ÂNCORA DE ESTILO]. Adicionar o número \"[N].\" em cor
  dourada/bronze sólida #C5A572 (sem gradiente) grande e bold, posicionado
  À ESQUERDA, e NA MESMA LINHA ao lado direito dele o título \"[TÍTULO]\"
  em fonte sans-serif preta e bold — ambos lado a lado horizontalmente,
  NUNCA empilhados verticalmente. Abaixo dessa linha, texto explicativo em
  fonte sans-serif regular cinza escuro, tamanho médio: \"[CORPO]\". Margens
  laterais generosas. Palavras-chave do corpo em negrito. Espaçamento confortável
  entre elementos. Limpo e minimalista." \
  -i [caminho-do-template-base.jpg] \
  --filename "yyyy-mm-dd-hh-mm-slide-N.png" \
  --resolution 2K
```

### CTA final

```bash
uv run ~/.claude/skills/carrossel-modular/scripts/generate_image_nano_banana.py \
  --prompt "[PREFIXO ÂNCORA DE ESTILO]. Adicionar mensagem de CTA em fonte
  sans-serif preta e bold, tamanho grande mas não exagerado: \"[TEXTO DO CTA]\".
  Centralizado ou à esquerda conforme melhor leitura. Incluir ícones nativos
  do Instagram quando relevante (🔖 salvar, ❤️ curtir, 💬 comentar, ↗️ compartilhar).
  IMPORTANTE: NÃO mencionar o handle do perfil (já está na assinatura do template).
  Design limpo e impactante." \
  -i [caminho-do-template-base.jpg] \
  --filename "yyyy-mm-dd-hh-mm-cta-final.png" \
  --resolution 2K
```

---

## Regras visuais avançadas (aprendidas com Samuel)

### Timeline / sequências / metas
**SEMPRE usar gráficos visuais** quando tiver:
- Sequências temporais ("2020 → 2021 → 2022")
- Previsões de faturamento ("R$ 1M → R$ 5M → R$ 10M")
- Metas progressivas ("Bronze → Prata → Ouro")

Exemplo de prompt: *"adicionar gráfico de linha ascendente simples mostrando 3 pontos: 2024, 2025, 2026, em preto fino, com valores ao lado"*

### Citações de empresas
**SEMPRE incluir logos** quando citar outras empresas/marcas:
- OpenAI → logo OpenAI
- Google → logo Google
- Anthropic → logo Anthropic

**Posicionamento:** logo ao lado do nome (nunca separado).

### Listas de benefícios/vantagens
**SEMPRE usar checkmarks verdes ✅** em listas positivas:
- Cor: verde #00C853
- Tamanho: proporcional ao texto
- Antes de cada item

### Textos longos
**SEMPRE destacar palavras-chave** em negrito:
- Identificar a palavra mais importante de cada frase
- Aplicar bold só nessa palavra
- Facilita scanability

### CTAs com ícones nativos
- Salvou? → 🔖
- Curtiu? → ❤️
- Comenta! → 💬
- Compartilha! → ↗️

Fonte do CTA: tamanho **G** (menor que a capa XG, mas maior que o body M). Em prompt: *"tamanho grande mas não exagerado, menor que o título da capa"*.

---

## Busca automática de imagens ilustrativas (opcional)

Quando o carrossel cita empresa/pessoa/produto, busca foto ilustrativa via DuckDuckGo (sem API key, sem custo):

```bash
uv run scripts/image-finder.py --keyword "anthropic headquarters" --count 1
```

Script vem com a skill (`scripts/image-finder.py`) — usa o DuckDuckGo image search direto, sem precisar conta Google/Pexels/Unsplash.

Casos de uso:
- Slide sobre empresa → "[empresa] headquarters" ou "[empresa] team"
- Slide sobre pessoa → "[nome da pessoa]"
- Slide sobre produto → "[produto] screenshot"
- Slide sobre conceito → "[conceito] illustration"

Depois, combina template base + foto via multi-image:

```bash
uv run ~/.claude/skills/carrossel-modular/scripts/generate_image_nano_banana.py \
  --prompt "Usar template base como fundo. Adicionar foto ilustrativa centralizada \
  ocupando 60% da área editável, com texto de apoio abaixo." \
  -i template-base.jpg \
  -i foto-ilustrativa.jpg \
  --filename "slide-com-foto.png"
```

---

## Vídeos no carrossel (padrão Samuel)

Quando incluir vídeo, usar template base como fundo com vídeo centralizado:

```bash
ffmpeg -y -i [VIDEO_INPUT].mp4 \
  -loop 1 -i [caminho-template-base.jpg] \
  -filter_complex "[0:v]scale='min(1080,iw)':-2:force_original_aspect_ratio=decrease[video]; \
  [1:v]scale=1080:1350,format=yuv420p[bg]; \
  [bg][video]overlay=(W-w)/2:(H-h)/2:shortest=1[outv]" \
  -map "[outv]" -map 0:a \
  -c:v libx264 -preset medium -crf 23 -c:a copy \
  -t [DURACAO] \
  carrossel-video-[nome].mp4
```

Descobrir duração:
```bash
ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 [VIDEO_INPUT].mp4 | cut -d. -f1
```

⚠️ **Nunca cortar o vídeo** — sempre redimensionar mantendo tudo visível. Vídeos wide ficam com mais margem lateral (normal).

---

## Avisos críticos

1. **NUNCA modifique o template base** — usa sempre via `-i`
2. **RESPEITE margens mínimas** (100px laterais)
3. **NÃO sobreponha elementos fixos** (topo, assinatura)
4. **MANTENHA consistência** tipográfica
5. **NUNCA repita** frases, palavras ou elementos
6. **NUNCA use Gemini pra editar template** — se precisa corrigir, DELETE e RECRIE usando o template base original

---

## Customização (avançado)

O **estilo Samuel** é só 1 exemplo de template-engine. Aluno avançado pode:

### Criar seu próprio template base

1. Define identidade visual (cor de fundo, marca d'água, elementos fixos)
2. Cria 1 PNG/JPG 1080×1350 no Canva/Figma/Photoshop
3. Salva em `assets/templates/meu-template.jpg`
4. Aponta no briefing: `usa template assets/templates/meu-template.jpg`

### Trocar tipografia

- Edita § "Tipografia padrão" deste módulo
- O default é "sans-serif Black / Regular" (Gemini interpreta como Helvetica, Inter, SF Pro — depende do que ele acha que combina)
- Pra forçar uma família específica, cite no prompt: *"fonte Inter Black"*, *"fonte Söhne Bold"*, etc — Gemini tenta aproximar
- Mantém estrutura: capa Black, body Regular, números em cor sólida de destaque

### Adicionar variações de template

Pode ter vários templates pra mesmo perfil (variação por categoria de post):
- `template-tech.jpg` — fundo escuro, accent verde neon
- `template-mercado.jpg` — fundo bege, accent dourado
- `template-meme.jpg` — fundo branco puro, sem rodapé

No briefing, pergunta extra: *"qual variação de template? tech/mercado/meme/outro"*.

### Criar template via Nano Banana Pro

Se o aluno não tem Canva/Figma, pede pra Nano Banana Pro gerar o template UMA vez:

```bash
uv run ~/.claude/skills/carrossel-modular/scripts/generate_image_nano_banana.py \
  --prompt "Template 1080x1350 vertical, fundo cor sólida [HEX], \
  topo discreto com texto '[NOME PERFIL]' em fonte sem-serifa pequena, \
  rodapé com '@[handle]' alinhado à esquerda. \
  Centro 100% vazio, pronto pra receber título. \
  Estilo: [Apple Notes / minimalista / editorial]. \
  Sem outros elementos. Sem texto no centro." \
  --filename "template-base.jpg" \
  --resolution 4K
```

Salva em `assets/templates/` e usa daí em diante.

---

## Quando trocar pra outro engine

- **Template ficou repetitivo** → engine A (Nano Banana Pro) pra capas variadas
- **Slide precisa de tabela/diagrama complexo** → engine B (gpt-image-2)
- **Carrossel single-use sem identidade** → engine A
- **Aluno quer salvar dinheiro de API** → engine B com `--quality low` (~$0.10 o carrossel)
