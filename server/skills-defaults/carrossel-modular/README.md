# Carrossel Modular

Skill modular pra gerar carrosséis Instagram editoriais — sem cara de IA, com voz própria, em ~7 minutos.

**Versão modular** da Máquina Automática de Carrosséis (express). Mais flexível, mais customizável, mais peças móveis.

---

## Quando usar essa skill (vs a express)

| Sua situação | Use |
|---|---|
| Primeira vez gerando carrossel, não quer pensar | **Express** (`carrossel-claude-skill`) |
| Quer trocar engine de imagem (Nano Banana Pro, gpt-image-2) | **Modular** ← você está aqui |
| Quer template base fixo (estilo Samuel/Apple Notes) | **Modular** |
| Quer customizar filtro editorial pra voz própria | **Modular** |
| Quer encadear vários engines no mesmo carrossel | **Modular** |
| Quer salvar configs de 2+ marcas | **Modular** |

---

## Estrutura

```
carrossel-modular/
├── SKILL.md                     ← orquestrador slim (ponto de entrada do Claude)
├── README.md                    ← este arquivo
├── references/                  ← módulos lidos on-demand
│   ├── 01-fluxo.md              ← pipeline + briefing + 8 perguntas
│   ├── 02-headlines.md          ← LP1-LP5 + 6 gatilhos + checklist
│   ├── 03-editorial.md          ← 11 camadas anti-AI-slop + 7 params + 5 testes
│   ├── 04-design-system.md      ← tipografia + paletas + hierarquia
│   ├── 05-render-nano-banana-pro.md  ← engine A (default)
│   ├── 06-render-alternativas.md     ← engine B (gpt-image-2)
│   ├── 07-templates-visuais.md  ← engine D (template fixo estilo Samuel)
│   └── 08-caption-hashtag.md    ← caption Instagram + hashtags
├── assets/
│   ├── templates/               ← 3 templates de exemplo (bege, dark tech, editorial)
│   │   └── README.md
│   └── briefings/               ← configs de marca em JSON
│       ├── exemplo-marca.json
│       └── README.md
└── scripts/
    ├── generate_image_nano_banana.py  ← engine A (Nano Banana Pro / Gemini 3 Pro Image)
    ├── generate_image_gpt.py          ← engine B (OpenAI gpt-image-2)
    ├── gerar-slide.sh                 ← wrapper bash do engine A
    ├── gerar-slide-gpt.sh             ← wrapper bash do engine B
    ├── image-finder.py                ← busca foto/logo via DuckDuckGo (sem API key)
    └── construir-prompt.md            ← templates de prompt por tipo de slide
```

---

## Pré-requisitos

A skill é **auto-contida** — todos os scripts de geração de imagem vêm embarcados em `scripts/`. Não precisa instalar skill externa.

| Item | Obrigatório? |
|---|---|
| Claude Code (CLI ou IDE) | ✅ |
| `uv` instalado | ✅ (auto-instala deps Python dos scripts inline) |
| `GEMINI_API_KEY` | ✅ pra engine A (Nano Banana Pro) e engine D (template) |
| `OPENAI_API_KEY` | só pra engine B (gpt-image-2) |
| Template base PNG/JPG | só pra engine D — já vem com 3 templates de exemplo em `assets/templates/` |

### Configurar API keys (3 formas — escolhe 1)

Os scripts da skill procuram a chave **nesta ordem**:
1. Variável de ambiente do shell (`export GEMINI_API_KEY=...`)
2. Arquivo `.env` na raiz do projeto onde você roda o Claude Code (ou em qualquer pasta pai até 5 níveis acima)
3. `~/.claude/settings.json` (se `GEMINI_API_KEY` estiver no bloco `env`)

**Forma 1 — `.env` local (mais rápido pra testar)**
```bash
cp ~/.claude/skills/carrossel-modular/.env.example .env
# edita o .env, cola a chave depois do =
# reinicia o Claude Code
```

