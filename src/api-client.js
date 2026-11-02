let csrf = '';
export const h = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const initials = name => String(name ?? '').trim().split(/\s+/).slice(0,2).map(v=>v[0]).join('').toUpperCase();
export async function api(path, { method='GET', body } = {}) {
  let response;
  try { response = await fetch(path,{ method, credentials:'same-origin', headers:{ ...(body ? {'content-type':'application/json'} : {}), ...(method!=='GET' ? {'x-csrf-token':csrf} : {}) }, ...(body ? {body:JSON.stringify(body)} : {}) }); }
  catch { throw new Error('Não foi possível conectar. Confira se o servidor está rodando e tente novamente.'); }
  const value = await response.json();
  if (!response.ok) throw Object.assign(new Error(value.error || 'Não foi possível concluir.'),{status:response.status});
  if (value.csrf) csrf = value.csrf;
  return value;
}
export async function signOut() {
  await api('/api/auth/logout',{method:'POST'});
  try { const channel = new BroadcastChannel('ianiza:access'); channel.postMessage('logout'); channel.close(); } catch {}
  location.replace('/login');
}
export async function uploadBrandFile(file) {
  const form=new FormData();form.append('file',file);
  let response;try{response=await fetch('/api/brain/files',{method:'POST',credentials:'same-origin',headers:{'x-csrf-token':csrf},body:form});}catch{throw new Error('Não foi possível enviar o arquivo. Tente novamente.');}
  const data=await response.json();if(!response.ok)throw Object.assign(new Error(data.error||'Não foi possível enviar o arquivo.'),{status:response.status});return data.file;
}
export async function uploadSkillFile(file,{signal}={}){
 let response;try{response=await fetch('/api/skills/imports',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/octet-stream','x-csrf-token':csrf,'x-skill-filename':encodeURIComponent(file.name)},body:file,signal});}catch(e){if(e.name==='AbortError')throw e;throw new Error('Não foi possível enviar a skill. Confira a conexão e tente novamente.');}
 const data=await response.json();if(!response.ok)throw Object.assign(new Error(data.error||'Não foi possível validar a skill.'),{status:response.status});return data;
}
export function watchSession(check) {
  let checking=false;
  async function verify() { if (document.hidden || checking) return; checking=true; try { await check(); } catch(e) { if(e.status===401) location.replace('/login?session=expired'); } finally { checking=false; } }
  setInterval(verify,30000);
  window.addEventListener('focus',verify);
  window.addEventListener('pageshow',verify);
  try { const channel=new BroadcastChannel('ianiza:access'); channel.onmessage=e=>{ if(e.data==='logout') location.replace('/login'); }; } catch {}
}
