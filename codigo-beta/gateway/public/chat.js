// Chat da área Arquivos: conversas com os agentes (Claude Code, Codex e o que mais o servidor de agentes
// tiver), em abas da grade de painéis (grid.js). Desde 08/10/2026 fala ACP com o servidor de agentes da
// pessoa (agentes/) pelo WebSocket /api/agentes/ws, que o gateway autentica. As conversas
// são as do próprio agente (~/.claude/projects, ~/.codex/sessions): as do terminal aparecem aqui também.
// Este arquivo cuida também da divisória entre a árvore e a grade.
const $=id=>document.getElementById(id);
const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
const toast=t=>window.ratoeiraToast?.(t);
const guardar=(k,v)=>{try{localStorage.setItem(k,JSON.stringify(v));}catch{}};
const ler=(k,padrao)=>{try{const v=JSON.parse(localStorage.getItem(k));return v??padrao;}catch{return padrao;}};

// ── Divisória: árvore | grade ────────────────────────────────────────────────
const G=window.ratoeiraGrid;
const PADRAO={arvore:300};
const larguras={...PADRAO,...ler('ratoeira:larguras',{})};
function aplicarLarguras(){$('files').style.setProperty('--w-arvore',larguras.arvore+'px');}
function limitar(lado,px){const total=$('files').clientWidth;return Math.round(Math.max(180,Math.min(px,total-340)));}
for(const div of document.querySelectorAll('.divisor')){
  const lado=div.dataset.lado;
  div.addEventListener('pointerdown',ev=>{
    ev.preventDefault();div.setPointerCapture(ev.pointerId);document.body.classList.add('arrastando');
    const inicio=ev.clientX,base=larguras[lado];
    const mover=e=>{larguras[lado]=limitar(lado,base+e.clientX-inicio);aplicarLarguras();};
    const soltar=()=>{div.removeEventListener('pointermove',mover);document.body.classList.remove('arrastando');guardar('ratoeira:larguras',larguras);};
    div.addEventListener('pointermove',mover);div.addEventListener('pointerup',soltar,{once:true});div.addEventListener('pointercancel',soltar,{once:true});
  });
  div.addEventListener('dblclick',()=>{larguras[lado]=PADRAO[lado];aplicarLarguras();guardar('ratoeira:larguras',larguras);});
  div.addEventListener('keydown',e=>{const passo=e.shiftKey?60:20;const sinal={ArrowLeft:-1,ArrowRight:1}[e.key];if(!sinal)return;e.preventDefault();larguras[lado]=limitar(lado,larguras[lado]+sinal*passo);aplicarLarguras();guardar('ratoeira:larguras',larguras);});
}
aplicarLarguras();

// ── Estado do chat ───────────────────────────────────────────────────────────
// agentes: [{id, nome}]; opcoes: por agente, as opções que ele aceita (modelo, esforço, modo...), no formato do ACP.
const chat={info:null,md:null,agentes:null,opcoes:{},abas:[],ativa:null};
// Nova conversa repete o último agente/modelo/esforço/permissão usado neste navegador. Sem memória: o que
// o agente diz que é o atual (hoje Opus 5.5 no Claude) e o modo automático, que o servidor já liga.
// A pasta começa sempre na raiz do repo.
// Escolhas de conversa nova (modelo, esforço, modo de aprovação): o que a pessoa mudou (chat.info.minhas)
// por cima do padrão do admin (chat.info.padrao), por cima do que o agente traz. Moram no gateway: valem
// em qualquer navegador, e quem nunca mudou segue o admin mesmo quando ele troca o padrão.
const CATEGORIA={modelo:'model',esforco:'thought_level',modo:'mode'};
const escolhaEm=(fonte,agente,campo)=>fonte?.agentes?.[agente]?.[campo];
const doAgente=(agente,campo)=>opcaoDe(chat.opcoes[agente],CATEGORIA[campo])?.currentValue;
const padraoAdmin=(agente,campo)=>escolhaEm(chat.info?.padrao,agente,campo)??doAgente(agente,campo);
const escolhaDe=(agente,campo)=>escolhaEm(chat.info?.minhas,agente,campo)??padraoAdmin(agente,campo);
const agentePreferido=()=>chat.info?.minhas?.agente??chat.info?.padrao?.agente;
const NOME_AGENTE={claude:'Claude Code',codex:'Codex'};
const nomeAgente=id=>chat.agentes?.find(a=>a.id===id)?.nome||NOME_AGENTE[id]||id;
// O id da conversa na grade e no layout salvo: c:<agente>:<sessão>
const idDe=(agente,sessao)=>agente+':'+sessao;
const partes=id=>{const i=id.indexOf(':');return {agente:id.slice(0,i),sessao:id.slice(i+1)};};

function aviso(texto){$('chat-aviso').textContent=texto||'';$('chat-aviso').hidden=!texto;}

// ── Conexão com o servidor de agentes ───────────────────────────────────────
// Pedido {id, op, ...} → resposta {t:'resposta', id, ok, dados|erro}; eventos chegam soltos ({t:'evento'|'estado'}).
// Uma conexão com o servidor de agentes da própria pessoa (ws) e, desde 15/10/2026, uma por conversa compartilhada
// com ela (/api/agentes/ws?convite=<id>): o gateway liga essa no servidor de agentes do dono da conversa.
const novaConexao=(convite=null)=>({sock:null,abrindo:null,n:0,espera:new Map(),convite});
const ws=novaConexao();
const conexoesConvite=new Map();   // id do convite → conexão
const urlDe=c=>c.convite?'/api/agentes/ws?convite='+encodeURIComponent(c.convite):(chat.info?.agentes||'/api/agentes/ws');
function conectar(c=ws){
  if(c.sock?.readyState===1)return Promise.resolve();
  if(c.abrindo)return c.abrindo;
  c.abrindo=(async()=>{
    // desligado por ociosidade: o gateway liga e recusa a primeira; tenta de novo por uns 40 s
    for(let i=0;i<20;i++){
      const ok=await new Promise(fim=>{
        const s=new WebSocket((location.protocol==='https:'?'wss://':'ws://')+location.host+urlDe(c));
        s.onopen=()=>{c.sock=s;fim(true);};
        s.onerror=()=>fim(false);
        s.onclose=()=>{
          if(c.sock!==s)return;
          c.sock=null;
          for(const r of c.espera.values())r.no(new Error('A conexão com os agentes caiu.'));
          c.espera.clear();
          if(c!==ws){reconectarConvite(c);return;}
          aviso('Conexão com os agentes caiu. Tentando de novo…');
          setTimeout(()=>reconectar().catch(()=>{}),1500);
        };
        s.onmessage=e=>receber(JSON.parse(e.data),c);
      });
      if(ok){if(c===ws)aviso('');return;}
      if(i===0&&c===ws)aviso('Ligando o seu ambiente…');
      // convite que não existe mais (o dono tirou): não adianta insistir
      if(c!==ws&&i>=2&&!(await conviteAinda(c.convite)))throw new Error('Essa conversa não está mais compartilhada contigo.');
      await new Promise(r=>setTimeout(r,2000));
    }
    throw new Error(c===ws?'Seu ambiente não respondeu. Tente de novo daqui a pouco.':'O ambiente de quem compartilhou não respondeu. Tente de novo daqui a pouco.');
  })().finally(()=>{c.abrindo=null;});
  return c.abrindo;
}
async function pedir(op,dados={},c=ws){
  await conectar(c);
  // o número do pedido vai por último: nenhum dado sobrescreve (já aconteceu com o id da rotina)
  return new Promise((ok,no)=>{const id=++c.n;c.espera.set(id,{ok,no});c.sock.send(JSON.stringify({...dados,op,id}));});
}
// pedido sobre a conversa de uma aba: vai pela conexão dela (a do dono, se for compartilhada)
const pedirAba=(aba,op,dados={})=>pedir(op,{agente:aba.agente,sessao:aba.sessao,...dados},aba.conn??ws);
function receber(m,c=ws){
  if(m.t==='resposta'){const r=c.espera.get(m.id);if(!r)return;c.espera.delete(m.id);m.ok?r.ok(m.dados):r.no(new Error(m.erro));return;}
  if(c===ws&&(m.t==='terminal'||m.t==='terminal-fim'))return aoTerminal(m);
  const aba=chat.abas.find(a=>a.agente===m.agente&&a.sessao===m.sessao&&(a.conn??ws)===c);
  if(m.t==='conta'){carregarContas(m.agente);return;}
  if(m.t==='presenca'){if(aba){aba.presenca=m.pessoas||[];faixa(aba);}return;}
  if(m.t==='digitando'){if(aba&&m.pessoa?.email){(aba.digitando??=new Map());if(m.ativo)aba.digitando.set(m.pessoa.email,{nome:m.pessoa.nome,ate:Date.now()+7000});else aba.digitando.delete(m.pessoa.email);desenharDigitando(aba);}return;}
  if(m.t==='estado'){if(COM_CONTAS.has(m.agente)&&c===ws)carregarContas(m.agente);if(aba){aba.rodando=m.estado!=='livre';aba.esperando=m.estado==='esperando';estado(aba);}return;}
  // aba dormindo não assinou: o que chegar dela fica pro histórico que vem quando ela acordar
  if(m.t==='evento'&&aba&&!aba.dormindo&&m.seq>aba.seq){aba.seq=m.seq;aoEvento(aba,m.update);}
}
// Reconectou (rede, ou o ambiente religou): cada aba aberta assina de novo e recebe só o que faltou.
async function reconectar(){
  await conectar();
  for(const aba of chat.abas)if(!aba.dormindo&&!aba.conn)await assinar(aba,true).catch(()=>{});
  for(const t of [...terminais.values()])await assinarTerminal(t).catch(()=>fecharTerminal(t,false));
}
// A conexão de uma conversa compartilhada caiu (rede, o dono trocou o modo ou tirou o acesso): reabre e
// reassina; se o convite saiu, a aba avisa e fica parada.
async function reconectarConvite(c){
  const abas=chat.abas.filter(a=>a.conn===c);if(!abas.length){conexoesConvite.delete(c.convite);return;}
  await new Promise(r=>setTimeout(r,800));
  const ainda=await conviteAinda(c.convite);
  for(const aba of abas){
    if(!ainda){aba.convite.saiu=true;faixa(aba);estado(aba);continue;}
    aba.convite={...aba.convite,...ainda};
    await assinar(aba,true).then(()=>{faixa(aba);estado(aba);}).catch(()=>{});
  }
}
// O convite ainda vale? Devolve o convite de agora (o modo pode ter mudado) ou null.
async function conviteAinda(id){
  try{const r=await fetch('/_ratoeira/api/compartilhadas',{credentials:'same-origin'});if(!r.ok)return null;return (await r.json()).comigo?.find(c=>c.id===id)||null;}catch{return null;}
}
// O agente religou (conta trocada, adaptador caiu): a conversa ficou solta no servidor. Abre de novo
// (retoma do histórico do agente) e manda outra vez, em vez de mostrar "Abra a conversa antes".
async function enviarRetomando(aba,blocos){
  try{return await pedirAba(aba,'enviar',{blocos,aparelho:TIPO_APARELHO});}
  catch(e){if(!/Abra a conversa antes/.test(e?.message||''))throw e;await assinar(aba,true);return pedirAba(aba,'enviar',{blocos,aparelho:TIPO_APARELHO});}
}
async function assinar(aba,soFaltou){
  // convidado não liga ferramenta de app nem da Ratoeira: a conversa é do dono
  const lig=aba.conn?null:ligacaoDe(aba.id);
  const r=await pedirAba(aba,'abrir',{...(aba.cwd?{cwd:aba.cwd}:{}),...(aba.conn?{}:{mcp:[...(lig?.mcp??[]),...await ferramentasRatoeira()]})});
  aba.cwd=r.cwd;aba.config=r.config||{};if(r.titulo)aba.titulo=r.titulo;if(Array.isArray(r.comandos))aba.comandos=r.comandos;aba.conta=r.conta??null;aba.ultracode=Boolean(r.ultracode);
  aba.compartilhada=Boolean(r.compartilhada)||Boolean(aba.conn);
  aba.pendentes=new Map((r.pedidos||[]).map(p=>[p.pedido,p]));
  let a=await pedirAba(aba,'assinar',{desde:soFaltou?aba.seq:0});
  // conversa nova na tela, ou o servidor religou e retomou do histórico: redesenha do começo. Reconexão comum
  // só acrescenta o que faltou (redesenhar tudo pulava a tela pro fim no meio da leitura).
  let doZero=!soFaltou;
  if(soFaltou&&a.seq<aba.seq){doZero=true;aba.seq=0;aba.blocos=[];aba.porChave=new Map();aba.notasVistas=new Set();a=await pedirAba(aba,'assinar',{desde:0});}
  if(Array.isArray(a.presenca))aba.presenca=a.presenca;
  aba.rodando=a.estado!=='livre';desenhar(aba,!doZero);estado(aba);faixa(aba);
}

