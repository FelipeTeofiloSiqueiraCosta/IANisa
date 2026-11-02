# 05 · Render Nano Banana Pro (engine padrão)

Módulo lido quando: engine `A` escolhido no briefing (default). Gera slides via Google Gemini 3 Pro Image.

---

## Por que default

- **Fotorrealismo** nativo (capa com pessoa real, ambiente real, produto real)
- **4K** nativo (slide entrega nítido em telas grandes)
- **Multi-image fusion** (combina foto do produto + cenário + iluminação)
- **Texto direto na imagem** — gera o slide **completo, com headline + corpo + CTA**, em uma única passada. Não precisa composite separado.
- **API rápida** (~30s por slide em 2K)

**Quando trocar pra engine B (gpt-image-2):** só em casos extremos de tipografia (infográfico denso, tabela com 20+ células, parágrafo longo com 50+ palavras dentro do slide). Pra carrossel editorial padrão, **engine A entrega tudo pronto**.

---

## Pré-requisitos

- API key Gemini em `GEMINI_API_KEY` (env) ou passada via `--api-key`
- `uv` instalado (deps Python são auto-instaladas inline pelo script)

O script `generate_image_nano_banana.py` **já vem com a skill** — não precisa instalar skill externa.

**Checa antes de gerar**:
```bash
test -n "$GEMINI_API_KEY" && echo "GEMINI_API_KEY OK" || echo "FALTA GEMINI_API_KEY"
command -v uv >/dev/null && echo "uv OK" || echo "FALTA uv — instalar com: curl -LsSf https://astral.sh/uv/install.sh | sh"
```

Se faltar `GEMINI_API_KEY`, avise o usuário e ofereça trocar pra engine B (precisa `OPENAI_API_KEY`).

---

## Comando base

```bash
uv run ~/.claude/skills/carrossel-modular/scripts/generate_image_nano_banana.py \
  --prompt "PROMPT_AQUI" \
  --filename "yyyy-mm-dd-hh-mm-ss-slide-N.png" \
  --resolution 2K
```

Resolução: **2K** é o sweet spot pra Instagram (1080×1350 em alta). Use `4K` só se for impressão.

---

## Princípios de prompt (importantes)

1. **Tamanhos relativos, não absolutos** — Nano Banana Pro ignora `60pt`, `100px`. Use "grande/médio/pequeno", "ocupa ~70%", "margens generosas".
2. **Prompt < 200 palavras** — passa disso, modelo descarta partes.
3. **Âncora de estilo fixa** — quando for carrossel (vários slides), defina um prefixo de prompt único e cole em **todos** os slides. Garante consistência visual entre slides.
4. **Adaptação ao resultado real** — após gerar o slide 1, examine o estilo REAL que saiu (cor, escala, espaçamento). Ajuste os prompts dos slides 2+ pra COMBINAR com o resultado, não com a especificação original. Consistência > perfeição.
5. **Regeneração, nunca edição** — se um slide errou, delete e gere de novo com prompt ajustado. Tentar "ajustar" via prompt de edição funciona mal.

## Estrutura do prompt (template)

Nano Banana Pro gera **o slide pronto, com texto incluído**. Estrutura geral:

```
Imagem 1080x1350 vertical para Instagram carrossel. Estilo [Clássico = editorial
cinemático | Moderno = clean tech | Minimalista = espaço puro | Bold = alto
contraste, cores saturadas].

CENA / FUNDO: [descrição visual concreta — cena fotográfica, fundo sólido, gradient].

TEXTO NO SLIDE (renderizar EXATAMENTE como escrito, mantendo acentos):
[HEADLINE OU CORPO LITERAL ENTRE ASPAS]

TIPOGRAFIA: [Sans-serif Black pra headline · Sans-serif Regular pra corpo].
Tamanho: headline grande (item de maior destaque), corpo médio.
Alinhamento: esquerda. Margens laterais generosas.

PALETA: cor predominante [HEX_PRIMARIA], detalhes em [HEX_ACCENT],
texto em [preto / branco / cinza escuro conforme contraste com fundo].

COMPOSIÇÃO: terço inferior — conteúdo principal em flex-end. Espaço negativo
no terço superior. Texto não fica embaixo do username do Instagram.

REFERÊNCIAS VISUAIS PERMITIDAS: pode incluir logos das marcas citadas no briefing
(Apple, OpenAI, Google, etc), pessoas reconhecíveis se relevantes ao tema,
produtos reais, ambientes/cidades específicas. Imagem rica > imagem genérica.

EVITAR: watermark da IA, marcas d'água com instruções, elementos de UI do
Instagram (chrome do app), logos aleatórios não pedidos no briefing.
```

### Templates por tipo de slide

