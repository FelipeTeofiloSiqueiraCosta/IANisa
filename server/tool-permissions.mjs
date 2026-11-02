import {randomUUID} from 'node:crypto';
import {problem} from './accounts.mjs';

// Toda chamada continua passando pelo servidor, inclusive quando o agente tem
// autorização persistente. Não usamos allow_always no ACP: revogação vale já na próxima chamada.
export function createToolPermissions({timeout=60000}={}) {
 const pending=new Map(),owner=a=>a.organization.id+':'+a.user.id;
 const cancelled=()=>({outcome:{outcome:'cancelled'}}),accepted=optionId=>({outcome:{outcome:'selected',optionId}});
 function decision(item){try{const value=item.mode(item.server);return ['allow','ask'].includes(value)?value:'deny';}catch{return 'deny';}}
 function reconcile(){for(const item of [...pending.values()]){const mode=decision(item);if(mode!=='ask')item.finish(mode==='allow'?accepted(item.optionId):cancelled());}}
 function ask(actor,requestId,params,servers,{mode=()=> 'ask'}={}){
  const allow=params.options?.find(o=>o.kind==='allow_once'),call=params.toolCall;
  const rawTitle=String(call?.title||'Ferramenta do conector').slice(0,300),raw=JSON.stringify(call?.rawInput??{});
  const declared=call?._meta?.claudeCode?.toolName||call?._meta?.toolName||(rawTitle.startsWith('mcp__')?rawTitle:null);
  // Um nome explícito de ferramenta nativa nunca é tratado como MCP.
  const server=declared?servers.find(s=>declared.startsWith('mcp__'+s.name+'__')):servers.find(s=>call?._meta?.claudeCode?.mcpServer?.name===s.name);
  if(!allow||!server)return Promise.resolve(cancelled());
  const tool=declared?.slice(('mcp__'+server.name+'__').length)||rawTitle;
  const names={generate_image:'Gerar imagem',generate_video:'Gerar vídeo',generate_audio:'Gerar áudio',balance:'Consultar saldo',get_status:'Consultar andamento'};
  const title=rawTitle.startsWith('mcp__')?(names[tool]||tool.replaceAll('_',' ')):rawTitle;
  const item={server,mode,optionId:allow.optionId};const initial=decision(item);
  if(initial==='allow')return Promise.resolve(accepted(allow.optionId));
  if(initial==='deny')return Promise.resolve(cancelled());
  const id=randomUUID();return new Promise(resolve=>{
   const finish=result=>{clearTimeout(pending.get(id)?.timer);pending.delete(id);resolve(result);};
   const timer=setTimeout(()=>finish(cancelled()),timeout);timer.unref?.();
   pending.set(id,{...item,id,owner:owner(actor),requestId,title,connectorId:server.id,connector:server.title||server.name,input:raw.slice(0,16000),at:Date.now(),finish,timer});
  });
 }
 function list(actor){reconcile();return {permissions:[...pending.values()].filter(p=>p.owner===owner(actor)).map(({id,requestId,title,connectorId,connector,input,at})=>({id,requestId,title,connectorId,connector,input,at}))};}
 function decide(actor,id,allow){if(typeof allow!=='boolean')throw problem(400,'Informe se deseja permitir a execução.');const p=pending.get(id);if(!p||p.owner!==owner(actor))throw problem(404,'Este pedido expirou ou pertence a outra pessoa.');p.finish(allow&&decision(p)!=='deny'?accepted(p.optionId):cancelled());return {ok:true};}
 function cancel(actor,requestId){for(const p of [...pending.values()])if(p.owner===owner(actor)&&p.requestId===requestId)p.finish(cancelled());}
 return {ask,list,decide,reconcile,cancel,close(){for(const p of [...pending.values()])p.finish(cancelled());}};
}
