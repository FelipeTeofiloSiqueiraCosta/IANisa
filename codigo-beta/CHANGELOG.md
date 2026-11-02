# Ratoeira: o que mudou

Uma entrada por versão, a mais nova em cima. É o texto que o admin lê na tela de Atualizações antes de atualizar:
escrever pra quem usa (o que muda pra ele), não pra quem programa. Versão nova: `node kit/nova-versao.mjs <x.y.z>`,
que acerta o `VERSION`, os `package.json` e abre a entrada aqui.

Número: `maior.menor.correção`. Correção (0.5.0 → 0.5.1) não muda nada de que o aluno dependa e pode ir sozinha;
menor (0.5 → 0.6) traz coisa nova; maior fica pro dia em que algo deixar de funcionar como antes.

## 0.11.1 (29/10/2026)

Correção.

- **Instalação em VPS com processador ARM (em teste).** O instalador aceitava só x86_64; agora instala também em
  ARM de 64 bits (Oracle Ampere, por exemplo), com o Claude Code feito pra ARM, e a atualização troca o Claude
  Code certo pra cada máquina. Ainda não foi testado inteiro em ARM: o navegador dos agentes e o ditado podem não
  subir lá. Em x86 (Hostinger e as outras), nada muda.

## 0.11.0 (29/10/2026)

- **As versões novas passam a chegar pela tua conta da plataforma Ratos de IA.** Em Configurações › Atualizações
  tem um bloco novo, "Conta da plataforma": clica em **Conectar à plataforma**, abre o endereço que aparece (logado
  na tua conta da plataforma, a mesma da Comunidade) e confirma o código. Leva meio minuto e é uma vez só. Daí
  em diante a Ratoeira recebe as versões novas enquanto a tua Comunidade Ratos estiver ativa. **Conecta logo
  depois de atualizar:** daqui a alguns dias o jeito antigo de buscar versão sai, e a Ratoeira que não estiver
  conectada fica parada na versão que tem até conectar.
- Sem a Comunidade ativa, a Ratoeira continua funcionando normal, com tudo que tem: só não recebe versão nova, e a
  tela diz por quê.
- Cada conta conecta até 3 Ratoeiras. Dá pra ver e desconectar as tuas em
  `plataforma.ratosdeia.com.br/ratoeira/conectar`.
- O agente de quem administra também conecta: é só pedir "conecta a Ratoeira na plataforma".

## 0.10.2 (29/10/2026)

Correção.

- **Codex com os modelos novos (GPT-6.1 Sol e GPT-6.1 Terra).** A OpenAI só mostra cada modelo pra versões novas do
  Codex, e a Ratoeira seguia instalando uma de setembro. Agora vai o Codex 0.165.0, junto com o Claude Code
  2.1.308 e os adaptadores do chat mais novos.
- **Claude Code e Codex atualizam junto com a Ratoeira.** Até aqui eles ficavam na versão da instalação e o botão de
  atualizar não trocava. Agora cada versão da Ratoeira traz as versões dos dois que a gente testou, e a atualização
  troca sozinha. Vale na próxima conversa; conversa que estiver rodando termina com a versão de antes.

## 0.10.1 (28/10/2026)

Correção.

- **O Claude sumia da conversa nova quando a pasta da tua área deixava de existir** (uma área apagada ou uma pasta
  movida). Ele aparecia como desconectado, mesmo com a conta conectada, e a árvore de Arquivos não abria. Agora a
  Ratoeira passa sozinha pra próxima área tua que existe (ou pra tua pasta pessoal), e o Claude volta pra lista.
- **Conversa numa pasta que não existe mais** mostra o motivo ("a pasta X não existe mais") em vez de "O agente não
  respondeu".
- **Quando um agente não abre por outro motivo que não seja a conta**, o chat avisa, em vez de só tirar ele da lista.

## 0.10.0 (28/10/2026)

- **Codex igual ao Claude, em três coisas:**
  - **Limites na tela:** a conversa do Codex mostra quanto já foi do limite de 5 h e da semana, o plano da conta,
    o aviso quando passa de 80% e a hora exata em que o limite volta.
  - **Várias contas:** em Configurações › Contas de IA, "Adicionar outra conta tua" entra com outra conta do
    ChatGPT. Quem administra adiciona várias contas da organização e escolhe quem pode usar cada uma (a conta
    geral de antes vira a primeira da lista, sem ninguém entrar de novo). Cada conversa escolhe a conta no seletor
    da caixa do chat, e trocar no meio não perde a conversa.
  - **Versões guardadas sozinhas:** o que o Codex muda na pasta vira versão no fim de cada resposta, no teu nome,
    como já era no Claude.
