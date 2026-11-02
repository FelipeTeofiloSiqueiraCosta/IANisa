Complemento — Coordenação de Rotinas e Dependências entre Agentes

1. Objetivo

Implementar um mecanismo de coordenação entre agentes que executam tarefas recorrentes, permitindo que uma rotina dependa dos resultados produzidos por outra.

Cada execução de rotina deverá possuir seu próprio status, histórico, responsáveis, resultados e dependências.

O sistema deverá identificar automaticamente quando uma tarefa dependente pode começar.

2. Status das tarefas do dia

Cada rotina deverá gerar uma instância de execução para a data ou período correspondente.

Uma rotina configurada para executar diariamente não deverá utilizar apenas um status global.

Por exemplo:

Rotina: Produção diária de conteúdo

* Execução de 01/11/2026: concluída.
* Execução de 02/11/2026: agendada.
* Execução de 03/11/2026: agendada.

Cada execução deverá possuir estados independentes:

* scheduled — Agendada.
* waiting_dependency — Aguardando outra tarefa.
* ready — Pronta para execução.
* in_progress — Em execução.
* in_review — Aguardando aprovação do diretor.
* changes_requested — Aguardando correções.
* approved — Resultado aprovado e disponível.
* failed — Execução com falha.
* cancelled — Execução cancelada.

É importante distinguir o status operacional da tarefa da disponibilidade do resultado aprovado.

3. Dependências entre rotinas

O usuário ou o diretor poderá configurar que uma rotina depende de outra.

Exemplo:

Rotina A — Agente de Tendências

Todos os dias, às 8h:
Pesquisar cinco tendências relevantes de inteligência artificial e produzir um relatório.

Rotina B — Agente Copywriter

Todos os dias:
Utilizar o relatório aprovado da Rotina A para produzir um roteiro de vídeo.

Rotina C — Agente Social Media

Todos os dias:
Utilizar o roteiro aprovado da Rotina B para preparar o conteúdo da publicação.

A execução da Rotina B deverá aguardar o resultado aprovado da Rotina A correspondente ao mesmo dia.

A Rotina C deverá aguardar a aprovação do resultado da Rotina B.

4. Comunicação e compartilhamento de resultados

Os agentes deverão conseguir identificar quando os resultados de suas dependências estiverem disponíveis.

Essa comunicação não deve depender exclusivamente de mensagens de chat entre agentes.

O sistema deverá disponibilizar mecanismos estruturados para:

* Consultar o status de tarefas dependentes.
* Identificar quais agentes são responsáveis.
* Receber notificações quando uma dependência mudar de estado.
* Localizar os arquivos e resultados aprovados.
* Consultar o contexto necessário para continuar a execução.
* Reportar bloqueios ou inconsistências ao diretor.

A comunicação direta entre agentes poderá existir, mas o estado oficial das tarefas deverá ser mantido por um mecanismo centralizado e persistente.

5. Liberação automática de tarefas dependentes

Quando o Agente 1 finalizar sua tarefa:

1. O resultado é salvo como uma entrega pendente.
2. O diretor recebe a entrega para avaliação.
3. O diretor aprova ou solicita ajustes.
4. Caso aprovado, o sistema publica o resultado no diretório autorizado.
5. O sistema identifica as tarefas dependentes daquela execução.
6. Verifica se todas as dependências obrigatórias foram satisfeitas.
7. Libera as tarefas que estiverem prontas.
8. Os agentes responsáveis recebem as referências dos resultados necessários.

Se uma dependência falhar, atrasar ou for rejeitada, a tarefa seguinte deverá permanecer bloqueada, com o motivo visível.

6. Associação correta das execuções

Uma tarefa diária não poderá consumir automaticamente um resultado de outro dia apenas porque ele é o mais recente disponível.

Por padrão, as dependências deverão ser vinculadas à execução do mesmo período operacional.

Exemplo:

O copywriter que produz o conteúdo de 02/11 deverá utilizar o relatório de tendências de 02/11, e não o relatório do dia anterior.

O diretor poderá configurar exceções, como utilizar o último resultado aprovado disponível, quando isso fizer sentido.

As execuções deverão possuir identificadores estáveis e considerar o fuso horário definido para a rotina.

7. Execução em paralelo

O sistema deverá identificar tarefas independentes que possam ser executadas simultaneamente.

Quando uma tarefa depender de múltiplos agentes, deverá aguardar todas as entregas obrigatórias.

O diretor poderá reorganizar dependências quando necessário, evitando ciclos de dependência e tarefas permanentemente bloqueadas.

8. Estrutura de armazenamento

Cada execução diária deverá ter seus próprios documentos e resultados.

rotinas/
├── pesquisa-tendencias/
│   └── execucoes/
│       └── 2026-11-02/
│           ├── task.md
│           ├── status.json
│           └── resultados/
│               └── tendencias.md
│
├── criacao-roteiro/
│   └── execucoes/
│       └── 2026-11-02/
│           ├── task.md
│           ├── status.json
│           └── resultados/
│               └── roteiro.md
│
└── preparacao-publicacao/
    └── execucoes/
        └── 2026-11-02/
            ├── task.md
            ├── status.json
            └── resultados/

Esses arquivos representam o workspace. O backend deverá manter os estados oficiais, relacionamentos e dependências em armazenamento transacional, evitando inconsistências entre agentes.

9. Preview UI/UX

O preview deverá apresentar um painel chamado Execuções de Hoje, onde o usuário possa visualizar:

* Quais agentes possuem tarefas programadas.
* Quais tarefas já começaram.
* Quais dependem de outras.
* Quais aguardam aprovação.
* Quais resultados já foram liberados.
* Quais agentes estão trabalhando simultaneamente.
* Quais tarefas estão bloqueadas e por quê.

Ao clicar em uma tarefa, o usuário deverá conseguir visualizar suas dependências, resultados e histórico.

10. Critérios de aceitação

* [ ]	Cada rotina gera execuções independentes por período.
* [ ]	Cada execução possui seu próprio status.
* [ ]	O sistema identifica dependências entre agentes.
* [ ]	Um agente pode consultar o status de uma tarefa da qual depende.
* [ ]	Resultados são disponibilizados após aprovação.
* [ ]	Tarefas dependentes são liberadas automaticamente.
* [ ]	Resultados de dias diferentes não são misturados indevidamente.
* [ ]	Dependências podem envolver múltiplos agentes.
* [ ]	Tarefas independentes podem ser executadas em paralelo.
* [ ]	Falhas e bloqueios são apresentados ao diretor.
* [ ]	O preview demonstra visualmente toda a coordenação.