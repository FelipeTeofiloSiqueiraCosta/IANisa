// Ponte entre uma aplicação e a Ratoeira (APPS.md, "Tela"). A aplicação carrega em todas as páginas:
//   <script src="/_ratoeira/app.js"></script>
// e ganha window.ratoeira:
//   ratoeira.tela({titulo, detalhe})   diz o que está na tela (vira a etiqueta do chat). Sem chamar, vale o <title>.
//                                       detalhe: o que está aberto por cima (um card, um painel); null quando fecha.
//   ratoeira.chat.nova(texto)          conversa nova no chat da Ratoeira, já com o pedido
//   ratoeira.chat.nova(texto,{enviar:false})  conversa nova com o pedido na caixa, sem mandar (a pessoa edita antes)
//   ratoeira.chat.escrever(texto)      põe o texto na caixa da conversa em uso, sem mandar
//   ratoeira.chat.abrir(agente, sessao, titulo)  abre uma conversa que já existe (da própria pessoa) no chat
//   ratoeira.chat.abrir(agente, sessao, titulo, {texto, enviar})  idem, e escreve o texto na caixa dela depois que abre
//                                      (enviar: true manda; sem, fica na caixa pra pessoa completar)
//   ratoeira.aoTerminar(fn)            o agente terminou de mexer: a tela busca os dados de novo
//   ratoeira.embutido                  true quando a aplicação está numa aba da Ratoeira
// Aberta sozinha (fora da Ratoeira), mostra um botão "Abrir com o chat" que leva pro modo foco
// (só a aplicação e o chat). <html data-ratoeira-sem-botao> esconde o botão.
// Fala com o portal por postMessage, então funciona igual quando cada aplicação tiver endereço próprio.
(()=>{
  if(window.ratoeira)return;
  const ORIGEM=new URL(document.currentScript?.src||location.href).origin;
  const embutido=window.parent!==window;
  const portal=embutido?window.parent:null;
  const endereco=()=>location.pathname+location.search+location.hash;
  const tituloDaPagina=()=>{const t=document.title.split(' · ');return t.length>1?t.slice(0,-1).join(' · '):document.title;};
  const mandar=(tipo,dados={})=>{try{portal?.postMessage({ratoeira:1,tipo,...dados},ORIGEM);}catch{}};
  // Fora da Ratoeira: o modo foco abre a mesma página com o chat do lado (o texto só preenche a caixa, nunca manda)
  const foco=texto=>ORIGEM+'/portal/?foco'+(texto?'&texto='+encodeURIComponent(texto.slice(0,2000)):'')+'#aplicacao:'+endereco();
  const aoTerminar=[];
  let tela={titulo:null,detalhe:null};
  window.addEventListener('message',e=>{
    if(e.origin!==ORIGEM||e.source!==portal||!e.data?.ratoeira)return;
    if(e.data.tipo==='terminou')for(const fn of aoTerminar){try{fn();}catch{}}
  });
  const avisarTela=()=>mandar('tela',{titulo:String(tela.titulo||tituloDaPagina()).slice(0,120),detalhe:tela.detalhe?String(tela.detalhe).slice(0,120):null,endereco:endereco()});
  window.ratoeira={
    embutido,
    tela(t={}){tela={...tela,...t};avisarTela();},
    chat:{
      nova(texto,{enviar=true}={}){if(embutido)mandar('chat',{texto:String(texto||''),enviar:enviar!==false,nova:true});else location.assign(foco(String(texto||'')));},
      escrever(texto){if(embutido)mandar('chat',{texto:String(texto||''),enviar:false});else location.assign(foco(String(texto||'')));},
      abrir(agente,sessao,titulo,{texto='',enviar=false}={}){if(embutido)mandar('abrir',{agente:String(agente||''),sessao:String(sessao||''),titulo:String(titulo||''),texto:String(texto||''),enviar:enviar===true});},
    },
    aoTerminar(fn){if(typeof fn==='function')aoTerminar.push(fn);},
  };
  // "Olá": a página nova se apresenta (o portal esquece a tela da página anterior) e já diz o título
  mandar('ola',{versao:1});avisarTela();
  // endereço que muda sem recarregar (history/hash) também é tela nova
  const antes=history.pushState,antesR=history.replaceState;
  history.pushState=function(...a){const r=antes.apply(this,a);avisarTela();return r;};
  history.replaceState=function(...a){const r=antesR.apply(this,a);avisarTela();return r;};
  window.addEventListener('popstate',avisarTela);window.addEventListener('hashchange',avisarTela);
  // dentro de outra página (aba ou cartão no chat): avisa a altura do conteúdo, pro cartão no chat caber sem rolagem
  if(embutido)addEventListener('DOMContentLoaded',()=>{
    const medir=()=>mandar('altura',{altura:Math.ceil(document.body.getBoundingClientRect().height)});
    medir();try{new ResizeObserver(medir).observe(document.body);}catch{}
  });
  if(!embutido)addEventListener('DOMContentLoaded',()=>{
    if(document.documentElement.hasAttribute('data-ratoeira-sem-botao'))return;
    const b=document.createElement('a');b.href=foco('');b.textContent='Abrir com o chat';b.title='Abrir na Ratoeira, com o chat do lado';
    Object.assign(b.style,{position:'fixed',right:'16px',bottom:'16px',zIndex:2147483000,padding:'9px 14px',borderRadius:'10px',background:'#1f1e1b',color:'#fff',
      font:'500 13px/1.2 system-ui,sans-serif',textDecoration:'none',boxShadow:'0 4px 18px rgba(0,0,0,.18)'});
    document.body.append(b);
  });
})();
