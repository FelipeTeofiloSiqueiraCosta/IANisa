import http from 'node:http';
import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { createHmac, createHash, randomBytes } from 'node:crypto';
import { createAcesso } from './usuarios.mjs';
import { tratarEntrada, lerCookie, COOKIE } from './entrada.mjs';
import { enviarEmail } from './email.mjs';
import { DESCRICAO as DESCRICAO_CORE, PUBLICAVEIS } from './core.mjs';
import { createCompartilhar, lerLinkConversa } from './compartilhar.mjs';
import { createPush, SERVICE_WORKER } from './push.mjs';
import { existsSync } from 'node:fs';

const publicDir = new URL('./public/', import.meta.url);
const brandingCss = readFileSync(new URL('branding.css', publicDir), 'utf8');
const defaultsScript = readFileSync(new URL('defaults.js', publicDir), 'utf8');
const assets = new Map([
  ['/favicon.ico', ['favicon.png','image/png']],
  ['/apple-touch-icon.png', ['icon.png','image/png']],
  ['/_ratoeira/icon.png', ['icon.png','image/png']],
  ['/_ratoeira/favicon.png', ['favicon.png','image/png']],
  ['/_ratoeira/branding.js', ['branding.js','application/javascript; charset=utf-8']],
]);
const faviconPattern = /^\/assets\/assets\/images\/favicon-(light|dark)(-(running|attention))?\.[a-f0-9]{32}\.png$/;
// shortcuts: segurar o ícone do app instalado (Android, Chrome/Edge no computador) mostra estes atalhos
const icone=[{src:'/_ratoeira/icon.png',sizes:'512x512',type:'image/png'}];
const manifest = JSON.stringify({id:'/',name:'Ratoeira',short_name:'Ratoeira',start_url:'/',scope:'/',display:'standalone',background_color:'#ecebe6',theme_color:'#ecebe6',icons:[{...icone[0],purpose:'any'}],
  shortcuts:[{name:'Conversa nova',short_name:'Conversa',url:'/portal/?nova#arquivos',icons:icone},{name:'Mesa',url:'/portal/#arquivos',icons:icone},{name:'Início',url:'/portal/#inicio',icons:icone}]});

