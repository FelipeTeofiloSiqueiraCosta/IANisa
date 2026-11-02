import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState } from '../src/state.js';
import { ensureCoordination, createPlan, distributePlan, findTask, submitForReview, processTaskReviews, reviewTask } from '../src/coordination.js';
import { ensureRoutines, reviewExecution, runId } from '../src/routines.js';
import { approvedTaskKnowledge, publishTaskResult, ensureTaskKnowledge, taskKnowledgeFiles, taskKnowledgeFolders, consultTaskKnowledge, taskFolderPath } from '../src/task-knowledge.js';
const fresh=()=>ensureCoordination(initialState());
function prepare(){const state=fresh(),c=createPlan(state,{title:'Black Friday coleção',brief:'Campanha da coleção com vídeos verticais.',intake:{history:[{role:'assistant',text:'Para quem?'},{role:'user',text:'Clientes da coleção.'}],answers:{assets:'Pasta de referências.'}}});distributePlan(state,c);return {state,c,task:findTask(state,c.sessionIds.find(id=>findTask(state,id).m.id==='lia')).s};}
function approve(state,task){submitForReview(state,task,'Calendário da coleção Black Friday com vídeos verticais.',{now:1000});processTaskReviews(state,4000);}

test('aprovar publica o resultado automaticamente na TSK, com origem, sem alterar regras da organização',()=>{
  const {state,task}=prepare(),rules=structuredClone(state.brain);assert.equal(approvedTaskKnowledge(state).length,0);approve(state,task);
  const [saved]=approvedTaskKnowledge(state);assert.equal(saved.content,task.delivery);assert.equal(saved.taskId,task.id);assert.match(saved.path,/^TSK\/.+\/resultado-aprovado\.md$/);assert.deepEqual(state.brain,rules);
});
test('a pasta TSK reúne entrevista, briefing, plano, textos, dados, anotações e colaboração',()=>{
  const {state,task}=prepare();task.notes=[{role:'note',text:'Ajustar a abertura do vídeo.',time:'10:00'}];task.messages.push({role:'assistant',text:'Texto desenvolvido pelo agente.',time:'10:01'});task.queued=['Orientação para o próximo passo.'];
  const files=taskKnowledgeFiles(state,'session',task.id),get=name=>files.find(f=>f.name===name)?.content;
  assert.match(get('briefing.md'),/Campanha da coleção/);assert.match(get('entrevista.md'),/Clientes da coleção/);assert.match(get('planejamento.md'),/Entregas|conteúdo|canais/);assert.match(get('textos-e-conversa.md'),/Texto desenvolvido/);assert.match(get('anotacoes.md'),/abertura/);assert.match(get('dados.json'),/Orientação para o próximo passo/);assert.match(get('colaboracao.md'),/Preciso/);
  task.notes.push({role:'note',text:'Nova informação vinculada à tarefa.'});assert.match(taskKnowledgeFiles(state,'session',task.id).find(f=>f.name==='anotacoes.md').content,/Nova informação/);
});
test('rascunhos e versões devolvidas ficam na pasta, mas não aparecem como resultados aprovados',()=>{
  const {state,task}=prepare();submitForReview(state,task,'Versão com cor divergente.',{scenario:'changes',now:1000});processTaskReviews(state,4000);
  assert.equal(approvedTaskKnowledge(state).length,0);assert.throws(()=>publishTaskResult(state,task),/Apenas resultados aprovados/);
  const files=taskKnowledgeFiles(state,'session',task.id);assert.ok(files.some(f=>f.name==='entrega-em-revisao.md'));assert.match(files.find(f=>f.name==='revisoes.md').content,/Versão com cor divergente/);assert.ok(!files.some(f=>f.name==='resultado-aprovado.md'));
});
test('retomar e sincronizar não duplica a publicação; o resultado aprovado é preservado',()=>{
  const {state,task}=prepare();approve(state,task);const saved=structuredClone(task.knowledgeResult),copy=JSON.parse(JSON.stringify(state));ensureTaskKnowledge(copy);ensureTaskKnowledge(copy);
  const restored=findTask(copy,task.id).s;assert.equal(restored.knowledgeHistory.length,1);assert.deepEqual(restored.knowledgeResult,saved);restored.delivery='Outra versão ainda não aprovada';assert.equal(approvedTaskKnowledge(copy)[0].content,saved.content);
});
test('o diretor consulta conhecimento relevante da TSK e inclui a origem no novo plano',()=>{
  const {state,task}=prepare();approve(state,task);const references=consultTaskKnowledge(state,'Nova coleção Black Friday com vídeos verticais.');assert.equal(references.length,1);assert.equal(references[0].sourceId,task.id);
  const next=createPlan(state,{title:'Outra campanha Black Friday',brief:'Usar a referência de vídeos verticais da coleção.'});assert.equal(next.plan.taskKnowledge[0].path,task.knowledgeResult.path);assert.equal(consultTaskKnowledge(state,'Tema completamente desconhecido xyzzy').length,0);
});
test('a confirmação humana adicional também publica automaticamente depois da decisão',()=>{
  const {state,task,c}=prepare();c.plan.reviewPolicy.mode='human';submitForReview(state,task,'Conteúdo da coleção.',{now:1000});processTaskReviews(state,4000);assert.equal(approvedTaskKnowledge(state).length,0);
  reviewTask(state,task,{decision:'approve',actor:'user',checks:['brief','brand','quality']});assert.equal(approvedTaskKnowledge(state)[0].actor,'user');
});
test('resultados de rotinas aprovadas entram na mesma base TSK, com período e referência corretos',()=>{
  const today='2026-11-01',state=ensureRoutines(fresh(),{today}),ws=state.routineWorkspace,e=ws.executions.find(e=>e.id===runId('tendencias',today));
  reviewExecution(ws,e.id,{decision:'approve',checks:['brief','brand','quality']},{date:today,time:'09:00'});
  const saved=approvedTaskKnowledge(state).find(k=>k.sourceId===e.id);assert.match(saved.path,/TSK\/rotinas\/tendencias\/2026-11-01\/resultado-aprovado.md/);assert.equal(saved.content,e.delivery.content);assert.ok(taskKnowledgeFiles(state,'routine',e.id).some(f=>f.name==='resultado-aprovado.md'));
});
test('a migração indexa apenas entregas já aprovadas e os segmentos de caminho ficam isolados',()=>{
  const {state,task}=prepare();approve(state,task);delete task.knowledgeResult;delete task.knowledgeHistory;ensureTaskKnowledge(state);
  assert.equal(approvedTaskKnowledge(state).length,1);assert.ok(taskKnowledgeFolders(state).some(f=>f.id===task.id));
  assert.equal(taskFolderPath(state,{id:'../fora',campaignId:'..'}).includes('/../'),false);
});
