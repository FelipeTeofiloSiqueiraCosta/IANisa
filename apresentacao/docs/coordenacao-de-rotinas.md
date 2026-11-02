# Coordenação de rotinas e dependências

Registro de decisões do projeto IANiza · atualizado em 01/11/2026.

Este documento consolida o [complemento recebido](complemento-rotinas-original.md) e sua aplicação ao preview. O escopo atual é o setor de Marketing, com pessoas e agentes configuráveis. `codigo-beta/` permanece como referência, sem alterações.

## O que ficou decidido

1. **Rotina e execução são coisas diferentes.** A rotina descreve o trabalho recorrente. Cada data ou período gera uma execução independente, com identificador estável, responsável, horário, fuso, briefing, histórico, dependências e resultados próprios.
2. **O diretor coordena e revisa.** O usuário apresenta o objetivo; o diretor consulta o cérebro, apresenta o plano e distribui após a confirmação. Entregas de pessoas e agentes passam pela revisão.
3. **Entregar não libera o resultado.** O material entra como entrega pendente. Só após a aprovação ele fica disponível como insumo autorizado.
4. **A regra padrão é o mesmo período.** O roteiro de 02/11 utiliza a pesquisa aprovada de 02/11. Um resultado antigo não substitui silenciosamente a entrega necessária. A exceção “último resultado aprovado disponível” exige configuração explícita do diretor e não pode apontar para um período futuro.
5. **Todas as dependências obrigatórias precisam ser atendidas.** A aprovação reavalia automaticamente as execuções dependentes. A etapa liberada fica pronta para começar; liberação e início são estados diferentes.
6. **Trabalhos independentes podem acontecer em paralelo.** Uma tarefa que precisa de duas entradas aguarda as duas. Configurações com ciclos de dependência são rejeitadas antes de salvar.
7. **Falhas e bloqueios têm motivos visíveis.** Rejeição, correção, falha e cancelamento não liberam entregas. O diretor pode consultar a ocorrência, reorganizar as rotinas e solicitar uma nova tentativa, preservando o histórico.
8. **O registro estruturado coordena o trabalho.** Agentes consultam o andamento, os responsáveis e as referências dos resultados. O chat complementa a colaboração; uma mensagem dizendo “terminei” não substitui a aprovação oficial.
9. **Conhecimento com origem na TSK.** O histórico de cada execução fica na sua TSK. O resultado aprovado entra automaticamente na base, vinculado à execução e ao período. O diretor pode consultá-lo com seu contexto.
10. **Mudanças preservam o trabalho iniciado.** O preview aplica novas configurações às execuções que ainda não começaram. As já iniciadas mantêm o briefing e as dependências que receberam.

## Estados da execução

| Estado | Significado | Resultado disponível? |
| --- | --- | --- |
| `scheduled` | Aguardando data e horário | Não |
| `waiting_dependency` | Aguardando entregas obrigatórias aprovadas | Não |
| `ready` | Horário e dependências atendidos | Não |
| `in_progress` | Responsável trabalhando | Não |
| `in_review` | Entrega pendente na revisão do diretor | Não |
| `changes_requested` | Responsável precisa corrigir | Não |
| `approved` | Revisão concluída e resultado publicado | Sim, com referência da execução |
| `failed` | Falha registrada para o diretor | Não |
| `cancelled` | Execução cancelada, com motivo | Não |

O status operacional e a disponibilidade do resultado são campos separados. A liberação verifica a aprovação e a existência de um resultado publicado vinculado à execução correta.

## Como demonstrar no preview

