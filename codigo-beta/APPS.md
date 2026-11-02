# Aplicações na Ratoeira: o padrão

Pra quem (pessoa ou agente) vai criar ou mudar uma aplicação que roda dentro da Ratoeira. Siga na ordem e termine pelo checklist. Este arquivo é genérico: vale pra qualquer instalação da Ratoeira.

**Aplicação**, aqui, é um sistema com servidor próprio: um CRM, um painel financeiro, um controle de pedidos. Ela abre numa aba da Ratoeira, ao lado dos arquivos e do chat, usa o login e os papéis da Ratoeira, e conversa pelo chat da Ratoeira (o agente da pessoa usa as ferramentas dela).

Página HTML estática, sem servidor, não precisa disto: vai pro menu Aplicações como página simples.

## Regras de ouro

1. **Comece pelo esqueleto** (abaixo). Nada de inventar estrutura própria.
2. **Sem login próprio.** Quem é a pessoa e qual o papel dela vêm da Ratoeira, assinados. Nada de tela de login, senha, cadastro ou convite no app.
3. **SQLite na pasta de dados do app.** Banco à parte (Postgres) só com um motivo da lista da seção "Banco".
4. **Sem Docker**, a não ser que seja software de terceiro que só existe assim. App nosso roda direto na máquina, como serviço do systemd, com usuário próprio. Nunca como root.
5. **Sem chat próprio.** O chat é o da Ratoeira. O agente de quem conversa mexe nos dados do app direto (seção "Dados") e o app diz o que está na tela. Ferramenta (MCP) é opcional.
6. **Uma camada de regras só.** Tela e ferramenta chamam as mesmas funções, e é nelas que mora o "pode ou não pode" de cada papel.
7. **Efeito fora do app** (mandar e-mail, marcar na agenda, cobrar, publicar) **sempre em dois passos:** prepara, e uma pessoa confirma. O modelo nunca confirma sozinho.

## Esqueleto

```
<nome>/
  README.md        o que o app faz, os papéis, como rodar local
  ratoeira-app.json  o manifesto (abaixo)
  servidor...      qualquer linguagem
  migracoes/       001-inicio.sql, 002-...; a versão aplicada fica em PRAGMA user_version
  agente/
    AGENTS.md      como o agente usa o app: o que cada ferramenta faz, fluxos comuns, cuidados
    skills/        (opcional) skills que o agente usa quando conversa sobre o app
```

O manifesto descreve o app num lugar só. A Ratoeira lê esse arquivo quando alguém publica o app (seção "Pôr no ar"): é a fonte de verdade do app. A pasta do app fica em `<área>/apps/<pasta>/`.

```json
{
  "nome": "pedidos",
  "titulo": "Pedidos",
  "descricao": "Pedidos dos clientes, do orçamento à entrega.",
  "porta": 8790,
  "preparar": "python3 -m venv $AMBIENTE/venv && $AMBIENTE/venv/bin/pip install -q -r requirements.txt",
  "iniciar": "exec $AMBIENTE/venv/bin/gunicorn --bind 127.0.0.1:$PORTA app:app",
  "saude": "/saude",
  "papeis": ["admin", "equipe", "leitura"],
  "publico": [],
  "pacotes": ["sqlite3"],
  "chaves": ["ERP_TOKEN"],
  "memoria": "512M",
  "cpu": "50%",
  "rotinas": [{ "nome": "sincronizar", "comando": "exec $AMBIENTE/venv/bin/python sincronizar.py", "intervalo": "30min" }],
  "chat": { "mcp": "/mcp", "agente": "agente/" }
}
```

Campo desconhecido faz a publicação ser recusada. Os campos:

