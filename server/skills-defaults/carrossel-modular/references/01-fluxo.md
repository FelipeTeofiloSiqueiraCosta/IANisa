# 01 · Fluxo completo

Módulo lido quando: usuário acabou de escolher modo 1 ou 2 e mandou o insumo.

---

## Briefing rápido (8 perguntas de uma vez — não 1 por 1)

> Antes de criar, preciso de 8 coisas rápidas:
>
> **1. Marca** — nome e @ do Instagram
> **2. Nicho** — ex: marketing digital, fitness, imobiliário, gastronomia, advocacia, tech, e-commerce…
> **3. Cor principal** — hex (`#E8421A`) ou descrição (`laranja vibrante`) ou *"não sei"* que eu sugiro
> **4. Estilo visual** — A) Clássico · B) Moderno · C) Minimalista · D) Bold · E) Outro
> **5. Tipo de carrossel** — A) Tendência interpretada · B) Tese contraintuitiva · C) Case/Benchmark · D) Previsão/Futuro
> **6. CTA do último slide** — ex: "Comenta GUIA", "Me segue", "Manda pra um sócio"
> **7. Slides e imagens** — quantos slides (5/7/9/12) e em quantos deles você quer imagem
> **8. Engine de imagem** — A) Nano Banana Pro *(default, fotorrealismo · `GEMINI_API_KEY`)* · B) gpt-image-2 *(tipografia perfeita · `OPENAI_API_KEY`)* · D) Template base fixo *(consistência visual · usa engine A)*
>
> Se você já configurou em conversa anterior, escreve só *"usa minha config"* que eu puxo.

**Defaults** caso o usuário não responda algum item:
- Estilo: `B) Moderno`
- Tipo: `A) Tendência interpretada`
- Slides: 9, com 1 imagem (a capa)
- Engine: `A) Nano Banana Pro`

---

## Pipeline (bastidor invisível ao usuário)

### Etapa 1 — Triagem silenciosa

Extrai do insumo, sem mostrar ao usuário:
- **Transformação** (do estado X pro estado Y)
- **Fricção central** (o que trava o leitor)
- **Ângulo dominante** (qual aresta cortante puxar)
- **Evidências A/B/C** (dados, casos, contrastes)
- **Eixo** — Mercado · Cases · Notícias · Cultura · Produto
- **Funil** — Topo (educa) · Meio (compara) · Fundo (converte)

### Etapa 2 — 10 headlines

Leia `references/02-headlines.md`. Gera 10 headlines (5 Investigação Cultural + 5 Narrativa Magnética). Apresenta tabela ao usuário e aguarda escolha.

### Etapa 3 — Espinha narrativa

Após escolha da headline, monte a espinha conforme o **tipo de carrossel** escolhido no briefing:

| Tipo | Arco |
|---|---|
| **Tendência interpretada** | Hook → Contexto → Mudança → Impacto → Ação → CTA |
| **Tese contraintuitiva** | Crença comum → Dados que desafiam → Verdade → Novo modelo → Aplicação → CTA |
| **Case/Benchmark** | Resultado → Quem fez → Como → Princípio → Como replicar → CTA |
| **Previsão/Futuro** | Sinais fracos → Padrão → Direção → Quem se posiciona ganha → Ações → CTA |

Apresenta a espinha (1 frase por bloco) e aguarda `aprovado` ou ajuste.

**Como o arco vira slides físicos:** o arco tem 6 blocos conceituais; quando o usuário pediu 9 slides (default), expande pra: Capa (com a headline) + 6 blocos do arco + 2 slides de expansão. Pra 5 slides, comprime fundindo Hook+Contexto e Aplicação+Direção. Veja a tabela "Sequência de slides padrão" no fim deste módulo.

### Etapa 4 — Texto slide a slide

Para cada slide do arco, escreva o conteúdo respeitando a anatomia editorial:
- **Capa**: headline pura. Sem sub-headline.
- **Slides internos**: 1 ideia por slide. Máximo 3 níveis de hierarquia (âncora, contexto, metadata).
- **CTA final**: 1 ação clara + handle.

Roda **validação editorial** (leia `references/03-editorial.md`) — mín 8/10 em todos os 7 params. Se < 8, reescreve até 3x.

### Etapa 5 — Apresentação do texto

Mostra o texto de cada slide num bloco:

```
**SLIDE 1 (Capa)**
[Headline]

**SLIDE 2 (Hook)**
[Texto]

...

**SLIDE 9 (CTA)**
[Texto]
[Handle]
```

Pede: *"ajusta o slide [N]"* ou *"aprovado"*.

### Etapa 6 — Self-report

Mostra ao usuário:

```
Editorial: 9.1/10
  Gramática 10 · Fluidez 9 · AI Slop 10 · Fatos 8 · Estrutura 9 · Densidade 9 · Tom 9
Testes finais: Folha · Substituição · Promessa · Artigo · Binário — todos OK
```

### Etapa 7 — Render

Roda o engine escolhido. Leia o módulo correspondente:
- A → `references/05-render-nano-banana-pro.md`
- B/C/E → `references/06-render-alternativas.md`
- D → `references/07-templates-visuais.md`

### Etapa 8 — Caption

Leia `references/08-caption-hashtag.md`. Gera caption + 5-12 hashtags. Entrega.

---

## Defaults por nicho (paleta inicial)

Se o usuário disser "não sei" na cor, use a paleta do nicho (detalhe em `references/04-design-system.md`):

| Nicho | Primária |
|---|---|
| Marketing Digital | `#E8421A` |
| Imobiliário | `#1B2A4A` |
| Fitness/Saúde | `#1A1A2E` |
| Gastronomia | `#2C1810` |
| Moda/Beleza | `#1C1C1C` |
| Educação | `#1B3A4B` |
| Tech/SaaS | `#0A192F` |
| Advocacia | `#1A1A2E` |
| Contabilidade | `#1C2541` |
| E-commerce | `#1A1A1A` |
| Pet/Veterinária | `#2D3436` |

Tabela completa (accent, fundos, fonte) em `references/04-design-system.md`.

---

## Sequência de slides padrão

| Slides | Sequência |
|---|---|
| 5 | Capa → Hook → Prova → Aplicação → CTA |
| 7 | Capa → Hook → Contexto → Mecanismo → Prova → Direção → CTA |
| **9 (default)** | Capa → Hook → Contexto → Mecanismo → Prova → Expansão → Aplicação → Direção → CTA |
| 12 | 9 + 3 expansões alternando |

---

## Regra de ouro do fluxo

Cada etapa termina com **1 input específico pedido**. Você **não pergunta nada novo até receber esse input**. Se o usuário pular, repete a pergunta mínima da etapa atual sem reclamar.
