# IANiza

Projeto atual: **login → escritório 3D com Lia, social media → conversa, perfil e configurações da conta**. A configuração inicial da empresa aparece em uma conversa própria, depois da conexão com o Claude. O modelo completo anterior fica separado em `apresentacao/`. O `codigo-beta/` permanece intacto e não é executado pelo projeto.

Uma instalação atende **uma única empresa**, na VPS de quem recebe o projeto. Pessoas convidadas entram nessa mesma empresa; não há cadastro nem alternância entre organizações. Veja [Instalação única e skills padrão](docs/instalacao-unica-e-skills.md).

## Executar

Requer Node.js 24 ou superior. Dependências fixadas no lockfile.

```sh
npm ci
npm run build
npm run dev
```

Abra http://127.0.0.1:4173/. Uma instalação nova mostra no terminal um link de primeiro acesso, de uso único e com validade de uma hora. Contas já criadas continuam disponíveis depois de reiniciar.

## Estrutura atual

- `src/app.js`: sessão, escritório, perfil e abertura do cérebro.
- `src/office-scene.js`: ambiente 3D, com Lia em uma estação, seleção pelo avatar ou cartão, rotação e zoom.
- `src/agents-ui.js` e `server/agents-store.mjs`: perfil da Lia, skills por função e conversa real via Claude, persistente por pessoa e separada da entrevista da empresa.
- `src/access.js`: login, primeiro acesso, senha e conta, sem sidebar.
- `src/brand-ui.js` e `src/brand-chat.js`: conexão antes da entrevista, conversa, anexos, resumo e estados de envio.
- `server/accounts.mjs`: autenticação e permissões persistentes.
- `server/brand-store.mjs`: entrevista, arquivos privados, perfil e versões confirmadas.
- `server/ai-runtime.mjs`: conexão real por ACP com os adaptadores usados pela base.
- `server/prompts/extrator-de-marca.md`: cópia da skill fornecida pelo usuário, usada como referência da entrevista.
- `scripts/build.mjs`: gera bundles separados para o projeto e a apresentação.

## Apresentação preservada

Abra http://127.0.0.1:4173/apresentacao/ após entrar. O modelo anterior, com integrantes, sessões, rotinas, tarefas e roteiro guiado, continua disponível. Seus dados de demonstração permanecem nas chaves originais do navegador; o projeto atual não os importa.

Código, estilos, documentação, testes e capturas do protótipo foram movidos para `apresentacao/`. Essa pasta é referência de produto e apresentação, separada da implementação funcional.

## Configuração da marca

Primeiro autorize a conta em **Perfil → Conexões de IA**. A entrevista só abre depois de o servidor verificar que o Claude está conectado. O modelo conversa de verdade por ACP; não há respostas simuladas na entrevista.

A pessoa envia textos e materiais, responde aos blocos da skill e confere o resumo. **Salvar no cérebro** confirma a versão. Propostas e lacunas ficam identificadas; números, casos e depoimentos não são inventados. A skill `minha-marca` pode ser baixada como um único `SKILL.md`.

- Enter envia; Shift+Enter quebra a linha. A mensagem aparece imediatamente com “Enviando…” e recebe a confirmação de entrega ao servidor.
- PDFs, PNG, JPG, WebP, TXT, Markdown e CSV: até 8 MB por arquivo, 12 arquivos e 24 MB por instalação.
- Arquivos e conversa ficam no servidor, com autenticação. A entrevista pode continuar depois.
- Sem um conector selecionado, links precisam de texto colado ou arquivo anexado.
- Lia é o primeiro e único agente funcional; o tour e os demais integrantes continuam na apresentação.

Veja [Marca, conexão e cérebro](docs/marca-e-cerebro.md) e [Autenticação](docs/acesso-e-convites.md).

## Skills e conectores

Em **Perfil → Skills**, consulte as cinco skills padrão do projeto (Extrator de marca, Texto humano, Benchmark de mercado, Carrossel modular e Criativos estáticos que convertem), edite nome, descrição e instruções, exclua ou restaure pacotes e importe outras skills por `.md` ou `.zip`. O upload binário é validado no servidor antes da confirmação, com até 24 MB por ZIP e limites de expansão. A marca confirmada também aparece no catálogo. No chat, selecione as skills antes de enviar. Scripts importados ficam como referência; não são executados.

Em **Perfil → Conectores**, cadastre um endereço MCP HTTP com token ou cabeçalhos, teste a conexão e veja as ferramentas disponíveis. No chat geral, escolha os conectores e autorize cada execução com **Permitir esta vez** ou **Recusar**. O cadastro é persistente e as credenciais ficam criptografadas. O **Higgsfield já vem como padrão**, com login próprio por OAuth em **Conectar Higgsfield**. O **Meta Ads também tem fluxo de conexão**, com configuração de App ID próprio e endereço de retorno antes do login no Facebook; a Meta recusou o registro automático da IANiza. OAuth para outros serviços e associação individual de conectores aos agentes ficam para outra etapa; Lia não usa conectores diretos.

Veja [Importação segura de skills](docs/importacao-segura-skills.md) e [Skills e conectores](docs/skills-e-conectores.md), incluindo armazenamento e preparação para VM. A distribuição de responsabilidades está em [Agentes, skills e conectores](docs/agentes-skills-e-conectores.md), com a matriz em `config/marketing-agent-skills.json`. Lia usa esse mapa para restringir suas skills no servidor. Scripts, workers e conectores diretos da Lia continuam desabilitados.

## Lia no escritório

Clique no avatar 3D, no rótulo **Lia · Social media** ou no cartão **Seu time**. O painel apresenta conversa, atividades e skills da função. Ela organiza pautas e calendário, prepara textos e estruturas de carrosséis e analisa referências fornecidas. A conversa usa a conexão real do Claude, consulta somente a versão aprovada da marca e fica salva por pessoa em `.data/agents.sqlite`.

Selecione até três skills disponíveis por pedido. As skills do Benchmark System aparecem como **Integração pendente**. Coleta externa, transcrição, geração de imagens, publicação e coordenação com outros integrantes ainda não são executadas pela Lia. Se a conexão falhar, a mensagem permanece salva e pode ser reenviada sem duplicar o histórico.

## Dados e verificação

`.data/access.sqlite` guarda contas, sessões e convites; `.data/brain.sqlite` guarda a entrevista, os anexos e versões confirmadas. As skills do catálogo ficam em `.data/skills/`, com lixeira e versões anteriores em `.data/skill-trash/`. A pasta legada `.data/organizations/<id>/` continua guardando anexos e a marca desta única empresa para preservar os dados existentes; o UUID não é um recurso de múltiplas empresas. Todos esses diretórios são privados, ignorados pelo Git e não são servidos como conteúdo público. Credenciais de Claude/Codex são administradas pelos próprios CLIs.

```sh
npm test
```

Os testes cobrem acesso, persistência, uploads, revisão do perfil, estados de envio e o protótipo preservado. Os testes HTTP precisam abrir uma porta local temporária.

O servidor escuta somente em loopback. Publicação HTTPS, compartilhamento externo e isolamento de CLIs entre instalações precisam ser configurados para a VPS. As APIs de convites permanecem disponíveis no backend; a gestão visual anterior foi preservada em `apresentacao/referencia/` para implementação posterior.
# IANisa
