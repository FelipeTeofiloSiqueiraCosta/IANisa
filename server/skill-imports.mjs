import {randomUUID,createHash} from 'node:crypto';
import {mkdirSync,chmodSync,readdirSync,lstatSync,unlinkSync,readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {problem} from './accounts.mjs';
import {parseSkillUpload,MAX_SKILL_UPLOAD,skillUploadName} from './skill-archive.mjs';
export {MAX_SKILL_UPLOAD,skillUploadName};
const limited=message=>Object.assign(problem(429,message),{retryAfter:60});
const digest=data=>createHash('sha256').update(data).digest('hex');
export function createSkillImports({directory,store,now=Date.now}){
 const folder=path.join(directory,'skill-imports');mkdirSync(folder,{recursive:true,mode:0o700});if(lstatSync(folder).isSymbolicLink())throw new Error('Diretório de importação inválido.');chmodSync(folder,0o700);
 // Arquivos de preparação não sobrevivem à reinicialização; o catálogo confirmado é preservado.
 for(const name of readdirSync(folder))if(/^[a-f0-9-]{36}\.upload$/.test(name))unlinkSync(path.join(folder,name));
 const pending=new Map(),inflight=new Set(),rates=new Map(),owner=a=>a.organization.id+':'+a.user.id;
 const admin=a=>{if(a.user.role!=='admin')throw problem(403,'Somente administradores podem importar skills.');};
 function discard(id){const item=pending.get(id);if(!item)return;pending.delete(id);try{unlinkSync(item.file);}catch(e){if(e.code!=='ENOENT')throw e;}}
 function purge(){for(const [id,item] of pending)if(item.expires<=now())discard(id);for(const [key,r]of rates)if(r.until<=now())rates.delete(key);}
 const timer=setInterval(purge,60000);timer.unref?.();
 function reserve(actor){admin(actor);purge();const key=owner(actor);if(inflight.size>=4||inflight.has(key))throw limited('Há outra importação em andamento. Aguarde um instante.');let rate=rates.get(key);if(!rate){rate={count:0,until:now()+60000};rates.set(key,rate);}if(rate.count>=10)throw limited('Foram feitas muitas tentativas de importação. Aguarde um minuto.');rate.count++;inflight.add(key);let released=false;return ()=>{if(!released){released=true;inflight.delete(key);}};}
 function quota(actor,size){const own=[...pending.values()].filter(p=>p.owner===owner(actor));const others=[...pending.values()].filter(p=>p.owner!==owner(actor));if(others.filter(p=>p.org===actor.organization.id).length>=2||others.reduce((n,p)=>n+p.size,0)+size>128*1024*1024)throw limited('Há importações aguardando confirmação. Finalize ou cancele uma antes de enviar outra.');return own;}
 async function prepare(actor,name,data){admin(actor);purge();skillUploadName(name);if(data.length>MAX_SKILL_UPLOAD)throw problem(413,'O arquivo deve ter até 24 MB.');quota(actor,data.length);const parsed=await parseSkillUpload(name,data),pkg=parsed.pkg;
  if(store.list(actor).skills.some(s=>s.name===pkg.name))throw problem(409,'Essa skill já está no catálogo. Você pode encontrá-la em Skills e escolher Usar no chat.');
  const own=quota(actor,data.length),id=randomUUID(),file=path.join(folder,id+'.upload');writeFileSync(file,data,{flag:'wx',mode:0o600});for(const old of own)discard(old.id);
  pending.set(id,{id,file,hash:digest(data),owner:owner(actor),org:actor.organization.id,name,size:data.length,expires:now()+10*60000});
  return {id,name:pkg.name,title:pkg.title,description:pkg.description,sourceName:name,expiresAt:now()+10*60000,ignored:parsed.ignored,main:pkg.files.find(f=>f.path==='SKILL.md').text,files:pkg.files.map(f=>({path:f.path,size:f.size??Buffer.byteLength(f.text),mime:f.mime||'text/plain'})),total:pkg.files.reduce((sum,f)=>sum+(f.size??Buffer.byteLength(f.text)),0)};
 }
 function owned(actor,id){admin(actor);purge();const item=pending.get(id);if(!item||item.owner!==owner(actor))throw problem(404,'Esta preparação expirou ou pertence a outra pessoa. Envie o arquivo novamente.');return item;}
 async function confirm(actor,id){const item=owned(actor,id);if(item.confirming)throw problem(409,'Esta skill já está sendo importada.');item.confirming=true;try{const data=readFileSync(item.file);if(digest(data)!==item.hash){discard(id);throw problem(409,'O arquivo temporário mudou. Envie a skill novamente.');}const parsed=await parseSkillUpload(item.name,data);if(owned(actor,id)!==item)throw problem(409,'A preparação mudou. Envie o arquivo novamente.');const result=store.install(actor,{files:parsed.files});discard(id);return result;}finally{item.confirming=false;}}
 function cancel(actor,id){owned(actor,id);discard(id);return {ok:true};}
 return {reserve,prepare,confirm,cancel,close(){clearInterval(timer);for(const id of [...pending.keys()])discard(id);}};
}
