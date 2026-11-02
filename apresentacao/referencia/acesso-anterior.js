import { api, h, initials, signOut, watchSession } from './api-client.js';

const $ = s => document.querySelector(s);
const root = $('#access-root');
const symbols = {
  arrow:'<path d="M5 12h14m-5-5 5 5-5 5"/>', check:'<path d="m5 12 4 4L19 6"/>',
  team:'<circle cx="9" cy="8" r="3"/><path d="M3 21v-2a6 6 0 0 1 12 0v2m1-16a3 3 0 0 1 0 6m2 4a5 5 0 0 1 3 4v2"/>',
  mail:'<rect x="3" y="5" width="18" height="14" rx="3"/><path d="m3 7 9 6 9-6"/>',
  shield:'<path d="M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6l-8-3Z"/><path d="m8 12 3 3 5-5"/>',
  plus:'<path d="M12 5v14M5 12h14"/>', close:'<path d="m6 6 12 12M18 6 6 18"/>',
  eye:'<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  office:'<rect x="3" y="8" width="18" height="13" rx="2"/><path d="M7 8V4h10v4M3 13h18M10 13v8M14 13v8"/>',
  user:'<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  logout:'<path d="M9 4H4v16h5m6-13 5 5-5 5M8 12h12"/>',
  link:'<path d="m10 13 4-4m-6 7-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m2 0 1-1a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0"/>',
  clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', search:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>'
};
const icon = name => `<svg class="a-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${symbols[name]||symbols.check}</svg>`;
const brand = () => '<a href="/" class="a-brand" aria-label="IANiza, início"><span>✳</span>ianiza<b>.</b></a>';
const role = value => value==='admin'?'Administrador':'Membro';
const date = value => new Date(value).toLocaleString('pt-BR',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'});
const button = (text, attrs='', kind='primary') => `<button class="a-button ${kind}" ${attrs}>${text}</button>`;
const alert = () => '<p class="a-error" id="form-error" role="alert" tabindex="-1" hidden></p>';
function showError(form,e) { const el=form.querySelector('.a-error');if(el){el.textContent=e.message;el.hidden=false;el.focus();}else toast(e.message); }
function toast(text) { const el=$('#access-toast');el.textContent=text;el.hidden=false;clearTimeout(toast.timer);toast.timer=setTimeout(()=>el.hidden=true,4500); }
function passwordField(label='Senha',name='password',autocomplete='new-password') { return `<label class="a-field">${label}<span class="a-password"><input name="${name}" type="password" ${autocomplete==='new-password'?'minlength="12"':''} maxlength="200" autocomplete="${autocomplete}" required ${autocomplete==='new-password'?'aria-describedby="password-help"':''}><button type="button" data-password="${name}" aria-label="Mostrar ${label.toLowerCase()}" aria-pressed="false">${icon('eye')}</button></span></label>`; }
function bindPasswords(scope) { scope.querySelectorAll('[data-password]').forEach(b=>b.addEventListener('click',()=>{const input=scope.querySelector(`[name="${b.dataset.password}"]`);const visible=input.type==='password';input.type=visible?'text':'password';b.setAttribute('aria-pressed',String(visible));b.setAttribute('aria-label',(visible?'Ocultar':'Mostrar')+' senha');})); }
function bindForm(id, handler) {
  const form=$(id);bindPasswords(form);
  form.addEventListener('submit',async e=>{
    e.preventDefault();if(form.dataset.busy)return;
    const submit=form.querySelector('[type="submit"]'),text=submit.innerHTML;
    form.dataset.busy='true';submit.disabled=true;submit.innerHTML='Um instante…';form.setAttribute('aria-busy','true');
    const err=form.querySelector('.a-error');if(err)err.hidden=true;
    try { await handler(Object.fromEntries(new FormData(form)),form); }
    catch(error) { showError(form,error); }
    finally { delete form.dataset.busy;submit.disabled=false;submit.innerHTML=text;form.removeAttribute('aria-busy'); }
  });
}
function checkConfirmation(data) { if(data.password!==data.confirmPassword)throw new Error('As senhas precisam ser iguais. Confira e tente novamente.'); }

// Ilustração vetorial da colaboração; não depende de imagens ou de serviços externos.
function teamIllustration() { return `<div class="a-art" aria-hidden="true"><div class="a-orbit"></div><div class="a-art-board"><div class="a-art-toolbar"><i></i><i></i><i></i><span>ESTÚDIO MARKETING</span></div><div class="a-art-content"><div class="a-art-title"><span class="a-tiny-spark">✳</span><div><strong>Uma ideia. Muitas mãos.</strong><small>O seu time, conectado.</small></div></div><div class="a-art-flow"><span class="a-art-person human">${icon('user')}</span><i></i><span class="a-art-director">✳</span><i></i><span class="a-art-person">${icon('team')}</span></div><div class="a-art-tasks"><div><span class="a-art-dot"></span><span>Planejar a próxima campanha</span><b>Em equipe</b></div><div><span class="a-art-dot amber"></span><span>Dar vida a uma nova ideia</span><b>Em criação</b></div></div></div></div><div class="a-art-float">${icon('check')}Cada talento faz a diferença.</div></div>`; }
function authShell(content) {
  document.body.className='access-auth';
  root.innerHTML=`<div class="a-auth-layout"><aside class="a-story">${brand()}<div class="a-story-copy"><p class="a-eyebrow">GENTE E INTELIGÊNCIA. JUNTAS.</p><h1>Boas ideias começam com um <em>time.</em></h1><p>Um espaço para conectar pessoas, organizar ideias e criar o próximo passo.</p></div>${teamIllustration()}<div class="a-story-foot"><span class="a-small-star">✳</span>Um time. Muitas possibilidades.</div></aside><main id="access-main" class="a-auth-main"><div class="a-mobile-brand">${brand()}</div><div class="a-auth-card">${content}</div><footer class="a-auth-foot">${icon('shield')}Seu espaço de trabalho começa aqui.</footer></main></div>`;
}

async function login() {
  document.title='Entrar · IANiza';
  const status=await api('/api/auth/status');
  authShell(`<span class="a-kicker">BOM TER VOCÊ POR AQUI</span><h2>Entre no seu espaço<span>.</span></h2><p class="a-lead">Seu time e suas próximas ideias estão aqui.</p>${new URLSearchParams(location.search).get('session')==='expired'?'<div class="a-notice">Sua sessão terminou. Entre novamente para continuar.</div>':''}<form id="login-form">${alert()}<label class="a-field">E-mail<input type="email" name="email" autocomplete="username" placeholder="voce@empresa.com.br" maxlength="254" required></label>${passwordField('Senha','password','current-password')}<div class="a-form-options"><label class="a-checkbox"><input type="checkbox" name="remember">Manter conectado</label><a href="/recuperar">Esqueci minha senha</a></div>${button(`Entrar ${icon('arrow')}`,'type="submit"','primary full')}</form><div class="a-auth-bottom">${icon('mail')}<span>Ainda não tem acesso?<br><strong>Peça um convite ao administrador do seu time.</strong></span></div>${!status.initialized?'<div class="a-notice setup">Primeira vez nesta instalação? Abra o link de primeiro acesso exibido ao iniciar o servidor.</div>':''}`);
  bindForm('#login-form',async data=>{await api('/api/auth/login',{method:'POST',body:{email:data.email,password:data.password,remember:data.remember==='on'}});location.replace('/');});
}
function recovery() {
  authShell(`<span class="a-form-symbol">${icon('link')}</span><span class="a-kicker">RECUPERAR ACESSO</span><h2>Vamos te trazer de volta<span>.</span></h2><p class="a-lead">Peça ao administrador da sua equipe um link para criar uma nova senha.</p><div class="a-notice">O link é pessoal, vale por 1 hora e só pode ser usado uma vez. Ao trocar a senha, os acessos anteriores são encerrados.</div><p class="a-hint">Nesta etapa, o administrador compartilha o link diretamente com você. O envio automático por e-mail ainda não está configurado.</p><a class="a-button primary full" href="/login">Voltar para entrar ${icon('arrow')}</a>`);
}
async function linkPage(kind) {
  const raw=new URLSearchParams(location.hash.slice(1)).get('token') ?? '';
  // O fragmento não é enviado no HTTP. Mantém o link durante a definição da senha para permitir atualizar a página.
  let info;
  try { info=await api('/api/auth/link-info',{method:'POST',body:{token:raw,kind}}); }
  catch(e) { authShell(`<span class="a-form-symbol">${icon('clock')}</span><span class="a-kicker">ACESSO POR LINK</span><h2>Esse link não está disponível<span>.</span></h2><p class="a-lead">${h(e.message)}</p><a class="a-button primary full" href="/login">Ir para o login ${icon('arrow')}</a>`);return; }
  const setup=kind==='setup',invite=kind==='invite';
  let current=null;try{current=await api('/api/auth/me');}catch{}
  if(current && (!setup && current.user.email!==info.email)) {
    authShell(`<span class="a-kicker">UMA CONTA POR VEZ</span><h2>Você já está conectado<span>.</span></h2><p class="a-lead">Este link é para <strong>${h(info.email)}</strong>. Você está usando a conta de <strong>${h(current.user.name)}</strong>.</p>${alert()}${button('Sair e continuar com este link','id="switch-account"','primary full')}<a class="a-text-link" href="/">Continuar na minha conta</a>`);
    $('#switch-account').onclick=async()=>{try{await api('/api/auth/logout',{method:'POST'});location.reload();}catch(e){showError(root,e);}};return;
  }
  document.title=(setup?'Primeiro acesso':invite?'Aceitar convite':'Nova senha')+' · IANiza';
  authShell(`<span class="a-kicker">${setup?'SEU PRIMEIRO PASSO':invite?'VOCÊ FAZ PARTE DO TIME':'RECUPERAR ACESSO'}</span><h2>${setup?'Vamos criar seu espaço':invite?'Um convite para criar junto':'Crie sua nova senha'}<span>.</span></h2><p class="a-lead">${setup?'Crie a primeira conta de administrador da sua empresa.':invite?`Você foi convidado para <strong>${h(info.organization?.name)}</strong> como <strong>${role(info.role)}</strong>.`:`Defina uma nova senha para <strong>${h(info.email)}</strong>.`}</p><form id="link-form">${alert()}${setup?'<label class="a-field">Nome da empresa<input name="organization" autocomplete="organization" maxlength="80" placeholder="Como seu time se chama?" required></label>':''}${setup||invite?`<label class="a-field">Seu nome<input name="name" autocomplete="name" maxlength="80" value="${h(info.name)}" required></label>`:''}${setup?'<label class="a-field">Seu e-mail<input name="email" type="email" autocomplete="username" maxlength="254" placeholder="voce@empresa.com.br" required></label>':`<div class="a-invite-email">${icon('mail')}<span>${h(info.email)}</span></div>`}${passwordField(setup||invite?'Crie uma senha':'Nova senha')}<p class="a-hint" id="password-help">Pelo menos 12 caracteres. Você pode usar uma frase fácil de lembrar.</p>${passwordField('Confirme a senha','confirmPassword')}<p class="a-hint">${icon('clock')} Link válido até ${h(date(info.expiresAt))}.</p>${button(`${setup?'Criar meu espaço':invite?'Aceitar convite e entrar':'Salvar senha e entrar'} ${icon('arrow')}`,'type="submit"','primary full')}</form><a class="a-text-link" href="/login">Já tenho acesso · Entrar</a>`);
  bindForm('#link-form',async data=>{checkConfirmation(data);await api(setup?'/api/auth/setup':'/api/auth/accept',{method:'POST',body:{...data,token:raw}});history.replaceState(null,'',location.pathname);location.replace(setup?'/pessoas':'/');});
}

let identity, people, tab='users', query='';
function shell(content, active='people') {
  document.body.className='access-workspace';
  root.innerHTML=`<aside class="a-sidebar">${brand()}<div class="a-workspace"><span>${h(initials(identity.organization.name))}</span><div><strong>${h(identity.organization.name)}</strong><small>Time de Marketing</small></div></div><p class="a-nav-label">SEU ESPAÇO</p><nav><a href="/">${icon('office')}Escritório<span>↗</span></a>${identity.user.role==='admin'?`<a href="/pessoas" ${active==='people'?'aria-current="page"':''}>${icon('team')}Pessoas e acesso</a>`:''}<a href="/conta" ${active==='account'?'aria-current="page"':''}>${icon('user')}Minha conta</a></nav><div class="a-sidebar-note"><span>✳</span><strong>Um time começa com pessoas.</strong><p>Cada convite abre espaço para uma nova ideia.</p></div><div class="a-sidebar-account"><span class="a-avatar">${h(initials(identity.user.name))}</span><div><strong>${h(identity.user.name)}</strong><small>${role(identity.user.role)}</small></div><button class="a-icon-button" data-logout aria-label="Sair da conta">${icon('logout')}</button></div></aside><div class="a-workspace-body"><header class="a-topbar"><div><a href="/">Meu espaço</a><span>/</span><strong>${active==='people'?'Pessoas e acesso':'Minha conta'}</strong></div><a href="/conta" class="a-avatar" aria-label="Minha conta">${h(initials(identity.user.name))}</a></header><main id="access-main" class="a-workspace-main">${content}</main></div>`;
  $('[data-logout]').onclick=async()=>{try{await signOut();}catch(e){toast(e.message);}};
}
const pill=(text,kind='neutral')=>`<span class="a-pill ${kind}"><i></i>${h(text)}</span>`;
const inviteStatus={pending:['Pendente','amber'],expired:['Expirado','neutral'],revoked:['Revogado','neutral'],used:['Aceito','green']};
function tableRows() {
  const needle=query.toLocaleLowerCase('pt-BR'),items=(tab==='users'?people.users:people.invitations).filter(p=>`${p.name} ${p.email}`.toLocaleLowerCase('pt-BR').includes(needle));
  const box=$('#people-rows');
  $('#visible-count').textContent=`${items.length} ${tab==='users'?(items.length===1?'pessoa':'pessoas'):(items.length===1?'convite':'convites')}`;
  if(!items.length){box.innerHTML=`<div class="a-empty"><span>${icon(tab==='users'?'team':'mail')}</span><h3>${query?'Ninguém com esse nome por aqui.':'O próximo talento pode estar a um convite.'}</h3><p>${query?'Tente buscar por outro nome ou e-mail.':'Convide alguém para fazer parte do seu espaço de Marketing.'}</p>${!query?button(`${icon('plus')} Convidar pessoa`,'data-invite'):''}</div>`;}
  else box.innerHTML=items.map(p=>tab==='users'?`<article class="a-person-row"><span class="a-avatar ${p.role==='admin'?'sage':'sand'}">${h(initials(p.name))}</span><div class="a-person-name"><strong>${h(p.name)} ${p.id===identity.user.id?'<small>Você</small>':''}</strong><span>${h(p.email)}</span></div><span class="a-person-role">${role(p.role)}</span>${pill(p.status==='active'?'Ativo':'Sem acesso',p.status==='active'?'green':'neutral')}<button class="a-button subtle" data-manage="${h(p.id)}" aria-label="Gerenciar acesso de ${h(p.name)}">Gerenciar</button></article>`:`<article class="a-person-row"><span class="a-avatar sand">${icon('mail')}</span><div class="a-person-name"><strong>${h(p.name)}</strong><span>${h(p.email)}</span><small>${role(p.role)} · ${p.status==='pending'?'Válido até':'Criado em'} ${h(date(p.status==='pending'?p.expiresAt:p.createdAt))}</small></div>${pill(...(inviteStatus[p.status]||inviteStatus.expired))}<button class="a-button subtle" data-invitation="${h(p.id)}" aria-label="Ver convite de ${h(p.name)}">Ver convite</button></article>`).join('');
  box.querySelectorAll('[data-manage]').forEach(b=>b.onclick=()=>manageUser(b.dataset.manage));
  box.querySelectorAll('[data-invitation]').forEach(b=>b.onclick=()=>manageInvite(b.dataset.invitation));
  box.querySelector('[data-invite]')?.addEventListener('click',inviteForm);
}
function renderPeople() {
  const active=people.users.filter(p=>p.status==='active').length,pending=people.invitations.filter(p=>p.status==='pending').length,admins=people.users.filter(p=>p.role==='admin'&&p.status==='active').length;
  document.title='Pessoas e acesso · IANiza';
  shell(`<section class="a-page-heading"><div><p class="a-eyebrow">SEU TIME COMEÇA AQUI</p><h1>Gente boa, no mesmo espaço<span>.</span></h1><p>Convide pessoas e cuide de quem tem acesso à sua equipe.</p></div>${button(`${icon('plus')}Convidar pessoa`,'id="invite-person"')}</section><div class="a-stats"><div><span class="a-stat-icon">${icon('team')}</span><div><strong>${active}</strong><span>${active===1?'pessoa com acesso':'pessoas com acesso'}</span></div></div><div><span class="a-stat-icon amber">${icon('mail')}</span><div><strong>${pending}</strong><span>${pending===1?'convite pendente':'convites pendentes'}</span></div></div><div><span class="a-stat-icon">${icon('shield')}</span><div><strong>${admins}</strong><span>${admins===1?'administrador':'administradores'}</span></div></div></div><section class="a-people-card"><div class="a-people-toolbar"><div class="a-tabs" aria-label="Listas de acesso">${[['users','Pessoas',people.users.length],['invitations','Convites',people.invitations.length]].map(([id,label,count])=>`<button data-tab="${id}" aria-pressed="${tab===id}" class="${tab===id?'active':''}">${label}<span>${count}</span></button>`).join('')}</div><label class="a-search">${icon('search')}<input id="people-search" type="search" placeholder="Buscar nome ou e-mail" aria-label="Buscar nome ou e-mail" value="${h(query)}"></label></div><div class="a-table-caption"><span id="visible-count"></span><span>${tab==='users'?'Permissões e acesso':'Convites pessoais · uso único'}</span></div><div id="people-rows"></div></section><div class="a-access-note">${icon('shield')}<p><strong>Você decide quem faz parte.</strong> Administradores gerenciam os acessos. Membros entram no espaço de Marketing.</p></div><div class="a-preview-note">O acesso e os convites já são funcionais. O escritório ainda apresenta dados de demonstração, separados por conta neste navegador.</div>`);
  $('#invite-person').onclick=inviteForm;
  $('[data-tab="users"]').onclick=()=>{tab='users';renderPeople();};$('[data-tab="invitations"]').onclick=()=>{tab='invitations';renderPeople();};
  $('#people-search').oninput=e=>{query=e.target.value;tableRows();};tableRows();
}
async function refreshPeople(){people=await api('/api/team');renderPeople();}
let previousFocus;
function closeModal(){const d=$('#access-modal dialog');d?.close();$('#access-modal').innerHTML='';previousFocus?.isConnected&&previousFocus.focus();}
function modal(content) {
  previousFocus=document.activeElement;
  $('#access-modal').innerHTML=`<dialog class="a-modal" aria-labelledby="modal-title"><button class="a-modal-close a-icon-button" data-close aria-label="Fechar">${icon('close')}</button>${content}</dialog>`;
  const d=$('#access-modal dialog');d.querySelector('[data-close]').onclick=closeModal;d.addEventListener('cancel',e=>{e.preventDefault();closeModal();});d.showModal();
}
function inviteForm() {
  modal(`<span class="a-form-symbol">${icon('mail')}</span><p class="a-kicker">TEM ESPAÇO PARA MAIS UM</p><h2 id="modal-title">Quem vem criar com você?</h2><p class="a-lead">A pessoa recebe acesso ao espaço da sua empresa, com uma conta e senha próprias.</p><form id="invite-form">${alert()}<label class="a-field">Nome<input name="name" autocomplete="off" maxlength="80" placeholder="Nome da pessoa" required></label><label class="a-field">E-mail<input name="email" type="email" autocomplete="off" maxlength="254" placeholder="pessoa@empresa.com.br" required></label><fieldset class="a-role-options"><legend>Permissão de acesso</legend><label><input name="role" type="radio" value="member" checked><span><strong>Membro</strong><small>Acessa o espaço de Marketing.</small></span></label><label><input name="role" type="radio" value="admin"><span><strong>Administrador</strong><small>Também convida pessoas e gerencia acessos.</small></span></label></fieldset><div class="a-notice">${icon('link')} Você vai gerar um link pessoal para compartilhar. Ele vale por 24 horas e só pode ser usado uma vez.</div>${button(`Gerar convite ${icon('arrow')}`,'type="submit"','primary full')}</form>`);
  bindForm('#invite-form',async data=>{const invitation=await api('/api/team/invitations',{method:'POST',body:data});await refreshPeople();showLink(invitation,'invite');});
}
function showLink(result,kind) {
  modal(`<span class="a-form-symbol">${icon('check')}</span><p class="a-kicker">${kind==='invite'?'CONVITE PRONTO':'RECUPERAÇÃO DE ACESSO'}</p><h2 id="modal-title">${kind==='invite'?'O próximo passo é compartilhar.':'Um novo começo para a senha.'}</h2><p class="a-lead">Envie este link diretamente para <strong>${h(result.name||result.email)}</strong>.</p><div class="a-share-person">${icon('mail')} ${h(result.email)}</div><label class="a-field">Link pessoal<input id="share-link" readonly value="${h(result.url)}" aria-label="Link pessoal para compartilhar"></label>${button(`${icon('link')}Copiar link`,'id="copy-link"','primary full')}<p class="a-hint">Válido até ${h(date(result.expiresAt))}. O link não é enviado por e-mail automaticamente. Para sua segurança, ele só aparece agora; você pode gerar outro depois.</p>${location.hostname==='127.0.0.1'||location.hostname==='localhost'?'<div class="a-notice">Você está usando um endereço local. Para convidados abrirem em outro computador, a instalação precisa estar em um endereço HTTPS acessível.</div>':''}<div class="a-modal-footer">${button('Concluir','id="finish-link"','secondary')}</div>`);
  $('#copy-link').onclick=async()=>{try{await navigator.clipboard.writeText(result.url);$('#copy-link').innerHTML=icon('check')+'Link copiado';toast('Link copiado. Compartilhe diretamente com a pessoa convidada.');}catch{$('#share-link').select();toast('Selecione o link e copie com Ctrl+C ou ⌘C.');}};
  $('#finish-link').onclick=closeModal;
}
function manageInvite(id) {
  const p=people.invitations.find(x=>x.id===id),state=inviteStatus[p.status]||inviteStatus.expired;
  modal(`<span class="a-kicker">CONVITE DO TIME</span><h2 id="modal-title">${h(p.name)}</h2><p class="a-lead">${h(p.email)}</p>${pill(...state)}<dl class="a-details"><div><dt>Permissão</dt><dd>${role(p.role)}</dd></div><div><dt>Criado em</dt><dd>${h(date(p.createdAt))}</dd></div><div><dt>Validade</dt><dd>${h(date(p.expiresAt))}</dd></div></dl>${alert()}${p.status==='used'?'<div class="a-notice">O convite já foi aceito. O acesso dessa pessoa está na aba Pessoas.</div>':`<p class="a-hint">Gerar outro link invalida o anterior e renova a validade por 24 horas.</p><div class="a-modal-actions">${button('Gerar novo link','id="renew-invite"')}${p.status==='pending'?button('Revogar convite','id="revoke-invite"','danger'):''}</div>`}`);
  $('#renew-invite')?.addEventListener('click',async e=>{e.currentTarget.disabled=true;try{const l=await api(`/api/team/invitations/${id}/renew`,{method:'POST'});await refreshPeople();showLink(l,'invite');}catch(error){showError($('#access-modal'),error);if($('#renew-invite'))$('#renew-invite').disabled=false;}});
  $('#revoke-invite')?.addEventListener('click',()=>confirmAction('Revogar este convite?',`${p.name} não poderá usar o link atual para criar uma conta.`,async()=>{await api(`/api/team/invitations/${id}/revoke`,{method:'POST'});await refreshPeople();closeModal();toast('Convite revogado.');},()=>manageInvite(id)));
}
function confirmAction(title,text,action,back) {
  modal(`<p class="a-kicker">CONFIRMAR ALTERAÇÃO</p><h2 id="modal-title">${h(title)}</h2><p class="a-lead">${h(text)}</p>${alert()}<div class="a-modal-actions">${button('Cancelar','id="cancel-action"','secondary')}${button('Confirmar','id="confirm-action"','danger')}</div>`);
  $('#cancel-action').onclick=back;$('#confirm-action').onclick=async e=>{e.currentTarget.disabled=true;try{await action();}catch(error){showError($('#access-modal'),error);if($('#confirm-action'))$('#confirm-action').disabled=false;}};
}
function manageUser(id) {
  const p=people.users.find(x=>x.id===id),self=id===identity.user.id;
  modal(`<span class="a-kicker">ACESSO AO ESPAÇO</span><h2 id="modal-title">${h(p.name)}${self?' · você':''}</h2><p class="a-lead">${h(p.email)}</p><form id="manage-user">${alert()}<label class="a-field">Permissão<select name="role" ${self?'disabled':''}><option value="member" ${p.role==='member'?'selected':''}>Membro</option><option value="admin" ${p.role==='admin'?'selected':''}>Administrador</option></select></label><p class="a-hint">${self?'Seu acesso de administrador é preservado.':'Administradores também podem convidar pessoas e gerenciar acessos.'}</p>${!self?button('Salvar permissão','type="submit"','primary full'):''}</form><div class="a-account-actions">${self?'<a class="a-button secondary full" href="/conta">Minha conta e senha</a>':`${p.status==='active'?button(`${icon('link')}Gerar link para nova senha`,'id="reset-link"','secondary full'):''}${button(p.status==='active'?'Desativar acesso':'Reativar acesso','id="toggle-access"',p.status==='active'?'danger full':'secondary full')}`}</div>${self?'':'<p class="a-hint">Desativar encerra as sessões dessa pessoa. O histórico da conta é preservado.</p>'}`);
  if(!self)bindForm('#manage-user',async data=>{await api(`/api/team/users/${id}`,{method:'PATCH',body:{role:data.role}});await refreshPeople();closeModal();toast('Permissão atualizada.');});
  $('#reset-link')?.addEventListener('click',async e=>{e.currentTarget.disabled=true;try{const l=await api(`/api/team/users/${id}/reset-link`,{method:'POST'});showLink(l,'reset');}catch(error){showError($('#access-modal'),error);if($('#reset-link'))$('#reset-link').disabled=false;}});
  $('#toggle-access')?.addEventListener('click',()=>confirmAction(p.status==='active'?'Desativar este acesso?':'Reativar este acesso?',p.status==='active'?`${p.name} perderá o acesso e as sessões abertas serão encerradas.`:`${p.name} poderá entrar novamente com a senha já cadastrada.`,async()=>{await api(`/api/team/users/${id}`,{method:'PATCH',body:{status:p.status==='active'?'disabled':'active'}});await refreshPeople();closeModal();toast('Acesso atualizado.');},()=>manageUser(id)));
}
function accountPage() {
  document.title='Minha conta · IANiza';
  shell(`<section class="a-page-heading"><div><p class="a-eyebrow">SEU ACESSO</p><h1>Bom ter você no time<span>.</span></h1><p>Confira sua conta e mantenha seu acesso atualizado.</p></div><a class="a-button secondary" href="/">${icon('office')}Ir para o escritório</a></section><div class="a-account-grid"><section class="a-account-card"><span class="a-avatar large">${h(initials(identity.user.name))}</span><h2>${h(identity.user.name)}</h2><p>${h(identity.user.email)}</p>${pill(role(identity.user.role),'green')}<dl class="a-details"><div><dt>Empresa</dt><dd>${h(identity.organization.name)}</dd></div><div><dt>Equipe</dt><dd>Marketing</dd></div></dl>${button(`${icon('logout')}Sair da conta`,'id="account-logout"','secondary full')}</section><section class="a-account-card"><span class="a-form-symbol">${icon('shield')}</span><h2>Alterar minha senha</h2><p class="a-lead">Uma senha só sua para entrar no espaço.</p><form id="password-form">${alert()}${passwordField('Senha atual','currentPassword','current-password')}${passwordField('Nova senha')}<p id="password-help" class="a-hint">Use de 12 a 200 caracteres.</p>${passwordField('Confirme a nova senha','confirmPassword')}${button('Salvar nova senha','type="submit"','primary full')}<p class="a-hint">As outras sessões da sua conta serão encerradas.</p></form></section></div>`,'account');
  $('#account-logout').onclick=async()=>{try{await signOut();}catch(e){toast(e.message);}};
  bindForm('#password-form',async(data,form)=>{checkConfirmation(data);await api('/api/account/password',{method:'POST',body:data});identity=await api('/api/auth/me');form.reset();toast('Senha alterada. Os outros acessos foram encerrados.');});
}
async function start() {
  const route=location.pathname;
  if(['/primeiro-acesso','/convite','/nova-senha'].includes(route))return linkPage({'/primeiro-acesso':'setup','/convite':'invite','/nova-senha':'reset'}[route]);
  if(route==='/recuperar')return recovery();
  try{identity=await api('/api/auth/me');}catch(e){if(e.status!==401)throw e;}
  if(route==='/login'){if(identity){location.replace('/');return;}return login();}
  if(!identity){location.replace('/login');return;}
  watchSession(async()=>{const current=await api('/api/auth/me');if(current.user.id!==identity.user.id||current.user.role!==identity.user.role)location.reload();});
  if(route==='/pessoas'){if(identity.user.role!=='admin'){location.replace('/conta');return;}await refreshPeople();}else accountPage();
}
start().catch(e=>{authShell(`<h2>Vamos tentar de novo?</h2><p class="a-lead" role="alert">${h(e.message)}</p><a class="a-button primary full" href="${h(location.pathname)}">Tentar novamente</a>`);});