- **Verificação em dois passos:** entrada com app autenticador (Google Authenticator, 1Password e afins), códigos
  de reserva e aparelho lembrado por 30 dias. Fica em Configurações › Segurança; quem administra pode exigir de
  todo mundo.
- **Esqueci a senha:** a Ratoeira manda o link por e-mail, pelo e-mail que tu configurar (Resend ou o SMTP de um
  e-mail teu) em Configurações › E-mail.
- **Backup fora da VPS:** em Segurança, liga um backup automático pra um armazenamento teu (Cloudflare R2,
  Backblaze B2 ou S3). A senha do backup aparece uma vez só: guarda ela.
- **Publicados na Mesa:** o que está publicado ganha um globo na árvore de arquivos, com o link no menu, e a busca
  acha o arquivo pelo link colado.
- **Barra de conversas:** "Rodando agora" no topo, depois as não lidas e as rotinas recentes. Botão direito na aba
  ou na conversa marca como lida ou não lida.
- **Sino:** o que precisa de ti fica no topo, os "terminou" vêm agrupados, e tem filtro.
- **Integrações** separadas em "Só tuas" e "Do time", cada lado com o seu "Ligar uma nova".
- **Página com senha dos Publicados atrás do Caddy:** cada pessoa tem a sua trava de tentativas. Antes, todo mundo
  contava como uma só, e 10 senhas erradas de qualquer um travavam a página pra todos por 15 minutos.
- **Mandar arquivo ou link de conversa pelo menu de compartilhar do celular.**

## 0.9.2 (27/10/2026)

- **Tabela no chat pelo celular:** quando a tabela não cabia, uma coluna era espremida até ficar uma letra por
  linha. Agora as palavras ficam inteiras e a tabela rola pro lado.
- **Barra do celular igual em todas as telas:** o rato abre uma gaveta com os apps, as telas, a tua conta e o tema.
  Os botões ficaram maiores, mais fáceis de acertar com o dedo.
- **Ratoeira instalada como app no celular:** segurar o ícone mostra atalhos, o ícone mostra quantos avisos tem no
  sino, aparece uma tela própria quando cai a conexão e a tela não apaga enquanto tu grava um áudio.
- **Mensagem mandada com "Agora"** enquanto o agente trabalha volta a funcionar como no Claude Code normal.

## 0.9.1 (25/10/2026)

- **App novo aparece sozinho em Apps:** quando o agente publica um app pelo chat, ele entra no menu e na tela de
  Apps assim que a resposta termina, sem recarregar a página.
- **Quem cria o app já entra com o acesso máximo:** quem publicou o app e quem administra a Ratoeira abrem com o
  papel que pode mais, sem precisar mexer em Pessoas. Pessoas continua servindo pra dar papel aos outros ou bloquear.
- **O agente só diz que o app está pronto depois de publicar de verdade**, e não manda mais trocar o teu papel em
  Pessoas.

## 0.9.0 (24/10/2026)

- **Baixar no iPhone:** com a Ratoeira na tela de início do iPhone, o Baixar abria o arquivo em tela cheia, sem
  salvar e sem voltar. Agora ele abre o menu de compartilhar do iPhone, com "Salvar em Arquivos", AirDrop e o resto.
- **Tela da Início no iPhone do tamanho certo:** ao abrir, o iPhone dava zoom na caixa de texto e a tela passava
  da borda. Não dá mais.
- **Conversa em nova janela ou aba:** no menu da conversa (⋯ ou botão direito na aba), "Abrir em nova janela" abre
  uma Mesa à parte, com o arranjo de painéis só dela. Some sozinha depois de 14 dias sem abrir.
- **Botão direito na aba** abre o menu do painel, com "Fechar aba". O "Dividir" saiu desse menu.
- **Recarregar o arquivo:** botão novo na barra do arquivo, pra quando o agente mudou o arquivo no meio da conversa.
- **Página HTML aberta na área Arquivos mostra as imagens e os vídeos dela.** Antes, tudo o que ela buscava da
  própria pasta aparecia quebrado. Continua isolada: só lê esse tipo de arquivo, só da pasta onde está.