Abra **Rotinas → Execuções de hoje**, ou diretamente [o painel local](http://127.0.0.1:4173/#rotinas).

- Cadeia principal: pesquisa de tendências → roteiro → preparação da publicação.
- A pesquisa começa com uma entrega pendente. O roteiro aguarda, mesmo existindo uma pesquisa aprovada de ontem.
- Design e edição humana estão em andamento ao mesmo tempo, demonstrando paralelismo.
- A página da campanha precisa de **duas** entregas aprovadas: publicação e visual.
- A análise de anúncios apresenta uma falha de conexão ilustrativa, com motivo e opção de nova tentativa.
- Datas anteriores e posteriores têm execuções e históricos próprios.
- O botão **Como apresentar** exibe um roteiro guiado que acompanha a evolução da cadeia.
- Cada tarefa abre dependências, responsável, resultado, disponibilidade e histórico. Os resultados aprovados têm uma referência de workspace ilustrativa.
- **Nova rotina** permite escolher responsável, horário, objetivo, várias dependências e regra de período.
- A direção possui um acesso às revisões de rotinas; o escritório também mostra um resumo do dia.
- No escritório 3D, os cartões indicam a quantidade de rotinas de cada integrante. Seus detalhes oferecem acesso às execuções do dia. Indicadores e monitores animados identificam quem está trabalhando; a preferência de movimento reduzido é respeitada.

Veja o [roteiro para apresentar aos gestores](roteiro-apresentacao.md).

## O que está implementado e o que é simulado

O preview implementa as regras de estado, as verificações de dependência, os identificadores por data, a separação entre entrega pendente e resultado liberado, a rejeição de ciclos e o histórico. Esses dados ficam no `localStorage`, preservando os integrantes e as conversas existentes.

É uma demonstração de frontend: não executa agentes reais, não faz revisão por IA, não conecta serviços, não publica conteúdo e não escreve os arquivos exibidos no workspace. O cenário usa **09h, no fuso America/Sao_Paulo**, para permitir uma apresentação previsível. Executar ou avançar etapas depende das ações de simulação na interface; não há um agendador em segundo plano.

As rotinas recorrentes e as campanhas pontuais têm registros separados neste preview. A direção reúne os acessos às duas áreas; a unificação das sessões e notificações reais pertence à implementação do backend.

## Contrato para o backend futuro

- Manter rotinas, versões, execuções, responsáveis, dependências, revisões, eventos e resultados em armazenamento transacional.
- Garantir unicidade da execução por rotina e período operacional; gerar as datas no fuso da rotina e tratar concorrência, atrasos e reinícios do serviço.
- Publicar arquivos apenas no diretório autorizado, com referência à execução, revisão e versão do resultado. Os arquivos são a representação do workspace; o banco é o registro oficial.
- Aprovação, publicação do resultado e reavaliação das dependências precisam de transações e operações idempotentes. Usar eventos persistentes para notificar agentes sem liberar duas vezes uma execução.
- Conferir todas as entradas antes de iniciar, incluindo autorização, período, aprovação e disponibilidade dos arquivos.
- Conservar no contexto da execução as referências exatas dos resultados consumidos; mudanças posteriores não podem trocar um insumo silenciosamente.
- Definir políticas de repetição, timeout, atraso, cancelamento e exceções de período, mantendo motivos e trilha de auditoria.
- Definir o mapeamento de períodos quando rotinas usarem fusos ou frequências diferentes. O preview atual demonstra rotinas diárias em um único fuso.
- Conectar execuções às sessões reais de pessoas e agentes, às ferramentas autorizadas e às notificações do diretor.

## Critérios e evidências

| Critério do complemento | Evidência no preview |
| --- | --- |
| Execuções independentes por período | Navegação entre datas; IDs e históricos próprios |
| Status próprio por execução | Lista, cartões e detalhes |
| Dependências entre agentes | Cadeia de três etapas e página com duas entradas |
| Consulta do andamento e responsáveis | Detalhes das dependências, com acesso à execução de origem |
| Resultados somente após aprovação | Entrega pendente separada do resultado publicado |
| Liberação automática | Aprovar a pesquisa torna o roteiro pronto |
| Proteção contra mistura de dias | Regra padrão do mesmo dia e exceção explícita |
| Dependências múltiplas | Página aguarda publicação e visual |
| Trabalho paralelo | Design e edição em execução simultânea |
| Falhas e bloqueios visíveis | Ocorrências, motivo e histórico |
| Coordenação demonstrável | Painel do dia, guia e ações de simulação |

Os testes de `test/routines.test.mjs` cobrem essas regras, incluindo transições, múltiplas entradas, calendário, exceções, falhas, ciclos e preservação dos dados anteriores. Execute `npm test`.

## Responsabilidade pela aprovação

O usuário define os critérios; o diretor revisa as entregas de pessoas e agentes, aprova as corretas e devolve as divergentes. A confirmação humana é adicional e opcional, ou solicitada quando falta uma definição. O preview simula essa revisão automaticamente. Esta definição atualiza a antiga demonstração manual. Consulte [Quem aprova o quê](revisao-pelo-diretor.md).

## Resultados na TSK

Conforme o esclarecimento do usuário, resultados aprovados ficam automaticamente no conhecimento da pasta TSK. Textos, dados, anotações e histórico continuam na mesma pasta. Consulte [Conhecimento organizado por TSK](conhecimento-tsk.md).
