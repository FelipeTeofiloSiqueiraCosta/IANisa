import {imageURLs} from '../shared/chat-media.mjs';

const actions={generate_image:'Gerar imagem',generate_video:'Gerar vídeo',generate_audio:'Gerar áudio',balance:'Consultar saldo',get_status:'Consultar andamento',get_generation:'Consultar geração',get_task_status:'Consultar andamento'};
const modelId=value=>typeof value==='string'&&value.length<=100&&/^(default|claude-[a-z0-9._:-]+|(?:opus|sonnet|haiku)[a-z0-9._:-]*)$/i.test(value)?value:null;
const mediaModel=value=>typeof value==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9 ._/-]{0,79}$/.test(value)?value:null;
export function sessionModel(session){
  const option=session?.configOptions?.find(o=>o.category==='model'||o.id==='model');
  const id=modelId(option?.currentValue??session?.models?.currentModelId);
  const entry=option?.options?.flatMap(o=>o.options??[o]).find(o=>o.value===id);
  const name=typeof entry?.name==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9 ._():/+-]{0,79}$/.test(entry.name)?entry.name:null;
  return id?{provider:'claude',id,...(name?{name}:{})}:null;
}
export function createTurnObserver({connectors=[],onProgress=()=>{}}={}){
  const calls=new Map(),media=new Map();let model=null,responding=false,closed=false;
  const emit=event=>{if(!closed)onProgress(event);};
  function phase(id){emit({type:'phase',id});}
  function setModel(session){const next=sessionModel(session);if(next&&JSON.stringify(next)!==JSON.stringify(model)){model=next;emit({type:'model',model});}}
  function callInfo(update){
    const name=update?._meta?.claudeCode?.toolName||update?._meta?.toolName||(update.title?.startsWith('mcp__')?update.title:null);
    const connector=name?connectors.find(c=>name.startsWith('mcp__'+c.name+'__')):null;
    return connector?{connector,tool:name.slice(('mcp__'+connector.name+'__').length)}:null;
  }
  function update(u){
    if(closed||!u)return;
    if(u.sessionUpdate==='config_option_update'){setModel(u);return;}
    if(u.sessionUpdate==='agent_message_chunk'){
      if(!responding&&u.content?.type==='text'){responding=true;phase('responding');}return;
    }
    if(!['tool_call','tool_call_update'].includes(u.sessionUpdate)||typeof u.toolCallId!=='string')return;
    let call=calls.get(u.toolCallId);const info=callInfo(u);
    if(!call&&info&&calls.size<60){call={...info,id:u.toolCallId};calls.set(u.toolCallId,call);}
    if(!call)return; // Ferramentas nativas/desconhecidas não viram atividade de MCP.
    if(['cancelled','failed'].includes(call.status))return;
    if(u.rawInput){call.model=mediaModel(u.rawInput.model??u.rawInput.model_id)??call.model;}
    responding=false;
    const status=({pending:'running',in_progress:'running',completed:'completed',failed:'failed',cancelled:'cancelled'})[u.status]??'running';
    call.status=status;
    emit({type:'tool',id:call.id,label:(actions[call.tool]||'Executar ferramenta')+' · '+call.connector.title,status});
    if(status==='completed'&&call.connector.builtin==='higgsfield'){
      // Examina apenas resultados concluídos, com tamanho limitado; não persiste o payload.
      let raw='';try{raw=JSON.stringify(u.rawOutput??u.content??'').slice(0,200000);}catch{}
      for(const url of imageURLs(raw))if(media.size<6)media.set(url,{url,connector:'higgsfield',model:call.model??null,source:'tool'});
    }
  }
  async function permission(params,authorize){
    const u=params.toolCall??{},info=callInfo(u);
    if(!info)return authorize();
    update({...u,sessionUpdate:'tool_call'});
    emit({type:'tool',id:u.toolCallId,label:(actions[info.tool]||'Executar ferramenta')+' · '+info.connector.title,status:'waiting'});
    try{
      const result=await authorize();
      const status=result.outcome?.outcome==='selected'?'running':'cancelled';if(calls.has(u.toolCallId))calls.get(u.toolCallId).status=status;
      emit({type:'tool',id:u.toolCallId,label:(actions[info.tool]||'Executar ferramenta')+' · '+info.connector.title,status});
      return result;
    }catch(e){emit({type:'tool',id:u.toolCallId,label:'Usar conector · '+info.connector.title,status:'failed'});throw e;}
  }
  return {phase,setModel,update,permission,metadata:()=>({model,media:[...media.values()]}),close(){closed=true;}};
}
