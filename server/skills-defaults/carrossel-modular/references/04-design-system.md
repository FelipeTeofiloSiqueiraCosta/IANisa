# 04 · Design system

Módulo lido quando: definir paleta, tipografia, hierarquia visual antes de renderizar.

---

## Tamanho nativo

**1080×1350px** (4:5 vertical · ideal Instagram).

---

## Paletas por nicho

Default quando usuário não dá cor ou diz "não sei":

| Nicho | Primária | Accent | Fundo Claro | Fundo Escuro | Fonte |
|---|---|---|---|---|---|
| Marketing Digital | `#E8421A` | `#FF6B47` | `#F7F4F1` | `#0F0D0C` | Barlow Condensed |
| Imobiliário | `#1B2A4A` | `#C9A84C` | `#F5F0E8` | `#0D1B2A` | Montserrat |
| Fitness/Saúde | `#1A1A2E` | `#E94560` | `#F0F4F8` | `#16213E` | Inter |
| Gastronomia | `#2C1810` | `#D4A574` | `#FDF6ED` | `#1A1008` | Playfair Display |
| Moda/Beleza | `#1C1C1C` | `#C4956A` | `#FAF5F0` | `#0A0A0A` | Cormorant Garamond |
| Educação | `#1B3A4B` | `#34B3A0` | `#F0FAF7` | `#0D2137` | Source Sans Pro |
| Tech/SaaS | `#0A192F` | `#64FFDA` | `#F0F4F8` | `#020C1B` | Space Grotesk |
| Advocacia | `#1A1A2E` | `#B8860B` | `#F5F1E8` | `#0D0D1A` | EB Garamond |
| Contabilidade | `#1C2541` | `#3A7D44` | `#F2F6F3` | `#0B132B` | Roboto |
| E-commerce | `#1A1A1A` | `#FF6B35` | `#FFF8F2` | `#0D0D0D` | DM Sans |
| Pet/Veterinária | `#2D3436` | `#E17055` | `#FFF5F0` | `#1A1A1A` | Quicksand |

---

## Geração de paleta a partir de 1 cor

Se o usuário deu só a primária, derive:

- `BRAND_LIGHT` = primária + 20% branco
- `BRAND_DARK` = primária - 30% preto
- `LIGHT_BG` = off-white com temperatura do nicho
- `DARK_BG` = near-black com tint da primária
- `GRADIENT` = `linear-gradient(165deg, BRAND_DARK, BRAND, BRAND_LIGHT)`

---

## Pareamento fonte ↔ estilo visual

| Estilo | Headline | Body |
|---|---|---|
| Clássico | Playfair Display 900 | DM Sans 400 |
| Moderno | Barlow Condensed 900 | Plus Jakarta Sans 400 |
| Minimalista | Plus Jakarta Sans 800 | Plus Jakarta Sans 400 |
| Bold | Space Grotesk 800 | Space Grotesk 400 |

---

## Escala tipográfica

| Elemento | Tamanho relativo |
|---|---|
| Headline capa | XG (item de maior destaque) |
| Headline interna | G |
| Body | M |
| Tag (número/handle) | P |

⚠️ Use só tamanhos relativos (XG/G/M/P) nos prompts — modelos de imagem (A/B/C/D) ignoram pt/px.

---

## Hierarquia (sempre 3 níveis, nunca mais)

1. **Âncora** — headline, número grande, palavra-chave
2. **Contexto** — body que sustenta a âncora
3. **Metadata** — número do slide, @, tag

---

## Cor accent (regras)

- Apenas em **palavras-chave** (números importantes, palavra-tese)
- Nunca em frases inteiras
- Nunca em fundos de texto
- Aparece em **< 10%** da composição

---

## Regra do terço inferior

Conteúdo principal em `flex-end` — terço superior é "respiro" (vazio). Mobile-first: não fica embaixo do username do Instagram.

---

## Slide de capa (regras específicas)

- Sempre tem imagem **OU** fundo sólido + gradient
- Headline tamanho XG (item de maior destaque visual)
- Tag opcional no topo (tamanho P)
- @ no rodapé (tamanho P)
- **Sem** sub-headline. Headline carrega tudo.

---

## Arco narrativo por tipo de carrossel

| Tipo | Arco |
|---|---|
| **Tendência interpretada** | Hook → Contexto → Mudança → Impacto → Ação → CTA |
| **Tese contraintuitiva** | Crença comum → Dados que desafiam → Verdade → Novo modelo → Aplicação → CTA |
| **Case/Benchmark** | Resultado → Quem fez → Como → Princípio → Como replicar → CTA |
| **Previsão/Futuro** | Sinais fracos → Padrão → Direção → Quem se posiciona ganha → Ações → CTA |

---

## Customização (avançado)

Aluno avançado pode:

- **Adicionar paleta nova** ao módulo (basta nova linha na tabela). Recomendado: testar a cor primária no Instagram em modo escuro e claro antes.
- **Trocar pareamento fonte ↔ estilo** pra fontes da marca dele.
- **Adicionar novo estilo visual** (ex: "F — Editorial Magazine" com Tiempos Headline + Newsreader Body).
- **Criar novo arco narrativo** (ex: "Manifesto" → Diagnóstico → Inimigo → Bandeira → Convocação → CTA).

Mantém a estrutura: paleta · pareamento · escala · hierarquia · regra do terço · capa.
