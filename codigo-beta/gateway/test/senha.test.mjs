// Gateway com login próprio (access.mode "senha"): telas de entrada, cookie de sessão, servidor de
// agentes de cada pessoa, aplicações por pessoa e papel, tela de Pessoas, sair e desativar.
import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {WebSocket,WebSocketServer} from 'ws';
import {createGateway,uidDoSistema} from '../server.mjs';
import {createPortal} from '../portal.mjs';
import {createContas} from '../contas.mjs';

const SENHA='uma frase bem comprida';
const host='ratoeira.example.com',origin='https://'+host;
const dir=await mkdtemp(path.join(tmpdir(),'ratoeira-senha-'));
const vistos={};
function paseoFalso(nome){
  const s=http.createServer((req,res)=>{vistos[nome]=req.headers;res.setHeader('content-type','application/json');res.end(JSON.stringify({paseo:nome}));});
  const wss=new WebSocketServer({noServer:true});
  s.on('upgrade',(req,sock,head)=>wss.handleUpgrade(req,sock,head,ws=>ws.send(nome)));
  s.wss=wss;return s;
}
const unico=paseoFalso('unico');
await new Promise(r=>unico.listen(0,'127.0.0.1',r));
let appVisto;
const app=http.createServer((req,res)=>{appVisto=req.headers;res.end('sistema');});
await new Promise(r=>app.listen(0,'127.0.0.1',r));

let gateway;
const contas=createContas({dir:path.join(dir,'contas'),socketPattern:path.join(dir,'{user}.sock'),criarUsuario:async()=>{},
  appsPapeis:new Map([['/sistema',['admin','equipe','financeiro']]]),aoRevogar:e=>gateway.revogar(e)});
await contas.iniciar();
const portal=createPortal({hostname:host,dataDir:path.join(dir,'estado'),pagesDir:dir,acesso:contas,contas,criaAmbiente:true,
  appsPapeis:[{prefix:'/sistema',name:'Sistema',papeis:['admin','equipe','financeiro']}]},
  {runtime:{status:async id=>({id,status:'connected'}),launch:()=>{throw new Error('não');},backup:async()=>{}}});
const ligados=[],enviados=[];
gateway=createGateway({hostname:host,upstreamPort:unico.address().port,password:'TEST_ONLY',access:{mode:'senha'},contas,portal,
  apps:[{prefix:'/sistema',port:app.address().port}],playground:{tratar:()=>false,tratarUpgrade:()=>false,entrar:()=>{},paraTela:()=>({itens:[]}),fechar(){}},agentes:{socket:path.join(dir,'agentes-{user}.sock'),ligar:u=>ligados.push(u)},
  pushArquivo:path.join(dir,'push.json'),avisosCadaMs:0,enviarPush:async(sub,carga)=>{enviados.push({sub,carga:JSON.parse(carga)});if(sub.endpoint.includes('morta'))throw Object.assign(new Error('gone'),{statusCode:410});}});
await new Promise(r=>gateway.listen(0,'127.0.0.1',r));
const porta=gateway.address().port,base='http://127.0.0.1:'+porta;
after(async()=>{
  for(const c of unico.wss.clients)c.terminate();
  for(const c of agentesDaAna?.wss.clients??[])c.terminate();
  for(const s of [gateway,unico,app,agentesDaAna?.ag].filter(Boolean))s.closeAllConnections?.();
  gateway.shutdown();await Promise.all([unico,app,agentesDaAna?.ag].filter(Boolean).map(s=>new Promise(r=>s.close(r))));
  await rm(dir,{recursive:true,force:true});
});

// Pedido com Host público (como chega pelo Tunnel/Caddy), pra conferir cookie Secure e origem.
function pedir(caminho,{method='GET',headers={},body}={}){
  return new Promise((ok,erro)=>{
    const req=http.request({host:'127.0.0.1',port:porta,path:caminho,method,headers:{host,...headers}},res=>{
      let txt='';res.setEncoding('utf8');res.on('data',c=>txt+=c);res.on('end',()=>ok({status:res.statusCode,headers:res.headers,texto:txt}));
    });
    req.on('error',erro);if(body)req.write(body);req.end();
  });
}
const form=obj=>new URLSearchParams(obj).toString();
const postForm=(caminho,obj,extra={})=>pedir(caminho,{method:'POST',headers:{origin,'content-type':'application/x-www-form-urlencoded',...extra},body:form(obj)});
const cookieDe=r=>r.headers['set-cookie']?.[0]?.split(';')[0];
const api=(caminho,cookie,{method='GET',body}={})=>pedir(caminho,{method,headers:{cookie,...(method!=='GET'?{origin,'content-type':'application/json'}:{})},body:body&&JSON.stringify(body)});
const wsAbre=cookie=>new Promise(ok=>{
  const ws=new WebSocket(`ws://127.0.0.1:${porta}/ws`,{headers:{host,origin,cookie}});
  ws.on('message',d=>ok({ws,primeiro:String(d)}));
  ws.on('unexpected-response',(_q,res)=>{res.resume();ok({status:res.statusCode});});
  ws.on('error',()=>ok({status:'erro'}));
});

let admin;   // cookie do admin
test('sem login: página vai pra tela de entrar, API dá 401, e a tela não roda script',async()=>{
  const raiz=await pedir('/');
  assert.equal(raiz.status,302);assert.equal(raiz.headers.location,'/_ratoeira/entrar?volta=%2F');
  assert.equal((await pedir('/_ratoeira/api/portal')).status,401);
  assert.equal((await pedir('/api/agents')).status,401);
  assert.equal((await pedir('/sistema/')).status,401);
  const tela=await pedir('/_ratoeira/entrar');
  assert.equal(tela.status,200);assert.match(tela.headers['content-security-policy'],/default-src 'none'/);
  assert.ok(!/<script/i.test(tela.texto));
  assert.equal((await pedir('/_ratoeira/icon.png')).status,200);
  const manifesto=await pedir('/manifest.json');
  assert.equal(manifesto.status,200);assert.equal(JSON.parse(manifesto.texto).display,'standalone');
  // atalhos do ícone: todos dentro do portal, e o de conversa nova com ?nova
  const atalhos=JSON.parse(manifesto.texto).shortcuts;
  assert.deepEqual(atalhos.map(a=>a.url),['/portal/?nova#arquivos','/portal/#arquivos','/portal/#inicio']);
  assert.equal((await wsAbre('')).status,401);
});

test('primeiro acesso pelo link: cria o admin e já entra, com cookie HttpOnly e Secure',async()=>{
  const token=await contas.primeiroAcesso();
  assert.equal((await pedir('/_ratoeira/link/'+token)).status,200);
  // sem origem, ou de outro site: recusa
  assert.equal((await pedir('/_ratoeira/link/'+token,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:form({email:'caio@x.com',nome:'Caio',senha:SENHA,confirmar:SENHA})})).status,403);
  assert.equal((await postForm('/_ratoeira/link/'+token,{email:'caio@x.com',nome:'Caio',senha:SENHA,confirmar:'outra coisa'})).status,400);
  const r=await postForm('/_ratoeira/link/'+token,{email:'caio@x.com',nome:'Caio',senha:SENHA,confirmar:SENHA});
  assert.equal(r.status,303);
  assert.match(r.headers['set-cookie'][0],/HttpOnly/);assert.match(r.headers['set-cookie'][0],/Secure/);assert.match(r.headers['set-cookie'][0],/SameSite=Lax/);
  admin=cookieDe(r);
  assert.equal((await pedir('/_ratoeira/link/'+token)).status,410);
  const info=JSON.parse((await api('/_ratoeira/api/portal',admin)).texto);
  assert.equal(info.user.isAdmin,true);assert.equal(info.user.name,'Caio');assert.equal(info.user.signOut,'/_ratoeira/sair');
});

test('entrar: senha errada volta pra tela, a certa abre sessão e volta pro caminho pedido',async()=>{
  const errada=await postForm('/_ratoeira/entrar',{email:'caio@x.com',senha:'nao e essa nao',volta:'/portal/'});
  assert.equal(errada.status,401);assert.match(errada.texto,/E-mail ou senha incorretos/);
  const certa=await postForm('/_ratoeira/entrar',{email:'caio@x.com',senha:SENHA,volta:'/portal/#arquivos'});
  assert.equal(certa.status,303);assert.equal(certa.headers.location,'/portal/#arquivos');
  // volta pra outro site, não
  const fora=await postForm('/_ratoeira/entrar',{email:'caio@x.com',senha:SENHA,volta:'//evil.example/x'});
  assert.equal(fora.headers.location,'/');
  // com sessão, a tela de entrar segue direto (o ícone do iPhone posto a partir dela abria o formulário toda vez)
  const ja=await pedir('/_ratoeira/entrar?volta=%2Fportal%2F',{headers:{cookie:cookieDe(certa)}});
  assert.equal(ja.status,303);assert.equal(ja.headers.location,'/portal/');
  const tela=await pedir('/_ratoeira/entrar');
  assert.match(tela.texto,/rel="manifest" href="\/manifest.json"/);assert.match(tela.headers['content-security-policy'],/manifest-src 'self'/);
});

