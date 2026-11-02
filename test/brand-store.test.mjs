import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createBrandStore,validateBrandFile,validateBrandAnswer,MAX_BRAND_FILE} from '../server/brand-store.mjs';
import {renderBrandSkill} from '../server/brand-schema.mjs';
const owner={user:{id:'owner',name:'Admin de teste',role:'admin'},organization:{id:'11111111-1111-4111-8111-111111111111',name:'Empresa'}};
const member={...owner,user:{id:'member',name:'Membro',role:'member'}};
const other={...owner,organization:{id:'22222222-2222-4222-8222-222222222222',name:'Outra'}};
const answer=(fields=[],nextBlock=1,reviewReady=false)=>({reply:'Qual é o público da sua marca?',fields,nextBlock,reviewReady});
async function fixture(t,runTurn=async()=>answer([{key:'NOME_MARCA',value:'Marca Teste',source:'provided'}])){const directory=await mkdtemp(path.join(tmpdir(),'ianiza-brain-'));let store=createBrandStore({directory,runTurn});t.after(async()=>{await store.close();await rm(directory,{recursive:true,force:true});});return {get store(){return store;},directory,reopen(){store.close();store=createBrandStore({directory,runTurn});}};}
async function send(f,text='Minha marca é Marca Teste.',extra={}){return f.store.send(owner,{revision:f.store.view(owner).revision,requestId:randomUUID(),text,fileIds:[],provider:'claude',...extra});}