// Markdown da resposta → HTML limpo. O CSP do portal já bloqueia script inline; o DOMPurify é a segunda trava.
async function carregarMarkdown(){
  if(chat.md)return;
  const lib=await import(chat.info.markdown);
  chat.md={marked:new lib.Marked({gfm:true}),purify:lib.DOMPurify};
}
function markdown(texto,cwd){
  const html=chat.md.purify.sanitize(chat.md.marked.parse(texto||''),{USE_PROFILES:{html:true},FORBID_TAGS:['style','form','input','button','iframe']});
  const box=el('div','md');box.innerHTML=html;
  box.querySelectorAll('img').forEach(img=>imagemDoAgente(img,cwd));
  box.querySelectorAll('a[href]').forEach(a=>{
    // link pra arquivo (sem http): abre na Mesa, não numa aba nova do navegador
    const href=a.getAttribute('href');if(!/^[a-z][a-z0-9+.-]*:|^#|^\/\//i.test(href)&&pareceCaminho(decodeURI(href))){a.classList.add('caminho');a.dataset.caminho=decodeURI(href);return;}
    // link da própria Mesa (o "Copiar link", ou o agente montando o endereço inteiro): abre aqui, não numa aba nova
    const rel=relDaMesa(href);if(rel){a.classList.add('caminho');a.dataset.caminho=rel;a.dataset.raiz='1';a.title='Abrir na Mesa';return;}
    // link de conversa da Ratoeira ("Copiar link da conversa"): abre a conversa aqui
    const conv=lerLinkConversa(href);if(conv){a.title='Abrir a conversa';a.addEventListener('click',e=>{e.preventDefault();abrirLinkConversa(conv);});return;}
    a.target='_blank';a.rel='noopener noreferrer';
  });
  for(const c of box.querySelectorAll('code'))if(!c.closest('pre'))caminhoEmCodigo(c,cwd);
  box.querySelectorAll('pre').forEach(blocoCopiavel);
  return box;
}
// Bloco de código (prompt, yaml, comando…) ganha botão Copiar. Texto corrido (sem linguagem, text, markdown)
// quebra a linha em vez de rolar de lado: é o prompt pra colar em outro lugar.
function blocoCopiavel(pre){
  const caixa=el('div','md-bloco');pre.replaceWith(caixa);caixa.append(pre);
  const ling=pre.querySelector('code')?.className.match(/language-(\S+)/)?.[1]||'';
  if(!ling||/^(text|txt|md|markdown|prompt)$/i.test(ling))pre.classList.add('quebra');
  const b=el('button','md-copiar');b.type='button';b.title='Copiar';b.setAttribute('aria-label','Copiar');
  const rotulo=el('span',undefined,'Copiar');b.append(icone('copiar'),rotulo);
  b.addEventListener('click',e=>{
    e.stopPropagation();
    const ok=()=>{b.replaceChildren(icone('feito'),rotulo);rotulo.textContent='Copiado';clearTimeout(b.volta);b.volta=setTimeout(()=>{b.replaceChildren(icone('copiar'),rotulo);rotulo.textContent='Copiar';},1600);};
    (navigator.clipboard?navigator.clipboard.writeText(pre.textContent.replace(/\n$/,'')):Promise.reject()).then(ok,()=>toast('Não deu pra copiar: selecione o texto e copie à mão.'));
  });
  caixa.append(b);
}
// Quando o limite do plano volta, no relógio de quem lê: "hoje às 15:00", "amanhã às 09:30", "sábado, 12/10, às 15:00".
function quandoVolta(ms){
  const d=new Date(ms),dia=x=>new Date(x.getFullYear(),x.getMonth(),x.getDate()).getTime();
  const dias=Math.round((dia(d)-dia(new Date()))/864e5),hora=d.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
  if(dias<=0)return 'hoje às '+hora;if(dias===1)return 'amanhã às '+hora;
  return d.toLocaleDateString('pt-BR',{weekday:'long',day:'2-digit',month:'2-digit'})+', às '+hora;
}
// Imagem no markdown do agente (`![x](caminho)`): o caminho é do servidor, não do navegador. Dentro da pasta de
// trabalho carrega pela rota de arquivos e abre na Mesa ao clicar; fora dela (o /tmp do agente) ou na web (o CSP
// só deixa imagem da própria Ratoeira) vira um aviso com o caminho, em vez do ícone de imagem quebrada.
function imagemDoAgente(img,cwd){
  const src=img.getAttribute('src')||'',alt=img.getAttribute('alt')||'';
  if(/^data:image\//i.test(src))return;
  const url=r=>'/_ratoeira/arquivo/'+r.split('/').map(encodeURIComponent).join('/');
  const aviso=texto=>{const s=el('span','md-img-fora');s.append(icone('arquivo'),el('span',undefined,texto));img.replaceWith(s);return s;};
  let local=null;try{local=!/^[a-z][a-z0-9+.-]*:|^\/\//i.test(src)&&pareceCaminho(decodeURI(src))?decodeURI(src):null;}catch{}
  if(!local){const s=aviso(alt?'Imagem: '+alt:'Imagem da web');if(/^https?:/i.test(src)){const a=el('a',undefined,src);a.href=src;a.target='_blank';a.rel='noopener noreferrer';s.append(' ',a);}return;}
  // relativo: tenta a partir da pasta da conversa e, se não achar, da raiz (igual ao clique num caminho)
  const tentativas=[caminhoNoRepo(local,cwd),caminhoNoRepo(local,null)].filter((x,i,l)=>x&&l.findIndex(y=>y?.rel===x.rel)===i);
  if(!tentativas.length){aviso('Imagem fora da pasta de trabalho, não dá pra mostrar aqui: '+local).title='Peça pro agente salvar a imagem dentro do repositório';return;}
  let i=0;img.loading='lazy';img.classList.add('md-img','caminho');img.title='Abrir na Mesa';
  const usar=()=>{img.src=url(tentativas[i].rel);img.dataset.caminho=tentativas[i].rel;img.dataset.raiz='1';};
  img.onerror=()=>{if(++i<tentativas.length)usar();else aviso('Não achei a imagem '+tentativas[0].rel+' no repositório.');};
  usar();
}
// <origem da Ratoeira>/portal/#arquivos/<caminho> → o caminho, relativo à raiz do repositório (ou null)
// ── Link de conversa (desde 16/10/2026): "Copiar link da conversa" no ⋯ da conversa. Colado numa conversa, o agente
// lê a outra pela ferramenta ler_conversa (MCP da Ratoeira). Quem é dono colar o link dele numa conversa de outra
// pessoa (em que entrou) libera só pra ler pro dono de lá: é ele autorizando (gateway, compartilhadas/por-link).
function linkDaConversa(aba){return location.origin+'/portal/?chat='+encodeURIComponent(aba.agente+':'+aba.sessao)+'&de='+encodeURIComponent(aba.convite?.dono||meuEmail()||'')+'#arquivos';}
function lerLinkConversa(href){
  let u;try{u=new URL(href,location.href);}catch{return null;}
  if(u.origin!==location.origin)return null;
  const m=(u.searchParams.get('chat')||'').match(/^([a-z][a-z0-9-]{0,30}):([A-Za-z0-9_.:-]{1,200})$/),dono=(u.searchParams.get('de')||'').toLowerCase();
  return m&&dono.includes('@')?{agente:m[1],sessao:m[2],dono}:null;
}
async function copiarLinkConversa(aba){
  const link=linkDaConversa(aba);
  try{await navigator.clipboard.writeText(link);toast('Link copiado. Cola numa conversa (tua ou de alguém do time) e o agente de lá lê esta por ele.');}catch{prompt('Copie o link:',link);}
}
// Enviar o link pelo menu de compartilhar do aparelho (celular): mesmo link, que só abre pra quem tem acesso
async function enviarLinkConversa(aba){
  try{await navigator.share({title:tituloDe(aba),url:linkDaConversa(aba)});}catch(e){if(e?.name!=='AbortError')copiarLinkConversa(aba);}
}
async function abrirLinkConversa(l){
  if(l.dono===meuEmail())return abrirNoPainel(idDe(l.agente,l.sessao)).catch(e=>toast('Não abriu: '+e.message));
  try{const c=(await apiCompartilhar('compartilhadas')).comigo.find(x=>x.dono===l.dono&&x.agente===l.agente&&x.sessao===l.sessao);if(c)return window.ratoeiraAbrirCompartilhada(c.id,c.titulo);}catch{}
  toast('Essa conversa não está compartilhada contigo.');
}
// Antes de a mensagem ir pro agente, numa conversa de outra pessoa: link de conversa minha libera só pra ler pro dono
// daqui, pro agente dele já conseguir ler. Link de conversa de outra pessoa não libera nada (o gateway confere).
async function liberarLinks(aba,texto){
  if(!aba.conn||aba.convite?.modo!=='entrar')return;
  const links=[...new Set(String(texto).match(/https?:\/\/[^\s<>()"'`]+/g)||[])].filter(h=>lerLinkConversa(h)?.dono===meuEmail()).slice(0,5);
  for(const link of links){
    const l=lerLinkConversa(link),aberta=chat.abas.find(a=>!a.conn&&a.agente===l.agente&&a.sessao===l.sessao);
    let cwd=aberta?.cwd,titulo=aberta?tituloDe(aberta):null;
    if(!cwd)try{const s=(await pedir('listar',{agente:l.agente})).find(x=>x.sessao===l.sessao);cwd=s?.cwd;titulo=s?.titulo??titulo;}catch{}
    if(!cwd){toast('Não achei essa conversa tua pra liberar.');continue;}
    try{const r=await apiCompartilhar('compartilhadas/por-link',{link,convite:aba.convite.id,cwd,titulo});
      if(r.liberada&&!r.ja)toast((r.para||'O dono desta conversa')+' agora pode ler "'+(titulo||'a tua conversa')+'" (só ler). Pra tirar: Compartilhar, na tua conversa.');}
    catch(e){toast('Não liberei o link: '+e.message);}
  }
}
function relDaMesa(href){
  let u;try{u=new URL(href,location.href);}catch{return null;}
  if(u.origin!==location.origin||!['/','/portal','/portal/'].includes(u.pathname)||!u.hash.startsWith('#arquivos/'))return null;
  let rel;try{rel=u.hash.slice('#arquivos/'.length).split('/').map(decodeURIComponent).join('/');}catch{return null;}
  return rel&&!rel.split('/').some(x=>!x||x==='.'||x==='..')?rel:null;
}
// Caminho de arquivo no chat (`apps/x/AGENTS.md`, `chat.js:42`, link [x](docs/a.md), o arquivo de uma ferramenta):
// clicar abre na Mesa, na linha quando tem. Precisa ter / ou extensão e fica dentro do repositório. Com espaço
// (`Clientes/Acme Ltda/CLAUDE.md`), só se tiver / e extensão: `npm run build` e `cd apps/x` seguem texto.
const RE_CAMINHO=/^(\/?[\p{L}\p{N}_.@~+-](?:[\p{L}\p{N}_.@~+ -]*[\p{L}\p{N}_.@~+-])?(?:\/[\p{L}\p{N}_.@~+ -]*[\p{L}\p{N}_.@~+-])*\/?)(?::(\d+)(?::\d+)?|#L(\d+)(?:-L?\d+)?)?$/u;
function pareceCaminho(t){t=String(t||'').trim();if(t.length<3||t.length>300||/[^\S ]|  /.test(t))return false;const m=RE_CAMINHO.exec(t);if(!m)return false;
  const p=m[1];if(p.includes(' '))return p.includes('/')&&/\.[a-z0-9]{1,6}$/i.test(p);return (p.includes('/')&&!/^\/+$/.test(p)&&!p.startsWith('//'))||/\.[a-z0-9]{1,6}$/i.test(p);}
// Caminho em código só vira link se o arquivo existe na pasta de trabalho: fora dela (`/tmp/x`) ou só um nome
// solto na frase (`servidor.mjs`), segue texto. Documento (abre renderizado) ganha a pílula amarela; código e
// configuração, um sublinhado discreto. A checagem é a do clique, guardada: sim fica, não vale 30 s.
const existe=new Map(),DOC=/\.(md|markdown|html?|pdf|png|jpe?g|gif|webp|avif|svg|mp4|webm|mov|mp3|m4a|wav|ogg|csv|txt|xlsx|docx|pptx)$/i;
function arquivoExiste(rel){
  const v=existe.get(rel);if(v===true||v instanceof Promise)return v;if(typeof v==='number'&&Date.now()-v<30000)return false;
  const p=fetch('/_ratoeira/arquivo/'+rel.split('/').map(encodeURIComponent).join('/'),{method:'HEAD',credentials:'same-origin'})
    .then(r=>r.ok,()=>false).then(ok=>{existe.set(rel,ok||Date.now());return ok;});
  existe.set(rel,p);return p;
}
function caminhoEmCodigo(c,cwd){
  const t=c.textContent;if(!pareceCaminho(t))return;
  const alvos=[caminhoNoRepo(t,cwd),caminhoNoRepo(t,null)].filter((x,i,l)=>x&&l.findIndex(y=>y?.rel===x.rel)===i);
  const marcar=rel=>{c.classList.add('caminho',DOC.test(rel)?'doc':'cod');c.dataset.caminho=t;c.title='Abrir na Mesa';
    // HTML, PDF, imagem e markdown ganham o globo do Publicar do lado (portal.js, diálogo Publicar)
    if(window.ratoeiraPublicar&&/\.(html?|pdf|png|jpe?g|gif|webp|svg|avif|md)$/i.test(rel)&&!c.nextElementSibling?.classList.contains('caminho-pub')){
      const b=document.createElement('button');b.type='button';b.className='caminho-pub';b.dataset.pubRel=rel;b.title='Publicar: um link pra abrir fora da Ratoeira';b.setAttribute('aria-label','Publicar '+rel);
      b.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z"/></svg>';
      b.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();window.ratoeiraPublicar(rel);});c.after(b);window.ratoeiraMarcarGlobos?.([b]);}};
  const ja=alvos.find(a=>existe.get(a.rel)===true);if(ja)return marcar(ja.rel);
  (async()=>{for(const a of alvos)if(await arquivoExiste(a.rel))return marcar(a.rel);})();
}
// texto do caminho → {rel, linha} relativo à raiz do repositório (o relativo vale a partir da pasta da conversa)
function caminhoNoRepo(t,cwd){
  const m=RE_CAMINHO.exec(String(t||'').trim());if(!m)return null;
  const raiz=chat.info?.pastaPadrao;if(!raiz)return null;
  let p=m[1].replace(/\/$/,'');const linha=Number(m[2]||m[3])||null;
  if(p.startsWith('/')){if(!p.startsWith(raiz+'/'))return null;p=p.slice(raiz.length+1);}
  else{const base=cwd&&cwd.startsWith(raiz+'/')?cwd.slice(raiz.length+1):'';if(base&&!p.startsWith(base+'/'))p=base+'/'+p;}
  const partes=[];for(const x of p.split('/')){if(!x||x==='.')continue;if(x==='..'){if(!partes.length)return null;partes.pop();}else partes.push(x);}
  return partes.length?{rel:partes.join('/'),linha}:null;
}
async function abrirCaminho(t,cwd){
  const alvo=caminhoNoRepo(t,cwd);
  if(!alvo||!window.ratoeiraAbrirArquivo){toast('Esse caminho fica fora do repositório.');return;}
  // o agente às vezes cita da raiz mesmo com a conversa numa subpasta: tenta os dois
  const tenta=async rel=>(await fetch('/_ratoeira/ver/'+rel.split('/').map(encodeURIComponent).join('/'),{method:'HEAD',credentials:'same-origin'}).catch(()=>null))?.ok;
  let rel=alvo.rel;
  if(!await tenta(rel)){const direto=caminhoNoRepo(t,null);if(direto&&direto.rel!==rel&&await tenta(direto.rel))rel=direto.rel;else{toast('Não achei '+rel+' no repositório.');return;}}
  window.ratoeiraAbrirArquivo(rel,{linha:alvo.linha});
}

// Agentes e as opções de cada um (o agente diz quais modelos, esforços e modos aceita), com cache.
async function carregarOpcoes(agente){
  if(!chat.agentes)chat.agentes=await pedir('agentes');
  const lista=agente?[agente]:chat.agentes.map(a=>a.id);
  const r=await Promise.allSettled(lista.map(async a=>{if(!chat.opcoes[a])chat.opcoes[a]=(await pedir('opcoes',{agente:a,cwd:chat.info.pastaPadrao})).configOptions||[];}));
  // Agente sem conta (ex.: Codex de quem só tem a conta geral do Claude) sai da conversa nova e não derruba os outros.
  // Pedido de um agente só (abrir conversa dele) ou nenhum que funcione: o erro sobe.
  if(agente||r.every(x=>x.status==='rejected')){const falha=r.find(x=>x.status==='rejected');if(falha)throw falha.reason;}
  // Falha por outro motivo que não a conta também tira o agente da lista, mas avisa uma vez: calado, parecia
  // "Claude desconectado" com a conta conectada (reporte 36, 28/10/2026).
  r.forEach((x,i)=>{const msg=x.reason?.message||String(x.reason||'');
    if(x.status!=='rejected'||/^Falta conectar a conta/.test(msg)||chat.avisouOpcoes?.has(lista[i]))return;
    (chat.avisouOpcoes??=new Set()).add(lista[i]);
    toast((chat.agentes.find(a=>a.id===lista[i])?.nome||lista[i])+' não abriu: '+msg);});
}
const comOpcoes=()=>chat.agentes.filter(a=>chat.opcoes[a.id]);
// A opção de uma categoria (model / thought_level / mode), pelo que o ACP chama de category, com o id de reserva.
const RESERVA={model:['model'],thought_level:['effort','reasoning_effort','thought_level'],mode:['mode']};
function opcaoDe(lista,categoria){return (lista||[]).find(o=>o.category===categoria)||(lista||[]).find(o=>RESERVA[categoria].includes(o.id));}
// Valores de uma opção do tipo select (podem vir em grupos).
// "Default (recommended)" vira o modelo que ele é de fato: o agente descreve o padrão só pela família ("Opus (1M
// context)"), então vale o nome da opção da mesma família ("Opus 5.5"). Esforço "Default" vira "Padrão".
function valoresDe(op){
  const vs=(op?.options||[]).flatMap(x=>x.options?x.options:[x]);
  const padrao=x=>{const fam=(x.description||'').split(/[\s(]/)[0];const mesma=fam?vs.filter(o=>o!==x&&(o.name||'').startsWith(fam+' ')):[];
    return mesma.length===1?mesma[0].name:x.description||'Padrão';};
  return vs.map(x=>/^default\b/i.test(x.name||'')
    ?(n=>({id:x.value,label:n==='Padrão'?n:n+' (padrão)',curto:n}))(padrao(x))
    :{id:x.value,label:x.name||x.value,title:x.description||undefined});
}

// ── Ícones (traço, herdam a cor) ─────────────────────────────────────────────
const ICONES={
  claude:'<path d="M12 3v18M3 12h18M5.6 5.6l12.8 12.8M18.4 5.6 5.6 18.4"/>',
  fila:'<path d="M4 7h10M4 12h10M4 17h7"/><circle cx="18" cy="16" r="3.5"/><path d="M18 14.5V16l1 .8"/>',
  agora:'<path d="M13 3 5 13h6l-1 8 8-10h-6z"/>',
  ajustes:'<path d="M4 7h9m4 0h3M4 17h3m4 0h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  nota:'<path d="M5 4h14v12H10l-5 4z"/><path d="M9 8.5h6M9 11.5h4" stroke-dasharray="2 1.6"/>',
  compartilhar:'<circle cx="9" cy="8" r="3.2"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0"/><path d="M17 8v6M14 11h6"/>',
  // Codex = a flor da OpenAI (o GPT), simplificada: o desenho do Codex some em tamanho pequeno
  codex:'<rect x="8.7" y="3" width="6.6" height="18" rx="3.3"/><rect x="8.7" y="3" width="6.6" height="18" rx="3.3" transform="rotate(60 12 12)"/><rect x="8.7" y="3" width="6.6" height="18" rx="3.3" transform="rotate(120 12 12)"/>',
  esforco:'<path d="M9.5 4a3 3 0 0 0-3 3 3 3 0 0 0-2 5 3 3 0 0 0 2 5 3 3 0 0 0 6 1V5.5A1.5 1.5 0 0 0 9.5 4z"/><path d="M14.5 4a3 3 0 0 1 3 3 3 3 0 0 1 2 5 3 3 0 0 1-2 5 3 3 0 0 1-6 1"/>',
  modo:'<path d="M12 3 5 6v5c0 4.5 3 8.2 7 10 4-1.8 7-5.5 7-10V6z"/>',
  pasta:'<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  seta:'<path d="m7 10 5 5 5-5"/>',
  enviar:'<path d="M12 19V5m-6 6 6-6 6 6"/>',
  subir:'<path d="M12 19V5m-6 6 6-6 6 6"/>',
  parar:'<rect x="7" y="7" width="10" height="10" rx="1.5" fill="currentColor"/>',
  app:'<rect x="4" y="4" width="6.5" height="6.5" rx="2"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="2"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="2"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="2"/>',
  arquivo:'<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
  fechar:'<path d="M7 7l10 10M17 7 7 17"/>',
  copiar:'<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h8"/>',
  feito:'<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  relogio:'<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  celular:'<rect x="7" y="3" width="10" height="18" rx="2"/><path d="M11 18h2"/>',
  computador:'<rect x="3" y="5" width="18" height="12" rx="1.5"/><path d="M8 20h8M12 17v3"/>',
  contexto:'<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5a8.5 8.5 0 0 1 8.5 8.5H12z"/>',
  microfone:'<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/>',
  carregando:'<path d="M20 12a8 8 0 1 1-5.3-7.5"/>',
  conta:'<circle cx="12" cy="8.5" r="3.5"/><path d="M5 20a7 7 0 0 1 14 0"/>',
  clipe:'<path d="m20.5 11.5-8.4 8.4a5 5 0 0 1-7.1-7.1l8.4-8.4a3.3 3.3 0 0 1 4.7 4.7l-8.4 8.4a1.7 1.7 0 0 1-2.4-2.4l7.8-7.8"/>',
};
function icone(nome,cls='ic'){const s=document.createElementNS('http://www.w3.org/2000/svg','svg');s.setAttribute('viewBox','0 0 24 24');s.setAttribute('aria-hidden','true');s.classList.add(cls);s.innerHTML=ICONES[nome]||ICONES.claude;return s;}

// Pílula = botão com o valor escolhido + menu nosso (desde 16/10/2026; antes era o <select> nativo, invisível por
// cima). O <select> segue existindo, fora da tela, guardando a lista e o valor: quem usa a pílula lê sel.value e
// ouve 'change' nele como antes. O menu lê o <select> na hora de abrir (optgroup vira título, title vira a
// descrição de cada opção). `p.desenhar(p,menu)` troca o miolo (o esforço desenha régua e chaves).
function pilula(nomeIcone,rotulo){
  const box=el('button','pilula');box.type='button';box.setAttribute('aria-haspopup','listbox');box.setAttribute('aria-expanded','false');
  const sel=el('select');
  const ic=icone(nomeIcone);const txt=el('span','pilula-texto');const marca=el('span','pilula-marca');marca.hidden=true;
  box.append(ic,txt,marca,icone('seta','seta'));
  // o title diz o valor quando a pílula mostra só o ícone (conversa aberta)
  const atualizar=()=>{const o=sel.selectedOptions[0];txt.textContent=o?(o.dataset.curto||o.textContent):'';box.title=rotulo+(o?': '+txt.textContent:'');box.setAttribute('aria-label',box.title);};
  sel.addEventListener('change',atualizar);
  const p={box,sel,ic,rotulo,atualizar,desenhar:null,
    trocarIcone(n){const novo=icone(n);box.replaceChild(novo,box.firstChild);},
    // pontinho amarelo do lado do valor (ultracode ligado)
    marcar(sim,dica){marca.hidden=!sim;marca.title=dica||'';},
    abrir(){abrirMenuPilula(p);}};
  box.addEventListener('click',e=>{e.stopPropagation();abrirMenuPilula(p);});
  box.addEventListener('keydown',e=>{if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();abrirMenuPilula(p,true);}});
  return p;
}
let menuPilula=null;
function fecharMenuPilula(focar=false){
  const m=menuPilula;if(!m)return;menuPilula=null;
  m.menu.remove();m.veu?.remove();m.p.box.setAttribute('aria-expanded','false');m.p.box.classList.remove('aberta');
  document.removeEventListener('pointerdown',m.fora,true);window.removeEventListener('resize',m.sair);document.removeEventListener('scroll',m.rolar,true);
  if(focar)m.p.box.focus();
}
// escolhe um valor como se fosse no <select>: o change avisa quem usa a pílula; o da caixa sobe pra barra
function escolherNaPilula(p,v,fechar=true){
  if(fechar)fecharMenuPilula(true);
  if(p.sel.value===v)return;
  p.sel.value=v;p.sel.dispatchEvent(new Event('change'));p.box.dispatchEvent(new Event('change',{bubbles:true}));
}
function itemDoMenu(p,o){
  const b=el('button','pmenu-item');b.type='button';b.setAttribute('role','option');b.setAttribute('aria-selected',String(o.value===p.sel.value));
  const t=el('span','pmenu-txt');t.append(el('span','pmenu-t',o.textContent));if(o.title)t.append(el('span','pmenu-d',o.title));
  b.append(t,icone('feito','pmenu-ok'));
  b.onclick=()=>escolherNaPilula(p,o.value);
  return b;
}
function desenharListaPilula(p,menu){
  const filhos=[...p.sel.children];
  // lista comprida (pastas): busca em cima
  if(p.sel.options.length>8){
    const busca=el('input','pmenu-busca');busca.type='search';busca.placeholder='Buscar…';busca.setAttribute('aria-label','Buscar em '+p.rotulo.toLowerCase());
    busca.addEventListener('input',()=>{const q=semAcento(busca.value);for(const b of menu.querySelectorAll('.pmenu-item'))b.hidden=Boolean(q)&&!semAcento(b.textContent).includes(q);});
    busca.addEventListener('keydown',e=>{if(e.key==='ArrowDown'){e.preventDefault();menu.querySelector('.pmenu-item:not([hidden])')?.focus();}if(e.key==='Enter'){e.preventDefault();menu.querySelector('.pmenu-item:not([hidden])')?.click();}});
    menu.append(busca);
  }
  for(const f of filhos){
    if(f.tagName==='OPTGROUP'){menu.append(el('div','pmenu-grupo',f.label));for(const o of f.children)menu.append(itemDoMenu(p,o));}
    else menu.append(itemDoMenu(p,f));
  }
}
const semAcento=t=>(t||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase();
function abrirMenuPilula(p,peloTeclado=false){
  if(menuPilula?.p===p){fecharMenuPilula(true);return;}
  fecharMenuPilula();
  if(p.sel.disabled){if(p.box.title)toast(p.box.title);return;}
  const folha=G.celular();
  const menu=el('div',folha?'pmenu folha':'pmenu');menu.setAttribute('role','listbox');menu.setAttribute('aria-label',p.rotulo);
  const m={p,menu,veu:null};
  m.redesenhar=()=>{const foco=menu.contains(document.activeElement)?[...menu.querySelectorAll('button,input')].indexOf(document.activeElement):-1;
    menu.replaceChildren();(p.desenhar||desenharListaPilula)(p,menu,m);
    if(foco>=0)[...menu.querySelectorAll('button,input')][foco]?.focus();};
  m.redesenhar();
  if(folha){m.veu=el('div','pmenu-veu');m.veu.onclick=()=>fecharMenuPilula();document.body.append(m.veu);}
  document.body.append(menu);
  // perto da pílula: em cima se couber (a caixa fica embaixo), senão embaixo; nunca saindo da tela
  if(!folha){
    const r=p.box.getBoundingClientRect(),vw=innerWidth,vh=innerHeight;
    const w=Math.min(menu.offsetWidth,vw-16);menu.style.left=Math.max(8,Math.min(r.left,vw-w-8))+'px';
    const acima=r.top-12,abaixo=vh-r.bottom-12;
    if(acima>=Math.min(menu.scrollHeight,320)||acima>abaixo){menu.style.bottom=(vh-r.top+6)+'px';menu.style.maxHeight=acima+'px';}
    else{menu.style.top=(r.bottom+6)+'px';menu.style.maxHeight=abaixo+'px';}
  }
  p.box.setAttribute('aria-expanded','true');p.box.classList.add('aberta');
  menuPilula=m;
  m.fora=e=>{if(!menu.contains(e.target)&&!p.box.contains(e.target)&&e.target!==m.veu)fecharMenuPilula();};
  m.sair=()=>fecharMenuPilula();m.rolar=e=>{if(!menu.contains(e.target))fecharMenuPilula();};
  document.addEventListener('pointerdown',m.fora,true);window.addEventListener('resize',m.sair);document.addEventListener('scroll',m.rolar,true);
  menu.addEventListener('keydown',e=>{
    if(e.key==='Escape'){e.preventDefault();e.stopPropagation();fecharMenuPilula(true);return;}
    if(e.key==='Tab'){fecharMenuPilula();return;}
    if(!['ArrowDown','ArrowUp','Home','End'].includes(e.key)||e.target.matches('input'))return;
    const its=[...menu.querySelectorAll('.pmenu-item:not([hidden]),.pmenu-regua [aria-checked=true],.pmenu-chave')];if(!its.length)return;
    e.preventDefault();let i=its.indexOf(document.activeElement);
    i=e.key==='Home'?0:e.key==='End'?its.length-1:e.key==='ArrowDown'?(i+1)%its.length:(i<=0?its.length-1:i-1);its[i].focus();
  });
  // no toque não puxa o foco (abriria o teclado na busca); no mouse e no teclado, vai pro escolhido
  if(!TOQUE||peloTeclado)(menu.querySelector('[aria-selected=true],[aria-checked=true]')||menu.querySelector('button,input'))?.focus();
}

// Esforço: régua com os níveis do agente e, embaixo, as chaves da conversa (ultracode no Claude; rápido quando o
// agente oferece). Escolher na régua não fecha o menu, pra dar pra mexer nas chaves junto.
function desenharEsforco(c,p,menu,m){
  const os=[...p.sel.options],i=p.sel.selectedIndex;
  if(os.length>7)desenharListaPilula(p,menu);
  else if(os.length){
    const linha=el('div','pmenu-linha'),tx=el('span','pmenu-txt'),t=el('span','pmenu-t','Esforço ');
    t.append(el('span','pmenu-fraco','('+(os[i]?.textContent||'')+')'));tx.append(t,el('span','pmenu-d','Quanto ele pensa antes de responder'));
    const regua=el('div','pmenu-regua');regua.setAttribute('role','radiogroup');regua.setAttribute('aria-label','Esforço');
    const ir=o=>{escolherNaPilula(p,o.value,false);m.redesenhar();menu.querySelector('.pmenu-regua [aria-checked=true]')?.focus();};
    os.forEach((o,k)=>{
      const b=el('button');b.type='button';b.setAttribute('role','radio');b.setAttribute('aria-checked',String(k===i));b.setAttribute('aria-label',o.textContent);b.title=o.textContent;
      if(k<=i)b.classList.add('ate');b.tabIndex=k===i?0:-1;
      b.onclick=()=>ir(o);
      b.onkeydown=e=>{const d=e.key==='ArrowRight'?1:e.key==='ArrowLeft'?-1:0;if(d&&os[k+d]){e.preventDefault();ir(os[k+d]);}};
      regua.append(b);
    });
    linha.append(tx,regua);menu.append(linha);
  }
  for(const x of extrasEsforco(c)){
    const linha=el('div','pmenu-linha'),tx=el('span','pmenu-txt');tx.append(el('span','pmenu-t',x.titulo),el('span','pmenu-d',x.desc));
    const ch=el('button','pmenu-chave');ch.type='button';ch.setAttribute('role','switch');ch.setAttribute('aria-checked',String(x.ligado));ch.setAttribute('aria-label',x.titulo);
    ch.onclick=async()=>{ch.disabled=true;try{await x.alternar(!x.ligado);}finally{if(menuPilula?.p===p){m.redesenhar();menu.querySelector(`.pmenu-chave[aria-label="${x.titulo}"]`)?.focus();}}};
    linha.append(tx,ch);menu.append(linha);
    if(x.ligado&&x.aviso)menu.append(el('p','pmenu-aviso',x.aviso));
  }
}
// As chaves do menu do esforço. Na caixa de conversa nova, ficam guardadas até criar; na conversa, valem nela.
function extrasEsforco(c){
  const aba=c.aba??null,agente=aba?aba.agente:c.agente,xs=[];
  if(aba?.conn)return xs;   // conversa de outra pessoa: as escolhas são do dono
  if(agente==='claude'){
    const ligado=Boolean(aba?aba.ultracode:c.ultraNovo);
    xs.push({titulo:'Ultracode',desc:'Divide o trabalho entre vários agentes. Vale pra conversa toda',ligado,
      aviso:'Gasta a cota bem mais rápido: pode abrir dezenas de agentes num pedido só.',
      alternar:async v=>{
        if(!aba){c.ultraNovo=v;marcarUltracode(c);return;}
        try{const r=await pedirAba(aba,'conversa-ultracode',{ligar:v});aba.ultracode=r.ultracode??v;toast(v?'Ultracode ligado nesta conversa.':'Ultracode desligado nesta conversa.');}
        catch(e){toast(e.message);}
        marcarUltracode(c);
      }});
  }
  // modo rápido: só aparece quando o agente oferece pro modelo escolhido (opção `fast` do claude-agent-acp)
  const lista=aba?aba.config?.configOptions:listaNova(c,agente);const f=(lista||[]).find(o=>o.id==='fast');
  if(f){
    const atual=!aba&&c.fastNovo!=null?c.fastNovo:f.currentValue;
    xs.push({titulo:'Rápido',desc:'Responde mais rápido. Pode gastar mais da cota',ligado:atual===true||atual==='on',
      alternar:async v=>{
        const valor=f.type==='boolean'?v:(v?'on':'off');
        if(!aba){c.fastNovo=valor;return;}
        try{const r=await pedirAba(aba,'opcao',{opcao:f.id,valor});aba.config=r.config||aba.config;}catch(e){toast('Não troquei o modo rápido: '+e.message);}
        estado(aba);
      }});
  }
  return xs;
}
function marcarUltracode(c){const sim=c.aba?Boolean(c.aba.ultracode):Boolean(c.ultraNovo)&&c.agente==='claude';c.esforco.marcar(sim,'Ultracode ligado');}
function opcoes(sel,grupos,valor){
  // grupos: [{rotulo?, itens:[{id,label,curto?,title?}]}]
  sel.replaceChildren();
  for(const g of grupos){
    const pai=g.rotulo?el('optgroup'):sel;if(g.rotulo){pai.label=g.rotulo;sel.append(pai);}
    for(const i of g.itens){const o=el('option',undefined,i.label);o.value=i.id;if(i.curto)o.dataset.curto=i.curto;if(i.title)o.title=i.title;pai.append(o);}
  }
  if(valor!=null&&[...sel.options].some(o=>o.value===valor))sel.value=valor;
}

// Anel de contexto: quanto da janela a conversa já ocupa (o agente manda em usage_update). Custo é o preço
// de API que o CLI calcula; no plano não é cobrado.
function anel(){
  const box=el('div','anel');box.tabIndex=0;box.setAttribute('role','img');
  box.innerHTML='<svg viewBox="0 0 36 36" aria-hidden="true"><circle cx="18" cy="18" r="14" class="anel-fundo"/><circle cx="18" cy="18" r="14" class="anel-uso" pathLength="100" stroke-dasharray="0 100"/></svg>';
  const dica=el('div','anel-dica');dica.setAttribute('role','tooltip');box.append(dica);
  return {box,atualizar(u){
    const pct=u?.size?Math.min(100,Math.round(100*(u.used||0)/u.size)):null;
    box.hidden=pct==null;if(pct==null)return;
    box.querySelector('.anel-uso').setAttribute('stroke-dasharray',`${pct} ${100-pct}`);box.classList.toggle('cheio',pct>=80);
    const k=n=>n>=1000?(n/1000).toLocaleString('pt-BR',{maximumFractionDigits:1})+'k':String(n||0);
    const linhas=[['Contexto',`${k(u.used)} de ${k(u.size)} tokens (${pct}%)`]];
    const custo=u.cost?.amount;
    if(custo)linhas.push(['Preço de API',`≈ ${u.cost.currency==='USD'||!u.cost.currency?'US$ ':u.cost.currency+' '}${custo.toLocaleString('pt-BR',{minimumFractionDigits:3,maximumFractionDigits:3})} nesta conversa`]);
    dica.replaceChildren(...linhas.map(([a,b])=>{const p=el('p');p.append(el('strong',undefined,a+': '),document.createTextNode(b));return p;}),el('p','anel-nota','No plano Max esse valor não é cobrado: ele consome a cota de uso.'));
    box.setAttribute('aria-label',`Contexto usado: ${pct}%`);
  }};
}

// Medidor ao lado do anel: quanto tempo o cache ainda vale (depois disso o Claude relê a conversa inteira e gasta
// mais do limite) e, no balão, quanto já foi do limite de 5 h e do semanal. Passou de 80%, aviso no topo da caixa.
// Vem do servidor de agentes (ratoeira_uso, no fim de cada resposta) e do uso de cada resposta (_claude/rateLimit).
const ALERTA_LIMITE=0.8;
const medidores=new Set();
const redesenharMedidores=()=>{for(const m of medidores)if(m.box.isConnected)m.desenhar();};
setInterval(redesenharMedidores,30e3);
// aba em segundo plano, celular bloqueado ou notebook dormindo: o navegador congela o timer e o relógio ficava
// mostrando o tempo de quando a página parou (o "1h" de logo depois da resposta). Ao voltar, redesenha na hora.
document.addEventListener('visibilitychange',()=>{if(!document.hidden)redesenharMedidores();});
addEventListener('pageshow',redesenharMedidores);addEventListener('focus',redesenharMedidores);
const pctUso=x=>Math.round(x*100)+'%';
// plano do ChatGPT como o Codex escreve (plus, pro, prolite, team...)
const PLANOS={free:'Grátis',go:'Go',plus:'Plus',pro:'Pro',prolite:'Pro Lite',team:'Team',business:'Business',enterprise:'Enterprise',edu:'Edu'};
const nomePlano=p=>PLANOS[String(p).toLowerCase()]??String(p);
// curto, pro relógio: 48m, 1h, 1h20m
function faltaCurto(ms){const min=Math.max(0,Math.ceil(ms/60e3));return min<60?min+'m':Math.floor(min/60)+'h'+(min%60?min%60+'m':'');}
function falta(ms){const min=Math.ceil(ms/60e3);return min<60?min+' min':Math.floor(min/60)+' h'+(min%60?' '+min%60+' min':'');}
function limitesDoUso(info){
  const j=info?.unifiedWindows;if(!j)return null;
  const janela=w=>w&&Number.isFinite(w.utilization)?{uso:w.utilization,volta:w.resetsAt>0?w.resetsAt*1000:null}:null;
  const r={cinco:janela(j.five_hour),semana:janela(j.seven_day),em:Date.now()};
  return r.cinco||r.semana?r:null;
}
function medidor(){
  const box=el('div','medidor');box.tabIndex=0;box.hidden=true;
  const texto=el('span','medidor-texto'),dica=el('div','anel-dica');dica.setAttribute('role','tooltip');
  box.append(icone('relogio'),texto,dica);
  const aviso=el('div','limite-perto');aviso.hidden=true;aviso.setAttribute('role','status');
  const avisoTexto=el('span'),fechar=el('button','limite-perto-fechar');fechar.type='button';fechar.setAttribute('aria-label','Esconder aviso');fechar.append(icone('fechar'));
  const trocar=el('button','limite-perto-trocar','Trocar de conta');trocar.type='button';trocar.hidden=true;
  trocar.addEventListener('click',e=>{e.preventDefault();m.trocar?.();});
  aviso.append(icone('relogio'),avisoTexto,trocar,fechar);
  let dados={},escondidoEm=-1;   // o × esconde até o uso subir mais 5 pontos
  fechar.addEventListener('click',e=>{e.preventDefault();escondidoEm=maior()?.uso??0;aviso.hidden=true;});
  const janelas=()=>[['limite de 5 h',dados.limites?.cinco],['limite semanal',dados.limites?.semana]].filter(([,w])=>w);
  const maior=()=>janelas().map(([nome,w])=>({nome,...w})).sort((a,b)=>b.uso-a.uso)[0];
  const linha=(a,b)=>{const p=el('p');p.append(el('strong',undefined,a+': '),document.createTextNode(b));return p;};
  const m={box,aviso,desenhar(){
    const {cache}=dados,agora=Date.now(),js=janelas();
    box.hidden=!cache&&!js.length;if(box.hidden){aviso.hidden=true;return;}
    const resta=cache?cache.ate-agora:0;
    texto.textContent=cache?faltaCurto(resta):pctUso(maior().uso);
    box.classList.toggle('vencido',!!cache&&resta<=0);
    const topo=maior();box.classList.toggle('alerta',!!topo&&topo.uso>=ALERTA_LIMITE);
    const hora=ms=>new Date(ms).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
    const ps=[];
    if(cache)ps.push(linha('Cache',resta>0?`vale até ${hora(cache.ate)} (mais ${falta(resta)})`:`venceu às ${hora(cache.ate)}`));
    for(const [nome,w] of js)ps.push(linha(nome[0].toUpperCase()+nome.slice(1),pctUso(w.uso)+' usado'+(w.volta&&w.volta>agora?' · volta '+quandoVolta(w.volta):'')));
    // o Codex manda o plano da conta junto dos limites (o Claude, não)
    if(dados.limites?.plano)ps.push(linha('Plano',nomePlano(dados.limites.plano)));
    const lidos=dados.limites?.em?'Limites lidos às '+hora(dados.limites.em)+'.':'';
    ps.push(el('p','anel-nota',!cache?lidos||'Limites da conta desta conversa.':resta<=0?'Com o cache vencido, a próxima mensagem relê a conversa inteira e gasta mais do limite.':
      'Enquanto o cache vale, mandar mensagem nesta conversa sai mais barato no limite.'+(lidos?' '+lidos:'')));
    dica.replaceChildren(...ps);
    box.setAttribute('aria-label',[cache?(resta>0?'Cache vale mais '+falta(resta):'Cache vencido'):'',...js.map(([n,w])=>n+' '+pctUso(w.uso))].filter(Boolean).join('. '));
    const mostrar=topo&&topo.uso>=ALERTA_LIMITE&&topo.uso>=escondidoEm+0.05;
    aviso.hidden=!mostrar;trocar.hidden=!m.temContas;
    if(mostrar)avisoTexto.textContent=`Tu já usou ${pctUso(topo.uso)} do ${topo.nome}.`+(topo.volta&&topo.volta>agora?` Volta ${quandoVolta(topo.volta)}.`:'');
  },atualizar(d){dados=d||{};medidores.add(m);m.desenhar();}};
  return m;
}

// ── Aviso de contexto (desde 15/10/2026). O anel já mostra quanto da janela a conversa ocupa, mas quem não sabe o
// que é contexto não lê. Uma faixa discreta no topo da caixa, como a do limite do plano, em dois cortes: "longa"
// (50%) e "quase cheia" (80%: logo o agente resume sozinho e pode perder detalhe). Duas saídas: conversa nova com
// um resumo de passagem que esta escreve (a antiga fica intacta) ou compactar aqui (/compact, Claude e Codex).
// O × esconde até o próximo corte; compactou e caiu, volta a valer do zero.
const CONTEXTO_LONGA=50,CONTEXTO_CHEIA=80;
const PEDIDO_PASSAGEM='Vou continuar este trabalho numa conversa nova. Escreve só o resumo de passagem pra ela, em markdown, sem fazer mais nada: o objetivo, o que já foi feito, as decisões e o porquê, os arquivos que importam (com o caminho), o que falta e o próximo passo.';
function nivelContexto(u){
  if(!u?.size)return 0;const pct=100*(u.used||0)/u.size;
  return pct>=CONTEXTO_CHEIA?2:pct>=CONTEXTO_LONGA?1:0;
}
function avisoContexto(aba){
  const box=el('div','limite-perto contexto-perto');box.hidden=true;box.setAttribute('role','status');
  // texto curto ("Contexto em 62%"); a explicação fica no balão (mouse ou toque), como no anel
  const texto=el('span','ctx-rotulo'),rotulo=el('span'),dica=el('div','anel-dica');texto.tabIndex=0;dica.setAttribute('role','tooltip');texto.append(rotulo,dica);
  const nova=el('button','limite-perto-trocar'),compactar=el('button','limite-perto-trocar','Compactar');
  nova.append(el('span','ctx-longo','Conversa nova'),el('span','ctx-curto','Nova'));
  const fechar=el('button','limite-perto-fechar');fechar.setAttribute('aria-label','Esconder aviso');fechar.append(icone('fechar'));
  for(const b of [nova,compactar,fechar])b.type='button';
  nova.onclick=()=>passarParaNova(aba);compactar.onclick=()=>compactarConversa(aba);
  fechar.onclick=()=>{aba.contextoEscondido=nivelContexto(aba.uso);box.hidden=true;};
  box.append(icone('contexto'),texto,nova,compactar,fechar);
  return {box,rotulo,dica,nova,compactar,fechar};
}
function desenharContexto(aba){
  const c=aba.ctxAviso;if(!c)return;
  const u=aba.uso,nivel=nivelContexto(u),pct=u?.size?Math.round(100*(u.used||0)/u.size):0;
  if(nivel<(aba.contextoEscondido??0))aba.contextoEscondido=nivel;
  const ocupado=aba.passagem?'Escrevendo o resumo pra conversa nova…':aba.compactando?'Compactando a conversa…':'';
  // quem entrou na conversa de outra pessoa não decide por ela
  const mostrar=!aba.conn&&(Boolean(ocupado)||nivel>(aba.contextoEscondido??0));
  c.box.hidden=!mostrar;if(!mostrar)return;
  c.box.classList.toggle('cheio',nivel===2&&!ocupado);
  if(ocupado)c.rotulo.textContent=ocupado;else c.rotulo.replaceChildren(el('span','ctx-longo','Contexto em '),pct+'%');
  const p=t=>el('p',undefined,t);
  c.dica.replaceChildren(...(ocupado?[p(aba.passagem?'Quando o resumo ficar pronto, a conversa nova abre com ele na caixa.':'O agente está resumindo esta conversa pra seguir nela, mais leve.')]:
    [p(nivel===2?'A conversa está quase no limite do que o agente consegue lembrar. Logo ele resume sozinho e pode esquecer detalhes.':
      'Esta conversa ficou longa: cada resposta relê tudo, então fica mais lenta e gasta mais do limite.'),
     el('p','anel-nota','Conversa nova: esta escreve um resumo e uma nova abre com ele (esta fica como está). Compactar: o agente resume esta e segue nela.')]));
  c.nova.hidden=c.compactar.hidden=c.fechar.hidden=Boolean(ocupado);
  const espera=aba.rodando?' (espera o agente terminar)':'';
  c.nova.disabled=c.compactar.disabled=aba.rodando;
  c.nova.title='Esta conversa escreve um resumo do que foi feito e uma conversa nova abre com ele. Esta fica como está.'+espera;
  c.compactar.title='O agente resume esta conversa e segue nela, mais leve. Detalhes antigos podem ficar de fora.'+espera;
}
async function passarParaNova(aba){
  if(aba.rodando||aba.passagem)return;
  aba.passagem={desde:aba.blocos.length};aba.rodando=true;estado(aba);
  try{await enviarRetomando(aba,blocosDe(PEDIDO_PASSAGEM,{citados:[],imagens:[]}));}
  catch(e){aba.passagem=null;aba.rodando=false;estado(aba);toast('Não pedi o resumo: '+e.message);}
}
async function compactarConversa(aba){
  if(aba.rodando||aba.compactando)return;
  aba.compactando=true;aba.rodando=true;estado(aba);
  try{await enviarRetomando(aba,blocosDe('/compact',{citados:[],imagens:[]}));}
  catch(e){aba.compactando=false;aba.rodando=false;estado(aba);toast('Não compactei: '+e.message);}
}
// Fim do turno: o resumo de passagem vira o começo da conversa nova (na caixa, pra pessoa dizer o próximo passo antes
// de mandar); a compactação, se o uso novo ainda não chegou, esconde o aviso até o próximo corte.
function fimContexto(aba,motivo){
  if(aba.compactando){aba.compactando=false;aba.contextoEscondido=Math.max(aba.contextoEscondido??0,nivelContexto(aba.uso));desenharContexto(aba);}
  if(!aba.passagem)return;
  const {desde}=aba.passagem;aba.passagem=null;desenharContexto(aba);
  const resumo=motivo==='end_turn'?aba.blocos.slice(desde).filter(b=>b.tipo==='assistant').map(b=>b.texto).join('\n\n').trim():'';
  if(!resumo){toast('O resumo não veio, então a conversa nova não abriu.');return;}
  const texto=`Continuando a conversa "${aba.titulo||'anterior'}". Resumo de passagem:\n\n${resumo}\n\n---\n\nAgora: `;
  window.ratoeiraNovaConversa({texto,cwd:aba.cwd}).catch(e=>toast('Não abri a conversa nova: '+e.message));
}

const TOQUE=matchMedia('(hover: none) and (pointer: coarse)').matches;

// Compositor: caixa de texto + pílulas + anel + botão enviar/parar. Serve à nova conversa e à conversa aberta.
function compositor({placeholder,comPasta=false,comTela=true,comandos=null,compacto=false,pessoas=null}){
  // compacto (conversa aberta): pílulas só com ícone, tudo numa linha; a conversa nova mostra o texto
  const raiz=el('form',compacto?'composer compacto':'composer');
  const etiquetas=el('div','etiquetas');etiquetas.hidden=true;
  const area=el('textarea');area.rows=2;area.placeholder=placeholder;area.setAttribute('aria-label','Mensagem');
  const barra=el('div','composer-barra');const esq=el('div','pilulas');const dir=el('div','composer-dir');
  // conta (várias contas do Claude) vem antes do modelo; só aparece pra quem tem mais de uma
  const conta=pilula('conta','Conta');conta.box.hidden=true;
  const modelo=pilula('claude','Modelo'),esforco=pilula('esforco','Esforço'),modo=pilula('modo','Permissões');
  const pasta=comPasta?pilula('pasta','Pasta'):null;
  esforco.desenhar=(p,menu,m)=>desenharEsforco(c,p,menu,m);
  esq.append(conta.box,modelo.box,esforco.box,modo.box);if(pasta)esq.append(pasta.box);
  const ctx=anel();ctx.box.hidden=true;
  const uso=medidor();
  const botao=el('button','enviar');botao.type='submit';botao.append(icone('enviar'));botao.setAttribute('aria-label','Enviar');
  dir.append(uso.box,ctx.box,botao);barra.append(esq,dir);raiz.append(uso.aviso,etiquetas,area,barra);
  // compacto: uma linha miúda embaixo diz o que está escolhido, na ordem dos ícones (conta · modelo · esforço · modo)
  if(compacto){
    // coluna bem estreita: conta, modelo, esforço e permissões viram um botão só, que abre a lista por cima da caixa
    const ajustes=el('button','ib pilulas-abrir');ajustes.type='button';ajustes.title='Conta, modelo, esforço e permissões';ajustes.setAttribute('aria-label','Conta, modelo, esforço e permissões');ajustes.setAttribute('aria-expanded','false');ajustes.append(icone('ajustes'));
    const abrirAjustes=v=>{raiz.classList.toggle('pilulas-abertas',v);ajustes.setAttribute('aria-expanded',String(v));};
    ajustes.onclick=e=>{e.stopPropagation();abrirAjustes(!raiz.classList.contains('pilulas-abertas'));};
    esq.addEventListener('change',()=>abrirAjustes(false));
    document.addEventListener('pointerdown',e=>{if(raiz.classList.contains('pilulas-abertas')&&!esq.contains(e.target)&&!ajustes.contains(e.target)&&!e.target.closest?.('.pmenu,.pmenu-veu'))abrirAjustes(false);});
    raiz.addEventListener('keydown',e=>{if(e.key==='Escape'&&raiz.classList.contains('pilulas-abertas')){abrirAjustes(false);ajustes.focus();}});
    barra.prepend(ajustes);
    const resumo=el('div','composer-resumo');raiz.append(resumo);
    const resumir=()=>{resumo.textContent=[conta,modelo,esforco,modo].filter(p=>!p.box.hidden).map(p=>p.box.querySelector('.pilula-texto').textContent).filter(Boolean).join(' · ');};
    new MutationObserver(resumir).observe(esq,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['hidden']});
  }
  // No celular não tem Shift: lá o Enter quebra linha e quem envia é o botão.
  if(TOQUE)area.enterKeyHint='enter';
  area.addEventListener('input',()=>{area.style.height='auto';area.style.height=Math.min(area.scrollHeight,260)+'px';});
  raiz.addEventListener('click',e=>{if(e.target===raiz||e.target===barra)area.focus();});
  const c={raiz,area,conta,modelo,esforco,modo,pasta,ctx,uso,botao,etiquetas,comTela:undefined,comArquivo:null,anterior:null,parar:null,
    // com o agente rodando: caixa vazia, o botão para; com texto, envia no meio do turno (o agente lê sem parar)
    rodando(sim){c.ocupado=sim;const parar=sim&&!area.value.trim()&&!temAnexo(c);botao.replaceChildren(icone(parar?'parar':'enviar'));botao.classList.toggle('parar',parar);
      botao.setAttribute('aria-label',parar?'Parar':sim?'Enviar agora (o agente lê sem parar)':'Enviar');botao.title=sim&&!parar?'Enviar agora: o agente lê sem parar o que está fazendo':'';botao.type=parar?'button':'submit';}};
  area.addEventListener('input',()=>{if(c.ocupado)c.rodando(true);});
  prepararAnexos(c);
  // Clipe: escolhe imagem ou arquivo (da galeria, da câmera, do computador). No celular é o único jeito (lá não tem colar nem arrastar).
  const escolher=document.createElement('input');escolher.type='file';escolher.multiple=true;escolher.hidden=true;
  escolher.onchange=()=>{const fs=[...escolher.files];escolher.value='';c.juntar(fs);};
  const clipe=el('button','clipe');clipe.type='button';clipe.append(icone('clipe'));clipe.setAttribute('aria-label','Anexar arquivo ou imagem');clipe.title='Anexar arquivo ou imagem';
  clipe.onclick=()=>escolher.click();
  dir.prepend(clipe,escolher);
  prepararDitado(c);
  if(comandos)menuSugestoes(c,{comandos,pessoas});
  // ↑ na caixa vazia traz a última mensagem; Esc com o agente rodando para (os dois como no Claude Code)
  area.addEventListener('keydown',e=>{
    if(e.isComposing)return;
    if(e.key==='ArrowUp'&&!area.value&&c.anterior){const t=c.anterior();if(t){e.preventDefault();area.value=t;area.setSelectionRange(t.length,t.length);area.dispatchEvent(new Event('input'));}}
    if(e.key==='Escape'&&c.parar?.()){e.preventDefault();}
    if(TOQUE||e.key!=='Enter'||e.shiftKey)return;e.preventDefault();if(!botao.disabled)raiz.requestSubmit();
  });
  if(comTela){compositores.add(c);desenharEtiqueta(c);}
  conta.sel.addEventListener('change',()=>trocarConta(c));
  // "Trocar de conta" da faixa dos 80% abre o seletor de conta desta caixa
  uso.trocar=()=>{if(conta.box.hidden)return false;conta.abrir();return true;};
  return c;
}

// ── Conta do agente (várias contas do Claude, desde 10/10/2026; por conversa desde 16/10/2026; do Codex desde 28/10/2026) ──
// Cada conversa tem a conta dela (um processo do Claude por conta). Na caixa de uma conversa, o seletor troca
// só a conta dela (op conversa-conta: ela dorme numa e acorda na outra, com o mesmo histórico); na de conversa
// nova, escolhe a conta com que ela nasce. A padrão (Contas de IA, op conta-usar) só vale pras novas. A lista vem
// do servidor de agentes (op contas); quando muda em outra aba ou navegador, ele avisa ({t:'conta'}) e toda caixa relê.
const comContas=new Set(),COM_CONTAS=new Set(['claude','codex']);
const usoCurto=l=>l?[l.cinco?'5h '+Math.round(l.cinco.uso*100)+'%':'',l.semana?'sem. '+Math.round(l.semana.uso*100)+'%':''].filter(Boolean).join(' · '):'';
const relendoContas={};
function carregarContas(agente){
  if(!COM_CONTAS.has(agente))return;
  clearTimeout(relendoContas[agente]);relendoContas[agente]=setTimeout(async()=>{
    try{const d=await pedir('contas',{agente});(chat.contas??={})[agente]=d;}catch{return;}
    for(const c of comContas)if(!c.raiz.isConnected)comContas.delete(c);else if(c.contaAgente===agente)desenharConta(c,agente);
  },150);
}
// aba: a conversa desta caixa (sem aba, é a caixa de conversa nova)
function desenharConta(c,agente,aba=c.contaAba??null){
  c.contaAgente=agente;c.contaAba=aba;comContas.add(c);chat.contas??={};
  if(COM_CONTAS.has(agente)&&!(agente in chat.contas)){chat.contas[agente]=null;carregarContas(agente);}
  // conversa de outra pessoa (compartilhada): roda na conta do dono, quem entrou não troca
  const d=chat.contas[agente],mostrar=Boolean(d&&d.contas.length>1&&!aba?.conn);
  c.conta.box.hidden=!mostrar;if(c.uso.temContas!==mostrar){c.uso.temContas=mostrar;c.uso.desenhar();}if(!mostrar)return;
  const tem=id=>id&&d.contas.some(x=>x.id===id);
  const atual=aba?(tem(aba.conta)?aba.conta:d.ativa):(tem(c.contaNova)?c.contaNova:d.ativa);
  opcoes(c.conta.sel,[{itens:d.contas.map(x=>({id:x.id,label:[x.nome,x.id===d.ativa?'padrão':'',usoCurto(x.limites)].filter(Boolean).join(' · '),curto:x.nome}))}],atual);c.conta.atualizar();
  const ocupada=Boolean(aba?.rodando);c.conta.sel.disabled=ocupada;
  if(!aba)modelosDaConta(c);
  const qual=agente==='codex'?'do Codex':'do Claude';
  c.conta.box.title=!aba?'Conta '+qual+' desta conversa nova':ocupada?'Esta conversa está respondendo: espere terminar ou pare antes de trocar a conta':'Conta '+qual+' desta conversa (as outras ficam como estão)';
}
async function trocarConta(c){
  const agente=c.contaAgente,d=chat.contas?.[agente],alvo=c.conta.sel.value,aba=c.contaAba;
  if(!d)return;
  const nome=d.contas.find(x=>x.id===alvo)?.nome||'a outra conta';
  if(!aba){c.contaNova=alvo;modelosDaConta(c);return;}
  if(alvo===aba.conta)return;
  try{const r=await pedirAba(aba,'conversa-conta',{conta:alvo});aba.conta=r.conta??alvo;toast('Esta conversa agora usa '+nome+'.');}
  catch(e){toast(e.message);}
  desenharConta(c,agente,aba);
}

// Sugestões na caixa de mensagem, num menu acima dela (na Início, abaixo):
//  /  no começo da mensagem: comandos e skills que o agente anunciou (available_commands_update do ACP).
//     A mensagem vai como texto (`/nome args`): quem roda o comando ou a skill é o próprio agente.
//  @  no começo ou depois de espaço: arquivo ou pasta do repositório, pela mesma busca da área Arquivos.
//     Vira `@caminho` no texto e um resource_link na mensagem (o agente recebe o caminho inteiro).
// ↑↓ escolhem, Enter ou Tab completam, Esc fecha.
function menuSugestoes(c,{comandos,pessoas=null}){
  const {raiz,area}=c;
  const menu=el('ul','cmd-menu');menu.hidden=true;menu.setAttribute('role','listbox');menu.id='cmd-'+Math.random().toString(36).slice(2,8);
  area.setAttribute('aria-controls',menu.id);area.setAttribute('aria-autocomplete','list');
  raiz.prepend(menu);
  const fontes=[
    {achar:(v)=>{const m=/^\/(\S*)$/.exec(v.texto);return m&&{de:0,ate:v.texto.length,termo:m[1].toLowerCase()};},
      // `comandos` devolve a lista (ou uma promessa dela): a da conversa aberta, ou a última vista do agente na nova
      lista:()=>comandos(),guardar:true,
      // começa com o que foi digitado primeiro; depois quem tem no meio do nome ou na descrição
      filtrar:(lista,m)=>{const nome=x=>String(x.name||'').toLowerCase();
        return [...lista.filter(x=>nome(x).startsWith(m)),...lista.filter(x=>!nome(x).startsWith(m)&&(nome(x).includes(m)||String(x.description||'').toLowerCase().includes(m)))];},
      item:x=>({nome:'/'+x.name,hint:x.input?.hint,desc:x.description}),
      vazio:(m,lista)=>!lista.length&&!m?'O agente ainda não mandou os comandos. Abre de novo em uns segundos.':null,
      inserir:x=>'/'+x.name+' '},
    {achar:(v)=>{const antes=v.texto.slice(0,v.cursor);const m=/(^|\s)@([^\s@]*)$/.exec(antes);if(!m)return null;
        return {de:antes.length-m[2].length-1,ate:v.cursor+/^\S*/.exec(v.texto.slice(v.cursor))[0].length,termo:m[2]};},
      // na conversa aberta, as pessoas vêm primeiro (marcar avisa; quem não está, o dono convida); depois os arquivos
      lista:async m=>{
        const sem=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
        const gente=pessoas?(await pessoas().catch(()=>[])).filter(p=>!m||sem(p.nome).split(/\s+/).some(w=>w.startsWith(sem(m)))||sem(p.email).startsWith(sem(m))).map(p=>({...p,pessoa:true})):[];
        const arqs=m.length<2?[]:(await apiArquivos('busca?q='+encodeURIComponent(m))).itens||[];
        return [...gente,...arqs];},espera:150,
      item:x=>x.pessoa?{nome:x.nome,desc:x.dentro?'na conversa · avisa no sino':'convida pra conversa (pode entrar)',icone:'compartilhar'}:{nome:x.nome,desc:x.caminho,icone:x.tipo==='pasta'?'pasta':null},
      vazio:m=>m.length<2?(pessoas?'Digita o nome de alguém, ou parte do nome do arquivo':'Digita parte do nome do arquivo ou da pasta'):'Nada com esse nome',
      inserir:x=>{if(x.pessoa){(c.mencoes??=new Map()).set(x.email,x);return '@'+x.nome+' ';}c.citados.add(x.caminho);return '@'+x.caminho+' ';}},
  ];
  let ativo=null,itens=[],sel=0,pedido=0,timer=null;const guardadas=new Map();
  const abrir=()=>{menu.hidden=false;area.setAttribute('aria-expanded','true');};
  const fechar=()=>{pedido++;clearTimeout(timer);ativo=null;menu.hidden=true;itens=[];area.removeAttribute('aria-activedescendant');area.setAttribute('aria-expanded','false');};
  const marcar=()=>{[...menu.children].forEach((li,i)=>{li.classList.toggle('ativo',i===sel);li.setAttribute('aria-selected',String(i===sel));if(i===sel){area.setAttribute('aria-activedescendant',li.id);li.scrollIntoView({block:'nearest'});}});};
  function escolher(i){
    const x=itens[i];if(!x||!ativo)return;const {f,r}=ativo;
    const novo=f.inserir(x);area.value=area.value.slice(0,r.de)+novo+area.value.slice(r.ate);
    const pos=r.de+novo.length;area.setSelectionRange(pos,pos);fechar();area.dispatchEvent(new Event('input'));area.focus();
  }
  async function atualizar(){
    const v={texto:area.value,cursor:area.selectionStart};
    let f=null,r=null;for(const x of fontes){r=x.achar(v);if(r){f=x;break;}}
    if(!f)return fechar();
    const meu=++pedido;ativo={f,r};
    // desenha já com a última lista e de novo quando a atual chegar (na conversa nova ela vem do servidor)
    if(guardadas.has(f))desenhar(f,guardadas.get(f),r.termo);
    if(f.espera){clearTimeout(timer);await new Promise(ok=>{timer=setTimeout(ok,f.espera);});if(meu!==pedido)return;}
    let lista;try{lista=await f.lista(r.termo);}catch{lista=[];}
    if(meu!==pedido)return;
    lista=Array.isArray(lista)?lista:[];if(f.guardar)guardadas.set(f,lista);
    desenhar(f,lista,r.termo);
  }
  function desenhar(f,lista,termo){
    itens=(f.filtrar?f.filtrar(lista,termo):lista).slice(0,60);
    menu.replaceChildren();
    if(!itens.length){const aviso=f.vazio?.(termo,lista);if(!aviso)return fechar();menu.append(el('li','cmd-vazio',aviso));abrir();return;}
    itens.forEach((x,i)=>{
      const v=f.item(x);const li=el('li','cmd');li.id=menu.id+'-'+i;li.setAttribute('role','option');
      const n=el('span','cmd-nome');if(v.icone)n.append(icone(v.icone));n.append(v.nome);if(v.hint)n.append(el('span','cmd-hint',' '+v.hint));
      li.append(n);if(v.desc)li.append(el('span','cmd-desc',v.desc));
      li.addEventListener('mousedown',e=>{e.preventDefault();escolher(i);});li.addEventListener('mousemove',()=>{if(sel!==i){sel=i;marcar();}});
      menu.append(li);
    });
    sel=Math.min(sel,itens.length-1);abrir();marcar();
  }
  area.addEventListener('input',()=>{sel=0;atualizar();});
  area.addEventListener('click',atualizar);
  area.addEventListener('blur',()=>setTimeout(fechar,100));
  // a lista de comandos já vem ao focar a caixa, pra o primeiro `/` não esperar o servidor
  area.addEventListener('focus',()=>{if(!guardadas.has(fontes[0]))Promise.resolve().then(comandos).then(l=>{if(Array.isArray(l)&&l.length&&!guardadas.has(fontes[0]))guardadas.set(fontes[0],l);}).catch(()=>{});});
  // registrado antes do Enter-envia do compositor: com o menu aberto, Enter completa em vez de enviar
  area.addEventListener('keydown',e=>{
    if(menu.hidden||e.isComposing)return;
    if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();fechar();return;}
    if(!itens.length)return;
    if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();e.stopImmediatePropagation();sel=(sel+(e.key==='ArrowDown'?1:-1)+itens.length)%itens.length;marcar();return;}
    if((e.key==='Enter'&&!e.shiftKey)||e.key==='Tab'){e.preventDefault();e.stopImmediatePropagation();escolher(sel);}
  });
}

// Imagem colada ou arrastada pra caixa: vai junto da mensagem (bloco image do ACP). Grande demais, reduz pra
// 1568 px no lado maior (o tamanho em que o Claude lê) e vira JPEG, pra mensagem não passar de ~1 MB.
const TIPOS_IMAGEM=['image/png','image/jpeg','image/gif','image/webp'],LADO_IMAGEM=1568,MAX_IMAGENS=6;
const dataUrl=f=>new Promise((ok,no)=>{const r=new FileReader();r.onload=()=>ok(String(r.result));r.onerror=()=>no(r.error);r.readAsDataURL(f);});
async function lerImagem(arquivo){
  const url=await dataUrl(arquivo);
  const img=await new Promise((ok,no)=>{const i=new Image();i.onload=()=>ok(i);i.onerror=()=>no(new Error('Não consegui ler a imagem.'));i.src=url;});
  const lado=Math.max(img.naturalWidth,img.naturalHeight);
  if(lado<=LADO_IMAGEM&&arquivo.size<=1.2e6&&TIPOS_IMAGEM.includes(arquivo.type))return {mimeType:arquivo.type,data:url.slice(url.indexOf(',')+1)};
  const k=Math.min(1,LADO_IMAGEM/lado),w=Math.round(img.naturalWidth*k),h=Math.round(img.naturalHeight*k);
  const cv=document.createElement('canvas');cv.width=w;cv.height=h;const g=cv.getContext('2d');g.fillStyle='#fff';g.fillRect(0,0,w,h);g.drawImage(img,0,0,w,h);
  const d=cv.toDataURL('image/jpeg',.85);return {mimeType:'image/jpeg',data:d.slice(d.indexOf(',')+1)};
}
// Outro arquivo (PDF, planilha, zip, código…) colado, arrastado ou escolhido no clipe: nenhum dos dois agentes
// recebe esses tipos direto pelo ACP. Na hora de enviar ele sobe pro servidor de agentes (op anexo, fora do git,
// some em 30 dias) e o caminho vai no fim do texto, num <ratoeira-anexos> que o agente lê e o balão mostra como
// etiqueta. Imagem que o navegador não abre (HEIC, SVG) ou que passa das 6 vai do mesmo jeito.
const MAX_ARQUIVOS=10,MAX_ANEXO=14*1024*1024;
const ANEXOS=/\n*<ratoeira-anexos>\n?([\s\S]*?)\n?<\/ratoeira-anexos>\s*$/;
// mensagem mandada com o agente rodando: o servidor de agentes junta um pedido pra ele responder antes de seguir
// (servidor.mjs, DURANTE). Fica no histórico do agente; a tela tira.
const DURANTE=/\s*<ratoeira-durante>[\s\S]*?<\/ratoeira-durante>\s*/g;
const anexosDoTexto=t=>[...t.matchAll(/^- (.+) \(([^()]*)\): (\/.+)$/gm)].map(x=>({nome:x[1],tamanho:x[2],caminho:x[3]}));
// na fila e na cópia da conversa: só os nomes (o texto da fila vem cortado, às vezes sem o fecho)
const semAnexos=t=>String(t??'').replace(/\n*<ratoeira-anexos>[\s\S]*$/,m=>{const n=anexosDoTexto(m).map(a=>a.nome);return n.length?(t.startsWith('<ratoeira-anexos>')?'':' ')+'(anexou '+n.join(', ')+')':'';});
const temAnexo=c=>Boolean(c.imagens?.length||c.arquivos?.length);
const tamanhoLegivel=b=>b<1024?b+' B':b<1048576?Math.round(b/1024)+' KB':(b/1048576).toFixed(1).replace('.',',')+' MB';
function prepararAnexos(c){
  c.citados=new Set();c.imagens=[];c.arquivos=[];
  const caixa=el('div','anexos');caixa.hidden=true;c.raiz.insertBefore(caixa,c.area);c.anexos=caixa;
  async function juntar(arquivos){
    for(const f of arquivos){
      if(TIPOS_IMAGEM.includes(f.type)&&c.imagens.length<MAX_IMAGENS){
        try{c.imagens.push(await lerImagem(f));continue;}catch{}
      }
      // pasta solta do Finder chega como arquivo vazio e sem tipo
      if(!f.size){toast(f.type?'O arquivo '+f.name+' está vazio.':'Pasta não dá pra soltar aqui: solta os arquivos de dentro dela.');continue;}
      if(f.size>MAX_ANEXO){toast(f.name+' passa de '+Math.round(MAX_ANEXO/1048576)+' MB. Pra arquivo grande, envia pela árvore da Mesa.');continue;}
      if(c.arquivos.length>=MAX_ARQUIVOS){toast('No máximo '+MAX_ARQUIVOS+' arquivos por mensagem.');break;}
      c.arquivos.push({arquivo:f,nome:f.name,tamanho:f.size});
    }
    desenharAnexos(c);if(c.ocupado)c.rodando(true);
  }
  c.juntar=juntar;
  c.area.addEventListener('paste',e=>{const fs=[...(e.clipboardData?.files||[])];if(fs.length){e.preventDefault();juntar(fs);}});
  c.raiz.addEventListener('dragover',e=>{if([...(e.dataTransfer?.items||[])].some(i=>i.kind==='file')){e.preventDefault();c.raiz.classList.add('soltando');}});
  c.raiz.addEventListener('dragleave',e=>{if(!c.raiz.contains(e.relatedTarget))c.raiz.classList.remove('soltando');});
  c.raiz.addEventListener('drop',e=>{c.raiz.classList.remove('soltando');const fs=e.dataTransfer?.files;if(fs?.length){e.preventDefault();juntar(fs);}});
}
function desenharAnexos(c){
  c.anexos.replaceChildren();c.anexos.hidden=!temAnexo(c);
  const tirar=(rotulo,fn)=>{const x=el('button','anexo-x');x.type='button';x.setAttribute('aria-label',rotulo);x.title=rotulo;x.append(icone('fechar'));
    x.onclick=()=>{fn();desenharAnexos(c);if(c.ocupado)c.rodando(true);c.area.focus();};return x;};
  c.imagens.forEach((im,i)=>{
    const b=el('div','anexo');const img=el('img');img.src='data:'+im.mimeType+';base64,'+im.data;img.alt='Imagem '+(i+1);
    b.append(img,tirar('Tirar a imagem '+(i+1),()=>c.imagens.splice(i,1)));c.anexos.append(b);
  });
  c.arquivos.forEach((a,i)=>{
    const b=el('div','anexo anexo-arquivo');b.title=a.nome;
    b.append(icone('arquivo'),el('span','anexo-nome',a.nome),el('span','anexo-tam',tamanhoLegivel(a.tamanho)),tirar('Tirar '+a.nome,()=>c.arquivos.splice(i,1)));
    c.anexos.append(b);
  });
}
// O que vai pro agente: o texto, cada arquivo citado com @ que ainda está no texto, as imagens e os outros arquivos.
function anexosDe(c){const arquivo=arquivoDe(c);return {citados:[...new Set([...c.citados,...(arquivo?[arquivo]:[])])],imagens:[...c.imagens],arquivos:[...c.arquivos],arquivo};}
function limparAnexos(c){c.citados.clear();c.imagens=[];c.arquivos=[];desenharAnexos(c);}
// Sobe os arquivos (pedirFn: pro próprio servidor, ou pro do dono numa conversa compartilhada) e junta o
// <ratoeira-anexos> ao texto. Sem arquivo, devolve o texto como veio.
async function comArquivos(texto,{arquivos},pedirFn){
  if(!arquivos?.length)return texto;
  const total=arquivos.reduce((s,a)=>s+a.tamanho,0);if(total>1048576)toast('Subindo '+(arquivos.length>1?arquivos.length+' arquivos':arquivos[0].nome)+' ('+tamanhoLegivel(total)+')…');
  const linhas=[];
  for(const a of arquivos){
    const d=await dataUrl(a.arquivo);
    const r=await pedirFn('anexo',{nome:a.nome,dados:d.slice(d.indexOf(',')+1)});
    linhas.push('- '+r.nome+' ('+tamanhoLegivel(r.tamanho)+'): '+r.caminho);
  }
  const bloco='<ratoeira-anexos>\nArquivos que anexei, já salvos no servidor (lê pelo caminho):\n'+linhas.join('\n')+'\n</ratoeira-anexos>';
  return texto?texto+'\n\n'+bloco:bloco;
}
function blocosDe(texto,{citados,imagens}){
  const blocos=[];if(texto.trim())blocos.push({type:'text',text:texto});
  for(const rel of citados)if(texto.includes('@'+rel)||texto.includes('Arquivo aberto na tela: '+rel+'.'))blocos.push({type:'resource_link',uri:'file://'+encodeURI(chat.info.pastaPadrao+'/'+rel),name:rel.split('/').pop()});
  for(const im of imagens)blocos.push({type:'image',mimeType:im.mimeType,data:im.data});
  return blocos;
}

// ── Ditado: microfone do compositor ─────────────────────────────────────────
// Grava aqui, manda o áudio pro servidor de agentes (op transcrever: AssemblyAI com chave, senão o motor da própria VPS,
// Configurações › Organização › Ditado) e põe o texto onde está o cursor, somando ao
// que já tem. Nunca envia sozinho: a pessoa corrige e manda. Cada pedaço (1 s) vai pro IndexedDB enquanto grava, e
// o áudio vira um cartão na caixa desde que a gravação para até o texto entrar: transcrevendo, não transcreveu (com
// tentar de novo, e sozinho quando o erro é de rede), não entendeu nada ou texto pronto pra inserir. Só sai do
// navegador quando o texto entra numa caixa. Decisão: docs/2026-10-10-ditado-no-chat.md.
const DITADO_MAX_MS=10*60000,DITADO_FATIA=1000;
const DITADO_ESPERAS=[5000,15000,45000,120000];   // tentativas sozinhas quando o erro é de rede
const podeDitar=Boolean(navigator.mediaDevices?.getUserMedia&&window.MediaRecorder);
const ditado={db:null,gravando:null,audios:[],caixas:new Set()};
const tempo=ms=>{const s=Math.max(0,Math.round(ms/1000));return Math.floor(s/60)+':'+String(s%60).padStart(2,'0');};
// IndexedDB: gravacoes {id, mime, inicio, duracao, raiz, texto?} e pedacos {gravacao, n, blob}. Sem ele (aba anônima,
// armazenamento bloqueado) o ditado funciona igual, só não sobrevive a recarregar.
function banco(){
  return ditado.db??=new Promise((ok,no)=>{
    const r=indexedDB.open('ratoeira-ditado',1);
    r.onupgradeneeded=()=>{const db=r.result;db.createObjectStore('gravacoes',{keyPath:'id'});db.createObjectStore('pedacos',{autoIncrement:true}).createIndex('gravacao','gravacao');};
    r.onsuccess=()=>ok(r.result);r.onerror=()=>no(r.error);r.onblocked=()=>no(new Error('IndexedDB bloqueado'));
  }).catch(e=>{ditado.db=Promise.reject(e);ditado.db.catch(()=>{});throw e;});
}
// uma transação: fn(lojas) faz os pedidos e devolve uma função que lê o resultado no fim
async function tx(nomes,modo,fn){
  try{const db=await banco();return await new Promise((ok,no)=>{const t=db.transaction(nomes,modo);const lojas=nomes.map(n=>t.objectStore(n));const ler=fn(...lojas);
    t.oncomplete=()=>ok(typeof ler==='function'?ler():undefined);t.onerror=()=>no(t.error);t.onabort=()=>no(t.error);});}
  catch{return undefined;}
}
const guardarGravacao=g=>tx(['gravacoes'],'readwrite',s=>{s.put(g);});
const guardarPedaco=(id,n,blob)=>tx(['pedacos'],'readwrite',s=>{s.add({gravacao:id,n,blob});});
const pedacosDe=id=>tx(['pedacos'],'readonly',s=>{const r=s.index('gravacao').getAll(id);return ()=>(r.result||[]).sort((a,b)=>a.n-b.n).map(p=>p.blob);});
const apagarGravacao=id=>tx(['gravacoes','pedacos'],'readwrite',(g,p)=>{g.delete(id);const r=p.index('gravacao').getAllKeys(id);r.onsuccess=()=>{for(const k of r.result)p.delete(k);};});
const gravacoesGuardadas=()=>tx(['gravacoes'],'readonly',s=>{const r=s.getAll();return ()=>r.result||[];});
const metaDe=a=>({id:a.id,mime:a.mime,inicio:a.inicio,duracao:a.duracao,raiz:a.raiz,...(a.texto?{texto:a.texto}:{})});

function prepararDitado(c){
  if(!podeDitar)return;
  const mic=el('button','microfone');mic.type='button';mic.append(icone('microfone'));
  const status=el('div','ditado-status');status.hidden=true;status.setAttribute('aria-live','polite');
  const cartoes=el('div','ditado-pendentes');cartoes.hidden=true;cartoes.setAttribute('aria-live','polite');c.raiz.insertBefore(cartoes,c.area);
  c.ditado={mic,status,cartoes};
  mic.onclick=()=>{const g=ditado.gravando;if(g?.c===c)pararDitado();else if(!g)comecarDitado(c);else toast('Já tem um áudio gravando em outra caixa.');};
  c.botao.before(status,mic);
  ditado.caixas.add(c);desenharDitado(c);
}
const viva=c=>Boolean(c)&&(c.raiz.isConnected||c===novo);
// o cartão aparece na caixa onde o áudio foi gravado; se ela fechou (ou o áudio é de outra visita), em todas
const cartoesDe=c=>ditado.audios.filter(a=>a.c===c||!viva(a.c));
function desenharDitado(c){
  if(!c.ditado)return;
  const {mic,status,cartoes}=c.ditado,g=ditado.gravando,minha=g?.c===c;
  mic.classList.toggle('gravando',minha);mic.replaceChildren(icone(minha?'parar':'microfone'));
  const rotulo=minha?'Parar e transcrever':'Ditar (gravar áudio)';mic.setAttribute('aria-label',rotulo);mic.title=rotulo;
  c.raiz.classList.toggle('ditando',minha);
  status.hidden=!minha;status.replaceChildren();
  if(minha){
    const x=el('button','ditado-cancelar');x.type='button';x.append(icone('fechar'));x.setAttribute('aria-label','Descartar o áudio');x.title='Descartar (Esc)';x.onclick=()=>pararDitado({cancelar:true});
    status.append(x,el('span','ditado-ponto'),el('span','ditado-tempo',tempo(Date.now()-g.inicio)));
  }
  cartoes.replaceChildren();
  const lista=cartoesDe(c);cartoes.hidden=!lista.length;
  for(const a of lista)cartoes.append(cartaoDitado(a,c));
}
function cartaoDitado(a,c){
  const chip=el('div','etiqueta ditado-pendente');chip.dataset.estado=a.estado;
  const botao=(texto,fn,cls='ditado-tentar')=>{const b=el('button',cls,texto);b.type='button';b.onclick=fn;return b;};
  const rotulo={transcrevendo:'Transcrevendo',erro:'Não transcreveu',vazio:'Não entendi nada',pronto:'Texto pronto'}[a.estado];
  chip.append(icone(a.estado==='transcrevendo'?'carregando':'microfone'),el('span','etiqueta-app',rotulo),el('span','etiqueta-tela',tempo(a.duracao)));
  if(a.estado==='transcrevendo'){chip.title='Mandando o áudio e esperando o texto';chip.append(botao('Parar',()=>pararEspera(a),'ditado-parar'));}
  else if(a.estado==='pronto'){chip.title=a.texto;chip.append(botao('Inserir',()=>entregar(a,c)));}
  else{
    chip.title=a.estado==='vazio'?'O áudio chegou, mas não veio texto. Confere o microfone e tenta de novo.':'Não transcreveu: '+a.erro;
    if(a.proxima)chip.append(el('span','ditado-proxima','de novo em '+Math.max(1,Math.ceil((a.proxima-Date.now())/1000))+' s'));
    chip.append(botao('Tentar de novo',()=>transcreverDitado(a,c)));
  }
  if(a.estado!=='transcrevendo'){
    const x=el('button','etiqueta-x');x.type='button';x.append(icone('fechar'));x.setAttribute('aria-label','Descartar o áudio');
    x.onclick=()=>{if(!confirm(a.estado==='pronto'?'Descartar esse texto?':'Descartar esse áudio de '+tempo(a.duracao)+'? Não dá pra desfazer.'))return;esquecer(a);};
    chip.append(x);
  }
  return chip;
}
function redesenharDitado(){for(const c of [...ditado.caixas]){if(!viva(c)){ditado.caixas.delete(c);continue;}desenharDitado(c);}}
// a contagem "de novo em N s" anda sozinha
setInterval(()=>{if(ditado.audios.some(a=>a.proxima))redesenharDitado();},1000);
function esquecer(a){clearTimeout(a.timer);a.espera?.no(new Error('parado'));ditado.audios=ditado.audios.filter(x=>x!==a);apagarGravacao(a.id);redesenharDitado();}

// Tela acesa enquanto grava: sem isso o celular apaga a tela no meio do áudio. O navegador solta a trava quando a
// página sai da frente; voltando com a gravação ainda rolando, pede de novo. Navegador sem Wake Lock só segue igual.
const telaAcesa={trava:null};
async function manterTelaAcesa(sim){
  if(!sim){const t=telaAcesa.trava;telaAcesa.trava=null;t?.release().catch(()=>{});return;}
  if(telaAcesa.trava||!navigator.wakeLock)return;
  try{const t=await navigator.wakeLock.request('screen');if(ditado.gravando&&!telaAcesa.trava){telaAcesa.trava=t;t.addEventListener('release',()=>{if(telaAcesa.trava===t)telaAcesa.trava=null;});}else t.release().catch(()=>{});}catch{}
}
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&ditado.gravando)manterTelaAcesa(true);});
async function comecarDitado(c){
  let stream;
  try{stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}});}
  catch(e){toast(e?.name==='NotAllowedError'?'O navegador não liberou o microfone. Libera nas permissões do site e tenta de novo.':'Não achei microfone neste aparelho.');return;}
  if(ditado.gravando){stream.getTracks().forEach(t=>t.stop());return;}
  // webm/opus no Chrome, Firefox e Safari 18.4+; mp4/aac no Safari mais antigo
  const tipo=['audio/webm;codecs=opus','audio/webm','audio/mp4','audio/ogg;codecs=opus'].find(t=>MediaRecorder.isTypeSupported(t));
  let rec;
  try{rec=new MediaRecorder(stream,{...(tipo?{mimeType:tipo}:{}),audioBitsPerSecond:32000});}
  catch{stream.getTracks().forEach(t=>t.stop());toast('Este navegador não grava áudio.');return;}
  const g={id:Date.now().toString(36)+Math.random().toString(36).slice(2,7),mime:(rec.mimeType||tipo||'audio/webm').split(';')[0],inicio:Date.now(),
    raiz:chat.info?.pastaPadrao??null,blobs:[],n:0,c,rec,stream,cancelar:false};
  ditado.gravando=g;manterTelaAcesa(true);
  guardarGravacao({id:g.id,mime:g.mime,inicio:g.inicio,duracao:0,raiz:g.raiz});
  rec.ondataavailable=e=>{if(!e.data?.size||g.cancelar)return;g.blobs.push(e.data);guardarPedaco(g.id,g.n++,e.data);};
  rec.onstop=()=>{stream.getTracks().forEach(t=>t.stop());clearInterval(g.relogio);terminarDitado(g);};
  rec.onerror=()=>{try{rec.stop();}catch{}};
  rec.start(DITADO_FATIA);
  // motor da VPS: o modelo carrega (~8 s) enquanto a pessoa fala, não depois
  pedir('ditado-aquecer',{}).catch(()=>{});
  g.relogio=setInterval(()=>{const ms=Date.now()-g.inicio;if(ms>=DITADO_MAX_MS){toast('Chegou em 10 minutos: parei a gravação.');pararDitado();return;}
    const t=c.ditado.status.querySelector('.ditado-tempo');if(t)t.textContent=tempo(ms);},250);
  redesenharDitado();
}
function pararDitado({cancelar=false}={}){
  const g=ditado.gravando;if(!g)return;g.cancelar=cancelar;g.duracao=Date.now()-g.inicio;
  if(g.rec.state!=='inactive')g.rec.stop();else terminarDitado(g);
}
async function terminarDitado(g){
  if(ditado.gravando!==g)return;
  ditado.gravando=null;manterTelaAcesa(false);
  if(g.cancelar||g.duracao<400){await apagarGravacao(g.id);redesenharDitado();g.c.area.focus();return;}
  if(!g.blobs.length){await apagarGravacao(g.id);redesenharDitado();toast('O navegador não entregou áudio nenhum. Confere o microfone e grava de novo.');return;}
  const a={id:g.id,mime:g.mime,inicio:g.inicio,duracao:g.duracao,raiz:g.raiz,blob:new Blob(g.blobs,{type:g.mime}),c:g.c,estado:'transcrevendo',tentativas:0};
  ditado.audios.push(a);
  await guardarGravacao(metaDe(a));
  transcreverDitado(a,g.c);
}
// erro de rede (ou do serviço fora do ar) tenta de novo sozinho; chave, formato e afins esperam a pessoa
const passageiro=m=>/conexão|internet|não chegou|não consegui falar|fora do ar|ocupado|não respondeu|ambiente/i.test(m);
// quanto esperar a resposta: ida do áudio numa rede ruim (~15 KB/s) + a transcrição (até a duração da fala) + folga
const prazoDe=a=>Math.min(10*60000,30000+a.blob.size/15+a.duracao);
function pararEspera(a){a.espera?.no(Object.assign(new Error('Parei de esperar. O áudio continua aqui.'),{parado:true}));}
async function transcreverDitado(a,c){
  if(a.estado==='transcrevendo'&&a.espera)return;
  clearTimeout(a.timer);a.proxima=null;
  a.c=c;a.estado='transcrevendo';a.erro=null;redesenharDitado();
  try{
    if(navigator.onLine===false)throw new Error('Sem internet agora.');
    a.blob??=new Blob((await pedacosDe(a.id))||[],{type:a.mime});
    if(!a.blob.size)throw Object.assign(new Error('O áudio guardado se perdeu neste navegador.'),{perdido:true});
    const url=await dataUrl(a.blob);
    // a espera pode ser cortada pelo botão Parar ou pelo prazo (conexão meio morta: o pedido sai e a resposta nunca volta)
    const r=await new Promise((ok,no)=>{
      const fim=e=>{clearTimeout(t);a.espera=null;no(e);};
      const t=setTimeout(()=>fim(new Error('A resposta não chegou a tempo (a conexão está lenta ou caiu).')),prazoDe(a));
      a.espera={no:fim};
      pedir('transcrever',{audio:url.slice(url.indexOf(',')+1),mime:a.mime,duracaoMs:Math.round(a.duracao),raiz:a.raiz})
        .then(v=>{if(!a.espera)return;clearTimeout(t);a.espera=null;ok(v);},e=>{if(a.espera)fim(
          // servidor de agentes de antes do ditado (publicado, mas ainda não religou): o pedido não existe nele
          /Pedido desconhecido/.test(e.message)?new Error('Teu servidor de agentes ainda está na versão de antes do ditado: vale quando ele religar.'):e);});
    });
    a.tentativas=0;
    if(!r?.texto){a.estado='vazio';return;}
    a.texto=r.texto;a.estado='pronto';guardarGravacao(metaDe(a));
    entregar(a,c);
  }catch(e){
    if(e.perdido){esquecer(a);toast(e.message);return;}
    a.estado='erro';a.erro=e.message;
    if(!e.parado&&passageiro(e.message)&&a.tentativas<DITADO_ESPERAS.length&&viva(a.c)){
      const ms=DITADO_ESPERAS[a.tentativas++];a.proxima=Date.now()+ms;a.timer=setTimeout(()=>transcreverDitado(a,a.c),ms);
    }
  }finally{a.espera=null;redesenharDitado();}
}
// texto pronto entra na caixa (a do áudio, ou a que a pessoa clicou); caixa travada ou fechada: fica o cartão "Inserir"
function entregar(a,c){
  if(!viva(c)||c.area.disabled){a.estado='pronto';redesenharDitado();return;}
  inserirDitado(c,a.texto);ditado.audios=ditado.audios.filter(x=>x!==a);apagarGravacao(a.id);redesenharDitado();
}
// entra onde está o cursor (ou no fim), com espaço dos dois lados quando precisa
function inserirDitado(c,texto){
  const a=c.area,v=a.value,ini=a.selectionStart??v.length,fim=a.selectionEnd??ini;
  const antes=v.slice(0,ini),depois=v.slice(fim);
  const t=(antes&&!/\s$/.test(antes)?' ':'')+texto+(depois&&!/^\s/.test(depois)?' ':'');
  a.value=antes+t+depois;a.focus();const pos=antes.length+t.length;a.setSelectionRange(pos,pos);a.dispatchEvent(new Event('input'));
}
// Esc descarta a gravação (antes do Esc da caixa, que pararia o agente)
addEventListener('keydown',e=>{if(e.key==='Escape'&&ditado.gravando){e.preventDefault();e.stopImmediatePropagation();pararDitado({cancelar:true});}},true);
// voltou a internet: tenta já os que falharam nesta visita (os de outra visita esperam a pessoa clicar)
addEventListener('online',()=>{for(const a of ditado.audios)if(a.estado==='erro'&&viva(a.c))transcreverDitado(a,a.c);});
// o que ficou de outra visita (inclusive gravação cortada no meio: aba fechada, celular travou) volta como cartão
if(podeDitar)gravacoesGuardadas().then(async lista=>{
  for(const g of lista||[]){
    if(ditado.gravando?.id===g.id||ditado.audios.some(a=>a.id===g.id))continue;
    if(g.texto){ditado.audios.push({...g,c:null,estado:'pronto',tentativas:0});continue;}
    const blobs=await pedacosDe(g.id);
    if(!blobs?.length){apagarGravacao(g.id);continue;}
    ditado.audios.push({...g,c:null,duracao:g.duracao||blobs.length*DITADO_FATIA,estado:'erro',tentativas:0,
      erro:g.duracao?'ficou guardado de outra visita':'a gravação foi interrompida'});
  }
  redesenharDitado();
});