**Capa:**
```
[ESTRUTURA acima].
TEXTO NO SLIDE: headline única "[HEADLINE EXATA]".
Sem sub-headline. Headline carrega tudo.
```

**Slide interno (1 ideia):**
```
[ESTRUTURA acima].
TEXTO NO SLIDE: âncora "[FRASE-CHAVE]" em destaque (sans-serif Black).
Abaixo, corpo "[2-3 frases que sustentam a âncora]" em sans-serif Regular.
```

**Slide com número grande:**
```
[ESTRUTURA acima].
TEXTO NO SLIDE: número "[N]" em tamanho XG na cor [HEX_ACCENT].
Ao lado ou abaixo, legenda "[CONTEXTO DO NÚMERO]".
```

**CTA final:**
```
[ESTRUTURA acima].
TEXTO NO SLIDE: "[FRASE CTA]" em sans-serif Black, alinhamento esquerda.
Linha de ação abaixo com ícones nativos do Instagram (🔖 salvar, ❤️ curtir, 💬 comentar).
@[handle] no rodapé em tamanho pequeno.
```

---

## Dicas pra texto sair perfeito no Nano Banana Pro

1. **Texto entre aspas literais** no prompt — o modelo respeita o que está entre `"..."`.
2. **Avisa pra manter acentos** — "renderizar EXATAMENTE como escrito, mantendo acentos e pontuação".
3. **Limita texto por slide** — até ~30 palavras de texto direto na imagem. Acima disso, divide em 2 slides ou simplifica.
4. **Tipografia em tamanhos relativos** — "Black tamanho grande", não "60pt".
5. **Se errou alguma letra** — regere com prompt idêntico (a próxima geração costuma acertar). Não tenta "ajustar" via edit.

---

## Iteração

```bash
# Variante de capa
uv run ~/.claude/skills/carrossel-modular/scripts/generate_image_nano_banana.py \
  --prompt "$PROMPT_CAPA" --filename "capa-v2.png" --resolution 2K

# Editar slide existente (mudar cor de fundo, adicionar elemento)
uv run ~/.claude/skills/carrossel-modular/scripts/generate_image_nano_banana.py \
  --prompt "ajusta o fundo para tom mais escuro, mantém composição" \
  --input-image "capa-v1.png" \
  --filename "capa-v2.png" --resolution 2K
```

---

## Convenção de nomes

```
yyyy-mm-dd-hh-mm-ss-[slug-do-tema]-slide-NN.png
```

Exemplo:
```
2026-05-17-09-32-15-demissao-social-media-slide-01.png  ← capa
2026-05-17-09-32-15-demissao-social-media-slide-02.png  ← hook
2026-05-17-09-32-15-demissao-social-media-slide-03.png  ← contexto
...
2026-05-17-09-32-15-demissao-social-media-slide-09.png  ← CTA
```

Salva no diretório atual do usuário (não no diretório da skill).

---

## Apresentação ao usuário (após render)

```
✓ 9 slides gerados em /Users/.../slides/
  Engine: Nano Banana Pro · Resolução: 2K · Tempo: ~4min

Slide 1 (capa): 2026-05-17-09-32-15-...-slide-01.png
Slide 2 (hook): 2026-05-17-09-32-15-...-slide-02.png
...

Quer ajustar algum? Ex:
  - "regera slide 3 com fundo mais claro"
  - "troca engine para D pra usar template base"
  - "exportar caption"
```

---

## Fallback

- **Sem API key Gemini**: peça pro usuário configurar `GEMINI_API_KEY` ou troque pra engine B (precisa `OPENAI_API_KEY`).
- **API timeout em slide específico**: tenta uma vez de novo com mesmo prompt. Se falhar 2x, marca esse slide como `[REGERAR]` e segue os outros.
- **Texto na imagem saiu errado**: regenera com prompt idêntico (a próxima costuma acertar). Se persistir, simplifica o texto ou divide em 2 slides com menos palavras cada.

---

## Customização (avançado)

Aluno avançado pode:

- **Salvar prompts campeões** num arquivo `~/.carrossel-prompts.md` e reusar (ex: "estilo Apple Notes minimalista" virou template fixo dele).
- **Trocar engine padrão** editando `SKILL.md` § 5: muda default de A pra B se o nicho dele é text-heavy (jurídico, educação).
- **Encadear engines**: usa Nano Banana Pro pra capa fotorrealista + gpt-image-2 pros slides internos com texto + template base no CTA. Comando: `engine misto: A capa, B internos, D CTA`.
- **Adicionar pós-processamento** (Pillow filters, ImageMagick effects) em `scripts/gerar-slide.sh`.

Detalhes em `references/06-render-alternativas.md`.