test('primeiro acesso solicita configuração uma vez; conversa persiste sem misturar organizações',async t=>{
 const f=await fixture(t);assert.equal(f.store.view(owner).onboardingNeeded,true);assert.equal(f.store.view(member).editable,false);f.store.dismiss(owner);assert.equal(f.store.view(owner).onboardingNeeded,false);f.reopen();assert.equal(f.store.view(owner).onboardingNeeded,false);assert.equal(f.store.view(other).onboardingNeeded,true);assert.equal(f.store.view(owner).messages.length,1);
});
test('upload real é privado e apenas administradores podem enviar ou alterar o cérebro',async t=>{
 const f=await fixture(t),file=f.store.upload(owner,'../../manual.txt',Buffer.from('Nome da marca: Marca Teste'));assert.equal(file.name,'manual.txt');assert.equal(f.store.fileFor(owner,file.id).data.toString(),'Nome da marca: Marca Teste');assert.throws(()=>f.store.fileFor(other,file.id),{status:404});assert.throws(()=>f.store.upload(member,'a.txt',Buffer.from('teste')),{status:403});assert.throws(()=>f.store.patch(member,{revision:0,fields:{NOME_MARCA:'x'}}),{status:403});assert.throws(()=>f.store.confirm(member,{revision:0}),{status:403});
 assert.throws(()=>validateBrandFile('logo.svg',Buffer.from('<svg/>')),{status:415});assert.throws(()=>validateBrandFile('falso.png',Buffer.from('texto')),{status:415});assert.throws(()=>validateBrandFile('grande.txt',Buffer.alloc(MAX_BRAND_FILE+1)),{status:413});
});
test('a entrevista usa a resposta do adaptador, envia os anexos e guarda autoria e dados',async t=>{
 let received;const f=await fixture(t,async input=>{received=input;return answer([{key:'NOME_MARCA',value:'Marca Teste',source:'provided'},{key:'TOM_VOZ',value:'Direto e acolhedor',source:'inferred'}]);});const file=f.store.upload(owner,'bio.md',Buffer.from('Somos a Marca Teste.'));const s=await send(f,'Veja minha bio.',{fileIds:[file.id]});assert.equal(received.provider,'claude');assert.equal(received.files[0].data.toString(),'Somos a Marca Teste.');assert.equal(s.messages.at(-1).text,'Qual é o público da sua marca?');assert.equal(s.messages.at(-1).provider,'claude');assert.equal(s.profile.TOM_VOZ.source,'inferred');assert.equal(s.confirmed,null);f.reopen();assert.equal(f.store.view(owner).messages.length,3);
});
test('falha do Claude não cria resposta falsa; reenviar não duplica a mensagem',async t=>{
 let count=0;const f=await fixture(t,async()=>{if(!count++)throw Object.assign(new Error('Conecte o Claude.'),{status:409});return answer([{key:'NOME_MARCA',value:'Marca Teste',source:'provided'}]);});const input={revision:0,requestId:randomUUID(),text:'Olá',fileIds:[],provider:'claude'};await assert.rejects(f.store.send(owner,input),{status:409});const failed=f.store.view(owner);assert.equal(failed.messages.length,2);assert.equal(failed.pending,null);assert.match(failed.error,/Conecte/);const success=await f.store.send(owner,input);assert.equal(success.messages.filter(m=>m.role==='user').length,1);assert.equal(success.messages.length,3);await f.store.send(owner,input);assert.equal(f.store.view(owner).messages.length,3);
});
test('há um turno por empresa e alterações concorrentes não sobrescrevem o resumo',async t=>{
 let finish;const f=await fixture(t,()=>new Promise(r=>finish=r));const work=send(f);assert.ok(f.store.view(owner).pending);await assert.rejects(send(f,'Outra mensagem'),{status:409});assert.throws(()=>f.store.review(owner),{status:409});finish(answer());await work;assert.throws(()=>f.store.patch(owner,{revision:0,fields:{NOME_MARCA:'x'}}),{status:409});
});
test('hipóteses de números e cases ficam pendentes; resumo recebe sugestões visuais identificadas',async t=>{
 const value=validateBrandAnswer(answer([{key:'NUMEROS',value:'Mil clientes',source:'inferred'},{key:'CASES',value:'Caso imaginário',source:'proposed'}]));assert.equal(value.fields[0].value,'[ADICIONAR DADO REAL]');assert.equal(value.fields[1].value,'[INSERIR CASO REAL]');const f=await fixture(t);const s=f.store.review(owner);assert.match(s.profile.COR_PRIMARIA.value,/^#[0-9A-F]{6}$/);assert.equal(s.profile.FONTE_DISPLAY.source,'proposed');assert.equal(s.reviewReady,true);
});
test('salvar exige conferir o resumo, gera uma skill única e preserva versões anteriores',async t=>{
 const f=await fixture(t);let s=await send(f);assert.throws(()=>f.store.confirm(owner,{revision:s.revision}),{status:409});s=f.store.review(owner);s=f.store.confirm(owner,{revision:s.revision});assert.equal(s.confirmed.revision,1);assert.equal(s.onboardingNeeded,false);assert.equal(s.profile.NUMEROS.value,'[ADICIONAR DADO REAL]');const content=f.store.exportSkill(owner);assert.match(content,/Marca Teste/);assert.match(content,/name: minha-marca/);assert.doesNotMatch(content,/\{\{[A-Z_]+\}\}/);const disk=await readFile(path.join(f.directory,'organizations',owner.organization.id,'.claude/skills/minha-marca/SKILL.md'),'utf8');assert.equal(disk,content);s=f.store.patch(owner,{revision:s.revision,fields:{TOM_VOZ:'Novo tom'}});assert.equal(f.store.exportSkill(owner),content);s=f.store.review(owner);f.store.confirm(owner,{revision:s.revision});assert.match(f.store.exportSkill(owner),/Novo tom/);assert.equal(f.store.view(owner).confirmed.revision,2);assert.throws(()=>f.store.exportSkill(other),{status:404});
});
test('skill mantém JSON válido com aspas e linhas no perfil, sem inventar listas',()=>{
 const profile={NOME_MARCA:{value:'Marca "Teste"'},TOM_VOZ:{value:'Direto\ne simples'},EXPRESSOES_ASSINATURA:{value:'Diz "oi";Tudo bem?'},COR_PRIMARIA:{value:'#111111'}};const skill=renderBrandSkill(profile);const json=JSON.parse(skill.match(/```json\n([\s\S]*?)\n```/)[1]);assert.equal(json.marca,'Marca "Teste"');assert.equal(json.tom_voz,'Direto\ne simples');assert.deepEqual(json.hashtags_fixas,[]);assert.deepEqual(json.expressoes_assinatura,['Diz "oi"','Tudo bem?']);assert.equal(json.template_base,null);assert.doesNotMatch(skill,/\{\{[A-Z_0-9]+\}\}/);
});
test('a produção não aceita simular uma entrevista com o modo guiado',async t=>{const f=await fixture(t);await assert.rejects(send(f,'Olá',{provider:'guided'}),{status:400});assert.equal(f.store.view(owner).messages.length,1);});
