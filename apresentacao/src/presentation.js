import { STORE_KEY } from './state.js';
import { findTask } from './coordination.js';

export const PRESENTATION_KEY=STORE_KEY+':guided-presentation';
export const exampleBrief={reviewPolicy:{mode:'director',criteria:'Usar a paleta oficial e o tom da marca; incluir Instagram e vídeos verticais de 30 segundos; não publicar antes da revisão.'},title:'Campanha de Black Friday · apresentação',brief:'Criar uma campanha de Black Friday para a nova coleção, com conteúdo para Instagram, vídeos curtos, página e anúncios. Usar as cores e o tom da empresa. O diretor deve apresentar o plano, distribuir após a aprovação e revisar as entregas antes da publicação.'};
const roleDescriptions=[
  [/head|comercial/i,'Alinha prioridades, oferta e decisões. Recebe tarefas do diretor e acompanha o trabalho do time.'],
  [/videomaker/i,'Transforma o planejamento de conteúdo em roteiro e cenas. Quando precisa de outra entrega, aguarda o resultado aprovado antes de começar.'],
  [/social/i,'Organiza temas, formatos e calendário de conteúdo. Seu planejamento aprovado pode orientar o trabalho do videomaker.'],
  [/tráfego|trafego/i,'Planeja a distribuição, os públicos e os anúncios. Trabalha com as peças aprovadas e leva resultados ao diretor.'],
  [/editor/i,'É responsável pelos cortes, legendas e ritmo dos vídeos. Uma pessoa recebe sua tarefa e confirma quando começa; o diretor também revisa sua entrega.'],
  [/web/i,'Prepara páginas e experiências digitais. Usa os textos e a identidade visual aprovados para manter tudo alinhado.'],
  [/design/i,'Cria as peças e a direção visual, seguindo cores, logotipo e referências da empresa. Pode trabalhar em paralelo com outras etapas.'],
  [/copy/i,'Escreve títulos, chamadas e textos com a voz da marca. O texto aprovado pode liberar a criação da página.'],
];
export function explainMember(m){return roleDescriptions.find(([pattern])=>pattern.test(m.role))?.[1]||`Este integrante atua como ${m.role}. A função, as ferramentas e as habilidades podem ser configuradas para o seu time.`;}
export function createPresentationState(original){
  const demo=structuredClone(original);delete demo.officeJourney;delete demo.intakeDraft;
  demo.presentation={version:1,active:true,step:'overview',memberIds:demo.members.map(m=>m.id),journeyId:null,campaignId:null,animating:false,history:[],startedAt:Date.now()};
  return demo;
}
export function presentationSteps(state){
  return ['overview','requester','director','brain',...(state.presentation?.memberIds||state.members.map(m=>m.id)).map(id=>'member:'+id),
    'compose','interview','briefing','sending','received','consulting','planning','plan','distribution','working','human','dependency','delivery','review','changes','redelivery','rechecking','released','memory','finish'];
}
export function setPresentationStep(state,step){
  const p=state.presentation;if(!p?.active||!presentationSteps(state).includes(step))throw new Error('Esta etapa da apresentação não está disponível.');
  p.step=step;p.history.push({step,at:Date.now()});p.animating=false;return p;
}
export function presentationCampaign(state){return state.campaigns.find(c=>c.id===state.presentation?.campaignId);}
export function presentationTasks(state){
  const c=presentationCampaign(state),tasks=(c?.sessionIds||[]).map(id=>findTask(state,id)).filter(Boolean);
  const roots=tasks.filter(x=>!(x.s.dependencies||[]).length),parents=roots.filter(x=>tasks.some(y=>y.s.dependencies?.includes(x.s.id)));
  const parent=parents.find(x=>x.m.type==='robot')||parents[0]||roots.find(x=>x.m.type==='robot')||roots[0]||tasks[0];
  const dependent=parent?tasks.find(x=>x.s.dependencies?.includes(parent.s.id)):null;
  const human=parent?.m.type==='human'?parent:tasks.find(x=>x.m.type==='human'&&!(x.s.dependencies||[]).length)||tasks.find(x=>x.m.type==='human');
  return {tasks,parent,dependent,human};
}
export function exampleDelivery(state,{needsCorrection=false}={}){
  const {parent}=presentationTasks(state),palette=state.brain.entries.flatMap(e=>e.palette||[]).join(', ')||'paleta oficial da empresa';return `Entrega de demonstração — ${parent?.s.title||'planejamento da campanha'}\n\nObjetivo: apresentar a coleção na Black Friday com clareza da oferta e identidade consistente.\n\nProposta: conteúdo para Instagram, vídeos verticais de 30 segundos e uma chamada para conhecer a coleção. ${needsCorrection?'Cor proposta: #ff2d55, fora da paleta oficial.':`Correção aplicada: usar a paleta oficial (${palette}).`} Manter a voz da marca e as condições comerciais aprovadas.\n\nO material está organizado para o diretor conferir o briefing, as regras da empresa e a qualidade antes de liberar a próxima etapa.`;
}
export function savePresentation(state){try{localStorage.setItem(PRESENTATION_KEY,JSON.stringify(state));}catch{}}
export function loadPresentation(){try{const s=JSON.parse(localStorage.getItem(PRESENTATION_KEY));if(s?.version===1&&s.presentation?.version===1&&s.presentation.active&&Array.isArray(s.members)&&Array.isArray(s.campaigns)&&Array.isArray(s.presentation.memberIds)&&presentationSteps(s).includes(s.presentation.step))return s;}catch{}return null;}
export function discardPresentation(){try{localStorage.removeItem(PRESENTATION_KEY);}catch{}}
