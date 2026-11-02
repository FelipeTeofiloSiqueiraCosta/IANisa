import { advanceJourney } from './journey.js';
import { directorProfile, scheduleTaskReview } from './coordination.js';
import { catalog } from './state.js';
import { exampleDelivery, explainMember, presentationSteps, setPresentationStep, presentationTasks } from './presentation.js';

export function createPresentationUI(ctx){
  const {h,icon,avatar,persist}=ctx,$=s=>document.querySelector(s),S=()=>ctx.getState(),P=()=>S().presentation;
  let lastCamera='',lastOffice=null,lastRender='',reentrant=false,coachObserver=null,observedRoot=null;
  const active=()=>Boolean(P()?.active);
  const member=id=>S().members.find(m=>m.id===id);
  function objectInfo(id){
    if(id==='requester')return {title:'Você é quem dá o objetivo.',text:'Este personagem representa o usuário. Você conversa para completar o briefing e aprova o plano; o envio do pedido não cria uma tarefa de execução para você.',targets:['requester'],person:{id:'requester',name:'Você',role:'Solicitante',type:'human',color:'#b88b64',connectors:[],skills:[]}};
    if(id==='director')return {title:'O diretor organiza o trabalho.',text:'Ele recebe o briefing já conferido na entrevista, consulta as regras da empresa e prepara o plano. Só depois da sua aprovação distribui as tarefas. Ele mesmo valida as entregas: aprova o que atende aos critérios e devolve o que precisa de ajuste. Você só participa de uma entrega se isso for configurado ou faltar uma definição.',targets:['director'],person:directorProfile};
    if(id==='brain')return {title:'O cérebro é a memória da empresa.',text:'A base reúne as regras da organização e as pastas TSK. Cada tarefa guarda seu histórico completo; o resultado aprovado entra automaticamente no conhecimento da TSK para o diretor consultar depois.',targets:['brain']};
    const m=member(id);return m?{title:`${m.name} · ${m.role}`,text:explainMember(m),targets:[m.id],person:m}:{title:'Um time configurável.',text:'Você pode adicionar pessoas e agentes com as funções, ferramentas e habilidades de que o Marketing precisar.',targets:['office']};
  }
  function info(){
    const p=P(),j=S().officeJourney,{human,parent,dependent}=presentationTasks(S());
    if(p.inspectId)return {...objectInfo(p.inspectId),label:'EXPLORANDO UM OBJETO',button:'Voltar ao roteiro'};
    if(p.step.startsWith('member:'))return {...objectInfo(p.step.slice(7)),button:'Próximo integrante'};
    if(['requester','director','brain'].includes(p.step))return {...objectInfo(p.step),button:p.step==='requester'?'Conhecer o diretor':p.step==='director'?'Conhecer o cérebro':'Conhecer o time'};
    const consultation=parent?.s.review?.status==='awaiting_user';
    const notes={
      overview:{title:'Conheça o escritório, de perto.',text:'Vamos conhecer o time, entrevistar o usuário, conferir o briefing e acompanhar o diretor planejar, distribuir e revisar as entregas. Os campos já estarão preenchidos; você conduz a apresentação pelos botões.',targets:['office'],button:'Começar pelo usuário'},
      compose:{title:'Antes da tarefa, uma conversa.',text:'O usuário conta o que precisa. A entrevista aproveita as informações já dadas e pergunta apenas o que falta. As respostas do exemplo já estarão escritas para você avançar pelos botões.',targets:['requester'],button:'Começar entrevista'},
      interview:{title:'A entrevista completa o que falta.',text:'Público, prazo, oferta e materiais são combinados antes de planejar. O que já foi informado não é perguntado de novo. O diretor ainda não recebeu a tarefa.',targets:['requester'],button:'Continuar entrevista'},
      briefing:{title:'Da conversa para um briefing claro.',text:'Confira o resumo das respostas e as regras já disponíveis no cérebro. Os critérios de revisão vêm desse briefing. Só depois da sua confirmação ele segue para o diretor.',targets:['requester'],button:'Conferir briefing'},
      sending:{title:'O pedido está a caminho do diretor.',text:'Acompanhe o briefing confirmado saindo do usuário. O diretor recebe as respostas da entrevista e as regras da empresa antes de planejar a distribuição.',targets:['requester','director'],button:'Enviando pedido…',disabled:true},
      received:{title:'O diretor recebeu o briefing completo.',text:'As respostas da entrevista e os critérios estão no contexto do pedido. Nenhum agente recebeu uma tarefa deste pedido ainda: primeiro o diretor precisa consultar o contexto e planejar.',targets:['director'],button:'Consultar o cérebro'},
      consulting:{title:'As regras da empresa entram no plano.',text:'O diretor consulta as regras da organização e procura resultados aprovados em pastas TSK relacionadas ao pedido. O trajeto mostra essa troca de informações.',targets:['director','brain'],button:'Preparar o plano'},
      planning:{title:'O diretor organiza quem faz o quê.',text:'Agora ele separa as entregas, escolhe responsáveis e conecta as etapas que dependem de resultados anteriores. Esta é uma simulação visual do planejamento.',targets:['director'],button:'Apresentar o plano'},
      plan:{title:'Você confere antes de distribuir.',text:'O plano parte do briefing já confirmado e mostra as entregas, os responsáveis e as dependências. Abra a proposta e confirme Aprovar e distribuir quando quiser continuar.',targets:['requester','director'],button:'Ver plano para aprovar'},
      working:{title:'O time trabalha com uma direção comum.',text:'Verde indica trabalho em execução neste pedido. Outras etapas aguardam uma entrega aprovada. Pessoas recebem suas tarefas e confirmam quando começam.',targets:['office'],button:human?'Ver uma tarefa humana':'Ver as dependências'},
      human:{title:human?`${human.m.name} também recebe uma tarefa.`:'Pessoas e agentes seguem a mesma revisão.',text:human?'A pessoa recebe o briefing do diretor, mas confirma o início do próprio trabalho. Abra a tarefa e clique em Começar tarefa.':'Você pode configurar pessoas no time. Nesta campanha não há uma tarefa humana pronta para iniciar.',targets:[human?.m.id||'director'],button:human?'Abrir tarefa da pessoa':'Continuar'},
      dependency:{title:dependent?`${dependent.m.name} precisa esperar ${parent.m.name}.`:'As dependências definem a ordem.',text:dependent?`“${dependent.s.title.split(' · ')[0]}” aguarda a entrega de ${parent.m.name}. Uma conversa ajuda, mas a etapa só é liberada depois da aprovação do diretor, sem exigir um clique do usuário em cada entrega.`:'As etapas independentes podem avançar em paralelo. Quando uma tarefa precisa de outra, o motivo da espera fica visível.',targets:dependent?[parent.m.id,dependent.m.id]:['director'],button:'Preparar uma entrega'},
      delivery:{title:parent?`${parent.m.name} preparou o material.`:'Uma entrega volta ao diretor.',text:'A entrega de exemplo já está escrita. Abra o formulário e envie o material para revisão. Preparar a entrega ainda não libera seu uso pela próxima etapa.',targets:[parent?.m.id||'director'],button:'Ver entrega preenchida'},
      review:{title:consultation?'O diretor precisa de uma definição.':'O diretor está revisando sozinho.',text:consultation?parent.s.review.evaluation.feedback:'Ele compara a entrega com o briefing e os critérios definidos por você. Nesta demonstração há uma cor fora da paleta: o diretor vai devolver a tarefa ao responsável, sem pedir sua aprovação.',targets:[parent?.m.id||'director','director'],button:parent?.s.review?.status==='awaiting_user'?'Responder à consulta do diretor':'Diretor conferindo…',disabled:parent?.s.review?.status!=='awaiting_user'},
      changes:{title:`${parent?.m.name||'O responsável'} recebeu o pedido de correção.`,text:parent?.s.review?.feedback||'O diretor encontrou uma divergência e explicou o que precisa mudar. A dependência continua bloqueada. O ajuste volta ao responsável, sem aprovação humana.',targets:['director',parent?.m.id||'director'],button:'Ver como o agente corrige',color:'#c19269'},
      redelivery:{title:'O agente refaz seguindo a orientação.',text:'O diretor pediu a troca da cor. A entrega corrigida já usa a paleta oficial. Você só conduz a apresentação: abra e envie o exemplo para o diretor conferir de novo.',targets:[parent?.m.id||'director'],button:'Abrir correção preenchida'},
      rechecking:{title:consultation?'O diretor solicitou sua confirmação.':'O diretor confere a entrega corrigida.',text:consultation?parent.s.review.evaluation.feedback:'O material voltou ao diretor. Se atender aos critérios, ele aprova, registra o parecer e libera a próxima etapa automaticamente. Nenhum botão de aprovação humana é necessário.',targets:[parent?.m.id||'director','director'],button:parent?.s.review?.status==='awaiting_user'?'Responder à consulta do diretor':'Conferindo a correção…',disabled:parent?.s.review?.status!=='awaiting_user'},
      released:{title:dependent?`Agora ${dependent.m.name} pode começar.`:'O resultado foi aprovado e liberado.',text:dependent?`O diretor aprovou a entrega corrigida de ${parent.m.name} e liberou automaticamente a tarefa de ${dependent.m.name}. O resultado aprovado e seu contexto acompanham a próxima etapa.`:'O material aprovado fica disponível para quem precisa dele. O histórico conserva o parecer e a origem da entrega.',targets:dependent?[parent.m.id,dependent.m.id]:[parent?.m.id||'director'],button:'Ver resultado na TSK',color:'#86ae5c'},
      memory:{title:'Aprovou? O resultado já está na TSK.',text:'A pasta da tarefa reúne briefing, entrevista, plano, textos, dados, anotações e revisões. O resultado aprovado ficou disponível automaticamente na base, com sua origem. O diretor pode abrir essa TSK quando precisar consultar o trabalho.',targets:['brain'],button:p.tskViewed?'Concluir apresentação':'Abrir pasta TSK'},
      finish:{title:'Do briefing ao conhecimento, com origem.',text:'Você acompanhou a entrevista, o planejamento, o trabalho do time e a revisão. O resultado aprovado entrou automaticamente no conhecimento da pasta TSK, junto do histórico da tarefa. Seus pedidos originais foram preservados.',targets:['office'],button:'Encerrar apresentação'},
    };
    if(p.step==='distribution'){
      const delivered=j?.deliveries?.[j.delivered-1],next=j?.deliveries?.[j.delivered],recipient=p.animating?member(next?.memberId):member(delivered?.memberId);
      const received=delivered?S().members.flatMap(m=>m.sessions.map(s=>({m,s}))).find(x=>x.s.id===delivered.sessionId):null;
      return {title:p.animating?`O diretor está enviando para ${recipient?.name||'o time'}.`:`${recipient?.name||'O time'} recebeu sua tarefa.`,text:p.animating?'Observe o envelope e a câmera acompanhando o envio. O contexto do pedido vai junto.':received?`${received.s.title.split(' · ')[0]}. ${received.s.status==='blocked'?'Esta etapa aguarda outra entrega aprovada.':received.m.type==='human'?'A pessoa confirma quando começa a trabalhar.':'Este agente já pode trabalhar na etapa liberada.'} ${j.delivered} de ${j.deliveries.length} recebimentos registrados.`:'Cada tarefa segue para o responsável escolhido no plano.',targets:p.animating?['director',recipient?.id||'director']:[recipient?.id||'director'],person:recipient,button:p.animating?'Enviando tarefa…':next?`Enviar para ${member(next.memberId)?.name||'o próximo responsável'}`:'Ver equipe trabalhando',disabled:p.animating};
    }
    return notes[p.step]||notes.overview;
  }
  function personDetails(m){if(!m)return '';return `<aside class="presentation-profile"><div class="presentation-person">${avatar(m)}<span><strong>${h(m.name)}</strong><small>${m.type==='human'?'Pessoa':'Agente de IA'} · ${h(m.role)}</small></span></div>${m.connectors?.length?`<div class="presentation-tools"><span>Ferramentas</span>${m.connectors.map(id=>`<i>${h(catalog.connectors[id]?.name||id)}</i>`).join('')}</div>`:''}${m.skills?.length?`<p class="presentation-skills"><strong>Habilidades:</strong> ${h(m.skills.join(' · '))}</p>`:''}</aside>`;}
  function decorateSnapshot(s){if(!active()||!s)return s;const p=P(),j=S().officeJourney;if(p.step==='distribution'){const last=j.deliveries[j.delivered-1];return {...s,guideDuration:1600,guideHolding:!p.animating,focusMember:p.animating?j.deliveries[j.delivered]?.memberId:last?.memberId};}return s;}
  function render(force=false){
    document.body.classList.toggle('presentation-mode',active());
    if(!active()){coachObserver?.disconnect();observedRoot=null;document.documentElement.style.removeProperty('--presentation-coach-height');return;}
    const p=P(),deck=presentationSteps(S()),n=deck.indexOf(p.step),data=info();
    const root=$('#office-presentation');if(!root||ctx.currentView()!=='office')return;
    const review=presentationTasks(S()).parent?.s.review;const key=`${p.step}:${p.inspectId||''}:${p.animating}:${S().officeJourney?.delivered||0}:${review?.status||''}`;
    if(force||key!==lastRender){
      if(lastRender&&key!==lastRender)window.speechSynthesis?.cancel();
      const hadFocus=root.contains(document.activeElement),action=hadFocus?document.activeElement.closest('[data-action]')?.dataset.action:null;
      lastRender=key;root.hidden=false;root.innerHTML=`<section class="presentation-coach" aria-label="Apresentação guiada"><div class="presentation-coach-top"><span>${icon('play')}APRESENTAÇÃO GUIADA <i>ETAPA ${n+1} DE ${deck.length}</i></span><div>${typeof window.speechSynthesis!=='undefined'?'<button class="text-link" data-action="presentation-speak" aria-label="Ouvir explicação">Ouvir</button>':''}<button class="text-link" data-action="presentation-exit">Sair</button></div></div><div class="presentation-coach-body ${data.person?'has-profile':''}"><div><p class="presentation-focus-label">${data.label||'EM FOCO NO ESCRITÓRIO'}</p><h2>${h(data.title)}</h2><p class="presentation-explanation" role="status" aria-live="polite">${h(data.text)}</p></div>${personDetails(data.person)}</div>${['changes','released'].includes(p.step)?`<div class="presentation-director-verdict ${p.step==='changes'?'changes':'approved'}">${icon(p.step==='changes'?'rotate':'check')}<span><strong>${p.step==='changes'?'Diretor → responsável · corrigir':'Diretor → equipe · aprovado'}</strong> ${p.step==='changes'?'Próxima etapa continua bloqueada':'Resultado liberado para continuar'}</span><button class="text-link" data-action="presentation-review-report">Ver parecer</button></div>`:''}<div class="presentation-coach-actions"><span>Exemplos preenchidos · seus pedidos são preservados</span><div>${n>0&&n<=deck.indexOf('compose')&&!p.inspectId?'<button class="button secondary" data-action="presentation-back">'+icon('back')+'Voltar</button>':''}${p.step==='memory'&&p.tskViewed?'<button class="button secondary" data-action="presentation-tsk-folder">Reabrir pasta TSK</button>':''}${p.step==='finish'?'<button class="button secondary" data-action="presentation-restart">Recomeçar</button>':''}<button class="button primary" data-action="presentation-next" ${data.disabled?'disabled':''}>${h(data.button)}${icon('arrow')}</button></div></div><div class="presentation-progress"><span style="width:${(n+1)/deck.length*100}%"></span></div></section>`;
      if(action)(root.querySelector(`[data-action="${action}"]`)||root.querySelector('[data-action="presentation-next"]'))?.focus({preventScroll:true});
    }
    if(root!==observedRoot){coachObserver?.disconnect();observedRoot=root;coachObserver=new ResizeObserver(()=>document.documentElement.style.setProperty('--presentation-coach-height',root.getBoundingClientRect().height+'px'));coachObserver.observe(root);}
    document.documentElement.style.setProperty('--presentation-coach-height',root.getBoundingClientRect().height+'px');
    const office=ctx.getOffice(),cameraKey=`${p.step}:${(data.targets||[]).join(',')}:${p.animating}:${p.inspectId||''}`;
    if(office&&data.targets.some(id=>member(id)&&!office.nodePoint(id))){ctx.showOffice();return;}
    if(office&&(force||cameraKey!==lastCamera||office!==lastOffice)){lastCamera=cameraKey;lastOffice=office;office.focusOn(data.targets,{color:data.color});}
  }
  function show(step){setPresentationStep(S(),step);P().inspectId=null;persist();ctx.journey().refresh();if(ctx.currentView()!=='office')ctx.showOffice();render(true);}
  function proceed(){
    const p=P(),j=S().officeJourney;if(p.inspectId){p.inspectId=null;persist();render(true);return;}
    const deck=presentationSteps(S()),at=deck.indexOf(p.step),{human,parent}=presentationTasks(S());
    if(['compose','interview','briefing'].includes(p.step)){ctx.direction().newBrief();return;}
    if(p.step==='received'){advanceJourney(S(),Date.now(),true);show('consulting');return;}
    if(p.step==='consulting'){advanceJourney(S(),Date.now(),true);show('planning');return;}
    if(p.step==='planning'){advanceJourney(S(),Date.now(),true);p.campaignId=j.campaignId;show('plan');return;}
    if(p.step==='plan'){ctx.journey().reviewPlan();return;}
    if(p.step==='distribution'){
      if(p.animating)return;if(j.delivered>=j.deliveries.length){show('working');return;}
      p.animating=true;j.enteredAt=Date.now();j.pausedAt=null;persist();ctx.journey().refresh();render(true);return;
    }
    if(p.step==='working'){show(human?'human':'dependency');return;}
    if(p.step==='human'){if(human?.s.status==='assigned')ctx.journey().tasks();else show('dependency');return;}
    if(['delivery','redelivery'].includes(p.step)){if(parent)ctx.direction().deliveryForm(parent.s.id);return;}
    if(['review','rechecking'].includes(p.step)){if(parent?.s.review?.status==='awaiting_user')ctx.direction().reviewForm(parent.s.id);return;}
    if(p.step==='memory'){if(p.tskViewed){show('finish');return;}if(parent){p.tskViewed=true;persist();render(true);ctx.direction().openTaskFolder(parent.s.id);}return;}
    if(p.step==='finish'){exit();return;}
    show(deck[at+1]||'finish');
  }
  function onIntakeStage(stage){if(!active())return;setPresentationStep(S(),stage);P().inspectId=null;persist();render(true);}
  function onBriefSent(){if(!active())return;const p=P();setPresentationStep(S(),'sending');p.journeyId=S().officeJourney.id;p.animating=true;}
  function onDistributed(){if(!active())return;const p=P();p.campaignId=S().officeJourney.campaignId;setPresentationStep(S(),'distribution');p.animating=true;}
  function tick(){
    if(!active())return;const p=P(),j=S().officeJourney;
    if(p.animating&&j){const duration=p.step==='sending'?1500:1600;if(Date.now()-j.enteredAt>=duration){advanceJourney(S(),Date.now(),true);p.animating=false;if(p.step==='sending')setPresentationStep(S(),'received');persist();ctx.journey().refresh();render(true);}}
    onStateChange();
  }
  function onStateChange(){
    if(!active()||reentrant)return;const p=P(),{human,parent}=presentationTasks(S());let next=null;
    if(p.step==='human'&&human?.s.status==='working')next='dependency';
    if(['delivery','redelivery'].includes(p.step)&&parent?.s.status==='review')next=p.step==='redelivery'?'rechecking':'review';
    if(['review','rechecking'].includes(p.step)&&parent?.s.status==='review'&&parent.s.review?.engine!=='director-preview-v1'){scheduleTaskReview(S(),parent.s);persist();}
    if(['review','rechecking'].includes(p.step)&&parent?.s.status==='done')next='released';
    if(['review','rechecking'].includes(p.step)&&parent?.s.status==='changes')next='changes';
    if(next){reentrant=true;setPresentationStep(S(),next);persist();ctx.showOffice();ctx.revealOffice();reentrant=false;}
    render();
  }
  function afterView(){lastRender='';lastOffice=null;onStateChange();render(true);}
  function onModal(dialog){
    if(!active())return;
    const form=dialog.querySelector('form'),p=P(),{parent,human}=presentationTasks(S());
    if(dialog.classList.contains('tsk-folder-modal'))return;
    if(form?.id?.startsWith('intake-')){dialog.querySelector('button.primary[type="submit"]')?.classList.add('presentation-recommended');return;}
    if(form?.id==='delivery-form'&&p.step==='changes'){setPresentationStep(S(),'redelivery');persist();render(true);}
    if(form?.id==='delivery-form'){form.elements.delivery.value=exampleDelivery(S(),{needsCorrection:p.step==='delivery'});form.elements.reviewScenario.value=p.step==='delivery'?'changes':'pass';}

    if(p.step==='human'&&human)dialog.querySelectorAll('.journey-assignment-list>article').forEach(article=>{article.hidden=!article.querySelector(`[data-id="${human.s.id}"]`);});
    const tip=document.createElement('div');tip.className='presentation-dialog-guide';tip.innerHTML=`<span>${icon('play')}APRESENTAÇÃO · ${presentationSteps(S()).indexOf(p.step)+1}/${presentationSteps(S()).length}</span><strong>${form?.id==='review-form'?'O diretor solicitou sua decisão.':dialog.querySelector('[data-director-review-task]')?'O diretor registrou o parecer. Você pode conferir os motivos.':form?'Os campos de exemplo já estão preenchidos.':'Confira a proposta para continuar.'}</strong><p>${form?.id==='review-form'?'Esta consulta humana só aparece quando foi solicitada ou falta uma definição.':form?'Você pode conferir ou editar. Para seguir o roteiro, basta clicar no botão destacado.':'Você aprova o plano. A revisão das entregas é feita pelo diretor, conforme a configuração.'}</p>`;
    const description=dialog.querySelector('.modal-description');if(description)description.after(tip);else dialog.querySelector('h2')?.after(tip);
    dialog.querySelectorAll('input:not([type="checkbox"]),textarea').forEach(el=>{if(el.value)el.classList.add('presentation-prefilled');});
    const recommended=dialog.querySelector('[data-action="journey-approve"]')||dialog.querySelector('[data-action="journey-start-human"]')||dialog.querySelector('button.primary[type="submit"]');recommended?.classList.add('presentation-recommended');
    if(form)form.querySelector('.journey-example-link')?.setAttribute('hidden','');
  }
  function start(){ctx.enter();lastRender='';lastCamera='';ctx.showOffice();ctx.revealOffice();render(true);}
  function exit(){window.speechSynthesis?.cancel();ctx.getOffice()?.clearFocus();ctx.leave();document.body.classList.remove('presentation-mode');lastCamera='';lastRender='';ctx.showOffice();}
  function onObjectClick(id){if(!active())return false;P().inspectId=id;persist();render(true);return true;}
  function arrangeMembers(members){if(!active())return members;const target=info().targets?.find(id=>member(id)),index=members.findIndex(m=>m.id===target);if(index<20)return members;const result=[...members],chosen=result.splice(index,1)[0];result.splice(result[0]?.isDirector?1:0,0,chosen);return result;}
  function handleAction(action){
    if(action==='presentation-start'){start();return true;}
    if(!active())return false;
    if(action==='presentation-next')proceed();
    else if(action==='presentation-back'){const deck=presentationSteps(S()),index=deck.indexOf(P().step);if(index>0)show(deck[index-1]);}
    else if(action==='presentation-tsk-folder'){const {parent}=presentationTasks(S());if(parent)ctx.direction().openTaskFolder(parent.s.id);}
    else if(action==='presentation-review-report'){const {parent}=presentationTasks(S());if(parent)ctx.direction().reviewForm(parent.s.id);}
    else if(action==='presentation-exit')exit();
    else if(action==='presentation-restart'){ctx.leave();start();}
    else if(action==='presentation-speak'){try{const data=info(),speech=new SpeechSynthesisUtterance(data.title+' '+data.text);speech.lang='pt-BR';const voice=window.speechSynthesis.getVoices().find(v=>v.lang.toLowerCase()==='pt-br');if(voice)speech.voice=voice;window.speechSynthesis.cancel();window.speechSynthesis.speak(speech);}catch{ctx.toast('A explicação escrita continua disponível nesta tela.');}}
    else return false;return true;
  }
  return {active,handleAction,afterView,onModal,onStateChange,onIntakeStage,onBriefSent,onDistributed,tick,decorateSnapshot,onObjectClick,arrangeMembers};
}
