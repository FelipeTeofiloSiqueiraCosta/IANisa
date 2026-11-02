# 03 · Filtro editorial (anti-AI slop + 7 params + 5 testes)

Módulo lido quando: hora de validar texto de cada slide ou caption.

> **Padrão:** *"um repórter da Folha de S.Paulo escreveria assim?"*
> Você é um jornalista brasileiro, não uma IA traduzindo texto americano.

---

## CAMADA 1 — Construções proibidas (hard-block)

| Proibido | Alternativa |
|---|---|
| "Não é X, é Y" | Mostrar diferença sem nomear fórmula |
| "E isso muda tudo" | Dizer especificamente o que muda |
| "No fim das contas" / "Ao final do dia" | Cortar |
| "A pergunta que fica:" | Formular a pergunta sem anunciar |
| "De forma X" | Ser específico sobre como |
| "É claro que X" / "Simplesmente" / "Basicamente" | Cortar |
| "Cada vez mais" | Usar o dado real |
| "Em um mundo onde" / "Vivemos em uma era" | Começar direto no fato |
| "É preciso" / "Devemos" / "Você precisa" | Tom jornalístico — descrever, não prescrever |
| "Imagine ter…" / "E se eu te dissesse…" / "Você já parou pra pensar…" | Começar com fato |

---

## CAMADA 2 — Verbos-clichê de IA (proibidos absolutos)

```
transforme · desbloqueie · potencialize · destrave · alavanque
revolucione · maximize · otimize (genérico) · escalar (motivacional)
catapultar · elevar · boostar · turbinar
```

---

## CAMADA 3 — Substantivos vazios

```
jornada (de transformação) · mindset (genérico) · ecossistema (sem objeto)
sinergia · disrupção (sem caso) · gamechanger · unicórnio (genérico)
overdelivery · high-performance · mentalidade vencedora · propósito (headline)
```

---

## CAMADA 4 — Paralelismos forçados proibidos

```
❌ "X diminui, Y acelera"
❌ "Enquanto X perde, Y ganha"
❌ "Menos X, mais Y"
❌ "Antes: X. Agora: Y."
❌ "Sem X, com Y"
```

---

## CAMADA 5 — Aberturas/fechamentos proibidos

**Aberturas:**
- "Hoje vamos falar sobre..."
- "Neste carrossel você vai aprender..."
- "Antes de começar..."
- "Como você provavelmente sabe..."
- "Muitas pessoas perguntam..."
- "Todo mundo já ouviu falar de..."

**Fechamentos:**
- "Continue no próximo →"
- "Swipe para ver mais"
- "Mas tem mais..."
- "Espero que tenha gostado!"
- "Se tiver dúvidas, me manda mensagem"
- "Obrigado por acompanhar"
- "Não esqueça de seguir"
- "Salva e comenta!"
- "Manda pra um amigo"

**Headlines proibidas:**
- "Quando X vira Y"
- "A ascensão de X"
- "O impacto de X"
- "X: o que você precisa saber"
- "Tudo que você precisa saber sobre X"
- "O guia definitivo de X"
- "X mudou para sempre"
- "Virou" como verbo principal
- qualquer abertura com "descubra", "saiba", "conheça"

---

## CAMADA 6 — Emojis decorativos (proibidos)

```
🚀 ✨ 💡 🔥 💪 🎯 ⚡ 🎉 ✅ 👇 👆 ➡️
```

Permitido apenas se substitui palavra (lista numerada `1️⃣ 2️⃣ 3️⃣`) ou é da marca do usuário.

---

## CAMADA 7 — Hashtags proibidas (caption)

```
#empreendedorismo · #mindset · #foco · #disciplina · #propósito · #sucesso
#empreender · #empresario · #motivacional · #motivacao · #vencedor · #superação
#transformação · #evolução · #legado · #atitude
```

Use hashtags **específicas do nicho + tema do post**.

---

## CAMADA 8 — Jargões a evitar

| Jargão | Substituir |
|---|---|
| Ecossistema | sistema, mercado, ambiente |
| Sinergia | integração, colaboração |
| Disruptivo | que quebra com o padrão |
| Stakeholders | envolvidos, partes interessadas |
| Mindset | mentalidade, modo de pensar |
| Engajamento | resultado, alcance |
| Curadoria (genérico) | seleção |
| Storytelling | narrativa |
| Overview | visão geral |
| Benchmark (verbo) | comparar com referências |

