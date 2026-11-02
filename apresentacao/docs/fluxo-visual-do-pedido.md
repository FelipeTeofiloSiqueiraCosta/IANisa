# Do pedido ao time trabalhando

Atualizado em 01/11/2026. Implementação visual no preview local do Marketing, independente de `codigo-beta/`.

## Experiência do usuário

Para demonstrar esta experiência com foco da câmera, explicações e formulários preenchidos, use o [modo de apresentação guiada](apresentacao-guiada.md), acessível pelo botão **Apresentar**.

1. O usuário clica em **Novo pedido**, ou no avatar **Você**, e descreve o objetivo. A [entrevista inicial](entrevista-e-briefing.md) pergunta somente os detalhes faltantes. O usuário confere o resumo e confirma o briefing antes do envio; os critérios de revisão vêm dessa conversa.
2. O pedido sai do avatar do usuário e segue para o diretor como um pequeno envelope animado. O usuário aparece como solicitante; não recebe uma tarefa de execução por causa do envio.
3. O diretor recebe o pedido. A interface registra o recebimento e mostra que nenhuma tarefa foi distribuída ainda.
4. O diretor consulta o cérebro. O contexto e as regras da empresa aparecem como referência da preparação.
5. O diretor prepara o plano: entregas, responsáveis e dependências. Uma indicação de planejamento acompanha o personagem no 3D.
6. A interface aguarda a aprovação do usuário. **Ver e aprovar plano** abre as entregas propostas, responsáveis humanos ou agentes e a ordem de dependências. **Ajustar plano** abre a edição detalhada na Direção.
7. Depois da confirmação, o diretor envia as tarefas a cada responsável. A animação destaca um recebimento por vez; o contador e o histórico registram o andamento.
8. Os agentes trabalham nas tarefas liberadas. Tarefas que precisam de outra entrega continuam aguardando. Pessoas recebem a tarefa e podem confirmar **Começar tarefa**.
9. **Ver tarefas** permite abrir cada conversa. O clique em um integrante do escritório destaca a tarefa deste pedido em seus detalhes. As entregas passam pela revisão automática do diretor: se corretas, são aprovadas; se divergentes, voltam ao responsável. A confirmação humana adicional é opcional, conforme a [regra de revisão](revisao-pelo-diretor.md).

## Clareza visual

- Os antigos cartões grandes do 3D foram substituídos por rótulos compactos. Os detalhes continuam disponíveis por hover, foco de teclado e clique.
- No celular, agentes e pessoas aparecem como marcadores com avatar. O integrante focado, selecionado ou recebendo uma tarefa expande sua identificação, preservando a visão dos modelos.
- Direção, cérebro e rotinas aparecem como atalhos pequenos acima do escritório, preservando espaço para os personagens.
- Durante a distribuição e o acompanhamento, os indicadores no 3D representam **este pedido**. Um trabalho antigo não faz uma tarefa nova bloqueada parecer em execução.
- Tarefas ainda a caminho ficam atenuadas; recebidas aparecem com seu estado. Monitores e indicadores animados acompanham a execução. Bloqueios e tarefas humanas recebidas permanecem estáticos.
- A apresentação permite pausar, continuar e avançar uma etapa por vez. A preferência de movimento reduzido mantém os estados e o acompanhamento, com trajetos estáticos.
- Depois da distribuição, **Recolher acompanhamento** guarda a apresentação em uma linha compacta e devolve ao escritório os indicadores gerais do time. **Ver acompanhamento** retoma o contexto do pedido, sem criar ou duplicar tarefas.

## Estado e persistência

O pedido em apresentação fica em `officeJourney`, com identificador, briefing, fase, horários, histórico, campanha associada e lista de recebimentos. O plano só é criado ao concluir a preparação; as sessões só são criadas depois da aprovação explícita. A distribuição anima os recebimentos sem criar novas sessões a cada quadro ou evento.

Recarregar a página preserva o ponto de apresentação e os recebimentos já registrados. A aprovação continua sujeita às regras do cérebro: se a base mudar, o planejamento precisa ser atualizado antes de distribuir.

Um pedido novo pode substituir a apresentação de um plano já pronto ou de uma campanha em execução. Os planos e as sessões anteriores continuam disponíveis na Direção e nas Conversas. Durante as breves etapas de preparação e distribuição, a interface solicita aguardar o pedido atual.

## Limite do preview

O fluxo é uma simulação de frontend. “Consultar”, “planejar” e “enviar” ilustram a experiência do produto, sem executar raciocínio de uma IA real, chamar ferramentas ou enviar trabalho a usuários externos. As sessões e as aprovações são registros locais no navegador. A execução multiusuário e o agendamento real seguem como escopo do backend futuro.

## Verificação

`test/journey.test.mjs` cobre a criação tardia do plano, a aprovação obrigatória, o recebimento sem duplicação, a preservação das dependências e das tarefas humanas, a atualização do cérebro, a pausa, a retomada, a persistência e a reabertura de planos anteriores. Execute `npm test` e `npm run build`.
