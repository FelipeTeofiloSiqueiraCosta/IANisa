# Distribuição de skills e conectores do Marketing

Definição registrada em 02/11/2026 a partir dos arquivos presentes em `.data/skills/`. O usuário confirmou que “Ring Shield” significa **Higgsfield**. Esta matriz define a distribuição para a implementação dos agentes; não ativa agentes, scripts nem permissões.

O arquivo estruturado correspondente é [`config/marketing-agent-skills.json`](../config/marketing-agent-skills.json). As atribuições usam a função, de modo que trocar o nome de uma pessoa ou agente não muda o acesso planejado.

## Primeiro agente implementado: Lia

Lia, social media, é o único agente presente no escritório funcional. Seu avatar 3D e o cartão **Seu time** abrem o painel com conversa, atividades e skills. A conversa usa o Claude real e é armazenada por pessoa em `.data/agents.sqlite`, separada da entrevista da marca. O contexto recebe somente a versão aprovada do cérebro; a resposta da Lia não altera esse perfil.

O servidor permite selecionar até três skills ativas do catálogo previstas para a função: Texto humano, Carrossel modular, Benchmark de mercado e Extrator de marca (apoio). O papel da Lia tem precedência sobre os roteiros de entrada das skills: ela aproveita o contexto disponível, sem reiniciar a entrevista. As instruções orientam planejamento e produção textual; não liberam scripts, coleta externa ou publicação. A geração de imagens e vídeos usa o Higgsfield conectado, conforme a permissão salva no agente. As capacidades internas do Benchmark System aparecem como **Integração pendente**.

Lia recebe **Higgsfield diretamente**, por solicitação do usuário. A conexão ativa é resolvida no servidor a cada mensagem; conector desconectado ou desativado não entra na sessão. A aba **Conectores** permite adicionar e remover serviços e escolher **Usar sem perguntar** ou **Pedir confirmação a cada uso**. O Higgsfield começa liberado, conforme solicitado pelo usuário. Tokens não entram no histórico nem na API. Meta Ads não é atribuído por padrão, mas o administrador pode adicioná-lo ou adicionar outros conectores cadastrados. Os demais integrantes, o Diretor e a delegação automática continuam pendentes; a Lia prepara briefings e propostas para revisão humana. O campo `implementedAgents` registra esta implementação; os demais `runtimeEnabled: false` continuam descrevendo os limites do mapa e dos pacotes técnicos.

## Inventário analisado

Há **cinco skills principais** e **19 SKILL.md canônicos** dentro de `benchmark-system/skills/`. O Texto humano aparece nos dois lugares: são 24 definições e **23 capacidades distintas**. As 19 cópias em `.agents/skills/` e as 19 em `.claude/skills/` foram comparadas byte a byte com o catálogo canônico e são espelhos, não outras skills.

O Texto humano principal e o do pacote têm a mesma metodologia; muda somente o caminho relativo do script verificador. Usar uma capacidade lógica, sem duplicar a skill no agente. Não foi encontrado um `SKILL.md` principal na raiz de `benchmark-system`: ele é um pacote de ferramentas e contratos que depende da estrutura interna.

## Responsabilidades por função

| Função | Referência na apresentação | Responsabilidade |
| --- | --- | --- |
| Diretor do time | Diretor | Planeja, coordena e revisa; consulta o cérebro e delega a execução especializada. |
| Social media | Lia | Pauta, calendário, referências e desempenho do conteúdo orgânico. |
| Gestor de tráfego | Theo | Anúncios, hipóteses de teste, métricas e estratégia de mídia paga. |
| Copywriter | Cora | Mensagem, argumento, oferta, roteiro escrito, headline e CTA. |
| Designer | Duna | Direção de arte, imagens, slides e peças estáticas. |
| Web designer | Noah | Landing pages e estrutura das páginas do funil. |
| Videomaker | Vico | Concepção audiovisual, roteiro de cenas, ingestão e imagens de apoio. |
| Editor de vídeo | Lucas | Montagem, áudio, legendas, motion e conferência técnica; quando humano, usa as skills pelo assistente de IA. |
| Head de marketing | Clara | Define objetivos, prioridades e regras; acompanha e aprova os planos. |
| Head comercial | Configurável | Fornece oferta, objeções, preço e metas comerciais; valida essas definições. |