test('Paseo: sem ambiente, nada; com o Paseo único ligado pelo comando da VPS, vai pra ele',async()=>{
  assert.equal((await api('/api/agents',admin)).status,403);
  await contas.compartilhado('caio@x.com',true);
  const r=await api('/api/agents',admin);
  assert.equal(JSON.parse(r.texto).paseo,'unico');
  // a sessão da Ratoeira não vai pro Paseo
  assert.ok(!String(vistos.unico.cookie??'').includes('ratoeira_sessao'));
  assert.equal((await wsAbre(admin)).primeiro,'unico');
});

let anaCookie,anaWs,agentesDaAna;
test('convite pela tela de Pessoas: ambiente próprio, app com papel, link de 24 h',async()=>{
  const r=await api('/_ratoeira/api/pessoas',admin,{method:'POST',body:{email:'ana@x.com',nome:'Ana',ambiente:true,usuario:'ana',apps:{'/sistema':'equipe'}}});
  assert.equal(r.status,201);
  const {link,pessoa}=JSON.parse(r.texto);
  assert.match(link,/^\/_ratoeira\/link\/[A-Za-z0-9_-]{40,}$/);assert.equal(pessoa.estado,'convidada');
  const usar=await postForm(link,{email:'ana@x.com',nome:'Ana Souza',senha:SENHA,confirmar:SENHA});
  assert.equal(usar.status,303);anaCookie=cookieDe(usar);
  // sem Paseo por pessoa (saiu em 09/10/2026): endereço do Paseo não existe pra ela
  assert.equal((await api('/api/agents',anaCookie)).status,404);
  // membro não vê a tela de Pessoas
  assert.equal((await api('/_ratoeira/api/pessoas',anaCookie)).status,403);
  assert.equal(JSON.parse((await api('/_ratoeira/api/portal',anaCookie)).texto).user.isAdmin,false);
});

test('aplicações: só quem tem o app abre, e a sessão não chega no app',async()=>{
  const r=await api('/sistema/x',anaCookie);
  assert.equal(r.status,200);assert.ok(!String(appVisto.cookie??'').includes('ratoeira_sessao'));
  assert.equal(r.headers['cache-control'],'private, no-cache');
  const lu=JSON.parse((await api('/_ratoeira/api/pessoas',admin,{method:'POST',body:{email:'lu@x.com',nome:'Lu',apps:{'/sistema':'financeiro'}}})).texto);
  const luCookie=cookieDe(await postForm(lu.link,{email:'lu@x.com',nome:'Lu',senha:SENHA,confirmar:SENHA}));
  // sem ambiente e só com o app: a raiz leva pro app; portal, API e Paseo, não
  const raiz=await api('/',luCookie);assert.equal(raiz.status,302);assert.equal(raiz.headers.location,'/sistema/');
  assert.equal((await api('/_ratoeira/api/portal',luCookie)).status,403);
  assert.equal((await api('/api/agents',luCookie)).status,403);
  assert.equal((await api('/sistema/y',luCookie)).status,200);
  // tirar o app pela tela de Pessoas fecha a porta
  await api('/_ratoeira/api/pessoas/'+encodeURIComponent('lu@x.com')+'/editar',admin,{method:'POST',body:{apps:{}}});
  assert.equal((await api('/sistema/y',luCookie)).status,403);
  assert.equal((await api('/',luCookie)).status,403);
});

test('chat por ACP: /api/agentes/ws vai pro servidor de agentes da pessoa, e liga ele se estiver desligado',async()=>{
  const abre=(cookie,extra={})=>new Promise(ok=>{
    const ws=new WebSocket(`ws://127.0.0.1:${porta}/api/agentes/ws`,{headers:{host,origin,...(cookie?{cookie}:{}),...extra}});
    ws.on('message',d=>{ok({ws,primeiro:String(d)});});
    ws.on('unexpected-response',(_q,res)=>{res.resume();ok({status:res.statusCode});});
    ws.on('error',()=>ok({status:'erro'}));
  });
  assert.equal((await abre(null)).status,401);
  assert.equal((await abre(anaCookie,{origin:'https://outro.example.com'})).status,403);
  // desligado: 503 e pede pro systemd ligar o da ana
  assert.equal((await abre(anaCookie)).status,503);
  assert.deepEqual(ligados,['ana']);
  const ag=http.createServer();const wss=new WebSocketServer({server:ag,path:'/ws'});agentesDaAna={ag,wss};
  let visto;wss.on('connection',(ws,req)=>{visto=req.headers;ws.send('agentes da ana');});
  await new Promise(r=>ag.listen(path.join(dir,'agentes-ana.sock'),r));
  const w=await abre(anaCookie);
  assert.equal(w.primeiro,'agentes da ana');
  // a sessão da Ratoeira não chega no servidor de agentes
  assert.ok(!visto.cookie&&!visto.origin);
  anaWs=w.ws;   // fica aberto: desativar a pessoa tem que derrubar (teste abaixo)
});

