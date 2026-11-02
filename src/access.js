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
  bindForm('#link-form',async data=>{checkConfirmation(data);await api(setup?'/api/auth/setup':'/api/auth/accept',{method:'POST',body:{...data,token:raw}});history.replaceState(null,'',location.pathname);location.replace('/');});
}

let identity;
function accountPage() {
  document.title='Minha conta · IANiza';
  document.body.className='access-workspace account-minimal';
  root.innerHTML=`<header class="workspace-header"><a href="/" class="workspace-brand" aria-label="IANiza, escritório"><span>✳</span>ianiza<b>.</b></a><span class="account-profile-link" aria-label="Conta de ${h(identity.user.name)}">${h(initials(identity.user.name))}</span></header><main id="access-main" class="account-main"><a class="account-back" href="/">${icon('arrow')}Voltar ao escritório</a><section class="a-page-heading"><div><p class="a-eyebrow">SEU ACESSO</p><h1>Minha conta<span>.</span></h1><p>Suas informações e configurações de acesso.</p></div></section><div class="a-account-grid"><section class="a-account-card"><span class="a-avatar large">${h(initials(identity.user.name))}</span><h2>${h(identity.user.name)}</h2><p>${h(identity.user.email)}</p><dl class="a-details"><div><dt>Empresa</dt><dd>${h(identity.organization.name)}</dd></div><div><dt>Permissão</dt><dd>${role(identity.user.role)}</dd></div></dl>${button(`${icon('logout')}Sair da conta`,'id="account-logout"','secondary full')}</section><section class="a-account-card"><span class="a-form-symbol">${icon('shield')}</span><h2>Alterar minha senha</h2><p class="a-lead">Uma senha só sua para entrar no espaço.</p><form id="password-form">${alert()}${passwordField('Senha atual','currentPassword','current-password')}${passwordField('Nova senha')}<p id="password-help" class="a-hint">Use de 12 a 200 caracteres.</p>${passwordField('Confirme a nova senha','confirmPassword')}${button('Salvar nova senha','type="submit"','primary full')}<p class="a-hint">As outras sessões da sua conta serão encerradas.</p></form></section></div></main>`;
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
  if(route==='/pessoas'){location.replace('/conta');return;}
  accountPage();
}
start().catch(e=>{authShell(`<h2>Vamos tentar de novo?</h2><p class="a-lead" role="alert">${h(e.message)}</p><a class="a-button primary full" href="${h(location.pathname)}">Tentar novamente</a>`);});
