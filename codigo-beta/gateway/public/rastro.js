'use strict';
// Rastro pro botão "Reportar": guarda, só neste navegador e só na memória, os últimos eventos que
// ajudam a debugar (erros de JS, avisos do console, requisições que falharam ou demoraram, quedas
// de WebSocket, navegação e cliques). Carrega antes do portal.js e do chat.js pra pegar tudo.
// Nada sai daqui sozinho: o portal.js lê window.__ratoeiraRastro só quando a pessoa envia um reporte.
(() => {
  const MAX=150,inicio=Date.now(),eventos=[];
  const curto=(v,n=300)=>{let s;try{s=typeof v==='string'?v:v instanceof Error?(v.stack||v.message):JSON.stringify(v);}catch{s=String(v);}return String(s??'').slice(0,n);};
  // URL sem query: parâmetro de URL às vezes leva token
  const semQuery=u=>{try{const x=new URL(u,location.href);return (x.origin===location.origin?'':x.origin)+x.pathname;}catch{return curto(u,120);}};
  function anotar(tipo,dados){eventos.push({t:new Date().toISOString(),tipo,...dados});if(eventos.length>MAX)eventos.shift();}

  addEventListener('error',e=>{
    if(e.target&&e.target!==window&&e.target.tagName)anotar('recurso',{tag:e.target.tagName.toLowerCase(),url:semQuery(e.target.src||e.target.href||'')});
    else anotar('erro',{msg:curto(e.message),onde:semQuery(e.filename||'')+':'+(e.lineno||0)+':'+(e.colno||0),stack:curto(e.error?.stack,1200)});
  },true);
  addEventListener('unhandledrejection',e=>anotar('promessa',{msg:curto(e.reason?.message??e.reason),stack:curto(e.reason?.stack,1200)}));
  for(const nivel of ['error','warn']){
    const orig=console[nivel];
    console[nivel]=function(...args){try{anotar('console.'+nivel,{msg:args.map(a=>curto(a,400)).join(' ').slice(0,800)});}catch{}return orig.apply(this,args);};
  }

  // fetch: guarda o que falhou (status >= 400 ou erro de rede) e o que demorou mais de 5 s
  const fetchOrig=window.fetch;
  window.fetch=async function(input,init){
    const url=semQuery(typeof input==='string'?input:input?.url??''),metodo=(init?.method||input?.method||'GET').toUpperCase(),t0=performance.now();
    try{
      const r=await fetchOrig.apply(this,arguments),ms=Math.round(performance.now()-t0);
      if(!r.ok||ms>5000)anotar('fetch',{metodo,url,status:r.status,ms});
      return r;
    }catch(err){anotar('fetch',{metodo,url,status:0,ms:Math.round(performance.now()-t0),msg:curto(err?.message)});throw err;}
  };

  // WebSocket: abriu, fechou (código e motivo) e erro. O chat e o Paseo vivem disso.
  const WSOrig=window.WebSocket;
  if(WSOrig){
    const WS=function(url,proto){
      const ws=proto===undefined?new WSOrig(url):new WSOrig(url,proto),u=semQuery(url),t0=Date.now();
      ws.addEventListener('open',()=>anotar('ws',{url:u,evento:'abriu'}));
      ws.addEventListener('error',()=>anotar('ws',{url:u,evento:'erro'}));
      ws.addEventListener('close',e=>anotar('ws',{url:u,evento:'fechou',codigo:e.code,motivo:curto(e.reason,120),limpo:e.wasClean,durou_s:Math.round((Date.now()-t0)/1000)}));
      return ws;
    };
    WS.prototype=WSOrig.prototype;
    for(const k of ['CONNECTING','OPEN','CLOSING','CLOSED'])WS[k]=WSOrig[k];
    window.WebSocket=WS;
  }

  addEventListener('hashchange',()=>anotar('navegou',{para:curto(location.hash,160)}));
  addEventListener('online',()=>anotar('rede',{estado:'online'}));
  addEventListener('offline',()=>anotar('rede',{estado:'offline'}));
  document.addEventListener('visibilitychange',()=>anotar('visibilidade',{estado:document.visibilityState}));
  // Cliques: só o rótulo do botão ou link (nunca o que foi digitado)
  document.addEventListener('click',e=>{
    const el=e.target?.closest?.('button,a,[role=tab],[role=button],summary');if(!el)return;
    const rotulo=(el.getAttribute('aria-label')||el.title||el.textContent||'').replace(/\s+/g,' ').trim().slice(0,60);
    anotar('clique',{em:el.tagName.toLowerCase()+(el.id?'#'+el.id:''),rotulo});
  },true);

  window.__ratoeiraRastro={
    eventos:()=>eventos.slice(),
    contexto:()=>({
      url:location.pathname+location.hash,tela:document.title,area:document.body?.dataset.view??null,
      aberto_ha_s:Math.round((Date.now()-inicio)/1000),
      janela:{largura:innerWidth,altura:innerHeight,dpr:devicePixelRatio},
      tema:document.documentElement.dataset.theme,barra:document.documentElement.dataset.barra,
      navegador:navigator.userAgent,brave:navigator.brave?true:undefined,idioma:navigator.language,online:navigator.onLine,
      fuso:Intl.DateTimeFormat().resolvedOptions().timeZone,
      memoria_mb:performance.memory?Math.round(performance.memory.usedJSHeapSize/1048576):undefined,
    }),
  };
})();
