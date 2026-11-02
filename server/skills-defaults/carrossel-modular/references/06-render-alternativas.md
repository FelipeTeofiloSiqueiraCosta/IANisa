# 06 · Render alternativa — gpt-image-2 (engine B)

Módulo lido quando: engine `B` escolhido no briefing, ou usuário pediu `troca engine para B`.

---

## Quando usar gpt-image-2

Pra carrossel **padrão**, engine A (Nano Banana Pro) já entrega slide pronto com texto. Use B só em casos onde **tipografia densa** é o ponto:

- **Infográfico com tabela** (20+ células, números alinhados em grid)
- **Diagrama técnico** (fluxograma, arquitetura, processo com setas e labels)
- **Parágrafo longo** dentro do slide (>50 palavras)
- **Texto com formatação rica** (mistura de tamanhos, negritos, itálicos no mesmo bloco)

**Não é boa pra:** fotorrealismo (use engine A).

---

## Pré-requisitos

- `OPENAI_API_KEY` no env (ou passada via `--api-key`)
- `uv` instalado (deps Python são auto-instaladas inline)

Checa:
```bash
test -n "$OPENAI_API_KEY" && echo "API KEY OK" || echo "FALTA OPENAI_API_KEY"
```

O script roda **embarcado na skill** — não precisa instalar CLI externa.

---

## Comando base

```bash
uv run ~/.claude/skills/carrossel-modular/scripts/generate_image_gpt.py \
  --prompt "PROMPT_AQUI" \
  --filename "yyyy-mm-dd-hh-mm-ss-slide-NN.png" \
  --size 1024x1536 \
  --quality high
```

Sizes aceitos (alias ou pixels exatos):
- `1024x1536` ou `portrait`/`tall` (4:5 vertical — **default pra carrossel**)
- `1024x1024` ou `square`
- `1536x1024` ou `landscape`/`wide`
- `2048x2048`

---

## Custo (qualidade × $)

| Quality | Por slide (1024x1536) | Carrossel 9 slides |
|---|---|---|
| low | ~$0.011 | ~$0.10 |
| medium | ~$0.042 | ~$0.38 |
| high | ~$0.167 | ~$1.50 |

**Avise o usuário antes** se for `high`: *"Vou gerar 9 slides em qualidade alta — custo aprox $1.50. Prossegue?"*

Use:
- `low` pra **rascunho** / explorar variantes
- `medium` pra **iteração** normal
- `high` pra **entrega final** (texto crisp, sem artefatos)

---

## Edit com referência

```bash
uv run ~/.claude/skills/carrossel-modular/scripts/generate_image_gpt.py \
  --prompt "mantém composição, troca fundo para [COR]" \
  --input-image slide-base.png \
  --filename slide-v2.png \
  --quality high
```

---

## Multi-referência (combinar 2+ imagens)

```bash
uv run ~/.claude/skills/carrossel-modular/scripts/generate_image_gpt.py \
  --prompt "combina: foto do produto + cenário urbano + estilo cinemático" \
  --input-image produto.png \
  --input-image cenario.jpg \
  --filename composto.png
```

---

## Inpaint com máscara

```bash
uv run ~/.claude/skills/carrossel-modular/scripts/generate_image_gpt.py \
  --prompt "substitui céu por aurora boreal" \
  --input-image foto.jpg \
  --mask mascara-ceu.png \
  --filename resultado.png
```

Máscara: PNG com canal alpha — transparente = regenerar, opaco = manter.

---

## Quando trocar de engine no meio do carrossel

| Cenário | Solução |
|---|---|
| Capa precisa de foto realista mas slides são text-heavy | Capa engine A, internos engine B |
| Aluno quer consistência total | Tudo engine D (template base) |
| Custo importa muito | Engine B com `--quality low` (~$0.10 o carrossel) |
| Aluno tem só `OPENAI_API_KEY` (sem Gemini) | Tudo engine B |

Comando: `engine misto: A capa, B internos, D CTA` — você roda os engines diferentes e entrega tudo junto.

---

## Customização (avançado)

Aluno avançado pode:

- **Criar engine F próprio** — ex: Midjourney via API, Stable Diffusion local, FLUX schnell. Adiciona novo módulo `references/05f-render-meu-engine.md` e atualiza `SKILL.md` § 5.
- **Engine híbrido**: gpt-image-2 pro texto + Pillow pra composite final + ImageMagick pra ajustes. Tudo em um script bash em `scripts/`.
- **CDN/upload automático**: depois do render, sobe pro S3/Bunny/Cloudflare e devolve URL pública (útil pra agendador de post).
