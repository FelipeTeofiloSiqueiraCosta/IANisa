// Playground: experimentos em Docker num endereço só (apps.exemplo.com/<nome>/) ou no domínio de cada um, com o login
// da Ratoeira por troca de código.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtemp,rm,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createPlayground,lerManifesto,COOKIE_PLAY} from '../playground.mjs';

test('manifesto: nome igual à pasta, porta válida, domínio opcional',()=>{
  assert.equal(lerManifesto('{"porta":8000}','demo').porta,8000);
  assert.match(lerManifesto('{"nome":"outro","porta":8000}','demo').erro,/igual à pasta/);
  assert.match(lerManifesto('{"porta":80}','demo').erro,/porta/);
  assert.match(lerManifesto('{"porta":8000,"dominio":"não é host"}','demo').erro,/dominio/);
  assert.equal(lerManifesto('{"porta":8000,"dominio":"Demo.Exemplo.com","publico":true}','demo').dominio,'demo.exemplo.com');
  assert.match(lerManifesto('nada','demo').erro,/JSON/);
});

async function montar(t,manifesto){
  const dir=await mkdtemp(path.join(tmpdir(),'ratoeira-play-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const vistos=[];
  const up=http.createServer((req,res)=>{vistos.push({...req.headers,caminho:req.url});res.end('oi do container');});
  await new Promise(r=>up.listen(0,'127.0.0.1',r));t.after(()=>up.close());
  await mkdir(path.join(dir,'area','playground','demo'),{recursive:true});
  await writeFile(path.join(dir,'area','playground','demo','ratoeira-play.json'),JSON.stringify({porta:up.address().port,...manifesto}));
  await mkdir(path.join(dir,'estado'));
  await writeFile(path.join(dir,'estado.json'),JSON.stringify({em:'2026-10-13T00:00:00Z',containers:[{nome:'demo',estado:'running',memoriaMB:120,cpu:1.5},{nome:'orfao',estado:'exited'}]}));
  const pg=createPlayground({areas:[{id:'time',caminho:path.join(dir,'area')}],estadoDir:path.join(dir,'estado'),hostname:'ratoeira.exemplo.com',estadoArquivo:path.join(dir,'estado.json')});
  t.after(()=>pg.fechar());
  pg.definirBase('apps.exemplo.com');
  let ativas=new Set(['ana@x.com']);pg.usarContas(e=>ativas.has(e));
  // um servidor que faz o papel do gateway: endereço de experimento ou, no principal, /_ratoeira/play/entrar
  const gw=http.createServer((req,res)=>{
    if(pg.tratar(req,res,{cookiesFora:['ratoeira_sessao']}))return;
    if(req.url.startsWith('/_ratoeira/play/entrar'))return pg.entrar(req,res,'ana@x.com');
    res.writeHead(404);res.end('principal');
  });
  await new Promise(r=>gw.listen(0,'127.0.0.1',r));t.after(()=>gw.close());
  const pedir=(host,url,cookie)=>new Promise((ok,no)=>{http.get({host:'127.0.0.1',port:gw.address().port,path:url,headers:{host,...(cookie?{cookie}:{})}},r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>ok({status:r.statusCode,headers:r.headers,corpo:d}));}).on('error',no);});
  return {pg,pedir,vistos,desativar:e=>ativas.delete(e),dir};
}

