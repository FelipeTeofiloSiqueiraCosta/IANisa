import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, saveState, STORE_KEY } from '../src/state.js';
import { ensureCoordination, submitForReview, reviewTask, saveKnowledge } from '../src/coordination.js';
import { beginJourney, advanceJourney, approveJourney } from '../src/journey.js';
import { createPresentationState, presentationSteps, setPresentationStep, presentationTasks, exampleBrief, exampleDelivery, explainMember, savePresentation, loadPresentation, discardPresentation, PRESENTATION_KEY } from '../src/presentation.js';

const original=()=>ensureCoordination(initialState());
function prepareDemo(state){beginJourney(state,exampleBrief,10000);for(let n=1;n<=4;n++)advanceJourney(state,10000+n*3000,true);state.presentation.campaignId=state.officeJourney.campaignId;approveJourney(state,state.officeJourney.campaignId,30000);return presentationTasks(state);}

test('a apresentação usa uma cópia e não modifica pedidos, pessoas ou conhecimentos do usuário',()=>{
  const real=original();real.officeJourney={id:'pedido-original',phase:'running',deliveries:[]};const before=structuredClone(real),demo=createPresentationState(real);
  assert.equal(demo.officeJourney,undefined);assert.equal(demo.presentation.active,true);
  const {parent}=prepareDemo(demo);submitForReview(demo,parent.s,exampleDelivery(demo));reviewTask(demo,parent.s,{decision:'approve',checks:['brief','brand','quality']});
  saveKnowledge(demo,{title:'Aprendizado do exemplo',content:'Usar o formato de vídeo aprovado.',category:'result',source:{sessionId:parent.s.id,memberId:parent.m.id,campaignId:parent.s.campaignId}});
  demo.members[0].name='Nome apenas da apresentação';
  assert.deepEqual(real,before);assert.equal(demo.campaigns.length,real.campaigns.length+1);assert.equal(demo.brain.revision,real.brain.revision+1);
});
test('o roteiro apresenta todos os integrantes, inclusive funções personalizadas, em ordem estável',()=>{
  const real=original();real.members.push({...structuredClone(real.members[1]),id:'custom-specialist',name:'Nina',role:'Especialista em eventos'});
  const demo=createPresentationState(real),deck=presentationSteps(demo);
  assert.equal(deck.filter(s=>s.startsWith('member:')).length,real.members.length);
  for(const m of real.members)assert.ok(deck.includes('member:'+m.id));
  assert.equal(new Set(deck).size,deck.length);assert.equal(deck[0],'overview');assert.equal(deck.at(-1),'finish');
  assert.match(explainMember(real.members.at(-1)),/Especialista em eventos/);
});
test('o exemplo de entrega pertence à campanha demonstrada e tem uma próxima etapa dependente real',()=>{
  const demo=createPresentationState(original()),{parent,dependent,human}=prepareDemo(demo);
  assert.equal(parent.s.campaignId,demo.presentation.campaignId);assert.ok(dependent.s.dependencies.includes(parent.s.id));
  assert.equal(human.m.type,'human');assert.equal(human.s.status,'assigned');
  const text=exampleDelivery(demo);assert.ok(text.includes(parent.s.title));assert.match(text,/30 segundos/);assert.match(text,/diretor conferir/);
});
test('o roteiro escolhe uma entrega liberada mesmo quando a dependência inicial pertence a uma pessoa',()=>{
  const real=original();real.members=real.members.filter(m=>['lia','vico'].includes(m.id));real.members.find(m=>m.id==='lia').type='human';
  const demo=createPresentationState(real),{parent,dependent,human}=prepareDemo(demo);
  assert.equal(parent.m.id,'lia');assert.equal(parent.s.status,'assigned');assert.equal(human.s.id,parent.s.id);
  assert.equal(dependent.m.id,'vico');assert.equal(dependent.s.status,'blocked');
});
test('as etapas inválidas não mudam o roteiro e o progresso pode ser serializado e retomado',()=>{
  const demo=createPresentationState(original());setPresentationStep(demo,'brain');
  assert.throws(()=>setPresentationStep(demo,'aprovar-sem-revisar'),/não está disponível/);assert.equal(demo.presentation.step,'brain');
  const restored=JSON.parse(JSON.stringify(demo));assert.deepEqual(presentationSteps(restored),presentationSteps(demo));assert.equal(restored.presentation.step,'brain');
});
test('salvar, retomar e encerrar a apresentação usa uma chave própria e preserva o escritório original',()=>{
  const previous=globalThis.localStorage,values=new Map();globalThis.localStorage={getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};
  try{
    const real=original();saveState(real);const baseline=values.get(STORE_KEY),demo=createPresentationState(real);setPresentationStep(demo,'director');savePresentation(demo);
    assert.notEqual(PRESENTATION_KEY,STORE_KEY);assert.equal(values.get(STORE_KEY),baseline);assert.equal(loadPresentation().presentation.step,'director');
    discardPresentation();assert.equal(loadPresentation(),null);assert.equal(values.get(STORE_KEY),baseline);
  }finally{if(previous===undefined)delete globalThis.localStorage;else globalThis.localStorage=previous;}
});