O Editor de vídeo pode ser humano, como Lucas na apresentação. Nesse caso, recebe a tarefa e usa o assistente de IA com as skills da função. Os heads humanos recebem relatórios e definem prioridades; não precisam ganhar todas as ferramentas técnicas para acompanhar o trabalho. O cérebro é um recurso de conhecimento compartilhado, não outro integrante que executa tudo.

## As cinco skills principais

| Skill | Responsável principal | Apoio | Entrega e divisão |
| --- | --- | --- |
| [Extrator de marca](../.data/skills/extrator-de-marca/SKILL.md) | Diretor do time | Head de marketing, Head comercial, Social media, Copywriter, Designer | Entrevistar o usuário e propor o perfil da empresa para conferência. Os demais integrantes consultam a marca aprovada; não repetem a entrevista nem alteram regras por conta própria. |
| [Benchmark de mercado](../.data/skills/benchmark-de-mercado/SKILL.md) | Diretor do time | Social media, Gestor de tráfego, Copywriter | Consolidar concorrência, posicionamento, ofertas e oportunidades em um diagnóstico estratégico. Lia pesquisa conteúdo; Theo pesquisa anúncios; Cora interpreta linguagem e ofertas. O diretor consolida e prioriza. |
| [Texto humano](../.data/skills/texto-humano/SKILL.md) | Copywriter | Social media, Videomaker, Editor de vídeo, Web designer, Designer, Diretor do time, Head de marketing, Head comercial | Orientar e revisar o texto que será publicado ou falado. Aplicar ao texto publicável, inclusive texto de imagem e legenda; não transformar todo dado técnico ou conversa interna em copy. |
| [Carrossel modular](../.data/skills/carrossel-modular/SKILL.md) | Social media | Copywriter, Designer | Coordenar pauta e sequência; Cora escreve; Duna produz os slides. Reutilizar briefing e cérebro; o render atual cita Gemini/OpenAI diretos e exige adaptação para usar Higgsfield. |
| [Criativos estáticos que convertem](../.data/skills/criativos-estaticos-que-convertem/SKILL.md) | Designer | Copywriter, Gestor de tráfego | Produzir peças e variações para anúncios com copy e hipóteses definidas. Cora define a mensagem; Theo define público, objetivo e teste; Duna produz. Publicar é outra tarefa. |

## Skills do Benchmark System

O responsável principal responde pela entrega. “Apoio” significa acesso durante uma subtarefa pertinente, não carregar todas as skills em todas as sessões.

