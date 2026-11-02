import { uid } from './state.js';
import { normalizeReviewPolicy } from './review.js';
import { createPlan, distributePlan, validatePlan, findTask } from './coordination.js';

export const journeyStages=['sending','received','consulting','planning','awaiting_approval','distributing','running'];
export const stageDurations={sending:1500,received:1400,consulting:2000,planning:2300,distributing:900};
export const stageCopy={
  sending:['Pedido a caminho','Seu objetivo está seguindo para o diretor.'],
  received:['O diretor recebeu seu pedido','Objetivo registrado. Nenhuma tarefa deste pedido foi distribuída.'],
  consulting:['Consultando o cérebro da empresa','O diretor reúne as regras da marca e o contexto para este pedido.'],
  planning:['Preparando o plano de trabalho','Organizando entregas, responsáveis e a ordem das dependências.'],
  awaiting_approval:['O plano está pronto para você','Revise as entregas. O time só recebe as tarefas depois da sua aprovação.'],
  distributing:['Distribuindo o trabalho','Cada responsável recebe sua tarefa e o contexto necessário.'],
  running:['O time recebeu o plano','Agentes começam as etapas liberadas. Pessoas recebem tarefas e dependências continuam valendo.'],
};
export const journeyBusy=j=>Boolean(j&&['sending','received','consulting','planning','distributing'].includes(j.phase));
function record(j,phase,now,text){j.phase=phase;j.enteredAt=now;if(j.pausedAt)j.pausedAt=now;j.history.push({id:uid(),phase,at:now,text:text||stageCopy[phase][0]});}
export function beginJourney(state,input,now=Date.now()){
  if(journeyBusy(state.officeJourney))throw new Error('O diretor está organizando o pedido atual. Aguarde esta etapa terminar.');
  const title=String(input.title||'').trim(),brief=String(input.brief||'').trim();
  if(!title||!brief)throw new Error('Conte o nome e o objetivo do pedido.');
  if(!state.members.length)throw new Error('Adicione alguém ao time antes de passar uma tarefa.');
  if(input.preferredMemberId&&!state.members.some(m=>m.id===input.preferredMemberId))throw new Error('O responsável indicado não está no time.');
  const previous=state.officeJourney;
  if(previous?.campaignId){const c=state.campaigns.find(c=>c.id===previous.campaignId);if(c)c.journeyHistory=previous.history;}
  const j=state.officeJourney={id:uid(),title,brief,reviewPolicy:normalizeReviewPolicy(input.reviewPolicy),intake:input.intake?structuredClone(input.intake):null,preferredMemberId:input.preferredMemberId||null,phase:'sending',createdAt:now,enteredAt:now,campaignId:null,history:[],deliveries:[],delivered:0};
  record(j,'sending',now);return j;
}
export function advanceJourney(state,now=Date.now(),force=false){
  const j=state.officeJourney;if(!j||!journeyBusy(j))return false;
  const duration=stageDurations[j.phase];if(!force&&(j.pausedAt||now-j.enteredAt<duration))return false;
  if(j.phase==='sending')record(j,'received',now);
  else if(j.phase==='received')record(j,'consulting',now);
  else if(j.phase==='consulting')record(j,'planning',now);
  else if(j.phase==='planning'){
    const c=createPlan(state,{title:j.title,brief:j.brief,preferredMemberId:j.preferredMemberId,reviewPolicy:j.reviewPolicy,intake:j.intake});j.campaignId=c.id;
    record(j,'awaiting_approval',now);j.pausedAt=null;c.journeyHistory=j.history;
  }else if(j.phase==='distributing'){
    const target=j.deliveries[j.delivered];
    if(target){target.receivedAt=now;j.delivered++;const x=findTask(state,target.sessionId);j.history.push({id:uid(),phase:'delivery',memberId:target.memberId,at:now,text:`${x?.m.name||'Responsável'} recebeu ${x?.s.title||'a tarefa'}.`});}
    j.enteredAt=now;if(j.delivered>=j.deliveries.length)record(j,'running',now);
  }
  const c=state.campaigns.find(c=>c.id===j.campaignId);if(c)c.journeyHistory=j.history;
  return true;
}
export function approveJourney(state,campaignId,now=Date.now()){
  const c=state.campaigns.find(c=>c.id===campaignId);if(!c)throw new Error('Esse plano não está disponível.');
  validatePlan(state,c);
  if(journeyBusy(state.officeJourney))throw new Error('Aguarde a distribuição que está em andamento.');
  distributePlan(state,c);
  let j=state.officeJourney;
  if(j?.campaignId!==c.id)j=state.officeJourney={id:uid(),title:c.title,brief:c.brief,preferredMemberId:c.preferredMemberId||null,campaignId:c.id,createdAt:now,history:c.journeyHistory||[],deliveries:[],delivered:0};
  j.deliveries=c.sessionIds.map(sessionId=>({sessionId,memberId:findTask(state,sessionId).m.id,receivedAt:null}));
  j.delivered=0;j.pausedAt=null;record(j,'distributing',now,'Você aprovou o plano. O diretor está encaminhando as tarefas.');c.journeyHistory=j.history;
  return j;
}
export function journeySnapshot(state,now=Date.now()){
  const j=state.officeJourney;if(!j)return null;
  const tasks=j.deliveries.map(d=>{const x=findTask(state,d.sessionId);return x?{...d,memberId:x.m.id,name:x.m.name,type:x.m.type,title:x.s.title,status:x.s.status,step:x.s.step}:null;}).filter(Boolean);
  const elapsed=Math.max(0,Math.min(1,((j.pausedAt||now)-j.enteredAt)/(stageDurations[j.phase]||1)));
  return {id:j.id,phase:j.phase,title:j.title,campaignId:j.campaignId,enteredAt:j.enteredAt,pausedAt:j.pausedAt||null,elapsed,delivered:j.delivered,total:tasks.length,tasks,
    focusMember:j.phase==='distributing'?j.deliveries[j.delivered]?.memberId:null,
    planningCount:state.campaigns.find(c=>c.id===j.campaignId)?.plan.tasks.length||0,
    completed:tasks.length>0&&tasks.every(t=>t.status==='done'),
  };
}
export function pauseJourney(state,now=Date.now()){
  const j=state.officeJourney;if(!journeyBusy(j))return;
  if(j.pausedAt){j.enteredAt+=now-j.pausedAt;j.pausedAt=null;}else j.pausedAt=now;
}