---

## CAMADA 9 — Anglicismos numéricos

```
❌ "10+ anos" → "mais de 10 anos"
❌ "5x maior" → "cinco vezes maior"
❌ "24/7" → "24 horas por dia"
❌ "3x mais barato" → "três vezes mais barato"
```

---

## CAMADA 10 — Dados e fontes (sempre exigir 3)

| Preguiçoso | Refazer com |
|---|---|
| "Estudos mostram..." | nomear estudo + ano |
| "Especialistas dizem..." | nomear quem |
| "Muitas empresas..." | número/exemplo |
| "A maioria..." | percentual + amostra |
| "Recentemente..." | data/período |
| "No Brasil..." | dado nacional específico |

**Regra**: número + fonte + ano. Sem os 3 = opinião, marca `[VERIFICAR]`.

---

## CAMADA 11 — Regras gramaticais

1. **Artigos sempre presentes**. "IA muda mercado" → "**A** IA muda **o** mercado".
2. **Conectivos naturais**: porque, só que, por isso, enquanto, mas, aí, então.
3. **Cada bloco soa como parágrafo de reportagem**, não bullet PowerPoint.

---

## 7 PARÂMETROS DE VALIDAÇÃO (mín 8/10 em CADA)

| # | Parâmetro | O que pega |
|---|---|---|
| 1 | **Gramática** | Falta de artigo, concordância, fragmentos. Penalidade máx 7. |
| 2 | **Fluidez** | Texto picotado sem conectivos. Penalidade máx 5. |
| 3 | **AI Slop** | Estruturas binárias, cacoetes, jargão, anglicismos numéricos, verbo-clichê. |
| 4 | **Fatos verificados** | Número sem fonte+ano. Penalidade máx 6. |
| 5 | **Estrutura** | Hook cumprido no deck, slide vazio, anatomia editorial. |
| 6 | **Densidade** | Tira artigos+conectivos+adjetivos: o que sobra precisa ser substância. |
| 7 | **Tom Editorial** | "Folha, não IA traduzindo". Sem 2ª pessoa no corpo, sem metalinguagem. |

---

## 5 TESTES FINAIS (antes de entregar)

1. **Teste da Folha** — soaria num caderno sério?
2. **Teste da substituição** — funciona com qualquer outro sujeito? → genérico, refazer.
3. **Teste da promessa** — todo claim do hook foi cumprido?
4. **Teste do artigo** — todo substantivo tem artigo?
5. **Teste binário** — buscou ativamente por "não é X é Y", "sem X", "menos X", "de forma X"?

---

## Loop de qualidade

```
1. Gera bloco (slide ou caption)
2. Roda CAMADAS 1-11 → se falhar, reescreve trocando termo
3. Roda 7 PARÂMETROS → se < 8, reescreve apontando qual falhou
4. Roda 5 TESTES → se falhar, reescreve com correção específica
5. Repete (1-4) até 8/10+ em todos
6. Tentou 3x e não bateu → mostra ao usuário + pede 1 dado real OU 1 caso OU 1 contraste
```

---

## Self-report obrigatório (ao entregar o texto final)

```
Editorial: 9.1/10
  Gramática 10 · Fluidez 9 · AI Slop 10 · Fatos 8 · Estrutura 9 · Densidade 9 · Tom 9
Testes finais: Folha · Substituição · Promessa · Artigo · Binário — todos OK
```

---

## Customização (avançado)

Aluno avançado adiciona ou remove camadas conforme o tom dele:

- **Mais informal** (perfil de creator pessoa-física): remove CAMADA 8 (jargões) e relaxa CAMADA 11.2 (conectivos podem ser mais casuais: "tipo", "aí", "saca").
- **Mais técnico** (perfil B2B SaaS): adiciona CAMADA 12 — "todo termo técnico explicado na primeira menção".
- **Voz própria**: adiciona CAMADA 13 — "expressões da marca" (lista de 5-10 expressões assinatura do criador) e CAMADA 14 — "expressões proibidas pela marca" (ex: a marca nunca usa "imersão", "metodologia", etc).

Mantém a estrutura: camadas hard-block + 7 params + 5 testes + loop + self-report.
