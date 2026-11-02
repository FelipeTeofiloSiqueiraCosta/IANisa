import { api, h, initials, signOut, watchSession } from './api-client.js';
import { OfficeScene } from './office-scene.js';
import { createBrandUI } from './brand-ui.js';
import {createCapabilitiesUI} from './capabilities-ui.js';
import {watchAppUpdates} from './app-updates.js';
import {createAgentsUI} from './agents-ui.js';

const $=selector=>document.querySelector(selector);
let office;
function setProfileOpen(open) {
  $('#profile-panel').hidden=!open;
  $('#profile-button').setAttribute('aria-expanded',String(open));
}
async function start() {
  try {
    const identity=await api('/api/auth/me');
    $('#profile-initials').textContent=initials(identity.user.name);
    $('#profile-name').textContent=identity.user.name;
    $('#profile-email').textContent=identity.user.email;
    $('#profile-button').setAttribute('aria-label',`Abrir perfil de ${identity.user.name}`);
    document.body.classList.remove('workspace-loading');
    const scene=$('#office');
    scene.addEventListener('office-unavailable',()=>{$('#office-controls').hidden=true;$('#office-hint').hidden=true;});
    const roster=await api('/api/agents');
    const agentsUI=createAgentsUI({identity,onStatus:status=>office?.setAgentStatus(status)});
    office=new OfficeScene(scene,{agents:roster.agents,onSelect:()=>agentsUI.open()});
    $('#office-team').hidden=roster.agents.length===0;
    $('#open-lia').onclick=()=>{office.focusAgent();agentsUI.open();};
    $('#office-loading').remove();
    $('#profile-button').addEventListener('click',()=>setProfileOpen($('#profile-panel').hidden));
    document.addEventListener('click',event=>{if(!event.target.closest('.workspace-profile'))setProfileOpen(false);});
    document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!$('#profile-panel').hidden){setProfileOpen(false);$('#profile-button').focus();}});
    $('#sign-out').addEventListener('click',async()=>{const b=$('#sign-out');b.disabled=true;try{await signOut();}catch(e){$('#profile-error').textContent=e.message;$('#profile-error').hidden=false;b.disabled=false;}});
    let capabilities;
    const brand=createBrandUI({identity,chooseResources:(kind,ids)=>capabilities.choose(kind,ids)});
    capabilities=createCapabilitiesUI({onUse:options=>brand.open(options)});
    $('#open-brain').onclick=()=>{setProfileOpen(false);brand.open();};
    $('#open-skills').onclick=()=>{setProfileOpen(false);capabilities.open('skills');};
    $('#open-connectors').onclick=()=>{setProfileOpen(false);capabilities.open('connectors');};
    if(identity.user.role==='admin'){$('#open-ai').hidden=false;$('#open-ai').onclick=()=>{setProfileOpen(false);brand.connections();};}
    $('#zoom-out').onclick=()=>office.zoom(-.15);
    $('#zoom-in').onclick=()=>office.zoom(.15);
    $('#reset-view').onclick=()=>office.reset();
    watchSession(async()=>{const current=await api('/api/auth/me');if(current.user.id!==identity.user.id||current.user.role!==identity.user.role)location.reload();});
    watchAppUpdates();
    window.addEventListener('pagehide',()=>office.dispose(),{once:true});
    window.addEventListener('pageshow',event=>{if(event.persisted)location.reload();});
    const authReturn=new URL(location.href).searchParams.get('connectorAuth');
    if(authReturn){history.replaceState(null,'',location.pathname);capabilities.open('connectors',{notice:authReturn==='error'?'A autorização do conector não foi concluída. Confira a configuração na área de Conectores e tente novamente.':undefined});}
    else brand.init().catch(e=>{$('#profile-error').textContent=e.message;$('#profile-error').hidden=false;});
  } catch(e) {
    if(e.status===401){location.replace('/login');return;}
    document.body.classList.remove('workspace-loading');
    $('#office-loading').innerHTML=`<div class="office-unavailable"><strong>Não foi possível abrir seu espaço.</strong><p role="alert">${h(e.message)}</p><a href="/">Tentar novamente</a></div>`;
    $('#office-controls').hidden=true;
  }
}
start();
