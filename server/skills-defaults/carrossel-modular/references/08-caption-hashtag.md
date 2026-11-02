# 08 · Caption + hashtags

Módulo lido quando: hora de escrever a legenda do post (depois do render).

---

## Estrutura padrão da caption

```
[Hook curto da headline — 1 linha que prende]

[3-5 frases que expandem o ângulo, sem repetir o que está no carrossel.
Caption complementa o carrossel, não resume.]

[CTA do briefing — 1 linha clara]

—
@<handle>

#hashtag1 #hashtag2 ... #hashtag5-12
```

---

## Regras de caption

1. **Hook ≠ headline da capa** — caption começa diferente, pra não soar redundante.
2. **Não resume o carrossel** — caption é "voice over", carrossel é "tela". Quem só lê a caption deve querer ver o carrossel.
3. **Sem fechamentos clichês** (ver `references/03-editorial.md` CAMADA 5). Nada de "salva e comenta", "manda pra um amigo", "espero que gostem".
4. **CTA específico** — usa o CTA do briefing. Se foi "Comenta GUIA pra eu mandar a versão completa", usa essa frase exata.
5. **Sem 2ª pessoa repetida** — "você" no início OK, mas não 5 vezes na mesma caption.
6. **Roda filtro editorial** (CAMADAS 1-11 + 7 params) na caption também.

---

## Estilo de hashtags

### 5 a 12 hashtags

| Quantidade | Categoria |
|---|---|
| **60%** | nicho-específicas (pequenas, 1k-50k posts) |
| **30%** | médias (10k-100k posts) |
| **10%** | amplas (>500k posts) |

### Hashtags PROIBIDAS (caption)

```
#empreendedorismo · #mindset · #foco · #disciplina · #propósito · #sucesso
#empreender · #empresario · #motivacional · #motivacao · #vencedor · #superação
#transformação · #evolução · #legado · #atitude
```

Essas são bait pra bot, queimam o algoritmo. Use **hashtags específicas do tema do post + nicho do perfil**.

### Exemplo por nicho

**Marketing digital** (post sobre "demissão de social media"):
```
#socialmediabrasil #marketingdigital2026 #empresariobr #folhademagra
#produtividadeIA #marketingautomatizado #conteudoBR #cortedecusto
#agenciaversusinhouse #empresariopme
```

**Imobiliário** (post sobre "tendência de compra"):
```
#imobiliariosaopaulo #mercadoimobiliario2026 #investimentoimobiliario
#corretordeimoveis #imoveissp #precomenor #lancamentosp #mercadopme
#realestate #propertytech
```

**Tech/SaaS** (post sobre "fim do funcionário de TI"):
```
#devbrasil #saasbrasil #tecbr #engenhariadesoftware #produtoetech
#startupbrasil #cofounderbr #IAnodesenvolvimento #b2bsaas #scaleup
```

---

## Apresentação ao usuário

```
**Caption:**

[caption final aqui, com quebras de linha como vai ficar no Instagram]

—
**Hashtags ({N}):**
#tag1 #tag2 ... #tagN

—
Editorial caption: 9.0/10
  Gramática 10 · Fluidez 9 · AI Slop 9 · Estrutura 9 · Tom 8

Pede `caption mais provocativa`, `caption mais curta`, `troca hashtags`, ou `aprovado`.
```

---

## Comandos de iteração

- `caption mais provocativa` — refaz com mais tensão
- `caption mais curta` — corta pela metade
- `caption mais técnica` — adiciona termos do nicho
- `troca hashtags` — gera novo set de hashtags
- `caption sem cta` — remove CTA (útil pra post de marca, não de venda)
- `aprovado` — finaliza

---

## Customização (avançado)

Aluno avançado pode:

- **Adicionar bloco fixo** — assinatura padrão do perfil (ex: "— Oscar Balbino, CEO ZapVoice").
- **Multi-CTA** — caption com 2 CTAs (1 macro, 1 específico do post).
- **Banco de hashtags** — manter `~/.hashtags-perfil.md` com sets pré-validados por categoria, e a skill puxa de lá automaticamente.
- **Variação por horário** — caption "ativa" (com CTA forte) pra horário de pico, caption "passiva" (sem CTA) pra fim de noite. Briefing extra: "horário de postagem".
- **Translation/multi-idioma** — gera caption PT-BR e EN-US no mesmo bloco (perfis bilíngues).