| Skill | Responsável principal | Apoio | Uso |
| --- | --- | --- |
| [`benchmark-profile`](../.data/skills/benchmark-system/skills/benchmark-profile/SKILL.md) | Social media | Videomaker, Copywriter | Comparar conteúdo orgânico de perfis e compilar inteligência editorial. |
| [`benchmark-advertiser`](../.data/skills/benchmark-system/skills/benchmark-advertiser/SKILL.md) | Gestor de tráfego | Copywriter, Web designer | Comparar anúncios, oferta e caminho até a conversão. |
| [`capture-reference`](../.data/skills/benchmark-system/skills/capture-reference/SKILL.md) | Social media | Videomaker, Copywriter, Designer, Editor de vídeo | Transformar uma referência em pauta e adaptação coerente com a marca. |
| [`self-review`](../.data/skills/benchmark-system/skills/self-review/SKILL.md) | Social media | Gestor de tráfego, Diretor do time | Comparar os posts próprios e devolver aprendizados sustentados por evidências. |
| [`profile-extract`](../.data/skills/benchmark-system/skills/profile-extract/SKILL.md) | Social media | Gestor de tráfego | Obter dados de perfis e rankings que alimentam a análise orgânica. |
| [`content-analysis`](../.data/skills/benchmark-system/skills/content-analysis/SKILL.md) | Social media | Copywriter, Videomaker, Designer, Editor de vídeo | Analisar gancho, estrutura, retenção e CTA de conteúdo orgânico. |
| [`ads-extract`](../.data/skills/benchmark-system/skills/ads-extract/SKILL.md) | Gestor de tráfego | Copywriter | Coletar e organizar anúncios públicos e variações de criativos. |
| [`funnel-map`](../.data/skills/benchmark-system/skills/funnel-map/SKILL.md) | Web designer | Gestor de tráfego, Copywriter, Head comercial | Mapear páginas, objetivo, oferta e a passagem de uma etapa para outra. |
| [`offer-analysis`](../.data/skills/benchmark-system/skills/offer-analysis/SKILL.md) | Copywriter | Gestor de tráfego, Web designer, Head comercial | Analisar promessa, prova, mecanismo, objeções, preço e condições. |
| [`video-download`](../.data/skills/benchmark-system/skills/video-download/SKILL.md) | Videomaker | Editor de vídeo, Social media, Gestor de tráfego | Obter a mídia e os metadados necessários à tarefa. |
| [`transcribe`](../.data/skills/benchmark-system/skills/transcribe/SKILL.md) | Videomaker | Editor de vídeo, Social media, Copywriter | Gerar fala com timestamps e alimentar roteiro, análise e montagem. |
| [`edit-video`](../.data/skills/benchmark-system/skills/edit-video/SKILL.md) | Editor de vídeo | Videomaker, Designer | Coordenar montagem, plano de edição, render e conferência técnica. |
| [`clean-audio`](../.data/skills/benchmark-system/skills/clean-audio/SKILL.md) | Editor de vídeo | Videomaker | Diagnosticar e tratar áudio quando necessário. |
| [`remotion-compositor`](../.data/skills/benchmark-system/skills/remotion-compositor/SKILL.md) | Editor de vídeo | Designer, Videomaker | Compor legendas, cartões, grafismos e efeitos do plano de edição. |
| [`broll-source`](../.data/skills/benchmark-system/skills/broll-source/SKILL.md) | Videomaker | Editor de vídeo, Designer | Selecionar material de apoio e registrar fonte, licença e créditos. |
| [`omni-insert`](../.data/skills/benchmark-system/skills/omni-insert/SKILL.md) | Videomaker | Editor de vídeo, Designer | Criar ou animar planos de apoio e encaixá-los na edição. |
| [`model-edit`](../.data/skills/benchmark-system/skills/model-edit/SKILL.md) | Editor de vídeo | Videomaker, Designer | Medir uma referência e produzir uma receita de edição reproduzível. |
| [`style-extract`](../.data/skills/benchmark-system/skills/style-extract/SKILL.md) | Editor de vídeo | Videomaker, Designer | Comparar várias referências e propor um estilo com evidência e confiança. |
| `texto-humano` do pacote | Copywriter | Os mesmos da versão principal | Alias da mesma capacidade, com ajuste do caminho do verificador. |

## Conectores

| Conector | Acesso direto planejado | Quem recebe o resultado | Limite |
| --- | --- | --- |
| Meta Ads | Theo; diretor pode ter leitura para conferência | Demais integrantes recebem relatórios e briefings pertinentes | Gestão de anúncios e verba só na tarefa autorizada; não conceder escrita a todos. |
| Higgsfield | Lia já tem acesso direto; Duna para imagens, Vico para vídeo e Lucas na edição estão previstos | Cora e Noah podem pedir material a esses responsáveis | Escolher uma ferramenta compatível com a tarefa e registrar consumo; não gerar por todos simultaneamente. |

Acesso de leitura por função ainda depende de implementar filtros no backend e de conferir as ferramentas que o conector realmente expõe. Selecionar um MCP inteiro não é, por si só, uma restrição a leitura. O mapeamento não concede tokens nem muda a autenticação já existente. No cérebro a autorização continua por chamada. Na Lia o servidor aplica a configuração persistente de cada conector.

O MCP Meta Ads não deve ser presumido como fonte completa de dados públicos de concorrentes ou de todas as redes. Quando `ads-extract` citar uma ferramenta de Ads Library, será necessário conferir se ela existe no conector conectado e se a conta tem autorização. CTR, CPA, ROAS e vendas de concorrentes não podem ser inferidos como fatos a partir de longevidade ou número de variações. Esses sinais geram hipóteses, não comprovação de resultado.

## O que será necessário para executar

