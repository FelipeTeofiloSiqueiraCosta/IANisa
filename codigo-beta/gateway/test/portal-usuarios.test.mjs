// Multiusuário no portal: cada pessoa do mapa vê a pasta dela e conecta a própria conta pelo servidor de
// agentes dela (o Paseo por pessoa saiu em 09/10/2026). Quem não está no mapa segue como antes.
import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createGateway} from '../server.mjs';
import {createPortal} from '../portal.mjs';
import {normalizeUsers,createAcesso} from '../usuarios.mjs';

test('cada pessoa vê a própria pasta e as próprias conexões',async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'ratoeira-pessoas-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  for(const p of ['ana','beto','caio']){await mkdir(path.join(dir,p),{recursive:true});await writeFile(path.join(dir,p,p+'.md'),'# '+p);}
  const users=normalizeUsers({'ana@example.com':{user:'rt-ana',repoDir:path.join(dir,'ana')},'beto@example.com':{user:'rt-beto',repoDir:path.join(dir,'beto')}});
  const criados=[];
  const agentesRuntime=({socketPath})=>{criados.push(socketPath);return {
    status:async id=>({id,name:id,installed:true,status:socketPath.includes('rt-ana')?'connected':'disconnected'}),
    launch:()=>{const c=new EventEmitter();c.stdout=new EventEmitter();c.stderr=new EventEmitter();c.stdin=new EventEmitter();c.stdin.write=()=>true;c.kill=()=>{};
      setTimeout(()=>c.stdout.emit('data',Buffer.from('Abra https://claude.com/cai/oauth/authorize?x=1 e paste code here')),5);return c;},
    backup:async()=>{},confirm:async id=>({id,status:'connected'})};};
  const portal=createPortal({hostname:'ratoeira.example.com',agentPath:'/new?projectId=unico',dataDir:path.join(dir,'estado'),pagesDir:path.join(dir,'pages'),
    adminEmails:['caio@example.com','chefe@example.com'],repoDir:path.join(dir,'caio'),acesso:createAcesso({users,paseoCompartilhado:['caio@example.com']}),
    agentesConexoes:{socket:'/run/ratoeira-agentes-{user}/agentes.sock'}},
    {runtime:{status:async id=>({id,name:id,status:'connected',installed:true,account:'compartilhada'}),launch:()=>{throw new Error('não');},backup:async()=>{}},agentesRuntime});
  const gateway=createGateway({hostname:'ratoeira.example.com',password:'test',portal,users:{'ana@example.com':'rt-ana','beto@example.com':'rt-beto'},paseoCompartilhado:['caio@example.com'],
    verify:async token=>({email:token+'@example.com',exp:Math.floor(Date.now()/1000)+300})});
  await new Promise(r=>gateway.listen(0,'127.0.0.1',r));t.after(()=>gateway.shutdown());
  const base='http://127.0.0.1:'+gateway.address().port;
  const como=quem=>({'cf-access-jwt-assertion':quem});
  const mutate=quem=>({...como(quem),origin:'https://ratoeira.example.com','content-type':'application/json'});
  const nomes=async quem=>(await (await fetch(base+'/_ratoeira/api/arquivos/arvore',{headers:como(quem)})).json()).itens.map(i=>i.nome);

  assert.deepEqual(await nomes('ana'),['ana.md']);
  assert.deepEqual(await nomes('beto'),['beto.md']);
  assert.deepEqual(await nomes('caio'),['caio.md']);
  assert.equal((await fetch(base+'/_ratoeira/ver/beto.md',{headers:como('ana')})).status,404);
  assert.equal((await fetch(base+'/_ratoeira/ver/ana.md',{headers:como('ana')})).status,200);

  const info=await (await fetch(base+'/_ratoeira/api/portal',{headers:como('ana')})).json();
  // sem Paseo próprio: nada de aba Agentes
  assert.equal(info.agentPath,null);assert.equal(info.agents,false);
  // a conta é dela, então ela mesma conecta, mesmo sem ser administradora
  assert.equal(info.user.canManageConnections,true);
  assert.equal(info.user.ownAccount,true);
  // no Paseo único (kit 0.1.0) a aba Agentes segue
  const doCaio=await (await fetch(base+'/_ratoeira/api/portal',{headers:como('caio')})).json();
  assert.equal(doCaio.agentPath,'/new?projectId=unico');assert.equal(doCaio.agents,true);
  assert.equal((await (await fetch(base+'/_ratoeira/api/portal',{headers:como('outro')})).json()).user.canManageConnections,false);

  const status=async quem=>(await (await fetch(base+'/_ratoeira/api/connections',{headers:como(quem)})).json()).providers[0];
  assert.equal((await status('ana')).status,'connected');
  assert.equal((await status('beto')).status,'disconnected');
  assert.equal((await status('caio')).account,'compartilhada');
  assert.deepEqual(criados.sort(),['/run/ratoeira-agentes-rt-ana/agentes.sock','/run/ratoeira-agentes-rt-beto/agentes.sock']);

  // o login de uma pessoa não trava nem aparece pra outra
  assert.equal((await fetch(base+'/_ratoeira/api/connections/claude/start',{method:'POST',headers:mutate('ana'),body:'{}'})).status,202);
  assert.equal((await fetch(base+'/_ratoeira/api/connections/claude/start',{method:'POST',headers:mutate('beto'),body:'{}'})).status,202);
  await new Promise(r=>setTimeout(r,30));
  const flow=await (await fetch(base+'/_ratoeira/api/connections/flow',{headers:como('ana')})).json();
  assert.equal(flow.flow.stage,'code');
  assert.match(flow.flow.url,/^https:\/\/claude\.com\/cai\/oauth\/authorize/);
  assert.equal((await (await fetch(base+'/_ratoeira/api/connections/flow',{headers:como('caio')})).json()).flow,null);
  // fora do mapa e fora da lista, mesmo sendo admin: não vê a pasta nem a conta do Paseo único
  const chefe=await (await fetch(base+'/_ratoeira/api/portal',{headers:como('chefe')})).json();
  assert.equal(chefe.files,false);assert.equal(chefe.agents,false);assert.equal(chefe.chat,null);assert.equal(chefe.user.canManageConnections,false);
  assert.equal((await fetch(base+'/_ratoeira/api/arquivos/arvore',{headers:como('chefe')})).status,404);
  assert.equal((await fetch(base+'/_ratoeira/ver/caio.md',{headers:como('chefe')})).status,404);
  assert.equal((await fetch(base+'/_ratoeira/api/connections',{headers:como('chefe')})).status,403);
  assert.equal((await fetch(base+'/_ratoeira/api/connections/claude/start',{method:'POST',headers:mutate('chefe'),body:'{}'})).status,403);
});

