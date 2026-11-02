# Conhecimento organizado por TSK

Atualizado em 01/11/2026, após o esclarecimento do usuário. Esta definição substitui a regra anterior de guardar apenas aprendizados selecionados manualmente.

## Regra do produto

O diretor consulta as referências da organização para planejar. O trabalho de cada tarefa fica reunido em sua pasta **TSK**: entrevista, briefing, planejamento, textos, dados, conversas, anotações, colaboração e versões entregues.

Quando uma entrega é aprovada, seu resultado fica **automaticamente disponível na base de conhecimento, dentro da TSK de origem**. Não existe outra etapa obrigatória de copiar o resultado ou decidir salvá-lo. O diretor pode voltar à pasta para consultar a informação, entender o contexto e usar o resultado aprovado como referência.

Rascunhos, versões devolvidas e notas continuam registrados na pasta, com seu estado. O selo **resultado aprovado** identifica o material que passou pela revisão. A pasta conserva o histórico de como se chegou ao resultado.

## Estrutura demonstrada

```text
Base de conhecimento
├── Regras da organização
│   ├── Identidade e marca
│   ├── Tom de voz
│   └── Contexto e orientações
└── TSK
    └── pedido / tarefa
        ├── briefing.md
        ├── entrevista.md
        ├── planejamento.md
        ├── textos-e-conversa.md
        ├── dados.json
        ├── anotacoes.md
        ├── colaboracao.md
        ├── conversa-com-diretor.md
        ├── entrega-em-revisao.md
        ├── revisoes.md
        ├── resultados / versao-1.md
        └── resultado-aprovado.md
```

Tarefas pontuais ficam em `TSK/<tarefa>/`. Tarefas de campanha compartilham o agrupamento `TSK/<pedido>/<tarefa>/`. Rotinas ficam em `TSK/rotinas/<rotina>/<período>/`, mantendo o vínculo com a execução e o dia corretos.

## Interface

Em **Cérebro**, há duas áreas: **Regras da organização** e **TSK · tarefas e resultados**. É possível pesquisar, filtrar resultados aprovados ou todas as tarefas e abrir uma pasta com seus arquivos. O resumo de cada sessão também oferece acesso à TSK.

O resultado aprovado recebe um selo de disponibilidade para consulta do diretor. O plano conserva as referências de resultados anteriores da TSK consultados no cenário do preview. A apresentação guiada termina mostrando a aprovação e a pasta preenchida, sem uma segunda confirmação para guardar conhecimento.

## Persistência e limites da prévia

As pastas são uma visualização dos registros já persistidos no navegador. Conversas, notas e dados são lidos dos registros da própria tarefa; a interface não mantém uma cópia divergente. A aprovação cria uma versão preservada do resultado, com origem e parecer. Retomar a página não duplica essa publicação.

A publicação na TSK não altera as regras oficiais nem a revisão do cérebro da organização. Um resultado aprovado não substitui a paleta, o tom de voz ou outra diretriz cadastrada.

O preview não cria arquivos reais na VPS, não executa um agente e não faz busca semântica por IA. A consulta demonstrativa encontra resultados aprovados por termos relacionados ao pedido e conserva sua origem. No backend, a TSK deverá ser persistente, ter controle de acesso, versões e indexação dos materiais, com publicação idempotente depois da revisão.

## Implementação e verificação

- `src/task-knowledge.js`: publicação automática, versões aprovadas, catálogo de pastas, arquivos e consulta com origem.
- `src/task-knowledge-ui.js`: índice pesquisável, filtros e visualização dos arquivos.
- `test/task-knowledge.test.mjs`: conteúdo da pasta, aprovação automática, preservação de versões, ausência de duplicação, consulta do diretor, confirmação humana opcional e rotinas.

`codigo-beta/` continua como referência, sem alterações.
