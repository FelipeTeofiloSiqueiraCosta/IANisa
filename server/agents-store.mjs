import {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
import {mkdirSync,chmodSync,readFileSync} from 'node:fs';
import path from 'node:path';
import {problem} from './accounts.mjs';
import {newActivity,applyActivity,finishActivity} from './agent-activity.mjs';
import {imageURL} from '../shared/chat-media.mjs';

const matrix=JSON.parse(readFileSync(new URL('../config/marketing-agent-skills.json',import.meta.url),'utf8'));
const role=matrix.roles.find(r=>r.id==='social_media');
const assignments=matrix.skills.filter(s=>[...s.primary,...s.support].includes(role.id));
const catalogNames=new Set(['extrator-de-marca','benchmark-de-mercado','texto-humano','carrossel-modular']);
export const liaProfile={id:'lia',name:'Lia',role:role.label,roleId:role.id,color:'#9baf83',type:'agent',responsibility:role.responsibility,
  daily:['Organizar pautas, formatos e calendário editorial.','Transformar referências em ideias alinhadas à marca.','Planejar a sequência de carrosséis e preparar legendas.','Analisar conteúdo e métricas fornecidos para propor melhorias.'],
  boundaries:['Consultar a marca aprovada sem alterar as regras da empresa.','Entregar propostas e rascunhos para revisão.','Usar dados fornecidos; pesquisas externas e geração de mídia dependem de integrações.'],
};
const connectorDefaults=matrix.implementedAgents?.find(a=>a.id==='lia')??{};
const directConnectors=new Set(connectorDefaults.directConnectors??[]);
const introduction='Sou a Lia, sua social media. Posso organizar o calendário de conteúdo, desenvolver pautas e estruturar carrosséis com a voz da sua marca. Qual conteúdo vamos preparar?';

export function createAgentsStore({directory,skills,connectors=null,approvedBrand=()=>null,runTurn,now=Date.now}) {
  mkdirSync(directory,{recursive:true,mode:0o700});
  const filename=path.join(directory,'agents.sqlite'),db=new DatabaseSync(filename);chmodSync(filename,0o600);
  db.exec('PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS agent_conversations(org_id TEXT NOT NULL,user_id TEXT NOT NULL,agent_id TEXT NOT NULL,state TEXT NOT NULL,PRIMARY KEY(org_id,user_id,agent_id)); CREATE TABLE IF NOT EXISTS agent_connector_settings(org_id TEXT NOT NULL,agent_id TEXT NOT NULL,revision INTEGER NOT NULL,assignments TEXT NOT NULL,updated_by TEXT NOT NULL,updated_at INTEGER NOT NULL,PRIMARY KEY(org_id,agent_id));');
  const jobs=new Map();
  const key=actor=>actor.organization.id+':'+actor.user.id;
  function assertId(id){if(id!=='lia')throw problem(404,'Agente não encontrado.');}
  function save(actor,state){db.prepare('INSERT INTO agent_conversations VALUES (?,?,?,?) ON CONFLICT(org_id,user_id,agent_id) DO UPDATE SET state=excluded.state').run(actor.organization.id,actor.user.id,'lia',JSON.stringify(state));}
  function load(actor){
    const row=db.prepare('SELECT state FROM agent_conversations WHERE org_id=? AND user_id=? AND agent_id=?').get(actor.organization.id,actor.user.id,'lia');
    if(row)return JSON.parse(row.state);
    const state={revision:0,createdAt:now(),messages:[{id:randomUUID(),role:'assistant',text:introduction,author:'Lia',at:now()}],pending:null,error:null};save(actor,state);return state;
  }
  function connectorSettings(actor,id='lia'){
    assertId(id);let row=db.prepare('SELECT * FROM agent_connector_settings WHERE org_id=? AND agent_id=?').get(actor.organization.id,id);
    if(!row){const defaults=(connectors?.list(actor).connectors??[]).filter(c=>directConnectors.has(c.builtin)).map(c=>({connectorId:c.id,mode:connectorDefaults.connectorPermissions?.[c.builtin]??'ask'}));db.prepare('INSERT INTO agent_connector_settings VALUES (?,?,?,?,?,?)').run(actor.organization.id,id,0,JSON.stringify(defaults),'system',now());row=db.prepare('SELECT * FROM agent_connector_settings WHERE org_id=? AND agent_id=?').get(actor.organization.id,id);}
    return {revision:row.revision,assignments:JSON.parse(row.assignments)};
  }
  function publicConnector(c,assignment){return {id:c.id,key:c.builtin,title:c.name,enabled:c.enabled,assigned:Boolean(assignment),mode:assignment?.mode??null,available:c.enabled&&!c.requiresConnection&&c.status!=='error',status:!c.enabled?'disabled':c.requiresConnection?'auth-required':c.status==='error'?'error':'available',toolCount:c.tools.length};}
  function connectorAccess(actor,id='lia'){
    const settings=connectorSettings(actor,id),catalog=connectors?.list(actor).connectors??[];
    return {agentId:id,revision:settings.revision,editable:actor.user.role==='admin',connectors:catalog.map(c=>publicConnector(c,settings.assignments.find(a=>a.connectorId===c.id)))};
  }
  function updateConnectors(actor,id,input){
    assertId(id);if(actor.user.role!=='admin')throw problem(403,'Somente administradores podem configurar os conectores dos agentes.');
    const current=connectorSettings(actor,id);if(input.revision!==current.revision)throw problem(409,'As permissões mudaram em outra tela. Reabra Conectores para conferir.');
    if(!Array.isArray(input.assignments)||input.assignments.length>5)throw problem(400,'Escolha até cinco conectores para a Lia.');
    const catalog=new Set((connectors?.list(actor).connectors??[]).map(c=>c.id)),seen=new Set();
    const assignments=input.assignments.map(a=>{if(!a||typeof a.connectorId!=='string'||!catalog.has(a.connectorId)||seen.has(a.connectorId)||!['allow','ask'].includes(a.mode)||Object.keys(a).some(k=>!['connectorId','mode'].includes(k)))throw problem(400,'Informe conectores válidos, sem repetições, e o modo de autorização.');seen.add(a.connectorId);return {connectorId:a.connectorId,mode:a.mode};});
    db.prepare('UPDATE agent_connector_settings SET revision=revision+1,assignments=?,updated_by=?,updated_at=? WHERE org_id=? AND agent_id=?').run(JSON.stringify(assignments),actor.user.id,now(),actor.organization.id,id);
    return connectorAccess(actor,id);
  }
  function connectorMode(actor,id,connectorId){
    const access=connectorAccess(actor,id).connectors.find(c=>c.id===connectorId);return access?.assigned&&access.available?access.mode:'deny';
  }
  function assignedConnectors(actor){return connectorAccess(actor).connectors.filter(c=>c.assigned);}
  function profile(actor){
    const catalog=skills.list(actor).skills;
    return {...liaProfile,skills:assignments.map(s=>{
      const pkg=catalogNames.has(s.id)?catalog.find(p=>p.name===s.id):null;
      return {id:s.id,title:pkg?.title||s.label,purpose:s.purpose,responsibility:s.primary.includes(role.id)?'primary':'support',catalogId:pkg?.id??null,status:pkg?(pkg.enabled?'available':'disabled'):'pending',dependencies:s.dependencies};
    }),connectors:assignedConnectors(actor),canManageConnectors:actor.user.role==='admin',brandRevision:approvedBrand(actor)?.revision??null};
  }
  function view(actor,id='lia'){
    assertId(id);const agent=profile(actor),state=load(actor);
    if(state.pending&&!jobs.has(key(actor))){finishActivity(state.activity,'interrupted',now());state.pending=null;state.error='A conexão foi interrompida. Sua mensagem está salva; tente novamente.';state.revision++;save(actor,state);}
    return {agent,...state};
  }
  function list(actor){return {agents:[view(actor).agent]};}
  async function send(actor,id,input){
    assertId(id);
    if(jobs.has(key(actor)))throw problem(409,'A Lia já está respondendo. Aguarde um instante.');
    if(typeof input.text!=='string'||!input.text.trim()||input.text.length>12000||typeof input.requestId!=='string'||!/^[a-f0-9-]{36}$/.test(input.requestId))throw problem(400,'Escreva uma mensagem válida para a Lia.');
    if((input.connectorIds?.length)||input.agent||input.provider&&input.provider!=='claude')throw problem(400,'Esta conversa usa o perfil da Lia e a conexão com o Claude.');
    const state=load(actor),existing=state.messages.find(m=>m.role==='user'&&m.requestId===input.requestId);
    const ids=input.skillIds??[];
    if(!Array.isArray(ids)||ids.length>3||ids.some(id=>typeof id!=='string')||new Set(ids).size!==ids.length)throw problem(400,'Escolha até três skills diferentes.');
    if(existing&&(existing.text!==input.text.trim()||JSON.stringify(existing.skills.map(s=>s.id))!==JSON.stringify(ids)))throw problem(409,'Essa mensagem já tem outro conteúdo. Envie uma nova mensagem.');
    if(state.messages.some(m=>m.role==='assistant'&&m.requestId===input.requestId))return view(actor);
    const agent=profile(actor),allowed=new Set(agent.skills.filter(s=>s.status==='available').map(s=>s.catalogId));
    if(ids.some(id=>!allowed.has(id)))throw problem(403,'Uma das skills não está disponível para a Lia. Confira o perfil dela.');
    const selected=skills.resolve(actor,ids),refs=selected.map(({id,name,title,version})=>({id,name,title,version}));
    const enabledConnectors=agent.connectors.filter(c=>c.available),activeConnectors=connectors?connectors.resolve(actor,enabledConnectors.map(c=>c.id)):[],connectorRefs=activeConnectors.map(({id,title,builtin})=>({id,title,key:builtin}));
    for(const c of activeConnectors)c.permission=enabledConnectors.find(a=>a.id===c.id).mode;
    if(existing&&JSON.stringify(existing.connectors??[])!==JSON.stringify(connectorRefs))throw problem(409,'Os conectores disponíveis mudaram. Envie uma nova mensagem.');
    if(existing&&JSON.stringify(existing.skills)!==JSON.stringify(refs))throw problem(409,'A skill mudou. Envie uma nova mensagem com a versão atual.');
    if(!existing){
      if(input.revision!==state.revision)throw problem(409,'A conversa mudou em outra aba. Atualize antes de enviar.');
      if(state.messages.length>=100)throw problem(413,'Esta conversa atingiu o limite de mensagens.');
      state.messages.push({id:randomUUID(),role:'user',text:input.text.trim(),author:actor.user.name,at:now(),requestId:input.requestId,skills:refs,connectors:connectorRefs});
    }
    const brand=approvedBrand(actor);
    state.pending=input.requestId;state.error=null;state.activity=newActivity(input.requestId,now());applyActivity(state.activity,{type:'phase',id:'context'},now());state.revision++;save(actor,state);
    const onProgress=event=>{if(state.pending===input.requestId&&applyActivity(state.activity,event,now())){state.revision++;save(actor,state);}};
    const job=(async()=>{
      try{
        const workdir=path.join(directory,'agents','lia');mkdirSync(workdir,{recursive:true,mode:0o700});
        const result=await runTurn({actor,requestId:input.requestId,provider:'claude',directory:workdir,agent:liaProfile,auxiliary:true,state:{block:0,profile:brand?.profile??{},messages:state.messages},files:[],skills:selected,connectors:activeConnectors,onProgress});
        if(typeof result?.reply!=='string'||!result.reply.trim()||result.reply.length>20000)throw problem(502,'A Lia não concluiu a resposta. Sua mensagem está salva; tente novamente.');
        if(result.execution?.model)onProgress({type:'model',model:result.execution.model});
        onProgress({type:'phase',id:'saving'});finishActivity(state.activity,'completed',now());
        const media=connectorRefs.some(c=>c.key==='higgsfield')?(result.execution?.media??[]).filter(m=>m.connector==='higgsfield'&&imageURL(m.url)).slice(0,6).map(m=>({url:imageURL(m.url),connector:'higgsfield',model:typeof m.model==='string'?m.model.slice(0,80):null,source:'tool'})):[];
        state.messages.push({id:randomUUID(),role:'assistant',text:result.reply,author:'Lia',provider:'claude',model:state.activity.model??null,activity:structuredClone(state.activity),media,at:now(),requestId:input.requestId,skills:refs,connectors:connectorRefs,brandRevision:brand?.revision??null});
        state.error=null;
      }catch(e){finishActivity(state.activity,'failed',now());state.error=e.status?e.message:'Não foi possível responder agora. Sua mensagem está salva.';throw e;}
      finally{state.pending=null;state.revision++;save(actor,state);}
    })();
    jobs.set(key(actor),job);
    try{await job;}finally{jobs.delete(key(actor));}
    return view(actor);
  }
  return {list,view,send,connectorAccess,updateConnectors,connectorMode,async close(){await Promise.allSettled([...jobs.values()]);db.close();}};
}