- **Link do modo foco no celular** abre na Mesa normal.

## 0.8.3 (20/10/2026)

- **A Ratoeira avisa a equipe quando é instalada.** Pelo mesmo caminho do botão Reportar, ela conta pra gente que
  terminou de instalar, quando quem administra entra pela primeira vez e quando muda de versão. Vai só o endereço
  dela, a versão, o nome e o e-mail de quem administra e quantas pessoas têm conta: nada dos teus arquivos, das
  conversas ou das chaves. Serve pra gente saber quem instalou e te ajudar sem esperar um reporte.

## 0.8.2 (20/10/2026)

Correções pequenas.

- **Conversa que não abria mais:** quando o agente pedia permissão enquanto trabalhava no fundo (um subagente, um
  workflow), a conversa ficava "rodando" pra sempre, a mensagem seguinte não saía e, ao recarregar a página, ela
  ficava em "Carregando a conversa…". Agora ela volta ao normal depois da resposta (ou do Parar), e se o servidor
  demorar aparece "Tentar de novo".
- **Ratoeira na tela inicial do iPhone:** quem já está logado não cai mais na tela de entrar toda vez que abre pelo
  ícone; vai direto pra Ratoeira.
- **Boas-vindas minimizada não cobre mais o chat:** a janela minimizada virou uma aba fina na borda direita da tela
  ("Boas-vindas · 3/6"), longe do botão de enviar. Tocar nela volta pra janela.

## 0.8.1 (19/10/2026)

- **Arquivo que o agente traz pra pasta não trava mais as versões:** o que ele criava em outro lugar e depois movia
  pra tua pasta chegava fechado só pra ele, e a Ratoeira não conseguia guardar a versão. Vale quando o agente de
  cada pessoa reinicia (sozinho, depois de um tempo parado).
- **Receita de instalação com um passo novo, opcional:** depois das boas-vindas, o agente do teu computador
  oferece levar pra Ratoeira o que ele já usa (skills, integrações, tuas instruções gerais e as chaves de API
  delas), item por item, e diz o que não dá pra levar.

## 0.8.0 (18/10/2026)

- **A Mesa mostra a tua pasta como ela é:** tudo o que está nela aparece, inclusive o `.env` (pra pôr uma chave) e os
  arquivos que não vão pro GitHub. Esses vêm com o nome mais apagado e um ícone pequeno; passando o mouse, ele explica.
  Pasta nova, pasta vazia e arquivo que o agente moveu aparecem na hora, no lugar certo.
- **Criar e renomear pelo botão direito:** numa pasta, "Novo arquivo" e "Nova pasta"; no espaço vazio da árvore, na
  raiz; em qualquer arquivo ou pasta, "Renomear". Arquivo novo já abre pra escrever.

## 0.7.1 (18/10/2026)

- **Versões guardadas sozinhas, de tudo:** no fim de cada resposta do agente, a Ratoeira guarda uma versão do que
  mudou, no teu nome. Antes só entrava o que ele editava; agora entra também o que ele cria, move ou apaga.
- **O agente parou de perguntar se pode "commitar"** ou de avisar que não guardou: isso é com a Ratoeira.

## 0.7.0 (18/10/2026)

- **Mesa no celular, barra nova:** em cima ficam Arquivos, Conversas e Abas, com o nome de cada um, e do lado a
  conversa nova, o sino e o teu menu. Conversas é a mesma lista do computador (quem espera a tua resposta, o que está
  rodando, as compartilhadas e as tuas), com o número das que pedem atenção.
- **O rato vai pra Início**, como em todo app. A Início também está no topo do teu menu.

## 0.6.9 (18/10/2026)

- **Conversa nova lembra a pasta:** começa na pasta da última conversa que tu abriu, como já fazia com o modelo.
  Se a pasta foi apagada ou renomeada, volta pra raiz.
- **Pasta da conversa à vista:** o topo da conversa mostra o nome da pasta onde ela roda; clicar mostra a pasta na
  árvore. Conversa nova numa subpasta já abre a pasta na árvore.
