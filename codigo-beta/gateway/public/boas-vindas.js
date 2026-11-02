'use strict';
// Boas-vindas da primeira vez (docs/2026-10-17-boas-vindas.md): uma janela curta de passos, um tour com balões em
// cima da barra de verdade, a lista "Primeiros passos" na Início e o painel Configurações › Endereços.
// Fica num arquivo à parte do portal.js: só fala com ele pelo evento "ratoeira:portal" (dados do /portal),
// "ratoeira:view" (troca de tela) e pelas funções que ele e o chat.js põem na window.
(() => {
  const $=id=>document.getElementById(id);
  const el=(tag,cls,txt)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(txt!==undefined)e.textContent=txt;return e;};
  const botao=(txt,fn,cls='')=>{const b=el('button',cls,txt);b.type='button';b.onclick=fn;return b;};
  const toast=t=>window.ratoeiraToast?.(t);
  async function api(caminho,opcoes={}){
    const r=await fetch('/_ratoeira/api'+caminho,{credentials:'same-origin',...opcoes,headers:{'Content-Type':'application/json',...(opcoes.headers||{})}});
    let d;try{d=await r.json();}catch{throw new Error('Não deu pra ler a resposta.');}
    if(!r.ok)throw new Error(d.error||'Não deu certo. Tenta de novo.');
    return d;
  }
  const post=(caminho,corpo)=>api(caminho,{method:'POST',body:JSON.stringify(corpo)});
  // Ícones de traço, desenhos fixos daqui (nada do servidor entra no innerHTML).
  const ICONES={
    github:'<path d="M9 19c-4 1.3-4-2-6-2.5M15 21v-3.5a3 3 0 0 0-.9-2.4c3-.3 6-1.5 6-6.6a5 5 0 0 0-1.4-3.6 4.7 4.7 0 0 0-.1-3.6s-1.1-.3-3.7 1.4a12.6 12.6 0 0 0-6.6 0C5.7 1 4.6 1.3 4.6 1.3a4.7 4.7 0 0 0-.1 3.6A5 5 0 0 0 3 8.5c0 5 3 6.3 6 6.6a3 3 0 0 0-.9 2.4V21"/>',
    computador:'<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
    zero:'<path d="M12 5v14M5 12h14"/>',
    ok:'<path d="m5 12.5 4.5 4.5L19 7.5"/>',
    copiar:'<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
    escudo:'<path d="M12 3 5 6v6c0 4.4 3 7.6 7 9 4-1.4 7-4.6 7-9V6z"/>',
    globo:'<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
    pronto:'<path d="M12 3l1.9 4.9 4.9 1.9-4.9 1.9L12 16.6l-1.9-4.9-4.9-1.9 4.9-1.9z"/>',
    plug:'<path d="M9 7V3m6 4V3M7 7h10v4a5 5 0 0 1-10 0z"/><path d="M12 16v5"/>',
    aviso:'<path d="M12 4 2.5 20h19z"/><path d="M12 10v4.5M12 17.5h.01"/>',
  };
  const icone=n=>{const s=document.createElementNS('http://www.w3.org/2000/svg','svg');s.setAttribute('viewBox','0 0 24 24');s.setAttribute('aria-hidden','true');s.innerHTML=ICONES[n];return s;};

  let P=null,BV=null;   // dados do /portal e das boas-vindas
  const admin=()=>Boolean(BV?.admin);
  const pasta=()=>BV?.pasta||P?.chat?.pastaPadrao||'a pasta de trabalho';
  const nome=()=>{const n=P?.user?.name||'';return n.includes('@')?'':n.split(' ')[0];};

  // Abre uma conversa com o pedido pronto (chat.js). A janela vira lingueta na borda, pra pessoa acompanhar a conversa.
  function conversa(texto){
    if(!window.ratoeiraNovaConversa){toast('O chat ainda não está pronto. Tenta de novo em uns segundos.');return;}
    minimizar();window.ratoeiraNovaConversa({texto});
  }
  // Bloco pra copiar (texto pra colar no Claude do computador)
  function blocoCopiar(texto){
    const box=el('div','bv-copiar'),pre=el('pre','',texto);
    const b=botao('Copiar',async()=>{try{await navigator.clipboard.writeText(texto);b.replaceChildren(icone('ok'),document.createTextNode('Copiado'));setTimeout(()=>b.replaceChildren(icone('copiar'),document.createTextNode('Copiar')),2500);}catch{toast('Não consegui copiar. Seleciona o texto e copia à mão.');}},'bv-copiar-btn');
    b.replaceChildren(icone('copiar'),document.createTextNode('Copiar'));
    box.append(pre,b);return box;
  }

  // ── Pedidos prontos ──
  // Um projeto só vai pra raiz com o git dele. Vários: cada um numa subpasta, sem o .git dele (a pasta de trabalho já é um
  // repositório; um git dentro do outro some da Mesa e do envio pro GitHub). A pessoa não precisa ouvir falar disso.
  const PERGUNTA_PROJETOS='Me pergunta, em palavras simples, se nesta Ratoeira eu vou trabalhar só nesse projeto ou se vou ter outros também (outros projetos, clientes ou negócios).';
  const PEDIDO_GITHUB=()=>`Quero trazer o meu trabalho, que está num repositório do GitHub, pra esta Ratoeira, na pasta de trabalho (${pasta()}). Vamos passo a passo, comigo:
1. Confere se o \`gh\` está instalado e logado no meu usuário. Se não estiver, faz o login pelo código de dispositivo (\`gh auth login --web --git-protocol https\`) e me mostra o código e o link pra eu autorizar no navegador.
2. Lista os meus repositórios e me pergunta qual é.
3. ${PERGUNTA_PROJETOS}
4. Traz o repositório. Nada de sudo dentro da pasta: os arquivos ficam com o meu usuário e com escrita pro grupo dela.
   - Só esse projeto: vai pra raiz da pasta de trabalho. Se ela só tem o git vazio da instalação, liga o remoto e baixa a branch principal ali mesmo. Se já tiver algum arquivo meu, me mostra o que tem e pergunta antes de mexer.
   - Vários: vai numa subpasta com o nome do projeto (minúsculas e hífen, ex.: ${pasta()}/meu-projeto; confirma o nome comigo). Clona numa pasta temporária e copia só os arquivos, sem a pasta .git dele, e commita na pasta de trabalho. Não me explica o porquê do git, só faz.
5. Liga um envio automático: a cada 15 minutos, manda pro GitHub o que mudou aqui e traz o que mudou lá (commit, \`git pull --rebase\`, \`git push\`), como uma automação minha da Ratoeira (no meu crontab da Ratoeira, pelo ratoeira-cron). Se der conflito, para e me avisa, sem forçar nada. Com vários projetos, o envio é da pasta de trabalho inteira: cria um repositório privado novo pra ela na minha conta e me diz, numa linha, que daqui pra frente é esse o repositório que vale (no computador também).
6. No fim, me mostra o link do repositório, quantos arquivos chegaram, em que pasta e quando foi o último envio.`;
  const PEDIDO_COPIA=()=>`Quero trazer a pasta do meu trabalho, que está aqui no meu computador, pra minha Ratoeira (a VPS que tu me ajudou a instalar). Vamos passo a passo, comigo:
1. Me pergunta qual pasta é, se eu ainda não disse, e me mostra o tamanho dela.
2. ${PERGUNTA_PROJETOS}
3. Manda o conteúdo pela conexão SSH que a gente configurou na instalação (o apelido \`ratoeira\` no ~/.ssh/config). Usa rsync, sem levar node_modules, .venv, pastas de build, vídeos grandes e arquivos .env (chave fica fora).
   - Só esse projeto: vai pra raiz da pasta de trabalho, ${pasta()}. Se a pasta tiver git, leva o histórico junto (a pasta .git) no lugar do git vazio que está lá.
   - Vários: vai numa subpasta com o nome do projeto (minúsculas e hífen, ex.: ${pasta()}/meu-projeto; confirma o nome comigo), sem a pasta .git dele. Não me explica o porquê do git, só faz.
4. Lá na VPS, acerta o dono: \`chown -R ${BV?.usuario||'<meu usuário da Ratoeira>'}:$(stat -c %G ${pasta()}) ${pasta()}\` e \`chmod -R g+rwX ${pasta()}\`.
5. Me diz quantos arquivos chegaram e em que pasta. Daí em diante eu sigo pela Ratoeira.`;
  const PEDIDO_SUBIR_GITHUB=`Quero pôr a minha pasta de trabalho, que está aqui no meu computador, num repositório privado do GitHub, pra depois ligar ele na minha Ratoeira. Vamos passo a passo, comigo:
1. Me pergunta qual pasta é, se eu ainda não disse.
2. Se ela ainda não tem git, cria (git init) com um .gitignore que deixe de fora .env, node_modules, .venv, vídeos e arquivos pesados. Se já tem, confere esse .gitignore antes de mandar.
3. Cria um repositório privado na minha conta do GitHub com o \`gh\` (instala e faz o login comigo se precisar) e manda tudo.
4. Me devolve o link do repositório. Depois eu volto na Ratoeira e escolho "No GitHub".`;
  const PEDIDO_INTEGRACAO=(nomeInt,pra,dica)=>`Quero ligar a integração ${nomeInt} (${pra}) no meu Claude Code aqui da Ratoeira, como MCP no escopo de usuário (vale em qualquer pasta). ${dica} Consulta a documentação atual pra usar o jeito oficial de instalar. Se precisar de chave ou token, me diz onde gerar e me pede; não repete a chave na resposta nem salva em arquivo do repositório. No fim, roda \`claude mcp list\` e me mostra se conectou.`;
  const PEDIDO_BUSCA='Me explica, em poucas linhas, o que tu consegue buscar na web daqui da Ratoeira e o que bloqueia (LinkedIn, YouTube, Instagram). Usa a skill buscar-web-ratoeira: quais caminhos são de graça, quais pedem chave, e quanto custam. Não liga nada ainda.';

  // ── A janela de passos ──
  const PASSOS_ADMIN=['ola','claude','trabalho','integracoes','publicar','tour'];
  const PASSOS_MEMBRO=['ola','claude','dicas','publicar','tour'];
  let passos=[],atual=0,dlg=null,pilula=null,escolha=null;
  function montarPassos(){
    passos=admin()?[...PASSOS_ADMIN]:[...PASSOS_MEMBRO];
    // quem usa a conta geral do Claude não tem o que conectar
    if(!admin()&&P?.user?.claudeModo==='geral')passos=passos.filter(p=>p!=='claude');
    // sem Publicados nesta Ratoeira, não tem o que mostrar
    if(!P?.playground)passos=passos.filter(p=>p!=='publicar');
  }
  function abrir(inicio=0){
    if(!BV)return;montarPassos();atual=Math.min(inicio,passos.length-1);
    pilula?.remove();pilula=null;
    if(!dlg){dlg=el('dialog','bv');dlg.setAttribute('aria-labelledby','bv-titulo');document.body.append(dlg);
      dlg.addEventListener('cancel',ev=>{ev.preventDefault();minimizar();});}
    const abria=!dlg.open;if(abria)dlg.showModal();desenhar();
  }
  // Lingueta na borda direita, a 30% da altura: o canto de baixo e o meio são da caixa do chat (reporte de 20/10/2026),
  // e ali em cima a borda não tem controle em nenhuma tela. Tocar volta pra janela; "Deixar pra depois" fica no rodapé dela.
  function minimizar(){
    if(dlg?.open)dlg.close();if(pilula)return;
    pilula=botao('',()=>abrir(atual),'bv-pilula');
    pilula.setAttribute('aria-label','Continuar as boas-vindas: passo '+(atual+1)+' de '+passos.length);pilula.title='Continuar as boas-vindas';
    pilula.append(el('i','dot acc'),el('span','bv-pilula-t','Boas-vindas · '+(atual+1)+'/'+passos.length));
    document.body.append(pilula);
  }
  async function terminar(acao='concluir'){
    if(dlg?.open)dlg.close();pilula?.remove();pilula=null;
    try{BV={...BV,...await post('/boas-vindas',{acao})};}catch(e){toast(e.message);}
    if(acao==='pular')toast('Tudo bem. As boas-vindas ficam no menu da tua conta, e a lista de primeiros passos na Início.');
    lista();
  }
  function cabeca(titulo,sub){
    const h=el('header','bv-cab');
    const dots=el('div','bv-dots');dots.setAttribute('aria-label','Passo '+(atual+1)+' de '+passos.length);
    passos.forEach((_,i)=>dots.append(el('i',i===atual?'atual':i<atual?'feito':'')));
    h.append(dots,el('h2','',titulo));h.lastChild.id='bv-titulo';
    if(sub)h.append(el('p','bv-sub',sub));
    return h;
  }
  function rodape(proximo='Continuar',{voltar=true,pular=true,proximoFn=null}={}){
    const f=el('footer','bv-pe');
    if(pular)f.append(botao('Deixar pra depois',()=>terminar('pular'),'bv-link'));
    f.append(el('span','bv-espaco'));
    if(voltar&&atual>0)f.append(botao('Voltar',()=>{atual--;desenhar();}));
    f.append(botao(proximo,proximoFn||(()=>{atual++;desenhar();}),'primary'));
    return f;
  }
  function desenhar(){
    dlg.replaceChildren();const p=passos[atual];dlg.dataset.passo=p;
    ({ola,claude,trabalho,integracoes,dicas,publicar,tour})[p]();
    dlg.querySelector('footer .primary')?.focus();
  }

  function ola(){
    const n=nome();
    const corpo=el('div','bv-corpo');
    if(admin()){
      dlg.append(cabeca(n?'Bem-vindo à tua Ratoeira, '+n+'.':'Bem-vindo à tua Ratoeira.'));
      corpo.append(el('p','','Aqui os teus agentes (Claude e Codex) trabalham numa máquina que é tua e fica ligada o tempo todo. Tu conversa com eles, vê os arquivos e usa os apps pelo navegador, no computador ou no celular.'),
        el('p','','Vamos deixar tudo pronto em uns 10 minutos:'));
      const ol=el('ol','bv-roteiro');for(const t of ['Conectar a tua conta do Claude','Trazer o teu trabalho pra cá','Ver o que os agentes já alcançam',...(P?.playground?['Mostrar o teu trabalho pra fora']:[]),'Dar uma volta pela tela'])ol.append(el('li','',t));corpo.append(ol);
    }else{
      dlg.append(cabeca(n?'Bem-vindo à Ratoeira, '+n+'.':'Bem-vindo à Ratoeira.'));
      corpo.append(el('p','','Aqui tu conversa com os agentes (Claude e Codex), vê os arquivos do time e usa os apps, pelo navegador, no computador ou no celular.'),
        el('p','','Leva dois minutos pra te mostrar o caminho.'));
    }
    dlg.append(corpo,rodape('Começar',{voltar:false}));
    dlg.querySelector('.bv-link').textContent='Pular por agora';
  }

  async function claude(){
    dlg.append(cabeca('Conecta a tua conta do Claude.','Os agentes usam a tua assinatura (Pro ou Max), não uma API cobrada à parte. Entrando com o login completo, vêm junto os conectores da tua conta: Gmail, Drive, Agenda, Canva.'));
    const corpo=el('div','bv-corpo'),estado=el('div','bv-estado','Conferindo a conta…');corpo.append(estado);
    const f=rodape('Continuar');dlg.append(corpo,f);
    let conectado=false;
    try{
      const r=await api('/connections');const c=(r.providers||[]).find(x=>x.id==='claude');
      conectado=c?.status==='connected';
      estado.replaceChildren();estado.className='bv-estado'+(conectado?' ok':'');
      if(conectado){estado.append(icone('ok'),el('span','','Claude conectado'+(c.account?' como '+c.account:'')+(c.via==='geral'?' (pela conta da organização)':'')+'.'));}
      else estado.append(el('span','','Ainda não conectado.'));
    }catch{estado.textContent='Não consegui conferir agora. Dá pra conectar em Configurações › Contas de IA.';}
    if(!conectado){
      corpo.append(botao('Conectar o Claude',()=>{minimizar();location.hash='#configuracoes/contas';},'primary bv-grande'));
      f.querySelector('.primary').textContent='Fazer depois';f.querySelector('.primary').className='';
    }
    corpo.append(el('p','bv-nota','Tem ChatGPT? Dá pra conectar o Codex no mesmo lugar, em Configurações › Contas de IA. É opcional.'));
  }

  function trabalho(){
    dlg.append(cabeca('Onde mora o teu trabalho hoje?','Tudo que tu e os agentes fizerem fica numa pasta desta Ratoeira, com o histórico de cada mudança. Escolhe por onde começar.'));
    const corpo=el('div','bv-corpo'),opcoes=el('div','bv-opcoes'),detalhe=el('div','bv-detalhe');
    opcoes.setAttribute('role','radiogroup');opcoes.setAttribute('aria-label','Onde mora o teu trabalho');
    const OP=[['github','github','No GitHub','Já está num repositório.'],['computador','computador','No meu computador','Numa pasta, com ou sem git.'],['zero','zero','Começar do zero','Ainda não tenho nada.']];
    for(const [id,ic,t,s] of OP){
      const b=el('button','bv-opcao');b.type='button';b.setAttribute('role','radio');b.dataset.op=id;
      const tx=el('span','bv-opcao-tx');tx.append(el('strong','',t),el('span','',s));
      b.append(el('span','bv-opcao-ic'),tx);b.firstChild.append(icone(ic));
      b.onclick=()=>{escolha=id;marcar();};opcoes.append(b);
    }
    function marcar(){
      for(const b of opcoes.children){const s=b.dataset.op===escolha;b.classList.toggle('sel',s);b.setAttribute('aria-checked',String(s));}
      detalhe.replaceChildren();
      if(escolha==='github'){
        detalhe.append(el('p','','O agente te ajuda a entrar no GitHub, traz o repositório pra cá e liga um envio automático, pra os dois ficarem iguais.'),
          botao('Abrir conversa com o agente',()=>conversa(PEDIDO_GITHUB()),'primary'),
          el('p','bv-nota','A conversa abre na Mesa. Quando acabar, volta pela aba "Boas-vindas" na borda direita da tela.'));
      }
      if(escolha==='computador'){
        const a=el('details','bv-sub-op'),b=el('details','bv-sub-op');a.open=true;
        a.append(el('summary','','Trazer uma cópia e seguir só aqui'),el('p','','Cola este texto no Claude do teu computador (o mesmo que instalou a Ratoeira: ele já tem acesso a ela). Ele manda a pasta pra cá, e daí em diante a casa é a Ratoeira.'),blocoCopiar(PEDIDO_COPIA()),aviso());
        b.append(el('summary','','Manter o computador e a Ratoeira sincronizados'),el('p','','Pra isso os dois precisam de um lugar em comum, o GitHub. Cola este texto no Claude do teu computador; depois volta aqui e escolhe "No GitHub".'),blocoCopiar(PEDIDO_SUBIR_GITHUB));
        a.addEventListener('toggle',()=>{if(a.open)b.open=false;});b.addEventListener('toggle',()=>{if(b.open)a.open=false;});
        detalhe.append(a,b);
      }
      if(escolha==='zero'){
        detalhe.append(el('p','','A pasta já existe, vazia. É só começar a conversar: o que tu e os agentes criarem fica nela, com histórico.'),aviso());
      }
    }
    corpo.append(opcoes,detalhe);
    const f=rodape('Continuar',{proximoFn:async()=>{if(escolha==='zero'){try{BV={...BV,...await post('/boas-vindas',{acao:'marcar',item:'comecar-do-zero'})};}catch{}}atual++;desenhar();}});
    dlg.append(corpo,f);
    if(escolha)marcar();
  }
  // Sem GitHub, a VPS é o único lugar onde os arquivos existem: diz isso com todas as letras.
  function aviso(){
    const a=el('div','bv-aviso');a.append(icone('escudo'));
    const t=el('div');t.append(el('strong','','Teus arquivos e o histórico ficam só nesta VPS.'),
      el('span','',' Liga o backup no painel de quem te vende a VPS (na Hostinger, fica na página da VPS, em Backups). Mais pra frente dá pra ligar o GitHub também.'));
    const marcado=BV?.marcados?.includes('backup-vps');
    const b=botao(marcado?'Backup da VPS ligado':'Já liguei o backup da VPS',async()=>{try{BV={...BV,...await post('/boas-vindas',{acao:'marcar',item:'backup-vps'})};b.textContent='Backup da VPS ligado';b.disabled=true;}catch(e){toast(e.message);}},'bv-aviso-btn');
    if(marcado)b.disabled=true;
    t.append(b);a.append(t);return a;
  }

  function integracoes(){
    dlg.append(cabeca('O que os agentes já alcançam, e o que vale ligar.'));
    const corpo=el('div','bv-corpo bv-int');
    const bloco=(ic,titulo,...filhos)=>{const s=el('section','bv-bloco');const h=el('h3');h.append(icone(ic),document.createTextNode(titulo));s.append(h,...filhos);return s;};
    corpo.append(bloco('pronto','Já vem pronto',lista3([
      ['Navegador','abre sites, testa telas, tira print.'],['Microfone no chat','fala em vez de digitar.'],['Conectores da tua conta do Claude','Gmail, Drive, Agenda, Canva, os que tu ligou no claude.ai.']])));
    const vale=el('div','bv-cards');
    if(!BV?.estado?.remoto)vale.append(cartao('GitHub','Repositórios, pull requests e issues.',()=>conversa(PEDIDO_INTEGRACAO('GitHub','repositórios, pull requests e issues','Usa o servidor MCP oficial do GitHub (remoto, por HTTP) com um token fine-grained.'))));
    vale.append(cartao('Context7','Documentação atualizada de qualquer biblioteca. De graça, sem chave.',()=>conversa(PEDIDO_INTEGRACAO('Context7','documentação atualizada de bibliotecas e APIs','É um MCP remoto por HTTP.'))));
    corpo.append(bloco('plug','Vale ligar',vale));
    corpo.append(bloco('globo','Quando a internet barrar',el('p','','LinkedIn, YouTube e Instagram costumam bloquear máquina de datacenter, que é o caso da VPS. Pede assim mesmo: o agente sabe descer pra outros caminhos, alguns pagos, com a tua chave.'),botao('Perguntar ao agente o que dá',()=>conversa(PEDIDO_BUSCA),'bv-link')));
    corpo.append(bloco('escudo','Dica de segurança',el('p','','Chave de API não mora em arquivo. Se o teu time usa 1Password, liga o cofre em Integrações e os agentes leem as chaves de lá.')));
    corpo.append(el('p','bv-nota','O resto (Resend, Supabase, Composio…) fica na tela de Integrações, pra quando precisar.'));
    dlg.append(corpo,rodape('Continuar'));
  }
  function lista3(itens){const ul=el('ul','bv-lista3');for(const [t,d] of itens){const li=el('li');li.append(el('strong','',t),document.createTextNode(': '+d));ul.append(li);}return ul;}
  function cartao(t,d,fn){const c=el('div','bv-cartao');c.append(el('strong','',t),el('p','',d),botao('Pedir pro agente ligar',fn));return c;}

  // Publicar: o que sai da Ratoeira num link. Três jeitos, e um teste de verdade (o agente faz, a pessoa publica).
  const PEDIDO_PUBLICAR='Quero aprender a publicar uma página com link. Faz uma de exemplo pra mim: um cartão de apresentação meu, simples e bonito, num HTML só, em exemplos/cartao.html. Antes, me pergunta numa mensagem só o meu nome, o que eu faço e um contato. Depois me mostra o caminho do arquivo e me diz, em duas linhas, que o globo do lado dele na Mesa publica num link, e que dá pra escolher quem vê (só o time, com senha ou qualquer pessoa). Não publica sozinho: quero clicar eu.';
  function publicar(){
    dlg.append(cabeca('Mostra o teu trabalho pra fora.','O que tu e os agentes fazem aqui pode virar um link pra cliente, pro time ou pro mundo.'));
    const corpo=el('div','bv-corpo bv-int');
    const bloco=(ic,titulo,texto)=>{const b=el('section','bv-bloco');const h=el('h3');h.append(icone(ic),document.createTextNode(titulo));b.append(h,el('p','',texto));return b;};
    corpo.append(
      bloco('globo','Publicar um arquivo','Uma página, um PDF ou uma imagem que o agente fez: o globo do lado do arquivo, na Mesa, gera um link. Tu escolhe quem vê: só o time, com senha ou qualquer pessoa.'),
      bloco('pronto','Sites e sisteminhas com link próprio','Pede pro agente criar e publicar: uma pesquisa pros teus clientes responderem, uma página de inscrição, um site de evento. Fica num endereço teu, pra quem está fora da Ratoeira, e pode ganhar domínio próprio.'),
      bloco('plug','Apps do time','Sistemas que abrem aqui dentro, com o login da Ratoeira: um controle de pedidos, um CRM, um painel. Também é só pedir.'));
    corpo.append(botao('Testar agora: fazer uma página e publicar',()=>conversa(PEDIDO_PUBLICAR),'primary bv-grande'),
      el('p','bv-nota','A conversa abre na Mesa. Quando acabar, volta pela aba "Boas-vindas" na borda direita da tela.'));
    dlg.append(corpo,rodape('Continuar'));
  }

  function dicas(){
    dlg.append(cabeca('No dia a dia'));
    const corpo=el('div','bv-corpo'),ul=el('ul','bv-lista3');
    for(const [t,d] of [['Microfone','no chat, pra falar em vez de digitar.'],['Avisos no celular','liga pelo sino, e chega aviso quando o agente termina ou alguém te chama, mesmo com a Ratoeira fechada.'],['Reportar','o inseto no pé da barra manda bug ou ideia pra quem cuida da Ratoeira, com print.'],['Pedir é o caminho','pra criar um app, uma automação ou ligar uma integração, é só pedir no chat.']]){const li=el('li');li.append(el('strong','',t),document.createTextNode(': '+d));ul.append(li);}
    corpo.append(ul);dlg.append(corpo,rodape('Continuar'));
  }

  function tour(){
    dlg.append(cabeca('Quer uma volta rápida pela tela?','Uns balões apontando o que é cada coisa na barra. Menos de um minuto.'));
    const f=rodape('Mostrar',{pular:false,proximoFn:()=>{dlg.close();iniciarTour(()=>terminar('concluir'));}});
    f.prepend(botao('Pular e terminar',()=>terminar('concluir'),'bv-link'));
    dlg.append(el('div','bv-corpo'),f);
  }

  // ── Tour: balões em cima da tela de verdade ──
  const PARADAS=()=>[
    ['[data-nav="inicio"]','Início','Onde a Ratoeira abre: conversa nova, quem espera a tua resposta e o que está rodando.'],
    ['[data-nav="arquivos"]','Mesa','Os teus arquivos com o chat do lado. Tudo que tu salva vira uma versão com o teu nome, e dá pra voltar.'],
    [['[data-nav="habilidades"]','[data-nav="integracoes"]','[data-nav="automacoes"]'],'Habilidades, Integrações e Automações','O que os agentes sabem fazer, o que eles alcançam e o que roda sozinho num horário. Pra criar qualquer um, é só pedir no chat.'],
    ['.rail-sec-apps','Apps','Os apps do time aparecem aqui: pede pro agente criar um (um controle de pedidos, um painel). Site, pesquisa ou página com link pra fora também é com ele, e o globo do lado de cada arquivo, na Mesa, publica.'],
    ['#reportar-abrir','Reportar','Achou um bug ou teve uma ideia? O inseto manda pra quem cuida da Ratoeira, com print. A resposta volta no sino.'],
    ['#sino-abrir','Sino','Avisos de conversa que terminou, rotina que precisa de ti e de quem te marcou. Dá pra receber no celular também.'],
    ['[data-nav="configuracoes"]','Configurações',admin()?'Contas de IA, pessoas do time, endereços e atualizações.':'As tuas contas de IA.'],
    // no celular a barra vira faixa no topo e o resto mora na gaveta que o rato abre: só aparece quando os de cima somem
    ['.rail-brand','O resto mora no rato','Toca no rato pra abrir o menu: Início, os teus apps, Habilidades, Integrações, Automações, Configurações, o tema e o "Rever as boas-vindas".',true],
  ];
  // a barra só mostra ícone e nome fora da Mesa: o tour roda na Início
  function iniciarTour(aoFim){
    if(document.body.dataset.view!=='inicio'){location.hash='#inicio';setTimeout(()=>iniciarTour(aoFim),350);return;}
    const visivel=e=>e&&!e.hidden&&e.getClientRects().length>0;
    const todas=PARADAS().map(([sel,t,d,soNoMenu])=>({els:(Array.isArray(sel)?sel:[sel]).map(s=>document.querySelector(s)).filter(visivel),t,d,soNoMenu}));
    const barraInteira=visivel(document.querySelector('[data-nav="integracoes"]'));
    const paradas=todas.filter(p=>p.els.length&&!(p.soNoMenu&&barraInteira));
    if(!paradas.length){aoFim();return;}
    const fundo=el('div','bv-tour'),luz=el('div','bv-luz'),balao=el('div','bv-balao');balao.setAttribute('role','dialog');balao.setAttribute('aria-live','polite');
    fundo.append(luz,balao);document.body.append(fundo);
    let i=0;
    const sair=()=>{fundo.remove();removeEventListener('resize',pos);document.removeEventListener('keydown',tecla,true);aoFim();};
    const tecla=e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();sair();}if(e.key==='ArrowRight'||e.key==='Enter'){e.preventDefault();e.stopPropagation();ir(i+1);}if(e.key==='ArrowLeft'){e.preventDefault();ir(i-1);}};
    function pos(){
      const r=paradas[i].els.map(e=>e.getBoundingClientRect()).reduce((a,b)=>({left:Math.min(a.left,b.left),top:Math.min(a.top,b.top),right:Math.max(a.right,b.right),bottom:Math.max(a.bottom,b.bottom)}));
      const m=6;Object.assign(luz.style,{left:(r.left-m)+'px',top:(r.top-m)+'px',width:(r.right-r.left+2*m)+'px',height:(r.bottom-r.top+2*m)+'px'});
      const W=innerWidth,H=innerHeight,bw=Math.min(320,W-32);balao.style.width=bw+'px';
      const bh=balao.offsetHeight;let x,y;
      if(r.right+16+bw<W){x=r.right+16;y=Math.min(Math.max(16,(r.top+r.bottom)/2-bh/2),H-bh-16);balao.dataset.lado='direita';}
      else{x=Math.min(Math.max(16,(r.left+r.right)/2-bw/2),W-bw-16);y=r.bottom+16+bh<H?r.bottom+16:Math.max(16,r.top-16-bh);balao.dataset.lado='baixo';}
      Object.assign(balao.style,{left:x+'px',top:y+'px'});
    }
    function ir(n){
      if(n<0)return;if(n>=paradas.length){sair();return;}i=n;const p=paradas[i];
      balao.replaceChildren(el('span','bv-balao-n',(i+1)+' de '+paradas.length),el('h3','',p.t),el('p','',p.d));
      const ac=el('div','bv-balao-ac');ac.append(botao('Sair do tour',sair,'bv-link'),el('span','bv-espaco'));
      if(i>0)ac.append(botao('Voltar',()=>ir(i-1)));
      ac.append(botao(i===paradas.length-1?'Terminar':'Próximo',()=>ir(i+1),'primary'));balao.append(ac);
      pos();ac.lastChild.focus();
    }
    addEventListener('resize',pos);document.addEventListener('keydown',tecla,true);
    fundo.addEventListener('click',e=>{if(e.target===fundo)ir(i+1);});
    ir(0);
  }

  // ── Lista "Primeiros passos" na Início ──
  let desenhando=0;
  async function lista(){
    const vez=++desenhando;
    const bento=document.querySelector('#view-inicio .bento');if(!bento||!BV)return;
    let card=$('home-passos');
    if(!BV.lista){card?.remove();return;}
    let bv=BV,conn=null,notif=null,publicados=null,dois=null;
    try{[bv,conn,notif,publicados,dois]=await Promise.all([api('/boas-vindas'),api('/connections').catch(()=>null),api('/notificacoes').catch(()=>null),P?.playground&&admin()?api('/playground').catch(()=>null):null,api('/dois-passos').catch(()=>null)]);BV=bv;}catch{}
    if(vez!==desenhando)return;
    if(!BV.lista){card?.remove();return;}
    const e=BV.estado||{},m=new Set(BV.marcados||[]);
    const claude=(conn?.providers||[]).find(x=>x.id==='claude');
    const itens=[
      {t:'Conectar o Claude',d:'Os agentes usam a tua assinatura.',feito:claude?.status==='connected',acao:['Conectar',()=>{location.hash='#configuracoes/contas';}]},
      ...(admin()?[
        {t:'Trazer o teu trabalho',d:'Do GitHub, do computador ou do zero.',feito:e.pastaComArquivos||m.has('comecar-do-zero'),acao:['Escolher',()=>abrir(passos.indexOf('trabalho')>=0?passos.indexOf('trabalho'):2)]},
        {t:'Ter uma cópia fora da VPS',d:'GitHub ligado ou o backup do provedor da VPS.',feito:e.remoto||m.has('backup-vps'),acao:['Já liguei o backup',async()=>{await post('/boas-vindas',{acao:'marcar',item:'backup-vps'});lista();}]},
      ]:[]),
      // verificação em dois passos: oferecida, não obrigatória; fica na lista até ativar (Configurações › Segurança)
      ...(dois?[{t:'Proteger a tua entrada',d:'Verificação em dois passos: além da senha, um código do celular.',opcional:true,feito:dois.ativo,acao:['Ativar',()=>{location.hash='#configuracoes/seguranca';}]}]:[]),
      {t:'Ligar os avisos no celular',d:'Abre a Ratoeira no celular e liga pelo sino.',feito:(notif?.push?.aparelhos||0)>0,acao:['Abrir o sino',()=>$('sino-abrir')?.click()]},
      ...(admin()?[
        {t:'Convidar alguém do time',d:'Cada pessoa ganha o login e a pasta dela.',feito:(e.pessoas||0)>1,acao:['Convidar',()=>{location.hash='#configuracoes/pessoas';}]},
        {t:'Criar um app ou publicar uma página',d:'É só pedir no chat.',feito:(P?.systemApps||[]).length>0||(publicados?.itens||[]).length>0,acao:['Pedir pro agente',()=>conversa('Quero criar o meu primeiro app aqui na Ratoeira. Me faz 3 perguntas sobre o que eu preciso controlar no dia a dia e me sugere um app simples pra começar.')]},
        {t:'Endereço próprio',d:'Opcional: a Ratoeira num domínio teu.',opcional:true,feito:Boolean(e.enderecoProprio),acao:['Ver como',()=>{location.hash='#configuracoes/enderecos';}]},
      ]:[]),
    ];
    const feitos=itens.filter(x=>x.feito).length,obrig=itens.filter(x=>!x.opcional);
    if(obrig.every(x=>x.feito)&&!itens.some(x=>x.opcional&&!x.feito)){card?.remove();return;}
    if(!card){card=el('section','card s2 bv-passos');card.id='home-passos';card.setAttribute('aria-labelledby','home-passos-t');}
    if(bento.firstChild!==card)bento.prepend(card);
    const cab=el('div','ch'),h=el('h2');h.id='home-passos-t';h.append(el('i','dot acc'),document.createTextNode('Primeiros passos'));
    cab.append(h,el('span','ch-meta',feitos+' de '+itens.length));
    const barra=el('div','bv-barra'),cheia=el('i');cheia.style.width=Math.round(100*feitos/itens.length)+'%';barra.append(cheia);
    const ul=el('ul','bv-itens');
    for(const x of itens){
      const li=el('li',x.feito?'feito':'');const ck=el('span','bv-ck');if(x.feito)ck.append(icone('ok'));
      const tx=el('div','bv-it-tx');tx.append(el('strong','',x.t+(x.opcional?' (opcional)':'')),el('span','',x.d));
      li.append(ck,tx);if(!x.feito)li.append(botao(x.acao[0],x.acao[1],'bv-it-btn'));ul.append(li);
    }
    const pe=el('div','bv-passos-pe');
    pe.append(botao('Rever as boas-vindas',()=>abrir(0),'bv-link'),el('span','bv-espaco'),botao('Dispensar a lista',async()=>{try{BV={...BV,...await post('/boas-vindas',{acao:'fechar-lista'})};}catch(err){toast(err.message);}card.remove();toast('Lista dispensada. As boas-vindas seguem no menu da tua conta.');},'bv-link'));
    card.replaceChildren(cab,barra,ul,pe);
  }

  // ── Configurações › Endereços ──
  const ENDERECOS={
    async carregar(){
      const box=$('enderecos-corpo');if(!box)return;
      let d;try{d=await api('/enderecos');}catch(e){box.replaceChildren(el('p','error-text',e.message));return;}
      box.replaceChildren(
        ilhaEndereco('ratoeira','A Ratoeira','Onde tu e o time entram.',d.ratoeira,d.ratoeiraProprio,d.ip,'ratoeira.seudominio.com.br'),
        ilhaEndereco('publicados','Os Publicados','Onde ficam as páginas e programas com link pra fora, cada um no seu caminho.',d.publicados,d.publicadosProprio,d.ip,'apps.seudominio.com.br'));
    }
  };
  function ilhaEndereco(tipo,titulo,sub,atual,proprio,ip,exemplo){
    const s=el('section','editor bv-end');
    const h=el('div','bv-end-cab'),tx=el('div');tx.append(el('h3','',titulo),el('p','muted',sub));h.append(tx);s.append(h);
    const linha=el('div','bv-end-atual');
    if(atual){const a=el('a','',atual);a.href='https://'+atual+'/';a.target='_blank';a.rel='noopener noreferrer';linha.append(a,el('span','chip'+(proprio?' ok':''),proprio?'domínio teu':'endereço do provedor'));}
    else linha.append(el('span','muted','Ainda sem endereço.'));
    s.append(linha);
    const f=el('form','bv-end-form'),lab=el('label','',proprio?'Trocar por outro domínio':'Usar um domínio teu'),inp=el('input');
    inp.name='nome';inp.placeholder=exemplo;inp.autocomplete='off';inp.spellcheck=false;inp.maxLength=200;lab.append(inp);
    const res=el('div','bv-end-res');res.setAttribute('aria-live','polite');
    const conf=el('button','','Conferir o DNS');conf.type='submit';
    const acoes=el('div','actions');acoes.append(conf);f.append(lab,acoes);s.append(f,res);
    const passoDns=nomeNovo=>{const ol=el('ol','bv-end-dns');
      ol.append(el('li','','No painel de quem te vende o domínio (Registro.br, Cloudflare, Hostinger…), abre a parte de DNS.'));
      const li=el('li');li.append(document.createTextNode('Cria um registro do tipo '),el('code','','A'),document.createTextNode(' com o nome '),el('code','',nomeNovo),document.createTextNode(' apontando pra '),el('code','',ip||'o IP desta VPS'),document.createTextNode('.'));ol.append(li);
      if(tipo==='publicados'){const l2=el('li');l2.append(document.createTextNode('Se for usar domínio próprio em cada página, cria também um curinga: '),el('code','','*.'+nomeNovo),document.createTextNode(' pro mesmo IP.'));ol.append(l2);}
      ol.append(el('li','','Se o domínio está na Cloudflare, deixa a nuvem cinza ("só DNS"): com a laranja, o endereço aponta pra Cloudflare e não pra VPS.'),
        el('li','','Espera uns minutos (às vezes algumas horas) e confere aqui de novo.'));return ol;};
    f.onsubmit=async ev=>{
      ev.preventDefault();const n=inp.value.trim().toLowerCase().replace(/^https?:\/\//,'').replace(/\/.*$/,'');if(!n){inp.focus();return;}
      conf.disabled=true;conf.textContent='Conferindo…';res.replaceChildren();
      try{
        const r=await api('/enderecos/conferir?nome='+encodeURIComponent(n));
        if(r.aponta){
          const ok=el('p','bv-end-ok');ok.append(icone('ok'),document.createTextNode(r.nome+' já aponta pra esta VPS.'));
          res.append(ok,el('p','muted','Falta trocar na Ratoeira: o agente roda a receita oficial, que guarda uma cópia da configuração, põe o HTTPS no endereço novo'+(tipo==='ratoeira'?', deixa o antigo levando pro novo e religa a Ratoeira por uns segundos.':' e passa os Publicados pra lá.')),
            botao('Pedir pro agente trocar',()=>{if(!window.ratoeiraNovaConversa){toast('O chat ainda não está pronto.');return;}window.ratoeiraNovaConversa({texto:pedidoEndereco(tipo,r.nome)});},'primary'));
        }else{
          res.append(el('p','bv-end-nao',r.ips.length?r.nome+' aponta pra '+r.ips.join(', ')+', não pra esta VPS'+(ip?' ('+ip+')':'')+'.':r.nome+' ainda não aponta pra lugar nenhum.'),passoDns(r.nome));
        }
      }catch(e){res.append(el('p','error-text',e.message));}
      finally{conf.disabled=false;conf.textContent='Conferir o DNS';}
    };
    if(!proprio&&ip)s.append(el('p','muted bv-end-ip','IP desta VPS: '+ip));
    return s;
  }
  const pedidoEndereco=(tipo,n)=>`Quero trocar o endereço ${tipo==='ratoeira'?'da Ratoeira':'dos Publicados'} pra ${n}. Conferi em Configurações › Endereços: o DNS já aponta pra esta VPS.
Usa a receita oficial \`endereco\` da Ratoeira, que mora em kit/receitas/ da fonte do núcleo (o caminho está em core.fonte, no /etc/ratoeira/gateway.config.json): \`sudo bash <fonte>/kit/receitas/endereco ${tipo==='ratoeira'?'--ratoeira':'--publicados'} ${n}\`. Antes de rodar, me diz em poucas linhas o que ela vai fazer e espera o meu ok. ${tipo==='ratoeira'?'Ela religa a Ratoeira por uns segundos, então esta conversa cai e volta: depois me passa o endereço novo pra eu abrir.':'Depois me passa o endereço novo dos Publicados.'}`;
  window.ratoeiraEnderecos=ENDERECOS;

  // ── Começo ──
  async function iniciar(dados){
    P=dados;if(!P?.user?.signOut)return;   // só no login próprio (as instalações): sem contas, não há a quem dar boas-vindas
    try{BV=await api('/boas-vindas');}catch{return;}
    // "Rever as boas-vindas" no menu da conta, sempre
    const menu=document.querySelector('#eu-pop .eu-cel');
    if(menu&&!$('eu-boas-vindas')){const b=el('button');b.type='button';b.id='eu-boas-vindas';b.append(icone('pronto'),el('span','','Rever as boas-vindas'));b.onclick=()=>{$('eu-toggle')?.click();abrir(0);};menu.append(b);}
    if(document.body.dataset.view==='inicio')lista();
    const q=new URLSearchParams(location.search);
    if(BV.mostrar||q.get('boas-vindas')==='1')setTimeout(()=>abrir(0),400);
  }
  addEventListener('ratoeira:view',e=>{if(e.detail==='inicio'&&BV)lista();});
  if(window.__ratoeiraPortal)iniciar(window.__ratoeiraPortal);else addEventListener('ratoeira:portal',e=>iniciar(e.detail),{once:true});
  // pra testar no console: ratoeiraBoasVindas.abrir(), .tour()
  window.ratoeiraBoasVindas={abrir:n=>abrir(n||0),tour:()=>iniciarTour(()=>{}),lista};
})();
