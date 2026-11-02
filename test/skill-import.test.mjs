import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {normalizeSkillFiles} from '../shared/skill-import.js';
import {validateSkillPackage,createSkillsStore} from '../server/skills-store.mjs';
const text='---\nname: benchmark-importacao-teste\ndescription: Analisar concorrentes sem inventar dados.\n---\n# Benchmark\nConteúdo original da skill.';
test('Markdown com nome próprio vira o arquivo principal sem alterar o texto ou a seleção original',()=>{
 const original=[{path:'benchmark-importacao-teste.md',text}],normalized=normalizeSkillFiles(original),pkg=validateSkillPackage(original);
 assert.equal(original[0].path,'benchmark-importacao-teste.md');assert.equal(normalized[0].path,'SKILL.md');assert.equal(normalized[0].text,text);assert.equal(pkg.name,'benchmark-importacao-teste');assert.equal(pkg.files[0].path,'SKILL.md');assert.equal(pkg.files[0].text,text);
});
test('pasta mantém referências e reconhece skill.md sem aceitar dois arquivos principais',()=>{
 const pkg=validateSkillPackage([{path:'skill.md',text},{path:'references/exemplo.md',text:'Referência'}]);assert.equal(pkg.files[0].path,'SKILL.md');assert.equal(pkg.files[1].path,'references/exemplo.md');
 assert.throws(()=>validateSkillPackage([{path:'SKILL.md',text},{path:'skill.md',text}]),{status:400});
});
test('normalizar não aceita caminhos inseguros nem converte um texto comum em skill válida',()=>{
 for(const filename of ['../benchmark.md','pasta/../../benchmark.md','pasta\\benchmark.md'])assert.throws(()=>validateSkillPackage([{path:filename,text}]),{status:400});
 assert.throws(()=>validateSkillPackage([{path:'anotacoes.md',text:'# Notas sem cabeçalho de skill'}]),{status:400});
});
test('importar arquivo com nome próprio persiste um pacote utilizável',async t=>{
 const directory=await mkdtemp(path.join(tmpdir(),'ianiza-named-skill-')),store=createSkillsStore({directory}),actor={organization:{id:'11111111-1111-4111-8111-111111111111'},user:{id:'admin',role:'admin'}};
 t.after(async()=>{store.close();await rm(directory,{recursive:true,force:true});});const result=store.install(actor,{files:[{path:'benchmark-importacao-teste.md',text}]});assert.equal(store.resolve(actor,[result.id])[0].files[0].text,text);assert.equal(await readFile(path.join(directory,'skills/benchmark-importacao-teste/SKILL.md'),'utf8'),text);
});


test('nome de exibição com espaços e acentos é normalizado somente na cópia importada',()=>{
 const original='---\nname: Criativos Estáticos que Convertem\ndescription: Criar anúncios.\n---\n# Instruções originais';const pkg=validateSkillPackage([{path:'SKILL.md',text:original}]);assert.equal(pkg.name,'criativos-estaticos-que-convertem');assert.equal(pkg.title,'Criativos Estáticos que Convertem');assert.match(pkg.files[0].text,/name: criativos-estaticos-que-convertem/);assert.match(pkg.files[0].text,/# Instruções originais/);assert.match(original,/name: Criativos Estáticos/);
});
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aJ1kAAAAASUVORK5CYII=';
test('templates de imagem persistem fora do banco e mantêm o MIME real mesmo com extensão JPG',async t=>{
 const directory=await mkdtemp(path.join(tmpdir(),'ianiza-skill-image-')),store=createSkillsStore({directory}),actor={organization:{id:'11111111-1111-4111-8111-111111111111'},user:{id:'admin',role:'admin'}};
 t.after(async()=>{store.close();await rm(directory,{recursive:true,force:true});});const result=store.install(actor,{files:[{path:'SKILL.md',text},{path:'assets/template.jpg',base64:png},{path:'references/exemplo.md',text:'Referência textual'}]});
 const image=result.files.find(f=>f.mime);assert.equal(image.mime,'image/png');assert.equal(image.base64,undefined);assert.ok(image.sha256);assert.deepEqual(store.fileFor(actor,result.id,'assets/template.jpg').data,Buffer.from(png,'base64'));assert.equal(store.resolve(actor,[result.id])[0].files.find(f=>f.mime).base64,png);assert.throws(()=>store.fileFor({...actor,organization:{id:'22222222-2222-4222-8222-222222222222'}},result.id,'assets/template.jpg'),{status:404});assert.throws(()=>store.fileFor(actor,result.id,'../../access.sqlite'),{status:404});
 const dbBytes=await readFile(path.join(directory,'skills.sqlite'));assert.equal(dbBytes.includes(Buffer.from(png)),false);
});
test('arquivos de imagem falsos, SVG e imagens acima da cota são recusados',()=>{
 for(const file of [{path:'assets/template.jpg',base64:Buffer.from('<html>teste</html>').toString('base64')},{path:'assets/template.svg',base64:Buffer.from('<svg/>').toString('base64')},{path:'assets/template.jpg',base64:'a'.repeat(12*1024*1024)}])assert.throws(()=>validateSkillPackage([{path:'SKILL.md',text},file]),{status:400});
});

test('cabeçalho de imagem com resolução excessiva é recusado sem decodificar pixels',()=>{const data=Buffer.from(png,'base64');data.writeUInt32BE(100000,16);data.writeUInt32BE(100000,20);assert.throws(()=>validateSkillPackage([{path:'SKILL.md',text},{path:'template.png',base64:data.toString('base64')}]),{status:400});});