- **Boas-vindas:** um passo novo mostra como levar o teu trabalho pra fora da Ratoeira (o globo de cada arquivo,
  sites e sisteminhas com link próprio, apps do time), com um teste que faz uma página de exemplo pra tu publicar.

## 0.6.8 (18/10/2026)

Correções pequenas.

- **Conectar o Claude:** o campo do código de autorização não perde mais o cursor no meio da digitação, e o
  navegador parou de oferecer a senha salva nele.
- **Barra da esquerda em tela baixa (notebook):** os apps não ficam mais por cima de Notificações. O que não cabe
  vai pro "+N", e com um app só ele aparece no lugar do "+1".
- **Boas-vindas, trazer o teu trabalho:** o agente pergunta se tu vai ter um projeto só ou vários. Com vários, cada
  um entra numa pasta com o nome dele, e a raiz fica livre pros próximos.

## 0.6.7 (18/10/2026)

Correções pequenas.

- **Mesa:** quando o agente move ou apaga pastas e arquivos, a árvore da esquerda mostra na hora como ficou. Antes,
  até salvar no git, ela seguia mostrando o lugar antigo junto com o novo.
- **Codex sem conta conectada:** a Ratoeira parou de perguntar a ele a cada 20 segundos (enchia o log). Abrir uma
  conversa do Codex sem conta agora diz pra conectar em Configurações › Contas de IA.

## 0.6.6 (17/10/2026)

- **Instalar no beta sem conta do GitHub:** a receita e o README usam a chave de leitura que a equipe da Ratoeira
  manda pra cada pessoa, no lugar do convite e do login do GitHub na VPS. Quem já instalou não precisa fazer nada.

## 0.6.5 (17/10/2026)

Correções pequenas.

- **Atualizações:** a tela não fica mais com os botões apagados depois de "Ver se tem versão nova" quando a resposta
  demora ou dá erro. Ela espera um tempo, confere o estado de novo e devolve os botões.
- **Reportar:** o diálogo diz "Vai para a equipe da Ratoeira" (antes saía "pra a").

## 0.6.4 (17/10/2026)

Primeira vez e Reportar ligado sozinho.

- **Boas-vindas:** na primeira vez, cada pessoa (quem administra e quem foi convidado) é recebida por uns passos
  curtos: conectar a conta do Claude, trazer o teu trabalho (do GitHub, do computador ou do zero) e as integrações.
  Depois vem um tour pelas telas, e a Início ganha uma lista de "Primeiros passos" que some quando tu termina.
- **Configurações › Endereços:** pra usar um domínio teu no portal e nos Publicados, com o que pôr no DNS e a conferência
  de que ficou certo.
- **Reportar ligado desde a instalação:** a instalação já deixa o Reportar mandando pra equipe da Ratoeira, sem passo
  à mão. Quem não quiser instala com `--sem-reportar`, e aí o reporte fica só na tua VPS.
- **Coluna de conversas da Mesa:** mais enxuta (as tuas, as compartilhadas com movimento e as rotinas do dia; o resto
  em "Ver todas") e rola em vez de espremer. Conversa que acabou de responder fica 10 minutos em "Rodando agora".
- **Aplicações:** no computador, o app aberto fora da Mesa ocupa a tela só pra ele, e a barra mostra quantos apps
  couberem, com um "+N" pro resto.
- **Link de arquivo:** abre direto no modo foco, sem esperar a árvore carregar.

## 0.6.3 (16/10/2026)

- **Conta do agente não conectada:** no lugar do "Authentication required", a conversa diz que falta conectar a
  conta do Claude Code (ou do Codex) e tem um botão que leva direto pra Configurações › Contas de IA. Conectou, é só
  mandar a mensagem de novo.

## 0.6.2 (16/10/2026)

Melhorias no chat e nos agentes. Nada muda no que já existe.

- **Ler outra conversa:** "Copiar link da conversa", no ⋯. Colado numa conversa, o agente lê a outra (as mensagens,
  as notas e o que o agente de lá fez) pra juntar o contexto. Quem é dono colar o link na conversa de outra pessoa já
  libera só pra leitura.
- **Mensagem com o agente rodando:** o agente responde a ela antes de seguir com o que estava fazendo.
- **Último pedido fixo no topo:** numa conversa longa, o último pedido fica numa linha no alto; clicar volta até ele.
- **Menus da caixa do chat:** conta, modelo, esforço e aprovação com menus próprios, e o esforço máximo (ultracode)
  por conversa.
