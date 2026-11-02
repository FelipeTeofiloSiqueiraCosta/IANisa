# Entrevista da marca e cérebro

A skill enviada pelo usuário está preservada em `server/prompts/extrator-de-marca.md`. Seu roteiro é adaptado à aplicação: primeiro conexão da conta, depois conversa, resumo e confirmação. As instruções de criar arquivos no computador do aluno foram adaptadas ao armazenamento privado por organização. Nenhuma instrução do documento foi tratada como pedido para entrevistar o usuário deste chat ou modificar o código beta.

## Conexão real

A base usa `@agentclientprotocol/sdk` com `claude-agent-acp` e `codex-acp`. Os mesmos pacotes e versões foram instalados na raiz, com implementação própria do cliente ACP em `server/ai-runtime.mjs`. Referências consultadas: `codigo-beta/agentes/servidor.mjs`, `agentes.json`, `gateway/connections.mjs` e `gateway/login-runner.py`. A base não é importada nem executada.

O fluxo de autorização, adaptado da base, chama apenas comandos fixos dos CLIs. O link oficial e o código temporário ficam em memória; a autenticação é concluída pelo provedor e confirmada pelo CLI. Autorizar a conta é uma ação do usuário. Não copiamos credenciais da base ou da VPS.

A entrevista usa Claude Code nesta etapa. Codex já tem status e fluxo de autorização disponíveis para uso posterior. Os comandos podem ser configurados com `IANIZA_CLAUDE_BIN` e `IANIZA_CODEX_BIN`; por padrão são encontrados no PATH do processo servidor. Python 3 é necessário para o PTY de autorização.

Antes da conexão, aparece somente a tela de autorização. Depois de confirmada, abre a conversa. A saudação fixa está identificada como orientação inicial da IANiza; respostas atribuídas ao Claude vêm do adaptador. Falhas não geram respostas falsas.

Cada turno envia contexto e materiais da organização pela API ACP. As ferramentas nativas de terminal, leitura, escrita e navegação ficam desabilitadas. MCPs só são disponibilizados quando selecionados pela pessoa; cada execução depende de autorização no chat (ver [Skills e conectores](skills-e-conectores.md)). PDFs e imagens seguem como conteúdo nativo, e textos como contexto. O fluxo não exige chave da API separada quando o CLI já possui uma conta autorizada.

Referências técnicas: [ACP](https://agentclientprotocol.com/), [Claude Code programático](https://code.claude.com/docs/en/headless).

## Conversa e materiais

Os onze temas da skill cobrem negócio, ofertas, público, posicionamento, voz, visual, provas, concorrência, conteúdo, regras e exemplos. O Claude recebe a orientação de aproveitar informações já enviadas, aceitar lacunas, identificar propostas e não inventar fatos.

Uploads são privados: PDF, PNG, JPG, WebP, TXT, Markdown e CSV, até 8 MB cada; máximo de 12 arquivos e 24 MB por organização. Extensão, assinatura e conteúdo textual são verificados; nomes originais não decidem o caminho em disco. Somente administradores alteram o cérebro e enviam arquivos. Membros da mesma organização podem consultar o conhecimento.

A confirmação humana em **Salvar no cérebro** gera uma versão do perfil e uma skill autossuficiente. Hipóteses e propostas são apresentadas para conferência. Dados factuais ausentes permanecem como placeholders honestos.

- Conversa e versões: `.data/brain.sqlite`.
- Materiais: `.data/organizations/<id>/uploads/<id-do-arquivo>`.
- Skill confirmada: `.data/organizations/<id>/.claude/skills/minha-marca/SKILL.md`.

O banco é a fonte usada pela interface e pela exportação. A skill é uma cópia para uso por agentes futuros; o diretor ainda não foi implementado no projeto funcional. O tour fica para outra etapa.

## Envio e retomada

Enter envia, Shift+Enter insere uma linha e composição de teclado não dispara envios. A mensagem aparece imediatamente com “Enviando…”. O status muda quando o servidor confirma o registro. O envio usa um identificador único; tentar novamente conserva o texto e não duplica a mensagem já recebida. As atualizações do envio preservam o contêiner e a posição de leitura, sem reiniciar a rolagem. Há um turno por organização, e revisões concorrentes exigem atualizar o resumo.

Conversas continuam salvas após fechar a tela. Uma versão em edição não substitui silenciosamente a última versão confirmada. Sem conectores selecionados, a entrevista pede conteúdo colado ou anexado para usar links. Com um MCP compatível selecionado, o acesso segue a autorização da ferramenta.

## Verificação

Os testes automatizados usam dados descartáveis, sem chamadas pagas. Foi validado também um turno real com Claude pela conexão autorizada, usando apenas uma mensagem técnica em diretório temporário e sem alterar o cérebro da empresa. A autorização de conta e o status foram confirmados separadamente da antiga saudação fixa.
