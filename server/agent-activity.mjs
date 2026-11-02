const phases={context:'Preparando o contexto da marca e as skills',connectors:'Conectando os serviços disponíveis',connecting:'Conectando ao Claude',session:'Iniciando a conversa com o Claude',responding:'Preparando a resposta',saving:'Salvando a resposta'};
const states=new Set(['running','waiting','completed','failed','cancelled','interrupted']);
export function newActivity(requestId,at){return {requestId,status:'running',startedAt:at,steps:[]};}
// Só recebe eventos operacionais estruturados. Texto de pensamento, argumentos e
// saídas brutas das ferramentas nunca são copiados para a atividade persistida.
export function applyActivity(activity,event,at){
  if(activity.status!=='running')return false;
  if(event.type==='model'){
    const id=event.model?.id;
    if(typeof id!=='string'||!/^(default|claude-[a-z0-9._:-]+|(?:opus|sonnet|haiku)(?:[a-z0-9._:-]*))$/i.test(id)||id.length>100)return false;
    const name=typeof event.model?.name==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9 ._():/+-]{0,79}$/.test(event.model.name)?event.model.name:null;
    const next={provider:'claude',id,...(name?{name}:{})};
    if(JSON.stringify(activity.model)===JSON.stringify(next))return false;
    activity.model=next;return true;
  }
  const phase=event.type==='phase'&&phases[event.id],tool=event.type==='tool';
  if(!phase&&!tool)return false;
  let id=phase?'phase:'+event.id:'tool:'+String(event.id).slice(0,150);
  let step=activity.steps.find(s=>s.id===id);
  if(phase&&step?.status!=='running'&&step){id+=':'+activity.steps.length;step=null;}
  const status=phase?'running':states.has(event.status)?event.status:'running';
  const label=phase||String(event.label||'Usando conector').slice(0,100);
  if(step&&['completed','failed','cancelled','interrupted'].includes(step.status))return false;
  if(step&&step.status===status)return false;
  if(!step){
    if(activity.steps.length>=60)return false;
    for(const previous of activity.steps)if(previous.type==='phase'&&previous.status==='running'){previous.status='completed';previous.finishedAt=at;}
    step={id,type:phase?'phase':'tool',label,status,startedAt:at};activity.steps.push(step);
  }else step.status=status;
  step.updatedAt=at;
  if(!['running','waiting'].includes(status))step.finishedAt=at;
  return true;
}
export function finishActivity(activity,status,at){
  if(!activity||activity.status!=='running')return;
  activity.status=status;activity.finishedAt=at;
  for(const step of activity.steps)if(['running','waiting'].includes(step.status)){
    // A resposta final não prova o sucesso de uma ferramenta sem retorno.
    step.status=step.type==='tool'?'interrupted':status;step.finishedAt=at;
  }
}