| Campo | O quê |
|---|---|
| `nome` | minúsculas, números e hífen. Vira o endereço (`/<nome>/`) e o usuário Linux (`app-<nome>`) |
| `titulo`, `descricao` | o que aparece no menu de Apps |
| `porta` | onde o app escuta, em `127.0.0.1` (1024 a 65535, sem repetir a de outro app) |
| `preparar` | (opcional) instala as dependências. Roda como o usuário do app, com a pasta do código como diretório atual. Só pode escrever em `$AMBIENTE` |
| `iniciar` | o comando do servidor, uma linha. Roda na pasta do código |
| `saude` | (padrão `/saude`) rota que responde quando o app está de pé. A publicação espera ela antes de dar por pronto |
| `papeis` | os papéis que o app aceita, **do que pode mais pro que pode menos**. App publicado nasce liberado pra todo mundo com o **último** papel da lista; quem publicou e quem administra a Ratoeira entram com o **primeiro**. Na tela de Pessoas dá pra trocar o papel de alguém ou bloquear ("Sem acesso") |
| `publico` | subcaminhos que abrem sem login (ex.: `["/p/"]` pra link de proposta) |
| `pacotes` | (opcional) pacotes do sistema (apt). Só instala os que o admin liberou em `/etc/ratoeira/pacotes-permitidos` |
| `chaves` | (opcional) nomes das chaves de API que o app lê do ambiente. Os valores ficam em `/etc/ratoeira/apps/<nome>/chaves.env` (root, 600); quem administra grava pelo chat com `definir_chaves_app` (abaixo, "Pôr no ar"), sem root. A tela avisa as que faltam |
| `ambiente` | (opcional) configuração que não é segredo, ex.: `{"IDENTIDADE": "ratoeira"}`. Texto literal, sem aspas; não troca as variáveis fixas abaixo |
| `memoria`, `cpu` | teto do app (padrão `512M` e `50%`) |
| `rotinas` | (opcional) tarefas periódicas: `nome`, `comando` e `quando` (calendário do systemd, ex.: `"*-*-* 03:00"`) ou `intervalo` (ex.: `"30min"`, conta do fim da passada) |
| `chat` | como o app conversa pelo chat da Ratoeira (seção "Chat e ferramentas") |

## Como roda

Depois de publicado, a Ratoeira cuida disto. O manifesto não escolhe nada desta lista.

- **Processo:** serviço do systemd `ratoeira-app@<nome>`, com usuário Linux próprio (`app-<nome>`). Nunca root e nunca a conta de uma pessoa: app de time não pode depender de quem criou. Com teto de memória e CPU, sem poder escrever fora da pasta de dados.
- **Código:** uma cópia em `/opt/ratoeira/apps/<nome>/codigo`, de dono root. O app lê, mas não muda o próprio código. Publicar de novo troca a cópia; se a versão nova não responder na rota de saúde, a anterior volta.
- **Endereço:** escuta só em `127.0.0.1:$PORTA`. Nunca em `0.0.0.0`. A Ratoeira repassa `<endereço da Ratoeira>/<nome>/` pra essa porta, depois de conferir o login. O app precisa funcionar debaixo desse prefixo: links relativos, `<base href>` ou o prefixo do framework (ex.: `SCRIPT_NAME`).
- **Variáveis que o app recebe:** `PORTA`, `DADOS` (banco e uploads: `/var/lib/ratoeira/apps/<nome>`, só do app), `AMBIENTE` (o que o `preparar` instalou), `RATOEIRA_APP` (o nome), `RATOEIRA_BASE` (`/<nome>`), `HOME` (igual a `DADOS`) e as `chaves`. O segredo de identidade chega como credencial do systemd: arquivo `$CREDENTIALS_DIRECTORY/ratoeira-segredo`.
- **Dados:** sempre em `$DADOS`. Nada de dado dentro da pasta do código. **A pasta é dividida com o time da área** de onde o app veio (grupo da área, setgid e ACL padrão pro app e pro grupo): o agente de cada pessoa lê e muda o banco e os arquivos direto, e o texto fixo dos agentes diz onde fica cada app (`ratoeira-instrucoes`, regerado a cada publicação). Por isso o app **relê do disco** o que pode ter mudado por fora (nada de guardar estado só em memória) e mantém o formato dos dados legível pra quem lê o código: migrações em `migracoes/` e o `agente/AGENTS.md` dizendo onde fica o quê.
- **Segredos:** nunca no código nem no git. Token de integração (Google, ERP...) guardado no banco vai cifrado com uma chave das `chaves`.
- **Tarefas periódicas:** as `rotinas` do manifesto, que viram timers do systemd. Nada de cron.

## Identidade: quem é a pessoa

Em todo pedido que não é link público, a Ratoeira manda:

```
x-ratoeira-identidade: <payload>.<assinatura>
```

