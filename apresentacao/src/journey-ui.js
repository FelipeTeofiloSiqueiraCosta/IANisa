import { briefingReviewSummary, readReviewPolicy } from './review-ui.js';
import { beginJourney, advanceJourney, approveJourney, pauseJourney, journeySnapshot, journeyBusy, stageCopy } from './journey.js';
import { findTask, readyToRun } from './coordination.js';
import { statusLabels } from './state.js';

export function createJourneyUI(ctx){
  const {h,icon,avatar,modal,closeModal,toast,persist,go}=ctx;
  const S=()=>ctx.getState(),J=()=>S().officeJourney,$=s=>document.querySelector(s);
  let lastKey='';
  const campaign=()=>S().campaigns.find(c=>c.id===J()?.campaignId);
  function focusControls(){document.querySelector('#office-journey .journey-current-actions button')?.focus({preventScroll:true});}
  function begin(input){try{beginJourney(S(),input);ctx.onBriefSent?.();persist();closeModal();ctx.showOffice();ctx.revealOffice();focusControls();return true;}catch(err){error(err);return false;}}
  function distribute(id){try{approveJourney(S(),id);ctx.onPlanDistributed?.();persist();closeModal();ctx.showOffice();ctx.revealOffice();focusControls();}catch(err){error(err);}}
  function error(err){const root=$('#modal-root dialog form')||$('#modal-root dialog');if(root){let el=root.querySelector('.journey-form-error');if(!el){el=document.createElement('p');el.className='journey-form-error';el.setAttribute('role','alert');root.append(el);}el.textContent=err.message;el.scrollIntoView({block:'nearest'});}else toast(err.message);}
  function phaseDescription(s){
    if(s.phase==='distributing'){const next=s.tasks[s.delivered];return next?`Enviando para ${next.name} · ${s.delivered} de ${s.total} tarefas recebidas.`:'Concluindo a distribuição.';}
    if(s.phase==='running'){const working=s.tasks.filter(t=>t.status==='working').length,waiting=s.tasks.filter(t=>t.status==='blocked').length,people=s.tasks.filter(t=>t.status==='assigned').length;return s.completed?'Todas as entregas deste pedido foram aprovadas pelo diretor.':`${working} em execução · ${waiting} aguardando dependências · ${people} ${people===1?'tarefa recebida':'tarefas recebidas'} por pessoas para iniciar.`;}
    return stageCopy[s.phase]?.[1]||'O pedido está salvo. Abra a direção para continuar.';
  }
  function summaryMarkup(){const s=journeySnapshot(S());if(!s)return '';
    if(J().minimized)return `<section class="journey-minimized" aria-label="Acompanhamento recolhido">${icon('check')}<span><small>Acompanhamento salvo</small><strong>${h(s.title)}</strong></span><button class="text-link" data-action="journey-expand">Ver acompanhamento ${icon('arrow')}</button></section>`;
    const stage=s.phase==='sending'?0:['received','consulting'].includes(s.phase)?1:s.phase==='planning'?2:s.phase==='awaiting_approval'?3:4;
    return `<section class="journey-status-panel" aria-label="Acompanhamento do novo pedido"><div class="journey-current"><span class="journey-stage-icon ${journeyBusy(J())&&!J().pausedAt?'is-active':''}">${icon(s.phase==='awaiting_approval'?'check':s.phase==='running'?'team':s.phase==='consulting'?'brain':'send')}</span><div><p class="journey-status-copy" role="status" aria-live="polite">${h(s.completed?'Tudo aprovado':stageCopy[s.phase]?.[0]||'Pedido salvo')}${J().pausedAt?' · pausa':''}</p><strong>${h(s.title)}</strong><span>${h(phaseDescription(s))}</span></div><div class="journey-current-actions">${s.phase==='awaiting_approval'?'<button class="button primary" data-action="journey-review">Ver e aprovar plano '+icon('arrow')+'</button>':s.phase==='running'?'<button class="button secondary" data-action="journey-tasks">Ver tarefas '+icon('arrow')+'</button><button class="icon-button" data-action="journey-minimize" aria-label="Recolher acompanhamento">'+icon('minus')+'</button>':''}${journeyBusy(J())?`<button class="icon-button" data-action="journey-pause" aria-label="${J().pausedAt?'Continuar apresentação':'Pausar apresentação'}">${icon(J().pausedAt?'play':'pause')}</button><button class="text-link" data-action="journey-next">Avançar ${icon('arrow')}</button>`:''}</div></div><ol class="journey-steps" aria-label="Etapas do pedido">${[J().intake?'Briefing confirmado':'Seu pedido','Diretor recebe','Prepara o plano','Você aprova','Time recebe e trabalha'].map((label,i)=>`<li class="${i<stage?'passed':i===stage?'current':''}"><span>${i<stage?icon('check'):i+1}</span>${label}</li>`).join('')}</ol><details class="journey-history"><summary>Histórico do pedido <span>${J().history.length} ${J().history.length===1?'evento':'eventos'}</span></summary><ol>${J().history.map(e=>`<li><time>${new Date(e.at).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}</time>${h(e.text)}</li>`).join('')}</ol></details></section>`;
  }
  function update(force=false){
    if(ctx.currentView()!=='office')return;
    const raw=journeySnapshot(S()),s=ctx.decorateSnapshot?ctx.decorateSnapshot(raw):raw,key=s?`${s.id}:${s.phase}:${s.delivered}:${s.pausedAt}:${J()?.minimized}:${s.guideHolding}:${s.focusMember}:${s.tasks.map(t=>t.status).join(',')}`:'idle';
    const root=$('#office-journey');if(!root)return;
    if(force||key!==lastKey){
      const focusAction=root.contains(document.activeElement)?document.activeElement.closest('[data-action]')?.dataset.action:null,historyOpen=Boolean(root.querySelector('details')?.open);
      lastKey=key;root.innerHTML=summaryMarkup();root.hidden=!s;if(historyOpen&&root.querySelector('details'))root.querySelector('details').open=true;ctx.getOffice()?.setJourney(J()?.minimized?null:s);
      if(focusAction)(root.querySelector(`[data-action="${focusAction}"]`)||root.querySelector('.journey-current-actions button')||root.querySelector('[data-action="journey-expand"]'))?.focus({preventScroll:true});
      const legend=document.querySelector('.scene-legend');if(legend)legend.innerHTML=s&&!J()?.minimized&&['distributing','running'].includes(s.phase)?'<span><i class="green-dot"></i>Neste pedido: em execução</span><span><i class="amber-dot"></i>Aguarda etapa</span><span><i class="gray-dot"></i>Recebida</span>':'<span><i class="green-dot"></i>Trabalhando</span><span><i class="amber-dot"></i>Precisa de você</span><span><i class="gray-dot"></i>Disponível</span>';
    }
  }
  function mount(){lastKey='';update(true);}
  function reviewPlan(){const c=campaign();if(!c){toast('O diretor ainda está preparando o plano.');return;}if(c.status!=='awaiting_approval'){tasks();return;}
    const stale=c.plan.brainRevision!==S().brain.revision;
    modal(`<span class="modal-kicker">${icon('check')}PLANO DO DIRETOR · SUA APROVAÇÃO</span><h2>${h(c.title)}</h2><p class="modal-description">${h(c.plan.approach)}</p><div class="journey-plan-context">${icon('brain')}Regras do cérebro · versão ${c.plan.brainRevision}<span>${c.plan.tasks.length} entregas · nenhuma distribuída ainda</span></div><form id="journey-policy-form">${briefingReviewSummary(h,c.plan.reviewPolicy)}</form><div class="journey-plan-tasks">${c.plan.tasks.map((t,i)=>{const m=S().members.find(m=>m.id===t.memberId),dep=c.plan.tasks.find(x=>x.id===t.dependsOn);return `<article><span class="journey-task-number">${i+1}</span><div><strong>${h(t.title)}</strong><p>${h(t.brief)}</p><span class="journey-plan-owner">${m?avatar(m):''}${h(m?.name||'Responsável a definir')} · ${m?.type==='human'?'Pessoa':'IA'}</span><small>${dep?'Aguarda aprovação de: '+h(dep.title):'Pode começar sem depender de outra entrega'}</small></div></article>`;}).join('')}</div>${stale?'<p class="journey-form-error" role="alert">O cérebro mudou desde este plano. Atualize antes de aprovar.</p>':''}<div class="journey-approval-note">${icon('link')}Ao aprovar, você verá o diretor enviar as tarefas. Dependências e revisão continuam valendo para pessoas e agentes.</div><div class="form-bottom"><button class="button secondary" data-action="journey-adjust">${icon('settings')}${stale?'Atualizar plano':'Ajustar plano'}</button><button class="button primary" data-action="journey-approve" ${stale?'disabled':''}>${icon('check')}Aprovar e distribuir</button></div><p class="form-note">Fluxo de demonstração: tarefas e sessões ficam salvas neste navegador. Nenhuma IA ou ferramenta real é acionada.</p>`,'journey-plan-modal');
    $('#journey-policy-form')?.addEventListener('submit',e=>e.preventDefault());
    $('#journey-policy-form')?.addEventListener('change',()=>{c.plan.reviewPolicy=readReviewPolicy(new FormData($('#journey-policy-form')));persist();});
  }
  function tasks(){const s=journeySnapshot(S());if(!s)return;modal(`<span class="modal-kicker">${icon('team')}PEDIDO DISTRIBUÍDO</span><h2>O trabalho chegou ao time.</h2><p class="modal-description">${h(s.title)}. Abra uma tarefa para acompanhar a conversa, os arquivos e a revisão.</p><div class="journey-assignment-list">${s.tasks.map(t=>{const m=S().members.find(m=>m.id===t.memberId);return `<article>${m?avatar(m):''}<div><strong>${h(t.name)}</strong><p>${h(t.title)}</p><span class="status-badge ${h(t.status)}"><i></i>${h(statusLabels[t.status])}</span><small>${h(t.step)}</small><div class="journey-assignment-actions">${t.status==='assigned'?`<button class="button primary" data-action="journey-start-human" data-id="${h(t.sessionId)}">${icon('play')}Começar tarefa</button>`:''}<button class="text-link" data-action="journey-open-session" data-id="${h(t.sessionId)}">Abrir conversa ${icon('arrow')}</button></div></div></article>`;}).join('')}</div><button class="button secondary full" data-action="close-modal">Voltar ao escritório</button>`,'journey-plan-modal');}
  function handleAction(a,b){
    if(a==='journey-review')reviewPlan();
    else if(a==='journey-approve')distribute(J()?.campaignId);
    else if(a==='journey-next'){try{advanceJourney(S(),Date.now(),true);persist();update(true);}catch(err){error(err);}}
    else if(a==='journey-pause'){pauseJourney(S());persist();update(true);}
    else if(a==='journey-tasks')tasks();
    else if(a==='journey-minimize'){J().minimized=true;persist();update(true);}
    else if(a==='journey-expand'){J().minimized=false;persist();update(true);}
    else if(a==='journey-adjust'){const c=campaign();if(!c)return true;closeModal();ctx.openPlan(c.id);}
    else if(a==='journey-example'){const f=$('#director-brief-form');if(f){f.elements.title.value='Campanha de Black Friday';f.elements.brief.value='Criar uma campanha de Black Friday para a coleção: Instagram, vídeos curtos, página e anúncios. Seguir as cores e o tom da empresa. O diretor deve organizar as entregas e revisar o material antes da publicação.';f.elements.brief.focus();}}
    else if(a==='journey-open-session'){const x=findTask(S(),b.dataset.id);if(x){closeModal();ctx.sessionsFor(x.m.id,x.s.id);}}
    else if(a==='journey-start-human'){const x=findTask(S(),b.dataset.id);if(x?.m.type==='human'&&x.s.status==='assigned'&&readyToRun(S(),x.s)){x.s.status='working';x.s.step='A pessoa responsável iniciou esta tarefa.';x.s.messages.push({id:`human-start-${Date.now()}`,role:'director',text:'O início desta tarefa foi confirmado pela pessoa responsável.',time:new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})});persist();closeModal();ctx.showOffice();ctx.revealOffice();toast(`${x.m.name} começou a tarefa.`);}}
    else return false;return true;
  }
  setInterval(()=>{try{if(ctx.guidedActive?.()){ctx.guidedTick?.();update();return;}const changed=advanceJourney(S());if(changed)persist();update(changed);}catch(err){if(J()){J().phase='error';J().error=err.message;persist();update(true);}toast(err.message);}},250);
  return {begin,distribute,mount,refresh:()=>update(true),handleAction,snapshot:()=>journeySnapshot(S()),reviewPlan,tasks};
}
