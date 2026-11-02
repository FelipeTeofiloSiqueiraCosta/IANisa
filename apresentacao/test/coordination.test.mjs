import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState } from '../src/state.js';
import { ensureCoordination, createPlan, distributePlan, findTask, submitForReview, reviewTask, saveKnowledge, askColleague, replyToColleague, validatePlan } from '../src/coordination.js';

const fresh=()=>ensureCoordination(initialState());
const plan=s=>createPlan(s,{title:'Black Friday',brief:'Criar uma campanha com as cores e o tom da empresa.'});
const approve=(state,session)=>reviewTask(state,session,{decision:'approve',checks:['brief','brand','quality']});

test('preparar um plano não cria tarefas; distribuir exige confirmação e é uma operação única',()=>{
  const state=fresh(),before=state.members.map(m=>m.sessions.length),c=plan(state);
  assert.deepEqual(state.members.map(m=>m.sessions.length),before);
  assert.equal(c.status,'awaiting_approval');
  distributePlan(state,c);
  assert.equal(c.sessionIds.length,c.plan.tasks.length);
  const after=state.members.map(m=>m.sessions.length);
  assert.throws(()=>distributePlan(state,c),/já foi distribuído/);
  assert.deepEqual(state.members.map(m=>m.sessions.length),after);
});
test('alterar o cérebro invalida a distribuição de um plano desatualizado',()=>{
  const state=fresh(),c=plan(state);
  saveKnowledge(state,{category:'brand',title:'Cores oficiais',content:'Usar apenas as cores aprovadas.',palette:'#405738, #cb7d53'});
  assert.throws(()=>distributePlan(state,c),/cérebro foi atualizado/);
  assert.equal(c.status,'awaiting_approval');
  createPlan(state,{title:c.title,brief:c.brief,campaignId:c.id});
  assert.doesNotThrow(()=>distributePlan(state,c));
});
test('pessoas recebem tarefas a fazer; agentes respeitam dependências até a aprovação da entrega necessária',()=>{
  const state=fresh(),c=plan(state);distributePlan(state,c);
  const video=findTask(state,c.sessionIds.find(id=>findTask(state,id).m.id==='vico'));
  const social=findTask(state,video.s.dependencies[0]);
  const human=c.sessionIds.map(id=>findTask(state,id)).find(x=>x.m.id==='clara');
  assert.equal(human.s.status,'assigned');assert.equal(video.s.status,'blocked');
  assert.throws(()=>submitForReview(state,video.s,'Roteiro'),/não está pronta/);
  submitForReview(state,social.s,'Calendário e formatos da campanha.');
  assert.equal(video.s.status,'blocked');
  reviewTask(state,social.s,{decision:'changes',feedback:'Detalhe o formato dos vídeos.'});
  assert.equal(video.s.status,'blocked');assert.equal(social.s.status,'changes');
  submitForReview(state,social.s,'Calendário e formatos revisados.');approve(state,social.s);
  assert.equal(video.s.status,'working');
  const request=state.collaborations.find(t=>t.relatedTaskId===social.s.id);
  assert.equal(request.answered,true);assert.match(request.reply.text,/Calendário e formatos revisados/);
});
test('entregas humanas seguem a mesma revisão obrigatória, com três critérios antes da aprovação',()=>{
  const state=fresh(),c=createPlan(state,{title:'Oferta comercial',brief:'Conferir condições da oferta.',preferredMemberId:'clara'});
  distributePlan(state,c);const task=findTask(state,c.sessionIds[0]);
  submitForReview(state,task.s,'Oferta e condições comerciais conferidas.');
  assert.equal(task.s.status,'review');
  assert.throws(()=>reviewTask(state,task.s,{decision:'approve',checks:['brief']}),/Confira briefing/);
  assert.equal(task.s.status,'review');approve(state,task.s);
  assert.equal(task.s.status,'done');assert.equal(task.s.review.status,'approved');
});
test('um pedido com espera bloqueia a tarefa; só sua resposta libera a espera e preserva outras dependências',()=>{
  const state=fresh(),task=state.members.find(m=>m.id==='vico').sessions[0];
  const a=askColleague(state,{taskId:task.id,to:'lia',text:'Qual formato?',wait:true});
  const b=askColleague(state,{taskId:task.id,to:'cora',text:'Qual chamada?',wait:true});
  assert.equal(task.status,'blocked');replyToColleague(state,a.id,'Formato vertical.');
  assert.equal(task.status,'blocked');replyToColleague(state,b.id,'Conheça a coleção.');
  assert.equal(task.status,'working');assert.throws(()=>replyToColleague(state,b.id,'Repetida'),/pedido em aberto/);
});
test('aprendizados exigem entrega aprovada e ficam vinculados à origem sem duplicação',()=>{
  const state=fresh(),task=state.members.find(m=>m.id==='vico').sessions[0];
  const entry={category:'result',title:'Aprendizado sobre narrativa',content:'Abrir com um detalhe do produto.',source:{sessionId:task.id,memberId:'vico'}};
  assert.throws(()=>saveKnowledge(state,entry),/Somente entregas aprovadas/);
  submitForReview(state,task,'Roteiro com detalhes do produto.');approve(state,task);
  const before=state.brain.entries.length;saveKnowledge(state,entry);saveKnowledge(state,{...entry,content:'Aprendizado refinado.'});
  assert.equal(state.brain.entries.length,before+1);
  assert.equal(state.brain.entries.find(e=>e.source?.sessionId===task.id).content,'Aprendizado refinado.');
});
test('o planejamento rejeita dependências circulares antes de criar sessões',()=>{
  const state=fresh(),c=plan(state);c.plan.tasks[0].dependsOn=c.plan.tasks[1].id;c.plan.tasks[1].dependsOn=c.plan.tasks[0].id;
  assert.throws(()=>validatePlan(state,c),/espera circular/);assert.equal(c.sessionIds,undefined);
});
test('a atualização preserva integrantes e históricos existentes e não duplica a migração',()=>{
  const state=initialState(),before=state.members.map(m=>({id:m.id,messages:m.sessions.map(s=>s.messages.map(m=>m.text))}));
  ensureCoordination(state);ensureCoordination(state);
  assert.deepEqual(state.members.map(m=>({id:m.id,messages:m.sessions.map(s=>s.messages.map(m=>m.text))})),before);
  assert.equal(state.brain.entries.length,4);
  assert.ok(state.members.find(m=>m.id==='duna').sessions[0].status==='review');
});
