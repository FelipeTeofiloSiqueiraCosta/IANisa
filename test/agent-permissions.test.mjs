import test from 'node:test';
import assert from 'node:assert/strict';
import {createToolPermissions} from '../server/tool-permissions.mjs';
const actor={organization:{id:'company'},user:{id:'owner'}},server={id:'connector',name:'mcp_example',title:'Exemplo'};
const call={toolCall:{title:'mcp__mcp_example__generate_image',rawInput:{prompt:'Exemplo'},_meta:{claudeCode:{toolName:'mcp__mcp_example__generate_image'}}},options:[{kind:'allow_once',optionId:'once'},{kind:'allow_always',optionId:'forever'}]};
test('autorização persistente dispensa perguntas repetidas sem liberar ferramentas nativas ou outro servidor',async t=>{
 const p=createToolPermissions();t.after(()=>p.close());
 for(let i=0;i<3;i++){assert.deepEqual(await p.ask(actor,'request-'+i,call,[server],{mode:()=> 'allow'}),{outcome:{outcome:'selected',optionId:'once'}});assert.equal(p.list(actor).permissions.length,0);}
 const spoof={...call,toolCall:{...call.toolCall,title:'Bash',_meta:{claudeCode:{toolName:'Bash',mcpServer:{name:server.name}}}}};
 assert.equal((await p.ask(actor,'native',spoof,[server],{mode:()=> 'allow'})).outcome.outcome,'cancelled');
 assert.equal((await p.ask(actor,'foreign',call,[{...server,name:'another'}],{mode:()=> 'allow'})).outcome.outcome,'cancelled');
});
test('revogação e mudança para uso liberado afetam solicitações pendentes e chamadas seguintes',async t=>{
 const p=createToolPermissions();t.after(()=>p.close());let mode='ask';const policy={mode:()=>mode};
 const first=p.ask(actor,'first',call,[server],policy);assert.equal(p.list(actor).permissions[0].title,'Gerar imagem');
 mode='deny';p.reconcile();assert.equal((await first).outcome.outcome,'cancelled');assert.equal((await p.ask(actor,'second',call,[server],policy)).outcome.outcome,'cancelled');
 mode='ask';const third=p.ask(actor,'third',call,[server],policy);mode='allow';p.reconcile();assert.equal((await third).outcome.outcome,'selected');assert.equal(p.list(actor).permissions.length,0);
 mode='ask';const fourth=p.ask(actor,'fourth',call,[server],policy),pending=p.list(actor).permissions[0];mode='deny';p.decide(actor,pending.id,true);assert.equal((await fourth).outcome.outcome,'cancelled');
});