// ── Tela da aplicação aberta do lado (ex.: Pedidos) ─────────────────────────
// Cada caixa de mensagem sugere, em etiqueta apagada ("+ Pedidos"), a tela atual da aplicação (a aba de aplicação
// que teve foco por último, ver portal.js). Nada vai sozinho: um clique põe a etiqueta, e aí a mensagem leva a tela
// como contexto e, se a aplicação conversa pelo chat (config apps[].chat), a conversa ganha as ferramentas dela
// (MCP). O × tira. Vale só pra aquela caixa e pra aquela aplicação: trocou de aba, volta a ser sugestão. Fica de fora
// da Início, que não tem aplicação do lado. No modo foco (só a aplicação e o chat) e na nova conversa pedida no
// painel da aplicação (novaConversaDoPainel), a etiqueta já vem posta.
const compositores=new Set();
const telaAtual=()=>window.ratoeiraApps?.atual()??null;
const comTelaPosta=(c,t)=>c.comTela===t.url||(c.comTela===undefined&&'foco' in document.documentElement.dataset);
function telaDe(c){const t=telaAtual();return t&&comTelaPosta(c,t)?t:null;}
function desenharEtiqueta(c){
  const t=telaAtual(),rel=window.ratoeiraArquivoAtivo?.()||null;const box=c.etiquetas;box.replaceChildren();box.hidden=!t&&!rel;
  const fantasma=(rotulo,dica,fn)=>{const b=el('button','etiqueta fantasma');b.type='button';b.append(el('span',undefined,'+ '+rotulo));b.title=dica;b.onclick=()=>{fn();desenharEtiqueta(c);c.area.focus();};box.append(b);};
  const xis=(e,rotulo,fn)=>{const x=el('button','etiqueta-x');x.type='button';x.setAttribute('aria-label',rotulo);x.title=rotulo;x.append(icone('fechar'));x.onclick=()=>{fn();desenharEtiqueta(c);c.area.focus();};e.append(x);};
  if(t){
    if(!comTelaPosta(c,t))fantasma(t.app.name,'Mandar a tela do '+t.app.name+' junto com a mensagem',()=>{c.comTela=t.url;});
    else{
      const e=el('span','etiqueta');e.title='Vai junto com a mensagem: '+t.endereco+(t.app.chat?' (e a conversa ganha as ferramentas do '+t.app.name+')':'');
      e.append(icone('app'),el('span','etiqueta-app',t.app.name),el('span','etiqueta-tela',t.titulo));
      xis(e,'Não usar a tela do '+t.app.name,()=>{c.comTela=null;});box.append(e);
    }
  }
  // o arquivo da aba ativa da área Arquivos: mesma coisa, sugerido; um clique põe, o × tira só desta caixa
  if(rel){
    const nome=rel.split('/').pop();
    if(c.comArquivo!==rel)fantasma(nome,'Mandar '+rel+' junto com a mensagem',()=>{c.comArquivo=rel;});
    else{
      const e=el('span','etiqueta');e.title='Vai junto com a mensagem: '+rel;
      e.append(icone('arquivo'),el('span','etiqueta-app',nome));
      xis(e,'Não mandar '+nome,()=>{c.comArquivo=null;});box.append(e);
    }
  }
}
// o arquivo que vai junto da mensagem (etiqueta posta e ainda à vista), ou null
function arquivoDe(c){if(!compositores.has(c))return null;const rel=window.ratoeiraArquivoAtivo?.()||null;return rel&&c.comArquivo===rel?rel:null;}
for(const ev of ['ratoeira:app-tela','ratoeira:arquivo-ativo'])window.addEventListener(ev,()=>{for(const c of compositores)if(c.raiz.isConnected||c===novo)desenharEtiqueta(c);});

