import test from 'node:test';
import assert from 'node:assert/strict';
import {newActivity,applyActivity,finishActivity} from '../server/agent-activity.mjs';
import {createTurnObserver,sessionModel} from '../server/turn-observer.mjs';
import {imageURL,messageImages,conversationModel} from '../shared/chat-media.mjs';
import {renderMessage,renderActivity} from '../src/agent-message.js';

const url='https://d8j0ntlcm91z4.cloudfront.net/user_test/result.png';
const connector={name:'higgs',title:'Higgsfield',builtin:'higgsfield'};
const call={toolCallId:'tool-1',_meta:{claudeCode:{toolName:'mcp__higgs__generate_image'}},rawInput:{model:'seedream-5-lite',prompt:'dados privados do briefing'}};
test('etapas usam eventos reais de MCP e metadados da sessão, sem pensamentos, entradas ou saídas brutas',async()=>{
 const activity=newActivity('request',1),o=createTurnObserver({connectors:[connector],onProgress:e=>applyActivity(activity,e,2)});
 o.phase('connecting');o.setModel({configOptions:[{category:'model',currentValue:'claude-sonnet-4-5'}]});
 o.update({sessionUpdate:'agent_thought_chunk',content:{type:'text',text:'pensamento que nunca deve aparecer'}});
 o.update({sessionUpdate:'tool_call',...call,status:'pending'});
 let finish;const waiting=o.permission({toolCall:call},()=>new Promise(resolve=>finish=resolve));assert.equal(activity.steps.at(-1).status,'waiting');
 finish({outcome:{outcome:'selected',optionId:'once'}});await waiting;
 assert.equal(activity.steps.at(-1).status,'running');
 o.update({sessionUpdate:'tool_call_update',toolCallId:'tool-1',status:'completed',rawOutput:[{type:'text',text:JSON.stringify({url,secret:'token privado'})}]});
 o.update({sessionUpdate:'agent_message_chunk',content:{type:'text',text:'{"reply":"resposta"}'}});
 assert.equal(activity.steps.find(s=>s.type==='tool').label,'Gerar imagem · Higgsfield');assert.equal(activity.steps.filter(s=>s.type==='tool').length,1);
 assert.equal(activity.steps.find(s=>s.type==='tool').status,'completed');assert.equal(activity.model.id,'claude-sonnet-4-5');
 assert.doesNotMatch(JSON.stringify(activity),/pensamento|briefing|token privado|rawInput|rawOutput|response|reply/);
 assert.deepEqual(o.metadata().media,[{url,connector:'higgsfield',model:'seedream-5-lite',source:'tool'}]);
 finishActivity(activity,'completed',3);o.close();o.phase('session');assert.equal(activity.status,'completed');assert.ok(activity.steps.every(s=>s.status==='completed'));
});
test('falhas, recusas e ferramentas sem resultado não são apresentadas como sucesso',async()=>{
 const a=newActivity('request',1),o=createTurnObserver({connectors:[connector],onProgress:e=>applyActivity(a,e,2)});
 o.update({sessionUpdate:'tool_call',...call});
 await o.permission({toolCall:call},async()=>({outcome:{outcome:'cancelled'}}));
 o.update({sessionUpdate:'tool_call_update',toolCallId:'tool-1',status:'completed',rawOutput:{url:'https://evil.example/result.png'}});
 assert.equal(a.steps[0].status,'cancelled');assert.equal(o.metadata().media.length,0);
 o.update({sessionUpdate:'tool_call',toolCallId:'native',title:'Bash',rawInput:{command:'rebuild'}});assert.equal(a.steps.length,1);
 o.update({sessionUpdate:'tool_call',...call,toolCallId:'tool-2'});finishActivity(a,'failed',3);assert.equal(a.steps.at(-1).status,'interrupted');
 const before=JSON.stringify(a);o.phase('responding');assert.equal(JSON.stringify(a),before);
});
test('prévia aceita somente imagens HTTPS do CDN exato do Higgsfield e mensagens com proveniência do conector',()=>{
 const valid={role:'assistant',text:'Imagem: '+url,connectors:[{key:'higgsfield'}]};assert.equal(messageImages(valid).length,1);
 for(const other of ['http://d8j0ntlcm91z4.cloudfront.net/x.png','https://d8j0ntlcm91z4.cloudfront.net.evil.test/x.png','https://d8j0ntlcm91z4.cloudfront.net@evil.test/x.png','https://evil.cloudfront.net/x.png','https://d8j0ntlcm91z4.cloudfront.net/x.svg','https://user:pass@d8j0ntlcm91z4.cloudfront.net/x.png','https://d8j0ntlcm91z4.cloudfront.net:8443/x.png','javascript:alert(1)','data:image/png;base64,AAAA'])assert.equal(imageURL(other),null,other);
 assert.equal(messageImages({...valid,role:'user'}).length,0);assert.equal(messageImages({...valid,connectors:[]}).length,0);
 const html=renderMessage({...valid,text:'<script>alert(1)</script> '+url,provider:'claude',model:{id:'claude-sonnet-4-5'}});
 assert.match(html,/<img /);assert.match(html,/referrerpolicy="no-referrer"/);assert.match(html,/Claude · claude-sonnet-4-5/);assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script>/);
 assert.equal(html.includes('<div class="agent-message-text">&lt;script&gt;alert(1)&lt;/script&gt; https:'),false);
 const legacy=messageImages({...valid,text:'Gerei com o modelo Seedream 5.0 Lite, em formato quadrado. '+url});assert.equal(legacy[0].model,'Seedream 5.0 Lite');assert.equal(legacy[0].source,'legacy');
});
test('modelo padrão e histórico sem metadados não inventam versões; etapas não recebem HTML ativo',()=>{
 const named=sessionModel({configOptions:[{id:'model',currentValue:'opus',options:[{value:'opus',name:'Opus 5.5'}]}]});assert.equal(named.name,'Opus 5.5');assert.equal(conversationModel(named),'Claude · Opus 5.5');
 assert.equal(sessionModel({models:{currentModelId:'default'}}).id,'default');assert.equal(sessionModel({configOptions:[{id:'model',currentValue:'<script>secret</script>'}]}),null);
 assert.equal(conversationModel(null),'Claude · modelo não registrado');assert.equal(conversationModel({id:'default'}),'Claude · padrão da conta');
 const a=newActivity('request',1);applyActivity(a,{type:'phase',id:'responding'},2);applyActivity(a,{type:'tool',id:'one',label:'<img src=x onerror=alert(1)>',status:'running'},3);applyActivity(a,{type:'tool',id:'one',status:'completed'},4);applyActivity(a,{type:'phase',id:'responding'},5);
 assert.equal(a.steps.at(-1).status,'running');assert.equal(a.steps.length,3);assert.match(renderActivity(a,{live:true}),/&lt;img/);assert.doesNotMatch(renderActivity(a),/<img src=x/);
});
