import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState } from '../src/state.js';
import { ensureRoutines, instantiatePeriod, operationalDate, dependencyStates, refreshExecutions, runId, startExecution, submitExecution, reviewExecution, interruptExecution, retryExecution, saveRoutine } from '../src/routines.js';

const today='2026-11-01',clock={date:today,time:'09:00'};
const fresh=()=>ensureRoutines(initialState(),{today}).routineWorkspace;
const get=(w,id,date=today)=>w.executions.find(e=>e.id===runId(id,date));
const approve=(w,id)=>reviewExecution(w,get(w,id).id,{decision:'approve',checks:['brief','brand','quality']},clock);
const deliver=(w,id)=>{const e=get(w,id);if(e.status==='ready')startExecution(w,e.id);submitExecution(w,e.id,'Material de exemplo completo e contextualizado.');};

test('uma rotina gera instâncias estáveis e independentes, sem duplicação ou mistura entre períodos',()=>{
  const w=fresh(),a=get(w,'tendencias'),b=get(w,'tendencias','2026-11-02');
  const count=w.executions.length;instantiatePeriod(w,today);
  assert.equal(w.executions.length,count);assert.notEqual(a.id,b.id);assert.equal(a.status,'in_review');assert.equal(b.status,'scheduled');
  approve(w,'tendencias');assert.equal(b.status,'scheduled');assert.equal(b.result,null);
  assert.throws(()=>instantiatePeriod(w,'2026-02-31'),/data válida/);
});
test('resultado de ontem não libera hoje; entrega pendente e correções mantêm a dependência bloqueada',()=>{
  const w=fresh(),copy=get(w,'roteiro'),research=get(w,'tendencias');
  assert.equal(get(w,'tendencias','2026-10-31').result.availability,'published');
  assert.equal(copy.status,'waiting_dependency');assert.equal(dependencyStates(w,copy)[0].satisfied,false);
  assert.throws(()=>startExecution(w,copy.id),/não está liberada/);
  reviewExecution(w,research.id,{decision:'changes',feedback:'Acrescentar referências confiáveis.'},clock);
  assert.equal(research.result,null);assert.equal(copy.status,'waiting_dependency');
  submitExecution(w,research.id,'Relatório corrigido com referências.');approve(w,'tendencias');
  assert.equal(copy.status,'ready');assert.equal(research.result.availability,'published');
  startExecution(w,copy.id);assert.equal(copy.inputs[0].runId,research.id);assert.equal(copy.inputs[0].period,today);
});
test('aprovação exige conferência e só uma publicação íntegra pode liberar dependências',()=>{
  const w=fresh(),research=get(w,'tendencias');
  assert.throws(()=>reviewExecution(w,research.id,{decision:'approve',checks:['brief']},clock),/Confira/);
  assert.equal(research.status,'in_review');approve(w,'tendencias');
  assert.throws(()=>approve(w,'tendencias'),/não está aguardando/);
  research.result.availability='pending';refreshExecutions(w,clock);assert.equal(get(w,'roteiro').status,'waiting_dependency');
  research.result.availability='published';research.result.runId='outra-execucao';refreshExecutions(w,clock);
  assert.equal(get(w,'roteiro').status,'waiting_dependency');
});
test('tarefas independentes rodam em paralelo e múltiplas dependências exigem todas as aprovações',()=>{
  const w=fresh();assert.equal(get(w,'visual').status,'in_progress');assert.equal(get(w,'edicao').status,'in_progress');
  approve(w,'tendencias');deliver(w,'roteiro');approve(w,'roteiro');deliver(w,'publicacao');approve(w,'publicacao');
  const page=get(w,'pagina');assert.equal(page.status,'waiting_dependency');assert.equal(dependencyStates(w,page).filter(d=>d.satisfied).length,1);
  deliver(w,'visual');approve(w,'visual');assert.equal(page.status,'ready');
  startExecution(w,page.id);assert.equal(page.inputs.length,2);assert.ok(page.inputs.every(i=>i.period===today));
});
test('falha tem motivo, bloqueia dependentes e uma nova tentativa preserva o histórico',()=>{
  const w=fresh(),visual=get(w,'visual');
  interruptExecution(w,visual.id,'failed','Arquivo de referência indisponível.',clock);
  const dep=dependencyStates(w,get(w,'pagina')).find(d=>d.routine.id==='visual');assert.match(dep.reason,/falhou.*referência/);
  const before=visual.history.length;retryExecution(w,visual.id,clock);assert.equal(visual.status,'ready');assert.ok(visual.history.length>before);
  interruptExecution(w,visual.id,'cancelled','Prioridade cancelada pelo diretor.',clock);
  assert.match(dependencyStates(w,get(w,'pagina')).find(d=>d.routine.id==='visual').reason,/cancelada/);
});
test('exceção do último aprovado é explícita e nunca consome um período futuro',()=>{
  const w=fresh(),routine=w.routines.find(r=>r.id==='roteiro');
  saveRoutine(w,{...routine,dependencies:[{routineId:'tendencias',policy:'latest_approved'}]});refreshExecutions(w,clock);
  assert.equal(get(w,'roteiro').status,'ready');startExecution(w,get(w,'roteiro').id);
  assert.equal(get(w,'roteiro').inputs[0].period,'2026-10-31');
  const old=w.executions.filter(e=>e.routineId==='tendencias'&&e.period<today);old.forEach(e=>e.result=null);
  const future=get(w,'tendencias','2026-11-02');future.status='approved';future.result={availability:'published',runId:future.id,id:'future-result'};
  const copy=get(w,'roteiro');copy.status='ready';refreshExecutions(w,clock);assert.equal(copy.status,'waiting_dependency');
});
test('ciclos são rejeitados sem alterar a configuração e execuções iniciadas mantêm seu contexto',()=>{
  const w=fresh(),research=w.routines.find(r=>r.id==='tendencias'),visual=w.routines.find(r=>r.id==='visual');
  assert.throws(()=>saveRoutine(w,{...research,dependencies:[{routineId:'publicacao',policy:'same_period'}]}),/circular/);
  assert.deepEqual(research.dependencies,[]);
  const running=get(w,'visual'),brief=running.brief;saveRoutine(w,{...visual,title:'Visual atualizado',brief:'Novo briefing',dependencies:[{routineId:'tendencias',policy:'same_period'}]});
  assert.equal(running.brief,brief);assert.deepEqual(running.dependencies,[]);
  assert.equal(get(w,'visual','2026-11-02').title,'Visual atualizado');
});
test('data operacional considera o fuso, o horário programado e a virada do ano',()=>{
  assert.equal(operationalDate(new Date('2026-11-02T01:30:00Z'),'America/Sao_Paulo'),'2026-11-01');
  assert.equal(operationalDate(new Date('2026-11-02T01:30:00Z'),'UTC'),'2026-11-02');
  const w=fresh();instantiatePeriod(w,'2027-01-01');refreshExecutions(w,{date:'2027-01-01',time:'07:59'});
  assert.equal(get(w,'tendencias','2027-01-01').status,'scheduled');refreshExecutions(w,{date:'2027-01-01',time:'08:00'});
  assert.equal(get(w,'tendencias','2027-01-01').status,'ready');
});
test('a migração preserva integrantes, conversas e resultados do preview existente',()=>{
  const state=initialState(),before=structuredClone(state.members);ensureRoutines(state,{today});assert.deepEqual(state.members,before);
  const w=state.routineWorkspace;approve(w,'tendencias');ensureRoutines(state,{today});
  assert.equal(state.routineWorkspace,w);assert.equal(get(w,'tendencias').status,'approved');
});
