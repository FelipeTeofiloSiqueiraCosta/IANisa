import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,mkdir,writeFile,stat} from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createSkillsStore} from '../server/skills-store.mjs';
import {createAccounts} from '../server/accounts.mjs';
const actor={organization:{id:'11111111-1111-4111-8111-111111111111'},user:{id:'owner',role:'admin'}},member={...actor,user:{id:'member',role:'member'}};
const second={...actor,organization:{id:'22222222-2222-4222-8222-222222222222'}};
const defaults=['benchmark-de-mercado','carrossel-modular','criativos-estaticos-que-convertem','extrator-de-marca','texto-humano'];
async function folder(t){const dir=await mkdtemp(path.join(tmpdir(),'ianiza-installation-'));t.after(()=>rm(dir,{recursive:true,force:true}));return dir;}
test('uma instalação nova recebe as cinco skills sem UUID fixo nem dados da marca de outra instalação',async t=>{
 for(const a of [actor,second]){const directory=await folder(t),store=createSkillsStore({directory});try{const catalog=store.list(a);assert.deepEqual(catalog.skills.map(s=>s.name).sort(),defaults);assert.ok(catalog.skills.every(s=>s.source==='default'&&s.manageable));assert.equal(catalog.skills.some(s=>s.name==='minha-marca'),false);assert.ok((await stat(path.join(directory,'skills','carrossel-modular','assets/templates/template-bege-classico.jpg'))).size>4000000);}finally{store.close();}}
});
test('editar e excluir padrão conserva referências e versões; reiniciar não desfaz a decisão e restaurar é explícito',async t=>{
 const directory=await folder(t);let store=createSkillsStore({directory});t.after(()=>store.close());
 const id='default:carrossel-modular',before=store.detail(actor,id),template=store.fileFor(actor,id,'assets/templates/template-bege-classico.jpg').data;
 const shipped=new URL('../server/skills-defaults/carrossel-modular/SKILL.md',import.meta.url),original=await readFile(shipped);
 const input={version:before.version,title:'Carrossel da equipe',description:'Descrição com "aspas", acentuação e\nsegunda linha.',instructions:'# Instruções próprias\n\nUse a marca desta instalação.\n</textarea><script>texto</script>'};
 assert.throws(()=>store.update(member,id,input),{status:403});
 const updated=store.update(actor,id,input);assert.equal(updated.title,input.title);assert.equal(updated.description,input.description);assert.match(updated.files.find(f=>f.path==='SKILL.md').text,/name: carrossel-modular/);assert.notEqual(updated.version,before.version);
 assert.deepEqual(store.fileFor(actor,id,'assets/templates/template-bege-classico.jpg').data,template);assert.deepEqual(updated.files.filter(f=>f.path!=='SKILL.md'),before.files.filter(f=>f.path!=='SKILL.md'));
 assert.throws(()=>store.update(actor,id,input),{status:409});assert.throws(()=>store.remove(actor,id,before.version),{status:409});
 store.close();store=createSkillsStore({directory});assert.equal(store.detail(actor,id).title,input.title);
 store.remove(actor,id,store.detail(actor,id).version);assert.throws(()=>store.resolve(actor,[id]),{status:404});assert.throws(()=>store.fileFor(actor,id,'assets/templates/template-bege-classico.jpg'),{status:404});
 store.close();store=createSkillsStore({directory});assert.equal(store.list(actor).skills.some(s=>s.id===id),false);assert.equal(store.list(actor).deletedCount,1);const deleted=store.deleted(actor).skills[0];
 assert.throws(()=>store.restore(member,id,deleted.version),{status:403});store.restore(actor,id,deleted.version);assert.equal(store.detail(actor,id).title,input.title);assert.deepEqual(store.fileFor(actor,id,'assets/templates/template-bege-classico.jpg').data,template);
 assert.deepEqual(await readFile(shipped),original);assert.equal((await stat(path.join(directory,'skills','carrossel-modular','SKILL.md'))).mode&0o777,0o600);
 const db=new DatabaseSync(path.join(directory,'skills.sqlite'),{readOnly:true});assert.equal(db.prepare('SELECT count(*) AS n FROM skill_edit_backups').get().n,1);db.close();
});
test('migração adota skill existente como padrão e conserva ID, texto, preferência e arquivos antigos',async t=>{
 const directory=await folder(t),legacy=path.join(directory,'organizations',actor.organization.id,'.claude/skills/benchmark-de-mercado');await mkdir(legacy,{recursive:true});
 const text='---\nname: benchmark-de-mercado\ndescription: Versão personalizada anterior.\n---\n# Conteúdo que deve continuar igual';await writeFile(path.join(legacy,'SKILL.md'),text);
 const db=new DatabaseSync(path.join(directory,'skills.sqlite'));db.exec('CREATE TABLE skills(id TEXT PRIMARY KEY,org_id TEXT NOT NULL,name TEXT NOT NULL,title TEXT NOT NULL,description TEXT NOT NULL,files TEXT NOT NULL,enabled INTEGER NOT NULL,created_by TEXT NOT NULL,at INTEGER NOT NULL,UNIQUE(org_id,name));CREATE TABLE skill_preferences(org_id TEXT NOT NULL,skill_id TEXT NOT NULL,enabled INTEGER NOT NULL,PRIMARY KEY(org_id,skill_id));');
 db.prepare('INSERT INTO skills VALUES (?,?,?,?,?,?,?,?,?)').run('id-que-ja-esta-no-historico',actor.organization.id,'benchmark-de-mercado','Meu benchmark','Versão personalizada anterior.',JSON.stringify([{path:'SKILL.md',text}]),1,'owner',1);db.prepare('INSERT INTO skill_preferences VALUES (?,?,?)').run(actor.organization.id,'default:texto-humano',0);db.close();
 const store=createSkillsStore({directory});try{const catalog=store.list(actor);assert.equal(catalog.skills.length,5);const pkg=store.detail(actor,'id-que-ja-esta-no-historico');assert.equal(pkg.source,'default');assert.equal(pkg.title,'Meu benchmark');assert.equal(pkg.files[0].text,text);assert.equal(store.detail(actor,'default:texto-humano').enabled,false);assert.equal(await readFile(path.join(directory,'skills','benchmark-de-mercado','SKILL.md'),'utf8'),text);assert.equal(await readFile(path.join(legacy,'SKILL.md'),'utf8'),text);assert.throws(()=>store.list(second),{status:404});}finally{store.close();}
});
test('banco de acesso impede cadastrar uma segunda empresa na mesma instalação',async t=>{
 const directory=await folder(t),accounts=await createAccounts({directory});try{const link=accounts.createSetupLink();await accounts.setup({token:link.token,name:'Dona',email:'dona@example.test',organization:'Minha empresa',password:'uma frase segura 123456'},'127.0.0.1');assert.equal(accounts.createSetupLink(),null);const db=new DatabaseSync(path.join(directory,'access.sqlite'));try{assert.throws(()=>db.prepare('INSERT INTO organization VALUES (?,?)').run(second.organization.id,'Outra empresa'));assert.equal(db.prepare('SELECT count(*) AS n FROM organization').get().n,1);}finally{db.close();}}finally{accounts.close();}
});