- `payload` = base64url sem `=` de um JSON: `{"email", "nome", "app": "/<nome>", "papel", "exp"}`. Quando a pessoa tem ambiente próprio na VPS, vêm também `usuario` e `uid` (o usuário Linux dela).
- `assinatura` = base64url sem `=` do HMAC-SHA256 do texto `payload`, com o segredo do app.
- `exp` = agora + 60 s.

O app faz:
1. Sem cabeçalho, assinatura errada (compare em tempo constante), `exp` vencido, `app` diferente do seu ou papel que ele não conhece: **401** com uma página curta "Abra pela Ratoeira".
2. Pessoa nova é criada no primeiro pedido, pela chave `email`. Nome e papel são atualizados a cada pedido, com o que a Ratoeira manda.
3. Papel é da Ratoeira: o app declara a lista (`papeis`). Quem não tem papel definido recebe o último da lista (o app nasce liberado); quem administra troca ou bloqueia na tela de Pessoas. Ponha por último o papel que é seguro dar pra todo mundo.

Escrita pela tela (POST, PUT, DELETE) exige também um cabeçalho próprio do app (ex.: `X-<Nome>: 1`), que formulário de outro site não consegue mandar.

## Banco

**SQLite por app é o padrão.** Ele roda dentro do processo, sem ida e volta pela rede, e é rápido de sobra pra um time. Não tem serviço pra manter, e o backup é um arquivo.

- `PRAGMA journal_mode=WAL`, `busy_timeout` de uns 15 s e `foreign_keys=ON` em toda conexão.
- Escrita em transação curta (`BEGIN IMMEDIATE` se tem mais de um processo).
- Migrações numeradas em `migracoes/`, aplicadas na subida, com a versão em `PRAGMA user_version`.
- Backup: `sqlite3 banco.db ".backup destino"` (cópia segura com o app rodando), mais uma cópia fora da máquina.

**Postgres só se tiver um destes motivos:** muitas escritas ao mesmo tempo o tempo todo, busca vetorial ou de texto pesada, dado que mais de um app lê e escreve, banco de vários GB com consulta analítica. Aí é um banco e um usuário só pro app, num Postgres da máquina.

## Tela

- Qualquer stack. Página simples renderizada no servidor + JS leve costuma bastar.
- `<title>` no formato `<Tela> · <Nome do app>` (ex.: `Cliente Acme · Pedidos`).
- Funciona dentro de um iframe da própria Ratoeira: nada de `X-Frame-Options: DENY` (`SAMEORIGIN` serve) e nada de navegar a página de cima (`window.top`).
- **Toda página carrega a ponte da Ratoeira**, antes dos scripts do app:
  ```html
  <script src="/_ratoeira/app.js"></script>
  ```
  Ela cria `window.ratoeira`:

  | | Pra quê |
  |---|---|
  | `ratoeira.tela({titulo, detalhe})` | diz o que está na tela. Vira a etiqueta do chat e o contexto da mensagem. Sem chamar, vale o `<title>`. `detalhe` é o que está aberto por cima (um card, um painel lateral): chame com o nome quando abre e com `null` quando fecha |
  | `ratoeira.chat.nova(texto)` | botão que pede algo ao chat (ex.: "Gerar resumo do cliente"): conversa nova já com o pedido. O texto vai com as quebras de linha, até 20 mil caracteres, e espera o chat carregar se a página acabou de abrir |
| `ratoeira.chat.nova(texto, {enviar: false})` | igual, mas o pedido fica na caixa da conversa nova, sem mandar: a pessoa edita ou completa antes (ex.: "Arrumar com o agente") |
  | `ratoeira.chat.escrever(texto)` | põe o texto na caixa da conversa em uso, sem mandar (ex.: "Sobre Acme: ") |
  | `ratoeira.chat.abrir(agente, sessao, titulo)` | abre no chat uma conversa que já existe, da própria pessoa (`agente`: `claude`, `codex`...; `sessao`: o id da sessão). Ex.: o app de Sessões abrindo uma sessão antiga |
  | `ratoeira.chat.abrir(agente, sessao, titulo, {texto, enviar})` | igual, e escreve o `texto` na caixa dela depois que abre (`enviar: true` manda; sem, fica pra pessoa completar). Ex.: um app de revisão mandando os apontamentos pra conversa que fez o documento |
  | `ratoeira.aoTerminar(fn)` | o agente terminou de mexer: a tela busca os dados de novo |
  | `ratoeira.embutido` | `true` quando o app está numa aba da Ratoeira |