// Conversa ligada a uma aplicação: as ferramentas (MCP), a pasta com as instruções e a chave que registra cada
// mensagem (a aplicação usa o que a pessoa digitou como aprovação de e-mail, reunião...). Guardado neste navegador.
const LIGACOES='ratoeira:chat-apps';
const ligacaoDe=conv=>ler(LIGACOES,{})[conv]||null;
function guardarLigacao(conv,v){const m=ler(LIGACOES,{});delete m[conv];if(v)m[conv]=v;const ks=Object.keys(m);if(ks.length>60)delete m[ks[0]];guardar(LIGACOES,m);}
const appDe=url=>window.ratoeiraApps?.app(url)??null;
async function pedirApp(app,rota,corpo){
  const r=await fetch(app.url+rota,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json',...(app.chat.cabecalhos||{})},body:JSON.stringify(corpo)});
  let d={};try{d=await r.json();}catch{}
  if(!r.ok)throw Object.assign(new Error(d.erro||d.error||app.name+' recusou ('+r.status+').'),{status:r.status});
  return d;
}
// Toda conversa ganha as ferramentas da própria Ratoeira (MCP "ratoeira"): ler outra conversa pelo link (todo mundo,
// desde 16/10/2026) e, pra quem administra, publicar app e a própria Ratoeira. O token vale 7 dias e serve pra todas
// as conversas desta página; renova uma vez por dia. Ratoeira sem nada disso (403/404): nada, e só pergunta amanhã.
let mcpRatoeira=null;
async function ferramentasRatoeira(){
  if(!chat.info)return [];
  if(mcpRatoeira&&Date.now()-mcpRatoeira.em<864e5)return mcpRatoeira.mcp;
  try{mcpRatoeira={mcp:(await pedirRatoeira('ligar',{app:'ratoeira'})).mcp||[],em:Date.now()};}catch(e){mcpRatoeira={mcp:[],em:[403,404].includes(e.status)?Date.now():Date.now()-864e5+60e3};}   // falhou: tenta de novo em 1 min
  return mcpRatoeira.mcp;
}
// Jeito novo (app.chat.mcp): quem emite o token e guarda a mensagem é o gateway (/_ratoeira/api/chat/*), e o agente
// chama o MCP do app por ele. Jeito antigo (app.chat.sessao/mensagem): o próprio app faz isso.
async function pedirRatoeira(rota,corpo){
  const r=await fetch('/_ratoeira/api/chat/'+rota,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(corpo)});
  let d={};try{d=await r.json();}catch{}
  if(!r.ok)throw Object.assign(new Error(d.error||'A Ratoeira recusou ('+r.status+').'),{status:r.status});
  return d;
}
async function sessaoDoApp(app,sessao=null){
  if(app.chat.mcp){
    const d=await pedirRatoeira('ligar',{app:app.url});
    let pasta=typeof d.pasta==='string'?d.pasta:null;if(!pasta&&app.chat.pasta){try{pasta=(await pedirApp(app,app.chat.pasta,{})).pasta||null;}catch{}}
    return {app:app.url,chave:d.chave,pasta:typeof pasta==='string'?pasta:null,mcp:d.mcp,pelaRatoeira:true};
  }
  const d=await pedirApp(app,app.chat.sessao,sessao?{conversa:sessao}:{});
  if(!Array.isArray(d.mcp)||!d.chave)throw new Error(app.name+' não devolveu as ferramentas.');
  return {app:app.url,chave:d.chave,pasta:typeof d.pasta==='string'?d.pasta:null,mcp:d.mcp};
}
const registrarNoApp=(app,lig,sessao,texto)=>lig.pelaRatoeira
  ?pedirRatoeira('mensagem',{chave:lig.chave,conversa:sessao,mensagem:texto})
  :pedirApp(app,app.chat.mensagem,{chave:lig.chave,conversa:sessao,mensagem:texto});
