// Aviso no celular e no computador por Web Push (desde 15/10/2026, docs/2026-10-15-conversa-compartilhada.md):
// o mesmo que entra no sino chega no aparelho, com a Ratoeira fechada. A pessoa liga em cada aparelho (sino ›
// "Avisar neste aparelho"); o navegador dá uma assinatura (endpoint do serviço de push do Google, Apple ou Mozilla),
// guardada aqui por e-mail. As chaves VAPID nascem na primeira vez e ficam só nesta máquina, num JSON 600 da pasta
// de dados do gateway: identificam esta Ratoeira pros serviços de push, não dão acesso a nada.
import {readFileSync,writeFileSync,renameSync,mkdirSync} from 'node:fs';
import path from 'node:path';
import webpush from 'web-push';

const MAX_POR_PESSOA=10;                 // aparelhos
const INTERVALO=60e3;                    // o mesmo aviso (tag) não toca de novo no mesmo aparelho antes disso

export function createPush({arquivo,assunto='mailto:ratoeira@localhost',enviar=webpush.sendNotification.bind(webpush),agora=Date.now,log=console.log}){
  let dados={chaves:null,assinaturas:{}};
  try{const d=JSON.parse(readFileSync(arquivo,'utf8'));dados={chaves:d.chaves??null,assinaturas:d.assinaturas&&typeof d.assinaturas==='object'?d.assinaturas:{}};}catch{}
  const gravar=()=>{try{mkdirSync(path.dirname(arquivo),{recursive:true});const t=arquivo+'.tmp';writeFileSync(t,JSON.stringify(dados),{mode:0o600});renameSync(t,arquivo);}catch(e){log('push: não gravei ('+e.message+')');}};
  if(!dados.chaves?.publicKey){dados.chaves=webpush.generateVAPIDKeys();gravar();}
  const vapid={subject:assunto,publicKey:dados.chaves.publicKey,privateKey:dados.chaves.privateKey};
  const ultimos=new Map();               // `${endpoint}|${tag}` → quando tocou
  const valida=s=>s&&typeof s.endpoint==='string'&&/^https:\/\//.test(s.endpoint)&&s.endpoint.length<2000&&typeof s.keys?.p256dh==='string'&&typeof s.keys?.auth==='string'&&s.keys.p256dh.length<200&&s.keys.auth.length<100;
  return {
    chave:()=>vapid.publicKey,
    aparelhos:email=>(dados.assinaturas[email]??[]).map(a=>({aparelho:a.aparelho,desde:a.desde})),
    tem:(email,endpoint)=>(dados.assinaturas[email]??[]).some(a=>a.sub.endpoint===endpoint),
    assinar(email,sub,aparelho){
      if(!valida(sub))throw Object.assign(new Error('Assinatura de aviso inválida.'),{status:400});
      const lista=(dados.assinaturas[email]??[]).filter(a=>a.sub.endpoint!==sub.endpoint);
      lista.push({sub:{endpoint:sub.endpoint,keys:{p256dh:sub.keys.p256dh,auth:sub.keys.auth}},aparelho:String(aparelho??'').slice(0,60)||'aparelho',desde:new Date(agora()).toISOString()});
      dados.assinaturas[email]=lista.slice(-MAX_POR_PESSOA);gravar();
    },
    sair(email,endpoint){dados.assinaturas[email]=(dados.assinaturas[email]??[]).filter(a=>a.sub.endpoint!==endpoint);gravar();},
    // manda pra todos os aparelhos da pessoa; assinatura que o serviço diz que acabou (404/410) sai
    async avisar(email,{titulo,corpo,url,tag,naoLidas}){
      const lista=dados.assinaturas[email]??[];if(!lista.length)return 0;
      const carga=JSON.stringify({titulo,corpo,url,tag,...(Number.isInteger(naoLidas)?{naoLidas}:{})});let n=0,sujo=false;
      await Promise.all(lista.map(async a=>{
        const k=a.sub.endpoint+'|'+tag;if(tag&&agora()-(ultimos.get(k)??0)<INTERVALO)return;
        ultimos.set(k,agora());
        try{await enviar(a.sub,carga,{vapidDetails:vapid,TTL:6*3600,urgency:'high',timeout:10000});n++;}
        catch(e){if([404,410].includes(e?.statusCode)){a.morta=true;sujo=true;}else log('push: falhou pra '+email+' ('+(e?.statusCode??e?.message)+')');}
      }));
      if(sujo){dados.assinaturas[email]=lista.filter(a=>!a.morta);gravar();}
      if(ultimos.size>2000)ultimos.clear();
      return n;
    },
  };
}

