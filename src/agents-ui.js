import {api,h} from './api-client.js';
import {sendsOnEnter,chatScrollTarget} from './brand-chat.js';
import {activityLabel,renderActivity,renderMessage} from './agent-message.js';
import {conversationModel} from '../shared/chat-media.mjs';

const robot='<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M24 6v6M14 15h20a7 7 0 0 1 7 7v10a7 7 0 0 1-7 7H14a7 7 0 0 1-7-7V22a7 7 0 0 1 7-7Z"/><path d="M2 24v7m44-7v7M18 32h12"/><circle cx="17" cy="24" r="2"/><circle cx="31" cy="24" r="2"/></svg>';
export function createAgentsUI({identity,onStatus=()=>{}}){
  const root=document.querySelector('#agents-root');
  let state,draft='',selected=null,busy=false,timer,previousFocus,pane='chat',outgoing=null,toolRequests=[],permissionSignature=null,accessState=null,connectorDraft=[],accessBusy=false,accessDirty=false;
  const $=s=>root.querySelector(s);
  const dialog=()=>$('dialog');
  function close(){clearInterval(timer);timer=null;dialog()?.close();root.innerHTML='';permissionSignature=null;toolRequests=[];accessState=null;connectorDraft=[];accessDirty=false;previousFocus?.isConnected&&previousFocus.focus({preventScroll:true});}
  function frame(){
    if(dialog())return;
    previousFocus=document.activeElement;
    root.innerHTML=`<dialog class="agent-dialog" aria-labelledby="agent-title"><header class="agent-header"><span class="agent-avatar">${robot}</span><div><span class="agent-eyebrow">SEU TIME · SOCIAL MEDIA</span><h1 id="agent-title">Lia<span class="agent-kind">Agente de IA</span></h1><p id="lia-status" role="status">Disponível para conversar</p></div><button class="agent-close" aria-label="Voltar ao escritório">×</button></header><nav class="agent-tabs" aria-label="Painel da Lia"><button data-pane="chat" aria-pressed="true">Conversa</button><button data-pane="about" aria-pressed="false">Sobre a Lia</button><button data-pane="connectors" aria-pressed="false">Conectores</button></nav><div class="agent-error" id="lia-error" role="alert" hidden></div><section id="lia-chat"><div class="agent-messages" role="log" aria-label="Conversa com a Lia" tabindex="0"></div><div id="lia-tools" class="agent-tool-permissions" aria-live="polite"></div><div class="agent-starters"><button data-prompt="Me ajude a montar um calendário de conteúdo para esta semana.">Planejar a semana</button><button data-prompt="Quero estruturar um carrossel. Vamos definir a pauta e a sequência dos slides.">Criar um carrossel</button><button data-prompt="Quero analisar uma referência de conteúdo. Quais dados devo te passar?">Analisar uma referência</button></div><form id="lia-compose"><fieldset class="agent-skill-picker"><legend>Skills para este pedido <small>até 3</small></legend><div id="lia-skills"></div></fieldset><div id="lia-connectors" class="agent-connectors"></div><label class="agent-input-label" for="lia-input">Seu pedido para a Lia</label><div class="agent-compose-box"><textarea id="lia-input" maxlength="12000" rows="3" placeholder="Conte o que você quer preparar…"></textarea><button type="submit" aria-label="Enviar para a Lia">↑</button></div><p class="agent-save-note">Sua conversa fica salva para continuar depois.</p></form></section><section id="lia-about" class="agent-about" hidden></section><section id="lia-access" class="agent-access" hidden></section></dialog>`;
    const modelLine=document.createElement('p');modelLine.id='lia-model';modelLine.className='agent-model';modelLine.textContent='Conversa com Claude';$('#lia-status').after(modelLine);
    $('.agent-close').onclick=close;
    dialog().addEventListener('cancel',e=>{e.preventDefault();close();});
    root.querySelectorAll('[data-pane]').forEach(b=>b.onclick=()=>{pane=b.dataset.pane;renderPane();if(pane==='connectors')loadConnectorAccess();});
    root.querySelectorAll('[data-prompt]').forEach(b=>b.onclick=()=>{draft=b.dataset.prompt;$('#lia-input').value=draft;$('#lia-input').focus();});
    $('#lia-input').value=draft;
    $('#lia-input').oninput=e=>{draft=e.target.value;};
    $('#lia-input').onkeydown=e=>{if(sendsOnEnter(e)){e.preventDefault();send();}};
    $('#lia-compose').onsubmit=e=>{e.preventDefault();send();};
    dialog().showModal();
  }
  function showError(message){if($('#lia-error')){$('#lia-error').textContent=message;$('#lia-error').hidden=!message;}}
  function renderPane(){
    if(!dialog())return;
    $('#lia-chat').hidden=pane!=='chat';$('#lia-about').hidden=pane!=='about';$('#lia-access').hidden=pane!=='connectors';
    root.querySelectorAll('[data-pane]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.pane===pane)));
    if(pane!=='chat')showError('');else if(state?.error)showError(state.error);
  }
  function renderProfile(){
    if(!state||!dialog())return;
    const agent=state.agent,available=agent.skills.filter(s=>s.status==='available');
    selected??=available.filter(s=>s.id==='texto-humano').map(s=>s.catalogId);selected=selected.filter(id=>available.some(s=>s.catalogId===id));
    $('#lia-skills').innerHTML=available.map(s=>`<label><input type="checkbox" value="${h(s.catalogId)}" ${selected.includes(s.catalogId)?'checked':''}><span>${h(s.title)}</span></label>`).join('')||'<p>Nenhuma skill está ativa no catálogo.</p>';
    $('#lia-skills').querySelectorAll('input').forEach(input=>input.onchange=()=>{const ids=[...$('#lia-skills').querySelectorAll('input:checked')].map(i=>i.value);if(ids.length>3){input.checked=false;showError('Selecione até três skills para o pedido.');return;}selected=ids;showError('');});
    const connectorStatus={available:'Conectado',disabled:'Desativado','auth-required':'Conecte na área de Conectores',error:'Confira a conexão'};
    const connectorCards=(agent.connectors||[]).map(c=>`<span class="agent-connector ${c.available?'is-connected':''}"><i aria-hidden="true"></i>${h(c.title)} · ${h(connectorStatus[c.status])}${c.available?' · '+(c.mode==='allow'?'Uso liberado':'Pedir confirmação'):''}</span>`).join('');
    $('#lia-connectors').innerHTML=connectorCards+'<button type="button" data-manage-connectors class="agent-manage-access">'+(agent.canManageConnectors?'Gerenciar conectores':'Ver conectores')+'</button>';if(busy||state.pending)$('#lia-skills').querySelectorAll('input').forEach(i=>i.disabled=true);
    $('#lia-connectors [data-manage-connectors]').onclick=()=>{pane='connectors';renderPane();loadConnectorAccess();};
    $('#lia-about').innerHTML=`<div class="agent-about-intro"><span class="agent-section-label">O QUE EU FAÇO</span><h2>Conteúdo com direção.</h2><p>${h(agent.responsibility)}</p></div><h3>No dia a dia</h3><ul>${agent.daily.map(x=>`<li>${h(x)}</li>`).join('')}</ul><h3>Skills da minha função</h3><div class="agent-capability-list">${agent.skills.map(s=>`<article><div><strong>${h(s.title)}</strong><small>${s.responsibility==='primary'?'Responsável principal':'Apoio à função'}</small></div><span class="agent-capability-state ${h(s.status)}">${({available:'Disponível',disabled:'Desativada',pending:'Integração pendente'})[s.status]}</span></article>`).join('')}</div><h3>Conectores da Lia</h3><div class="agent-connectors">${connectorCards||'<p>Nenhum conector atribuído.</p>'}</div><h3>Contexto e entregas</h3><p>${agent.brandRevision?'Uso a versão '+h(agent.brandRevision)+' da marca aprovada no cérebro.':'A marca ainda não foi confirmada no cérebro. Posso começar com o contexto que você me passar.'}</p><p>Preparo propostas para sua revisão. Posso criar imagens e vídeos pelo Higgsfield quando ele estiver conectado e habilitado. Você escolhe quais conectores posso usar e se devo pedir confirmação na aba Conectores. Os serviços podem consumir créditos. Coleta de perfis, transcrição e edição por scripts continuam pendentes.</p>`;
  }
  async function loadConnectorAccess(){
    if(!$('#lia-access'))return;$('#lia-access').innerHTML='<p class="agent-access-loading" role="status">Carregando conectores…</p>';
    try{accessState=await api('/api/agents/lia/connectors');connectorDraft=accessState.connectors.filter(c=>c.assigned).map(c=>({connectorId:c.id,mode:c.mode}));accessDirty=false;renderConnectorAccess();}catch(e){showError(e.message);}
  }
  function renderConnectorAccess(notice=''){
    if(!accessState||!$('#lia-access'))return;
    const editable=accessState.editable&&!accessBusy,available=accessState.connectors.filter(c=>!connectorDraft.some(d=>d.connectorId===c.id));
    const statuses={available:'Conta conectada',disabled:'Conector desativado na empresa','auth-required':'Conecte a conta na área de Conectores',error:'Confira a conexão na empresa'};
    $('#lia-access').innerHTML=`<div class="agent-access-intro"><h2>Conectores da Lia</h2><p>Escolha os serviços que ela pode usar e quando deve pedir confirmação. A configuração vale para a Lia em toda esta instalação.</p>${!accessState.editable?'<small>Somente administradores podem alterar estes acessos.</small>':''}</div><div class="agent-access-list">${connectorDraft.map(d=>{const c=accessState.connectors.find(c=>c.id===d.connectorId);return `<article class="agent-access-card"><div class="agent-access-heading"><div><h3>${h(c.title)}</h3><small>${h(statuses[c.status])}</small></div>${accessState.editable?`<button type="button" data-remove-access="${h(c.id)}" aria-label="Remover acesso a ${h(c.title)}" ${editable?'':'disabled'}>Remover</button>`:''}</div><label>Permissão para ${h(c.title)}<select data-access-mode="${h(c.id)}" ${editable?'':'disabled'}><option value="allow" ${d.mode==='allow'?'selected':''}>Usar sem perguntar</option><option value="ask" ${d.mode==='ask'?'selected':''}>Pedir confirmação a cada uso</option></select></label><p>${d.mode==='allow'?'A Lia pode executar as ferramentas deste conector sem interromper você.':'A Lia aguardará sua aprovação antes de executar cada ferramenta.'}</p></article>`;}).join('')||'<p class="agent-access-empty">A Lia ainda não tem acesso a nenhum conector.</p>'}</div>${accessState.editable?`<div class="agent-access-add"><label for="lia-add-connector">Adicionar um conector<select id="lia-add-connector" ${editable&&available.length&&connectorDraft.length<5?'':'disabled'}>${available.length?available.map(c=>`<option value="${h(c.id)}">${h(c.title)}</option>`).join(''):'<option>Nenhum outro conector cadastrado</option>'}</select></label><button type="button" id="lia-add-access" ${editable&&available.length&&connectorDraft.length<5?'':'disabled'}>Adicionar</button></div>`:''}<p class="agent-access-note">São os conectores cadastrados na empresa. Usos autorizados podem consumir créditos ou alterar dados no serviço. Remover aqui retira o acesso da Lia e mantém a conta conectada na empresa.</p><div class="agent-access-footer"><p id="lia-access-notice" role="status">${h(notice||(accessDirty?'Alterações ainda não salvas.':'Permissões salvas nesta instalação.'))}</p>${accessState.editable?`<button type="button" id="lia-save-access" ${editable&&accessDirty?'':'disabled'}>${accessBusy?'Salvando…':'Salvar permissões'}</button>`:''}</div>`;
    $('#lia-add-access')?.addEventListener('click',()=>{if(!editable||connectorDraft.length>=5)return;const id=$('#lia-add-connector').value;if(!available.some(c=>c.id===id))return;connectorDraft.push({connectorId:id,mode:'allow'});accessDirty=true;renderConnectorAccess();});
    root.querySelectorAll('[data-remove-access]').forEach(b=>b.onclick=()=>{connectorDraft=connectorDraft.filter(d=>d.connectorId!==b.dataset.removeAccess);accessDirty=true;renderConnectorAccess();});
    root.querySelectorAll('[data-access-mode]').forEach(select=>select.onchange=()=>{connectorDraft.find(d=>d.connectorId===select.dataset.accessMode).mode=select.value;accessDirty=true;renderConnectorAccess();});
    $('#lia-save-access')?.addEventListener('click',async()=>{if(accessBusy||!accessDirty)return;accessBusy=true;renderConnectorAccess();try{const result=await api('/api/agents/lia/connectors',{method:'PATCH',body:{revision:accessState.revision,assignments:connectorDraft}});accessState=result;accessDirty=false;accessBusy=false;renderConnectorAccess('Permissões salvas. A Lia já usa esta configuração.');await refresh();}catch(e){accessBusy=false;renderConnectorAccess();showError(e.message);}});
  }
  async function allowConnector(connectorId){
    const current=await api('/api/agents/lia/connectors');if(!current.connectors.some(c=>c.id===connectorId&&c.assigned))throw new Error('Este conector foi removido da Lia. Confira os acessos.');
    await api('/api/agents/lia/connectors',{method:'PATCH',body:{revision:current.revision,assignments:current.connectors.filter(c=>c.assigned).map(c=>({connectorId:c.id,mode:c.id===connectorId?'allow':c.mode}))}});await refresh();
  }
  function waitingLabel(){return 'Aguardando sua autorização para usar '+(toolRequests[0]?.connector||'o conector')+'…';}
  function statusLabel(){return toolRequests.length?waitingLabel():busy||state?.pending?activityLabel(state?.pending?state.activity:null):'Disponível para conversar';}
  function renderMessages(forceBottom=false){
    if(!state)return;
    onStatus(busy||state.pending?'working':'available');
    if(!dialog())return;
    const list=$('.agent-messages'),before={scrollHeight:list.scrollHeight,clientHeight:list.clientHeight,scrollTop:list.scrollTop};
    const messages=[...state.messages];
    if(outgoing&&!messages.some(m=>m.requestId===outgoing.requestId&&m.role==='user'))messages.push(outgoing);
    // Mantém as mensagens e imagens existentes no DOM durante o polling.
    // Atualizar uma etapa não recarrega as prévias nem perde a posição de leitura.
    const existing=new Map([...list.querySelectorAll('.agent-message')].map(el=>[el.dataset.key,el]));
    let anchor=list.firstElementChild;
    for(const m of messages){
      const key=m.id||m.role+':'+m.requestId;let article=existing.get(key);existing.delete(key);
      if(!article){article=document.createElement('article');article.className='agent-message '+m.role;article.dataset.key=key;article.innerHTML=renderMessage(m);
        article.querySelectorAll('img').forEach(img=>{img.onerror=()=>{img.hidden=true;img.closest('figure').querySelector('.agent-image-error').hidden=false;};});
      }
      if(article!==anchor)list.insertBefore(article,anchor);anchor=article.nextElementSibling;
    }
    for(const article of existing.values())article.remove();
    let live=$('#lia-live-activity');if(!live){live=document.createElement('div');live.id='lia-live-activity';list.append(live);}
    const liveHTML=busy||state.pending?(state.pending&&state.activity?renderActivity(state.activity,{live:true,open:!!live.querySelector('details[open]')}):'<p class="agent-thinking" role="status">Enviando sua mensagem ao Claude…</p>'):state.activity&&state.activity.status!=='completed'?renderActivity(state.activity):'';
    if(live.dataset.content!==liveHTML){live.dataset.content=liveHTML;live.innerHTML=liveHTML;}
    list.querySelector('.agent-retry')?.remove();
    list.scrollTop=chatScrollTarget(before,list,{forceBottom});
    const locked=busy||Boolean(state.pending);
    $('#lia-input').disabled=locked;$('#lia-compose button[type="submit"]').disabled=locked;
    $('#lia-skills').querySelectorAll('input').forEach(i=>i.disabled=locked);
    root.querySelectorAll('[data-prompt]').forEach(b=>b.disabled=locked);
    $('.agent-starters').hidden=state.messages.length>1||locked;
    $('#lia-status').textContent=statusLabel();
    const model=state.activity?.model||[...state.messages].reverse().find(m=>m.model)?.model;
    $('#lia-model').textContent=model?conversationModel(model):'Conversa com Claude · '+(state.pending?'identificando o modelo…':'modelo exibido na próxima resposta');
    const lastUser=[...state.messages].reverse().find(m=>m.role==='user');
    const retry=(state.error&&lastUser&&!state.messages.some(m=>m.role==='assistant'&&m.requestId===lastUser.requestId))?lastUser:null;
    if(retry&&!locked){const b=document.createElement('button');b.className='agent-retry';b.textContent='Tentar responder novamente';b.onclick=()=>send(retry);list.append(b);}
    if(state.error&&pane==='chat')showError(state.error);
  }
  function renderPermissions(){
    if(!dialog())return;
    const signature=JSON.stringify(toolRequests),box=$('#lia-tools');if(signature===permissionSignature)return;permissionSignature=signature;
    const expanded=new Set([...box.querySelectorAll('details[open]')].map(d=>d.closest('[data-tool]').dataset.tool));
    box.innerHTML=toolRequests.map(p=>`<section class="agent-tool-card" data-tool="${h(p.id)}"><strong>A Lia quer usar ${h(p.connector)}</strong><p>${h(p.title)}</p><small>Esta execução pode consumir créditos do serviço.</small><details ${expanded.has(p.id)?'open':''}><summary>Ver dados enviados</summary><pre>${h(p.input)}</pre></details><div><button type="button" data-allow="${h(p.id)}">Permitir esta vez</button><button type="button" data-deny="${h(p.id)}">Recusar</button>${state?.agent.canManageConnectors&&p.connectorId?`<button type="button" data-always="${h(p.connectorId)}">Não perguntar novamente</button>`:''}</div></section>`).join('');
    for(const action of ['allow','deny'])box.querySelectorAll('[data-'+action+']').forEach(b=>b.onclick=async()=>{const card=b.closest('section');card.querySelectorAll('button').forEach(button=>button.disabled=true);try{await api('/api/tool-permissions/'+b.dataset[action],{method:'POST',body:{allow:action==='allow'}});await refreshPermissions();}catch(e){showError(e.message);card.querySelectorAll('button').forEach(button=>button.disabled=false);}});
    box.querySelectorAll('[data-always]').forEach(b=>b.onclick=async()=>{b.disabled=true;try{await allowConnector(b.dataset.always);}catch(e){showError(e.message);b.disabled=false;}});
    $('#lia-status').textContent=statusLabel();
  }
  async function refreshPermissions(){
    const requestId=state?.pending||outgoing?.requestId;
    const requests=requestId?(await api('/api/tool-permissions')).permissions:[];if(requestId!==(state?.pending||outgoing?.requestId))return;toolRequests=requests.filter(p=>p.requestId===requestId);renderPermissions();
  }
  async function refresh(){
    const latest=await api('/api/agents/lia');
    if(state&&latest.revision<state.revision)return;
    const changed=!state||latest.revision!==state.revision,profileChanged=!state||JSON.stringify(latest.agent)!==JSON.stringify(state.agent);state=latest;
    if(profileChanged)renderProfile();if(changed)renderMessages();await refreshPermissions();
  }
  async function send(retry){
    if(busy||state?.pending||!state)return;
    const text=retry?.text||draft.trim();if(!text)return;
    const requestId=retry?.requestId||crypto.randomUUID(),skillIds=retry?retry.skills.map(s=>s.id):[...(selected||[])];
    const revision=state.revision;busy=true;showError('');state.error=null;
    outgoing={requestId,role:'user',author:identity.user.name,text};
    if(!retry){draft='';$('#lia-input').value='';}renderMessages(true);
    try{state=await api('/api/agents/lia/messages',{method:'POST',body:{text,requestId,revision,skillIds}});outgoing=null;}
    catch(e){try{await refresh();}catch{}if(!state.messages.some(m=>m.role==='user'&&m.requestId===requestId)){draft=text;if($('#lia-input'))$('#lia-input').value=draft;}outgoing=null;state.error=e.message;}
    finally{busy=false;toolRequests=[];renderPermissions();renderProfile();renderMessages();if(dialog()?.open&&pane==='chat')$('#lia-input').focus({preventScroll:true});}
  }
  async function open(){
    frame();renderPane();showError('');
    try{await refresh();if(!dialog()?.open)return;renderProfile();renderMessages(true);if(pane==='connectors')await loadConnectorAccess();clearInterval(timer);timer=setInterval(()=>refresh().catch(e=>showError(e.message)),1800);}
    catch(e){showError(e.message);}
  }
  return {open,close};
}