- **Toda janela interna avisa o chat.** Card, gaveta, painel lateral, formulário, aba interna, resumo expandido: tudo que muda o que a pessoa está vendo sem mudar o endereço chama `ratoeira.tela({detalhe})` ao abrir e `ratoeira.tela({detalhe: null})` ao fechar. Sem isso, a pessoa pergunta "o que falta nesse cliente?" e o agente não sabe qual cliente.
  - **Camadas:** coisa aberta dentro de coisa aberta (um formulário dentro do card) vira um detalhe só, do de baixo pro de cima, separado por ` › `: `Acme (pedido 42) › Editar entrega`. Um ajudante de poucas linhas no app guarda a pilha (abre empilha, fecha tira) e manda o texto junto.
  - **Identificador junto:** ponha no texto o id do jeito que as ferramentas chamam (`Acme (pedido 42)`, `Reunião "Kickoff", 10/10 14:00 (reunião 7)`). O agente vai direto, sem buscar.
  - **Fecha por qualquer caminho:** janela que fecha pelo ×, pelo Esc e pelo clique fora avisa nos três. Observar a classe ou o atributo que abre e fecha a janela é mais seguro que embrulhar cada função de fechar.
- **O app não tem chat próprio.** Dentro da Ratoeira, quem conversa é o chat do lado. Aberto sozinho, a ponte mostra um botão "Abrir com o chat" que leva pro modo foco: a mesma página, com o chat do lado. Ali, `chat.nova` e `chat.escrever` só preenchem a caixa, nunca mandam. `<html data-ratoeira-sem-botao>` esconde o botão.
- Se a página não carregou a ponte (ex.: o app rodando fora da Ratoeira, num teste), `window.ratoeira` não existe: use `window.ratoeira?.` e siga sem chat.

## Chat e ferramentas (MCP), opcional

**O caminho principal é o agente mexer nos dados direto** (seção "Como roda", Dados): a pessoa pede no chat, o agente lê o código do app e grava no banco ou na pasta. Nada precisa ser mapeado antes. Ferramenta MCP fica pro que precisa dela: efeito fora do app com confirmação de pessoa (seção "Confirmação"), ou um atalho pra uma tarefa muito repetida. Em teste desde 09/10/2026: se o acesso direto bastar, as ferramentas saem.

O agente da pessoa (Claude Code, Codex...) conversa pelo chat da Ratoeira e, se o app oferece, usa as ferramentas dele. Quando a pessoa põe a etiqueta do app na mensagem (ela aparece apagada, como sugestão, e um clique põe), a Ratoeira liga a conversa ao app. Os botões do app que usam `ratoeira.chat` já mandam com a etiqueta posta.

### O que o app oferece

A Ratoeira cuida do encanamento: emite o token de cada conversa, guarda a mensagem que a pessoa digitou e repassa as chamadas do agente pro app. O app só oferece:

1. **Servidor MCP** no caminho do manifesto (ex.: `/mcp`, debaixo do prefixo: `/<nome>/mcp`), HTTP com JSON-RPC por POST. O agente chama pelo gateway (`http://127.0.0.1:<porta da Ratoeira>/_ratoeira/mcp/<nome>`), e o gateway repassa com:
   - `x-ratoeira-identidade`: o mesmo cabeçalho assinado da tela, com três campos a mais: `via: "chat"`, `conversa` (id da conversa) e `mensagem_sha` + `mensagem_em` (hash sha256, 32 primeiros caracteres em hex, e hora em segundos da última mensagem que a pessoa digitou);
   - `x-ratoeira-mensagem`: essa mensagem, em base64url.

   O app confere a identidade como em qualquer pedido, e confere que o sha256 da mensagem bate com `mensagem_sha`. Se não bater, trata como "sem mensagem". Sem identidade válida: 401. O app não emite token nem guarda sessão.
2. **`agente/AGENTS.md`**: como o agente usa o app. Com `"chat": {"agente": "agente/"}` no manifesto, a Ratoeira manda o agente de quem conversa ler o `AGENTS.md` dessa pasta, na cópia publicada. Se as instruções dependem da pessoa (papel, pasta de trabalho só dela), o app oferece uma rota opcional `POST /<nome>/<pasta>` (com a identidade da pessoa) que prepara a pasta e devolve `{"pasta": "<caminho absoluto>"}`, legível pelo usuário Linux dela. A Ratoeira manda o agente ler o `AGENTS.md` dessa pasta.

