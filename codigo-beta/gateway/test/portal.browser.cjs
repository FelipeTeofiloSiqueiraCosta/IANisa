// Run with PLAYWRIGHT_MODULE pointing to an installed Playwright, or install it locally.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const {readFileSync}=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');

(async()=>{
  const browser=await chromium.launch({headless:true});
  try{
    const page=await browser.newPage({viewport:{width:1440,height:960}});
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    let frameLoads=0;
    await page.route('http://ratoeira.test/**',async route=>{
      const pathname=new URL(route.request().url()).pathname;
      let body,contentType='application/json';
      if(pathname==='/_ratoeira/api/portal')body={user:{email:'ana@example.com',name:'Ana',canManageConnections:true},agentPath:'/agents',apps:[{id:'guia',name:'Guia da Ratoeira',description:'Como colocar suas próprias páginas neste portal.',url:'/_ratoeira/pages/guia/'}],pagesDirectory:'/home/ana/.local/share/ratoeira/pages'};
      else if(pathname==='/_ratoeira/api/connections')body={providers:[{id:'claude',name:'Claude Code',installed:true,status:'connected',account:'ana@example.com',plan:'Max'},{id:'codex',name:'Codex',installed:true,status:'connected',plan:'ChatGPT'}]};
      else if(pathname==='/_ratoeira/api/connections/flow')body={flow:null};
      else if(pathname==='/agents'){
        frameLoads++;contentType='text/html';body='<html><body><h1>Agentes de teste</h1><textarea aria-label="Mensagem"></textarea><a href="#sessao">Sessão</a></body></html>';
      }else{
        const file=pathname==='/portal/'?'portal.html':pathname.split('/').pop();
        try{body=readFileSync(path.join(__dirname,'../public',file));contentType=file.endsWith('.css')?'text/css':file.endsWith('.js')?'text/javascript':file.endsWith('.png')?'image/png':file.endsWith('.ttf')?'font/ttf':'text/html';}
        catch{await route.fulfill({status:404,body:'Missing fixture'});return;}
      }
      await route.fulfill({status:200,contentType,body:typeof body==='object'&&!Buffer.isBuffer(body)?JSON.stringify(body):body});
    });
    await page.goto('http://ratoeira.test/portal/');
    const agent=page.frameLocator('#agent-frame');
    await agent.getByRole('textbox',{name:'Mensagem'}).fill('Rascunho preservado');
    async function assertFocus(width,height){
      await page.setViewportSize({width,height});
      assert.equal(await page.locator('.sidebar').isVisible(),false);
      const box=await page.locator('#agent-frame').boundingBox();
      assert.equal(Math.round(box.width),width);
      assert.equal(Math.round(box.height),height-44);
      assert.equal(Math.round(box.x),0);
      assert.equal(await page.getByRole('link',{name:'Voltar à Ratoeira'}).isVisible(),true);
    }
    await assertFocus(1440,960);
    await assertFocus(390,844);
    await assertFocus(844,390);
    await page.getByRole('link',{name:'Voltar à Ratoeira'}).click();
    await page.getByRole('heading',{name:'Aplicações',exact:true}).waitFor();
    await page.locator('[data-nav=conexoes]').click();
    await page.getByRole('heading',{name:'Claude Code',exact:true}).waitFor();
    await page.locator('[data-nav=agentes]').click();
    assert.equal(await agent.getByRole('textbox',{name:'Mensagem'}).inputValue(),'Rascunho preservado');
    await page.getByRole('link',{name:'Voltar à Ratoeira'}).click();
    await page.getByRole('heading',{name:'Conexões',exact:true}).waitFor();
    assert.equal(frameLoads,1,'Navigation must preserve the existing iframe');
    for(const [width,height] of [[1440,960],[768,1024],[390,844]]){
      await page.setViewportSize({width,height});
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
      assert.equal(await page.locator('[data-nav=agentes]').isVisible(),true);
    }
    await page.getByRole('button',{name:'Usar tema claro'}).click();
    await page.reload();
    await page.getByRole('heading',{name:'Conexões',exact:true}).waitFor();
    assert.equal(await page.locator('html').getAttribute('data-theme'),'light');
    await page.getByRole('button',{name:'Usar tema escuro'}).click();
    await page.locator('[data-nav=agentes]').click();
    await agent.getByRole('link',{name:'Sessão'}).click();
    await page.getByRole('link',{name:'Abrir agente em nova aba'}).focus();
    assert.equal(await page.locator('#agent-external').getAttribute('href'),'http://ratoeira.test/agents#sessao');
    await page.getByRole('link',{name:'Voltar à Ratoeira'}).click();
    await page.setViewportSize({width:1440,height:960});
    if(process.env.UI_SCREENSHOT_DIR)await page.screenshot({path:path.join(process.env.UI_SCREENSHOT_DIR,'ratoeira-conexoes-desktop.png')});
    await page.locator('[data-nav=aplicacoes]').click();
    await page.getByRole('heading',{name:'Aplicações',exact:true}).waitFor();
    await page.mouse.move(0,0);
    if(process.env.UI_SCREENSHOT_DIR)await page.screenshot({path:path.join(process.env.UI_SCREENSHOT_DIR,'ratoeira-aplicacoes-desktop.png')});
    await page.setViewportSize({width:390,height:844});
    if(process.env.UI_SCREENSHOT_DIR)await page.screenshot({path:path.join(process.env.UI_SCREENSHOT_DIR,'ratoeira-aplicacoes-mobile.png')});
    assert.deepEqual(errors,[]);
    console.log('PASS: full-width agent at 3 sizes, return to previous module, draft/iframe preserved, current-session link, theme persistence, no overflow or runtime errors.');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