**Forma 2 — `settings.json` global (persistente, vale em todo projeto)**
Edita `~/.claude/settings.json`:
```json
{
  "env": {
    "GEMINI_API_KEY": "sua-chave-aqui",
    "OPENAI_API_KEY": "sua-chave-aqui-se-for-usar-engine-B"
  }
}
```

**Forma 3 — `export` no shell (não persiste)**
```bash
export GEMINI_API_KEY=sua-chave-aqui
```

Chaves: https://aistudio.google.com/apikey (Gemini) · https://platform.openai.com/api-keys (OpenAI)

### Checa rápido
```bash
echo "uv:              $(command -v uv >/dev/null && echo OK || echo 'FALTA — curl -LsSf https://astral.sh/uv/install.sh | sh')"
echo "GEMINI_API_KEY:  $(test -n "$GEMINI_API_KEY" && echo OK || (test -f .env && grep -q '^GEMINI_API_KEY=.\+$' .env && echo 'OK (no .env)' || echo FALTA))"
echo "OPENAI_API_KEY:  $(test -n "$OPENAI_API_KEY" && echo OK || (test -f .env && grep -q '^OPENAI_API_KEY=.\+$' .env && echo 'OK (no .env)' || echo 'só precisa pra engine B'))"
```

---

## Como instalar

### Opção 1 — Skill local do projeto (recomendado durante a aula)

A skill já está aqui dentro do repo. Pra Claude Code reconhecer, ela precisa estar em `.claude/skills/` ou `~/.claude/skills/`:

```bash
# Symlink local pro projeto (não persiste fora dele)
mkdir -p .claude/skills
ln -s "$(pwd)/carrossel-modular" .claude/skills/carrossel-modular
```

### Opção 2 — Skill global (pra usar em qualquer projeto)

```bash
ln -s "$(pwd)/carrossel-modular" ~/.claude/skills/carrossel-modular
```

Restart Claude Code e a skill aparece. Pra disparar: pede *"gera um carrossel pra Instagram"*.

---

## Como usar (fluxo padrão)

1. Abre Claude Code em qualquer projeto
2. Digita: *"gera um carrossel pra Instagram sobre [tema]"*
3. Responde as 8 perguntas do briefing (marca, nicho, cor, estilo, tipo, CTA, slides+imagens, engine)
4. Escolhe 1 das 10 headlines
5. Aprova a espinha narrativa
6. Aprova o texto slide a slide (ou pede ajustes: `ajusta o slide 3`, `mais denso o slide 5`)
7. Aprova → render → recebe PNGs no diretório atual
8. Recebe a caption final

**Tempo médio**: ~7 minutos do tema ao carrossel postável.

---

## Como criar seu estilo próprio (alvo da aula avançada)

A grande sacada da skill modular: **cada módulo é trocável**. Você adapta a skill pro seu jeito.

### 1. Customizar o filtro editorial (`references/03-editorial.md`)

Adicione/remova camadas:
- **Mais informal**: remove CAMADA 8 (jargões), relaxa CAMADA 11 (conectivos casuais OK: "tipo", "aí", "saca")
- **Mais técnico**: adiciona CAMADA 12 — "todo termo técnico explicado na primeira menção"
- **Voz própria**: adiciona CAMADA 13 — lista de 5-10 "expressões assinatura" da marca + CAMADA 14 — "expressões proibidas"

### 2. Trocar o banco de headlines (`references/02-headlines.md`)

Substitua os 5 padrões positivos por padrões do seu nicho:
- **Jurídico** → "LP1-J — Jurisprudência/STF" (cita STJ, STF, decisão recente)
- **Médico** → "LP2-M — Estudo/Diretriz" (cita NEJM, SBC, diretriz nova)
- **Financeiro** → "LP4-F — Janela curta" (Copom semana que vem, vencimento de prêmio)

Mantém estrutura (5 padrões positivos + 4 negativos + 6 gatilhos + checklist de 10 itens), só troca o conteúdo.

### 3. Trocar o design system (`references/04-design-system.md`)

- Adiciona paleta nova (1 linha na tabela)
- Troca pareamento fonte ↔ estilo (Helvetica → Söhne, etc)
- Cria novo arco narrativo (ex: "Manifesto" → Diagnóstico → Inimigo → Bandeira → Convocação → CTA)