### Configuração do chat (no gateway)

```json
"chat": {
  "mcp": "mcp",
  "pasta": "api/chat/pasta",
  "cabecalhos": {"X-Pedidos": "1"}
}
```

`mcp` é obrigatório; `pasta` e `cabecalhos` (vão na chamada da pasta, que sai do navegador) são opcionais. App publicado pela Ratoeira recebe isso do manifesto (`"chat": {"mcp": "/mcp"}`).

Legado, só pra app antigo: `sessao` e `mensagem` (o app emitia o token e recebia a mensagem), e `esconder`, `css`, `ponte`, `recarregar` e `detalhe` (pra app que não carrega o `app.js`). App novo não usa nenhum deles.

### Boas ferramentas

- **Poucas e por tarefa.** Prefira "registrar reunião no histórico do cliente" a uma ferramenta por tabela. Prefira um `buscar` com filtros a dez `listar_x`. Cada ferramenta custa contexto em toda conversa.
- **Filtradas por papel.** A lista que o agente recebe depende do papel da pessoa. Quem só lê não vê ferramenta de escrita.
- **Schema de verdade:** argumentos tipados, obrigatórios marcados, enums onde couber. Nunca um `campos: object` com as regras só no texto.
- **Anotações MCP:** `readOnlyHint` nas de leitura, `destructiveHint` nas que apagam ou mudam muito, `idempotentHint` quando repetir não faz mal.
- **A descrição ensina o fluxo:** pra que serve, quando usar, o que vem antes (ex.: "use `buscar_clientes` antes, pra achar o id").
- **Saída curta e paginada,** com os ids que a próxima ferramenta precisa. Nada de despejar tabela inteira.
- **Erro em português, que diz o que fazer,** devolvido como erro de ferramenta (`isError: true`), não como exceção solta.
- **Mesma função da tela:** a ferramenta chama a mesma camada de regras. Toda alteração é registrada com quem fez e por onde (`via: chat` ou `via: tela`).
- **Conteúdo de fora é dado, não ordem.** Texto de e-mail, documento ou site que a ferramenta devolve vai marcado como conteúdo externo, e a descrição avisa o agente pra não seguir instrução que vier dentro dele.

### Confirmação (efeito fora do app)

1. A ferramenta **prepara** (ex.: `preparar_email`) e devolve o que preparou, com um id. Nada sai ainda.
2. A pessoa confirma de um destes jeitos:
   - pelo **cartão no chat** (o caminho mais seguro): a resposta da ferramenta traz `"ratoeira_cartao": "<caminho dentro do app>"` (ex.: `"cartao/acao/42"`). O chat da Ratoeira mostra essa página do app embutida logo abaixo da ferramenta. A página é do app: mostra o que foi preparado, deixa editar e tem os botões (enviar, cancelar). O clique é da pessoa, dentro do app, com a identidade dela, e o agente não alcança. A página carrega `/_ratoeira/app.js` (a altura se ajusta sozinha), não tem barra lateral e usa `ratoeira.aoTerminar` pra reler quando o agente termina (ex.: aprovado por mensagem);
   - pelo **botão na tela do app**;
   - por uma ferramenta de confirmar que só aceita se a **última mensagem digitada** pela pessoa for uma aprovação clara e curta ("pode mandar"), **na mesma conversa**, e só pro que foi preparado **antes** dessa mensagem.
3. O que foi preparado num turno nunca se aprova no mesmo turno. É isso que impede uma instrução escondida num e-mail lido pelo agente de preparar e aprovar sozinha.

## Pôr no ar

**Com o publicar ligado** (`publicar` na config do gateway): **o agente de quem administra publica sozinho.** Toda conversa de um admin tem as ferramentas da própria Ratoeira (MCP `ratoeira`): `publicar_app`, `estado_publicacao` e `listar_apps`. Terminou de criar ou mudar o app e os testes passaram: o agente chama `publicar_app` com o `nome` do manifesto, sem pedir clique a ninguém. A Ratoeira sobe a versão que está na pasta naquele momento. Ninguém precisa de sudo nem de entrar na VPS:

