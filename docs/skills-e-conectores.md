# Skills e conectores

As duas áreas ficam no perfil do escritório. O código beta foi consultado como referência de catálogo e transporte ACP; continua intacto e não é executado. Lia é o primeiro e único agente do escritório funcional. A seleção de skills funciona na conversa com o Claude e no painel da Lia; nesta última, o servidor restringe as opções à função de social media.

## Skills

Padrão do projeto: **Extrator de marca**, **Texto humano**, **Benchmark de mercado**, **Carrossel modular** e **Criativos estáticos que convertem**, com suas referências e templates. São distribuídas em `server/skills-defaults/` e copiadas uma única vez para o catálogo privado da instalação. Administradores podem editar nome, descrição e instruções, excluir e restaurar. Edições e exclusões persistem após reinícios e atualizações. **Minha marca** é gerada pela entrevista de cada instalação, sem distribuir os dados da empresa no código.

Cada VPS atende uma empresa e seus usuários convidados. Não há operação de múltiplas organizações; os identificadores legados dos bancos são mantidos por compatibilidade. Veja [Instalação única e skills](instalacao-unica-e-skills.md).

Administradores podem importar **somente `.md` ou `.zip`**. Um Markdown avulso pode ter qualquer nome; um ZIP deve conter uma única skill, com SKILL.md na raiz ou dentro de uma pasta principal. A prévia vem da validação no servidor. Nomes de exibição com espaços e acentos são aceitos e normalizados em um identificador interno, sem alterar os originais no computador da pessoa.

O ZIP pode ter até 24 MB, até 64 arquivos aceitos e até 24 MB expandidos. Textos, scripts de referência e templates PNG/JPG/WebP são suportados. As imagens ficam em arquivos privados da instalação, e a assinatura real determina seu MIME. Scripts não são executados. Veja [Importação segura](importacao-segura-skills.md) para limites e controles completos.

No chat, **Skills** permite selecionar até três pacotes por mensagem. O servidor resolve a seleção no catálogo da instalação e envia as instruções e referências ao modelo. Identificador, nome e versão ficam no histórico. Pacotes alterados ou desativados exigem uma mensagem nova em vez de mudar uma tentativa já registrada.

Texto humano orienta o conteúdo produzido pelo Claude de verdade; a aplicação não afirma que pode provar autoria humana. Pedidos com skills de escrita não alteram os campos ou as anotações da entrevista. Para voltar à entrevista, retire a seleção ou escolha o Extrator de marca. Os textos produzidos continuam no histórico; não são publicados automaticamente como regras da empresa.

## Distribuição por agente e pessoa

A matriz atual está em [Agentes, skills e conectores](agentes-skills-e-conectores.md), com um registro estruturado em [`config/marketing-agent-skills.json`](../config/marketing-agent-skills.json). Ela substitui as sugestões provisórias anteriores e inclui as cinco skills principais e as 19 definições do pacote `benchmark-system`, sem contar espelhos como novas skills.

O usuário confirmou que o segundo conector é o **Higgsfield**. O mapa prevê Theo no acesso de anúncios à Meta; Duna e Vico na geração de imagens/vídeos do Higgsfield, com Lucas na edição quando necessário. Esses integrantes ainda não estão implementados. Lia já usa as instruções das skills do catálogo previstas para sua função e conectores configuráveis pelo administrador, com uso liberado ou confirmação a cada chamada; as capacidades do Benchmark System continuam com integração pendente.

As anotações anteriores de Texto humano para Vico e Lucas permanecem contempladas. A Ilha de edição está agora representada pelas skills `edit-video`, `transcribe`, `clean-audio`, `remotion-compositor` e pelas auxiliares do Benchmark System encontrado em `.data/skills/`. Criativo de Impacto, antes analisado em Downloads, não está no catálogo desta pasta e não foi incluído como se estivesse instalado.

## Conectores MCP

Administradores podem cadastrar, editar, ativar/desativar e testar servidores MCP **Streamable HTTP**. A tela recebe nome, endereço e autenticação opcional por Bearer ou cabeçalhos. HTTPS é obrigatório fora do localhost. URLs com credenciais embutidas ou parâmetros de autenticação são recusadas.

