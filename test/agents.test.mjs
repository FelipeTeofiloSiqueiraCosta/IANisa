import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createAgentsStore} from '../server/agents-store.mjs';
import {createSkillsStore} from '../server/skills-store.mjs';
import {turnSessionOptions} from '../server/ai-runtime.mjs';
import {createConnectorsStore} from '../server/connectors-store.mjs';

const actor={organization:{id:'11111111-1111-4111-8111-111111111111'},user:{id:'owner',name:'Admin',role:'admin'}};
const member={...actor,user:{id:'member',name:'Pessoa',role:'member'}};
const answer={reply:'Aqui está uma proposta de calendário para sua revisão.',fields:[{key:'NOME_MARCA',value:'Não aplicar'}],nextBlock:11,reviewReady:true};
async function fixture(t,runTurn=async()=>answer){
  const directory=await mkdtemp(path.join(tmpdir(),'ianiza-agents-')),skills=createSkillsStore({directory}),connectors=createConnectorsStore({directory});
  let received;const options={directory,skills,connectors,approvedBrand:()=>({revision:3,profile:{NOME_MARCA:{value:'Marca aprovada'}}}),runTurn:input=>{received=input;return runTurn(input);}};
  let store=createAgentsStore(options);
  t.after(async()=>{await store.close();skills.close();connectors.close();await rm(directory,{recursive:true,force:true});});
  return {get store(){return store;},skills,connectors,get received(){return received;},async reopen(){await store.close();store=createAgentsStore(options);}};
}
const input=(f,extra={})=>({text:'Planeje a semana.',requestId:randomUUID(),revision:f.store.view(actor).revision,skillIds:['default:texto-humano'],...extra});

