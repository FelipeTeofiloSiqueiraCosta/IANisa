import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState } from '../src/state.js';
import { ensureCoordination, createPlan, findTask, saveKnowledge } from '../src/coordination.js';
import { beginJourney, advanceJourney, approveJourney, pauseJourney, journeySnapshot } from '../src/journey.js';

const fresh=()=>ensureCoordination(initialState());
const input={title:'Campanha de lançamento',brief:'Criar peças, vídeos e página com as regras da empresa.'};
const count=s=>s.members.reduce((n,m)=>n+m.sessions.length,0);
function ready(s){beginJourney(s,input,10000);for(let i=1;i<=4;i++)advanceJourney(s,10000+i*3000,true);return s.officeJourney;}

test('o pedido percorre recebimento, cérebro e planejamento sem criar tarefas antes da aprovação',()=>{
  const s=fresh(),before=count(s),j=beginJourney(s,input,10000);
  assert.equal(s.campaigns.length,0);assert.equal(j.phase,'sending');assert.equal(count(s),before);
  assert.equal(advanceJourney(s,11499),false);advanceJourney(s,11500);assert.equal(j.phase,'received');
  advanceJourney(s,12900);assert.equal(j.phase,'consulting');advanceJourney(s,14900);assert.equal(j.phase,'planning');
  assert.equal(s.campaigns.length,0);advanceJourney(s,17200);assert.equal(j.phase,'awaiting_approval');
  assert.equal(s.campaigns.length,1);assert.equal(count(s),before);assert.equal(advanceJourney(s,999999),false);
  assert.deepEqual(j.history.map(e=>e.phase),['sending','received','consulting','planning','awaiting_approval']);
});
test('uma confirmação cria sessões uma única vez, mantendo tarefas humanas e dependências',()=>{
  const s=fresh(),j=ready(s),before=count(s);approveJourney(s,j.campaignId,30000);
  assert.equal(j.phase,'distributing');assert.equal(j.delivered,0);assert.equal(count(s),before+j.deliveries.length);
  const tasks=j.deliveries.map(d=>findTask(s,d.sessionId));
  assert.ok(tasks.some(x=>x.m.type==='human'&&x.s.status==='assigned'));
  assert.ok(tasks.some(x=>x.s.status==='blocked'));assert.ok(tasks.some(x=>x.m.type==='robot'&&x.s.status==='working'));
  const after=count(s);assert.throws(()=>approveJourney(s,j.campaignId),/já foi distribuído/);assert.equal(count(s),after);
});
test('a animação de envio registra cada recebimento sem duplicar trabalho e termina com todos recebidos',()=>{
  const s=fresh(),j=ready(s);approveJourney(s,j.campaignId,30000);const before=count(s),n=j.deliveries.length;
  assert.equal(advanceJourney(s,30899),false);advanceJourney(s,30900);assert.equal(j.delivered,1);
  assert.equal(j.deliveries[0].receivedAt,30900);assert.equal(j.phase,'distributing');
  for(let i=1;i<n;i++)advanceJourney(s,30900+i*900);
  assert.equal(j.phase,'running');assert.equal(j.delivered,n);assert.equal(count(s),before);
  assert.equal(j.history.filter(e=>e.phase==='delivery').length,n);assert.ok(j.deliveries.every(d=>d.receivedAt));
  assert.equal(advanceJourney(s,999999),false);
});
test('o cérebro desatualizado bloqueia aprovação sem distribuir nenhuma tarefa',()=>{
  const s=fresh(),j=ready(s),before=count(s);
  saveKnowledge(s,{title:'Nova regra',category:'direction',content:'Revisar todas as peças antes de publicar.'});
  assert.throws(()=>approveJourney(s,j.campaignId),/cérebro foi atualizado/);
  assert.equal(j.phase,'awaiting_approval');assert.equal(j.deliveries.length,0);assert.equal(count(s),before);
});
test('pausar congela a etapa; continuar mantém o tempo restante e avançar manualmente permanece disponível',()=>{
  const s=fresh(),j=beginJourney(s,input,10000);pauseJourney(s,10500);
  assert.equal(advanceJourney(s,14000),false);assert.equal(journeySnapshot(s,999999).elapsed,1/3);
  pauseJourney(s,14000);assert.equal(j.enteredAt,13500);assert.equal(advanceJourney(s,14999),false);
  advanceJourney(s,15000);assert.equal(j.phase,'received');pauseJourney(s,15100);
  advanceJourney(s,16000,true);assert.equal(j.phase,'consulting');assert.equal(j.pausedAt,16000);
});
test('recarregar durante a distribuição conserva os recebimentos e o histórico de origem',()=>{
  let s=fresh();const j=ready(s);approveJourney(s,j.campaignId,30000);advanceJourney(s,30900);s=JSON.parse(JSON.stringify(s));
  const before=count(s);advanceJourney(s,31800);assert.equal(s.officeJourney.delivered,2);assert.equal(count(s),before);
  assert.equal(s.campaigns.find(c=>c.id===j.campaignId).journeyHistory.filter(e=>e.phase==='delivery').length,2);
});
test('outro pedido não sobrescreve uma preparação ativa e planos anteriores ficam disponíveis para aprovação',()=>{
  const s=fresh(),j=beginJourney(s,input,10000);
  assert.throws(()=>beginJourney(s,{...input,title:'Outro pedido'},10100),/pedido atual/);assert.equal(s.officeJourney,j);
  for(let i=1;i<=4;i++)advanceJourney(s,10000+i*3000,true);
  const oldCampaign=j.campaignId;beginJourney(s,{...input,title:'Segundo pedido'},30000);
  const before=count(s);assert.throws(()=>approveJourney(s,oldCampaign),/andamento/);assert.equal(count(s),before);
  for(let i=1;i<=4;i++)advanceJourney(s,30000+i*3000,true);
  approveJourney(s,oldCampaign,50000);assert.equal(s.officeJourney.campaignId,oldCampaign);
  assert.equal(s.campaigns.length,2);
});
test('um plano já criado pode entrar na distribuição visual e a tarefa específica segue para o responsável indicado',()=>{
  const s=fresh(),c=createPlan(s,{...input,preferredMemberId:'vico'}),before=count(s);approveJourney(s,c.id,10000);
  assert.equal(s.officeJourney.deliveries.length,1);assert.equal(s.officeJourney.deliveries[0].memberId,'vico');
  assert.equal(count(s),before+1);assert.ok(!s.members.some(m=>m.id==='requester'));
  const t=journeySnapshot(s);assert.equal(t.tasks[0].name,'Vico');assert.equal(t.focusMember,'vico');
});
test('avançar o planejamento em pausa não deixa a distribuição presa depois da aprovação',()=>{
  const s=fresh(),j=beginJourney(s,input,10000);pauseJourney(s,10100);
  for(let i=1;i<=4;i++)advanceJourney(s,11000+i*1000,true);
  assert.equal(j.phase,'awaiting_approval');assert.equal(j.pausedAt,null);
  approveJourney(s,j.campaignId,20000);assert.equal(j.pausedAt,null);
  advanceJourney(s,20900);assert.equal(j.delivered,1);
});