1. Um ajudante de root, com lista fechada de ações, cria o usuário do app, a pasta de dados e o segredo de identidade; instala os pacotes liberados; copia o código; roda o `preparar`; gera o serviço e os timers; liga e espera a rota de saúde.
2. Deu certo: o app entra no menu sem reiniciar a Ratoeira (a tela aberta se atualiza sozinha quando a resposta do agente termina). Falhou: a ferramenta devolve o motivo e o fim do log (a tela de Apps mostra o mesmo), e a versão anterior (se tinha) segue no ar. O agente corrige e publica de novo.
3. Quem publicou o app pela primeira vez e quem administra a Ratoeira já entram com o **primeiro** papel da lista (o que pode mais); o resto abre com o último. Na tela de Pessoas, troque o papel de quem precisa de mais e bloqueie quem não deve ver.
4. Se faltarem chaves, a ferramenta avisa quais. **O agente de quem administra grava, sem root** (desde 28/10/2026): escreve os valores em `~/.config/ratoeira/chaves-apps/<nome>.env` (`NOME=valor` por linha, modo 600; com `umask 077` antes de criar), sem mostrar valor na conversa (chave do cofre vai direto: `op read "op://Vault/item/campo" `, com o resultado redirecionado pro arquivo), e chama `definir_chaves_app` com o `nome`. O ajudante de root junta no `chaves.env` só os nomes declarados em `chaves`, apaga o arquivo de origem e publica de novo; a resposta traz só os nomes.
5. Abra pela barra da Ratoeira e rode o checklist.

Mudou o código: o agente publica de novo. Conversa de quem não é admin não tem essas ferramentas: o agente avisa que está pronto e pede pra um admin publicar (no chat dele, "publica o app <nome>").

**Sem o publicar ligado** (instalação antiga): quem tem sudo na VPS cria o usuário do app, a pasta de dados, o segredo (`openssl rand -base64 32`, legível pelo app e pelo gateway), o serviço do systemd com as travas acima, e uma entrada em `apps` na config do gateway (`prefix`, `port`, `name`, `description`, `papeis`, `public`, `segredo`, `chat`). Depois, reinicia o gateway.

## Checklist

- [ ] Esqueleto completo: `README.md`, manifesto, `migracoes/`, `agente/AGENTS.md`.
- [ ] Escuta só em `127.0.0.1`; roda com usuário próprio, sem root; dados em `/var/lib/<nome>/`.
- [ ] Sem o cabeçalho de identidade (ou com ele adulterado), toda rota não pública dá 401.
- [ ] Nenhuma tela de login, senha ou cadastro; papel vem da Ratoeira e é conferido na camada de regras.
- [ ] SQLite com WAL, migrações numeradas com `user_version`, backup testado.
- [ ] Nenhum segredo no código ou no git.
- [ ] Abre dentro da aba da Ratoeira, debaixo do prefixo, com `<title>` no formato certo.
- [ ] O app relê do disco o que o agente pode mudar por fora; `agente/AGENTS.md` diz onde fica cada dado (banco, tabelas, pastas).
- [ ] (Se tiver MCP) `/mcp` recusa pedido sem identidade válida (401) e confere o hash da mensagem antes de usar ela como aprovação.
- [ ] (Se tiver MCP) Ferramentas com schema, anotações, filtro por papel, erro em português; registram `via: chat`.
- [ ] Efeito fora do app só em dois passos, com confirmação de pessoa; a ferramenta que prepara devolve `ratoeira_cartao` e a página do cartão funciona embutida no chat.
- [ ] Toda página carrega `/_ratoeira/app.js`; a etiqueta do chat mostra a tela certa e **cada janela interna** (card, gaveta, formulário...) aparece no detalhe com o id, em camadas, e some ao fechar por qualquer caminho; os botões que pedem algo ao chat usam `ratoeira.chat`; a tela recarrega em `ratoeira.aoTerminar`; aberto sozinho, aparece "Abrir com o chat".

## Para onde o padrão vai

Isto muda sem quebrar app que já segue o padrão:
- A Ratoeira lê o manifesto e põe o app no ar sozinha, sem passo de administrador.
- O app escuta num socket que só a Ratoeira abre, no lugar da porta.
- Cada app ganha endereço próprio.