Salvar mostra **Configurado · ainda não testado**. O botão **Testar conexão** abre uma sessão MCP real, faz `initialize` e `tools/list`, sem executar ferramentas, e guarda a lista e o horário. Um teste anterior não garante disponibilidade permanente. O teste rejeita redirecionamentos e tem limite de tempo. Falhas e exigência de autenticação têm mensagens próprias.

Até cinco conectores podem ser selecionados no chat. O servidor entrega apenas esses descritores à sessão ACP do Claude; os tokens não vão no prompt nem nas respostas da API. Os CLIs não herdam MCPs de outras configurações (`strictMcpConfig`). Ferramentas nativas de terminal, leitura, escrita e navegação continuam desabilitadas. Com MCPs selecionados, o modo que desliga todas as customizações é substituído pela configuração explícita da sessão, com fontes de configuração vazias, plugins vazios, hooks desligados e regra de pedir autorização para todas as ferramentas selecionadas.

No chat do cérebro, cada execução pede **Permitir esta vez** ou **Recusar**, mostrando o conector, a ferramenta e os argumentos. Na Lia, o administrador configura cada serviço em **Conectores**: **Usar sem perguntar** salva uma autorização persistente; **Pedir confirmação a cada uso** mantém o pedido no chat. Somente a pessoa que iniciou uma mensagem pode aprovar aquela chamada pontual; somente administradores alteram a configuração persistente do agente. Pedidos pontuais expiram em 60 segundos, e terminar o turno cancela os que restaram. Ferramentas sem identificação de um MCP selecionado são recusadas. Abrir/fechar uma tela não autoriza uma execução.

Conectores sem a skill de entrevista trabalham no modo de conversa, preservando o perfil da marca. Se o Extrator de marca estiver selecionado, as ferramentas podem fornecer fontes para a entrevista. Resultados de ferramentas são dados, sem autoridade para mudar regras da aplicação.

Limites desta etapa: sem servidores stdio, sem instalação de comandos e sem OAuth genérico para destinos arbitrários. Higgsfield e Meta Ads têm integrações próprias. O login de Claude/Codex continua em **Conexões de IA**, separado dos conectores de ferramentas.

## Meta Ads

O endereço oficial `https://mcp.facebook.com/ads` é reconhecido e um cadastro existente é aproveitado. O serviço exige autenticação. O registro automático da IANiza foi consultado e recusado pelo servidor da Meta com `invalid_client_metadata`: a configuração usa um **App ID previamente cadastrado no Meta for Developers**, em vez de tentar imitar outro cliente.

**Configurar Meta** mostra os passos e o endereço `<APP_ORIGIN>/api/connector-oauth/callback` para cadastrar no aplicativo. O App ID é público; a interface não pede senha ou App Secret. Depois de configurado, **Conectar Meta Ads** gera uma autorização por PKCE e usa os endpoints oficiais descobertos pela Meta. Só após o usuário concluir a autorização a conta é marcada como conectada. Consultas e alterações por ferramentas continuam dependendo da confirmação no chat.

Sem App ID, a conexão permanece pendente; não há uma conta ou aplicativo fictício. A validação de OAuth com dados de teste cobre callback, state e PKCE, enquanto o login real depende do aplicativo e das permissões da pessoa. Ao desconectar ou expirar um token sem renovação disponível, o token é removido e o App ID é preservado para reconectar.

