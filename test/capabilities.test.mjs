import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createSkillsStore,validateSkillPackage} from '../server/skills-store.mjs';
import {createConnectorsStore,connectorURL,inspectMCP} from '../server/connectors-store.mjs';
import {createToolPermissions} from '../server/tool-permissions.mjs';
import {createBrandStore} from '../server/brand-store.mjs';
import {turnSessionOptions,parseBrandResponse} from '../server/ai-runtime.mjs';
import http from 'node:http';
import {once} from 'node:events';
const admin={organization:{id:'11111111-1111-4111-8111-111111111111'},user:{id:'owner',name:'Teste',role:'admin'}},other={...admin,organization:{id:'22222222-2222-4222-8222-222222222222'}},member={...admin,user:{id:'member',role:'member'}};
const files=[{path:'SKILL.md',text:'---\nname: minha-escrita\ndescription: Escrever de forma clara.\n---\n# Escrita\nSem inventar dados.'},{path:'scripts/check.sh',text:'echo referencia'}];
async function temp(t){const dir=await mkdtemp(path.join(tmpdir(),'ianiza-cap-'));t.after(()=>rm(dir,{recursive:true,force:true}));return dir;}
test('skills padrão acompanham uma instalação; importação persiste e exige a empresa local',async t=>{
 const directory=await temp(t);let store=createSkillsStore({directory});t.after(()=>store.close());
 const human=store.detail(admin,'default:texto-humano');assert.equal(human.files.length,2);assert.match(human.files[0].text,/Não vale para código/);
 const pkg=store.install(admin,{files});assert.equal(pkg.source,'custom');assert.equal(pkg.fileCount,2);assert.equal((await readFile(path.join(directory,'skills/minha-escrita/scripts/check.sh'),'utf8')),'echo referencia');
 assert.throws(()=>store.detail(other,pkg.id),{status:404});assert.throws(()=>store.install(member,{files}),{status:403});assert.throws(()=>store.install(admin,{files}),{status:409});
 store.toggle(admin,pkg.id,false);assert.throws(()=>store.resolve(admin,[pkg.id]),{status:409});store.close();store=createSkillsStore({directory});assert.equal(store.detail(admin,pkg.id).enabled,false);
 store.toggle(admin,'default:texto-humano',false);assert.throws(()=>store.detail(other,'default:texto-humano'),{status:404});
});
test('pacotes recusam caminhos inseguros, duplicados, binários e cabeçalhos incompletos',()=>{
 for(const invalid of [[{path:'../SKILL.md',text:files[0].text}],[{path:'SKILL.md',text:'sem cabeçalho'}],[files[0],files[0]],[files[0],{path:'a.txt',text:'\0'}],[files[0],{path:'scripts/../../escape.sh',text:'x'}]])assert.throws(()=>validateSkillPackage(invalid),{status:400});
});
test('conector guarda credenciais criptografadas, mascara respostas e retesta após editar',async t=>{
 const directory=await temp(t);let descriptor;const store=createConnectorsStore({directory,inspect:async d=>{descriptor=d;return {tools:[{name:'read',description:'Ler dados'}]};}});t.after(()=>store.close());
 const saved=store.create(admin,{name:'Documentos',url:'https://example.test/mcp',headers:[{name:'Authorization',value:'Bearer segredo-teste-123'}]});assert.equal(saved.status,'configured');assert.equal(saved.hasCredentials,true);assert.doesNotMatch(JSON.stringify(store.list(admin)),/segredo-teste/);
 assert.equal((await readFile(path.join(directory,'connectors.sqlite'))).includes(Buffer.from('segredo-teste-123')),false);
 const checked=await store.test(admin,saved.id);assert.equal(checked.connector.status,'tested');assert.equal(descriptor.headers[0].value,'Bearer segredo-teste-123');
 assert.throws(()=>store.resolve(other,[saved.id]),{status:404});assert.throws(()=>store.update(member,saved.id,{enabled:false}),{status:403});
 store.update(admin,saved.id,{name:'Outro',url:'https://example.test/novo'});assert.equal(store.list(admin).connectors.find(item=>item.id===saved.id).status,'configured');assert.equal(store.resolve(admin,[saved.id])[0].headers[0].value,'Bearer segredo-teste-123');
 store.update(admin,saved.id,{enabled:false});assert.throws(()=>store.resolve(admin,[saved.id]),{status:409});
});
test('endereços e headers de MCP são validados; erros do serviço não vazam credenciais',async t=>{
 const directory=await temp(t);const store=createConnectorsStore({directory,inspect:async()=>{throw new Error('401 token-secreto');}});t.after(()=>store.close());
 for(const url of ['file:///etc/passwd','https://user:secret@example.com/mcp','https://example.com/?api_key=secret','http://example.com/mcp'])assert.throws(()=>connectorURL(url),{status:400});
 assert.equal(connectorURL('http://127.0.0.1:4155/mcp'),'http://127.0.0.1:4155/mcp');
 assert.throws(()=>store.create(admin,{name:'x',url:'https://example.com',headers:[{name:'Host',value:'x'}]}),{status:400});
 const c=store.create(admin,{name:'x',url:'https://example.com/mcp'});await assert.rejects(store.test(admin,c.id),e=>e.status===422&&!e.message.includes('token-secreto'));assert.equal(store.list(admin).connectors.find(item=>item.id===c.id).status,'auth-required');
});
test('autorização MCP pertence à pessoa, vale uma vez e recusa ferramentas nativas',async()=>{
 const p=createToolPermissions(),servers=[{name:'mcp_test'}];
 const params={toolCall:{title:'Ler documentos',rawInput:{query:'teste'},_meta:{claudeCode:{toolName:'mcp__mcp_test__read'}}},options:[{kind:'allow_once',optionId:'once'}]};
 const work=p.ask(admin,'request',params,servers),pending=p.list(admin).permissions[0];assert.ok(pending);assert.equal(p.list(other).permissions.length,0);assert.equal(p.list(member).permissions.length,0);assert.throws(()=>p.decide(member,pending.id,true),{status:404});
 p.decide(admin,pending.id,true);assert.deepEqual(await work,{outcome:{outcome:'selected',optionId:'once'}});assert.throws(()=>p.decide(admin,pending.id,true),{status:404});
 const cancelled=p.ask(admin,'request',params,servers);p.cancel(admin,'request');assert.deepEqual(await cancelled,{outcome:{outcome:'cancelled'}});
 assert.deepEqual(await p.ask(admin,'request',{...params,toolCall:{title:'Bash',rawInput:{command:'echo x'}}},servers),{outcome:{outcome:'cancelled'}});p.close();
});
test('seleção vai ao runtime e fica no histórico; skill de escrita não altera a entrevista',async t=>{
 const directory=await temp(t);const skills=createSkillsStore({directory}),connectors=createConnectorsStore({directory});const c=connectors.create(admin,{name:'Dados',url:'https://example.test/mcp'});let received;
 const brain=createBrandStore({directory,resolveSkills:skills.resolve,resolveConnectors:connectors.resolve,runTurn:async input=>{received=input;return {reply:'Texto revisado.',fields:[{key:'NOME_MARCA',value:'Alteração indevida',source:'provided'}],nextBlock:11,reviewReady:true};}});t.after(()=>{brain.close();skills.close();connectors.close();});
 const input={revision:0,requestId:randomUUID(),text:'Reescreva esta legenda',fileIds:[],provider:'claude',skillIds:['default:texto-humano'],connectorIds:[c.id]};
 const s=await brain.send(admin,input);assert.equal(received.skills[0].name,'texto-humano');assert.equal(received.connectors[0].id,c.id);assert.equal(received.auxiliary,true);assert.deepEqual(s.profile,{});assert.equal(s.block,0);assert.equal(s.reviewReady,false);assert.deepEqual(s.notes,{});assert.equal(s.messages.at(-1).skills[0].name,'texto-humano');assert.equal(s.messages.at(-1).connectors[0].title,'Dados');assert.doesNotMatch(JSON.stringify(s),/https:\/\/example.test/);
 const options=turnSessionOptions(received);assert.equal(options.mcpServers[0].type,'http');assert.deepEqual(options._meta.claudeCode.options.tools,[]);assert.equal(options._meta.claudeCode.options.extraArgs['disable-slash-commands'],null);assert.deepEqual(options._meta.claudeCode.options.allowedTools,[]);assert.match(options._meta.claudeCode.options.settings.permissions.ask[0],/^mcp__/);assert.match(options._meta.claudeCode.options.systemPrompt,/Não altere o perfil da marca/);
});
test('teste de conexão usa initialize e tools/list reais, sem executar ferramentas',async t=>{
 const methods=[];const server=http.createServer(async(req,res)=>{
  if(req.method!=='POST'){res.writeHead(405);res.end();return;}
  let body='';for await(const c of req)body+=c;const m=JSON.parse(body);methods.push(m.method);
  if(m.id===undefined){res.writeHead(202);res.end();return;}
  const result=m.method==='initialize'?{protocolVersion:m.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'fixture',version:'1'}}:m.method==='tools/list'?{tools:[{name:'fixture_read',description:'Teste local',inputSchema:{type:'object'}}]}:{};
  res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({jsonrpc:'2.0',id:m.id,result}));
 });server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(resolve=>server.close(resolve)));
 const result=await inspectMCP({url:`http://127.0.0.1:${server.address().port}/mcp`,headers:[]});assert.equal(result.tools[0].name,'fixture_read');assert.ok(methods.includes('initialize'));assert.ok(methods.includes('tools/list'));assert.equal(methods.includes('tools/call'),false);
});

test('resposta final estruturada é lida após uma transição de ferramenta, sem aceitar texto inválido',()=>{
 const reply={reply:'Valor obtido.',fields:[],nextBlock:0,reviewReady:false};assert.deepEqual(parseBrandResponse('Consultei a ferramenta.\n'+JSON.stringify(reply)),reply);assert.throws(()=>parseBrandResponse('Ainda estou consultando.'),{status:502});
});