test('privado: sem cookie vai pro login da Ratoeira, volta com código e ganha cookie só daquele endereço',async t=>{
  const {pedir,vistos,desativar}=await montar(t,{titulo:'Demo'});
  const host='apps.exemplo.com';
  // sem a barra no fim, vai pra com barra
  assert.equal((await pedir(host,'/demo')).headers.location,'/demo/');
  const r1=await pedir(host,'/demo/painel?x=1');
  assert.equal(r1.status,302);
  const entrar=new URL(r1.headers.location);
  assert.equal(entrar.host,'ratoeira.exemplo.com');assert.equal(entrar.pathname,'/_ratoeira/play/entrar');
  assert.equal(entrar.searchParams.get('host'),host);assert.equal(entrar.searchParams.get('volta'),'/demo/painel?x=1');
  const r2=await pedir('ratoeira.exemplo.com',entrar.pathname+entrar.search);
  const voltar=new URL(r2.headers.location);
  assert.equal(voltar.host,host);
  const r3=await pedir(host,voltar.pathname+voltar.search);
  assert.equal(r3.status,302);assert.equal(r3.headers.location,'/demo/painel?x=1');
  const cookie=r3.headers['set-cookie'][0].split(';')[0];
  assert.match(r3.headers['set-cookie'][0],/HttpOnly; Secure; SameSite=Lax/);
  // código é de uso único
  assert.equal((await pedir(host,voltar.pathname+voltar.search)).status,400);
  // com o cookie, chega no container; sem nenhum cookie da Ratoeira, com quem é
  const r4=await pedir(host,'/demo/painel',`${cookie}; ratoeira_sessao=segredo; tema=claro`);
  assert.equal(r4.status,200);assert.equal(r4.corpo,'oi do container');
  assert.equal(vistos.at(-1).cookie,'tema=claro');
  assert.equal(vistos.at(-1)['x-ratoeira-email'],'ana@x.com');
  assert.equal(vistos.at(-1).host,host);
  // o caminho chega inteiro, com o prefixo dito no cabeçalho
  assert.equal(vistos.at(-1).caminho,'/demo/painel');assert.equal(vistos.at(-1)['x-forwarded-prefix'],'/demo');
  // caminho que não é de experimento
  assert.equal((await pedir(host,'/nada/',cookie)).status,404);
  // o cookie não vale em outro endereço, nem forjado, nem pra quem foi desativado
  assert.equal((await pedir('ratoeira.exemplo.com','/x',cookie)).status,404);
  assert.equal((await pedir(host,'/demo/painel',cookie.replace(/.$/,c=>c==='a'?'b':'a'))).status,302);
  desativar('ana@x.com');
  assert.equal((await pedir(host,'/demo/painel',cookie)).status,302);
});

test('público abre sem login; com domínio próprio abre na raiz dele e o caminho redireciona pra lá',async t=>{
  const {pg,pedir,vistos,dir}=await montar(t,{publico:true});
  const r=await pedir('apps.exemplo.com','/demo/');
  assert.equal(r.status,200);assert.equal(r.corpo,'oi do container');assert.equal(vistos.at(-1)['x-ratoeira-email'],undefined);
  await writeFile(path.join(dir,'area','playground','demo','ratoeira-play.json'),JSON.stringify({porta:Number(JSON.parse((await import('node:fs')).readFileSync(path.join(dir,'area','playground','demo','ratoeira-play.json'),'utf8')).porta),publico:true,dominio:'demo.cliente.com'}));
  await new Promise(r=>setTimeout(r,5100));   // o registro é relido a cada 5 s
  const r2=await pedir('apps.exemplo.com','/demo/x?y=1');
  assert.equal(r2.status,301);assert.equal(r2.headers.location,'https://demo.cliente.com/x?y=1');
  const r3=await pedir('demo.cliente.com','/x');
  assert.equal(r3.corpo,'oi do container');assert.equal(vistos.at(-1).caminho,'/x');assert.equal(vistos.at(-1)['x-forwarded-prefix'],undefined);
  assert.deepEqual(pg.paraTela().itens.find(i=>i.nome==='demo').enderecos,['https://demo.cliente.com/','https://apps.exemplo.com/demo/']);
  // endereço que não é do Playground segue pro gateway
  assert.equal((await pedir('outro.exemplo.com','/')).corpo,'principal');
});

test('entrar só emite código pra endereço de experimento (nada de redirecionar pra qualquer lugar)',async t=>{
  const {pedir}=await montar(t,{});
  const r=await pedir('ratoeira.exemplo.com','/_ratoeira/play/entrar?host=evil.com&volta=/');
  assert.equal(r.status,404);
  const r2=await pedir('ratoeira.exemplo.com','/_ratoeira/play/entrar?host=apps.exemplo.com&volta=//evil.com');
  assert.match(r2.headers.location,/volta=%2F$/);
});

test('tela: estado dos containers, órfão aparece, padrão validado',async t=>{
  const {pg}=await montar(t,{titulo:'Demo',dono:'Ana@x.com'});
  const tela=pg.paraTela();
  assert.equal(tela.base,'apps.exemplo.com');
  const demo=tela.itens.find(i=>i.nome==='demo');
  assert.equal(demo.estado,'ligado');assert.equal(demo.memoriaMB,120);assert.equal(demo.dono,'ana@x.com');
  assert.deepEqual(demo.enderecos,['https://apps.exemplo.com/demo/']);
  assert.match(tela.itens.find(i=>i.nome==='orfao').erro,/sem pasta/);
  assert.throws(()=>pg.definirBase('apps.exemplo.com/caminho'),/sem caminho/);
  assert.throws(()=>pg.definirBase('ratoeira.exemplo.com'),/diferente/);
  assert.equal(pg.definirBase('https://Apps.Exemplo.com/').base,'apps.exemplo.com');
  assert.equal(pg.definirBase('').base,null);
  assert.deepEqual(pg.paraTela().itens.find(i=>i.nome==='demo').enderecos,[]);
});

