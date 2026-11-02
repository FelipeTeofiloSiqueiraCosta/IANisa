// Somente o CDN de imagens retornado pelo Higgsfield nesta integração.
// Não há proxy de URLs arbitrárias nem interpretação de HTML das respostas.
export const HIGGSFIELD_IMAGE_ORIGINS=['https://d8j0ntlcm91z4.cloudfront.net'];
export function imageURL(value){
  if(typeof value!=='string'||value.length>2048)return null;
  try{const u=new URL(value);return HIGGSFIELD_IMAGE_ORIGINS.includes(u.origin)&&!u.username&&!u.password&&!u.port&&/\.(png|jpe?g|webp)$/i.test(u.pathname)?u.href:null;}catch{return null;}
}
export function imageURLs(text){
  return [...new Set((String(text).slice(0,200000).match(/https:\/\/[^\s<>"'`\\\]\)]+/g)??[]).map(s=>imageURL(s.replace(/[.,;]+$/,''))).filter(Boolean))].slice(0,6);
}
export function messageImages(message){
  if(message.role!=='assistant'||!message.connectors?.some(c=>c.key==='higgsfield'))return [];
  const verified=(message.media??[]).filter(m=>m.connector==='higgsfield'&&imageURL(m.url));
  if(verified.length)return verified.slice(0,6).map(m=>({...m,url:imageURL(m.url)}));
  // Compatibilidade: mensagens antigas não registravam os resultados das ferramentas.
  const mentioned=String(message.text).match(/\bmodelo\s+((?:Seedream|Flux|Ideogram|Recraft|Imagen|Nano Banana)[a-zA-Z0-9 .-]{0,50}?)(?=,|\n|\s+em formato|$)/i)?.[1]?.trim();
  return imageURLs(message.text).map(url=>({url,connector:'higgsfield',model:mentioned??null,source:'legacy'}));
}
export function conversationModel(model){
  if(!model?.id)return 'Claude · modelo não registrado';
  return model.id==='default'?'Claude · padrão da conta':'Claude · '+(model.name||({opus:'Opus',sonnet:'Sonnet',haiku:'Haiku'})[model.id]||model.id);
}
