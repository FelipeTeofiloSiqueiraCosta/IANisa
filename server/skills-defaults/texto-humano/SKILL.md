---
name: texto-humano
description: Padrão anti-cara-de-IA (anti "AI slop") para texto em português que vai ser publicado ou falado — roteiro de vídeo, copy de anúncio, post, legenda, e-mail de campanha, landing page, título de aula, script de VSL, bio, thread. Use ANTES de escrever qualquer um deles e para revisar texto pronto que soa como IA ou post de LinkedIn. Traz voz, estruturas proibidas, palavras banidas, regras de ritmo e um checklist final com verificador por script.
---

# Texto humano (anti-cara-de-IA)

Regras canônicas para qualquer texto que vai ser publicado ou falado: roteiro de vídeo,
copy de anúncio, post, legenda, e-mail de campanha, landing page, título de aula.
Vale para conteúdo em português e para qualquer marca ou creator do sistema.

Não vale para código, comentário técnico, documentação interna, resposta de chat comum.

## Voz

Escreva como uma pessoa falando com outra, não como marca falando com público.
Diga a coisa direto, sem preparar o terreno antes.
Use exemplo concreto, nome, número, situação real. Se não tenho o dado, não invento.

Faltou dado? Pergunta ou deixa um marcador visível tipo `[NÚMERO?]`. Número inventado
em texto publicado é erro grave, não licença poética. No resto do sistema esse marcador
é o `[DADO REAL]`, e a regra é a mesma: sem o dado na mão, o texto para ali.

## Estruturas proibidas

- "Não é X, é Y" e todas as variações: "Mais do que X, é Y", "Não se trata de X, e sim de Y",
  "Nunca foi sobre X", "X não é só Y", "Não apenas X, mas também Y"
- Frase isolada de uma linha só pra dar impacto dramático
- Pergunta retórica respondida na linha seguinte
- Lista de três ("rápido, simples e eficiente")
- Falso intervalo ("de pequenos negócios a grandes corporações")
- Dois pontos dramáticos ("E aí apareceu o problema: confiança.")
- Fechar com resumo, moral da história ou frase motivacional

## Palavras e expressões banidas

crucial, fundamental, essencial, robusto, poderoso, transformador, revolucionário,
inovador, otimizar, potencializar, alavancar, desvendar, mergulhar, cenário (figurado),
jornada (figurado), universo (figurado), nos dias de hoje, cada vez mais, vale ressaltar,
é importante destacar, em um mundo onde, no fim das contas, a verdade é que, simples assim,
spoiler, deixa eu te explicar, vamos por partes, e não para por aí, isso muda tudo

## Ritmo

Varie tamanho de frase de verdade. Alterne longa, curta, média.
Parágrafos não podem ter todos o mesmo tamanho.
Nada de lista no formato "Termo em negrito: explicação".
No máximo um travessão no texto inteiro.

## Antes de entregar

1. Leia em voz alta. Se soar como post de LinkedIn, reescreva.
2. Procure "não é" e "mais do que". Achou, vira afirmação direta.
3. Três frases seguidas do mesmo tamanho? Quebre uma.
4. A primeira frase só prepara o assunto? Corta.
5. A última frase só resume o que já foi dito? Corta.

Rodar o verificador ajuda no passo 2 e no travessão, e não substitui a leitura em voz alta:

```bash
.claude/skills/texto-humano/scripts/check-slop.sh arquivo.md
```

Ele grepa palavra banida, padrão "não é X, é Y", travessão em excesso e lista
"**Termo**: explicação". Saída limpa não garante texto bom, só que o óbvio saiu.
Sai 1 se achou algo, então dá pra encadear num portão antes de publicar.

## Como corrigir cada caso

| Escrito assim | Vira isso |
| --- | --- |
| "Não é sobre vender mais, é sobre atender melhor." | "Atender melhor vende mais." |
| "E aí veio o problema: confiança." | "O cliente não confiava no bot." |
| "Você sabe o que trava a operação? Resposta lenta." | "O que trava a operação é resposta lenta." |
| "Rápido, simples e eficiente." | "Responde em 3 segundos." |
| "De pequenos negócios a grandes corporações." | "Loja de bairro e franquia com 40 unidades." |
| "É crucial otimizar sua jornada de atendimento." | "Vale arrumar a fila de atendimento." |

## Onde isto entra no sistema

Todo texto que sai deste sistema para o mundo passa por aqui: o roteiro que a
`capture-reference` adapta, a copy que a `offer-analysis` inspira, a legenda de um
post, a fala que vai virar VSL. A linha editorial do creator manda no QUE dizer;
esta skill manda em COMO a frase é escrita. Quando as duas divergem, a linha
editorial ganha no conteúdo e esta ganha na forma.

## Quando o usuário reclamar que ficou com cara de IA

Não defenda o texto. Aponte a estrutura que causou (quase sempre é uma das proibidas),
reescreve o trecho e mostra as duas versões lado a lado.
