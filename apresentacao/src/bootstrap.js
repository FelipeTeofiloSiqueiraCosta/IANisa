import { api, h, initials, watchSession } from './api-client.js';

async function boot() {
  try {
    const a = await api('/api/auth/me');
    window.ianizaAccount = { user:a.user, organization:a.organization };
    // Somente os dados de demonstração usam localStorage, separados por pessoa.
    document.documentElement.dataset.previewScope = `${a.organization.id}:${a.user.id}`;
    document.querySelector('.account').outerHTML = `<a class="account account-link" href="/conta" title="Minha conta"><span class="account-avatar">${h(initials(a.user.name))}</span><span><strong>${h(a.user.name)}</strong><small>${a.user.role==='admin'?'Administrador':'Membro'}</small></span><span class="account-online"></span></a>`;
    const avatar=document.querySelector('.top-avatar'); avatar.outerHTML=`<a class="top-avatar" href="/conta" aria-label="Minha conta">${h(initials(a.user.name))}</a>`;
    document.querySelector('.workspace-switch strong').textContent=a.organization.name;
    document.querySelector('.workspace-switch small').textContent='Time de Marketing';
    const script=document.createElement('script');script.src='/apresentacao/assets/app.js';
    script.onload=()=>document.body.classList.remove('auth-pending');
    script.onerror=()=>{ document.body.classList.remove('auth-pending');document.querySelector('#main').innerHTML='<p>Não foi possível abrir o escritório. Atualize a página para tentar novamente.</p>'; };
    document.head.append(script);
    watchSession(async()=>{const current=await api('/api/auth/me');if(current.user.id!==a.user.id||current.user.role!==a.user.role)location.reload();});
  } catch(e) {
    if(e.status===401)location.replace('/login');
    else {document.body.classList.remove('auth-pending');document.querySelector('#main').innerHTML=`<p role="alert">${h(e.message)}</p><a href="/">Tentar novamente</a>`;}
  }
}
boot();