| Parte | Dependência identificada no pacote | Consequência para a IANiza |
| --- | --- | --- |
| Benchmark de mercado e páginas | Pesquisa web e captura de fontes | Precisa de adaptador de pesquisa autorizado; Meta e Higgsfield não cobrem a web inteira. |
| Perfis e anúncios públicos | Apify e/ou acesso autorizado, além das ferramentas de cada plataforma | A presença do arquivo não conecta esses provedores; credenciais ficam fora dos prompts. |
| Transcrição | Deepgram e ferramentas de mídia | Implementar um serviço de transcrição; não tratar Higgsfield como substituto automático. |
| Análise visual | Gemini opcional no pacote | Pode ser adaptada ao provedor de análise disponível; geração de imagem não substitui análise. |
| Carrossel e omni-insert | Scripts atuais usam APIs específicas de Gemini/OpenAI | É necessário um adaptador para produzir por Higgsfield; o simples vínculo não faz essa troca. |
| Edição e motion | FFmpeg/FFprobe, Remotion/Node e recursos nativos | Executar futuramente em workers restritos e com limites, não liberar terminal ao chat. |
| Compatibilidade da VPS | O pacote cita `avconvert`, Vision e binários macOS/arm64 | Não declarar compatibilidade Linux antes de substituir ou portar esses componentes e testar. |

O catálogo funcional atual registra as cinco skills principais. As 19 definições do Benchmark System estão no disco, com referências e scripts, mas ainda não foram integradas como pacote executável no runtime. Elas não devem ser desmembradas copiando apenas o SKILL.md: os caminhos relativos, contratos e bibliotecas também são necessários. Nenhum instalador ou script desse pacote foi executado nesta análise.

## Coordenação e revisão

O usuário passa pela entrevista inicial. O diretor consulta o cérebro e a TSK, monta o plano e apresenta para aprovação. Com o plano aprovado, distribui as subtarefas abaixo. Cada sessão recebe apenas as skills e fontes que precisa.

1. **Pesquisar:** Lia usa o eixo orgânico; Theo usa o eixo pago; Noah e Cora analisam páginas e ofertas quando necessário. O diretor consolida a estratégia.
2. **Escrever:** Cora produz a mensagem; Texto humano acompanha o texto publicável; a marca aprovada fornece tom e regras.
3. **Produzir:** Duna cria estáticos e slides; Vico prepara cenas e assets; Lucas cuida de montagem, áudio e motion.
4. **Revisar:** o diretor confere cada entrega contra o briefing e o cérebro. Se houver erro, devolve com os ajustes. Não pede aprovação humana para cada entrega por padrão.
5. **Consultar o usuário quando previsto:** decisões ainda sem definição, alteração das regras da empresa, portões explícitos do plano de edição, mudança audível da voz ou operações que exigem autorização. Não remover silenciosamente esses portões para fazer uma skill parecer autônoma.
6. **Guardar e aprender:** a tarefa reúne insumos, rascunhos, anotações e resultados em sua TSK; o resultado aprovado entra no conhecimento da tarefa. Aprendizados propõem mudanças, mas não sobrescrevem automaticamente as regras gerais da empresa.

Todos consultam a mesma versão aprovada da marca. Preencher os dados que já existem no cérebro evita repetir a entrevista do Extrator ou as perguntas iniciais do Carrossel. Dependências usam entregas aprovadas: uma publicação não avança com arte, texto ou vídeo ainda devolvidos para ajuste.

## Como usar o arquivo estruturado na próxima implementação

Os campos `primary`, `support` e `reviewer` definem a responsabilidade. `dependencies` aponta o que ainda precisa de integração. O `sha256` identifica a versão do SKILL.md analisada. `runtimeEnabled: false` registra que este arquivo é o desenho das atribuições, e não uma liberação de acesso ou uma funcionalidade já em execução. Permissões reais deverão ser conferidas no servidor a cada tarefa.

O escopo continua sendo uma empresa por VPS. Perfis, creators ou marcas citados no pacote podem representar referências e canais internos da mesma empresa; não acrescentam um cadastro de múltiplas organizações à IANiza.

## Correção: Higgsfield na conversa da Lia

A conta podia aparecer conectada no catálogo, mas a sessão da Lia era criada com `connectors: []` e o prompt afirmava que geração estava indisponível. A sessão agora recebe somente o Higgsfield atribuído e habilitado, com renovação OAuth pelo transporte comum. O contexto atual dos conectores prevalece sobre respostas antigas de indisponibilidade. As autorizações ficam na conversa e são vinculadas à pessoa e ao pedido. Membros podem usar a conexão da instalação conforme a permissão salva no agente, mas continuam sem poder configurar, reconectar, desconectar ou consultar credenciais OAuth.

O histórico anterior foi preservado; para usar a capacidade nova é preciso enviar uma nova mensagem. Essa correção não ativa os scripts do pacote nem a execução do render de carrossel por Gemini/OpenAI direto; Lia pode usar as ferramentas disponíveis do Higgsfield sem essas APIs alternativas.