// ── Página (estático, sem Docker) ──
import {createHash} from 'node:crypto';
import {symlink} from 'node:fs/promises';
async function montarPagina(t,manifesto,{pastaExterna=false}={}){
  const dir=await mkdtemp(path.join(tmpdir(),'ratoeira-pag-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const item=path.join(dir,'area','playground','proposta');await mkdir(path.join(item,'img'),{recursive:true});
  const raiz=pastaExterna?path.join(dir,'area','Clientes','acme'):item;await mkdir(raiz,{recursive:true});
  await writeFile(path.join(raiz,'index.html'),'<h1>Proposta Acme</h1>');
  await mkdir(path.join(raiz,'img'),{recursive:true});await writeFile(path.join(raiz,'img','logo.svg'),'<svg/>');
  await writeFile(path.join(raiz,'.env'),'SEGREDO=1');
  await writeFile(path.join(dir,'fora.txt'),'fora da área');await symlink(path.join(dir,'fora.txt'),path.join(raiz,'atalho.txt'));
  await writeFile(path.join(item,'ratoeira-play.json'),JSON.stringify({tipo:'pagina',titulo:'Proposta Acme',...(pastaExterna?{pasta:'Clientes/acme'}:{}),...manifesto}));
  await mkdir(path.join(dir,'estado'));
  const pg=createPlayground({areas:[{id:'time',caminho:path.join(dir,'area')}],estadoDir:path.join(dir,'estado'),hostname:'ratoeira.exemplo.com',estadoArquivo:path.join(dir,'nada.json')});
  t.after(()=>pg.fechar());pg.definirBase('apps.exemplo.com');pg.usarContas(e=>e==='ana@x.com');
  const gw=http.createServer((req,res)=>{if(pg.tratar(req,res,{cookiesFora:[]}))return;res.writeHead(404);res.end('principal');});
  await new Promise(r=>gw.listen(0,'127.0.0.1',r));t.after(()=>gw.close());
  const pedir=(url,{cookie,method='GET',body,headers={}}={})=>new Promise((ok,no)=>{const q=http.request({host:'127.0.0.1',port:gw.address().port,path:url,method,headers:{host:'apps.exemplo.com',...headers,...(cookie?{cookie}:{}),...(body?{'content-type':'application/x-www-form-urlencoded'}:{})}},r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>ok({status:r.statusCode,headers:r.headers,corpo:d}));});q.on('error',no);if(body)q.write(body);q.end();});
  return {pg,pedir};
}

test('página pública: serve os arquivos, sem oculto, sem manifesto, sem sair da área, com noindex',async t=>{
  const {pg,pedir}=await montarPagina(t,{acesso:'publico'});
  const r=await pedir('/proposta/');
  assert.equal(r.status,200);assert.equal(r.corpo,'<h1>Proposta Acme</h1>');assert.match(r.headers['content-type'],/text\/html/);assert.match(r.headers['x-robots-tag'],/noindex/);
  assert.equal((await pedir('/proposta/img/logo.svg')).headers['content-type'],'image/svg+xml');
  assert.equal((await pedir('/proposta/img')).headers.location,'/proposta/img/');
  for(const u of ['/proposta/.env','/proposta/ratoeira-play.json','/proposta/atalho.txt','/proposta/../../fora.txt','/proposta/%2e%2e/%2e%2e/fora.txt','/proposta/nao-existe.html'])
    assert.equal((await pedir(u)).status,404,u);
  assert.equal((await pedir('/proposta/',{method:'POST'})).status,405);
  const item=pg.paraTela().itens[0];
  assert.equal(item.tipo,'pagina');assert.equal(item.estado,'pagina');assert.equal(item.acesso,'publico');assert.equal(item.pasta,'playground/proposta');
  // onde mora na Mesa (busca e globo da árvore)
  assert.equal(item.item,'playground/proposta');assert.match(item.raizArea,/[\/]area$/);
});

