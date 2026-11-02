// Anexo de arquivo no chat contra a prévia local (agentes de mentira). Fora do npm test:
//   PORTA=6811 node test/previa/servidor.mjs &  e  node test/anexos.browser.cjs
// Cobre: o clipe aceita qualquer arquivo (imagem vira miniatura, o resto etiqueta com nome e tamanho); × tira;
// enviar sobe o arquivo e o balão mostra a etiqueta, sem o <ratoeira-anexos> à vista; soltar arquivo na caixa da
// conversa aberta manda só o arquivo (sem balão vazio); pasta solta avisa em vez de sumir.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const BASE=process.env.BASE||'http://localhost:6811',OUT=process.env.OUT||'/tmp/';
const erros=[];const ok=(c,m)=>{console.log((c?'OK   ':'FALHA'),m);if(!c)erros.push(m);};
const espera=ms=>new Promise(r=>setTimeout(r,ms));
const PNG=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==','base64');
// solta arquivos na caixa como o Finder faz (DataTransfer com File)
const soltar=(pg,sel,arquivos)=>pg.evaluate(({sel,arquivos})=>{
  const alvo=[...document.querySelectorAll(sel)].pop();const dt=new DataTransfer();
  for(const a of arquivos)dt.items.add(new File([a.texto],a.nome,{type:a.tipo}));
  alvo.dispatchEvent(new DragEvent('dragover',{dataTransfer:dt,bubbles:true,cancelable:true}));
  alvo.dispatchEvent(new DragEvent('drop',{dataTransfer:dt,bubbles:true,cancelable:true}));
},{sel,arquivos});

(async()=>{
  const browser=await chromium.launch();const pg=await browser.newPage({viewport:{width:1400,height:900}});
  const errosJs=[];pg.on('pageerror',e=>errosJs.push(e.message));
  await pg.goto(BASE+'/portal/#arquivos');await espera(1200);
  await pg.locator("button[aria-label='Nova conversa']").first().click();await espera(800);
  const nova='#composer-novo';
  ok(await pg.locator(nova+' .clipe').getAttribute('title')==='Anexar arquivo ou imagem','clipe diz que aceita arquivo');
  await pg.locator(nova+' input[type=file]').setInputFiles([
    {name:'relatorio.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4 '+'x'.repeat(3000))},
    {name:'vendas.csv',mimeType:'text/csv',buffer:Buffer.from('mes,valor\nset,10\n')},
    {name:'print.png',mimeType:'image/png',buffer:PNG}]);
  await espera(400);
  ok(await pg.locator(nova+' .anexo-arquivo').count()===2,'dois arquivos viram etiqueta');
  ok(await pg.locator(nova+' .anexo img').count()===1,'a imagem segue como miniatura');
  ok((await pg.locator(nova+' .anexo-arquivo').first().innerText()).includes('3 KB'),'etiqueta mostra o tamanho');
  await pg.screenshot({path:OUT+'anexos-1-caixa.png'});
  await pg.locator(nova+' .anexo-arquivo .anexo-x').nth(1).click();
  ok(await pg.locator(nova+' .anexo-arquivo').count()===1,'× tira o arquivo');
  await pg.locator(nova+' textarea').fill('Lê esse relatório');
  await pg.locator(nova+' textarea').press('Enter');
  await pg.waitForSelector('.msg.user .etiqueta',{timeout:8000});await espera(800);
  const balao=pg.locator('.msg.user').first();
  ok((await balao.locator('.etiqueta').innerText()).includes('relatorio.pdf'),'balão mostra a etiqueta do arquivo');
  ok((await balao.locator('.balao').innerText()).trim()==='Lê esse relatório','balão mostra só o texto');
  ok(!(await balao.innerText()).includes('ratoeira-anexos'),'o bloco pro agente não aparece');
  ok(await pg.locator('.msg.user img.msg-img').count()===1,'a imagem foi junto');
  // na conversa aberta: soltar arquivo e mandar sem texto
  await soltar(pg,'.composer:not(#composer-novo)',[{nome:'notas.md',tipo:'text/markdown',texto:'# oi'}]);await espera(300);
  ok(await pg.locator('.composer:not(#composer-novo) .anexo-arquivo').count()===1,'arquivo solto na caixa da conversa vira etiqueta');
  await pg.locator('.composer:not(#composer-novo) textarea').last().press('Enter');
  await pg.waitForFunction(()=>[...document.querySelectorAll('.msg.user .etiqueta')].some(e=>e.innerText.includes('notas.md')),null,{timeout:8000});
  const so=pg.locator('.msg.user',{has:pg.locator('.etiqueta',{hasText:'notas.md'})});
  ok(await so.locator('.balao').count()===0,'só arquivo: sem balão vazio');
  // pasta do Finder chega vazia e sem tipo: avisa
  await soltar(pg,'.composer:not(#composer-novo)',[{nome:'Downloads',tipo:'',texto:''}]);await espera(300);
  ok(await pg.locator('.composer:not(#composer-novo) .anexo-arquivo').count()===0,'pasta não vira anexo');
  ok((await pg.locator('body').innerText()).includes('Pasta não dá pra soltar aqui'),'pasta avisa');
  await pg.screenshot({path:OUT+'anexos-2-conversa.png'});
  ok(!errosJs.length,'sem erro de JavaScript'+(errosJs.length?': '+errosJs.join(' | '):''));
  await browser.close();
  console.log(erros.length?`\n${erros.length} falha(s)`:'\ntudo certo');process.exit(erros.length?1:0);
})().catch(e=>{console.error(e);process.exit(1);});
