// Virtual TSK folders reuse the preview's persisted records. No filesystem access.
const segment=value=>encodeURIComponent(String(value)).replace(/\./g,'%2E');
const tasks=state=>state.members.flatMap(m=>m.sessions.map(s=>({m,s})));
export const taskFolderPath=(state,s)=>`TSK/${s.campaignId?segment(s.campaignId)+'/':''}${segment(s.id)}`;
export const routineFolderPath=e=>`TSK/rotinas/${segment(e.routineId)}/${segment(e.period)}`;
export function publishTaskResult(state,s){
  if(s.status!=='done'||s.review?.status!=='approved')throw new Error('Apenas resultados aprovados podem ser publicados como conhecimento da TSK.');
  const reviewIndex=s.review.history?.length||0,previous=s.knowledgeResult;
  if(previous?.reviewIndex===reviewIndex&&previous.content===String(s.delivery||'')&&previous.approvedAt===s.review.approvedAt)return previous;
  const version=(s.knowledgeHistory?.length||0)+1;
  const c=state.campaigns.find(c=>c.id===s.campaignId);
  const result={id:`tsk-result:${s.id}:${version}`,taskId:s.id,campaignId:s.campaignId||null,title:s.title,version,reviewIndex,path:taskFolderPath(state,s)+'/resultado-aprovado.md',
    content:String(s.delivery||''),approvedAt:s.review.approvedAt,actor:s.review.actor||'director',brainRevision:s.review.brainRevision,criteria:s.review.policy?.criteria||c?.plan.reviewPolicy?.criteria||'',briefing:c?.brief||s.title};
  (s.knowledgeHistory??=[]).push(result);s.knowledgeResult=result;return result;
}
export function ensureTaskKnowledge(state){for(const {s} of tasks(state))if(s.status==='done'&&s.review?.status==='approved'&&!s.knowledgeResult)publishTaskResult(state,s);return state;}
export function approvedTaskKnowledge(state){
  const sessions=tasks(state).filter(({s})=>s.status==='done'&&s.review?.status==='approved'&&s.knowledgeResult).map(({m,s})=>({...s.knowledgeResult,source:'session',sourceId:s.id,ownerId:m.id,owner:m.name,role:m.role}));
  const runs=(state.routineWorkspace?.executions||[]).filter(e=>e.status==='approved'&&e.result?.availability==='published').map(e=>({id:e.result.id,source:'routine',sourceId:e.id,ownerId:e.ownerId,owner:state.members.find(m=>m.id===e.ownerId)?.name||'Time',role:'Rotina',title:e.title+' · '+e.period,content:e.result.content,approvedAt:e.result.approvedAt,version:1,path:routineFolderPath(e)+'/resultado-aprovado.md'}));
  return [...sessions,...runs];
}
const searchable=text=>String(text||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
export function consultTaskKnowledge(state,query,limit=3){
  const ignored=new Set(['para','como','pela','pelo','pelas','pelos','com','uma','das','dos','que','por','sua','seu','suas','seus','nossa','nosso','criar','fazer','usar','campanha','conteudo','entrega','diretor']);
  const terms=[...new Set(searchable(query).match(/[a-z0-9]{3,}/g)||[])].filter(t=>!ignored.has(t));
  return approvedTaskKnowledge(state).map(r=>({r,score:terms.filter(t=>searchable(r.title+' '+r.content).includes(t)).length})).filter(x=>x.score>0).sort((a,b)=>b.score-a.score).slice(0,limit).map(({r})=>structuredClone(r));
}
export function taskKnowledgeFolders(state){
  const approved=approvedTaskKnowledge(state);
  return [...tasks(state).map(({m,s})=>({id:s.id,source:'session',title:s.title,owner:m.name,ownerId:m.id,type:m.type,status:s.status,path:taskFolderPath(state,s),result:approved.find(r=>r.source==='session'&&r.sourceId===s.id)||null})),
    ...(state.routineWorkspace?.executions||[]).map(e=>({id:e.id,source:'routine',title:e.title+' · '+e.period,owner:state.members.find(m=>m.id===e.ownerId)?.name||'Time',ownerId:e.ownerId,type:'routine',status:e.status,path:routineFolderPath(e),result:approved.find(r=>r.source==='routine'&&r.sourceId===e.id)||null}))];
}
const json=value=>JSON.stringify(value,null,2);
const transcript=messages=>(messages||[]).map(m=>`${m.time||m.at?'['+(m.time||m.at)+'] ':''}${({user:'Você',assistant:'Assistente',director:'Diretor',note:'Anotação de pessoa'})[m.role]||m.from||'Time'}\n${m.text||''}`).join('\n\n');
export function taskKnowledgeFiles(state,source,id){
  const folder=taskKnowledgeFolders(state).find(f=>f.source===source&&f.id===id);if(!folder)return [];
  const files=[],add=(name,content,status='context')=>files.push({name,path:folder.path+'/'+name,content:String(content||'Nenhum registro nesta etapa.'),status});
  if(source==='session'){
    const {m,s}=tasks(state).find(x=>x.s.id===id),c=state.campaigns.find(c=>c.id===s.campaignId);
    add('briefing.md',c?.brief||s.title);
    if(c?.intake)add('entrevista.md',transcript(c.intake.history));
    add('planejamento.md',c?`# ${c.title}\n\n${c.plan.approach}\n\n${c.plan.tasks.map(t=>`- ${t.title} · ${state.members.find(m=>m.id===t.memberId)?.name||'Time'}${t.dependsOn?' · depende de '+c.plan.tasks.find(other=>other.id===t.dependsOn)?.title:''}`).join('\n')}\n\nCritérios da revisão:\n${c.plan.reviewPolicy?.criteria||''}`:s.messages?.find(m=>m.role==='director')?.text||s.step);
    add('textos-e-conversa.md',transcript(s.messages));
    add('anotacoes.md',transcript(s.notes));
    add('dados.json',json({taskId:s.id,campaignId:s.campaignId||null,responsavel:{id:m.id,nome:m.name,funcao:m.role},status:s.status,progresso:s.progress,etapa:s.step,dependencias:s.dependencies||[],orientacoesPendentes:s.queued||[],referencias:c?.intake?.answers.assets||null}));
    if(c)add('conversa-com-diretor.md',transcript(c.messages));
    const collaboration=state.collaborations.filter(t=>t.taskId===s.id||t.relatedTaskId===s.id||c&&t.campaignId===c.id);
    add('colaboracao.md',collaboration.map(t=>`${state.members.find(m=>m.id===t.from)?.name||'Time'} → ${state.members.find(m=>m.id===t.to)?.name||'Time'}\n${t.text}\n${t.reply?'Resposta: '+t.reply.text:'Aguardando resposta.'}`).join('\n\n'));
    if(s.delivery)add('entrega-em-revisao.md',s.delivery,s.status==='done'?'context':'draft');
    add('revisoes.md',(s.review?.history||[]).map((r,i)=>`# Parecer ${i+1} · ${r.actor==='user'?'Usuário':'Diretor'}\n${r.decision==='approve'?'Aprovado':'Correção solicitada'}\n${r.feedback||''}\n\nVersão entregue:\n${r.delivery||''}`).join('\n\n'));
    for(const r of s.knowledgeHistory||[])add(`resultados/versao-${r.version}.md`,r.content,'approved');
    if(folder.result)add('resultado-aprovado.md',folder.result.content,'approved');
  }else{
    const e=state.routineWorkspace.executions.find(e=>e.id===id);
    add('briefing.md',e.brief);add('planejamento.md',`${e.title}\nPeríodo: ${e.period}\nHorário: ${e.time} · ${e.timeZone}\n\nCritérios:\n${e.review?.policy?.criteria||e.reviewPolicy?.criteria||'Briefing, regras da empresa e qualidade.'}`);
    add('dados.json',json({executionId:e.id,routineId:e.routineId,periodo:e.period,status:e.status,dependencias:e.dependencies,entradas:e.inputs||[]}));
    add('anotacoes-e-historico.md',(e.history||[]).map(h=>`[${h.at}] ${h.text}`).join('\n\n'));
    if(e.delivery)add('entrega-em-revisao.md',e.delivery.content,e.status==='approved'?'context':'draft');
    add('revisoes.md',json(e.review?.history||[]));
    if(folder.result)add('resultado-aprovado.md',folder.result.content,'approved');
  }
  return files;
}
