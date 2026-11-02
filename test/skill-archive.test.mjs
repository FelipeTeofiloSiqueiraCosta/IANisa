import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readdir,writeFile,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {parseSkillUpload} from '../server/skill-archive.mjs';
import {createSkillImports} from '../server/skill-imports.mjs';
import {createSkillsStore} from '../server/skills-store.mjs';
import {zipFixture} from './helpers/zip.mjs';
const markdown='---\nname: Exemplo de Skill\ndescription: Skill para verificar importação segura.\n---\n# Exemplo\nSem executar scripts.',main={name:'SKILL.md',data:markdown};
const actor={organization:{id:'11111111-1111-4111-8111-111111111111'},user:{id:'owner',role:'admin'}},another={...actor,user:{id:'another',role:'admin'}},otherOrg={...actor,organization:{id:'22222222-2222-4222-8222-222222222222'}},member={...actor,user:{id:'member',role:'member'}};
async function fixture(t){const directory=await mkdtemp(path.join(tmpdir(),'ianiza-secure-import-')),store=createSkillsStore({directory});let time=1000000;const imports=createSkillImports({directory,store,now:()=>time});t.after(async()=>{imports.close();store.close();await rm(directory,{recursive:true,force:true});});return {directory,store,imports,tick(ms){time+=ms;}};}
test('aceita somente Markdown ou ZIP, reconhecendo uma pasta principal e referências',async()=>{
 assert.equal((await parseSkillUpload('nome-livre.md',Buffer.from(markdown))).pkg.name,'exemplo-de-skill');
 const zip=zipFixture([{name:'pasta/SKILL.md',data:markdown},{name:'pasta/references/ajuda.md',data:'Referência'},{name:'pasta/.env',data:'NAO_IMPORTAR=segredo'},{name:'__MACOSX/._SKILL.md',data:'metadados'}]);
 const result=await parseSkillUpload('skill.zip',zip);assert.equal(result.ignored,2);assert.equal(result.pkg.files.length,2);assert.equal(result.pkg.files[1].path,'references/ajuda.md');assert.equal(result.pkg.title,'Exemplo de Skill');
 await assert.rejects(parseSkillUpload('arquivo.exe',Buffer.from(markdown)),{status:415});await assert.rejects(parseSkillUpload('arquivo.zip',Buffer.from(markdown)),{status:415});await assert.rejects(parseSkillUpload('texto.md',Buffer.from([0xff,0xfe,0x00])),{status:400});
});
test('recusa Zip Slip, caminhos absolutos, backslashes, nomes duplicados e links simbólicos',async()=>{
 for(const name of ['../fora.md','/tmp/fora.md','C:/fora.md','pasta\\fora.md','pasta/../../fora.md'])await assert.rejects(parseSkillUpload('skill.zip',zipFixture([main,{name,data:'texto'}])),e=>e.status===400);
 await assert.rejects(parseSkillUpload('skill.zip',zipFixture([main,{name:'skill.md',data:markdown}])),{status:400});
 await assert.rejects(parseSkillUpload('skill.zip',zipFixture([main,{name:'link.md',data:'../../fora',mode:0o120777}])),{status:400});
});
test('recusa arquivos proibidos, ZIP aninhado, arquivos cifrados e corrupção de CRC',async()=>{
 for(const entry of [{name:'programa.exe',data:'MZ'},{name:'payload.html',data:'<script>alert(1)</script>'},{name:'outro.zip',data:'PK'},{name:'script.svg',data:'<svg/>'},{name:'secreto.md',data:'texto',flags:1},{name:'corrompido.md',data:'texto',crc:12345}])await assert.rejects(parseSkillUpload('skill.zip',zipFixture([main,entry])),e=>e.status===400||e.status===415);
});
test('limita entradas, tamanho declarado, expansão real e taxa de compactação antes de instalar',async()=>{
 await assert.rejects(parseSkillUpload('skill.zip',zipFixture([main,...Array.from({length:64},(_,i)=>({name:'references/f'+i+'.txt',data:'a'}))])),{status:413});
 await assert.rejects(parseSkillUpload('skill.zip',zipFixture([main,{name:'assets/grande.png',data:'x',method:8,size:25*1024*1024}])),{status:413});
 await assert.rejects(parseSkillUpload('skill.zip',zipFixture([main,{name:'assets/bomba.png',data:Buffer.alloc(2*1024*1024),method:8}])),{status:413});
 await assert.rejects(parseSkillUpload('skill.zip',zipFixture([main,{name:'references/falso.txt',data:Buffer.alloc(200000),method:8,size:10}])),e=>e.status===400||e.status===413);
});
test('preparação é privada e temporária; só a confirmação instala a skill, sem executar scripts',async t=>{
 const f=await fixture(t),zip=zipFixture([main,{name:'scripts/exemplo.sh',data:'touch /tmp/nao-deve-executar'}]);const prepared=await f.imports.prepare(actor,'skill.zip',zip);
 assert.equal(f.store.list(actor).skills.some(s=>s.name==='exemplo-de-skill'),false);assert.equal((await stat(path.join(f.directory,'skill-imports',prepared.id+'.upload'))).mode&0o777,0o600);
 await assert.rejects(f.imports.confirm(another,prepared.id),{status:404});await assert.rejects(f.imports.confirm(otherOrg,prepared.id),{status:404});await assert.rejects(f.imports.confirm(member,prepared.id),{status:403});
 const saved=await f.imports.confirm(actor,prepared.id);assert.equal(saved.title,'Exemplo de Skill');assert.equal((await stat(path.join(f.directory,'skills/exemplo-de-skill/scripts/exemplo.sh'))).mode&0o111,0);assert.equal((await readdir(path.join(f.directory,'skill-imports'))).length,0);await assert.rejects(f.imports.confirm(actor,prepared.id),{status:404});
});
test('cancelamento e expiração impedem confirmação; alteração do temporário é detectada',async t=>{
 const f=await fixture(t);let p=await f.imports.prepare(actor,'skill.md',Buffer.from(markdown));const work=f.imports.confirm(actor,p.id);f.imports.cancel(actor,p.id);await assert.rejects(work,{status:404});assert.equal(f.store.list(actor).skills.length,5);
 p=await f.imports.prepare(actor,'skill.md',Buffer.from(markdown));f.tick(11*60000);await assert.rejects(f.imports.confirm(actor,p.id),{status:404});
 p=await f.imports.prepare(actor,'skill.md',Buffer.from(markdown));await writeFile(path.join(f.directory,'skill-imports',p.id+'.upload'),'modificado');await assert.rejects(f.imports.confirm(actor,p.id),{status:409});assert.equal(f.store.list(actor).skills.length,5);
});
test('limita upload simultâneo por pessoa e tentativas repetidas',async t=>{
 const f=await fixture(t),release=f.imports.reserve(actor);assert.throws(()=>f.imports.reserve(actor),{status:429});release();for(let i=0;i<9;i++)f.imports.reserve(actor)();assert.throws(()=>f.imports.reserve(actor),{status:429});f.tick(60001);f.imports.reserve(actor)();
});