test('instalação só com usuários do mapa sobe sem a config do Paseo único',async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'ratoeira-so-mapa-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const portal=createPortal({hostname:'localhost:7000',dataDir:dir,pagesDir:dir,acesso:createAcesso({users:{'ana@example.com':'rt-ana'}}),agentesConexoes:{socket:'/run/{user}.sock'}},{agentesRuntime:()=>({status:async id=>({id,status:'connected'})})});
  const gateway=createGateway({hostname:'localhost:7000',portal,users:{'ana@example.com':'rt-ana'},verify:async t=>({email:t+'@example.com',exp:Math.floor(Date.now()/1000)+300})});
  await new Promise(r=>gateway.listen(0,'127.0.0.1',r));t.after(()=>gateway.shutdown());
  const base='http://127.0.0.1:'+gateway.address().port;
  assert.equal((await (await fetch(base+'/_ratoeira/api/connections',{headers:{'cf-access-jwt-assertion':'ana'}})).json()).providers[0].status,'connected');
  assert.equal((await fetch(base+'/_ratoeira/api/connections',{headers:{'cf-access-jwt-assertion':'outro'}})).status,403);
});

test('as Conexões de cada pessoa vão pro servidor de agentes dela, que liga se estiver desligado',async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'ratoeira-agcon-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const users=normalizeUsers({'ana@example.com':{user:'rt-ana',repoDir:dir}});
  const pedidos=[];const ligados=[];
  const portal=createPortal({hostname:'localhost:7000',dataDir:path.join(dir,'estado'),pagesDir:path.join(dir,'pages'),acesso:createAcesso({users}),
    agentesConexoes:{socket:'/run/ratoeira-agentes-{user}/agentes.sock',ligar:u=>ligados.push(u)}},
    {agentesRuntime:({socketPath,ligar})=>{pedidos.push(socketPath);ligar();return {status:async id=>({id,status:'connected'}),launch:()=>{},backup:async()=>{},confirm:async id=>({id,status:'connected'})};}});
  const gateway=createGateway({hostname:'localhost:7000',password:'test',portal,users:{'ana@example.com':'rt-ana'},
    verify:async token=>({email:token+'@example.com',exp:Math.floor(Date.now()/1000)+300})});
  await new Promise(r=>gateway.listen(0,'127.0.0.1',r));t.after(()=>gateway.shutdown());
  const r=await (await fetch('http://127.0.0.1:'+gateway.address().port+'/_ratoeira/api/connections',{headers:{'cf-access-jwt-assertion':'ana'}})).json();
  assert.equal(r.providers[0].status,'connected');
  assert.deepEqual(pedidos,['/run/ratoeira-agentes-rt-ana/agentes.sock']);
  assert.deepEqual(ligados,['rt-ana']);
});