### 4. Trocar engine padrão (`SKILL.md` § 5)

Se seu nicho é text-heavy (jurídico, educação), troca default de `A` (Nano Banana) pra `B` (gpt-image-2). Edita 1 linha em `SKILL.md`.

### 5. Criar template base próprio (`references/07-templates-visuais.md` + `assets/templates/`)

Inspirado no Samuel:
1. Cria 1 PNG 1080×1350 no Canva com sua identidade visual fixa (topo + rodapé + cor de fundo)
2. Salva em `assets/templates/meu-template.jpg`
3. Edita `assets/briefings/minha-marca.json` apontando o caminho
4. Daí em diante, qualquer carrossel com engine D usa seu template

### 6. Criar engine F (próprio)

Se quer usar Midjourney, Stable Diffusion local, FLUX, etc:
1. Cria `references/05f-render-meu-engine.md` com instruções
2. Adiciona linha na tabela do `SKILL.md` § 5 (letra F)
3. Cria `scripts/gerar-slide-meu-engine.sh` (modelo: `gerar-slide.sh`)

### 7. Adicionar pós-processamento

Em `scripts/gerar-slide.sh`, adiciona pipeline depois do render:
- Pillow → filtros, ajuste de saturação, marca d'água
- ImageMagick → bordas, efeitos
- Upload automático pra S3/Bunny/Cloudflare → devolve URL pública

### 8. Salvar prompts campeões

Mantém `~/.carrossel-prompts.md` com prompts de slide que funcionaram. A cada 10 carrosséis, cristaliza padrões.

---

## Comandos rápidos no chat

| Comando | Efeito |
|---|---|
| `gera um carrossel sobre X` | Inicia |
| `usa config minha-marca` | Pula briefing |
| `escolho a 7` | Avança com headline 7 |
| `a 4 mais provocativa` | Reescreve só a 4 |
| `mistura a 2 com a 5` | Combina duas headlines |
| `ajusta o slide 3` | Reescreve slide 3 |
| `troca engine para B` | Re-renderiza com gpt-image-2 |
| `troca paleta para Imobiliário` | Re-aplica paleta nova |
| `exportar` | Gera PNGs finais |
| `caption` | Gera só a caption Instagram |
| `salva config` | Imprime JSON da marca pra reuso |

---

## Diferenças vs skill express

| Aspecto | Express | Modular |
|---|---|---|
| Engine de imagem | Apenas HTML+Playwright | A/B/D (Nano Banana Pro, gpt-image-2, template) |
| Template base fixo (Samuel-style) | ❌ | ✅ (engine D) |
| Customização do filtro editorial | ❌ (monolítico) | ✅ (camadas adicionáveis) |
| Banco de headlines trocável | ❌ | ✅ |
| Configs múltiplas marcas | ❌ | ✅ (JSON por marca) |
| Encadeamento de engines | ❌ | ✅ (capa A, internos B, CTA D) |
| Curva de aprendizado | Baixa (instala e roda) | Média (vale modificar) |
| Tempo médio por carrossel | ~5 min | ~7 min |
| Tamanho do SKILL.md | ~600 linhas | ~140 linhas + módulos sob demanda |

---

## Roadmap (ideias)

- [ ] Engine F: Midjourney via Discord API
- [ ] Engine G: FLUX schnell local (ComfyUI)
- [ ] Auto-upload pro buffer/later/post planner
- [ ] Banco de hashtags vivo (atualiza por trending)
- [ ] A/B test automático: gera 2 versões, mede performance
- [ ] Skill irmã: `reels-modular` (vertical 9:16)

---

## Créditos

Construída em cima da skill express **Máquina Automática de Carrosséis** (calibrada por Oscar Balbino, low-ticket SDA Club IA) + skill **Carrossel Instagram Apple Notes** (Samuel Pereira). Pivotada pra padrão skill-builder com progressive disclosure.

Calibração editorial: análise de 1.000+ carrosséis com métrica real (likes, saves, shares).
