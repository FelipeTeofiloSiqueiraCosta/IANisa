'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const state = {portal:null, flow:null, timer:null, providers:[], busy:false, appId:null};
  function setTheme(theme){
    document.documentElement.dataset.theme=theme;
    const label=theme==='dark'?'Usar tema claro':'Usar tema escuro';
    $('theme-toggle').setAttribute('aria-label',label);$('theme-toggle').querySelector('.tip').textContent=theme==='dark'?'Tema claro':'Tema escuro';
    document.querySelector('meta[name="theme-color"]').content=theme==='dark'?'#141412':'#ecebe6';
    const t=$('eu-tema');if(t){t.setAttribute('aria-label',label);t.title=theme==='dark'?'Tema claro':'Tema escuro';}
  }
  let savedTheme;try{savedTheme=localStorage.getItem('ratoeira:theme');}catch{}
  setTheme(savedTheme==='dark'?'dark':'light');
  // Barra da esquerda: na Mesa só ícones (com dica no hover), pra sobrar espaço; nas outras telas, ícone + nome. Sem botão de recolher.
  document.documentElement.dataset.barra='aberta';
  // Teclado do celular: a tela acompanha a parte visível, pra caixa de mensagem não ficar embaixo dele.
  // O Chrome do Android já encolhe sozinho (interactive-widget no viewport); o Safari do iPhone, só por aqui.
  // Com zoom de pinça (scale>1) não mexe, senão a tela encolheria junto.
  const vv=window.visualViewport;
  if(vv){const ajustar=()=>{if(vv.scale>1.01)return;document.documentElement.style.setProperty('--vvh',Math.round(vv.height)+'px');if(vv.offsetTop>0)window.scrollTo(0,0);};vv.addEventListener('resize',ajustar);ajustar();}
  $('theme-toggle').onclick=()=>{const theme=document.documentElement.dataset.theme==='dark'?'light':'dark';setTheme(theme);try{localStorage.setItem('ratoeira:theme',theme);}catch{}};
  const terminal = flow => !flow || ['complete','error','cancelled'].includes(flow.stage);
  // o que o diálogo Publicar aceita (pasta não; igual ao PUBLICAVEL do playground.mjs)
  const PUBLICAVEL=/\.(html?|pdf|png|jpe?g|gif|webp|svg|avif|md)$/i;
  const node = (tag, text, cls) => { const el=document.createElement(tag); if(text!==undefined) el.textContent=text; if(cls) el.className=cls; return el; };
  // Ícone de traço (herda a cor). Os desenhos são fixos, daqui; nada vindo do servidor entra no innerHTML.
  const ICON={fora:'<path d="M7.5 18h9.5a4 4 0 0 0 1-7.9A6 6 0 0 0 6.6 9.3 4.4 4.4 0 0 0 7.5 18z"/><path d="m4 4 16 16"/>',chave:'<circle cx="8" cy="15" r="4"/><path d="m10.8 12.2 8.7-8.7M17 6l3 3M14.5 8.5l2 2"/>',mapa:'<path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2z"/><path d="M9 4v14M15 6v14"/>',rotina:'<path d="M5 5h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-6l-5 4v-4H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z"/><path d="M12 8v3l2 1.5"/>',script:'<rect x="3" y="4" width="18" height="16" rx="3"/><path d="m7 9 3 3-3 3m6 0h4"/>',pessoas:'<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14.2a6.5 6.5 0 0 1 3.5 5.8"/>',servidor:'<rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 7.5h.01M7 16.5h.01"/>',ext:'<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',lixo:'<path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12"/>',mais:'<path d="M12 5v14M5 12h14"/>',arquivo:'<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',link:'<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',baixar:'<path d="M12 4v11m-5-5 5 5 5-5M5 20h14"/>',enviar:'<path d="M12 15V4M7.5 8.5 12 4l4.5 4.5"/><path d="M5 12v7a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-7"/>',recarregar:'<path d="M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5"/>',editar:'<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M14 6l4 4"/>',olho:'<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>',codigo:'<path d="m8 8-4 4 4 4M16 8l4 4-4 4"/>',historico:'<path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1L3.5 8.5"/><path d="M3.5 4v4.5H8M12 7.5V12l3 2"/>',voltar:'<path d="M15 6l-6 6 6 6"/>',pasta:'<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',conversa:'<path d="M4 5h16v11H9l-5 4z"/>',mesa:'<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M3 9h18M9 9v11"/>',mundo:'<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z"/>'};
  const svg=name=>{const s=document.createElementNS('http://www.w3.org/2000/svg','svg');s.setAttribute('viewBox','0 0 24 24');s.setAttribute('aria-hidden','true');s.innerHTML=ICON[name];return s;};
  // Cor do ícone de cada aplicação: sai do nome, então é sempre a mesma pra mesma aplicação.
  const tom=name=>{let h=0;for(const c of String(name))h=(h*31+c.codePointAt(0))>>>0;return 't'+(h%6);};
  const appIcon=name=>{const s=node('span',String(name).trim().slice(0,1).toUpperCase()||'?','appic '+tom(name));s.setAttribute('aria-hidden','true');return s;};
  // Pergunta com botões (ex.: Salvar / Descartar / Cancelar). Devolve a chave do botão; Esc = a última.
  function perguntar(titulo,texto,botoes,foco=0){
    return new Promise(ok=>{
      const d=document.createElement('dialog');d.className='pergunta';
      const acoes=node('div',undefined,'actions');
      for(const [chave,rotulo,cls] of botoes){const b=node('button',rotulo,cls||'');b.type='button';b.onclick=()=>{d.close(chave);};acoes.append(b);}
      d.append(node('h2',titulo),node('p',texto),acoes);document.body.append(d);
      d.addEventListener('close',()=>{const v=d.returnValue||botoes[botoes.length-1][0];d.remove();ok(v);},{once:true});
      d.showModal();acoes.querySelectorAll('button')[foco]?.focus();
    });
  }
  // Pergunta com uma caixa de texto (nome de arquivo, de pasta). Devolve o texto, ou null se cancelou.
  // selecionarAte: no renomear, já vem selecionado o nome sem a extensão.
  function pedirNome(titulo,texto,{valor='',botao='Criar',dica='',selecionarAte=null}={}){
    return new Promise(ok=>{
      const d=document.createElement('dialog');d.className='pergunta';
      const form=node('form');form.method='dialog';
      const campo=node('input');campo.type='text';campo.value=valor;campo.placeholder=dica;campo.required=true;campo.maxLength=255;
      campo.autocomplete='off';campo.spellcheck=false;campo.setAttribute('aria-label',titulo);campo.className='pergunta-campo';
      const acoes=node('div',undefined,'actions'),sim=node('button',botao,'primary'),nao=node('button','Cancelar');sim.type='submit';nao.type='button';
      nao.onclick=()=>d.close('');acoes.append(sim,nao);
      form.onsubmit=e=>{e.preventDefault();const v=campo.value.trim();if(!v){campo.focus();return;}d.close('ok');};
      form.append(campo,acoes);d.append(node('h2',titulo),...(texto?[node('p',texto)]:[]),form);document.body.append(d);
      d.addEventListener('close',()=>{const v=d.returnValue==='ok'?campo.value.trim():null;d.remove();ok(v);},{once:true});
      d.showModal();campo.focus();
      if(valor){const fim=selecionarAte??valor.length;campo.setSelectionRange(0,fim);}
    });
  }
  function errorAt(id, message) { $(id).textContent=message || ''; $(id).hidden=!message; }
  async function api(path, options={}) {
    const response=await fetch('/_ratoeira/api'+path,{credentials:'same-origin',...options,headers:{'Content-Type':'application/json',...(options.headers||{})}});
    if(response.status===401){window.top.location.reload(); throw new Error('Sua sessão expirou. Recarregando…');}
    let data; try{data=await response.json();}catch{throw new Error('Não foi possível ler a resposta. Tente novamente.');}
    if(!response.ok)throw new Error(data.error||'Não foi possível concluir a ação. Tente novamente.');
    return data;
  }
  const post=(path,body={})=>api(path,{method:'POST',body:JSON.stringify(body)});
  window.ratoeiraToast=text=>toast(text);
  function toast(text){$('toast').textContent=text;$('toast').hidden=false;clearTimeout(state.toast);state.toast=setTimeout(()=>$('toast').hidden=true,4000);}
  // Modo foco (?foco): só a grade, sem barra nem árvore. É o "abrir em nova aba" das aplicações, com o chat do lado.
  const focoDe=caminho=>location.pathname+'?foco#aplicacao:'+caminho;
  // Na Mesa o título da guia fica fixo ("Mesa · Ratoeira"), pra achar a guia principal entre as outras do navegador.
  // No modo foco a guia é de uma aplicação só: leva o nome dela.
  // num espaço (?espaco=, ver grid.js) quem dá o título da guia é o chat (a conversa do espaço)
  const tituloMesa=nome=>{if('espaco' in document.documentElement.dataset)return;document.title=(new URLSearchParams(location.search).has('foco')?nome:'Mesa')+' · Ratoeira';};
  function safeURL(value){try{const u=new URL(value,location.origin);if(u.protocol==='https:' || (u.origin===location.origin && u.pathname.startsWith('/_ratoeira/pages/')))return u.href;}catch{}return null;}
  // ── Arquivos: árvore do repo (somente leitura) + abas com o arquivo renderizado ──
  const encodePath=rel=>rel.split('/').map(encodeURIComponent).join('/');
  // Baixar no iPhone/iPad: o app da tela de início ignora o download e abre o arquivo em tela cheia, sem
  // salvar nem voltar. Lá vai pelo menu de compartilhar do sistema (Salvar em Arquivos, AirDrop); sem ele,
  // abre o arquivo por cima, com os controles do navegador. Fora do iOS o link baixa como sempre.
  const IOS=/iP(hone|ad|od)/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
  // Enviar pra fora (desde 27/10/2026): o menu de compartilhar do aparelho (WhatsApp, e-mail…) com o próprio arquivo.
  // Só onde tem toque e Web Share; no computador seguem Baixar e Copiar link. Sem dar pra mandar o arquivo (tipo que o
  // aparelho recusa), manda o link do arquivo, que só abre pra quem tem acesso à Ratoeira.
  const PODE_ENVIAR=Boolean(navigator.share)&&matchMedia('(hover: none) and (pointer: coarse)').matches;
  async function enviarArquivo(rel){
    const nome=rel.split('/').pop(),url='/_ratoeira/arquivo/'+encodePath(rel)+'?baixar=1';
    let dados=null;
    try{const r=await fetch(url,{credentials:'same-origin'});if(r.ok){const b=await r.blob();const f=new File([b],nome,{type:b.type||'application/octet-stream'});if(navigator.canShare?.({files:[f]}))dados={files:[f],title:nome};}}catch{}
    if(!dados)dados={title:nome,url:location.origin+'/portal/?foco#arquivos/'+encodePath(rel)};
    const mandar=()=>navigator.share(dados).then(()=>true,e=>e?.name==='AbortError'?true:e?.name==='NotAllowedError'?false:(toast('Não deu pra enviar: '+(e?.message||e)),true));
    if(await mandar())return;
    // o iPhone só abre o menu logo depois de um toque, e baixar o arquivo pode ter passado do tempo: pede outro toque
    if(await perguntar('Arquivo pronto',nome,[['ok','Enviar','primary'],['nao','Cancelar']])==='ok')await mandar();
  }
  async function baixarArquivo(evento,rel){
    if(!IOS)return false;
    evento?.preventDefault();
    const url='/_ratoeira/arquivo/'+encodePath(rel)+'?baixar=1',nome=rel.split('/').pop();
    if(!navigator.canShare){window.open(url,'_blank');return true;}
    let arquivo=null;
    try{const r=await fetch(url,{credentials:'same-origin'});if(r.ok){const b=await r.blob();const f=new File([b],nome,{type:b.type||'application/octet-stream'});if(navigator.canShare({files:[f]}))arquivo=f;}}catch{}
    // o fetch pode ter gastado o toque (o iOS só deixa compartilhar logo depois dele): aí pede outro
    const compartilhar=()=>navigator.share({files:[arquivo]}).then(()=>true,e=>e?.name==='AbortError');
    if(arquivo){
      if(await compartilhar())return true;
      if(await perguntar('Arquivo pronto',nome,[['ok','Salvar ou compartilhar','primary'],['nao','Cancelar']])==='ok'&&!await compartilhar())toast('Não deu pra abrir o menu de compartilhar.');
      return true;
    }
    if(await perguntar('Baixar '+nome,'Abre o arquivo numa janela por cima, com o botão de compartilhar do iPhone.',[['ok','Abrir','primary'],['nao','Cancelar']])==='ok')window.open(url,'_blank');
    return true;
  }
  function decodePath(value){try{return value.split('/').map(decodeURIComponent).join('/');}catch{return null;}}
  const files=(()=>{
    const RENDER=new Set(['md','markdown','html','htm','pdf','png','jpg','jpeg','gif','webp','avif','svg','mp4','webm','mov','mp3','m4a','wav','ogg']);
    const INERT=new Set(['pdf','png','jpg','jpeg','gif','webp','avif','mp4','webm','mov','mp3','m4a','wav','ogg']);
    const BINARY=new Set(['docx','doc','xlsx','xls','pptx','ppt','key','pages','numbers','psd','ai','sketch','fig','zip','gz','tgz','tar','rar','7z','ttf','otf','woff','woff2','ico','dmg','exe','bin','sqlite','db']);
    const MAX_TABS=10;
    const f={children:new Map(),open:new Set(['']),abas:new Map(),active:null,loaded:false,searchTimer:null,searching:false};
    const ext=rel=>{const n=rel.split('/').pop();const i=n.lastIndexOf('.');return i>0?n.slice(i+1).toLowerCase():'';};
    const urlOf=(rel,mode)=>'/_ratoeira/'+(mode==='source'?'fonte/':'ver/')+encodePath(rel);
    const modesOf=rel=>{const e=ext(rel);return {render:RENDER.has(e),source:!BINARY.has(e)&&!INERT.has(e)};};
    const defaultMode=rel=>{const m=modesOf(rel);return m.render?'render':m.source?'source':'none';};
    // Cada pasta vem com o conteúdo das subpastas dela (subpastas=1): abrir a próxima pasta é instantâneo, e
    // nesse momento as subpastas dela já são pedidas em segundo plano. Antes, cada pasta nova era uma ida à rede.
    const fundo=new Set();   // pastas cujas subpastas já foram pedidas
    async function buscarPasta(dir,{fresco=false}={}){
      fundo.add(dir);
      try{
        const data=await api('/arquivos/arvore?subpastas=1'+(fresco?'&fresco=1':'')+'&caminho='+encodeURIComponent(dir));
        f.children.set(dir,data.itens);
        for(const [sub,itens] of Object.entries(data.filhos||{}))if(!f.children.has(sub))f.children.set(sub,itens);
        return data.itens;
      }catch(error){fundo.delete(dir);throw error;}
    }
    async function load(dir){
      if(!f.children.has(dir))return buscarPasta(dir);
      if(!fundo.has(dir))buscarPasta(dir).catch(()=>{});
      return f.children.get(dir);
    }
    function icon(item){
      const dir=item.tipo==='pasta'||item.alvo==='pasta',e=dir?'dir':ext(item.nome);
      const kind=dir?'dir':['md','markdown'].includes(e)?'md':['html','htm'].includes(e)?'html':e==='pdf'?'pdf':['png','jpg','jpeg','gif','webp','avif','svg'].includes(e)?'img':'file';
      const span=node('span',undefined,'ficon '+kind);span.setAttribute('aria-hidden','true');span.textContent={dir:'',md:'MD',html:'</>',pdf:'PDF',img:'IMG',file:''}[kind];return span;
    }
    const hora=iso=>{const d=new Date(iso);return d.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})+(new Date().toDateString()===d.toDateString()?'':' de '+d.toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit'}));};
    // "há 3 min": relativo, recalculado a cada minuto. Antes era a hora fixa de quando a página abriu,
    // e uma aba aberta de um dia pro outro mostrava "às 16:00" parecendo que o sync tinha parado.
    const atras=iso=>{const s=(Date.now()-Date.parse(iso))/1000;if(s<60)return 'agora';if(s<3600)return 'há '+Math.round(s/60)+' min';if(s<6*3600)return 'há '+Math.round(s/3600)+' h';return 'às '+hora(iso);};
    function showEstado(e){
      const box=$('files-sync'),text=$('files-sync-text');$('files-sync-btn').hidden=!e.podeSincronizar;$('files-enviar-btn').hidden=!podeEnviar();
      const travado=e.ultimo?.resultado==='travado';box.classList.toggle('travado',travado);
      if(travado){text.textContent='Sync travado: '+e.ultimo.mensagem;text.title='O sync parou e espera alguém resolver. Enquanto isso, aqui aparece a última versão que sincronizou.';}
      else if(e.ultimo?.resultado==='pausado'){text.textContent='Sync pausado na VPS';text.title=e.ultimo.mensagem;}
      else{const quando=e.ultimo?.quando||e.sincronizadoEm;text.textContent=quando?'Sincronizado '+atras(quando):'';text.title=[quando?'Última busca no repositório: '+hora(quando)+'.':'',e.podeSincronizar?'O botão ao lado busca e envia as mudanças agora.':''].filter(Boolean).join(' ');}
    }
    async function recarregarArvore({fresco=false}={}){
      const abertas=[...f.open];f.children.clear();fundo.clear();
      // fresco: o servidor refaz a lista dos pesados (fora do git) na hora, em vez de esperar o cache dele
      for(const dir of abertas){try{await buscarPasta(dir,{fresco:fresco&&dir===abertas[0]});}catch{f.open.delete(dir);}}
      renderTree();
    }
    async function refreshEstado(){
      try{
        // as pastas abertas vão junto: a versão muda quando algo entra ou sai de uma delas no disco
        const e=await api('/arquivos/estado?abertas='+encodeURIComponent([...f.open].filter(Boolean).slice(0,60).join('\n')));showEstado(e);f.ultimoEstado=e;
        // Chegou commit novo desde a última olhada: recarrega a árvore (as abas abertas ficam, pra não perder o que se lê).
        if(e.versao&&f.versao&&e.versao!==f.versao&&!f.searching)recarregarArvore().catch(()=>{});
        if(e.versao)f.versao=e.versao;
        return e;
      }catch{return null;}
    }
    // A cada minuto (só com a aba visível e na área Arquivos) e ao voltar pra aba.
    const talvezAtualizar=()=>{if(f.loaded&&document.visibilityState==='visible'&&document.body.dataset.view==='arquivos')refreshEstado();};
    setInterval(talvezAtualizar,60000);
    document.addEventListener('visibilitychange',talvezAtualizar);
    window.addEventListener('focus',talvezAtualizar);
    window.addEventListener('ratoeira:view',e=>{if(e.detail==='arquivos')talvezAtualizar();});
    // O agente criou, mudou ou apagou arquivo (chat.js): confere uma vez depois que a rajada de edições acalma.
    let esperaAgente=null;
    window.addEventListener('ratoeira:mexeu-arquivos',()=>{clearTimeout(esperaAgente);esperaAgente=setTimeout(talvezAtualizar,1500);});
    async function sincronizar(){
      const btn=$('files-sync-btn');if(btn.disabled)return;btn.disabled=true;btn.classList.add('girando');$('files-sync-text').textContent='Sincronizando…';
      try{
        const r=await post('/arquivos/sincronizar');
        if(!r.aceito){toast(r.motivo);return;}
        const desde=Date.parse(r.pedidoEm)-1000,limite=Date.now()+120000;let e=null;
        while(Date.now()<limite){await new Promise(ok=>setTimeout(ok,2000));e=await api('/arquivos/estado');if(e.ultimo&&Date.parse(e.ultimo.quando)>=desde)break;e=null;}
        if(!e){toast('O sync está demorando. A árvore atualiza sozinha na próxima vez que tu abrir.');return;}
        showEstado(e);
        // O índice do git mudou: recarrega as pastas abertas e as abas.
        f.versao=e.versao||f.versao;await recarregarArvore();for(const t of f.abas.values())if(t.frame?.tagName==='IFRAME')t.frame.src=t.frame.src;
        toast(e.ultimo.resultado==='ok'?'Atualizado.':'Sync travado: '+e.ultimo.mensagem);
      }catch(error){toast(error.message);}
      finally{btn.disabled=false;btn.classList.remove('girando');refreshEstado();}
    }
    $('files-sync-btn').onclick=sincronizar;
    // Árvore recolhível: some inteira e deixa só a alça no vão, no meio da altura. Começa aberta (num espaço, recolhida; não fica salvo).
    $('arvore-toggle').onclick=()=>{
      const recolher=$('files').dataset.arvore!=='recolhida',b=$('arvore-toggle');
      if(recolher)$('files').dataset.arvore='recolhida';else delete $('files').dataset.arvore;
      const rotulo=recolher?'Abrir árvore':'Recolher árvore';b.setAttribute('aria-label',rotulo);b.title=rotulo;b.setAttribute('aria-expanded',String(!recolher));
      if(!recolher)$('files-search').focus();
    };
    // espaço novo (?espaco=): começa com a árvore recolhida, pra janela abrir leve; ela fica a um clique
    if('espaco' in document.documentElement.dataset)$('arvore-toggle').onclick();
    async function revealDir(dir){
      $('files-search').value='';f.searching=false;
      const parts=dir.split('/');for(let i=0;i<parts.length;i++){const d=parts.slice(0,i+1).join('/');f.open.add(d);try{await load(d);}catch{break;}}
      renderTree();requestAnimationFrame(()=>{const el=[...$('files-list').querySelectorAll('.trow')].find(b=>b.dataset.path===dir);el?.scrollIntoView({block:'start'});el?.focus();});
    }
    // O que o git não guarda (ignorado, repositório aninhado): nome apagado e um ícone pequeno que explica no passar do
    // mouse. Dentro de uma pasta já marcada, os de dentro só ficam apagados (o ícone repetido em cada um era ruído).
    const FORA_ARQ='Fica só nesta VPS: não guarda versões nem vai pro GitHub.',FORA_PASTA='Pasta que fica só nesta VPS: o que está nela não guarda versões nem vai pro GitHub.';
    // Publicados na Mesa (desde 28/10/2026): a pasta do item (playground/<nome>), a pasta que ele serve e o arquivo de
    // origem levam um globo, e o menu dá o link. A lista vem da seção Publicados, abaixo (ratoeiraPublicadosDaMesa).
    const ACESSO_PUB={time:'só o time',senha:'com senha',publico:'qualquer um com o link'};
    function publicadoDe(rel){
      for(const x of window.ratoeiraPublicadosDaMesa?.()||[])if(rel===x.item||rel===x.origem||(x.pasta&&x.pasta!=='.'&&rel===x.pasta))return x;
      return null;
    }
    function rotuloPub(x){const end=x.enderecos?.[0];return 'Publicado'+(end?' em '+end.replace(/^https?:\/\//,''):'')+' · '+(ACESSO_PUB[x.acesso]||'só o time')+(x.mudou?' · mudou desde a publicação':'');}
    function globoPub(x){const s=node('span',undefined,'tpub'+(x.mudou?' pub-mudou':''));s.append(svg('mundo'));s.title=rotuloPub(x);s.setAttribute('aria-label',s.title);s.setAttribute('role','img');return s;}
    function row(item,depth,flat,paiFora=false){
      const b=node('button',undefined,'trow');b.type='button';b.style.setProperty('--depth',depth);b.dataset.path=item.caminho;b.dataset.tipo=item.tipo;
      if(item.tipo==='pasta'&&flat){b.append(node('span','','chev fold'));b.onclick=()=>revealDir(item.caminho);}
      else if(item.tipo==='pasta'){const open=f.open.has(item.caminho);b.setAttribute('aria-expanded',String(open));b.append(node('span','','chev fold'+(open?' open':'')));b.onclick=()=>toggle(item.caminho);}
      else{b.append(node('span','','chev'));b.onclick=()=>openFile(item.caminho);if(item.caminho===f.active)b.setAttribute('aria-current','true');
        // arrastar o arquivo da árvore pra um painel (ou pra borda dele) abre ali
        if(item.tipo==='arquivo'){b.draggable=true;b.addEventListener('dragstart',e=>{e.dataTransfer.setData('text/x-ratoeira-arquivo',item.caminho);e.dataTransfer.effectAllowed='copy';document.body.classList.add('arrastando-aba');});b.addEventListener('dragend',()=>document.body.classList.remove('arrastando-aba'));}}
      if(item.tipo!=='atalho'||item.alvo==='pasta'){b.addEventListener('contextmenu',e=>{e.preventDefault();menuArvore(item,e.clientX,e.clientY,b);});
        b.addEventListener('keydown',e=>{if(e.key==='ContextMenu'||(e.shiftKey&&e.key==='F10')){e.preventDefault();const r=b.getBoundingClientRect();menuArvore(item,r.left+24,r.bottom,b);}});}
      b.append(icon(item));const label=node('span',item.nome,'tname');b.append(label);
      const pub=publicadoDe(item.caminho);if(pub)b.append(globoPub(pub));
      if(item.foraDoGit){b.classList.add('fora');if(!paiFora){const s=node('span',undefined,'tfora');s.append(svg('fora'));s.title=item.tipo==='pasta'?FORA_PASTA:FORA_ARQ;s.setAttribute('aria-label',s.title);s.setAttribute('role','img');b.append(s);}}
      if(flat){const dir=item.caminho.split('/').slice(0,-1).join('/');if(dir)b.append(node('span',dir,'tdir'));b.title=item.caminho;}
      // atalho pra pasta (desde 28/10/2026): não abre por aqui, mas o toque e o botão direito oferecem conversar nela
      if(item.tipo==='atalho'&&item.alvo==='pasta'){b.onclick=()=>{const r=b.getBoundingClientRect();menuArvore(item,r.left+24,r.bottom,b);};b.title='Atalho pra uma pasta: abre o menu pra conversar nela.';}
      else if(item.tipo==='atalho'){b.disabled=true;b.title='Atalho (symlink): não abre por aqui.';}
      return b;
    }
    function renderTree(){
      if(f.searching)return;
      const list=$('files-list');list.replaceChildren();
      const walk=(dir,depth,fora)=>{const items=f.children.get(dir);if(!items)return;for(const item of items){list.append(row(item,depth,false,fora));if(item.tipo==='pasta'&&f.open.has(item.caminho)){if(f.children.has(item.caminho))walk(item.caminho,depth+1,fora||Boolean(item.foraDoGit));else list.append(node('p','Carregando…','tloading'));}}};
      walk('',0,false);
      if(!list.childElementCount)list.append(node('p','Nada por aqui.','tloading'));
    }
    window.addEventListener('ratoeira:publicados',()=>{if(f.loaded&&!f.searching)renderTree();});
    async function toggle(dir){
      if(f.open.has(dir)){f.open.delete(dir);renderTree();return;}
      f.open.add(dir);renderTree();
      if(f.children.has(dir)){load(dir).catch(()=>{});return;}
      try{await load(dir);}catch(error){f.open.delete(dir);toast(error.message);}
      renderTree();
    }
    async function reveal(rel){
      const parts=rel.split('/');
      for(let i=0;i<parts.length-1;i++){const dir=parts.slice(0,i+1).join('/');f.open.add(dir);try{await load(dir);}catch{break;}}
      renderTree();
      requestAnimationFrame(()=>{const el=[...$('files-list').querySelectorAll('.trow')].find(b=>b.dataset.path===rel);el?.scrollIntoView({block:'nearest'});});
    }
    // Cada arquivo aberto é uma aba da grade (grid.js): o conteúdo (iframe) e a barra dele andam juntos, em qualquer painel.
    const G=window.ratoeiraGrid,idDe=rel=>'a:'+rel;
    function frameFor(tab){
      tab.frame?.remove();tab.frame=null;
      if(tab.mode==='none'){const box=node('div',undefined,'files-none');box.append(node('p','Este tipo de arquivo não tem visualização no navegador.'));const a=node('a','Baixar '+tab.rel.split('/').pop(),'primary-link');a.href='/_ratoeira/arquivo/'+encodePath(tab.rel)+'?baixar=1';a.onclick=e=>{baixarArquivo(e,tab.rel);};box.append(a);tab.frame=box;tab.holder.append(box);return;}
      const frame=document.createElement('iframe');frame.title=tab.rel;frame.referrerPolicy='no-referrer';
      // PDF, imagem e mídia não executam nada; o Chrome se recusa a mostrar PDF em iframe com sandbox.
      if(!(tab.mode==='render'&&INERT.has(ext(tab.rel))))frame.setAttribute('sandbox','allow-scripts allow-forms allow-downloads allow-popups');
      // linha pedida (caminho clicado no chat): o modo Original tem âncora #L<n> em cada linha
      frame.src=urlOf(tab.rel,tab.mode)+(tab.linha&&tab.mode==='source'?'#L'+tab.linha:'');tab.frame=frame;tab.holder.append(frame);
    }
    function botaoIcone(tag,nome,rotulo){const b=node(tag,undefined,'ib');if(tag==='button')b.type='button';b.setAttribute('aria-label',rotulo);b.title=rotulo;b.append(svg(nome));return b;}
    // Barra do arquivo (caminho, Renderizado/Original, copiar link, nova aba, baixar): montada uma vez por aba.
    function barraDe(tab){
      if(!tab.barraEl){
        // caminho: no celular fica curto (mostra o fim); tocar copia o caminho inteiro
        const barra=node('div',undefined,'files-bar'),caminho=node('span',tab.rel,'files-path');caminho.title=tab.rel+' (clique pra copiar)';
        caminho.setAttribute('role','button');caminho.tabIndex=0;caminho.setAttribute('aria-label','Copiar o caminho '+tab.rel);
        caminho.onclick=()=>copiarCaminho(tab.rel);caminho.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();copiarCaminho(tab.rel);}};
        const seg=node('div',undefined,'seg');seg.setAttribute('role','group');seg.setAttribute('aria-label','Modo de visualização');
        // no celular os modos viram só ícone (olho e código); o nome fica no title e no leitor de tela
        const modo=(texto,icone,m)=>{const b=node('button',undefined,'seg-modo');b.type='button';b.title=texto;b.setAttribute('aria-label',texto);b.append(svg(icone),node('span',texto));b.onclick=()=>setMode(tab,m);return b;};
        const r=modo('Renderizado','olho','render'),o=modo('Original','codigo','source');seg.append(r,o);
        const copiar=botaoIcone('button','link','Copiar link pro time');copiar.onclick=()=>copiarLink(tab.rel);
        const enviar=botaoIcone('button','enviar','Enviar (WhatsApp, e-mail…)');enviar.hidden=!PODE_ENVIAR;enviar.onclick=()=>enviarArquivo(tab.rel);
        const abrir=botaoIcone('a','ext','Abrir em nova aba');abrir.target='_blank';abrir.rel='noopener noreferrer';abrir.classList.add('files-open');
        const baixar=botaoIcone('a','baixar','Baixar');baixar.href='/_ratoeira/arquivo/'+encodePath(tab.rel)+'?baixar=1';baixar.setAttribute('download','');baixar.onclick=e=>{baixarArquivo(e,tab.rel);};
        // edição: Editar troca o arquivo pelo editor; Salvar e Sair aparecem no lugar dos modos
        const editar=node('button',undefined,'files-editar');editar.type='button';editar.append(svg('editar'),node('span','Editar'));editar.title='Editar este arquivo';editar.setAttribute('aria-label','Editar');editar.onclick=()=>entrarEdicao(tab);
        const salvarB=node('button','Salvar','primary files-salvar');salvarB.type='button';salvarB.title='Salvar (⌘S / Ctrl+S)';salvarB.onclick=()=>salvarEdicao(tab);
        const sair=node('button','Sair da edição','files-sair');sair.type='button';sair.onclick=()=>sairEdicao(tab);
        const estadoEd=node('span','','files-estado');estadoEd.setAttribute('role','status');
        const hist=botaoIcone('button','historico','Histórico: quem editou e o que mudou');hist.setAttribute('aria-pressed','false');hist.onclick=()=>historicoDe(tab);
        // recarregar: o agente pode ter mudado o arquivo no meio da conversa (o commit, que atualiza as abas sozinho, só sai no fim)
        const recarregar=botaoIcone('button','recarregar','Recarregar o arquivo');recarregar.onclick=()=>{if(tab.frame?.tagName==='IFRAME')tab.frame.src=tab.frame.src;};
        const acoes=node('div',undefined,'files-actions');acoes.append(estadoEd,salvarB,sair,editar,seg,recarregar,hist,enviar,copiar,abrir,baixar);
        // Publicar (Publicados, playground.mjs): página HTML vira link de fora; o agente pergunta quem vê
        if(state.portal?.playground&&state.portal?.chat&&PUBLICAVEL.test(tab.rel)){const pub=botaoIcone('button','mundo','Publicar: um link pra abrir fora da Ratoeira');pub.dataset.pubRel=tab.rel;pub.onclick=()=>publicarArquivo(tab.rel);acoes.insertBefore(pub,copiar);window.ratoeiraMarcarGlobos?.([pub]);}
        barra.append(caminho,acoes);Object.assign(tab,{barraEl:barra,segR:r,segO:o,seg,abrirEl:abrir,recarregarEl:recarregar,histBtn:hist,editarBtn:editar,salvarBtn:salvarB,sairBtn:sair,estadoEl:estadoEd});
      }
      const m=modesOf(tab.rel);tab.segR.hidden=!m.render;tab.segO.hidden=!m.source;tab.seg.hidden=!(m.render&&m.source);
      tab.segR.setAttribute('aria-pressed',String(tab.mode==='render'));tab.segO.setAttribute('aria-pressed',String(tab.mode==='source'));
      tab.abrirEl.hidden=tab.mode==='none';tab.abrirEl.href=urlOf(tab.rel,tab.mode);
      const editando=Boolean(tab.ed);
      tab.recarregarEl.hidden=tab.mode==='none'||editando;
      tab.editarBtn.hidden=editando||!podeEditar(tab.rel);tab.salvarBtn.hidden=tab.sairBtn.hidden=!editando;
      if(editando)tab.seg.hidden=true;tab.salvarBtn.disabled=!tab.ed?.sujo||tab.ed?.salvando;
      return tab.barraEl;
    }
    // ── Editor (CodeMirror, carregado só no primeiro "Editar") ──
    // Ler e salvar vão pelo servidor de agentes da pessoa, que roda como ela: o Linux decide o que ela pode mexer,
    // e o commit sai no nome dela (como o commit-turno faz com o que o agente edita). Salvar confere se o arquivo
    // mudou desde que ela abriu; se mudou, pergunta antes de escrever por cima.
    const podeEditar=rel=>Boolean(state.portal?.chat&&window.ratoeiraPedir)&&modesOf(rel).source;
    let moduloEditor=null;
    const raizDoRepo=()=>state.portal.chat.pastaPadrao;
    function estadoEdicao(tab,texto,classe=''){tab.estadoEl.textContent=texto;tab.estadoEl.className='files-estado '+classe;}
    function marcarSujo(tab,sujo){
      if(!tab.ed||tab.ed.sujo===sujo)return;tab.ed.sujo=sujo;
      G.atualizar(idDe(tab.rel),{titulo:(sujo?'● ':'')+tab.rel.split('/').pop()});
      estadoEdicao(tab,sujo?'Não salvo':'',sujo?'sujo':'');barraDe(tab);
    }
    async function entrarEdicao(tab){
      if(tab.ed)return;
      estadoEdicao(tab,'Abrindo o editor…');tab.editarBtn.disabled=true;
      try{
        moduloEditor??=await import('/_ratoeira/editor.js');
        const r=await window.ratoeiraPedir('ler',{raiz:raizDoRepo(),caminho:tab.rel});
        const box=node('div',undefined,'editor-box');tab.holder.append(box);
        tab.ed={box,hash:r.hash,sujo:false,salvando:false};
        tab.ed.api=moduloEditor.criarEditor(box,{texto:r.texto,caminho:tab.rel,aoMudar:()=>marcarSujo(tab,true),aoSalvar:()=>salvarEdicao(tab)});
        estadoEdicao(tab,'');barraDe(tab);G.desenhar();tab.ed.api.focar();
      }catch(e){estadoEdicao(tab,'');toast('Não abri o editor: '+e.message);}
      finally{tab.editarBtn.disabled=false;}
    }
    async function salvarEdicao(tab,{forcar=false}={}){
      const ed=tab.ed;if(!ed||ed.salvando||(!ed.sujo&&!forcar))return true;
      ed.salvando=true;barraDe(tab);estadoEdicao(tab,'Salvando…');
      try{
        const texto=ed.api.texto();
        const r=await window.ratoeiraPedir('salvar',{raiz:raizDoRepo(),caminho:tab.rel,texto,base:ed.hash,forcar});
        if(r.conflito){
          ed.salvando=false;estadoEdicao(tab,'Não salvo','sujo');barraDe(tab);
          const q=await perguntar('O arquivo mudou desde que tu abriu','Alguém salvou, um agente editou ou o sync trouxe uma versão nova. O que tu quer fazer?',[['forcar','Salvar a minha por cima','primary'],['recarregar','Ficar com a versão nova (perde as minhas mudanças)'],['cancelar','Cancelar']]);
          if(q==='forcar')return salvarEdicao(tab,{forcar:true});
          if(q==='recarregar'){const n=await window.ratoeiraPedir('ler',{raiz:raizDoRepo(),caminho:tab.rel});ed.api.trocar(n.texto);ed.hash=n.hash;marcarSujo(tab,false);estadoEdicao(tab,'Versão nova carregada');}
          return false;
        }
        ed.hash=r.hash;ed.salvando=false;marcarSujo(tab,false);
        estadoEdicao(tab,r.commit?'Salvo · commit '+r.commit:'Salvo','ok');
        // o arquivo renderizado (atrás do editor) passa a mostrar a versão nova
        if(tab.frame?.tagName==='IFRAME')tab.frame.src=tab.frame.src;
        return true;
      }catch(e){ed.salvando=false;estadoEdicao(tab,'Não salvo','sujo');barraDe(tab);toast('Não salvei: '+e.message);return false;}
      finally{if(tab.ed)tab.ed.salvando=false;barraDe(tab);}
    }
    // Sair do editor (ou fechar a aba) com alteração: salvar, descartar ou continuar editando.
    async function podeSairDaEdicao(tab){
      if(!tab.ed?.sujo)return true;
      G.mostrar(idDe(tab.rel));
      const q=await perguntar('Salvar as alterações em '+tab.rel.split('/').pop()+'?','Se tu descartar, o que mudou desde o último salvar se perde.',[['salvar','Salvar','primary'],['descartar','Descartar'],['cancelar','Continuar editando']]);
      if(q==='salvar')return salvarEdicao(tab);
      return q==='descartar';
    }
    async function sairEdicao(tab){
      if(!tab.ed||!await podeSairDaEdicao(tab))return;
      tab.ed.api.destruir();tab.ed.box.remove();tab.ed=null;
      G.atualizar(idDe(tab.rel),{titulo:tab.rel.split('/').pop()});estadoEdicao(tab,'');barraDe(tab);G.desenhar();
    }
    // Recarregar ou fechar o navegador com arquivo não salvo: o navegador pergunta.
    window.addEventListener('beforeunload',e=>{if([...f.abas.values()].some(t=>t.ed?.sujo)){e.preventDefault();e.returnValue='';}});
    // ── Histórico do arquivo: painel por cima do arquivo, com quem editou, quando e o que mudou (git log) ──
    const quandoFoi=iso=>{const d=new Date(iso),s=(Date.now()-d)/1000;if(s<60)return 'agora';if(s<3600)return 'há '+Math.round(s/60)+' min';if(s<86400)return 'há '+Math.round(s/3600)+' h';if(s<7*86400)return 'há '+Math.round(s/86400)+(s<1.5*86400?' dia':' dias');return d.toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit',year:'numeric'});};
    const quandoExato=iso=>new Date(iso).toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'});
    const automatico=msg=>/^auto-sync:/.test(msg||'');
    function historicoDe(tab){
      if(tab.hist){tab.hist.remove();tab.hist=null;tab.histBtn.setAttribute('aria-pressed','false');return;}
      const box=node('aside',undefined,'hist');box.setAttribute('aria-label','Histórico de '+tab.rel);box.tabIndex=-1;
      box.addEventListener('keydown',e=>{if(e.key==='Escape'){e.stopPropagation();historicoDe(tab);tab.histBtn.focus();}});
      tab.hist=box;tab.holder.append(box);tab.histBtn.setAttribute('aria-pressed','true');
      listaHist(tab);
    }
    function cabHist(tab,titulo,voltar=null){
      const cab=node('div',undefined,'hist-cab');
      if(voltar){const v=botaoIcone('button','voltar','Voltar à lista');v.onclick=voltar;cab.append(v);}
      cab.append(node('strong',titulo));
      const x=node('button','×','ib hist-x');x.type='button';x.setAttribute('aria-label','Fechar histórico');x.onclick=()=>historicoDe(tab);cab.append(x);
      return cab;
    }
    async function listaHist(tab){
      const box=tab.hist;box.replaceChildren(cabHist(tab,'Histórico'),node('p','Carregando…','hist-msg'));box.focus();
      let r;try{r=await api('/arquivos/historico?caminho='+encodeURIComponent(tab.rel));}catch(e){if(tab.hist===box)box.lastChild.textContent=e.message;return;}
      if(tab.hist!==box)return;box.lastChild.remove();
      if(!r.disponivel){box.append(node('p','Esta pasta não usa git: não há histórico.','hist-msg'));return;}
      if(!r.itens.length){box.append(node('p','Ainda sem histórico: o arquivo não foi commitado.','hist-msg'));return;}
      const ult=r.itens[0];box.append(node('p','Última edição: '+ult.autor+', '+quandoFoi(ult.quando)+'.','hist-ultima'));
      const ul=node('ul',undefined,'hist-lista');
      for(const it of r.itens){
        const li=node('li'),b=node('button',undefined,'hist-item');b.type='button';b.title=it.autor+' <'+it.email+'> · '+quandoExato(it.quando)+' · '+it.curto;
        const topo=node('span',undefined,'hist-topo');topo.append(appIcon(it.autor),node('strong',it.autor),node('span',quandoFoi(it.quando),'hist-quando'));
        b.append(topo,node('span',automatico(it.mensagem)?'Sincronização automática':it.mensagem,'hist-msg-commit'+(automatico(it.mensagem)?' auto':'')));
        b.onclick=()=>detalheHist(tab,it);li.append(b);ul.append(li);
      }
      box.append(ul);
      if(r.itens.length>=60)box.append(node('p','Mostrando as 60 últimas edições.','hist-msg'));
    }
    // Uma edição: o diff (o que entrou e saiu) e, se quiser, o arquivo inteiro como estava.
    async function detalheHist(tab,it){
      const box=tab.hist;if(!box)return;
      box.replaceChildren(cabHist(tab,it.curto,()=>listaHist(tab)));
      const meta=node('div',undefined,'hist-meta');meta.append(node('p',automatico(it.mensagem)?'Sincronização automática ('+it.mensagem+')':it.mensagem,'hist-titulo'),node('p',it.autor+' · '+quandoExato(it.quando),'hist-quem'));
      const alternar=node('button','Ver o arquivo como estava');alternar.type='button';alternar.hidden=true;
      const corpo=node('div',undefined,'hist-corpo');corpo.append(node('p','Carregando…','hist-msg'));
      meta.append(alternar);box.append(meta,corpo);box.focus();
      const falta=()=>node('p','Essa versão não está guardada na VPS: o repositório lá guarda o histórico de quem editou, mas só as versões mais recentes dos arquivos.','hist-msg');
      let modo='diff';
      const mostrar=async()=>{
        corpo.replaceChildren(node('p','Carregando…','hist-msg'));
        try{
          if(modo==='diff'){
            const r=await api('/arquivos/mudanca?caminho='+encodeURIComponent(tab.rel)+'&commit='+it.commit);if(tab.hist!==box)return;
            alternar.hidden=r.estado==='falta'||r.estado==='apagado';
            if(r.estado==='falta'){corpo.replaceChildren(falta());return;}
            if(r.estado==='apagado'){corpo.replaceChildren(node('p','O arquivo foi apagado nessa edição.','hist-msg'));return;}
            const pre=node('pre',undefined,'hist-diff');
            if(r.estado==='novo')corpo.replaceChildren(node('p','O arquivo nasceu nessa edição.','hist-nota'));else corpo.replaceChildren();
            for(const l of r.diff.split('\n')){const c=l[0]==='+'?'add':l[0]==='-'?'del':l.startsWith('@@')?'hunk':l.startsWith('\\')?'hunk':'';pre.append(node('span',l.startsWith('@@')?'···':l||' ',c));}
            corpo.append(pre);
          }else{
            const r=await api('/arquivos/versao?caminho='+encodeURIComponent(tab.rel)+'&commit='+it.commit);if(tab.hist!==box)return;
            if(r.estado==='falta'){corpo.replaceChildren(falta());return;}
            const pre=node('pre',undefined,'hist-diff hist-texto');for(const l of r.texto.replace(/\n$/,'').split('\n'))pre.append(node('span',l||' '));corpo.replaceChildren(pre);
          }
        }catch(e){if(tab.hist===box)corpo.replaceChildren(node('p',e.message,'hist-msg'));}
      };
      alternar.onclick=()=>{modo=modo==='diff'?'texto':'diff';alternar.textContent=modo==='diff'?'Ver o arquivo como estava':'Ver o que mudou';mostrar();};
      mostrar();
    }
    function setHash(rel){const target='#arquivos'+(rel?'/'+encodePath(rel):'');if(location.hash!==target)history.replaceState(null,'',target);}
    function marcarArvore(rel){document.querySelectorAll('#files-list .trow[aria-current]').forEach(b=>b.removeAttribute('aria-current'));const el=[...$('files-list').querySelectorAll('.trow')].find(b=>b.dataset.path===rel);el?.setAttribute('aria-current','true');}
    // O arquivo "ativo" é o da aba ativa do painel em foco: vai pro endereço, pro título e pra árvore.
    const avisarArquivo=()=>window.dispatchEvent(new CustomEvent('ratoeira:arquivo-ativo'));
    function ativo(rel){if(f.active!==rel){f.active=rel;avisarArquivo();}if(document.body.dataset.view!=='arquivos')return;setHash(rel);marcarArvore(rel);if(rel)tituloMesa(rel.split('/').pop());}
    G.ao('aoFocar',aba=>{if(aba?.tipo==='arquivo')ativo(aba.rel);else if(aba?.tipo==='app'){appFocada(aba.url);if(document.body.dataset.view==='arquivos'){setHash(null);tituloMesa(aba.titulo);}}});
    G.ao('aoVoltar',()=>{$('files').dataset.mobile='arvore';});
    // Celular: seletor Arquivos · Abas · + Conversa no topo da Mesa (no computador fica escondido).
    // data-mobile: arvore (Arquivos), abas (lista do que está aberto) ou arquivo (a aba aberta, na grade).
    const mesa=$('files');
    const ICONE_MESA={
      conversa:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5h14a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-8l-4 3v-3H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z"/></svg>',
      arquivo:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/></svg>',
      terminal:'<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="3"/><path d="m7 9 3 3-3 3m6 0h4"/></svg>',
      app:'<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="6.5" height="6.5" rx="2"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="2"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="2"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="2"/></svg>'};
    // A lista é redesenhada a cada mudança da grade; o bloco de recentes fica fora dela pra não perder a busca.
    const abertasBox=node('div',undefined,'mesa-abertas');
    function listaMesa(lista){
      const box=abertasBox;box.replaceChildren();
      if(!$('mesa-lista').contains(box))$('mesa-lista').prepend(box);
      recentesMesa.bloco.hidden=!state.portal?.chat;
      if(!$('mesa-lista').contains(recentesMesa.bloco))$('mesa-lista').append(recentesMesa.bloco);
      if(!lista.length){box.append(node('p','Nada aberto. Abre um arquivo ou começa uma conversa.','mesa-vazio'));return;}
      for(const a of lista){
        const linha=node('div',undefined,'mesa-item'),abrir=node('button',undefined,'mesa-abrir');abrir.type='button';
        // conversa: a marca do agente, como na aba do computador
        const ic=node('span',undefined,'mesa-ic'),marca=a.tipo==='conversa'&&a.icone?G.icone(a.icone):null;
        if(marca)ic.append(marca);else ic.innerHTML=ICONE_MESA[['arquivo','app','terminal'].includes(a.tipo)?a.tipo:'conversa'];
        const txt=node('span',undefined,'mesa-txt'),sub=node('span',undefined,'mesa-sub');
        if(a.espera)sub.append(node('span','Espera tua resposta','mesa-espera'));
        else if(a.rodando)sub.append(node('i',undefined,'dot acc'));
        else if(a.pronta)sub.append(node('i',undefined,'dot ok'));
        const agente={claude:'Claude',codex:'Codex'}[a.icone]||'';
        const apoio=a.tipo==='arquivo'?a.dica:a.tipo==='nova'?'':a.tipo==='conversa'?[agente,a.rodando&&!a.espera?'rodando':a.pronta?'resposta nova':''].filter(Boolean).join(' · '):a.tipo==='terminal'?'Terminal':a.tipo==='app'?'App':'';
        if(apoio)sub.append(node('span',apoio,a.tipo==='arquivo'?'mono':undefined));
        txt.append(node('span',a.titulo,'mesa-tit'),sub);abrir.append(ic,txt);
        abrir.onclick=()=>{G.mostrar(a.id);mesa.dataset.mobile='arquivo';};
        const x=node('button','×','mesa-x');x.type='button';x.setAttribute('aria-label','Fechar '+a.titulo);x.onclick=()=>G.fechar(a.id);
        linha.append(abrir,x);box.append(linha);
      }
    }
    // Conversas recentes, embaixo das abas: fechada por padrão e só busca a lista quando abre (a tela de abas já
    // custa pra carregar no celular). Mostra as que não estão abertas aqui; a busca vasculha as 40 últimas.
    const recentesMesa=(()=>{
      const bloco=node('div',undefined,'mesa-rec'),botao=node('button',undefined,'mesa-rec-abrir'),corpo=node('div',undefined,'mesa-rec-corpo');
      botao.type='button';botao.setAttribute('aria-expanded','false');
      botao.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>';
      botao.append(node('span','Conversas recentes','mesa-rec-t'),node('span','›','mesa-rec-seta'));
      const busca=node('input',undefined,'mesa-rec-busca');busca.type='search';busca.placeholder='Buscar conversa';busca.setAttribute('aria-label','Buscar conversa');
      const lista=node('div',undefined,'mesa-rec-lista');corpo.append(busca,lista);corpo.hidden=true;bloco.append(botao,corpo);
      let itens=null;
      const msg=t=>lista.replaceChildren(node('p',t,'mesa-vazio'));
      function desenhar(){
        if(!itens)return;
        const q=busca.value.trim().toLowerCase();
        const achadas=itens.filter(a=>!q||(a.titulo||'').toLowerCase().includes(q)||(a.cwd||'').toLowerCase().includes(q)).slice(0,q?40:8);
        if(!achadas.length){msg(q?'Nenhuma conversa com esse termo.':'Nenhuma outra conversa.');return;}
        lista.replaceChildren(...achadas.map(a=>{
          const linha=node('div',undefined,'mesa-item'),abrir=node('button',undefined,'mesa-abrir');abrir.type='button';
          const ic=node('span',undefined,'mesa-ic'),marca=G.icone(a.agente);if(marca)ic.append(marca);else ic.innerHTML=ICONE_MESA.conversa;
          const txt=node('span',undefined,'mesa-txt'),sub=node('span',undefined,'mesa-sub');
          if(a.estado==='esperando')sub.append(node('span','Espera tua resposta','mesa-espera'));
          else if(a.estado==='rodando')sub.append(node('i',undefined,'dot acc'));
          const onde=(a.cwd||'').replace(/^\/home\/[^/]+\//,'~/').split('/').filter(Boolean).pop()||'';
          sub.append(node('span',[a.nomeAgente,quandoRec(a.atualizada),onde].filter(Boolean).join(' · ')));
          txt.append(node('span',a.titulo||'Sem título','mesa-tit'),sub);abrir.append(ic,txt);
          abrir.onclick=()=>{fechar();window.ratoeiraAbrirConversa?.(a.agente,a.sessao,a.titulo);};
          linha.append(abrir);return linha;
        }));
      }
      async function carregar(){
        itens=null;msg('Carregando…');
        try{itens=await window.ratoeiraRecentes();desenhar();}catch(e){msg('Não consegui listar: '+(e?.message||e));}
      }
      function fechar(){corpo.hidden=true;botao.setAttribute('aria-expanded','false');itens=null;lista.replaceChildren();busca.value='';}
      botao.onclick=()=>{if(!corpo.hidden){fechar();return;}corpo.hidden=false;botao.setAttribute('aria-expanded','true');carregar();};
      busca.addEventListener('input',desenhar);
      return {bloco,fechar};
    })();
    function quandoRec(iso){if(!iso)return'';const s=(Date.now()-Date.parse(iso))/1000;if(s<60)return'agora';if(s<3600)return Math.round(s/60)+' min';if(s<86400)return Math.round(s/3600)+' h';return new Date(iso).toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit'});}
    function seletorMesa(){
      const m=mesa.dataset.mobile,lista=G.lista();
      // fechou a última aba com ela na tela: volta pra lista (que mostra o vazio), não pra um painel em branco
      if(m==='arquivo'&&!G.ids().length){mesa.dataset.mobile='abas';return;}
      // Arquivos e Conversas são a mesma coluna (chat.js, trocarColuna): o botão de cima escolhe o que ela mostra
      const conv=m==='arvore'&&mesa.dataset.coluna==='conversas';$('mesa-conversas').hidden=!window.ratoeiraColuna;
      $('mesa-arquivos').setAttribute('aria-selected',String(m==='arvore'&&!conv));$('mesa-conversas').setAttribute('aria-selected',String(conv));$('mesa-abas').setAttribute('aria-selected',String(m!=='arvore'));
      $('mesa-abas-n').textContent=String(lista.length);$('mesa-abas-n').hidden=!lista.length;$('mesa-nova').hidden=!state.portal?.chat;
      if(m==='abas')listaMesa(lista);else recentesMesa.fechar();
    }
    new MutationObserver(seletorMesa).observe(mesa,{attributes:true,attributeFilter:['data-mobile','data-coluna']});
    G.ao('aoDesenhar',seletorMesa);
    // a barra do celular aparece em todas as telas: acerta o seletor (e o botão de conversa nova) também fora da Mesa
    window.addEventListener('ratoeira:view',seletorMesa);
    // no celular a barra é a mesma em todas as telas (25/10/2026): fora da Mesa, o botão leva pra ela já naquela vista
    const irMesa=()=>{if(document.body.dataset.view!=='arquivos')location.hash='#arquivos';};
    $('mesa-arquivos').onclick=()=>{window.ratoeiraColuna?.('arquivos');mesa.dataset.mobile='arvore';irMesa();};
    $('mesa-conversas').onclick=()=>{window.ratoeiraColuna?.('conversas');mesa.dataset.mobile='arvore';irMesa();};
    $('mesa-abas').onclick=()=>{mesa.dataset.mobile='abas';irMesa();};
    $('mesa-nova').onclick=async()=>{await window.ratoeiraNovaConversa?.();mesa.dataset.mobile='arquivo';};
    G.ao('soltarArquivo',(rel,painel)=>openFile(rel,{painel}));
    function lembrar(rel){try{const r=JSON.parse(localStorage.getItem('ratoeira:arquivos-recentes')||'[]').filter(x=>x!==rel);localStorage.setItem('ratoeira:arquivos-recentes',JSON.stringify([rel,...r].slice(0,8)));}catch{}}
    function criarAba(rel){let tab=f.abas.get(rel);if(!tab){tab={rel,mode:defaultMode(rel),holder:node('div',undefined,'arq')};f.abas.set(rel,tab);}return tab;}
    function registrarAba(tab,opts){
      G.registrar({id:idDe(tab.rel),tipo:'arquivo',rel:tab.rel,titulo:tab.rel.split('/').pop(),dica:tab.rel,el:tab.holder,
        barra:()=>barraDe(tab),aoMostrar:()=>{if(!tab.frame)frameFor(tab);},aoFechar:()=>fecharAba(tab.rel),antesDeFechar:()=>podeSairDaEdicao(tab)},opts);
    }
    // Mais de MAX_TABS arquivos: fecha o mais antigo que não está à vista.
    function limitarAbas(novo){if(f.abas.size<=MAX_TABS)return;const velho=[...f.abas.values()].find(t=>t.rel!==novo&&t.holder.hidden&&!t.ed);if(velho)G.fechar(idDe(velho.rel));}
    function openFile(rel,{painel=null}={}){
      lembrar(rel);const novo=!f.abas.has(rel);const tab=criarAba(rel);
      registrarAba(tab,{painel});if(novo)limitarAbas(rel);
      ativo(rel);$('files').dataset.mobile='arquivo';
    }
    function fecharAba(rel){const tab=f.abas.get(rel);if(!tab)return;if(tab.ed){tab.ed.api.destruir();tab.ed=null;}tab.holder.remove();f.abas.delete(rel);if(f.active===rel){f.active=null;avisarArquivo();}}
    function setMode(tab,mode){if(tab.mode===mode)return;tab.mode=mode;tab.linha=null;frameFor(tab);barraDe(tab);G.desenhar();}
    // Aplicações do sistema (servidor próprio, ex.: o Pipeline) também abrem como aba da grade, do lado dos arquivos
    // e das conversas. Só as da config (systemApps): o endereço nunca vem do hash nem de quem clica. Sem sandbox,
    // porque elas já rodam neste mesmo endereço e precisam do login da Ratoeira (o cookie não vai pra iframe em sandbox).
    const apps=new Map(),idApp=url=>'p:'+url;
    const appDe=url=>(state.portal?.systemApps||[]).find(a=>a.url===url)||null;
    // endereço dentro de uma aplicação (ex.: /pedidos/clientes/acme): só caminho deste site, debaixo do prefixo dela
    const appDoCaminho=c=>{if(typeof c!=='string'||!c.startsWith('/')||c.startsWith('//'))return null;return (state.portal?.systemApps||[]).find(a=>c.startsWith(a.url))||null;};
    // A "tela atual" que o chat oferece como contexto: a página aberta agora na aba de aplicação que teve foco por último.
    let recente=null;
    function appFocada(url){if(!url||recente===url)return;recente=url;avisarTela();}
    const avisarTela=()=>window.dispatchEvent(new CustomEvent('ratoeira:app-tela'));
    function telaDe(t){
      // a aplicação que carrega /_ratoeira/app.js diz a tela ela mesma (ratoeira.tela); as outras, o portal lê por dentro
      if(t.tela){const {titulo,detalhe,endereco}=t.tela;return {url:t.app.url,app:t.app,titulo:titulo+(detalhe?' › '+detalhe:''),endereco,...(detalhe?{detalhe}:{})};}
      let titulo=t.app.name,endereco=t.app.url;
      try{const w=t.frame.contentWindow,u=new URL(w.location.href);
        if(u.origin===location.origin){endereco=u.pathname+u.search+u.hash;const partes=String(w.document.title||'').split(' · ').filter(p=>p&&!p.includes(t.app.name));if(partes.length)titulo=partes.join(' · ');}
        // o que está aberto por cima da tela (ex.: o card de um cliente): o primeiro visível dos seletores da config
        const sel=t.app.chat?.detalhe;
        if(sel){const e=[...w.document.querySelectorAll(sel)].find(x=>x.getClientRects().length);const txt=e?.textContent.replace(/\s+/g,' ').trim().slice(0,120);if(txt)return {url:t.app.url,app:t.app,titulo:titulo+' › '+txt,endereco,detalhe:txt};}
      }catch{}
      return {url:t.app.url,app:t.app,titulo,endereco};
    }
    // Página da aplicação carregou (ou navegou): some o chat próprio dela, os botões que abriam ele passam a abrir o
    // da Ratoeira, e o chat fica sabendo da tela nova.
    function aoCarregarApp(t){
      const c=t.app.chat;
      try{
        const w=t.frame.contentWindow,d=w.document;
        if(c?.esconder||c?.css){const st=d.createElement('style');st.textContent=(c.esconder?c.esconder+'{display:none!important}':'')+(c.css||'');d.head.append(st);}
        // quem carrega o app.js já fala com a Ratoeira por ele: nada de ponte trocada nem de observar a página
        if(w.ratoeira)t.appJs=true;
        if(c?.ponte&&!t.appJs)w[c.ponte]={
          nova:texto=>window.dispatchEvent(new CustomEvent('ratoeira:app-pedido',{detail:{url:t.app.url,texto:String(texto||''),enviar:true}})),
          sobre:dados=>window.dispatchEvent(new CustomEvent('ratoeira:app-pedido',{detail:{url:t.app.url,texto:'Sobre '+(dados?.cliente||dados?.nome||'')+': ',enviar:false}})),
        };
      }catch{}
      // card que abre/fecha e endereço trocado sem recarregar a página não disparam "load": observa a página
      t.obs?.disconnect();
      if(!t.appJs)try{
        const w=t.frame.contentWindow;
        t.obs=new w.MutationObserver(()=>{clearTimeout(t.obsT);t.obsT=setTimeout(()=>{const k=JSON.stringify(telaDe(t));if(k!==t.ultima){t.ultima=k;if(recente===t.app.url)avisarTela();}},250);});
        t.obs.observe(w.document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['class','open','hidden','style']});
        t.ultima=JSON.stringify(telaDe(t));
      }catch{}
      appFocada(t.app.url);avisarTela();
    }
    // Pro chat (chat.js): a tela atual, e recarregar os dados da aplicação quando o agente termina.
    // Mensagens do /_ratoeira/app.js de cada aba de aplicação (postMessage, pra valer também quando cada
    // aplicação tiver endereço próprio): ola (página nova), tela (o que está aberto), chat (pedido ao chat), abrir (conversa existente).
    const txt=(v,n)=>typeof v==='string'?v.replace(/\s+/g,' ').trim().slice(0,n):'';
    // pedido ao chat: mantém as quebras de linha (apontamentos de revisão chegam em lista), teto de 20 mil caracteres
    const pedidoTxt=v=>typeof v==='string'?v.replace(/\r\n?/g,'\n').replace(/[ \t]+$/gm,'').trim().slice(0,20000):'';
    window.addEventListener('message',e=>{
      const m=e.data;if(!m||m.ratoeira!==1||e.origin!==location.origin)return;
      const t=[...apps.values()].find(x=>x.frame&&x.frame.contentWindow===e.source);if(!t)return;
      if(m.tipo==='ola'){t.tela=null;t.appJs=true;return;}
      if(m.tipo==='tela'){
        const nova={titulo:txt(m.titulo,120)||t.app.name,detalhe:txt(m.detalhe,120)||null,endereco:txt(m.endereco,500)||t.app.url};
        if(JSON.stringify(nova)===JSON.stringify(t.tela))return;
        t.tela=nova;if(recente===t.app.url)avisarTela();return;
      }
      if(m.tipo==='chat'){appFocada(t.app.url);window.dispatchEvent(new CustomEvent('ratoeira:app-pedido',{detail:{url:t.app.url,texto:pedidoTxt(m.texto),enviar:m.enviar===true,nova:m.nova===true}}));}
      // abrir conversa que já existe: só agente conhecido e id no formato de sessão; o servidor de agentes da própria pessoa é quem abre
      if(m.tipo==='abrir'&&/^[a-z][a-z0-9-]{0,30}$/.test(m.agente||'')&&/^[A-Za-z0-9_-]{8,80}$/.test(m.sessao||'')){appFocada(t.app.url);window.ratoeiraAbrirConversa?.(m.agente,m.sessao,txt(m.titulo,120)||null,{texto:pedidoTxt(m.texto),enviar:m.enviar===true});}
    });
    window.ratoeiraApps={
      atual(){const t=recente&&apps.get(recente);return t?.frame&&G.tem(idApp(recente))?telaDe(t):null;},
      app:url=>appDe(url),
      // a aplicação passa a ser a "tela atual" (ex.: nova conversa pedida no painel dela)
      focar:url=>appFocada(url),
      recarregar(url){
        const t=apps.get(url);if(!t?.frame)return;
        if(t.appJs){try{t.frame.contentWindow.postMessage({ratoeira:1,tipo:'terminou'},location.origin);}catch{}return;}
        const f=t.app.chat?.recarregar;if(!f)return;try{const r=t.frame.contentWindow[f]?.();r?.catch?.(()=>{});}catch{}
      },
    };
    function abaApp(app){let t=apps.get(app.url);if(!t){t={app,holder:node('div',undefined,'arq')};apps.set(app.url,t);}return t;}
    // Botões do app na barra das abas (sem segunda barra: o nome já está na aba). Montados uma vez por aba.
    function acoesApp(t){
      if(!t.acoesEl){
        // onde a pessoa está dentro da aplicação (cai na entrada se o iframe ainda não carregou)
        const aqui=()=>{try{const u=new URL(t.frame.contentWindow.location.href);if(u.origin===location.origin)return u.pathname+u.search+u.hash;}catch{}return t.app.url;};
        const recarregar=botaoIcone('button','recarregar','Recarregar o app');recarregar.onclick=()=>{try{t.frame.contentWindow.location.reload();}catch{if(t.frame)t.frame.src=t.frame.src;}};
        // modo foco: só a aplicação e o chat (que nasce recolhido, pra não recarregar nem reconectar quem só quer ver o app)
        const copiar=botaoIcone('button','link','Copiar link pro time');copiar.onclick=()=>copiarTexto(location.origin+focoDe(aqui()),'Link copiado. Abre só esta aplicação, com o chat recolhido do lado. Só abre pra quem tem acesso a este app na Ratoeira.');
        const abrir=botaoIcone('a','ext','Abrir em nova aba, com o chat');abrir.target='_blank';abrir.rel='noopener';abrir.href=focoDe(t.app.url);
        const atual=()=>{abrir.href=focoDe(aqui());};
        for(const ev of ['pointerenter','focus','click'])abrir.addEventListener(ev,atual);
        t.acoesEl=[recarregar,copiar,abrir];
      }
      return t.acoesEl;
    }
    function registrarApp(t,opts){
      G.registrar({id:idApp(t.app.url),tipo:'app',url:t.app.url,titulo:t.app.name,dica:t.app.description||t.app.name,el:t.holder,acoes:()=>acoesApp(t),
        aoMostrar:()=>{if(t.frame)return;const fr=document.createElement('iframe');fr.title=t.app.name;fr.src=t.inicio||t.app.url;t.frame=fr;fr.addEventListener('load',()=>aoCarregarApp(t));t.holder.append(fr);},
        aoFechar:()=>{t.holder.remove();apps.delete(t.app.url);if(recente===t.app.url){recente=null;avisarTela();}}},opts);
    }
    // url: a entrada da aplicação ou uma página dentro dela (vinda do modo foco)
    function openApp(url){
      const app=appDoCaminho(url);if(!app){toast('Essa aplicação não está disponível.');return;}
      const t=abaApp(app);
      if(url!==app.url){if(t.frame){try{t.frame.contentWindow.location.assign(url);}catch{t.frame.src=url;}}else t.inicio=url;}
      registrarApp(t,{});appFocada(app.url);setHash(null);tituloMesa(app.name);$('files').dataset.mobile='arquivo';
    }
    // Apps na busca da Mesa: os do sistema abrem como aba da Mesa; página simples
    // ainda abre na tela dela (não tem aba de página na grade).
    const semAcento=t=>String(t).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
    function appsDaMesa(){
      return [...(state.portal?.systemApps||[]).map(a=>({nome:a.name,abrir:()=>openApp(a.url)})),
        ...(state.portal?.apps||[]).map(a=>({nome:a.name,abrir:()=>{location.hash='#app:'+a.id;}}))];
    }
    function publicadosNaBusca(q){
      const url=q.replace(/^https?:\/\//i,'').replace(/[?#].*$/,'').replace(/\/+$/,'').toLowerCase(),palavras=q.split(/\s+/).map(semAcento);
      return (window.ratoeiraPublicadosDaMesa?.()||[]).filter(x=>{
        for(const e of x.enderecos||[]){const b=e.replace(/^https?:\/\//i,'').replace(/\/+$/,'').toLowerCase();if(url===b||url.startsWith(b+'/'))return true;}
        const alvo=semAcento([x.titulo,x.nome,x.descricao,x.item,x.origem,...(x.enderecos||[])].filter(Boolean).join(' '));
        return palavras.every(p=>alvo.includes(p));
      });
    }
    // tocar leva pra pasta do item na árvore (o menu dela tem o link e o original); ao vivo, direto pro original
    function botaoPublicado(x){
      const b=node('button',undefined,'trow tapp tpubrow');b.type='button';b.title=rotuloPub(x);
      b.append(globoPub(x),node('span',x.titulo||x.nome,'tname'));const end=x.enderecos?.[0];if(end)b.append(node('span',end.replace(/^https?:\/\//,''),'tdir'));
      b.onclick=()=>{if(x.modo==='aovivo'&&x.origem){reveal(x.origem);openFile(x.origem);}else revealDir(x.pasta&&x.pasta!=='.'?x.pasta:x.item);};
      return b;
    }
    function botaoApp(a,cls){const b=node('button',undefined,cls);b.type='button';b.append(appIcon(a.nome),node('span',a.nome));b.onclick=a.abrir;return b;}
    // Menu de clique direito na árvore (ou tecla de menu / Shift+F10): o que dá pra fazer com o arquivo ou a pasta.
    // Enxuto de propósito. Citar e conversa nova passam pelo chat (chat.js); apagar, pelo servidor de agentes da
    // pessoa, como o editor salva: roda como ela e o commit sai no nome dela.
    function publicarArquivo(rel){window.ratoeiraPublicar?.(rel);}
    function menuArvore(item,x,y,origem){
      fecharMenuArvore();
      const arq=item.tipo==='arquivo',rel=item.caminho,modo=arq?defaultMode(rel):'none';
      const m=node('div',undefined,'menu-ctx');m.setAttribute('role','menu');m.setAttribute('aria-label',item.nome);
      const acao=(rotulo,fn,perigo=false)=>{const b=node('button',rotulo,'menu-item'+(perigo?' perigo':''));b.type='button';b.setAttribute('role','menuitem');b.onclick=()=>{fecharMenuArvore();fn();};m.append(b);};
      const sep=()=>{if(m.lastChild&&!m.lastChild.classList.contains('menu-sep')&&!m.lastChild.classList.contains('menu-nota'))m.append(node('div',undefined,'menu-sep'));};
      // espaço vazio da árvore: só criar e enviar, na raiz
      if(rel===''){
        if(podeEnviar()){acao('Novo arquivo…',()=>criarEm('','arquivo'));acao('Nova pasta…',()=>criarEm('','pasta'));sep();acao('Enviar arquivos pra cá…',()=>escolherArquivos(''));}
      }else{
      // no celular não tem passar o mouse: a explicação do sinal fica aqui
      if(item.foraDoGit)m.append(node('p',item.tipo==='pasta'?FORA_PASTA:FORA_ARQ,'menu-nota'));
      if(arq){acao('Abrir',()=>openFile(rel));if(modo!=='none')acao('Abrir no navegador',()=>window.open(urlOf(rel,modo),'_blank','noopener'));}
      if(state.portal?.chat&&window.ratoeiraCitar){
        sep();acao('Citar no chat',()=>window.ratoeiraCitar(rel));
        if(arq)acao('Nova conversa sobre este arquivo',()=>window.ratoeiraNovaConversa({texto:'@'+rel+' ',citar:rel}));
        else acao('Nova conversa nesta pasta',()=>window.ratoeiraNovaConversa({cwd:raizDoRepo()+'/'+rel}));
      }
      if(state.portal?.playground&&state.portal?.chat&&arq&&PUBLICAVEL.test(rel)){sep();acao('Publicar…',()=>publicarArquivo(rel));}
      const pub=publicadoDe(rel),end=pub?.enderecos?.[0];
      if(pub){sep();m.append(node('p',rotuloPub(pub),'menu-nota'));
        if(end){acao('Abrir o link publicado',()=>window.open(end,'_blank','noopener'));acao('Copiar o link publicado',()=>copiarTexto(end,'Link copiado.'));}
        if(pub.origem&&pub.origem!==rel)acao('Abrir o original',()=>{reveal(pub.origem);openFile(pub.origem);});}
      sep();acao('Copiar caminho',()=>copiarTexto(rel,'Caminho copiado.'));
      if(arq&&PODE_ENVIAR)acao('Enviar…',()=>enviarArquivo(rel));
      if(arq){acao('Copiar link pro time',()=>copiarLink(rel));acao('Baixar',()=>{if(IOS){baixarArquivo(null,rel);return;}const a=document.createElement('a');a.href='/_ratoeira/arquivo/'+encodePath(rel)+'?baixar=1';a.download='';document.body.append(a);a.click();a.remove();});}
      if(!arq&&item.tipo!=='atalho'&&podeEnviar()){sep();acao('Novo arquivo…',()=>criarEm(rel,'arquivo'));acao('Nova pasta…',()=>criarEm(rel,'pasta'));acao('Enviar arquivos pra cá…',()=>escolherArquivos(rel));}
      if(podeEnviar()&&item.tipo!=='atalho'){sep();acao('Renomear…',()=>renomear(item));if(arq)acao('Apagar…',()=>apagarArquivo(rel,item.foraDoGit),true);}
      }
      document.body.append(m);
      const r=m.getBoundingClientRect();m.style.left=Math.max(8,Math.min(x,innerWidth-r.width-8))+'px';m.style.top=Math.max(8,Math.min(y,innerHeight-r.height-8))+'px';
      m.addEventListener('keydown',e=>{
        const bs=[...m.querySelectorAll('button')],i=bs.indexOf(document.activeElement);
        if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();bs[(i+(e.key==='ArrowDown'?1:-1)+bs.length)%bs.length].focus();}
        else if(e.key==='Escape'||e.key==='Tab'){e.preventDefault();fecharMenuArvore();origem?.focus();}
      });
      m.querySelector('button')?.focus();f.menu=m;
    }
    function fecharMenuArvore(){f.menu?.remove();f.menu=null;}
    // Botão direito no espaço vazio da árvore (fora de um item): criar na raiz.
    $('files-list').addEventListener('contextmenu',e=>{if(e.target.closest('.trow')||f.searching||!podeEnviar())return;e.preventDefault();menuArvore({tipo:'pasta',caminho:'',nome:'Raiz'},e.clientX,e.clientY,null);});
    // Criar e renomear pela árvore (servidor de agentes da pessoa, como apagar e salvar: o commit sai no nome dela).
    async function atualizarPasta(dir){try{await buscarPasta(dir);}catch{}renderTree();}
    async function criarEm(dir,tipo){
      const pasta=tipo==='pasta';
      const nome=await pedirNome(pasta?'Nova pasta':'Novo arquivo',dir?'Em '+dir:'Na raiz',{botao:'Criar',dica:pasta?'nome-da-pasta':'notas.md'});
      if(!nome)return;
      try{
        const r=await window.ratoeiraPedir('arquivo-criar',{raiz:raizDoRepo(),pasta:dir,nome,tipo});
        if(dir)f.open.add(dir);await atualizarPasta(dir);
        if(pasta){await window.ratoeiraMostrarPasta?.(r.caminho,{foco:true});return;}
        await reveal(r.caminho);openFile(r.caminho);G.desenhar();
        // arquivo de texto novo já abre no editor, pra escrever
        const tab=f.abas.get(r.caminho);if(tab&&modesOf(r.caminho).source)entrarEdicao(tab).catch(()=>{});
      }catch(e){toast(e.message);}
    }
    async function renomear(item){
      const pasta=item.tipo==='pasta',ponto=item.nome.lastIndexOf('.');
      const nome=await pedirNome('Renomear',item.caminho,{valor:item.nome,botao:'Renomear',selecionarAte:!pasta&&ponto>0?ponto:null});
      if(!nome||nome===item.nome)return;
      const dentro=r=>r===item.caminho||r.startsWith(item.caminho+'/');
      const abertas=[...f.abas.keys()].filter(dentro);
      if(abertas.some(r=>f.abas.get(r)?.ed?.sujo)){toast('Tem arquivo aberto com edição não salva aí. Salva ou sai da edição antes.');return;}
      try{
        const r=await window.ratoeiraPedir('arquivo-renomear',{raiz:raizDoRepo(),caminho:item.caminho,nome});
        const troca=x=>r.caminho+x.slice(item.caminho.length);
        for(const a of abertas)G.fechar(idDe(a));
        for(const d of [...f.open])if(dentro(d)){f.open.delete(d);f.open.add(troca(d));}
        for(const d of [...f.children.keys()])if(dentro(d))f.children.delete(d);
        const pai=item.caminho.includes('/')?item.caminho.slice(0,item.caminho.lastIndexOf('/')):'';
        await atualizarPasta(pai);
        for(const a of abertas)openFile(troca(a));if(abertas.length)G.desenhar();
        toast(pasta?'Pasta renomeada.':'Renomeado.');
      }catch(e){toast(e.message);}
    }
    document.addEventListener('pointerdown',e=>{if(f.menu&&!f.menu.contains(e.target))fecharMenuArvore();},true);
    for(const ev of ['blur','resize'])window.addEventListener(ev,fecharMenuArvore);
    $('files-list').addEventListener('scroll',fecharMenuArvore);
    async function copiarTexto(texto,ok){try{await navigator.clipboard.writeText(texto);toast(ok);}catch{prompt('Copie:',texto);}}
    async function apagarArquivo(rel,pesado=false){
      const nome=rel.split('/').pop();
      const q=await perguntar('Apagar '+nome+'?',pesado?'Fica só nesta VPS, sem versões guardadas: apagar não tem volta.':'Sai do repositório pra todo mundo no próximo sync, com um commit no teu nome. Dá pra recuperar pelo histórico do git.',[['apagar','Apagar','danger'],['cancelar','Cancelar']],1);
      if(q!=='apagar')return;
      const tab=f.abas.get(rel);
      if(tab?.ed?.sujo){toast('Esse arquivo está aberto com edição não salva. Salva ou sai da edição antes.');return;}
      try{
        await window.ratoeiraPedir('apagar',{raiz:raizDoRepo(),caminho:rel});
        if(tab)G.fechar(idDe(rel));
        const dir=rel.split('/').slice(0,-1).join('/');const itens=f.children.get(dir);if(itens)f.children.set(dir,itens.filter(i=>i.caminho!==rel));
        renderTree();toast(nome+' apagado.');
      }catch(e){toast('Não apaguei: '+e.message);}
    }
    // ── Enviar do computador pra uma pasta (desde 15/10/2026) ──
    // Arrastar do Finder/Explorer pra cima de uma pasta da árvore (ou pro vazio: raiz), ou "Enviar arquivos pra cá…" no
    // menu da pasta. Vai em pedaços pelo servidor de agentes da pessoa (arquivo-enviar/parte/concluir): grava como ela e
    // commita no nome dela; pesado (vídeo, áudio, PSD, pacote, acima de 50 MB) fica fora do git, marcado "só aqui".
    const PARTE=4*1024*1024,MAX_ENVIO=2*1024**3;
    const podeEnviar=()=>Boolean(state.portal?.chat&&window.ratoeiraPedir);
    const envio={fila:[],ativos:0,total:0,feitos:0,bytes:0,enviados:0,pesados:0,erros:[],cancelado:false,decisao:null,perguntando:null,pastas:new Set(),box:null};
    function desenharEnvio(){
      if(!envio.box){
        const box=node('div',undefined,'envio-box');box.setAttribute('role','status');
        const txt=node('span',undefined,'envio-txt'),barra=node('div',undefined,'envio-barra'),cheio=node('i');barra.append(cheio);
        const x=node('button','Cancelar','envio-cancelar');x.type='button';x.onclick=cancelarEnvios;
        box.append(txt,x,barra);$('files-list').after(box);envio.box={box,txt,cheio};
      }
      const pct=envio.bytes?Math.min(100,Math.round(envio.enviados/envio.bytes*100)):100;
      envio.box.txt.textContent=`Enviando ${Math.min(envio.feitos+1,envio.total)} de ${envio.total} · ${pct}%`;
      envio.box.cheio.style.width=pct+'%';
    }
    function cancelarEnvios(){envio.cancelado=true;envio.fila.length=0;}
    // Pasta arrastada: o navegador entrega as entradas; desce em cada uma (readEntries vem em lotes).
    async function lerEntradas(item){
      const saida=[],ocultos={n:0};
      async function descer(entry,prefixo){
        if(entry.name.startsWith('.')){ocultos.n++;return;}
        if(entry.isFile){const file=await new Promise((ok,no)=>entry.file(ok,no));saida.push({file,rel:prefixo+entry.name});return;}
        const leitor=entry.createReader();let lote;
        do{lote=await new Promise((ok,no)=>leitor.readEntries(ok,no));for(const e of lote)await descer(e,prefixo+entry.name+'/');}while(lote.length);
      }
      await descer(item,'');return {saida,ocultos:ocultos.n};
    }
    async function arquivosDoArrasto(dt){
      const entradas=[...dt.items||[]].filter(i=>i.kind==='file').map(i=>i.webkitGetAsEntry?.()).filter(Boolean);
      if(!entradas.length)return {lista:[...dt.files].filter(f=>!f.name.startsWith('.')).map(file=>({file,rel:file.name})),ocultos:0};
      const lista=[];let ocultos=0;
      for(const e of entradas){const r=await lerEntradas(e);lista.push(...r.saida);ocultos+=r.ocultos;}
      return {lista,ocultos};
    }
    function escolherArquivos(dir){
      const inp=document.createElement('input');inp.type='file';inp.multiple=true;
      inp.onchange=()=>{enviarArquivos(dir,[...inp.files].map(file=>({file,rel:file.name})));};
      inp.click();
    }
    function enviarArquivos(dir,lista,ocultos=0){
      if(!lista.length){if(ocultos)toast('Nada pra enviar: arquivo começando com ponto não sobe por aqui.');return;}
      const grandes=lista.filter(x=>x.file.size>MAX_ENVIO);
      if(grandes.length)toast(grandes.length+' arquivo(s) acima de 2 GB ficaram de fora: '+grandes.map(x=>x.file.name).join(', '));
      const novos=lista.filter(x=>x.file.size<=MAX_ENVIO).map(x=>({...x,caminho:(dir?dir+'/':'')+x.rel}));
      if(!novos.length)return;
      if(!envio.ativos&&!envio.fila.length)Object.assign(envio,{total:0,feitos:0,bytes:0,enviados:0,pesados:0,erros:[],cancelado:false,decisao:null,pastas:new Set()});
      envio.fila.push(...novos);envio.total+=novos.length;envio.bytes+=novos.reduce((s,x)=>s+x.file.size,0);envio.pastas.add(dir);
      desenharEnvio();
      while(envio.ativos<2&&envio.fila.length)rodarEnvio();
    }
    const comoBase64=blob=>new Promise((ok,no)=>{const r=new FileReader();r.onload=()=>ok(String(r.result).slice(String(r.result).indexOf(',')+1));r.onerror=()=>no(r.error);r.readAsDataURL(blob);});
    // Mesmo nome: uma pergunta por vez (dois envios em paralelo não abrem duas janelas), com "o mesmo pros próximos".
    async function decidir(caminho){
      if(envio.decisao)return envio.decisao;
      while(envio.perguntando)await envio.perguntando;
      if(envio.decisao)return envio.decisao;
      let fim;envio.perguntando=new Promise(ok=>{fim=ok;});
      const varios=envio.fila.length>0;
      const q=await perguntar('Já existe '+caminho.split('/').pop(),'Na pasta '+(caminho.split('/').slice(0,-1).join('/')||'raiz')+' já tem um arquivo com esse nome.',
        [['substituir','Substituir','primary'],['manter','Manter os dois'],...(varios?[['substituir-todos','Substituir todos'],['manter-todos','Manter os dois em todos']]:[]),['pular','Pular']],1);
      if(q.endsWith('-todos'))envio.decisao=q.slice(0,-6);
      envio.perguntando=null;fim();
      return q.replace(/-todos$/,'');
    }
    async function rodarEnvio(){
      const x=envio.fila.shift();if(!x)return;envio.ativos++;
      let id=null,pos=0;
      try{
        const raiz=raizDoRepo();
        let r=await window.ratoeiraPedir('arquivo-enviar',{raiz,caminho:x.caminho,tamanho:x.file.size});
        if(r.existe){
          const d=await decidir(x.caminho);
          if(d==='pular'){envio.enviados+=x.file.size;return;}
          r=await window.ratoeiraPedir('arquivo-enviar',{raiz,caminho:x.caminho,tamanho:x.file.size,seExistir:d});
        }
        id=r.envio;
        while(pos<x.file.size){
          if(envio.cancelado)throw new Error('cancelado');
          const dados=await comoBase64(x.file.slice(pos,pos+PARTE));
          const antes=pos;pos=(await window.ratoeiraPedir('arquivo-parte',{envio:id,pos,dados})).recebido;
          envio.enviados+=pos-antes;desenharEnvio();
        }
        const fim=await window.ratoeiraPedir('arquivo-concluir',{envio:id});id=null;
        if(fim.pesado)envio.pesados++;
      }catch(e){
        if(id)window.ratoeiraPedir('arquivo-cancelar',{envio:id}).catch(()=>{});
        envio.enviados+=x.file.size-pos;
        if(e.message!=='cancelado')envio.erros.push(x.caminho.split('/').pop()+': '+e.message);
      }finally{
        envio.feitos++;envio.ativos--;
        if(envio.fila.length&&!envio.cancelado)rodarEnvio();
        else if(!envio.ativos)terminarEnvios();
        else desenharEnvio();
      }
    }
    async function terminarEnvios(){
      envio.box?.box.remove();envio.box=null;
      const ok=envio.feitos-envio.erros.length;
      for(const dir of envio.pastas){let d='';for(const p of dir?dir.split('/'):[]){d=d?d+'/'+p:p;f.open.add(d);}}
      try{await recarregarArvore({fresco:true});}catch{}
      const partes=[];
      if(envio.cancelado)partes.push('Envio cancelado.');
      if(ok>0)partes.push(ok===1?'1 arquivo enviado.':ok+' arquivos enviados.');
      if(envio.pesados)partes.push(envio.pesados===1?'1 é pesado e fica só aqui, fora do git.':envio.pesados+' são pesados e ficam só aqui, fora do git.');
      if(envio.erros.length)partes.push('Não subiu: '+envio.erros.slice(0,3).join(' · ')+(envio.erros.length>3?' (e mais '+(envio.erros.length-3)+')':''));
      toast(partes.join(' '));
      refreshEstado();
    }
    // Arrastar de fora (o navegador diz "Files"): a pasta sob o cursor acende; arquivo da árvore aponta pra pasta dele.
    // Pasta fechada abre depois de um instante parado em cima, como no Finder.
    (()=>{
      const lista=$('files-list');let alvo=null,abrir=null;
      const deFora=e=>[...(e.dataTransfer?.types||[])].includes('Files');
      const pastaDe=el=>{const b=el?.closest?.('.trow');if(!b||b.disabled)return {dir:'',linha:null};const it=b.dataset.tipo;
        if(it==='pasta')return {dir:b.dataset.path,linha:b};const dir=b.dataset.path.split('/').slice(0,-1).join('/');
        return {dir,linha:dir?[...lista.querySelectorAll('.trow')].find(r=>r.dataset.path===dir):null};};
      const limpar=()=>{lista.querySelectorAll('.soltar-aqui').forEach(r=>r.classList.remove('soltar-aqui'));lista.classList.remove('soltar-raiz');clearTimeout(abrir);alvo=null;};
      lista.addEventListener('dragover',e=>{
        if(!deFora(e)||!podeEnviar()||f.searching)return;
        e.preventDefault();e.dataTransfer.dropEffect='copy';
        const {dir,linha}=pastaDe(e.target);if(alvo===dir)return;
        limpar();alvo=dir;
        if(linha)linha.classList.add('soltar-aqui');else lista.classList.add('soltar-raiz');
        if(linha&&linha.dataset.tipo==='pasta'&&!f.open.has(dir))abrir=setTimeout(()=>{if(alvo===dir)toggle(dir);},800);
      });
      lista.addEventListener('dragleave',e=>{if(!lista.contains(e.relatedTarget))limpar();});
      lista.addEventListener('drop',async e=>{
        if(!deFora(e)||!podeEnviar())return;
        e.preventDefault();const dir=alvo??pastaDe(e.target).dir;limpar();
        try{const {lista:arqs,ocultos}=await arquivosDoArrasto(e.dataTransfer);enviarArquivos(dir,arqs,ocultos);}
        catch(err){toast('Não consegui ler o que foi arrastado: '+err.message);}
      });
    })();
    $('files-enviar-btn').onclick=()=>escolherArquivos('');
    async function copiarCaminho(rel){
      try{await navigator.clipboard.writeText(rel);toast('Caminho copiado: '+rel);}
      catch{prompt('Copie o caminho:',rel);}
    }
    async function copiarLink(rel){
      // modo foco, igual ao link de app: só o arquivo, com o chat recolhido do lado (sem as abas de quem clica)
      const link=location.origin+'/portal/?foco#arquivos/'+encodePath(rel);
      try{await navigator.clipboard.writeText(link);toast('Link copiado. Abre só este arquivo, com o chat recolhido do lado. Só abre pra quem tem acesso à Ratoeira.');}
      catch{prompt('Copie o link:',link);}
    }
    // Volta o layout salvo: os arquivos se registram já; as conversas, quando o chat conectar (chat.js).
    function restaurarGrade(){
      const ids=G.restaurar();G.reiniciarRestauro(true);
      for(const id of ids){
        if(id.startsWith('a:'))registrarAba(criarAba(id.slice(2)),{ativar:false});
        else if(id.startsWith('p:')){const app=appDe(id.slice(2));if(app)registrarApp(abaApp(app),{ativar:false});else G.remover(id);}
      }
      G.reiniciarRestauro(false);G.desenhar();
      window.dispatchEvent(new CustomEvent('ratoeira:grade'));
    }
    $('files-search').addEventListener('input',()=>{
      // com a coluna em Conversas, a mesma caixa filtra as conversas (chat.js)
      if($('files').dataset.coluna==='conversas')return;
      clearTimeout(f.searchTimer);const q=$('files-search').value.trim();
      if(q.length<2){f.searching=false;renderTree();return;}
      f.searchTimer=setTimeout(async()=>{
        try{const data=await api('/arquivos/busca?q='+encodeURIComponent(q));if($('files-search').value.trim()!==q)return;
          f.searching=true;const list=$('files-list');list.replaceChildren();
          const achados=appsDaMesa().filter(a=>q.split(/\s+/).every(p=>semAcento(a.nome).includes(semAcento(p))));
          const pubs=publicadosNaBusca(q),grupos=achados.length+pubs.length>0;
          if(achados.length){list.append(node('p','Apps','tgrupo'));achados.forEach(a=>list.append(botaoApp(a,'trow tapp')));}
          if(pubs.length){list.append(node('p','Publicados','tgrupo'));pubs.forEach(x=>list.append(botaoPublicado(x)));}
          if(grupos&&data.itens.length)list.append(node('p','Arquivos','tgrupo'));
          if(!data.itens.length&&!grupos)list.append(node('p','Nada com esse nome: nenhum app, publicado, pasta ou arquivo.','tloading'));
          data.itens.forEach(item=>list.append(row(item,0,true)));
          if(data.limitado)list.append(node('p','Mostrando 200 de '+data.total+'. Refine a busca (dá pra usar parte do caminho, ex: "clínicas/convite").','tloading'));
        }catch(error){toast(error.message);}
      },180);
    });
    // O chat (chat.js) sugere como pasta da conversa a pasta do arquivo aberto.
    window.ratoeiraArquivoAtivo=()=>f.active;
    // Pasta de uma conversa (chat.js): abre na árvore e rola até ela, sem mudar a raiz nem fechar as outras.
    // foco: veio de um clique (no celular troca pra árvore). Sem foco (conversa nova), não tira o cursor da caixa.
    window.ratoeiraMostrarPasta=async(rel,{foco=false}={})=>{
      if(!f.loaded)return;
      if(foco&&$('files').dataset.mobile)$('files').dataset.mobile='arvore';
      if(!rel){$('files-list').scrollTop=0;return;}
      if(foco)return revealDir(rel);
      const parts=rel.split('/');for(let i=0;i<parts.length;i++){const d=parts.slice(0,i+1).join('/');f.open.add(d);try{await load(d);}catch{return;}}
      renderTree();requestAnimationFrame(()=>[...$('files-list').querySelectorAll('.trow')].find(b=>b.dataset.path===rel)?.scrollIntoView({block:'nearest'}));
    };
    // Caminho clicado no chat: abre o arquivo numa aba da Mesa. Com linha, no modo Original, já nela.
    window.ratoeiraAbrirArquivo=(rel,{linha=null}={})=>{
      openFile(rel);reveal(rel).catch(()=>{});
      const tab=f.abas.get(rel);if(!tab)return;
      if(linha&&modesOf(rel).source){tab.mode='source';tab.linha=linha;frameFor(tab);barraDe(tab);G.desenhar();}
    };
    return {
      // Pra Início: o texto do sync ("Sincronizado há 4 min") e os últimos arquivos abertos neste navegador.
      async resumo(){await refreshEstado();let recentes=[];try{recentes=JSON.parse(localStorage.getItem('ratoeira:arquivos-recentes')||'[]');}catch{}return {sync:$('files-sync-text').textContent,travado:$('files-sync').classList.contains('travado'),recentes:Array.isArray(recentes)?recentes.filter(r=>typeof r==='string'):[]};},
      async show(rel,app=null){
        // O arquivo do link abre antes da árvore carregar (a raiz leva segundos a frio): esperar deixava na frente,
        // nesse tempo, a aba que a pessoa tinha deixado ativa da outra vez, e o link parecia cair em outra tela.
        let jaAberto=false;
        if(!f.loaded){f.loaded=true;refreshEstado();restaurarGrade();if(rel&&!app){openFile(rel);G.desenhar();jaAberto=true;}$('files-list').replaceChildren(node('p','Carregando…','tloading'));try{await load('');}catch(error){f.loaded=false;$('files-list').replaceChildren(node('p',error.message,'tloading'));return;}renderTree();}
        if(app)openApp(app);
        else if(jaAberto)await reveal(rel);
        else if(rel&&!(rel===f.active&&G.tem(idDe(rel)))){await reveal(rel);openFile(rel);}
        else{const a=G.abaAtiva();if(a?.tipo==='arquivo')ativo(a.rel);else if(a?.tipo==='app'){setHash(null);tituloMesa(a.titulo);}else if(f.active)setHash(f.active);}
        G.desenhar();
      },
    };
  })();
  // ── Pessoas (login próprio, só admin): convidar, links, apps e papel, desativar ──
  const pessoas=(()=>{
    let dados=null;
    const urlCompleta=link=>location.origin+link;
    function mostrarLink(titulo,link,validade){
      const box=$('link-gerado');box.replaceChildren(node('strong',titulo),node('code',urlCompleta(link)));
      const acoes=node('div',undefined,'actions'),copiar=node('button','Copiar link','primary');copiar.type='button';
      copiar.onclick=async()=>{try{await navigator.clipboard.writeText(urlCompleta(link));toast('Link copiado.');}catch{toast('Não deu pra copiar. Selecione o link e copie.');}};
      acoes.append(copiar);box.append(node('p',validade+' Quem tiver o link define a senha: mande só pra pessoa.','muted'),acoes);box.hidden=false;box.scrollIntoView({block:'nearest'});
    }
    // um seletor por aplicação. App com papel padrão (os publicados pela tela nascem liberados): "Padrão (papel)",
    // "Sem acesso" (bloqueia, vai como null) ou um papel. App sem padrão: "Sem acesso" ou um papel.
    function seletoresDeApps(box,atuais={}){
      box.querySelectorAll('label').forEach(l=>l.remove());
      if(!dados.apps.length){box.hidden=true;return;}
      box.hidden=false;
      for(const app of dados.apps){
        const l=node('label',app.name),sel=node('select');sel.dataset.prefix=app.prefix;
        sel.append(new Option(app.padrao?`Padrão (${app.padrao})`:'Sem acesso',''));if(app.padrao)sel.append(new Option('Sem acesso','-'));
        app.papeis.forEach(p=>sel.append(new Option(p,p)));
        sel.value=!Object.hasOwn(atuais,app.prefix)?'':atuais[app.prefix]===null?(app.padrao?'-':''):atuais[app.prefix];l.append(sel);box.append(l);
      }
    }
    const appsDe=box=>Object.fromEntries([...box.querySelectorAll('select')].filter(s=>s.value).map(s=>[s.dataset.prefix,s.value==='-'?null:s.value]));
    // áreas do time (repo compartilhado): caixas de marcar
    function caixasDeAreas(box,marcadas){
      box.querySelectorAll('label').forEach(l=>l.remove());
      for(const a of dados.areas||[]){const l=node('label',undefined,'check'),c=node('input');c.type='checkbox';c.value=a.id;c.checked=marcadas.includes(a.id);l.append(c,document.createTextNode(' '+a.nome));box.append(l);}
    }
    const areasDe=box=>[...box.querySelectorAll('input[type=checkbox]')].filter(c=>c.checked).map(c=>c.value);
    const nomeArea=id=>(dados.areas||[]).find(a=>a.id===id)?.nome||id;
    const enc=email=>encodeURIComponent(email);
    function desenhar(){
      const lista=$('pessoas-lista');lista.replaceChildren();
      const eu=state.portal.user.email;
      for(const p of dados.pessoas){
        const row=node('article',undefined,'app-row'),corpo=node('div'),h=node('h2',p.nome);corpo.append(h,node('p',p.email));
        const chips=node('div',undefined,'chips');
        const chip=(t,forte)=>chips.append(node('span',t,'chip'+(forte?' forte':'')));
        chip(p.papel==='admin'?'Administrador':'Membro',p.papel==='admin');
        chip({ativa:'Ativa',convidada:'Convite pendente',desativada:'Desativada'}[p.estado]);
        if(p.doisPassos)chip('Dois passos ligado');
        chip(p.ambiente?.tipo==='proprio'?'Ambiente: '+p.ambiente.user:p.ambiente?.tipo==='compartilhado'?'Paseo principal':'Sem ambiente');
        for(const id of p.ambiente?.areas||[])chip('Área: '+nomeArea(id),true);
        if(p.ambiente?.tipo==='proprio')chip({geral:'Claude: conta geral',propria:'Claude: conta própria',opcional:'Claude: própria ou geral'}[p.ambiente.claude||'propria']);
        if(p.ambiente?.tipo==='proprio')chip({geral:'Codex: conta geral',propria:'Codex: conta própria',opcional:'Codex: própria ou geral'}[p.ambiente.codex||'propria']);
        for(const [prefix,papel] of Object.entries(p.apps||{}))chip((dados.apps.find(a=>a.prefix===prefix)?.name||prefix)+': '+(papel??'sem acesso'));
        corpo.append(chips);
        const acoes=node('div',undefined,'actions');
        const botao=(texto,fn)=>{const b=node('button',texto);b.type='button';b.onclick=async()=>{b.disabled=true;errorAt('pessoas-error','');try{await fn();}catch(e){errorAt('pessoas-error',e.message);}finally{b.disabled=false;}};acoes.append(b);};
        // quem tem verificação em dois passos e perdeu o celular: o link de senha nova pode zerar junto
        if(p.estado!=='desativada')botao(p.temSenha?'Link de senha nova':'Novo convite',async()=>{
          const zerarDois=p.doisPassos&&p.temSenha&&confirm(`${p.nome} tem verificação em dois passos. Zerar junto com a senha?\n\nOK: zera (pra quem perdeu o celular e os códigos de reserva).\nCancelar: mantém, e o link vai pedir o código do app depois da senha nova.`);
          const r=await post('/pessoas/'+enc(p.email)+'/link',{zerarDois});mostrarLink((r.tipo==='convite'?'Convite pra ':'Senha nova pra ')+p.nome,r.link,r.tipo==='convite'?'Vale 24 horas.':'Vale 1 hora. As sessões abertas fecham quando a pessoa trocar a senha.');});
        if(p.doisPassos)botao('Zerar dois passos',async()=>{
          if(!confirm(`Zerar a verificação em dois passos de ${p.nome}? Na próxima entrada, a senha basta${state.portal.seguranca?.exigirDois?' e a Ratoeira pede pra configurar de novo':''}.`))return;
          await post('/pessoas/'+enc(p.email)+'/zerar-dois');toast('Verificação em dois passos zerada.');await carregar();
        });
        botao('Editar',async()=>editar(row,p));
        if(p.email!==eu)botao(p.estado==='desativada'?'Reativar':'Desativar',async()=>{
          if(p.estado!=='desativada'&&!confirm(`Desativar ${p.nome}? A pessoa sai na hora e não entra mais até ser reativada.`))return;
          await post('/pessoas/'+enc(p.email)+'/'+(p.estado==='desativada'?'reativar':'desativar'));await carregar();
        });
        row.append(corpo,acoes);lista.append(row);
      }
    }
    function editar(row,p){
      row.querySelector('.pessoa-editor')?.remove();
      const f=node('form',undefined,'editor pessoa-editor'),grid=node('div',undefined,'form-grid');
      const papel=node('label','Papel na Ratoeira'),sel=node('select');sel.append(new Option('Membro','membro'),new Option('Administrador','admin'));sel.value=p.papel;papel.append(sel);
      grid.append(papel);f.append(grid);
      const seletorModo=(atual,rotulo='Conta do Claude')=>{const l=node('label',rotulo),s=node('select');for(const [v,t] of [['geral','Usa a conta geral'],['propria','Conecta a própria (obrigatório)'],['opcional','A própria se conectar; senão a geral']])s.append(new Option(t,v));s.value=atual;l.append(s);return {l,s};};
      let modo=null,modoCodex=null,dar=null;
      if(p.ambiente?.tipo==='proprio'){modo=seletorModo(p.ambiente.claude||'propria');modoCodex=seletorModo(p.ambiente.codex||'propria','Conta do Codex');grid.append(modo.l,modoCodex.l);}
      // quem ainda não tem ambiente (ex.: só usa um app) pode ganhar um
      if(!p.ambiente&&dados.criaAmbiente){
        const box=node('fieldset',undefined,'pessoa-apps');box.append(node('legend','Ambiente próprio'));
        const lc=node('label',undefined,'check'),c=node('input');c.type='checkbox';lc.append(c,document.createTextNode(' Dar ambiente: agentes, arquivos e terminal'));
        const lu=node('label','Usuário Linux'),u=node('input');u.maxLength=32;u.placeholder='ex.: '+p.email.split('@')[0].toLowerCase().replace(/[^a-z0-9_-]/g,'');lu.append(u);
        const m=seletorModo(dados.claudePadrao||'propria'),mc=seletorModo(dados.codexPadrao||'propria','Conta do Codex');const ar=node('fieldset',undefined,'pessoa-apps');ar.append(node('legend','Áreas do time'));
        box.append(lc,lu,m.l,mc.l);if((dados.areas||[]).length)box.append(ar);
        const mostrar=()=>{[lu,m.l,mc.l,ar].forEach(x=>x.hidden=!c.checked);};c.onchange=mostrar;mostrar();
        f.append(box);if((dados.areas||[]).length)caixasDeAreas(ar,(dados.areas||[]).map(a=>a.id));
        dar={c,u,m,mc,ar};
      }
      let areas=null;
      if(p.ambiente?.tipo==='proprio'&&(dados.areas||[]).length){areas=node('fieldset',undefined,'pessoa-apps');areas.append(node('legend','Áreas do time (repo compartilhado)'));f.append(areas);caixasDeAreas(areas,p.ambiente.areas||[]);}
      const apps=node('fieldset',undefined,'pessoa-apps');apps.append(node('legend','Aplicações'));f.append(apps);
      seletoresDeApps(apps,p.apps);
      const erro=node('p','','error-text');erro.hidden=true;f.append(erro);
      const acoes=node('div',undefined,'actions'),salvar=node('button','Salvar','primary'),cancelar=node('button','Cancelar');cancelar.type='button';cancelar.onclick=()=>f.remove();
      acoes.append(salvar,cancelar);f.append(acoes);
      f.onsubmit=async ev=>{ev.preventDefault();salvar.disabled=true;try{await post('/pessoas/'+enc(p.email)+'/editar',{papel:sel.value,apps:appsDe(apps),...(areas?{areas:areasDe(areas)}:{}),...(modo?{claude:modo.s.value,codex:modoCodex.s.value}:{})});
        if(dar?.c.checked){if(!dar.u.value.trim())throw new Error('Informe o usuário Linux.');await post('/pessoas/'+enc(p.email)+'/editar',{darAmbiente:{usuario:dar.u.value.trim()},claude:dar.m.s.value,codex:dar.mc.s.value,...((dados.areas||[]).length?{areas:areasDe(dar.ar)}:{})});}await carregar();toast('Salvo.');}catch(e){erro.textContent=e.message;erro.hidden=false;}finally{salvar.disabled=false;}};
      row.append(f);
    }
    function desenharRestritas(){
      const box=$('restritas-box');box.hidden=!(dados.areas||[]).length;$('restritas-sem-area').hidden=!box.hidden;if(box.hidden)return;
      const lista=$('restritas-lista');lista.replaceChildren();
      const nomePessoa=e=>dados.pessoas.find(p=>p.email===e)?.nome||e;
      if(!dados.restritas.length)lista.append(node('p','Nenhuma pasta restrita: quem está na área vê o repo inteiro.','muted'));
      for(const r of dados.restritas){
        const row=node('article',undefined,'app-row'),corpo=node('div');corpo.append(node('h2',r.pasta),node('p',nomeArea(r.area)));
        const chips=node('div',undefined,'chips');(r.pessoas.length?r.pessoas:[]).forEach(e=>chips.append(node('span',nomePessoa(e),'chip')));if(!r.pessoas.length)chips.append(node('span','Só o dono da área','chip'));corpo.append(chips);
        const acoes=node('div',undefined,'actions'),b=node('button','Liberar pra todos');b.type='button';
        b.onclick=async()=>{if(!confirm(`Liberar ${r.pasta} pra todo mundo da área?`))return;b.disabled=true;try{await post('/pessoas/restritas/liberar',{area:r.area,pasta:r.pasta});await carregar();toast('Pasta liberada.');}catch(e){errorAt('pessoas-error',e.message);b.disabled=false;}};
        acoes.append(b);row.append(corpo,acoes);lista.append(row);
      }
      const f=$('restrita-form'),selArea=f.elements.area;const antes=selArea.value;selArea.replaceChildren();
      (dados.areas||[]).forEach(a=>selArea.append(new Option(a.nome,a.id)));if(antes)selArea.value=antes;
      const quem=()=>{const box=$('restrita-pessoas');box.querySelectorAll('label').forEach(l=>l.remove());
        for(const p of dados.pessoas.filter(p=>p.estado!=='desativada'&&(p.ambiente?.areas||[]).includes(selArea.value))){const l=node('label',undefined,'check'),c=node('input');c.type='checkbox';c.value=p.email;l.append(c,document.createTextNode(' '+p.nome));box.append(l);}};
      selArea.onchange=quem;quem();
    }
    $('restrita-form').onsubmit=async ev=>{
      ev.preventDefault();const f=ev.target,b=f.querySelector('button[type=submit]');b.disabled=true;errorAt('restrita-error','');
      try{await post('/pessoas/restritas',{area:f.elements.area.value,pasta:f.elements.pasta.value,pessoas:areasDe($('restrita-pessoas'))});f.elements.pasta.value='';await carregar();toast('Pasta restrita.');}
      catch(e){errorAt('restrita-error',e.message);}finally{b.disabled=false;}
    };
    async function carregar(){
      try{dados=await api('/pessoas');desenhar();desenharRestritas();errorAt('pessoas-error','');}
      catch(e){errorAt('pessoas-error',e.message);}
    }
    const form=$('convite-form');
    const abrir=aberto=>{form.hidden=!aberto;$('convite-toggle').setAttribute('aria-expanded',String(aberto));if(aberto){form.reset();form.elements.usuario.required=false;$('convite-areas').hidden=true;$('convite-claude-box').hidden=true;$('convite-codex-box').hidden=true;errorAt('convite-error','');$('convite-usuario-box').hidden=true;$('convite-ambiente-box').hidden=!dados?.criaAmbiente;seletoresDeApps($('convite-apps'));form.elements.nome.focus();}};
    $('convite-toggle').onclick=()=>abrir(form.hidden);
    $('convite-cancel').onclick=()=>abrir(false);
    // sugere o usuário Linux a partir do e-mail; o admin pode trocar
    form.elements.ambiente.onchange=()=>{const on=form.elements.ambiente.checked;$('convite-usuario-box').hidden=!on;form.elements.usuario.required=on;
      $('convite-areas').hidden=!on||!(dados.areas||[]).length;if(on)caixasDeAreas($('convite-areas'),(dados.areas||[]).map(a=>a.id));
      $('convite-claude-box').hidden=!on;if(on)form.elements.claude.value=dados.claudePadrao||'propria';
      $('convite-codex-box').hidden=!on;if(on)form.elements.codex.value=dados.codexPadrao||'propria';
      if(on&&!form.elements.usuario.value)form.elements.usuario.value=(form.elements.email.value.split('@')[0]||'').toLowerCase().normalize('NFD').replace(/[^a-z0-9_-]/g,'').replace(/^[^a-z_]+/,'').slice(0,32);};
    form.onsubmit=async ev=>{
      ev.preventDefault();const b=form.querySelector('button[type=submit]');b.disabled=true;errorAt('convite-error','');
      try{
        const r=await post('/pessoas',{nome:form.elements.nome.value,email:form.elements.email.value,papel:form.elements.papel.value,ambiente:form.elements.ambiente.checked,usuario:form.elements.usuario.value,apps:appsDe($('convite-apps')),...(form.elements.ambiente.checked&&(dados.areas||[]).length?{areas:areasDe($('convite-areas'))}:{}),...(form.elements.ambiente.checked?{claude:form.elements.claude.value,codex:form.elements.codex.value}:{})});
        abrir(false);await carregar();mostrarLink('Convite pra '+r.pessoa.nome,r.link,'Vale 24 horas.');
      }catch(e){errorAt('convite-error',e.message);}
      finally{b.disabled=false;}
    };
    return {mostrar:()=>{$('link-gerado').hidden=true;carregar();}};
  })();
  // ── Habilidades: as skills do repo (qualquer pasta) e as globais da pessoa ──
  // As do repo saem do índice do git que o gateway já guarda (sem varrer o disco); as globais, do servidor de
  // agentes da pessoa. A lista fica 1 min aqui antes de pedir de novo.
  const habilidades=(()=>{
    // As do repo chegam rápido; as globais esperam o servidor de agentes da pessoa, que pode estar desligado
    // por ociosidade e levar uns segundos pra ligar. Por isso uma não espera a outra.
    let repo=null,minhas=[],dados=null,em=0;
    // só monta a lista quando as do repo chegaram: antes disso fica o esqueleto
    const juntar=()=>{dados=repo?[...repo.map(h=>({...h,origem:'repo'})),...minhas.map(h=>({...h,origem:'tuas'}))]:null;};
    async function carregar(){
      (window.ratoeiraHabilidadesPessoais?.()??Promise.resolve([])).then(r=>{if(!Array.isArray(r))return;minhas=r;juntar();if(!dados)return;filtros();if(document.body.dataset.view==='habilidades')desenhar();}).catch(()=>{});
      repo=(await api('/habilidades')).itens;juntar();em=Date.now();filtros();
    }
    function filtros(){
      const sel=$('habs-onde'),antes=sel.value;sel.replaceChildren(new Option('Todas as pastas',''));
      const ondes=[...new Set(dados.filter(h=>h.origem==='repo').map(h=>h.onde))];
      for(const o of ondes)sel.append(new Option(o?o:'Raiz do repo','r:'+o));
      if(dados.some(h=>h.origem==='tuas'))sel.append(new Option('Tuas (globais)','tuas'));
      if([...sel.options].some(o=>o.value===antes))sel.value=antes;
    }
    // esqueleto com o formato dos cartões enquanto a primeira lista não chega
    function esqueleto(){const l=$('habs-lista');l.replaceChildren();for(let i=0;i<9;i++){const c=node('div',undefined,'hab-card esqueleto');c.setAttribute('aria-hidden','true');c.append(node('span',undefined,'osso curto'),node('span',undefined,'osso'),node('span',undefined,'osso'),node('span',undefined,'osso meio'));l.append(c);}$('habs-resumo').textContent='Procurando habilidades…';}
    function desenhar(){
      const lista=$('habs-lista');lista.replaceChildren();
      const q=$('habs-busca').value.trim().toLowerCase().normalize('NFD').replace(/\p{M}/gu,''),onde=$('habs-onde').value;
      const sem=t=>String(t||'').toLowerCase().normalize('NFD').replace(/\p{M}/gu,'');
      const itens=dados.filter(h=>(!onde||(onde==='tuas'?h.origem==='tuas':h.origem==='repo'&&'r:'+h.onde===onde))&&(!q||q.split(/\s+/).every(p=>sem(h.nome+' '+h.descricao+' '+(h.onde||'')).includes(p))));
      $('habs-resumo').textContent=itens.length===dados.length?dados.length+' habilidades':itens.length+' de '+dados.length;
      if(!itens.length)lista.append(node('p',dados.length?'Nenhuma habilidade com esse filtro.':'Nenhuma habilidade encontrada nas pastas .claude/skills e .agents/skills.','muted'));
      const pasta=state.portal.chat?.pastaPadrao;
      for(const h of itens){
        const card=node('article',undefined,'hab-card'),topo=node('div',undefined,'hab-topo');
        topo.append(node('strong',h.nome,'hab-nome'),node('span',h.de==='codex'?'Codex':h.de==='agents'?'.agents':'Claude','chip'));
        const desc=node('p',h.descricao||'Sem descrição no SKILL.md.','hab-desc'+(h.descricao?'':' muted'));desc.title=h.descricao||'';
        const pe=node('div',undefined,'hab-pe'),onde=node('span',undefined,'hab-onde');onde.append(svg('pasta'),node('span',h.origem==='tuas'?'Tuas (globais)':h.onde||'Raiz do repo'));
        const acoes=node('span',undefined,'hab-acoes');
        if(h.origem==='repo'){const ver=node('a','Ver','hab-btn');ver.href='#arquivos/'+encodePath(h.caminho);acoes.append(ver);}
        if(state.portal.chat){const usar=node('button','Usar no chat','hab-btn primary');usar.type='button';
          // a conversa nasce na pasta da skill: skill de subpasta só carrega com o agente aberto ali
          usar.onclick=()=>window.ratoeiraNovaConversa?.({texto:'/'+h.nome+' ',cwd:h.origem==='repo'&&h.onde&&pasta?pasta+'/'+h.onde:null});acoes.append(usar);}
        pe.append(onde,acoes);card.append(topo,desc,pe);lista.append(card);
      }
    }
    $('habs-busca').addEventListener('input',()=>dados&&desenhar());
    $('habs-onde').addEventListener('change',()=>dados&&desenhar());
    return {async mostrar(){
      errorAt('habs-erro','');
      if(!dados)esqueleto();
      if(!dados||Date.now()-em>60000){try{await carregar();}catch(e){errorAt('habs-erro',e.message);if(!dados)return;}}
      desenhar();
    }};
  })();
  const quandoFoi=iso=>{const d=new Date(iso),s=(Date.now()-d)/1000;if(s<60)return 'agora';if(s<3600)return 'há '+Math.round(s/60)+' min';if(s<86400)return 'há '+Math.round(s/3600)+' h';if(s<7*86400)return 'há '+Math.round(s/86400)+(s<1.5*86400?' dia':' dias');return d.toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit',year:'numeric'});};
  const quandoExato=iso=>new Date(iso).toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'});
  // ── Cron: ler o crontab, dizer em português quando roda e calcular a próxima vez ──
  // O cron conta no fuso da máquina (state.portal.fuso, UTC na maioria); a tela mostra no horário de quem está vendo.
  // srv(d) é um Date cujos campos UTC são a hora de parede da máquina; deSrv volta pro instante (#239, 27/10/2026).
  const fusoSrv=()=>state.portal?.fuso||'UTC';
  function deslSrv(d=new Date()){
    try{const p=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:fusoSrv(),hourCycle:'h23',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'}).formatToParts(d).map(x=>[x.type,x.value]));
      return Date.UTC(+p.year,p.month-1,+p.day,+p.hour,+p.minute,+p.second)-Math.floor(d.getTime()/1000)*1000;}catch{return 0;}
  }
  const srv=d=>new Date(d.getTime()+deslSrv(d)),deSrv=d=>new Date(d.getTime()-deslSrv(new Date(d.getTime()-deslSrv(d))));
  const DESLIGADO='#desligado# ';
  const MACROS={'@yearly':'0 0 1 1 *','@annually':'0 0 1 1 *','@monthly':'0 0 1 * *','@weekly':'0 0 * * 0','@daily':'0 0 * * *','@midnight':'0 0 * * *','@hourly':'0 * * * *'};
  const NOMES={jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12,sun:0,mon:1,tue:2,wed:3,thu:4,fri:5,sat:6};
  function campoCron(txt,min,max){
    const out=new Set();
    for(const parte of txt.toLowerCase().split(',')){
      const [faixa,passoTxt]=parte.split('/');const passo=passoTxt?Number(passoTxt):1;if(!(passo>=1))return null;
      let a,b;
      if(faixa==='*'){a=min;b=max;}
      else{const [x,y]=faixa.split('-').map(v=>NOMES[v]??Number(v));if(!Number.isInteger(x))return null;a=x;b=y===undefined?(passoTxt?max:x):y;if(!Number.isInteger(b))return null;}
      for(let i=a;i<=b;i+=passo)out.add(max===6&&i===7?0:i);
    }
    return [...out].every(n=>n>=min&&n<=(max===6?7:max))?out:null;
  }
  function lerCron(expr){
    const e=MACROS[expr]??expr;const f=e.trim().split(/\s+/);if(f.length!==5)return null;
    const m=campoCron(f[0],0,59),h=campoCron(f[1],0,23),d=campoCron(f[2],1,31),mes=campoCron(f[3],1,12),dow=campoCron(f[4],0,6);
    if(!m||!h||!d||!mes||!dow)return null;
    return {m,h,d,mes,dow,dLivre:f[2]==='*',dowLivre:f[4]==='*',campos:f};
  }
  // Próxima vez que a expressão casa, a partir de agora (no fuso da máquina, como o cron do servidor).
  function proximaCron(expr,de=new Date()){
    const c=lerCron(expr);if(!c)return null;
    const t=srv(new Date(Math.floor(de.getTime()/60000)*60000+60000));
    for(let i=0;i<200000;i++){
      if(!c.mes.has(t.getUTCMonth()+1)){t.setUTCMonth(t.getUTCMonth()+1,1);t.setUTCHours(0,0,0,0);continue;}
      const dOk=c.d.has(t.getUTCDate()),wOk=c.dow.has(t.getUTCDay());
      const dia=c.dLivre&&c.dowLivre?true:c.dLivre?wOk:c.dowLivre?dOk:(dOk||wOk);
      if(!dia){t.setUTCDate(t.getUTCDate()+1);t.setUTCHours(0,0,0,0);continue;}
      if(!c.h.has(t.getUTCHours())){t.setUTCHours(t.getUTCHours()+1,0,0,0);continue;}
      if(!c.m.has(t.getUTCMinutes())){t.setUTCMinutes(t.getUTCMinutes()+1,0,0);continue;}
      return deSrv(t);
    }
    return null;
  }
  const hhmm=d=>d.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
  const DIAS=['domingo','segunda','terça','quarta','quinta','sexta','sábado'];
  // "a cada 15 min", "todo dia às 06:00", "seg a sex às 09:30"... e a expressão quando não tem frase pronta.
  function descreverCron(expr){
    if(expr==='@reboot')return 'quando a VPS liga';
    const c=lerCron(expr);if(!c)return expr;
    const [fm,fh,fd,fmes,fdow]=c.campos;
    const passo=fm.match(/^\*\/(\d+)$/);
    if(passo&&fh==='*'&&fd==='*'&&fmes==='*'&&fdow==='*')return 'a cada '+passo[1]+' min';
    if(/^\d+$/.test(fm)&&fh==='*'&&fd==='*'&&fmes==='*'&&fdow==='*')return 'toda hora, no minuto '+fm;
    const ph=fh.match(/^\*\/(\d+)$/);
    if(/^\d+$/.test(fm)&&ph&&fd==='*'&&fmes==='*'&&fdow==='*')return 'a cada '+ph[1]+' h';
    const l=localDeCron(expr),CURTO=['dom','seg','ter','qua','qui','sex','sáb'];
    if(l.freq==='dia')return 'todo dia às '+l.hora;
    if(l.freq==='uteis')return 'seg a sex às '+l.hora;
    if(l.freq==='semana')return (l.dias.length===1?(l.dias[0]===0||l.dias[0]===6?'todo ':'toda ')+DIAS[l.dias[0]]:l.dias.map(w=>CURTO[w]).join(', '))+' às '+l.hora;
    if(l.freq==='mes')return 'todo dia '+l.dia+' do mês às '+l.hora;
    if(/^\d+$/.test(fm)&&/^[\d,]+$/.test(fh)&&fmes==='*'){
      const horas=fh.split(',').map(h=>{const d=srv(new Date());d.setUTCHours(Number(h),Number(fm),0,0);return hhmm(deSrv(d));}).join(', ');
      if(fd==='*'&&fdow==='*')return 'todo dia às '+horas;
      if(fd==='*'&&/^1-5$/.test(fdow))return 'seg a sex às '+horas;
      if(fd==='*'&&/^\d$/.test(fdow)){const d=Number(fdow)%7;return (d===0||d===6?'todo ':'toda ')+DIAS[d]+' às '+horas;}
      if(/^\d+$/.test(fd)&&fdow==='*')return 'todo dia '+fd+' do mês às '+horas;
    }
    return expr;
  }
  // Horário escolhido na tela (fuso de quem vê) → cron no fuso da máquina, e de volta. Muda o dia da semana quando o
  // horário cruza a meia-noite lá (ex.: 22h em Brasília é 01h do dia seguinte num servidor em UTC).
  const listaDias=ws=>{const v=[...new Set(ws)].sort((a,b)=>a-b);const out=[];for(let i=0;i<v.length;){let j=i;while(j+1<v.length&&v[j+1]===v[j]+1)j++;out.push(j-i>=2?v[i]+'-'+v[j]:v.slice(i,j+1).join(','));i=j+1;}return out.join(',');};
  function cronDeLocal({freq,hora='09:00',dias=[],dia=1,cada=2,cron=''}){
    if(freq==='cron')return cron.trim().replace(/\s+/g,' ');
    const [h,m]=String(hora).split(':').map(Number);if(!(h>=0&&h<24&&m>=0&&m<60))return '';
    const d=new Date();d.setHours(h,m,0,0);const s=srv(d);
    const uh=s.getUTCHours(),um=s.getUTCMinutes(),desl=(s.getUTCDay()-d.getDay()+7)%7,mover=w=>(w+desl)%7;
    if(freq==='horas')return um+' */'+cada+' * * *';
    if(freq==='dia')return um+' '+uh+' * * *';
    if(freq==='uteis')return um+' '+uh+' * * '+listaDias([1,2,3,4,5].map(mover));
    if(freq==='semana')return dias.length?um+' '+uh+' * * '+listaDias(dias.map(mover)):'';
    if(freq==='mes'){const n=Number(dia)+(desl===1?1:desl===6?-1:0);return um+' '+uh+' '+(n>=1?n:Number(dia))+' * *';}
    return '';
  }
  function localDeCron(expr){
    const c=lerCron(expr);if(!c||String(expr).startsWith('@'))return {freq:'cron',cron:expr};
    const [fm,fh,fd,fmes,fdow]=c.campos;if(fmes!=='*')return {freq:'cron',cron:expr};
    const ph=fh.match(/^\*\/(\d+)$/);
    if(/^\d+$/.test(fm)&&ph&&fd==='*'&&fdow==='*')return {freq:'horas',cada:Number(ph[1])};
    if(!/^\d+$/.test(fm)||!/^\d+$/.test(fh))return {freq:'cron',cron:expr};
    const s=srv(new Date());s.setUTCHours(Number(fh),Number(fm),0,0);const d=deSrv(s);
    const hora=String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0'),desl=(d.getDay()-s.getUTCDay()+7)%7,voltar=w=>(w+desl)%7;
    if(fd==='*'&&fdow==='*')return {freq:'dia',hora};
    if(fd==='*'){const ws=[...c.dow].map(voltar).sort((a,b)=>a-b);return ws.join()==='1,2,3,4,5'?{freq:'uteis',hora}:{freq:'semana',hora,dias:ws};}
    if(/^\d+$/.test(fd)&&fdow==='*')return {freq:'mes',hora,dia:Number(fd)+(desl===6?-1:desl===1?1:0)};
    return {freq:'cron',cron:expr};
  }
  function quandoVai(d){
    if(!d)return '';const hoje=new Date(),am=new Date(Date.now()+86400000);
    const dia=d.toDateString()===hoje.toDateString()?'hoje':d.toDateString()===am.toDateString()?'amanhã':d.toLocaleDateString('pt-BR',{weekday:'short',day:'2-digit',month:'2-digit'});
    return dia+' às '+hhmm(d);
  }
  // Linhas do crontab viram automações. `# ratoeira: Nome | o que faz` logo antes dá nome e descrição;
  // `#desligado# ` na frente é uma automação desligada. comUsuario: linhas do /etc/cron.d (6º campo é o usuário).
  function lerCrontab(texto,{comUsuario=false}={}){
    const out=[];let rotulo=null;
    (texto||'').split('\n').forEach((bruta,i)=>{
      const l=bruta.trim();
      const r=l.match(/^#\s*ratoeira:\s*([^|]+?)\s*(?:\|\s*(.*))?$/);if(r){rotulo={nome:r[1],descricao:r[2]||''};return;}
      const desligada=l.startsWith(DESLIGADO.trim());const base=desligada?bruta.slice(bruta.indexOf(DESLIGADO)+DESLIGADO.length):bruta;
      const b=base.trim();
      if(!b||(!desligada&&b.startsWith('#'))||/^[A-Za-z_][A-Za-z0-9_]*\s*=/.test(b)){if(!b.startsWith('# Instalado pela Ratoeira'))rotulo=l?null:rotulo;return;}
      const partes=b.split(/\s+/);let expr,resto;
      if(partes[0].startsWith('@')){expr=partes[0];resto=partes.slice(1);}else{expr=partes.slice(0,5).join(' ');resto=partes.slice(5);}
      let usuario=null;if(comUsuario){usuario=resto[0];resto=resto.slice(1);}
      const comando=resto.join(' ');const chave=comando.match(/ratoeira-cron\s+([A-Za-z0-9._-]+)/)?.[1]??null;
      const curto=comando.replace(/^\S*ratoeira-cron\s+\S+\s+(--\s+)?/,'');
      out.push({linha:i,texto:base,ligada:!desligada,expr,comando,curto,usuario,chave,nome:rotulo?.nome||chave||curto.split(/\s+/)[0].split('/').pop()||'automação',descricao:rotulo?.descricao||''});
      rotulo=null;
    });
    return out;
  }
  const tz=()=>Intl.DateTimeFormat().resolvedOptions().timeZone;
  const REGRAS_AUTOMACAO=()=>[
    'Regras das automações nesta Ratoeira:',
    '- As minhas ficam no arquivo ~/.config/ratoeira/crontab (formato crontab). Edita esse arquivo; não usa `crontab -e` (não grava daqui). A Ratoeira instala em até 1 minuto, e erro de sintaxe aparece na tela de Automações.',
    '- O servidor está no fuso '+fusoSrv()+' (é nesse horário que o cron conta); eu estou em '+tz()+' (agora são '+hhmm(new Date())+' aqui). Converte os horários.',
    '- Antes de cada linha, um comentário `# ratoeira: Nome curto | o que faz`.',
    '- O comando roda pelo invólucro: `/usr/local/bin/ratoeira-cron <nome-sem-espaço> -- <comando>` (ele guarda o log e o resultado pra tela, e já põe claude e codex no PATH). Usa caminhos absolutos.',
    '- Pra desligar sem apagar, a linha começa com `#desligado# `.',
    '- Antes de salvar, me mostra como vai ficar e confirma comigo.',
  ].join('\n');

  // ── Registros do time (_contexto/integracoes.md e _contexto/automacoes.md, convenção do Ratos OS) ──
  // O gateway entrega as tabelas já lidas; cada tela pega a coluna pelo começo do nome, porque o cabeçalho
  // varia um pouco de repo pra repo ("automação" ou "rotina", "pra quê" ou "pra que").
  let registrosCache=null,registrosEm=0;
  const PARADA=/fora de uso|desligad|rascunho|parad/i;   // seções de coisa parada começam recolhidas
  async function lerRegistros(){if(!registrosCache||Date.now()-registrosEm>60000){registrosCache=await api('/registros');registrosEm=Date.now();}return registrosCache;}
  const campo=(item,...nomes)=>{for(const n of nomes){const k=Object.keys(item).find(c=>c.startsWith(n)||c.includes(n));if(k&&item[k])return item[k];}return '';};
  const primeiro=item=>Object.values(item)[0]||'';
  // **negrito** e [link](...) do markdown viram texto limpo; `código` vira <code>
  const limpo=t=>String(t||'').replace(/\*\*(.*?)\*\*/g,'$1').replace(/\[([^\]]+)\]\([^)]*\)/g,'$1');
  function textoComCodigo(t,cls){const p=node('span',undefined,cls);String(limpo(t)).split(/`([^`]*)`/).forEach((x,i)=>p.append(i%2?node('code',x):document.createTextNode(x)));return p;}

  const REGRAS_ROTINA=()=>[
    'Regras das rotinas nesta Ratoeira:',
    '- Rotina é um pedido pro agente que roda sozinho num horário. Cada uma é um arquivo em ~/.config/ratoeira/rotinas/<id>.md (id: minúsculas, números e hífen).',
    '- Formato do arquivo:',
    '```\n---\nnome: Nome curto\nquando: <cron de 5 campos, no fuso do servidor, '+fusoSrv()+'>\nagente: claude (ou codex)\npasta: <caminho absoluto onde o agente abre; o padrão é '+(state.portal.chat?.pastaPadrao||'a raiz do repo')+'>\navisar: quando-precisar (ou sempre, ou so-erro)\nligada: sim\n---\n<o pedido, escrito como eu escreveria no chat; pode chamar skill, ex.: /minha-skill>\n```',
    '- O servidor está no fuso '+fusoSrv()+' (é nesse horário que o cron conta); eu estou em '+tz()+' (agora são '+hhmm(new Date())+' aqui). Converte o horário.',
    '- Roda sem ninguém olhando, no modo automático: o pedido tem que se virar sozinho e dizer onde deixar o resultado (arquivo, e-mail, mensagem).',
    '- A Ratoeira põe no horário em até 1 minuto, e cada execução vira uma conversa no chat com o nome da rotina.',
    '- avisar diz quando o sino (e o celular) me chama: quando-precisar (o agente termina a resposta com uma linha "[avisar] <pergunta>" se precisar de mim), sempre (toda execução) ou so-erro. Falha avisa sempre. Eu respondo na própria conversa da execução.',
    '- Se o que eu pedir não for um pedido pro agente (é um script, ou algo que precisa estar no ar o tempo todo, como um webhook), me avisa e me orienta antes.',
    '- Antes de salvar, me mostra como vai ficar e confirma comigo.',
  ].join('\n');
  const pastaCurta=p=>{const raiz=state.portal.chat?.pastaPadrao||'';return !p||p===raiz?'raiz do repo':p.startsWith(raiz+'/')?p.slice(raiz.length+1):p.replace(/^\/home\/[^/]+\//,'~/');};

  const automacoes=(()=>{
    let meus=null,rotinas=null,time=null;
    const chipResultado=(est,{temRegistro=true}={})=>{
      if(!temRegistro)return node('span','sem registro','chip');
      if(!est)return node('span','ainda não rodou','chip');
      if(est.rodando)return node('span','rodando agora','chip forte');
      const quando=est.fim?quandoFoi(est.fim):'';
      const c=node('span',(est.codigo===0?'deu certo ':'falhou (saída '+est.codigo+') ')+quando,'chip '+(est.codigo===0?'ok':'erro'));c.title='Início '+quandoExato(est.inicio)+(est.fim?' · fim '+quandoExato(est.fim):'');return c;
    };
    function chave(rotulo,ligada,alternar){
      const sw=node('label',undefined,'chave');const cb=node('input');cb.type='checkbox';cb.checked=ligada;cb.setAttribute('aria-label',(ligada?'Desligar ':'Ligar ')+rotulo);sw.append(cb,node('span'));
      if(!alternar){sw.replaceChildren();sw.className='chave-vazia';return sw;}
      cb.onchange=async()=>{cb.disabled=true;try{await alternar(cb.checked);}catch(e){cb.checked=!cb.checked;toast(e.message);}finally{cb.disabled=false;}};
      return sw;
    }
    function botao(texto,fn,cls='hab-btn'){const b=node('button',texto,cls);b.type='button';b.onclick=fn;return b;}
    // Cada grupo é uma ilha: cabeçalho (ícone, título, o que é, botão de criar) e as linhas embaixo
    function secao(titulo,sub,{icone=null,tom='',acao=null}={}){
      const s=node('section',undefined,'auto-secao'),cab=node('header',undefined,'auto-cab'),txt=node('div',undefined,'auto-cab-txt');
      if(icone){const ic=node('span',undefined,'auto-ic '+tom);ic.setAttribute('aria-hidden','true');ic.append(svg(icone));cab.append(ic);}
      txt.append(node('h2',titulo));if(sub)txt.append(node('p',sub));cab.append(txt);if(acao)cab.append(acao);s.append(cab);return s;
    }
    // Vazio: uma frase e exemplos que já abrem a conversa com o pedido
    function vazio(texto,exemplos=[],abrir=null){
      const v=node('div',undefined,'auto-vazio');v.append(node('p',texto));
      if(exemplos.length&&abrir){const g=node('div',undefined,'sugs');for(const e of exemplos){const b=node('button',undefined,'sug');b.type='button';b.append(node('span',e.rotulo??e));b.onclick=()=>abrir(e);g.append(b);}v.append(g);}
      return v;
    }
    const EXEMPLOS_ROTINA=[
      {rotulo:'Toda segunda às 9h, resume o que mudou nos arquivos na semana',nome:'Resumo da semana',freq:'semana',dias:[1],hora:'09:00',pedido:'Resume o que mudou nos arquivos desta pasta nos últimos 7 dias (pelo histórico do git), em tópicos curtos por assunto, e salva em resumos/semana-AAAA-MM-DD.md.'},
      {rotulo:'Todo dia às 18h, confere as tarefas atrasadas',nome:'Tarefas atrasadas',freq:'uteis',hora:'18:00',pedido:'Procura nos arquivos de tarefas desta pasta o que está com prazo vencido e lista em tarefas-atrasadas.md, com o caminho de cada uma e há quantos dias venceu.'},
      {rotulo:'Todo dia 1º, monta o relatório do mês',nome:'Relatório do mês',freq:'mes',dia:1,hora:'08:00',pedido:'Monta o relatório do mês passado a partir das planilhas e anotações desta pasta e salva em relatorios/AAAA-MM.md.'}];
    const EXEMPLOS_AUTO=['De hora em hora, copia uma pasta pra um backup','Todo dia às 3h, apaga arquivos temporários com mais de 7 dias'];
    // ── Modal de rotina: criar e mudar direto na tela; "Prefiro descrever pro agente" leva pro chat ──
    const dlg=$('rotina-dlg'),fr=$('rotina-form');let atual=null;
    function mostrarCampos(){const f=fr.elements.freq.value;for(const el of fr.querySelectorAll('[data-se]'))el.hidden=!el.dataset.se.split(' ').includes(f);proxima();}
    const valores=()=>({freq:fr.elements.freq.value,hora:fr.elements.hora.value,dia:fr.elements.dia.value,cada:fr.elements.cada.value,cron:fr.elements.cron.value,dias:[...fr.querySelectorAll('[name=dias]:checked')].map(c=>Number(c.value))});
    function proxima(){
      const e=cronDeLocal(valores()),p=e&&(lerCron(e)||e.startsWith('@'))?proximaCron(e):null,el=$('rotina-proxima');
      el.textContent=!e?(fr.elements.freq.value==='semana'?'Escolhe pelo menos um dia.':'Horário incompleto.'):p?'Próxima vez: '+quandoVai(p)+'.':e.startsWith('@')?descreverCron(e):'Expressão inválida.';
    }
    function abrirRotina(r=null){
      atual=r&&r.id?r:null;const base=r||{};fr.reset();errorAt('rotina-erro','');
      const q=atual?localDeCron(atual.quando):{freq:base.freq||'dia',hora:base.hora,dias:base.dias,dia:base.dia};
      fr.elements.nome.value=base.nome||'';fr.elements.pedido.value=base.pedido||'';fr.elements.freq.value=q.freq;
      if(q.hora)fr.elements.hora.value=q.hora;if(q.dia)fr.elements.dia.value=q.dia;if(q.cada)fr.elements.cada.value=String(q.cada);if(q.cron)fr.elements.cron.value=q.cron;
      for(const c of fr.querySelectorAll('[name=dias]'))c.checked=(q.dias||[1]).includes(Number(c.value));
      fr.elements.agente.value=base.agente==='codex'?'codex':'claude';fr.elements.pasta.value=base.pasta||state.portal.chat?.pastaPadrao||'';fr.elements.avisar.value=['sempre','so-erro'].includes(base.avisar)?base.avisar:'quando-precisar';
      fr.elements.ligada.checked=atual?atual.ligada:true;$('rotina-ligada-box').hidden=!atual;$('rotina-apagar').hidden=!atual;
      $('rotina-titulo').textContent=atual?'Editar rotina':'Nova rotina';$('rotina-salvar').textContent=atual?'Salvar':'Criar rotina';
      $('rotina-agente').textContent=atual?'Mudar com o agente':'Prefiro descrever pro agente';
      mostrarCampos();dlg.showModal();(atual?fr.elements.pedido:fr.elements.nome).focus();
    }
    fr.addEventListener('input',proxima);fr.elements.freq.addEventListener('change',mostrarCampos);
    for(const id of ['rotina-fechar','rotina-cancelar'])$(id).onclick=()=>dlg.close();
    $('rotina-agente').onclick=()=>{dlg.close();if(atual)editarRotina(atual);else novaRotina(fr.elements.pedido.value.trim());};
    $('rotina-apagar').onclick=async()=>{
      if(await perguntar('Apagar a rotina?','"'+atual.nome+'" para de rodar. As conversas que ela já criou ficam no chat.',[['apagar','Apagar','perigo'],['nao','Cancelar']],1)!=='apagar')return;
      try{rotinas=await window.ratoeiraPedir('rotina-apagar',{rotina:atual.id});post('/automacoes/aplicar').catch(()=>{});dlg.close();desenharMeus();toast('Rotina apagada.');}catch(e){errorAt('rotina-erro',e.message);}
    };
    fr.onsubmit=async ev=>{
      ev.preventDefault();const v=valores(),quando=cronDeLocal(v),b=$('rotina-salvar');
      if(!fr.elements.nome.value.trim())return errorAt('rotina-erro','Dá um nome pra rotina.');
      if(!fr.elements.pedido.value.trim())return errorAt('rotina-erro','Escreve o que o agente faz.');
      if(!quando||!(lerCron(quando)||quando.startsWith('@')))return errorAt('rotina-erro',v.freq==='semana'&&!v.dias.length?'Escolhe pelo menos um dia da semana.':'Confere o horário.');
      b.disabled=true;errorAt('rotina-erro','');
      try{
        const r=await window.ratoeiraPedir('rotina-salvar',{rotina:atual?.id??null,nome:fr.elements.nome.value,quando,agente:fr.elements.agente.value,pasta:fr.elements.pasta.value.trim(),pedido:fr.elements.pedido.value,avisar:fr.elements.avisar.value,ligada:fr.elements.ligada.checked});
        rotinas=r.rotinas;post('/automacoes/aplicar').catch(()=>{});dlg.close();desenharMeus();toast(atual?'Rotina salva.':'Rotina criada. Entra no horário em até 1 minuto.');
      }catch(e){errorAt('rotina-erro',/desconhecido/i.test(e.message)?'O servidor de agentes ainda está na versão anterior. Tenta de novo daqui a alguns minutos, ou usa "Prefiro descrever pro agente".':e.message);}
      finally{b.disabled=false;}
    };
    const novaRotina=ex=>window.ratoeiraNovaConversa?.({texto:REGRAS_ROTINA()+'\n\nO que eu quero que rode sozinho (o pedido, e quando): '+(typeof ex==='string'?ex:'')});
    const novaAutomacao=ex=>window.ratoeiraNovaConversa?.({texto:REGRAS_AUTOMACAO()+'\n\nO que eu quero automatizar (o que roda, e quando): '+(typeof ex==='string'?ex:'')});

    // ── Rotina: quando · agente · pasta, e o pedido ──
    function linhaRotina(r,{alternar=null,rodar=null,editar=null,abrir=null,dono=null}){
      const row=node('article',undefined,'auto-row rotina'+(r.ligada?'':' desligada'));
      const corpo=node('div',undefined,'auto-corpo');
      const t=node('div',undefined,'auto-titulo');t.append(node('strong',r.nome));if(dono)t.append(node('span',dono,'chip'));corpo.append(t);
      const valida=Boolean(lerCron(r.quando)||r.quando.startsWith('@'));
      const quando=node('p',undefined,'auto-quando');const prox=r.ligada&&valida?proximaCron(r.quando):null;
      quando.append(node('span',valida?descreverCron(r.quando):'horário inválido ('+r.quando+')',valida?'':'error-text'),node('span',r.agente==='codex'?'Codex':'Claude','muted'),node('span',pastaCurta(r.pasta),'muted'),
        ...(prox?[node('span','próxima: '+quandoVai(prox),'muted')]:r.ligada?[]:[node('span','desligada','muted')]));
      quando.title=r.quando+' ('+fusoSrv()+')';corpo.append(quando);
      const pedido=node('p',r.pedido,'auto-pedido');pedido.title=r.pedido;corpo.append(pedido);
      const lado=node('div',undefined,'auto-lado');lado.append(chipResultado(r.estado));
      const acoes=node('div',undefined,'auto-acoes');
      if(abrir&&r.sessao?.sessao)acoes.append(botao('Abrir a última',()=>abrir(r)));
      if(rodar)acoes.append(botao('Rodar agora',async ev=>{ev.target.disabled=true;try{await rodar(r);}catch(e){toast(e.message);}finally{ev.target.disabled=false;}}));
      if(editar)acoes.append(botao('Editar',()=>editar(r)));
      lado.append(acoes);row.append(chave(r.nome,r.ligada,alternar),corpo,lado);return row;
    }
    // ── Automação (comando agendado) ──
    function linhaAuto(a,{estados={},alternar=null,editar=null,log=null,dono=null}){
      const row=node('article',undefined,'auto-row'+(a.ligada?'':' desligada'));
      const corpo=node('div',undefined,'auto-corpo');
      const t=node('div',undefined,'auto-titulo');t.append(node('strong',a.nome));if(dono)t.append(node('span',dono,'chip'));corpo.append(t);
      if(a.descricao)corpo.append(node('p',a.descricao,'auto-desc'));
      const quando=node('p',undefined,'auto-quando');const prox=a.ligada?proximaCron(a.expr):null;
      quando.append(node('span',descreverCron(a.expr)),...(prox?[node('span','próxima: '+quandoVai(prox),'muted')]:a.ligada?[]:[node('span','desligada','muted')]));
      quando.title=a.expr+' ('+fusoSrv()+')';corpo.append(quando);
      const cmd=node('code',a.curto||a.comando,'auto-cmd');cmd.title=a.comando;corpo.append(cmd);
      const lado=node('div',undefined,'auto-lado');lado.append(chipResultado(a.chave?estados[a.chave]:null,{temRegistro:Boolean(a.chave)}));
      const acoes=node('div',undefined,'auto-acoes');let caixaLog=null;
      if(log&&a.chave)acoes.append(botao('Log',async()=>{
        if(caixaLog){caixaLog.remove();caixaLog=null;return;}
        caixaLog=node('pre','Carregando…','auto-log');row.append(caixaLog);
        try{const t=await log(a);caixaLog.textContent=t||'Sem log ainda.';caixaLog.scrollTop=caixaLog.scrollHeight;}catch(e){caixaLog.textContent=e.message;}
      }));
      if(editar)acoes.append(botao('Editar com o chat',()=>editar(a)));
      lado.append(acoes);row.append(chave(a.nome,a.ligada,alternar),corpo,lado);return row;
    }
    const abrirConversa=r=>window.ratoeiraAbrirConversa?.(r.sessao.agente,r.sessao.sessao,r.sessao.titulo);
    function editarRotina(r){
      const texto=REGRAS_ROTINA()+'\n\nQuero mudar a rotina "'+r.nome+'" (~/.config/ratoeira/rotinas/'+r.id+'.md), que hoje é:\n```\nquando: '+r.quando+' ('+descreverCron(r.quando)+' no meu horário)\nagente: '+r.agente+'\npasta: '+r.pasta+'\navisar: '+(r.avisar||'quando-precisar')+'\nligada: '+(r.ligada?'sim':'não')+'\n\n'+r.pedido+'\n```\n'
        +(r.estado?'Última execução: '+(r.estado.rodando?'rodando agora':'saída '+r.estado.codigo+' em '+quandoExato(r.estado.fim||r.estado.inicio))+(r.sessao?.titulo?' (conversa "'+r.sessao.titulo+'")':'')+'\n':'')+'\nO que eu quero mudar: ';
      window.ratoeiraNovaConversa?.({texto});
    }
    function editarAuto(a,log=''){
      const est=a.chave?meus?.estados?.[a.chave]:null;
      const texto=REGRAS_AUTOMACAO()+'\n\nQuero mudar esta automação (linha '+(a.linha+1)+' do arquivo):\n```\n'+(a.descricao||a.nome!==a.chave?'# ratoeira: '+a.nome+(a.descricao?' | '+a.descricao:'')+'\n':'')+a.texto+'\n```\n'
        +(est?'Último resultado: '+(est.rodando?'rodando agora':'saída '+est.codigo+' em '+quandoExato(est.fim||est.inicio))+'\n':'')
        +(log?'Fim do log:\n```\n'+log.split('\n').slice(-25).join('\n')+'\n```\n':'')+'\nO que eu quero mudar: ';
      window.ratoeiraNovaConversa?.({texto});
    }
    async function carregarMeus(){
      if(!state.portal.chat||!window.ratoeiraPedir){meus=null;rotinas=null;return;}
      [meus,rotinas]=await Promise.all([window.ratoeiraPedir('automacoes'),window.ratoeiraPedir('rotinas')]);
    }
    function desenharMeus(){
      const rb=$('auto-rotinas'),ab=$('auto-minhas');rb.replaceChildren();ab.replaceChildren();
      const comChat=Boolean(state.portal.chat);
      const sr=secao('Rotinas','Pedidos pro agente que rodam sozinhos num horário. Cada execução vira uma conversa no chat, que dá pra abrir e continuar.',{icone:'rotina',tom:'t0',acao:comChat?botao('Nova rotina',()=>abrirRotina(),'primary'):null});rb.append(sr);
      const sa=secao('Automações','Scripts e comandos agendados, que rodam sem agente.',{icone:'script',tom:'t1',acao:comChat?botao('Nova automação',novaAutomacao,''):null});ab.append(sa);
      if(!comChat){sr.append(vazio('Rotinas e automações precisam do chat ligado nesta Ratoeira.'));sa.remove();return;}
      if(!meus||!rotinas){sr.append(vazio('Carregando…'));sa.append(vazio('Carregando…'));return;}
      if(!rotinas.length)sr.append(vazio('Nenhuma rotina ainda. Começa por uma destas ou conta a tua em "Nova rotina":',EXEMPLOS_ROTINA,e=>abrirRotina(e)));
      for(const r of rotinas)sr.append(linhaRotina(r,{abrir:abrirConversa,editar:abrirRotina,
        alternar:async ligar=>{rotinas=await window.ratoeiraPedir('rotina-alternar',{rotina:r.id,ligar});post('/automacoes/aplicar').catch(()=>{});desenharMeus();toast(ligar?'Ligada.':'Desligada.');},
        rodar:async r=>{await window.ratoeiraPedir('rotina-rodar',{rotina:r.id});toast('Rodando. A conversa aparece no chat quando terminar.');setTimeout(()=>atualizar(),1500);}}));
      if(meus.status?.erro){const n=node('div',undefined,'notice error auto-aviso');n.append(node('strong','O cron recusou o teu arquivo de automações. As de antes seguem valendo.'),node('pre',meus.status.erro));
        n.append(botao('Corrigir com o chat',()=>window.ratoeiraNovaConversa?.({texto:REGRAS_AUTOMACAO()+'\n\nO cron recusou o meu ~/.config/ratoeira/crontab com este erro:\n```\n'+meus.status.erro+'\n```\nCorrige o arquivo.'}),''));sa.append(n);}
      const lista=lerCrontab(meus.texto||'');
      if(!lista.length)sa.append(vazio('Nenhuma ainda. Serve pra script que roda num horário. Pra coisa que precisa estar no ar o tempo todo (um webhook), o agente sugere outro caminho.',EXEMPLOS_AUTO,novaAutomacao));
      for(const a of lista)sa.append(linhaAuto(a,{estados:meus.estados||{},
        alternar:async ligar=>{meus=await window.ratoeiraPedir('automacao-alternar',{linha:a.linha,texto:a.texto,ligar});post('/automacoes/aplicar').catch(()=>{});desenharMeus();toast(ligar?'Ligada.':'Desligada.');},
        editar:async a=>{let log='';if(a.chave)try{log=(await window.ratoeiraPedir('automacao-log',{nome:a.chave})).texto;}catch{}editarAuto(a,log);},
        log:async a=>(await window.ratoeiraPedir('automacao-log',{nome:a.chave})).texto}));
    }
    function desenharTime(){
      const box=$('auto-time'),vps=$('auto-vps');box.replaceChildren();vps.replaceChildren();
      if(!time?.admin)return;
      if(time.erro){box.append(vazio(time.erro));return;}
      const outros=(time.pessoas||[]).filter(p=>p.usuario!==time.meuUsuario);
      const tem=outros.filter(p=>(p.rotinas||[]).length||lerCrontab(p.crontab).length);
      const s=secao('Do time','O que cada pessoa agendou. Tu pode ligar e desligar; mudar o resto, só a pessoa (ou o agente dela).'+(time.geradoEm?' Atualizado '+quandoFoi(time.geradoEm)+'.':''),{icone:'pessoas',tom:'t5'});box.append(s);
      if(!tem.length)s.append(vazio('Ninguém mais do time tem rotina ou automação.'));
      const alternarDe=(p,extra)=>async ligar=>{time=await post('/automacoes/alternar',{usuario:p.usuario,ligar,...extra});desenharTime();toast(ligar?'Ligada.':'Desligada.');};
      for(const p of tem){
        const dono=p.nome||p.usuario;
        if(p.status?.erro)s.append(node('p',dono+': o cron recusou o arquivo ('+p.status.erro.split('\n')[0]+').','error-text'));
        for(const r of p.rotinas||[])s.append(linhaRotina({...r,estado:p.estados?.['rotina-'+r.id]},{dono,alternar:alternarDe(p,{rotina:r.id})}));
        for(const a of lerCrontab(p.crontab))s.append(linhaAuto(a,{estados:p.estados||{},dono,alternar:p.gerenciado?alternarDe(p,{linha:a.linha,texto:a.texto}):null,log:a.chave?async a=>p.logs?.[a.chave]||'':null}));
      }
      // Bastidores: crons e timers da máquina. Pro dia a dia não importam; ficam recolhidos.
      const linhasVps=[];for(const c of time.sistema||[])for(const a of lerCrontab(c.texto,{comUsuario:c.comUsuario}))linhasVps.push([a,c.origem+(a.usuario?' · '+a.usuario:'')]);
      const timers=(time.timers||[]).filter(x=>x.unit);
      const d=node('details',undefined,'bastidores'),sm=node('summary'),ic=node('span',undefined,'auto-ic');ic.setAttribute('aria-hidden','true');ic.append(svg('servidor'));
      const st=node('span',undefined,'auto-cab-txt');st.append(node('strong','Bastidores da VPS'),node('span','Crons e timers do sistema e de quem não é pessoa da Ratoeira (ex.: o sync do repo). Só leitura: mexe-se por SSH.'));
      sm.append(ic,st,node('span',String(linhasVps.length+timers.length),'chip'));d.append(sm);
      for(const [a,origem] of linhasVps)d.append(linhaAuto(a,{dono:origem}));
      if(timers.length){
        const t=node('div',undefined,'auto-timers');t.append(node('h3','Timers do systemd'));
        for(const x of timers){
          const row=node('div',undefined,'auto-timer');const prox=x.next?new Date(x.next/1000):null,ult=x.last?new Date(x.last/1000):null;
          row.append(node('code',x.unit.replace(/\.timer$/,'')),node('span',x.activates||'','muted'),node('span',prox?'próxima: '+quandoVai(prox):'','muted'),node('span',ult?'última: '+quandoFoi(ult.toISOString()):'nunca rodou','muted'));
          t.append(row);
        }
        d.append(t);
      }
      vps.append(d);
    }
    // Mapa do time: o que roda fora das rotinas (Workers, servidores, outros computadores), do registro.
    function desenharMapa(reg){
      const box=$('auto-mapa');box.replaceChildren();
      const montar=state.portal.chat?botao('Montar com o chat',()=>window.ratoeiraNovaConversa?.({texto:'Monta o `_contexto/automacoes.md` deste repositório: uma tabela com automação | o que faz | onde roda | quando | onde deixa o resultado | como saber se quebrou, com tudo que roda sozinho (crons, Workers, webhooks, scripts agendados). Procura no código e me pergunta o que não der pra saber.'}),''):null;
      let ver=null;if(reg){ver=node('a','Ver o arquivo','hab-btn');ver.href='#arquivos/'+encodePath(reg.arquivo);}
      const s=secao('Mapa do time','O que roda fora das rotinas: Workers, servidores, outros computadores. Vem do arquivo _contexto/automacoes.md; pra mudar, pede pro agente.',{icone:'mapa',tom:'t2',acao:reg?ver:montar});box.append(s);
      if(!reg){s.append(vazio('Ainda não tem mapa. Quando alguém ligar uma automação fora da Ratoeira, o agente registra lá.'));return;}
      for(const sec of reg.secoes){
        if(!sec.itens.length)continue;
        const l=node('div',undefined,'int-lista');
        if(PARADA.test(sec.titulo)){const d=node('details',undefined,'secao-parada');d.append(node('summary',sec.titulo+' ('+sec.itens.length+')','mapa-sub'),l);s.append(d);}
        else{if(reg.secoes.length>1)s.append(node('h3',sec.titulo,'mapa-sub'));s.append(l);}
        for(const it of sec.itens){
          const row=node('div',undefined,'mapa-row');
          const c=node('div',undefined,'mapa-corpo');c.append(node('strong',limpo(primeiro(it))));
          const faz=campo(it,'o que faz','faz','estado');if(faz)c.append(textoComCodigo(faz,'auto-desc'));
          const onde=[campo(it,'onde roda','onde'),campo(it,'quando')].filter(Boolean);if(onde.length)c.append(textoComCodigo(onde.join(' · '),'muted mapa-onde'));
          const q=campo(it,'quebrou','como saber');if(q)c.append(textoComCodigo('Se quebrar: '+q,'mapa-quebrou'));
          row.append(c);l.append(row);
        }
      }
    }
    async function atualizar(){
      lerRegistros().then(r=>desenharMapa(r.automacoes)).catch(()=>desenharMapa(null));
      const [a,b]=await Promise.allSettled([carregarMeus(),api('/automacoes').then(r=>{time=r;})]);
      if(a.status==='rejected')errorAt('auto-erro','Não consegui ler as tuas rotinas e automações: '+a.reason.message);
      desenharMeus();desenharTime();
    }
    return {async mostrar(){errorAt('auto-erro','');desenharMeus();await atualizar();}};
  })();

  // ── Integrações: os MCPs que os agentes da pessoa enxergam, e as sugeridas ──
  const SUGERIDAS=[
    {id:'github',nome:'GitHub',pra:'repositórios, pull requests e issues',chave:/github/i,dica:'Usa o servidor MCP oficial do GitHub (remoto, por HTTP) com um token fine-grained.'},
    {id:'resend',nome:'Resend',pra:'mandar e-mail (avisos, relatórios, convites)',chave:/resend/i,dica:'Usa o MCP oficial do Resend.'},
    {id:'composio',nome:'Composio',pra:'centenas de apps com uma chave só (Slack, Notion, HubSpot, Google Sheets…)',chave:/composio/i,dica:'O Composio entrega um MCP que dá acesso aos apps que eu conectar na conta dele.'},
    {id:'context7',nome:'Context7',pra:'documentação atualizada de bibliotecas e APIs',chave:/context7/i,dica:'É um MCP remoto por HTTP.'},
    {id:'supabase',nome:'Supabase',pra:'banco de dados Postgres, autenticação e storage',chave:/supabase/i,dica:'Usa o MCP oficial do Supabase. Se a minha conta do Claude já tem o conector do Supabase, me avisa em vez de instalar outro.'},
    {id:'rendi',nome:'Rendi',pra:'renderizar vídeo pesado fora da VPS (opcional; tem plano grátis pra vídeo curto)',chave:/rendi/i,
      texto:'Quero ligar o Rendi (ffmpeg na nuvem) pra renderizar vídeo pesado fora da VPS. Segue a seção "Ligar o Rendi" da skill video-pesado-ratoeira: me explica antes, em poucas linhas, o que o plano grátis cobre e quando vale o pago, me pede a chave, pergunta se é só minha ou do time e instala também o MCP de documentação deles no escopo de usuário. Não repete a chave na resposta nem salva em arquivo do repositório. No fim, confere se a chave ficou acessível e roda `claude mcp list`.'},
  ];
  const promptIntegracao=s=>'Quero ligar a integração '+s.nome+' ('+s.pra+') no meu Claude Code aqui da Ratoeira, como MCP no escopo de usuário (vale em qualquer pasta). '+s.dica
    +' Consulta a documentação atual do '+s.nome+' pra usar o jeito oficial de instalar. Se precisar de chave ou token, me diz onde gerar e me pede; não repete a chave na resposta nem salva em arquivo do repositório. No fim, roda `claude mcp list` e me mostra se conectou.';
  // Nome do serviço por trás de um sinal: META_ADS_TOKEN → "meta ads"; op://Time/meta-ads → "meta ads".
  const normal=t=>' '+String(t||'').toLowerCase().normalize('NFD').replace(/\p{M}/gu,'').replace(/[^a-z0-9]+/g,' ').trim()+' ';
  const GENERICAS=new Set(['api','key','token','secret','client','id','access','refresh','developer','password','pass','service','role','webhook','account','private','auth','bearer','login','customer','consumer','credentials','credential','sk','url','local']);
  function servicoDe(x){
    if(x.tipo==='op')return x.nome.split('/').pop().replace(/[-_]/g,' ');
    if(x.tipo==='mcp')return x.nome;
    const p=x.nome.replace(/^(NEXT_PUBLIC_|VITE_|PUBLIC_)/,'').toLowerCase().split('_');while(p.length>1&&GENERICAS.has(p[p.length-1]))p.pop();
    return p.join(' ');
  }
  // Agrupa os sinais por serviço e devolve os que o registro não cita.
  function semRegistro(sinais,reg){
    const texto=normal((reg?.secoes||[]).flatMap(s=>s.itens.flatMap(i=>Object.values(i))).join(' | '));
    const grupos=new Map();
    for(const x of sinais){
      const s=servicoDe(x).trim();if(!s||texto.includes(normal(s))||texto.includes(normal(x.nome)))continue;
      const g=grupos.get(s)??{servico:s,sinais:[]};g.sinais.push(x);grupos.set(s,g);
    }
    return [...grupos.values()].sort((a,b)=>a.servico.localeCompare(b.servico));
  }
  const integracoes=(()=>{
    let meus=null,time=null,carregando=false,reg=null,locais=[],cofre=null;
    const botao=(texto,fn,cls='')=>{const b=node('button',texto,cls);b.type='button';b.onclick=fn;return b;};
    // A mesma ilha das Automações: cabeçalho com ícone, título, descrição e ação; o conteúdo vem em faixas por dentro.
    function ilha(titulo,sub,{icone=null,tom='',acao=null}={}){
      const s=node('section',undefined,'auto-secao'),cab=node('header',undefined,'auto-cab'),txt=node('div',undefined,'auto-cab-txt');
      if(icone){const ic=node('span',undefined,'auto-ic '+tom);ic.setAttribute('aria-hidden','true');ic.append(svg(icone));cab.append(ic);}
      txt.append(node('h2',titulo));if(sub)txt.append(node('p',sub));cab.append(txt);if(acao)cab.append(acao);s.append(cab);return s;
    }
    const aviso=texto=>{const v=node('div',undefined,'auto-vazio');v.append(node('p',texto));return v;};
    const rodape=texto=>node('p',texto,'int-rodape');
    function desenharRegistro(){
      const box=$('int-registro'),ach=$('int-achados');box.replaceChildren();ach.replaceChildren();
      const r=reg?.integracoes;
      const ver=r?node('a','Ver o arquivo','hab-btn'):null;if(ver)ver.href='#arquivos/'+encodePath(r.arquivo);
      const monta=!r&&reg&&state.portal.chat?botao('Montar com o chat',()=>window.ratoeiraNovaConversa?.({texto:'Monta o `_contexto/integracoes.md` deste repositório: tabelas por assunto com integração | pra quê | como o agente alcança | estado | última checagem. Chave nunca entra: só onde ela mora (`op://Vault/item`) ou o nome da variável. Procura no código, nos .env (só os nomes) e nas skills, e me pergunta o que não der pra saber.'}),'primary'):null;
      const s=ilha('Registro do time','Os serviços que o time usa e como o agente alcança cada um. A chave nunca aparece aqui: só onde ela mora.',{icone:'pessoas',tom:'t1',acao:ver||monta});box.append(s);
      if(!reg){s.append(aviso('Carregando…'));return;}
      if(!r)s.append(aviso('Ainda não tem registro de integrações neste repositório (_contexto/integracoes.md).'));
      else for(const sec of r.secoes){
        if(!sec.itens.length)continue;
        const l=node('div',undefined,'int-lista');
        if(PARADA.test(sec.titulo)){const d=node('details',undefined,'secao-parada');d.append(node('summary',sec.titulo+' ('+sec.itens.length+')','mapa-sub'),l);s.append(d);}
        else s.append(node('h3',sec.titulo,'mapa-sub'),l);
        for(const it of sec.itens){
          const row=node('div',undefined,'reg-row');const est=campo(it,'estado')||'';
          const cls=/^ligad/i.test(est)?'ok':/conferir|morta|venc|erro|401/i.test(est)?'forte':'';
          const c=node('div',undefined,'mapa-corpo');c.append(node('strong',limpo(primeiro(it))));
          const pra=campo(it,'pra');if(pra)c.append(textoComCodigo(pra,'auto-desc'));
          const como=campo(it,'como','alcan');if(como)c.append(textoComCodigo(como,'muted mapa-onde'));
          row.append(c,node('span',est?limpo(est):'—','chip '+cls));l.append(row);
        }
      }
      // o que está no repo (ou nos .env da pessoa) e o registro não cita: ilha própria, logo abaixo
      const faltam=semRegistro([...(reg.sinais||[]),...locais],r);
      if(!faltam.length)return;
      const pedir=()=>window.ratoeiraNovaConversa?.({texto:'Achei no repositório integrações que não estão no registro `'+(r?.arquivo||'_contexto/integracoes.md')+'`. Pra cada uma, descobre pelo código pra que serve e acrescenta uma linha na seção certa (integração | pra quê | como o agente alcança | estado | última checagem). Chave nunca entra, só onde ela mora. O que parecer antigo ou lixo, me pergunta antes.\n\n'+faltam.map(g=>'- '+g.servico+': '+g.sinais.map(x=>(x.tipo==='op'?'op://'+x.nome:x.nome)+(x.onde?.length?' ('+x.onde.join(', ')+')':'')).join('; ')).join('\n')});
      const a=ilha('Encontradas sem registro ('+faltam.length+')','Sinais de integração no repositório e nos teus .env (só o nome das chaves) que o registro não cita. Pode ser coisa nova, antiga ou lixo.',{icone:'arquivo',acao:state.portal.chat?botao('Registrar com o chat',pedir,'primary'):null});
      const l=node('div',undefined,'int-lista');
      for(const g of faltam){const row=node('div',undefined,'reg-row');const c=node('div',undefined,'mapa-corpo');c.append(node('strong',g.servico));
        c.append(node('span',g.sinais.map(x=>(x.tipo==='op'?'op://'+x.nome:x.tipo==='mcp'?'MCP '+x.nome:x.nome)+(x.onde?.[0]?' em '+x.onde[0]:'')).slice(0,3).join(' · '),'muted mapa-onde'));row.append(c);l.append(row);}
      a.append(l);ach.append(a);
    }
    // ── Cofre de chaves (1Password): onde moram as chaves do time. Admin cola o token de uma service account;
    // o agente de quem tem ambiente passa a ler os op:// sozinho. O token nunca volta pra tela. ──
    function desenharCofre(){
      const box=$('int-cofre');box.replaceChildren();if(!cofre)return;
      const adm=cofre.podeConfigurar;
      const form=()=>{
        const f=node('form',undefined,'cofre-form');const i=node('input');i.type='password';i.autocomplete='off';i.spellcheck=false;i.placeholder='ops_…';i.setAttribute('aria-label','Token da service account');i.required=true;
        const b=node('button','Conectar','primary');b.type='submit';const e=node('p','','error-text');e.hidden=true;
        f.append(i,b,e);
        f.onsubmit=async ev=>{ev.preventDefault();b.disabled=true;b.textContent='Testando no 1Password…';e.hidden=true;
          try{cofre={...cofre,...await post('/cofre/token',{token:i.value.trim()})};i.value='';desenharCofre();toast('Cofre conectado. Os agentes passam a ler as chaves quando religarem (ninguém conversando).');}
          catch(x){e.textContent=x.message;e.hidden=false;}finally{b.disabled=false;b.textContent='Conectar';}};
        return f;
      };
      let acao=null;
      if(adm&&cofre.configurado){acao=node('span',undefined,'auto-acoes');
        acao.append(botao('Trocar token',()=>{const d=s.querySelector('.cofre-troca');if(d)d.hidden=!d.hidden;},'hab-btn'),
          botao('Desconectar',async()=>{if(!confirm('Desconectar o cofre? Os agentes param de ler as chaves do 1Password (as skills que usam op:// deixam de funcionar).'))return;try{cofre={...cofre,...await post('/cofre/remover')};desenharCofre();}catch(x){toast(x.message);}},'hab-btn'));}
      const s=ilha('Cofre de chaves (1Password)','Onde moram as chaves do time. Conectado, os agentes leem as chaves sozinhos (pelas referências op://), e ninguém precisa colar chave em .env.',{icone:'chave',tom:'t0',acao});box.append(s);
      if(cofre.configurado){
        const row=node('div',undefined,'reg-row'),c=node('div',undefined,'mapa-corpo');
        c.append(node('strong','Conectado'+(cofre.conta?' a '+cofre.conta:'')),node('span','Desde '+quandoExato(cofre.desde)+'. Todo mundo com ambiente nesta Ratoeira lê estes vaults:','auto-desc'));
        const chips=node('div',undefined,'chips');for(const v of cofre.vaults||[])chips.append(node('span',v,'chip'));if(!(cofre.vaults||[]).length)chips.append(node('span','nenhum vault visível','muted'));c.append(chips);
        row.append(c,node('span','ligado','chip ok'));s.append(row);
        if(adm){const t=node('div',undefined,'cofre-troca auto-vazio');t.hidden=true;t.append(node('p','Cola o token novo (o antigo deixa de valer aqui na hora):'),form());s.append(t);}
      }else if(adm){
        const v=node('div',undefined,'auto-vazio cofre-passos');
        v.append(node('p','Conecta o 1Password do time em três passos:'));
        const ol=node('ol');for(const t of ['No 1Password, vai em Developer → Service Accounts e cria uma service account.','Dá a ela só leitura, e só no vault das chaves do time (nunca no de senhas pessoais). É ele que define o que os agentes enxergam.','Copia o token (começa com ops_) e cola aqui. A Ratoeira testa antes de guardar.'])ol.append(node('li',t));
        const doc=node('a','Como criar uma service account ↗');doc.href='https://developer.1password.com/docs/service-accounts/get-started/';doc.target='_blank';doc.rel='noopener noreferrer';
        v.append(ol,form(),node('p','Sem 1Password? Tudo bem: as chaves ficam no .env de cada um, fora do git. Só não fica compartilhado nem guardado num cofre.','muted'),doc);s.append(v);
      }else s.append(aviso('O cofre não está conectado. Quem administra a Ratoeira conecta o 1Password do time aqui; enquanto isso, as chaves ficam no .env de cada um.'));
    }
    const ESTADO={conectado:['Conectado','ok'],autorizar:['Precisa autorizar','forte'],falhou:['Falhou','erro'],instalado:['Instalado',''],desligado:['Desligado','']};
    const ORIGEM={conta:'Conta do Claude',plugin:'Plugin',instalado:'Instalado por ti'};
    function linha(m,agente){
      const row=node('div',undefined,'int-row');
      const [txt,cls]=ESTADO[m.estado]||[m.estado,''];
      row.append(node('strong',m.nome.replace(/^claude\.ai /,'')),node('span',agente==='codex'?'Codex':ORIGEM[m.origem]||'','chip'),node('code',m.alvo||''),node('span',txt,'chip '+cls));
      if(m.estado==='autorizar'&&m.origem==='conta'){const a=node('a','Autorizar no claude.ai ↗','hab-btn');a.href='https://claude.ai/settings/connectors';a.target='_blank';a.rel='noopener noreferrer';row.append(a);}
      else if(m.estado==='falhou')row.append(botao('Consertar com o chat',()=>window.ratoeiraNovaConversa?.({texto:'A integração (MCP) "'+m.nome+'" do meu Claude Code está falhando: '+(m.detalhe||'sem detalhe')+'. Descobre por quê e conserta (ou me diz se é melhor remover). No fim, roda `claude mcp list` e me mostra.'}),'hab-btn'));
      else row.append(node('span'));
      return row;
    }
    function desenhar(){
      const box=$('int-minhas');box.replaceChildren();
      const testar=state.portal.chat?botao(carregando?'Testando…':'Testar de novo',()=>carregar(true)):null;if(testar)testar.disabled=carregando;
      const s=ilha('O que o teu agente alcança agora','Os da tua conta do Claude (Gmail, Drive…) vêm do claude.ai; os outros foram instalados pra ti. Os do time que viram MCP também aparecem aqui.',{icone:'link',tom:'t2',acao:testar});box.append(s);
      if(!state.portal.chat)s.append(aviso('Integrações precisam do chat ligado nesta Ratoeira.'));
      else if(!meus){s.append(aviso(carregando?'Testando cada conexão… (leva uns segundos)':'Carregando…'));const e=node('div',undefined,'int-lista');for(let i=0;i<3;i++){const r=node('div',undefined,'int-row esqueleto');r.append(node('span',undefined,'osso curto'),node('span',undefined,'osso meio'));e.append(r);}s.append(e);}
      else{
        const todas=[...(meus.claude||[]).map(m=>[m,'claude']),...(meus.codex||[]).map(m=>[m,'codex'])];
        if(meus.claude===null)s.append(aviso('Não consegui perguntar ao Claude Code quais integrações ele tem.'));
        else if(!todas.length)s.append(aviso('Nenhuma integração ainda. Começa pelas sugeridas abaixo.'));
        if(todas.length){const l=node('div',undefined,'int-lista');for(const [m,ag] of todas)l.append(linha(m,ag));s.append(l);}
        s.append(rodape('Testado '+quandoFoi(new Date(meus.em).toISOString())+'. As chaves ficam na tua conta, na VPS: ninguém do time vê.'));
      }
      const sb=$('int-sug');sb.replaceChildren();
      const sug=ilha('Sugeridas','Boas práticas pra começar. O agente instala no jeito oficial de cada uma e te pede a chave quando precisar.',{icone:'mais',tom:'t5'});
      const grade=node('div',undefined,'habs-grid int-sug-grade');
      for(const x of SUGERIDAS){
        const card=node('article',undefined,'hab-card'),topo=node('div',undefined,'hab-topo');topo.append(node('strong',x.nome,'hab-nome int-nome'));
        const achada=[...(meus?.claude||[]),...(meus?.codex||[])].filter(m=>x.chave.test(m.nome));
        const tem=achada.length>0,conectada=achada.some(m=>m.estado==='conectado'||m.estado==='instalado');
        if(tem)topo.append(conectada?node('span','Já conectada','chip ok'):node('span','Precisa autorizar','chip forte'));
        const pe=node('div',undefined,'hab-pe'),acoes=node('span',undefined,'hab-acoes');
        if(state.portal.chat)acoes.append(botao(tem?'Ver com o chat':'Pedir pro agente instalar',()=>window.ratoeiraNovaConversa?.({texto:tem?'Me mostra como está a integração '+x.nome+' no meu Claude Code (rodando `claude mcp list`) e o que dá pra fazer com ela.':x.texto||promptIntegracao(x)}),'hab-btn'+(tem?'':' primary')));
        pe.append(acoes);card.append(topo,node('p','Pra '+x.pra+'.','hab-desc'),pe);grade.append(card);
      }
      sug.append(grade);sb.append(sug);
      const tb=$('int-time');tb.replaceChildren();
      if(time?.admin&&time.pessoas){
        const t=ilha('MCPs de cada pessoa','O que cada pessoa instalou no próprio agente (só o nome; as da conta do Claude de cada um não aparecem aqui).'+(time.geradoEm?' Atualizado '+quandoFoi(time.geradoEm)+'.':''),{icone:'pessoas'});
        const outros=time.pessoas.filter(p=>p.usuario!==time.meuUsuario);
        if(!outros.length)t.append(aviso('Só tu nesta Ratoeira, por enquanto.'));
        for(const p of outros){
          const row=node('div',undefined,'int-pessoa');row.append(node('strong',p.nome||p.usuario));
          const chips=node('div',undefined,'chips');for(const m of p.mcps||[])chips.append(node('span',m.nome+(m.agente==='codex'?' (Codex)':''),'chip'));
          if(!(p.mcps||[]).length)chips.append(node('span','nenhuma','muted'));row.append(chips);t.append(row);
        }
        tb.append(t);
      }
    }
    async function carregar(atualizar=false){
      if(!state.portal.chat||carregando)return;
      carregando=true;if(atualizar)meus=null;desenhar();
      try{meus=await window.ratoeiraPedir('integracoes',{cwd:state.portal.chat.pastaPadrao,atualizar});errorAt('int-erro','');}
      catch(e){errorAt('int-erro','Não consegui listar as integrações: '+e.message);}
      finally{carregando=false;desenhar();}
    }
    // "Só tuas" e "Do time" (desde 28/10/2026, do #244/#245 da FeedMe: quem usa não descobria que dá pra ligar
    // integração só sua). Cada lado tem o seu "Ligar uma nova", com o pedido certo pro agente; a escolha fica no navegador.
    const LADOS={
      tuas:{explica:'Só o teu agente usa. As chaves ficam na tua conta, na VPS, e ninguém do time vê. É aqui que entra conta pessoal: teu Instagram, teu WhatsApp, teu Gmail.',
        pedido:'Quero ligar uma integração só minha (só o meu agente usa; ninguém do time vê). Antes, vê se a minha conta do Claude já tem um conector pra isso. Se não tiver, usa o jeito oficial do serviço: MCP no escopo de usuário (`claude mcp add --scope user …`) ou, se for só uma chave de API, grava em `~/.config/ratoeira/chaves.env` (NOME=valor, chmod 600). Se precisar de chave ou login, me diz onde gerar e me pede; não repete a chave na resposta nem salva no repositório. No fim, testa e me mostra que funcionou.\n\nA integração: '},
      time:{explica:'Todo agente do time usa. Fica registrada no repositório (_contexto/integracoes.md) e a chave mora no cofre, se tiver um.',
        pedido:'Quero ligar uma integração pro time todo (os agentes de todo mundo usam). Usa o jeito oficial do serviço; a chave vai pro cofre do time (referência op://) se tiver um conectado, senão me diz onde ela deve ficar. Registra em `_contexto/integracoes.md` (integração | pra quê | como o agente alcança | estado | última checagem), sem valor de chave, só onde ela mora. Se precisar de chave, me pede; não repete na resposta nem salva no repositório. No fim, testa e me mostra que funcionou.\n\nA integração: '},
    };
    let lado=(()=>{try{return localStorage.getItem('ratoeira:int-lado')==='time'?'time':'tuas';}catch{return 'tuas';}})();
    function mostrarLado(l){
      lado=l;try{localStorage.setItem('ratoeira:int-lado',l);}catch{}
      for(const b of $('int-seg').querySelectorAll('button'))b.setAttribute('aria-pressed',String(b.dataset.int===l));
      $('int-g-tuas').hidden=l!=='tuas';$('int-g-time').hidden=l!=='time';$('int-explica').textContent=LADOS[l].explica;
      $('int-ligar').hidden=!state.portal.chat;
    }
    for(const b of $('int-seg').querySelectorAll('button'))b.onclick=()=>mostrarLado(b.dataset.int);
    $('int-ligar').onclick=()=>window.ratoeiraNovaConversa?.({texto:LADOS[lado].pedido});
    return {mostrar(){
      mostrarLado(lado);desenhar();desenharRegistro();carregar(false);api('/integracoes').then(r=>{time=r;desenhar();}).catch(()=>{});
      api('/cofre').then(c=>{cofre=c;desenharCofre();}).catch(()=>{cofre=null;desenharCofre();});
      lerRegistros().then(r=>{reg=r;desenharRegistro();}).catch(e=>{reg={sinais:[]};desenharRegistro();errorAt('int-erro','Não consegui ler o registro: '+e.message);});
      if(state.portal.chat)window.ratoeiraPedir?.('chaves-locais',{raiz:state.portal.chat.pastaPadrao}).then(l=>{locais=Array.isArray(l)?l:[];if(reg)desenharRegistro();}).catch(()=>{});
    }};
  })();
  // Configurações: Tua conta (todo mundo) e Organização (só o que a pessoa pode mexer). #configuracoes/<seção>
  let pessoasOrg=null;
  function configuracoes(sub){
    const links=[...document.querySelectorAll('[data-cfg]')],pode=k=>links.some(a=>a.dataset.cfg===k&&!a.hidden);
    if(!pode(sub)){sub='contas';history.replaceState(null,'','#configuracoes/contas');}
    for(const a of links){if(a.dataset.cfg===sub)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');}
    for(const painel of document.querySelectorAll('.cfg-painel'))painel.hidden=painel.id!=='cfg-'+sub;
    document.title=(sub==='contas-org'?'Contas de IA da organização':links.find(a=>a.dataset.cfg===sub).textContent)+' · Ratoeira';
    if(sub==='contas')refreshConnections();
    if(sub==='pessoas'||sub==='pastas')pessoas.mostrar();
    if(sub==='contas-org'){pessoasOrg=api('/pessoas').then(r=>r.pessoas||[]).catch(()=>null);claudeGeral.carregar();codexGeral.carregar();}
    if(sub==='padrao-chat')chatPadrao.carregar();
    if(sub==='ditado')ditadoCfg.carregar();
    if(sub==='seguranca')segurancaCfg.carregar('conta');
    if(sub==='seguranca-org')segurancaCfg.carregar('org');
    if(sub==='email')emailCfg.carregar();
    if(sub==='atualizacoes')atualizacoesCfg.carregar();
    if(sub==='enderecos')window.ratoeiraEnderecos?.carregar();
    if(sub==='playground')api('/playground').then(r=>{$('playground-form').elements.base.value=r.base||'';}).catch(e=>errorAt('playground-erro',e.message));
  }
  // ── Tela do app (computador, fora da Mesa, desde 17/10/2026) ──
  // Clicar num app (barra, Início, Apps) fora da Mesa abre só a aplicação: sem árvore, grade nem conversas, que a Mesa
  // carrega toda vez que monta. Na Mesa, no modo foco e no celular (onde a Mesa já é uma tela só), segue virando aba.
  // "Abrir na Mesa" leva o app pra aba da Mesa, na página onde a pessoa está; "Conversar" faz o mesmo e já abre uma
  // conversa nova do lado, com a tela como etiqueta (o chat mora na grade da Mesa). Cada app visitado guarda o iframe,
  // pra voltar sem recarregar. Sem sandbox, pelo mesmo motivo da aba da Mesa (precisa do login da Ratoeira).
  const sistema=(()=>{
    const frames=new Map();let atual=null;
    const appDe=c=>typeof c==='string'&&c.startsWith('/')&&!c.startsWith('//')?(state.portal?.systemApps||[]).find(a=>c.startsWith(a.url))||null:null;
    const ondeEm=fr=>{try{const u=new URL(fr.contentWindow.location.href);if(u.origin===location.origin)return u.pathname+u.search+u.hash;}catch{}return null;};
    const aqui=()=>{const fr=atual&&frames.get(atual.url),c=fr&&ondeEm(fr);return c&&c.startsWith(atual.url)?c:atual?.url||'';};
    const txt=(v,n)=>typeof v==='string'?v.replace(/\s+/g,' ').trim().slice(0,n):'';
    // pedido ao chat: mantém as quebras de linha (apontamentos de revisão chegam em lista), teto de 20 mil caracteres
    const pedidoTxt=v=>typeof v==='string'?v.replace(/\r\n?/g,'\n').replace(/[ \t]+$/gm,'').trim().slice(0,20000):'';
    const botao=(icone,rotulo,texto)=>{const b=node('button',undefined,texto?'sis-btn':'ib');b.type='button';b.title=rotulo;b.setAttribute('aria-label',rotulo);b.append(svg(icone));if(texto)b.append(node('span',texto));return b;};
    // leva pra Mesa com o app numa aba e espera ela montar
    async function paraMesa(){
      const alvo='#aplicacao:'+aqui();state.paraMesa=true;
      if(location.hash===alvo)route();
      else{const trocou=new Promise(r=>window.addEventListener('ratoeira:view',r,{once:true}));location.hash=alvo;await trocou;}
      await state.mesaPronta;
    }
    function pedir(detalhe){const url=atual.url;paraMesa().then(()=>window.dispatchEvent(new CustomEvent('ratoeira:app-pedido',{detail:{url,...detalhe}})));}
    function montarBarra(){
      const bar=$('sis-bar');if(bar.childElementCount)return;
      const nome=node('span',undefined,'sis-nome');nome.id='sis-nome';
      const conversar=botao('conversa','Conversar sobre esta tela: abre na Mesa, com uma conversa nova do lado','Conversar');conversar.hidden=!state.portal.chat;
      conversar.onclick=()=>pedir({texto:'',enviar:false,nova:true});
      const mesa=botao('mesa','Abrir na Mesa, como aba do lado dos arquivos e das conversas','Abrir na Mesa');mesa.classList.add('primary');mesa.onclick=()=>paraMesa();
      const recarregar=botao('recarregar','Recarregar o app');recarregar.onclick=()=>{const fr=frames.get(atual?.url);if(!fr)return;try{fr.contentWindow.location.reload();}catch{fr.src=fr.src;}};
      const copiar=botao('link','Copiar link pro time');
      copiar.onclick=async()=>{const l=location.origin+focoDe(aqui());try{await navigator.clipboard.writeText(l);toast('Link copiado. Abre só este app, com o chat recolhido do lado. Só abre pra quem tem acesso a ele na Ratoeira.');}catch{prompt('Copie:',l);}};
      const ext=node('a',undefined,'ib');ext.id='sis-ext';ext.target='_blank';ext.rel='noopener';ext.title='Abrir em nova aba, com o chat';ext.setAttribute('aria-label',ext.title);ext.append(svg('ext'));
      for(const ev of ['pointerenter','focus'])ext.addEventListener(ev,()=>{ext.href=focoDe(aqui());});
      bar.append(nome,conversar,mesa,recarregar,copiar,ext);
    }
    // app antigo (sem o app.js): some o chat próprio dele e os botões que abriam ele passam a abrir o da Ratoeira
    function aoCarregar(app,fr){
      const c=app.chat;if(!c)return;
      try{
        const w=fr.contentWindow,d=w.document;if(w.ratoeira)return;
        if(c.esconder||c.css){const st=d.createElement('style');st.textContent=(c.esconder?c.esconder+'{display:none!important}':'')+(c.css||'');d.head.append(st);}
        if(c.ponte)w[c.ponte]={
          nova:texto=>{atual=app;pedir({texto:String(texto||''),enviar:true});},
          sobre:dados=>{atual=app;pedir({texto:'Sobre '+(dados?.cliente||dados?.nome||'')+': ',enviar:false});},
        };
      }catch{}
    }
    function mostrar(caminho){
      const app=appDe(caminho);if(!app)return;montarBarra();
      let fr=frames.get(app.url);
      if(!fr){fr=document.createElement('iframe');fr.title=app.name;fr.src=caminho;fr.addEventListener('load',()=>aoCarregar(app,fr));frames.set(app.url,fr);$('sis-corpo').append(fr);}
      else if(caminho!==app.url&&caminho!==ondeEm(fr)){try{fr.contentWindow.location.assign(caminho);}catch{fr.src=caminho;}}
      atual=app;for(const [u,f] of frames)f.hidden=u!==app.url;
      const sim=node('span',app.name.slice(0,1).toUpperCase(),'app-symbol '+tom(app.name));sim.setAttribute('aria-hidden','true');
      $('sis-nome').replaceChildren(sim,node('span',app.name));$('sis-ext').href=focoDe(aqui());
    }
    // pedidos do /_ratoeira/app.js do app aberto aqui: chat e conversa existente vão pra Mesa, onde o chat mora
    window.addEventListener('message',e=>{
      const m=e.data;if(!m||m.ratoeira!==1||e.origin!==location.origin)return;
      const par=[...frames].find(([,f])=>f.contentWindow===e.source);if(!par)return;
      atual=appDe(par[0]);if(!atual)return;
      if(m.tipo==='chat')pedir({texto:pedidoTxt(m.texto),enviar:m.enviar===true,nova:m.nova===true});
      if(m.tipo==='abrir'&&/^[a-z][a-z0-9-]{0,30}$/.test(m.agente||'')&&/^[A-Za-z0-9_-]{8,80}$/.test(m.sessao||''))
        paraMesa().then(()=>window.ratoeiraAbrirConversa?.(m.agente,m.sessao,txt(m.titulo,120)||null,{texto:pedidoTxt(m.texto),enviar:m.enviar===true}));
    });
    return {serve:c=>Boolean(appDe(c)),mostrar,nome:()=>atual?.name||'App',url:()=>atual?.url||null};
  })();
  function route(){
    if(!state.portal)return;
    let hash=location.hash.slice(1)||'inicio';
    // endereços antigos: Conexões e Pessoas viraram seções de Configurações
    if(hash==='conexoes'||hash==='pessoas'){hash='configuracoes/'+(hash==='conexoes'?'contas':'pessoas');history.replaceState(null,'','#'+hash);}
    // #aplicacao:/pedidos/ abre a aplicação do sistema como aba da área Arquivos; sem Arquivos, abre a página inteira.
    let abrirApp=null,naTela=null;
    if(hash.startsWith('aplicacao:')){
      abrirApp=decodePath(hash.slice(10));hash='arquivos';
      if(!state.portal.files){const a=(state.portal.systemApps||[]).find(x=>x.url===abrirApp);if(a){location.assign(a.url);return;}abrirApp=null;hash='inicio';}
      // fora da Mesa, no computador: a tela do app (ver "sistema" acima)
      else if(!state.paraMesa&&document.body.dataset.view!=='arquivos'&&!('foco' in document.documentElement.dataset)&&!matchMedia('(max-width:760px)').matches&&sistema.serve(abrirApp)){naTela=abrirApp;abrirApp=null;hash='sistema';}
      state.paraMesa=false;
    }
    let section=hash.startsWith('app:')?'app':(hash==='arquivos'||hash.startsWith('arquivos/'))?'arquivos':(hash==='configuracoes'||hash.startsWith('configuracoes/'))?'configuracoes':hash;
    if(!['inicio','agentes','aplicacoes','configuracoes','app','arquivos','habilidades','automacoes','integracoes','sistema'].includes(section)||(section==='sistema'&&!naTela))section='inicio';
    if(section==='habilidades'&&!state.portal.files)section='inicio';
    if(section==='agentes'&&!state.portal.agents)section='inicio';
    if(section==='arquivos'&&!state.portal.files){section='inicio';toast('A Mesa não está configurada neste servidor.');}
    if(section==='app'){
      const id=hash.slice(4),app=state.portal.apps.find(a=>a.id===id) || (id==='guia'?{id:'guia',name:'Guia de aplicações',url:'/_ratoeira/pages/guia/'}:null);
      const url=app&&safeURL(app.url);
      if(!url){section='inicio';toast('Esse atalho não está disponível.');}
      else { $('app-title').textContent=app.name;$('app-external').href=url;$('app-frame').title=app.name;if(state.appId!==id){$('app-frame').src=url;state.appId=id;} }
    }
    if(section==='agentes'&&!state.agentStarted&&state.agentURL){state.agentStarted=true;$('agent-frame').src=state.agentURL;$('agent-frame').hidden=false;$('agent-loading').hidden=true;}
    if(section==='sistema')sistema.mostrar(naTela);
    document.body.dataset.view=section;
    const barra=section==='arquivos'||section==='sistema'?'recolhida':'aberta',mudouBarra=document.documentElement.dataset.barra!==barra;
    document.documentElement.dataset.barra=barra;if(mudouBarra)ajustarApps();
    ['inicio','agentes','aplicacoes','configuracoes','app','arquivos','habilidades','automacoes','integracoes','sistema'].forEach(key=>$('view-'+key).hidden=key!==section);
    document.querySelectorAll('[data-nav]').forEach(a=>{if(a.dataset.nav===section || (section==='app'&&a.dataset.nav===hash))a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');});
    document.querySelectorAll('#app-nav>a[data-app]').forEach(a=>{if(section==='sistema'&&a.dataset.app===sistema.url())a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');});
    document.title=(section==='sistema'?sistema.nome():section==='app'?$('app-title').textContent:{inicio:'Início',agentes:'Agentes',aplicacoes:'Apps',configuracoes:'Configurações',arquivos:'Mesa',habilidades:'Habilidades',automacoes:'Automações',integracoes:'Integrações'}[section])+' · Ratoeira';
    if(section==='configuracoes')configuracoes(hash.slice(14));
    if(section==='inicio')inicio();
    if(section==='aplicacoes'&&state.portal)atualizarApps({publicar:true});
    if(section==='habilidades')habilidades.mostrar();
    if(section==='automacoes')automacoes.mostrar();
    if(section==='integracoes')integracoes.mostrar();
    // chat.js liga e desliga a parte dos agentes da Início por aqui.
    window.dispatchEvent(new CustomEvent('ratoeira:view',{detail:section}));
    if(section==='arquivos')state.mesaPronta=files.show(hash.startsWith('arquivos/')?decodePath(hash.slice(9)):null,abrirApp);
  }
  // Aplicações: um card por aplicação. As do sistema (servidor e login próprios) abrem a página inteira, fora do quadro isolado.
  function appCard({name,description,url,href,externo,remover}){
    const card=node('article',undefined,'app-card'),main=node('a',undefined,'app-main');main.href=href;
    const txt=node('span',undefined,'app-txt');txt.append(node('strong',name));if(description)txt.append(node('span',description));
    main.append(appIcon(name),txt);
    const meta=node('div',undefined,'app-meta');meta.append(node('code',url));
    const acts=node('span',undefined,'app-acts');
    const ext=node('a',undefined,'ib');ext.href=externo||safeURL(url)||href;ext.target='_blank';ext.rel='noopener noreferrer';ext.setAttribute('aria-label','Abrir '+name+' em nova aba');ext.title='Abrir em nova aba';ext.append(svg('ext'));acts.append(ext);
    const erro=node('p',undefined,'error-text');erro.setAttribute('role','alert');erro.hidden=true;
    if(remover){const b=node('button',undefined,'ib remove');b.type='button';b.setAttribute('aria-label','Remover atalho de '+name);b.title='Remover atalho';b.append(svg('lixo'));b.onclick=()=>remover(b,erro);acts.append(b);}
    meta.append(acts);card.append(main,meta,erro);return card;
  }
  function navApp(name,href,dataNav,url){const a=node('a');a.href=href;if(dataNav)a.dataset.nav=dataNav;if(url)a.dataset.app=url;a.append(node('span',name.slice(0,1).toUpperCase(),'app-symbol '+tom(name)),node('span',name,'tip'));a.firstChild.setAttribute('aria-hidden','true');a.setAttribute('aria-label',name);return a;}
  // Barra baixa (notebook, janela pequena): os apps que não cabem até o sino somem da barra e viram um "+N" no fim,
  // que abre a lista deles. Mede de novo quando a janela muda de altura e quando a barra abre ou recolhe.
  function ajustarApps(){
    const nav=$('app-nav'),mais=$('app-mais');if(!nav||!mais)return;
    maisApps(null);
    const itens=[...nav.querySelectorAll(':scope>a')],sec=nav.closest('.rail-sec-apps'),extras=[sec.querySelector('.rail-apps-cab'),sec.querySelector('.rail-apps-todos')];
    sec.hidden=false;itens.forEach(a=>{a.hidden=false;});mais.hidden=true;extras.forEach(e=>{if(e)e.hidden=false;});
    if(matchMedia('(max-width:760px)').matches)return;
    // só a lista encolhe (portal.css): sobrou quando ela, a seção ou a barra passam do espaço que têm
    const rail=nav.closest('.rail'),passa=e=>e.scrollHeight>e.clientHeight+1,sobra=()=>passa(nav)||passa(sec)||passa(rail);
    if(!sobra())return;
    // apertado: sai o cabeçalho "Apps" e o "Ver todos" (o menu do "+N" leva pra tela de Apps), sobra lugar pros apps
    extras.forEach(e=>{if(e)e.hidden=true;});mais.hidden=false;let n=itens.length;
    while(n>0&&sobra())itens[--n].hidden=true;
    // "+1" ocupa o lugar do app que ele esconde: melhor mostrar o app
    if(itens.length-n===1){mais.hidden=true;itens[n].hidden=false;if(!sobra())return;itens[n].hidden=true;mais.hidden=false;}
    // nem o "+N" cabe (janela muito baixa): fica só o cabeçalho de Apps; nem ele, a seção sai (os apps seguem na Início e em #aplicacoes)
    if(sobra()){mais.hidden=true;if(extras[0])extras[0].hidden=false;if(sobra())sec.hidden=true;return;}
    const fora=itens.length-n,rotulo=fora===1?'Mais 1 app':'Mais '+fora+' apps';
    mais.firstChild.textContent='+'+fora;mais.lastChild.textContent=rotulo;mais.setAttribute('aria-label',rotulo);
  }
  // a fonte chega depois do primeiro desenho e muda a altura dos itens: mede de novo
  document.fonts?.ready.then(()=>ajustarApps()).catch(()=>{});
  function maisApps(botao){
    $('rail-mais-pop')?.remove();$('app-mais')?.setAttribute('aria-expanded','false');
    if(!botao)return;
    const rail=botao.closest('.rail'),pop=node('div',undefined,'rail-mais-pop');pop.id='rail-mais-pop';pop.setAttribute('role','menu');pop.setAttribute('aria-label','Mais apps');
    for(const a of $('app-nav').querySelectorAll(':scope>a[hidden]')){
      const l=node('a');l.href=a.getAttribute('href');l.setAttribute('role','menuitem');l.append(a.firstChild.cloneNode(true),node('span',a.getAttribute('aria-label')));l.onclick=()=>maisApps(null);pop.append(l);
    }
    const todos=node('a','Ver todos na tela de Apps','todos');todos.href='#aplicacoes';todos.setAttribute('role','menuitem');todos.onclick=()=>maisApps(null);pop.append(todos);
    rail.append(pop);botao.setAttribute('aria-expanded','true');
    const topo=botao.getBoundingClientRect().top-rail.getBoundingClientRect().top;
    pop.style.top=Math.max(8,Math.min(topo,rail.clientHeight-pop.offsetHeight-8))+'px';
    pop.querySelector('a')?.focus();
  }
  document.addEventListener('pointerdown',e=>{const p=$('rail-mais-pop');if(p&&!p.contains(e.target)&&!$('app-mais')?.contains(e.target))maisApps(null);});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&$('rail-mais-pop')){maisApps(null);$('app-mais')?.focus();}});
  // mede de novo quando a barra muda de altura e quando o rodapé dela cresce (o sino e o Reportar aparecem depois)
  try{const alturas=new WeakMap(),ro=new ResizeObserver(rs=>{let mudou=false;for(const r of rs){const n=Math.round(r.contentRect.height);if(alturas.get(r.target)!==n){alturas.set(r.target,n);mudou=true;}}if(mudou)ajustarApps();});
    ro.observe(document.querySelector('.rail'));ro.observe(document.querySelector('.rail-foot'));}catch{}
  function renderApps(){
    $('apps-list').replaceChildren();$('app-nav').replaceChildren();
    (state.portal.systemApps||[]).forEach(app=>{
      const dentro=state.portal.files?'#aplicacao:'+app.url:app.url;
      $('app-nav').append(navApp(app.name,dentro,null,app.url));
      $('apps-list').append(appCard({name:app.name,description:app.description,url:app.url,href:dentro,externo:app.url}));
    });
    state.portal.apps.forEach(app=>{
      $('app-nav').append(navApp(app.name,'#app:'+app.id,'app:'+app.id));
      $('apps-list').append(appCard({name:app.name,description:app.description,url:app.url,href:'#app:'+app.id,remover:async(remove,removalError)=>{
        if(!confirm('Remover o atalho “'+app.name+'”? Os arquivos da página serão mantidos.'))return;removalError.hidden=true;removalError.textContent='';remove.disabled=true;
        try{await api('/apps/'+encodeURIComponent(app.id),{method:'DELETE',body:'{}'});state.portal.apps=state.portal.apps.filter(a=>a.id!==app.id);renderApps();route();toast('Atalho removido. Os arquivos foram mantidos.');}
        catch(error){removalError.textContent=error.message;removalError.hidden=false;remove.disabled=false;}}}));
    });
    // card vazio no fim: cria com o agente (sem chat, abre o formulário de atalho)
    const comChat=Boolean(state.portal.chat),nova=node('button',undefined,'app-card app-nova');nova.type='button';const t=node('span',undefined,'app-txt');
    t.append(node('strong',comChat?'Criar um app':'Novo atalho'),node('span',comChat?'Abre uma conversa na Mesa pra montar com o agente.':'Uma página da VPS ou um endereço HTTPS.'));
    const ic=node('span',undefined,'appic');ic.append(svg('mais'));nova.append(ic,t);nova.onclick=()=>comChat?criarApp():toggleForm(true);$('apps-list').append(nova);
    // a barra mostra quantos couberem na altura; o resto vai pro "+N" (ajustarApps)
    const nav=$('app-nav');
    if(!nav.children.length)nav.append(node('span','Nenhum app ainda','rail-apps-vazio'));
    else{const mais=node('button',undefined,'rail-apps-mais');mais.type='button';mais.id='app-mais';mais.hidden=true;mais.setAttribute('aria-haspopup','menu');mais.setAttribute('aria-expanded','false');
      mais.append(node('span','','app-symbol'),node('span','','tip'));mais.onclick=e=>{e.stopPropagation();maisApps($('rail-mais-pop')?null:mais);};nav.append(mais);}
    ajustarApps();
    $('app-novo').hidden=$('app-criar').hidden=!comChat;
    renderPublicar();renderPlayground();
  }
  // A lista de apps vem do /portal na abertura, mas o agente publica pelo chat (publicar_app) com a página aberta.
  // Busca de novo quando uma resposta do agente termina, ao abrir Apps e ao voltar pra aba; redesenha só se mudou.
  let appsBuscando=null,appsBuscouEm=0;
  function atualizarApps({publicar=false,folga=0}={}){
    if(!state.portal||appsBuscando||Date.now()-appsBuscouEm<folga)return appsBuscando;
    appsBuscando=(async()=>{try{
      const novos=(await api('/portal')).systemApps||[];appsBuscouEm=Date.now();
      if(JSON.stringify(novos)!==JSON.stringify(state.portal.systemApps||[])){
        state.portal.systemApps=novos;renderApps();
        document.querySelectorAll('#app-nav>a[data-app]').forEach(a=>{if(document.body.dataset.view==='sistema'&&a.dataset.app===sistema.url())a.setAttribute('aria-current','page');});
      }else if(publicar)renderPublicar();
    }catch{}finally{appsBuscando=null;}})();
    return appsBuscando;
  }
  window.addEventListener('ratoeira:resposta-terminou',()=>atualizarApps({publicar:document.body.dataset.view==='aplicacoes'}));
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')atualizarApps({folga:30000});});
  // Publicados (playground.mjs): tudo que tem link pra abrir no navegador, cada um no seu caminho do endereço dos
  // Publicados (ou num domínio só dele). Página = arquivos servidos direto; programa = container (o ajudante de root lê o
  // estado de 1 em 1 minuto). Cada ação vira um pedido no chat: quem publica, liga, troca o acesso ou apaga é o agente.
  function pedirNoChat(texto){window.ratoeiraNovaConversa?.({texto});}
  function haQuanto(iso){
    if(!iso)return null;const s=(Date.now()-new Date(iso))/1000;
    return s<90?'agora':s<3600?'há '+Math.round(s/60)+' min':s<86400?'há '+Math.round(s/3600)+' h':'há '+Math.round(s/86400)+' dias';
  }
  const ACESSO={time:'só o time',senha:'com senha',publico:'qualquer um com o link'};
  // ── Diálogo Publicar (HTML, PDF, imagem, markdown; pasta não). Analisa no gateway (o que o arquivo usa, se já foi
  // publicado) e grava pelo servidor de agentes da pessoa (op "publicar"), que commita no nome dela. Sem agente.
  let publicados=[];   // a lista dos Publicados, pro globo marcar "publicado" e "mudou"
  const copiar=async(texto,ok)=>{try{await navigator.clipboard.writeText(texto);toast(ok);}catch{prompt('Copie:',texto);}};
  let publicadosAssinatura='';
  async function carregarPublicados(){
    try{publicados=(await api('/playground')).itens||[];}catch{}marcarGlobos();
    const a=JSON.stringify(publicados.map(x=>[x.nome,x.item,x.origem,x.pasta,x.acesso,x.mudou,x.enderecos]));
    if(a!==publicadosAssinatura){publicadosAssinatura=a;window.dispatchEvent(new CustomEvent('ratoeira:publicados'));}
  }
  // os desta Mesa (a área da árvore), pro globo da árvore e pra busca
  window.ratoeiraPublicadosDaMesa=()=>{const raiz=state.portal?.chat?.pastaPadrao;return publicados.filter(x=>!x.erro&&x.item&&x.raizArea===raiz);};
  window.addEventListener('ratoeira:resposta-terminou',()=>{if(state.portal?.playground&&state.portal?.chat)carregarPublicados();});
  function marcarGlobos(els){
    for(const b of els||document.querySelectorAll('[data-pub-rel]')){
      const p=publicados.find(x=>x.origem===b.dataset.pubRel);
      b.classList.toggle('pub-sim',Boolean(p));b.classList.toggle('pub-mudou',Boolean(p?.mudou));
      const r=p?(p.mudou?'Publicado · mudou desde a publicação':'Publicado'):'Publicar: um link pra abrir fora da Ratoeira';b.title=r;b.setAttribute('aria-label',r);
    }
  }
  window.ratoeiraMarcarGlobos=marcarGlobos;
  window.ratoeiraPublicar=async rel=>{
    const d=$('pub-dlg'),f=$('pub-form');
    if(!state.portal?.playground||!state.portal?.chat||!window.ratoeiraPedir)return toast('Publicar não está ligado nesta Ratoeira.');
    f.reset();errorAt('pub-erro','');$('pub-pronto').hidden=true;$('pub-campos').hidden=false;$('pub-estado').hidden=true;$('pub-tirar').hidden=true;
    $('pub-ok').hidden=false;$('pub-ok').disabled=true;$('pub-ok').textContent='Publicar';$('pub-agente').hidden=false;
    $('pub-arquivo').textContent=rel;$('pub-junto').hidden=true;$('pub-junto-lista').replaceChildren();f.elements.nome.disabled=false;
    $('pub-fechar').onclick=()=>d.close();
    $('pub-agente').onclick=()=>{d.close();window.ratoeiraNovaConversa?.({texto:`Quero publicar @${rel} pra abrir fora da Ratoeira. `,citar:rel});};
    if(!d.open)d.showModal();
    let a,base;
    try{[a,base]=await Promise.all([api('/playground/analisar?arquivo='+encodeURIComponent(rel)),api('/playground').then(r=>r.base)]);}
    catch(e){errorAt('pub-erro',e.message);return;}
    if(!base){errorAt('pub-erro','Falta o endereço dos Publicados: quem administra define em Configurações › Publicados.');return;}
    const ex=a.existente;
    $('pub-base').textContent=base+'/';
    f.elements.nome.value=ex?ex.nome:a.sugestao;f.elements.nome.disabled=Boolean(ex);
    const marcar=(nome,v)=>{const el=[...f.elements[nome]].find(x=>x.value===v);if(el)el.checked=true;};
    marcar('acesso',ex?.acesso||'time');marcar('modo',ex?.modo||'foto');
    f.elements.senha.placeholder=ex?.acesso==='senha'?'Em branco: mantém a senha atual':'A senha que o cliente vai digitar';
    const senhaVisivel=()=>{$('pub-senha-box').hidden=f.elements.acesso.value!=='senha';};senhaVisivel();
    for(const r of f.elements.acesso)r.onchange=senhaVisivel;
    if(a.tipo==='html'||a.tipo==='md'){
      const ja=ex?new Set(ex.junto||[]):null;
      for(const j of a.junto){
        const l=node('label',undefined,'check'),c=node('input');c.type='checkbox';c.name='junto';c.value=j.caminho;c.checked=ja?ja.has(j.caminho):j.marcado;
        const info=j.tipo==='pasta'?` · pasta, ${j.arquivos??0} arquivo${j.arquivos===1?'':'s'}`:'';
        const tam=j.tamanho!=null?` · ${j.tamanho>1048576?(j.tamanho/1048576).toFixed(1)+' MB':Math.max(1,Math.round(j.tamanho/1024))+' KB'}`:'';
        const t=node('span',j.caminho);t.append(node('span',info+tam+(j.marcado?' · o arquivo usa':''),'muted'));l.append(c,t);$('pub-junto-lista').append(l);
      }
      // resumo de uma linha; a lista fica fechada, a não ser que a publicação já feita fuja do que o arquivo usa
      const tam=n=>n>1048576?(n/1048576).toFixed(1).replace('.',',')+' MB':Math.max(1,Math.round(n/1024))+' KB';
      const resumir=()=>{
        const sel=a.junto.filter(j=>f.querySelector(`input[name=junto][value="${CSS.escape(j.caminho)}"]`)?.checked);
        const soNecessario=sel.length===a.junto.filter(j=>j.marcado).length&&sel.every(j=>j.marcado);
        const lista=sel.map(j=>j.caminho).join(', '),total=sel.reduce((t,j)=>t+(j.tamanho||0),0);
        $('pub-junto-resumo').textContent=!sel.length?'Só o arquivo.':(soNecessario?'Só o necessário: ':'Personalizado: ')+lista+(total?` (${tam(total)})`:'')+'.';
      };
      f.querySelectorAll('input[name=junto]').forEach(c=>c.onchange=resumir);resumir();
      $('pub-junto-det').open=Boolean(ja)&&a.junto.some(j=>ja.has(j.caminho)!==j.marcado);
      $('pub-junto').hidden=!a.junto.length;
    }
    if(ex){
      const link=ex.enderecos?.[0]||`https://${base}/${ex.nome}/`;
      $('pub-estado').textContent=`Publicado ${haQuanto(ex.publicadoEm)||''}${ex.publicadoPor?' por '+ex.publicadoPor.split('@')[0]:''} em ${link.replace('https://','')}`+(ex.mudou?' · o arquivo mudou desde então.':'.');
      $('pub-estado').hidden=false;$('pub-tirar').hidden=false;$('pub-ok').textContent=ex.modo==='foto'?'Atualizar':'Salvar';
    }
    $('pub-ok').disabled=false;
    $('pub-gerar').onclick=()=>{const al='abcdefghjkmnpqrstuvwxyz23456789',r=crypto.getRandomValues(new Uint8Array(12));f.elements.senha.value=[...r].map((x,i)=>(i&&i%4===0?'-':'')+al[x%al.length]).join('');};
    $('pub-tirar').onclick=async()=>{
      if(!confirm(`Tirar do ar ${base}/${ex.nome}/? O link para de abrir na hora.${ex.modo==='foto'?' A cópia publicada some; o teu arquivo fica.':''}`))return;
      $('pub-tirar').disabled=true;
      try{await window.ratoeiraPedir('despublicar',{raiz:state.portal.chat.pastaPadrao,nome:ex.nome});d.close();toast('Tirado do ar.');carregarPublicados();renderPlayground();}
      catch(e){errorAt('pub-erro',e.message);}finally{$('pub-tirar').disabled=false;}
    };
    f.onsubmit=async ev=>{
      ev.preventDefault();errorAt('pub-erro','');
      const nome=f.elements.nome.value.trim(),acesso=f.elements.acesso.value,senha=f.elements.senha.value.trim();
      if(!/^[a-z0-9][a-z0-9-]{0,40}$/.test(nome))return errorAt('pub-erro','O link aceita só letras minúsculas, números e hífen.');
      if(acesso==='senha'&&!senha&&ex?.acesso!=='senha')return errorAt('pub-erro','Escreve ou gera uma senha.');
      $('pub-ok').disabled=true;$('pub-ok').textContent='Publicando…';
      try{
        await window.ratoeiraPedir('publicar',{raiz:state.portal.chat.pastaPadrao,arquivo:rel,nome,acesso,...(senha?{senha}:{}),
          junto:[...f.querySelectorAll('input[name=junto]:checked')].map(x=>x.value),modo:f.elements.modo.value,dono:state.portal.user.email});
        const link=`https://${base}/${nome}/`;
        $('pub-campos').hidden=true;$('pub-estado').hidden=true;$('pub-tirar').hidden=true;$('pub-ok').hidden=true;$('pub-agente').hidden=true;
        const box=$('pub-pronto');box.replaceChildren();
        const linha=node('div',undefined,'pub-link-final'),cod=node('code',link),cp=node('button','Copiar'),ab=node('a','Abrir');
        cp.type='button';cp.onclick=()=>copiar(link,'Link copiado.');ab.href=link;ab.target='_blank';ab.rel='noopener noreferrer';ab.className='button';
        linha.append(cod,cp,ab);box.append(node('p',(ex?'Atualizado. ':'Publicado. ')+'Pode levar uns segundos pra abrir.'),linha);
        if(acesso==='senha'&&senha){const sp=node('p');sp.append('Senha: ',node('code',senha),' · ela não fica guardada em lugar nenhum: copia agora.');const cs=node('button','Copiar senha');cs.type='button';cs.onclick=()=>copiar(senha,'Senha copiada.');const ls=node('div',undefined,'pub-link-final');ls.append(sp,cs);box.append(ls);}
        box.hidden=false;carregarPublicados();renderPlayground();
      }catch(e){errorAt('pub-erro',e.message);$('pub-ok').textContent=ex?'Atualizar':'Publicar';}
      finally{$('pub-ok').disabled=false;}
    };
  };
  async function renderPlayground(){
    const box=$('apps-playground');
    if(!state.portal.playground){box.hidden=true;return;}
    let d;try{d=await api('/playground');}
    catch(e){box.hidden=false;box.replaceChildren(node('h2','Publicados','secao'),node('p',e.message,'error-text'));return;}
    const grid=node('div',undefined,'apps-grid'),comChat=Boolean(state.portal.chat);
    for(const x of d.itens){
      const pag=x.tipo==='pagina',oque=pag?'a página':'o programa';
      const card=node('div',undefined,'app-card'),main=node('div',undefined,'pub-main'),txt=node('span',undefined,'app-txt');
      const partes=[];
      if(x.erro)partes.push(x.erro);
      else{
        partes.push(pag?(x.mudou?'Página · mudou desde a publicação':'Página'):{ligado:'Programa ligado',desligado:'Programa desligado','sem-container':'Programa sem container rodando',desconhecido:'Programa'}[x.estado]||x.estado);
        partes.push(ACESSO[x.acesso]||'só o time');
        if(x.memoriaMB)partes.push(Math.round(x.memoriaMB)+' MB');
        const ha=haQuanto(x.ultimoAcesso);partes.push(ha?'aberto '+ha:'nunca aberto');
        if(x.dono)partes.push(x.dono.split('@')[0]);
      }
      txt.append(node('strong',x.titulo),node('span',partes.join(' · ')));if(x.descricao)txt.append(node('span',x.descricao,'muted'));
      main.append(appIcon(x.titulo),txt);card.append(main);
      if(x.desligadoSozinho&&x.estado!=='ligado')card.append(node('p','Desligado sozinho '+haQuanto(x.desligadoSozinho)+', depois de dias sem acesso.','muted'));
      const meta=node('div',undefined,'app-meta');
      const end=x.enderecos[0];
      meta.append(node('code',end?end.replace('https://',''):'sem endereço'));
      const acts=node('span',undefined,'app-acts');
      if(end){const a=node('a',undefined,'ib');a.href=end;a.target='_blank';a.rel='noopener noreferrer';a.title='Abrir em nova aba';a.setAttribute('aria-label','Abrir '+x.titulo+' em nova aba');a.append(svg('ext'));acts.append(a);}
      if(pag&&x.origem&&comChat){const a=node('button',undefined,'ib');a.type='button';a.title=x.mudou?'Mudou desde a publicação · abrir o Publicar':'Publicar (atualizar, quem vê, tirar do ar)';a.setAttribute('aria-label',a.title);a.append(svg('mundo'));if(x.mudou)a.classList.add('pub-mudou');a.onclick=()=>window.ratoeiraPublicar(x.origem);acts.append(a);}
      if(pag&&x.pasta&&state.portal.files){const a=node('a',undefined,'ib');a.href='#arquivos/'+x.pasta.split('/').map(encodeURIComponent).join('/');a.title='Ver os arquivos na Mesa';a.setAttribute('aria-label','Ver os arquivos de '+x.titulo+' na Mesa');a.append(svg('pasta'));acts.append(a);}
      meta.append(acts);card.append(meta);
      if(comChat){
        const pedidos=node('div',undefined,'actions');
        const b=(rot,texto)=>{const bt=node('button',rot);bt.type='button';bt.onclick=()=>pedirNoChat(texto);pedidos.append(bt);};
        if(!pag&&x.estado==='ligado')b('Desligar',`Desliga o programa ${x.nome} dos Publicados.`);else if(!pag&&!x.erro)b('Ligar',`Liga o programa ${x.nome} dos Publicados.`);
        if(!x.erro)b('Quem vê',`Quero mudar quem vê ${oque} ${x.nome} dos Publicados (hoje: ${ACESSO[x.acesso]||'só o time'}). Agora: `);
        if(!x.erro)b(x.enderecos.length>1?'Trocar domínio':'Domínio próprio',x.enderecos.length>1?`Quero trocar ou tirar o domínio próprio d${oque.slice(1)} ${x.nome} dos Publicados (hoje ${x.enderecos[0].replace('https://','').replace(/\/$/,'')}). O novo: `:`Quero um domínio próprio pr${oque.slice(1)} ${x.nome} dos Publicados: `);
        b('Apagar',pag?`Tira do ar a página ${x.nome} dos Publicados. Me mostra o que vai sumir antes.`:`Apaga o programa ${x.nome} dos Publicados: containers, volumes e a pasta. Me mostra o que vai sumir antes.`);
        card.append(pedidos);
      }
      grid.append(card);
    }
    if(comChat){const nova=node('button',undefined,'app-card app-nova');nova.type='button';const t=node('span',undefined,'app-txt');
      t.append(node('strong','Publicar algo'),node('span','Uma página, uma proposta, um protótipo ou um programa (n8n, Metabase). Abre uma conversa na Mesa.'));
      const ic=node('span',undefined,'appic');ic.append(svg('mais'));nova.append(ic,t);nova.onclick=()=>pedirNoChat('Quero publicar: ');grid.append(nova);}
    publicados=d.itens;marcarGlobos();
    const aviso=d.base?null:node('p',d.podeEditar?'Falta o endereço dos Publicados: defina em Configurações › Publicados.':'Falta o endereço dos Publicados; quem administra define em Configurações.','notice');
    box.hidden=false;
    box.replaceChildren(node('h2','Publicados','secao'),node('p','O que tem link pra abrir no navegador, cada um no seu caminho'+(d.base?' de '+d.base:'')+' (ou num domínio só dele). Quem vê: só o time (login da Ratoeira), quem tem a senha, ou qualquer um com o link. Programa que ninguém abre por 7 dias desliga sozinho.','muted secao-p'),...(aviso?[aviso]:[]),grid);
  }
  $('playground-form').onsubmit=async ev=>{
    ev.preventDefault();const f=ev.target,b=f.querySelector('button[type=submit]');b.disabled=true;errorAt('playground-erro','');
    try{const r=await api('/playground',{method:'PUT',body:JSON.stringify({base:f.elements.base.value})});f.elements.base.value=r.base||'';toast('Endereço dos Publicados salvo.');}
    catch(e){errorAt('playground-erro',e.message);}finally{b.disabled=false;}
  };
  // Configurações › Organização › Ditado (só admin): a chave do AssemblyAI da organização (o gateway testa e guarda;
  // o root grava num arquivo que o servidor de agentes de cada pessoa lê) e qual motor está valendo de fato, que pode
  // vir também do cofre de chaves (o servidor de agentes de quem está olhando diz).
  // ── Segurança (Tua conta, desde 28/10/2026): verificação em dois passos e, pra quem administra, exigir de todos ──
  const segurancaCfg=(()=>{
    // modo 'conta' (Tua conta: a verificação da pessoa) ou 'org' (Organização, só admin: exigir de todos e Esta VPS)
    let modo='conta',estado=null,org=null,vigia,backup=null,backupForm=false,backupSenha=null;   // vigia: undefined = sem chat pra saber, null = não tem, rotina = tem
    const VIGIA='vigia-de-seguranca';
    // Pedidos que a tela manda pro agente (passo 3) e o texto da rotina do vigia (passo 6)
    const PEDIDO_SSH=`Quero deixar o SSH desta VPS só com chave (Configurações › Segurança, passo "SSH só com chave"). Antes de mexer:
1. Confirma comigo que eu (ou o agente do meu computador) entro nesta VPS por chave: me passa o comando pra rodar no meu computador, ssh -o PasswordAuthentication=no -o BatchMode=yes <o apelido ou root@IP desta VPS> true, e só segue se der certo.
2. Confere que tem chave em /root/.ssh/authorized_keys ou na home de quem entra.
Depois roda a receita ssh-so-chave da Ratoeira (sudo bash /opt/ratoeira/fonte/kit/receitas/ssh-so-chave; onde a Ratoeira é desenvolvida, pela ferramenta rodar_receita) e me mostra o resultado. Não fecha a porta 22, não mexe no firewall e não desliga o root por chave: é por ali que o agente do meu computador entra.`;
    const PEDIDO_VIGIA=`Vigia de segurança desta VPS (ligado em Configurações › Segurança). Confere as últimas 24 horas, sem mudar nada:
1. SSH: tentativas que falharam e IPs banidos (sudo journalctl _COMM=sshd --since -24h; sudo fail2ban-client status sshd).
2. Entradas no SSH que deram certo (Accepted) vindas de um IP que não apareceu nos 30 dias antes.
3. Firewall: quantos bloqueios (sudo journalctl -k --since -24h | grep -c "UFW BLOCK") e se as regras mudaram (sudo ufw status).
4. Portas escutando fora do 127.0.0.1 além da 22, 80 e 443 (sudo ss -tlnp).
5. Usuário novo com shell de login, ou authorized_keys mudado nas últimas 24 horas.
6. Quem usou sudo (sudo journalctl _COMM=sudo --since -24h).
7. Atualização de segurança pendente (apt list --upgradable 2>/dev/null | grep -i security) e se a máquina pede reinício (/var/run/reboot-required).
8. Entradas no portal da Ratoeira: senha errada, conta travada, IP novo (sudo tail -n 300 /var/lib/ratoeira/gateway-estado/contas/acessos.log).
Escreve um resumo curto aqui. Robô tentando senha e sendo barrado é normal. Se tudo estiver normal, termina sem aviso. Se algo fugir do normal (entrada de IP desconhecido, porta nova, usuário ou chave nova, sudo de quem não costuma, reinício ou atualização de segurança pendente há dias), termina com uma linha [avisar] dizendo o que foi e o que tu sugere. Não corrige nada sozinho.`;
    const corpo=()=>$(modo==='org'?'seguranca-org-corpo':'seguranca-corpo');
    // o QR vem do servidor como SVG só de retângulos (dois-passos.mjs); entra pelo DOMParser, sem innerHTML
    const svgDe=texto=>{const d=new DOMParser().parseFromString(texto,'image/svg+xml').documentElement;return d.nodeName==='svg'?document.importNode(d,true):node('p','QR indisponível: use a chave abaixo.')};
    const campoCodigo=()=>{const i=node('input');i.inputMode='numeric';i.autocomplete='one-time-code';i.maxLength=12;i.required=true;i.placeholder='123456';return i;};
    function reservas(lista,depois){
      const box=node('div',undefined,'seg-reservas');
      box.append(node('h3','Guarde os códigos de reserva'),node('p','Se perder o celular, cada um entra no lugar do código do app, uma vez só. Eles não aparecem de novo: guarda num gerenciador de senhas ou anota num lugar seguro.','help'));
      const ul=node('ul',undefined,'seg-codigos');for(const c of lista)ul.append(node('li',c));box.append(ul);
      const texto='Códigos de reserva da Ratoeira ('+location.host+', '+state.portal.user.email+')\n\n'+lista.join('\n')+'\n';
      const acoes=node('div',undefined,'actions'),copiar=node('button','Copiar'),baixar=node('button','Baixar'),ok=node('button','Já guardei','primary');
      for(const b of [copiar,baixar,ok])b.type='button';
      copiar.onclick=()=>navigator.clipboard.writeText(texto).then(()=>toast('Códigos copiados.'),()=>toast('Não deu pra copiar. Seleciona e copia à mão.'));
      baixar.onclick=()=>{const a=node('a');a.href=URL.createObjectURL(new Blob([texto],{type:'text/plain'}));a.download='ratoeira-codigos-de-reserva.txt';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),5000);};
      ok.onclick=depois;acoes.append(copiar,baixar,ok);box.append(acoes);
      corpo().replaceChildren(box);
    }
    // pede um código (desligar e trocar reservas): formulário curto no lugar das ações
    function pedirCodigo(rotulo,acao,alvo){
      const f=node('form',undefined,'editor seg-pedir'),l=node('label','Código do app ou de reserva'),i=campoCodigo(),err=node('p',undefined,'error-text');err.hidden=true;err.setAttribute('role','alert');
      l.append(i);const acoes=node('div',undefined,'actions'),ok=node('button',rotulo,'primary'),volta=node('button','Cancelar');volta.type='button';volta.onclick=desenhar;
      acoes.append(ok,volta);f.append(l,err,acoes);
      f.onsubmit=async ev=>{ev.preventDefault();ok.disabled=true;err.hidden=true;try{await acao(i.value.trim());}catch(e){err.textContent=e.message;err.hidden=false;}finally{ok.disabled=false;}};
      alvo.replaceChildren(f);i.focus();
    }
    async function ativar(){
      const q=await post('/dois-passos/comecar');
      const box=node('div',undefined,'seg-ativar');
      box.append(node('p','1. Instala um app autenticador no celular (Google Authenticator, Microsoft Authenticator, 1Password).','help'),
        node('p','2. No app, adiciona uma conta e aponta a câmera pro código:','help'));
      const qr=node('div',undefined,'seg-qr');qr.append(svgDe(q.qr));box.append(qr);
      box.append(node('p','Sem câmera? Digita esta chave no app:','help'),node('code',q.segredo.replace(/(.{4})/g,'$1 ').trim(),'seg-chave'));
      const f=node('form',undefined,'editor'),l=node('label','3. Digita o código de 6 dígitos que o app mostra'),i=campoCodigo(),err=node('p',undefined,'error-text');err.hidden=true;err.setAttribute('role','alert');
      l.append(i);const acoes=node('div',undefined,'actions'),ok=node('button','Ativar','primary'),volta=node('button','Cancelar');volta.type='button';volta.onclick=desenhar;
      acoes.append(ok,volta);f.append(l,err,acoes);box.append(f);
      f.onsubmit=async ev=>{ev.preventDefault();ok.disabled=true;err.hidden=true;
        try{const r=await post('/dois-passos/confirmar',{codigo:i.value.trim()});toast('Verificação em dois passos ligada.');reservas(r.reservas,()=>carregar());}
        catch(e){err.textContent=e.message;err.hidden=false;}finally{ok.disabled=false;}};
      corpo().replaceChildren(box);i.focus();
    }
    function desenhar(){
      const c=corpo();if(!estado){c.replaceChildren(node('p','Carregando…','loading'));return;}
      const card=node('section',undefined,'seg-card');
      card.append(node('h3','Verificação em dois passos'));
      if(!estado.ativo){
        card.append(node('p',estado.exigido?'Esta Ratoeira exige: na próxima entrada ela pede pra configurar.':'Desligada. Além da senha, a entrada pede um código do celular. Quem descobrir a tua senha não entra sem ele.','help'));
        const acoes=node('div',undefined,'actions'),b=node('button','Ativar','primary');b.type='button';
        b.onclick=async()=>{b.disabled=true;try{await ativar();}catch(e){toast(e.message);b.disabled=false;}};acoes.append(b);card.append(acoes);
      }else{
        const desde=estado.desde?new Date(estado.desde).toLocaleDateString('pt-BR'):'';
        card.append(node('p','Ligada'+(desde?' desde '+desde:'')+'. '+(estado.reservas?estado.reservas+(estado.reservas===1?' código de reserva sobrando.':' códigos de reserva sobrando.'):'Nenhum código de reserva sobrando: gera novos.'),'help'));
        const acoes=node('div',undefined,'actions'),novos=node('button','Gerar códigos de reserva novos'),des=node('button','Desligar');
        for(const b of [novos,des])b.type='button';
        novos.onclick=()=>pedirCodigo('Gerar novos',async cod=>{const r=await post('/dois-passos/reservas',{codigo:cod});reservas(r.reservas,()=>carregar());},acoes);
        des.onclick=()=>pedirCodigo('Desligar',async cod=>{await post('/dois-passos/desligar',{codigo:cod});toast('Verificação em dois passos desligada.');await carregar();},acoes);
        acoes.append(novos);if(!estado.exigido)acoes.append(des);card.append(acoes);
      }
      const partes=modo==='org'?[]:[card];
      if(modo==='org'&&org){
        const o=node('section',undefined,'seg-card');o.append(node('h3','Organização'));
        const l=node('label',undefined,'check'),cx=node('input');cx.type='checkbox';cx.checked=org.exigirDois;
        l.append(cx,document.createTextNode(' Exigir verificação em dois passos de todo mundo'));
        o.append(l,node('p','Quem ainda não tem sai na hora e, na próxima entrada, configura antes de usar. Pra ligar, a tua precisa estar ativa. Quem perder o celular: Pessoas › Zerar dois passos.','help'));
        const err=node('p',undefined,'error-text');err.hidden=true;err.setAttribute('role','alert');o.append(err);
        cx.onchange=async()=>{
          if(cx.checked&&!confirm('Exigir de todo mundo? Quem ainda não ativou sai agora e configura na próxima entrada.')){cx.checked=false;return;}
          cx.disabled=true;err.hidden=true;
          try{org=await post('/seguranca',{exigirDois:cx.checked});state.portal.seguranca=org;toast(org.exigirDois?'Agora a verificação é exigida de todo mundo.':'Cada um escolhe se usa a verificação.');await carregar();}
          catch(e){cx.checked=!cx.checked;err.textContent=e.message;err.hidden=false;}finally{cx.disabled=false;}
        };
        partes.push(o,vps());
      }
      c.replaceChildren(...partes);
    }
    // Esta VPS (só quem administra): os passos que protegem a máquina. O SSH nunca fecha: é o socorro de quem usa.
    function vps(){
      const sec=node('section',undefined,'seg-card seg-vps');
      const be=backup?.estado,backupOk=Boolean(be?.configurado&&be.ultimo_ok&&Date.now()-Date.parse(be.ultimo_ok)<36*3600e3);
      const feitos=[estado.ativo,Boolean(org.portaDosFundos),org.ssh===false,Boolean(vigia),backupOk],n=feitos.filter(Boolean).length;
      const cab=node('div',undefined,'seg-cab');cab.append(node('h3','Esta VPS'),node('span','Nível '+n+' de '+feitos.length,'seg-nivel'+(n===feitos.length?' ok':'')));
      sec.append(cab,node('p','Passos que deixam a máquina mais segura, sem pressa. Nenhum deles fecha o SSH: é por ele que tu (ou o agente do teu computador) entra pra resolver problema.','help'));
      const passo=(titulo,texto,feito,acao)=>{
        const li=node('div',undefined,'seg-passo'+(feito?' feito':''));
        const tx=node('div');tx.append(node('strong',titulo),node('p',texto,'help'));
        const marca=node('span',feito?'Feito':'Pendente','seg-marca');li.append(marca,tx);
        if(acao)li.append(acao);sec.append(li);
      };
      const btn=(t,fn,cls='')=>{const b=node('button',t,cls);b.type='button';b.onclick=async()=>{b.disabled=true;try{await fn();}catch(e){toast(e.message);}finally{b.disabled=false;}};return b;};
      passo('Verificação em dois passos',estado.ativo?'A tua está ligada.':'A tua, em Tua conta › Segurança.',estado.ativo,estado.ativo?null:btn('Abrir',()=>{location.hash='#configuracoes/seguranca';}));
      const pdf=org.portaDosFundos;
      passo('Porta dos fundos',pdf?'Conferida em '+new Date(pdf.em).toLocaleDateString('pt-BR')+'. Se o SSH der problema, entra pelo terminal web do provedor.'
        :'Abre o terminal web no painel do provedor da VPS (na Hostinger: VPS › Terminal do navegador) e confere que entra. É por ele que tu volta se o SSH der problema.',
        Boolean(pdf),btn(pdf?'Desmarcar':'Já entrei',async()=>{org={...org,...await post('/seguranca',{portaDosFundos:!pdf})};desenhar();},pdf?'':'primary'));
      const ssh=org.ssh;
      passo('SSH só com chave',ssh===false?'O SSH não aceita senha. O root continua entrando por chave, e a porta 22 segue aberta.'
        :ssh===null?'Não consegui ler a configuração do SSH desta VPS.'
        :'Hoje o SSH aceita senha, e robôs tentam adivinhar o dia todo. O agente confere contigo que a tua chave entra e desliga só a senha.',
        ssh===false,ssh===true?(pdf?btn('Fazer com o agente',()=>window.ratoeiraNovaConversa?.({texto:PEDIDO_SSH}),'primary')
          :node('span','Primeiro a porta dos fundos','help seg-trava')):null);
      passo('Vigia diário',vigia?'Ligado: '+(vigia.ligada?'todo dia confere tentativas de entrada, portas, usuários e atualizações, e só chama no sino se algo fugir do normal.':'está desligado em Automações.')
        :vigia===undefined?'Precisa do chat ligado nesta Ratoeira.'
        :'Uma rotina às 8h que confere tentativas de entrada, portas abertas, usuário ou chave nova, uso de sudo e atualizações. Só chama no sino quando algo foge do normal.',
        Boolean(vigia?.ligada),vigia?btn('Ver em Automações',()=>{location.hash='#automacoes';}):vigia===null?btn('Ligar o vigia',ligarVigia,'primary'):null);
      passoBackup(passo,btn,sec,be,backupOk);
      return sec;
    }
    // ── Backup fora da VPS (kit/backup): destino S3 (Cloudflare R2, Backblaze B2 ou outro), criptografado com uma senha
    // que nasce no gateway e aparece uma vez aqui ──
    const QUANDO=d=>{const t=new Date(d);return t.toLocaleDateString('pt-BR')+' às '+t.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});};
    function passoBackup(passo,btn,sec,be,ok){
      const titulo='Backup fora da VPS';
      if(!backup?.disponivel&&!be){passo(titulo,'Chega numa atualização da Ratoeira. Até lá, liga o backup no painel do provedor da VPS (na Hostinger: VPS › Backups).',false,null);return;}
      if(!be?.configurado){
        passo(titulo,'Uma cópia criptografada da máquina inteira, toda madrugada, num lugar fora daqui (Cloudflare R2 ou Backblaze B2 têm 10 GB grátis). Se a VPS se perder, dá pra voltar.',false,
          backupForm?null:btn('Configurar',()=>{backupForm=true;desenhar();},'primary'));
        if(backupForm)sec.append(formBackup());
        return;
      }
      const onde=be.destino?.host?be.destino.host+'/'+be.destino.caminho:'destino configurado';
      const linha=be.status==='running'?'Rodando agora'+(be.comecou?', desde '+QUANDO(be.comecou):'')+'. ':be.status==='failed'?'O último falhou: '+(be.erro||'sem detalhe')+'. ':'';
      const texto=linha+(be.ultimo_ok?'Último backup completo em '+QUANDO(be.ultimo_ok)+'. ':'Nenhum backup completo ainda. ')+'Vai pra '+onde+(be.timer?', toda madrugada.':'. O diário está desligado.')+(be.pela_tela?'':' Montado à mão nesta VPS.');
      const acoes=node('div',undefined,'seg-acoes');
      if(backup?.disponivel&&be.pela_tela){
        acoes.append(btn('Fazer agora',async()=>{await pedirBackup({acao:'agora'});toast('Backup começou. Leva de minutos a uma hora, conforme o tamanho.');}),
          btn(be.timer?'Desligar o diário':'Ligar o diário',async()=>{await pedirBackup({acao:be.timer?'desligar':'ligar'});}));
      }
      passo(titulo,texto,ok,acoes.childElementCount?acoes:null);
      if(backupSenha)sec.append(caixaSenha());
    }
    async function pedirBackup(corpo){
      const r=await post('/backup',corpo);backup={disponivel:r.disponivel,estado:r.estado};if(r.senha)backupSenha=r.senha;desenhar();return r;
    }
    function caixaSenha(){
      const box=node('div',undefined,'seg-senha');
      box.append(node('strong','Guarda a senha do backup'),node('p','Sem ela ninguém abre o backup, nem nós. Guarda num gerenciador de senhas, fora desta VPS. (Ela também fica na VPS, em /etc/ratoeira-backup/password, mas isso não ajuda se a VPS se perder.)','help'),
        node('code',backupSenha,'seg-chave'));
      const acoes=node('div',undefined,'actions'),copiar=node('button','Copiar'),ok=node('button','Já guardei','primary');for(const b of [copiar,ok])b.type='button';
      copiar.onclick=()=>navigator.clipboard.writeText(backupSenha).then(()=>toast('Senha copiada.'),()=>toast('Não deu pra copiar. Seleciona e copia à mão.'));
      ok.onclick=()=>{backupSenha=null;desenhar();};acoes.append(copiar,ok);box.append(acoes);return box;
    }
    const DESTINOS={
      r2:{nome:'Cloudflare R2',endpoint:'https://<id-da-conta>.r2.cloudflarestorage.com',regiao:'auto',como:'No painel da Cloudflare: R2 › Create bucket. Depois R2 › Manage API tokens › Create API token, com "Object Read & Write" só nesse bucket. O endereço (S3 API) aparece na página do token.'},
      b2:{nome:'Backblaze B2',endpoint:'https://s3.us-west-004.backblazeb2.com',regiao:'us-west-004',como:'No Backblaze: Buckets › Create a Bucket (privado). Depois Application Keys › Add a New Application Key, só nesse bucket. O endereço (Endpoint) aparece no bucket; a região é o pedaço depois de "s3." (ex.: us-west-004).'},
      s3:{nome:'Outro S3',endpoint:'https://',regiao:'',como:'Qualquer serviço compatível com S3 (AWS, Wasabi, MinIO): endereço, bucket e uma chave que leia e grave nele.'},
    };
    function formBackup(){
      let tipo='r2';
      const f=node('form',undefined,'editor email-form seg-backup'),err=node('p',undefined,'error-text');err.hidden=true;err.setAttribute('role','alert');
      const seg=node('div',undefined,'email-tipo'),como=node('p',undefined,'help'),campos=node('div');
      const campo=(rotulo,nome,{tipo:t='text',valor='',ph='',ajuda}={})=>{const l=node('label',rotulo),i=node('input');i.name=nome;i.type=t;i.value=valor;i.placeholder=ph;i.autocomplete='off';i.spellcheck=false;l.append(i);if(ajuda)l.append(node('span',ajuda,'help'));return l;};
      const desenharCampos=()=>{
        const d=DESTINOS[tipo];for(const b of seg.children)b.setAttribute('aria-pressed',String(b.dataset.tipo===tipo));
        como.textContent=d.como;
        campos.replaceChildren(campo('Endereço (endpoint)','endpoint',{ph:d.endpoint,ajuda:'Começa com https:// e não leva o nome do bucket.'}),campo('Bucket','bucket',{ph:'ratoeira-backup'}),
          campo('ID da chave (Access Key ID)','chave_id'),campo('Segredo da chave (Secret Access Key)','segredo',{tipo:'password'}),
          campo('Região','regiao',{valor:d.regiao,ph:'auto'}),campo('Pasta dentro do bucket (opcional)','prefixo',{ph:location.hostname}));
      };
      for(const [k,d] of Object.entries(DESTINOS)){const b=node('button',d.nome);b.type='button';b.dataset.tipo=k;b.onclick=()=>{tipo=k;desenharCampos();};seg.append(b);}
      desenharCampos();
      const acoes=node('div',undefined,'actions'),ok=node('button','Testar e ligar','primary'),volta=node('button','Cancelar');volta.type='button';volta.onclick=()=>{backupForm=false;desenhar();};
      acoes.append(ok,volta);
      f.append(seg,como,campos,node('p','A Ratoeira confere a chave, cria o backup criptografado nesse lugar, mostra a senha dele uma vez e já faz o primeiro.','help'),err,acoes);
      f.onsubmit=async ev=>{ev.preventDefault();ok.disabled=true;ok.textContent='Conferindo…';err.hidden=true;
        const destino=Object.fromEntries([...f.querySelectorAll('input')].map(i=>[i.name,i.value.trim()]));
        try{backupForm=false;await pedirBackup({acao:'configurar',destino});toast('Backup ligado: o primeiro já começou.');}
        catch(e){backupForm=true;err.textContent=e.message;err.hidden=false;}finally{ok.disabled=false;ok.textContent='Testar e ligar';}};
      return f;
    }
    async function ligarVigia(){
      const pasta=state.portal.chat?.pastaPadrao;
      await window.ratoeiraPedir('rotina-salvar',{nome:'Vigia de segurança',quando:cronDeLocal({freq:'dia',hora:'08:00'}),agente:'claude',...(pasta?{pasta}:{}),avisar:'quando-precisar',pedido:PEDIDO_VIGIA,ligada:true});
      toast('Vigia ligado: roda todo dia às 8h.');await lerVigia();desenhar();
    }
    async function lerVigia(){
      if(!state.portal.chat||!window.ratoeiraPedir){vigia=undefined;return;}
      try{const l=await window.ratoeiraPedir('rotinas');vigia=(Array.isArray(l)?l:l?.rotinas||[]).find(r=>r.id===VIGIA)??null;}catch{vigia=undefined;}
    }
    async function carregar(qual=modo){
      modo=qual;estado=null;desenhar();
      try{
        const daOrg=modo==='org'&&state.portal.user.isAdmin;
        [estado,org,,backup]=await Promise.all([api('/dois-passos'),daOrg?api('/seguranca'):Promise.resolve(null),daOrg?lerVigia():null,
          daOrg?api('/backup').catch(()=>null):null]);
        if(org)state.portal.seguranca=org;
      }catch(e){corpo().replaceChildren(node('p','Não consegui carregar: '+e.message,'error-text'));return;}
      desenhar();
    }
    return {carregar};
  })();
  // ── E-mail da Ratoeira (Organização, desde 28/10/2026): Resend ou SMTP do próprio aluno, e o "Esqueci a senha" ──
  const emailCfg=(()=>{
    let atual=null,editando=false;
    const corpo=()=>$('email-corpo');
    const campo=(rotulo,nome,{tipo='text',valor='',ph='',ajuda}={})=>{const l=node('label',rotulo),i=node('input');i.name=nome;i.type=tipo;i.value=valor;i.placeholder=ph;i.autocomplete='off';i.spellcheck=false;l.append(i);if(ajuda)l.append(node('span',ajuda,'help'));return l;};
    function formulario(){
      const f=node('form',undefined,'editor email-form'),err=node('p',undefined,'error-text');err.hidden=true;err.setAttribute('role','alert');
      let tipo=atual?.tipo||'smtp';
      const seg=node('div',undefined,'email-tipo');
      const partes=node('div');
      const desenharCampos=()=>{
        for(const b of seg.children)b.setAttribute('aria-pressed',String(b.dataset.tipo===tipo));
        const mesmo=atual?.tipo===tipo,guardada=mesmo?' (deixa vazio pra manter a que está guardada)':'';
        partes.replaceChildren(campo('Remetente','de',{valor:atual?.de||'',ph:'Ratoeira <ratoeira@seudominio.com.br>',ajuda:'De quem o e-mail chega. No Resend, precisa ser de um domínio verificado lá; no Gmail, o próprio endereço.'}),
          ...(tipo==='resend'?[campo('Chave da API do Resend'+guardada,'chave',{tipo:'password',ph:'re_…',ajuda:'Em resend.com › API Keys. O plano grátis manda 3 mil por mês, mais que suficiente.'})]
          :[campo('Servidor','host',{valor:mesmo?atual.host:'',ph:'smtp.gmail.com'}),campo('Porta','porta',{valor:String(mesmo?atual.porta:587),ph:'587'}),
            campo('Usuário','usuario',{valor:mesmo?atual.usuario:'',ph:'teu@gmail.com'}),
            campo('Senha'+guardada,'senha',{tipo:'password',ajuda:'No Gmail, uma senha de app (myaccount.google.com › Segurança › Senhas de app), não a senha da conta.'})]));
      };
      for(const [k,t] of [['smtp','SMTP (Gmail e outros)'],['resend','Resend']]){const b=node('button',t);b.type='button';b.dataset.tipo=k;b.onclick=()=>{tipo=k;desenharCampos();};seg.append(b);}
      desenharCampos();
      const acoes=node('div',undefined,'actions'),ok=node('button','Testar e salvar','primary');acoes.append(ok);
      if(atual?.configurado){const volta=node('button','Cancelar');volta.type='button';volta.onclick=()=>{editando=false;desenhar();};acoes.append(volta);}
      f.append(seg,partes,node('p','Antes de salvar, a Ratoeira manda um e-mail de teste pra ti ('+state.portal.user.email+').','help'),err,acoes);
      f.onsubmit=async ev=>{ev.preventDefault();ok.disabled=true;ok.textContent='Testando…';err.hidden=true;
        const dados={tipo,...Object.fromEntries([...f.querySelectorAll('input')].map(i=>[i.name,i.value.trim()]))};
        try{atual=await post('/email',dados);editando=false;toast('E-mail salvo. O de teste foi pra '+state.portal.user.email+'.');desenhar();}
        catch(e){err.textContent=e.message;err.hidden=false;}finally{ok.disabled=false;ok.textContent='Testar e salvar';}};
      return f;
    }
    function desenhar(){
      const c=corpo();if(!atual){c.replaceChildren(node('p','Carregando…','loading'));return;}
      if(!atual.configurado||editando){c.replaceChildren(...(atual.configurado?[]:[node('p','Sem e-mail, quem esquecer a senha pede um link pra quem administra, em Pessoas.','notice')]),formulario());return;}
      const card=node('section',undefined,'seg-card');
      card.append(node('h3',atual.tipo==='resend'?'Resend':'SMTP: '+atual.host+':'+atual.porta),node('p','Manda como '+atual.de+(atual.desde?'. Configurado em '+new Date(atual.desde).toLocaleDateString('pt-BR'):'')+'.','help'));
      const l=node('label',undefined,'check'),cx=node('input');cx.type='checkbox';cx.checked=atual.esqueciSenha;
      l.append(cx,document.createTextNode(' Permitir trocar a senha pelo e-mail'));
      card.append(l,node('p','Aparece "Esqueceu a senha?" na tela de entrar, e o link chega no e-mail da conta. Vale 1 hora. Quem tem verificação em dois passos ainda digita o código depois.','help'));
      cx.onchange=async()=>{cx.disabled=true;try{atual=await post('/email/esqueci',{ligar:cx.checked});toast(atual.esqueciSenha?'"Esqueceu a senha?" ligado na tela de entrar.':'"Esqueceu a senha?" desligado.');}catch(e){cx.checked=!cx.checked;toast(e.message);}finally{cx.disabled=false;}};
      const acoes=node('div',undefined,'actions'),mudar=node('button','Mudar'),tirar=node('button','Tirar o e-mail');for(const b of [mudar,tirar])b.type='button';
      mudar.onclick=()=>{editando=true;desenhar();};
      tirar.onclick=async()=>{if(!confirm('Tirar o e-mail da Ratoeira? O "Esqueceu a senha?" some da tela de entrar.'))return;try{atual=await post('/email/remover');desenhar();}catch(e){toast(e.message);}};
      acoes.append(mudar,tirar);card.append(acoes);c.replaceChildren(card);
    }
    async function carregar(){atual=null;editando=false;desenhar();try{atual=await api('/email');}catch(e){corpo().replaceChildren(node('p','Não consegui carregar: '+e.message,'error-text'));return;}desenhar();}
    return {carregar};
  })();
  const ditadoCfg={
    async carregar(){
      errorAt('ditado-erro','');$('ditado-estado').textContent='Conferindo…';
      try{this.desenhar(await api('/ditado'));}catch(e){$('ditado-estado').textContent='Não consegui conferir: '+e.message;}
    },
    async desenhar(org){
      $('ditado-tirar').hidden=!org.configurado;
      let d=null;try{d=await window.ratoeiraPedir('ditado-estado',{fresco:true});}catch{}
      const motor=d?.motor??(org.configurado?'assemblyai':org.local?'local':null);
      const origem=d?.origem??(org.configurado?'organizacao':null);
      const de={organizacao:'chave da organização',cofre:'chave do cofre de chaves, item "assemblyai"',ambiente:'chave configurada no servidor'}[origem]||'chave';
      $('ditado-estado').textContent=motor==='assemblyai'?'Em uso: AssemblyAI ('+de+').'+(org.local?' O motor da VPS fica desligado.':'')
        :motor==='local'?'Em uso: o motor da VPS (Parakeet), de graça. A primeira fala depois de um tempo parado leva uns segundos a mais.'
        :'O ditado ainda não funciona aqui: o motor da VPS não está instalado (receita ditado-local) e não tem chave do AssemblyAI.';
    },
  };
  $('ditado-form').onsubmit=async ev=>{
    ev.preventDefault();const f=ev.target,b=f.querySelector('button[type=submit]'),chave=f.elements.chave.value.trim();
    if(!chave){errorAt('ditado-erro','Cola a chave primeiro.');return;}
    b.disabled=true;b.textContent='Testando…';errorAt('ditado-erro','');
    try{await ditadoCfg.desenhar(await api('/ditado/chave',{method:'POST',body:JSON.stringify({chave})}));f.elements.chave.value='';toast('Chave do AssemblyAI salva: vale pra todo mundo em até 1 minuto.');}
    catch(e){errorAt('ditado-erro',e.message);}finally{b.disabled=false;b.textContent='Testar e salvar';}
  };
  $('ditado-tirar').onclick=async()=>{
    if(!confirm('Tirar a chave do AssemblyAI da organização? O ditado volta pro motor da VPS.'))return;errorAt('ditado-erro','');
    try{await ditadoCfg.desenhar(await api('/ditado/remover',{method:'POST',body:'{}'}));toast('Chave tirada.');}catch(e){errorAt('ditado-erro',e.message);}
  };
  // Configurações › Organização › Atualizações (só nas instalações, config "atualizar", e só admin; atualizacoes.mjs).
  // O gateway grava o pedido e liga o atualizador (root) sem esperar. Enquanto tem pedido aberto, a tela pergunta o
  // estado a cada 3 s; no meio o gateway reinicia, e erro de rede ou 502 quer dizer "reiniciando": segue tentando.
  const atualizacoesCfg=(()=>{
    let timer=null,esperando=false,viuPedido=false,ultimo=null;
    const quando=iso=>{if(!iso)return '';const d=new Date(iso);return isNaN(d)?String(iso):d.toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'short'});};
    const visivel=()=>!$('cfg-atualizacoes').hidden;
    async function ler(){
      let r;
      // com prazo: um pedido que nunca responde (rede, proxy) não pode deixar a tela parada com os botões apagados
      try{r=await fetch('/_ratoeira/api/atualizacoes',{credentials:'same-origin',headers:{'Content-Type':'application/json'},signal:AbortSignal.timeout(15000)});}
      catch{throw Object.assign(new Error('reiniciando'),{reiniciando:true});}
      if(r.status===401){window.top.location.reload();throw new Error('Sua sessão expirou. Recarregando…');}
      if([502,503,504].includes(r.status))throw Object.assign(new Error('reiniciando'),{reiniciando:true});
      let d;try{d=await r.json();}catch{throw Object.assign(new Error('reiniciando'),{reiniciando:true});}
      if(!r.ok)throw new Error(d.error||'Não consegui ler o estado das atualizações.');
      return d;
    }
    // CHANGELOG em markdown simples: parágrafos, listas com "- " e títulos "###"; `código` e **negrito** pelo textoComCodigo
    function mudancas(lista){
      const box=$('atu-mudancas');box.replaceChildren();
      for(const m of lista){
        box.append(node('h3',m.titulo||m.versao));
        let ul=null,par=[];
        const fechaPar=()=>{if(par.length){const p=node('p');p.append(textoComCodigo(par.join(' ')));box.append(p);par=[];}};
        for(const linha of String(m.texto||'').split('\n')){
          const li=linha.match(/^\s*[-*]\s+(.*)$/),tit=linha.match(/^#{3,6}\s+(.*)$/);
          if(li){fechaPar();if(!ul){ul=node('ul');box.append(ul);}const x=node('li');x.append(textoComCodigo(li[1]));ul.append(x);continue;}
          if(ul&&/^\s{2,}\S/.test(linha)&&ul.lastChild){ul.lastChild.append(document.createTextNode(' '),textoComCodigo(linha.trim()));continue;}
          ul=null;
          if(tit){fechaPar();const p=node('p');const b=node('strong');b.append(textoComCodigo(tit[1]));p.append(b);box.append(p);continue;}
          if(!linha.trim()){fechaPar();continue;}
          par.push(linha.trim());
        }
        fechaPar();
      }
      box.hidden=!lista.length;
    }
    // A conta da plataforma ligada a esta Ratoeira (kit/instalador/atualizar, "conectar"): as versões novas só saem com
    // a Comunidade Ratos ativa nela. Sem conexão, as antigas seguem buscando pela chave fixa, até ela sair.
    function conta(e,ocupado){
      const c=e.conexao||{},lic=e.licenca||{},box=$('atu-conta');
      box.hidden=false;
      const esperando=c.estado==='esperando'&&e.pedido?.acao==='conectar';
      const bloq=lic.ok===false;
      box.classList.toggle('bloqueada',bloq);
      $('atu-conta-texto').textContent=esperando?'Esperando o código ser digitado na plataforma (vale 15 minutos).'
        :c.estado==='conectada'?'Conectada a '+(c.email||'uma conta')+'.'+(bloq?' '+(lic.mensagem||'A plataforma não liberou versão nova.'):' As versões novas chegam enquanto a Comunidade Ratos dessa conta estiver ativa.')
        :c.estado==='desconhecida'?'A plataforma não reconhece mais esta Ratoeira. Conecta de novo.'
        :bloq?(lic.mensagem||'A plataforma não liberou versão nova.')
        :'Não conectada. Conecta com a tua conta da plataforma Ratos de IA: é por ela que chegam as versões novas, enquanto a tua Comunidade Ratos estiver ativa.';
      $('atu-codigo').hidden=!esperando;
      if(esperando){const l=$('atu-codigo-link');l.href=c.url||'';l.textContent=String(c.url||'').replace(/\?.*$/,'').replace(/^https?:\/\//,'');$('atu-codigo-valor').textContent=c.codigo||'';}
      const b=$('atu-conectar');b.hidden=esperando||(c.estado==='conectada'&&!bloq);b.disabled=ocupado;
      b.textContent=c.estado==='conectada'||c.estado==='desconhecida'?'Conectar outra conta':'Conectar à plataforma';
    }
    function andando(texto,cls=''){const n=$('atu-andando');n.className='notice atu-andando'+(cls?' '+cls:'');n.textContent=texto||'';n.hidden=!texto;return n;}
    const rotuloPedido=p=>p.acao==='conectar'?'Conectando à plataforma…':p.acao==='verificar'?'Procurando versão nova…':p.acao==='voltar'?'Voltando pra versão anterior…':'Atualizando'+(p.versao?' pra '+p.versao:'')+'…';
    function desenhar(e){
      ultimo=e;
      const d=e.disponivel;
      $('atu-noar').textContent=e.noAr?.versao||'sem registro';
      $('atu-noar-desde').textContent=e.noAr?.em?'desde '+quando(e.noAr.em):'';
      $('atu-canal').textContent=e.canal||'—';
      $('atu-verificado').textContent=e.verificadoEm?'verificado em '+quando(e.verificadoEm):'nunca verificado';
      $('atu-disp').textContent=d?.versao||'—';
      const chip=$('atu-disp-chip');chip.hidden=!d?.versao;chip.className='chip'+(d?.nova?' forte':' ok');chip.textContent=d?.nova?'nova':'em dia';
      mudancas(d?.nova?d.mudancas||[]:[]);
      const ocupado=Boolean(e.pedido);
      conta(e,ocupado);
      const aplicar=$('atu-aplicar');aplicar.hidden=!d?.nova;aplicar.textContent='Atualizar pra '+(d?.versao||'');aplicar.disabled=ocupado;
      const voltar=$('atu-voltar');voltar.hidden=!e.anterior?.versao;voltar.disabled=ocupado;
      $('atu-verificar').disabled=ocupado;
      // a última tentativa: o resultado do último pedido do gateway ou a última atualização, a mais nova das duas
      const t=[e.resultado,e.ultima].filter(Boolean).sort((a,b)=>String(b.em||'').localeCompare(String(a.em||'')))[0]||null;
      const log=$('atu-log');log.hidden=!t?.log?.length;
      if(t){$('atu-log-titulo').textContent='Log da última tentativa ('+(t.acao||'?')+(t.versao?' '+t.versao:'')+', '+(t.ok?'ok':'falhou')+(t.em?', '+quando(t.em):'')+')';$('atu-log-texto').textContent=(t.log||[]).join('\n');}
      errorAt('atu-erro',!ocupado&&t&&!t.ok?'A última tentativa falhou: '+(t.erro||'veja o log')+'.':'');
      if(ocupado)andando(rotuloPedido(e.pedido)+' Desde '+quando(e.pedido.desde)+'.');
      else if(!viuPedido&&!esperando)andando('');
    }
    function terminou(e){
      viuPedido=false;esperando=false;
      const t=e.resultado;
      if(!t){andando('');return;}
      if(!t.ok){andando('Não deu: '+(t.erro||'veja o log')+'.','erro');return;}
      if(t.acao==='verificar'){andando('');toast(e.disponivel?.nova?'Tem versão nova: '+e.disponivel.versao+'.':'A Ratoeira está em dia.');return;}
      if(t.acao==='conectar'){andando('');toast('Ratoeira conectada a '+(e.conexao?.email||'tua conta')+'.');return;}
      const n=andando('Ratoeira '+(e.noAr?.versao||'')+' no ar. Recarrega a página pra pegar as telas novas. ','ok');
      const b=node('button','Recarregar');b.type='button';b.onclick=()=>location.reload();n.append(b);
    }
    function agendar(){clearTimeout(timer);timer=setTimeout(passo,3000);}
    async function passo(){
      timer=null;
      if(!visivel())return;
      try{
        const e=await ler();
        desenhar(e);
        if(e.pedido){viuPedido=true;esperando=false;agendar();return;}
        // logo depois de pedir, o pedido pode ainda não ter aparecido (ou já ter acabado, no "verificar" rápido)
        if(viuPedido||esperando){terminou(e);return;}
      }catch(err){
        if(err.reiniciando&&(viuPedido||esperando)){andando('A Ratoeira está reiniciando… sigo tentando.');agendar();return;}
        // qualquer outro erro: para de esperar e devolve os botões, senão a tela fica apagada até recarregar
        viuPedido=false;esperando=false;andando('');if(ultimo)desenhar({...ultimo,pedido:null});
        errorAt('atu-erro',err.reiniciando?'A Ratoeira não respondeu. Tenta de novo em instantes.':err.message);
      }
    }
    async function pedir(acao,versao){
      errorAt('atu-erro','');
      for(const id of ['atu-aplicar','atu-verificar','atu-voltar','atu-conectar'])$(id).disabled=true;
      try{
        const e=await api('/atualizacoes',{method:'POST',body:JSON.stringify({acao,...(versao?{versao}:{})}),signal:AbortSignal.timeout(20000)});
        esperando=true;viuPedido=Boolean(e.pedido);desenhar(e);
        if(!e.pedido)andando(rotuloPedido({acao,versao}));
        agendar();
      }catch(err){
        // a resposta não veio a tempo, mas o pedido pode ter chegado: segue perguntando o estado, que decide
        if(err?.name==='TimeoutError'||err?.name==='AbortError'){esperando=true;andando(rotuloPedido({acao,versao}));agendar();return;}
        errorAt('atu-erro',err.message);if(ultimo)desenhar(ultimo);
      }
    }
    $('atu-verificar').onclick=()=>pedir('verificar');
    $('atu-conectar').onclick=()=>pedir('conectar');
    $('atu-aplicar').onclick=async()=>{
      const v=ultimo?.disponivel?.versao;if(!v)return;
      const ok=await perguntar('Atualizar pra '+v+'?','A troca leva alguns minutos e a Ratoeira reinicia no meio: o chat de todo mundo cai uns segundos e as conversas reconectam sozinhas. Configuração, pessoas, arquivos e apps ficam como estão. Se a versão nova não subir, volta sozinha pra '+(ultimo?.noAr?.versao||'de antes')+'.',[['sim','Atualizar pra '+v,'primary'],['nao','Cancelar']]);
      if(ok==='sim')pedir('aplicar',v);
    };
    $('atu-voltar').onclick=async()=>{
      const v=ultimo?.anterior?.versao;if(!v)return;
      const ok=await perguntar('Voltar pra '+v+'?','Troca a versão no ar ('+(ultimo?.noAr?.versao||'?')+') pela anterior, '+v+', e restaura a configuração de antes da última atualização. A Ratoeira reinicia no meio, por uns segundos.',[['sim','Voltar pra '+v,'primary'],['nao','Cancelar']]);
      if(ok==='sim')pedir('voltar');
    };
    return {
      async carregar(){
        clearTimeout(timer);timer=null;errorAt('atu-erro','');
        try{const e=await ler();desenhar(e);if(e.pedido){viuPedido=true;agendar();}}
        catch(err){errorAt('atu-erro',err.reiniciando?'A Ratoeira não respondeu. Tenta de novo em instantes.':err.message);}
      },
    };
  })();
  // Apps nas áreas (só admin, docs/2026-10-09-publicar-app-sem-sudo.md): os apps com manifesto
  // (apps/<pasta>/ratoeira-app.json) e o estado de cada um. Não tem botão: o agente de quem administra publica
  // sozinho pelo MCP "ratoeira" (publicar_app, server.mjs). Publicando agora, a tela acompanha até terminar.
  const publicando=new Set();
  async function renderPublicar(){
    const box=$('apps-publicar');
    if(!state.portal.podePublicar){box.hidden=true;return;}
    let apps;
    try{apps=(await api('/publicar')).apps;}
    catch(e){box.hidden=false;box.replaceChildren(node('h2','Apps nas áreas','secao'),node('p',e.message,'error-text'));return;}
    const grid=node('div',undefined,'apps-grid');
    for(const a of apps){
      const u=a.ultimo||{},rodando=u.estado==='publicando'||publicando.has(a.nome);
      const card=node('div',undefined,'app-card'),main=node('div',undefined,'pub-main'),txt=node('span',undefined,'app-txt');
      const situacao=a.naConfigPrincipal?'Publicado à mão (config principal do gateway).':rodando?'Publicando…':u.estado==='erro'?'Falhou: '+(u.erro||'veja o log.')
        :a.noAr?'No ar'+(a.versao?' · '+a.versao.split(' ')[0]:'')+'.':'Ainda não publicado.';
      txt.append(node('strong',a.titulo),node('span',situacao));main.append(appIcon(a.titulo),txt);
      const meta=node('div',undefined,'app-meta');meta.append(node('code','/'+a.nome+'/ · '+a.areaNome));
      card.append(main);
      if(u.faltamChaves?.length)card.append(node('p','Faltam chaves: '+u.faltamChaves.join(', ')+'. Quem administra pede pro agente gravar (ferramenta definir_chaves_app).','muted'));
      if(u.log?.length&&!rodando){const d=node('details',undefined,'achados');d.append(node('summary',u.estado==='erro'?'Ver o log da tentativa':'Ver o log da última publicação'),node('pre',u.log.join('\n'),'pub-log'));card.append(d);}
      card.append(meta);grid.append(card);
      if(rodando&&!publicando.has(a.nome)){publicando.add(a.nome);acompanhar(a);}
    }
    if(!apps.length)grid.append(node('p','Nenhum app com manifesto nas áreas. Crie com o agente (APPS.md) e ele aparece aqui.','muted'));
    box.hidden=false;
    box.replaceChildren(node('h2','Apps nas áreas','secao'),node('p','O agente de quem administra publica sozinho quando termina de criar ou mudar um app. Pra publicar de novo, peça no chat. Quem acessa cada um tu define em Pessoas.','muted secao-p'),grid);
  }
  async function acompanhar(a){
    for(;;){
      await new Promise(r=>setTimeout(r,3000));
      let e;try{e=(await api('/publicar/'+a.nome)).estado;}catch{continue;}
      if(e?.estado==='publicando')continue;
      publicando.delete(a.nome);
      if(e?.estado==='ok'){
        try{state.portal.systemApps=(await api('/portal')).systemApps||[];}catch{}
        toast(a.titulo+' no ar.');renderApps();
      }else{toast('Não publiquei '+a.titulo+'. Veja o log no card.');renderPublicar();}
      return;
    }
  }

  // "+" de Apps: conversa nova com um pedido neutro; o agente escolhe entre app completo e página simples
  function criarApp(){window.ratoeiraNovaConversa?.({texto:'Quero criar um app novo na Ratoeira: '});}
  $('app-novo').onclick=criarApp;$('app-criar').onclick=criarApp;
  // ── Início: saudação, aplicações e arquivos. A parte dos agentes (prompt, conversas) é do chat.js. ──
  function inicio(){
    const h=new Date().getHours(),nome=(state.portal.user.name||'').split(/[\s@]/)[0];
    $('home-ola').textContent=(h>=5&&h<12?'Bom dia':h>=12&&h<18?'Boa tarde':'Boa noite')+(nome?', '+nome.charAt(0).toUpperCase()+nome.slice(1):'');
    const tiles=$('home-apps-lista');tiles.replaceChildren();
    const todas=[...(state.portal.systemApps||[]).map(a=>({name:a.name,href:state.portal.files?'#aplicacao:'+a.url:a.url})),...state.portal.apps.map(a=>({name:a.name,href:'#app:'+a.id}))];
    for(const a of todas.slice(0,11)){const t=node('a',undefined,'tile');t.href=a.href;t.append(appIcon(a.name),node('span',a.name));tiles.append(t);}
    const nova=node('a',undefined,'tile');nova.href='#aplicacoes';const ic=node('span',undefined,'appic vazio');ic.setAttribute('aria-hidden','true');ic.append(svg('mais'));nova.append(ic,node('span','Novo'));tiles.append(nova);
    $('home-arquivos').hidden=!state.portal.files;
    if(state.portal.files)files.resumo().then(r=>{
      $('home-sync').textContent=r.sync||'';$('home-sync').classList.toggle('error-text',r.travado);
      const ul=$('home-arquivos-lista');ul.replaceChildren();
      if(!r.recentes.length)ul.append(node('li','Os arquivos que tu abrir aparecem aqui.','vazio'));
      for(const rel of r.recentes.slice(0,4)){const li=node('li'),a=node('a',undefined,'linha');a.href='#arquivos/'+encodePath(rel);const partes=rel.split('/');a.append(svg('arquivo'),node('span',partes.pop(),'t'),node('span',partes.join('/'),'w dir'));a.title=rel;li.append(a);ul.append(li);}
    }).catch(()=>{});
  }
  function toggleForm(show){$('app-form').hidden=!show;$('add-toggle').setAttribute('aria-expanded',String(show));if(show)$('app-form').elements.name.focus();else $('add-toggle').focus();}
  $('add-toggle').onclick=()=>toggleForm($('app-form').hidden);$('add-cancel').onclick=()=>toggleForm(false);
  $('app-form').onsubmit=async event=>{
    event.preventDefault();errorAt('app-error','');const form=event.currentTarget,button=form.querySelector('[type=submit]');
    const values=Object.fromEntries(new FormData(form));Object.keys(values).forEach(k=>values[k]=values[k].trim());
    if(!values.name){errorAt('app-error','Dê um nome pro atalho.');return;}if(!safeURL(values.url)){errorAt('app-error','Use um endereço HTTPS ou uma página em /_ratoeira/pages/.');return;}
    button.disabled=true;button.textContent='Salvando…';try{const app=await post('/apps',values);state.portal.apps.push(app);renderApps();form.reset();toggleForm(false);route();toast('Atalho adicionado.');}catch(error){errorAt('app-error',error.message);}finally{button.disabled=false;button.textContent='Salvar atalho';}
  };
  // ── Conta geral do Claude (modo senha, só admin) ──
  // Estado e uso das contas da organização (Configurações › Organização › Contas de IA)
  function estadoConta(id,ok){const e=$(id);e.className='conta-estado'+(ok?' ok':'');e.replaceChildren(node('i',undefined,'dot'+(ok?' ok':'')),document.createTextNode(ok?'Conectada':'Não conectada'));}
  // quem usa: marcado "geral", ou "opcional" (usa a da organização enquanto não conecta a própria)
  async function usoConta(id){
    const alvo=$(id+'-geral-uso'),lista=await pessoasOrg;alvo.replaceChildren();if(!lista)return;
    const quem=lista.filter(p=>p.estado!=='desativada'&&['geral','opcional'].includes(p.ambiente?.[id]));
    alvo.append(node('span',quem.length?'Marcadas pra usar:':'Ninguém marcado pra usar.'));
    for(const p of quem)alvo.append(node('span',p.nome+(p.ambiente[id]==='opcional'?' · opcional':''),'chip'));
    const a=node('a','Mudar em Pessoas →');a.href='#configuracoes/pessoas';alvo.append(a);
  }
  // Uso de cada conta (5 h e semana), do jeito que o medidor do chat guarda: "5h 12% · semana 8%"
  const usoTexto=l=>l?[l.cinco?'5h '+Math.round(l.cinco.uso*100)+'%':'',l.semana?'semana '+Math.round(l.semana.uso*100)+'%':''].filter(Boolean).join(' · '):'';
  // ── Contas do Claude da organização (modo senha, só admin). Várias desde 10/10/2026: cada uma com nome,
  // validade (token de 1 ano) e quem pode usar (todos os marcados em Pessoas, ou só alguns). ──
  const claudeGeral=(()=>{
    let timer=null,dados=null,editando=null;
    const box=$('claude-geral');
    const fechar=f=>{f.reset();f.hidden=true;};
    for(const f of [$('claude-geral-novo'),$('claude-geral-form')])f.querySelector('[data-fechar]').onclick=()=>fechar(f);
    async function carregar(){
      if(!state.portal.user.isAdmin||!state.portal.user.signOut){box.hidden=true;return;}
      box.hidden=false;
      try{dados=await api('/claude-contas');errorAt('claude-geral-erro','');}catch(e){errorAt('claude-geral-erro',e.message);return;}
      const n=dados.contas.length;estadoConta('claude-geral-estado',n>0);
      $('claude-geral-status').textContent=n?(n===1?'1 conta.':n+' contas.')+' Cada pessoa escolhe qual usar no seletor do chat.':'Sem conta, quem está marcado pra conta da organização fica sem Claude.';
      $('claude-geral-gerar').hidden=!dados.podeGerar;usoConta('claude');
      await desenharLista();desenharFluxo(dados.flow);
    }
    // quem pode usar: só faz sentido escolher entre quem está marcado "geral" ou "opcional" em Pessoas
    const elegiveis=async()=>((await pessoasOrg)||[]).filter(p=>p.estado!=='desativada'&&['geral','opcional'].includes(p.ambiente?.claude));
    async function desenharLista(){
      const alvo=$('claude-contas'),gente=await elegiveis();alvo.replaceChildren();
      for(const c of dados.contas){
        const linha=node('div',undefined,'conta-sub'),topo=node('div',undefined,'conta-sub-topo');
        const ate=new Date(new Date(c.desde).getTime()+365*864e5);
        const quem=c.pessoas?gente.filter(p=>c.pessoas.includes(p.email)).map(p=>p.nome):null;
        const info=node('div',undefined,'conta-sub-txt');info.append(node('strong',c.nome),node('span',[isNaN(ate)?'Token de 1 ano':'Vale até '+ate.toLocaleDateString('pt-BR'),c.pendente?'instalando…':'',quem?'Só: '+(quem.join(', ')||'ninguém'):'Todos os marcados'].filter(Boolean).join(' · '),'muted'));
        const abre=tipo=>{editando=editando===c.id+':'+tipo?null:c.id+':'+tipo;desenharLista();};
        const quemB=node('button','Quem pode usar');quemB.type='button';quemB.onclick=()=>abre('quem');
        const ren=node('button','Renomear');ren.type='button';ren.onclick=()=>abre('nome');
        const rem=node('button','Remover');rem.type='button';rem.onclick=async()=>{rem.closest('details').open=false;
          const q=await perguntar('Remover a conta "'+c.nome+'"?','Quem estava usando ela passa pra próxima conta que pode usar. A conta continua existindo na Anthropic: aqui só sai da lista.',[['sim','Remover','danger'],['nao','Cancelar']],1);
          if(q!=='sim')return;try{await post('/claude-contas/'+c.id+'/remover');carregar();}catch(e){errorAt('claude-geral-erro',e.message);}};
        // Renomear e Remover no ⋯, como nas outras linhas de conta
        const mais=node('details',undefined,'mais'),sm=node('summary',undefined,'ib'),pop=node('div',undefined,'mais-pop');sm.setAttribute('aria-label','Mais opções da conta '+c.nome);sm.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 12h.01M12 12h.01M18 12h.01" stroke-width="3"/></svg>';
        ren.addEventListener('click',()=>{mais.open=false;});pop.append(ren,rem);mais.append(sm,pop);
        const acoes=node('div',undefined,'conta-sub-acoes');acoes.append(quemB,mais);topo.append(info,acoes);linha.append(topo);
        if(editando===c.id+':nome'){
          const f=node('form',undefined,'quem-form'),i=node('input');i.value=c.nome;i.maxLength=60;i.required=true;i.setAttribute('aria-label','Nome da conta');
          const ok=node('button','Salvar','primary');ok.type='submit';const ac=node('div',undefined,'actions');ac.append(ok);f.append(i,ac);
          f.onsubmit=async ev=>{ev.preventDefault();ok.disabled=true;try{dados.contas=(await post('/claude-contas/'+c.id+'/editar',{nome:i.value.trim()})).contas;editando=null;desenharLista();}catch(e){errorAt('claude-geral-erro',e.message);ok.disabled=false;}};
          linha.append(f);setTimeout(()=>i.select());
        }
        if(editando===c.id+':quem'){
          const f=node('form',undefined,'quem-form'),todos=node('label');const tc=node('input');tc.type='checkbox';tc.checked=!c.pessoas;todos.append(tc,document.createTextNode(' Todos os marcados pra conta da organização (e quem for marcado depois)'));f.append(todos);
          const caixas=gente.map(p=>{const l=node('label'),i=node('input');i.type='checkbox';i.value=p.email;i.checked=!c.pessoas||c.pessoas.includes(p.email);i.disabled=!c.pessoas;l.append(i,document.createTextNode(' '+p.nome+(p.ambiente.claude==='opcional'?' · opcional':'')));f.append(l);return i;});
          if(!gente.length)f.append(node('p','Ninguém está marcado pra usar conta da organização. Marque em Pessoas.','muted'));
          tc.onchange=()=>{for(const i of caixas){i.disabled=tc.checked;if(tc.checked)i.checked=true;}};
          const ok=node('button','Salvar','primary');ok.type='submit';const ac=node('div',undefined,'actions');ac.append(ok);f.append(ac);
          f.onsubmit=async ev=>{ev.preventDefault();ok.disabled=true;try{dados.contas=(await post('/claude-contas/'+c.id+'/editar',{pessoas:tc.checked?null:caixas.filter(i=>i.checked).map(i=>i.value)})).contas;editando=null;toast('Salvo. Quem perdeu o acesso deixa de usar quando o chat dela religar.');desenharLista();}catch(e){errorAt('claude-geral-erro',e.message);ok.disabled=false;}};
          linha.append(f);
        }
        alvo.append(linha);
      }
    }
    function desenharFluxo(flow){
      const alvo=$('claude-geral-fluxo');clearTimeout(timer);
      if(!flow||['complete','error','cancelled'].includes(flow.stage)){alvo.replaceChildren(...(flow?.message&&flow.stage!=='cancelled'?[node('p',flow.message,flow.stage==='error'?'error-text':'muted')]:[]));return;}
      // segue perguntando mesmo quando nada mudou (antes parava aqui e a tela ficava em "Preparando")
      timer=setTimeout(async()=>{try{const d=await api('/claude-contas');if(d.flow?.stage==='complete')toast('Conta adicionada.');dados=d;if(['complete','error'].includes(d.flow?.stage))carregar();else desenharFluxo(d.flow);}catch{}},2000);
      if(alvo.dataset.assinatura===JSON.stringify([flow.id,flow.stage,flow.url]))return;
      alvo.dataset.assinatura=JSON.stringify([flow.id,flow.stage,flow.url]);alvo.replaceChildren();
      if(flow.stage==='starting')alvo.append(node('p','Preparando a autorização…','muted'));
      const url=flow.url&&safeURL(flow.url);
      if(url){const a=node('a','Abrir autorização ↗','authorize');a.href=url;a.target='_blank';a.rel='noopener noreferrer';alvo.append(a,node('p','Entre com a conta que vai ser adicionada (se o navegador já está logado em outra, saia antes), autorize e cole o código abaixo.','muted'));}
      if(flow.stage==='code'){const f=node('form'),i=node('input');i.placeholder='Código da página oficial';i.autocomplete='off';i.spellcheck=false;const b=node('button','Enviar código','primary');f.append(i,b);
        f.onsubmit=async ev=>{ev.preventDefault();b.disabled=true;try{desenharFluxo(await post('/claude-contas/flow/'+encodeURIComponent(flow.id)+'/code',{code:i.value.trim()}));}catch(e){errorAt('claude-geral-erro',e.message);}finally{b.disabled=false;}};alvo.append(f);}
      const c=node('button','Cancelar');c.type='button';c.onclick=async()=>{clearTimeout(timer);await post('/claude-contas/flow/'+encodeURIComponent(flow.id)+'/cancel').catch(()=>{});carregar();};alvo.append(c);
    }
    // Adicionar: primeiro o nome, depois o login oficial (setup-token rodado pelo gateway)
    $('claude-geral-gerar').onclick=()=>{errorAt('claude-geral-erro','');fechar($('claude-geral-form'));const f=$('claude-geral-novo');f.hidden=false;f.elements.nome.focus();};
    $('claude-geral-novo').onsubmit=async ev=>{ev.preventDefault();const f=ev.target;try{$('claude-geral-fluxo').dataset.assinatura='';desenharFluxo(await post('/claude-contas/start',{nome:f.elements.nome.value.trim()}));fechar(f);}catch(e){errorAt('claude-geral-erro',e.message);}};
    $('claude-geral-colar').onclick=ev=>{ev.target.closest('details').open=false;fechar($('claude-geral-novo'));const f=$('claude-geral-form');f.hidden=false;f.elements.nome.focus();};
    $('claude-geral-form').onsubmit=async ev=>{ev.preventDefault();const f=ev.target;try{await post('/claude-contas/token',{nome:f.elements.nome.value.trim(),token:f.elements.token.value.trim()});fechar(f);toast('Conta adicionada.');carregar();}catch(e){errorAt('claude-geral-erro',e.message);}};
    return {carregar};
  })();
  // ── Contas do Codex da organização (modo senha, só admin): login do ChatGPT pelo código de dispositivo. Várias desde
  // 28/10/2026, como as do Claude: nome, conta e plano do login, e quem pode usar. A "geral" de antes é a primeira. ──
  const codexGeral=(()=>{
    let timer=null,dados=null,editando=null;
    const box=$('codex-geral');
    $('codex-geral-novo').querySelector('[data-fechar]').onclick=()=>{$('codex-geral-novo').reset();$('codex-geral-novo').hidden=true;};
    async function carregar(){
      if(!state.portal.user.isAdmin||!state.portal.user.signOut){box.hidden=true;return;}
      try{dados=await api('/codex-contas');errorAt('codex-geral-erro','');}catch(e){box.hidden=false;errorAt('codex-geral-erro',e.message);return;}
      box.hidden=!dados.podeGerar&&!dados.contas.length;
      const n=dados.contas.length;estadoConta('codex-geral-estado',n>0);
      $('codex-geral-status').textContent=n?(n===1?'1 conta.':n+' contas.')+' Cada pessoa escolhe qual usar no seletor do chat.':'Sem conta, só quem conectou a própria usa o Codex.';
      $('codex-geral-gerar').hidden=!dados.podeGerar;usoConta('codex');
      await desenharLista();desenharFluxo(dados.flow);
    }
    const elegiveis=async()=>((await pessoasOrg)||[]).filter(p=>p.estado!=='desativada'&&['geral','opcional'].includes(p.ambiente?.codex));
    async function desenharLista(){
      const alvo=$('codex-contas'),gente=await elegiveis();alvo.replaceChildren();
      for(const c of dados.contas){
        const linha=node('div',undefined,'conta-sub'),topo=node('div',undefined,'conta-sub-topo');
        const quem=c.pessoas?gente.filter(p=>c.pessoas.includes(p.email)).map(p=>p.nome):null;
        const info=node('div',undefined,'conta-sub-txt');
        info.append(node('strong',c.nome),node('span',[c.conta&&c.conta!==c.nome?c.conta:'',c.plano?'Plano '+c.plano:'',c.pendente?'instalando…':'',quem?'Só: '+(quem.join(', ')||'ninguém'):'Todos os marcados'].filter(Boolean).join(' · '),'muted'));
        const abre=tipo=>{editando=editando===c.id+':'+tipo?null:c.id+':'+tipo;desenharLista();};
        const quemB=node('button','Quem pode usar');quemB.type='button';quemB.onclick=()=>abre('quem');
        const ren=node('button','Renomear');ren.type='button';ren.onclick=()=>abre('nome');
        const denovo=node('button','Entrar de novo');denovo.type='button';denovo.hidden=!dados.podeGerar;
        denovo.onclick=async()=>{mais.open=false;errorAt('codex-geral-erro','');try{$('codex-geral-fluxo').dataset.assinatura='';desenharFluxo(await post('/codex-contas/start',{id:c.id}));}catch(e){errorAt('codex-geral-erro',e.message);}};
        const rem=node('button','Remover');rem.type='button';rem.onclick=async()=>{mais.open=false;
          const q=await perguntar('Remover a conta "'+c.nome+'"?','Quem estava usando ela passa pra próxima conta que pode usar. A conta continua existindo na OpenAI: aqui só sai da lista.',[['sim','Remover','danger'],['nao','Cancelar']],1);
          if(q!=='sim')return;try{await post('/codex-contas/'+c.id+'/remover');carregar();}catch(e){errorAt('codex-geral-erro',e.message);}};
        const mais=node('details',undefined,'mais'),sm=node('summary',undefined,'ib'),pop=node('div',undefined,'mais-pop');sm.setAttribute('aria-label','Mais opções da conta '+c.nome);sm.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 12h.01M12 12h.01M18 12h.01" stroke-width="3"/></svg>';
        ren.addEventListener('click',()=>{mais.open=false;});pop.append(ren,denovo,rem);mais.append(sm,pop);
        const acoes=node('div',undefined,'conta-sub-acoes');acoes.append(quemB,mais);topo.append(info,acoes);linha.append(topo);
        if(editando===c.id+':nome'){
          const f=node('form',undefined,'quem-form'),i=node('input');i.value=c.nome;i.maxLength=60;i.required=true;i.setAttribute('aria-label','Nome da conta');
          const ok=node('button','Salvar','primary');ok.type='submit';const ac=node('div',undefined,'actions');ac.append(ok);f.append(i,ac);
          f.onsubmit=async ev=>{ev.preventDefault();ok.disabled=true;try{dados.contas=(await post('/codex-contas/'+c.id+'/editar',{nome:i.value.trim()})).contas;editando=null;desenharLista();}catch(e){errorAt('codex-geral-erro',e.message);ok.disabled=false;}};
          linha.append(f);setTimeout(()=>i.select());
        }
        if(editando===c.id+':quem'){
          const f=node('form',undefined,'quem-form'),todos=node('label');const tc=node('input');tc.type='checkbox';tc.checked=!c.pessoas;todos.append(tc,document.createTextNode(' Todos os marcados pra conta da organização (e quem for marcado depois)'));f.append(todos);
          const caixas=gente.map(p=>{const l=node('label'),i=node('input');i.type='checkbox';i.value=p.email;i.checked=!c.pessoas||c.pessoas.includes(p.email);i.disabled=!c.pessoas;l.append(i,document.createTextNode(' '+p.nome+(p.ambiente.codex==='opcional'?' · opcional':'')));f.append(l);return i;});
          if(!gente.length)f.append(node('p','Ninguém está marcado pra usar conta do Codex da organização. Marque em Pessoas.','muted'));
          tc.onchange=()=>{for(const i of caixas){i.disabled=tc.checked;if(tc.checked)i.checked=true;}};
          const ok=node('button','Salvar','primary');ok.type='submit';const ac=node('div',undefined,'actions');ac.append(ok);f.append(ac);
          f.onsubmit=async ev=>{ev.preventDefault();ok.disabled=true;try{dados.contas=(await post('/codex-contas/'+c.id+'/editar',{pessoas:tc.checked?null:caixas.filter(i=>i.checked).map(i=>i.value)})).contas;editando=null;toast('Salvo. Quem perdeu o acesso deixa de usar quando o chat dela religar.');desenharLista();}catch(e){errorAt('codex-geral-erro',e.message);ok.disabled=false;}};
          linha.append(f);
        }
        alvo.append(linha);
      }
    }
    function desenharFluxo(flow){
      const alvo=$('codex-geral-fluxo');clearTimeout(timer);
      if(!flow||['complete','error','cancelled'].includes(flow.stage)){alvo.replaceChildren(...(flow?.message&&flow.stage!=='cancelled'?[node('p',flow.message,flow.stage==='error'?'error-text':'muted')]:[]));return;}
      timer=setTimeout(async()=>{try{const d=await api('/codex-contas');if(d.flow?.stage==='complete')toast('Conta do Codex conectada.');dados=d;if(['complete','error'].includes(d.flow?.stage))carregar();else desenharFluxo(d.flow);}catch{}},2000);
      if(alvo.dataset.assinatura===JSON.stringify([flow.id,flow.stage,flow.url,flow.deviceCode]))return;
      alvo.dataset.assinatura=JSON.stringify([flow.id,flow.stage,flow.url,flow.deviceCode]);alvo.replaceChildren();
      const url=flow.url&&safeURL(flow.url);
      if(!url)alvo.append(node('p','Preparando a autorização…','muted'));
      else{const a=node('a','Abrir autorização ↗','authorize');a.href=url;a.target='_blank';a.rel='noopener noreferrer';alvo.append(a);
        if(flow.deviceCode)alvo.append(node('p','Use este código na página de autorização:'),node('code',flow.deviceCode,'device-code'));
        alvo.append(node('p','Entre com a conta do ChatGPT que vai ser adicionada (se o navegador já está logado em outra, saia antes) e digite o código lá. Esta tela atualiza sozinha.','muted'));}
      const c=node('button','Cancelar');c.type='button';c.onclick=async()=>{clearTimeout(timer);await post('/codex-contas/flow/'+encodeURIComponent(flow.id)+'/cancel').catch(()=>{});carregar();};alvo.append(c);
    }
    // Adicionar: primeiro o nome (opcional: sem nome fica o e-mail da conta), depois o login oficial
    $('codex-geral-gerar').onclick=()=>{errorAt('codex-geral-erro','');const f=$('codex-geral-novo');f.hidden=false;f.elements.nome.focus();};
    $('codex-geral-novo').onsubmit=async ev=>{ev.preventDefault();const f=ev.target;try{$('codex-geral-fluxo').dataset.assinatura='';desenharFluxo(await post('/codex-contas/start',{nome:f.elements.nome.value.trim()}));f.reset();f.hidden=true;}catch(e){errorAt('codex-geral-erro',e.message);}};
    return {carregar};
  })();
  // ── Padrão do chat (só admin): agente, modelo, esforço e aprovação da conversa nova pra todo mundo ──
  // As opções vêm do agente (chat.js); "O do agente" deixa o campo sem padrão.
  const chatPadrao=(()=>{
    const box=$('chat-padrao'),campos=$('chat-padrao-campos');let agentes=null;
    function select(rotulo,itens,valor,{vazio='O do agente'}={}){
      const l=node('label',rotulo),s=node('select');if(vazio!==null)s.append(new Option(vazio,''));
      for(const i of itens)s.append(new Option(i.label,i.id));s.value=itens.some(i=>i.id===valor)?valor:'';l.append(s);return {l,s};
    }
    async function carregar(){
      const chat=state.portal.chat;
      if(!chat?.podeDefinirPadrao){box.hidden=true;return;}
      box.hidden=false;errorAt('chat-padrao-erro','');
      try{agentes=await window.ratoeiraChatOpcoes?.();if(!agentes?.length)throw new Error('Nenhum agente respondeu.');}
      catch(e){campos.replaceChildren(node('p','Não consegui ler as opções dos agentes: '+(e.message||e),'muted'));agentes=null;return;}
      const p=chat.padrao||{agentes:{}};campos.replaceChildren();
      const grid=node('div',undefined,'form-grid');
      const ag=select('Agente da conversa nova',agentes.map(a=>({id:a.id,label:a.nome})),p.agente||'claude',{vazio:null});grid.append(ag.l);campos.append(grid);
      for(const a of agentes){
        const v=p.agentes?.[a.id]||{},fs=node('fieldset',undefined,'pessoa-apps chat-padrao-agente'),g=node('div',undefined,'form-grid');fs.append(node('legend',a.nome));
        for(const [campo,rotulo,itens] of [['modelo','Modelo',a.modelos],['esforco','Esforço',a.esforcos],['modo','Aprovação',a.modos]]){
          if(!itens.length)continue;const x=select(rotulo,itens,v[campo]);x.s.dataset.agente=a.id;x.s.dataset.campo=campo;g.append(x.l);
        }
        fs.append(g);campos.append(fs);
      }
      ag.s.dataset.campo='agente';
    }
    $('chat-padrao-form').onsubmit=async ev=>{
      ev.preventDefault();if(!agentes)return;const b=ev.target.querySelector('button[type=submit]');b.disabled=true;errorAt('chat-padrao-erro','');
      const corpo={agentes:{}};
      for(const s of campos.querySelectorAll('select')){
        if(s.dataset.campo==='agente'){corpo.agente=s.value;continue;}
        if(s.value)(corpo.agentes[s.dataset.agente]??={})[s.dataset.campo]=s.value;
      }
      try{const r=await post('/chat/padrao',corpo);state.portal.chat.padrao=r;window.ratoeiraChatPadraoSalvo?.(r);toast('Padrão do chat salvo.');}
      catch(e){errorAt('chat-padrao-erro',e.message);}finally{b.disabled=false;}
    };
    return {carregar};
  })();
  function renderProviders(){
    const lista=$('providers'),u=state.portal.user,fluxo=$('login-flow');
    // o quadro do login muda de lugar ao redesenhar, e o navegador solta o foco do campo do código: devolve no fim
    const foco=fluxo.contains(document.activeElement)?document.activeElement:null,sel=foco&&'selectionStart' in foco?[foco.selectionStart,foco.selectionEnd]:null;
    lista.replaceChildren();$('readonly-note').hidden=u.canManageConnections;
    // multiusuário: a conta conectada aqui é só desta pessoa, no ambiente dela
    if(u.ownAccount)$('shared-note').textContent='As contas do Claude e do Codex que os teus agentes usam. Ficam no teu ambiente: só os teus agentes usam.';
    if(!state.providers.length)lista.append(node('p','Nenhuma conta de IA está disponível neste ambiente.','empty'));
    state.providers.forEach(provider=>{
      const modo=provider.id==='claude'?u.claudeModo:provider.id==='codex'?u.codexModo:null,daOrg=modo==='geral'||provider.via==='geral';
      const row=node('article',undefined,'conta-row'),ic=node('span',provider.id==='codex'?'X':(provider.name||'?').slice(0,1),'conta-ic'),txt=node('div',undefined,'conta-txt'),nome=node('div',undefined,'conta-nome');
      ic.setAttribute('aria-hidden','true');
      // A conta que os agentes usam de fato: a própria, a da organização, ou nenhuma (própria vencida conta como nenhuma).
      const vencida=provider.status==='disconnected'&&provider.propria,propria=provider.status==='connected'&&!daOrg;
      const lc=contasDe(provider.id),emUso=lc?.contas.find(c=>c.id===lc.ativa)??null;
      const [rotulo,ok]=!provider.installed?['Não instalado',false]:emUso&&provider.status==='connected'?[emUso.tipo==='propria'?'Padrão: a tua conta':'Padrão: '+emUso.nome,true]
        :propria?['Usando a tua conta',true]:provider.status==='connected'?['Usando a conta da organização',true]
        :vencida?['Login vencido',false]:provider.status==='disconnected'?['Não conectada',false]:['Não deu pra conferir',false];
      const estado=node('span',undefined,'conta-estado'+(ok?' ok':vencida?' alerta':''));estado.append(node('i',undefined,'dot'+(ok?' ok':vencida?' acc':'')),document.createTextNode(rotulo));
      nome.append(node('h3',provider.name),estado);txt.append(nome);
      const linhas=[],volta=provider.geralDisponivel?'Se desconectar, os teus agentes voltam pra conta da organização.':'Se desconectar, os teus agentes ficam sem conta até tu conectar outra.';
      if(propria&&(provider.account||provider.plan))linhas.push([provider.account,provider.plan].filter(Boolean).join(' · '));
      if(modo==='geral')linhas.push('Quem administra esta Ratoeira cuida dela.');
      else if(propria&&!(lc?.ativa&&lc.ativa!=='propria'))linhas.push(volta);
      else if(daOrg)linhas.push('Se conectar a tua, os teus agentes passam a usar a tua.');
      else if(vencida)linhas.push(provider.geralDisponivel?'A tua conta saiu (o login venceu ou foi revogado) e os teus agentes estão sem conta. Reconecta, ou usa a da organização.':'A tua conta saiu (o login venceu ou foi revogado) e os teus agentes estão sem conta. Reconecta pra voltar a usar.');
      else if(provider.message&&provider.status!=='connected')linhas.push(provider.message);
      if(!provider.installed)linhas.push('Precisa ser instalado na VPS.');
      for(const l of linhas)txt.append(node('p',l));
      row.append(ic,txt);
      // Claude com várias contas e outra em uso: os botões de cima mexeriam na "Tua conta", não na que está em uso.
      // Aí cada conta age na própria linha da lista, e conta nova entra por "+ Adicionar outra conta tua".
      const outraEmUso=Boolean(lc?.ativa&&lc.ativa!=='propria');
      if(u.canManageConnections&&provider.installed&&modo!=='geral'&&!outraEmUso){
        const ocupado=state.busy||!terminal(state.flow),acoes=node('div',undefined,'conta-acoes');
        const botao=node('button',daOrg?'Conectar a minha':propria||vencida?'Reconectar':'Conectar',propria?undefined:'primary');
        botao.type='button';botao.disabled=ocupado;botao.onclick=()=>startConnection(provider.id);
        // desconectar só existe com ambiente próprio (o servidor de agentes da pessoa sabe tirar o login)
        if(u.ownAccount&&(propria||vencida)&&!provider.geralFixa){
          const sair=node('button',vencida&&provider.geralDisponivel?'Usar a da organização':'Desconectar');sair.type='button';sair.disabled=ocupado;
          sair.onclick=()=>desconectar(provider,volta);acoes.append(sair);
        }
        acoes.append(botao);row.append(acoes);
      }
      // várias contas do Claude: as que a pessoa pode usar, qual vale agora, e as pessoais dela
      if(provider.id==='claude'&&u.ownAccount&&state.contasClaude)row.append(contasDoClaude());
      // várias contas do Codex (desde 28/10/2026), no mesmo jeito
      if(provider.id==='codex'&&u.ownAccount&&state.contasCodex)row.append(contasDoCodex());
      // o login acontece dentro da linha da conta que a pessoa clicou (o de conta pessoal, na do agente dela)
      if(state.flow&&(state.flow.provider===provider.id||['claude-token','claude-conta'].includes(state.flow.provider)&&provider.id==='claude'||state.flow.provider==='codex-conta'&&provider.id==='codex'))row.append(fluxo);
      lista.append(row);
    });
    if(!fluxo.isConnected)$('cfg-contas').append(fluxo);
    if(foco?.isConnected&&document.activeElement!==foco){foco.focus({preventScroll:true});if(sel)try{foco.setSelectionRange(...sel);}catch{}}
  }
  // Lista de contas do Claude da pessoa (servidor de agentes dela): organização liberadas, pessoais e o login.
  // A escolhida vale pra todas as conversas do Claude dela; o seletor da caixa do chat faz a mesma coisa.
  const TIPO_CONTA={propria:'login',pessoal:'pessoal',org:'organização'};
  async function carregarContasClaude(){
    const [cl,cx]=await Promise.allSettled([api('/connections/claude/contas'),api('/connections/codex/contas')]);
    state.contasClaude=cl.status==='fulfilled'?cl.value:null;state.contasCodex=cx.status==='fulfilled'?cx.value:null;
  }
  const contasDe=agente=>agente==='claude'?state.contasClaude:agente==='codex'?state.contasCodex:null;
  // Contas do Codex da pessoa (desde 28/10/2026): as da organização liberadas, as pessoais (login do ChatGPT pelo código de
  // dispositivo, numa pasta só dela) e o login próprio. Cada conversa pode trocar a sua no seletor da caixa do chat.
  function contasDoCodex(){
    const d=state.contasCodex,box=node('div',undefined,'conta-extra contas-lista'),pode=state.portal.user.canManageConnections;
    if(d.contas.length)box.append(node('p',d.contas.length>1?'A conta padrão é a das conversas novas, do terminal e das rotinas. Cada conversa pode trocar a dela no seletor da caixa do chat, sem mexer nas outras.':'A conta que os teus agentes usam:','muted'));
    for(const c of d.contas){
      const ativa=c.id===d.ativa,linha=node('div',undefined,'conta-sub'+(ativa?' ativa':'')),topo=node('div',undefined,'conta-sub-topo');
      const info=node('div',undefined,'conta-sub-txt');info.append(node('strong',c.nome),node('span',[TIPO_CONTA[c.tipo],usoTexto(c.limites)].filter(Boolean).join(' · '),'muted'));
      const acoes=node('div',undefined,'conta-sub-acoes');
      if(ativa)acoes.append(node('span','Padrão','chip ok'));
      else{const b=node('button','Usar como padrão');b.type='button';
        b.onclick=async()=>{b.disabled=true;try{state.contasCodex=await post('/connections/codex/usar',{conta:c.id});toast('Conversas novas do Codex agora usam '+c.nome+'. As abertas seguem na conta delas.');}catch(e){errorAt('connections-error',e.message);}renderProviders();};acoes.append(b);}
      if(c.tipo==='pessoal'&&pode){const e=node('button','Entrar de novo');e.type='button';e.title='O login venceu ou quer trocar de conta do ChatGPT';
        e.onclick=async()=>{e.disabled=true;errorAt('connections-error','');try{acceptFlow(await post('/connections/codex-conta/start',{id:c.id.slice(8),nome:c.nome}));}catch(err){errorAt('connections-error',err.message);}finally{e.disabled=false;}};acoes.append(e);}
      if(c.tipo==='propria'&&pode){const r=node('button','Remover');r.type='button';
        r.onclick=async()=>{
          if(await perguntar('Remover "Tua conta" do Codex?','O login do ChatGPT sai desta Ratoeira. A conta continua existindo na OpenAI, e as conversas ficam. Dá pra entrar de novo depois.',[['sim','Remover','danger'],['nao','Cancelar']],1)!=='sim')return;
          r.disabled=true;errorAt('connections-error','');
          try{const x=await post('/connections/codex/sair');state.providers=state.providers.map(p=>p.id==='codex'&&x.provider?x.provider:p);await carregarContasClaude();toast('Conta removida.');}
          catch(e){errorAt('connections-error',e.message);}renderProviders();};acoes.append(r);}
      if(c.tipo==='pessoal'&&pode){const r=node('button','Remover');r.type='button';r.onclick=async()=>{
        if(await perguntar('Remover a conta "'+c.nome+'"?','O login sai daqui. A conta continua existindo na OpenAI, e as conversas ficam.',[['sim','Remover','danger'],['nao','Cancelar']],1)!=='sim')return;
        try{state.contasCodex=await post('/connections/codex/pessoais/'+c.id.slice(8)+'/remover');}catch(e){errorAt('connections-error',e.message);}renderProviders();};acoes.append(r);}
      topo.append(info,acoes);linha.append(topo);box.append(linha);
    }
    if(d.modo!=='geral'&&pode){
      const add=node('details','','conta-add'),sum=node('summary','+ Adicionar outra conta tua');add.append(sum);
      const f=node('form',undefined,'token-form'),ln=node('label','Nome da conta'),nome=node('input');nome.maxLength=60;nome.placeholder='Ex.: Minha Plus';ln.append(nome);
      const entrar=node('button','Entrar com a conta do ChatGPT','primary');entrar.type='submit';
      const ac=node('div',undefined,'actions');ac.append(entrar);
      f.append(node('p','Pra usar mais de uma conta tua do ChatGPT no Codex. A página de autorização pede um código: entre com a conta que vai ser adicionada (se o navegador já está logado em outra, saia antes).','muted'),ln,ac);
      f.onsubmit=async ev=>{ev.preventDefault();entrar.disabled=true;errorAt('connections-error','');try{acceptFlow(await post('/connections/codex-conta/start',{nome:nome.value.trim()}));}catch(e){errorAt('connections-error',e.message);}finally{entrar.disabled=false;}};
      add.append(f);box.append(add);
    }
    return box;
  }
  function contasDoClaude(){
    const d=state.contasClaude,box=node('div',undefined,'conta-extra contas-lista');
    if(d.contas.length)box.append(node('p',d.contas.length>1?'A conta padrão é a das conversas novas, do terminal e das rotinas. Cada conversa pode trocar a dela no seletor da caixa do chat, sem mexer nas outras.':'A conta que os teus agentes usam:','muted'));
    for(const c of d.contas){
      const ativa=c.id===d.ativa,linha=node('div',undefined,'conta-sub'+(ativa?' ativa':'')),topo=node('div',undefined,'conta-sub-topo');
      // conta por token (as da organização e as pessoais do jeito antigo) só usa o modelo: sem conectores do claude.ai
      const info=node('div',undefined,'conta-sub-txt');info.append(node('strong',c.nome),node('span',[TIPO_CONTA[c.tipo],c.completa===false?'sem conectores do claude.ai':'',usoTexto(c.limites)].filter(Boolean).join(' · '),'muted'));
      const acoes=node('div',undefined,'conta-sub-acoes');
      if(ativa)acoes.append(node('span','Padrão','chip ok'));
      else{const b=node('button','Usar como padrão');b.type='button';b.disabled=!d.podeTrocar;if(!d.podeTrocar)b.title='Tem conversa do Claude respondendo: espere terminar ou pare antes.';
        b.onclick=async()=>{b.disabled=true;try{state.contasClaude=await post('/connections/claude/usar',{conta:c.id});toast('Conversas novas agora usam '+c.nome+'. As abertas seguem na conta delas.');}catch(e){errorAt('connections-error',e.message);}renderProviders();};acoes.append(b);}
      // pessoal do jeito antigo: entrar de novo com o login completo (a conta e a escolha ficam)
      if(c.tipo==='pessoal'&&c.completa===false&&state.portal.user.canManageConnections){const e=node('button','Entrar de novo');e.type='button';e.title='Login completo, com os conectores do claude.ai';
        e.onclick=async()=>{e.disabled=true;errorAt('connections-error','');try{acceptFlow(await post('/connections/claude-conta/start',{id:c.id.slice(8),nome:c.nome}));}catch(err){errorAt('connections-error',err.message);}finally{e.disabled=false;}};acoes.append(e);}
      // o login próprio sai pelo mesmo caminho do Desconectar (os logins de MCP ficam); a escolha cai na próxima da lista
      if(c.tipo==='propria'&&state.portal.user.canManageConnections){const r=node('button','Remover');r.type='button';r.disabled=!d.podeTrocar;if(!d.podeTrocar)r.title='Tem conversa do Claude respondendo: espere terminar ou pare antes.';
        r.onclick=async()=>{
          if(await perguntar('Remover "Tua conta"?','O login do Claude sai desta Ratoeira (os logins de MCP ficam). A conta continua existindo na Anthropic, e as conversas ficam. Dá pra entrar de novo depois.',[['sim','Remover','danger'],['nao','Cancelar']],1)!=='sim')return;
          r.disabled=true;errorAt('connections-error','');
          try{const x=await post('/connections/claude/sair');state.providers=state.providers.map(p=>p.id==='claude'&&x.provider?x.provider:p);await carregarContasClaude();toast(x.religou?'Conta removida.':'Conta removida. Vale quando a conversa que está rodando terminar.');}
          catch(e){errorAt('connections-error',e.message);}renderProviders();};acoes.append(r);}
      if(c.tipo==='pessoal'){const r=node('button','Remover');r.type='button';r.onclick=async()=>{
        if(await perguntar('Remover a conta "'+c.nome+'"?','O login sai daqui. A conta continua existindo na Anthropic, e as conversas ficam.',[['sim','Remover','danger'],['nao','Cancelar']],1)!=='sim')return;
        try{state.contasClaude=await post('/connections/claude/pessoais/'+c.id.slice(8)+'/remover');}catch(e){errorAt('connections-error',e.message);}renderProviders();};acoes.append(r);}
      topo.append(info,acoes);linha.append(topo);box.append(linha);
    }
    // conta pessoal a mais: login completo (pasta de config só dela, com os conectores do claude.ai) ou, colado, um token de 1 ano
    if(d.modo!=='geral'&&state.portal.user.canManageConnections){
      const add=node('details','', 'conta-add'),sum=node('summary','+ Adicionar outra conta tua');add.append(sum);
      const f=node('form',undefined,'token-form'),ln=node('label','Nome da conta'),nome=node('input');nome.maxLength=60;nome.placeholder='Ex.: Minha Max 2';ln.append(nome);
      const entrar=node('button','Entrar com a conta do Claude','primary');entrar.type='button';
      const ac=node('div',undefined,'actions');ac.append(entrar);
      // token do setup-token: o jeito antigo, escondido (a conta fica sem os conectores do claude.ai)
      const tokDet=node('details','','conta-token'),tokSum=node('summary','Tenho um token do claude setup-token (sem conectores)');
      const lt=node('label','Token (começa com sk-ant-oat01-)'),tk=node('input');tk.autocomplete='off';tk.spellcheck=false;lt.append(tk);
      const salvar=node('button','Salvar token');salvar.type='submit';const ac2=node('div',undefined,'actions');ac2.append(salvar);
      tokDet.append(tokSum,lt,ac2);
      f.append(node('p','Pra usar mais de uma conta tua, com os conectores do claude.ai dela. Entre com ela no login oficial (se o navegador já está logado em outra, saia antes).','muted'),ln,ac,tokDet);
      entrar.onclick=async()=>{entrar.disabled=true;errorAt('connections-error','');try{acceptFlow(await post('/connections/claude-conta/start',{nome:nome.value.trim()}));}catch(e){errorAt('connections-error',e.message);}finally{entrar.disabled=false;}};
      f.onsubmit=async ev=>{ev.preventDefault();if(!tk.value.trim())return tk.focus();try{state.contasClaude=await post('/connections/claude/pessoais',{nome:nome.value.trim(),token:tk.value.trim()});toast('Conta adicionada.');}catch(e){errorAt('connections-error',e.message);}renderProviders();};
      add.append(f);box.append(add);
    }
    return box;
  }
  async function refreshConnections(){
    const button=$('refresh-connections');if(button.disabled)return;button.disabled=true;errorAt('connections-error','');
    try{const data=await api('/connections');state.providers=data.providers||[];if(state.portal.user.ownAccount)await carregarContasClaude();renderProviders();$('contas-conferido').textContent='conferido às '+new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});if(!state.flow || terminal(state.flow)){const result=await api('/connections/flow');acceptFlow(result.flow||null);}
      // ambiente desligado por ociosidade: o gateway já mandou ligar; confere de novo sozinho
      if(state.providers.some(p=>p.ligando)&&(state.religando=(state.religando||0)+1)<=6)setTimeout(()=>{if(document.body.dataset.view==='configuracoes'&&!$('cfg-contas').hidden)refreshConnections();},6000);else if(!state.providers.some(p=>p.ligando))state.religando=0;
    }catch(error){errorAt('connections-error',error.message);}finally{button.disabled=false;}
  }
  $('refresh-connections').onclick=refreshConnections;
  async function desconectar(provider,volta){
    const q=await perguntar('Desconectar a tua conta do '+provider.name+'?',volta+' Conversa rodando agora segue na conta atual até terminar.',[['sair','Desconectar','danger'],['cancelar','Cancelar']],1);
    if(q!=='sair')return;
    state.busy=true;renderProviders();errorAt('connections-error','');
    try{const r=await post('/connections/'+encodeURIComponent(provider.id)+'/sair');
      state.providers=state.providers.map(p=>p.id===provider.id&&r.provider?r.provider:p);
      toast(r.religou?'Conta desconectada.':'Conta desconectada. Vale quando a conversa que está rodando terminar.');}
    catch(error){errorAt('connections-error',error.message);}finally{state.busy=false;renderProviders();}
  }
  async function startConnection(provider){state.busy=true;renderProviders();errorAt('connections-error','');try{acceptFlow(await post('/connections/'+encodeURIComponent(provider)+'/start'));}catch(error){errorAt('connections-error',error.message);}finally{state.busy=false;renderProviders();}}
  function acceptFlow(flow){
    // a conferência a cada 2 s devolve o mesmo fluxo: só redesenha as contas quando a etapa muda (redesenhar tirava o foco do código)
    const previous=state.flow;state.flow=flow;clearTimeout(state.timer);$('flow-retry')?.remove();renderFlow();
    if(!previous||!flow||previous.id!==flow.id||previous.stage!==flow.stage||previous.provider!==flow.provider)renderProviders();
    if(!terminal(flow))state.timer=setTimeout(pollFlow,2000);
    if(flow?.stage==='complete'&&previous?.stage!=='complete'){toast('Conta conectada.');refreshConnections();}
  }
  async function pollFlow(){
    if(state.polling)return;state.polling=true;const currentRetry=$('flow-retry');if(currentRetry)currentRetry.disabled=true;
    try{const result=await api('/connections/flow');errorAt('connections-error','');acceptFlow(result.flow||null);}catch(error){errorAt('connections-error',error.message);clearTimeout(state.timer);let retry=$('flow-retry');if(!retry){retry=node('button','Retomar verificação');retry.id='flow-retry';retry.type='button';retry.onclick=()=>pollFlow();$('login-flow').append(retry);}retry.disabled=false;}finally{state.polling=false;}
  }
  function renderFlow(){
    const box=$('login-flow'),flow=state.flow;box.hidden=!flow||!state.portal.user.canManageConnections;if(box.hidden){box.replaceChildren();delete box.dataset.signature;return;}
    // Preserve a code being typed while the server reports the same flow stage.
    const signature=JSON.stringify([flow.id,flow.stage,flow.url,flow.deviceCode,flow.message,flow.expiresAt]);if(box.dataset.signature===signature)return;box.dataset.signature=signature;box.replaceChildren();
    const title=node('h2',({complete:'Conta conectada',error:'Não foi possível conectar',cancelled:'Conexão cancelada'}[flow.stage]) || (['claude-token','claude-conta'].includes(flow.provider)?'Adicionar conta do Claude':flow.provider==='codex-conta'?'Adicionar conta do Codex':'Conectar '+(flow.provider==='claude'?'Claude':'Codex')));title.id='flow-title';box.append(title);
    if(flow.message)box.append(node('p',flow.message));
    if(!terminal(flow)){
      if(flow.stage==='starting')box.append(node('p','Preparando a autorização…'));
      if(flow.deviceCode){box.append(node('p','Use este código na página de autorização:'));box.append(node('code',flow.deviceCode,'device-code'));}
      const authURL=flow.url&&safeURL(flow.url);if(authURL&&new URL(authURL).protocol==='https:'){const link=node('a','Abrir autorização ↗','authorize');link.href=authURL;link.target='_blank';link.rel='noopener noreferrer';box.append(link);box.append(node('p','Conclua a autorização na página oficial e volte para esta aba.'));}
      if(flow.stage==='code'){
        const form=node('form'),label=node('label','Código de autorização'),input=node('input');input.type='text';input.name='code';input.required=true;input.autocomplete='one-time-code';input.spellcheck=false;input.autocapitalize='off';
        // texto comum e código de uso único: campo de senha faz o navegador oferecer a senha salva do site
        for(const a of ['data-1p-ignore','data-lpignore','data-bwignore','data-form-type'])input.setAttribute(a,a==='data-form-type'?'other':'true');input.setAttribute('aria-label','Código de autorização');label.append(input);const button=node('button','Enviar código','primary');button.type='submit';const error=node('p',undefined,'error-text');error.setAttribute('role','alert');form.append(label,button,error);
        form.onsubmit=async event=>{event.preventDefault();const code=input.value.trim();if(!code)return;input.value='';button.disabled=true;try{acceptFlow(await post('/connections/flow/'+encodeURIComponent(flow.id)+'/code',{code}));}catch(err){error.textContent=err.message;}finally{button.disabled=false;}};box.append(form);
      }
      if(flow.expiresAt){const date=new Date(flow.expiresAt);if(!isNaN(date))box.append(node('p','Autorização válida até '+date.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})+'.','muted'));}
      const actions=node('div',undefined,'actions'),cancel=node('button','Cancelar conexão');cancel.type='button';cancel.onclick=async()=>{cancel.disabled=true;try{acceptFlow(await post('/connections/flow/'+encodeURIComponent(flow.id)+'/cancel'));}catch(error){errorAt('connections-error',error.message);cancel.disabled=false;}};actions.append(cancel);box.append(actions);
    }
  }
  window.addEventListener('hashchange',route);
  // Menu da conta (avatar no pé da barra): nome, e-mail e sair.
  // No celular (desde 25/10/2026) o mesmo menu vira a gaveta que o rato abre: Início, Mesa, os apps, Habilidades,
  // Integrações, Automações, Configurações e, no pé, quem é, tema, Reportar e Sair. No computador .eu-mais fica escondido.
  const celular=()=>matchMedia('(max-width:760px)').matches,rato=document.querySelector('.rail-brand');
  function encherGaveta(){
    const lista=$('eu-apps');lista.replaceChildren();
    for(const a of $('app-nav').querySelectorAll(':scope>a')){
      const l=node('a');l.href=a.getAttribute('href');if(a.getAttribute('aria-current'))l.setAttribute('aria-current','page');
      l.append(a.firstChild.cloneNode(true),node('span',a.getAttribute('aria-label')));l.addEventListener('click',()=>eu(false));lista.append(l);
    }
    $('eu-apps-cab').hidden=!lista.children.length;
    $('eu-av').textContent=$('avatar').textContent;
    $('eu-reportar').hidden=$('reportar-abrir').hidden;
  }
  const eu=aberto=>{if(aberto)encherGaveta();$('eu-pop').hidden=!aberto;$('eu-toggle').setAttribute('aria-expanded',String(aberto));rato.setAttribute('aria-expanded',String(aberto&&celular()));};
  $('eu-toggle').onclick=e=>{e.stopPropagation();eu($('eu-pop').hidden);};
  rato.addEventListener('click',e=>{if(!celular())return;e.preventDefault();e.stopPropagation();eu($('eu-pop').hidden);});
  document.querySelectorAll('.eu-mais a').forEach(a=>a.addEventListener('click',()=>eu(false)));
  // o fundo escuro em volta da gaveta é o próprio #eu-pop: tocar nele fecha
  $('eu-pop').addEventListener('click',e=>{if(e.target===$('eu-pop'))eu(false);});
  $('eu-reportar').onclick=()=>{eu(false);$('reportar-abrir').click();};
  $('eu-tema').onclick=()=>$('theme-toggle').click();
  document.addEventListener('pointerdown',e=>{if(!$('eu-pop').hidden&&!$('eu-pop').contains(e.target)&&!$('eu-toggle').contains(e.target)&&!rato.contains(e.target))eu(false);});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('eu-pop').hidden){eu(false);(celular()?rato:$('eu-toggle')).focus();}});
  function currentAgentLink(){try{const url=new URL($('agent-frame').contentWindow.location.href);if(url.origin===location.origin)$('agent-external').href=url.href;}catch{}}
  for(const event of ['pointerenter','focus','click'])$('agent-external').addEventListener(event,currentAgentLink);
  // ── Reportar: o texto da pessoa + print da tela (sem esta janela) + o rastro do navegador (rastro.js) ──
  // O print sai de um desenho da página (modern-screenshot, carregado só no primeiro clique): não pede
  // permissão, mas o que roda dentro de iframe com sandbox pode sair em branco.
  const rep={tipo:'bug',print:null,captura:0,lib:null,pendente:null};
  const dicaReporte={bug:'O que deu errado? O que tu esperava que acontecesse?',sugestao:'O que tu mudaria ou acrescentaria?'};
  function tipoReporte(t){rep.tipo=t;for(const b of document.querySelectorAll('.reporte-tipo button'))b.setAttribute('aria-pressed',String(b.dataset.tipo===t));$('reporte-texto').placeholder=dicaReporte[t];}
  function bibliotecaPrint(){
    if(!rep.lib)rep.lib=new Promise((ok,falha)=>{const s=document.createElement('script');s.src='/_ratoeira/screenshot.js';
      s.onload=()=>window.modernScreenshot?ok(window.modernScreenshot):falha(new Error('biblioteca do print não carregou'));
      s.onerror=()=>{rep.lib=null;falha(new Error('biblioteca do print não carregou'));};document.head.append(s);});
    return rep.lib;
  }
  // Fontes já em data URL: sem isso a biblioteca monta um <style> na página pra ler as fontes, e a CSP do
  // portal (style-src 'self') bloqueia, o que derruba o print inteiro. Mesmas famílias do portal.css.
  const FONTES_PRINT=[['Geist','geist.woff2','woff2','100 900'],['Geist Mono','geist-mono.woff2','woff2','100 900'],['Bricolage','bricolage-400.ttf','truetype','400 500'],['Bricolage','bricolage-800.ttf','truetype','600 900']];
  function fontesPrint(){
    if(!rep.fontes)rep.fontes=Promise.all(FONTES_PRINT.map(async([familia,arq,formato,peso])=>{
      const blob=await (await fetch('/_ratoeira/'+arq)).blob();
      const url=await new Promise((ok,falha)=>{const r=new FileReader();r.onload=()=>ok(r.result);r.onerror=()=>falha(r.error);r.readAsDataURL(blob);});
      return `@font-face{font-family:'${familia}';src:url(${url}) format('${formato}');font-weight:${peso}}`;
    })).then(regras=>regras.join('\n')).catch(err=>{rep.fontes=null;throw err;});
    return rep.fontes;
  }
  async function tirarPrint(){
    const [lib,cssText]=await Promise.all([bibliotecaPrint(),fontesPrint()]);
    // fora do print: a própria janela, o aviso e a dica do botão (que está em hover na hora do clique)
    const recolhida=document.documentElement.dataset.barra==='recolhida';
    const fora=n=>n.id==='reporte'||n.id==='toast'||(recolhida&&n.classList?.contains('tip')&&n.parentElement?.id==='reportar-abrir');
    return lib.domToJpeg(document.documentElement,{quality:.82,scale:Math.min(window.devicePixelRatio||1,1.5),width:innerWidth,height:innerHeight,
      backgroundColor:getComputedStyle(document.body).backgroundColor,timeout:8000,font:{cssText},filter:n=>!fora(n)});
  }
  function semPrint(texto){rep.print=null;$('reporte-print-img').hidden=true;$('reporte-print-img').removeAttribute('src');$('reporte-print-status').hidden=false;$('reporte-print-status').textContent=texto;$('reporte-print-remover').hidden=true;}
  function abrirReporte(){
    const d=$('reporte');if(d.open)return;
    // o estado da tela é o da hora do clique, antes da janela abrir
    rep.contexto=window.__ratoeiraRastro?.contexto()??{};rep.eventos=window.__ratoeiraRastro?.eventos()??[];rep.clicou=new Date().toISOString();
    errorAt('reporte-erro','');tipoReporte(rep.tipo);semPrint('Tirando o print…');
    const id=++rep.captura;
    d.showModal();$('reporte-texto').focus();
    rep.pendente=tirarPrint().then(url=>{if(id!==rep.captura)return;rep.print=url;$('reporte-print-img').src=url;$('reporte-print-img').hidden=false;$('reporte-print-status').hidden=true;$('reporte-print-remover').hidden=false;})
      .catch(err=>{if(id!==rep.captura)return;semPrint('Não deu pra tirar o print. O resto vai normal.');console.warn('print do reporte:',err?.message??err);})
      .finally(()=>{if(id===rep.captura)rep.pendente=null;});
  }
  // fechar guarda o texto (rascunho): só some depois de enviar
  function fecharReporte(){rep.captura++;rep.pendente=null;if($('reporte').open)$('reporte').close();}
  // ── Meus reportes (desde 16/10/2026): o status de cada reporte que a pessoa mandou daqui e o recado da triagem.
  // A lista vem da caixa de entrada (GET /reportes/meus); o aviso no sino (tipo "reporte") abre aqui.
  const NOME_STATUS_REP={novo:'Recebido',aceito:'Na fila',feito:'Resolvido',recusado:'Não vamos fazer'};
  const versaoNum=v=>String(v||'').split(/[.+-]/).slice(0,3).map(n=>parseInt(n,10)||0);
  const temVersao=(minha,alvo)=>{const a=versaoNum(minha),b=versaoNum(alvo);for(let i=0;i<3;i++){if(a[i]!==b[i])return a[i]>b[i];}return true;};
  function modoMeus(on,destaque){
    $('reporte-form').classList.toggle('meus',on);$('reporte-titulo').textContent=on?'Meus reportes':'Reportar';
    $('reporte-meus-abrir').textContent=on?'Novo reporte':'Meus reportes';
    if(on)carregarMeus(destaque);else $('reporte-texto').focus();
  }
  async function carregarMeus(destaque){
    const lista=$('reporte-meus-lista'),st=$('reporte-meus-status');st.hidden=false;st.textContent='Carregando…';lista.replaceChildren();
    let d;try{d=await api('/reportes/meus');}catch(e){st.textContent=e.message;return;}
    if(!d.reportes.length){st.textContent='Tu ainda não mandou nenhum reporte daqui.';return;}
    st.textContent='O que tu mandou e o que a gente fez com cada um.';
    const minha=state.portal?.version;
    lista.replaceChildren(...d.reportes.map(r=>{
      const li=node('li',undefined,r.id===destaque?'destaque':'');
      const topo=node('div',undefined,'rm-topo');
      topo.append(node('span',r.titulo,'rm-titulo'),node('span',NOME_STATUS_REP[r.status]||r.status,'chip'+(r.status==='feito'?' feito':'')),node('span',quandoFoi(r.quando),'rm-quando'));
      li.append(topo);
      if(r.recado)li.append(node('p',r.recado,'rm-recado'));
      if(r.status==='feito'&&r.versao)li.append(node('p','Sai na versão '+r.versao+(minha?(temVersao(minha,r.versao)?'. Já está na tua ('+minha+').':'. A tua é a '+minha+': chega quando atualizar.'):'.'),'rm-versao'));
      return li;
    }));
    lista.querySelector('.destaque')?.scrollIntoView({block:'nearest'});
  }
  window.ratoeiraMeusReportes=id=>{if(!state.portal?.meusReportes)return;if(!$('reporte').open){$('reporte').showModal();}modoMeus(true,id);};
  // de volta pro formulário: fecha e abre de novo, pra o print e o rastro serem da tela (sem a janela)
  $('reporte-meus-abrir').onclick=()=>{if(!$('reporte-form').classList.contains('meus'))return modoMeus(true);$('reporte').close();modoMeus(false);abrirReporte();};
  $('reportar-abrir').onclick=()=>{if($('reporte-form').classList.contains('meus'))modoMeus(false);abrirReporte();};
  for(const b of document.querySelectorAll('.reporte-tipo button'))b.onclick=()=>tipoReporte(b.dataset.tipo);
  $('reporte-fechar').onclick=fecharReporte;$('reporte-cancelar').onclick=fecharReporte;
  $('reporte').addEventListener('close',()=>{rep.captura++;rep.pendente=null;$('reportar-abrir').focus();});
  $('reporte-print-remover').onclick=()=>{rep.captura++;rep.pendente=null;semPrint('Vai sem print.');};
  $('reporte-form').onsubmit=async ev=>{
    ev.preventDefault();const texto=$('reporte-texto').value.trim();
    if(!texto){errorAt('reporte-erro','Escreva o que aconteceu.');$('reporte-texto').focus();return;}
    const enviar=$('reporte-enviar');enviar.disabled=true;enviar.textContent='Enviando…';errorAt('reporte-erro','');
    try{
      if(rep.pendente)await rep.pendente;   // print ainda saindo: espera (ele tem limite de 8 s)
      await post('/reportes',{tipo:rep.tipo,texto,print:rep.print,trace:{...rep.contexto,clicou_em:rep.clicou,enviado_em:new Date().toISOString(),eventos:rep.eventos}});
      $('reporte-texto').value='';fecharReporte();toast('Reporte enviado. Valeu!');
    }catch(err){errorAt('reporte-erro',err.message);}
    finally{enviar.disabled=false;enviar.textContent='Enviar';}
  };
  // Área aberta na Mesa (desde 29/10/2026, reporte 35): quem tem mais de uma troca aqui, sem passar por Pessoas. É só
  // preferência no servidor (a pasta de trabalho muda, a permissão não); a página recarrega pra árvore, chat e
  // terminal abrirem na pasta nova, e as abas de cada área ficam guardadas à parte (grid.js, AREA).
  function montarArea(areas){
    const sel=$('area-sel');sel.hidden=!areas;
    const chave=()=>{try{const a=localStorage.getItem('ratoeira:area');return a&&a!==localStorage.getItem('ratoeira:area-base')?a:'';}catch{return '';}};
    // ficou sem ter o que escolher (saiu de uma área): volta pras abas de sempre
    if(!areas){if(chave()){try{localStorage.removeItem('ratoeira:area');}catch{}location.reload();}return;}
    const antes=chave();
    try{if(!localStorage.getItem('ratoeira:area-base'))localStorage.setItem('ratoeira:area-base',areas.aberta||'');localStorage.setItem('ratoeira:area',areas.aberta||'');}catch{}
    // trocou de área em outro aparelho: recarrega uma vez pra grade pegar as abas desta área
    if(chave()!==antes){location.reload();return;}
    sel.replaceChildren(...areas.lista.map(a=>{const o=document.createElement('option');o.value=a.id;o.textContent='Área: '+a.nome;return o;}));
    sel.value=areas.aberta||'';
    sel.onchange=async()=>{
      const id=sel.value;sel.disabled=true;
      try{await post('/area',{id});try{localStorage.setItem('ratoeira:area',id);}catch{}history.replaceState(null,'',location.pathname+location.search+'#arquivos');location.reload();}
      catch(e){toast(e.message);sel.value=areas.aberta||'';sel.disabled=false;}
    };
  }
  async function init(){try{
    const data=await api('/portal');state.portal=data;data.apps=Array.isArray(data.apps)?data.apps:[];
    $('user-name').textContent=data.user.name||data.user.email;$('eu-rotulo').textContent=data.user.name||data.user.email;$('user-email').textContent=data.user.email||'';$('avatar').textContent=(data.user.name||data.user.email||'R').slice(0,1).toUpperCase();$('pages-directory').textContent=data.pagesDirectory||'Consulte a pasta configurada no servidor';
    montarArea(data.areas);
    // Aba Agentes (o Paseo num iframe, ~20 MB): só no Paseo único do kit 0.1.0. Na nossa o Paseo saiu em 09/10/2026
    // (chat, terminal e Contas de IA vão pelo servidor de agentes) e o portal não manda agentPath.
    // O iframe só carrega na primeira visita à aba e depois fica montado.
    if(data.agentPath){const agentURL=new URL(data.agentPath,location.origin);if(agentURL.origin!==location.origin)throw new Error('O endereço do ambiente de agentes é inválido.');
      $('agent-external').href=agentURL.href;state.agentURL=agentURL.href;}
    // Configurações: a parte da Organização só mostra o que esta pessoa pode mexer
    const cfgOrg={pessoas:data.user.isAdmin,'contas-org':data.user.isAdmin&&data.user.signOut,'padrao-chat':data.chat?.podeDefinirPadrao,playground:data.user.isAdmin&&Boolean(data.playground),ditado:data.user.isAdmin&&Boolean(data.user.signOut)&&Boolean(data.chat),email:data.user.isAdmin&&Boolean(data.user.signOut),'seguranca-org':data.user.isAdmin&&Boolean(data.user.signOut),pastas:data.user.isAdmin&&data.modo==='restrito',atualizacoes:Boolean(data.atualizacoes),enderecos:data.user.isAdmin&&Boolean(data.user.signOut)};
    for(const a of document.querySelectorAll('[data-cfg]'))if(a.dataset.cfg in cfgOrg)a.hidden=!cfgOrg[a.dataset.cfg];
    $('cfg-link-seguranca').hidden=!data.user.signOut;
    $('cfg-org').hidden=!Object.values(cfgOrg).some(Boolean);
    if(data.playground&&data.chat)carregarPublicados();$('reportar-abrir').hidden=!data.reportes;$('reporte-meus-abrir').hidden=!data.meusReportes;
    if(data.meusReportes&&new URLSearchParams(location.search).get('reportes')==='meus'){const q=new URLSearchParams(location.search);q.delete('reportes');history.replaceState(null,'',location.pathname+(q.size?'?'+q:'')+location.hash);setTimeout(()=>window.ratoeiraMeusReportes(),300);}
    // pra onde vai o reporte: o diálogo diz antes de enviar (sem destino conhecido, fica o texto de sempre)
    const destino=data.reportesDestino,oQue='o que tu escreveu, o teu e-mail, o print, a tela aberta, a versão da Ratoeira, os erros recentes do navegador e o log do servidor (a Ratoeira tenta tirar senhas e chaves).';
    if(destino?.envia&&destino.nome)$('reporte-junto').textContent='Vai para '+destino.nome+': '+oQue;
    else if(destino&&!destino.envia)$('reporte-junto').textContent='Fica guardado nesta Ratoeira, pra quem administra ver: '+oQue;
    // sem Paseo único não há aba Agentes: o item some do menu
    if(!data.agents)document.querySelector('[data-nav="agentes"]').hidden=true;
    if(!data.files){document.querySelector('[data-nav="arquivos"]').hidden=true;document.querySelector('[data-nav="habilidades"]').hidden=true;}
    // automações e integrações são do ambiente da pessoa (servidor de agentes): sem chat, somem
    if(!data.chat){document.querySelector('[data-nav="automacoes"]').hidden=true;document.querySelector('[data-nav="integracoes"]').hidden=true;}
    if(data.user.signOut){const sair=document.querySelector('.logout');sair.href=data.user.signOut;sair.onclick=async ev=>{ev.preventDefault();try{await fetch(data.user.signOut,{method:'POST',credentials:'same-origin'});}catch{}location.href='/_ratoeira/entrar';};}
    renderApps();route();
    // chat.js (módulo) espera o portal carregar pra saber se o chat existe e onde está o cliente.
    window.__ratoeiraPortal=data;window.dispatchEvent(new CustomEvent('ratoeira:portal',{detail:data}));
  }catch(error){$('agent-loading').hidden=true;errorAt('global-error',error.message);const retry=node('button','Tentar novamente');retry.onclick=()=>location.reload();$('global-error').append(document.createTextNode(' '),retry);}}
  init();
})();
