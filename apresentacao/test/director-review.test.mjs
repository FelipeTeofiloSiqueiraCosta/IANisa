import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState } from '../src/state.js';
import { ensureCoordination, createPlan, distributePlan, findTask, submitForReview, processTaskReviews, reviewTask, saveKnowledge } from '../src/coordination.js';
import { ensureRoutines, scheduleExecutionReview, processExecutionReviews, reviewExecution, runId } from '../src/routines.js';
import { beginJourney, advanceJourney } from '../src/journey.js';

function campaign(reviewPolicy){const state=ensureCoordination(initialState()),c=createPlan(state,{title:'Campanha',brief:'Seguir a marca e o briefing.',reviewPolicy});distributePlan(state,c);const parent=c.sessionIds.map(id=>findTask(state,id)).find(x=>x.m.id==='lia'),child=c.sessionIds.map(id=>findTask(state,id)).find(x=>x.m.id==='vico');return {state,c,parent,child};}

test('o diretor aprova e libera dependências sem aprovação humana a cada entrega',()=>{
  const {state,parent,child}=campaign();submitForReview(state,parent.s,'Planejamento de conteúdo.',{now:1000});
  assert.equal(processTaskReviews(state,2000).length,0);assert.equal(child.s.status,'blocked');
  assert.throws(()=>reviewTask(state,parent.s,{decision:'approve',actor:'user',checks:['brief','brand','quality']}),/não solicitou/);
  assert.equal(processTaskReviews(state,4000)[0].decision,'approve');
  assert.equal(parent.s.status,'done');assert.equal(parent.s.review.actor,'director');assert.equal(child.s.status,'working');
  assert.equal(parent.s.review.evaluation.findings.every(f=>f.status==='passed'),true);
});
test('divergência volta ao agente; somente a entrega corrigida aprovada libera o fluxo',()=>{
  const {state,parent,child}=campaign();submitForReview(state,parent.s,'Versão com cor fora da paleta.',{scenario:'changes',now:1000});processTaskReviews(state,4000);
  assert.equal(parent.s.status,'changes');assert.equal(child.s.status,'blocked');assert.match(parent.s.review.feedback,/paleta/);
  assert.equal(parent.s.review.evaluation.findings.find(f=>f.id==='brand').status,'failed');
  submitForReview(state,parent.s,'Versão corrigida com a paleta oficial.',{now:5000});processTaskReviews(state,8000);
  assert.equal(parent.s.status,'done');assert.equal(child.s.status,'working');assert.equal(parent.s.review.history.length,2);
  assert.equal(parent.s.review.history[0].decision,'changes');assert.match(parent.s.review.history[0].delivery,/fora da paleta/);
  assert.equal(parent.s.review.history[1].decision,'approve');
});
test('aprovação humana adicional só é pedida se configurada e após a conferência do diretor',()=>{
  const {state,parent,child}=campaign({mode:'human',criteria:'A oferta final deve ser confirmada por mim.'});
  submitForReview(state,parent.s,'Oferta conferida.',{now:1000});processTaskReviews(state,4000);
  assert.equal(parent.s.review.status,'awaiting_user');assert.equal(child.s.status,'blocked');assert.equal(parent.s.status,'review');
  reviewTask(state,parent.s,{decision:'approve',actor:'user',checks:['brief','brand','quality'],feedback:'Oferta confirmada.'});
  assert.equal(child.s.status,'working');assert.equal(parent.s.review.actor,'user');assert.equal(parent.s.review.policy.criteria,'A oferta final deve ser confirmada por mim.');
});
test('mesmo com confirmação humana adicional, um erro conhecido retorna ao responsável primeiro',()=>{
  const {state,parent}=campaign({mode:'human'});submitForReview(state,parent.s,'Material divergente.',{scenario:'changes',now:1000});processTaskReviews(state,4000);
  assert.equal(parent.s.status,'changes');assert.equal(parent.s.review.actor,'director');assert.notEqual(parent.s.review.status,'awaiting_user');
});
test('falta de definição ou mudança nas regras exige consulta, sem aprovação automática',()=>{
  for(const scenario of ['unclear','pass']){
    const {state,parent,child}=campaign();submitForReview(state,parent.s,'Material entregue.',{scenario,now:1000});
    if(scenario==='pass')saveKnowledge(state,{title:'Nova regra',category:'direction',content:'Usar a nova oferta aprovada.'});
    processTaskReviews(state,4000);assert.equal(parent.s.review.status,'awaiting_user');assert.equal(child.s.status,'blocked');assert.notEqual(parent.s.status,'done');
  }
});
test('retomada de revisão pendente é idempotente e preserva o parecer e a resposta ao agente dependente',()=>{
  const {state,parent,child}=campaign();submitForReview(state,parent.s,'Calendário aprovado.',{now:1000});
  const restored=JSON.parse(JSON.stringify(state));processTaskReviews(restored,4000);const first=structuredClone(restored);
  assert.equal(processTaskReviews(restored,5000).length,0);assert.deepEqual(restored,first);
  assert.equal(findTask(restored,child.s.id).s.status,'working');assert.equal(findTask(restored,parent.s.id).s.review.history.length,1);
});
test('entrega humana recebe o mesmo parecer autônomo do diretor',()=>{
  const {state,c}=campaign(),human=c.sessionIds.map(id=>findTask(state,id)).find(x=>x.m.id==='clara');
  submitForReview(state,human.s,'Oferta e prioridades definidas.',{now:1000});processTaskReviews(state,4000);
  assert.equal(human.s.status,'done');assert.equal(human.s.review.actor,'director');
});
test('rotinas também usam a revisão automática do diretor, mantendo resultado pendente até a decisão',()=>{
  const today='2026-11-01',state=ensureRoutines(ensureCoordination(initialState()),{today}),ws=state.routineWorkspace;
  const parent=ws.executions.find(e=>e.id===runId('tendencias',today)),child=ws.executions.find(e=>e.id===runId('roteiro',today));
  scheduleExecutionReview(state,parent,{scenario:'changes',now:1000});processExecutionReviews(state,4000,{date:today,time:'09:00'});
  assert.equal(parent.status,'changes_requested');assert.equal(child.status,'waiting_dependency');assert.equal(parent.result,null);
  parent.status='in_review';scheduleExecutionReview(state,parent,{now:5000});processExecutionReviews(state,8000,{date:today,time:'09:00'});
  assert.equal(parent.status,'approved');assert.equal(parent.result.availability,'published');assert.equal(child.status,'ready');
  assert.equal(processExecutionReviews(state,9000).length,0);
});
test('critérios definidos no pedido acompanham o planejamento gerado depois da animação',()=>{
  const state=ensureCoordination(initialState()),reviewPolicy={mode:'human',criteria:'Confirmar o preço comigo.'};
  beginJourney(state,{title:'Oferta',brief:'Criar uma oferta.',reviewPolicy},1000);for(let i=0;i<4;i++)advanceJourney(state,2000+i*3000,true);
  assert.deepEqual(state.campaigns[0].plan.reviewPolicy,reviewPolicy);
});
test('rotina configurada com confirmação adicional mantém o resultado bloqueado até a decisão humana',()=>{
  const today='2026-11-01',state=ensureRoutines(ensureCoordination(initialState()),{today}),ws=state.routineWorkspace;
  const parent=ws.executions.find(e=>e.id===runId('tendencias',today)),child=ws.executions.find(e=>e.id===runId('roteiro',today));
  parent.reviewPolicy={mode:'human',criteria:'Quero validar as referências finais.'};scheduleExecutionReview(state,parent,{now:1000});processExecutionReviews(state,4000,{date:today,time:'09:00'});
  assert.equal(parent.review.status,'awaiting_user');assert.equal(parent.result,null);assert.equal(child.status,'waiting_dependency');
  reviewExecution(ws,parent.id,{decision:'approve',actor:'user',checks:['brief','brand','quality']},{date:today,time:'09:00'});
  assert.equal(child.status,'ready');assert.equal(parent.review.actor,'user');assert.match(parent.history.at(-1).text,/confirmação humana/);
});
