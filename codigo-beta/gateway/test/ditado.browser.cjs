// Ditado do chat contra a prévia local (agentes de mentira), com o microfone falso do Chromium. Fora do npm test:
//   PORTA=6811 node test/previa/servidor.mjs &  e  node test/ditado.browser.cjs
// Cobre: gravar e parar põe o texto no cursor; Esc descarta; conexão travada mostra "Transcrevendo" com Parar e o
// áudio fica; serviço fora do ar tenta de novo sozinho; transcrição vazia não apaga o áudio; o guardado sobrevive a
// recarregar e vira texto no "Tentar de novo"; gravação cortada (aba recarregada no meio) volta como cartão.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const BASE=process.env.BASE||'http://localhost:6811',OUT=process.env.OUT||'/tmp/';
const erros=[];const ok=(c,m)=>{console.log((c?'OK   ':'FALHA'),m);if(!c)erros.push(m);};
const espera=ms=>new Promise(r=>setTimeout(r,ms));
// modo da transcrição de mentira: 'falhar', 'travar', 'vazio' ou null (normal)
const modo=(pg,m)=>pg.evaluate(m=>new Promise(r=>{const s=new WebSocket('ws://'+location.host+'/api/agentes/ws');
  s.onopen=()=>s.send(JSON.stringify({id:1,op:'previa-ditado',modo:m}));s.onmessage=()=>{s.close();r();};}),m);
