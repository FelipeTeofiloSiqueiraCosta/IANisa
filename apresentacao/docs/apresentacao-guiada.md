# Apresentação guiada do Marketing

Atualizado em 01/11/2026. Este modo foi criado para apresentar o projeto a pessoas não técnicas, com a câmera mostrando cada objeto e exemplos que dispensam digitação.

## Como começar

Abra o preview e clique em **Apresentar**. O roteiro começa com uma visão do escritório. Use os botões para avançar no seu ritmo; não é necessário preencher os formulários manualmente.

## O que o roteiro mostra

1. O usuário que envia o objetivo, o diretor que coordena e o cérebro com as regras da empresa.
2. Cada integrante configurado no time, com aproximação da câmera, explicação da função, ferramentas e habilidades.
3. Uma entrevista com pedido e respostas de exemplo já preenchidos. O assistente pergunta só os detalhes faltantes e gera um briefing para conferência antes de enviá-lo ao diretor.
4. O envio do pedido, o recebimento pelo diretor, a consulta ao cérebro e a preparação do plano.
5. A revisão do plano e a confirmação explícita de **Aprovar e distribuir**.
6. O envio para cada responsável. A câmera acompanha o trajeto e depois foca quem recebeu; a legenda explica se a tarefa pode começar, depende de outra entrega ou deve ser iniciada por uma pessoa.
7. Uma pessoa confirmando o início da tarefa, o trabalho em paralelo e uma dependência entre agentes.
8. Uma entrega de exemplo já escrita, enviada para a revisão do diretor.
9. O diretor revisando sozinho, identificando uma cor fora da paleta e devolvendo ao responsável com uma orientação. A entrega corrigida volta ao diretor e é aprovada automaticamente, sem confirmação humana em cada etapa.
10. A liberação da próxima tarefa e o resultado automaticamente disponível no conhecimento da pasta TSK, com briefing, plano, textos, dados, anotações e revisões.

Com os oito integrantes iniciais, são 32 etapas. A quantidade de apresentações de pessoas e agentes acompanha o time configurado. Os recebimentos da distribuição são mostrados um por vez dentro de uma mesma etapa.

## Controles e enquadramento

- **Próximo passo** avança o roteiro. Nas etapas de formulário, ele abre a tela que já contém o exemplo.
- **Voltar** permite rever as apresentações iniciais sem criar tarefas.
- Clicar em um objeto no 3D abre sua explicação no roteiro. **Voltar ao roteiro** retoma a etapa que estava sendo demonstrada.
- A câmera aproxima o usuário, o diretor, o cérebro ou o integrante correspondente. Quando a relação entre dois objetos é relevante, ambos são enquadrados.
- A distribuição espera o clique para enviar ao próximo responsável, permitindo explicar cada recebimento.
- **Ouvir** lê a explicação quando o navegador oferece síntese de voz; as legendas permanecem como referência principal.
- **Sair** encerra o modo guiado. Ao final, **Recomeçar** permite repetir a apresentação.
- Movimento reduzido é respeitado: os enquadramentos ficam imediatos e os estados continuam visíveis.

## Preservação dos dados

A apresentação usa uma cópia do escritório atual. Pessoas, funções, ferramentas e conhecimentos aparecem como configurados, mas as tarefas, aprovações e aprendizados da demonstração ficam separados dos pedidos originais.

O progresso é salvo em uma chave própria de armazenamento do navegador, `ianiza:marketing-preview:v1:guided-presentation`. Recarregar a página retoma a apresentação; sair restaura o escritório original. Recomeçar cria outra cópia, sem acumular as tarefas de demonstração no escritório real do preview.

Formulários preenchidos automaticamente e confirmações por clique ficam restritos ao modo de apresentação. O uso normal continua permitindo escrever pedidos e revisar os campos manualmente.

## Implementação e validação

- `src/presentation.js`: cópia isolada, roteiro por integrante, seleção de tarefas demonstráveis, exemplos e persistência separada.
- `src/presentation-ui.js`: legendas, controles, preenchimento de formulários, progressão e integração com os fluxos existentes.
- `src/office.js`: enquadramentos animados, foco em um ou dois objetos e destaque dos participantes.

Os modelos de planejamento, aprovação, dependência e curadoria continuam sendo os mesmos utilizados pelo restante do preview. O usuário confirma o plano; as entregas são conferidas pelo diretor em uma simulação automática. Uma confirmação humana adicional só aparece se configurada ou faltar uma definição. Não há IA ou serviços reais. Veja a [regra de revisão pelo diretor](revisao-pelo-diretor.md).

Os testes de `test/presentation.test.mjs` conferem isolamento dos dados, persistência separada, inclusão de funções personalizadas, seleção de uma tarefa liberada e retomada de etapas. A verificação na interface percorreu o roteiro completo apenas por cliques e confirmou a restauração dos números e conhecimentos originais ao sair.

A [entrevista e o briefing](entrevista-e-briefing.md) substituem a antiga criação por formulário. Não existe uma pergunta adicional sobre o que define uma boa entrega: esses critérios já vêm da conversa. Na etapa de memória, **Abrir pasta TSK** mostra que o resultado aprovado já entrou na base. **Concluir apresentação** avança sem um salvamento manual.

A [regra de conhecimento por TSK](conhecimento-tsk.md) é a definição atual: cada resultado aprovado fica automaticamente disponível na sua pasta de origem.
