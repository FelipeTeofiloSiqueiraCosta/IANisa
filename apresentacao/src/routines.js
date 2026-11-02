import { routineFolderPath } from './task-knowledge.js';
import { uid } from './state.js';
import { beginDirectorReview, evaluateDirectorReview, normalizeReviewPolicy } from './review.js';

export const executionLabels = {
  scheduled:'Agendada', waiting_dependency:'Aguardando dependência', ready:'Pronta para começar',
  in_progress:'Em execução', in_review:'Na revisão do diretor', changes_requested:'Correções solicitadas',
  approved:'Aprovada · resultado liberado', failed:'Falhou', cancelled:'Cancelada',
};
export const DEFAULT_ZONE = 'America/Sao_Paulo';
export function operationalDate(now=new Date(),timeZone=DEFAULT_ZONE){
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
  return ['year','month','day'].map(type=>parts.find(p=>p.type===type).value).join('-');
}
export function shiftDate(period,days){const d=new Date(period+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10);}
const event=(e,text,kind='info')=>(e.history??=[]).push({id:uid(),at:new Date().toISOString(),text,kind});
export const runId=(routineId,period)=>`execution:${routineId}:${period}`;
export const routineFor=(ws,e)=>ws.routines.find(r=>r.id===e.routineId);
export function instantiatePeriod(ws,period){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(period)||Number.isNaN(Date.parse(period+'T12:00:00Z'))||new Date(period+'T12:00:00Z').toISOString().slice(0,10)!==period)throw new Error('Escolha uma data válida.');
  for(const r of ws.routines){
    const id=runId(r.id,period);if(ws.executions.some(e=>e.id===id))continue;
    const e={id,routineId:r.id,period,timeZone:r.timeZone,title:r.title,brief:r.brief,ownerId:r.ownerId,time:r.time,
      dependencies:structuredClone(r.dependencies),reviewPolicy:normalizeReviewPolicy(r.reviewPolicy),status:'scheduled',delivery:null,result:null,history:[]};
    event(e,`Execução criada para ${period}, às ${r.time}, no fuso ${r.timeZone}.`);ws.executions.push(e);
  }
  return ws.executions.filter(e=>e.period===period);
}
export function dependencyStates(ws,e){
  return e.dependencies.map(dep=>{
    const candidates=ws.executions.filter(x=>x.routineId===dep.routineId&&x.period<=e.period);
    const source=dep.policy==='latest_approved'
      ? candidates.filter(x=>x.status==='approved'&&x.result?.availability==='published').sort((a,b)=>b.period.localeCompare(a.period))[0]
      : candidates.find(x=>x.period===e.period);
    const satisfied=Boolean(source?.status==='approved'&&source.result?.availability==='published'&&source.result.runId===source.id);
    const routine=ws.routines.find(r=>r.id===dep.routineId);
    const label=routine?.title||'Rotina indisponível';
    let reason=satisfied?`Resultado aprovado de ${source.period}`:!source?`Aguardando ${label} de ${e.period}`:source.status==='failed'?`${label} falhou: ${source.failure}`:source.status==='cancelled'?`${label} foi cancelada`:source.status==='in_review'?`${label} aguarda aprovação do diretor`:source.status==='changes_requested'?`${label} precisa de correções do responsável`:`Aguardando o resultado aprovado de ${label}`;
    return {dependency:dep,source,routine,satisfied,reason};
  });
}
export function refreshExecutions(ws,{date=operationalDate(),time='09:00'}={}){
  for(const e of ws.executions){
    if(!['scheduled','waiting_dependency','ready'].includes(e.status))continue;
    const due=e.period<date||(e.period===date&&e.time<=time);
    const next=!due?'scheduled':dependencyStates(ws,e).every(d=>d.satisfied)?'ready':'waiting_dependency';
    if(next!==e.status){e.status=next;event(e,next==='ready'?'Todas as entregas obrigatórias estão aprovadas. Execução liberada.':next==='scheduled'?'Aguardando a data e o horário programados.':'Execução bloqueada até receber as entregas aprovadas.');}
  }
}
export function validateRoutine(ws,r){
  if(!String(r.title||'').trim()||!r.ownerId||!/^([01]\d|2[0-3]):[0-5]\d$/.test(r.time))throw new Error('Confira o título, o responsável e o horário.');
  try{new Intl.DateTimeFormat('pt-BR',{timeZone:r.timeZone}).format(new Date());}catch{throw new Error('Escolha um fuso horário válido.');}
  const routines=[...ws.routines.filter(x=>x.id!==r.id),r];
  for(const dep of r.dependencies){if(!routines.some(x=>x.id===dep.routineId)||!['same_period','latest_approved'].includes(dep.policy))throw new Error('Confira as dependências escolhidas.');}
  const visit=(id,path=new Set())=>{if(path.has(id))throw new Error('Essas dependências criam uma espera circular. Escolha outra sequência.');const current=routines.find(x=>x.id===id);for(const dep of current?.dependencies||[])visit(dep.routineId,new Set([...path,id]));};
  routines.forEach(x=>visit(x.id));
}
export function saveRoutine(ws,input){
  const r={id:input.id||uid(),title:String(input.title||'').trim(),ownerId:input.ownerId,time:input.time,timeZone:input.timeZone||DEFAULT_ZONE,frequency:'daily',reviewPolicy:normalizeReviewPolicy(input.reviewPolicy),dependencies:input.dependencies||[],brief:String(input.brief||'').trim()};
  validateRoutine(ws,r);const previous=ws.routines.find(x=>x.id===r.id);
  if(previous)Object.assign(previous,r);else ws.routines.push(r);
  // Executions already started retain their original briefing and dependency snapshot.
  for(const e of ws.executions.filter(x=>x.routineId===r.id&&['scheduled','waiting_dependency','ready'].includes(x.status))){Object.assign(e,{title:r.title,brief:r.brief,ownerId:r.ownerId,time:r.time,timeZone:r.timeZone,reviewPolicy:normalizeReviewPolicy(r.reviewPolicy),dependencies:structuredClone(r.dependencies)});event(e,'O diretor atualizou a configuração antes do início desta execução.');}
  return r;
}
export function startExecution(ws,id){
  const e=ws.executions.find(x=>x.id===id);if(!e||e.status!=='ready'||!dependencyStates(ws,e).every(d=>d.satisfied))throw new Error('Esta tarefa ainda não está liberada para começar.');
  e.status='in_progress';e.inputs=dependencyStates(ws,e).map(d=>({runId:d.source.id,resultId:d.source.result.id,path:d.source.result.path,period:d.source.period}));
  event(e,`Trabalho iniciado com ${e.inputs.length} resultado(s) aprovado(s) como referência.`);return e;
}
export function submitExecution(ws,id,content){
  const e=ws.executions.find(x=>x.id===id);if(!e||!['in_progress','changes_requested'].includes(e.status))throw new Error('Comece a tarefa antes de enviar uma entrega.');
  if(!String(content||'').trim())throw new Error('Descreva o resultado entregue.');
  e.delivery={id:uid(),content:String(content).trim(),availability:'pending',submittedAt:new Date().toISOString()};
  e.status='in_review';event(e,'Entrega pendente salva. O diretor foi notificado; o resultado ainda não foi liberado.','review');return e;
}
export function reviewExecution(ws,id,{decision,feedback='',checks=[],actor='director'},clock){
  const e=ws.executions.find(x=>x.id===id);if(!e||e.status!=='in_review'||!e.delivery)throw new Error('Esta execução não está aguardando revisão.');
  if(actor==='user'&&e.review?.status!=='awaiting_user')throw new Error('O diretor ainda não solicitou sua decisão.');
  if(decision==='approve'){
    if(!['brief','brand','quality'].every(c=>checks.includes(c)))throw new Error('Confira o objetivo, as regras da empresa e a qualidade.');
    e.status='approved';e.result={id:uid(),runId:e.id,content:e.delivery.content,availability:'published',approvedAt:new Date().toISOString(),path:routineFolderPath(e)+'/resultado-aprovado.md'};
    event(e,actor==='user'?'Diretor conferiu a entrega e recebeu a confirmação humana solicitada. Resultado liberado (simulação).':'Diretor aprovou a entrega. Resultado disponibilizado automaticamente no conhecimento da pasta TSK (simulação).','approved');
    refreshExecutions(ws,clock);
  }else if(decision==='changes'){
    if(!String(feedback).trim())throw new Error('Explique o ajuste necessário.');
    e.status='changes_requested';e.feedback=String(feedback).trim();event(e,(actor==='user'?'Usuário definiu a correção, encaminhada pelo diretor: ':'Diretor solicitou correções: ')+e.feedback,'changes');
  }else throw new Error('Parecer inválido.');
  if(e.review){e.review.status=decision==='approve'?'approved':'changes';e.review.feedback=feedback;e.review.actor=actor;e.review.history.push({decision,actor,feedback,evaluation:structuredClone(e.review.evaluation),delivery:e.delivery.content});}
  return e;
}
export function scheduleExecutionReview(state,e,{scenario='pass',now=Date.now()}={}){
  if(e.status!=='in_review'||!e.delivery)throw new Error('Envie uma entrega antes da revisão.');
  e.review=beginDirectorReview(state,e.reviewPolicy,scenario,e.review,now);
}
export function processExecutionReviews(state,now=Date.now(),clock){
  const ws=state.routineWorkspace,results=[];
  for(const e of ws.executions){
    if(e.status!=='in_review'||e.review?.engine!=='director-preview-v1'||e.review.status!=='pending'||e.review.dueAt>now)continue;
    const evaluation=evaluateDirectorReview(state,e.review);e.review.evaluation=evaluation;
    if(evaluation.decision==='awaiting_user'){e.review.status='awaiting_user';event(e,evaluation.feedback,'review');}
    else reviewExecution(ws,e.id,{...evaluation,actor:'director'},clock);
    results.push(e);
  }
  return results;
}
export function interruptExecution(ws,id,kind,reason,clock){
  const e=ws.executions.find(x=>x.id===id);if(!e||['approved','cancelled'].includes(e.status)||!['failed','cancelled'].includes(kind))throw new Error('Esta execução não pode ser interrompida.');
  if(!String(reason||'').trim())throw new Error('Informe o motivo para o diretor acompanhar.');
  e.status=kind;e.failure=String(reason).trim();event(e,(kind==='failed'?'Falha reportada ao diretor: ':'Execução cancelada: ')+e.failure,kind);refreshExecutions(ws,clock);return e;
}
export function retryExecution(ws,id,clock){
  const e=ws.executions.find(x=>x.id===id);if(!e||e.status!=='failed')throw new Error('Somente uma execução com falha pode ser tentada novamente.');
  e.status='scheduled';e.failure=null;event(e,'Diretor solicitou uma nova tentativa. As dependências serão verificadas novamente.');refreshExecutions(ws,clock);return e;
}
export function ensureRoutines(state,{today=operationalDate()}={}){
  if(!state.routineWorkspace){
    const owner=(pattern,fallback=0)=>state.members.find(m=>pattern.test(m.role))?.id||state.members[fallback]?.id;
    const definitions=[
      ['tendencias','Pesquisar tendências de IA',owner(/videomaker/i),'08:00',[],'Pesquisar cinco tendências relevantes e entregar um relatório com fontes e oportunidades para a marca.'],
      ['roteiro','Criar o roteiro do dia',owner(/copy/i),'08:15',['tendencias'],'Usar a pesquisa aprovada do mesmo dia para criar um roteiro de vídeo com o tom da marca.'],
      ['publicacao','Preparar a publicação',owner(/social/i),'08:30',['roteiro'],'Preparar o texto e os formatos de publicação a partir do roteiro aprovado. Nenhuma publicação real acontece neste preview.'],
      ['visual','Criar o visual da campanha',owner(/^designer$/i),'08:00',[],'Desenvolver as peças visuais seguindo a identidade da empresa.'],
      ['edicao','Editar o vídeo institucional',owner(/editor/i),'08:00',[],'Editar um vídeo já roteirizado. Esta rotina independente pode acontecer em paralelo com a pesquisa e o design.'],
      ['metricas','Conferir os anúncios',owner(/tráfego/i),'08:00',[],'Reunir os indicadores dos anúncios para o diretor avaliar.'],
      ['pagina','Montar a página da campanha',owner(/web/i),'08:45',['publicacao','visual'],'Usar a publicação e o visual aprovados do mesmo dia para preparar a página. Aguardar as duas entregas.'],
    ];
    const ws=state.routineWorkspace={version:1,timeZone:DEFAULT_ZONE,demoDate:today,routines:[],executions:[]};
    ws.routines=definitions.filter(d=>d[2]).map(([id,title,ownerId,time,deps,brief])=>({id,title,ownerId,time,timeZone:DEFAULT_ZONE,frequency:'daily',dependencies:deps.map(routineId=>({routineId,policy:'same_period'})),brief}));
    const yesterday=shiftDate(today,-1);instantiatePeriod(ws,yesterday);instantiatePeriod(ws,today);instantiatePeriod(ws,shiftDate(today,1));
    const previous=ws.executions.find(e=>e.routineId==='tendencias'&&e.period===yesterday);
    if(previous){previous.status='approved';previous.result={id:uid(),runId:previous.id,availability:'published',content:'Relatório de tendências do dia anterior, disponível apenas para consulta ou exceção explícita.',path:`rotinas/tendencias/execucoes/${yesterday}/resultados/entrega.md`,approvedAt:new Date().toISOString()};event(previous,'Resultado de ontem aprovado. Ele não substitui automaticamente a pesquisa de hoje.','approved');}
    refreshExecutions(ws,{date:today,time:'09:00'});
    const research=ws.executions.find(e=>e.routineId==='tendencias'&&e.period===today);
    if(research){startExecution(ws,research.id);submitExecution(ws,research.id,'Relatório de exemplo: cinco tendências de IA, referências e sugestões de conteúdo. Material preparado para conferência do diretor; substitua pelas fontes da sua empresa.');}
    for(const id of ['visual','edicao']){const e=ws.executions.find(e=>e.routineId===id&&e.period===today);if(e?.status==='ready')startExecution(ws,e.id);}
    const metrics=ws.executions.find(e=>e.routineId==='metricas'&&e.period===today);if(metrics)interruptExecution(ws,metrics.id,'failed','Conexão com Meta Ads indisponível no cenário de exemplo.',{date:today,time:'09:00'});
  }
  instantiatePeriod(state.routineWorkspace,today);instantiatePeriod(state.routineWorkspace,shiftDate(today,1));
  refreshExecutions(state.routineWorkspace,{date:today,time:'09:00'});return state;
}
