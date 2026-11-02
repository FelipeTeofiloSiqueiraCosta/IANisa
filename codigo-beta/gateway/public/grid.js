'use strict';
// Grade de painéis da área Arquivos: qualquer painel leva abas de arquivo ou de conversa, e a pessoa monta o
// layout arrastando a aba (meio do painel = move; borda = divide naquela direção; borda de fora da grade = divide
// a grade inteira), pelo menu ⋯ do painel
// (recolher, maximizar, fechar) e arrastando o vão entre painéis pra mudar o tamanho.
//
// Como não recarrega nada: os painéis são posicionados soltos dentro de #grade-paineis, e o conteúdo de cada aba
// (o iframe do arquivo, o bloco da conversa) mora numa camada própria (#grade-camada) e só muda de posição e
// tamanho. Mover um iframe de lugar na árvore da página faria o navegador recarregar o arquivo.
//
// Quem usa (portal.js pros arquivos, chat.js pras conversas) entrega cada aba assim:
//   ratoeiraGrid.registrar({id, tipo:'arquivo'|'app'|'conversa'|'nova'|'terminal', titulo, dica, rodando, el, icone?,
//                           barra?():Element|null, acoes?():Element[], aoMostrar?(), aoFechar?(), antesDeFechar?():Promise<bool>, renomear?(nome)}, {painel?, ativar?})
// icone: nome de um ícone daqui (ex.: 'claude', 'codex'); renomear: a aba aceita nome novo (duplo clique ou menu ⋯).
// acoes: botões da aba ativa que vão na própria barra das abas (no lugar de uma segunda barra); no celular viram
// itens do menu ⋯, com o aria-label de cada botão como texto.
//   ratoeiraGrid.atualizar(id,{titulo,dica,rodando})   ·  mostrar(id)  ·  remover(id)  ·  fechar(id)
// O layout fica salvo neste navegador (ratoeira:grade; o de cada espaço, ratoeira:grade:espaco:<id>); ids de aba: 'a:<caminho>', 'p:<endereço da aplicação>', 'c:<conversa>', 't:<terminal>', 'nova'.
window.ratoeiraGrid=(()=>{
  const $=id=>document.getElementById(id);
  const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
  const ICONES={
    conversa:'<path d="M4 5h16v11H9l-5 4z"/>',app:'<rect x="4" y="4" width="6.5" height="6.5" rx="2"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="2"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="2"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="2"/>',arquivo:'<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
    mais:'<circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/>',
    voltar:'<path d="M15 6l-6 6 6 6"/>',terminal:'<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><path d="M7.5 9.5l3 2.5-3 2.5M12.5 15h4"/>',
    // marcas simplificadas dos agentes, pra diferenciar as conversas (não são os logotipos oficiais)
    claude:'<path d="M12 3.5v17M3.5 12h17M6 6l12 12M18 6 6 18" stroke-width="2.6" stroke-linecap="round"/>',
    // Codex = a flor da OpenAI (o GPT), simplificada: o desenho do Codex some em tamanho pequeno
    codex:'<rect x="8.7" y="3" width="6.6" height="18" rx="3.3"/><rect x="8.7" y="3" width="6.6" height="18" rx="3.3" transform="rotate(60 12 12)"/><rect x="8.7" y="3" width="6.6" height="18" rx="3.3" transform="rotate(120 12 12)"/>',
  };
  const icone=n=>{const s=document.createElementNS('http://www.w3.org/2000/svg','svg');s.setAttribute('viewBox','0 0 24 24');s.setAttribute('aria-hidden','true');s.innerHTML=ICONES[n];return s;};
  // Espaços guardados neste navegador: id → quando foi aberto por último. Espaço 14 dias sem abrir some (layout e
  // prontas). O aberto se marca ao carregar e a cada hora em que está na tela, então não some no meio do uso.
  function novoEspaco(){return Date.now().toString(36)+Math.random().toString(36).slice(2,8);}
  function guardarEspacos(){
    const K='ratoeira:espacos',VALE=14*864e5;
    const ler=()=>{try{const v=JSON.parse(localStorage.getItem(K)||'{}');return v&&typeof v==='object'&&!Array.isArray(v)?v:{};}catch{return {};}};
    const marcar=()=>{try{const r=ler();if(ESPACO)r[ESPACO]=Date.now();localStorage.setItem(K,JSON.stringify(r));}catch{}};
    try{
      const r=ler(),agora=Date.now();
      for(const [id,em] of Object.entries(r))if(id!==ESPACO&&!(agora-Number(em)<VALE)){
        localStorage.removeItem('ratoeira:grade:espaco:'+id);localStorage.removeItem('ratoeira:grade:espaco:'+id+':prontas');delete r[id];}
      localStorage.setItem(K,JSON.stringify(r));
    }catch{}
    if(!ESPACO)return;
    marcar();setInterval(()=>{if(document.visibilityState==='visible')marcar();},36e5);
    document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')marcar();});
  }
  // No celular o link do modo foco abre a Mesa normal (com barra e navegação, o link vira aba): lá o foco prendia a
  // pessoa sem saída e a conversa nova cobria o arquivo. Fica no foco só o "Abrir com o chat" (?texto=) e a janela.
  {const q=new URLSearchParams(location.search);
    if(q.has('foco')&&!q.has('texto')&&!q.has('conversa')&&matchMedia('(max-width:760px)').matches){q.delete('foco');const s=q.toString();history.replaceState(null,'',location.pathname+(s?'?'+s:'')+location.hash);}}
  // Espaço (?espaco=<id>, do menu ⋯ "Abrir em nova janela/aba"): uma Mesa à parte, com o layout guardado só dela.
  // Nasce com a conversa de ?conversa= num painel e um painel vazio do lado; depois ?conversa= sai do endereço e
  // recarregar volta o layout do espaço. O link antigo da janela separada (?foco&conversa=) vira um espaço novo.
  {const q=new URLSearchParams(location.search);
    if(q.has('foco')&&q.has('conversa')){q.delete('foco');q.set('espaco',novoEspaco());history.replaceState(null,'',location.pathname+'?'+q+location.hash);}}
  const ESPACO=(()=>{const v=new URLSearchParams(location.search).get('espaco');return /^[a-z0-9]{6,24}$/.test(v||'')?v:null;})();
  const SEMENTE=ESPACO&&new URLSearchParams(location.search).get('conversa');
  if(ESPACO)document.documentElement.dataset.espaco='';
  // modo foco (?foco, ver portal.js): layout guardado à parte, pra não bagunçar o da área Arquivos
  const FOCO=!ESPACO&&new URLSearchParams(location.search).has('foco');if(FOCO)document.documentElement.dataset.foco='';
  // Abas da Mesa por área (desde 29/10/2026): a área que já estava aberta antes da primeira troca segue na chave de
  // sempre (base); as outras ganham a sua. Quem acerta 'ratoeira:area' é o portal.js (montarArea).
  const AREA=(()=>{try{const a=localStorage.getItem('ratoeira:area');return a&&a!==localStorage.getItem('ratoeira:area-base')?a:null;}catch{return null;}})();
  const GAP=8,MIN=170,CHAVE=ESPACO?'ratoeira:grade:espaco:'+ESPACO:FOCO?'ratoeira:grade-foco':'ratoeira:grade'+(AREA?':area:'+AREA:'');
  guardarEspacos();
  const celular=()=>matchMedia('(max-width:760px)').matches;
  // Painel recolhido: vira uma faixa fina com o ícone de cada aba; as abas seguem abertas (a conversa continua
  // rodando). Só recolhe o que está na ponta direita (o próprio painel ou a coluna em que ele está), lado a lado
  // com outro; o conteúdo do meio fica sempre aberto. A ponta esquerda é a árvore, que tem botão próprio.
  // Não fica salvo no navegador: recarregou, volta aberto.
  const FAIXA=44;
  ICONES.recolher='<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M15 4v16M8.5 10l2 2-2 2"/>';
  ICONES.expandir='<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M15 4v16M10.5 10l-2 2 2 2"/>';
  function recolhivel(p){let cur=p;for(let pai=paiDe(cur);pai;cur=pai,pai=paiDe(cur))if(pai.dir==='h'&&pai.filhos.at(-1)===cur&&pai.filhos.some(f=>f!==cur&&!f.recolhido))return cur;return null;}
  function expandirAte(p){for(let cur=p;cur;cur=paiDe(cur))cur.recolhido=false;}
  function recolher(p){
    const n=recolhivel(p);if(!n)return;n.recolhido=true;
    const dentro=paineis(n);if(dentro.some(q=>q.id===foco)){const outro=paineis().find(q=>!dentro.includes(q));if(outro)focar(outro.id);}
    desenhar();
  }

  // ── Estado: árvore de divisões ('d', dir h = lado a lado, v = empilhado) com painéis ('p') nas folhas ──
  let seq=0;const novoId=()=>'p'+(++seq);
  const painel=(abas=[])=>({t:'p',id:novoId(),abas:[...abas],ativa:abas[0]??null});
  let raiz=painel();
  const abas=new Map();               // id → aba registrada
  let foco=raiz.id,historico=[raiz.id],maximizado=null;
  const ganchos={acoes:null,menu:null,aoFocar:null,aoVoltar:null,soltarArquivo:null};
  const dom=new Map();                // painel.id → {raiz,topo,lista,acoes,barra,vazio}
  let rects=new Map(),divisores=[],faixas=new Map();

  const paineis=(n=raiz,out=[])=>{if(n.t==='p')out.push(n);else n.filhos.forEach(f=>paineis(f,out));return out;};
  const acharPainel=id=>paineis().find(p=>p.id===id);
  const painelDaAba=id=>paineis().find(p=>p.abas.includes(id));
  function paiDe(alvo,n=raiz){if(n.t!=='d')return null;for(const f of n.filhos){if(f===alvo)return n;const r=paiDe(alvo,f);if(r)return r;}return null;}
  function substituir(velho,novo){if(raiz===velho){raiz=novo;return;}const p=paiDe(velho);p.filhos[p.filhos.indexOf(velho)]=novo;}

  function focar(id,{avisar=true}={}){
    if(!acharPainel(id))return;
    expandirAte(acharPainel(id));   // painel que ganha foco (conversa nova, aba mostrada) sai da faixa
    foco=id;historico=[id,...historico.filter(x=>x!==id&&acharPainel(x))];
    if(avisar)ganchos.aoFocar?.(abaAtiva());
  }
  const abaAtiva=()=>{const p=acharPainel(foco);return p?.ativa?abas.get(p.ativa)??null:null;};

  // Divide o painel alvo pro lado pedido; o painel novo nasce com a aba (se vier) e ocupa a fração pedida.
  function dividir(alvo,lado,abaId=null,fracao=0.5){
    const novo=painel(abaId?[abaId]:[]);
    const dir=lado==='esq'||lado==='dir'?'h':'v',antes=lado==='esq'||lado==='cima';
    const pai=paiDe(alvo);
    if(pai&&pai.dir===dir){
      const i=pai.filhos.indexOf(alvo),peso=pai.pesos[i];
      pai.pesos[i]=peso*(1-fracao);pai.filhos.splice(antes?i:i+1,0,novo);pai.pesos.splice(antes?i:i+1,0,peso*fracao);
    }else if(alvo===raiz&&raiz.t==='d'&&raiz.dir===dir){
      // borda da grade inteira, com a raiz já nessa direção: entra como mais um filho dela, na ponta
      const soma=raiz.pesos.reduce((a,b)=>a+b,0)||1,peso=soma*fracao/(1-fracao);
      if(antes){raiz.filhos.unshift(novo);raiz.pesos.unshift(peso);}else{raiz.filhos.push(novo);raiz.pesos.push(peso);}
    }else substituir(alvo,{t:'d',dir,filhos:antes?[novo,alvo]:[alvo,novo],pesos:antes?[fracao,1-fracao]:[1-fracao,fracao]});
    return novo;
  }
  function tirarDe(p,id){
    const i=p.abas.indexOf(id);if(i<0)return;p.abas.splice(i,1);
    if(p.ativa===id)p.ativa=p.abas[Math.min(i,p.abas.length-1)]??null;
  }
  // Painel vazio some (menos o último), e a divisão que ficou com um filho só dá lugar a ele.
  function limpar(p){
    if(p.abas.length||raiz===p)return;
    const pai=paiDe(p);if(!pai)return;
    const i=pai.filhos.indexOf(p);pai.filhos.splice(i,1);pai.pesos.splice(i,1);
    if(pai.filhos.length===1)substituir(pai,pai.filhos[0]);
    if(maximizado===p.id)maximizado=null;
    if(foco===p.id)focar(historico.find(x=>x!==p.id&&acharPainel(x))??paineis()[0].id);
  }
  function mover(id,dest,indice=dest.abas.length){
    const orig=painelDaAba(id);
    if(orig===dest){const i=orig.abas.indexOf(id);orig.abas.splice(i,1);if(indice>i)indice--;}
    else if(orig)tirarDe(orig,id);
    dest.abas.splice(Math.max(0,Math.min(indice,dest.abas.length)),0,id);dest.ativa=id;
    if(orig&&orig!==dest)limpar(orig);
    focar(dest.id);
  }

  // Onde abre uma aba nova de cada tipo: no painel mais recente que já tem esse tipo (painel vazio serve pra
  // arquivo); se não tiver, divide. Aplicação abre onde abrem os arquivos. Conversa sem painel de conversa abre à
  // direita, como era o chat.
  const temTipo=(p,tipos)=>p.abas.some(id=>tipos.includes(abas.get(id)?.tipo??(id.startsWith('c:')?'conversa':id.startsWith('t:')?'terminal':id.startsWith('p:')?'app':id==='nova'?'nova':'arquivo')));
  function alvoPara(tipo){
    const ordem=historico.map(acharPainel).filter(Boolean);
    if(tipo==='arquivo'||tipo==='app'){
      const p=ordem.find(p=>!p.abas.length||temTipo(p,['arquivo','app']));if(p)return p;
      return dividir(ordem[0]??paineis()[0],'esq',null,0.6);
    }
    // terminal: junto dos outros terminais; sem nenhum, uma faixa embaixo do painel em uso
    if(tipo==='terminal'){
      const p=ordem.find(p=>temTipo(p,['terminal']));if(p)return p;
      const base=ordem[0]??paineis()[0],h=rects.get(base.id)?.h||800;
      return dividir(base,'baixo',null,Math.min(0.5,Math.max(0.3,280/h)));
    }
    const p=ordem.find(p=>temTipo(p,['conversa','nova']));if(p)return p;
    const vazio=ordem.find(p=>!p.abas.length);if(vazio)return vazio;
    const base=ordem.find(p=>temTipo(p,['arquivo','app']))??ordem[0];
    const w=rects.get(base.id)?.w||1000;
    return dividir(base,'dir',null,Math.min(0.5,Math.max(0.3,440/w)));
  }

  // ── API pros donos das abas ──
  function registrar(aba,{painel:painelId=null,ativar=true,indice=null}={}){
    if(!lido)restaurar();
    abas.set(aba.id,aba);if(prontas.has(aba.id))aba.pronta=true;
    if(aba.el){if(aba.el.parentNode!==$('grade-camada'))$('grade-camada').append(aba.el);aba.el.classList.add('aba-corpo');aba.el.hidden=true;
      if(!aba.el.dataset.naGrade){aba.el.dataset.naGrade='1';aba.el.addEventListener('pointerdown',()=>{const x=abas.get(aba.id);if(x?.segura){x.segura=false;queueMicrotask(desenhar);}const p=painelDaAba(aba.id);if(p&&p.id!==foco){focar(p.id);desenhar();}},true);}}
    let p=painelDaAba(aba.id);
    if(!p){
      p=(painelId&&acharPainel(painelId))||alvoPara(aba.tipo);
      const i=indice??(p.ativa?p.abas.indexOf(p.ativa)+1:p.abas.length);p.abas.splice(i,0,aba.id);
      if(ativar||!p.ativa)p.ativa=aba.id;
    }else if(painelId&&painelId!==p.id&&acharPainel(painelId))mover(aba.id,acharPainel(painelId));
    else if(ativar)p.ativa=aba.id;
    if(ativar)focar(p.id);
    desenhar();
    return p.id;
  }
  // Conversa que termina fora da vista da pessoa fica "pronta" (bolinha verde) até ela abrir a aba.
  function atualizar(id,campos){
    const a=abas.get(id);if(!a)return;const parou=a.rodando&&campos.rodando===false;Object.assign(a,campos);
    if(a.rodando)marcarPronta(a,false);else if(parou&&!naVista(id))marcarPronta(a,true);
    desenhar();
  }
  // As prontas ficam guardadas no navegador, pra sobreviver a recarregar a página.
  const CHAVE_PRONTAS=CHAVE+':prontas';
  const prontas=new Set((()=>{try{const v=JSON.parse(localStorage.getItem(CHAVE_PRONTAS)||'[]');return Array.isArray(v)?v:[];}catch{return [];}})());
  function marcarPronta(a,v){
    a.pronta=v;if(prontas.has(a.id)===v)return;v?prontas.add(a.id):prontas.delete(a.id);
    try{localStorage.setItem(CHAVE_PRONTAS,JSON.stringify([...prontas]));}catch{}
    // a barra de Conversas mostra as prontas em "Não lidas" (desde 28/10/2026)
    window.dispatchEvent(new CustomEvent('ratoeira:pronta',{detail:{id:a.id,pronta:v}}));
  }
  // A pessoa está olhando a aba: janela em primeiro plano, Mesa na tela e a aba ativa num painel aberto.
  const olhando=()=>document.visibilityState==='visible'&&document.hasFocus()&&$('grade-paineis').clientWidth>0;
  function naVista(id){const p=painelDaAba(id);return olhando()&&Boolean(p&&p.ativa===id&&rects.get(p.id));}
  // Conversas esperando a pessoa (resposta nova ou pedido de permissão) vão pro título da página: "(2) Mesa · Ratoeira".
  let noTitulo=0;
  function prefixarTitulo(){const novo=(noTitulo?'('+noTitulo+') ':'')+document.title.replace(/^\(\d+\) /,'');if(document.title!==novo)document.title=novo;}
  function mostrar(id){const p=painelDaAba(id);if(!p)return;p.ativa=id;focar(p.id);desenhar();}
  // Tira a aba da grade (quem é dono do conteúdo decide se apaga o elemento).
  function remover(id){
    const a=abas.get(id);if(a)marcarPronta(a,false);abas.delete(id);if(a?.el)a.el.hidden=true;
    const p=painelDaAba(id);if(p){tirarDe(p,id);limpar(p);}
    if(p&&p.id===foco)ganchos.aoFocar?.(abaAtiva());
    desenhar();
  }
  // Fechar pela interface: avisa o dono e tira.
  // antesDeFechar (ex.: editor com alteração não salva) pode segurar: devolve false e a aba fica.
  async function fechar(id){
    const a=abas.get(id);
    if(a?.antesDeFechar){let ok=true;try{ok=await a.antesDeFechar();}catch{}if(!ok)return false;}
    try{a?.aoFechar?.();}catch{}if(abas.has(id)||painelDaAba(id))remover(id);return true;
  }

  // ── Desenho ──
  function calcular(){
    const box=$('grade-paineis');const W=box.clientWidth,H=box.clientHeight;
    rects=new Map();divisores=[];faixas=new Map();
    if(!W||!H)return;
    const so=maximizado&&acharPainel(maximizado)?maximizado:celular()?foco:null;
    if(so){rects.set(so,{x:0,y:0,w:W,h:H});return;}
    (function rec(n,x,y,w,h){
      if(n.recolhido){faixas.set(n,{x,y,w,h});return;}
      if(n.t==='p'){rects.set(n.id,{x,y,w,h});return;}
      const lado=n.dir==='h',fixo=lado?n.filhos.filter(f=>f.recolhido).length*FAIXA:0;
      const total=(lado?w:h)-GAP*(n.filhos.length-1)-fixo,soma=n.pesos.reduce((a,b,i)=>a+(lado&&n.filhos[i].recolhido?0:b),0)||1;
      let pos=lado?x:y;
      n.filhos.forEach((f,i)=>{
        const tam=lado&&f.recolhido?FAIXA:Math.max(0,total*n.pesos[i]/soma);
        if(lado)rec(f,pos,y,tam,h);else rec(f,x,pos,w,tam);pos+=tam;
        if(i<n.filhos.length-1){if(!f.recolhido&&!n.filhos[i+1].recolhido)divisores.push({no:n,i,lado,total,soma,x:lado?pos:x,y:lado?y:pos,w:lado?GAP:w,h:lado?h:GAP});pos+=GAP;}
      });
    })(raiz,0,0,W,H);
  }
  function domDe(p){
    let d=dom.get(p.id);if(d)return d;
    const raizEl=el('section','painel');raizEl.setAttribute('aria-label','Painel');
    const topo=el('div','painel-topo'),barraAbas=el('div','tabsbar');
    const voltar=el('button','ib so-celular voltar-arvore');voltar.type='button';voltar.setAttribute('aria-label','Voltar à árvore');voltar.append(icone('voltar'));voltar.onclick=()=>ganchos.aoVoltar?.();
    const lista=el('div','tabs');lista.setAttribute('role','tablist');lista.setAttribute('aria-label','Abas do painel');
    const acoes=el('div','painel-acoes');
    lista.addEventListener('scroll',()=>bordasAbas(lista),{passive:true});
    // Roda do mouse (vertical) rola a barra de abas pro lado
    lista.addEventListener('wheel',e=>{if(Math.abs(e.deltaY)>Math.abs(e.deltaX)&&lista.scrollWidth>lista.clientWidth){e.preventDefault();lista.scrollLeft+=e.deltaY;}},{passive:false});
    // Trilho embaixo da barra: mostra que tem mais abas pros lados e quanto da fila está à vista. Clicar ou arrastar nele rola
    const trilho=el('div','tabs-trilho'),pegador=el('b');trilho.append(pegador);trilho.setAttribute('aria-hidden','true');lista._trilho=trilho;
    trilho.addEventListener('pointerdown',e=>{
      e.preventDefault();trilho.setPointerCapture(e.pointerId);trilho.classList.add('arrastando');
      const r=trilho.getBoundingClientRect(),escala=lista.scrollWidth/r.width,p0=pegador.getBoundingClientRect();
      // clique fora do pegador centraliza ele ali; dentro, arrasta de onde pegou
      const meio=e.target===pegador?e.clientX-p0.left:p0.width/2;
      const ir=x=>{lista.scrollLeft=(x-r.left-meio)*escala;};
      if(e.target!==pegador)ir(e.clientX);
      const mover=ev=>ir(ev.clientX),soltar=()=>{trilho.classList.remove('arrastando');trilho.removeEventListener('pointermove',mover);trilho.removeEventListener('pointerup',soltar);trilho.removeEventListener('pointercancel',soltar);};
      trilho.addEventListener('pointermove',mover);trilho.addEventListener('pointerup',soltar);trilho.addEventListener('pointercancel',soltar);
    });
    barraAbas.append(voltar,lista,acoes,trilho);
    const barra=el('div','painel-barra');
    topo.append(barraAbas,barra);
    const vazio=el('div','painel-vazio');
    raizEl.append(topo,vazio);
    raizEl.addEventListener('pointerdown',()=>{if(foco!==p.id){focar(p.id);desenhar();}});
    $('grade-paineis').append(raizEl);
    d={raiz:raizEl,topo,lista,acoes,barra,vazio};dom.set(p.id,d);return d;
  }
  // Esfumado nas pontas e trilho embaixo quando tem aba escondida pra algum lado (as abas não encolhem: a barra rola)
  function bordasAbas(lista){
    const {scrollLeft:x,scrollWidth:w,clientWidth:c}=lista;
    lista.classList.toggle('mais-esq',x>2);lista.classList.toggle('mais-dir',x+c<w-2);
    const t=lista._trilho;if(!t)return;
    const sobra=w>c+2;t.hidden=!sobra;if(!sobra)return;
    Object.assign(t.style,{left:lista.offsetLeft+'px',width:c+'px'});
    Object.assign(t.firstChild.style,{left:(x/w*100)+'%',width:(c/w*100)+'%'});
  }
  // Bolinha da aba: amarela piscando trabalhando, vermelha esperando a pessoa, verde com resposta nova.
  const sinal=a=>a?.espera?' precisa':a?.rodando?' rodando':a?.pronta?' pronta':'';
  function botaoAba(p,id){
    const a=abas.get(id);const caixa=el('div','tab'+(p.ativa===id?' ativa':'')+sinal(a));caixa.dataset.id=id;caixa.draggable=true;
    const abrir=el('button','tab-open');abrir.type='button';abrir.setAttribute('role','tab');abrir.setAttribute('aria-selected',String(p.ativa===id));
    const nomeIcone=a?.icone&&ICONES[a.icone]?a.icone:a?.tipo==='conversa'||a?.tipo==='nova'?'conversa':a?.tipo==='app'?'app':null;
    if(nomeIcone){const ic=icone(nomeIcone);ic.classList.add('ic-'+nomeIcone);abrir.append(ic);}
    abrir.append(el('span',undefined,a?.titulo||'Carregando…'));abrir.title=(a?.dica||a?.titulo||'')+(a?.renomear?' · duplo clique renomeia':'');
    abrir.onclick=()=>mostrar(id);
    if(a?.renomear)abrir.addEventListener('dblclick',e=>{e.preventDefault();renomear(id);});
    const x=el('button','tab-close','×');x.type='button';x.setAttribute('aria-label','Fechar '+(a?.titulo||'aba'));x.onclick=()=>fechar(id);
    caixa.addEventListener('auxclick',e=>{if(e.button===1){e.preventDefault();fechar(id);}});
    // botão direito na aba: ela fica ativa e abre o mesmo menu do ⋯, onde o mouse está (no celular não tem)
    caixa.addEventListener('contextmenu',e=>{if(celular())return;e.preventDefault();p.ativa=id;focar(p.id);desenhar();abrirMenu(p,caixa,{x:e.clientX,y:e.clientY,aba:id});});
    caixa.addEventListener('dragstart',e=>{arrasto={id};e.dataTransfer.effectAllowed='move';try{e.dataTransfer.setData('text/plain',a?.titulo||id);}catch{}document.body.classList.add('arrastando-aba');caixa.classList.add('arrastando');});
    caixa.addEventListener('dragend',fimArrasto);
    caixa.append(abrir,x);return caixa;
  }
  // Renomear no lugar: o nome da aba vira um campo. Enter (ou sair do campo) salva, Esc desiste.
  let editando=null;
  function renomear(id){
    const a=abas.get(id),p=painelDaAba(id);if(!a?.renomear||!p)return;
    if(p.ativa!==id){p.ativa=id;focar(p.id);desenhar();}
    const caixa=[...dom.get(p.id).lista.children].find(t=>t.dataset.id===id);const span=caixa?.querySelector('.tab-open span');if(!span)return;
    editando=id;caixa.draggable=false;caixa.classList.add('editando');
    const campo=el('input','tab-campo');campo.value=a.titulo||'';campo.maxLength=200;campo.setAttribute('aria-label','Nome da conversa');
    span.replaceWith(campo);campo.focus();campo.select();
    let fim=false;
    const terminar=async salvar=>{
      if(fim)return;fim=true;editando=null;const nome=campo.value.trim();
      const q=painelDaAba(id);if(q&&dom.get(q.id))dom.get(q.id).assAbas=null;desenhar();
      if(salvar&&nome!==(a.titulo||''))try{await a.renomear(nome);}catch{}
    };
    campo.addEventListener('keydown',e=>{e.stopPropagation();if(e.key==='Enter'){e.preventDefault();terminar(true);}else if(e.key==='Escape'){e.preventDefault();terminar(false);}});
    campo.addEventListener('blur',()=>terminar(true));
    for(const ev of ['click','pointerdown','dblclick'])campo.addEventListener(ev,e=>e.stopPropagation());
  }
  function desenhar(){
    calcular();
    // "Marcar como não lida" (desde 28/10/2026) na aba que está na tela segura a marca até a pessoa sair dela ou clicar dentro
    for(const a of abas.values())if(a.segura&&!naVista(a.id))a.segura=false;
    if(olhando())for(const p of paineis()){const a=rects.get(p.id)&&p.ativa?abas.get(p.ativa):null;if(a?.pronta&&!a.segura)marcarPronta(a,false);}
    const n=[...abas.values()].filter(a=>a.pronta||a.espera).length;if(n!==noTitulo){noTitulo=n;prefixarTitulo();}
    const vivos=new Set(paineis().map(p=>p.id));
    for(const [id,d] of dom)if(!vivos.has(id)){d.raiz.remove();dom.delete(id);}
    const varios=vivos.size>1;
    for(const p of paineis()){
      const d=domDe(p),r=rects.get(p.id);
      d.raiz.hidden=!r;if(!r)continue;
      Object.assign(d.raiz.style,{left:r.x+'px',top:r.y+'px',width:r.w+'px',height:r.h+'px'});
      d.raiz.classList.toggle('foco',varios&&p.id===foco);
      // só refaz abas e botões quando mudou algo neles: refazer no meio de um clique engole o clique
      const assAbas=JSON.stringify([p.ativa,p.abas.map(id=>{const a=abas.get(id);return [id,a?.titulo,a?.dica,sinal(a),a?.icone];})]);
      // com uma aba sendo renomeada, a barra não é refeita (perderia o que está sendo digitado)
      if(d.assAbas!==assAbas&&!(editando&&p.abas.includes(editando))){d.assAbas=assAbas;d.lista.replaceChildren(...p.abas.map(id=>botaoAba(p,id)));
        // a aba ativa sempre à vista: trocar de conversa ou abrir uma nova rola a barra até ela
        if(d.ativaVista!==p.ativa){d.ativaVista=p.ativa;const t=d.lista.querySelector('.tab.ativa');if(t){const l=d.lista,tl=t.offsetLeft-l.offsetLeft;if(tl<l.scrollLeft||tl+t.offsetWidth>l.scrollLeft+l.clientWidth)l.scrollLeft=Math.max(0,tl-(l.clientWidth-t.offsetWidth)/2);}}}
      bordasAbas(d.lista);
      const ativa=p.ativa?abas.get(p.ativa):null,daAba=celular()?[]:ativa?.acoes?.()??[];
      const podeRecolher=!celular()&&Boolean(recolhivel(p)),extras=ganchos.acoes?.(p.id)??[],assAcoes=JSON.stringify([extras.length,celular(),podeRecolher,daAba.length&&p.ativa]);
      if(d.assAcoes!==assAcoes){d.assAcoes=assAcoes;d.acoes.replaceChildren(...daAba,...(daAba.length?[el('span','acoes-sep')]:[]),...extras,...(podeRecolher?[botaoRecolher(p)]:[]),botaoMenu(p));}
      const barra=ativa?.barra?.()??null;
      if(barra){if(d.barra.firstChild!==barra)d.barra.replaceChildren(barra);d.barra.hidden=false;}else{d.barra.replaceChildren();d.barra.hidden=true;}
      d.vazio.hidden=Boolean(ativa?.el);
      if(!d.vazio.hidden&&!d.vazio.childElementCount){d.vazio.append(el('p',undefined,'Painel vazio.'),el('p','muted','Abra um arquivo na árvore ou arraste uma aba pra cá.'));}
    }
    // conteúdo das abas: só a ativa de cada painel visível aparece, por cima do corpo do painel
    const visiveis=new Set();
    for(const p of paineis()){
      const r=rects.get(p.id);if(!r||!p.ativa)continue;const a=abas.get(p.ativa);if(!a?.el)continue;
      const topoH=dom.get(p.id).topo.offsetHeight;
      Object.assign(a.el.style,{left:r.x+'px',top:(r.y+topoH)+'px',width:r.w+'px',height:Math.max(0,r.h-topoH)+'px'});
      visiveis.add(a.id);
      if(a.el.hidden){a.el.hidden=false;try{a.aoMostrar?.();}catch{}}
    }
    for(const a of abas.values())if(a.el&&!visiveis.has(a.id))a.el.hidden=true;
    desenharFaixas();
    desenharDivisores();
    salvar();
    ganchos.aoDesenhar?.();
  }
  let puxando=false;
  function desenharDivisores(){
    const box=$('grade-paineis'),atuais=[...box.querySelectorAll('.grade-divisor')];
    // no meio de um arrasto o divisor não pode ser trocado (perderia o ponteiro): só muda de lugar
    if(puxando&&atuais.length===divisores.length){divisores.forEach((dv,i)=>Object.assign(atuais[i].style,{left:dv.x+'px',top:dv.y+'px',width:dv.w+'px',height:dv.h+'px'}));return;}
    atuais.forEach(d=>d.remove());
    for(const dv of divisores){
      const d=el('div','grade-divisor '+(dv.lado?'lado':'pilha'));d.tabIndex=0;d.setAttribute('role','separator');d.setAttribute('aria-orientation',dv.lado?'vertical':'horizontal');
      d.setAttribute('aria-label','Arrastar pra mudar o tamanho dos painéis (duplo clique iguala)');
      Object.assign(d.style,{left:dv.x+'px',top:dv.y+'px',width:dv.w+'px',height:dv.h+'px'});
      const mudar=px=>{const n=dv.no,soma=dv.soma??n.pesos.reduce((a,b)=>a+b,0),porPx=soma/dv.total,minimo=MIN*porPx,par=n.pesos[dv.i]+n.pesos[dv.i+1];
        let a=n.pesos[dv.i]+px*porPx;a=Math.max(minimo,Math.min(par-minimo,a));n.pesos[dv.i]=a;n.pesos[dv.i+1]=par-a;};
      d.addEventListener('pointerdown',ev=>{
        ev.preventDefault();d.setPointerCapture(ev.pointerId);document.body.classList.add('arrastando');puxando=true;
        const ini=dv.lado?ev.clientX:ev.clientY,base=[...dv.no.pesos];
        const mover_=e=>{dv.no.pesos=[...base];mudar((dv.lado?e.clientX:e.clientY)-ini);desenhar();};
        const soltar=()=>{d.removeEventListener('pointermove',mover_);document.body.classList.remove('arrastando');puxando=false;desenhar();};
        d.addEventListener('pointermove',mover_);d.addEventListener('pointerup',soltar,{once:true});d.addEventListener('pointercancel',soltar,{once:true});
      });
      d.addEventListener('dblclick',()=>{const n=dv.no,par=n.pesos[dv.i]+n.pesos[dv.i+1];n.pesos[dv.i]=n.pesos[dv.i+1]=par/2;desenhar();});
      d.addEventListener('keydown',e=>{const s={ArrowLeft:-1,ArrowRight:1,ArrowUp:-1,ArrowDown:1}[e.key];if(!s)return;e.preventDefault();mudar(s*(e.shiftKey?60:20));desenhar();box.querySelector(`.grade-divisor[data-i="${dv.i}"]`)?.focus();});
      d.dataset.i=String(dv.i);box.append(d);
    }
  }

  // ── Faixa de painel recolhido: botão de abrir e um ícone por aba (clicar abre o painel já nela) ──
  const faixaDom=new Map();   // id do primeiro painel da faixa → elemento
  function desenharFaixas(){
    const vivas=new Set();
    for(const [n,r] of faixas){
      const dentro=paineis(n),chave=dentro[0]?.id;if(!chave)continue;vivas.add(chave);
      let f=faixaDom.get(chave);if(!f){f=el('div','faixa-recolhida');f.setAttribute('role','toolbar');f.setAttribute('aria-label','Painel recolhido');$('grade-paineis').append(f);faixaDom.set(chave,f);}
      Object.assign(f.style,{left:r.x+'px',top:r.y+'px',width:r.w+'px',height:r.h+'px'});
      // só refaz quando as abas mudaram: refazer no meio de um clique engole o clique
      const itens=dentro.flatMap(p=>p.abas.map(id=>[p,id])),ass=JSON.stringify(itens.map(([p,id])=>{const a=abas.get(id);return [id,a?.titulo,sinal(a),a?.icone,p.ativa===id];}));
      if(f.dataset.ass===ass)continue;f.dataset.ass=ass;
      const abrir=el('button','ib');abrir.type='button';abrir.setAttribute('aria-label','Abrir o painel');abrir.title='Abrir o painel';abrir.append(icone('expandir'));
      abrir.onclick=()=>{n.recolhido=false;focar((dentro.find(p=>p.ativa)??dentro[0]).id);desenhar();};
      const lista=el('div','faixa-abas');
      for(const [p,id] of itens){
        const a=abas.get(id),b=el('button','ib faixa-aba'+sinal(a)+(p.ativa===id?' ativa':''));b.type='button';
        const nome=a?.icone&&ICONES[a.icone]?a.icone:a?.tipo==='conversa'||a?.tipo==='nova'?'conversa':a?.tipo==='app'?'app':null;
        if(nome)b.append(icone(nome));else b.append(el('span','faixa-letra',(a?.titulo||'?').slice(0,1).toUpperCase()));
        b.title=a?.titulo||'Aba';b.setAttribute('aria-label','Abrir '+(a?.titulo||'aba'));
        b.onclick=()=>{n.recolhido=false;p.ativa=id;focar(p.id);desenhar();};lista.append(b);
      }
      f.replaceChildren(abrir,lista);
    }
    for(const [chave,f] of faixaDom)if(!vivas.has(chave)){f.remove();faixaDom.delete(chave);}
  }
  function botaoRecolher(p){
    const b=el('button','ib painel-recolher');b.type='button';b.setAttribute('aria-label','Recolher painel');b.title='Recolher painel (as abas continuam abertas)';b.append(icone('recolher'));
    b.onclick=e=>{e.stopPropagation();recolher(p);};return b;
  }

  // ── Menu do painel (⋯, ou botão direito na aba): o que o chat pôs (conversa, terminal), recolher, maximizar, fechar ──
  function botaoMenu(p){
    const b=el('button','ib');b.type='button';b.setAttribute('aria-label','Opções do painel');b.title='Opções do painel';b.setAttribute('aria-haspopup','menu');b.append(icone('mais'));
    b.onclick=e=>{e.stopPropagation();if($('menu-painel')?.dono===b){fecharMenu();return;}abrirMenu(p,b);};return b;
  }
  function abrirMenu(p,botao,noMouse=null){
    fecharMenu();
    const m=el('div','menu-painel');m.setAttribute('role','menu');m.id='menu-painel';m.dono=botao;botao.setAttribute('aria-expanded','true');
    const item=(texto,fn,ativo=true)=>{const i=el('button',undefined,texto);i.type='button';i.setAttribute('role','menuitem');i.disabled=!ativo;i.onclick=()=>{fecharMenu();fn();};m.append(i);};
    const levar=p.abas.length>1?p.ativa:null;
    // o que o chat pôs no menu (no celular, nova conversa, terminal e recentes; no computador, só o terminal)
    const extras=ganchos.menu?.(p.id)??[];
    // no celular, os botões da aba ativa (app: recarregar, copiar link, nova aba) vêm pro menu
    if(celular())for(const b of abas.get(p.ativa)?.acoes?.()??[])item(b.getAttribute('aria-label'),()=>b.click());
    if(m.childElementCount&&extras.length)m.append(el('hr'));
    for(const x of extras)item(x.texto,()=>x.fn(botao));
    if(celular()&&paineis().length>1)item('Outro painel',()=>{const ps=paineis();focar(ps[(ps.findIndex(x=>x.id===foco)+1)%ps.length].id);desenhar();});
    if(m.childElementCount)m.append(el('hr'));
    if(p.ativa&&abas.get(p.ativa)?.renomear)item('Renomear conversa',()=>renomear(p.ativa));
    {const alvo=abas.get(noMouse?.aba??p.ativa);if(alvo?.tipo==='conversa'&&!alvo.rodando&&!alvo.espera)item(alvo.pronta?'Marcar como lida':'Marcar como não lida',()=>alvo.pronta?api.lida(alvo.id):api.naoLida(alvo.id));}
    if(p.ativa&&abas.get(p.ativa)?.copiarLink)item('Copiar link da conversa',()=>abas.get(p.ativa).copiarLink());
    if(p.ativa&&abas.get(p.ativa)?.enviarLink)item('Enviar link da conversa…',()=>abas.get(p.ativa).enviarLink());
    // no celular aparece um painel por vez: recolher e maximizar não teriam efeito visível. Dividir é arrastando a aba.
    if(!celular()&&recolhivel(p))item('Recolher painel',()=>recolher(p));
    if(!celular()&&paineis().length>1)item(maximizado===p.id?'Restaurar painel':'Maximizar painel',()=>{maximizado=maximizado===p.id?null:p.id;focar(p.id);desenhar();});
    if(noMouse?.aba)item('Fechar aba',()=>fechar(noMouse.aba));
    item('Fechar outras abas',async()=>{for(const id of p.abas.filter(x=>x!==p.ativa))if(!await fechar(id))break;},p.abas.length>1);
    if(paineis().length>1)item('Fechar painel',async()=>{for(const id of [...p.abas])if(!await fechar(id))return;const q=acharPainel(p.id);if(q){q.abas=[];limpar(q);}desenhar();});
    const box=$('grade').getBoundingClientRect(),r=botao.getBoundingClientRect();
    $('grade').append(m);
    const x=noMouse?noMouse.x-box.left:r.right-box.left-m.offsetWidth,y=noMouse?noMouse.y-box.top:r.bottom-box.top+4;
    Object.assign(m.style,{top:Math.max(4,Math.min(y,box.height-m.offsetHeight-4))+'px',left:Math.max(4,Math.min(x,box.width-m.offsetWidth-4))+'px'});
    m.querySelector('button:not(:disabled)')?.focus();
  }
  function fecharMenu(){const m=$('menu-painel');m?.dono?.setAttribute('aria-expanded','false');m?.remove();}
  // tocar fora fecha; tocar no próprio ⋯ fica com o clique dele (que fecha), senão fecharia e reabriria
  document.addEventListener('pointerdown',e=>{const m=$('menu-painel');if(m&&!m.contains(e.target)&&!m.dono?.contains(e.target))fecharMenu();});
  document.addEventListener('keydown',e=>{if(e.key==='Escape')fecharMenu();});
  // tocar dentro de um arquivo (iframe) não chega aqui como pointerdown; o foco indo pro iframe tira o da página
  window.addEventListener('blur',()=>setTimeout(()=>{if(document.activeElement?.tagName==='IFRAME')fecharMenu();},0));

  // ── Arrastar: aba (ou arquivo da árvore) pra outro painel, pra borda (divide) ou entre abas (reordena) ──
  // Faixa fina na borda de fora da grade (embaixo, esquerda, direita): divide a grade inteira, e a aba ocupa a
  // largura (ou a altura) toda, por cima de todas as colunas. Em cima não tem: ali ficam as barras de abas.
  let arrasto=null;
  const BORDA=16,FRACAO_TUDO=0.35;
  function bordaDaGrade(x,y,W,H){
    if(paineis().length<2||(maximizado&&acharPainel(maximizado))||celular())return null;
    const lado=y>H-BORDA&&y<=H+BORDA?'baixo':x<BORDA&&x>=-BORDA?'esq':x>W-BORDA&&x<=W+BORDA?'dir':null;
    if(!lado)return null;
    const f=FRACAO_TUDO,caixa={baixo:{x:0,y:H*(1-f),w:W,h:H*f},esq:{x:0,y:0,w:W*f,h:H},dir:{x:W*(1-f),y:0,w:W*f,h:H}}[lado];
    return {p:raiz,modo:lado,tudo:true,caixa};
  }
  function alvoDoArrasto(e){
    const box=$('grade-paineis').getBoundingClientRect(),x=e.clientX-box.left,y=e.clientY-box.top;
    const borda=bordaDaGrade(x,y,box.width,box.height);if(borda)return borda;
    for(const p of paineis()){
      const r=rects.get(p.id);if(!r||x<r.x||x>r.x+r.w||y<r.y||y>r.y+r.h)continue;
      const d=dom.get(p.id),topoH=d.topo.offsetHeight,barraH=d.topo.querySelector('.tabsbar').offsetHeight;
      if(y<r.y+barraH){
        // por cima da barra de abas: entra entre as abas
        const tabs=[...d.lista.children];let i=tabs.findIndex(t=>{const b=t.getBoundingClientRect();return e.clientX<b.left+b.width/2;});if(i<0)i=tabs.length;
        const ref=tabs[i]??tabs[tabs.length-1];const rb=ref?.getBoundingClientRect();
        const xLinha=ref?(i<tabs.length?rb.left:rb.right)-box.left:r.x+12;
        return {p,modo:'entre',indice:i,caixa:{x:xLinha-1,y:r.y+6,w:3,h:barraH-12}};
      }
      const cy=r.y+topoH,ch=r.h-topoH,rx=(x-r.x)/r.w,ry=(y-cy)/Math.max(1,ch);
      const bordas=[['esq',rx],['dir',1-rx],['cima',ry],['baixo',1-ry]].sort((a,b)=>a[1]-b[1]);
      const lado=bordas[0][1]<0.22?bordas[0][0]:'meio';
      const caixa={meio:{x:r.x,y:cy,w:r.w,h:ch},esq:{x:r.x,y:cy,w:r.w/2,h:ch},dir:{x:r.x+r.w/2,y:cy,w:r.w/2,h:ch},cima:{x:r.x,y:cy,w:r.w,h:ch/2},baixo:{x:r.x,y:cy+ch/2,w:r.w,h:ch/2}}[lado];
      return {p,modo:lado,caixa};
    }
    return null;
  }
  function inutil(alvo){
    if(!alvo||!arrasto?.id)return false;const orig=painelDaAba(arrasto.id);
    if(alvo.tudo){
      // a aba já é sozinha a faixa daquela borda: soltar de novo não muda nada
      const dir=alvo.modo==='baixo'?'v':'h',ponta=raiz.t==='d'&&raiz.dir===dir?(alvo.modo==='esq'?raiz.filhos[0]:raiz.filhos.at(-1)):null;
      return ponta===orig&&orig.abas.length===1;
    }
    return alvo.p===orig&&((alvo.modo==='meio')||(alvo.modo!=='entre'&&orig.abas.length===1));
  }
  function fimArrasto(){arrasto=null;document.body.classList.remove('arrastando-aba');$('grade-alvo').hidden=true;document.querySelectorAll('.tab.arrastando').forEach(t=>t.classList.remove('arrastando'));}
  function prepararArrasto(){
    const g=$('grade');
    g.addEventListener('dragover',e=>{
      const externo=!arrasto&&[...(e.dataTransfer?.types||[])].includes('text/x-ratoeira-arquivo');
      if(!arrasto&&!externo)return;
      e.preventDefault();e.dataTransfer.dropEffect=externo?'copy':'move';
      const alvo=alvoDoArrasto(e),caixa=$('grade-alvo');
      if(!alvo||inutil(alvo)){caixa.hidden=true;return;}
      caixa.hidden=false;caixa.className='grade-alvo '+(alvo.modo==='entre'?'linha':alvo.tudo?'area tudo':'area');Object.assign(caixa.style,{left:alvo.caixa.x+'px',top:alvo.caixa.y+'px',width:alvo.caixa.w+'px',height:alvo.caixa.h+'px'});
    });
    g.addEventListener('dragleave',e=>{if(!g.contains(e.relatedTarget))$('grade-alvo').hidden=true;});
    g.addEventListener('drop',e=>{
      const rel=!arrasto?e.dataTransfer?.getData('text/x-ratoeira-arquivo'):null;
      if(!arrasto&&!rel)return;
      e.preventDefault();const alvo=alvoDoArrasto(e);const id=arrasto?.id;fimArrasto();
      if(!alvo)return;
      if(rel){
        const destino=alvo.modo==='meio'||alvo.modo==='entre'?alvo.p:dividir(alvo.p,alvo.modo,null,alvo.tudo?FRACAO_TUDO:0.5);
        focar(destino.id);desenhar();ganchos.soltarArquivo?.(rel,destino.id);return;
      }
      if(inutil({...alvo,p:alvo.p})&&alvo.modo!=='entre')return;
      if(alvo.modo==='entre')mover(id,alvo.p,alvo.indice);
      else if(alvo.modo==='meio')mover(id,alvo.p);
      else{const orig=painelDaAba(id);const novo=dividir(alvo.p,alvo.modo,null,alvo.tudo?FRACAO_TUDO:0.5);mover(id,novo);if(orig)limpar(orig);}
      desenhar();
    });
  }

  // ── Guardar e voltar o layout ──
  // Nada grava antes de o layout salvo ser lido. Antes, abrir o portal na Início desenhava a grade ainda vazia
  // e gravava esse vazio por cima: ao voltar pra área Arquivos, as abas tinham sumido.
  let restaurando=false,lido=false;
  function salvar(){
    if(restaurando||!lido)return;
    const ser=n=>n.t==='p'?{t:'p',abas:n.abas.filter(id=>id!=='nova'),ativa:n.ativa==='nova'?null:n.ativa}:{t:'d',dir:n.dir,pesos:n.pesos,filhos:n.filhos.map(ser)};
    try{localStorage.setItem(CHAVE,JSON.stringify({v:1,raiz:ser(raiz),maximizado:null}));}catch{}
  }
  // Volta a árvore salva com as abas ainda por abrir; devolve os ids na ordem, pros donos registrarem.
  // Lê uma vez só: depois devolve o que está na grade.
  function restaurar(){
    if(lido)return ids();
    lido=true;
    let salvo;try{salvo=JSON.parse(localStorage.getItem(CHAVE)||'null');}catch{}
    if(ESPACO&&SEMENTE){const q=new URLSearchParams(location.search);q.delete('conversa');history.replaceState(null,'',location.pathname+'?'+q+location.hash);}
    // espaço novo: painel vazio (pros arquivos) e a conversa à direita, como na Mesa
    if((!salvo||salvo.v!==1)&&SEMENTE&&/^(cp:[A-Za-z0-9_-]{16,40}|[a-z][a-z0-9-]{0,30}:[A-Za-z0-9_.:-]{1,200})$/.test(SEMENTE)){
      const conv=painel(['c:'+SEMENTE]),vazio=painel();raiz={t:'d',dir:'h',filhos:[vazio,conv],pesos:[0.5,0.5]};foco=conv.id;historico=[conv.id,vazio.id];
      return ['c:'+SEMENTE];
    }
    if(!salvo||salvo.v!==1)return [];
    const ok=id=>typeof id==='string'&&/^(a|c|p|t):./.test(id)&&id.length<2000;
    const ler=(n,prof=0)=>{
      if(!n||prof>8)return null;
      if(n.t==='p'){const ids=Array.isArray(n.abas)?n.abas.filter(ok).slice(0,30):[];if(!ids.length)return null;const p=painel(ids);p.ativa=ids.includes(n.ativa)?n.ativa:ids[0];return p;}
      if(n.t==='d'&&(n.dir==='h'||n.dir==='v')&&Array.isArray(n.filhos)){
        const pares=n.filhos.map((f,i)=>[ler(f,prof+1),Number(n.pesos?.[i])>0?Number(n.pesos[i]):1]).filter(([f])=>f);
        if(!pares.length)return null;if(pares.length===1)return pares[0][0];
        return {t:'d',dir:n.dir,filhos:pares.map(x=>x[0]),pesos:pares.map(x=>x[1])};
      }
      return null;
    };
    const arvore=ler(salvo.raiz);if(!arvore)return [];
    raiz=arvore;foco=paineis()[0].id;historico=paineis().map(p=>p.id);
    return paineis().flatMap(p=>p.abas);
  }
  function ids(){if(!lido)restaurar();return paineis().flatMap(p=>p.abas);}

  function iniciar(){
    prepararArrasto();
    // voltar pra janela conta como ver a aba que está na tela; o título é de várias telas, o prefixo se mantém
    for(const ev of ['focus','visibilitychange'])window.addEventListener(ev,()=>desenhar());
    const tit=document.querySelector('title');if(tit)new MutationObserver(prefixarTitulo).observe(tit,{childList:true});
    new ResizeObserver(()=>{if($('grade-paineis').clientWidth)desenhar();}).observe($('grade-paineis'));
    // Clique dentro de um iframe não chega aqui: quando o foco vai pro iframe, descobre de qual aba ele é.
    window.addEventListener('blur',()=>setTimeout(()=>{const f=document.activeElement;if(f?.tagName!=='IFRAME')return;for(const a of abas.values())if(a.el?.contains(f)){const p=painelDaAba(a.id);if(p&&p.id!==foco){focar(p.id);desenhar();}return;}},0));
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',iniciar,{once:true});else iniciar();

  const api={
    registrar,atualizar,mostrar,remover,fechar,desenhar,restaurar,ids,
    painelDe:id=>painelDaAba(id)?.id??null,
    painelPara:tipo=>alvoPara(tipo).id,
    // painel que pediu, se ele já leva conversa (ou está vazio); senão o painel de conversa de sempre (ou um novo à direita)
    temConversa:id=>{const p=acharPainel(id);return Boolean(p&&temTipo(p,['conversa','nova']));},
    painelDeConversa:id=>{const p=acharPainel(id);return p&&(!p.abas.length||temTipo(p,['conversa','nova']))?p.id:alvoPara('conversa').id;},
    // recolhe o painel (vira faixa fina) pelo id; usado no modo foco pra abrir o chat já recolhido
    recolherPainel:id=>{const p=acharPainel(id);if(p)recolher(p);},
    focado:()=>foco,abaAtiva,celular,espaco:ESPACO,novoEspaco,
    abaAtivaDe:id=>{const p=acharPainel(id);return p?.ativa?abas.get(p.ativa)??null:null;},
    tem:id=>abas.has(id),
    // conversa sem aba aberta também guarda a marca (fica em "prontas" e vale quando a aba abrir)
    pronta:id=>abas.has(id)?Boolean(abas.get(id).pronta):prontas.has(id),
    lida:id=>{const a=abas.get(id)??{id};if(a.pronta||prontas.has(id)){a.segura=false;marcarPronta(a,false);desenhar();}},
    naoLida:id=>{const a=abas.get(id)??{id};a.segura=abas.has(id);marcarPronta(a,true);desenhar();},
    icone:n=>ICONES[n]?icone(n):null,
    // tudo que está aberto, na ordem dos painéis (a lista "Abas" do celular)
    lista:()=>ids().filter(id=>abas.has(id)).map(id=>{const a=abas.get(id);return {id,tipo:a.tipo,titulo:a.titulo||'',dica:a.dica||'',rodando:Boolean(a.rodando),espera:Boolean(a.espera),pronta:Boolean(a.pronta),icone:a.icone??null};}),
    ao:(nome,fn)=>{ganchos[nome]=fn;},
    reiniciarRestauro:v=>{restaurando=v;if(!v)salvar();},
  };
  return api;
})();
