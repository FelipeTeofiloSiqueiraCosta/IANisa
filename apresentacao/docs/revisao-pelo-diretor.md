# Quem aprova o quê

Atualizado em 01/11/2026, a partir da definição do usuário. Esta regra substitui o comportamento anterior que pedia ao apresentador para simular manualmente cada aprovação do diretor.

| Momento | Responsável pela decisão | Resultado |
| --- | --- | --- |
| Objetivo, regras e critérios | Usuário | Define o que é uma entrega correta |
| Plano e distribuição | Usuário | Confirma antes de criar tarefas |
| Revisão de entrega de agente ou pessoa | Diretor | Confere briefing, cérebro e critérios definidos |
| Entrega correta | Diretor | Aprova, registra o motivo e libera as dependências |
| Entrega divergente | Diretor | Devolve ao responsável com orientação; etapas dependentes continuam bloqueadas |
| Correção entregue | Diretor | Faz uma nova revisão antes de liberar |
| Confirmação adicional ativada no pedido ou rotina | Usuário, depois da revisão do diretor | Confirma o material que passou pelos critérios |
| Falta de definição ou regras alteradas durante a revisão | Usuário consultado pelo diretor | Esclarece o combinado ou devolve para ajuste |

## Interface

A [entrevista inicial](entrevista-e-briefing.md) reúne as informações que faltam e gera os critérios a partir do briefing confirmado e das regras do cérebro. Não se pede ao usuário para informar os mesmos critérios novamente. **Como o diretor vai revisar**, no resumo, permite ativar uma confirmação humana adicional (opcional). No plano, os critérios aparecem para consulta. A configuração acompanha a campanha e suas entregas. Rotinas têm a mesma configuração, preservada nas execuções que já começaram.

**Acompanhar revisão** apresenta o parecer, os critérios conferidos e o motivo da devolução ou liberação. O botão de aprovação humana só aparece quando o diretor realmente solicita essa decisão. A leitura do parecer não aprova nada.

A apresentação guiada demonstra uma entrega com cor fora da paleta, a devolução à Social Media, uma versão corrigida e a aprovação autônoma do diretor. O Videomaker só é liberado após essa aprovação. Os botões conduzem a demonstração; o apresentador não precisa atuar como revisor do diretor.

## Limites da prévia

A conferência é uma simulação com cenários explícitos, sem análise real por IA ou tentativa de avaliar texto por palavras-chave. **Cenário da prévia**, dentro do formulário de entrega, permite demonstrar material correto, divergente ou sem definição suficiente. A aprovação automática representa a experiência pretendida do produto, não uma avaliação confiável de arquivos reais.

Após a aprovação, o resultado entra automaticamente no [conhecimento da TSK](conhecimento-tsk.md), junto do histórico e do contexto da tarefa.

Na implementação do backend, o diretor deverá receber o material, as evidências, o briefing aprovado, os critérios e a versão das regras. O parecer deve conservar autoria, justificativa e histórico de versões. As dependências só podem ser liberadas por resultado aprovado e persistido, de forma idempotente. A preferência por confirmação humana adicional deve ser respeitada pelo serviço, não apenas pelo frontend.

## Validação

`test/director-review.test.mjs` verifica aprovação autônoma, devolução e reenvio, consulta humana opcional, falta de definição, mudança nas regras, retomada sem duplicação, tarefas humanas, rotinas e propagação dos critérios desde o pedido.
