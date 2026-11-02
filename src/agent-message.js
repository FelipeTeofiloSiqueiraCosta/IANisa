import {h} from './api-client.js';
import {messageImages,conversationModel} from '../shared/chat-media.mjs';

const statusLabels={running:'Em andamento',waiting:'Aguardando autorização',completed:'Concluído',failed:'Falhou',cancelled:'Não autorizado',interrupted:'Interrompido'};
export function activityLabel(activity){
  const steps=activity?.steps??[];
  const current=[...steps].reverse().find(s=>['running','waiting'].includes(s.status));
  return current?.status==='waiting'?'Aguardando autorização para o conector':current?.label||'Aguardando a resposta do Claude';
}
export function renderActivity(activity,{live=false,open=false}={}){
  if(!activity?.steps?.length)return '';
  const rows=steps=>'<ol>'+steps.map(s=>`<li class="is-${h(s.status)}"><i aria-hidden="true"></i><span>${h(s.label)}</span><small>${h(statusLabels[s.status]||'Em andamento')}</small></li>`).join('')+'</ol>';
  const history=`<details data-activity="${h(activity.requestId)}" ${open?'open':''}><summary>${live?'Ver todas as etapas':'Etapas desta resposta'} <small>· ${activity.steps.length}</small></summary>${rows(activity.steps)}</details>`;
  return `<section class="agent-activity ${live?'is-live':''}">${live?`<div class="agent-activity-current" role="status" aria-live="polite"><i aria-hidden="true"></i><strong>${h(activityLabel(activity))}</strong></div>${rows(activity.steps.slice(-3))}`:''}${history}</section>`;
}
export function renderMessage(message){
  const images=messageImages(message);
  let body=h(message.text);
  for(const img of images)body=body.split(h(img.url)).join(`<a href="${h(img.url)}" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer">Ver imagem gerada ↗</a>`);
  const preview=images.map((img,i)=>`<figure class="agent-image"><a href="${h(img.url)}" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer" aria-label="Abrir imagem ${i+1} em tamanho completo"><img src="${h(img.url)}" alt="Imagem gerada pelo Higgsfield" loading="lazy" decoding="async" referrerpolicy="no-referrer"></a><p class="agent-image-error" hidden>Não foi possível carregar a prévia. Abra a imagem pelo link.</p><figcaption><span>Imagem · Higgsfield${img.model?' · '+h(img.model):''}</span>${img.source==='legacy'&&img.model?'<small>Modelo informado na resposta</small>':''}<a href="${h(img.url)}" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer">Abrir imagem ↗</a></figcaption></figure>`).join('');
  const refs=[...(message.skills||[]),...(message.connectors||[])];
  return `<div class="agent-message-byline"><span class="agent-message-author">${h(message.role==='user'?message.author:'Lia')}</span>${message.role==='assistant'&&message.provider?`<span class="agent-message-model">${h(conversationModel(message.model))}</span>`:''}</div><div class="agent-message-text">${body}</div>${preview}${refs.length?`<small class="agent-message-skills">${refs.map(s=>h(s.title)).join(' · ')}</small>`:''}${renderActivity(message.activity)}`;
}
