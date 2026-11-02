// Uma aba aberta conserva o JS antigo mesmo com no-store. Oferece a atualização
// explicitamente, sem recarregar enquanto a pessoa escreve ou envia uma mensagem.
export function watchAppUpdates(){
 const loaded=document.documentElement.dataset.build;if(!loaded)return;
 let notice=null,checking=false;
 function place(){
  if(!notice)return;
  const modal=[...document.querySelectorAll('dialog[open]')].at(-1),anchor=modal?.querySelector('.brain-header')||document.querySelector('.workspace-header');
  if(anchor&&anchor.nextElementSibling!==notice)anchor.after(notice);
 }
 async function check(){
  if(document.hidden||checking||notice)return;checking=true;
  try{const response=await fetch('/assets/version.json',{cache:'no-store'});if(!response.ok)return;const {version}=await response.json();if(version===loaded||!/^[a-f0-9]{16}$/.test(version))return;
   notice=document.createElement('aside');notice.className='app-update-notice';notice.setAttribute('role','status');
   const text=document.createElement('span');text.textContent='Há uma nova versão da IANiza. Atualize quando terminar sua edição.';
   const button=document.createElement('button');button.type='button';button.textContent='Atualizar página';button.onclick=()=>location.reload();
   notice.append(text,button);place();
  }catch{}finally{checking=false;}
 }
 const observer=new MutationObserver(place);observer.observe(document.body,{childList:true,subtree:true});
 const timer=setInterval(check,30000);window.addEventListener('focus',check);document.addEventListener('visibilitychange',check);
 window.addEventListener('pagehide',()=>{clearInterval(timer);observer.disconnect();window.removeEventListener('focus',check);document.removeEventListener('visibilitychange',check);},{once:true});
 check();
}