const cartao=pg=>pg.locator('#composer-novo .ditado-pendente');
const estado=async pg=>(await cartao(pg).count())?cartao(pg).first().getAttribute('data-estado'):null;
const temTexto=pg=>pg.waitForFunction(()=>document.querySelector('#composer-novo textarea').value.includes('Ratoeira'),null,{timeout:8000});
async function abrirNova(pg){
  // mesmo endereço com # não recarrega: reload de verdade, como fechar e abrir a aba
  if(pg.url().startsWith(BASE))await pg.reload();else await pg.goto(BASE+'/portal/#arquivos');await espera(1200);
  await pg.locator("button[aria-label='Nova conversa']").first().click();await espera(800);
  return {caixa:pg.locator('#composer-novo textarea'),mic:pg.locator('#composer-novo .microfone')};
}
(async()=>{
  const b=await chromium.launch({args:['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream']});
  const ctx=await b.newContext({viewport:{width:1400,height:900},permissions:['microphone']});
  const pg=await ctx.newPage();const logs=[];pg.on('pageerror',e=>logs.push(e.message));
  let {caixa,mic}=await abrirNova(pg);
  ok(await mic.isVisible(),'botão de microfone aparece no compositor');
  await caixa.fill('antes');await caixa.press('End');
  await mic.click();await espera(2300);
  ok(await pg.locator('#composer-novo .composer.ditando').count()===1,'caixa fica em modo gravando');
  const t=await pg.locator('#composer-novo .ditado-tempo').innerText();
  ok(/^0:0[1-9]$/.test(t),'contador andando ('+t+')');
  await pg.screenshot({path:OUT+'ditado-gravando.png'});
  await mic.click();await temTexto(pg);
  let v=await caixa.inputValue();
  ok(v.startsWith('antes faz o deploy da Ratoeira'),'texto entra depois do que já tinha, com espaço: '+v);
  ok(/ [23] s\)/.test(v),'duração vai junto');
  ok(await pg.locator('#composer-novo .ditado-pendente').count()===0,'sem áudio guardado depois de dar certo');

  await caixa.fill('');
  await mic.click();await espera(1200);await pg.keyboard.press('Escape');await espera(1200);
  ok(await caixa.inputValue()===''&&await pg.locator('#composer-novo .ditado-pendente').count()===0,'Esc descarta sem texto e sem guardar');

  // conexão meio morta: fica "Transcrevendo" com Parar; Parar vira "Não transcreveu" e o áudio continua
  await modo(pg,'travar');
  await mic.click();await espera(1800);await mic.click();await espera(1500);
  ok(await estado(pg)==='transcrevendo','conexão travada: cartão "Transcrevendo" aparece na hora');
  await pg.screenshot({path:OUT+'ditado-transcrevendo.png'});
  await pg.locator('#composer-novo .ditado-parar').click();await espera(300);
  ok(await estado(pg)==='erro'&&await pg.locator('#composer-novo .ditado-tentar').isVisible(),'Parar: vira "Não transcreveu" com Tentar de novo');

  // serviço fora do ar: guarda e tenta de novo sozinho em 5 s
  await modo(pg,'falhar');
  await pg.locator('#composer-novo .ditado-tentar').click();await espera(1500);
  ok(await estado(pg)==='erro'&&/de novo em/.test(await cartao(pg).innerText()),'fora do ar: mostra "de novo em N s"');
  await pg.screenshot({path:OUT+'ditado-guardado.png'});
  // recarregar no meio: o áudio volta como cartão
  ({caixa,mic}=await abrirNova(pg));await espera(600);
  ok(await estado(pg)==='erro','depois de recarregar, o áudio continua lá');
  await modo(pg,null);
  await pg.locator('#composer-novo .ditado-tentar').click();await temTexto(pg);
  ok(await cartao(pg).count()===0,'Tentar de novo: texto na caixa e o cartão some');
  const n=await pg.evaluate(()=>new Promise(r=>{const q=indexedDB.open('ratoeira-ditado');q.onsuccess=()=>{const t=q.result.transaction(['gravacoes','pedacos']);
    const a=t.objectStore('gravacoes').count(),b=t.objectStore('pedacos').count();t.oncomplete=()=>r([a.result,b.result]);};}));
  ok(n[0]===0&&n[1]===0,'IndexedDB limpo depois de transcrever ('+n+')');

  // tentativa automática: falha uma vez e volta sozinho, sem clicar
  await caixa.fill('');await modo(pg,'falhar');
  await mic.click();await espera(1500);await mic.click();await espera(1800);
  await modo(pg,null);
  await temTexto(pg);
  ok(await cartao(pg).count()===0,'fora do ar e depois volta: transcreveu sozinho na segunda tentativa');

  // transcrição vazia: o áudio não some
  await caixa.fill('');await modo(pg,'vazio');
  await mic.click();await espera(1500);await mic.click();await espera(1800);
  ok(await estado(pg)==='vazio','não veio texto: cartão "Não entendi nada" e o áudio fica');
  await modo(pg,null);
  await pg.locator('#composer-novo .ditado-tentar').click();await temTexto(pg);

  await caixa.fill('');await mic.click();await espera(2600);
  ({caixa,mic}=await abrirNova(pg));await espera(600);
  const chip=cartao(pg);
  ok(await chip.count()===1&&/interrompida/.test(await chip.getAttribute('title')||''),'gravação cortada volta como cartão');
  await pg.locator('#composer-novo .ditado-tentar').click();await temTexto(pg);
  ok(true,'gravação cortada também vira texto');

  const m=await b.newContext({viewport:{width:390,height:800},isMobile:true,hasTouch:true,permissions:['microphone']});
  const mp=await m.newPage();mp.on('pageerror',e=>logs.push(e.message));
  await mp.goto(BASE+'/portal/#arquivos');await espera(1500);
  // no celular a conversa nova sai do menu ⋯ do painel: abre pelo mesmo atalho que a árvore usa
  await mp.evaluate(()=>window.ratoeiraNovaConversa({}));await espera(1200);
  const mmic=mp.locator('#composer-novo .microfone');
  ok(await mmic.isVisible(),'microfone aparece no celular');
  await mmic.tap();await espera(1500);
  const w=await mp.evaluate(()=>document.documentElement.scrollWidth);
  ok(w<=390,'sem rolagem lateral gravando no celular ('+w+')');
  await mp.screenshot({path:OUT+'ditado-celular.png'});
  await mmic.tap();await espera(1500);
  ok(!logs.length,'sem erro de JS: '+logs.slice(0,3).join(' | '));
  await b.close();
  console.log('\n'+erros.length+' falha(s)');process.exit(erros.length?1:0);
})().catch(e=>{console.error(e);process.exit(1);});