test('página com senha: formulário, senha errada, senha certa vira cookie só daquele caminho',async t=>{
  const sha=createHash('sha256').update('acme2026').digest('hex');
  const {pedir}=await montarPagina(t,{acesso:'senha',senha_sha256:sha},{pastaExterna:true});
  const r1=await pedir('/proposta/img/logo.svg');
  assert.equal(r1.status,401);assert.match(r1.corpo,/pede senha/);assert.match(r1.corpo,/action="\/proposta\/_ratoeira\/senha"/);
  const errada=await pedir('/proposta/_ratoeira/senha',{method:'POST',body:'senha=nao&volta=%2Fproposta%2F'});
  assert.equal(errada.status,403);assert.match(errada.corpo,/Senha errada/);
  const certa=await pedir('/proposta/_ratoeira/senha',{method:'POST',body:'senha=acme2026&volta=%2Fproposta%2Fimg%2Flogo.svg'});
  assert.equal(certa.status,303);assert.equal(certa.headers.location,'/proposta/img/logo.svg');
  assert.match(certa.headers['set-cookie'][0],/Path=\/proposta\/; HttpOnly; Secure/);
  const cookie=certa.headers['set-cookie'][0].split(';')[0];
  const r2=await pedir('/proposta/',{cookie});assert.equal(r2.status,200);assert.equal(r2.corpo,'<h1>Proposta Acme</h1>');
  // volta pra fora do caminho não é seguida
  const fora=await pedir('/proposta/_ratoeira/senha',{method:'POST',body:'senha=acme2026&volta=https%3A%2F%2Fevil.com'});
  assert.equal(fora.headers.location,'/proposta/');
});

test('página com senha: trava depois de 10 tentativas erradas; página do time pede login',async t=>{
  const sha=createHash('sha256').update('x').digest('hex');
  const {pedir}=await montarPagina(t,{acesso:'senha',senha_sha256:sha});
  for(let i=0;i<10;i++)await pedir('/proposta/_ratoeira/senha',{method:'POST',body:'senha=nao'});
  assert.match((await pedir('/proposta/_ratoeira/senha',{method:'POST',body:'senha=x'})).corpo,/Muitas tentativas/);
  // sem Cloudflare na frente (ipHeader não é cf-connecting-ip), forjar o cabeçalho não zera a trava
  const forjado={method:'POST',body:'senha=x',headers:{'cf-connecting-ip':'203.0.113.9'}};
  assert.match((await pedir('/proposta/_ratoeira/senha',forjado)).corpo,/Muitas tentativas/);
  assert.match(lerManifesto('{"tipo":"pagina","acesso":"senha"}','p').erro,/senha_sha256/);
  assert.match(lerManifesto('{"tipo":"pagina","pasta":"../etc"}','p').erro,/pasta/);
  assert.equal(lerManifesto('{"publico":true}','p').acesso,'publico');
});

test('página só do time: sem login vai pro login da Ratoeira',async t=>{
  const {pedir}=await montarPagina(t,{});
  const r=await pedir('/proposta/');
  assert.equal(r.status,302);assert.match(r.headers.location,/^https:\/\/ratoeira\.exemplo\.com\/_ratoeira\/play\/entrar/);
});

// ── Diálogo Publicar: ao vivo, entrada, markdown, análise e "mudou desde a publicação" ──
import {utimes} from 'node:fs/promises';
async function montarDialogo(t){
  const dir=await mkdtemp(path.join(tmpdir(),'ratoeira-dlg-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const area=path.join(dir,'area'),orig=path.join(area,'Clientes','Acme Co');
  await mkdir(path.join(orig,'cortes'),{recursive:true});await mkdir(path.join(orig,'referencias'),{recursive:true});
  await writeFile(path.join(orig,'simulacao.html'),'<link href="estilo.css"><img src="cortes/a.svg"><a href="https://x.com/y">x</a><img src="/abs.png"><img src="../fora.png">');
  await writeFile(path.join(orig,'estilo.css'),'body{}');await writeFile(path.join(orig,'cortes','a.svg'),'<svg/>');
  await writeFile(path.join(orig,'gerar.py'),'print(1)');await writeFile(path.join(orig,'referencias','r.txt'),'x');
  await writeFile(path.join(orig,'notas.md'),'# Título\n\n![](cortes/a.svg)');
  await mkdir(path.join(dir,'estado'));
  const pg=createPlayground({areas:[{id:'time',caminho:area}],estadoDir:path.join(dir,'estado'),hostname:'ratoeira.exemplo.com',estadoArquivo:path.join(dir,'nada.json')});
  t.after(()=>pg.fechar());pg.definirBase('apps.exemplo.com');
  const gw=http.createServer((req,res)=>{if(pg.tratar(req,res,{cookiesFora:[]}))return;res.writeHead(404);res.end('principal');});
  await new Promise(r=>gw.listen(0,'127.0.0.1',r));t.after(()=>gw.close());
  const pedir=url=>new Promise((ok,no)=>{http.get({host:'127.0.0.1',port:gw.address().port,path:url,headers:{host:'apps.exemplo.com'}},r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>ok({status:r.statusCode,headers:r.headers,corpo:d}));}).on('error',no);});
  const publicar=async(nome,m)=>{await mkdir(path.join(area,'playground',nome),{recursive:true});await writeFile(path.join(area,'playground',nome,'ratoeira-play.json'),JSON.stringify({nome,tipo:'pagina',...m}));await new Promise(r=>setTimeout(r,5100));};
  return {pg,pedir,publicar,area,orig};
}

