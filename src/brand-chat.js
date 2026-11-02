export const sendsOnEnter=event=>event.key==='Enter'&&!event.shiftKey&&!event.isComposing&&!event.repeat;
export function messagesWithOutgoing(messages,outgoing) {
  if(!outgoing)return messages;
  const saved=messages.some(m=>m.role==='user'&&m.requestId===outgoing.requestId);
  return saved?messages.map(m=>m.role==='user'&&m.requestId===outgoing.requestId?{...m,delivery:'sent'}:m):[...messages,outgoing];
}
export const deliveryLabel={sending:'Enviando…',sent:'Mensagem enviada',failed:'Não foi possível enviar'};

export function chatScrollTarget(before,after,{forceBottom=false,threshold=48}={}) {
  const wasAtBottom=before.scrollHeight-before.clientHeight-before.scrollTop<=threshold;
  const maximum=Math.max(0,after.scrollHeight-after.clientHeight);
  if(!forceBottom&&before.scrollHeight===after.scrollHeight&&before.clientHeight===after.clientHeight)return Math.min(before.scrollTop,maximum);
  return forceBottom||wasAtBottom?maximum:Math.min(before.scrollTop,maximum);
}