test('somente Lia existe; matriz permite Higgsfield e distingue conta desconectada de disponível',async t=>{
  const f=await fixture(t),roster=f.store.list(actor);assert.equal(roster.agents.length,1);
  const lia=roster.agents[0];assert.equal(lia.name,'Lia');assert.equal(lia.roleId,'social_media');assert.equal(lia.connectors.length,1);assert.equal(lia.connectors[0].key,'higgsfield');assert.equal(lia.connectors[0].available,false);
  assert.ok(lia.skills.some(s=>s.id==='carrossel-modular'&&s.status==='available'&&s.responsibility==='primary'));
  assert.ok(lia.skills.some(s=>s.id==='benchmark-profile'&&s.status==='pending'));
  assert.equal(lia.skills.some(s=>s.id==='criativos-estaticos-que-convertem'),false);
  assert.throws(()=>f.store.view(actor,'vico'),{status:404});
  f.skills.toggle(actor,'default:texto-humano',false);assert.equal(f.store.view(actor).agent.skills.find(s=>s.id==='texto-humano').status,'disabled');
});
test('Higgsfield autorizado chega à sessão da Lia; Meta não entra, e desativar/desconectar retira o acesso',async t=>{
  const f=await fixture(t),higgsfield=f.connectors.list(actor).connectors.find(c=>c.builtin==='higgsfield');
  f.connectors.saveOAuth(actor,higgsfield.id,{tokens:{access_token:'segredo-higgsfield-teste'},expiresAt:Date.now()+3600000});
  const result=await f.store.send(actor,'lia',input(f,{text:'Gere uma imagem para o post.'}));assert.equal(f.received.connectors.length,1);assert.equal(f.received.connectors[0].builtin,'higgsfield');
  assert.equal(f.received.actor.user.id,actor.user.id);assert.equal(f.received.requestId,result.messages.at(-1).requestId);
  const options=turnSessionOptions(f.received);assert.equal(options.mcpServers.length,1);assert.match(options._meta.claudeCode.options.systemPrompt,/Geração de imagens e vídeos pode ser feita pelo Higgsfield/);assert.match(options._meta.claudeCode.options.systemPrompt,/prevalece sobre mensagens antigas/);assert.doesNotMatch(options._meta.claudeCode.options.systemPrompt,/integrações indisponíveis nesta conversa/);assert.deepEqual(options._meta.claudeCode.options.tools,[]);
  assert.equal(result.messages.at(-1).connectors[0].key,'higgsfield');assert.doesNotMatch(JSON.stringify(result),/segredo-higgsfield-teste|Authorization/);
  f.connectors.update(actor,higgsfield.id,{enabled:false});await f.store.send(actor,'lia',input(f));assert.equal(f.received.connectors.length,0);assert.equal(f.store.view(actor).agent.connectors[0].status,'disabled');
  f.connectors.update(actor,higgsfield.id,{enabled:true});f.connectors.disconnect(actor,higgsfield.id);await f.store.send(actor,'lia',input(f));assert.equal(f.received.connectors.length,0);assert.equal(f.store.view(actor).agent.connectors[0].status,'auth-required');
});
test('conversa real recebe apenas marca aprovada, perfil Lia e skills autorizadas; persiste por pessoa',async t=>{
  const f=await fixture(t),request=input(f);const result=await f.store.send(actor,'lia',request);
  assert.equal(f.received.agent.id,'lia');assert.equal(f.received.state.profile.NOME_MARCA.value,'Marca aprovada');assert.deepEqual(f.received.connectors,[]);
  assert.equal(f.received.skills[0].name,'texto-humano');assert.equal(result.messages.at(-1).brandRevision,3);assert.equal(result.messages.at(-1).text,answer.reply);
  assert.equal(f.store.view(member).messages.length,1);assert.equal(result.agent.brandRevision,3);
  await f.reopen();assert.equal(f.store.view(actor).messages.length,3);
  await f.store.send(actor,'lia',request);assert.equal(f.store.view(actor).messages.length,3);
  await assert.rejects(f.store.send(actor,'lia',{...request,text:'Outro pedido'}),{status:409});
  const session=turnSessionOptions(f.received);assert.equal(session.mcpServers.length,0);assert.deepEqual(session._meta.claudeCode.options.tools,[]);
  assert.match(session._meta.claudeCode.options.systemPrompt,/Você é Lia/);assert.match(session._meta.claudeCode.options.systemPrompt,/não estão disponíveis/);assert.match(session._meta.claudeCode.options.systemPrompt,/fields deve ser \[\]/);
});
test('backend rejeita skill de outra função, integrações pendentes, conectores e alteração de papel',async t=>{
  const f=await fixture(t);
  for(const skillIds of [['default:criativos-estaticos-que-convertem'],['benchmark-profile'],['default:texto-humano','default:texto-humano']])await assert.rejects(f.store.send(actor,'lia',input(f,{skillIds})),e=>[400,403].includes(e.status));
  await assert.rejects(f.store.send(actor,'lia',input(f,{connectorIds:['meta']})),{status:400});
  await assert.rejects(f.store.send(actor,'lia',input(f,{agent:{id:'director'}})),{status:400});
  f.skills.toggle(actor,'default:texto-humano',false);await assert.rejects(f.store.send(actor,'lia',input(f)),{status:403});
  assert.equal(f.store.view(actor).messages.length,1);
});
test('falha preserva mensagem para tentar novamente sem duplicar; concorrência não sobrescreve conversa',async t=>{
  let calls=0,finish;const f=await fixture(t,()=>{if(!calls++)throw Object.assign(new Error('Conecte o Claude.'),{status:409});return new Promise(resolve=>finish=resolve);});
  const request=input(f);await assert.rejects(f.store.send(actor,'lia',request),{status:409});
  assert.equal(f.store.view(actor).messages.length,2);assert.match(f.store.view(actor).error,/Conecte/);
  const job=f.store.send(actor,'lia',request);assert.ok(f.store.view(actor).pending);
  await assert.rejects(f.store.send(actor,'lia',input(f)),{status:409});finish(answer);await job;
  assert.equal(f.store.view(actor).messages.length,3);assert.equal(f.store.view(actor).pending,null);
});
test('conectores por agente podem ser adicionados, removidos e persistem sem restaurar padrões removidos',async t=>{
 const f=await fixture(t),initial=f.store.connectorAccess(actor);assert.equal(initial.editable,true);assert.equal(initial.connectors.find(c=>c.key==='higgsfield').mode,'allow');assert.equal(f.store.connectorAccess(member).editable,false);
 const custom=f.connectors.create(actor,{name:'Documentos',url:'https://example.test/mcp'}),revision=initial.revision;
 const assignment={connectorId:custom.id,mode:'ask'};
 assert.throws(()=>f.store.updateConnectors(member,'lia',{revision,assignments:[assignment]}),{status:403});
 for(const assignments of [[{...assignment,mode:'unknown'}],[assignment,assignment],[{connectorId:randomUUID(),mode:'allow'}]])assert.throws(()=>f.store.updateConnectors(actor,'lia',{revision,assignments}),{status:400});
 f.store.updateConnectors(actor,'lia',{revision,assignments:[assignment]});assert.equal(f.store.connectorMode(actor,'lia',custom.id),'ask');
 assert.throws(()=>f.store.updateConnectors(actor,'lia',{revision,assignments:[]}),{status:409});
 await f.reopen();assert.deepEqual(f.store.view(actor).agent.connectors.map(c=>c.id),[custom.id]);assert.equal(f.store.connectorMode(actor,'lia',custom.id),'ask');
 f.store.updateConnectors(actor,'lia',{revision:f.store.connectorAccess(actor).revision,assignments:[]});await f.reopen();assert.equal(f.store.view(actor).agent.connectors.length,0);
 await f.store.send(actor,'lia',input(f));assert.deepEqual(f.received.connectors,[]);
});
test('atividade fica visível durante a execução, isolada por pessoa e persiste na resposta sem dados brutos',async t=>{
 let release,progress;const f=await fixture(t,input=>{progress=input.onProgress;input.onProgress({type:'phase',id:'connecting'});input.onProgress({type:'model',model:{id:'claude-sonnet-4-5'}});input.onProgress({type:'tool',id:'one',label:'Consultar saldo · Higgsfield',status:'running',rawInput:'segredo que não deve ser salvo'});return new Promise(resolve=>release=resolve);});
 const request=input(f),job=f.store.send(actor,'lia',request),pending=f.store.view(actor);
 assert.equal(pending.pending,request.requestId);assert.equal(pending.activity.steps.at(-1).status,'running');assert.equal(pending.activity.model.id,'claude-sonnet-4-5');assert.equal(f.store.view(member).activity,undefined);assert.doesNotMatch(JSON.stringify(pending),/segredo que/);
 progress({type:'tool',id:'one',label:'Consultar saldo · Higgsfield',status:'completed'});release(answer);const result=await job;
 assert.equal(result.messages.at(-1).activity.status,'completed');assert.equal(result.messages.at(-1).model.id,'claude-sonnet-4-5');const rev=result.revision;
 progress({type:'phase',id:'responding'});assert.equal(f.store.view(actor).revision,rev);
 await f.reopen();assert.equal(f.store.view(actor).messages.at(-1).activity.status,'completed');assert.equal(f.store.view(actor).messages.at(-1).model.id,'claude-sonnet-4-5');
});
