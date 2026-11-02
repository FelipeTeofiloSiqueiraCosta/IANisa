import test from 'node:test';
import assert from 'node:assert/strict';
import {sendsOnEnter,messagesWithOutgoing,chatScrollTarget} from '../src/brand-chat.js';
test('Enter envia; Shift+Enter, composição e repetição não submetem a mensagem',()=>{assert.equal(sendsOnEnter({key:'Enter'}),true);for(const extra of [{shiftKey:true},{isComposing:true},{repeat:true}])assert.equal(sendsOnEnter({key:'Enter',...extra}),false);assert.equal(sendsOnEnter({key:'a'}),false);});
test('a mensagem aparece antes da resposta e a confirmação não duplica o balão',()=>{const previous=[{role:'assistant',text:'Olá'}],outgoing={requestId:'one',role:'user',text:'Minha empresa',delivery:'sending'};const first=messagesWithOutgoing(previous,outgoing);assert.equal(first.length,2);assert.equal(first.at(-1).delivery,'sending');assert.equal(previous.length,1);const saved=[...previous,{id:'saved',role:'user',requestId:'one',text:'Minha empresa'}];const acknowledged=messagesWithOutgoing(saved,outgoing);assert.equal(acknowledged.length,2);assert.equal(acknowledged.at(-1).id,'saved');assert.equal(acknowledged.at(-1).delivery,'sent');});
test('falha antes da confirmação preserva o texto para tentar novamente',()=>{const outgoing={requestId:'retry',role:'user',text:'Texto original',delivery:'failed'};assert.equal(messagesWithOutgoing([],outgoing)[0].text,'Texto original');assert.equal(messagesWithOutgoing([],outgoing)[0].delivery,'failed');});
test('atualizações repetidas de status não alteram a posição de leitura',()=>{
  let scrollTop=320;
  for(let tick=0;tick<8;tick++)scrollTop=chatScrollTarget({scrollTop,scrollHeight:1400,clientHeight:400},{scrollHeight:1400,clientHeight:400});
  assert.equal(scrollTop,320);
});
test('a resposta não arrasta quem está lendo o histórico; quem está no fim acompanha a conversa',()=>{
  assert.equal(chatScrollTarget({scrollTop:300,scrollHeight:1500,clientHeight:400},{scrollHeight:2200,clientHeight:400}),300);
  assert.equal(chatScrollTarget({scrollTop:1100,scrollHeight:1500,clientHeight:400},{scrollHeight:2200,clientHeight:400}),1800);
});
test('enviar uma mensagem leva ao fim uma vez, e mudanças de altura respeitam os limites',()=>{
  assert.equal(chatScrollTarget({scrollTop:200,scrollHeight:1500,clientHeight:400},{scrollHeight:1700,clientHeight:450},{forceBottom:true}),1250);
  assert.equal(chatScrollTarget({scrollTop:300,scrollHeight:1500,clientHeight:400},{scrollHeight:200,clientHeight:400}),0);
});
test('uma atualização de status não interrompe quem começou a rolar para cima perto do fim',()=>{
  assert.equal(chatScrollTarget({scrollTop:980,scrollHeight:1400,clientHeight:400},{scrollHeight:1400,clientHeight:400}),980);
});
