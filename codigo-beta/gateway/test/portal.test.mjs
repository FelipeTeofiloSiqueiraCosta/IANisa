import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createGateway} from '../server.mjs';
import {createPortal} from '../portal.mjs';

test('portal/API/page requests keep authentication and CSRF boundaries and persist app writes',async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'ratoeira-api-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const pagesDir=path.join(dir,'pages');await mkdir(path.join(pagesDir,'example'),{recursive:true});await writeFile(path.join(pagesDir,'example','index.html'),'<h1>App</h1>');
  const publishedJson='{"answer": 42}\n';await writeFile(path.join(pagesDir,'example','data.json'),publishedJson);
  let launches=0;
  const portal=createPortal({hostname:'ratoeira.example.com',agentPath:'/new?projectId=test',dataDir:dir,pagesDir,adminEmails:['ana@example.com']},{runtime:{status:async id=>({id,name:id,status:'connected',installed:true}),launch:()=>{launches++;throw new Error('not in this test');},backup:async()=>{}}});
  const gateway=createGateway({hostname:'ratoeira.example.com',password:'test',verify:async token=>{if(!['ana','beto'].includes(token))throw new Error();return {email:token+'@example.com',exp:Math.floor(Date.now()/1000)+300};},portal});
  await new Promise(r=>gateway.listen(0,'127.0.0.1',r));t.after(()=>gateway.shutdown());
  const base='http://127.0.0.1:'+gateway.address().port;
  const auth={'cf-access-jwt-assertion':'ana'};const mutate={...auth,origin:'https://ratoeira.example.com','content-type':'application/json'};
  for(const route of ['/portal/','/_ratoeira/api/portal','/_ratoeira/api/connections','/_ratoeira/pages/example/'])assert.equal((await fetch(base+route)).status,401);
  const root=await fetch(base+'/',{headers:auth,redirect:'manual'});assert.equal(root.headers.get('location'),'/portal/#inicio');
  const info=await (await fetch(base+'/_ratoeira/api/portal',{headers:auth})).json();assert.equal(info.agentPath,'/new?projectId=test');assert.equal(info.user.canManageConnections,true);
  const body=JSON.stringify({name:'Example',url:'/_ratoeira/pages/example/'});
  assert.equal((await fetch(base+'/_ratoeira/api/apps',{method:'POST',headers:auth,body})).status,403);
  assert.equal((await fetch(base+'/_ratoeira/api/apps',{method:'POST',headers:{...mutate,origin:'null'},body})).status,403);
  assert.equal((await fetch(base+'/_ratoeira/api/apps',{method:'POST',headers:{...mutate,'content-type':'text/plain'},body})).status,415);
  const added=await fetch(base+'/_ratoeira/api/apps',{method:'POST',headers:mutate,body});assert.equal(added.status,201);const app=await added.json();
  assert.equal((await (await fetch(base+'/_ratoeira/api/portal',{headers:auth})).json()).apps.some(item=>item.id===app.id),true);
  const page=await fetch(base+'/_ratoeira/pages/example/',{headers:auth});assert.equal(page.status,200);assert.match(page.headers.get('content-security-policy'),/sandbox/);assert.ok(!page.headers.get('content-security-policy').includes('allow-same-origin'));
  const dataPage=await fetch(base+'/_ratoeira/pages/example/data.json',{headers:auth});assert.equal(dataPage.status,200);assert.equal(await dataPage.text(),publishedJson);
  assert.equal((await fetch(base+'/_ratoeira/api/connections/claude/start',{method:'POST',headers:{...mutate,'cf-access-jwt-assertion':'beto'},body:'{}'})).status,403);assert.equal(launches,0);
  const invalid=await fetch(base+'/_ratoeira/api/apps',{method:'POST',headers:mutate,body:'{'});assert.equal(invalid.status,400);
  const oversized=await fetch(base+'/_ratoeira/api/apps',{method:'POST',headers:mutate,body:JSON.stringify({name:'X'.repeat(20000)})});assert.equal(oversized.status,413);
  assert.equal((await fetch(base+'/_ratoeira/api/apps/'+app.id,{method:'DELETE',headers:mutate,body:'{'})).status,400);
  assert.equal((await fetch(base+'/_ratoeira/api/apps/'+app.id,{method:'DELETE',headers:mutate,body:'x'.repeat(20000)})).status,413);
  assert.equal((await (await fetch(base+'/_ratoeira/api/portal',{headers:auth})).json()).apps.some(item=>item.id===app.id),true);
  assert.equal((await fetch(base+'/_ratoeira/api/apps/'+app.id,{method:'DELETE',headers:mutate,body:'{}'})).status,200);
  assert.equal((await fetch(base+'/_ratoeira/api/does-not-exist',{headers:auth})).status,404);
});