test('desativar pela tela derruba a sessão e o WebSocket aberto na hora',async()=>{
  const fechou=new Promise(r=>anaWs.on('close',r));
  const r=await api('/_ratoeira/api/pessoas/'+encodeURIComponent('ana@x.com')+'/desativar',admin,{method:'POST',body:{}});
  assert.equal(r.status,200);
  await fechou;
  assert.equal((await api('/api/agents',anaCookie)).status,401);
  const link=JSON.parse((await api('/_ratoeira/api/pessoas/'+encodeURIComponent('ana@x.com')+'/link',admin,{method:'POST',body:{}})).texto);
  assert.equal(link.error,'Reative a pessoa antes.');
  await api('/_ratoeira/api/pessoas/'+encodeURIComponent('ana@x.com')+'/reativar',admin,{method:'POST',body:{}});
  const novo=JSON.parse((await api('/_ratoeira/api/pessoas/'+encodeURIComponent('ana@x.com')+'/link',admin,{method:'POST',body:{}})).texto);
  assert.equal(novo.tipo,'senha');assert.match(novo.link,/^\/_ratoeira\/link\//);
  for(const c of agentesDaAna.wss.clients)c.terminate();agentesDaAna.wss.close();agentesDaAna.ag.closeAllConnections();
  await new Promise(r=>agentesDaAna.ag.close(r));agentesDaAna=null;
});

test('conversa compartilhada: o dono convida, o sino avisa, o convidado entra no servidor do dono só pra ela',async()=>{
  const beto=JSON.parse((await api('/_ratoeira/api/pessoas',admin,{method:'POST',body:{email:'beto@x.com',nome:'Beto',ambiente:true,usuario:'beto'}})).texto);
  const betoCookie=cookieDe(await postForm(beto.link,{email:'beto@x.com',nome:'Beto',senha:SENHA,confirmar:SENHA}));
  const ana=cookieDe(await postForm('/_ratoeira/entrar',{email:'ana@x.com',senha:SENHA}));
  // servidor de agentes do Beto, de mentira: guarda o cabeçalho de quem chega e o aviso de conversa compartilhada
  const avisos=[];let quem=null;
  let versaoNova=false;
  const ag=http.createServer((req,res)=>{if(req.url==='/estado'){return res.end(JSON.stringify({ocupado:false,...(versaoNova?{recursos:['convite']}:{})}));}
    let d='';req.on('data',x=>d+=x);req.on('end',()=>{avisos.push({url:req.url,corpo:JSON.parse(d||'{}')});res.end('{}');});});
  const wss=new WebSocketServer({server:ag,path:'/ws'});wss.on('connection',(ws,req)=>{quem=JSON.parse(Buffer.from(req.headers['x-ratoeira-quem'],'base64url').toString());ws.send('agentes do beto');});
  await new Promise(r=>ag.listen(path.join(dir,'agentes-beto.sock'),r));
  try{
    const lista=JSON.parse((await api('/_ratoeira/api/compartilhadas',betoCookie)).texto);
    assert.deepEqual(lista.pessoas.map(p=>p.email),['ana@x.com']);   // o admin aqui não tem ambiente próprio
    assert.equal((await api('/_ratoeira/api/compartilhadas',betoCookie,{method:'POST',body:{email:'caio@x.com',agente:'claude',sessao:'s1',cwd:'/srv/t',modo:'ler'}})).status,400);
    assert.equal((await api('/_ratoeira/api/compartilhadas',betoCookie,{method:'POST',body:{email:'ana@x.com',agente:'claude',sessao:'s1',cwd:'/srv/t',modo:'tudo'}})).status,400);
    const r=await api('/_ratoeira/api/compartilhadas',betoCookie,{method:'POST',body:{email:'ana@x.com',agente:'claude',sessao:'s1',cwd:'/srv/t',titulo:'Proposta da Acme',modo:'ler'}});
    assert.equal(r.status,201);const conv=JSON.parse(r.texto);
    assert.equal(conv.donoNome,'Beto');assert.equal(conv.modo,'ler');
    for(let i=0;i<50&&!avisos.length;i++)await new Promise(ok=>setTimeout(ok,20));
    assert.deepEqual(avisos[0],{url:'/compartilhada',corpo:{agente:'claude',sessao:'s1',ligar:true}});
    // o sino da Ana
    const sino=JSON.parse((await api('/_ratoeira/api/notificacoes',ana)).texto);
    assert.equal(sino.naoLidas,1);assert.equal(sino.itens[0].deNome,'Beto');assert.equal(sino.itens[0].compartilhada,conv.id);
    assert.equal(JSON.parse((await api('/_ratoeira/api/notificacoes/lidas',ana,{method:'POST',body:{}})).texto).naoLidas,0);
    assert.equal(JSON.parse((await api('/_ratoeira/api/compartilhadas',ana)).texto).comigo[0].titulo,'Proposta da Acme');
    // o convidado chega no servidor do Beto, com o convite no cabeçalho; outra pessoa com o mesmo id, não
    const abre=(cookie,id)=>new Promise(ok=>{
      const ws=new WebSocket(`ws://127.0.0.1:${porta}/api/agentes/ws?convite=${id}`,{headers:{host,origin,cookie}});
      ws.on('message',d=>ok({ws,primeiro:String(d)}));ws.on('unexpected-response',(_q,res)=>{res.resume();ok({status:res.statusCode});});ws.on('error',()=>ok({status:'erro'}));
    });
    assert.equal((await abre(betoCookie,conv.id)).status,404);
    assert.equal((await abre(ana,'naoexisteessecodigo123')).status,404);
    // servidor do dono ainda na versão de antes (não sabe o que é convite): não liga o convidado
    assert.equal((await abre(ana,conv.id)).status,503);
    versaoNova=true;
    const w=await abre(ana,conv.id);
    assert.equal(w.primeiro,'agentes do beto');
    assert.deepEqual(quem,{email:'ana@x.com',nome:'Ana Souza',convite:{agente:'claude',sessao:'s1',cwd:'/srv/t',modo:'ler'}});
    // o próprio Beto chega no dele com o nome, sem convite
    const meu=await new Promise(ok=>{const ws=new WebSocket(`ws://127.0.0.1:${porta}/api/agentes/ws`,{headers:{host,origin,cookie:betoCookie}});ws.on('message',()=>ok(ws));});
    assert.deepEqual(quem,{email:'beto@x.com',nome:'Beto'});meu.close();
    // nota da Ana vai pro sino do Beto (pela conversa); duas seguidas viram um aviso só; nota do Beto vai pro da Ana (pelo convite)
    assert.equal(JSON.parse((await api('/_ratoeira/api/compartilhadas/atividade',ana,{method:'POST',body:{convite:conv.id,tipo:'nota',texto:'acho caro'}})).texto).avisados,1);
    await api('/_ratoeira/api/compartilhadas/atividade',ana,{method:'POST',body:{convite:conv.id,tipo:'nota',texto:'bem caro'}});
    const doBeto=JSON.parse((await api('/_ratoeira/api/notificacoes',betoCookie)).texto);
    assert.equal(doBeto.naoLidas,1);assert.equal(doBeto.itens[0].texto,'bem caro');assert.deepEqual(doBeto.itens[0].conversa,{agente:'claude',sessao:'s1'});
    await api('/_ratoeira/api/compartilhadas/atividade',betoCookie,{method:'POST',body:{agente:'claude',sessao:'s1',tipo:'mensagem',texto:'baixa pra 20k'}});
    assert.equal(JSON.parse((await api('/_ratoeira/api/notificacoes',ana)).texto).itens[0].compartilhada,conv.id);
    // marcada com @: a Ana recebe "te marcou" no lugar de "mandou mensagem"
    await api('/_ratoeira/api/compartilhadas/atividade',betoCookie,{method:'POST',body:{agente:'claude',sessao:'s1',tipo:'mensagem',texto:'@Ana Souza olha isso',mencionados:['ana@x.com']}});
    assert.equal(JSON.parse((await api('/_ratoeira/api/notificacoes',ana)).texto).itens[0].tipo,'mencao');
    // conversa que não é compartilhada, ou tipo inventado: nada
    assert.equal((await api('/_ratoeira/api/compartilhadas/atividade',betoCookie,{method:'POST',body:{agente:'claude',sessao:'outra',tipo:'nota',texto:'x'}})).status,404);
    assert.equal((await api('/_ratoeira/api/compartilhadas/atividade',ana,{method:'POST',body:{convite:conv.id,tipo:'spam',texto:'x'}})).status,400);
    // tirar o acesso derruba o convidado na hora e avisa o servidor do dono
    const caiu=new Promise(ok=>w.ws.on('close',ok));
    assert.equal((await api('/_ratoeira/api/compartilhadas/remover',ana,{method:'POST',body:{id:'outro'}})).status,404);
    assert.equal((await api('/_ratoeira/api/compartilhadas/remover',betoCookie,{method:'POST',body:{id:conv.id}})).status,200);
    await caiu;
    for(let i=0;i<50&&avisos.length<2;i++)await new Promise(ok=>setTimeout(ok,20));
    assert.deepEqual(avisos[1].corpo,{agente:'claude',sessao:'s1',ligar:false});
    assert.equal((await abre(ana,conv.id)).status,404);
    assert.equal(JSON.parse((await api('/_ratoeira/api/notificacoes',ana)).texto).itens.length,0);
  }finally{for(const c of wss.clients)c.terminate();wss.close();ag.closeAllConnections();await new Promise(r=>ag.close(r));}
});

test('aviso no aparelho: convite, agente terminou e esperando chegam por push pra quem não estava vendo',async()=>{
  // service worker sem login, como o manifesto
  const sw=await pedir('/sw.js');assert.equal(sw.status,200);assert.match(sw.texto,/showNotification/);
  // número no ícone e tela sem conexão só na navegação da janela, sem cache
  assert.match(sw.texto,/setAppBadge/);assert.match(sw.texto,/r\.mode!=='navigate'/);assert.match(sw.texto,/Sem conexão/);assert.ok(!/caches\./.test(sw.texto));
  const ana=cookieDe(await postForm('/_ratoeira/entrar',{email:'ana@x.com',senha:SENHA}));
  const beto=cookieDe(await postForm('/_ratoeira/entrar',{email:'beto@x.com',senha:SENHA}));
  const sino=JSON.parse((await api('/_ratoeira/api/notificacoes',ana)).texto);assert.match(sino.push.chave,/^[A-Za-z0-9_-]{80,}$/);
  const assinatura=e=>({endpoint:'https://push.example/'+e,keys:{p256dh:'B'.repeat(87),auth:'a'.repeat(22)}});
  assert.equal((await api('/_ratoeira/api/notificacoes/push',ana,{method:'POST',body:{assinatura:{endpoint:'http://inseguro'},aparelho:'x'}})).status,400);
  assert.equal((await api('/_ratoeira/api/notificacoes/push',ana,{method:'POST',body:{assinatura:assinatura('ana-celular'),aparelho:'celular'}})).status,200);
  await api('/_ratoeira/api/notificacoes/push',beto,{method:'POST',body:{assinatura:assinatura('beto-morta'),aparelho:'celular'}});
  // servidor de agentes do Beto, de mentira: responde os avisos que a gente for pondo
  const avisos=[];
  const ag=http.createServer((req,res)=>{const m=req.url.match(/^\/avisos\?desde=(\d+)/);res.setHeader('content-type','application/json');
    if(m)return res.end(JSON.stringify({inicio:'i1',seq:avisos.length,avisos:avisos.filter(a=>a.seq>Number(m[1]))}));
    if(req.url==='/estado')return res.end(JSON.stringify({recursos:['convite','avisos']}));req.resume();res.end('{}');});
  await new Promise(r=>ag.listen(path.join(dir,'agentes-beto.sock'),r));
  try{
    enviados.length=0;
    const conv=JSON.parse((await api('/_ratoeira/api/compartilhadas',beto,{method:'POST',body:{email:'ana@x.com',agente:'claude',sessao:'s2',cwd:'/srv/t',titulo:'Plano de mídia',modo:'entrar'}})).texto);
    // o convite chegou no celular da Ana, com o link que abre a conversa
    const conviteAna=enviados.find(e=>e.sub.endpoint.endsWith('ana-celular'));
    assert.match(conviteAna.carga.titulo,/Beto compartilhou/);assert.equal(conviteAna.carga.url,'/portal/?abrir='+encodeURIComponent('cp:'+conv.id)+'#arquivos');
    await gateway.lerAvisos();   // primeira leitura: só marca onde está
    enviados.length=0;
    avisos.push({seq:1,tipo:'terminou',agente:'claude',sessao:'s2',titulo:'Plano de mídia',vendo:['beto@x.com'],compartilhada:true});
    await gateway.lerAvisos();
    assert.deepEqual(enviados.map(e=>e.sub.endpoint),['https://push.example/ana-celular']);
    assert.equal(enviados[0].carga.titulo,'Plano de mídia');assert.equal(enviados[0].carga.corpo,'O agente terminou.');
    // o número do ícone vai junto: o convite e este, os dois ainda não lidos
    assert.equal(enviados[0].carga.naoLidas,2);
    assert.equal(JSON.parse((await api('/_ratoeira/api/notificacoes',ana)).texto).itens[0].tipo,'terminou');
    // esperando: só o dono (ele é quem aprova), e a assinatura morta (410) sai da lista
    enviados.length=0;
    avisos.push({seq:2,tipo:'esperando',agente:'claude',sessao:'s2',titulo:'Plano de mídia',vendo:[],compartilhada:true});
    await gateway.lerAvisos();
    assert.deepEqual(enviados.map(e=>e.sub.endpoint),['https://push.example/beto-morta']);
    assert.equal(JSON.parse((await api('/_ratoeira/api/notificacoes',beto)).texto).push.aparelhos,0);
    assert.equal(JSON.parse((await api('/_ratoeira/api/notificacoes',beto)).texto).itens[0].tipo,'esperando');
    // conversa só do Beto, ninguém vendo: aviso pra ele, pela conversa
    avisos.push({seq:3,tipo:'terminou',agente:'codex',sessao:'s9',titulo:'Relatório',vendo:[],compartilhada:false});
    await gateway.lerAvisos();
    assert.deepEqual(JSON.parse((await api('/_ratoeira/api/notificacoes',beto)).texto).itens[0].conversa,{agente:'codex',sessao:'s9'});
    // rotina: só pro dono, mesmo numa conversa compartilhada; cada execução é um aviso novo, com o que ela pediu
    await api('/_ratoeira/api/notificacoes/push',beto,{method:'POST',body:{assinatura:assinatura('beto-novo'),aparelho:'celular'}});
    enviados.length=0;
    avisos.push({seq:4,tipo:'rotina',motivo:'chama',rotina:'Leads da semana',texto:'aprovo os 3 e-mails?',agente:'claude',sessao:'s2',titulo:'Rotina: Leads',vendo:[],compartilhada:false});
    avisos.push({seq:5,tipo:'rotina',motivo:'falhou',rotina:'Backup',texto:'pasta não existe',agente:null,sessao:null,vendo:[],compartilhada:false});
    await gateway.lerAvisos();
    assert.deepEqual(enviados.map(e=>e.sub.endpoint),['https://push.example/beto-novo','https://push.example/beto-novo']);
    assert.equal(enviados[0].carga.titulo,'A rotina “Leads da semana” quer falar contigo');assert.equal(enviados[0].carga.corpo,'aprovo os 3 e-mails?');
    assert.equal(enviados[0].carga.url,'/portal/?abrir='+encodeURIComponent('claude:s2')+'#arquivos');
    assert.equal(enviados[1].carga.titulo,'A rotina “Backup” falhou');assert.equal(enviados[1].carga.url,'/portal/#automacoes');
    const [falhou,chama]=JSON.parse((await api('/_ratoeira/api/notificacoes',beto)).texto).itens;
    assert.equal(chama.motivo,'chama');assert.deepEqual(chama.conversa,{agente:'claude',sessao:'s2'});assert.equal(falhou.conversa,undefined);
    assert.ok(!JSON.parse((await api('/_ratoeira/api/notificacoes',ana)).texto).itens.some(n=>n.tipo==='rotina'));
    await api('/_ratoeira/api/compartilhadas/remover',beto,{method:'POST',body:{id:conv.id}});
  }finally{ag.closeAllConnections();await new Promise(r=>ag.close(r));}
});

test('sair apaga o cookie e encerra a sessão',async()=>{
  const outra=cookieDe(await postForm('/_ratoeira/entrar',{email:'caio@x.com',senha:SENHA}));
  assert.equal((await pedir('/_ratoeira/sair',{method:'POST',headers:{cookie:outra}})).status,403);   // sem origem
  const r=await pedir('/_ratoeira/sair',{method:'POST',headers:{cookie:outra,origin}});
  assert.equal(r.status,303);assert.match(r.headers['set-cookie'][0],/Max-Age=0/);
  assert.equal((await api('/_ratoeira/api/portal',outra)).status,401);
  assert.equal((await api('/_ratoeira/api/portal',admin)).status,200);
});

test('config: senha não aceita users, paseoCompartilhado nem restrictTo',()=>{
  for(const extra of [{users:{'a@x.com':'a'}},{paseoCompartilhado:['a@x.com']},{restrictTo:{}}])
    assert.throws(()=>createGateway({hostname:host,access:{mode:'senha'},contas,...extra}));
  assert.throws(()=>createGateway({hostname:host,access:{mode:'senha'}}));
});

test('contas do Claude da organização: só admin mexe, token validado, e nunca volta pela tela',async()=>{
  const TOKEN='sk-ant-oat01-'+'y'.repeat(50);
  assert.deepEqual(JSON.parse((await api('/_ratoeira/api/claude-contas',admin)).texto).contas,[]);
  assert.equal((await api('/_ratoeira/api/claude-contas/token',admin,{method:'POST',body:{nome:'Max',token:'sk-ant-api03-nao'}})).status,400);
  const r=await api('/_ratoeira/api/claude-contas/token',admin,{method:'POST',body:{nome:'Max',token:TOKEN}});
  assert.equal(r.status,200);const [c]=JSON.parse(r.texto).contas;assert.equal(c.nome,'Max');
  const tela=(await api('/_ratoeira/api/claude-contas',admin)).texto+(await api('/_ratoeira/api/pessoas',admin)).texto;
  assert.ok(!tela.includes(TOKEN));
  assert.equal(JSON.parse((await api(`/_ratoeira/api/claude-contas/${c.id}/editar`,admin,{method:'POST',body:{nome:'Max 1'}})).texto).contas[0].nome,'Max 1');
  // sem CLI do Claude pro gateway nesta config: gerar pelo fluxo é recusado com orientação
  assert.equal((await api('/_ratoeira/api/claude-contas/start',admin,{method:'POST',body:{nome:'X'}})).status,400);
  const outro=cookieDe(await postForm('/_ratoeira/entrar',{email:'caio@x.com',senha:SENHA}));
  await api(`/_ratoeira/api/claude-contas/${c.id}/remover`,outro,{method:'POST',body:{}});
  assert.deepEqual(JSON.parse((await api('/_ratoeira/api/claude-contas',admin)).texto).contas,[]);
});

import {writeFile} from 'node:fs/promises';
import {createHmac} from 'node:crypto';
test('identidade assinada pro app (contrato): assinatura, papel, validade, e o navegador não forja',async t=>{
  const seg=path.join(dir,'sistema.segredo');await writeFile(seg,'s'.repeat(48)+'\n',{mode:0o600});
  let visto;const app2=http.createServer((req,res)=>{visto=req.headers;res.end('ok');});
  await new Promise(r=>app2.listen(0,'127.0.0.1',r));
  const g=createGateway({hostname:host,access:{mode:'senha'},contas,apps:[{prefix:'/sistema',port:app2.address().port,segredo:seg,public:['/p/']}]});
  await new Promise(r=>g.listen(0,'127.0.0.1',r));
  t.after(()=>{g.closeAllConnections();g.close();app2.close();});
  const pedir2=(caminho,headers)=>new Promise((ok,erro)=>{const q=http.request({host:'127.0.0.1',port:g.address().port,path:caminho,headers:{host,...headers}},r=>{r.resume();r.on('end',()=>ok(r.statusCode));});q.on('error',erro);q.end();});
  assert.equal(await pedir2('/sistema/x',{cookie:admin,'x-ratoeira-identidade':'forjado.forjado'}),200);
  const [payload,assinatura]=visto['x-ratoeira-identidade'].split('.');
  assert.equal(assinatura,createHmac('sha256','s'.repeat(48)).update(payload).digest('base64url'));
  const dadosId=JSON.parse(Buffer.from(payload,'base64url').toString());
  assert.equal(dadosId.email,'caio@x.com');assert.equal(dadosId.nome,'Caio');assert.equal(dadosId.app,'/sistema');assert.equal(dadosId.papel,'admin');
  assert.ok(dadosId.exp>Date.now()/1000&&dadosId.exp<=Date.now()/1000+61);
  // caio não tem ambiente nesta config: sem usuário Linux no cabeçalho
  assert.equal(dadosId.usuario,undefined);assert.equal(dadosId.uid,undefined);
  // link público: sem login e sem identidade, mesmo que o navegador mande uma
  assert.equal(await pedir2('/sistema/p/abc',{'x-ratoeira-identidade':'forjado.forjado'}),200);
  assert.equal(visto['x-ratoeira-identidade'],undefined);
  assert.throws(()=>createGateway({hostname:host,access:{mode:'senha'},contas,apps:[{prefix:'/sistema',port:1,segredo:'relativo.segredo'}]}));
});

import {createHash} from 'node:crypto';
test('chat ligado ao app: o gateway emite o token, guarda a mensagem e repassa o MCP com a identidade assinada',async t=>{
  const seg=path.join(dir,'sistema-chat.segredo');await writeFile(seg,'c'.repeat(48)+'\n',{mode:0o600});
  let visto,caminho,corpo;const app3=http.createServer((req,res)=>{visto=req.headers;caminho=req.url;let d='';req.on('data',c=>d+=c);req.on('end',()=>{corpo=d;res.setHeader('content-type','application/json');res.end('{"jsonrpc":"2.0","id":1,"result":{}}');});});
  await new Promise(r=>app3.listen(0,'127.0.0.1',r));
  const g=createGateway({hostname:host,access:{mode:'senha',port:6768},contas,apps:[{prefix:'/sistema',port:app3.address().port,segredo:seg,chat:{mcp:'/mcp',pastaAgente:'/opt/ratoeira/apps/sistema/codigo/agente'}},{prefix:'/outro',port:1}]});
  await new Promise(r=>g.listen(0,'127.0.0.1',r));
  t.after(()=>{g.closeAllConnections();g.close();app3.close();});
  const ir=(caminho2,{method='POST',headers={},body}={})=>new Promise((ok,erro)=>{const q=http.request({host:'127.0.0.1',port:g.address().port,path:caminho2,method,headers:{host,...headers}},r=>{let x='';r.setEncoding('utf8');r.on('data',c=>x+=c);r.on('end',()=>ok({status:r.statusCode,json:(()=>{try{return JSON.parse(x);}catch{return null;}})()}));});q.on('error',erro);if(body)q.write(typeof body==='string'?body:JSON.stringify(body));q.end();});
  const logado={cookie:admin,origin,'content-type':'application/json'};
  // ligar: só app com chat.mcp, e só logado
  assert.equal((await ir('/_ratoeira/api/chat/ligar',{headers:{origin,'content-type':'application/json'},body:{app:'/sistema/'}})).status,401);
  assert.equal((await ir('/_ratoeira/api/chat/ligar',{headers:logado,body:{app:'/outro/'}})).status,404);
  const l=await ir('/_ratoeira/api/chat/ligar',{headers:logado,body:{app:'/sistema/'}});
  assert.equal(l.status,200);assert.equal(l.json.mcp[0].url,'http://127.0.0.1:6768/_ratoeira/mcp/sistema');
  // a pasta com o AGENTS.md do app (chat.agente do manifesto, gravada pelo publicar-app) vai junto
  assert.equal(l.json.pasta,'/opt/ratoeira/apps/sistema/codigo/agente');
  const token=l.json.mcp[0].headers[0].value.slice(7),chave=l.json.chave;
  // MCP: sem token, com token errado ou vindo pelo túnel, não passa
  const rpc='{"jsonrpc":"2.0","id":1,"method":"tools/list"}';
  assert.equal((await ir('/_ratoeira/mcp/sistema',{headers:{'content-type':'application/json'},body:rpc})).status,401);
  assert.equal((await ir('/_ratoeira/mcp/sistema',{headers:{'content-type':'application/json',authorization:'Bearer errado'},body:rpc})).status,401);
  assert.equal((await ir('/_ratoeira/mcp/sistema',{headers:{'content-type':'application/json',authorization:'Bearer '+token,'x-forwarded-for':'1.2.3.4'},body:rpc})).status,404);
  // mensagem: chave de outra pessoa ou vencida dá 404; a conversa fica presa na primeira
  assert.equal((await ir('/_ratoeira/api/chat/mensagem',{headers:logado,body:{chave:'nao',conversa:'s1',mensagem:'oi'}})).status,404);
  assert.equal((await ir('/_ratoeira/api/chat/mensagem',{headers:logado,body:{chave,conversa:'s1',mensagem:'pode mandar'}})).status,200);
  assert.equal((await ir('/_ratoeira/api/chat/mensagem',{headers:logado,body:{chave,conversa:'s2',mensagem:'x'}})).status,400);
  // MCP com token: vai pro caminho do app, com identidade assinada (via chat, conversa, hash da mensagem) e a mensagem
  const r=await ir('/_ratoeira/mcp/sistema',{headers:{'content-type':'application/json',authorization:'Bearer '+token},body:rpc});
  assert.equal(r.status,200);assert.equal(caminho,'/sistema/mcp');assert.equal(corpo,rpc);assert.equal(visto.authorization,undefined);
  const [payload,assinatura]=visto['x-ratoeira-identidade'].split('.');
  assert.equal(assinatura,createHmac('sha256','c'.repeat(48)).update(payload).digest('base64url'));
  const id=JSON.parse(Buffer.from(payload,'base64url').toString());
  assert.equal(id.via,'chat');assert.equal(id.conversa,'s1');assert.equal(id.papel,'admin');assert.ok(id.mensagem_em>0);
  assert.equal(id.mensagem_sha,createHash('sha256').update('pode mandar').digest('hex').slice(0,32));
  assert.equal(Buffer.from(visto['x-ratoeira-mensagem'],'base64url').toString(),'pode mandar');
});

test('uid do usuário Linux vem do /etc/passwd',()=>{
  const passwd='root:x:0:0::/root:/bin/sh\nana:x:1001:1001::/home/ana:/bin/bash\n';
  assert.equal(uidDoSistema('ana-teste-uid',()=>passwd.replace('ana:','ana-teste-uid:')),1001);
  assert.equal(uidDoSistema('ninguem-teste-uid',()=>passwd),null);
});

test('MCP da própria Ratoeira: só admin, publica pelo publicador e o token sobrevive a reiniciar o gateway',async t=>{
  const pedidos=[];let estado=null;
  const publicador={
    listar:async()=>[{nome:'pedidos',area:'time',titulo:'Pedidos',noAr:false,naConfigPrincipal:false,ultimo:estado}],
    estado:async()=>estado,
    publicar:async(p,por)=>{pedidos.push({...p,por});estado={estado:'ok',versao:'abc123 2026-10-09 '+por,faltamChaves:['ERP_TOKEN']};return {estado:'publicando'};},
  };
  const arq=path.join(dir,'chat-ligacoes.json');
  const subir=async()=>{const g=createGateway({hostname:host,access:{mode:'senha',port:6768},contas,publicador,ligacoesArquivo:arq});await new Promise(r=>g.listen(0,'127.0.0.1',r));t.after(()=>{g.closeAllConnections();g.close();});return g;};
  let g=await subir();
  const ir=(gw,caminho2,{headers={},body}={})=>new Promise((ok,erro)=>{const q=http.request({host:'127.0.0.1',port:gw.address().port,path:caminho2,method:'POST',headers:{host,...headers}},r=>{let x='';r.setEncoding('utf8');r.on('data',c=>x+=c);r.on('end',()=>ok({status:r.statusCode,json:(()=>{try{return JSON.parse(x);}catch{return null;}})()}));});q.on('error',erro);if(body)q.write(JSON.stringify(body));q.end();});
  // quem não é admin não ganha as ferramentas
  assert.ok([401,403].includes((await ir(g,'/_ratoeira/api/chat/ligar',{headers:{cookie:anaCookie,origin,'content-type':'application/json'},body:{app:'ratoeira'}})).status));
  const l=await ir(g,'/_ratoeira/api/chat/ligar',{headers:{cookie:admin,origin,'content-type':'application/json'},body:{app:'ratoeira'}});
  assert.equal(l.status,200);assert.equal(l.json.mcp[0].name,'ratoeira');assert.equal(l.json.mcp[0].url,'http://127.0.0.1:6768/_ratoeira/mcp/_ratoeira');
  const auth={'content-type':'application/json',authorization:l.json.mcp[0].headers[0].value};
  const rpc=(method,params)=>({jsonrpc:'2.0',id:1,method,params});
  assert.equal((await ir(g,'/_ratoeira/mcp/_ratoeira',{headers:{'content-type':'application/json',authorization:'Bearer errado'},body:rpc('tools/list')})).status,401);
  assert.equal((await ir(g,'/_ratoeira/mcp/_ratoeira',{headers:{...auth,'x-forwarded-for':'1.2.3.4'},body:rpc('tools/list')})).status,404);
  assert.equal((await ir(g,'/_ratoeira/mcp/_ratoeira',{headers:auth,body:rpc('initialize',{protocolVersion:'2025-06-18'})})).json.result.serverInfo.name,'ratoeira');
  assert.deepEqual((await ir(g,'/_ratoeira/mcp/_ratoeira',{headers:auth,body:rpc('tools/list')})).json.result.tools.map(x=>x.name),['listar_apps','publicar_app','definir_chaves_app','estado_publicacao']);
  // reinicia o gateway: o mesmo token segue valendo (ligações no disco)
  g.closeAllConnections();g.close();g=await subir();
  const p=await ir(g,'/_ratoeira/mcp/_ratoeira',{headers:auth,body:rpc('tools/call',{name:'publicar_app',arguments:{nome:'pedidos'}})});
  assert.equal(p.json.result.isError,false);assert.match(p.json.result.content[0].text,/no ar \(abc123[\s\S]*ERP_TOKEN/);
  assert.deepEqual(pedidos,[{area:'time',nome:'pedidos',chavesDe:null,por:'caio@x.com'}]);
  // definir_chaves_app precisa de usuário próprio (de onde o ajudante lê o arquivo de chaves); o admin daqui não tem
  const k=await ir(g,'/_ratoeira/mcp/_ratoeira',{headers:auth,body:rpc('tools/call',{name:'definir_chaves_app',arguments:{nome:'pedidos'}})});
  assert.equal(k.json.result.isError,true);assert.match(k.json.result.content[0].text,/usuário próprio/);assert.equal(pedidos.length,1);
  const n=await ir(g,'/_ratoeira/mcp/_ratoeira',{headers:auth,body:rpc('tools/call',{name:'publicar_app',arguments:{nome:'inventado'}})});
  assert.equal(n.json.result.isError,true);
  // a notificação não tem resposta
  assert.equal((await ir(g,'/_ratoeira/mcp/_ratoeira',{headers:auth,body:{jsonrpc:'2.0',method:'notifications/initialized'}})).status,202);
});

test('MCP da própria Ratoeira: publicar o core aparece só com o core ligado e só nas partes liberadas',async t=>{
  const pedidos=[];let est={parte:'telas',descricao:'telas do portal',noAr:null,repo:{commit:'abc tela nova',semCommit:[]},publicando:null,ultimo:null};
  const core={partes:['telas','gateway'],
    estado:async()=>est,estados:async()=>[est],
    publicar:async(parte,por)=>{pedidos.push({parte,por});est={...est,noAr:{commit:'abc tela nova',em:'agora',por},ultimo:{ok:true,em:'agora',erro:null,log:[]}};return {estado:'publicando'};}};
  const g=createGateway({hostname:host,access:{mode:'senha',port:6768},contas,core});
  await new Promise(r=>g.listen(0,'127.0.0.1',r));t.after(()=>{g.closeAllConnections();g.close();});
  const ir=(caminho2,{headers={},body}={})=>new Promise((ok,erro)=>{const q=http.request({host:'127.0.0.1',port:g.address().port,path:caminho2,method:'POST',headers:{host,...headers}},r=>{let x='';r.setEncoding('utf8');r.on('data',c=>x+=c);r.on('end',()=>ok({status:r.statusCode,json:(()=>{try{return JSON.parse(x);}catch{return null;}})()}));});q.on('error',erro);if(body)q.write(JSON.stringify(body));q.end();});
  assert.ok([401,403].includes((await ir('/_ratoeira/api/chat/ligar',{headers:{cookie:anaCookie,origin,'content-type':'application/json'},body:{app:'ratoeira'}})).status));
  const l=await ir('/_ratoeira/api/chat/ligar',{headers:{cookie:admin,origin,'content-type':'application/json'},body:{app:'ratoeira'}});
  assert.equal(l.status,200);
  const auth={'content-type':'application/json',authorization:l.json.mcp[0].headers[0].value};
  const rpc=(method,params)=>({jsonrpc:'2.0',id:1,method,params});
  const tools=(await ir('/_ratoeira/mcp/_ratoeira',{headers:auth,body:rpc('tools/list')})).json.result.tools;
  // sem publicador, as ferramentas de app não aparecem
  assert.deepEqual(tools.map(x=>x.name),['estado_ratoeira','publicar_ratoeira']);
  assert.deepEqual(tools[1].inputSchema.properties.parte.enum,['telas','gateway']);
  assert.equal((await ir('/_ratoeira/mcp/_ratoeira',{headers:auth,body:rpc('tools/call',{name:'publicar_app',arguments:{nome:'x'}})})).json.result.isError,true);
  const p=await ir('/_ratoeira/mcp/_ratoeira',{headers:auth,body:rpc('tools/call',{name:'publicar_ratoeira',arguments:{parte:'telas'}})});
  assert.equal(p.json.result.isError,false);assert.match(p.json.result.content[0].text,/última publicação: ok/);
  // gateway: não espera (o gateway reinicia no meio)
  const gw=await ir('/_ratoeira/mcp/_ratoeira',{headers:auth,body:rpc('tools/call',{name:'publicar_ratoeira',arguments:{parte:'gateway'}})});
  assert.match(gw.json.result.content[0].text,/estado_ratoeira daqui a 2 minutos/);
  assert.deepEqual(pedidos,[{parte:'telas',por:'caio@x.com'},{parte:'gateway',por:'caio@x.com'}]);
  const e=await ir('/_ratoeira/mcp/_ratoeira',{headers:auth,body:rpc('tools/call',{name:'estado_ratoeira',arguments:{}})});
  assert.match(e.json.result.content[0].text,/## telas[\s\S]*no ar: abc tela nova/);
});

test('MCP da própria Ratoeira: com core.quem, só quem está na lista mexe no núcleo; o resto do admin segue',async t=>{
  const pedidos=[];
  const core={partes:['telas','pacotes'],estados:async()=>[],estado:async parte=>({parte,publicando:null,ultimo:null}),
    publicar:async(parte,por)=>{pedidos.push({parte,por});return {estado:'publicando'};}};
  const publicador={listar:async()=>[],estado:async()=>null,publicar:async()=>({})};
  const sobe=async nucleoQuem=>{const g=createGateway({hostname:host,access:{mode:'senha',port:6768},contas,core,publicador,nucleoQuem});
    await new Promise(r=>g.listen(0,'127.0.0.1',r));t.after(()=>{g.closeAllConnections();g.close();});return g;};
  const ir=(g,caminho2,body,headers={})=>new Promise((ok,erro)=>{const q=http.request({host:'127.0.0.1',port:g.address().port,path:caminho2,method:'POST',headers:{host,'content-type':'application/json',...headers}},r=>{let x='';r.setEncoding('utf8');r.on('data',c=>x+=c);r.on('end',()=>ok(JSON.parse(x)));});q.on('error',erro);q.write(JSON.stringify(body));q.end();});
  const rpc=(method,params)=>({jsonrpc:'2.0',id:1,method,params});
  const ferramentas=async g=>{const l=await ir(g,'/_ratoeira/api/chat/ligar',{app:'ratoeira'},{cookie:admin,origin});const auth={authorization:l.mcp[0].headers[0].value};
    return {auth,nomes:(await ir(g,'/_ratoeira/mcp/_ratoeira',rpc('tools/list'),auth)).result.tools.map(x=>x.name)};};
  // admin fora da lista: publica app e vê o estado, mas não publica o núcleo nem instala pacote
  const fora=await sobe(['outra@x.com']);
  const f=await ferramentas(fora);
  assert.deepEqual(f.nomes,['listar_apps','publicar_app','definir_chaves_app','estado_publicacao','estado_ratoeira']);
  const recusa=await ir(fora,'/_ratoeira/mcp/_ratoeira',rpc('tools/call',{name:'publicar_ratoeira',arguments:{parte:'telas'}}),f.auth);
  assert.equal(recusa.result.isError,true);assert.match(recusa.result.content[0].text,/só é publicado por outra@x\.com/);
  assert.equal((await ir(fora,'/_ratoeira/mcp/_ratoeira',rpc('tools/call',{name:'instalar_pacotes',arguments:{pacotes:['ffmpeg']}}),f.auth)).result.isError,true);
  assert.deepEqual(pedidos,[]);
  // na lista (sem diferença de maiúscula): tudo
  const dentro=await sobe(['CAIO@x.com']);
  const d=await ferramentas(dentro);
  assert.deepEqual(d.nomes,['listar_apps','publicar_app','definir_chaves_app','estado_publicacao','estado_ratoeira','publicar_ratoeira','instalar_pacotes']);
  await ir(dentro,'/_ratoeira/mcp/_ratoeira',rpc('tools/call',{name:'publicar_ratoeira',arguments:{parte:'telas'}}),d.auth);
  assert.deepEqual(pedidos,[{parte:'telas',por:'caio@x.com'}]);
});

test('MCP da própria Ratoeira: receita e pacotes viram ferramentas próprias, fora do publicar_ratoeira',async t=>{
  const pedidos=[];
  const core={partes:['telas','receita','pacotes'],estados:async()=>[],
    estado:async parte=>({parte,publicando:null,ultimo:{ok:true,em:'agora',log:['Chromium 140 ok']}}),
    publicar:async(parte,por,extra)=>{pedidos.push({parte,...extra});return {estado:'publicando'};}};
  const g=createGateway({hostname:host,access:{mode:'senha',port:6768},contas,core});
  await new Promise(r=>g.listen(0,'127.0.0.1',r));t.after(()=>{g.closeAllConnections();g.close();});
  const ir=(caminho2,body,headers={})=>new Promise((ok,erro)=>{const q=http.request({host:'127.0.0.1',port:g.address().port,path:caminho2,method:'POST',headers:{host,'content-type':'application/json',...headers}},r=>{let x='';r.setEncoding('utf8');r.on('data',c=>x+=c);r.on('end',()=>ok(JSON.parse(x)));});q.on('error',erro);q.write(JSON.stringify(body));q.end();});
  const l=await ir('/_ratoeira/api/chat/ligar',{app:'ratoeira'},{cookie:admin,origin});
  const auth={authorization:l.mcp[0].headers[0].value};
  const rpc=(method,params)=>({jsonrpc:'2.0',id:1,method,params});
  const tools=(await ir('/_ratoeira/mcp/_ratoeira',rpc('tools/list'),auth)).result.tools;
  assert.deepEqual(tools.map(x=>x.name),['estado_ratoeira','publicar_ratoeira','rodar_receita','instalar_pacotes']);
  assert.deepEqual(tools[1].inputSchema.properties.parte.enum,['telas']);
  assert.equal((await ir('/_ratoeira/mcp/_ratoeira',rpc('tools/call',{name:'publicar_ratoeira',arguments:{parte:'receita'}}),auth)).result.isError,true);
  const r=await ir('/_ratoeira/mcp/_ratoeira',rpc('tools/call',{name:'rodar_receita',arguments:{nome:'playwright',args:['1.62.0']}}),auth);
  assert.match(r.result.content[0].text,/receita: ok[\s\S]*Chromium 140 ok/);
  await ir('/_ratoeira/mcp/_ratoeira',rpc('tools/call',{name:'instalar_pacotes',arguments:{pacotes:['ffmpeg']}}),auth);
  assert.deepEqual(pedidos,[{parte:'receita',receita:'playwright',args:['1.62.0']},{parte:'pacotes',pacotes:['ffmpeg']}]);
});

test('MCP da própria Ratoeira: atualizar_ratoeira e o estado da versão só com "atualizar", sem partes publicáveis',async t=>{
  const pedidos=[];let pedido=null;
  const atualizacoes={
    estado:async()=>({noAr:{versao:'0.5.0',em:'2026-10-10T12:00:00Z',por:'terminal'},anterior:{versao:'0.4.2'},canal:'beta',verificadoEm:'2026-10-16T09:00:00Z',
      disponivel:{versao:'0.6.0',nova:true,mudancas:[{versao:'0.6.0',titulo:'0.6.0 (2026-10-16)',texto:'- Tela de Atualizações'}]},
      ultima:null,resultado:pedido?null:{ok:true,acao:'verificar',em:'agora',log:['em dia']},pedido}),
    pedir:async(p,por)=>{if(!['verificar','aplicar','voltar'].includes(p.acao))throw Object.assign(new Error('Ação inválida: use verificar, aplicar, voltar.'),{status:400});pedidos.push({...p,por});if(p.acao!=='verificar')pedido={acao:p.acao,desde:'agora'};return {estado:'pedido'};}};
  // instalação: core sem partes (main.mjs nem monta) e publicador ligado
  const publicador={listar:async()=>[],estado:async()=>null,publicar:async()=>({})};
  const subir=async extra=>{const g=createGateway({hostname:host,access:{mode:'senha',port:6768},contas,publicador,...extra});await new Promise(r=>g.listen(0,'127.0.0.1',r));t.after(()=>{g.closeAllConnections();g.close();});return g;};
  const ir=(g,caminho2,body,headers={})=>new Promise((ok,erro)=>{const q=http.request({host:'127.0.0.1',port:g.address().port,path:caminho2,method:'POST',headers:{host,'content-type':'application/json',...headers}},r=>{let x='';r.setEncoding('utf8');r.on('data',c=>x+=c);r.on('end',()=>ok({status:r.statusCode,json:(()=>{try{return JSON.parse(x);}catch{return null;}})()}));});q.on('error',erro);q.write(JSON.stringify(body));q.end();});
  const rpc=(method,params)=>({jsonrpc:'2.0',id:1,method,params});
  // sem "atualizar": nem a ferramenta nem o estado aparecem
  const g0=await subir({});
  const l0=await ir(g0,'/_ratoeira/api/chat/ligar',{app:'ratoeira'},{cookie:admin,origin});
  assert.deepEqual((await ir(g0,'/_ratoeira/mcp/_ratoeira',rpc('tools/list'),{authorization:l0.json.mcp[0].headers[0].value})).json.result.tools.map(x=>x.name),['listar_apps','publicar_app','definir_chaves_app','estado_publicacao']);
  // com "atualizar"
  const g=await subir({atualizacoes});
  assert.ok([401,403].includes((await ir(g,'/_ratoeira/api/chat/ligar',{app:'ratoeira'},{cookie:anaCookie,origin})).status));
  const l=await ir(g,'/_ratoeira/api/chat/ligar',{app:'ratoeira'},{cookie:admin,origin});
  const auth={authorization:l.json.mcp[0].headers[0].value};
  const tools=(await ir(g,'/_ratoeira/mcp/_ratoeira',rpc('tools/list'),auth)).json.result.tools;
  assert.deepEqual(tools.map(x=>x.name),['listar_apps','publicar_app','definir_chaves_app','estado_publicacao','estado_ratoeira','atualizar_ratoeira']);
  const at=tools.find(x=>x.name==='atualizar_ratoeira');
  assert.deepEqual(at.inputSchema.properties.acao.enum,['conectar','verificar','aplicar','voltar']);
  assert.match(at.description,/ok explícito/);assert.match(at.description,/reiniciam o gateway/);assert.match(at.description,/estado_ratoeira/);
  assert.match((await ir(g,'/_ratoeira/mcp/_ratoeira',rpc('initialize',{}),auth)).json.result.instructions,/atualizar_ratoeira/);
  // estado sem partes publicáveis: só o bloco da versão, sem quebrar
  const e=await ir(g,'/_ratoeira/mcp/_ratoeira',rpc('tools/call',{name:'estado_ratoeira',arguments:{}}),auth);
  assert.equal(e.json.result.isError,false);
  assert.match(e.json.result.content[0].text,/no ar: 0\.5\.0[\s\S]*canal: beta[\s\S]*disponível: 0\.6\.0 \(nova\)[\s\S]*Tela de Atualizações[\s\S]*anterior \(pra voltar\): 0\.4\.2[\s\S]*último pedido: ok/);
  // verificar espera e devolve o estado; aplicar não espera (o gateway reinicia no meio)
  const v=await ir(g,'/_ratoeira/mcp/_ratoeira',rpc('tools/call',{name:'atualizar_ratoeira',arguments:{acao:'verificar'}}),auth);
  assert.match(v.json.result.content[0].text,/disponível: 0\.6\.0/);
  const a=await ir(g,'/_ratoeira/mcp/_ratoeira',rpc('tools/call',{name:'atualizar_ratoeira',arguments:{acao:'aplicar',versao:'0.6.0'}}),auth);
  assert.equal(a.json.result.isError,false);assert.match(a.json.result.content[0].text,/estado_ratoeira daqui a uns 3 minutos/);
  assert.match((await ir(g,'/_ratoeira/mcp/_ratoeira',rpc('tools/call',{name:'estado_ratoeira',arguments:{}}),auth)).json.result.content[0].text,/rodando agora: aplicar/);
  assert.equal((await ir(g,'/_ratoeira/mcp/_ratoeira',rpc('tools/call',{name:'atualizar_ratoeira',arguments:{acao:'apagar'}}),auth)).json.result.isError,true);
  assert.deepEqual(pedidos,[{acao:'verificar',versao:undefined,por:'caio@x.com'},{acao:'aplicar',versao:'0.6.0',por:'caio@x.com'}]);
});

test('com o Playground, subdomínio desconhecido ganha 404 (não a tela de login)',async()=>{
  const r=await new Promise((ok,erro)=>{http.get({host:'127.0.0.1',port:porta,path:'/',headers:{host:'qualquer.exemplo.com'}},res=>{res.resume();ok(res.statusCode);}).on('error',erro);});
  assert.equal(r,404);
  assert.notEqual((await pedir('/')).status,404);
});

test('ler outra conversa: o dono colar o link libera só pra ler; o agente lê com ler_conversa; link de outra pessoa não libera',async t=>{
  const criar=async(email,nome,usuario)=>{const p=JSON.parse((await api('/_ratoeira/api/pessoas',admin,{method:'POST',body:{email,nome,ambiente:true,usuario}})).texto);
    return cookieDe(await postForm(p.link,{email,nome,senha:SENHA,confirmar:SENHA}));};
  const gil=await criar('gil@x.com','Gil','gil'),dora=await criar('dora@x.com','Dora','dora');
  // servidor de agentes da Dora, de mentira: devolve o texto da conversa e guarda o que pediram
  const pedidos=[];
  const ag=http.createServer((req,res)=>{let d='';req.on('data',x=>d+=x);req.on('end',()=>{pedidos.push({url:req.url,corpo:JSON.parse(d||'{}')});
    res.end(req.url==='/ler-conversa'?JSON.stringify({titulo:'Landing',cwd:'/srv/t',estado:'livre',texto:'[Dora]: oi\n\n[Agente]: eco: oi',mensagens:1}):'{}');});});
  await new Promise(r=>ag.listen(path.join(dir,'agentes-dora.sock'),r));
  const g=createGateway({hostname:host,access:{mode:'senha',port:6768},contas,agentes:{socket:path.join(dir,'agentes-{user}.sock'),ligar:()=>{}},avisosCadaMs:0});
  await new Promise(r=>g.listen(0,'127.0.0.1',r));
  t.after(async()=>{g.closeAllConnections();g.close();ag.closeAllConnections();await new Promise(r=>ag.close(r));});
  const ir=(caminho2,{headers={},body,method='POST'}={})=>new Promise((ok,erro)=>{const q=http.request({host:'127.0.0.1',port:g.address().port,path:caminho2,method,headers:{host,...headers}},r=>{let x='';r.setEncoding('utf8');r.on('data',c=>x+=c);r.on('end',()=>ok({status:r.statusCode,json:(()=>{try{return JSON.parse(x);}catch{return null;}})()}));});q.on('error',erro);if(body)q.write(JSON.stringify(body));q.end();});
  const de=cookie=>({cookie,origin,'content-type':'application/json'});
  // o Gil compartilhou a conversa dele (destino) com a Dora, que entra; e outra só pra ler
  const destino=(await ir('/_ratoeira/api/compartilhadas',{headers:de(gil),body:{email:'dora@x.com',agente:'claude',sessao:'d1',cwd:'/srv/t',titulo:'Features',modo:'entrar'}})).json;
  const soLer=(await ir('/_ratoeira/api/compartilhadas',{headers:de(gil),body:{email:'dora@x.com',agente:'claude',sessao:'d2',cwd:'/srv/t',modo:'ler'}})).json;
  // quem não é admin ganha só a ferramenta de ler
  const l=await ir('/_ratoeira/api/chat/ligar',{headers:de(gil),body:{app:'ratoeira'}});
  assert.equal(l.status,200);
  const auth={'content-type':'application/json',authorization:l.json.mcp[0].headers[0].value};
  const rpc=(method,params)=>({jsonrpc:'2.0',id:1,method,params});
  assert.deepEqual((await ir('/_ratoeira/mcp/_ratoeira',{headers:auth,body:rpc('tools/list')})).json.result.tools.map(x=>x.name),['ler_conversa']);
  const ler=async link=>(await ir('/_ratoeira/mcp/_ratoeira',{headers:auth,body:rpc('tools/call',{name:'ler_conversa',arguments:{link}})})).json.result;
  const link='https://'+host+'/portal/?chat=claude%3Al1&de=dora%40x.com#arquivos';
  // ainda não compartilhada com o Gil: recusa e diz o caminho
  let r=await ler(link);assert.equal(r.isError,true);assert.match(r.content[0].text,/Dora cola o link numa conversa de Gil/);
  assert.equal((await ler('https://outro.site/qualquer')).isError,true);
  // o Gil colar o link da Dora não libera nada (não foi ela que mandou)
  assert.deepEqual((await ir('/_ratoeira/api/compartilhadas/por-link',{headers:de(gil),body:{link,convite:destino.id,cwd:'/srv/t'}})).json,{liberada:false});
  // a Dora cola numa conversa em que só lê: não vale
  assert.equal((await ir('/_ratoeira/api/compartilhadas/por-link',{headers:de(dora),body:{link,convite:soLer.id,cwd:'/srv/t'}})).status,404);
  // a Dora cola na conversa do Gil em que ela entra: fica compartilhada só pra ler com ele
  const lib=await ir('/_ratoeira/api/compartilhadas/por-link',{headers:de(dora),body:{link,convite:destino.id,cwd:'/srv/t',titulo:'Landing'}});
  assert.equal(lib.status,201);assert.equal(lib.json.para,'Gil');assert.equal(lib.json.modo,'ler');
  const comigo=(await ir('/_ratoeira/api/compartilhadas',{method:'GET',headers:{cookie:gil}})).json.comigo;
  assert.ok(comigo.some(c=>c.sessao==='l1'&&c.dono==='dora@x.com'&&c.modo==='ler'));
  assert.equal((await ir('/_ratoeira/api/compartilhadas/por-link',{headers:de(dora),body:{link,convite:destino.id,cwd:'/srv/t'}})).json.ja,true);
  // agora o agente do Gil lê, pelo servidor de agentes da Dora
  r=await ler(link);assert.equal(r.isError,false);
  assert.match(r.content[0].text,/^Conversa "Landing", de Dora\. 1 mensagens de gente; pasta \/srv\/t\. Só leitura/);
  assert.match(r.content[0].text,/\[Dora\]: oi/);
  assert.deepEqual(pedidos.find(p=>p.url==='/ler-conversa').corpo,{agente:'claude',sessao:'l1',cwd:'/srv/t',dono:'Dora'});
  // a Dora tirando o acesso, o agente do Gil para de ler
  const id=comigo.find(c=>c.sessao==='l1').id;
  assert.equal((await ir('/_ratoeira/api/compartilhadas/remover',{headers:de(dora),body:{id}})).status,200);
  assert.equal((await ler(link)).isError,true);
});
