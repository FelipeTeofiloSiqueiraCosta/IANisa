import {chatScrollTarget} from './brand-chat.js';

// Mantém o contêiner de rolagem e os balões já existentes durante o polling.
export function patchChat(dialog,content,footer,{forceBottom=false}={}) {
  const list=dialog.querySelector('#brain-messages');
  if(!list)return false;
  const template=document.createElement('template');
  template.innerHTML=content+footer;
  const incoming=template.content.querySelector('#brain-messages');
  if(!incoming)return false;
  const before={scrollTop:list.scrollTop,scrollHeight:list.scrollHeight,clientHeight:list.clientHeight};
  const oldNodes=new Map([...list.children].map(node=>[node.dataset.chatKey,node]));
  const wanted=new Set([...incoming.children].map(node=>node.dataset.chatKey));
  for(const [key,node] of oldNodes)if(!wanted.has(key))node.remove();
  let cursor=list.firstElementChild;
  for(const next of [...incoming.children]) {
    let node=oldNodes.get(next.dataset.chatKey);
    if(node) {
      if(!node.isEqualNode(next))node.innerHTML=next.innerHTML;
    } else node=next;
    if(node!==cursor)list.insertBefore(node,cursor);
    cursor=node.nextElementSibling;
  }
  // Metadados e rodapé só mudam quando o seu conteúdo muda, sem refazer o chat.
  for(const selector of ['.brain-chat-meta','.brain-connect-note','.brain-chat-bottom','.brain-readonly','.brain-tool-permissions']) {
    const current=dialog.querySelector(selector),next=template.content.querySelector(selector);
    if(current&&next) {
      const active=document.activeElement,restoreFocus=current.contains(active),id=active?.id;
      const selection=restoreFocus&&typeof active.selectionStart==='number'?[active.selectionStart,active.selectionEnd]:null;
      const materialsOpen=current.querySelector('.brain-materials')?.open;
      const inputHeight=current.querySelector('#brain-input')?.style.height;
      const materials=next.querySelector('.brain-materials');if(materials)materials.open=Boolean(materialsOpen);
      const input=next.querySelector('#brain-input');if(inputHeight&&input)input.style.height=inputHeight;
      if(selector==='.brain-tool-permissions')for(const card of next.children){const old=[...current.children].find(c=>c.dataset.toolId===card.dataset.toolId);const details=card.querySelector('details');if(details)details.open=Boolean(old?.querySelector('details')?.open);}
      if(current.isEqualNode(next))continue;
      current.replaceWith(next);
      const focus=id&&next.querySelector('#'+id);
      if(restoreFocus&&focus&&!focus.disabled){focus.focus({preventScroll:true});if(selection)focus.setSelectionRange(...selection);}
    } else if(current) current.remove();
    else if(next) {
      if(selector==='.brain-chat-meta'||selector==='.brain-connect-note')list.before(next);
      else list.after(next);
    }
  }
  const target=chatScrollTarget(before,{scrollHeight:list.scrollHeight,clientHeight:list.clientHeight},{forceBottom});
  if(Math.abs(list.scrollTop-target)>.5)list.scrollTop=target;
  return true;
}
