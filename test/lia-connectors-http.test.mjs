import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {createAppServer} from '../server/http.mjs';

test('Lia recebe Higgsfield pelo HTTP; só o dono do pedido permite a chamada e recusar não executa', {timeout:15000},async t=>{
 const directory=await mkdtemp(path.join(tmpdir(),'ianiza-lia-mcp-')),root=fileURLToPath(new URL('../',import.meta.url));
 let started,executed=0;
 const app=await createAppServer({root,directory,aiRuntime:{status:async()=>({status:'connected'}),close(){},async runTurn(input){
  assert.equal(input.agent.id,'lia');assert.equal(input.connectors.length,1);assert.equal(input.connectors[0].builtin,'higgsfield');
  const authorization=input.onPermission({toolCall:{title:'Preparar imagem de teste',rawInput:{prompt:'Exemplo local, sem geração externa.'},_meta:{claudeCode:{toolName:'mcp__'+input.connectors[0].name+'__generate_image'}}},options:[{kind:'allow_once',optionId:'once'}]});
  started();const result=await authorization,allowed=result.outcome.outcome==='selected';if(allowed)executed++;
  return {reply:allowed?'Execução autorizada no teste local.':'Execução recusada; nenhum crédito consumido.',fields:[],nextBlock:0,reviewReady:false};
 }}});
 app.server.listen(0,'127.0.0.1');await once(app.server,'listening');
 t.after(async()=>{app.permissions.close();app.server.close();await once(app.server,'close');app.accounts.close();await rm(directory,{recursive:true,force:true});});
 const port=app.server.address().port,origin='http://127.0.0.1:4173';
 function request(route,{method='GET',body,actor}={}){return new Promise((resolve,reject)=>{const req=http.request({host:'127.0.0.1',port,path:route,method,agent:false,headers:{host:'127.0.0.1:4173',origin,...(body?{'content-type':'application/json'}:{}),...(actor?{cookie:'ianiza_session='+actor.token,'x-csrf-token':actor.identity.csrf}:{})}},res=>{let text='';res.on('data',d=>text+=d);res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(text)}));});req.on('error',reject);req.end(body?JSON.stringify(body):undefined);});}
 const link=app.accounts.createSetupLink(),session=await app.accounts.setup({token:link.token,name:'Dona',email:'dona@example.test',organization:'Empresa teste',password:'frase de teste segura 123'},'local');
 const admin={token:session.token,identity:app.accounts.authenticated(session.token)};
 const invite=app.accounts.invite(admin.token,{name:'Pessoa',email:'pessoa@example.test',role:'member'}),joined=await app.accounts.accept({token:invite.token,name:'Pessoa',password:'outra frase segura 123'},'local');
 const member={token:joined.token,identity:app.accounts.authenticated(joined.token)};
 const h=app.connectors.list(admin.identity).connectors.find(c=>c.builtin==='higgsfield');app.connectors.saveOAuth(admin.identity,h.id,{tokens:{access_token:'token-descartavel-nao-real'},expiresAt:Date.now()+3600000});
 const firstAccess=app.agents.connectorAccess(admin.identity);app.agents.updateConnectors(admin.identity,'lia',{revision:firstAccess.revision,assignments:[{connectorId:h.id,mode:'ask'}]});
 async function turn(owner,other,allow){
  const state=await request('/api/agents/lia',{actor:owner});assert.equal(state.body.agent.connectors[0].available,true);
  const ready=new Promise(resolve=>started=resolve),requestId=randomUUID();
  const pending=request('/api/agents/lia/messages',{method:'POST',actor:owner,body:{text:'Prepare uma imagem de teste.',requestId,revision:state.body.revision,skillIds:['default:texto-humano']}});
  await ready;
  const own=await request('/api/tool-permissions',{actor:owner});assert.equal(own.body.permissions.length,1);const permission=own.body.permissions[0];assert.equal(permission.requestId,requestId);assert.equal(permission.connector,'Higgsfield');assert.doesNotMatch(JSON.stringify(own.body),/token-descartavel/);
  assert.equal((await request('/api/tool-permissions',{actor:other})).body.permissions.length,0);
  assert.equal((await request('/api/tool-permissions/'+permission.id,{method:'POST',actor:other,body:{allow:true}})).status,404);
  assert.equal((await request('/api/tool-permissions/'+permission.id,{method:'POST',actor:owner,body:{allow}})).status,200);
  const result=await pending;assert.equal(result.status,200);assert.equal(result.body.messages.at(-1).connectors[0].key,'higgsfield');assert.doesNotMatch(JSON.stringify(result.body),/token-descartavel|Authorization/);
  assert.equal((await request('/api/tool-permissions',{actor:owner})).body.permissions.length,0);
 }
 await turn(admin,member,true);assert.equal(executed,1);
 await turn(member,admin,false);assert.equal(executed,1);
 const access=await request('/api/agents/lia/connectors',{actor:admin}),settings={revision:access.body.revision,assignments:[{connectorId:h.id,mode:'allow'}]};
 assert.equal((await request('/api/agents/lia/connectors',{method:'PATCH',actor:member,body:settings})).status,403);
 assert.equal((await request('/api/agents/lia/connectors',{method:'PATCH',body:settings})).status,401);
 assert.equal((await request('/api/agents/lia/connectors',{method:'PATCH',actor:admin,body:settings})).status,200);
 assert.equal((await request('/api/agents/lia/connectors',{method:'PATCH',actor:admin,body:settings})).status,409);
 for(let i=0;i<2;i++){const state=(await request('/api/agents/lia',{actor:member})).body;const result=await request('/api/agents/lia/messages',{method:'POST',actor:member,body:{text:'Um pedido permitido.',requestId:randomUUID(),revision:state.revision,skillIds:[]}});assert.equal(result.status,200);assert.equal((await request('/api/tool-permissions',{actor:member})).body.permissions.length,0);}
 assert.equal(executed,3);
 const current=app.agents.connectorAccess(admin.identity);app.agents.updateConnectors(admin.identity,'lia',{revision:current.revision,assignments:[{connectorId:h.id,mode:'ask'}]});
 const ready=new Promise(resolve=>started=resolve),previous=(await request('/api/agents/lia',{actor:member})).body;
 const waiting=request('/api/agents/lia/messages',{method:'POST',actor:member,body:{text:'Pedido antes da revogação.',requestId:randomUUID(),revision:previous.revision,skillIds:[]}});await ready;
 const revoking=app.agents.connectorAccess(admin.identity);assert.equal((await request('/api/agents/lia/connectors',{method:'PATCH',actor:admin,body:{revision:revoking.revision,assignments:[]}})).status,200);assert.equal((await waiting).status,200);assert.equal(executed,3);assert.equal((await request('/api/tool-permissions',{actor:member})).body.permissions.length,0);
 assert.equal((await request('/api/connectors/'+h.id+'/disconnect',{method:'POST',actor:member,body:{}})).status,403);
 const state=(await request('/api/agents/lia',{actor:admin})).body;
 assert.equal((await request('/api/agents/lia/messages',{method:'POST',actor:admin,body:{text:'Forçar outro conector',requestId:randomUUID(),revision:state.revision,connectorIds:['meta'],skillIds:[]}})).status,400);
});
