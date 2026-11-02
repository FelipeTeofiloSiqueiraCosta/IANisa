import {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
import {mkdirSync,chmodSync,writeFileSync,readFileSync,renameSync,unlinkSync} from 'node:fs';
import path from 'node:path';
import {problem} from './accounts.mjs';
import {BRAND_FIELDS,topics,fieldLabels,initialBrandMessage,pendingValue,renderBrandSkill,extractorSkill} from './brand-schema.mjs';
export const MAX_BRAND_FILE=8*1024*1024,MAX_BRAND_TOTAL=24*1024*1024;
const proofFields=new Set(['NUMEROS','CASES','DEPOIMENTOS','AUTORIDADE']);
function visualDefaults(state) {
  const catalog=[...extractorSkill.matchAll(/^\| ([^|]+) \| `(#\w+)` \| `(#\w+)` \| `(#\w+)` \| `(#\w+)` \| ([^|]+) \|$/gm)];
  const niche=state.profile.NICHO?.value||'',closest=/imobili|arquitet/i.test(niche)?'Imobiliário':/saúde|odonto|clínica|fitness/i.test(niche)?'Fitness/Saúde':/gastron|restaurante|caf[eé]/i.test(niche)?'Gastronomia':/moda|beleza|estética/i.test(niche)?'Moda/Beleza':/educa|consultoria|mentoria/i.test(niche)?'Educação':/tech|software|saas/i.test(niche)?'Tech/SaaS':/advoca/i.test(niche)?'Advocacia':/contab/i.test(niche)?'Contabilidade':/loja|comércio|commerce/i.test(niche)?'E-commerce':/pet|veterin/i.test(niche)?'Pet/Veterinária':'Marketing Digital';
  const row=catalog.find(r=>r[1]===closest);if(!row)return;
  const classic=['Imobiliário','Gastronomia','Moda/Beleza','Advocacia','Contabilidade'].includes(closest),values={COR_PRIMARIA:row[2],COR_ACENTO:row[3],COR_FUNDO_CLARO:row[4],COR_FUNDO_ESCURO:row[5],FONTE_DISPLAY:row[6].trim(),FONTE_BODY:classic?'DM Sans':'Plus Jakarta Sans',ESTILO:classic?'Clássico':'Moderno'};
  for(const [key,value] of Object.entries(values))if(!state.profile[key]?.value||/^\[/.test(state.profile[key].value))state.profile[key]={value,source:'proposed',reason:'Sugestão visual do catálogo da skill · '+closest};
}
export function validateBrandFile(name,data) {
  if(!data.length||data.length>MAX_BRAND_FILE)throw problem(413,'Envie um arquivo de até 8 MB.');
  const extension=path.extname(String(name)).toLowerCase();
  if(extension==='.pdf'&&data.subarray(0,5).toString()==='%PDF-')return 'application/pdf';
  if(extension==='.png'&&data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return 'image/png';
  if(['.jpg','.jpeg'].includes(extension)&&data[0]===255&&data[1]===216&&data[2]===255)return 'image/jpeg';
  if(extension==='.webp'&&data.subarray(0,4).toString()==='RIFF'&&data.subarray(8,12).toString()==='WEBP')return 'image/webp';
  if(['.txt','.md','.csv'].includes(extension)) {try{const t=new TextDecoder('utf-8',{fatal:true}).decode(data);if(!/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(t))return 'text/plain';}catch{}}
  throw problem(415,'Use PDF, PNG, JPG, WebP, TXT, Markdown ou CSV. O conteúdo precisa corresponder ao tipo do arquivo.');
}
export function validateBrandAnswer(value) {
  if(!value||typeof value.reply!=='string'||!value.reply.trim()||value.reply.length>10000||!Array.isArray(value.fields)||value.fields.length>BRAND_FIELDS.length||!Number.isInteger(value.nextBlock)||value.nextBlock<0||value.nextBlock>11||typeof value.reviewReady!=='boolean')throw problem(502,'A IA devolveu um resumo incompleto. Sua mensagem está salva; tente novamente.');
  for(const f of value.fields){if(!BRAND_FIELDS.includes(f.key)||typeof f.value!=='string'||f.value.length>5000||!['provided','inferred','proposed'].includes(f.source))throw problem(502,'A IA devolveu um campo inválido. Tente novamente.');if(proofFields.has(f.key)&&f.source!=='provided')f.value=pendingValue(f.key);}
  return value;
}
const cleanName=n=>String(n??'arquivo').split(/[\\/]/).at(-1).replace(/[\x00-\x1f\x7f<>]/g,'').trim().slice(0,160)||'arquivo';
const msg=(role,text,actor,extra={})=>({id:randomUUID(),role,text,author:actor?.user?.name??'Assistente da marca',at:Date.now(),...extra});
export function createBrandStore({directory,runTurn,resolveSkills=()=>[],resolveConnectors=()=>[],now=Date.now}) {
  mkdirSync(directory,{recursive:true,mode:0o700});
  const filename=path.join(directory,'brain.sqlite'),db=new DatabaseSync(filename);chmodSync(filename,0o600);
  db.exec(`PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS brands(org_id TEXT PRIMARY KEY,state TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS brand_files(id TEXT PRIMARY KEY,org_id TEXT NOT NULL,name TEXT NOT NULL,mime TEXT NOT NULL,size INTEGER NOT NULL,created_by TEXT NOT NULL,at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS brand_versions(org_id TEXT NOT NULL,revision INTEGER NOT NULL,profile TEXT NOT NULL,skill TEXT NOT NULL,actor TEXT NOT NULL,at INTEGER NOT NULL,PRIMARY KEY(org_id,revision));
  `);
  const get=(sql,...args)=>db.prepare(sql).get(...args),all=(sql,...args)=>db.prepare(sql).all(...args),run=(sql,...args)=>db.prepare(sql).run(...args);
  const jobs=new Map();
  function orgDir(org) {if(!/^[a-f0-9-]{36}$/.test(org))throw problem(400,'Organização inválida.');return path.join(directory,'organizations',org);}
  function save(org,state) {run('INSERT INTO brands(org_id,state) VALUES (?,?) ON CONFLICT(org_id) DO UPDATE SET state=excluded.state',org,JSON.stringify(state));}
  function load(actor) {
    const id=actor.organization.id,row=get('SELECT state FROM brands WHERE org_id=?',id);
    mkdirSync(orgDir(id),{recursive:true,mode:0o700});
    if(row)return JSON.parse(row.state);
    const s={revision:0,block:0,profile:{},notes:{},messages:[msg('assistant',initialBrandMessage)],dismissed:[],reviewReady:false,provider:'claude',pending:null,confirmedRevision:0};
    save(id,s);return s;
  }
  function assertEditor(actor) {if(actor.user.role!=='admin')throw problem(403,'Somente administradores podem alterar as informações da empresa.');}
  function listFiles(org) {return all('SELECT id,name,mime,size,at FROM brand_files WHERE org_id=? ORDER BY at',org);}
  function view(actor) {
    const state=load(actor),confirmed=get('SELECT revision,profile,at FROM brand_versions WHERE org_id=? ORDER BY revision DESC LIMIT 1',actor.organization.id);
    if(state.pending&&!jobs.has(actor.organization.id)){state.error='A conexão foi interrompida. Sua mensagem está salva; você pode tentar novamente.';state.pending=null;save(actor.organization.id,state);}
    return {...state,editable:actor.user.role==='admin',onboardingNeeded:actor.user.role==='admin'&&!confirmed&&!state.dismissed.includes(actor.user.id),files:listFiles(actor.organization.id),topics:topics.map(t=>({...t,fields:t.fields.filter(k=>BRAND_FIELDS.includes(k))})),fieldLabels,confirmed:confirmed?{revision:confirmed.revision,profile:JSON.parse(confirmed.profile),at:confirmed.at}:null};
  }
  function fileFor(actor,id) {const f=get('SELECT * FROM brand_files WHERE org_id=? AND id=?',actor.organization.id,id);if(!f)throw problem(404,'Arquivo não encontrado.');return {...f,data:readFileSync(path.join(orgDir(actor.organization.id),'uploads',f.id))};}
  function upload(actor,name,data) {
    assertEditor(actor);const mime=validateBrandFile(name,data),org=actor.organization.id,s=load(actor);
    if(jobs.has(org))throw problem(409,'Espere a resposta da IA antes de adicionar outro arquivo.');
    const quota=get('SELECT count(*) AS n,coalesce(sum(size),0) AS bytes FROM brand_files WHERE org_id=?',org);
    if(quota.n>=12||quota.bytes+data.length>MAX_BRAND_TOTAL)throw problem(413,'Esta marca pode guardar até 12 arquivos, somando 24 MB.');
    const id=randomUUID(),dir=path.join(orgDir(org),'uploads');mkdirSync(dir,{recursive:true,mode:0o700});
    writeFileSync(path.join(dir,id),data,{mode:0o600,flag:'wx'});
    try{run('INSERT INTO brand_files VALUES (?,?,?,?,?,?,?)',id,org,cleanName(name),mime,data.length,actor.user.id,now());}catch(e){unlinkSync(path.join(dir,id));throw e;}
    s.revision++;save(org,s);return {id,name:cleanName(name),mime,size:data.length,at:now()};
  }
  function patch(actor,input) {
    assertEditor(actor);const org=actor.organization.id,s=load(actor);if(jobs.has(org))throw problem(409,'Espere a resposta da IA antes de editar.');
    if(input.revision!==s.revision)throw problem(409,'A marca foi atualizada em outra aba. Atualize o resumo para continuar.');
    if(!input.fields||typeof input.fields!=='object'||Array.isArray(input.fields)||Object.keys(input.fields).length>BRAND_FIELDS.length)throw problem(400,'Dados inválidos.');
    for(const [key,value] of Object.entries(input.fields)){if(!BRAND_FIELDS.includes(key)||typeof value!=='string'||value.length>5000)throw problem(400,'Campo inválido.');s.profile[key]={value:value.trim(),source:'provided',at:now(),actor:actor.user.id};}
    s.revision++;save(org,s);return view(actor);
  }
  async function send(actor,input) {
    assertEditor(actor);const org=actor.organization.id;
    if(jobs.has(org))throw problem(409,'A IA já está respondendo. Aguarde um instante.');
    const s=load(actor);
    if(typeof input.requestId!=='string'||!/^[a-f0-9-]{36}$/.test(input.requestId))throw problem(400,'Mensagem inválida.');
    if(s.messages.some(m=>m.requestId===input.requestId&&m.role==='assistant'))return view(actor);
    if(typeof input.text!=='string'||input.text.length>12000||(!input.text.trim()&&!input.fileIds?.length))throw problem(400,'Escreva uma mensagem ou envie um arquivo.');
    if(input.provider!=='claude')throw problem(400,'A entrevista requer uma conexão real com o Claude.');
    if(!Array.isArray(input.fileIds)||input.fileIds.length>12)throw problem(400,'Arquivos inválidos.');
    for(const id of input.fileIds)fileFor(actor,id);
    const skillIds=input.skillIds??[],connectorIds=input.connectorIds??[];
    const skills=resolveSkills(actor,skillIds),connectors=resolveConnectors(actor,connectorIds);
    const auxiliary=skills.some(s=>!['extrator-de-marca','minha-marca'].includes(s.name))||((skills.length>0||connectors.length>0)&&!skills.some(s=>s.name==='extrator-de-marca')); 
    const skillRefs=skills.map(({id,name,title,version})=>({id,name,title,version})),connectorRefs=connectors.map(({id,title})=>({id,title}));
    const existing=s.messages.find(m=>m.requestId===input.requestId&&m.role==='user');
    if(existing&&(existing.text!==input.text.trim()||JSON.stringify(existing.fileIds)!==JSON.stringify(input.fileIds)||JSON.stringify(existing.skills??[])!==JSON.stringify(skillRefs)||JSON.stringify(existing.connectors??[])!==JSON.stringify(connectorRefs)))throw problem(409,'Essa mensagem já foi enviada com outro conteúdo ou seleção. Envie uma nova mensagem.');
    if(!existing){if(input.revision!==s.revision)throw problem(409,'A conversa foi atualizada em outra aba. Atualize para continuar.');if(s.messages.length>=100)throw problem(413,'A conversa atingiu o limite. Confira o resumo e salve a marca.');s.messages.push(msg('user',input.text.trim(),actor,{requestId:input.requestId,fileIds:input.fileIds,skills:skillRefs,connectors:connectorRefs}));if(!auxiliary&&input.text.trim()&&s.messages.filter(m=>m.role==='user'&&!m.skills?.some(x=>!['extrator-de-marca','minha-marca'].includes(x.name))).length>1)s.notes[topics[Math.min(s.block,10)].id]=[...(s.notes[topics[Math.min(s.block,10)].id]||[]),input.text.trim()];}
    s.provider=input.provider;s.error=null;s.pending=input.requestId;s.revision++;save(org,s);
    const job=(async()=>{
      try{
        const files=listFiles(org).map(f=>fileFor(actor,f.id));
        const result=validateBrandAnswer(await runTurn({actor,requestId:input.requestId,provider:'claude',directory:orgDir(org),state:s,files,skills,connectors,auxiliary}));
        const latest=load(actor);
        if(!auxiliary){for(const f of result.fields)latest.profile[f.key]={value:f.value,source:f.source,at:now(),requestId:input.requestId};latest.block=result.nextBlock;latest.reviewReady=result.reviewReady;if(result.reviewReady)visualDefaults(latest);}
        latest.pending=null;latest.error=null;
        latest.messages.push(msg('assistant',result.reply,null,{requestId:input.requestId,provider:input.provider,skills:skillRefs,connectors:connectorRefs}));latest.revision++;save(org,latest);
      }catch(e){const latest=load(actor);latest.pending=null;latest.error=e.status?e.message:'Não foi possível responder agora. Sua mensagem ficou salva.';latest.revision++;save(org,latest);throw e;}
    })();
    jobs.set(org,job);
    try{await job;}finally{jobs.delete(org);}
    return view(actor);
  }
  function review(actor) {assertEditor(actor);const s=load(actor);if(jobs.has(actor.organization.id))throw problem(409,'Espere a resposta da IA.');visualDefaults(s);s.reviewReady=true;s.revision++;save(actor.organization.id,s);return view(actor);}
  function confirm(actor,input) {
    assertEditor(actor);const org=actor.organization.id,s=load(actor);if(jobs.has(org))throw problem(409,'Espere a resposta da IA.');
    if(input.revision!==s.revision)throw problem(409,'O resumo mudou. Confira a versão atual antes de salvar.');
    if(!s.reviewReady)throw problem(409,'Confira o resumo da marca antes de salvar no cérebro.');
    if(!s.profile.NOME_MARCA?.value?.trim()||/^\[/.test(s.profile.NOME_MARCA.value))throw problem(400,'Informe o nome da marca no resumo antes de salvar.');
    const profile=structuredClone(s.profile);for(const key of BRAND_FIELDS)if(!profile[key]?.value)profile[key]={value:pendingValue(key),source:'missing'};
    // Propostas e hipóteses ficam registradas como tal até esta confirmação explícita.
    let skill=renderBrandSkill(profile);
    if(Object.keys(s.notes).length)skill+='\n\n## Anotações fornecidas na entrevista\n\n'+Object.entries(s.notes).map(([id,texts])=>'### '+topics.find(t=>t.id===id).title+'\n'+texts.map(t=>t.replace(/^/gm,'> ')).join('\n\n')).join('\n\n');
    const revision=s.confirmedRevision+1,dir=path.join(orgDir(org),'.claude','skills','minha-marca');mkdirSync(dir,{recursive:true,mode:0o700});
    const temp=path.join(dir,randomUUID()+'.tmp');writeFileSync(temp,skill,{mode:0o600});renameSync(temp,path.join(dir,'SKILL.md'));
    db.exec('BEGIN IMMEDIATE');try{run('INSERT INTO brand_versions VALUES (?,?,?,?,?,?)',org,revision,JSON.stringify(profile),skill,actor.user.id,now());s.confirmedRevision=revision;s.profile=profile;s.dismissed=[...new Set([...s.dismissed,actor.user.id])];s.reviewReady=false;s.revision++;save(org,s);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}
    return view(actor);
  }
  function dismiss(actor){const s=load(actor);s.dismissed=[...new Set([...s.dismissed,actor.user.id])];save(actor.organization.id,s);return view(actor);}
  function exportSkill(actor){const r=get('SELECT skill FROM brand_versions WHERE org_id=? ORDER BY revision DESC LIMIT 1',actor.organization.id);if(!r)throw problem(404,'A marca ainda não foi salva no cérebro.');return r.skill;}
  return {view,upload,fileFor,patch,send,review,confirm,dismiss,exportSkill,close(){if(jobs.size)return Promise.allSettled([...jobs.values()]).then(()=>db.close());db.close();}};
}
