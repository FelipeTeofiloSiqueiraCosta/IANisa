import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState } from '../src/state.js';
import { ensureCoordination, distributePlan, findTask } from '../src/coordination.js';
import { beginJourney, advanceJourney } from '../src/journey.js';
import { createPresentationState } from '../src/presentation.js';
import { createIntakeDraft, recordIntakeRequest, nextIntakeQuestion, answerIntakeQuestion, confirmIntake, intakeSummary, interviewExample } from '../src/intake.js';
const fresh=()=>ensureCoordination(initialState());
function complete(draft){let q;while((q=nextIntakeQuestion(draft)))answerIntakeQuestion(draft,q.id,interviewExample.answers[q.id]);return draft;}

test('entrevistar não cria campanha ou tarefa e exige completar e conferir o briefing antes de enviar',()=>{
  const state=fresh(),draft=createIntakeDraft(),baseline=structuredClone(state);recordIntakeRequest(draft,interviewExample.request);
  assert.throws(()=>confirmIntake(state,draft),/Conclua a conversa/);assert.deepEqual(state,baseline);
  complete(draft);const input=confirmIntake(state,draft);assert.ok(input.intake.confirmedAt);assert.deepEqual(state,baseline);
  beginJourney(state,input,1000);assert.equal(state.campaigns.length,0);assert.deepEqual(state.members,baseline.members);
});
test('canais e formatos já informados no pedido não são perguntados outra vez',()=>{
  const draft=createIntakeDraft();recordIntakeRequest(draft,interviewExample.request);
  assert.match(draft.answers.deliverables,/30 segundos/);assert.match(draft.answers.channels,/Instagram/);assert.equal(draft.sources.channels,'request');
  const asked=[];while(nextIntakeQuestion(draft)){const q=nextIntakeQuestion(draft);asked.push(q.id);answerIntakeQuestion(draft,q.id,interviewExample.answers[q.id]);}
  assert.deepEqual(asked,['audience','deadline','offer','assets']);
});
test('um briefing completo passa direto ao resumo, sem perguntas redundantes',()=>{
  const draft=createIntakeDraft();recordIntakeRequest(draft,'Criar uma campanha.\nPúblico: Clientes atuais.\nEntregas: 2 vídeos de 30 segundos.\nCanais: Instagram.\nPrazo: 20/11/2026.\nOferta: Sem desconto.\nMateriais: Roteiro aprovado.');
  assert.equal(nextIntakeQuestion(draft),null);assert.equal(draft.stage,'summary');assert.equal(draft.history.length,1);
});
test('o público, prazo, oferta, referências e regras geram os critérios sem outra pergunta subjetiva',()=>{
  const state=fresh(),draft=complete(recordIntakeRequest(createIntakeDraft(),interviewExample.request)),input=confirmIntake(state,draft);
  for(const answer of Object.values(draft.answers))assert.ok(input.reviewPolicy.criteria.includes(answer));
  assert.ok(input.reviewPolicy.criteria.includes(state.brain.entries[0].title));assert.equal(input.reviewPolicy.mode,'director');assert.equal(input.intake.brainRevision,state.brain.revision);
  assert.equal(intakeSummary(state,draft).items.length,6);
});
test('uma edição de vídeo é uma entrega específica do editor e não entrevista sobre oferta comercial',()=>{
  const state=fresh(),draft=complete(recordIntakeRequest(createIntakeDraft(),'Preciso editar um vídeo vertical de 30 segundos para Instagram Reels.'));
  assert.equal(draft.scope,'single');assert.equal(draft.answers.offer,undefined);
  const input=confirmIntake(state,draft);assert.equal(input.preferredMemberId,'lucas');beginJourney(state,input,1000);
  for(let i=0;i<4;i++)advanceJourney(state,2000+i*3000,true);
  const c=state.campaigns[0];assert.equal(c.plan.tasks.length,1);assert.equal(c.plan.tasks[0].memberId,'lucas');
});
test('respostas, transcrição e critérios acompanham o diretor, o plano e a sessão criada',()=>{
  const state=fresh(),draft=complete(recordIntakeRequest(createIntakeDraft(),interviewExample.request)),input=confirmIntake(state,draft);
  beginJourney(state,input,1000);input.intake.answers.deadline='Alteração fora do estado';for(let i=0;i<4;i++)advanceJourney(state,2000+i*3000,true);
  const c=state.campaigns[0];assert.notEqual(c.intake.answers.deadline,'Alteração fora do estado');assert.ok(c.intake.history.length>1);assert.ok(c.brief.includes(interviewExample.answers.assets));
  distributePlan(state,c);const task=findTask(state,c.sessionIds[0]);assert.ok(task.s.messages[0].text.includes(interviewExample.answers.deadline));
});
test('editar um ponto do resumo conserva as outras respostas e atualiza os critérios',()=>{
  const state=fresh(),draft=complete(recordIntakeRequest(createIntakeDraft(),interviewExample.request)),before={...draft.answers};draft.editingKey='deadline';draft.stage='questions';
  answerIntakeQuestion(draft,'deadline','Até 18/11, às 12h.');assert.equal(draft.stage,'summary');assert.equal(draft.answers.offer,before.offer);
  const input=confirmIntake(state,draft);assert.match(input.reviewPolicy.criteria,/18\/11/);assert.ok(!input.reviewPolicy.criteria.includes(before.deadline));
});
test('retomar a entrevista conserva a pergunta atual e a apresentação não reutiliza o rascunho original',()=>{
  const state=fresh(),draft=recordIntakeRequest(createIntakeDraft(),interviewExample.request);answerIntakeQuestion(draft,'audience','Clientes da coleção.');draft.answerDrafts.deadline='Até sexta';state.intakeDraft=draft;
  const restored=JSON.parse(JSON.stringify(state));assert.equal(nextIntakeQuestion(restored.intakeDraft).id,'deadline');assert.equal(restored.intakeDraft.answerDrafts.deadline,'Até sexta');
  const demo=createPresentationState(state);assert.equal(demo.intakeDraft,undefined);assert.deepEqual(state.intakeDraft,draft);
});
test('não inventa preço ou data quando o usuário delega a definição ao planejamento',()=>{
  const state=fresh(),draft=recordIntakeRequest(createIntakeDraft(),interviewExample.request);answerIntakeQuestion(draft,'audience','Clientes.');
  for(const id of ['deadline','offer']){const q=nextIntakeQuestion(draft);assert.equal(q.id,id);answerIntakeQuestion(draft,id,q.alternative);}
  answerIntakeQuestion(draft,'assets','Produzir do zero.');const input=confirmIntake(state,draft);assert.match(input.brief,/Não divulgar preço ou desconto/);assert.match(input.brief,/propor um prazo/);
});
