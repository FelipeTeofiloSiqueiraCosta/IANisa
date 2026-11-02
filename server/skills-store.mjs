// Catálogo único da instalação. O UUID legado identifica a empresa, não um tenant.
// Instruções são enviadas ao modelo por seleção explícita; scripts importados não são executados.
import {DatabaseSync} from 'node:sqlite';
import {randomUUID,createHash} from 'node:crypto';
import {mkdirSync,chmodSync,readFileSync,writeFileSync,renameSync,lstatSync,existsSync,mkdtempSync,rmSync,readdirSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {imageSize} from 'image-size';
import {problem} from './accounts.mjs';
import {normalizeSkillFiles,normalizeSkillMetadata,SKILL_LIMITS} from '../shared/skill-import.js';
export const MAX_SKILL_BYTES=SKILL_LIMITS.total;
function imageMime(name,data){
 const ext=path.extname(name).toLowerCase();if(!['.png','.jpg','.jpeg','.webp'].includes(ext))throw problem(400,'Use imagens PNG, JPG ou WebP.');
 if(data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return 'image/png';
 if(data[0]===255&&data[1]===216&&data[2]===255)return 'image/jpeg';
 if(data.subarray(0,4).toString()==='RIFF'&&data.subarray(8,12).toString()==='WEBP')return 'image/webp';
 throw problem(400,'Use imagens PNG, JPG ou WebP com o conteúdo correspondente ao formato.');
}
export function validateSkillPackage(files) {
 if(!Array.isArray(files)||files.length<1||files.length>SKILL_LIMITS.files)throw problem(400,'Envie uma skill com até 64 arquivos.');
 const names=new Set();let total=0,textTotal=0;
 let checked=files.map(file=>{
  if(typeof file?.path!=='string')throw problem(400,'Arquivo de skill inválido.');
  const parts=file.path.split('/');
  if(file.path.length>220||parts.some(p=>!p||p==='.'||p==='..'||p.startsWith('.')||!/^[-\p{L}\p{N}_. ]+$/u.test(p)))throw problem(400,'Use caminhos relativos, sem atalhos ou pastas ocultas.');
  const key=file.path.normalize('NFC').toLowerCase();if(names.has(key))throw problem(400,'Há arquivos repetidos na pasta.');names.add(key);
  if(typeof file.text==='string'&&file.base64===undefined){
   if(!/\.(md|txt|json|ya?ml|sh|py|js|css|csv)$/i.test(file.path))throw problem(400,'Use arquivos de texto, scripts de referência ou imagens PNG, JPG e WebP.');
   const bytes=Buffer.byteLength(file.text);total+=bytes;textTotal+=bytes;
   if(bytes>SKILL_LIMITS.text||/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(file.text))throw problem(400,'Cada arquivo de texto deve ter até 128 KB.');
   return {path:file.path,text:file.text};
  }
  if(typeof file.base64!=='string'||file.text!==undefined||file.base64.length>Math.ceil(SKILL_LIMITS.image/3)*4||file.base64.length%4!==0||!/^[A-Za-z0-9+/]*={0,2}$/.test(file.base64))throw problem(400,'Imagem inválida ou maior que 8 MB.');
  const data=Buffer.from(file.base64,'base64');if(!data.length||data.length>SKILL_LIMITS.image)throw problem(400,'Cada imagem deve ter até 8 MB.');
  const mime=imageMime(file.path,data);let dimensions;try{dimensions=imageSize(data);}catch{throw problem(400,'Não foi possível validar as dimensões de uma imagem.');}
  const {width,height}=dimensions;if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>12000||height>12000||width*height>20000000)throw problem(400,'Cada imagem deve ter até 20 megapixels e no máximo 12.000 pixels por lado.');
  total+=data.length;return {path:file.path,base64:file.base64,mime,size:data.length,width,height,sha256:createHash('sha256').update(data).digest('hex')};
 });
 if(total>MAX_SKILL_BYTES)throw problem(413,'A pasta da skill deve ter até 24 MB.');
 if(textTotal>SKILL_LIMITS.textTotal)throw problem(413,'Os textos da skill devem somar até 1 MB.');
 checked=normalizeSkillFiles(checked);
 if(new Set(checked.map(f=>f.path)).size!==checked.length)throw problem(400,'Há mais de um arquivo principal SKILL.md. Selecione uma única skill.');
 const main=checked.find(f=>f.path==='SKILL.md'&&typeof f.text==='string');if(!main)throw problem(400,'A pasta precisa ter um SKILL.md na raiz.');
 let metadata;try{metadata=normalizeSkillMetadata(main.text);}catch(e){throw problem(400,e.message);}main.text=metadata.text;
 return {name:metadata.name,title:metadata.title,description:metadata.description,files:checked};
}
function readPackage(folder) {
 if(folder instanceof URL)folder=fileURLToPath(folder);
 const files=[];let entries=0,total=0;
 function walk(dir,prefix='') {
  if(lstatSync(dir).isSymbolicLink())throw problem(409,'A pasta da skill não pode ser um atalho.');
  for(const entry of readdirSync(dir,{withFileTypes:true})){
   if(entry.name.startsWith('.')||entry.name==='__MACOSX')continue;
   if(++entries>256)throw problem(413,'A pasta tem entradas demais.');
   const filename=path.join(dir,entry.name),relative=prefix+entry.name,info=lstatSync(filename);
   if(info.isSymbolicLink()||!info.isDirectory()&&!info.isFile())throw problem(409,'A skill contém um arquivo especial.');
   if(info.isDirectory()){walk(filename,relative+'/');continue;}
   const image=/\.(png|jpe?g|webp)$/i.test(relative);total+=info.size;
   if(files.length>=SKILL_LIMITS.files||info.size>(image?SKILL_LIMITS.image:SKILL_LIMITS.text)||total>SKILL_LIMITS.total)throw problem(413,'A pasta ultrapassa os limites de skill.');
   const data=readFileSync(filename);let file;
   if(image)file={path:relative,base64:data.toString('base64')};
   else {let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(data);}catch{throw problem(400,'O texto da skill precisa estar em UTF-8.');}file={path:relative,text};}
   files.push(file);
  }
 }
 walk(folder);return validateSkillPackage(files);
}
const defaultsDirectory=new URL('./skills-defaults/',import.meta.url);
const bundledDefaults=readdirSync(defaultsDirectory,{withFileTypes:true}).filter(e=>e.isDirectory()&&!e.name.startsWith('.')).map(e=>readPackage(new URL(e.name+'/',defaultsDirectory)));
const bytes=files=>files.reduce((sum,f)=>sum+(f.size??Buffer.byteLength(f.text)),0);
const metadata=files=>files.map(({base64,...file})=>file);
const fingerprint=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0,16);
export function createSkillsStore({directory,generatedSkill=()=>null,now=Date.now}) {
 mkdirSync(directory,{recursive:true,mode:0o700});const filename=path.join(directory,'skills.sqlite'),db=new DatabaseSync(filename);chmodSync(filename,0o600);
 db.exec(`PRAGMA busy_timeout=5000;
 CREATE TABLE IF NOT EXISTS skills(id TEXT PRIMARY KEY,org_id TEXT NOT NULL,name TEXT NOT NULL,title TEXT NOT NULL,description TEXT NOT NULL,files TEXT NOT NULL,enabled INTEGER NOT NULL DEFAULT 1,created_by TEXT NOT NULL,at INTEGER NOT NULL,UNIQUE(org_id,name));
 CREATE TABLE IF NOT EXISTS skill_preferences(org_id TEXT NOT NULL,skill_id TEXT NOT NULL,enabled INTEGER NOT NULL,PRIMARY KEY(org_id,skill_id));
 CREATE TABLE IF NOT EXISTS skill_catalog_installation(singleton INTEGER PRIMARY KEY CHECK(singleton=1),company_id TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS skill_default_seeds(name TEXT PRIMARY KEY);
 CREATE TABLE IF NOT EXISTS skill_edit_backups(id TEXT PRIMARY KEY,files TEXT NOT NULL);`);
 const columns=new Set(db.prepare('PRAGMA table_info(skills)').all().map(c=>c.name));
 for(const [name,definition] of [['source',"TEXT NOT NULL DEFAULT 'custom'"],['deleted_at','INTEGER'],['revision','INTEGER NOT NULL DEFAULT 1']])if(!columns.has(name))db.exec('ALTER TABLE skills ADD COLUMN '+name+' '+definition);
 const get=(sql,...a)=>db.prepare(sql).get(...a),all=(sql,...a)=>db.prepare(sql).all(...a),run=(sql,...a)=>db.prepare(sql).run(...a);
 const parent=path.join(directory,'skills'),trash=path.join(directory,'skill-trash');
 for(const folder of [parent,trash]){if(existsSync(folder)&&lstatSync(folder).isSymbolicLink())throw problem(409,'O diretório de skills não pode ser um atalho.');mkdirSync(folder,{recursive:true,mode:0o700});chmodSync(folder,0o700);}
 const admin=actor=>{if(actor.user.role!=='admin')throw problem(403,'Somente administradores podem configurar as skills da instalação.');};
 let ready=false;
 function checkCompany(actor) {
  const id=actor?.organization?.id;if(!/^[a-f0-9-]{36}$/.test(id))throw problem(400,'Empresa inválida.');
  const installed=get('SELECT company_id FROM skill_catalog_installation WHERE singleton=1');
  if(installed&&installed.company_id!==id)throw problem(404,'Esta empresa não pertence à instalação.');
  if(!installed){if(all('SELECT DISTINCT org_id FROM skills').some(r=>r.org_id!==id))throw problem(409,'O catálogo contém dados de outra instalação. Restaure o backup completo antes de continuar.');run('INSERT INTO skill_catalog_installation VALUES (1,?)',id);}
  return id;
 }
 function writePackage(pkg) {
  const temp=mkdtempSync(path.join(parent,'.import-'));
  try{for(const file of pkg.files){const target=path.join(temp,file.path);mkdirSync(path.dirname(target),{recursive:true,mode:0o700});writeFileSync(target,typeof file.text==='string'?Buffer.from(file.text):Buffer.from(file.base64,'base64'),{flag:'wx',mode:0o600});}return temp;}
  catch(e){rmSync(temp,{recursive:true,force:true});throw e;}
 }
 function ensure(actor) {
  const company=checkCompany(actor);if(ready)return company;
  // A migração copia os arquivos para o catálogo da instalação e preserva a pasta antiga.
  for(const row of all('SELECT * FROM skills WHERE deleted_at IS NULL')){
   const destination=path.join(parent,row.name);if(existsSync(destination)){if(lstatSync(destination).isSymbolicLink())throw problem(409,'Destino inválido de skill.');continue;}
   const legacy=path.join(directory,'organizations',company,'.claude','skills',row.name);
   if(!existsSync(legacy))throw problem(409,'Os arquivos de uma skill existente não foram encontrados. Restaure o backup antes de continuar.');
   const pkg=readPackage(legacy),temp=writePackage(pkg);renameSync(temp,destination);
  }
  for(const bundled of bundledDefaults){
   if(get('SELECT name FROM skill_default_seeds WHERE name=?',bundled.name))continue;
   const existing=get('SELECT * FROM skills WHERE name=?',bundled.name);
   if(existing){run("UPDATE skills SET source='default' WHERE id=?",existing.id);run('INSERT INTO skill_default_seeds VALUES (?)',bundled.name);continue;}
   const id='default:'+bundled.name,legacy=path.join(directory,'organizations',company,'.claude','skills',bundled.name);
   const pkg=existsSync(legacy)?readPackage(legacy):bundled,destination=path.join(parent,pkg.name);
   if(existsSync(destination))throw problem(409,'Há uma pasta de skill fora do catálogo. Preserve o backup e confira a instalação.');
   const temp=writePackage(pkg),enabled=get('SELECT enabled FROM skill_preferences WHERE org_id=? AND skill_id=?',company,id)?.enabled??1;let moved=false;
   db.exec('BEGIN IMMEDIATE');try{run("INSERT INTO skills(id,org_id,name,title,description,files,enabled,created_by,at,source) VALUES (?,?,?,?,?,?,?,?,?,'default')",id,company,pkg.name,pkg.title,pkg.description,JSON.stringify(metadata(pkg.files)),enabled,actor.user.id,now());run('INSERT INTO skill_default_seeds VALUES (?)',pkg.name);renameSync(temp,destination);moved=true;db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');rmSync(moved?destination:temp,{recursive:true,force:true});throw e;}
  }
  ready=true;return company;
 }
 function convert(row){return {...row,files:JSON.parse(row.files),enabled:Boolean(row.enabled),version:fingerprint([row.revision,row.files,row.enabled,row.deleted_at])};}
 function generated(actor){let text;try{text=generatedSkill(actor);}catch{}if(!text)return null;return {id:'generated:minha-marca',name:'minha-marca',title:'Minha marca',description:'Dados da empresa, gerados pela entrevista desta instalação.',source:'generated',enabled:get('SELECT enabled FROM skill_preferences WHERE org_id=? AND skill_id=?',actor.organization.id,'generated:minha-marca')?.enabled!==0,files:[{path:'SKILL.md',text}],version:fingerprint(text)};}
 function summary(pkg){return {id:pkg.id,name:pkg.name,title:pkg.title,description:pkg.description,source:pkg.source,enabled:pkg.enabled,version:pkg.version,fileCount:pkg.files.length,manageable:pkg.source!=='generated',deletedAt:pkg.deleted_at??null};}
 function list(actor){ensure(actor);const packages=all('SELECT * FROM skills WHERE deleted_at IS NULL ORDER BY CASE source WHEN \'default\' THEN 0 ELSE 1 END,at,name').map(convert),brand=generated(actor);if(brand)packages.push(brand);return {skills:packages.map(summary),editable:actor.user.role==='admin',deletedCount:actor.user.role==='admin'?get('SELECT count(*) AS n FROM skills WHERE deleted_at IS NOT NULL').n:0};}
 function stored(actor,id,deleted=false){ensure(actor);const row=get('SELECT * FROM skills WHERE id=?',id);if(!row||Boolean(row.deleted_at)!==deleted)throw problem(404,'Skill não encontrada.');return convert(row);}
 function detail(actor,id){ensure(actor);const pkg=id==='generated:minha-marca'?generated(actor):stored(actor,id);if(!pkg)throw problem(404,'Skill não encontrada.');return {...summary(pkg),files:pkg.files};}
 function quota(pkg,{replacing=null,backup=false,restoring=false}={}){const rows=all('SELECT * FROM skills');if(!replacing&&rows.filter(r=>r.deleted_at===null).length>=40)throw problem(413,'A instalação pode ter até 40 skills no catálogo.');const total=rows.reduce((sum,r)=>sum+bytes(JSON.parse(r.files)),0)+all('SELECT files FROM skill_edit_backups').reduce((sum,r)=>sum+bytes(JSON.parse(r.files)),0);const old=replacing?rows.find(r=>r.id===replacing):null;if(total+(restoring?0:bytes(pkg.files))-(old&&!backup?bytes(JSON.parse(old.files)):0)>100*1024*1024)throw problem(413,'As skills, a lixeira e as versões anteriores atingiram o limite de 100 MB da instalação.');}

 function install(actor,input){
  admin(actor);const company=ensure(actor),pkg=validateSkillPackage(input.files);
  if(pkg.name==='minha-marca'||get('SELECT id FROM skills WHERE name=?',pkg.name))throw problem(409,'Essa skill já está no catálogo ou nas excluídas. Use ou restaure a versão existente.');quota(pkg);
  const destination=path.join(parent,pkg.name);if(existsSync(destination))throw problem(409,'Já há arquivos nesse destino. Consulte o administrador.');
  const temp=writePackage(pkg),id=randomUUID();let moved=false,committed=false;
  try{db.exec('BEGIN IMMEDIATE');try{run("INSERT INTO skills(id,org_id,name,title,description,files,enabled,created_by,at,source) VALUES (?,?,?,?,?,?,?,?,?,'custom')",id,company,pkg.name,pkg.title,pkg.description,JSON.stringify(metadata(pkg.files)),1,actor.user.id,now());renameSync(temp,destination);moved=true;db.exec('COMMIT');committed=true;}catch(e){db.exec('ROLLBACK');throw e;}return detail(actor,id);}catch(e){if(!committed)rmSync(moved?destination:temp,{recursive:true,force:true});throw e;}
 }
 function assertVersion(pkg,version){if(typeof version!=='string'||version!==pkg.version)throw problem(409,'A skill mudou em outra tela. Abra a versão atual antes de continuar.');}
 function update(actor,id,input){
  admin(actor);const old=stored(actor,id);assertVersion(old,input.version);
  if(typeof input.title!=='string'||!input.title.trim()||input.title.trim().length>80||/[\x00-\x1f<>]/.test(input.title))throw problem(400,'Informe um nome de exibição de até 80 caracteres.');
  if(typeof input.description!=='string'||!input.description.trim()||input.description.length>3000||typeof input.instructions!=='string'||!input.instructions.trim())throw problem(400,'Preencha a descrição e as instruções da skill.');
  const main=old.files.find(f=>f.path==='SKILL.md'),header=main.text.match(/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1]??'';
  let preserved=header;for(const key of ['name','title','description'])preserved=preserved.replace(new RegExp('^'+key+':[^\\n]*(?:\\r?\\n[ \\t]+[^\\n]*)*(?:\\r?\\n|$)','m'),'');
  const text='---\nname: '+old.name+'\ntitle: '+JSON.stringify(input.title.trim())+'\ndescription: '+JSON.stringify(input.description.trim())+'\n'+(preserved.trim()?preserved.trim()+'\n':'')+'---\n\n'+input.instructions;
  const pkg=validateSkillPackage(old.files.map(f=>f.path==='SKILL.md'?{path:f.path,text}:typeof f.text==='string'?f:{...f,base64:fileFor(actor,id,f.path).data.toString('base64')}));quota(pkg,{replacing:id,backup:true});
  const temp=writePackage(pkg),destination=path.join(parent,old.name),backup=path.join(trash,randomUUID());let moved=false,installed=false;
  db.exec('BEGIN IMMEDIATE');try{renameSync(destination,backup);moved=true;renameSync(temp,destination);installed=true;run('UPDATE skills SET title=?,description=?,files=?,revision=revision+1 WHERE id=?',pkg.title,pkg.description,JSON.stringify(metadata(pkg.files)),id);run('INSERT INTO skill_edit_backups VALUES (?,?)',path.basename(backup),JSON.stringify(old.files));db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');if(installed)rmSync(destination,{recursive:true,force:true});if(moved)renameSync(backup,destination);rmSync(temp,{recursive:true,force:true});throw e;}
  // Versões anteriores ficam em diretório privado; nenhuma remoção definitiva pela interface.
  return detail(actor,id);
 }
 function toggle(actor,id,enabled){admin(actor);ensure(actor);if(typeof enabled!=='boolean')throw problem(400,'Informe se a skill está ativa.');if(id==='generated:minha-marca'){detail(actor,id);run('INSERT INTO skill_preferences VALUES (?,?,?) ON CONFLICT(org_id,skill_id) DO UPDATE SET enabled=excluded.enabled',actor.organization.id,id,enabled?1:0);}else{stored(actor,id);run('UPDATE skills SET enabled=?,revision=revision+1 WHERE id=?',enabled?1:0,id);}return detail(actor,id);}
 function remove(actor,id,version){admin(actor);const pkg=stored(actor,id);assertVersion(pkg,version);const destination=path.join(parent,pkg.name),backup=path.join(trash,id.replace(':','_'));if(existsSync(backup))throw problem(409,'O destino de recuperação já existe.');renameSync(destination,backup);try{run('UPDATE skills SET deleted_at=?,revision=revision+1 WHERE id=?',now()||1,id);}catch(e){renameSync(backup,destination);throw e;}return {ok:true};}
 function deleted(actor){admin(actor);ensure(actor);return {skills:all('SELECT * FROM skills WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC').map(convert).map(summary)};}
 function restore(actor,id,version){admin(actor);const pkg=stored(actor,id,true);assertVersion(pkg,version);quota(pkg,{restoring:true});const destination=path.join(parent,pkg.name),backup=path.join(trash,id.replace(':','_'));if(existsSync(destination))throw problem(409,'Já há arquivos no destino da skill.');renameSync(backup,destination);try{run('UPDATE skills SET deleted_at=NULL,revision=revision+1 WHERE id=?',id);}catch(e){renameSync(destination,backup);throw e;}return detail(actor,id);}
 function resolve(actor,ids){if(!Array.isArray(ids)||ids.length>3||ids.some(x=>typeof x!=='string')||new Set(ids).size!==ids.length)throw problem(400,'Escolha até três skills diferentes para a mensagem.');return ids.map(id=>{const pkg=detail(actor,id);if(!pkg.enabled)throw problem(409,'A skill '+pkg.title+' está desativada. Escolha outra ou ative em Skills.');return {...pkg,files:pkg.files.map(file=>typeof file.text==='string'?file:{...file,base64:fileFor(actor,id,file.path).data.toString('base64')})};});}
 function fileFor(actor,id,relative){const pkg=detail(actor,id),file=pkg.files.find(f=>f.path===relative);if(!file)throw problem(404,'Arquivo da skill não encontrado.');const data=typeof file.text==='string'?Buffer.from(file.text):readFileSync(path.join(parent,pkg.name,file.path));return {name:path.basename(file.path),mime:file.mime||'text/plain; charset=utf-8',data};}
 return {list,detail,install,update,toggle,remove,deleted,restore,resolve,fileFor,close(){db.close();}};
}