Referência verificável: [metadados públicos do recurso Meta Ads](https://mcp.facebook.com/.well-known/oauth-protected-resource/ads) e [metadados OAuth da Meta](https://www.facebook.com/.well-known/oauth-authorization-server/ads).

## Higgsfield padrão

O Higgsfield aparece automaticamente nas instalações existentes e novas, com o endereço oficial `https://mcp.higgsfield.ai/mcp`. Seu nome e endereço são fixos; administradores podem conectar sua conta, desconectar e desativar. Um cadastro anterior do mesmo endereço é aproveitado, preservando a desativação. Não é marcado como conectado antes da autorização, nem selecionado automaticamente nas conversas.

**Conectar Higgsfield** cria um link oficial de OAuth. A pessoa abre a página do Higgsfield e autoriza a IANiza. O fluxo usa o SDK MCP, descoberta oficial, registro do cliente, PKCE S256 e state aleatório de uso único, ligado à organização e à pessoa que iniciou a conexão. A tentativa expira em dez minutos. A interface acompanha o resultado e apresenta as ferramentas somente após um teste MCP real. O login não gera mídia.

Os tokens e os dados do cliente ficam criptografados na tabela `connector_oauth` do mesmo `connectors.sqlite`, com a chave privada já usada pelos conectores. A renovação ocorre antes do uso se o token estiver próximo do vencimento. Se a renovação falhar, é necessário reconectar. Tokens não são enviados no prompt: o servidor os entrega apenas ao transporte do MCP selecionado. O callback é `<APP_ORIGIN>/api/connector-oauth/callback`; ao mudar o endereço da instalação, reconecte para registrar o novo retorno.

Desconectar remove as credenciais da instalação e cancela os fluxos pendentes. Não revoga permissões no painel do próprio Higgsfield. As gerações pelo MCP utilizam os créditos da conta autorizada, conforme a [documentação oficial do Higgsfield](https://higgsfield.ai/creator-hub/help-center/integrations/what-is-higgsfield-mcp). No cérebro, cada chamada exige confirmação; nos agentes, vale o modo salvo para o conector.

## Persistência e VM

Dentro de `IANIZA_DATA_DIR` (padrão `.data/`):

- `skills.sqlite`: catálogo único, textos, metadados de imagens, revisões e registro das skills padrão já fornecidas.
- `skill-imports/`: preparações privadas temporárias, vinculadas a quem enviou; expiram em dez minutos e são removidas ao confirmar/cancelar ou reiniciar.
- `skills/`: pacotes usados nesta instalação; o banco é a fonte do catálogo.
- `skill-trash/`: pacotes excluídos recuperáveis e cópias anteriores às edições, todos privados e dentro da cota de 100 MB.
- `organizations/<id>/.claude/skills/`: caminho legado preservado; `minha-marca` continua vinculada ao cérebro da empresa. A migração copia os demais pacotes para `skills/` sem apagar os originais.
- `connectors.sqlite`: configuração, ferramentas disponíveis e credenciais criptografadas com AES-256-GCM.
- `.connector-key`: chave privada da instalação, com permissão de arquivo 0600. Deve acompanhar o banco em backups/restauração e não pode ser servida publicamente.
- `brain.sqlite`: conversa e referências dos recursos selecionados em cada mensagem.
- `agents.sqlite`: permissões persistentes de conectores por agente e conversa da Lia por pessoa, com referências das skills, conectores e da versão aprovada da marca usada em cada resposta.

Para uma VM, configure por exemplo `IANIZA_DATA_DIR=/var/lib/ianiza` com um diretório persistente do usuário de serviço. Faça backup do diretório inteiro, incluindo bancos, uploads, skills e a chave oculta. A autenticação dos CLIs continua administrada por eles. Pedidos de autorização pendentes são temporários em memória; reiniciar recusa os pedidos e conserva as mensagens para nova tentativa.

## Verificação

A suíte cobre a empresa única por instalação, migração, padrões editáveis e excluíveis, restauração, permissões, CSRF, importações, criptografia, desativação, seleção e preservação da entrevista. O teste MCP automatizado usa um servidor HTTP local e verifica que testar a conexão não executa ferramentas.

Também foi validado um turno real com Claude e uma ferramenta MCP temporária local: houve pedido de autorização, chamada real e devolução do valor de verificação. Esse teste não usou dados nem alterou o cérebro da empresa.

Referências: [servidores MCP remotos](https://modelcontextprotocol.io/docs/develop/connect-remote-servers), [SDK TypeScript MCP](https://github.com/modelcontextprotocol/typescript-sdk), [opções de ferramentas e configuração do Claude](https://code.claude.com/docs/en/cli-reference).

A integração Higgsfield foi verificada também contra os endpoints oficiais: descoberta e registro geraram um link de autorização com PKCE e callback da IANiza, sem login em conta real e sem geração de mídia. Os testes de callback, renovação, isolamento, expiração e armazenamento de tokens usam respostas OAuth descartáveis.

## Atualizações da interface

O build publica uma versão do front e o HTML referencia scripts e estilos com essa versão. Abas já abertas detectam uma versão nova e mostram **Atualizar página**, inclusive dentro dos pop-ups, sem recarregar automaticamente durante uma edição. Abas anteriores à inclusão deste aviso precisam ser atualizadas manualmente uma vez. Testar um conector antes de autorizar a conta mostra a orientação para abrir **Conectar Higgsfield**.