test('ao vivo: a entrada no /, só o que foi marcado sai da pasta original, markdown vira página',async t=>{
  const {pg,pedir,publicar}=await montarDialogo(t);
  await publicar('acme',{acesso:'publico',modo:'aovivo',origem:'Clientes/Acme Co/simulacao.html',pasta:'Clientes/Acme Co',entrada:'simulacao.html',junto:['cortes','estilo.css','notas.md']});
  const r=await pedir('/acme/');assert.equal(r.status,200);assert.match(r.corpo,/cortes\/a\.svg/);
  assert.equal((await pedir('/acme/cortes/a.svg')).status,200);
  assert.equal((await pedir('/acme/estilo.css')).headers['content-type'],'text/css; charset=utf-8');
  for(const u of ['/acme/gerar.py','/acme/referencias/r.txt'])assert.equal((await pedir(u)).status,404,u);
  const md=await pedir('/acme/notas.md');
  assert.match(md.headers['content-type'],/text\/html/);assert.match(md.corpo,/<h1>Título<\/h1>/);assert.match(md.corpo,/noindex/);
  assert.equal(pg.paraTela().itens[0].mudou,false);   // ao vivo nunca fica velho
});

test('análise: marca o que o HTML usa (relativo), lista o resto desmarcado, sugere nome e acha o que já foi publicado',async t=>{
  const {pg,publicar,orig}=await montarDialogo(t);
  const a=pg.analisar('Clientes/Acme Co/simulacao.html');
  assert.equal(a.tipo,'html');assert.equal(a.sugestao,'acme-co');assert.equal(a.existente,null);
  const marcados=a.junto.filter(j=>j.marcado).map(j=>j.caminho).sort();
  assert.deepEqual(marcados,['cortes','estilo.css']);
  assert.deepEqual(a.junto.filter(j=>!j.marcado).map(j=>j.caminho).sort(),['gerar.py','notas.md','referencias']);
  assert.equal(a.junto.find(j=>j.caminho==='cortes').arquivos,1);
  assert.deepEqual(pg.analisar('Clientes/Acme Co/notas.md').junto.filter(j=>j.marcado).map(j=>j.caminho),['cortes']);
  for(const r of ['Clientes/Acme Co/gerar.py','../x.html','Clientes/Acme Co/referencias'])assert.throws(()=>pg.analisar(r));
  // publicado como foto às 10h; o original mexido depois: "mudou"
  await publicar('acme-co',{acesso:'time',modo:'foto',origem:'Clientes/Acme Co/simulacao.html',entrada:'simulacao.html',junto:['cortes'],publicado_em:new Date(Date.now()-3600e3).toISOString()});
  const antes=new Date(Date.now()-7200e3);
  for(const f of ['simulacao.html','cortes/a.svg'])await utimes(path.join(orig,f),antes,antes);
  assert.equal(pg.analisar('Clientes/Acme Co/simulacao.html').existente.nome,'acme-co');
  assert.equal(pg.analisar('Clientes/Acme Co/simulacao.html').existente.mudou,false);
  await new Promise(r=>setTimeout(r,5100));
  await utimes(path.join(orig,'cortes','a.svg'),new Date(),new Date());
  assert.equal(pg.paraTela().itens.find(i=>i.nome==='acme-co').mudou,true);
  assert.equal(pg.analisar('Clientes/Acme Co/notas.md').sugestao,'acme-co-notas');
});
