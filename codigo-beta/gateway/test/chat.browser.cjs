// Compositor do chat: Enter repetido não duplica conversa, e no celular o Enter quebra linha.
// Usa um SDK do Paseo falso (criar conversa demora 1,5 s), sem tocar em agente real.
// Run with PLAYWRIGHT_MODULE pointing to an installed Playwright, or install it locally.
const {chromium,webkit,devices}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const {readFileSync}=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');

const SDK_FALSO=`
window.__criadas=[];window.__enviadas=[];
const espera=ms=>new Promise(r=>setTimeout(r,ms));
export class DaemonClient{constructor(){}subscribeConnectionStatus(){}async connect(){}async cancelAgent(){}}
export class Marked{parse(t){return t;}}
export const DOMPurify={sanitize:h=>h};
export function createPaseoApi(){return{
  providers:{
    listAvailable:async()=>({providers:[{provider:'claude',available:true}]}),
    listModels:async()=>({models:[{id:'opus',label:'Opus',isDefault:true,thinkingOptions:[]}]}),
    listModes:async()=>({modes:[{id:'auto',label:'Auto'}]}),
  },
  agents:{
    list:async()=>({agents:[]}),
    create:async opts=>{window.__criadas.push(opts.prompt);await espera(1500);return{id:'a'+window.__criadas.length};},
    ref:id=>({refresh:async()=>{},current:()=>({status:'idle'}),send:async t=>{window.__enviadas.push(t);},
      timeline:{subscribe:()=>()=>{},refetch:async()=>({entries:[]})}}),
  },
};}
`;

async function cenario(tipo,contexto,{toque}){
  const browser=await tipo.launch({headless:true});
  try{
    const page=await browser.newPage(contexto);
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.route('https://ratoeira.test/**',async route=>{
      const pathname=new URL(route.request().url()).pathname;
      let body,contentType='application/json';
      if(pathname==='/_ratoeira/api/portal')body={user:{email:'ana@example.com',name:'Ana'},agentPath:'/agents',apps:[],files:true,chat:{cliente:'/_ratoeira/sdk-falso.js',paseo:'0.9.1',pastaPadrao:'/home/ana/trabalho'}};
      else if(pathname==='/_ratoeira/sdk-falso.js'){contentType='text/javascript';body=SDK_FALSO;}
      else if(pathname.startsWith('/_ratoeira/api/arquivos/arvore'))body={caminho:'',itens:[]};
      else if(pathname.startsWith('/_ratoeira/api/arquivos/estado'))body={};
      else if(pathname.startsWith('/_ratoeira/api/'))body={};
      else if(pathname==='/agents'){contentType='text/html';body='<html><body></body></html>';}
      else{
        const file=pathname==='/portal/'?'portal.html':pathname.split('/').pop();
        try{body=readFileSync(path.join(__dirname,'../public',file));contentType=file.endsWith('.css')?'text/css':file.endsWith('.js')?'text/javascript':file.endsWith('.png')?'image/png':file.endsWith('.ttf')?'font/ttf':'text/html';}
        catch{await route.fulfill({status:404,body:'Missing fixture'});return;}
      }
      await route.fulfill({status:200,contentType,body:typeof body==='object'&&!Buffer.isBuffer(body)?JSON.stringify(body):body});
    });
    await page.goto('https://ratoeira.test/portal/#arquivos');
    await page.locator('#chat-toggle').waitFor({state:'visible'});
    await page.locator('#chat-toggle').click();
    const caixa=page.locator('#composer-novo textarea');
    await caixa.waitFor({state:'visible'});
    const dica=await page.locator('.novo-dica').textContent();

    if(toque){
      // Enter quebra linha e não envia; quem envia é o botão.
      await caixa.click();await caixa.pressSequentially('linha 1');await caixa.press('Enter');await caixa.pressSequentially('linha 2');
      assert.equal(await caixa.inputValue(),'linha 1\nlinha 2');
      assert.deepEqual(await page.evaluate(()=>window.__criadas),[]);
      assert.match(dica,/Enter quebra linha/);
      await page.locator('#composer-novo button.enviar').tap();
    }else{
      // Enter 5 vezes seguidas enquanto a conversa está sendo criada.
      await caixa.fill('faz um resumo');
      for(let i=0;i<5;i++)await caixa.press('Enter');
      assert.equal(await caixa.inputValue(),'faz um resumo','O texto fica à vista enquanto cria');
      assert.equal(await caixa.isDisabled(),true,'A caixa trava no primeiro Enter');
      assert.match(await page.locator('#composer-novo .composer-status').textContent(),/^Ligando o /);
      assert.match(dica,/Shift\+Enter quebra linha/);
    }
    await page.locator('.conv:not([hidden]) textarea').waitFor({state:'visible'});
    const criadas=await page.evaluate(()=>window.__criadas);
    assert.deepEqual(criadas,[toque?'linha 1\nlinha 2':'faz um resumo'],'Uma conversa só');
    // Depois de criada, a caixa da nova conversa volta ao normal.
    assert.equal(await caixa.isDisabled(),false);
    assert.equal(await caixa.inputValue(),'','Depois de criada, a caixa esvazia');
    assert.equal(await page.locator('#composer-novo .composer-status').count(),0);
    assert.deepEqual(errors,[]);
  }finally{await browser.close();}
}

(async()=>{
  await cenario(chromium,{viewport:{width:1440,height:960}},{toque:false});
  console.log('ok desktop: 5 Enters = 1 conversa');
  await cenario(webkit,{...devices['iPhone 13']},{toque:true});
  console.log('ok celular (WebKit 390px): Enter quebra linha, botão envia');
})().catch(e=>{console.error(e);process.exit(1);});