function reply(res, status, body, type='text/plain; charset=utf-8', head=false) {
  res.writeHead(status, {'content-type':type,'cache-control':'no-store','x-content-type-options':'nosniff'});
  res.end(head ? undefined : body);
}
function rejectSocket(socket, status) {
  socket.end(`HTTP/1.1 ${status} ${status===401?'Unauthorized':'Forbidden'}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
}
// Aplicações com servidor próprio na mesma máquina (ex.: um sistema em /pedidos, na porta 8790).
// O gateway repassa só o caminho de cada uma, como está, sem marca e sem a senha do Paseo; a aplicação
// tem o login dela. `public` lista subcaminhos que abrem sem login (ex.: o link que vai pro cliente);
// no modo cloudflare, o Access precisa liberar os mesmos caminhos. `restrictTo` prende um email a algumas
// dessas aplicações: ele não chega no portal, nos agentes, nos arquivos nem nas conexões.
// uid de um usuário Linux, lido do /etc/passwd (guardado por 1 min). null se não existir.
const uids=new Map();
export function uidDoSistema(usuario, ler=()=>readFileSync('/etc/passwd','utf8')) {
  const c=uids.get(usuario);if(c&&Date.now()-c.em<60000)return c.uid;
  let uid=null;
  try{for(const linha of ler().split('\n')){const [nome,,id]=linha.split(':');if(nome===usuario&&/^\d+$/.test(id)){uid=Number(id);break;}}}catch{}
  uids.set(usuario,{uid,em:Date.now()});return uid;
}
export function normalizeApps(list, restrictTo) {
  if (list==null && restrictTo==null) return {apps:[], limits:new Map()};
  if (list!=null && !Array.isArray(list)) throw new Error('Invalid gateway configuration');
  const apps=(list??[]).map(a=>{
    const prefix=a?.prefix;
    if (typeof prefix!=='string' || !/^\/[a-z0-9][a-z0-9-]{0,40}$/.test(prefix) || ['/portal','/assets','/api','/ws'].includes(prefix)
      || !Number.isInteger(a.port) || a.port<1 || a.port>65535) throw new Error('Invalid gateway configuration');
    const open=(a.public??[]).map(p=>{
      if (typeof p!=='string' || !/^\/[a-z0-9][a-z0-9_-]*\/$/.test(p)) throw new Error('Invalid gateway configuration');
      return prefix+p;
    });
    // segredo: arquivo com o segredo do app (contrato em docs/2026-10-07-contrato-identidade-apps.md).
    // Com ele, o gateway assina quem é a pessoa e o papel dela em cada pedido pro app.
    let segredo=null;
    if (a.segredo!=null) {
      if (typeof a.segredo!=='string' || !a.segredo.startsWith('/')) throw new Error('Invalid gateway configuration');
      segredo=readFileSync(a.segredo,'utf8').trim();
      if (segredo.length<32) throw new Error('Invalid gateway configuration');
    }
    // chat.mcp: caminho do MCP do app (relativo ao prefixo). Com ele, o agente chama o app pelo gateway
    // (/_ratoeira/mcp/<app>), que confere o token da conversa e assina quem é a pessoa (APPS.md, "Chat").
    const mcp=typeof a.chat?.mcp==='string' && /^\/?[a-z0-9][a-z0-9/_-]{0,80}$/.test(a.chat.mcp) && !a.chat.mcp.includes('//') ? a.chat.mcp.replace(/^\//,'') : null;
    // chat.pastaAgente: pasta da cópia publicada com o AGENTS.md do app (o publicar-app grava, a partir do "agente")
    const pa=a.chat?.pastaAgente;
    const pastaAgente=typeof pa==='string'&&/^\/[\w./-]{1,300}$/.test(pa)&&!pa.split('/').includes('..')?pa:null;
    return {prefix, port:a.port, open, segredo, mcp, pastaAgente};
  });
  const limits=new Map();
  for (const [email, prefixes] of Object.entries(restrictTo??{})) {
    if (!Array.isArray(prefixes) || !prefixes.length || prefixes.some(p=>!apps.some(a=>a.prefix===p))) throw new Error('Invalid gateway configuration');
    limits.set(email.toLowerCase(), prefixes);
  }
  return {apps, limits};
}

function brandedHtml(html, defaults) {
  const preset=defaults?.agent
    ? `<script type="application/json" id="ratoeira-defaults">${JSON.stringify(defaults.agent).replaceAll('<','\\u003c')}</script><script>${defaultsScript}</script>`
    : '';
  return html.replace('<title>Paseo</title>','<title>Ratoeira</title>')
    .replace('name="apple-mobile-web-app-title" content="Paseo"','name="apple-mobile-web-app-title" content="Ratoeira"')
    // Critical CSS arrives before React paints either logo, avoiding a Paseo flash.
    .replace('</head>',`<link rel="preload" as="image" href="/_ratoeira/icon.png"><style id="ratoeira-branding">${brandingCss}</style>${preset}<script src="/_ratoeira/branding.js" defer></script></head>`);
}

// Dois jeitos de saber quem entra:
// - cloudflare (padrão): Cloudflare Access na frente, o gateway valida o JWT (instalação com domínio próprio).
// - local: sem nada público. A pessoa chega por túnel SSH (ssh -L) ou pelo encaminhamento de porta
//   do VS Code, sempre em http://localhost:<porta>. Quem tem a chave SSH da VPS é o dono. O gateway
//   só confere o Host, pra um site aberto no navegador não conseguir falar com ele (DNS rebinding).
// - cloudflare + alsoLocal: o domínio passa pelo Access, e o túnel SSH continua entrando por
//   localhost. É o caminho de volta se a Cloudflare der problema. O Cloudflare Tunnel sempre
//   entrega o Host público, então quem vem da internet nunca cai na regra de localhost.
// - senha: login próprio (contas.mjs + entrada.mjs), cookie de sessão. Pessoas, ambiente, apps e
//   papéis saem das contas, não da config (users, paseoCompartilhado e restrictTo não valem aqui).
//   Com alsoLocal, também atende por http://localhost:<porta> (túnel SSH), sempre com login.
export function createGateway({hostname, upstreamPort=6767, password, verify, defaults, portal, access, apps:appList, restrictTo, users:userList, paseoSocket, paseoCompartilhado, contas, ipHeader, agentes, uidDe=uidDoSistema, publicador=null, core=null, nucleoQuem=null, atualizacoes=null, ligacoesArquivo=null, playground=null, compartilhadasArquivo=null, pushArquivo=null, enviarPush=null, avisosCadaMs=4000, retornosCadaMs=300000, instalacaoCadaMs=60000}) {
  const senha = access?.mode==='senha';
  if (senha && (!contas || userList!=null || paseoCompartilhado!=null || restrictTo!=null)) throw new Error('Invalid gateway configuration');
  const {apps, limits}=normalizeApps(appList, restrictTo);
  const acesso=senha ? contas : createAcesso({users:userList, paseoSocket, paseoCompartilhado});
  // As regras de quem vai pra onde, numa forma só pros três modos.
  const pessoaDe=email=>acesso.ambiente(email)?.pessoa;
  const limiteDe=email=>senha ? contas.limite(email) : (limits.get(email) ?? null);
  const podeApp=(email,prefix)=>senha ? contas.podeApp(email,prefix) : (!limits.get(email) || limits.get(email).includes(prefix));
  const appFor=pathname=>apps.find(a=>pathname===a.prefix||pathname.startsWith(a.prefix+'/'));
  const local = access?.mode==='local';
  const alsoLocal = !local && access?.alsoLocal===true;
  if ((local || alsoLocal) && !Number.isInteger(access.port)) throw new Error('Invalid gateway configuration');
  if (local) hostname = `localhost:${access.port}`;
  const precisaSenha = senha ? password!=null : acesso.usaPaseoUnico;
  if (!hostname || !Number.isInteger(upstreamPort) || (precisaSenha && !/^[A-Za-z0-9_-]+$/.test(password ?? '')) || (!local && !senha && typeof verify!=='function')) {
    throw new Error('Invalid gateway configuration');
  }
  // Qualquer porta: o túnel do aluno pode usar outra no computador dele (LocalForward 7000 ...).
  // A trava contra DNS rebinding é o NOME: um site de fora nunca chega com Host localhost.
  const isLocalReq = req => (local || alsoLocal) && /^(localhost|127\.0\.0\.1):\d{1,5}$/.test(req.headers.host ?? '');
  const publicOrigin = local ? null : `https://${hostname}`;
  const hostDaRatoeira = req => {const h=String(req.headers.host??'').toLowerCase().replace(/:\d+$/,'');return h===String(hostname).toLowerCase().replace(/:\d+$/,'')||['localhost','127.0.0.1','[::1]'].includes(h);};
  const owner = String(access?.owner ?? 'dono').toLowerCase();
  async function identify(req) {
    if (senha) {
      const s=contas.sessao(lerCookie(req));
      if (!s) throw new Error('No session');
      return s;
    }
    if (isLocalReq(req)) return {email: owner.includes('@') ? owner : `${owner}@localhost`, exp: Math.floor(Date.now()/1000)+30*86400};
    if (local) throw new Error('Wrong host');
    return verify(req.headers['cf-access-jwt-assertion']);
  }
  if (defaults?.landingPath && (!defaults.landingPath.startsWith('/new?') || /[\r\n\\]/.test(defaults.landingPath))) {
    throw new Error('Default landing path must be a local new-workspace route');
  }
  const sockets = new Set();
  // WebSockets abertos por pessoa: desativar alguém (contas.mjs) fecha todos na hora.
  const conexoes = new Map();
  // IP de quem tenta entrar, pra trava de tentativas: o cabeçalho do proxy da frente
  // (cf-connecting-ip no Tunnel, x-forwarded-for no Caddy) ou o endereço da conexão.
  // Sem ipHeader e com a conexão vindo da própria máquina (Tunnel, Caddy, túnel SSH), todo mundo
  // teria o mesmo IP e 30 erros de qualquer um travariam todos: aí a trava vale só por e-mail (null).
  const ipDe = req => {
    if (ipHeader && req.headers[ipHeader]) return String(req.headers[ipHeader]).split(',')[0].trim();
    const remoto = String(req.socket.remoteAddress ?? '');
    return /^(127\.|::1$|::ffff:127\.)/.test(remoto) ? null : remoto;
  };
  // O que não é do portal, de aplicação nem do chat vai pro Paseo único (kit 0.1.0), pela porta. Quem tem
  // ambiente próprio não tem mais Paseo (saiu em 09/10/2026): chat, terminal e Contas de IA vão pelo servidor
  // de agentes dela (/api/agentes/ws); endereço do Paseo vira 404.
  function paseoFor(identity) {
    const amb=acesso.ambiente(identity.email);
    return amb?.unico && !amb.pessoa ? {host:'127.0.0.1', port:upstreamPort} : null;
  }
  const noPaseo='Seu e-mail ainda não tem um ambiente nesta Ratoeira. Fale com quem administra.';
  const semPagina='Essa página não existe nesta Ratoeira.';
  function allowedOrigin(req, websocket=false) {
    // pedido pelo túnel só aceita a origem do próprio endereço local; pelo domínio, só a do domínio
    const expected = isLocalReq(req) ? `http://${req.headers.host}` : publicOrigin;
    if (req.headers.origin && req.headers.origin!==expected) return false;
    return !websocket && ['GET','HEAD','OPTIONS'].includes(req.method) || req.headers.origin===expected;
  }
  function upstreamHeaders(req, websocket=false) {
    const headers = {...req.headers};
    // Do not pass edge identity tokens or browser-supplied auth into the daemon.
    for (const name of Object.keys(headers)) {
      if (name.startsWith('cf-access-') || name.startsWith('x-forwarded-') || ['authorization','proxy-authorization','forwarded'].includes(name)) delete headers[name];
    }
    const cookies = (headers.cookie ?? '').split(';').map(x=>x.trim()).filter(x=>x&&!x.startsWith('CF_Authorization=')&&!x.startsWith(COOKIE+'='));
    if(cookies.length) headers.cookie=cookies.join('; '); else delete headers.cookie;
    // Bootstrap needs host:port, but Paseo compares public WS Origin and Host literally.
    // No modo local o navegador já fala host:porta, e é isso que o Paseo precisa ver nos dois casos.
    const viaTunel = isLocalReq(req);
    headers.host=viaTunel ? req.headers.host : websocket ? hostname : `${hostname}:443`;
    headers['x-forwarded-proto']=viaTunel ? 'http' : 'https';
    headers['x-forwarded-host']=headers.host;
    // HTML is branded by this gateway. The upstream must send its uncompressed form.
    delete headers['accept-encoding'];
    if(!websocket) {delete headers.connection; delete headers.upgrade;}
    headers.authorization=`Bearer ${password}`;
    if(websocket) headers['sec-websocket-protocol']=`paseo.bearer.${password}`;
    return headers;
  }
  // Cabeçalho de identidade pro app: payload.assinatura, HMAC-SHA256 com o segredo do app,
  // vale 60 s e só pra esse app. Sem papel nesse app, não vai (o app recusa: "abra pela Ratoeira").
  const b64u=v=>Buffer.from(v).toString('base64url');
  // usuario/uid: o usuário Linux da pessoa, quando ela tem ambiente. O app usa pra trocar arquivo com o
  // agente dela (ex.: a pasta de trabalho do chat do app), conferindo o dono pelo uid.
  // extra: o que vai junto e assinado nas chamadas do chat (via, conversa, hash da mensagem que a pessoa digitou)
  function identidadeApp(app, identity, extra={}) {
    if (!app.segredo || !identity) return null;
    const papel=senha ? contas.papelNoApp(identity.email, app.prefix) : null;
    if (!papel) return null;
    const nome=(senha && contas.nome?.(identity.email)) || identity.email.split('@')[0];
    const usuario=pessoaDe(identity.email)?.user;
    const uid=usuario!=null ? uidDe(usuario) : null;
    const payload=b64u(JSON.stringify({email:identity.email, nome, app:app.prefix, papel, ...(uid!=null?{usuario,uid}:{}), ...extra, exp:Math.floor(Date.now()/1000)+60}));
    return payload+'.'+createHmac('sha256', app.segredo).update(payload).digest('base64url');
  }
  function appHeaders(req, app, identity) {
    const headers={...req.headers};
    // o navegador nunca escolhe a identidade: qualquer x-ratoeira-* que venha dele sai
    for (const name of Object.keys(headers)) if (name.startsWith('x-ratoeira-')) delete headers[name];
    const ident=identidadeApp(app, identity);
    if (ident) headers['x-ratoeira-identidade']=ident;
    const client=String(req.headers['cf-connecting-ip']??req.socket.remoteAddress??'').split(',')[0].trim();
    for (const name of Object.keys(headers)) {
      if (name.startsWith('cf-') || name.startsWith('x-forwarded-') || ['authorization','proxy-authorization','forwarded','x-real-ip','connection','upgrade'].includes(name)) delete headers[name];
    }
    // a sessão da Ratoeira nunca chega no app: com ela, o app entraria como a pessoa
    const cookies=(headers.cookie ?? '').split(';').map(x=>x.trim()).filter(x=>x&&!x.startsWith('CF_Authorization=')&&!x.startsWith(COOKIE+'='));
    if (cookies.length) headers.cookie=cookies.join('; '); else delete headers.cookie;
    const viaTunel=isLocalReq(req);
    headers.host=viaTunel ? req.headers.host : hostname;
    headers['x-forwarded-host']=headers.host;
    headers['x-forwarded-proto']=viaTunel ? 'http' : 'https';
    headers['x-forwarded-for']=client || '0.0.0.0';
    return headers;
  }
  function proxyApp(req, res, app, identity) {
    const upstream=http.request({host:'127.0.0.1',port:app.port,path:req.url,method:req.method,headers:appHeaders(req, app, identity)},response=>{
      const headers={...response.headers}; delete headers.connection;
      // Sem regra de cache do app, o navegador guarda a página por conta própria e mostra de novo
      // sem perguntar: quem foi desativado continuaria vendo. Assim ele sempre pergunta ao gateway.
      if(!headers['cache-control']) headers['cache-control']='private, no-cache';
      res.writeHead(response.statusCode,headers); response.pipe(res);
      response.on('error',()=>res.destroy());
    });
    upstream.on('error',()=>{if(!res.headersSent)reply(res,502,'A aplicação está reiniciando. Tente de novo em alguns segundos.');else res.destroy();});
    req.on('aborted',()=>upstream.destroy());
    req.pipe(upstream);
  }
  // ── Chat ligado a um app (APPS.md, "Chat e ferramentas") ──
  // O chat pede pra ligar uma conversa a um app (/_ratoeira/api/chat/ligar): o gateway emite um token só pra
  // aquela pessoa e aquele app, que o agente dela usa no MCP do app por /_ratoeira/mcp/<app>. Antes de cada
  // mensagem ir pro agente, o chat avisa o que a pessoa digitou (/_ratoeira/api/chat/mensagem). O gateway repassa
  // cada chamada pro app com a identidade assinada, e a mensagem vai junto, amarrada na assinatura pelo hash: é
  // ela que vale de aprovação no app (ex.: "pode mandar o e-mail"). O app não emite token nem guarda sessão.
  // Com ligacoesArquivo, as ligações (só o hash do token) vão pro disco: reiniciar o gateway (publicar) não derruba
  // as ferramentas de quem está conversando. Sem ele, ficam em memória e o chat liga de novo quando a mensagem dá 404.
  const ligacoes=new Map();              // sha256(token) → {email, prefix, conversa, mensagem, mensagemEm, expira}
  const VALIDADE_LIGACAO=12*3600e3;
  const VALIDADE_RATOEIRA=7*24*3600e3;   // o MCP da própria Ratoeira (admin): uma por conversa nova, dura mais
  if(ligacoesArquivo){try{for(const [k,v] of Object.entries(JSON.parse(readFileSync(ligacoesArquivo,'utf8'))))if(v?.expira>Date.now())ligacoes.set(k,v);}catch{}}
  // grava na hora (arquivo pequeno, muda a cada mensagem): reiniciar logo depois não perde a ligação nova
  const salvarLigacoes=()=>{if(!ligacoesArquivo)return;
    try{writeFileSync(ligacoesArquivo+'.tmp',JSON.stringify(Object.fromEntries(ligacoes)),{mode:0o600});renameSync(ligacoesArquivo+'.tmp',ligacoesArquivo);}catch(e){console.log('ligações do chat: não gravei ('+e.message+')');}};
  const sha=v=>createHash('sha256').update(String(v)).digest('hex');
  const lerJson=req=>new Promise((ok,no)=>{let d='';req.setEncoding('utf8');req.on('data',c=>{d+=c;if(d.length>32768){no(new Error('grande'));req.destroy();}});req.on('end',()=>{try{ok(JSON.parse(d||'{}'));}catch(e){no(e);}});req.on('error',no);});
  const json=(res,status,obj)=>{res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(JSON.stringify(obj));};
  async function chatApi(req,res,pathname,identity){
    if(req.method!=='POST') return json(res,405,{error:'Use POST.'});
    let b;try{b=await lerJson(req);}catch{return json(res,400,{error:'Pedido inválido.'});}
    const agora=Date.now();for(const [k,v] of ligacoes)if(v.expira<agora)ligacoes.delete(k);
    if(pathname.endsWith('/ligar')&&b.app==='ratoeira'){
      // o MCP da própria Ratoeira: ler outra conversa (ler_conversa) pra todo mundo que tem conversa compartilhada
      // (desde 16/10/2026); publicar apps, a própria Ratoeira e atualizar, só pra quem administra, com isso ligado
      const publica=Boolean((publicador||core||atualizacoes)&&senha&&contas.ehAdmin?.(identity.email));
      if(!publica&&!compartilhar) return (publicador||core||atualizacoes)?json(res,403,{error:'Só quem administra a Ratoeira publica apps.'}):json(res,404,{error:'Esta Ratoeira não tem ferramentas pro chat.'});
      if(!Number.isInteger(access?.port)) return json(res,500,{error:'Falta a porta do gateway na configuração.'});
      const token=randomBytes(32).toString('base64url');
      ligacoes.set(sha(token),{email:identity.email,prefix:'/_ratoeira',conversa:null,mensagem:'',mensagemEm:0,expira:agora+VALIDADE_RATOEIRA});salvarLigacoes();
      return json(res,200,{mcp:[{type:'http',name:'ratoeira',url:`http://127.0.0.1:${access.port}/_ratoeira/mcp/_ratoeira`,headers:[{name:'Authorization',value:'Bearer '+token}]}]});
    }
    if(pathname.endsWith('/ligar')){
      const app=apps.find(a=>a.prefix+'/'===b.app||a.prefix===b.app);
      if(!app?.mcp||!app.segredo) return json(res,404,{error:'Essa aplicação não conversa pelo chat da Ratoeira.'});
      if(!podeApp(identity.email,app.prefix)||!identidadeApp(app,identity)) return json(res,403,{error:'Essa aplicação não está liberada pra você.'});
      if(!Number.isInteger(access?.port)) return json(res,500,{error:'Falta a porta do gateway na configuração.'});
      const token=randomBytes(32).toString('base64url'),chave=sha(token);
      ligacoes.set(chave,{email:identity.email,prefix:app.prefix,conversa:null,mensagem:'',mensagemEm:0,expira:agora+VALIDADE_LIGACAO});salvarLigacoes();
      return json(res,200,{chave,...(app.pastaAgente?{pasta:app.pastaAgente}:{}),mcp:[{type:'http',name:app.prefix.slice(1),url:`http://127.0.0.1:${access.port}/_ratoeira/mcp${app.prefix}`,headers:[{name:'Authorization',value:'Bearer '+token}]}]});
    }
    const rec=typeof b.chave==='string'&&ligacoes.get(b.chave);
    if(!rec||rec.email!==identity.email) return json(res,404,{error:'A sessão do chat venceu. Mande de novo.'});
    if(typeof b.conversa!=='string'||!/^[A-Za-z0-9_.:-]{1,200}$/.test(b.conversa)) return json(res,400,{error:'Conversa inválida.'});
    if(rec.conversa&&rec.conversa!==b.conversa) return json(res,400,{error:'Essa sessão é de outra conversa.'});
    Object.assign(rec,{conversa:b.conversa,mensagem:String(b.mensagem??'').slice(0,2000),mensagemEm:Math.floor(agora/1000),expira:agora+VALIDADE_LIGACAO});salvarLigacoes();
    return json(res,200,{ok:true});
  }
  // ── Conversa compartilhada (compartilhar.mjs) e o sino de notificações ──
  // Só no login próprio e com o chat por agentes: é o nome de cada pessoa e o servidor de agentes do dono.
  // Aviso no aparelho (push.mjs): todo aviso novo (ou atualizado) do sino vai também pros aparelhos da pessoa.
  const push=senha&&agentes&&pushArquivo?createPush({arquivo:pushArquivo,assunto:'mailto:ratoeira@'+(hostname||'localhost'),...(enviarPush?{enviar:enviarPush}:{})}):null;
  const idAviso=n=>n.compartilhada?'cp:'+n.compartilhada:n.conversa?n.conversa.agente+':'+n.conversa.sessao:null;
  function textoAviso(n){
    const q=n.deNome||nomeDe(n.de||'');
    if(n.tipo==='convite') return {titulo:q+' compartilhou uma conversa contigo',corpo:(n.titulo||'')+(n.modo==='entrar'?' · pode entrar':' · só ler')};
    if(n.tipo==='nota') return {titulo:q+' deixou uma nota'+(n.titulo?' em “'+n.titulo+'”':''),corpo:n.texto||''};
    if(n.tipo==='mencao') return {titulo:q+' te marcou'+(n.titulo?' em “'+n.titulo+'”':''),corpo:n.texto||''};
    if(n.tipo==='mensagem') return {titulo:q+' mandou mensagem'+(n.titulo?' em “'+n.titulo+'”':''),corpo:n.texto||''};
    // o nome da conversa em negrito e o que houve embaixo, como numa mensagem
    if(n.tipo==='terminou') return n.titulo?{titulo:n.titulo,corpo:'O agente terminou.'}:{titulo:'O agente terminou numa conversa',corpo:''};
    if(n.tipo==='esperando') return n.titulo?{titulo:n.titulo,corpo:'O agente está esperando tua resposta.'}:{titulo:'O agente está esperando tua resposta',corpo:''};
    if(n.tipo==='reporte') return {titulo:n.status==='feito'?'Teu reporte foi resolvido':'Teu reporte teve resposta',corpo:['“'+(n.titulo||'Reporte')+'”',n.texto,n.versao?'Sai na versão '+n.versao+'.':null].filter(Boolean).join(' · ')};
    if(n.tipo==='acesso') return textoAcesso(n);
    if(n.tipo==='rotina') return {titulo:{chama:'A rotina “'+n.rotina+'” quer falar contigo',terminou:'A rotina “'+n.rotina+'” terminou',falhou:'A rotina “'+n.rotina+'” falhou'}[n.motivo]||'Rotina',corpo:n.texto||''};
    return {titulo:'Ratoeira',corpo:''};
  }
  // aviso de acesso: a dona da conta lê "tua conta", quem administra lê o nome de quem foi
  function textoAcesso(n){
    const minha=n.propria,quem=minha?'tua conta':(n.deNome||n.email);
    if(n.motivo==='travou') return {titulo:minha?'Erraram a senha da tua conta várias vezes':'Erraram a senha de '+quem+' várias vezes',corpo:'A entrada ficou travada por 15 minutos'+(n.ip?' pra '+n.ip:'')+'. Se não foi '+(minha?'tu':'essa pessoa')+', vale trocar a senha.'};
    return {titulo:minha?'Entraram na tua conta de um lugar novo':quem+' entrou de um lugar novo',corpo:(n.ip?'IP '+n.ip+'. ':'')+'Se não foi '+(minha?'tu, troca a senha e avisa quem administra.':'essa pessoa, troca a senha dela em Pessoas.')};
  }
  function empurrar(n){
    if(!push) return;
    const id=idAviso(n),t=textoAviso(n);
    // rotina que falhou antes de abrir conversa: o toque leva pra tela de Automações
    // naoLidas: o número no ícone do app instalado (o service worker põe ao receber)
    push.avisar(n.para,{...t,naoLidas:compartilhar?.notificacoes(n.para).naoLidas,tag:n.tipo+'|'+(id??n.id),url:'/portal/'+(id?'?abrir='+encodeURIComponent(id)+'#arquivos':n.tipo==='rotina'?'#automacoes':n.tipo==='reporte'?'?reportes=meus#inicio':n.tipo==='acesso'?(n.propria?'#configuracoes/contas':'#configuracoes/pessoas'):'#arquivos')}).catch(()=>{});
  }
  const compartilhar=senha&&agentes?createCompartilhar({arquivo:compartilhadasArquivo,aoNotificar:empurrar}):null;
  // Acesso fora do comum (contas.mjs): IP novo vai pra dona da conta e pra quem administra; conta travada também.
  if(compartilhar&&contas?.aoAcesso) contas.aoAcesso(ev=>{
    const motivo=ev.evento==='travou'?'travou':ev.evento==='entrou'&&ev.ipNovo?'ip-novo':null;
    if(!motivo) return;
    const admins=contas.admins?.()??[];
    for(const para of new Set([ev.email,...admins])) compartilhar.avisoDeAcesso({para,motivo,email:ev.email,nome:contas.nome(ev.email),ip:ev.ip});
  });
  // Avisos dos servidores de agentes (o agente terminou ou está esperando alguém): o gateway pergunta a cada poucos
  // segundos aos que estão ligados e avisa quem é da conversa e não estava com ela aberta. "Esperando" vai só pro dono
  // (só ele aprova). Servidor que religou (inicio novo) recomeça a conta sem repetir o que já tinha.
  const lidosAvisos=new Map();           // usuário Linux → {inicio, seq}
  async function lerAvisos(){
    if(!compartilhar) return;
    for(const [email,pessoa] of contas.usuarios?.()??[]){
      const sock=agentes.socket.replaceAll('{user}',pessoa.user);if(!existsSync(sock)) continue;
      const antes=lidosAvisos.get(pessoa.user);
      const pegar=desde=>new Promise(ok=>{const q=http.get({socketPath:sock,path:'/avisos?desde='+desde,timeout:2000},res=>{let d='';res.on('data',x=>d+=x);res.on('end',()=>{try{ok(JSON.parse(d));}catch{ok(null);}});});q.on('error',()=>ok(null));q.on('timeout',()=>{q.destroy();ok(null);});});
      let r=await pegar(antes?.seq??0);
      if(!r?.inicio) continue;
      // o servidor religou: a conta dele recomeçou do zero, então tudo o que ele tem é novo
      if(antes&&antes.inicio!==r.inicio&&!(r=await pegar(0))?.inicio) continue;
      lidosAvisos.set(pessoa.user,{inicio:r.inicio,seq:r.seq});
      // primeira leitura depois que o gateway subiu: só marca onde está (o que já tinha não é novidade)
      if(!antes) continue;
      for(const a of r.avisos??[]){
        // "esperando" e rotina vão só pro dono (quem aprova; quem criou a rotina)
        const quem=['esperando','rotina'].includes(a.tipo)?[email]:(a.compartilhada?compartilhar.participantes(email,a.agente,a.sessao):[email]);
        for(const para of new Set(quem)) if(!(a.vendo??[]).includes(para)) compartilhar.avisoDoAgente({para,dono:email,agente:a.agente,sessao:a.sessao,tipo:a.tipo,titulo:a.titulo,motivo:a.motivo,rotina:a.rotina,texto:a.texto});
      }
    }
  }
  let lendoAvisos=false;
  const timerAvisos=compartilhar&&avisosCadaMs?setInterval(()=>{if(lendoAvisos)return;lendoAvisos=true;lerAvisos().catch(()=>{}).finally(()=>{lendoAvisos=false;});},avisosCadaMs):null;
  timerAvisos?.unref?.();
  // Volta dos reportes (reportes.mjs): a cada poucos minutos, os avisos de feito/recusado que a triagem mandou pra
  // cá vão pro sino de quem reportou, se a pessoa ainda existe nesta Ratoeira.
  async function lerRetornos(){
    const emails=new Set([...(contas?.usuarios?.()??[])].map(([email])=>email));
    await portal.reportes.retornos(async it=>{
      const para=String(it.quem).toLowerCase();
      if(emails.has(para))compartilhar.avisoDeReporte({para,reporte:it.id,titulo:it.titulo,status:it.status,recado:it.recado,versao:it.versao});
    });
  }
  let lendoRetornos=false;
  const rodarRetornos=()=>{if(lendoRetornos)return;lendoRetornos=true;lerRetornos().catch(e=>console.error('reportes: não consegui buscar os retornos:',e.message)).finally(()=>{lendoRetornos=false;});};
  const timerRetornos=compartilhar&&portal?.reportes?.temRetorno&&retornosCadaMs?setInterval(rodarRetornos,retornosCadaMs):null;
  timerRetornos?.unref?.();
  if(timerRetornos)setTimeout(rodarRetornos,15000).unref?.();
  // Aviso de instalação (reportes.mjs): a cada minuto confere se mudou algo (terminou de instalar, quem administra
  // entrou, versão nova) e só então manda. Falhou, tenta no minuto seguinte.
  let avisandoInstalacao=false;
  const avisarInstalacaoAgora=()=>{if(avisandoInstalacao)return;avisandoInstalacao=true;portal.reportes.avisarInstalacao().catch(e=>console.error('reportes: não consegui avisar a instalação:',e.message)).finally(()=>{avisandoInstalacao=false;});};
  const timerInstalacao=portal?.reportes?.temRetorno&&instalacaoCadaMs?setInterval(avisarInstalacaoAgora,instalacaoCadaMs):null;
  timerInstalacao?.unref?.();
  if(timerInstalacao)setTimeout(avisarInstalacaoAgora,10000).unref?.();
  // avisa o servidor de agentes do dono que a conversa passou (ou deixou) de ser compartilhada. Desligado, não
  // liga só por isso: o convidado entrando já liga, e o servidor confere de novo quando a conversa abrir.
  function avisarDono(c,ligar){
    const dono=pessoaDe(c.dono);if(!dono) return;
    const r=http.request({socketPath:agentes.socket.replaceAll('{user}',dono.user),path:'/compartilhada',method:'POST',headers:{'content-type':'application/json'},timeout:5000},res=>res.resume());
    r.on('error',()=>{});r.on('timeout',()=>r.destroy());r.end(JSON.stringify({agente:c.agente,sessao:c.sessao,ligar}));
  }
  const ativaComAmbiente=email=>Boolean(pessoaDe(email));
  function aceitaConvite(dono){
    const p=pessoaDe(dono);if(!p) return Promise.resolve(false);
    return new Promise(ok=>{
      const r=http.request({socketPath:agentes.socket.replaceAll('{user}',p.user),path:'/estado',method:'GET',timeout:3000},res=>{
        let d='';res.on('data',x=>d+=x);res.on('end',()=>{try{ok(JSON.parse(d).recursos?.includes('convite')===true);}catch{ok(false);}});});
      r.on('error',()=>{try{agentes.ligar?.(p.user);}catch{}ok(false);});r.on('timeout',()=>{r.destroy();ok(false);});r.end();
    });
  }
  const paraTela=c=>({...c,donoNome:nomeDe(c.dono),convidadoNome:nomeDe(c.convidado)});
  async function compartilharApi(req,res,pathname,identity){
    const eu=identity.email;
    try{
      if(pathname==='/_ratoeira/api/compartilhadas'&&req.method==='GET'){
        const {minhas,comigo}=compartilhar.dePessoa(eu);
        // pra quem dá pra compartilhar: quem está ativo e tem ambiente (o convidado abre o chat com ele)
        const pessoas=(await contas.listar()).filter(p=>p.email!==eu&&ativaComAmbiente(p.email)).map(p=>({email:p.email,nome:p.nome||p.email.split('@')[0]}));
        return json(res,200,{minhas:minhas.map(paraTela),comigo:comigo.filter(c=>ativaComAmbiente(c.dono)).map(paraTela),pessoas});
      }
      if(pathname==='/_ratoeira/api/notificacoes'&&req.method==='GET') return json(res,200,{...compartilhar.notificacoes(eu),push:push?{chave:push.chave(),aparelhos:push.aparelhos(eu).length}:null});
      if(req.method!=='POST') return json(res,405,{error:'Use GET ou POST.'});
      const b=await lerJson(req);
      if(pathname==='/_ratoeira/api/notificacoes/push'){
        if(!push) return json(res,404,{error:'Aviso no aparelho não está ligado nesta Ratoeira.'});
        if(b.sair){push.sair(eu,String(b.endpoint??''));return json(res,200,{ok:true});}
        push.assinar(eu,b.assinatura,b.aparelho);return json(res,200,{ok:true});
      }
      if(pathname==='/_ratoeira/api/notificacoes/lidas'){compartilhar.marcarLidas(eu,b.ids??null);return json(res,200,compartilhar.notificacoes(eu));}
      if(pathname==='/_ratoeira/api/compartilhadas'){
        if(!pessoaDe(eu)) return json(res,403,{error:'Tua conta não tem ambiente nesta Ratoeira.'});
        const convidado=String(b.email??'').toLowerCase();
        if(!ativaComAmbiente(convidado)) return json(res,400,{error:'Essa pessoa não tem ambiente ativo nesta Ratoeira.'});
        const c=compartilhar.compartilhar({dono:eu,donoNome:nomeDe(eu),convidado,agente:b.agente,sessao:b.sessao,cwd:b.cwd,titulo:b.titulo,modo:b.modo});
        avisarDono(c,true);
        // trocou o modo com o convidado dentro: ele reconecta e já pega o modo novo
        for(const {client,remote} of conexoesConvite.get(c.id)??[]){client.destroy();remote.destroy();}
        return json(res,201,paraTela(c));
      }
      // a tela de quem escreveu avisa: nota interna ou mensagem numa conversa compartilhada (vai pro sino dos outros)
      if(pathname==='/_ratoeira/api/compartilhadas/atividade'){
        let dono=eu,agente=b.agente,sessao=b.sessao;
        if(b.convite!=null){const c=compartilhar.achar(String(b.convite));if(!c||c.convidado!==eu) return json(res,404,{error:'Esse compartilhamento não existe mais.'});({dono,agente,sessao}=c);}
        return json(res,200,{avisados:compartilhar.atividade({de:eu,deNome:nomeDe(eu),dono,agente,sessao,tipo:b.tipo,texto:b.texto,mencionados:b.mencionados})});
      }
      // o dono colou o link de uma conversa dele numa conversa de outra pessoa (em que ele entrou): é ele autorizando.
      // Fica compartilhada só pra ler com o dono da conversa de destino, que o agente de lá lê com ler_conversa.
      // Quem chama é a tela de quem colou, antes de a mensagem ir pro agente; o link de outra pessoa não libera nada.
      if(pathname==='/_ratoeira/api/compartilhadas/por-link'){
        const l=lerLinkConversa(b.link);
        if(!l||l.dono!==eu) return json(res,200,{liberada:false});
        const destino=compartilhar.achar(String(b.convite??''));
        if(!destino||destino.convidado!==eu||destino.modo!=='entrar') return json(res,404,{error:'Essa conversa não está mais compartilhada contigo.'});
        const ja=compartilhar.convite({dono:eu,convidado:destino.dono,agente:l.agente,sessao:l.sessao});
        if(ja) return json(res,200,{liberada:true,ja:true,para:nomeDe(destino.dono)});
        const c=compartilhar.compartilhar({dono:eu,donoNome:nomeDe(eu),convidado:destino.dono,agente:l.agente,sessao:l.sessao,cwd:b.cwd,titulo:b.titulo,modo:'ler'});
        avisarDono(c,true);
        return json(res,201,{liberada:true,para:nomeDe(destino.dono),...paraTela(c)});
      }
      if(pathname==='/_ratoeira/api/compartilhadas/remover'){
        const c=compartilhar.remover(String(b.id??''),eu);
        for(const {client,remote} of conexoesConvite.get(c.id)??[]){client.destroy();remote.destroy();}
        if(!compartilhar.aindaCompartilhada(c.dono,c.agente,c.sessao)) avisarDono(c,false);
        return json(res,200,{ok:true});
      }
      return json(res,404,{error:'Recurso não encontrado.'});
    }catch(e){return json(res,e.status??400,{error:e.status?e.message:'Pedido inválido.'});}
  }
  // O MCP do app, chamado pelo agente da pessoa nesta máquina (sem login: vale o token da conversa).
  function mcpApp(req,res,pathname){
    if(req.headers['cf-connecting-ip']||req.headers['x-forwarded-for']) return reply(res,404,'Não encontrado.');
    const auth=String(req.headers.authorization??'');
    if(pathname.replace(/\/$/,'')==='/_ratoeira/mcp/_ratoeira'){
      const rec=auth.startsWith('Bearer ')&&ligacoes.get(sha(auth.slice(7)));
      if(!rec||rec.prefix!=='/_ratoeira'||rec.expira<Date.now()) return json(res,401,{error:'Token do chat inválido ou vencido.'});
      return mcpRatoeira(req,res,rec.email);
    }
    const app=apps.find(a=>a.prefix===pathname.slice('/_ratoeira/mcp'.length).replace(/\/$/,''));
    const rec=app&&auth.startsWith('Bearer ')&&ligacoes.get(sha(auth.slice(7)));
    if(!app?.mcp||!rec||rec.prefix!==app.prefix||rec.expira<Date.now()) return json(res,401,{error:'Token do chat inválido ou vencido.'});
    if(!podeApp(rec.email,app.prefix)) return json(res,403,{error:'Essa aplicação não está mais liberada pra essa pessoa.'});
    const ident=identidadeApp(app,{email:rec.email},{via:'chat',conversa:rec.conversa??'',mensagem_sha:sha(rec.mensagem).slice(0,32),mensagem_em:rec.mensagemEm});
    if(!ident) return json(res,403,{error:'Essa pessoa não tem papel nessa aplicação.'});
    const headers={host:'127.0.0.1','x-ratoeira-identidade':ident,'x-ratoeira-mensagem':b64u(rec.mensagem)};
    for(const n of ['content-type','content-length','accept','mcp-session-id','mcp-protocol-version','last-event-id'])if(req.headers[n])headers[n]=req.headers[n];
    const upstream=http.request({host:'127.0.0.1',port:app.port,path:app.prefix+'/'+app.mcp,method:req.method,headers},response=>{
      const h={...response.headers};delete h.connection;res.writeHead(response.statusCode,h);response.pipe(res);response.on('error',()=>res.destroy());
    });
    upstream.on('error',()=>{if(!res.headersSent)json(res,502,{error:'A aplicação está reiniciando. Tente de novo em alguns segundos.'});else res.destroy();});
    req.on('aborted',()=>upstream.destroy());
    req.pipe(upstream);
  }
  // ── MCP da própria Ratoeira (admin): publicar app pelo chat, sem botão (APPS.md, "Pôr no ar") ──
  const FERRAMENTAS_APPS=[
    {name:'listar_apps',description:'Lista os apps com manifesto (apps/<pasta>/ratoeira-app.json) nas áreas da Ratoeira: nome, área, se está no ar, a versão publicada e o resultado da última publicação.',
      inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true}},
    {name:'publicar_app',description:'Põe no ar (ou atualiza) um app da Ratoeira com a versão que está na pasta dele agora: cria o usuário do app, instala, liga o serviço e espera a rota de saúde. Se a versão nova não subir, a anterior segue no ar. Use quando terminar de criar ou mudar um app e os testes passarem; não precisa pedir pra pessoa clicar em nada. Leva de segundos a alguns minutos; se voltar "publicando", chame estado_publicacao depois.',
      inputSchema:{type:'object',properties:{nome:{type:'string',description:'O "nome" do manifesto (ex.: "pedidos").'},area:{type:'string',description:'Id da área, só se houver app com o mesmo nome em mais de uma.'}},required:['nome'],additionalProperties:false},annotations:{idempotentHint:true}},
    {name:'definir_chaves_app',description:'Grava as chaves (segredos) de um app no lugar dele, sem root, e publica o app de novo pra ele ler. Antes, grave os valores em ~/.config/ratoeira/chaves-apps/<nome>.env (NOME=valor por linha; crie com umask 077 ou chmod 600), sem mostrar valor na conversa: se a chave mora no cofre, `op read "op://Vault/item/campo"` direto pro arquivo. Só entram os nomes do campo "chaves" do manifesto; o arquivo é apagado depois. Devolve só os nomes.',
      inputSchema:{type:'object',properties:{nome:{type:'string',description:'O "nome" do manifesto.'},area:{type:'string',description:'Id da área, só se houver app com o mesmo nome em mais de uma.'}},required:['nome'],additionalProperties:false}},
    {name:'estado_publicacao',description:'O estado da última publicação de um app: publicando, ok ou erro, com o motivo, as chaves que faltam e o fim do log.',
      inputSchema:{type:'object',properties:{nome:{type:'string'}},required:['nome'],additionalProperties:false},annotations:{readOnlyHint:true}},
  ];
  // Publicar a própria Ratoeira (core.mjs): só as partes liberadas na config desta instância
  const publicaveis=core?core.partes.filter(p=>PUBLICAVEIS.includes(p)):[];
  const FERRAMENTAS_CORE=core?[
    {name:'publicar_ratoeira',description:'Publica uma parte da própria Ratoeira com o que está COMMITADO no repositório (mudança sem commit nos arquivos da parte faz recusar). Antes: rode os testes (npm test em gateway/ ou agentes/) e commite. Partes: '+publicaveis.map(p=>`"${p}" (${DESCRICAO_CORE[p]})`).join('; ')+'. Mudou só gateway/public: use "telas". Mudou .mjs do gateway: "gateway" (o chat de todo mundo cai uns segundos e esta conversa reconecta; se não subir, volta o anterior). Volta "publicando": chame estado_ratoeira de novo.',
      inputSchema:{type:'object',properties:{parte:{type:'string',enum:publicaveis}},required:['parte'],additionalProperties:false},annotations:{idempotentHint:true}},
    ...(core.partes.includes('receita')?[{name:'rodar_receita',description:'Instala algo pra máquina toda (biblioteca, navegador, CLI, serviço do sistema) rodando como root um script de kit/receitas/<nome> da fonte do núcleo, do último commit. Use quando a instalação precisa de root; o que dá pra instalar só pra pessoa (npm no projeto, pip/uv no usuário, ~/.local/bin) não precisa de receita. Pra criar uma: escreva o script (bash, set -euo pipefail, idempotente, que confere no fim se funcionou), dê permissão de execução, commite e chame esta ferramenta. Espera até ~25 min e devolve o fim do log.',
      inputSchema:{type:'object',properties:{nome:{type:'string',description:'O nome do arquivo em kit/receitas (ex.: "playwright").'},args:{type:'array',items:{type:'string'},maxItems:3,description:'Até 3 argumentos, sem espaço (ex.: uma versão).'}},required:['nome'],additionalProperties:false}}]:[]),
    ...(core.partes.includes('pacotes')?[{name:'instalar_pacotes',description:'apt-get install de pacotes do sistema (Ubuntu), como root. Use pra biblioteca ou programa que vem do apt (ex.: ffmpeg, poppler-utils). Coisa que precisa de mais passos vira receita (rodar_receita).',
      inputSchema:{type:'object',properties:{pacotes:{type:'array',items:{type:'string'},minItems:1,maxItems:20}},required:['pacotes'],additionalProperties:false}}]:[]),
  ]:[];
  // estado_ratoeira: as partes publicáveis (core) e/ou as atualizações (instalação); sem nenhum dos dois, não existe
  const FERRAMENTA_ESTADO=core||atualizacoes?[{name:'estado_ratoeira',description:[
      core&&publicaveis.length?'O que está no ar de cada parte da própria Ratoeira ('+publicaveis.join(', ')+') e o que está no repositório: commit publicado, commit no git, arquivos sem commit e o resultado da última publicação (com o fim do log, se falhou). Chame antes de publicar e depois, pra conferir.':'',
      atualizacoes?'Versão da Ratoeira no ar (e desde quando), canal, versão disponível com as mudanças do CHANGELOG, se tem atualização rodando e a última tentativa (com o fim do log, se falhou). Chame antes e depois de atualizar_ratoeira.':'',
    ].filter(Boolean).join(' ')||'Estado da própria Ratoeira.',
    inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true}}]:[];
  const FERRAMENTA_ATUALIZAR=atualizacoes?[{name:'atualizar_ratoeira',description:'Atualiza esta Ratoeira pela versão nova do produto. Ações: "conectar" (liga esta Ratoeira à conta da plataforma Ratos de IA de quem administra, que é por onde chegam as versões novas, enquanto a Comunidade Ratos dela estiver ativa: espera uns segundos e devolve um link e um código pra pessoa abrir e digitar, logada na plataforma; passe os dois pra ela), "verificar" (pergunta ao repositório se o canal tem versão nova; espera e devolve o que achou), "aplicar" (troca pra mais nova do canal, ou pra "versao" X.Y.Z; se falhar no meio, volta sozinha pra de antes) e "voltar" (volta pra versão que estava antes da última atualização). Antes de aplicar ou voltar: chame estado_ratoeira (ou verificar), mostre pra pessoa a versão no ar, a nova e o que muda (as mudanças do CHANGELOG), e só aplique com o ok explícito dela. Aplicar e voltar levam alguns minutos e reiniciam o gateway no meio: o chat de todo mundo cai uns segundos e esta conversa reconecta. Não espere a resposta: depois de uns 3 minutos, chame estado_ratoeira pra ver como ficou.',
    inputSchema:{type:'object',properties:{acao:{type:'string',enum:['conectar','verificar','aplicar','voltar']},versao:{type:'string',pattern:'^\\d+\\.\\d+\\.\\d+$',description:'Só com "aplicar": uma versão específica (ex.: "0.6.0"). Sem ela, a mais nova do canal.'}},required:['acao'],additionalProperties:false}}]:[];
  const FERRAMENTAS_RATOEIRA=[...(publicador?FERRAMENTAS_APPS:[]),...FERRAMENTA_ESTADO,...FERRAMENTAS_CORE,...FERRAMENTA_ATUALIZAR];
  // core.quem na config: só esses admins mexem no núcleo (publicar_ratoeira, receita, pacotes); sem a lista, todo admin
  const NOMES_CORE=new Set(FERRAMENTAS_CORE.map(f=>f.name));
  const podeNucleo=email=>!nucleoQuem?.length||nucleoQuem.some(e=>String(e).toLowerCase()===String(email??'').toLowerCase());
  const ferramentasDe=email=>FERRAMENTAS_RATOEIRA.filter(f=>!NOMES_CORE.has(f.name)||podeNucleo(email));
  const textoTentativa=(rot,u)=>!u?null:u.ok?`- ${rot}: ok, ${u.acao??''}${u.versao?' '+u.versao:''} (${u.em??'?'}${u.por?', '+u.por:''})${u.nada?' (já estava no ar)':''}`
    :`- ${rot} FALHOU, ${u.acao??''}${u.versao?' '+u.versao:''} (${u.em??'?'}): ${u.erro??'sem detalhe'}\n  fim do log:\n${u.log.slice(-20).map(x=>'    '+x).join('\n')}`;
  const textoAtualizacao=e=>{
    const l=['## Versão da Ratoeira',`- no ar: ${e.noAr?.versao?`${e.noAr.versao} (desde ${e.noAr.em??'?'}${e.noAr.por?', '+e.noAr.por:''})`:'sem registro do atualizador'}`,
      `- canal: ${e.canal??'?'} · verificado em ${e.verificadoEm??'nunca'}`];
    const c=e.conexao;
    l.push(c?.estado==='conectada'?`- plataforma: conectada a ${c.email??'uma conta'}`:c?.estado==='esperando'&&e.pedido?.acao==='conectar'?`- plataforma: esperando a pessoa abrir ${c.url} e digitar o código ${c.codigo} (vale 15 min)`
      :'- plataforma: não conectada (as versões novas saem pela conta da plataforma com a Comunidade Ratos ativa; ação "conectar")');
    if(e.licenca?.ok===false)l.push(`- sem versão nova: ${e.licenca.mensagem??e.licenca.motivo}`);
    const d=e.disponivel;
    if(d?.versao)l.push(d.nova?`- disponível: ${d.versao} (nova)`:`- disponível: ${d.versao} (em dia)`);
    if(d?.nova&&d.mudancas.length)l.push('- o que muda:\n'+d.mudancas.map(m=>`  ### ${m.titulo||m.versao}\n${m.texto.split('\n').slice(0,40).map(x=>'  '+x).join('\n')}`).join('\n'));
    if(e.anterior?.versao)l.push(`- anterior (pra voltar): ${e.anterior.versao}`);
    if(e.pedido)l.push(`- rodando agora: ${e.pedido.acao??'?'}${e.pedido.versao?' '+e.pedido.versao:''} desde ${e.pedido.desde}${e.pedido.por?' (pedido por '+e.pedido.por+')':''}`);
    const r=textoTentativa('último pedido',e.resultado);if(r)l.push(r);
    const u=textoTentativa('última atualização',e.ultima);if(u&&(!e.resultado||e.resultado.em!==e.ultima.em))l.push(u);
    return l.join('\n');
  };
  const textoCore=e=>{
    const l=[`## ${e.parte}: ${e.descricao}`,`- no ar: ${e.noAr?`${e.noAr.commit} (${e.noAr.em}, ${e.noAr.por})`:'sem registro de publicação por aqui'}`,
      `- no repositório: ${e.repo.commit??'?'}${e.repo.erro?' ('+e.repo.erro+')':''}`];
    if(e.repo.semCommit.length)l.push(`- sem commit (${e.repo.semCommit.length}): ${e.repo.semCommit.slice(0,10).join(', ')}`);
    if(e.publicando)l.push(`- publicando desde ${e.publicando.desde}`);
    else if(e.ultimo)l.push(e.ultimo.ok?`- última publicação: ok (${e.ultimo.em})`:`- última publicação FALHOU (${e.ultimo.em}): ${e.ultimo.erro}\n  fim do log:\n${e.ultimo.log.slice(-20).map(x=>'    '+x).join('\n')}`);
    return l.join('\n');
  };
  const textoEstado=(nome,e)=>!e?`${nome}: nunca publicado.`
    :e.estado==='publicando'?`${nome}: publicando (desde ${e.desde}). Chame estado_publicacao de novo daqui a pouco.`
    :e.estado==='ok'?`${nome}: no ar (${e.versao??'versão sem registro'}), em /${nome}/. Quem acessa se define na tela de Pessoas; todo mundo já abre com o último papel do manifesto.`+(e.chavesNovas?.length?`\nChaves gravadas: ${e.chavesNovas.join(', ')}.`:'')+(e.chavesIgnoradas?.length?` Fora do manifesto, ignoradas: ${e.chavesIgnoradas.join(', ')}.`:'')+(e.faltamChaves?.length?`\nFaltam chaves: ${e.faltamChaves.join(', ')}. Grave em ~/.config/ratoeira/chaves-apps/${nome}.env (NOME=valor, modo 600) e chame definir_chaves_app.`:'')
    :`${nome}: a publicação falhou: ${e.erro??'veja o log'}. A versão anterior, se havia, segue no ar.\nFim do log:\n${(e.log??[]).slice(-25).join('\n')}`;
  // ── Ler outra conversa (desde 16/10/2026): o agente recebe o link de uma conversa e lê o que foi dito lá ──
  // Pode ler quem é dono da conversa ou quem tem ela compartilhada (nem que seja só ler). O dono colar o link numa
  // conversa de outra pessoa já compartilha só pra ler (/_ratoeira/api/compartilhadas/por-link, pela tela dele).
  const FERRAMENTA_LER={name:'ler_conversa',description:'Lê uma conversa da Ratoeira (tua ou de outra pessoa do time) pelo link dela (…/portal/?chat=<agente>:<sessão>&de=<email>, o "Copiar link da conversa" do ⋯): as mensagens com o nome de quem mandou, as respostas do agente de lá, as notas internas e o que ele fez, as mais recentes se for longa. Use quando alguém mandar um link desses pra tu juntar o contexto daquela conversa com esta. Só lê: não manda nada pra lá. Chame de novo pra ver o que mudou. Só abre se a conversa é do dono desta ou está compartilhada com ele; se não estiver, diga pra quem é dona colar o link aqui (isso libera só pra leitura).',
    inputSchema:{type:'object',properties:{link:{type:'string',description:'O link da conversa, inteiro.'}},required:['link'],additionalProperties:false},annotations:{readOnlyHint:true}};
  const esperar=ms=>new Promise(r=>setTimeout(r,ms));
  function postarSocket(sock,caminho,corpo,timeout){
    return new Promise((ok,no)=>{
      const r=http.request({socketPath:sock,path:caminho,method:'POST',headers:{'content-type':'application/json'},timeout},res=>{
        let d='';res.setEncoding('utf8');res.on('data',x=>d+=x);res.on('end',()=>{try{ok({status:res.statusCode,corpo:JSON.parse(d||'{}')});}catch{no(new Error('resposta torta'));}});});
      r.on('error',no);r.on('timeout',()=>r.destroy(new Error('demorou demais')));r.end(JSON.stringify(corpo));
    });
  }
  async function lerConversa(args,email){
    const l=lerLinkConversa(args?.link);
    if(!l) throw new Error('Isso não é um link de conversa da Ratoeira (…/portal/?chat=<agente>:<sessão>&de=<email>). Peça o "Copiar link da conversa", no ⋯ da conversa.');
    const dono=nomeDe(l.dono),eu=nomeDe(email);
    let cwd=null;
    if(l.dono!==email){
      const c=compartilhar.convite({dono:l.dono,convidado:email,agente:l.agente,sessao:l.sessao});
      if(!c) throw new Error(`Essa conversa é de ${dono} e não está compartilhada com ${eu}. Pra ler, ${dono} cola o link numa conversa de ${eu} (isso libera só pra leitura) ou compartilha pelo botão Compartilhar.`);
      cwd=c.cwd;
    }
    const p=pessoaDe(l.dono);if(!p) throw new Error(`${dono} não tem ambiente ativo nesta Ratoeira.`);
    const sock=agentes.socket.replaceAll('{user}',p.user);
    // servidor de agentes do dono desligado: liga e espera um pouco
    if(!existsSync(sock)){try{agentes.ligar?.(p.user);}catch{}for(let i=0;i<20&&!existsSync(sock);i++)await esperar(500);}
    let r;try{r=await postarSocket(sock,'/ler-conversa',{agente:l.agente,sessao:l.sessao,...(cwd?{cwd}:{}),dono},90000);}
    catch(e){throw new Error(`Não consegui falar com o ambiente de ${dono} (${e.message}). Tente de novo em alguns segundos.`);}
    if(r.status!==200) throw new Error(r.corpo?.erro||'Não consegui ler essa conversa.');
    const d=r.corpo;
    return `Conversa "${d.titulo||'sem título'}", de ${dono}${d.estado==='rodando'?' (o agente de lá está trabalhando agora)':''}. ${d.mensagens} mensagens de gente; pasta ${d.cwd}. Só leitura: o que tu fizer aqui não aparece lá.\n\n${d.texto||'(ainda sem mensagens)'}`;
  }
  async function ferramentaRatoeira(nome,args,email){
    if(nome==='ler_conversa'&&compartilhar) return lerConversa(args,email);
    if(!contas.ehAdmin?.(email)) throw new Error('Só quem administra a Ratoeira publica apps.');
    if(!FERRAMENTAS_RATOEIRA.some(f=>f.name===nome)) throw new Error('Ferramenta desconhecida: '+nome);
    if(NOMES_CORE.has(nome)&&!podeNucleo(email)) throw new Error('Nesta Ratoeira, o núcleo só é publicado por '+nucleoQuem.join(', ')+'. Peça pra uma dessas pessoas.');
    if(nome==='estado_ratoeira'){
      // sem partes publicáveis (instalação), core.estados() vem vazio e só sai o bloco das atualizações
      const blocos=[...(core?(await core.estados()).map(textoCore):[]),...(atualizacoes?[textoAtualizacao(await atualizacoes.estado())]:[])];
      return blocos.join('\n\n')||'Nada publicável por aqui.';
    }
    if(nome==='atualizar_ratoeira'){
      const acao=String(args?.acao??''),versao=typeof args?.versao==='string'&&args.versao?args.versao:undefined;
      await atualizacoes.pedir({acao,versao},email).catch(e=>{throw new Error(e.message);});
      if(acao==='conectar'){
        // o código aparece em uns segundos; a espera pela pessoa digitar segue no atualizador (até 15 min)
        for(let i=0;i<15;i++){await new Promise(r=>setTimeout(r,1000));const e=await atualizacoes.estado();
          if(e.conexao?.estado==='esperando'&&e.pedido)return `Passe pra pessoa: abrir ${e.conexao.url} (logada na conta da plataforma Ratos de IA) e confirmar o código ${e.conexao.codigo}. Vale 15 minutos. Depois, chame estado_ratoeira pra ver se conectou.`;
          if(!e.pedido)return textoAtualizacao(e);}
        return textoAtualizacao(await atualizacoes.estado());
      }
      if(acao!=='verificar') return `${acao==='voltar'?'Voltando pra versão anterior':'Atualizando'}${versao?' pra '+versao:''}. Leva alguns minutos e reinicia o gateway no meio (esta conexão pode cair uns segundos); se falhar, a Ratoeira volta sozinha pra versão de antes. Chame estado_ratoeira daqui a uns 3 minutos.`;
      // verificar não reinicia nada: espera até ~2 min
      for(let i=0;i<60;i++){await new Promise(r=>setTimeout(r,2000));const e=await atualizacoes.estado();if(!e.pedido)return textoAtualizacao(e);}
      return textoAtualizacao(await atualizacoes.estado());
    }
    if(nome==='rodar_receita'||nome==='instalar_pacotes'){
      const parte=nome==='rodar_receita'?'receita':'pacotes';
      await core.publicar(parte,email,nome==='rodar_receita'?{receita:String(args?.nome??''),args:args?.args??[]}:{pacotes:args?.pacotes}).catch(e=>{throw new Error(e.message);});
      for(let i=0;i<750;i++){await new Promise(r=>setTimeout(r,2000));const e=await core.estado(parte);if(!e.publicando)
        return e.ultimo?.ok?`${parte}: ok (${e.ultimo.em}).\nFim do log:\n${e.ultimo.log.slice(-15).join('\n')}`:`${parte}: FALHOU: ${e.ultimo?.erro??'sem resultado'}\nFim do log:\n${(e.ultimo?.log??[]).slice(-25).join('\n')}`;}
      return `${parte}: ainda rodando depois de 25 min. Na VPS: journalctl -u ratoeira-publicar-core@${parte}`;
    }
    if(nome==='publicar_ratoeira'){
      const parte=String(args?.parte??'');
      if(!PUBLICAVEIS.includes(parte)) throw new Error(`Parte inválida: ${parte}.`);
      await core.publicar(parte,email).catch(e=>{throw new Error(e.message);});
      // o gateway reinicia no meio: não espera, a conversa pergunta o estado depois
      if(parte==='gateway') return 'gateway: publicando. Monta (npm ci + build, 1 a 3 min), reinicia o gateway e confere a saúde; se não subir, volta o anterior. Esta conexão pode cair uns segundos. Chame estado_ratoeira daqui a 2 minutos.';
      for(let i=0;i<60;i++){await new Promise(r=>setTimeout(r,2000));const e=await core.estado(parte);if(!e.publicando)return textoCore(e);}
      return textoCore(await core.estado(parte));
    }
    if(nome==='listar_apps'){
      const l=await publicador.listar();
      return l.length?l.map(a=>`- ${a.nome} (área ${a.area}): ${a.naConfigPrincipal?'publicado à mão na config principal':a.noAr?'no ar, '+(a.versao??''):'não publicado'}${a.ultimo?.estado==='erro'?' · última tentativa falhou: '+(a.ultimo.erro??''):''}`).join('\n')
        :'Nenhum app com ratoeira-app.json nas áreas.';
    }
    const n=String(args?.nome??'');
    if(nome==='estado_publicacao') return textoEstado(n,await publicador.estado(n));
    if(nome==='publicar_app'||nome==='definir_chaves_app'){
      const chavesDe=nome==='definir_chaves_app'?pessoaDe(email)?.user:null;
      if(nome==='definir_chaves_app'&&!chavesDe) throw new Error('Tua conta não tem usuário próprio nesta Ratoeira, então não tenho de onde ler as chaves.');
      let area=typeof args?.area==='string'?args.area:null;
      if(!area){
        const c=(await publicador.listar()).filter(a=>a.nome===n);
        if(!c.length) throw new Error(`Não achei o app "${n}" (apps/<pasta>/ratoeira-app.json com "nome": "${n}") em nenhuma área. Use listar_apps.`);
        if(c.length>1) throw new Error(`Tem "${n}" em mais de uma área (${c.map(a=>a.area).join(', ')}): diga qual em "area".`);
        area=c[0].area;
      }
      await publicador.publicar({area,nome:n,chavesDe},email);
      // espera até ~2 min; passou disso, devolve "publicando" e o agente pergunta depois
      for(let i=0;i<60;i++){await new Promise(r=>setTimeout(r,2000));const e=await publicador.estado(n);if(e?.estado!=='publicando')return textoEstado(n,e);}
      return textoEstado(n,await publicador.estado(n));
    }
    throw new Error('Ferramenta desconhecida: '+nome);
  }
  async function mcpRatoeira(req,res,email){
    if(req.method!=='POST') return json(res,405,{error:'Use POST.'});
    let m;try{m=await lerJson(req);}catch{return json(res,400,{jsonrpc:'2.0',id:null,error:{code:-32700,message:'JSON inválido'}});}
    const um=async x=>{
      if(!x||typeof x!=='object'||x.id==null) return null;   // notificação: sem resposta
      const ok=result=>({jsonrpc:'2.0',id:x.id,result});
      const admin=Boolean(senha&&contas.ehAdmin?.(email));
      if(x.method==='initialize') return ok({protocolVersion:typeof x.params?.protocolVersion==='string'?x.params.protocolVersion:'2025-06-18',capabilities:{tools:{}},serverInfo:{name:'ratoeira',version:'1'},
        instructions:(compartilhar?'Link de conversa da Ratoeira (…/portal/?chat=…) na mensagem: leia com ler_conversa.':'')
          +(admin?' Ferramentas da própria Ratoeira, só pra quem administra.'+(publicador?' Apps (APPS.md): depois de criar ou mudar um app e os testes passarem, publique com publicar_app.':'')+(core&&podeNucleo(email)?' A própria Ratoeira (telas, servidor, regras): mude no repositório, rode os testes, commite e publique com publicar_ratoeira; nunca copie à mão pra /opt/ratoeira.':'')+(atualizacoes?' Versão nova da Ratoeira: estado_ratoeira mostra o que muda; atualizar_ratoeira aplica, só com o ok da pessoa.':''):'')});
      if(x.method==='ping') return ok({});
      if(x.method==='tools/list') return ok({tools:[...(compartilhar?[FERRAMENTA_LER]:[]),...(admin?ferramentasDe(email):[])]});
      if(x.method==='tools/call'){
        try{return ok({content:[{type:'text',text:await ferramentaRatoeira(String(x.params?.name??''),x.params?.arguments,email)}],isError:false});}
        catch(e){return ok({content:[{type:'text',text:e.message}],isError:true});}
      }
      return {jsonrpc:'2.0',id:x.id,error:{code:-32601,message:'Método desconhecido.'}};
    };
    const r=Array.isArray(m)?(await Promise.all(m.map(um))).filter(Boolean):await um(m);
    if(!r||(Array.isArray(r)&&!r.length)){res.writeHead(202);return res.end();}
    return json(res,200,r);
  }
  const server = http.createServer(async(req,res)=>{
    if(req.url==='/_ratoeira/health' && req.method==='GET') return reply(res,200,'{"ok":true}','application/json');
    if(!req.url.startsWith('/')||req.url.startsWith('//')) return reply(res,400,'Caminho inválido.');
    // Playground (playground.mjs): endereço de experimento vai direto pro container dele, com o login próprio do subdomínio
    if(playground && playground.tratar(req,res,{cookiesFora:[COOKIE,'CF_Authorization']})) return;
    // Com o Playground, o túnel pode trazer qualquer subdomínio (rota curinga): o que não é a Ratoeira nem um
    // experimento não ganha a tela de login, ganha 404.
    if(playground && !hostDaRatoeira(req)) return reply(res,404,'Endereço desconhecido.');
    const pathname=req.url.split('?')[0];
    if(pathname.startsWith('/_ratoeira/mcp/')) return mcpApp(req,res,pathname);
    const app=appFor(pathname);
    // link público de uma aplicação (sem login): só leitura e o formulário de senha da própria aplicação
    const open=Boolean(app && ['GET','HEAD','POST'].includes(req.method) && app.open.some(p=>pathname.startsWith(p)) && !/(^|\/)\.\.?(\/|$)|%2e|%2f|%5c|\\/i.test(pathname));
    if(senha && !open) {
      // telas de entrada e o ícone delas abrem sem login
      // "Esqueci a senha": o link vai pro endereço configurado, nunca pro Host do pedido
      if(await tratarEntrada(req,res,{contas,ip:ipDe(req),origemOk:allowedOrigin(req),base:hostname&&!/^localhost(:|$)/.test(hostname)?'https://'+hostname:null,
        mandarEmail:contas?.emailConfig?m=>enviarEmail(contas.emailConfig(),m):null})) return;
      if(pathname==='/_ratoeira/icon.png' && req.method==='GET') return reply(res,200,readFileSync(new URL('icon.png',publicDir)),'image/png');
      // o navegador busca o manifesto sem cookie: com login, o Chrome do celular não instala a Ratoeira como app
      if(pathname==='/manifest.json' && ['GET','HEAD'].includes(req.method)) return reply(res,200,manifest,'application/manifest+json',req.method==='HEAD');
      // o service worker do aviso no aparelho (push.mjs): sem login, como o manifesto; só mostra a notificação
      if(pathname==='/sw.js' && push && ['GET','HEAD'].includes(req.method)) return reply(res,200,SERVICE_WORKER,'text/javascript; charset=utf-8',req.method==='HEAD');
    }
    let identity=null;
    // passe da página isolada (portal.mjs): imagem, vídeo e script de uma página aberta na área Arquivos chegam sem cookie
    const passe=!open && portal?.passe?.(req);
    if(passe) identity=passe;
    else if(!open) {
      try { identity=await identify(req); }
      catch {
        if(senha) {
          // página: vai pra tela de entrar e volta pra cá depois; API e o resto: 401
          if(['GET','HEAD'].includes(req.method) && (/text\/html/.test(req.headers.accept ?? '') || pathname==='/')) {
            res.writeHead(302,{'location':'/_ratoeira/entrar?volta='+encodeURIComponent(req.url),'cache-control':'no-store'});
            return res.end();
          }
          return reply(res,401,'Faça login para entrar na Ratoeira.');
        }
        return local ? reply(res,403,`Abra a Ratoeira por http://localhost:${access.port} (pelo túnel SSH)`) : reply(res,401,'Faça login para entrar na Ratoeira.');
      }
    }
    if(!allowedOrigin(req)) return reply(res,403,'Origem não permitida.');
    if(app && identity && !podeApp(identity.email, app.prefix)) return reply(res,403,'Essa aplicação não está liberada pra você. Fale com quem administra esta Ratoeira.');
    const limit=identity && limiteDe(identity.email);
    if(limit && !app) {
      if(limit.length && ['GET','HEAD'].includes(req.method) && (pathname==='/' || pathname.startsWith('/portal'))) {
        res.writeHead(302,{'location':limit[0]+'/','cache-control':'no-store'});
        return res.end();
      }
      return reply(res,403,limit.length ? 'Seu acesso nesta Ratoeira é só às aplicações liberadas pra você.' : 'Sua conta ainda não tem nada liberado nesta Ratoeira. Fale com quem administra.');
    }
    if(app) return proxyApp(req,res,app,identity);
    if(playground && identity && pathname==='/_ratoeira/play/entrar' && req.method==='GET') return playground.entrar(req,res,identity.email);
    if(playground && identity && pathname==='/_ratoeira/api/playground/analisar' && req.method==='GET'){
      try{return json(res,200,playground.analisar(new URL(req.url,'http://x').searchParams.get('arquivo')??''));}catch(e){return json(res,e.status??500,{error:e.message});}
    }
    if(playground && identity && pathname==='/_ratoeira/api/playground'){
      if(req.method==='GET') return json(res,200,{...playground.paraTela(),podeEditar:Boolean(senha&&contas.ehAdmin?.(identity.email))});
      if(req.method==='PUT'){
        if(!senha||!contas.ehAdmin?.(identity.email)) return json(res,403,{error:'Só quem administra muda o endereço do Playground.'});
        let b;try{b=await lerJson(req);}catch{return json(res,400,{error:'Pedido inválido.'});}
        try{return json(res,200,playground.definirBase(b.base));}catch(e){return json(res,e.status??500,{error:e.message});}
      }
      return json(res,405,{error:'Use GET ou PUT.'});
    }
    if(identity && (pathname==='/_ratoeira/api/chat/ligar'||pathname==='/_ratoeira/api/chat/mensagem')) return chatApi(req,res,pathname,identity);
    if(identity && compartilhar && (pathname.startsWith('/_ratoeira/api/compartilhadas')||pathname.startsWith('/_ratoeira/api/notificacoes'))) return compartilharApi(req,res,pathname,identity);
    if(portal && await portal.handle(req,res,identity))return;
    if(['GET','HEAD'].includes(req.method)) {
      // landingPath aponta pro projeto do Paseo único; quem tem Paseo próprio não usa
      if(req.url==='/' && (portal||defaults?.landingPath&&!pessoaDe(identity.email))) {
        res.writeHead(302,{'location':portal?'/portal/#inicio':defaults.landingPath,'cache-control':'no-store'});
        return res.end();
      }
      if(pathname==='/manifest.json') return reply(res,200,manifest,'application/manifest+json',req.method==='HEAD');
      const asset=assets.get(pathname) ?? (faviconPattern.test(pathname)?['favicon.png','image/png']:null);
      if(asset) return reply(res,200,readFileSync(new URL(asset[0],publicDir)),asset[1],req.method==='HEAD');
    }
    const paseo=paseoFor(identity);
    if(!paseo) return pessoaDe(identity.email) ? reply(res,404,semPagina) : reply(res,403,noPaseo);
    const upstream=http.request({...paseo,path:req.url,method:req.method,headers:upstreamHeaders(req,false)},response=>{
      const headers={...response.headers};
      delete headers.connection;
      const isHtml=response.headers['content-type']?.startsWith('text/html') && req.method!=='HEAD';
      if(isHtml) {
        const chunks=[]; let size=0;
        response.on('data',chunk=>{
          size+=chunk.length;
          if(size>2*1024*1024) {response.destroy();reply(res,502,'Página excede o limite do gateway.');}
          else chunks.push(chunk);
        });
        response.on('end',()=>{
          if(res.writableEnded) return;
          delete headers['content-length'];delete headers['content-encoding'];delete headers.etag;
          headers['cache-control']='no-store';
          res.writeHead(response.statusCode,headers);
          res.end(brandedHtml(Buffer.concat(chunks).toString('utf8'),defaults));
        });
      } else {res.writeHead(response.statusCode,headers);response.pipe(res);}
      response.on('error',()=>res.destroy());
    });
    upstream.on('error',error=>{
      if(res.headersSent) return res.destroy();
      reply(res,502,'O ambiente está reconectando. Tente novamente.');
    });
    req.on('aborted',()=>upstream.destroy());
    req.pipe(upstream);
  });
  // Chat da Ratoeira (agentes por ACP, agentes/): /api/agentes/ws vai pro servidor de
  // agentes da pessoa, num socket que só o grupo do gateway abre. Desligado: pede pro systemd ligar e
  // recusa com 503; o navegador tenta de novo em seguida. O servidor confia no socket: quem chega
  // nele já passou pelo login aqui.
  const ligandoAgentes=new Map();
  // x-ratoeira-quem: quem está do outro lado (nome no autor das mensagens e na presença) e, pra convidado, o
  // convite (só aquela conversa, ler ou entrar). O servidor de agentes confia: o socket só o gateway abre.
  const nomeDe=email=>(senha&&contas.nome?.(email))||email.split('@')[0];
  const cabecalhoQuem=q=>Buffer.from(JSON.stringify(q)).toString('base64url');
  const conexoesConvite=new Map();       // id do convite → Set({client, remote}): tirar o acesso derruba na hora
  function proxyAgentes(req, client, head, identity, convite=null) {
    // convidado vai pro servidor do dono da conversa; o resto, pro próprio
    const person=pessoaDe(convite?convite.dono:identity.email);
    if(!person) return rejectSocket(client,convite?404:403);
    const socketPath=agentes.socket.replaceAll('{user}',person.user);
    const headers={host:'localhost',connection:'Upgrade',upgrade:'websocket',
      'x-ratoeira-quem':cabecalhoQuem({email:identity.email,nome:nomeDe(identity.email),...(convite?{convite:{agente:convite.agente,sessao:convite.sessao,cwd:convite.cwd,modo:convite.modo}}:{})})};
    for(const k of ['sec-websocket-key','sec-websocket-version','sec-websocket-extensions']) if(req.headers[k]) headers[k]=req.headers[k];
    const upstream=http.request({socketPath,path:'/ws',method:'GET',headers});
    upstream.on('upgrade',(response,remote,remoteHead)=>{
      if(client.destroyed){remote.destroy();return;}
      upstream.setTimeout(0);remote.setTimeout(0);
      client.write('HTTP/1.1 101 Switching Protocols\r\n'+Object.entries(response.headers).map(([k,v])=>`${k}: ${v}\r\n`).join('')+'\r\n');
      if(remoteHead.length) client.write(remoteHead);
      if(head.length) remote.write(head);
      const lifetime=Math.max(1,Math.min(2147483647,identity.exp*1000-Date.now()));
      const timer=setTimeout(()=>{client.destroy();remote.destroy();},lifetime);timer.unref();
      let lista=conexoes.get(identity.email);if(!lista){lista=new Set();conexoes.set(identity.email,lista);}
      const par={client,remote};lista.add(par);
      let doConvite=null;if(convite){doConvite=conexoesConvite.get(convite.id);if(!doConvite){doConvite=new Set();conexoesConvite.set(convite.id,doConvite);}doConvite.add(par);}
      const fechar=()=>{clearTimeout(timer);lista.delete(par);if(!lista.size)conexoes.delete(identity.email);
        if(doConvite){doConvite.delete(par);if(!doConvite.size)conexoesConvite.delete(convite.id);}client.destroy();remote.destroy();};
      client.on('close',fechar);remote.on('close',fechar);
      client.on('error',fechar);remote.on('error',fechar);
      client.pipe(remote);remote.pipe(client);
    });
    upstream.on('response',response=>{response.resume();rejectSocket(client,403);});
    upstream.on('error',error=>{
      if(['ENOENT','ECONNREFUSED'].includes(error?.code) && agentes.ligar && Date.now()-(ligandoAgentes.get(person.user)??0)>15000) {
        ligandoAgentes.set(person.user,Date.now());
        try { agentes.ligar(person.user); } catch {}
      }
      if(!client.destroyed) client.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
    });
    client.on('error',()=>upstream.destroy());
    upstream.setTimeout(10000,()=>upstream.destroy());upstream.end();
  }
  server.on('upgrade',async(req,client,head)=>{
    if(playground && playground.tratarUpgrade(req,client,head,{cookiesFora:[COOKIE,'CF_Authorization']})) return;
    if(playground && !hostDaRatoeira(req)) return rejectSocket(client,403);
    let identity;
    try {identity=await identify(req);}
    catch {return rejectSocket(client,local?403:401);}
    if(!allowedOrigin(req,true)||!req.url.startsWith('/')||req.url.startsWith('//')) return rejectSocket(client,403);
    if(agentes && req.url.split('?')[0]==='/api/agentes/ws') {
      if(limiteDe(identity.email)) return rejectSocket(client,403);
      const idConvite=new URL(req.url,'http://x').searchParams.get('convite');
      if(idConvite!=null){
        const c=compartilhar?.achar(idConvite);
        if(!c||c.convidado!==identity.email) return rejectSocket(client,404);
        // o servidor do dono precisa saber o que é convite (versão de 15/10/2026 em diante): o de antes ignoraria
        // o cabeçalho e o convidado entraria como dono. Versão velha ou desligado: 503, o chat tenta de novo.
        if(!(await aceitaConvite(c.dono))) return rejectSocket(client,503);
        return proxyAgentes(req,client,head,identity,c);
      }
      return proxyAgentes(req,client,head,identity);
    }
    // aplicações do sistema não usam WebSocket, e quem está preso a elas não fala com o Paseo
    if(appFor(req.url.split('?')[0]) || limiteDe(identity.email)) return rejectSocket(client,403);
    const paseo=paseoFor(identity);
    if(!paseo) return rejectSocket(client,403);
    if(client.destroyed) return;
    const clientProtocol=req.headers['sec-websocket-protocol']?.split(',')[0]?.trim();
    const upstream=http.request({...paseo,path:req.url,method:'GET',headers:upstreamHeaders(req,true)});
    upstream.on('upgrade',(response,remote,remoteHead)=>{
      if(client.destroyed){remote.destroy();return;}
      upstream.setTimeout(0);remote.setTimeout(0);
      // The daemon selects its bearer subprotocol. Never expose that server secret.
      const headers={...response.headers};delete headers['sec-websocket-protocol'];
      if(clientProtocol) headers['sec-websocket-protocol']=clientProtocol;
      client.write('HTTP/1.1 101 Switching Protocols\r\n'+Object.entries(headers).map(([k,v])=>`${k}: ${v}\r\n`).join('')+'\r\n');
      if(remoteHead.length) client.write(remoteHead);
      if(head.length) remote.write(head);
      const lifetime=Math.max(1,Math.min(2147483647,identity.exp*1000-Date.now()));
      const timer=setTimeout(()=>{client.destroy();remote.destroy();},lifetime);timer.unref();
      let lista=conexoes.get(identity.email);if(!lista){lista=new Set();conexoes.set(identity.email,lista);}
      const par={client,remote};lista.add(par);
      let fechada=false;
      const fechar=()=>{if(fechada)return;fechada=true;lista.delete(par);if(!lista.size)conexoes.delete(identity.email);};
      client.on('close',()=>{clearTimeout(timer);remote.destroy();fechar();});
      remote.on('close',fechar);
      remote.on('close',()=>{clearTimeout(timer);client.destroy();});
      client.on('error',()=>remote.destroy());remote.on('error',()=>client.destroy());
      client.pipe(remote);remote.pipe(client);
    });
    upstream.on('response',response=>{response.resume();rejectSocket(client,403);});
    upstream.on('error',()=>client.destroy());
    client.on('error',()=>upstream.destroy());
    upstream.setTimeout(10000,()=>upstream.destroy());upstream.end();
  });
  server.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));});
  // contas.mjs chama quando a pessoa é desativada ou troca a senha
  server.revogar=email=>{for(const {client,remote} of conexoes.get(email)??[]){client.destroy();remote.destroy();}};
  // Apps publicados depois de ligar (publicar.mjs): troca a lista no lugar, sem reiniciar. restrictTo
  // (modo Cloudflare) segue valendo só pros apps que já existiam.
  server.trocarApps=list=>{const n=normalizeApps(list, null);apps.splice(0, apps.length, ...n.apps);};
  server.lerAvisos=lerAvisos;
  server.shutdown=()=>{clearInterval(timerAvisos);clearInterval(timerRetornos);clearInterval(timerInstalacao);portal?.close();playground?.fechar();for(const socket of sockets)socket.destroy();server.close();};
  return server;
}