// O service worker (servido em /sw.js, sem login, como o manifesto): mostra o aviso, abre a conversa no clique,
// põe o número no ícone do app instalado e, quando a página da Ratoeira não chega (sem internet ou a VPS fora),
// mostra a tela "sem conexão" no lugar da página de erro do navegador. Não guarda nada em cache: com rede, tudo
// segue indo direto pro servidor. Só a navegação da janela passa por aqui (nem iframe, nem script, nem API).
const SEM_CONEXAO=`<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="color-scheme" content="light dark"><meta name="theme-color" content="#ecebe6"><title>Sem conexão · Ratoeira</title>
<style>:root{--palco:#ecebe6;--ilha:#fff;--tinta:#1f1e1b;--suave:#67655d;--linha:#e4e2dc}
@media(prefers-color-scheme:dark){:root{--palco:#141412;--ilha:#1e1e1b;--tinta:#eeece4;--suave:#9d9a90;--linha:#33322d}}
body{margin:0;min-height:100dvh;display:grid;place-items:center;background:var(--palco);color:var(--tinta);font:15px/1.5 system-ui,-apple-system,sans-serif;padding:16px;box-sizing:border-box}
main{background:var(--ilha);border:1px solid var(--linha);border-radius:16px;padding:28px 24px;max-width:360px;text-align:center}
h1{font-size:19px;margin:0 0 8px}p{margin:0 0 20px;color:var(--suave)}
button{font:inherit;font-weight:600;border:0;border-radius:10px;padding:11px 20px;background:var(--tinta);color:var(--palco);cursor:pointer;min-height:44px}</style>
<main><h1>__TITULO__</h1><p>__TEXTO__</p><button type="button" id="de-novo">Tentar de novo</button></main>
<script>const ir=()=>location.reload();document.getElementById('de-novo').onclick=ir;addEventListener('online',ir);
setInterval(()=>{if(document.visibilityState==='visible'&&navigator.onLine)fetch('/manifest.json',{cache:'no-store'}).then(r=>{if(r.ok)ir();}).catch(()=>{});},15000);</script></html>`;

export const SERVICE_WORKER=`const TELA=${JSON.stringify(SEM_CONEXAO)};
const pagina=(t,x)=>new Response(TELA.replace('__TITULO__',t).replace('__TEXTO__',x),{status:503,headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store',
  'content-security-policy':"default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'"}});
const badge=n=>{try{if(!self.navigator.setAppBadge)return;return n>0?self.navigator.setAppBadge(n):self.navigator.clearAppBadge();}catch{}};
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));
self.addEventListener('fetch',e=>{
  const r=e.request;if(r.mode!=='navigate'||r.method!=='GET')return;
  e.respondWith(fetch(r).then(res=>[502,503,504,521,522,523,524,530].includes(res.status)
      ?pagina('A Ratoeira não respondeu','O servidor está fora do ar ou reiniciando. Tento de novo sozinho daqui a pouco.'):res,
    ()=>pagina('Sem conexão','O aparelho está sem internet. Assim que voltar, a Ratoeira abre de novo.')));
});
self.addEventListener('push',e=>{
  let d={};try{d=e.data.json();}catch{d={titulo:'Ratoeira',corpo:e.data?e.data.text():''};}
  e.waitUntil(Promise.all([self.registration.showNotification(d.titulo||'Ratoeira',{body:d.corpo||'',tag:d.tag||undefined,renotify:Boolean(d.tag),icon:'/_ratoeira/icon.png',badge:'/_ratoeira/icon.png',data:{url:d.url||'/portal/'}}),
    Number.isInteger(d.naoLidas)?badge(d.naoLidas):undefined]));
});
self.addEventListener('notificationclick',e=>{
  e.notification.close();const url=new URL(e.notification.data?.url||'/portal/',self.location.origin).href;
  e.waitUntil((async()=>{
    const abertas=await self.clients.matchAll({type:'window',includeUncontrolled:true});
    for(const c of abertas)if(new URL(c.url).origin===self.location.origin){await c.focus();c.postMessage({ratoeira:'abrir',url});return;}
    await self.clients.openWindow(url);
  })());
});
`;
