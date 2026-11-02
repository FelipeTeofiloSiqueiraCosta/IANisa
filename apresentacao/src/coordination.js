import { uid } from './state.js';
import { beginDirectorReview, evaluateDirectorReview, normalizeReviewPolicy, reviewPolicyFor } from './review.js';
import { ensureTaskKnowledge, publishTaskResult, consultTaskKnowledge } from './task-knowledge.js';

export const directorProfile = { id:'director', name:'Diretor', role:'Diretor do Marketing', type:'robot', color:'#607a45', connectors:['drive','notion'], skills:['Planejamento','Coordenação do time','Revisão de entregas'], sessions:[], isDirector:true };
export const knowledgeCategories = { brand:'Identidade e marca', voice:'Tom de voz', business:'Empresa e público', direction:'Regras da direção', result:'Resultados e aprendizados' };
export const stamp = () => new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
const message = (role,text) => ({ id:uid(),role,text,time:stamp() });
export function ensureCoordination(state) {
  state.campaigns ??= [];
  state.collaborations ??= [];
  state.brain ??= { revision:1, entries:[
    { id:'brand-example',category:'brand',title:'Identidade visual · exemplo',content:'Usar a paleta oficial, manter o logotipo legível e preservar o contraste. Substitua este exemplo pelas diretrizes da sua empresa.',palette:['#405738','#f7f8f3','#cb7d53'] },
    { id:'voice-example',category:'voice',title:'Como a marca conversa · exemplo',content:'Linguagem clara, próxima e sem promessas exageradas. Adaptar a mensagem ao público e ao canal.' },
    { id:'business-example',category:'business',title:'Contexto da empresa',content:'Cadastre aqui seus produtos, público, diferenciais e objetivos. O diretor usa essas informações ao planejar e revisar.' },
    { id:'direction-example',category:'direction',title:'Como o time deve trabalhar',content:'Apresentar o planejamento antes de distribuir tarefas. Toda entrega, de pessoa ou agente, passa pelo diretor. Conferir o briefing, as regras da marca e a qualidade. Guardar todos os registros da tarefa na sua pasta TSK. Resultados aprovados ficam disponíveis automaticamente no conhecimento dessa TSK.' },
  ] };
  if(!state.coordinationVersion){
    for(const m of state.members)for(const s of m.sessions){
      // Preserve existing sessions and messages. Previously finished examples enter the new review flow.
      if(s.status==='done'&&!s.review){s.status='review';s.progress=90;s.step='Entrega pronta. Aguardando revisão do diretor.';s.delivery='Material de demonstração preparado para conferência do briefing, da marca e da qualidade.';s.review={status:'pending',submittedAt:stamp(),history:[]};}
    }
    state.coordinationVersion=1;
  }
  const previousRule='Apresentar o planejamento antes de distribuir tarefas. Toda entrega, de pessoa ou agente, passa pelo diretor. Conferir o briefing, as regras da marca e a qualidade. Guardar no cérebro apenas aprendizados relevantes de entregas aprovadas.';
  const example=state.brain.entries.find(e=>e.id==='direction-example');
  if(example?.content===previousRule)example.content=example.content.replace('Guardar no cérebro apenas aprendizados relevantes de entregas aprovadas.','Guardar todos os registros da tarefa na sua pasta TSK. Resultados aprovados ficam disponíveis automaticamente no conhecimento dessa TSK.');
  return ensureTaskKnowledge(state);
}
export function allTasks(state){return state.members.flatMap(m=>m.sessions.map(s=>({m,s})));}
export function findTask(state,id){return allTasks(state).find(({s})=>s.id===id);}
export const reviewQueue=state=>allTasks(state).filter(({s})=>s.status==='review');
export function readyToRun(state,s){return (s.dependencies||[]).every(id=>findTask(state,id)?.s.status==='done') && !(s.waitingForMessages||[]).some(id=>!state.collaborations.find(t=>t.id===id)?.answered);}
export function refreshDependencies(state){
  for(const {m,s} of allTasks(state)){
    if(s.status==='blocked'&&readyToRun(state,s)){s.status=m.type==='human'?'assigned':'working';s.step=m.type==='human'?'Dependência resolvida. Sua tarefa está pronta para começar.':'Contexto recebido. Começando a próxima etapa.';s.messages.push(message('director','A dependência foi resolvida. O trabalho pode continuar com o contexto recebido.'));}
  }
}
const templates=[
  { role:/head|diretor|comercial/i,title:'Validar oferta e prioridades',brief:'Confirmar a oferta, as condições comerciais, as prioridades e os limites da campanha.',kind:'head' },
  { role:/social/i,title:'Planejar conteúdo e canais',brief:'Organizar os temas, os formatos e o calendário de publicação a partir do briefing.',kind:'social' },
  { role:/copy/i,title:'Escrever a mensagem da campanha',brief:'Criar títulos, chamadas e textos com a voz da marca e as condições da oferta.',kind:'copy' },
  { role:/^designer$|design gráfico|diretor.*arte/i,title:'Criar a direção visual',brief:'Propor as peças visuais respeitando a paleta, o logotipo e as referências da marca.',kind:'design' },
  { role:/videomaker/i,title:'Desenvolver roteiro e cenas',brief:'Usar o planejamento de conteúdo para criar a narrativa, as cenas e o roteiro.',kind:'video',dependsOn:'social' },
  { role:/editor.*v[ií]deo/i,title:'Editar o vídeo da campanha',brief:'Montar os cortes, as legendas e a trilha a partir do roteiro aprovado.',kind:'edit',dependsOn:'video' },
  { role:/web|landing/i,title:'Preparar a página da campanha',brief:'Organizar a página com mensagem, identidade visual e condições claras da oferta.',kind:'web',dependsOn:'copy' },
  { role:/tráfego|trafego|mídia|midia/i,title:'Planejar a distribuição',brief:'Propor públicos, canais e uma distribuição de orçamento para revisão. Não publicar anúncios nesta prévia.',kind:'ads',dependsOn:'design' },
];
export function createPlan(state,{title,brief,adjustment='',campaignId=null,preferredMemberId=null,reviewPolicy,intake=null}){
  title=String(title||'').trim();brief=String(brief||'').trim();
  if(!title||!brief)throw new Error('Preencha o nome e o objetivo da campanha.');
  let c=campaignId?state.campaigns.find(c=>c.id===campaignId):null;
  if(c&&c.status!=='awaiting_approval')throw new Error('Este plano já foi distribuído. As mudanças precisam de um novo planejamento.');
  const tasks=[];const used=new Set();
  if(preferredMemberId){const m=state.members.find(m=>m.id===preferredMemberId);if(!m)throw new Error('Esse integrante não faz parte do time.');tasks.push({id:uid(),memberId:m.id,title,brief,kind:'specific',dependsOn:null});}
  else for(const t of templates){const m=state.members.find(m=>!used.has(m.id)&&t.role.test(m.role));if(!m)continue;used.add(m.id);tasks.push({id:uid(),memberId:m.id,title:t.title,brief:t.brief,kind:t.kind,dependsOnKind:t.dependsOn||null,dependsOn:null});}
  if(!tasks.length&&state.members[0])tasks.push({id:uid(),memberId:state.members[0].id,title:'Desenvolver a proposta da campanha',brief:'Preparar a proposta a partir do briefing e das regras da empresa.',kind:'general',dependsOn:null});
  if(!tasks.length)throw new Error('Adicione ao menos um integrante ao time para distribuir o trabalho.');
  for(const t of tasks)t.dependsOn=tasks.find(other=>other.kind===t.dependsOnKind)?.id||null;
  const plan={reviewPolicy:normalizeReviewPolicy(reviewPolicy||c?.plan.reviewPolicy),objective:brief,approach:'Alinhar a oferta e a mensagem, organizar as entregas e conectar as etapas que dependem umas das outras. Todo material volta ao diretor para revisão.'+(adjustment?'\nAjuste solicitado: '+adjustment:''),tasks,brainRevision:state.brain.revision,knowledge:state.brain.entries.filter(e=>e.category!=='result').map(e=>({id:e.id,title:e.title,content:e.content,palette:e.palette||[]})),generatedAt:stamp(),adjustment};
  if(c){c.title=title;c.brief=brief;c.plan=plan;c.revision=(c.revision||1)+1;}
  else{c={id:uid(),title,brief,preferredMemberId,status:'awaiting_approval',revision:1,plan,createdAt:stamp(),messages:[message('user',brief),message('director','Preparei uma proposta com as regras disponíveis no cérebro. Revise o plano, os responsáveis e as dependências. Só distribuo após a sua confirmação.')]};state.campaigns.unshift(c);}
  if(intake)c.intake=structuredClone(intake);
  c.plan.taskKnowledge=consultTaskKnowledge(state,title+' '+brief);
  return c;
}
export function validatePlan(state,c){
  if(c.status!=='awaiting_approval')throw new Error('Este plano já foi distribuído.');
  if(c.plan.brainRevision!==state.brain.revision)throw new Error('O cérebro foi atualizado. Atualize o planejamento antes de confirmar a distribuição.');
  if(!c.plan.tasks.length)throw new Error('Inclua ao menos uma tarefa no planejamento.');
  for(const t of c.plan.tasks){if(!t.title.trim()||!state.members.some(m=>m.id===t.memberId))throw new Error('Confira o título e o responsável de cada tarefa.');if(t.dependsOn&&!c.plan.tasks.some(other=>other.id===t.dependsOn&&other.id!==t.id))throw new Error('Confira as dependências do planejamento.');}
  const visit=(id,seen=new Set())=>{if(seen.has(id))throw new Error('Há uma espera circular entre tarefas. Ajuste as dependências.');const task=c.plan.tasks.find(t=>t.id===id);if(task?.dependsOn)visit(task.dependsOn,new Set([...seen,id]));};
  c.plan.tasks.forEach(t=>visit(t.id));
}
export function distributePlan(state,c){
  validatePlan(state,c);
  const sessionIds=new Map(c.plan.tasks.map(t=>[t.id,uid()]));
  for(const t of c.plan.tasks){
    const m=state.members.find(m=>m.id===t.memberId),dep=t.dependsOn?c.plan.tasks.find(x=>x.id===t.dependsOn):null,owner=dep?state.members.find(x=>x.id===dep.memberId):null;
    const status=dep?'blocked':m.type==='human'?'assigned':'working';
    const step=dep?`Aguardando ${owner.name}: ${dep.title}`:m.type==='human'?'Tarefa recebida do diretor. Pronta para começar.':'Briefing recebido do diretor. Organizando os primeiros passos.';
    const s={id:sessionIds.get(t.id),title:t.title+' · '+c.title,status,progress:dep||m.type==='human'?0:8,step,minutes:0,queued:[],createdAt:Date.now(),campaignId:c.id,assignmentId:t.id,dependencies:dep?[sessionIds.get(dep.id)]:[],brainRevision:c.plan.brainRevision,review:null,messages:[message('director',`Plano aprovado por você: ${c.title}.\nSua entrega: ${t.brief}\nBriefing da campanha: ${c.brief}\nRegras consultadas: ${c.plan.knowledge.map(k=>k.title).join('; ')}.\nResultados anteriores consultados na TSK: ${(c.plan.taskKnowledge||[]).map(k=>k.title+' — '+k.path).join('; ')||'nenhum resultado anterior foi usado neste plano'}.\nCritérios definidos pelo usuário: ${normalizeReviewPolicy(c.plan.reviewPolicy).criteria}\nRevisão: ${normalizeReviewPolicy(c.plan.reviewPolicy).mode==='human'?'depois da minha conferência, o usuário também confirma':'vou aprovar ou devolver para ajustes, sem pedir confirmação humana a cada entrega'}.\nEnvie o resultado para minha revisão antes de considerar a tarefa concluída.`)]};
    if(m.type==='robot')s.messages.push(message('assistant',dep?`Vou aguardar ${owner.name} concluir a etapa necessária antes de começar. Posso acompanhar a tarefa e conversar com esse agente na aba Colaboração.`:'Recebi a tarefa e as regras. Vou desenvolver a proposta e encaminhar o resultado ao diretor.'));
    m.sessions.unshift(s);
    if(dep&&m.type==='robot'&&owner.type==='robot')state.collaborations.push({id:uid(),taskId:s.id,relatedTaskId:sessionIds.get(dep.id),campaignId:c.id,from:m.id,to:owner.id,text:`Preciso de “${dep.title}” para iniciar “${t.title}”. Você pode me passar o resultado quando estiver aprovado?`,wait:false,answered:false,time:stamp(),automatic:true});
  }
  c.status='running';c.approvedAt=stamp();c.approvedBrainRevision=c.plan.brainRevision;c.sessionIds=[...sessionIds.values()];c.messages.push(message('director','Você confirmou o plano. As tarefas foram distribuídas para pessoas e agentes. As dependências estão visíveis e todas as entregas passarão pela minha revisão.'));
  return c;
}
export function submitForReview(state,s,delivery,{scenario='pass',now=Date.now()}={}){
  if(!['working','assigned','changes','paused'].includes(s.status))throw new Error('Esta tarefa não está pronta para enviar à revisão.');
  if(!readyToRun(state,s))throw new Error('Resolva as dependências antes de enviar a entrega.');
  if(s.queued?.length)throw new Error('Há orientações na fila. Considere essas mensagens antes de enviar à revisão.');
  if(!String(delivery).trim())throw new Error('Descreva o que foi entregue para o diretor revisar.');
  s.delivery=String(delivery).trim();s.status='review';s.progress=90;s.step='Entrega enviada. Aguardando revisão do diretor.';
  s.review=beginDirectorReview(state,reviewPolicyFor(state,s),scenario,s.review,now);
  s.messages.push(message('director','Recebi a entrega para revisão. Vou conferir o briefing, as regras da empresa e a qualidade antes de aprovar.'));
}
export function reviewTask(state,s,{decision,feedback='',checks=[],actor='director'}){
  if(s.status!=='review')throw new Error('Esta entrega não está aguardando revisão.');
  if(actor==='user'&&s.review?.status!=='awaiting_user')throw new Error('O diretor ainda não solicitou uma decisão humana.');
  if(decision==='approve'){
    if(!['brief','brand','quality'].every(k=>checks.includes(k)))throw new Error('Confira briefing, regras da marca e qualidade antes de aprovar.');
    s.status='done';s.progress=100;s.step=actor==='user'?'Entrega revisada pelo diretor e confirmada pelo usuário.':'Entrega aprovada pelo diretor.';s.review={...s.review,status:'approved',brainRevision:state.brain.revision,approvedAt:stamp(),checks:[...checks]};
    s.messages.push({...message('director',actor==='user'?'Confirmação do usuário recebida. Entrega aprovada e liberada para a próxima etapa.':'Revisão aprovada: a entrega atende ao briefing, às regras da empresa e aos critérios de qualidade. Liberei o resultado para a próxima etapa e registrei automaticamente no conhecimento da pasta TSK.'),result:s.title});
    for(const t of state.collaborations.filter(t=>t.automatic&&!t.answered&&t.relatedTaskId===s.id)){t.answered=true;t.reply={id:uid(),from:t.to,to:t.from,text:'Minha entrega foi aprovada pelo diretor. Contexto para a próxima etapa: '+s.delivery,time:stamp()};}
  }else if(decision==='changes'){
    if(!feedback.trim())throw new Error('Descreva o ajuste que o diretor está pedindo.');
    s.status='changes';s.progress=65;s.step=(actor==='user'?'Usuário definiu o ajuste: ':'Diretor pediu ajustes: ')+feedback.trim();s.review={...s.review,status:'changes',feedback:feedback.trim()};s.messages.push(message('director',(actor==='user'?'O usuário definiu os ajustes. Refazer conforme esta orientação:\n':'Ajustes necessários antes da aprovação:\n')+feedback.trim()));
  }else throw new Error('Parecer inválido.');
  s.review.actor=actor;
  s.review.history.push({decision,actor,feedback:feedback.trim(),time:stamp(),evaluation:s.review.evaluation?structuredClone(s.review.evaluation):null,delivery:s.delivery});
  if(decision==='approve')publishTaskResult(state,s);
  refreshDependencies(state);
}
export function scheduleTaskReview(state,s,{scenario='pass',now=Date.now()}={}){
  if(s.status!=='review')throw new Error('Esta entrega não está aguardando revisão.');
  s.review=beginDirectorReview(state,reviewPolicyFor(state,s),scenario,s.review,now);
}
export function processTaskReviews(state,now=Date.now()){
  const results=[];
  for(const {m,s} of allTasks(state)){
    if(s.status!=='review'||s.review?.engine!=='director-preview-v1'||s.review.status!=='pending'||s.review.dueAt>now)continue;
    const evaluation=evaluateDirectorReview(state,s.review);s.review.evaluation=evaluation;
    if(evaluation.decision==='awaiting_user'){
      s.review.status='awaiting_user';s.step=evaluation.feedback;
      s.messages.push(message('director',evaluation.feedback));
    }else reviewTask(state,s,{...evaluation,actor:'director'});
    results.push({m,s,decision:evaluation.decision});
  }
  return results;
}
export function saveKnowledge(state,entry){
  const title=String(entry.title||'').trim(),content=String(entry.content||'').trim();
  if(!title||!content||!Object.hasOwn(knowledgeCategories,entry.category))throw new Error('Preencha o título, a categoria e o conteúdo.');
  let existing=entry.id?state.brain.entries.find(e=>e.id===entry.id):null;
  if(existing?.source&&existing.category!==entry.category)throw new Error('Mantenha a categoria de um aprendizado vinculado a uma entrega.');
  if(entry.source){const task=findTask(state,entry.source.sessionId);if(!task||task.s.status!=='done'||task.s.review?.status!=='approved')throw new Error('Somente entregas aprovadas pelo diretor podem gerar aprendizados no cérebro.');existing=state.brain.entries.find(e=>e.source?.sessionId===entry.source.sessionId)||existing;}
  const palette=String(entry.palette||'').split(/[,\s]+/).filter(Boolean);if(palette.some(c=>!/^#[0-9a-fA-F]{6}$/.test(c)))throw new Error('Use cores no formato #405738, separadas por vírgulas.');
  const saved={...(existing||{}),id:existing?.id||uid(),category:entry.category,title,content,palette,updatedAt:stamp(),...(entry.source?{source:entry.source}:{})};
  if(existing)Object.assign(existing,saved);else state.brain.entries.push(saved);
  state.brain.revision++;return saved;
}
export function askColleague(state,{taskId,to,text,wait=false}){
  const task=findTask(state,taskId),recipient=state.members.find(m=>m.id===to);
  if(!task||!recipient||recipient.id===task.m.id||!text.trim())throw new Error('Escolha outro integrante e escreva o pedido.');
  if(['review','done'].includes(task.s.status)&&wait)throw new Error('Uma tarefa em revisão ou aprovada não pode ser bloqueada por uma nova conversa.');
  const thread={id:uid(),taskId,from:task.m.id,to,text:text.trim(),wait,answered:false,campaignId:task.s.campaignId||null,time:stamp()};
  state.collaborations.push(thread);
  if(wait){(task.s.waitingForMessages||=[]).push(thread.id);task.s.status='blocked';task.s.step=`Aguardando uma resposta de ${recipient.name}.`;}
  return thread;
}
export function replyToColleague(state,id,text){
  const thread=state.collaborations.find(t=>t.id===id);if(!thread||thread.answered||!text.trim())throw new Error('Escreva uma resposta para um pedido em aberto.');
  thread.answered=true;thread.reply={id:uid(),from:thread.to,to:thread.from,text:text.trim(),time:stamp()};refreshDependencies(state);return thread;
}
