import {api,h,uploadBrandFile} from './api-client.js';
import {sendsOnEnter,messagesWithOutgoing,deliveryLabel} from './brand-chat.js';
import {patchChat} from './brand-chat-dom.js';
const icon=name=>`<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round">${({close:'<path d="m6 6 12 12M18 6 6 18"/>',send:'<path d="m22 2-7 20-4-9-9-4L22 2ZM11 13 22 2"/>',file:'<path d="M14 3H5v18h14V8l-5-5Zm0 0v5h5M8 12h8M8 16h5"/>',attach:'<path d="m21 11-8 8a6 6 0 0 1-8-8l9-9a4 4 0 0 1 6 6l-9 9a2 2 0 0 1-3-3l8-8"/>',check:'<path d="m5 12 4 4L19 6"/>',arrow:'<path d="M5 12h14m-5-5 5 5-5 5"/>',brain:'<path d="M12 5a4 4 0 0 0-7-1 4 4 0 0 0-2 7 4 4 0 0 0 2 7 4 4 0 0 0 7 2m0-15a4 4 0 0 1 7-1 4 4 0 0 1 2 7 4 4 0 0 1-2 7 4 4 0 0 1-7 2V5Z"/>',link:'<path d="m10 13 4-4m-6 7-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m2 0 1-1a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0"/>'})[name]||''}</svg>`;
const rich=text=>h(text).replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>').replace(/\n/g,'<br>');
const size=n=>n>=1048576?(n/1048576).toFixed(1)+' MB':Math.max(1,Math.round(n/1024))+' KB';
const pending=value=>!value||/^\[(ADICIONAR|INSERIR|CITAÇÃO)/.test(value);
const btn=(label,attrs='',kind='primary')=>`<button class="brain-button ${kind}" ${attrs}>${label}</button>`;
export function createBrandUI({identity,chooseResources}) {
  let state,statuses=null,pane='chat',onboardingConnection=false,provider='claude',draft='',selectedFiles=[],busy=false,flow=null,flowTimer=null,pollTimer=null,previousFocus=null,uploading=false,outgoing=null,sendPoll=null,pollingSend=false;
  let skillIds=[],connectorIds=[],skillCatalog=[],connectorCatalog=[],toolRequests=[];
  const root=document.querySelector('#brain-root');
  const dialog=()=>root.querySelector('dialog');
  const $=s=>root.querySelector(s);
  function error(text){const el=$('#brain-error');if(el){el.textContent=text;el.hidden=false;el.focus({preventScroll:true});}}
  function on(selector,event,handler){const node=$(selector);if(node)node['on'+event]=handler;}
  function frame(title,kicker,content,footer='',options={}) {
    if(pane==='chat'&&dialog()?.dataset.pane==='chat'&&patchChat(dialog(),content,footer,options)){document.querySelector('#brain-title').textContent=title;dialog().querySelector('.brain-kicker').textContent=kicker;return true;}
    if(!dialog()){previousFocus=document.activeElement;root.innerHTML='<dialog class="brain-dialog" aria-labelledby="brain-title"></dialog>';dialog().addEventListener('cancel',e=>{e.preventDefault();close();});}
    dialog().dataset.pane=pane;dialog().innerHTML=`<header class="brain-header"><span class="brain-symbol">${icon(pane==='connections'?'link':'brain')}</span><div><span class="brain-kicker">${kicker}</span><h1 id="brain-title">${title}</h1></div><button class="brain-icon-button brain-close" id="brain-close" aria-label="Continuar depois">${icon('close')}</button></header><p id="brain-error" class="brain-error" role="alert" tabindex="-1" hidden></p>${content}${footer}`;
    $('#brain-close').onclick=close;if(!dialog().open)dialog().showModal();
  }
  async function close(){clearInterval(pollTimer);pollTimer=null;dialog()?.close();root.innerHTML='';previousFocus?.isConnected&&previousFocus.focus({preventScroll:true});try{state=await api('/api/brain/dismiss',{method:'POST'});}catch{}}
  async function refreshStatus(fresh=false){try{statuses=await api('/api/ai/status'+(fresh?'?fresh=1':''));}catch(e){statuses=null;return;}if(dialog()&&pane==='chat'){if(connected())renderChat();else{pane='connections';onboardingConnection=true;renderConnections();}}}
  function connected(){return statuses?.claude?.status==='connected';}
  function fileLinks(files){return files.map(f=>`<a class="brain-file" href="/api/brain/files/${h(f.id)}" target="_blank" rel="noopener">${icon('file')}<span>${h(f.name)}<small>${size(f.size)}</small></span></a>`).join('');}
  async function refreshResources(){const [a,b]=await Promise.all([api('/api/skills'),api('/api/connectors')]);skillCatalog=a.skills;connectorCatalog=b.connectors;}
  function usedResources(m){return [...(m.skills||[]),...(m.connectors||[])].map(x=>`<span>${h(x.title||x.name)}</span>`).join('');}
  function permissionCards(){return toolRequests.map(p=>`<section class="brain-tool-card" data-tool-id="${h(p.id)}"><strong>O Claude quer usar uma ferramenta</strong><p>${h(p.connector)} · ${h(p.title)}</p><details><summary>Ver dados da solicitação</summary><pre>${h(p.input)}</pre></details><div>${btn('Permitir esta vez',`data-allow-tool="${h(p.id)}"`)}${btn('Recusar',`data-deny-tool="${h(p.id)}"`,'secondary')}</div></section>`).join('');}
  async function refreshPermissions(){try{toolRequests=(await api('/api/tool-permissions')).permissions;}catch{}}
  function renderChat({forceBottom=false}={}) {
    const taskMode=skillIds.some(id=>!['default:extrator-de-marca','generated:minha-marca'].includes(id))||((skillIds.length>0||connectorIds.length>0)&&!skillIds.includes('default:extrator-de-marca'));
    const locked=busy||Boolean(state.pending);
    const latest=state.messages.at(-1),failed=state.error?[...state.messages].reverse().find(m=>m.role==='user'):outgoing?.delivery==='failed'?outgoing:null;
    const content=`<div class="brain-chat-meta"><span class="brain-connection ${connected()?'connected':''}"><i></i>${connected()?'Claude conectado':'Claude ainda não conectado'}</span><div>${btn('Ver resumo','id="brain-review"','text')}</div></div>${provider==='claude'&&!connected()&&state.editable?`<div class="brain-connect-note"><span>Conecte sua conta do Claude para ele ler os materiais e conversar sobre sua marca.</span>${btn('Conectar Claude','id="brain-connect"','secondary')}</div>`:''}<div class="brain-messages" id="brain-messages" role="log" tabindex="0" aria-label="Conversa sobre a empresa">${messagesWithOutgoing(state.messages,outgoing).map(m=>`<article class="brain-message ${m.role}" data-chat-key="${h(m.role==='user'&&m.requestId?'user:'+m.requestId:m.id)}"><span class="brain-message-avatar">${m.role==='user'?h(m.author?.[0]?.toUpperCase()||'V'):'✳'}</span><div><div class="brain-message-author">${h(m.role==='user'?m.author:m.provider==='claude'?'Claude':'IANiza · orientação inicial')}</div><p>${rich(m.text)}</p>${m.fileIds?.length?`<div class="brain-message-files">${fileLinks(state.files.filter(f=>m.fileIds.includes(f.id)))}</div>`:''}${usedResources(m)?`<div class="brain-used-resources">${usedResources(m)}</div>`:''}${m.delivery?`<small class="brain-message-delivery ${h(m.delivery)}" role="status">${h(deliveryLabel[m.delivery])}</small>`:''}</div></article>`).join('')}${busy||state.pending?'<div class="brain-thinking" data-chat-key="thinking" role="status"><i></i><i></i><i></i><span>'+('Aguardando a resposta do Claude…')+'</span></div>':''}${failed?`<div class="brain-inline-error" data-chat-key="send-error"><p>${h(state.error||outgoing?.error||'Não foi possível enviar a mensagem.')}</p>${btn('Tentar novamente','id="brain-retry"','secondary')}</div>`:''}</div>`;
    const footer=state.editable?`<div class="brain-tool-permissions">${permissionCards()}</div><div class="brain-chat-bottom">${taskMode?'':state.messages.length<3?`<div class="brain-suggestions">${btn('Começar do zero','data-suggestion="vamos do zero"','chip')}${btn('Já tenho materiais','id="suggest-materials"','chip')}</div>`:`<div class="brain-suggestions">${btn('Não sei, pode sugerir','data-suggestion="Não sei. Pode sugerir, deixando claro o que é proposta."','chip')}${btn('Preparar resumo','data-suggestion="Pode gerar o resumo com o que já temos."','chip')}</div>`}${skillIds.length||connectorIds.length?`<div class="brain-context-tags">${[...skillCatalog.filter(s=>skillIds.includes(s.id)),...connectorCatalog.filter(c=>connectorIds.includes(c.id))].map(r=>`<span>${h(r.title||r.name)}</span>`).join('')}</div>`:''}${selectedFiles.length?`<div class="brain-selected-files">${fileLinks(state.files.filter(f=>selectedFiles.includes(f.id)))}</div>`:''}<form id="brain-compose"><label class="brain-sr-only" for="brain-input">Sua mensagem sobre a empresa</label><textarea id="brain-input" maxlength="12000" rows="3" placeholder="${taskMode?'Escreva seu pedido ou envie um texto para trabalhar…':'Conte sobre sua empresa, cole um texto ou envie materiais…'}" ${locked?'disabled':''}>${h(draft)}</textarea><div class="brain-compose-actions"><div class="brain-resources"><button type="button" class="brain-attach" id="brain-attach" ${locked||uploading?'disabled':''}>${icon('attach')}${uploading?'Enviando arquivo…':'Anexar arquivo'}</button><button type="button" class="brain-resource-choice" id="brain-choose-skills" ${locked?'disabled':''}>✳ Skills${skillIds.length?' · '+skillIds.length:''}</button><button type="button" class="brain-resource-choice" id="brain-choose-connectors" ${locked?'disabled':''}>⌘ Conectores${connectorIds.length?' · '+connectorIds.length:''}</button></div><input type="file" id="brain-file-input" accept=".pdf,.png,.jpg,.jpeg,.webp,.txt,.md,.csv" hidden><button class="brain-send" type="submit" aria-label="Enviar mensagem" ${locked||uploading?'disabled':''}>${icon('send')}</button></div></form><p class="brain-footnote">${'As respostas e os materiais ficam salvos para você continuar depois.'}</p><details class="brain-materials"><summary>Materiais da empresa · ${state.files.length}</summary><div>${fileLinks(state.files)}</div><small>PDF, imagens e textos · até 8 MB por arquivo, 24 MB no total.</small></details></div>`:`<div class="brain-readonly">As informações da empresa são configuradas pelos administradores. ${btn('Ver conhecimento salvo','id="brain-view"','secondary')}</div>`;
    const patched=frame(taskMode?'Conversa com o Claude.':'Vamos conhecer sua empresa.',taskMode?'SKILLS E CONECTORES':'CÉREBRO DA EMPRESA',content,footer,{forceBottom});
    $('#brain-review').onclick=()=>review();
    on('#brain-view','click',()=>review());
    on('#brain-connect','click',()=>connections());
    on('#brain-provider','change',e=>{provider=e.target.value;renderChat();});
    on('#brain-compose','submit',e=>{e.preventDefault();send();});
    on('#brain-input','input',e=>{draft=e.target.value;});
    on('#brain-input','keydown',e=>{if(sendsOnEnter(e)){e.preventDefault();send();}});
    root.querySelectorAll('[data-suggestion]').forEach(b=>b.onclick=()=>{draft=b.dataset.suggestion;renderChat();$('#brain-input').focus({preventScroll:true});});
    on('#brain-attach','click',()=>$('#brain-file-input').click());on('#suggest-materials','click',()=>$('#brain-file-input').click());
    on('#brain-file-input','change',async e=>{
      const file=e.target.files[0];if(!file)return;if(file.size>8*1024*1024){error('Escolha um arquivo de até 8 MB.');return;}
      uploading=true;renderChat();try{const result=await uploadBrandFile(file);state=await api('/api/brain');selectedFiles.push(result.id);}catch(e){error(e.message);uploading=false;renderChat();error(e.message);return;}uploading=false;renderChat();
    });
    on('#brain-retry','click',()=>send(failed));
    for(const kind of ['skills','connectors'])on('#brain-choose-'+kind,'click',async()=>{const selected=await chooseResources(kind,kind==='skills'?skillIds:connectorIds);if(selected){if(kind==='skills')skillIds=selected;else connectorIds=selected;await refreshResources();renderChat();}});
    for(const attr of ['allow','deny'])root.querySelectorAll('[data-'+attr+'-tool]').forEach(b=>b.onclick=async()=>{b.disabled=true;try{await api('/api/tool-permissions/'+b.dataset[attr+'Tool'],{method:'POST',body:{allow:attr==='allow'}});await refreshPermissions();renderChat();}catch(e){error(e.message);b.disabled=false;}});
    const list=$('#brain-messages');if(!patched)list.scrollTop=list.scrollHeight;
    if(busy&&failed)error(state.error);
  }
  async function send(retry) {
    if(busy||state.pending||uploading||!state.editable)return;
    if(!connected()){error('Conecte o Claude para iniciar a conversa.');return;}
    const text=retry?retry.text:draft.trim(),fileIds=retry?retry.fileIds||[]:[...selectedFiles];
    if(!text&&!fileIds.length)return;
    const requestId=retry?retry.requestId:crypto.randomUUID(),revision=state.revision;
    const chosenSkillIds=retry?(retry.skills||[]).map(s=>s.id):[...skillIds],chosenConnectorIds=retry?(retry.connectors||[]).map(c=>c.id):[...connectorIds];
    outgoing={id:'outgoing-'+requestId,requestId,role:'user',author:identity.user.name,text,fileIds,skills:skillCatalog.filter(s=>chosenSkillIds.includes(s.id)),connectors:connectorCatalog.filter(c=>chosenConnectorIds.includes(c.id)).map(c=>({id:c.id,title:c.name})),delivery:'sending'};
    draft='';selectedFiles=[];busy=true;state.error=null;if($('#brain-error'))$('#brain-error').hidden=true;renderChat({forceBottom:true});
    clearInterval(sendPoll);
    sendPoll=setInterval(async()=>{
      if(pollingSend||!busy)return;pollingSend=true;
      try{const [latest]=await Promise.all([api('/api/brain'),refreshPermissions()]);if(!busy||outgoing?.requestId!==requestId||latest.revision<state.revision)return;state=latest;if(state.messages.some(m=>m.role==='user'&&m.requestId===requestId))outgoing.delivery='sent';if(dialog()?.open&&pane==='chat')renderChat();}catch{}finally{pollingSend=false;}
    },700);
    try {
      state=await api('/api/brain/messages',{method:'POST',body:{requestId,text,fileIds,provider:'claude',revision,skillIds:chosenSkillIds,connectorIds:chosenConnectorIds}});
      busy=false;outgoing=null;toolRequests=[];
      if(!dialog()?.open)return;
      if(state.reviewReady&&!chosenSkillIds.some(id=>!['default:extrator-de-marca','generated:minha-marca'].includes(id))&&(!chosenSkillIds.length&&!chosenConnectorIds.length||chosenSkillIds.includes('default:extrator-de-marca'))){pane='review';renderReview();}else {renderChat();$('#brain-input')?.focus({preventScroll:true});}
    } catch(e) {
      busy=false;
      try{state=await api('/api/brain');}catch{}
      const saved=state.messages.some(m=>m.role==='user'&&m.requestId===requestId);
      outgoing={...outgoing,delivery:saved?'sent':'failed',error:e.message};
      if(dialog()?.open){renderChat();error(e.message);if(e.status===409)refreshStatus(true);}
    } finally {clearInterval(sendPoll);sendPoll=null;toolRequests=[];}
  }
  async function review() {
    try{if(state.editable)state=await api('/api/brain/review',{method:'POST'});pane='review';renderReview();}catch(e){error(e.message);}
  }
  function renderReview() {
    const missing=Object.values(state.profile).filter(f=>pending(f.value)).length;
    const content=`<div class="brain-review-intro"><p>Confira o que a IA vai usar como referência. Você pode corrigir os dados e deixar informações para depois.</p><div class="brain-review-notice">Sugestões de cores e fontes estão identificadas. Números, casos e depoimentos sem confirmação permanecem pendentes.</div></div><form id="brain-review-form" class="brain-review-form">${state.topics.map((topic,index)=>`<details class="brain-topic" ${index===0?'open':''}><summary><span>${h(topic.title)}</span><small>${topic.fields.filter(k=>!pending(state.profile[k]?.value)).length} informações</small></summary><div>${topic.fields.map(key=>{const f=state.profile[key],source=f?.source;return `<label>${h(state.fieldLabels[key]||key)}<span class="brain-field-source ${h(source||'missing')}">${({provided:'Informado',inferred:'Confira esta informação',proposed:'Sugestão para você conferir',missing:'Pendente'})[source]||'Pendente'}</span><textarea name="${h(key)}" rows="${key==='TEXTOS_ANCORA'?4:2}" maxlength="5000" ${state.editable?'':'readonly'} placeholder="Ainda não informado">${h(pending(f?.value)?'':f.value)}</textarea>${f?.reason?`<small>${h(f.reason)}</small>`:''}</label>`;}).join('')}${state.notes[topic.id]?.length?`<details class="brain-raw-notes"><summary>Respostas originais sobre este tema</summary>${state.notes[topic.id].map(t=>`<p>${rich(t)}</p>`).join('')}</details>`:''}</div></details>`).join('')}</form>`;
    const footer=`<footer class="brain-review-footer">${btn('Voltar à conversa','id="back-chat"','secondary')}${state.editable?btn(`${icon('check')}Salvar no cérebro`,'id="brain-save"'):''}</footer>`;
    frame('A sua marca, em resumo.','CONHECIMENTO DA EMPRESA',content,footer);
    $('#back-chat').onclick=()=>{pane='chat';renderChat();};
    $('#brain-save')?.addEventListener('click',async e=>{
      const b=e.currentTarget;b.disabled=true;b.textContent='Salvando…';
      try{
        const fields={},form=new FormData($('#brain-review-form'));
        for(const [key,value] of form.entries()){const previous=state.profile[key]?.value||'';if(value.trim()!==(pending(previous)?'':previous))fields[key]=value.trim();}
        if(Object.keys(fields).length)state=await api('/api/brain/profile',{method:'PATCH',body:{revision:state.revision,fields}});
        state=await api('/api/brain/confirm',{method:'POST',body:{revision:state.revision}});renderSaved();
      }catch(e){error(e.message);b.disabled=false;b.innerHTML=icon('check')+'Salvar no cérebro';}
    });
  }
  function renderSaved() {
    frame('A marca já está no cérebro.','CONHECIMENTO SALVO',`<div class="brain-saved"><span>${icon('check')}</span><h2>${h(state.profile.NOME_MARCA?.value)}</h2><p>As informações, as regras e os materiais ficaram guardados no espaço da sua empresa. Você pode voltar pelo perfil para consultar ou atualizar.</p><a href="/api/brain/skill" class="brain-button secondary">${icon('file')}Baixar skill minha-marca</a><small>O arquivo contém o perfil e as instruções para usar a marca em outras conversas.</small></div>`,`<footer class="brain-review-footer">${btn('Voltar ao escritório','id="finish-brain"')}</footer>`);
    $('#finish-brain').onclick=close;
  }
  function connectionCards() {return (onboardingConnection?['claude']:['claude','codex']).map(id=>{const st=statuses?.[id],name=id==='claude'?'Claude Code':'Codex';return `<section class="brain-ai-card"><div><span class="brain-ai-mark">${id==='claude'?'✳':'◎'}</span><div><h2>${name}</h2><p>${st?.status==='connected'?'Conta conectada':st?.installed===false?'Aplicativo não encontrado':'Conta ainda não conectada'}</p></div><i class="${st?.status==='connected'?'online':''}"></i></div>${btn(st?.status==='connected'?'Atualizar conexão':'Conectar '+name,`data-connect-provider="${id}"`,st?.status==='connected'?'secondary':'primary')}</section>`;}).join('');}
  function renderConnections() {
    let content='<div class="brain-connections"><p>'+(onboardingConnection?'Primeiro, autorize sua conta do Claude. Só depois abriremos a conversa sobre a empresa, com a skill Extrator de Marca.':'Conecte as contas que sua empresa vai usar. A autorização acontece na página oficial de cada provedor.')+'</p>'+connectionCards();
    if(flow){const complete=['complete','error','cancelled'].includes(flow.stage);content+=`<section class="brain-auth-flow"><strong>${flow.provider==='claude'?'Claude Code':'Codex'}</strong><p>${h(flow.message||({'starting':'Preparando o link de autorização…',authorize:'Conclua a autorização na página oficial.',code:'Depois de autorizar, cole o código mostrado pelo Claude.'})[flow.stage]||'Aguardando autorização…')}</p>${flow.url?`<a class="brain-button primary" href="${h(flow.url)}" target="_blank" rel="noopener noreferrer">Autorizar na página oficial ${icon('arrow')}</a>`:''}${flow.deviceCode?`<p class="brain-device-code">${h(flow.deviceCode)}</p>`:''}${flow.provider==='claude'&&flow.url&&!complete?`<form id="brain-auth-code"><label>Código de autorização<input name="code" autocomplete="off" spellcheck="false" required maxlength="4096" placeholder="Cole o código após autorizar"></label>${btn('Confirmar código','type="submit"','secondary')}</form>`:''}${!complete?btn('Cancelar tentativa','id="cancel-ai-flow"','text'):''}</section>`;}
    content+='</div>';
    frame(onboardingConnection?'Conecte o Claude para começar.':'Conectar as contas de IA.',onboardingConnection?'ANTES DA ENTREVISTA':'CONEXÕES',content,`<footer class="brain-review-footer">${btn(onboardingConnection?'Fazer isso depois':'Voltar ao escritório','id="connections-back"','secondary')}${btn('Já conectei · Verificar','id="check-ai"','text')}</footer>`);
    root.querySelectorAll('[data-connect-provider]').forEach(b=>b.onclick=async()=>{b.disabled=true;try{if(statuses?.[b.dataset.connectProvider]?.status==='connected'){await refreshStatus(true);renderConnections();return;}flow=await api(`/api/ai/${b.dataset.connectProvider}/login`,{method:'POST'});renderConnections();pollFlow();}catch(e){error(e.message);b.disabled=false;}});
    $('#connections-back').onclick=close;
    $('#check-ai').onclick=async()=>{await refreshStatus(true);if(!dialog())return;if(onboardingConnection&&connected()){onboardingConnection=false;pane='chat';renderChat();}else renderConnections();};
    $('#brain-auth-code')?.addEventListener('submit',async e=>{e.preventDefault();const b=e.target.querySelector('button');b.disabled=true;try{flow=await api(`/api/ai/flows/${flow.id}/code`,{method:'POST',body:{code:new FormData(e.target).get('code')}});renderConnections();}catch(e){error(e.message);b.disabled=false;}});
    $('#cancel-ai-flow')?.addEventListener('click',async()=>{try{flow=await api(`/api/ai/flows/${flow.id}/cancel`,{method:'POST'});clearInterval(flowTimer);renderConnections();}catch(e){error(e.message);}});
  }
  function pollFlow() {clearInterval(flowTimer);flowTimer=setInterval(async()=>{try{flow=await api(`/api/ai/flows/${flow.id}`);if(['complete','error','cancelled'].includes(flow.stage)){clearInterval(flowTimer);await refreshStatus(true);if(onboardingConnection&&connected()&&dialog()){flow=null;onboardingConnection=false;pane='chat';renderChat();return;}}if(dialog()&&pane==='connections'&&!document.activeElement?.closest('#brain-auth-code'))renderConnections();}catch(e){clearInterval(flowTimer);if(dialog())error(e.message);}},1500);}
  async function open(options={}) {
    try{
      state=await api('/api/brain');await refreshResources();provider='claude';
      if(options.skillId&&!skillIds.includes(options.skillId))skillIds=[options.skillId];
      if(options.connectorId&&!connectorIds.includes(options.connectorId))connectorIds=[options.connectorId];
      const forChat=options.skillId||options.connectorId;
      if(state.confirmed&&!forChat){pane='review';renderReview();}
      else if(state.editable){onboardingConnection=true;pane='connections';renderConnections();await refreshStatus(true);if(!dialog())return;if(connected()){onboardingConnection=false;pane='chat';renderChat();}else renderConnections();}
      else{pane='review';renderReview();}
      if(state.pending){clearInterval(pollTimer);pollTimer=setInterval(async()=>{try{const [latest]=await Promise.all([api('/api/brain'),refreshPermissions()]);state=latest;if(!state.pending)clearInterval(pollTimer);if(dialog()&&pane==='chat')renderChat();}catch{}},1000);}
    }catch(e){frame('Vamos tentar novamente?','CÉREBRO',`<div class="brain-empty-error">${h(e.message)}</div>`);}
  }
  async function connections() {if(!state)state=await api('/api/brain');onboardingConnection=false;pane='connections';renderConnections();await refreshStatus(true);if(dialog())renderConnections();}
  async function init() {state=await api('/api/brain');if(state.onboardingNeeded)await open();}
  return {init,open,connections};
}