## Permissões de conectores por agente

Em **Lia → Conectores**, o administrador vê os serviços cadastrados na empresa, adiciona ou remove até cinco deles e salva o modo de cada um. A configuração vale para o agente em toda a instalação e fica em `agent_connector_settings`, no banco `agents.sqlite`, com revisão, autoria e data. Não depende da aba ou da conversa e sobrevive ao reinício. Membros podem consultar, mas não alterar.

- **Usar sem perguntar:** a autorização já foi dada pelo administrador. O servidor responde a cada solicitação do ACP sem interromper o usuário; não ativa uma permissão global dentro do Claude.
- **Pedir confirmação a cada uso:** mostra **Permitir esta vez**, **Recusar** e, para administradores, **Não perguntar novamente**. Essa última ação salva a autorização desse conector para a Lia.
- **Remover:** elimina o vínculo com o agente, preservando a conexão da empresa. O padrão não é recriado depois. As próximas chamadas são recusadas, inclusive as que estavam esperando autorização. Não desfaz uma ação externa que já tenha sido executada.

Toda chamada é identificada e conferida no servidor. Conectores removidos, desativados, desconectados ou de outra empresa não são liberados. Permitir um conector não concede terminal ou ferramentas nativas. O modelo não pode ampliar a própria lista de acessos. Mudanças concorrentes exigem conferir a revisão atual antes de salvar. Escolher uso liberado também permite consumir créditos e realizar as ações disponíveis naquele serviço, conforme a tarefa.

Os testes cobrem persistência, remoção, adição, modos por conector, recusa para membros, revisão desatualizada, isolamento de pedidos, liberação sem perguntas repetidas e revogação durante uma espera. O chat do cérebro mantém seu comportamento de confirmação por chamada.

## Etapas reais, modelos e imagens no chat da Lia

A conversa acompanha os eventos do transporte ACP: preparação do contexto, conexão com os serviços, início da sessão Claude, ferramentas MCP em execução, espera por autorização e resposta salva. Cada ferramenta mantém seu próprio estado e o histórico de etapas pode ser expandido na resposta. Não há porcentagem simulada nem exposição de pensamento interno, argumentos ou saídas brutas. Terminal e builds continuam desabilitados: nenhuma etapa de build é inventada para a apresentação. Uma chamada sem retorno fica interrompida, sem afirmar que a operação externa falhou ou foi desfeita.

O andamento fica na conversa privada de cada pessoa em `agents.sqlite`, em `state.activity`; a resposta concluída guarda uma cópia em `messages[].activity`. Sobrevive ao reinício e uma execução órfã passa a interrompida. A configuração dos conectores continua sendo independente do histórico. Os eventos recebidos depois do encerramento são ignorados.

**Conversa com Claude** identifica o provedor. O modelo de cada nova resposta vem dos metadados da sessão ACP, incluindo o nome disponibilizado pelo adaptador; não é inferido do texto da IA. Quando a sessão só informa o padrão da conta ou um alias, a interface conserva essa informação sem inventar uma versão. Mensagens anteriores identificam Claude, com modelo não registrado. Essa conversa ainda não alterna para Codex/ChatGPT.

As imagens retornadas pelo Higgsfield aparecem no próprio chat, com **Abrir imagem**, identificação do serviço e modelo de geração quando registrado pela ferramenta. O domínio CloudFront é a entrega do arquivo de mídia, não o modelo da conversa. Para respostas antigas, só há prévia quando a mensagem já registra Higgsfield e contém uma URL de imagem do CDN permitido; um modelo extraído desse texto é identificado como informado na resposta.

O navegador só carrega imagens HTTPS PNG/JPEG/WebP do domínio exato `d8j0ntlcm91z4.cloudfront.net`, liberado explicitamente na CSP. Outros domínios, SVG, credenciais na URL e esquemas ativos não geram prévia. O conteúdo permanece escapado, sem HTML da resposta. A imagem usa `no-referrer`; não existe proxy de URLs arbitrárias. O link continua hospedado pelo serviço externo, sujeito à disponibilidade dele; esta alteração não arquiva os arquivos no disco da VPS. As mensagens e imagens preservam seus elementos no DOM durante atualizações de andamento, evitando recargas e saltos de leitura.
