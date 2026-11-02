# Entrevista antes da tarefa

Atualizado em 01/11/2026, conforme a explicação do usuário. Antes de enviar uma tarefa ao diretor, o solicitante passa por uma conversa para completar o briefing. A antiga pergunta isolada **“O que define uma boa entrega?”** foi removida da criação de pedidos e do planejamento: os critérios são obtidos do que já foi combinado.

## Caminho completo

1. **Pedido inicial:** o usuário conta o que precisa, com suas próprias palavras.
2. **Entrevista:** o assistente de briefing aproveita as informações explícitas do pedido e pergunta apenas os pontos faltantes: público, entregas e formatos, canais, prazo, oferta (quando é uma campanha) e materiais de referência.
3. **Resumo para conferência:** mostra o pedido, cada resposta e sua origem. O usuário pode editar um ponto sem repetir a conversa. As regras cadastradas no cérebro acompanham o briefing.
4. **Confirmação do briefing:** só neste momento o pedido segue para o diretor. A entrevista não cria sessões ou tarefas de execução.
5. **Diretor recebe e planeja:** usa as respostas e as regras para preparar entregas, responsáveis e dependências.
6. **Confirmação do plano:** o usuário confere a distribuição antes de o time receber tarefas.
7. **Trabalho e revisão:** pessoas e agentes executam; o diretor confere o resultado com o briefing confirmado. Se precisar, devolve para correção; se estiver correto, aprova e libera as próximas etapas.
8. **Resultado e conhecimento:** o histórico fica na pasta TSK. Ao aprovar, o diretor disponibiliza o resultado automaticamente no conhecimento da TSK de origem; ele pode consultar essa pasta depois, sem outra confirmação de salvamento.

A confirmação humana adicional de entregas permanece opcional, dentro de **Como o diretor vai revisar**. Ela não pede ao usuário para redigitar os critérios.

## Pedido completo ou incompleto

Se os detalhes já foram informados, a entrevista passa diretamente ao resumo. Informações extraídas do pedido aparecem como **Já informado no pedido**; respostas aparecem como **Combinado na entrevista**. Quem não conhece o prazo ou a oferta pode declarar isso explicitamente e solicitar uma proposta no planejamento. O preview não inventa datas, descontos ou preços.

Uma solicitação explícita de edição de vídeo é tratada como entrega específica para o editor configurado. Ela não gera automaticamente uma campanha para os oito integrantes nem pergunta sobre uma oferta comercial.

## Apresentação

O modo **Apresentar** contém as etapas **Antes da tarefa, uma conversa**, **A entrevista completa o que falta** e **Da conversa para um briefing claro**. As respostas de exemplo já estão preenchidas; os botões permitem demonstrar o caminho sem digitar. A entrevista e a conferência precedem a animação de envio ao diretor.

Com oito integrantes, o roteiro tem 32 etapas. As perguntas aparecem dentro da mesma etapa de entrevista. **Continuar depois** salva o rascunho. Reabrir o pedido ou retomar a apresentação recupera as respostas e a pergunta pendente. O modo de apresentação usa uma cópia, sem reutilizar ou alterar um rascunho original do usuário.

## Registros e implementação

- `src/intake.js`: campos, aproveitamento de informações explícitas, perguntas faltantes, resumo, critérios derivados e confirmação.
- `src/intake-ui.js`: conversa, respostas de exemplo, edição pontual, transcrição e envio.
- `intakeDraft`: rascunho local, separado da campanha.
- `officeJourney.intake` e `campaign.intake`: cópias do briefing confirmado e da transcrição. As sessões recebem o briefing e os critérios.
- `test/intake.test.mjs`: bloqueio de envio incompleto, ausência de perguntas duplicadas, edição, retomada, isolamento, seleção do editor e propagação do contexto.

Este é um protótipo de frontend. A extração usa padrões explícitos e conservadores; não há uma IA interpretando qualquer texto livre. O resumo existe para o usuário conferir o que foi reconhecido. A implementação futura deverá interpretar respostas, identificar contradições e pedir esclarecimentos antes de confirmar o briefing.

Esta definição complementa [Quem aprova o quê](revisao-pelo-diretor.md).

O esclarecimento posterior do usuário definiu o [conhecimento organizado por TSK](conhecimento-tsk.md), substituindo a seleção manual como requisito para guardar resultados aprovados.