// Recarrega a conversa aberta com as ferramentas da ligação (o agente só pega MCP quando a sessão carrega).
async function religar(aba,lig){
  const r=await pedirAba(aba,'abrir',{...(aba.cwd?{cwd:aba.cwd}:{}),mcp:[...lig.mcp,...await ferramentasRatoeira()],recarregar:true});
  if(!r.recarregada)throw new Error('O servidor de agentes ainda não liga conversa aberta a uma aplicação. Começa uma conversa nova com a etiqueta.');
  guardarLigacao(aba.id,lig);await assinar(aba,true);
}
// O contexto vai no começo da mensagem, entre marcas que a tela esconde (vira a etiqueta no balão).
const MARCA=/^<ratoeira-contexto>\n?([\s\S]*?)\n?<\/ratoeira-contexto>\s*/;
// "[Ana]: " na frente da mensagem: é como o servidor de agentes manda pro agente numa conversa compartilhada
const PREFIXO_AUTOR=/^\[([^\]\n]{1,60})\]: /;
// contexto copiado de outra conversa ("Continuar numa cópia minha"): vai pro agente, na tela fica recolhido
const COPIA=/^<ratoeira-copia de="([^"]*)" titulo="([^"]*)" mensagens="(\d+)">\n?([\s\S]*?)\n?<\/ratoeira-copia>\s*/;
const meuEmail=()=>window.__ratoeiraPortal?.user?.email||null;
const meuNome=()=>window.__ratoeiraPortal?.user?.name||null;
function contexto(tela,lig,primeira,arquivo=null){
  const app=lig&&appDe(lig.app),linhas=[];
  if(primeira&&app){
    linhas.push(`Esta conversa está ligada ao ${app.name}: as ferramentas MCP "${lig.mcp.map(m=>m.name).join('", "')}" leem e mudam os dados dele, sempre no nome de quem conversa.`);
    if(lig.pasta)linhas.push(`Antes de responder, leia e siga as instruções do ${app.name} em ${lig.pasta}/AGENTS.md (as skills dele estão em ${lig.pasta}/.claude/skills). O resto do repositório continua à mão como sempre.`);
  }
  if(tela)linhas.push(`Tela aberta agora no ${tela.app.name}: ${tela.titulo} (${tela.endereco}).`+(tela.detalhe?` O que está aberto por cima dela: ${tela.detalhe}.`:''));
  if(arquivo)linhas.push(`Arquivo aberto na tela: ${arquivo}.`);
  return linhas.length?'<ratoeira-contexto>\n'+linhas.join('\n')+'\n</ratoeira-contexto>\n\n':'';
}
// Antes de mandar numa conversa aberta: liga à aplicação da etiqueta (se ela conversa pelo chat e ainda não
// estava ligada), registra a mensagem na aplicação ligada e devolve o texto com o contexto na frente.
async function prepararEnvio(aba,c,texto){
  const tela=telaDe(c),app=tela?.app.chat?tela.app:null;
  let lig=ligacaoDe(aba.id),primeira=false;
  if(app&&lig?.app!==app.url){lig=await sessaoDoApp(app,aba.sessao);await religar(aba,lig);primeira=true;}
  const ligado=lig&&appDe(lig.app);
  if(ligado?.chat){
    try{await registrarNoApp(ligado,lig,aba.sessao,texto);}
    catch(e){
      // a chave venceu (12 h sem conversar): sessão nova pra mesma conversa, e de novo
      if(e.status!==404)throw e;
      lig=await sessaoDoApp(ligado,aba.sessao);await religar(aba,lig);primeira=true;
      await registrarNoApp(ligado,lig,aba.sessao,texto);
    }
  }
  return contexto(tela,ligado?lig:null,primeira,arquivoDe(c))+texto;
}

// Pílulas de modelo / esforço / modo. Conversa nova: os modelos de todos os agentes, agrupados ("agente/modelo").
// Conversa aberta: só os do agente dela (o agente não muda no meio).
function montarModelos(c,{agenteFixo=null,valor}){
  const ags=agenteFixo?[agenteFixo]:comOpcoes().map(a=>a.id);
  opcoes(c.modelo.sel,ags.map(a=>({rotulo:agenteFixo?null:nomeAgente(a),itens:valoresDe(opcaoDe(listaNova(c,a),'model')).map(m=>({...m,id:(agenteFixo?'':a+'/')+m.id}))})),valor);
  c.modelo.atualizar();
}
function montarEsforcoModo(c,agente,lista,{esforco,modo}={}){
  const e=opcaoDe(lista,'thought_level'),m=opcaoDe(lista,'mode');
  const ve=valoresDe(e),vm=valoresDe(m);
  opcoes(c.esforco.sel,[{itens:ve}],ve.some(o=>o.id===esforco)?esforco:e?.currentValue);
  c.esforco.box.hidden=!ve.length;c.esforco.atualizar();c.esforco.sel.dataset.config=e?.id||'';
  opcoes(c.modo.sel,[{itens:vm}],vm.some(o=>o.id===modo)?modo:m?.currentValue);
  c.modo.box.hidden=!vm.length;c.modo.atualizar();c.modo.sel.dataset.config=m?.id||'';
  c.modelo.trocarIcone(agente==='codex'?'codex':'claude');
  marcarUltracode(c);
}

// Conversa nova: modelos, esforços e modos são os da conta escolhida na caixa. Cada conta oferece os seus, com
// nomes próprios (o Opus é `opus` no login completo e `opus[1m]` na da organização): a lista de uma servindo a
// outra mandava um modelo que ela não tem, e a conversa nascia no de início da conta.
// Sem tabela de apelidos: o padrão (ou a última escolha) vale se a conta tiver; senão, o que a conta traz.
const opcoesDaConta={};
const listaNova=(c,a)=>(c.listaConta&&opcoesDaConta[a+'|'+c.listaConta])||chat.opcoes[a];
async function modelosDaConta(c){
  const conta=c.conta.box.hidden?null:c.conta.sel.value;
  const agente=c.agente;
  if(!COM_CONTAS.has(agente)||c.contaAgente!==agente||conta===c.listaConta)return;
  c.listaConta=conta;const k=agente+'|'+conta;
  if(conta&&!opcoesDaConta[k])try{opcoesDaConta[k]=(await pedir('opcoes',{agente,cwd:chat.info.pastaPadrao,conta})).configOptions||[];}
    catch{c.listaConta=null;return;}
  if(c.listaConta===conta&&c.agente===agente)remontarNovo(c);
}
// Remonta as pílulas na lista atual: fica o que está marcado se a conta tiver, senão a escolha da pessoa ou o
// padrão, senão o que a conta traz.
function remontarNovo(c){
  const a=c.agente,lista=listaNova(c,a);
  const tem=(cat,v)=>v!=null&&valoresDe(opcaoDe(lista,cat)).some(o=>o.id===v);
  const [ag,marcado]=c.modelo.sel.value.split(/\/(.+)/);
  const modelo=[ag===a?marcado:null,escolhaDe(a,'modelo')].find(v=>tem('model',v))??opcaoDe(lista,'model')?.currentValue;
  montarModelos(c,{valor:a+'/'+modelo});
  const esforco=[c.esforco.box.hidden?null:c.esforco.sel.value,escolhaDe(a,'esforco')].find(v=>tem('thought_level',v));
  const modo=[c.modo.box.hidden?null:c.modo.sel.value,escolhaDe(a,'modo')].find(v=>tem('mode',v));
  montarEsforcoModo(c,a,lista,{esforco,modo});
}

let iniciado=null;
function iniciar(){if(!iniciado)iniciado=iniciar1().catch(e=>{iniciado=null;throw e;});return iniciado;}
async function iniciar1(){
  aviso('Conectando aos agentes…');
  try{await Promise.all([conectar().then(()=>carregarOpcoes()),carregarMarkdown()]);}catch(e){aviso('Não consegui conectar aos agentes: '+(e?.message||e));throw e;}
  aviso('');
  // as conversas que estavam abertas na grade (layout salvo) voltam pros painéis delas; id de outro formato
  // (as do Paseo, de antes do ACP) sai
  // (as do Paseo, de antes do ACP) sai. Voltam dormindo: só título e estado, sem abrir nem assinar no servidor.
  // Cada uma conecta quando aparece na tela (a ativa de cada painel, já agora). Antes abria todas, uma por vez,
  // e no celular com muitas abas a tela demorava pra ficar usável.
  const titulos=ler('ratoeira:chat-titulos',{});
  for(const id of G.ids().filter(x=>x.startsWith('c:'))){
    const conv=id.slice(2);const {agente}=partes(conv);
    // cp:<convite> = conversa de outra pessoa compartilhada comigo
    if(agente!=='cp'&&!chat.agentes.some(a=>a.id===agente)){G.remover(id);continue;}
    await abrirConversa(conv,{ativar:false,dormir:true,titulo:titulos[conv]||null}).catch(()=>G.remover(id));
  }
  abertas.prontas=true;avisarAbertas();
  if(chat.abas.some(a=>a.dormindo))situarDormindo().catch(()=>{});
  await restaurarTerminais();
}

// ── Nova conversa ────────────────────────────────────────────────────────────
let novo=null;
function pastasSugeridas({escolher=true}={}){
  const raiz=chat.info.pastaPadrao;const itens=[{id:raiz,label:'Raiz do repo',curto:raiz.split('/').pop()}];
  const ativo=window.ratoeiraArquivoAtivo?.();
  if(ativo&&ativo.includes('/')){const dir=raiz+'/'+ativo.split('/').slice(0,-1).join('/');itens.push({id:dir,label:'Pasta do arquivo aberto: '+ativo.split('/').slice(0,-1).join('/'),curto:dir.split('/').pop()});}
  for(const p of ler('ratoeira:chat-pastas',[]))if(!itens.some(i=>i.id===p))itens.push({id:p,label:p.replace(raiz+'/','').replace(/^\/home\/[^/]+\//,'~/'),curto:p.split('/').pop()});
  if(escolher)itens.push({id:'__escolher',label:'Escolher pasta…'});
  return itens;
}
function lembrarPasta(p){const r=ler('ratoeira:chat-pastas',[]).filter(x=>x!==p);guardar('ratoeira:chat-pastas',[p,...r].slice(0,5));}

// Navegador de pastas: mesma árvore da área Arquivos (só pastas), com busca. Devolve o caminho absoluto ou null.
const seletor={rel:'',resolver:null,timer:null};
async function apiArquivos(rota){const r=await fetch('/_ratoeira/api/arquivos/'+rota,{credentials:'same-origin'});if(!r.ok)throw new Error('Não consegui listar as pastas.');return r.json();}
function escolherPasta(inicial=''){
  seletor.rel=inicial;$('pasta-busca').value='';$('pasta-pop').hidden=false;mostrarRecentes(false);
  desenharPastas();requestAnimationFrame(()=>$('pasta-busca').focus());
  return new Promise(ok=>{seletor.resolver=ok;});
}
function fecharPastas(valor){$('pasta-pop').hidden=true;const ok=seletor.resolver;seletor.resolver=null;ok?.(valor);}
async function desenharPastas(){
  const raiz=chat.info.pastaPadrao;const nomeRaiz=raiz.split('/').pop();
  const trilha=$('pasta-trilha');trilha.replaceChildren();
  const partesRel=seletor.rel?seletor.rel.split('/'):[];
  [nomeRaiz,...partesRel].forEach((nome,i)=>{if(i)trilha.append(el('span','sep','/'));const b=el('button','trilha-item',nome);b.type='button';b.onclick=()=>{seletor.rel=partesRel.slice(0,i).join('/');desenharPastas();};trilha.append(b);});
  $('pasta-usar').textContent='Usar '+(partesRel.length?partesRel[partesRel.length-1]:nomeRaiz+' (raiz)');
  const ul=$('pasta-lista');const q=$('pasta-busca').value.trim();
  ul.replaceChildren(el('li','muted','Carregando…'));
  try{
    // caminho colado (começa com /): usa direto; o servidor de agentes abre a conversa lá se a pessoa puder entrar na pasta
    if(q.startsWith('/')){
      const cam=q.replace(/\/+$/,'')||'/';ul.replaceChildren();const li=el('li');const b=el('button','pasta-item');b.type='button';
      b.append(icone('pasta'),el('span','pasta-nome','Usar '+cam));b.onclick=()=>fecharPastas(cam);li.append(b);ul.append(li);return;
    }
    let itens;
    if(q.length>=2){itens=(await apiArquivos('busca?q='+encodeURIComponent(q))).itens.filter(i=>i.tipo==='pasta');}
    else{itens=(await apiArquivos('arvore?caminho='+encodeURIComponent(seletor.rel))).itens.filter(i=>i.tipo==='pasta'||i.alvo==='pasta');}
    if($('pasta-busca').value.trim()!==q)return;
    ul.replaceChildren();
    if(!q&&seletor.rel){const li=el('li');const b=el('button','pasta-item subir','.. (voltar)');b.type='button';b.onclick=()=>{seletor.rel=partesRel.slice(0,-1).join('/');desenharPastas();};li.append(b);ul.append(li);}
    if(!itens.length)ul.append(el('li','muted',q?'Nenhuma pasta com esse nome.':'Sem subpastas aqui. Dá pra usar esta mesma.'));
    for(const it of itens){
      const li=el('li');const b=el('button','pasta-item');b.type='button';b.append(icone('pasta'),el('span','pasta-nome',it.nome));
      if(q){const dir=it.caminho.split('/').slice(0,-1).join('/');if(dir)b.append(el('span','pasta-onde',dir));}
      // atalho (symlink) pra pasta: não dá pra entrar nele por aqui, então um toque já escolhe
      if(it.tipo==='atalho'){b.append(el('span','pasta-onde','atalho'));b.title='Atalho: um toque usa esta pasta';b.onclick=()=>fecharPastas(raiz+'/'+it.caminho);}
      else{b.onclick=()=>{seletor.rel=it.caminho;$('pasta-busca').value='';desenharPastas();};
      b.ondblclick=()=>fecharPastas(raiz+'/'+it.caminho);}
      li.append(b);ul.append(li);
    }
  }catch(e){ul.replaceChildren(el('li','muted',e.message));}
}
$('pasta-busca').addEventListener('input',()=>{clearTimeout(seletor.timer);seletor.timer=setTimeout(desenharPastas,180);});
$('pasta-busca').addEventListener('keydown',e=>{const v=$('pasta-busca').value.trim();if(e.key==='Enter'&&v.startsWith('/')){e.preventDefault();fecharPastas(v.replace(/\/+$/,'')||'/');}});
$('pasta-usar').onclick=()=>{const raiz=chat.info.pastaPadrao;fecharPastas(seletor.rel?raiz+'/'+seletor.rel:raiz);};
$('pasta-cancelar').onclick=()=>fecharPastas(null);$('pasta-fechar').onclick=()=>fecharPastas(null);
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('pasta-pop').hidden)fecharPastas(null);});

// O `/` da conversa nova: a última lista que o agente escolhido anunciou (o servidor guarda), pedida de novo
// a cada vez que o menu abre, porque skill nova aparece sem recarregar a página.
async function comandosNovos(c){return c?.agente?pedir('comandos',{agente:c.agente}):[];}
// Compositor de conversa nova: o do painel de chat e o da Início usam o mesmo preparo.
// A Início não oferece "Escolher pasta…": o seletor de pastas mora dentro do painel de chat.
function prepararNovo(c,{escolher=true}={}){
  c.anterior=()=>ler('ratoeira:ultima-mensagem',null);
  c.modelo.sel.addEventListener('change',()=>{const [a]=c.modelo.sel.value.split(/\/(.+)/);if(a===c.agente)return;c.agente=a;montarEsforcoModo(c,a,listaNova(c,a),{esforco:escolhaDe(a,'esforco'),modo:escolhaDe(a,'modo')});desenharConta(c,a);});
  c.pasta.sel.addEventListener('focus',()=>{c.pasta.anterior=c.pasta.sel.value;});
  c.pasta.sel.addEventListener('change',async()=>{
    if(c.pasta.sel.value!=='__escolher'){c.pasta.anterior=c.pasta.sel.value;return;}
    const raiz=chat.info.pastaPadrao;const atual=c.pasta.anterior||raiz;
    const p=await escolherPasta(atual.startsWith(raiz+'/')?atual.slice(raiz.length+1):'');
    if(p&&p!==raiz)lembrarPasta(p);
    opcoes(c.pasta.sel,[{itens:pastasSugeridas({escolher})}],p||atual);c.pasta.atualizar();c.pasta.anterior=c.pasta.sel.value;
  });
}
function preencherNovo(c,{escolher=true}={}){
  const disponivel=a=>comOpcoes().some(x=>x.id===a);
  const pref=agentePreferido();
  const agente=disponivel(pref)?pref:disponivel('claude')?'claude':comOpcoes()[0]?.id;
  c.agente=agente;desenharConta(c,agente);
  const lista=listaNova(c,agente),modelos=valoresDe(opcaoDe(lista,'model'));
  const quer=escolhaDe(agente,'modelo');
  const idModelo=(modelos.some(m=>m.id===quer)?quer:null)||opcaoDe(lista,'model')?.currentValue||modelos[0]?.id;
  montarModelos(c,{valor:agente+'/'+idModelo});
  montarEsforcoModo(c,agente,lista,{esforco:escolhaDe(agente,'esforco'),modo:escolhaDe(agente,'modo')});
  // começa na pasta da última conversa nova, como o modelo; a que sumiu (apagada, renomeada) volta pra raiz
  const sugestoes=pastasSugeridas({escolher}),raiz=chat.info.pastaPadrao,rel=pastaLembrada(),lembrada=rel?raiz+'/'+rel:null;
  if(lembrada&&!sugestoes.some(i=>i.id===lembrada))sugestoes.splice(1,0,{id:lembrada,label:rel,curto:rel.split('/').pop()});
  const inicial=lembrada||sugestoes[0].id;
  opcoes(c.pasta.sel,[{itens:sugestoes}],inicial);c.pasta.atualizar();c.pasta.anterior=inicial;c.pasta.daTela=null;
  if(lembrada)apiArquivos('arvore?caminho='+encodeURIComponent(rel)).catch(()=>{
    if(c.pasta.sel.value!==lembrada)return;
    const itens=pastasSugeridas({escolher}).filter(i=>i.id!==lembrada);opcoes(c.pasta.sel,[{itens}],raiz);c.pasta.atualizar();c.pasta.anterior=raiz;});
}
// A pasta da última conversa nova, relativa à pasta de trabalho (null = raiz): nas escolhas da pessoa, no servidor
// (vale no celular e no computador); sem login próprio, neste navegador.
function pastaLembrada(){
  const r=chat.info?.padrao?chat.info?.minhas?.pasta:ler('ratoeira:chat-pasta',null);
  return typeof r==='string'&&r&&!r.startsWith('/')&&!r.split('/').some(x=>!x||x==='.'||x==='..')?r:null;
}
function montarNovo(){
  if(!novo){
    novo=compositor({placeholder:'O que tu quer que o agente faça?',comPasta:true,comandos:()=>comandosNovos(novo)});$('composer-novo').append(novo.raiz);
    if(TOQUE)$('chat-novo').querySelector('.novo-dica').textContent='Enter quebra linha · a seta envia · o relógio no topo abre as conversas recentes';
    prepararNovo(novo);
    // a conversa criada entra no lugar da aba "Nova conversa" (ver abrirEspera)
    novo.raiz.onsubmit=ev=>criarConversa(ev,novo);
  }
  preencherNovo(novo);
}
// Recentes: lista suspensa pelo botão 🕘, com busca. Separada da tela de nova conversa de propósito.
let recentes=[],recentesOutro=null;
async function listarRecentes(){
  const ul=$('chat-recentes');ul.replaceChildren(el('li','muted','Carregando…'));
  try{recentes=await pedir('listar',{});recentesOutro=await abertasNoOutro(recentes).catch(()=>null);desenharRecentes();}
  catch(e){ul.replaceChildren(el('li','muted','Não consegui listar: '+e.message));}
}
function itemRecente(a){
  const li=el('li');const b=el('button','recente');b.type='button';
  b.append(el('span','recente-titulo',a.titulo||'Sem título'),el('span','recente-meta',[nomeAgente(a.agente),quando(a.atualizada),a.cwd?.replace(/^\/home\/[^/]+\//,'~/')].filter(Boolean).join(' · ')));
  if(a.estado!=='livre')b.classList.add('rodando');
  const conv=idDe(a.agente,a.sessao);
  if(chat.abas.some(x=>x.id===conv))b.classList.add('aberta');
  b.onclick=()=>{const painel=recentesDe.painel?G.painelDeConversa(recentesDe.painel):null;mostrarRecentes(false);abrirConversa(conv,{painel,cwd:a.cwd,titulo:a.titulo}).catch(e=>toast('Não abriu: '+e.message));};li.append(b);return li;
}
const grupoRecentes=(titulo,meta)=>{const li=el('li','recentes-grupo');li.append(el('span',undefined,titulo));if(meta)li.append(el('span','recentes-grupo-meta',meta));return li;};
function desenharRecentes(){
  const ul=$('chat-recentes');const q=$('chat-recentes-busca').value.trim().toLowerCase();
  const itens=recentes.filter(a=>!q||(a.titulo||'').toLowerCase().includes(q)||(a.cwd||'').toLowerCase().includes(q)).slice(0,40);
  ul.replaceChildren();
  // as abas do outro aparelho vêm no topo (sem busca); some quando lá não tem nenhuma aberta
  const o=!q&&recentesOutro;
  if(o){ul.append(grupoRecentes('Abertas no '+o.tipo,vistoEm(o.em)),...o.conversas.map(itemRecente),grupoRecentes('Recentes'));}
  if(!itens.length)ul.append(el('li','muted',q?'Nenhuma conversa com esse termo.':'Nenhuma conversa ainda.'));
  ul.append(...itens.map(itemRecente));
}
// Recentes abre embaixo do botão do painel que pediu, e a conversa escolhida abre nesse painel.
const recentesDe={botao:null,painel:null};
function mostrarRecentes(abrir,botao=null,painel=null){
  const pop=$('chat-recentes-pop');if(abrir===undefined)abrir=pop.hidden;
  recentesDe.botao?.setAttribute('aria-expanded','false');
  pop.hidden=!abrir;
  if(abrir){
    Object.assign(recentesDe,{botao,painel});botao?.setAttribute('aria-expanded','true');
    const caixa=$('files').getBoundingClientRect(),r=botao?.getBoundingClientRect();
    if(r){const w=Math.min(360,caixa.width-16);Object.assign(pop.style,{width:w+'px',top:(r.bottom-caixa.top+6)+'px',left:Math.max(8,Math.min(r.right-caixa.left-w,caixa.width-w-8))+'px'});}
    $('chat-recentes-busca').value='';listarRecentes();requestAnimationFrame(()=>$('chat-recentes-busca').focus());
  }
}
$('chat-recentes-busca').addEventListener('input',desenharRecentes);
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('chat-recentes-pop').hidden){mostrarRecentes(false);recentesDe.botao?.focus();}});
document.addEventListener('pointerdown',e=>{const pop=$('chat-recentes-pop');if(!pop.hidden&&!pop.contains(e.target)&&!recentesDe.botao?.contains(e.target))mostrarRecentes(false);});
function quando(iso){if(!iso)return'';const s=(Date.now()-Date.parse(iso))/1000;if(s<60)return'agora';if(s<3600)return Math.round(s/60)+' min';if(s<86400)return Math.round(s/3600)+' h';return new Date(iso).toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit'});}
// "Nova conversa" é uma aba só (o compositor de #chat-novo), que vai pro painel pedido. A etiqueta da tela volta a
// ser sugestão a cada conversa nova; quem quer ela posta (botão do painel de um app, botões do próprio app) põe depois.
async function novaConversa(painel=null){
  mostrarRecentes(false);
  try{await iniciar();montarNovo();}catch(e){aviso('Não consegui montar a conversa nova: '+(e?.message||e));return;}
  novo.comTela=undefined;desenharEtiqueta(novo);
  G.registrar({id:'nova',tipo:'nova',titulo:'Nova conversa',el:$('chat-novo'),aoMostrar:()=>requestAnimationFrame(()=>novo?.area.focus())},{painel:painel?G.painelDeConversa(painel):null});
  requestAnimationFrame(()=>novo?.area.focus());
}
async function criarConversa(ev,c){
  ev.preventDefault();const texto=c.area.value.trim();if((!texto&&!temAnexo(c))||c.botao.disabled)return;
  const anexos=anexosDe(c);guardar('ratoeira:ultima-mensagem',texto);
  const [agente,idModelo]=c.modelo.sel.value.split(/\/(.+)/);
  // Criar leva uns segundos: trava já (senão cada Enter vira uma conversa nova), mas deixa o texto à vista com o
  // botão girando e uma linha dizendo o que está acontecendo, pra não parecer que a mensagem sumiu.
  const parar=criando(c,agente);const cwd=c.pasta.sel.value==='__escolher'?chat.info.pastaPadrao:c.pasta.sel.value;
  const esforco=c.esforco.box.hidden?null:c.esforco.sel.value,modo=c.modo.box.hidden?null:c.modo.sel.value;
  // pasta que veio de uma tela (Habilidades, um app) vale só pra esta conversa: não vira a lembrada
  const raiz=chat.info.pastaPadrao,pastaRel=cwd===raiz?null:cwd.startsWith(raiz+'/')?cwd.slice(raiz.length+1):undefined;
  lembrarEscolhas(agente,{modelo:idModelo,esforco,modo},c.pasta.daTela===cwd?undefined:pastaRel);
  // o que a pessoa escolheu nas pílulas, pelo id que o agente usa pra cada opção
  const escolhas={};const lista=listaNova(c,agente);
  const mod=opcaoDe(lista,'model');if(mod&&idModelo)escolhas[mod.id]=idModelo;
  if(esforco&&c.esforco.sel.dataset.config)escolhas[c.esforco.sel.dataset.config]=esforco;
  if(modo&&c.modo.sel.dataset.config)escolhas[c.modo.sel.dataset.config]=modo;
  if(c.fastNovo!=null&&(lista||[]).some(o=>o.id==='fast'))escolhas.fast=c.fastNovo;
  const ultracode=agente==='claude'&&Boolean(c.ultraNovo);
  c.botao.disabled=true;let espera=null;
  try{
    // com a etiqueta de uma aplicação que conversa pelo chat, a conversa já nasce com as ferramentas dela; a
    // mensagem vai depois de registrada na aplicação (é a aprovação dela)
    const tela=compositores.has(c)?telaDe(c):null,app=tela?.app.chat?tela.app:null;
    const lig=app?await sessaoDoApp(app):null;
    // texto junto dos blocos: servidor de agentes que ligou antes de 09/10 só lê o texto (perde só a imagem e o link)
    const arquivo=arquivoDe(c);const comAnexos=await comArquivos(texto,anexos,pedir);const msg=contexto(tela,null,false,arquivo)+comAnexos;
    espera=abrirEspera(c,texto||anexos.arquivos[0]?.nome||'Imagem',agente,cwd);
    const contaNova=!c.conta.box.hidden&&c.contaAgente===agente?c.conta.sel.value:null;
    const r=await pedir('nova',{agente,cwd,aparelho:TIPO_APARELHO,opcoes:escolhas,...(contaNova?{conta:contaNova}:{}),...(ultracode?{ultracode:true}:{}),mcp:[...(lig?.mcp??[]),...await ferramentasRatoeira()],...(lig?{}:{blocos:blocosDe(msg,anexos),...(msg.trim()?{texto:msg}:{})})});
    lembrarConversa(r);const conv=idDe(r.agente,r.sessao);
    // conversa nova numa subpasta: a árvore abre nela uma vez (sem mudar a raiz; trocar de aba depois não mexe)
    const relNova=relDaPasta(r.cwd||cwd);if(relNova&&coluna.modo==='arquivos')window.ratoeiraMostrarPasta?.(relNova);
    // ultracode gasta muito: a próxima conversa nova volta desligado
    if(c.ultraNovo){c.ultraNovo=false;marcarUltracode(c);}
    if(lig){guardarLigacao(conv,lig);await registrarNoApp(app,lig,r.sessao,texto);}
    limparAnexos(c);
    await espera.trocar(conv);espera=null;
    c.area.value='';c.area.style.height='auto';
    if(lig)await pedir('enviar',{agente:r.agente,sessao:r.sessao,blocos:blocosDe(contexto(tela,lig,true,arquivo)+comAnexos,anexos)});
  }catch(e){espera?.desfazer();c.area.value=texto;const msg='Não consegui criar a conversa: '+(e?.message||e);if(c===novo)aviso(msg);else toast(msg);}
  finally{parar();}
}
// Criar a conversa leva uns segundos. Em vez de segurar a pessoa na tela de nova conversa, uma aba provisória
// já mostra a mensagem e o ratinho andando, no painel onde a conversa vai abrir; quando ela fica pronta, a de
// verdade entra no lugar. O id ('criando:N') fica fora do padrão da grade, então não volta ao recarregar a página.
let esperas=0;
function abrirEspera(c,texto,agente,cwd){
  const doNovo=c===novo,id='criando:'+(++esperas);
  if(!doNovo&&location.hash!=='#arquivos'&&!location.hash.startsWith('#arquivos/'))location.hash='#arquivos';
  const p=el('section','conv');
  const info=el('div','conv-info');info.append(el('span',undefined,nomeAgente(agente)));const onde=botaoPasta(cwd);if(onde)info.append(onde);
  const msgs=el('div','conv-msgs');const m=el('div','msg user');m.append(el('div','balao',texto));msgs.append(m);
  const vivo=el('div','conv-vivo');const pista=el('span','rato-pista');pista.innerHTML=RATO;
  const vt=el('span','vivo-texto','Ligando o '+nomeAgente(agente)+'…');vivo.append(pista,vt);
  p.append(info,msgs,vivo);
  const timer=setTimeout(()=>{vt.textContent='Tá demorando mais que o normal. Segura aí, já já abre.';},8000);
  let fechada=false;
  G.registrar({id,tipo:'conversa',titulo:texto.slice(0,60),el:p,icone:agente,rodando:true,aoFechar:()=>{fechada=true;}},{painel:doNovo?G.painelDe('nova'):null});
  if(doNovo)G.remover('nova');else $('files').dataset.mobile='arquivo';
  const tirar=()=>{clearTimeout(timer);if(!fechada)G.remover(id);p.remove();};
  return {
    // fechou a aba provisória antes de terminar: a conversa segue existindo, nas recentes
    async trocar(conv){try{if(!fechada){await iniciar();await abrirConversa(conv,{titulo:texto,painel:G.painelDe(id)});}}finally{tirar();}},
    // deu erro: a nova conversa volta com o texto, pra tentar de novo
    desfazer(){if(doNovo&&!fechada)novaConversa(G.painelDe(id));tirar();},
  };
}
// Estado "criando" do compositor: texto apagado e travado, botão girando, linha de status embaixo. Passou de 8 s,
// a linha avisa que está demorando. Devolve a função que desfaz tudo.
function criando(c,agente){
  c.area.disabled=true;c.botao.disabled=true;c.raiz.classList.add('criando');
  c.botao.replaceChildren(icone('carregando'));c.botao.setAttribute('aria-label','Criando a conversa');
  const status=el('div','composer-status');status.setAttribute('role','status');status.textContent='Ligando o '+nomeAgente(agente)+'…';
  c.raiz.append(status);
  const timer=setTimeout(()=>{status.textContent='Tá demorando mais que o normal. Segura aí, já já abre.';},8000);
  return ()=>{clearTimeout(timer);status.remove();c.raiz.classList.remove('criando');
    c.botao.replaceChildren(icone('enviar'));c.botao.setAttribute('aria-label','Enviar');c.botao.disabled=false;c.area.disabled=false;};
}
// O que difere do padrão do admin vira escolha da pessoa; igual ao padrão deixa de ser (volta a seguir o admin).
// pasta: relativa à pasta de trabalho, null pra raiz, undefined pra não mexer.
function lembrarEscolhas(agente,valores,pasta){
  if(!chat.info?.padrao){if(pasta!==undefined)guardar('ratoeira:chat-pasta',pasta);return;}   // sem login próprio: só a pasta, neste navegador
  const antes=JSON.stringify(chat.info.minhas||{});
  const m=JSON.parse(antes==='{}'?'{"agentes":{}}':antes);m.agentes??={};
  const agentePadrao=chat.info.padrao.agente??'claude';
  if(agente!==agentePadrao)m.agente=agente;else delete m.agente;
  const meu={...(m.agentes[agente]||{})};
  for(const [campo,v] of Object.entries(valores)){if(v==null)continue;if(v===padraoAdmin(agente,campo))delete meu[campo];else meu[campo]=v;}
  if(Object.keys(meu).length)m.agentes[agente]=meu;else delete m.agentes[agente];
  if(pasta)m.pasta=pasta;else if(pasta===null)delete m.pasta;
  if(JSON.stringify(m)===antes)return;
  chat.info.minhas=m;
  fetch('/_ratoeira/api/chat/minhas',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(m)}).catch(()=>{});
}
// Pra tela de Habilidades: abre uma conversa nova com o texto já escrito (ex.: "/resumo ") e na pasta pedida.
window.ratoeiraNovaConversa=async({texto='',cwd=null,citar=null}={})=>{
  if(location.hash!=='#arquivos'&&!location.hash.startsWith('#arquivos/'))location.hash='#arquivos';
  await novaConversa(null);if(!novo)return;
  if(cwd){const itens=pastasSugeridas();if(!itens.some(i=>i.id===cwd))itens.splice(1,0,{id:cwd,label:cwd.replace(chat.info.pastaPadrao+'/',''),curto:cwd.split('/').pop()});
    opcoes(novo.pasta.sel,[{itens}],cwd);novo.pasta.atualizar();novo.pasta.anterior=cwd;novo.pasta.daTela=cwd;}
  novo.area.value=texto;novo.area.focus();novo.area.setSelectionRange(texto.length,texto.length);
  if(citar)novo.citados.add(citar);
};
// Menu da árvore (portal.js): "Citar no chat" escreve @caminho na caixa da conversa à vista (ou numa nova).
window.ratoeiraCitar=async rel=>{
  await chatPronto();if(!chat.info)return;
  const aba=chat.abas.find(a=>a.id===chat.ativa&&a.painel.isConnected&&!a.painel.hidden);
  let c=aba?.comp;
  if(!c){await window.ratoeiraNovaConversa({});c=novo;}
  if(!c)return;
  const a=c.area,pos=a.selectionStart??a.value.length,antes=a.value.slice(0,pos),depois=a.value.slice(pos);
  const ins=(antes&&!/\s$/.test(antes)?' ':'')+'@'+rel+' ';
  a.value=antes+ins+depois;c.citados.add(rel);a.focus();a.setSelectionRange(pos+ins.length,pos+ins.length);a.dispatchEvent(new Event('input'));
};
// Pra tela de Automações: abre a conversa que uma rotina deixou (na área Arquivos, como a Início faz).
// Com texto (ratoeira.chat.abrir de um app): escrito na caixa depois que a conversa abre; enviar manda.
window.ratoeiraAbrirConversa=(agente,sessao,titulo,{texto='',enviar=false}={})=>abrirNoPainel(idDe(agente,sessao),titulo).then(()=>{
  const aba=texto&&chat.abas.find(a=>a.id===idDe(agente,sessao));if(!aba)return;
  aba.comp.comTela=telaAtual()?.url??null;desenharEtiqueta(aba.comp);aba.comp.area.value=texto;
  if(enviar){aba.comp.raiz.requestSubmit();return;}
  aba.comp.area.focus();aba.comp.area.setSelectionRange(texto.length,texto.length);aba.comp.area.dispatchEvent(new Event('input'));
}).catch(e=>toast('Não abriu: '+e.message));
// Editor da área Arquivos: ler e salvar passam pelo servidor de agentes da pessoa (roda como ela).
// Telas que abrem direto (#automacoes, #integracoes...) pedem antes do portal entregar os dados do chat: espera.
const chatPronto=async()=>{if(!chat.info&&!window.__ratoeiraPortal)await new Promise(ok=>window.addEventListener('ratoeira:portal',()=>setTimeout(ok),{once:true}));};
// Lista "Conversas recentes" da tela de abas do celular: só as que não estão abertas aqui, e só quando pedem.
window.ratoeiraRecentes=async()=>{await iniciar();return (await pedir('listar',{})).filter(a=>!abertaAqui(a)).map(a=>({...a,nomeAgente:nomeAgente(a.agente)}));};
window.ratoeiraPedir=async(op,dados)=>{await chatPronto();if(!chat.info)throw new Error('O chat não está ligado nesta Ratoeira.');return pedir(op,dados);};
// As skills globais da pessoa (~/.claude/skills...), lidas pelo servidor de agentes dela.
window.ratoeiraHabilidadesPessoais=async()=>{
  await chatPronto();
  if(!chat.info)return [];
  return pedir('habilidades');
};
// Pra tela de Conexões (padrão do admin): as opções de cada agente, como o agente devolve.
window.ratoeiraChatOpcoes=async()=>{
  // Conexões pode abrir antes do chat receber os dados do portal (entrada direto em #conexoes)
  if(!chat.info)await new Promise(ok=>window.addEventListener('ratoeira:portal',()=>setTimeout(ok),{once:true}));
  if(!chat.info)throw new Error('O chat não está ligado nesta Ratoeira.');
  await iniciar();
  return comOpcoes().map(a=>({id:a.id,nome:nomeAgente(a.id),
    modelos:valoresDe(opcaoDe(chat.opcoes[a.id],'model')),esforcos:valoresDe(opcaoDe(chat.opcoes[a.id],'thought_level')),modos:valoresDe(opcaoDe(chat.opcoes[a.id],'mode'))}));
};
window.ratoeiraChatPadraoSalvo=v=>{if(chat.info)chat.info.padrao=v;if(novo)preencherNovo(novo);};
// a pasta de cada conversa aberta neste navegador (abrir sem pasta funciona, mas o agente tem que procurar)
// A pasta da conversa no topo dela: o nome curto ("raiz", "na-lata"), não o caminho do servidor. Dentro da pasta
// de trabalho, clicar mostra a pasta na árvore (troca a coluna pra Arquivos).
function relDaPasta(cwd){const raiz=chat.info?.pastaPadrao;if(!cwd||!raiz)return undefined;return cwd===raiz?'':cwd.startsWith(raiz+'/')?cwd.slice(raiz.length+1):undefined;}
function botaoPasta(cwd){
  const rel=relDaPasta(cwd);
  if(rel===undefined)return cwd?el('span','conv-pasta',cwd.replace(/^\/home\/[^/]+\//,'~/')):null;
  const b=el('button','conv-pasta');b.type='button';b.append(icone('pasta'),el('span',undefined,rel||'raiz'));
  b.title='Mostrar a pasta na árvore';b.setAttribute('aria-label','Pasta da conversa: '+(rel||'raiz')+'. Mostrar na árvore');
  b.onclick=()=>{if(coluna.modo!=='arquivos')trocarColuna('arquivos');window.ratoeiraMostrarPasta?.(rel,{foco:true});};
  return b;
}
function lembrarConversa(r){const m=ler('ratoeira:chat-cwds',{});m[idDe(r.agente,r.sessao)]=r.cwd;const ks=Object.keys(m);if(ks.length>60)delete m[ks[0]];guardar('ratoeira:chat-cwds',m);}

// ── Abertas no outro aparelho: este navegador conta ao servidor de agentes quais conversas tem em abas, e o
// Recentes e a Início mostram as do último aparelho do outro tipo (celular ↔ computador). Só pra ver: nada
// sincroniza. Só manda depois que as abas salvas voltaram (antes disso a lista sairia vazia).
const TIPO_APARELHO=TOQUE?'celular':'computador';
const APARELHO=(()=>{let a=ler('ratoeira:aparelho',null);if(typeof a!=='string'||!/^[A-Za-z0-9-]{8,64}$/.test(a)){a=TIPO_APARELHO+'-'+crypto.randomUUID();guardar('ratoeira:aparelho',a);}return a;})();
const abertas={timer:null,prontas:false};
function avisarAbertas(){
  if(!abertas.prontas||!chat.info)return;
  clearTimeout(abertas.timer);
  abertas.timer=setTimeout(()=>{
    const conversas=chat.abas.filter(a=>!a.conn).map(a=>({agente:a.agente,sessao:a.sessao,cwd:a.cwd,titulo:a.titulo||a.tituloInicial}));
    // título de cada aba aberta, pra ela voltar com nome quando volta dormindo
    guardar('ratoeira:chat-titulos',Object.fromEntries(chat.abas.filter(a=>a.titulo||a.tituloInicial).map(a=>[a.id,a.titulo||a.tituloInicial])));
    pedir('abertas-gravar',{aparelho:APARELHO,tipo:TIPO_APARELHO,conversas}).catch(()=>{});
  },3000);
}
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')avisarAbertas();});
// O aparelho do outro tipo usado por último, com as conversas dele completadas pela lista do servidor
// (título e estado de agora); null quando não tem nenhum ou ele não tem conversa aberta.
async function abertasNoOutro(todas){
  const o=(await pedir('abertas')).find(a=>a.aparelho!==APARELHO&&a.tipo!==TIPO_APARELHO);
  if(!o?.conversas.length)return null;
  return {...o,conversas:o.conversas.map(c=>({estado:'livre',...c,...todas.find(x=>x.agente===c.agente&&x.sessao===c.sessao)}))};
}
const vistoEm=ms=>{const q=quando(new Date(ms).toISOString());return q==='agora'?'visto agora':q.includes('/')?'visto em '+q:'visto há '+q;};
const abertaAqui=a=>chat.abas.some(x=>x.agente===a.agente&&x.sessao===a.sessao);

// Abre uma conversa no painel de chat da área Arquivos (usado pela Início).
async function abrirNoPainel(id,titulo=null){
  if(location.hash!=='#arquivos'&&!location.hash.startsWith('#arquivos/'))location.hash='#arquivos';
  await iniciar();await abrirConversa(id,titulo?{titulo}:{});
  $('files').dataset.mobile='arquivo';
}
// Várias de uma vez ("Abrir as N", das abertas no outro aparelho): todas viram aba, a primeira fica à vista.
async function abrirVarias(lista){
  if(location.hash!=='#arquivos'&&!location.hash.startsWith('#arquivos/'))location.hash='#arquivos';
  await iniciar();
  for(const [i,a] of lista.entries())await abrirConversa(idDe(a.agente,a.sessao),{ativar:i===0,titulo:a.titulo,cwd:a.cwd}).catch(()=>{});
  $('files').dataset.mobile='arquivo';
}

// ── Terminal ─────────────────────────────────────────────────────────────────
// Aba da grade com o shell da pessoa, no servidor de agentes dela (ops terminal-*); id na grade: t:<terminal>.
// O shell segue vivo com a aba escondida, a página recarregada ou o navegador fechado (até o servidor de agentes
// sair por ociosidade, 30 min sem ninguém conectado). Fechar a aba encerra o shell; `exit` fecha a aba.
// A tela é o xterm.js (terminal.js), que só carrega no primeiro terminal.
const terminais=new Map();   // id → {id, cwd, pos (quanto da saída já está na tela), tela, el}
let moduloTerminal=null;
const telaTerminal=()=>moduloTerminal??=import('/_ratoeira/terminal.js').catch(e=>{moduloTerminal=null;throw e;});
function montarTerminal(mod,id,cwd,{painel=null,ativar=true}={}){
  const box=el('div','terminal-aba'),area=el('div','terminal-tela');box.append(area);
  const t={id,cwd,pos:0,el:box,tela:null};terminais.set(id,t);
  const pasta=cwd.split('/').pop()||cwd;
  G.registrar({id:'t:'+id,tipo:'terminal',icone:'terminal',titulo:'Terminal · '+pasta,dica:cwd+' (fechar a aba encerra o terminal)',el:box,
    aoMostrar:()=>requestAnimationFrame(()=>{t.tela?.ajustar();t.tela?.focar();}),aoFechar:()=>fecharTerminal(t,true)},{painel,ativar});
  t.tela=mod.criarTerminal(area,{
    aoDigitar:dados=>pedir('terminal-entrada',{terminal:id,dados}).catch(e=>{if(/fechou/.test(e.message))fecharTerminal(t,false);}),
    aoTamanho:(linhas,colunas)=>pedir('terminal-tamanho',{terminal:id,linhas,colunas}).catch(()=>{}),
    aoTitulo:titulo=>{titulo=String(titulo||'').trim().slice(0,60);G.atualizar('t:'+id,{titulo:titulo||'Terminal · '+pasta});},
  });
  return t;
}
// Recebe a saída guardada desde o que já está na tela (tudo, na primeira vez) e passa a receber o resto.
async function assinarTerminal(t){
  const r=await pedir('terminal-assinar',{terminal:t.id,desde:t.pos});
  if(r.desde!==t.pos)t.tela.limpar();   // o servidor não tem mais esse pedaço (saída longa) ou religou: redesenha
  t.pos=r.pos;if(r.dados)t.tela.escrever(r.dados);
  const {linhas,colunas}=t.tela.tamanho();pedir('terminal-tamanho',{terminal:t.id,linhas,colunas}).catch(()=>{});
}
function aoTerminal(m){
  const t=terminais.get(m.terminal);if(!t?.tela)return;
  if(m.t==='terminal-fim')return fecharTerminal(t,false);
  if(m.pos<=t.pos)return;
  const ini=m.pos-m.dados.length;t.tela.escrever(ini<t.pos?m.dados.slice(t.pos-ini):m.dados);t.pos=m.pos;
}
// matar: a pessoa fechou a aba (encerra o shell). Sem matar: o shell já acabou (exit), a aba sai sozinha.
function fecharTerminal(t,matar){
  if(!terminais.delete(t.id))return;
  t.tela?.destruir();t.el.remove();
  if(matar)pedir('terminal-fechar',{terminal:t.id}).catch(()=>{});else G.remover('t:'+t.id);
}
async function novoTerminal(painel=null){
  try{
    const [mod]=await Promise.all([telaTerminal(),iniciar()]);
    const r=await pedir('terminal-abrir',{cwd:chat.info.pastaPadrao,linhas:30,colunas:100});
    await assinarTerminal(montarTerminal(mod,r.terminal,r.cwd,{painel}));
  }catch(e){toast('Não abri o terminal: '+e.message);}
}
// Layout salvo com terminais: os que ainda estão vivos no servidor voltam pros painéis deles; os outros saem.
async function restaurarTerminais(){
  const ids=G.ids().filter(x=>x.startsWith('t:'));if(!ids.length)return;
  let vivos=new Map(),mod=null;
  try{vivos=new Map((await pedir('terminais')).map(x=>[x.terminal,x]));if(ids.some(id=>vivos.has(id.slice(2))))mod=await telaTerminal();}catch{}
  for(const id of ids){
    const v=vivos.get(id.slice(2));
    if(!v||!mod){G.remover(id);continue;}
    const t=montarTerminal(mod,v.terminal,v.cwd,{ativar:false});
    await assinarTerminal(t).catch(()=>fecharTerminal(t,false));
  }
}
window.ratoeiraNovoTerminal=novoTerminal;

// ── Conversas em abas ────────────────────────────────────────────────────────
function tituloDe(aba){return aba.titulo||aba.tituloInicial||'Conversa';}
// Título e "rodando" de cada conversa vão pra aba dela na grade.
function desenharAbas(){agendarColuna();for(const aba of chat.abas)G.atualizar('c:'+aba.id,{titulo:tituloDe(aba),dica:tituloDe(aba)+' (fechar a aba não apaga a conversa)',rodando:aba.rodando||aba.pendentes.size>0,espera:aba.pendentes.size>0||Boolean(aba.dormindo&&aba.esperando)});
  // num espaço (?espaco=), a guia leva o título da primeira conversa dele, pra achar entre as outras janelas
  if(G.espaco){const c=G.ids().find(x=>x.startsWith('c:')),a=c&&chat.abas.find(x=>x.id===c.slice(2));document.title=(a?tituloDe(a):'Espaço')+' · Ratoeira';}}
function ativar(id){
  chat.ativa=id;G.mostrar('c:'+id);lerTerminou(id);agendarColuna();
  const aba=chat.abas.find(a=>a.id===id);if(aba){rolarProFim(aba);aba.comp.area.focus({preventScroll:true});}
}
// Nome que a pessoa dá à conversa: fica no servidor de agentes dela (vale em qualquer navegador, na Início e
// nas recentes). Nome vazio volta ao título que o agente deu.
async function renomearConversa(aba,nome){
  const antes=aba.titulo;if(nome){aba.titulo=nome;desenharAbas();}
  try{const r=await pedirAba(aba,'renomear',{titulo:nome});aba.titulo=r.titulo;avisarAbertas();}
  catch(e){aba.titulo=antes;toast('Não renomeei: '+e.message);}
  desenharAbas();
}
// Chamado pela grade quando a aba fecha: a conversa continua no agente, só sai da tela.
function fecharAba(id){
  const i=chat.abas.findIndex(a=>a.id===id);if(i<0)return;const aba=chat.abas[i];
  if(!aba.dormindo&&!aba.acordando)pedirAba(aba,'soltar').catch(()=>{});
  aba.painel.remove();chat.abas.splice(i,1);
  if(chat.ativa===id)chat.ativa=null;
  // última aba da conversa compartilhada: a conexão com o servidor do dono fecha junto
  if(aba.conn&&!chat.abas.some(a=>a.conn===aba.conn)){conexoesConvite.delete(aba.conn.convite);const s=aba.conn.sock;aba.conn.sock=null;s?.close();}
  avisarAbertas();
}

function conexaoDoConvite(id){let c=conexoesConvite.get(id);if(!c){c=novaConexao(id);conexoesConvite.set(id,c);}return c;}
async function abrirConversa(id,{ativar:ativarAgora=true,titulo=null,painel=null,cwd=null,dormir=false}={}){
  let aba=chat.abas.find(a=>a.id===id);
  if(aba?.dormindo&&!dormir)await acordar(aba);
  if(!aba){
    let {agente,sessao}=partes(id);
    // conversa de outra pessoa (cp:<convite>): roda no servidor de agentes do dono, por uma conexão só dela
    let convite=null;
    if(id.startsWith('cp:')){
      convite=await conviteAinda(id.slice(3));
      if(!convite)throw new Error('Essa conversa não está mais compartilhada contigo.');
      ({agente,sessao}=convite);cwd=convite.cwd;titulo??=convite.titulo;
    }
    aba={id,agente,sessao,cwd:cwd||ler('ratoeira:chat-cwds',{})[id]||null,tituloInicial:titulo?titulo.slice(0,60):null,titulo:null,
      blocos:[],porChave:new Map(),rodando:false,pendentes:new Map(),seq:0,config:{},uso:null,presenca:[]};
    if(convite){aba.convite=convite;aba.conn=conexaoDoConvite(convite.id);}
    montarPainel(aba);chat.abas.push(aba);
    aba.naGrade={id:'c:'+id,tipo:'conversa',titulo:tituloDe(aba),el:aba.painel,icone:agente,aoMostrar:()=>{if(aba.dormindo)acordar(aba).catch(()=>{});else rolarProFim(aba);},aoFechar:()=>fecharAba(id),
      copiarLink:()=>copiarLinkConversa(aba),...(navigator.share&&TOQUE?{enviarLink:()=>enviarLinkConversa(aba)}:{}),...(convite?{}:{renomear:nome=>renomearConversa(aba,nome)})};
    if(dormir){aba.dormindo=true;aba.msgs.replaceChildren(el('p','chat-vazio','Carregando a conversa…'));}
    G.registrar(aba.naGrade,{painel,ativar:ativarAgora});
    if(dormir){desenharAbas();return aba;}
    try{await carregarOpcoes(agente);await assinar(aba,false);lembrarConversa(aba);avisarAbertas();}
    catch(e){aba.painel.remove();chat.abas=chat.abas.filter(a=>a!==aba);G.remover('c:'+id);throw e;}
  }
  else if(painel&&G.painelDe('c:'+id)!==painel)G.registrar(aba.naGrade,{painel});
  desenharAbas();
  if(ativarAgora)ativar(id);
  return aba;
}

// Aba que voltou dormindo conecta aqui: na primeira vez que aparece ou quando alguém a abre de novo.
function acordar(aba){
  if(aba.acordando)return aba.acordando;
  aba.dormindo=false;
  // Sem limite, um servidor que não responde deixava "Carregando a conversa…" pra sempre (20/10/2026). Passado o
  // limite, aparece o Tentar de novo, mas a aba segue acordada: se a resposta vier depois, a conversa aparece igual.
  let limite;
  const DEMOROU=new Error('o servidor de agentes demorou demais pra responder.');
  const demorou=new Promise((_,no)=>{limite=setTimeout(()=>no(DEMOROU),60000);});
  aba.acordando=Promise.race([(async()=>{await carregarOpcoes(aba.agente);await assinar(aba,false);lembrarConversa(aba);avisarAbertas();})(),demorou])
    .finally(()=>clearTimeout(limite))
    .then(()=>{aba.acordando=null;},e=>{
      aba.acordando=null;if(e!==DEMOROU)aba.dormindo=true;
      const tentar=el('button',undefined,'Tentar de novo');tentar.type='button';tentar.onclick=()=>acordar(aba).catch(()=>{});
      const p=el('p','chat-vazio','Não abriu a conversa: '+(e?.message||e)+' ');p.append(tentar);aba.msgs.replaceChildren(p);throw e;});
  return aba.acordando;
}
// Título, pasta e estado das abas dormindo, numa lista só (em vez de abrir uma por uma).
async function situarDormindo(){
  const lista=await pedir('listar',{});
  for(const aba of chat.abas){
    if(!aba.dormindo)continue;
    const x=lista.find(c=>c.agente===aba.agente&&c.sessao===aba.sessao);if(!x)continue;
    if(x.titulo)aba.titulo=x.titulo;if(!aba.cwd&&x.cwd)aba.cwd=x.cwd;
    aba.rodando=x.estado!=='livre';aba.esperando=x.estado==='esperando';
  }
  desenharAbas();
}
function montarPainel(aba){
  const p=el('section','conv');p.hidden=true;
  const info=el('div','conv-info');const msgs=el('div','conv-msgs');msgs.setAttribute('aria-live','polite');
  const perm=el('div','conv-perm');perm.hidden=true;
  // O ratinho andando enquanto o agente trabalha (some quando ele termina). Sem isso, um comando demorado
  // deixava a tela parada e não dava pra saber se tinha travado.
  const vivo=el('div','conv-vivo');vivo.hidden=true;
  const pista=el('span','rato-pista');pista.innerHTML=RATO;
  const vivoTexto=el('span','vivo-texto'),vivoExtra=el('span','vivo-extra');vivo.append(pista,vivoTexto,vivoExtra);
  const comp=compositor({placeholder:'Responder…',compacto:true,comandos:()=>aba.comandos||[],pessoas:()=>pessoasDaAba(aba)});comp.aba=aba;
  aba.ctxAviso=avisoContexto(aba);comp.uso.aviso.after(aba.ctxAviso.box);
  // com o agente rodando, a mensagem entra no turno em andamento (o servidor manda pelo steering do adaptador)
  comp.raiz.onsubmit=async e=>{e.preventDefault();const t=comp.area.value.trim();if(!t&&!temAnexo(comp))return;
    // nota interna (botão "Entre nós", ou mensagem começando com "// "): só pras pessoas, o agente não vê
    if(emModoNota(aba)||/^\/\/\s/.test(t)){
      const texto=t.replace(/^\/\/\s+/,'');if(!texto)return;
      if(temAnexo(comp)){toast('Nota interna vai só com texto, por enquanto.');return;}
      comp.area.value='';comp.area.style.height='auto';
      try{await pedirAba(aba,'nota',{texto,apos:aba.blocos.filter(b=>b.tipo==='user').length});await avisarAtividade(aba,'nota',texto,await mencionar(aba,comp,texto));}
      catch(err){comp.area.value=t;toast('Não salvei a nota: '+err.message);}
      return;
    }
    const noMeio=aba.rodando;const anexos=anexosDe(comp);
    // com o agente rodando e "Na fila": espera o turno acabar (vai sozinha, na ordem)
    if(noMeio&&modoEnvio(aba)==='fila'){
      comp.area.value='';comp.area.style.height='auto';avisarDigitando(aba,false);estado(aba);
      try{await liberarLinks(aba,t);const texto=await comArquivos(await prepararEnvio(aba,comp,t),anexos,(op,d)=>pedirAba(aba,op,d));await pedirAba(aba,'enfileirar',{blocos:blocosDe(texto,anexos),aparelho:TIPO_APARELHO});limparAnexos(comp);await mencionar(aba,comp,t);}
      catch(err){comp.area.value=t;toast('Não pus na fila: '+err.message);}
      return;
    }
    comp.area.value='';comp.area.style.height='auto';aba.rodando=true;avisarDigitando(aba,false);estado(aba);
    try{await liberarLinks(aba,t);const texto=await comArquivos(await prepararEnvio(aba,comp,t),anexos,(op,d)=>pedirAba(aba,op,d));await enviarRetomando(aba,blocosDe(texto,anexos));limparAnexos(comp);estado(aba);const jaEra=aba.compartilhada,marcados=await mencionar(aba,comp,t);if(jaEra)avisarAtividade(aba,'mensagem',t,marcados);}
    catch(err){if(!noMeio)aba.rodando=false;estado(aba);comp.area.value=t;toast('Não enviou: '+err.message);}};
  // "Entre nós": a próxima mensagem vira nota interna (só aparece na conversa compartilhada)
  const notaBtn=el('button','nota-alternar');notaBtn.type='button';notaBtn.hidden=true;notaBtn.append(icone('nota'),el('span','rotulo','Entre nós'));
  notaBtn.title='Nota pra quem está na conversa: o agente não vê (atalho: começar com // )';notaBtn.setAttribute('aria-pressed','false');
  notaBtn.onclick=()=>{aba.modoNota=!aba.modoNota;desenharModoNota(aba);comp.rodando(aba.rodando&&!emModoNota(aba));comp.area.focus();};
  comp.raiz.querySelector('.composer-dir').prepend(notaBtn);comp.notaBtn=notaBtn;
  // com o agente rodando: a mensagem vai na fila (espera a vez) ou agora (entra no turno)
  // um botão só que alterna Fila ⇄ Agora; o texto some quando a caixa fica estreita (container query no portal.css)
  const envio=el('button','envio-alternar');envio.type='button';envio.hidden=true;
  envio.onclick=()=>{aba.modoEnvio=modoEnvio(aba)==='fila'?'agora':'fila';desenharEnvio(aba);comp.area.focus();};
  comp.raiz.querySelector('.composer-dir').prepend(envio);comp.envio=envio;
  comp.area.addEventListener('input',()=>avisarDigitando(aba,Boolean(comp.area.value.trim())));
  comp.area.addEventListener('blur',()=>avisarDigitando(aba,false));
  const parar=async()=>{comp.botao.disabled=true;try{await pedirAba(aba,'cancelar');}catch(err){toast('Não consegui parar: '+err.message);}finally{comp.botao.disabled=false;}};
  comp.botao.addEventListener('click',ev=>{if(!aba.rodando||comp.botao.type==='submit')return;ev.preventDefault();parar();});
  comp.parar=()=>{if(!aba.rodando||comp.botao.disabled)return false;parar();return true;};
  comp.anterior=()=>{const b=[...aba.blocos].reverse().find(x=>x.tipo==='user'&&x.texto);return b?b.texto.replace(MARCA,''):null;};
  // Troca de modelo/esforço/permissão vale já pro próximo turno. Só o agente não muda numa conversa aberta.
  const trocar=async(sel,rotulo)=>{
    const configId=sel===comp.modelo.sel?opcaoDe(aba.config.configOptions,'model')?.id:sel.dataset.config;
    if(!configId)return;
    try{const r=await pedirAba(aba,'opcao',{opcao:configId,valor:sel.value});aba.config=r.config||aba.config;}
    catch(err){toast('Não troquei '+rotulo+': '+err.message);}
    estado(aba);
  };
  comp.modelo.sel.addEventListener('change',()=>trocar(comp.modelo.sel,'o modelo'));
  comp.esforco.sel.addEventListener('change',()=>trocar(comp.esforco.sel,'o esforço'));
  comp.modo.sel.addEventListener('change',()=>trocar(comp.modo.sel,'as permissões'));
  msgs.addEventListener('click',e=>{
    const c=e.target.closest('.caminho');if(!c||!msgs.contains(c))return;
    e.preventDefault();e.stopPropagation();
    if(c.dataset.raiz){window.ratoeiraAbrirArquivo?.(c.dataset.caminho);return;}
    abrirCaminho(c.dataset.caminho+(c.dataset.linha?':'+c.dataset.linha:''),aba.cwd);
  });
  const faixaEl=el('div','conv-faixa');faixaEl.hidden=true;
  const soLer=el('p','conv-so-ler');soLer.hidden=true;
  const filaEl=el('div','conv-fila');filaEl.hidden=true;
  const digitandoEl=el('div','conv-digitando');digitandoEl.hidden=true;digitandoEl.setAttribute('aria-live','polite');
  // o último pedido mandado (de qualquer pessoa), numa linha fixa no topo quando ele sai por cima da tela
  const ultimo=el('button','conv-ultimo');ultimo.type='button';ultimo.tabIndex=-1;ultimo.setAttribute('aria-hidden','true');
  ultimo.title='Voltar pro último pedido';ultimo.append(icone('subir'),el('span','ultimo-autor'),el('span','ultimo-texto'));
  ultimo.onclick=()=>{const n=aba.ultimoNo;if(!n)return;
    msgs.scrollTo({top:msgs.scrollTop+n.getBoundingClientRect().top-msgs.getBoundingClientRect().top-12,behavior:'smooth'});
    const b=n.querySelector('.balao');b.classList.remove('pisca');void b.offsetWidth;b.classList.add('pisca');setTimeout(()=>b.classList.remove('pisca'),1400);};
  msgs.addEventListener('scroll',()=>conferirUltimo(aba),{passive:true});
  const rolo=el('div','conv-rolo');rolo.append(ultimo,msgs);
  p.append(info,faixaEl,rolo,vivo,digitandoEl,perm,filaEl,comp.raiz,soLer);
  Object.assign(aba,{painel:p,info,faixaEl,soLer,filaEl,digitandoEl,msgs,ultimo,perm,comp,vivo,vivoTexto,vivoExtra});
  if(aba.conn)p.classList.add('convidado');
}

// Cada evento do agente (ACP) vira um bloco. Mensagem e raciocínio chegam em pedaços que continuam o
// último bloco do mesmo tipo; ferramenta chega de novo com o mesmo toolCallId (status mudando) e é atualizada.
function aoEvento(aba,u){
  const t=u?.sessionUpdate;if(!t)return;const ultimo=aba.blocos[aba.blocos.length-1];
  const bloco=(chave,novo)=>{let b=chave&&aba.porChave.get(chave);if(!b){b=novo;aba.blocos.push(b);if(chave)aba.porChave.set(chave,b);}return b;};
  const pedaco=tipo=>{const txt=u.content?.type==='text'?u.content.text:'';if(!txt)return;const b=ultimo?.tipo===tipo?ultimo:bloco(null,{tipo,texto:''});b.texto+=txt;b.sujo=true;agendar(aba);};
  if(t==='user_message_chunk'&&u.content?.type==='image'&&u.content.data){bloco(null,{tipo:'imagem',src:'data:'+u.content.mimeType+';base64,'+u.content.data,autor:u.ratoeira_autor||null});agendar(aba);return;}
  // mensagem de outra pessoa (conversa compartilhada) não emenda na anterior
  if(t==='user_message_chunk'&&u.ratoeira_autor&&ultimo?.tipo==='user'&&ultimo.autor?.email!==u.ratoeira_autor.email){bloco(null,{tipo:'user',texto:'',autor:u.ratoeira_autor});return pedaco('user');}
  if(t==='user_message_chunk'){pedaco('user');const b=aba.blocos[aba.blocos.length-1];if(b?.tipo==='user'&&u.ratoeira_autor)b.autor??=u.ratoeira_autor;return;}
  if(t==='ratoeira_fila'){aba.fila=u.fila||[];aba.filaParada=Boolean(u.parada);desenharFila(aba);return;}
  if(t==='ratoeira_nota'&&u.nota?.id){
    if((aba.notasVistas??=new Set()).has(u.nota.id))return;aba.notasVistas.add(u.nota.id);
    // no lugar dela: depois da mensagem de gente número `apos` e do que veio em seguida (a resposta)
    const b={tipo:'nota-interna',nota:u.nota,sujo:true};let vistos=0,i=aba.blocos.length;
    for(let k=0;k<aba.blocos.length;k++)if(aba.blocos[k].tipo==='user'&&++vistos>u.nota.apos){i=k;break;}
    aba.blocos.splice(i,0,b);if(i<aba.blocos.length-1)aba.refazer=true;agendar(aba);return;
  }
  if(t==='ratoeira_compartilhada'){aba.compartilhada=Boolean(u.compartilhada)||Boolean(aba.conn);faixa(aba);if(!aba.compartilhada)aba.modoNota=false;estado(aba);for(const b of aba.blocos)if(b.tipo==='user')b.sujo=true;agendar(aba);return;}
  if(t==='agent_message_chunk')return pedaco('assistant');
  if(t==='agent_thought_chunk')return pedaco('reasoning');
  if(t==='tool_call'||t==='tool_call_update'){
    const b=bloco('t:'+u.toolCallId,{tipo:'tool',item:{}});
    for(const k of ['title','kind','status','rawInput','rawOutput','content','locations','_meta'])if(u[k]!==undefined&&u[k]!==null)b.item[k]=u[k];
    if(!b.cartao){const url=cartaoDe(aba,b.item);if(url){b.cartao=true;bloco('k:'+u.toolCallId,{tipo:'cartao',url});}}
    // O agente mexeu em arquivo: a árvore da Mesa confere se apareceu coisa nova (portal.js, com espera).
    if(u.status==='completed'&&['edit','delete','move','execute'].includes(b.item.kind))window.dispatchEvent(new CustomEvent('ratoeira:mexeu-arquivos'));
    b.sujo=true;agendar(aba);return;
  }
  if(t==='plan'){const b=bloco('plano',{tipo:'todo'});b.item=u;b.sujo=true;agendar(aba);return;}
  if(t==='available_commands_update'){if(Array.isArray(u.availableCommands))aba.comandos=u.availableCommands;return;}
  if(t==='usage_update'){aba.uso=u;aba.comp.ctx.atualizar(u);desenharContexto(aba);
    // resposta nova: o cache acabou de ser renovado; os limites vêm junto quando o Claude manda
    const lim=limitesDoUso(u._meta?.['_claude/rateLimit']);const p=aba.usoPlano||{};
    aba.usoPlano={cache:p.cache?{...p.cache,ate:Date.now()+p.cache.ttl}:p.cache,limites:lim??p.limites};if(lim)(chat.limites??={})[aba.agente]=lim;
    aba.comp.uso.atualizar(aba.usoPlano);return;}
  if(t==='ratoeira_conta'){aba.conta=u.conta??null;desenharConta(aba.comp,aba.agente,aba);return;}
  if(t==='ratoeira_ultracode'){aba.ultracode=Boolean(u.ultracode);marcarUltracode(aba.comp);return;}
  if(t==='ratoeira_uso'){carregarContas(aba.agente);const lim=u.limites??aba.usoPlano?.limites??null;aba.usoPlano={cache:u.cache??null,limites:lim};if(lim)(chat.limites??={})[aba.agente]=lim;aba.comp.uso.atualizar(aba.usoPlano);return;}
  if(t==='session_info_update'){if(u.title){aba.titulo=u.title;desenharAbas();}return;}
  if(t==='config_option_update'){aba.config={...aba.config,configOptions:u.configOptions};estado(aba);return;}
  if(t==='current_mode_update'){const m=opcaoDe(aba.config.configOptions,'mode');if(m)m.currentValue=u.currentModeId;estado(aba);return;}
  if(t==='ratoeira_pedido'){aba.pendentes.set(u.pedido,u);aba.permRecolhido=false;desenharPermissoes(aba);desenharAbas();return;}
  if(t==='ratoeira_pergunta'){aba.pendentes.set(u.pedido,{...u,tipo:'pergunta'});aba.permRecolhido=false;desenharPermissoes(aba);desenharAbas();return;}
  if(t==='ratoeira_pedido_resolvido'&&u.resposta==='decline')bloco(null,{tipo:'nota',texto:'Pergunta pulada.'});
  if(t==='ratoeira_pedido_resolvido'&&u.content&&typeof u.content==='object'){
    const v=Object.values(u.content).flat().filter(x=>x!==''&&x!==null&&x!==undefined).map(String);
    bloco(null,{tipo:'nota',texto:'Tua resposta: '+(v.join(' · ')||'(em branco)')});agendar(aba);
  }
  if(t==='ratoeira_pedido_resolvido'){aba.pendentes.delete(u.pedido);desenharPermissoes(aba);desenharAbas();return;}
  if(t==='ratoeira_erro'){bloco(null,{tipo:'erro',texto:u.mensagem||'Erro do agente.',motivo:u.motivo,agente:aba.agente});agendar(aba);return;}
  if(t==='ratoeira_limite'){bloco(null,{tipo:'limite',agente:u.agente,volta:u.volta,texto:u.texto});agendar(aba);return;}
  if(t==='ratoeira_fim'){fimContexto(aba,u.stopReason);window.dispatchEvent(new CustomEvent('ratoeira:mexeu-arquivos'));window.dispatchEvent(new CustomEvent('ratoeira:resposta-terminou'));const lig=ligacaoDe(aba.id);if(lig)window.ratoeiraApps?.recarregar(lig.app);
    // cartões do app nesta conversa relêem (ex.: e-mail aprovado por mensagem vira "enviado")
    for(const f of aba.msgs.querySelectorAll('iframe.cartao-app'))try{f.contentWindow.postMessage({ratoeira:1,tipo:'terminou'},location.origin);}catch{}if(u.stopReason==='cancelled')bloco(null,{tipo:'nota',texto:'Interrompido.'});else if(u.stopReason&&u.stopReason!=='end_turn')bloco(null,{tipo:'nota',texto:'O agente parou ('+u.stopReason+').'});agendar(aba);return;}
}

let quadro=new Set();
function agendar(aba){quadro.add(aba);if(quadro.size===1)requestAnimationFrame(()=>{for(const a of quadro){desenhar(a,!a.refazer);a.refazer=false;}quadro=new Set();});}

function desenhar(aba,incremental=false){
  const perto=aba.msgs.scrollHeight-aba.msgs.scrollTop-aba.msgs.clientHeight<120,antes=aba.msgs.scrollTop;
  if(!incremental){aba.msgs.replaceChildren();for(const b of aba.blocos){b.no=null;b.sujo=true;}}
  else if(aba.blocos.length)aba.msgs.querySelector('.chat-vazio')?.remove();
  for(const b of aba.blocos){
    if(b.no&&!b.sujo)continue;
    const novoNo=blocoDOM(b,aba.cwd,aba);if(b.no)b.no.replaceWith(novoNo);else aba.msgs.append(novoNo);b.no=novoNo;b.sujo=false;
  }
  autoria(aba);
  if(!aba.blocos.length)aba.msgs.replaceChildren(el('p','chat-vazio','Conversa vazia.'));
  // só a primeira vez vai pro fim sozinha; depois, só quem já estava no fim acompanha o que chega
  if(perto||!aba.desenhada)rolarProFim(aba);else if(!incremental)aba.msgs.scrollTop=antes;
  aba.desenhada=true;
  ultimoPedido(aba);
}
function rolarProFim(aba){aba.msgs.scrollTop=aba.msgs.scrollHeight;}
// Acha o último pedido com texto (imagem sozinha não conta) e põe a primeira linha dele na faixa.
function ultimoPedido(aba){
  const n=[...aba.msgs.querySelectorAll(':scope > .msg.user')].reverse().find(x=>x.querySelector('.balao'))||null;
  if(n!==aba.ultimoNo||n?.dataset.lido!=='1'){
    aba.ultimoNo=n;
    if(n){n.dataset.lido='1';
      const t=n.querySelector('.balao').textContent.split('\n').find(l=>l.trim())||'';
      const autor=n.classList.contains('de-outro')?n.querySelector('.msg-autor')?.textContent||'':'';
      aba.ultimo.querySelector('.ultimo-autor').textContent=autor;aba.ultimo.querySelector('.ultimo-texto').textContent=t.trim();}
  }
  conferirUltimo(aba);
}
function conferirUltimo(aba){
  const n=aba.ultimoNo,b=aba.ultimo;if(!b)return;
  const ver=Boolean(n&&n.isConnected&&n.getBoundingClientRect().bottom<aba.msgs.getBoundingClientRect().top+8);
  if(b.classList.contains('aparece')===ver)return;
  b.classList.toggle('aparece',ver);b.tabIndex=ver?0:-1;b.setAttribute('aria-hidden',String(!ver));
}

// Nome de ferramenta que gente lê: o do Claude vem em _meta.claudeCode.toolName (Bash, Read...); o resto, o título.
const NOME_TIPO={execute:'Terminal',read:'Ler',edit:'Editar',delete:'Apagar',move:'Mover',search:'Buscar',fetch:'Web',think:'Pensar'};
// Cartão de uma aplicação (ex.: e-mail que o app preparou, pra pessoa revisar e mandar): a ferramenta do app
// ligado à conversa devolve ratoeira_cartao (um caminho dentro do app) e o chat mostra a página dele embutida logo
// abaixo. O clique é da pessoa, dentro do app e com a identidade dela: o agente não alcança. A altura vem do
// /_ratoeira/app.js da página (mensagem "altura").
function cartaoDe(aba,item){
  if(item.status!=='completed')return null;
  const lig=ligacaoDe(aba.id);if(!lig)return null;
  const mcp=(item._meta?.claudeCode?.toolName||item.title||'').match(/^mcp(?:__|[._])([\w-]+?)(?:__|[._])(\w+)/);
  if(!mcp||!lig.mcp.some(m=>m.name===mcp[1]))return null;
  const c=JSON.stringify([item.rawOutput??null,item.content??null]).match(/ratoeira_cartao\\?"\s*:\s*\\?"([a-z0-9][a-z0-9/_-]{0,200})\\?"/);
  return c&&!c[1].includes('//')?lig.app+c[1]:null;
}
window.addEventListener('message',e=>{
  const m=e.data;if(!m||m.ratoeira!==1||m.tipo!=='altura'||e.origin!==location.origin)return;
  for(const f of document.querySelectorAll('iframe.cartao-app'))if(f.contentWindow===e.source){f.style.height=Math.max(60,Math.min(900,Math.round(Number(m.altura)||0)))+'px';break;}
});
function nomeFerramenta(it){
  const n=it._meta?.claudeCode?.toolName||'';
  const mcp=(n||it.title||'').match(/^mcp(?:__|[._])([\w-]+?)(?:__|[._])(\w+)/);
  if(mcp)return mcp[2].replace(/_/g,' ')+' · '+mcp[1];
  return n||NOME_TIPO[it.kind]||it.title||'ferramenta';
}
function textoDe(it){
  const partesTxt=[];const ri=it.rawInput||{};
  if(ri.command)partesTxt.push('$ '+(Array.isArray(ri.command)?ri.command.join(' '):ri.command));
  for(const c of it.content||[]){
    if(c.type==='content'&&c.content?.type==='text')partesTxt.push(c.content.text);
    else if(c.type==='diff')partesTxt.push('--- '+c.path+'\n'+(c.newText||''));
    else if(c.type==='terminal')partesTxt.push('(terminal '+c.terminalId+')');
  }
  if(!partesTxt.length||(partesTxt.length===1&&ri.command)){
    const o=it.rawOutput;if(o!=null)partesTxt.push(typeof o==='string'?o:o.stdout||o.output||o.formatted_output||JSON.stringify(o,null,2));
  }
  if(!partesTxt.length)partesTxt.push(JSON.stringify(ri,null,2));
  return partesTxt.join('\n').slice(0,20000);
}

// Conversa compartilhada (desde 16/10/2026, "híbrido"): as minhas seguem à direita, só com "Tu"; as dos outros vão
// pra esquerda com rosto (iniciais na cor de cada um) e nome. Sem nome no histórico é do dono: mandou antes de
// compartilhar. Mensagens seguidas da mesma pessoa e o cabeçalho do agente ficam com autoria(), que olha a ordem.
function rostoDe(n,aba,autor,email){
  if(!autor&&aba.conn)autor=aba.convite?.donoNome||'Dono';
  const meu=autor?(email?email===meuEmail():autor===meuNome()):!aba.conn,nome=meu?'Tu':autor;
  n.dataset.autor=email||autor||'eu';n.classList.toggle('de-outro',!meu);
  if(!meu)n.append(el('span','msg-rosto '+tomDe(nome),iniciais(nome)));
  n.append(el('div','msg-autor',nome));
}
const tomDe=nome=>{let h=0;for(const c of String(nome))h=(h*31+c.codePointAt(0))>>>0;return 't'+(h%6);};
// Junta as mensagens seguidas da mesma pessoa (sem repetir rosto e nome) e põe, antes da primeira resposta do
// agente depois de cada pedido, quem é ele e pra quem está respondendo. Roda no fim de cada desenho.
const DO_AGENTE='.msg.assistant,.msg.tool,.msg.pensando,.msg.cartao';
function autoria(aba){
  const caixa=aba.msgs;
  if(!aba.compartilhada){caixa.querySelectorAll(':scope > .msg-agente-cab').forEach(h=>h.remove());return;}
  for(const h of caixa.querySelectorAll(':scope > .msg-agente-cab'))if(!h.nextElementSibling?.matches(DO_AGENTE))h.remove();
  let ultimo=null,pedido=null;
  for(const n of [...caixa.children]){
    if(n.classList.contains('msg-agente-cab'))continue;
    if(n.matches('.msg.user')){const k=n.dataset.autor||'';n.classList.toggle('seguida',Boolean(k)&&ultimo===k);ultimo=k;pedido=n;continue;}
    ultimo=null;
    if(!n.matches(DO_AGENTE))continue;
    const ant=n.previousElementSibling,tem=ant?.classList.contains('msg-agente-cab')?ant:null;
    if(!pedido){tem?.remove();continue;}
    const quem=pedido.classList.contains('de-outro')?pedido.querySelector('.msg-autor')?.textContent||'':'';pedido=null;
    const txt=quem?'respondendo '+quem:'respondendo a ti';
    if(tem?.dataset.txt===txt)continue;
    tem?.remove();
    const agente=aba.agente||aba.convite?.agente||'claude';
    const h=el('div','msg-agente-cab');h.dataset.txt=txt;
    const av=el('span','msg-agente-av '+agente);av.append(icone(agente));
    h.append(av,el('b',undefined,nomeAgente(agente)),el('span',undefined,txt));n.before(h);
  }
}
function blocoDOM(b,cwd,aba=null){
  if(b.tipo==='nota-interna'){
    const n=b.nota,meu=n.autor?.email?n.autor.email===meuEmail():false;
    const d=el('div','msg nota-interna'+(meu?'':' de-outro'));
    const cab=el('div','nota-cab');cab.append(icone('nota'),el('span',undefined,(meu?'Tua nota':'Nota de '+(n.autor?.nome||'alguém'))+' · o agente não vê'));
    d.append(cab,el('div','nota-texto',n.texto));
    if(aba&&(!aba.conn||aba.convite?.modo==='entrar')){
      const mandar=el('button','nota-mandar','Mandar pro agente');mandar.type='button';
      mandar.title='Põe o texto da nota na caixa, pra mandar pro agente';
      mandar.onclick=()=>{aba.modoNota=false;desenharModoNota(aba);const c=aba.comp;c.area.value=(meu?'':'Nota de '+(n.autor?.nome||'alguém')+': ')+n.texto;c.area.dispatchEvent(new Event('input'));c.area.focus();};
      d.append(mandar);
    }
    return d;
  }
  if(b.tipo==='cartao'){const n=el('div','msg cartao');const f=el('iframe','cartao-app');f.src=b.url;f.title='Cartão da aplicação';n.append(f);return n;}
  if(b.tipo==='imagem'){const n=el('div','msg user');if(aba?.compartilhada)rostoDe(n,aba,b.autor?.nome||null,b.autor?.email||null);const img=el('img','msg-img');img.src=b.src;img.alt='Imagem enviada';n.append(img);return n;}
  if(b.tipo==='user'){
    const n=el('div','msg user');
    // conversa compartilhada: o nome de quem mandou. Ao vivo vem à parte (autor); no histórico, na frente do texto
    // ("[Ana]: ..."), que é como o agente recebeu.
    let texto=(b.texto||'').replace(DURANTE,''),autor=b.autor?.nome||null,email=b.autor?.email||null;
    const pre=texto.match(PREFIXO_AUTOR);if(pre){autor??=pre[1];texto=texto.slice(pre[0].length);}
    if(aba?.compartilhada)rostoDe(n,aba,autor,email);
    const cp=texto.match(COPIA);
    if(cp){texto=texto.slice(cp[0].length);const d=el('details','copia-etiqueta');const s=el('summary');s.append(icone('compartilhar'),el('span',undefined,'Continuação da conversa de '+cp[1]+': '+(cp[2]||'sem título')+' ('+cp[3]+' mensagens)'));
      d.append(s,el('div','copia-texto',cp[4]));n.append(d);}
    // arquivos anexados: o <ratoeira-anexos> do fim vira etiqueta (o agente leu o caminho)
    const an=texto.match(ANEXOS),arquivosMsg=an?anexosDoTexto(an[1]):[];if(an)texto=texto.slice(0,an.index);
    const m=texto.match(MARCA);b={...b,texto};
    if(m){const tela=m[1].match(/Tela aberta agora no (.+?): (.+?) \(([^()]*)\)\./m),liga=m[1].match(/^Esta conversa está ligada ao (.+?):/m);
      const arq=m[1].match(/^Arquivo aberto na tela: (.+)\.$/m);const fila=el('div','etiquetas-balao');
      if(tela||liga){const e=el('div','etiqueta no-balao');e.title=m[1];e.append(icone('app'),el('span','etiqueta-app',tela?.[1]||liga?.[1]));if(tela)e.append(el('span','etiqueta-tela',tela[2]));fila.append(e);}
      if(arq){const e=el('div','etiqueta no-balao');e.title=arq[1];e.append(icone('arquivo'),el('span','etiqueta-app',arq[1].split('/').pop()));fila.append(e);}
      if(fila.childElementCount)n.append(fila);}
    if(arquivosMsg.length){const fila=el('div','etiquetas-balao');
      for(const a of arquivosMsg){const e=el('div','etiqueta no-balao');e.title=a.nome+' ('+a.tamanho+')';e.append(icone('arquivo'),el('span','etiqueta-app',a.nome),el('span','etiqueta-tela',a.tamanho));fila.append(e);}
      n.append(fila);}
    const corpo=m?b.texto.slice(m[0].length):b.texto;if(corpo.trim()||!arquivosMsg.length)n.append(el('div','balao',corpo));return n;}
  if(b.tipo==='assistant'){const n=el('div','msg assistant');n.append(markdown(b.texto,cwd));return n;}
  if(b.tipo==='reasoning'){const d=el('details','msg pensando');d.append(el('summary',undefined,'Raciocínio'),el('div','pensando-texto',b.texto));return d;}
  if(b.tipo==='tool'){
    const it=b.item||{};const ri=it.rawInput||{};
    const resumo=(Array.isArray(ri.command)?ri.command.join(' '):ri.command)||ri.file_path||ri.path||ri.pattern||ri.url||ri.query||it.locations?.[0]?.path||(it.title!==nomeFerramenta(it)?it.title:'')||'';
    const st=it.status||'pending';
    const d=el('details','msg tool '+(st==='in_progress'?'running':st));
    const s=el('summary');const r=el('span','tool-resumo',String(resumo).split('\n')[0].slice(0,140));
    // ferramenta de arquivo (ler, editar, escrever): o caminho abre na Mesa, na linha que ela tocou
    const arq=!ri.command&&(ri.file_path||ri.notebook_path||it.locations?.[0]?.path);
    if(arq&&String(resumo)===String(arq)){r.classList.add('caminho');r.dataset.caminho=arq;const l=it.locations?.[0]?.line??ri.offset;if(l)r.dataset.linha=l;r.title='Abrir na Mesa';}
    s.append(el('span','tool-nome',nomeFerramenta(it)),r);
    if(st!=='completed')s.append(el('span','tool-status',{in_progress:'rodando…',pending:'esperando',failed:'falhou'}[st]||st));
    const corpo=el('pre','tool-corpo');corpo.textContent=textoDe(it);d.append(s,corpo);return d;
  }
  if(b.tipo==='todo'){const n=el('div','msg nota');const itens=b.item?.entries||[];n.textContent=itens.length?'Plano: '+itens.map(t=>(t.status==='completed'?'✓ ':'· ')+(t.content||'')).join('  '):'Plano atualizado.';return n;}
  if(b.tipo==='erro'){
    if(b.motivo!=='login')return el('div','msg erro',b.texto);
    // agente sem conta (nunca conectou, o login venceu ou foi revogado): diz o que fazer, não o erro em inglês
    const n=el('div','msg erro erro-login');
    n.append(el('span',null,`Falta conectar a conta do ${nomeAgente(b.agente)}: o login não foi feito ou venceu. Conecta em Configurações › Contas de IA e manda a mensagem de novo.`));
    const ir=el('a','erro-acao','Conectar conta');ir.href='#configuracoes/contas';n.append(ir);
    return n;
  }
  if(b.tipo==='limite'){
    const n=el('div','msg limite'),corpo=el('div','limite-corpo');
    corpo.append(el('strong',undefined,'Acabou o limite de uso da conta'+(b.agente?' do '+b.agente:'')+'.'));
    const passou=b.volta&&b.volta<=Date.now();
    corpo.append(el('p',undefined,!b.volta?'A conta não disse quando volta.':passou?'Já deve ter voltado ('+quandoVolta(b.volta)+'). É só mandar de novo.':'Volta '+quandoVolta(b.volta)+'. Aí é só mandar de novo.'));
    if(b.texto){const d=el('details','limite-original');d.append(el('summary',undefined,'Mensagem original'),el('p',undefined,b.texto));corpo.append(d);}
    n.append(icone('relogio'),corpo);return n;
  }
  return el('div','msg nota',b.texto||'');
}

// ── Ratinho trabalhando ──────────────────────────────────────────────────────
// Desenho fixo daqui (nada do servidor entra no innerHTML). Patas em dois pares que alternam; o chão corre por baixo.
const RATO='<svg class="rato" viewBox="0 0 48 24" aria-hidden="true">'
  +'<path class="rato-rabo" d="M11 15c-5 0-8-2-7-6 .5-2 2.5-2.5 3.5-1"/>'
  +'<g class="pata a"><path d="M15 18.5v3.5"/><path d="M27 18.5v3.5"/></g><g class="pata b"><path d="M18 18.5v3.5"/><path d="M30 18.5v3.5"/></g>'
  +'<g class="rato-corpo"><ellipse cx="21" cy="14" rx="10.5" ry="6"/><path d="M28 10.5c4-1 8 1 10.5 3.5-2.5 1.5-6.5 3-10.5 2"/><circle class="orelha" cx="30" cy="8.5" r="2.6"/><circle class="olho" cx="33.4" cy="12.6" r=".9"/><path class="bigode" d="M38 13.5l4-1.5M38 14.5l4 1"/></g></svg>'
  +'<span class="rato-chao"></span>';
const VERBOS=['Roendo','Farejando','Fuçando','Mordiscando','Cavando','Juntando migalhas','Mexendo os bigodes','Correndo no labirinto','Investigando','Roendo o problema','Escondendo o queijo','Testando a ratoeira','Atravessando o forro','Cheirando o código'];
const duracao=s=>s<60?s+'s':Math.floor(s/60)+'min '+String(s%60).padStart(2,'0')+'s';
function vivo(aba){
  const box=aba.vivo;if(!box)return;
  if(!aba.rodando){box.hidden=true;aba.desde=null;aba.verbo=null;return;}
  aba.desde??=Date.now();box.hidden=false;
  const esperando=aba.pendentes.size>0;box.classList.toggle('esperando',esperando);
  if(!aba.verbo||Date.now()-aba.verboEm>4000){let v;do v=VERBOS[Math.floor(Math.random()*VERBOS.length)];while(v===aba.verbo&&VERBOS.length>1);aba.verbo=v;aba.verboEm=Date.now();}
  // a ferramenta que está rodando agora (comando, leitura...), se tiver
  let ferramenta='';for(let i=aba.blocos.length-1;i>=0&&i>=aba.blocos.length-6;i--){const b=aba.blocos[i];if(b.tipo==='tool'&&['in_progress','pending'].includes(b.item?.status||'pending')){ferramenta=nomeFerramenta(b.item);break;}}
  aba.vivoTexto.textContent=esperando?'Esperando tua resposta':aba.verbo+'…';
  aba.vivoExtra.textContent=[esperando?'':ferramenta,duracao(Math.floor((Date.now()-aba.desde)/1000))].filter(Boolean).join(' · ');
}
setInterval(()=>{if(document.visibilityState!=='visible')return;for(const aba of chat.abas)if(aba.rodando&&!aba.painel.hidden)vivo(aba);},1000);

function estado(aba){
  const c=aba.comp;const lista=aba.config?.configOptions||chat.opcoes[aba.agente]||[];
  if(lista.length){
    const m=opcaoDe(lista,'model');
    opcoes(c.modelo.sel,[{itens:valoresDe(m)}],m?.currentValue);c.modelo.atualizar();c.modelo.box.hidden=!m;
    montarEsforcoModo(c,aba.agente,lista);
  }
  marcarUltracode(c);
  const ligada=appDe(ligacaoDe(aba.id)?.app)?.name;
  aba.info.replaceChildren(el('span',undefined,[nomeAgente(aba.agente),ligada?'ligada ao '+ligada:''].filter(Boolean).join(' · ')));
  const onde=botaoPasta(aba.cwd);if(onde)aba.info.firstChild.after(onde);
  // compartilhar (só o dono; conversa de outra pessoa não se repassa)
  if(!aba.conn&&chat.info?.compartilhar!==false){
    const b=el('button','ib conv-compartilhar');b.type='button';b.title='Compartilhar esta conversa';b.setAttribute('aria-label','Compartilhar esta conversa');b.setAttribute('aria-haspopup','dialog');
    b.append(icone('compartilhar'),el('span',undefined,'Compartilhar'));b.onclick=()=>abrirCompartilhar(aba,b);aba.info.append(b);
  }
  // convidado só pra ler: sem caixa de mensagem
  // quem só lê: a caixa fica, mas só pra nota interna; acesso tirado, nada
  const soLer=Boolean(aba.conn)&&aba.convite?.modo!=='entrar';
  c.raiz.hidden=Boolean(aba.convite?.saiu);aba.soLer.hidden=!soLer&&!aba.convite?.saiu;
  if(aba.convite?.saiu)aba.soLer.textContent='Essa conversa não está mais compartilhada contigo.';
  else if(soLer)aba.soLer.textContent=(aba.convite?.donoNome||'Quem compartilhou')+' compartilhou pra tu acompanhar: dá pra deixar nota, mas não falar com o agente.';
  desenharModoNota(aba);
  c.ctx.atualizar(aba.uso);desenharContexto(aba);
  c.uso.atualizar(aba.usoPlano??{limites:chat.limites?.[aba.agente]});
  desenharConta(c,aba.agente,aba);
  // em modo nota, o botão manda a nota (não vira Parar com o agente rodando)
  c.rodando(aba.rodando&&!emModoNota(aba));c.botao.disabled=false;desenharEnvio(aba);
  aba.painel.classList.toggle('rodando',aba.rodando);
  desenharPermissoes(aba);desenharAbas();vivo(aba);
}

// O agente pediu permissão (fora do modo automático, ou algo que ele não libera sozinho): as opções vêm dele.
// Pergunta do agente com opções (AskUserQuestion do Claude, ou formulário de um MCP), no formato de formulário
// do ACP: cada campo do requestedSchema vira opções (oneOf/enum), caixas (array) ou texto. O campo `<x>_custom`
// é a resposta livre ("Outra") da pergunta <x>. Responder manda {action:'accept', content}; Pular, 'decline'.
// Mais de uma pergunta vai uma por vez, como no Claude Code: Próximo e Anterior, e Responder na última.
// Marcar a opção de uma pergunta de escolha única já avança.
function cartaoPergunta(aba,p){
  const card=el('form','perm-card pergunta');const props=p.requestedSchema?.properties||{};const ids=Object.keys(props);
  const topo=el('div','pq-topo');topo.append(el('strong',undefined,p.message||'O agente tem uma pergunta'));card.append(topo);
  const leitores=[],passos=[];
  const opcoesDe=f=>(f.oneOf||f.anyOf||(f.enum||[]).map(v=>({const:v,title:String(v)}))).filter(o=>o&&o.const!==undefined);
  for(const id of ids){
    const f=props[id]||{};
    if(id.endsWith('_custom')&&props[id.slice(0,-7)])continue;   // vai junto da pergunta dela
    const bloco=el('fieldset','pq');const nome='pq-'+p.pedido+'-'+id;
    const titulo=f.description||(ids.length>2||!p.message?f.title:'');if(titulo)bloco.append(el('legend',undefined,titulo));
    const multi=f.type==='array',ops=multi?opcoesDe(f.items||{}):opcoesDe(f);
    if(ops.length){
      for(const o of ops){
        const lab=el('label','pq-op');const inp=el('input');inp.type=multi?'checkbox':'radio';inp.name=nome;inp.value=String(o.const);
        const txt=el('span','pq-txt');txt.append(el('span','pq-titulo',o.title||String(o.const)));if(o.description)txt.append(el('span','pq-desc',o.description));
        lab.append(inp,txt);bloco.append(lab);
      }
      leitores.push(c=>{const v=[...bloco.querySelectorAll('input[name="'+CSS.escape(nome)+'"]:checked')].map(i=>i.value);if(multi){if(v.length)c[id]=v;}else if(v[0]!==undefined)c[id]=v[0];});
    }else if(f.type==='boolean'){
      const lab=el('label','pq-op');const inp=el('input');inp.type='checkbox';lab.append(inp,el('span','pq-titulo',f.title||id));bloco.append(lab);
      leitores.push(c=>{c[id]=inp.checked;});
    }else{
      const inp=el('input','pq-livre');inp.type=f.type==='number'||f.type==='integer'?'number':'text';inp.placeholder=f.title||'';bloco.append(inp);
      leitores.push(c=>{const v=inp.value.trim();if(v)c[id]=inp.type==='number'?Number(v):v;});
    }
    const outra=props[id+'_custom'];
    if(outra){const inp=el('input','pq-livre');inp.type='text';inp.placeholder=ops.length?'Outra resposta ou um comentário (opcional)':'';bloco.append(inp);
      leitores.push(c=>{const v=inp.value.trim();if(v)c[id+'_custom']=v;});}
    card.append(bloco);passos.push(bloco);
  }
  const acoes=el('div','perm-acoes');
  const voltar=el('button','','Anterior');voltar.type='button';
  const ok=el('button','primary','Responder');ok.type='submit';
  const pular=el('button','','Pular');pular.type='button';
  acoes.append(voltar,ok,pular);card.append(acoes);
  const contador=el('span','pq-passo');if(passos.length>1)topo.append(contador);
  let passo=0;
  const ir=n=>{passo=Math.max(0,Math.min(passos.length-1,n));passos.forEach((b,i)=>b.hidden=i!==passo);
    const ultimo=passo===passos.length-1;voltar.hidden=passo===0;ok.textContent=ultimo?'Responder':'Próximo';
    contador.textContent=(passo+1)+' de '+passos.length;};
  ir(0);
  voltar.onclick=()=>ir(passo-1);
  // escolha única marcada já leva pra próxima (a marca aparece antes de pular); na última, quem manda é o botão
  card.addEventListener('change',e=>{if(e.target.type!=='radio'||passo>=passos.length-1)return;const de=passo;setTimeout(()=>{if(passo===de)ir(passo+1);},250);});
  const responder=async resposta=>{
    acoes.querySelectorAll('button').forEach(x=>x.disabled=true);
    try{await pedirAba(aba,'responder',{pedido:p.pedido,resposta});aba.pendentes.delete(p.pedido);desenharPermissoes(aba);desenharAbas();}
    catch(e){toast('Não consegui responder: '+e.message);acoes.querySelectorAll('button').forEach(x=>x.disabled=false);}
  };
  // Enter num campo de texto também avança, em vez de mandar tudo antes da hora
  card.onsubmit=e=>{e.preventDefault();if(passo<passos.length-1){ir(passo+1);return;}const content={};for(const l of leitores)l(content);responder({action:'accept',content});};
  pular.onclick=()=>responder({action:'decline'});
  return card;
}
// O cartão pode ocupar quase toda a conversa (no celular sobrava uma faixa pra rolar o texto do agente):
// a barra de cima recolhe e abre sem redesenhar, então o que já foi marcado não se perde.
// Cada cartão fica guardado pelo id do pedido e volta igual a cada redesenho (o estado da conversa muda e
// redesenha isto toda hora): sem isso, o que a pessoa tinha digitado em "Outra" sumia antes de ela mandar.
function desenharPermissoes(aba){
  const box=aba.perm;box.replaceChildren();box.hidden=!aba.pendentes.size;
  const guardados=aba.cartoesPerm??=new Map();for(const id of guardados.keys())if(!aba.pendentes.has(id))guardados.delete(id);
  if(!aba.pendentes.size){aba.permRecolhido=false;box.classList.remove('recolhido');return;}
  // conversa de outra pessoa: quem aprova é o dono (o agente roda com o acesso dele)
  if(aba.conn){box.append(el('p','perm-convidado','O agente está esperando '+(aba.convite?.donoNome||'quem compartilhou')+' responder um pedido.'));return;}
  const n=aba.pendentes.size,perg=[...aba.pendentes.values()].some(p=>p.tipo==='pergunta');
  const barra=el('button','perm-barra');barra.type='button';
  const rot=el('span','perm-barra-t',(perg?'O agente tem '+(n>1?n+' pedidos':'uma pergunta'):'O agente pede '+(n>1?n+' permissões':'permissão')));
  const acao=el('span','perm-barra-a');barra.append(rot,acao);
  const aplicar=()=>{box.classList.toggle('recolhido',!!aba.permRecolhido);acao.textContent=aba.permRecolhido?'Abrir e responder':'Recolher pra ler a conversa';barra.setAttribute('aria-expanded',String(!aba.permRecolhido));};
  barra.onclick=()=>{aba.permRecolhido=!aba.permRecolhido;aplicar();};
  aplicar();box.append(barra);
  for(const p of aba.pendentes.values()){
    if(!guardados.has(p.pedido))guardados.set(p.pedido,p.tipo==='pergunta'?cartaoPergunta(aba,p):cartaoPermissao(aba,p));
    box.append(guardados.get(p.pedido));
  }
}
function cartaoPermissao(aba,p){
  const card=el('div','perm-card');
  const tc=p.toolCall||{};const ri=tc.rawInput||{};const alvo=(Array.isArray(ri.command)?ri.command.join(' '):ri.command)||ri.file_path||ri.path||'';
  card.append(el('strong',undefined,tc.title||'O agente quer usar uma ferramenta'));
  if(alvo&&alvo!==tc.title)card.append(el('pre',undefined,String(alvo).slice(0,2000)));
  const acoes=el('div','perm-acoes');
  for(const o of p.options||[]){
    const b=el('button',String(o.kind||'').startsWith('reject')?'':'primary',o.name||o.optionId);b.type='button';
    b.onclick=async()=>{acoes.querySelectorAll('button').forEach(x=>x.disabled=true);
      try{await pedirAba(aba,'permitir',{pedido:p.pedido,opcao:o.optionId});aba.pendentes.delete(p.pedido);desenharPermissoes(aba);desenharAbas();}
      catch(e){toast('Não consegui responder: '+e.message);acoes.querySelectorAll('button').forEach(x=>x.disabled=false);}};
    acoes.append(b);
  }
  card.append(acoes);return card;
}

// ── Início: prompt de conversa nova e os cards das conversas ────────────────
// Lista as conversas dos agentes de quem está logado: quem espera resposta, quem está rodando, as últimas.
const inicio={timer:null,comp:null};
function linha(titulo,meta,{ponto,acao}={}){
  const li=el('li');const b=el('button','linha');b.type='button';
  if(ponto)b.append(el('i','dot '+ponto));
  b.append(el('span','t',titulo),el('span','w',meta));b.onclick=acao;li.append(b);return li;
}
function vazio(texto){return el('li','vazio',texto);}
const ondeCurto=cwd=>(cwd||'').replace(chat.info?.pastaPadrao||'\u0000','').replace(/^\/home\/[^/]+\//,'~/').replace(/^\//,'')||'raiz';
async function atualizarInicio(){
  const todos=await pedir('listar',{});
  const espera=todos.filter(a=>a.estado==='esperando'||(a.pedidos||[]).length);
  const rodando=todos.filter(a=>a.estado==='rodando'&&!espera.includes(a));
  const abrir=a=>()=>abrirNoPainel(idDe(a.agente,a.sessao),a.titulo).catch(e=>toast('Não abriu: '+e.message));
  // resumo embaixo da saudação
  const partesR=[];if(rodando.length)partesR.push(rodando.length===1?'1 agente rodando':rodando.length+' agentes rodando');if(espera.length)partesR.push(espera.length===1?'1 esperando tua resposta':espera.length+' esperando tua resposta');
  $('home-resumo').textContent=partesR.length?partesR.join(' e ')+'.':'Nenhum agente trabalhando agora.';
  $('home-espera').hidden=!espera.length;
  $('home-espera-lista').replaceChildren(...espera.slice(0,4).map(a=>{
    const p=(a.pedidos||[])[0];const ri=p?.toolCall?.rawInput||{};const alvo=(Array.isArray(ri.command)?ri.command.join(' '):ri.command)||ri.file_path||'';
    const li=el('li','pedido');li.append(el('strong',undefined,a.titulo||'Sem título'));
    if(p)li.append(el('span','pedido-o-que',p.toolCall?.title||'Quer usar uma ferramenta'));
    if(alvo)li.append(el('code',undefined,String(alvo).split('\n')[0].slice(0,200)));
    const b=el('button','primary','Responder');b.type='button';b.onclick=abrir(a);li.append(b);return li;
  }));
  $('home-rodando').hidden=false;
  $('home-rodando-lista').replaceChildren(...(rodando.length?rodando.slice(0,5).map(a=>linha(a.titulo||'Sem título',quando(a.atualizada),{ponto:'ok',acao:abrir(a)})):[vazio('Nenhum agente trabalhando agora.')]));
  // abertas no outro aparelho e que não estão abertas aqui; some quando não sobra nenhuma
  const outro=await abertasNoOutro(todos).catch(()=>null),faltam=(outro?.conversas||[]).filter(a=>!abertaAqui(a));
  $('home-outro').hidden=!faltam.length;
  if(faltam.length){
    $('home-outro-t').textContent='Abertas no '+outro.tipo;$('home-outro-quando').textContent=vistoEm(outro.em);
    $('home-outro-lista').replaceChildren(...faltam.slice(0,6).map(a=>linha(a.titulo||'Sem título',[ondeCurto(a.cwd),quando(a.atualizada)].filter(Boolean).join(' · '),{ponto:a.estado==='esperando'?'acc':a.estado==='rodando'?'ok':null,acao:abrir(a)})));
    const todas=$('home-outro-todas');todas.hidden=faltam.length<2;todas.textContent='Abrir as '+faltam.length;
    todas.onclick=()=>abrirVarias(faltam).catch(e=>toast('Não abriu: '+e.message));
  }
  desenharCompartilhadas().catch(()=>{});
  const ultimos=todos.slice(0,6);
  $('home-recentes').hidden=!ultimos.length;
  $('home-recentes-lista').replaceChildren(...ultimos.map(a=>linha(a.titulo||'Sem título',[ondeCurto(a.cwd),quando(a.atualizada)].filter(Boolean).join(' · '),{ponto:espera.includes(a)?'acc':rodando.includes(a)?'ok':null,acao:abrir(a)})));
  const sugs=$('home-sugs');sugs.replaceChildren();
  if(ultimos[0]){const b=el('button','sug');b.type='button';b.append(el('span',undefined,'Continuar “'+(ultimos[0].titulo||'Sem título')+'”'));b.onclick=abrir(ultimos[0]);sugs.append(b);}
}
async function mostrarInicio(){
  clearInterval(inicio.timer);
  if(!chat.info){$('home-prompt').hidden=true;['home-espera','home-rodando','home-outro','home-recentes'].forEach(id=>$(id).hidden=true);return;}
  try{await conectar();await carregarOpcoes();}catch(e){$('home-resumo').textContent='Não consegui falar com os agentes agora.';return;}
  if(!inicio.comp){
    inicio.comp=compositor({placeholder:'O que a gente faz agora?',comPasta:true,comTela:false,comandos:()=>comandosNovos(inicio.comp)});$('composer-home').append(inicio.comp.raiz);
    prepararNovo(inicio.comp,{escolher:false});
    inicio.comp.raiz.onsubmit=ev=>criarConversa(ev,inicio.comp);
  }
  try{preencherNovo(inicio.comp,{escolher:false});$('home-prompt').hidden=false;}catch{}
  const tick=()=>{if(document.body.dataset.view==='inicio'&&document.visibilityState==='visible')atualizarInicio().catch(()=>{});};
  tick();inicio.timer=setInterval(tick,15000);
}
window.addEventListener('ratoeira:view',e=>{if(e.detail==='inicio'){if(chat.info!==null||window.__ratoeiraPortal)mostrarInicio();}else clearInterval(inicio.timer);});

// ── Coluna da Mesa: Arquivos ou Conversas (desde 16/10/2026) ────────────────
// O alternador no topo da coluna da esquerda troca a árvore pela lista das conversas, agrupada: esperando tua
// resposta, rodando agora, compartilhadas contigo, rotinas das últimas 24 h e as tuas. A escolha fica neste
// navegador. Em Arquivos, um aviso no pé diz quem espera ou roda, pra não ficar parado sem ver. A caixa de busca
// é a mesma da árvore: em Conversas, filtra por título e pasta.
const coluna={modo:'arquivos',dados:null,comigo:[],timer:null,quadro:false,verTodas:0,verRodando:false,verPraLer:false};
try{if(localStorage.getItem('ratoeira:mesa-coluna')==='conversas')coluna.modo='conversas';}catch{}
const ROTINA=/^Rotina: /;
function trocarColuna(modo){
  coluna.modo=modo;try{localStorage.setItem('ratoeira:mesa-coluna',modo);}catch{}
  const conv=modo==='conversas',busca=$('files-search');$('files').dataset.coluna=modo;
  $('coluna-arquivos').setAttribute('aria-pressed',String(!conv));$('coluna-conversas').setAttribute('aria-pressed',String(conv));
  $('files-list').hidden=conv;$('conv-lista').hidden=!conv;
  const tinha=busca.value;busca.value='';busca.placeholder=conv?'Buscar conversa…':'Buscar no repo…';
  busca.setAttribute('aria-label',conv?'Buscar conversa pelo título ou pasta':'Buscar arquivo pelo nome');
  // saindo de Conversas com busca escrita: a árvore volta inteira
  if(!conv&&tinha)busca.dispatchEvent(new Event('input'));
  const alca=$('arvore-toggle')?.querySelector('.arvore-alca-nome');if(alca)alca.textContent=conv?'Conversas':'Arquivos';
  desenharColuna();if(conv)atualizarColuna();
}
async function atualizarColuna(){
  if(!chat.info)return;
  try{await iniciar();}catch{return;}
  const [todos,comigo]=await Promise.all([pedir('listar',{}),apiCompartilhar('compartilhadas').then(d=>d.comigo||[]).catch(()=>[])]);
  coluna.dados=todos;coluna.comigo=comigo;desenharColuna();
}
// várias mudanças no mesmo quadro (abas, sino, estado) viram um desenho só
function agendarColuna(){if(coluna.quadro||!coluna.dados)return;coluna.quadro=true;requestAnimationFrame(()=>{coluna.quadro=false;desenharColuna();});}
// O estado da aba aberta e acordada é o mais novo (vem ao vivo); o da lista pode ter até 20 s.
function situacao(a){
  const x=chat.abas.find(b=>!b.conn&&b.agente===a.agente&&b.sessao===a.sessao);
  if(x&&!x.dormindo)return x.pendentes.size?'espera':x.rodando?'rodando':null;
  return a.estado==='esperando'||(a.pedidos||[]).length?'espera':a.estado==='rodando'?'rodando':null;
}
const naoLidasDe=id=>sino.itens.filter(n=>!n.lida&&alvoSino(n)===id).length;
// Botão direito numa conversa da barra (desde 28/10/2026): abrir e marcar como lida ou não lida
function menuConversa(id,{pronta,livre},x,y,origem){
  fecharMenuConversa();
  const m=el('div','menu-ctx');m.setAttribute('role','menu');m.id='menu-conversa';
  const acao=(rotulo,fn)=>{const b=el('button','menu-item',rotulo);b.type='button';b.setAttribute('role','menuitem');b.onclick=()=>{fecharMenuConversa();fn();};m.append(b);};
  acao('Abrir',()=>origem.click());
  if(!id.startsWith('cp:')&&livre)acao(pronta?'Marcar como lida':'Marcar como não lida',()=>{if(pronta){G.lida('c:'+id);lerTerminou(id);}else G.naoLida('c:'+id);agendarColuna();});
  document.body.append(m);
  const r=m.getBoundingClientRect();m.style.left=Math.max(8,Math.min(x,innerWidth-r.width-8))+'px';m.style.top=Math.max(8,Math.min(y,innerHeight-r.height-8))+'px';
  m.addEventListener('keydown',e=>{const bs=[...m.querySelectorAll('button')],i=bs.indexOf(document.activeElement);
    if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();bs[(i+(e.key==='ArrowDown'?1:-1)+bs.length)%bs.length].focus();}
    else if(e.key==='Escape'||e.key==='Tab'){e.preventDefault();fecharMenuConversa();origem?.focus();}});
  m.querySelector('button')?.focus();
}
function fecharMenuConversa(){$('menu-conversa')?.remove();}
document.addEventListener('pointerdown',e=>{const m=$('menu-conversa');if(m&&!m.contains(e.target))fecharMenuConversa();});
function itemColuna({id,titulo,sub,hora,av,espera=false,pronta=false,livre=false,abrir,aparelho=null}){
  const b=el('button','cl-item'+(espera?' espera':'')+(pronta?' pronta':''));b.type='button';b.title=titulo;b.dataset.conv=id;
  if(id===chat.ativa)b.classList.add('ativa');else if(chat.abas.some(x=>x.id===id))b.classList.add('aberta');
  const tx=el('span','cl-tx'),l1=el('span','cl-l1'),l2=el('span','cl-l2');
  // de que aparelho saiu a última mensagem (o servidor de agentes guarda desde 28/10/2026)
  const h=el('span','cl-h',hora||'');if(aparelho){const ic=icone(aparelho,'cl-ap');ic.setAttribute('aria-hidden','false');ic.setAttribute('role','img');ic.setAttribute('aria-label','Última mensagem pelo '+aparelho);h.prepend(ic);h.title='Última mensagem pelo '+aparelho;}
  if(pronta){const d=el('i','dot ok cl-pronta');d.title='Resposta nova, ainda não lida';l1.append(d);}
  l1.append(el('span','cl-t',titulo),h);
  l2.append(el('span','cl-sub',sub||''));
  // em "Não lidas" a bolinha verde já diz que terminou: o número conta só o resto (nota, convite…)
  const n=pronta?sino.itens.filter(x=>!x.lida&&x.tipo!=='terminou'&&alvoSino(x)===id).length:naoLidasDe(id);if(n)l2.append(el('span','cl-n',n>9?'9+':String(n)));
  if(espera)l2.append(el('span','cl-resp','Responder'));
  tx.append(l1,l2);b.append(av,tx);
  b.onclick=()=>{const lidas=sino.itens.filter(x=>!x.lida&&alvoSino(x)===id).map(x=>x.id);if(lidas.length)marcarLidas(lidas);abrir().catch(e=>toast('Não abriu: '+e.message));};
  b.addEventListener('contextmenu',e=>{e.preventDefault();menuConversa(id,{pronta,livre},e.clientX,e.clientY,b);});
  return b;
}
function avAgente(agente){const s=el('span','cl-av ag '+agente);s.append(icone(agente));return s;}
function desenharColuna(){
  const conv=coluna.modo==='conversas',box=$('conv-lista'),dados=coluna.dados||[];
  // aberta aqui e que ainda não veio na lista (acabou de nascer): entra já, com o estado ao vivo da aba
  const novas=chat.abas.filter(x=>!x.conn&&x.agente&&x.sessao&&!dados.some(a=>a.agente===x.agente&&a.sessao===x.sessao))
    .map(x=>({agente:x.agente,sessao:x.sessao,titulo:tituloDe(x),cwd:x.cwd,estado:'livre',atualizada:null}));
  const todos=[...novas,...dados];
  const espera=todos.filter(a=>situacao(a)==='espera'),rodando=todos.filter(a=>situacao(a)==='rodando');
  // "Não lidas" (desde 28/10/2026): terminou e a pessoa ainda não abriu. Vale a bolinha verde da aba ou, sem aba ou
  // depois de recarregar, o aviso "o agente terminou" ainda não lido do sino. Sai quando ela abre a conversa. Tomou o
  // lugar dos 10 min extras em "Rodando agora", que mostrava como rodando o que já tinha parado.
  const avisosTerminou=id=>sino.itens.filter(n=>!n.lida&&n.tipo==='terminou'&&alvoSino(n)===id);
  const terminouEm=a=>Math.max(Date.parse(a.terminou||a.atualizada||0)||0,...avisosTerminou(idDe(a.agente,a.sessao)).map(n=>Date.parse(n.em||0)||0));
  const praLer=todos.filter(a=>{if(situacao(a))return false;const id=idDe(a.agente,a.sessao);return G.pronta('c:'+id)||avisosTerminou(id).length>0;})
    .sort((a,b)=>terminouEm(b)-terminouEm(a));
  // contagem no alternador e o aviso do pé (só em Arquivos)
  const n=espera.length+rodando.length+praLer.length;
  for(const cont of [$('coluna-n'),$('mesa-conversas-n')])if(cont){cont.hidden=!n;cont.textContent=String(n);cont.classList.toggle('acc',Boolean(espera.length));}
  const partes=[];if(espera.length)partes.push(espera.length+' esperando tua resposta');if(praLer.length)partes.push(praLer.length+(praLer.length>1?' não lidas':' não lida'));if(rodando.length)partes.push(rodando.length+' rodando');
  const sinal=$('mesa-sinal');sinal.hidden=conv||!partes.length;
  sinal.replaceChildren(el('i','dot '+(espera.length?'acc':'ok')),el('span',undefined,partes.join(' · ')));
  if(!conv)return;
  if(!coluna.dados){box.replaceChildren(el('p','tloading','Carregando…'));return;}
  const minha=a=>{const id=idDe(a.agente,a.sessao),st=situacao(a);
    const sub=st==='espera'?((a.pedidos||[])[0]?.toolCall?.title||'Esperando tua resposta'):st==='rodando'?'Trabalhando agora':praLer.includes(a)?'Terminou de responder':[nomeAgente(a.agente),ondeCurto(a.cwd)].filter(Boolean).join(' · ');
    return itemColuna({id,titulo:a.titulo||'Sem título',sub,hora:quando(a.atualizada),av:ROTINA.test(a.titulo||'')?(()=>{const s=el('span','cl-av rotina');s.append(icone('relogio'));return s;})():avAgente(a.agente),espera:st==='espera',pronta:!st&&praLer.includes(a),livre:!st,aparelho:a.aparelho,abrir:()=>abrirNoPainel(id,a.titulo)});};
  // da compartilhada só se sabe o estado quando ela está aberta aqui (a lista do dono não vem)
  const dela=c=>{const x=chat.abas.find(b=>b.id==='cp:'+c.id&&!b.dormindo);return itemColuna({id:'cp:'+c.id,titulo:c.titulo||'Sem título',sub:x?.rodando?'Trabalhando agora':[c.donoNome,c.modo==='entrar'?'pode entrar':'só ler'].join(' · '),hora:quando(c.em),av:el('span','cl-av pessoa '+tomDe(c.donoNome),iniciais(c.donoNome)),abrir:()=>abrirNoPainel('cp:'+c.id,c.titulo)});};
  const grupo=(titulo,itens,luz=null)=>{if(!itens.length)return [];const g=el('p','cl-grupo');if(luz)g.append(el('i','dot '+luz));g.append(el('span',undefined,titulo));return [g,...itens];};
  const q=semAcento($('files-search').value.trim());
  if(q){
    const bate=t=>q.split(/\s+/).every(p=>semAcento(t).includes(p));
    const achadas=[...coluna.comigo.filter(c=>bate((c.titulo||'')+' '+(c.donoNome||''))).map(dela),...todos.filter(a=>bate((a.titulo||'')+' '+(a.cwd||''))).slice(0,60).map(minha)];
    box.replaceChildren(...(achadas.length?achadas:[el('p','tloading','Nenhuma conversa com esse termo.')]));
    return;
  }
  // Pouca coisa à vista: até 5 rodando e 5 não lidas (o resto no "Ver mais"), as 8 tuas mais recentes logo abaixo (quem
  // sai de "Não lidas" cai ali, perto), as rotinas das últimas 24 h e por último até 5 compartilhadas com movimento nos últimos 7 dias (o convite
  // ou o último aviso do sino dela; aberta aqui conta como movimento). O resto vai pro
  // "Ver todas", por data, carregando de 20 em 20.
  const agora=Date.now(),dia=agora-864e5,semana=agora-7*864e5,usadas=new Set([...espera,...rodando,...praLer]);
  const mexeu=c=>Math.max(Date.parse(c.em||0)||0,...sino.itens.filter(x=>alvoSino(x)==='cp:'+c.id).map(x=>Date.parse(x.em||0)||0));
  const comigo=coluna.comigo.map(c=>({c,em:mexeu(c)})).sort((a,b)=>b.em-a.em);
  const vivaComigo=x=>x.em>semana||chat.abas.some(b=>b.id==='cp:'+x.c.id);
  const comigoVer=comigo.filter(vivaComigo).slice(0,5);
  const livres=todos.filter(a=>!usadas.has(a)),ehRotina=a=>ROTINA.test(a.titulo||'');
  const rotinas=livres.filter(a=>ehRotina(a)&&Date.parse(a.atualizada||0)>dia);
  const tuas=livres.filter(a=>!ehRotina(a)).slice(0,8);
  const resto=[...livres.filter(a=>!rotinas.includes(a)&&!tuas.includes(a)).map(a=>({em:Date.parse(a.atualizada||0)||0,item:()=>minha(a)})),
    ...comigo.filter(x=>!comigoVer.includes(x)).map(x=>({em:x.em,item:()=>dela(x.c)}))].sort((a,b)=>b.em-a.em);
  const MAX=5,verMais=(lista,chave)=>{const sobra=lista.length-MAX;if(sobra<=0)return [];
    const b=el('button','cl-mais',coluna[chave]?'Ver menos':'Ver mais ('+sobra+')');b.type='button';b.onclick=()=>{coluna[chave]=!coluna[chave];desenharColuna();};return [b];};
  const corta=(lista,chave)=>coluna[chave]?lista:lista.slice(0,MAX);
  const lerTodas=praLer.length>1?(()=>{const b=el('button','cl-mais','Marcar todas como lidas');b.type='button';
    b.onclick=()=>{const ids=[];for(const a of praLer){const id=idDe(a.agente,a.sessao);G.lida('c:'+id);ids.push(...avisosTerminou(id).map(n=>n.id));}if(ids.length)marcarLidas(ids);desenharColuna();};return [b];})():[];
  const itens=[
    ...grupo('Esperando tua resposta',espera.map(minha),'acc'),
    ...grupo('Rodando agora',corta(rodando,'verRodando').map(minha),'acc rodando'),...verMais(rodando,'verRodando'),
    ...grupo('Não lidas',corta(praLer,'verPraLer').map(minha),'ok'),...(praLer.length?[...verMais(praLer,'verPraLer'),...lerTodas]:[]),
    ...grupo('Tuas conversas',tuas.map(minha)),
    ...grupo('Rotinas recentes',rotinas.map(minha)),
    ...grupo('Compartilhadas contigo',comigoVer.map(x=>dela(x.c))),
    ...grupo('Todas as outras',resto.slice(0,coluna.verTodas).map(x=>x.item())),
  ];
  const faltam=resto.length-coluna.verTodas;
  if(faltam>0){const b=el('button','cl-mais',(coluna.verTodas?'Carregar mais (':'Ver todas (')+faltam+')');b.type='button';b.onclick=()=>{coluna.verTodas+=20;desenharColuna();};itens.push(b);}
  if(!itens.length)itens.push(el('p','tloading','Nenhuma conversa ainda. Começa uma pelo botão de conversa nova do painel.'));
  // desenha de novo sem perder a rolagem
  const topo=box.scrollTop;box.replaceChildren(...itens);box.scrollTop=topo;
}
function ligarColuna(){
  if(!chat.info||!$('coluna-seg'))return;
  // no celular, quem troca é o seletor da barra de cima (portal.js, seletorMesa)
  window.ratoeiraColuna=trocarColuna;
  $('coluna-seg').hidden=false;
  $('coluna-arquivos').onclick=()=>trocarColuna('arquivos');
  $('coluna-conversas').onclick=()=>trocarColuna('conversas');
  $('mesa-sinal').onclick=()=>trocarColuna('conversas');
  $('files-search').addEventListener('input',()=>{if(coluna.modo==='conversas')desenharColuna();});
  trocarColuna(coluna.modo);
  const tick=()=>{if(document.body.dataset.view==='arquivos'&&document.visibilityState==='visible')atualizarColuna().catch(()=>{});};
  tick();coluna.timer=setInterval(tick,20000);
  window.addEventListener('ratoeira:view',e=>{if(e.detail==='arquivos')tick();});
  document.addEventListener('visibilitychange',tick);
}


// ── Conversa compartilhada (desde 15/10/2026) ───────────────────────────────
// O dono compartilha uma conversa com outra pessoa do time, pra só ler ou pra entrar. A conversa segue no servidor
// de agentes do dono; quem foi convidado abre uma aba cp:<convite>, ligada lá pelo gateway. Desenho e regras:
// docs/2026-10-15-conversa-compartilhada.md.
async function apiCompartilhar(rota,corpo){
  const r=await fetch('/_ratoeira/api/'+rota,corpo?{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify(corpo)}:{credentials:'same-origin'});
  const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||'Não consegui.');return d;
}
const iniciais=n=>String(n||'?').split(/\s+/).filter(Boolean).slice(0,2).map(x=>x[0]).join('').toUpperCase()||'?';
function avatares(pessoas){
  const box=el('span','faixa-avs');
  for(const p of pessoas.slice(0,5)){const a=el('span','faixa-av',iniciais(p.nome));a.title=p.nome+(p.email===meuEmail()?' (tu)':'');box.append(a);}
  if(pessoas.length>5)box.append(el('span','faixa-av mais','+'+(pessoas.length-5)));
  return box;
}
// Faixa no topo da conversa compartilhada: de quem é, em nome de quem o agente roda, quem está vendo agora.
function faixa(aba){
  const f=aba.faixaEl;if(!f)return;
  const ativa=aba.compartilhada||aba.conn;f.hidden=!ativa;if(!ativa)return;
  f.replaceChildren();
  const vendo=(aba.presenca||[]).filter(p=>p.email!==meuEmail());
  if(aba.conn){
    const cv=aba.convite||{};
    const t=el('span','faixa-t');t.append(el('strong',undefined,'Conversa de '+(cv.donoNome||'outra pessoa')),
      el('span','faixa-chip',cv.saiu?'Acesso tirado':cv.modo==='entrar'?'Pode entrar':'Só leitura'));
    f.append(t,el('span','faixa-w','O agente roda no ambiente e no plano de '+(cv.donoNome||'quem compartilhou')+'.'));
    if(vendo.length){const v=el('span','faixa-vendo');v.append(el('span',undefined,'Vendo agora'),avatares(vendo));f.append(v);}
    if(!cv.saiu){const copia=el('button','ib faixa-acao','Continuar numa cópia minha');copia.type='button';copia.title='Abre uma conversa nova no teu ambiente e no teu plano, com o que foi dito até aqui';
      copia.onclick=()=>abrirCopia(aba,copia);f.append(copia);}
    if(!cv.saiu){const sair=el('button','ib faixa-acao faixa-sair','Sair');sair.type='button';sair.title='Sair desta conversa compartilhada';
      sair.onclick=async()=>{if(!confirm('Sair da conversa de '+(cv.donoNome||'outra pessoa')+'? Pra voltar, a pessoa precisa compartilhar de novo.'))return;
        try{await apiCompartilhar('compartilhadas/remover',{id:cv.id});fecharAba(aba.id);G.remover('c:'+aba.id);}catch(e){toast('Não saí: '+e.message);}};f.append(sair);}
    return;
  }
  const t=el('span','faixa-t');t.append(el('strong',undefined,'Compartilhada'));f.append(t);
  f.append(el('span','faixa-w','Cada mensagem vai pro agente com o nome de quem mandou. Roda como tu, no teu plano.'));
  if(vendo.length){const v=el('span','faixa-vendo');v.append(el('span',undefined,'Vendo agora'),avatares(vendo));f.append(v);}
  const ger=el('button','ib faixa-acao','Gerenciar');ger.type='button';ger.onclick=()=>abrirCompartilhar(aba,ger);f.append(ger);
}
// ── Nota interna (desde 15/10/2026): conversa entre as pessoas dentro da compartilhada, que o agente não vê.
// Só existe na compartilhada; quem só lê fica sempre nela.
const emModoNota=aba=>Boolean(aba.conn&&aba.convite?.modo!=='entrar')||Boolean(aba.modoNota&&(aba.compartilhada||aba.conn));
function desenharModoNota(aba){
  const c=aba.comp;if(!c?.notaBtn)return;
  const pode=Boolean(aba.compartilhada||aba.conn),travada=Boolean(aba.conn&&aba.convite?.modo!=='entrar'),nota=emModoNota(aba);
  c.notaBtn.hidden=!pode;c.notaBtn.disabled=travada;c.notaBtn.setAttribute('aria-pressed',String(nota));
  c.raiz.classList.toggle('modo-nota',nota);
  c.area.placeholder=nota?'Nota pra quem está na conversa (o agente não vê)…':'Responder…';
}
// ── Fila e "digitando…" (desde 15/10/2026). Fila: com o agente rodando, a mensagem espera a vez (padrão na
// compartilhada, pra ninguém atropelar o turno do outro) ou entra agora (padrão sozinho, como no Claude Code).
const modoEnvio=aba=>aba.modoEnvio??(aba.compartilhada||aba.conn?'fila':'agora');
function desenharEnvio(aba){
  const c=aba.comp;if(!c?.envio)return;
  const mostra=aba.rodando&&!emModoNota(aba);c.envio.hidden=!mostra;if(!mostra)return;
  const m=modoEnvio(aba);
  c.envio.replaceChildren(icone(m==='fila'?'fila':'agora'),el('span','rotulo',m==='fila'?'Fila':'Agora'));
  c.envio.setAttribute('aria-pressed',String(m==='fila'));c.envio.classList.toggle('agora',m==='agora');
  c.envio.title=m==='fila'?'Na fila: espera o agente terminar e vai sozinha. Toca pra trocar por Agora':'Agora: entra no que o agente está fazendo. Toca pra trocar por Fila';
  c.envio.setAttribute('aria-label',m==='fila'?'Mensagem vai na fila (toca pra mandar agora)':'Mensagem vai agora (toca pra pôr na fila)');
  if(c.botao.type==='submit')c.botao.title=m==='fila'?'Pôr na fila: vai quando o agente terminar':'Enviar agora: o agente lê sem parar o que está fazendo';
}
const podeMexerFila=(aba,item)=>!aba.conn||item.autor?.email===meuEmail();
function desenharFila(aba){
  const f=aba.filaEl;if(!f)return;const fila=aba.fila||[];
  f.hidden=!fila.length;f.replaceChildren();if(!fila.length)return;
  f.append(el('div','fila-cab',aba.filaParada?'Fila parada: alguém parou o agente. Manda uma pra continuar.':'Na fila · vai quando o agente terminar'));
  for(const item of fila){
    const linha=el('div','fila-item');const meu=item.autor?.email===meuEmail();
    linha.append(el('span','faixa-av',iniciais(item.autor?.nome)),el('span','fila-texto',(meu?'Tu':item.autor?.nome||'Alguém')+': '+(semAnexos(item.texto)||(item.imagens?'(imagem)':''))));
    if(podeMexerFila(aba,item)){
      const acao=(rot,fn)=>{const b=el('button','ib fila-acao',rot);b.type='button';b.onclick=async()=>{b.disabled=true;try{await fn();}catch(e){toast(e.message);b.disabled=false;}};return b;};
      if(meu)linha.append(acao('Editar',async()=>{await pedirAba(aba,'fila-tirar',{item:item.id});const c=aba.comp;c.area.value=item.texto;c.area.dispatchEvent(new Event('input'));c.area.focus();}));
      linha.append(acao('Mandar agora',()=>pedirAba(aba,'fila-agora',{item:item.id})),acao('Tirar',()=>pedirAba(aba,'fila-tirar',{item:item.id})));
    }
    f.append(linha);
  }
}
// "fulano está digitando": manda no máximo a cada 3 s enquanto tem texto, e "parou" quando apaga ou manda
function avisarDigitando(aba,ativo){
  if(!(aba.compartilhada||aba.conn))return;
  const agora=Date.now();
  if(ativo&&aba.digitandoEm&&agora-aba.digitandoEm<3000)return;
  if(!ativo&&!aba.digitandoEm)return;
  aba.digitandoEm=ativo?agora:0;pedirAba(aba,'digitando',{ativo}).catch(()=>{});
}
function desenharDigitando(aba){
  const d=aba.digitandoEl;if(!d)return;const agora=Date.now();
  for(const [k,v] of aba.digitando??[])if(v.ate<agora)aba.digitando.delete(k);
  const nomes=[...(aba.digitando??new Map()).values()].map(v=>v.nome);
  d.hidden=!nomes.length;d.textContent=nomes.length?nomes.join(' e ')+(nomes.length>1?' estão':' está')+' digitando…':'';
  clearTimeout(aba.digitandoTimer);if(nomes.length)aba.digitandoTimer=setTimeout(()=>desenharDigitando(aba),2000);
}
// avisa o sino dos outros da conversa (nota ou mensagem); conversa que não é compartilhada, o gateway ignora.
// `mencionados` (marcados com @) recebem "te marcou" no lugar do aviso comum.
function avisarAtividade(aba,tipo,texto,mencionados=[]){
  return apiCompartilhar('compartilhadas/atividade',{...(aba.conn?{convite:aba.convite.id}:{agente:aba.agente,sessao:aba.sessao}),tipo,texto,mencionados}).catch(()=>{});
}
// Quem dá pra marcar com @ nesta conversa: o dono vê o time todo (quem não está, ele convida); o convidado, o dono.
const cachePessoas={em:0,dados:null};
async function pessoasDaAba(aba){
  if(Date.now()-cachePessoas.em>30000){cachePessoas.dados=await apiCompartilhar('compartilhadas');cachePessoas.em=Date.now();}
  const d=cachePessoas.dados;
  if(aba.conn)return aba.convite?.dono?[{email:aba.convite.dono,nome:aba.convite.donoNome||aba.convite.dono.split('@')[0],dentro:true}]:[];
  const dentro=new Set(d.minhas.filter(c=>c.agente===aba.agente&&c.sessao===aba.sessao).map(c=>c.convidado));
  return d.pessoas.map(p=>({...p,dentro:dentro.has(p.email)}));
}
// Depois de mandar: quem foi marcado e ainda não está na conversa é convidado (pode entrar), se eu for o dono;
// devolve quem já estava (esses recebem "te marcou").
async function mencionar(aba,c,texto){
  const m=[...(c.mencoes??new Map()).values()].filter(p=>texto.includes('@'+p.nome));c.mencoes=new Map();
  if(!m.length)return [];
  const dentro=[],convidados=[];
  for(const p of m){
    if(p.dentro||aba.conn){dentro.push(p.email);continue;}
    try{await apiCompartilhar('compartilhadas',{email:p.email,modo:'entrar',agente:aba.agente,sessao:aba.sessao,cwd:aba.cwd,titulo:tituloDe(aba)});convidados.push(p.nome);}
    catch(e){toast('Não chamei '+p.nome+': '+e.message);}
  }
  if(convidados.length){cachePessoas.em=0;aba.compartilhada=true;faixa(aba);estado(aba);toast(convidados.join(' e ')+(convidados.length>1?' foram chamados':' foi chamado')+' pra conversa (pode entrar).');}
  return dentro;
}
// ── Continuar numa cópia minha (desde 15/10/2026): quem foi convidado leva a conversa pra um ramo dele, no ambiente
// e no plano dele. A tela já tem a conversa inteira: monta o contexto daqui (mensagens, respostas, notas e o que o
// agente fez, as mais recentes se passar do tamanho) e cria a conversa nova no próprio servidor de agentes.
const MAX_COPIA=60000;
function contextoDaConversa(aba){
  const linhas=[];let n=0;
  for(const b of aba.blocos){
    if(b.tipo==='user'){let t=(b.texto||'').replace(DURANTE,'').replace(MARCA,'');const pre=t.match(PREFIXO_AUTOR);const quem=b.autor?.nome||pre?.[1]||aba.convite?.donoNome||'Dono';if(pre)t=t.slice(pre[0].length);t=semAnexos(t.replace(COPIA,''));if(t.trim()){linhas.push('['+quem+']: '+t.trim());n++;}}
    else if(b.tipo==='assistant'&&b.texto?.trim())linhas.push('[Agente]: '+b.texto.trim());
    else if(b.tipo==='nota-interna')linhas.push('(nota de '+(b.nota.autor?.nome||'alguém')+', o agente de lá não viu: '+b.nota.texto+')');
    else if(b.tipo==='tool'){const it=b.item||{},ri=it.rawInput||{};const alvo=(Array.isArray(ri.command)?ri.command.join(' '):ri.command)||ri.file_path||ri.path||'';linhas.push('(o agente usou '+nomeFerramenta(it)+(alvo?': '+String(alvo).split('\n')[0].slice(0,160):'')+')');}
  }
  let texto=linhas.join('\n\n');
  if(texto.length>MAX_COPIA)texto='(o começo foi cortado)\n\n'+texto.slice(-MAX_COPIA);
  return {texto,mensagens:n};
}
let dlgCopia=null;
function abrirCopia(aba,botao){
  if(!dlgCopia){dlgCopia=el('dialog','compartilhar-dlg');dlgCopia.addEventListener('click',e=>{if(e.target===dlgCopia)dlgCopia.close();});document.body.append(dlgCopia);}
  const d=dlgCopia,dono=aba.convite?.donoNome||'quem compartilhou';
  const form=el('form','compartilhar-form');
  const topo=el('div','compartilhar-topo');const fechar=el('button','ib');fechar.type='button';fechar.setAttribute('aria-label','Fechar');fechar.append(icone('fechar'));fechar.onclick=()=>d.close();
  topo.append(el('h2',undefined,'Continuar numa cópia tua'),fechar);
  const pedido=el('textarea','copia-pedido');pedido.rows=3;pedido.placeholder='O que tu quer fazer a partir daqui? (opcional)';
  const ok=el('button','primary','Criar cópia');ok.type='submit';
  form.append(topo,el('p','compartilhar-tit',tituloDe(aba)),
    el('p','compartilhar-aviso','Abre uma conversa nova no teu ambiente e no teu plano, com o que foi dito até aqui. A original segue com '+dono+', e nada do que tu fizer na cópia aparece lá.'),
    pedido,ok);
  form.onsubmit=async e=>{e.preventDefault();ok.disabled=true;ok.textContent='Criando…';
    try{await criarCopia(aba,pedido.value.trim());d.close();}
    catch(err){ok.disabled=false;ok.textContent='Criar cópia';toast('Não criei a cópia: '+err.message);}};
  d.replaceChildren(form);if(!d.open)d.showModal();pedido.focus();
  d.addEventListener('close',()=>botao?.focus?.(),{once:true});
}
async function criarCopia(aba,pedido){
  await iniciar();
  const {texto,mensagens}=contextoDaConversa(aba);
  const dono=(aba.convite?.donoNome||'outra pessoa').replace(/"/g,"'"),titulo=tituloDe(aba).replace(/"/g,"'");
  const agente=chat.agentes?.some(a=>a.id===aba.agente)?aba.agente:(agentePreferido()||chat.agentes?.[0]?.id);
  // pasta: a mesma, se for da área do time; a home de outra pessoa não abre aqui
  const cwd=aba.cwd&&!/^\/home\//.test(aba.cwd)?aba.cwd:chat.info.pastaPadrao;
  const msg='<ratoeira-copia de="'+dono+'" titulo="'+titulo+'" mensagens="'+mensagens+'">\nEsta conversa continua uma conversa de '+dono+' ("'+titulo+'"), que roda no ambiente de '+dono+'. Abaixo, o que foi dito lá até agora. Os arquivos citados estão no mesmo repositório.\n\n'+texto+'\n</ratoeira-copia>\n'
    +(pedido||'Lê o contexto acima e me diz em poucas linhas onde a conversa parou. Depois espera o meu próximo pedido.');
  toast('Criando a cópia…');
  const r=await pedir('nova',{agente,cwd,aparelho:TIPO_APARELHO,mcp:await ferramentasRatoeira(),blocos:[{type:'text',text:msg}],texto:msg});
  lembrarConversa(r);
  const nome='Cópia: '+tituloDe(aba).slice(0,80);
  await pedir('renomear',{agente:r.agente,sessao:r.sessao,titulo:nome}).catch(()=>{});
  await abrirConversa(idDe(r.agente,r.sessao),{titulo:nome});
}
// Diálogo Compartilhar: escolhe a pessoa e o modo; lista com quem já está compartilhada, com trocar e tirar.
let dlgCompartilhar=null;
async function abrirCompartilhar(aba,botao){
  if(!dlgCompartilhar){
    dlgCompartilhar=el('dialog','compartilhar-dlg');dlgCompartilhar.setAttribute('aria-labelledby','compartilhar-t');
    dlgCompartilhar.addEventListener('click',e=>{if(e.target===dlgCompartilhar)dlgCompartilhar.close();});
    document.body.append(dlgCompartilhar);
  }
  const d=dlgCompartilhar;d.replaceChildren(el('p','compartilhar-carregando','Carregando…'));
  if(!d.open)d.showModal();
  let dados;try{dados=await apiCompartilhar('compartilhadas');}catch(e){d.replaceChildren(el('p',undefined,'Não abriu: '+e.message));return;}
  const desta=dados.minhas.filter(c=>c.agente===aba.agente&&c.sessao===aba.sessao);
  const form=el('form','compartilhar-form');form.method='dialog';
  const topo=el('div','compartilhar-topo');const h=el('h2',undefined,'Compartilhar conversa');h.id='compartilhar-t';
  const fechar=el('button','ib');fechar.type='button';fechar.setAttribute('aria-label','Fechar');fechar.append(icone('fechar'));fechar.onclick=()=>d.close();
  topo.append(h,fechar);form.append(topo,el('p','compartilhar-tit',tituloDe(aba)));
  const livres=dados.pessoas.filter(p=>!desta.some(c=>c.convidado===p.email));
  if(livres.length){
    const sel=el('select');sel.name='email';sel.setAttribute('aria-label','Com quem');
    for(const p of livres){const o=el('option',undefined,p.nome);o.value=p.email;sel.append(o);}
    const modos=el('div','compartilhar-modos');
    for(const [v,t,w] of [['ler','Só ler','Acompanha a conversa ao vivo, sem mandar mensagem.'],['entrar','Pode entrar na conversa','Manda mensagem pro mesmo agente, assinada com o próprio nome.']]){
      const lab=el('label','compartilhar-modo');const r=el('input');r.type='radio';r.name='modo';r.value=v;r.checked=v==='ler';
      const tx=el('span');tx.append(el('strong',undefined,t),el('span',undefined,w));lab.append(r,tx);modos.append(lab);
    }
    const ok=el('button','primary','Compartilhar');ok.type='submit';
    form.append(el('label','compartilhar-rot','Com quem'),sel,modos,
      el('p','compartilhar-aviso','O agente continua rodando como tu, com o teu acesso e no teu plano. Pedido de permissão do agente, só tu responde.'),ok);
    form.onsubmit=async e=>{e.preventDefault();ok.disabled=true;
      try{await apiCompartilhar('compartilhadas',{email:sel.value,modo:form.elements.modo.value,agente:aba.agente,sessao:aba.sessao,cwd:aba.cwd,titulo:tituloDe(aba)});
        aba.compartilhada=true;faixa(aba);estado(aba);for(const b of aba.blocos)if(b.tipo==='user')b.sujo=true;agendar(aba);
        toast('Compartilhada com '+sel.selectedOptions[0].textContent+'. A pessoa recebe o aviso no sino.');abrirCompartilhar(aba,botao);}
      catch(err){ok.disabled=false;toast('Não compartilhei: '+err.message);}};
  }else form.append(el('p','compartilhar-vazio',dados.pessoas.length?'Já está compartilhada com todo mundo do time.':'Ninguém mais do time tem ambiente nesta Ratoeira.'));
  if(desta.length){
    const lista=el('ul','compartilhar-lista');
    for(const c of desta){
      const li=el('li');li.append(el('span','faixa-av',iniciais(c.convidadoNome)),el('span','compartilhar-quem',c.convidadoNome));
      const modo=el('select');modo.setAttribute('aria-label','O que '+c.convidadoNome+' pode fazer');
      for(const [v,t] of [['ler','Só ler'],['entrar','Pode entrar']]){const o=el('option',undefined,t);o.value=v;o.selected=c.modo===v;modo.append(o);}
      modo.onchange=async()=>{try{await apiCompartilhar('compartilhadas',{email:c.convidado,modo:modo.value,agente:aba.agente,sessao:aba.sessao,cwd:aba.cwd,titulo:tituloDe(aba)});}catch(e){toast('Não troquei: '+e.message);}};
      const tirar=el('button','ib','Tirar');tirar.type='button';
      tirar.onclick=async()=>{try{await apiCompartilhar('compartilhadas/remover',{id:c.id});abrirCompartilhar(aba,botao);}catch(e){toast('Não tirei: '+e.message);}};
      li.append(modo,tirar);lista.append(li);
    }
    form.append(el('h3',undefined,'Com quem já está'),lista);
  }
  d.replaceChildren(form);
  d.addEventListener('close',()=>botao?.focus?.(),{once:true});
}
// Abre a conversa de outra pessoa (do sino e da Início)
window.ratoeiraAbrirCompartilhada=(id,titulo)=>abrirNoPainel('cp:'+id,titulo).catch(e=>toast('Não abriu: '+e.message));

// ── Sino: avisos pra pessoa (por enquanto, conversa compartilhada com ela) ──
const sino={naoLidas:null,timer:null,itens:[]};
// o número do sino também no ícone do app instalado (Android, iPhone com a Ratoeira na tela inicial, Mac e Windows)
function numeroNoIcone(n){try{if('setAppBadge' in navigator)(n?navigator.setAppBadge(n):navigator.clearAppBadge()).catch(()=>{});}catch{}}
async function lerSino(){
  if(!$('sino-abrir'))return;
  let d;try{d=await apiCompartilhar('notificacoes');}catch{$('sino-abrir').hidden=true;return;}
  $('sino-abrir').hidden=false;
  // aviso da conversa que está na frente: já marca como lido, sem bolinha nem toast
  const vistas=d.itens.filter(n=>!n.lida&&naFrente(n));
  if(vistas.length){for(const n of vistas)n.lida=true;apiCompartilhar('notificacoes/lidas',{ids:vistas.map(n=>n.id)}).catch(()=>{});}
  const novas=d.itens.filter(n=>!n.lida);
  // chegou coisa nova desde a última olhada: avisa uma vez
  if(sino.naoLidas!==null&&novas.length>sino.naoLidas){const n=novas[0];toast(fraseSino(n)+'.');}
  sino.naoLidas=novas.length;sino.itens=d.itens;sino.push=d.push||null;numeroNoIcone(novas.length);
  const badge=$('sino-n');badge.hidden=!novas.length;badge.textContent=novas.length>9?'9+':String(novas.length);
  $('sino-abrir').setAttribute('aria-label',novas.length?'Notificações, '+novas.length+' nova'+(novas.length>1?'s':''):'Notificações');
  if(!$('sino-pop').hidden)desenharSino();
  agendarColuna();
  if(document.body.dataset.view==='inicio')desenharCompartilhadas().catch(()=>{});
}
// abriu a conversa (ou a aba dela apareceu na tela): o "o agente terminou" dela vira lido e ela sai de "Não lidas"
function lerTerminou(id){const ids=sino.itens.filter(n=>!n.lida&&n.tipo==='terminou'&&alvoSino(n)===id).map(n=>n.id);if(ids.length)marcarLidas(ids);}
window.addEventListener('ratoeira:pronta',e=>{const id=e.detail?.id||'';if(!e.detail?.pronta&&id.startsWith('c:'))lerTerminou(id.slice(2));agendarColuna();});
// marca como lido no servidor e já na tela (bolinha e lista); sem ids, todas
function marcarLidas(ids=null){
  for(const n of sino.itens)if(!ids||ids.includes(n.id))n.lida=true;
  sino.naoLidas=sino.itens.filter(n=>!n.lida).length;numeroNoIcone(sino.naoLidas);
  const badge=$('sino-n');badge.hidden=!sino.naoLidas;badge.textContent=sino.naoLidas>9?'9+':String(sino.naoLidas);
  $('sino-abrir').setAttribute('aria-label',sino.naoLidas?'Notificações, '+sino.naoLidas+' nova'+(sino.naoLidas>1?'s':''):'Notificações');
  if(!$('sino-pop').hidden)desenharSino();
  apiCompartilhar('notificacoes/lidas',ids?{ids}:{}).catch(()=>{});agendarColuna();
}
// Filtros do sino (desde 28/10/2026): "Tudo" põe no topo o que precisa da pessoa e junta os "o agente terminou"
// numa linha só (eram mais da metade dos avisos); os outros filtros mostram a lista direto. Fica no navegador.
const FILTROS_SINO=[['tudo','Tudo'],['naolidas','Não lidas'],['precisa','Precisa de ti'],['pessoas','Pessoas'],['rotinas','Rotinas']];
const precisaDeTi=n=>n.tipo==='esperando'||n.tipo==='mencao'||n.tipo==='acesso'||(n.tipo==='rotina'&&(n.motivo==='chama'||n.motivo==='falhou'));
const dePessoa=n=>['mensagem','nota','convite','mencao'].includes(n.tipo);
sino.filtro=(()=>{const f=ler('ratoeira:sino-filtro','tudo');return FILTROS_SINO.some(([k])=>k===f)?f:'tudo';})();
function itemSino(n,forte=false){
    const li=el('li',(n.lida?'':'nova')+(forte?' forte':''));const b=el('button','sino-item');b.type='button';
    // aviso do agente leva o ícone dele; o resto, as iniciais de quem fez
    if(['terminou','esperando','rotina','reporte','acesso'].includes(n.tipo)){const av=el('span','faixa-av sino-av-agente');av.append(icone(n.tipo==='terminou'||n.motivo==='terminou'||n.status==='feito'?'feito':'relogio'));b.append(av);}
    else b.append(el('span','faixa-av',iniciais(n.deNome)));
    const tx=el('span','sino-tx');tx.append(el('span','sino-o-que',fraseSino(n)),
      el('span','sino-w',['terminou','esperando'].includes(n.tipo)?quando(n.em):n.tipo==='reporte'?[n.texto?'“'+n.texto+'”':'',n.versao?'sai na '+n.versao:'',quando(n.em)].filter(Boolean).join(' · '):n.tipo==='acesso'?[n.ip?'IP '+n.ip:'',quando(n.em)].filter(Boolean).join(' · '):n.tipo==='rotina'?[n.texto?'“'+n.texto+'”':'',quando(n.em)].filter(Boolean).join(' · '):n.tipo==='convite'?[n.titulo||'Sem título',n.modo==='entrar'?'pode entrar':'só ler',quando(n.em)].filter(Boolean).join(' · '):[n.texto?'“'+n.texto+'”':'',quando(n.em)].filter(Boolean).join(' · ')));
    b.append(tx);b.onclick=()=>{if(!n.lida)marcarLidas([n.id]);abrirSino(false);abrirDoSino(n);};
    li.append(b);
    // marcar como lida sem abrir
    if(!n.lida){const ok=el('button','ib sino-lida');ok.type='button';ok.title='Marcar como lida';ok.setAttribute('aria-label','Marcar como lida');ok.append(icone('feito'));ok.onclick=e=>{e.stopPropagation();marcarLidas([n.id]);};li.append(ok);}
    return li;
}
function desenharSino(){
  const todas=$('sino-todas');if(todas){todas.hidden=!sino.itens.some(n=>!n.lida);todas.onclick=()=>marcarLidas();}
  const lista=$('sino-lista'),filtros=$('sino-filtros');
  if(filtros){filtros.hidden=!sino.itens.length;filtros.replaceChildren(...FILTROS_SINO.map(([k,r])=>{const b=el('button',undefined,r);b.type='button';b.setAttribute('aria-pressed',String(sino.filtro===k));
    b.onclick=e=>{e.stopPropagation();sino.filtro=k;guardar('ratoeira:sino-filtro',k);desenharSino();};return b;}));}
  if(!sino.itens.length){lista.replaceChildren(el('li','vazio','Nada por aqui. Quando alguém compartilhar uma conversa contigo, aparece aqui.'));return;}
  const itens=sino.itens.slice(0,60),f=sino.filtro;
  if(f!=='tudo'&&f!=='naolidas'){
    const sel=itens.filter(f==='precisa'?n=>precisaDeTi(n)&&!n.lida:f==='pessoas'?dePessoa:n=>n.tipo==='rotina');
    lista.replaceChildren(...(sel.length?sel.slice(0,30).map(n=>itemSino(n,f==='precisa')):[el('li','vazio',f==='precisa'?'Nada esperando por ti agora.':'Nada por aqui.')]));return;
  }
  const base=f==='naolidas'?itens.filter(n=>!n.lida):itens;
  if(!base.length){lista.replaceChildren(el('li','vazio','Tudo lido.'));return;}
  const topo=base.filter(n=>precisaDeTi(n)&&!n.lida),terminou=base.filter(n=>n.tipo==='terminou'&&!topo.includes(n)),resto=base.filter(n=>!topo.includes(n)&&!terminou.includes(n));
  const out=[];
  if(topo.length)out.push(el('li','sino-grupo','Precisa de ti'),...topo.map(n=>itemSino(n,true)));
  if(resto.length){if(topo.length)out.push(el('li','sino-grupo','O resto'));out.push(...resto.slice(0,30).map(n=>itemSino(n)));}
  if(terminou.length){
    const li=el('li','sino-dobra'),d=el('details');const sum=el('summary');const av=el('span','faixa-av sino-av-agente');av.append(icone('feito'));
    const nao=terminou.filter(n=>!n.lida).length;
    sum.append(av,el('span','sino-o-que','O agente terminou em '+terminou.length+(terminou.length>1?' conversas':' conversa')),el('span','sino-n',nao?nao+(nao>1?' novas':' nova'):String(terminou.length)));
    const ul=el('ul','sino-lista');ul.append(...terminou.slice(0,30).map(n=>itemSino(n)));d.append(sum,ul);li.append(d);out.push(li);
  }
  lista.replaceChildren(...out);
}
const fraseSino=n=>{const q=n.deNome||'Alguém',em=n.titulo?' em “'+n.titulo+'”':'',vezes=n.vezes>1?' ('+n.vezes+')':'';
  if(n.tipo==='mencao')return q+' te marcou'+em+vezes;
  if(n.tipo==='terminou')return 'O agente terminou'+em;
  if(n.tipo==='esperando')return 'O agente está esperando tua resposta'+em;
  if(n.tipo==='reporte')return (n.status==='feito'?'Teu reporte foi resolvido':'Teu reporte teve resposta')+(n.titulo?': “'+n.titulo+'”':'');
  if(n.tipo==='acesso'){const minha=n.propria,quem=minha?'tua conta':(n.deNome||n.email);
    return (n.motivo==='travou'?(minha?'Erraram a senha da tua conta várias vezes':'Erraram a senha de '+quem+' várias vezes'):(minha?'Entraram na tua conta de um lugar novo':quem+' entrou de um lugar novo'))+vezes;}
  if(n.tipo==='rotina')return 'A rotina “'+(n.rotina||'')+'” '+({chama:'quer falar contigo',terminou:'terminou',falhou:'falhou'}[n.motivo]||'rodou');
  // tipo que esta tela não conhece (veio de um gateway mais novo): frase neutra, não a de convite
  return n.tipo==='nota'?q+' deixou uma nota'+em+vezes:n.tipo==='mensagem'?q+' mandou mensagem'+em+vezes:n.tipo==='convite'?q+' compartilhou uma conversa contigo':'Aviso novo'+(n.titulo?': “'+n.titulo+'”':'')+'. Recarrega a página pra ver';};
const alvoSino=n=>n.compartilhada?'cp:'+n.compartilhada:n.conversa?idDe(n.conversa.agente,n.conversa.sessao):null;
function abrirDoSino(n){
  if(n.compartilhada)return window.ratoeiraAbrirCompartilhada(n.compartilhada,n.titulo);
  if(n.conversa)return abrirNoPainel(idDe(n.conversa.agente,n.conversa.sessao),n.titulo).catch(e=>toast('Não abriu: '+e.message));
  // rotina que falhou antes de abrir conversa: a tela de Automações mostra o erro
  if(n.tipo==='rotina')location.hash='#automacoes';
  // volta de um reporte: abre o Meus reportes do botão Reportar (portal.js)
  if(n.tipo==='reporte')window.ratoeiraMeusReportes?.(n.reporte);
  // acesso fora do comum: quem administra vai pra Pessoas (trocar a senha de quem foi); a dona, pra Tua conta
  if(n.tipo==='acesso')location.hash=n.propria?'#configuracoes/contas':'#configuracoes/pessoas';
}
// a conversa do aviso já está aberta na frente da pessoa: conta como visto
const naFrente=n=>document.visibilityState==='visible'&&(document.body.dataset.view==='arquivos')&&chat.ativa===alvoSino(n)&&!chat.abas.find(a=>a.id===chat.ativa)?.painel.hidden;
function abrirSino(abrir){
  $('sino-pop').hidden=!abrir;$('sino-abrir').setAttribute('aria-expanded',String(abrir));
  if(!abrir)return;
  desenharSino();desenharPush().catch(()=>{});
}
if($('sino-abrir')){
  $('sino-abrir').onclick=e=>{e.stopPropagation();abrirSino($('sino-pop').hidden);};
  document.addEventListener('pointerdown',e=>{if(!$('sino-pop').hidden&&!$('sino-pop').contains(e.target)&&!$('sino-abrir').contains(e.target))abrirSino(false);});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('sino-pop').hidden){abrirSino(false);$('sino-abrir').focus();}});
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')lerSino();});
}
// ── Aviso no aparelho (Web Push, desde 15/10/2026): o mesmo do sino chega com a Ratoeira fechada. Liga em cada
// aparelho pelo pé do sino. O service worker (/sw.js) só mostra o aviso e, no toque, abre a conversa (?abrir=).
const temPush=()=>'serviceWorker' in navigator&&'PushManager' in window&&'Notification' in window;
const chaveBytes=b64=>{const p='='.repeat((4-b64.length%4)%4),r=atob((b64+p).replace(/-/g,'+').replace(/_/g,'/'));return Uint8Array.from(r,c=>c.charCodeAt(0));};
async function assinaturaAtual(){const reg=await navigator.serviceWorker.getRegistration('/');return reg?{reg,sub:await reg.pushManager.getSubscription()}:{reg:null,sub:null};}
const nomeAparelho=()=>(TOQUE?'celular':'computador')+' · '+(/iPhone|iPad/.test(navigator.userAgent)?'iOS':/Android/.test(navigator.userAgent)?'Android':/Mac/.test(navigator.userAgent)?'Mac':/Windows/.test(navigator.userAgent)?'Windows':'navegador');
// o subscribe que falha volta em inglês e não diz o que fazer ("Registration failed - push service error" é o
// navegador sem conseguir falar com o serviço de push dele: Brave com o push desligado, VPN, rede ou bloqueador)
let pushErro=null;
async function explicarPush(e){
  if(!(e?.name==='AbortError'||/push service/i.test(e?.message??'')))return 'Não liguei os avisos: '+e.message;
  if(await navigator.brave?.isBrave?.().catch(()=>false))return 'O Brave vem com esse aviso desligado. Em brave://settings/privacy, liga "Use Google services for push messaging" (usar os serviços do Google pra push), fecha e abre o navegador e tenta de novo.';
  return 'O navegador não conseguiu falar com o serviço de avisos dele (no Chrome, o do Google). Costuma ser VPN, rede da empresa ou bloqueador barrando. Tenta fora dela ou em outro navegador.';
}
async function desenharPush(){
  const pe=$('sino-pe');if(!pe)return;
  if(!sino.push){pe.hidden=true;return;}
  pe.hidden=false;pe.replaceChildren();
  if(!temPush()){pe.append(el('p',undefined,/iPhone|iPad/.test(navigator.userAgent)?'Pra receber aviso no iPhone, põe a Ratoeira na tela inicial (Compartilhar › Adicionar à Tela de Início) e abre por lá.':'Este navegador não recebe aviso fora da Ratoeira.'));return;}
  if(Notification.permission==='denied'){pe.append(el('p',undefined,'Os avisos estão bloqueados neste navegador. Libera nas configurações do site pra receber.'));return;}
  const {sub}=await assinaturaAtual();
  if(sub){
    const sair=el('button','ib','Desligar');sair.type='button';
    sair.onclick=async()=>{try{await apiCompartilhar('notificacoes/push',{sair:true,endpoint:sub.endpoint});await sub.unsubscribe();toast('Avisos desligados neste aparelho.');}catch(e){toast('Não desliguei: '+e.message);}desenharPush();};
    const p=el('p','sino-push-ok');p.append(el('span',undefined,'Avisando neste aparelho'),sair);pe.append(p);return;
  }
  const ligar=el('button','primary','Avisar neste aparelho');ligar.type='button';
  ligar.onclick=async()=>{ligar.disabled=true;
    try{
      if(await Notification.requestPermission()!=='granted')throw new Error('o navegador não deu permissão');
      const reg=await navigator.serviceWorker.register('/sw.js');await navigator.serviceWorker.ready;
      const sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:chaveBytes(sino.push.chave)});
      await apiCompartilhar('notificacoes/push',{assinatura:sub.toJSON(),aparelho:nomeAparelho()});
      pushErro=null;toast('Pronto: os avisos chegam aqui mesmo com a Ratoeira fechada.');
    }catch(e){console.warn('push: '+e?.name+': '+e?.message);pushErro=await explicarPush(e);toast('Não liguei os avisos neste aparelho.');}
    desenharPush();};
  pe.append(ligar,el('p',undefined,'Chega aviso quando alguém te chama, deixa nota ou o agente termina, mesmo com a Ratoeira fechada.'));
  if(pushErro)pe.append(el('p','sino-push-erro',pushErro));
}
// aparelho já ligado: reenvia a assinatura (o navegador pode ter trocado, ou o servidor perdido)
async function renovarPush(){
  if(!sino.push||!temPush()||Notification.permission!=='granted')return;
  const {sub}=await assinaturaAtual();if(sub)apiCompartilhar('notificacoes/push',{assinatura:sub.toJSON(),aparelho:nomeAparelho()}).catch(()=>{});
}
// abrir a conversa de um aviso: cp:<convite> ou <agente>:<sessão>
function abrirAviso(id){
  if(!/^(cp:[A-Za-z0-9_-]{16,40}|[a-z][a-z0-9-]{0,30}:[A-Za-z0-9_.:-]{1,200})$/.test(id||''))return;
  if(id.startsWith('cp:'))window.ratoeiraAbrirCompartilhada(id.slice(3));else abrirNoPainel(id).catch(e=>toast('Não abriu: '+e.message));
}
if('serviceWorker' in navigator)navigator.serviceWorker.addEventListener('message',e=>{if(e.data?.ratoeira==='abrir')try{const q=new URL(e.data.url).searchParams;if(q.get('reportes')==='meus')window.ratoeiraMeusReportes?.();else abrirAviso(q.get('abrir'));}catch{}});
// o service worker fica registrado mesmo sem o aviso ligado: é ele que mostra a tela "sem conexão" (push.mjs)
function registrarSW(){if(sino.push&&'serviceWorker' in navigator)navigator.serviceWorker.register('/sw.js').catch(()=>{});}
function ligarSino(){if(sino.timer||!$('sino-abrir'))return;lerSino().then(()=>{registrarSW();return renovarPush();}).catch(()=>{});sino.timer=setInterval(()=>{if(document.visibilityState==='visible')lerSino();},30000);}
// Início: as conversas que outras pessoas compartilharam comigo
async function desenharCompartilhadas(){
  const box=$('home-compartilhadas');if(!box)return;
  let d;try{d=await apiCompartilhar('compartilhadas');}catch{box.hidden=true;return;}
  box.hidden=!d.comigo.length;
  $('home-compartilhadas-lista').replaceChildren(...d.comigo.slice(0,6).map(c=>linha(c.titulo||'Sem título',[c.donoNome,c.modo==='entrar'?'pode entrar':'só ler',quando(c.em)].join(' · '),{acao:()=>window.ratoeiraAbrirCompartilhada(c.id,c.titulo)})));
}

// ── Liga quando o portal carregar ───────────────────────────────────────────
// Cada painel da grade ganha "nova conversa", "novo terminal" e "conversas recentes" (só com chat ligado).
// No computador, nova conversa e recentes ficam à vista e o terminal vai pro menu ⋯; no celular, que já tem
// nova conversa e abas no topo, vão os três pro menu. No celular, recentes vai sempre (painel de arquivo também), senão só
// achava abrindo uma conversa nova antes.
function botaoPainel(rotulo,svg,fn){const b=el('button','ib');b.type='button';b.setAttribute('aria-label',rotulo);b.title=rotulo;b.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true">'+svg+'</svg>';b.onclick=e=>{e.stopPropagation();fn(b);};return b;}
const abrirRecentes=(b,painel)=>{iniciar().then(()=>mostrarRecentes(true,b,painel)).catch(()=>{});};
// Nova conversa pedida no painel de uma aplicação: a pessoa quer falar dela, então a etiqueta já vem posta (com as
// ferramentas do app). Em qualquer outro lugar a etiqueta segue só sugerida.
async function novaConversaDoPainel(painel){
  const aba=G.abaAtivaDe(painel);
  await novaConversa(painel);
  if(aba?.tipo!=='app'||!novo)return;
  window.ratoeiraApps?.focar(aba.url);novo.comTela=aba.url;desenharEtiqueta(novo);
}
// "Recentes" só aparece em painel que já tem conversa, pra não encher painel de arquivo de ícone.
G.ao('acoes',painel=>!chat.info||G.celular()?[]:[
  botaoPainel('Nova conversa','<path d="M4 5h16v11H9l-5 4z"/><path d="M12 8v5M9.5 10.5h5"/>',()=>novaConversaDoPainel(painel)),
  ...(G.temConversa(painel)?[botaoPainel('Conversas recentes','<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',b=>{b.setAttribute('aria-haspopup','dialog');abrirRecentes(b,painel);})]:[]),
]);
// "Abrir em nova janela/aba": a conversa da aba ativa num espaço novo (uma Mesa à parte, com layout só dela; ver
// grid.js). Janela = popup, pra pôr em outra tela; aba = guia normal do navegador. A da Mesa segue aberta.
const urlDoEspaco=id=>location.pathname+'?espaco='+G.novoEspaco()+'&conversa='+encodeURIComponent(id)+'#arquivos';
G.ao('menu',painel=>!chat.info?[]:[
  ...(G.celular()?[{texto:'Nova conversa',fn:()=>novaConversaDoPainel(painel)}]:[]),
  ...(!G.celular()&&G.abaAtivaDe(painel)?.tipo==='conversa'?[
    {texto:'Abrir em nova janela',fn:()=>window.open(urlDoEspaco(G.abaAtivaDe(painel).id.slice(2)),'_blank','popup,width=1200,height=860,noopener')},
    {texto:'Abrir em nova aba',fn:()=>window.open(urlDoEspaco(G.abaAtivaDe(painel).id.slice(2)),'_blank','noopener')},
  ]:[]),
  {texto:'Novo terminal',fn:()=>novoTerminal(painel)},
  ...(G.celular()?[{texto:'Conversas recentes',fn:b=>abrirRecentes(b,painel)}]:[]),
]);
// Layout salvo com conversas: sem chat, tira as abas delas; com chat, conecta e abre cada uma no painel dela.
function restaurarConversas(){
  if(!window.__ratoeiraPortal)return Promise.resolve();
  const ids=G.ids().filter(x=>x.startsWith('c:')||x.startsWith('t:'));if(!ids.length)return Promise.resolve();
  if(!chat.info){ids.forEach(id=>G.remover(id));return Promise.resolve();}
  return iniciar().catch(()=>{});
}
window.addEventListener('ratoeira:grade',restaurarConversas);
// Botões da aplicação que abriam o chat dela (ex.: "Gerar proposta", "perguntar sobre o cliente"), trocados pela
// ponte do portal.js: com texto pronto, conversa nova com a etiqueta posta (enviada, ou só na caixa com nova sem
// enviar); sem, o texto vai pra caixa da conversa em uso, também com a etiqueta posta (o pedido veio da tela do app).
// Pedido que chega antes do chat carregar (app aberto direto num link) espera: o comPortal entrega depois.
let pedidosApp=[];
window.addEventListener('ratoeira:app-pedido',e=>{if(!chat.pronto){pedidosApp.push(e.detail);return;}pedidoApp(e.detail);});
async function pedidoApp(detalhe){
  const {texto,enviar,nova}=detalhe||{};if(!chat.info)return;
  if(enviar||nova){
    await novaConversa();if(!novo)return;novo.comTela=telaAtual()?.url??null;desenharEtiqueta(novo);novo.area.value=texto;
    if(enviar){if(texto.trim())novo.raiz.requestSubmit();return;}
    // chat.nova(texto,{enviar:false}): conversa nova com o pedido na caixa, pra pessoa editar antes de mandar
    const c=novo;requestAnimationFrame(()=>{c.area.focus();c.area.setSelectionRange(texto.length,texto.length);c.area.dispatchEvent(new Event('input'));});return;
  }
  const aba=chat.abas.find(a=>a.id===chat.ativa);
  const c=aba?aba.comp:(await novaConversa(),novo);if(!c)return;
  if(aba)ativar(aba.id);
  c.comTela=telaAtual()?.url??null;desenharEtiqueta(c);c.area.value=texto;c.area.focus();c.area.setSelectionRange(texto.length,texto.length);
}
function comPortal(data){
  chat.info=data?.chat||null;
  if(chat.info){ligarSino();ligarColuna();}
  // veio do toque num aviso (?abrir=): abre a conversa e tira o parâmetro do endereço
  const abrir=new URLSearchParams(location.search).get('abrir');
  if(abrir&&chat.info){history.replaceState(null,'',location.pathname+location.hash);setTimeout(()=>abrirAviso(abrir),300);}
  // link de conversa (?chat=…&de=…): abre a conversa, se é minha ou está compartilhada comigo
  const doLink=lerLinkConversa(location.href);
  if(doLink&&chat.info){history.replaceState(null,'',location.pathname+location.hash);setTimeout(()=>abrirLinkConversa(doLink),300);}
  // atalho "Conversa nova" do ícone do app (?nova, manifesto em server.mjs): abre a caixa de conversa nova
  const params=new URLSearchParams(location.search),pedeNova=params.has('nova');
  if(pedeNova){params.delete('nova');history.replaceState(null,'',location.pathname+(params.size?'?'+params:'')+location.hash);}
  const FOCO='foco' in document.documentElement.dataset;
  // No modo foco (link "com o chat"), o painel do chat nasce recolhido: só a faixa com o ícone, sem atrapalhar
  // quem só quer ver a aplicação. As abas seguem ligadas (a conversa não para de existir), a pessoa só não vê —
  // quem quiser conversar clica a faixa pra abrir. Não mexe no celular (lá não tem faixa recolhida).
  const recolherChat=()=>{if(!FOCO||G.celular())return;const id=G.ids().find(x=>x.startsWith('c:')||x==='nova');const p=id&&G.painelDe(id);if(p)G.recolherPainel(p);};
  restaurarConversas().then(recolherChat).finally(()=>{chat.pronto=true;const fila=pedidosApp;pedidosApp=[];for(const p of fila)pedidoApp(p);});G.desenhar();
  // modo foco sem conversa no layout: já abre a caixa de conversa nova do lado da aplicação
  // ?texto= (o app.js aberto fora da Ratoeira manda o pedido do botão): só preenche a caixa, nunca envia sozinho,
  // porque um link qualquer poderia mandar o agente fazer coisas em nome da pessoa
  const pedido=new URLSearchParams(location.search).get('texto');
  if(chat.info&&FOCO&&(pedido||!G.ids().some(id=>id.startsWith('c:'))))
    novaConversa().then(()=>{
      if(pedido&&novo){novo.area.value=pedido.slice(0,2000);novo.area.dispatchEvent(new Event('input'));novo.area.focus();}
      else recolherChat();
    });
  if(document.body.dataset.view==='inicio')mostrarInicio();
  if(pedeNova&&chat.info){novaConversa().then(()=>{if(G.celular())$('files').dataset.mobile='arquivo';});return;}
  // Celular: a Mesa abre no que estava aberto; sem nada aberto, numa conversa nova (não na árvore).
  if(matchMedia('(max-width:760px)').matches&&$('files')?.dataset.mobile==='arvore'&&!location.hash.startsWith('#arquivos/')){
    if(G.ids().length)$('files').dataset.mobile='arquivo';
    else if(chat.info)novaConversa().then(()=>{if($('files').dataset.mobile==='arvore')$('files').dataset.mobile='arquivo';});
  }
}
if(window.__ratoeiraPortal)comPortal(window.__ratoeiraPortal);else window.addEventListener('ratoeira:portal',e=>comPortal(e.detail),{once:true});