- **Trabalho no fundo:** o servidor de agentes não reinicia no meio de um comando, Monitor ou workflow que o agente
  deixou rodando, e retoma as conversas depois de religar (inclusive quando a VPS acabou de ligar).
- **Memória:** cada pessoa tem um piso garantido e o grupo um teto, no lugar de um limite fixo por pessoa; quando a
  memória aperta, conversa parada há 10 minutos dorme (e acorda sozinha quando tu volta nela).
- **Buscar na web:** skill nova `buscar-web-ratoeira`, pra quando um site bloqueia a VPS (LinkedIn, YouTube,
  Instagram): desce de jeitos gratuitos pros pagos, com as chaves que tu ligar.
- **Meus reportes:** no Reportar, o que tu já mandou e a resposta; quando a equipe marca um reporte como feito ou
  recusado com recado, chega um aviso no sino.

## 0.6.1 (16/10/2026)

Correções de segurança. Nada muda no jeito de usar.

- **Atualizações mais seguras:** o atualizador não segue mais atalhos (links) na pasta de pedidos, sempre responde
  à tela (mesmo quando algo inesperado dá errado) e só aplica versões do teu canal. Pra descer de versão, o caminho é
  o botão Voltar; o Atualizar não instala versão mais velha que a que está no ar.
- **Instalador:** rodar de novo numa VPS já instalada mantém o endereço do portal e o dos Publicados (inclusive um
  domínio teu); o firewall libera a porta de verdade do SSH, mesmo que não seja a 22; avisa com clareza quando a chave
  do Reportar foi guardada mas o envio não foi ligado; e mostra o motivo quando não consegue criar o usuário.
- **Reportar:** o diálogo diz que o teu e-mail e a versão vão junto, e que a Ratoeira *tenta* tirar senhas e chaves
  (antes prometia que tirava). O limpador também passou a pegar mais formatos de chave (1Password, Resend, Google,
  xAI, tokens JWT e linhas `NOME_DA_CHAVE=valor`).

## 0.6.0 (16/10/2026)

Primeira versão pra instalar numa VPS nova, fora de onde a Ratoeira é feita (beta fechado).

- **Instalar numa VPS nova:** um comando, numa VPS Ubuntu 24.04 limpa, sobe a Ratoeira inteira: HTTPS no nome que a
  VPS já tem (sem precisar de domínio), firewall, login próprio, multiusuário, navegador e ditado dos agentes, e um link
  de primeiro acesso pra criar a conta de quem administra.
- **Atualizações:** Configurações › Atualizações mostra a versão no ar, a nova e o que muda; o botão Atualizar (ou o
  pedido pro agente de quem administra) monta a versão nova ao lado, troca e confere. Se ela não subir, a de antes volta
  sozinha. Os teus arquivos, apps, rotinas, contas e configurações não são tocados.
- **Reportar:** o diálogo diz o que vai junto e pra quem vai (a equipe da Ratoeira), antes de enviar.
- **Guia da Ratoeira** novo em Apps, com o que dá pra fazer e por onde começar.

## 0.5.0 (12/10/2026)

Primeira versão com número de verdade. Até aqui a Ratoeira se identificava pelo commit de cada parte (gateway,
agentes, telas, regras); o portal dizia 0.4.0 e o kit dos alunos 0.1.0. O que ela tem nesta versão:

- **Mesa:** arquivos com árvore e abas, grade de painéis, editor que commita no nome de quem salvou, histórico, busca.
- **Chat** com Claude e Codex pelo servidor de agentes de cada pessoa (ACP): permissões, perguntas, imagens, ditado,
  comandos e skills com `/`, arquivo citado com `@`, medidor de contexto, cache e limites do plano.
- **Terminal** na grade.
- **Habilidades, Integrações** (registro do time, cofre de chaves do 1Password, MCPs) **e Automações** (rotinas do
  agente e scripts agendados).
- **Apps** com servidor próprio, login e papéis da Ratoeira, publicados pelo agente do admin.
- **Login próprio**, convite por link, várias pessoas, cada uma com usuário Linux e servidor de agentes; áreas do
  time e pastas restritas; contas do Claude da organização e de cada pessoa.
- **Celular**, botão Reportar, publicar a própria Ratoeira pelo chat do admin.
