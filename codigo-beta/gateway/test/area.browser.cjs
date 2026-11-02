// Seletor de área na Mesa (reporte 35): aparece com duas áreas, troca pelo POST /area e guarda as abas por área.
// Rodar: node test/area.browser.cjs (com o Playwright compartilhado da Ratoeira).
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const {readFileSync}=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');

(async()=>{
  const browser=await chromium.launch({headless:true});
  try{
    const page=await browser.newPage({viewport:{width:1440,height:960}});
    const erros=[];page.on('pageerror',e=>erros.push(e.message));
    let aberta='time';const pedidos=[];
    const lista=[{id:'time',nome:'Time'},{id:'natus',nome:'Natus'}];
    await page.route('https://ratoeira.test/**',async route=>{
      const req=route.request(),pathname=new URL(req.url()).pathname;
      let body,contentType='application/json';
      if(pathname==='/_ratoeira/api/portal')body={user:{email:'gil@example.com',name:'Gil',ownAccount:true},apps:[],files:true,areas:{lista,aberta}};
      else if(pathname==='/_ratoeira/api/area'){pedidos.push(JSON.parse(req.postData()));aberta=pedidos.at(-1).id;body={lista,aberta};}
      else if(pathname.startsWith('/_ratoeira/api/'))body={};
      else{
        const file=pathname==='/portal/'?'portal.html':pathname.split('/').pop();
        try{body=readFileSync(path.join(__dirname,'../public',file));contentType=file.endsWith('.css')?'text/css':file.endsWith('.js')?'text/javascript':file.endsWith('.html')?'text/html':'application/octet-stream';}
        catch{await route.fulfill({status:404,body:'Missing fixture'});return;}
      }
      await route.fulfill({status:200,contentType,body:typeof body==='object'&&!Buffer.isBuffer(body)?JSON.stringify(body):body});
    });
    await page.goto('https://ratoeira.test/portal/#arquivos');
    const sel=page.getByRole('combobox',{name:'Área aberta na Mesa'});
    await sel.waitFor({state:'visible'});
    assert.deepEqual(await sel.locator('option').allTextContents(),['Área: Time','Área: Natus']);
    assert.equal(await sel.inputValue(),'time');
    const ls=()=>page.evaluate(()=>[localStorage.getItem('ratoeira:area'),localStorage.getItem('ratoeira:area-base')]);
    assert.deepEqual(await ls(),['time','time']);
    await Promise.all([page.waitForEvent('load'),sel.selectOption('natus')]);
    assert.deepEqual(pedidos,[{id:'natus'}]);
    await sel.waitFor({state:'visible'});
    assert.equal(await sel.inputValue(),'natus');
    assert.deepEqual(await ls(),['natus','time']);
    // a área foi trocada em outro aparelho: este recarrega uma vez e fica nela
    aberta='time';
    await page.reload();await page.waitForFunction(()=>localStorage.getItem('ratoeira:area')==='time');
    await sel.waitFor({state:'visible'});assert.equal(await sel.inputValue(),'time');
    await page.screenshot({path:process.env.PRINT||'/dev/null'}).catch(()=>{});
    assert.deepEqual(erros,[]);
    console.log('ok: seletor de área');
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