test('automações e integrações: inventário só pro admin, liga/desliga de outra pessoa pelo ajudante de root',async t=>{
  const {readFile:ler}=await import('node:fs/promises');
  const dir=await mkdtemp(path.join(tmpdir(),'ratoeira-automacoes-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const inventario=path.join(dir,'inventario.json'),resultado=path.join(dir,'resultado.json'),pedido=path.join(dir,'pedido.json');
  await writeFile(inventario,JSON.stringify({geradoEm:'2026-10-09T10:00:00Z',
    pessoas:[{usuario:'beto',crontab:'0 9 * * * x\n',estados:{},logs:{},status:{},mcps:[{nome:'github',tipo:'http',alvo:'api.githubcopilot.com',escopo:'usuário',agente:'claude'}]}],
    sistema:[{origem:'/etc/cron.d/backup',texto:'0 3 * * * root /x\n',comUsuario:true}],timers:[{unit:'backup.timer',next:1}]}));
  let pedidos=[];
  // o "root" de mentira: lê o pedido, responde ok (ou erro se a linha não bate)
  const aplicar=async()=>{try{const p=JSON.parse(await ler(pedido,'utf8'));pedidos.push(p);await rm(pedido);await writeFile(resultado,JSON.stringify(p.texto==='0 9 * * * x'?{ok:true}:{ok:false,erro:'o arquivo mudou; recarregue a tela'}));}catch{}};
  const portal=createPortal({hostname:'ratoeira.example.com',agentPath:'/new',dataDir:dir,pagesDir:path.join(dir,'pages'),adminEmails:['ana@example.com'],automacoes:{inventario,resultado,pedido,aplicar}},{runtime:{status:async()=>({}),launch:()=>{},backup:async()=>{}}});
  const gateway=createGateway({hostname:'ratoeira.example.com',password:'test',verify:async token=>({email:token+'@example.com',exp:Math.floor(Date.now()/1000)+300}),portal});
  await new Promise(r=>gateway.listen(0,'127.0.0.1',r));t.after(()=>gateway.shutdown());
  const base='http://127.0.0.1:'+gateway.address().port;
  const get=async(quem,rota)=>(await fetch(base+'/_ratoeira/api'+rota,{headers:{'cf-access-jwt-assertion':quem}})).json();
  const post=(quem,rota,corpo)=>fetch(base+'/_ratoeira/api'+rota,{method:'POST',headers:{'cf-access-jwt-assertion':quem,origin:'https://ratoeira.example.com','content-type':'application/json'},body:JSON.stringify(corpo)});

  const admin=await get('ana','/automacoes');
  assert.equal(admin.admin,true);assert.equal(admin.pessoas[0].usuario,'beto');assert.equal(admin.sistema.length,1);assert.equal(admin.pessoas[0].mcps,undefined,'MCP fica na outra tela');
  assert.deepEqual(Object.keys(await get('beto','/automacoes')).sort(),['admin','configurado','meuUsuario'],'quem não é admin não vê o dos outros');
  assert.equal((await get('ana','/integracoes')).pessoas[0].mcps[0].nome,'github');
  assert.equal((await get('beto','/integracoes')).pessoas,undefined);

  assert.equal((await post('beto','/automacoes/alternar',{usuario:'beto',linha:0,texto:'0 9 * * * x',ligar:false})).status,403,'só admin');
  assert.equal((await post('ana','/automacoes/alternar',{usuario:'../root',linha:0,texto:'x',ligar:false})).status,400);
  assert.equal((await post('ana','/automacoes/alternar',{usuario:'beto',linha:0,texto:'0 9 * * * x',ligar:false})).status,200);
  assert.deepEqual(pedidos.at(-1),{usuario:'beto',linha:0,texto:'0 9 * * * x',ligar:false});
  assert.equal((await post('ana','/automacoes/alternar',{usuario:'beto',rotina:'resumo-dia',ligar:false})).status,409,'rotina vai pro ajudante (o de mentira só aceita a linha)');
  assert.deepEqual(pedidos.at(-1),{usuario:'beto',rotina:'resumo-dia',ligar:false});
  assert.equal((await post('ana','/automacoes/alternar',{usuario:'beto',rotina:'../x',ligar:false})).status,400);
  const r=await post('ana','/automacoes/alternar',{usuario:'beto',linha:0,texto:'outra',ligar:true});
  assert.equal(r.status,409);assert.match((await r.json()).error,/mudou/);
});

test('publicar app: só admin, e só quando o publicador está ligado',async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'ratoeira-publicar-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const pedidos=[];
  const publicador={listar:async()=>[{nome:'pedidos',area:'time'}],estado:async nome=>({estado:'ok',nome}),publicar:async(b,por)=>{pedidos.push({...b,por});return {estado:'publicando'};}};
  const montar=async extra=>{
    const portal=createPortal({hostname:'ratoeira.example.com',agentPath:'/new',dataDir:dir,pagesDir:path.join(dir,'pages'),adminEmails:['ana@example.com'],...extra},{runtime:{status:async()=>({}),launch:()=>{},backup:async()=>{}}});
    const gateway=createGateway({hostname:'ratoeira.example.com',password:'test',verify:async token=>({email:token+'@example.com',exp:Math.floor(Date.now()/1000)+300}),portal});
    await new Promise(r=>gateway.listen(0,'127.0.0.1',r));t.after(()=>gateway.shutdown());
    return 'http://127.0.0.1:'+gateway.address().port;
  };
  const base=await montar({publicador});
  const get=(quem,rota)=>fetch(base+'/_ratoeira/api'+rota,{headers:{'cf-access-jwt-assertion':quem}});
  const post=(quem,rota,b)=>fetch(base+'/_ratoeira/api'+rota,{method:'POST',headers:{'cf-access-jwt-assertion':quem,origin:'https://ratoeira.example.com','content-type':'application/json'},body:JSON.stringify(b)});
  assert.equal((await (await get('ana','/portal')).json()).podePublicar,true);
  assert.equal((await (await get('beto','/portal')).json()).podePublicar,false);
  assert.deepEqual((await (await get('ana','/publicar')).json()).apps.map(a=>a.nome),['pedidos']);
  assert.equal((await get('beto','/publicar')).status,403);
  assert.equal((await post('beto','/publicar',{area:'time',nome:'pedidos'})).status,403);
  assert.equal(pedidos.length,0);
  const r=await post('ana','/publicar',{area:'time',nome:'pedidos'});assert.equal(r.status,202);
  assert.deepEqual(pedidos,[{area:'time',nome:'pedidos',por:'ana@example.com'}]);
  assert.equal((await (await get('ana','/publicar/pedidos')).json()).estado.estado,'ok');
  const sem=await montar({});
  assert.equal((await fetch(sem+'/_ratoeira/api/publicar',{headers:{'cf-access-jwt-assertion':'ana'}})).status,404);
});

test('ditado: confere a chave no AssemblyAI antes de guardar',async()=>{
  const {testarDitadoPadrao}=await import('../portal.mjs');
  const vistos=[];const f=async(url,o)=>{vistos.push([url,o.headers.authorization]);return {ok:o.headers.authorization.startsWith('boa'),status:o.headers.authorization.startsWith('boa')?200:401};};
  await testarDitadoPadrao('boa'+'x'.repeat(30),{fetch:f});
  assert.deepEqual(vistos[0],['https://api.assemblyai.com/v2/transcript?limit=1','boa'+'x'.repeat(30)]);
  await assert.rejects(testarDitadoPadrao('ruim'+'x'.repeat(30),{fetch:f}),e=>e.status===400&&/recusou/.test(e.message));
  await assert.rejects(testarDitadoPadrao('curta',{fetch:f}),e=>e.status===400&&/não parece/.test(e.message));
  assert.equal(vistos.length,2,'formato errado nem vai pro AssemblyAI');
  await assert.rejects(testarDitadoPadrao('boa'+'x'.repeat(30),{fetch:async()=>{throw new Error('rede');}}),e=>e.status===502);
});

test('cofre: confere o token no 1Password antes de guardar, e lê conta e vaults',async t=>{
  const {testarCofrePadrao}=await import('../portal.mjs');
  const {chmod}=await import('node:fs/promises');
  const dir=await mkdtemp(path.join(tmpdir(),'ratoeira-op-falso-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const op=path.join(dir,'op');
  // op de mentira: aceita só o token "bom"; nunca recebe o token na linha de comando (só no ambiente)
  await writeFile(op,`#!/bin/sh
case "$OP_SERVICE_ACCOUNT_TOKEN" in ops_bom*) ;; *) echo "[ERROR] 2026/10/09 00:00:00 (401) Unauthorized: You aren't authorized" >&2; exit 1;; esac
case "$*" in *"$OP_SERVICE_ACCOUNT_TOKEN"*) exit 9;; esac
[ "$1" = vault ] && echo '[{"id":"a","name":"Time"},{"id":"b","name":"Clientes"}]'
[ "$1" = whoami ] && echo '{"url":"time.1password.com"}'
exit 0
`);await chmod(op,0o755);
  assert.deepEqual(await testarCofrePadrao('ops_bom'+'x'.repeat(30),{op}),{vaults:['Time','Clientes'],conta:'time.1password.com'});
  await assert.rejects(testarCofrePadrao('ops_ruim'+'x'.repeat(30),{op}),e=>e.status===400&&/recusou/.test(e.message)&&/Unauthorized/.test(e.message));
  await assert.rejects(testarCofrePadrao('ops_bom',{op:path.join(dir,'nao-existe')}),e=>/não está instalado/.test(e.message));
});
