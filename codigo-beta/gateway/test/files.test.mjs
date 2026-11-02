import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtemp,mkdir,writeFile,readFile,symlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createGateway} from '../server.mjs';
import {createPortal} from '../portal.mjs';

async function repoDeTeste(dir){
  const repo=path.join(dir,'repo');const pasta=path.join(repo,'Clientes','Acme Clínicas');
  await mkdir(pasta,{recursive:true});
  await writeFile(path.join(pasta,'notas.md'),'# Título\n\n- item\n  - sub\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n<script>alert(1)</script>\n');
  await writeFile(path.join(pasta,'pagina.html'),'<h1>oi</h1><script>parent.x=1</script>');
  await writeFile(path.join(pasta,'logo.svg'),'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
  await writeFile(path.join(pasta,'foto.png'),Buffer.from([137,80,78,71,0,0,0,0]));
  await writeFile(path.join(pasta,'dados.bin'),Buffer.from([1,0,2,0,3]));
  await writeFile(path.join(repo,'.gitignore'),'.env\nsolto/\n');
  await writeFile(path.join(repo,'.env'),'SEGREDO=cru\n');
  await mkdir(path.join(repo,'solto'));await writeFile(path.join(repo,'solto','x.md'),'não versionado');
  await writeFile(path.join(dir,'fora.txt'),'fora do repo');
  await symlink(path.join(dir,'fora.txt'),path.join(repo,'atalho.txt'));
  await mkdir(path.join(dir,'outra'));await symlink(path.join(dir,'outra'),path.join(repo,'atalho-pasta'));
  const git=(...a)=>execFileSync('git',['-C',repo,...a],{stdio:'pipe'});
  git('init','-q');git('add','-A');git('-c','user.name=t','-c','user.email=t@t','commit','-qm','x');
  return repo;
}

test('arquivos: a pasta como está no disco (fora a .git), sem travessia, sem symlink, HTML/SVG em sandbox',async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'ratoeira-arquivos-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const repoDir=await repoDeTeste(dir);
  const portal=createPortal({hostname:'ratoeira.example.com',agentPath:'/new',dataDir:dir,pagesDir:path.join(dir,'pages'),repoDir,syncRequestFile:path.join(dir,'pedido-sync'),syncStateFile:path.join(dir,'ultimo.json')},{runtime:{status:async()=>({}),launch:()=>{},backup:async()=>{}}});
  const gateway=createGateway({hostname:'ratoeira.example.com',password:'test',verify:async token=>{if(token!=='ana')throw new Error();return {email:'ana@example.com',exp:Math.floor(Date.now()/1000)+300};},portal});
  await new Promise(r=>gateway.listen(0,'127.0.0.1',r));t.after(()=>gateway.shutdown());
  const base='http://127.0.0.1:'+gateway.address().port,auth={'cf-access-jwt-assertion':'ana'};
  const get=(p,h=auth)=>fetch(base+p,{headers:h});
  const pasta='/Clientes/Acme%20Cl%C3%ADnicas';

  for(const p of ['/_ratoeira/api/arquivos/arvore','/_ratoeira/arquivo'+pasta+'/notas.md','/_ratoeira/ver'+pasta+'/notas.md','/_ratoeira/fonte'+pasta+'/notas.md'])
    assert.equal((await get(p,{})).status,401,'sem login: '+p);

  const raiz=await (await get('/_ratoeira/api/arquivos/arvore')).json();
  const nomes=raiz.itens.map(i=>i.nome);
  // desde 19/10/2026 nada some: o ignorado aparece, com o sinal foraDoGit; só a .git fica de fora
  assert.ok(raiz.itens.find(i=>i.nome==='.env')?.foraDoGit,'.env aparece, marcado fora do git');
  assert.ok(raiz.itens.find(i=>i.nome==='solto')?.foraDoGit,'pasta ignorada aparece, marcada');
  assert.ok(!nomes.includes('.git'),'a .git não aparece');
  assert.ok(!raiz.itens.find(i=>i.nome==='Clientes').foraDoGit,'o que o git guarda vem sem o sinal');
  assert.ok(nomes.includes('Clientes'));assert.equal(raiz.itens[0].tipo,'pasta','pastas primeiro');
  assert.equal(raiz.itens.find(i=>i.nome==='atalho.txt').tipo,'atalho');
  assert.equal(raiz.itens.find(i=>i.nome==='atalho.txt').alvo,undefined,'atalho pra arquivo não vira pasta');
  assert.deepEqual(['tipo','alvo'].map(k=>raiz.itens.find(i=>i.nome==='atalho-pasta')[k]),['atalho','pasta'],'atalho pra pasta diz o destino');
  assert.equal((await get('/_ratoeira/api/arquivos/arvore?caminho=atalho-pasta')).status,404,'mas não entra nele');
  const sub=await (await get('/_ratoeira/api/arquivos/arvore?caminho='+encodeURIComponent('Clientes/Acme Clínicas'))).json();
  assert.ok(sub.itens.some(i=>i.nome==='notas.md'&&i.tamanho>0));
  const comFilhos=await (await get('/_ratoeira/api/arquivos/arvore?subpastas=1')).json();
  assert.deepEqual(comFilhos.filhos['Clientes'].map(i=>i.nome),['Acme Clínicas'],'subpastas=1 traz o conteúdo das subpastas junto');
  assert.equal(raiz.filhos,undefined,'sem subpastas=1, não traz');

  const busca=await (await get('/_ratoeira/api/arquivos/busca?q=NOTAS')).json();
  assert.equal(busca.itens[0].caminho,'Clientes/Acme Clínicas/notas.md');
  const buscaPasta=await (await get('/_ratoeira/api/arquivos/busca?q=acme')).json();
  assert.deepEqual(buscaPasta.itens.map(i=>[i.caminho,i.tipo]),[['Clientes/Acme Clínicas','pasta']],'acha a pasta pelo nome, sem listar cada arquivo dela');
  const buscaCaminho=await (await get('/_ratoeira/api/arquivos/busca?q='+encodeURIComponent('clínicas/pag'))).json();
  assert.equal(buscaCaminho.itens[0].caminho,'Clientes/Acme Clínicas/pagina.html');
  const buscar=async q=>(await (await get('/_ratoeira/api/arquivos/busca?q='+encodeURIComponent(q))).json()).itens.map(i=>i.caminho);
  assert.deepEqual(await buscar('clinicas'),['Clientes/Acme Clínicas'],'sem acento acha com acento');
  assert.deepEqual(await buscar('CLÍNICAS'),['Clientes/Acme Clínicas'],'maiúscula e acento no termo');
  assert.deepEqual(await buscar('clinicas acme'),['Clientes/Acme Clínicas'],'palavras fora de ordem, no nome');
  assert.deepEqual(await buscar('clinicas pagina'),['Clientes/Acme Clínicas/pagina.html'],'palavras espalhadas pelo caminho');
  assert.deepEqual(await buscar('clientes notas'),['Clientes/Acme Clínicas/notas.md']);
  assert.deepEqual(await buscar('clinicas xyz'),[],'toda palavra tem que aparecer');

  // Modo Original: cada linha tem âncora #L<n> (o chat abre o arquivo já na linha citada)
  assert.match(await (await get('/_ratoeira/fonte/'+encodeURI('Clientes/Acme Clínicas/notas.md'))).text(),/<span id="L1">/);

  // Botão de atualizar: o gateway só toca o arquivo de pedido; exige POST com origem e JSON.
  const mutate={...auth,origin:'https://ratoeira.example.com','content-type':'application/json'};
  assert.equal((await fetch(base+'/_ratoeira/api/arquivos/sincronizar',{method:'POST',headers:auth,body:'{}'})).status,403);
  const pedido=await fetch(base+'/_ratoeira/api/arquivos/sincronizar',{method:'POST',headers:mutate,body:'{}'});
  assert.equal(pedido.status,202);assert.equal((await pedido.json()).aceito,true);
  assert.match(await readFile(path.join(dir,'pedido-sync'),'utf8'),/^\d{4}-/);
  assert.equal((await (await fetch(base+'/_ratoeira/api/arquivos/sincronizar',{method:'POST',headers:mutate,body:'{}'})).json()).aceito,false,'limite de 1 pedido a cada 15s');
  await writeFile(path.join(dir,'ultimo.json'),'{"resultado":"travado","mensagem":"conflito"}');
  const est=await (await get('/_ratoeira/api/arquivos/estado')).json();
  assert.equal(est.ultimo.resultado,'travado');assert.equal(est.podeSincronizar,true);

  assert.equal(await (await get('/_ratoeira/fonte/.env')).status,200,'o .env abre (pra pessoa pôr a chave)');
  assert.equal(await (await get('/_ratoeira/arquivo/solto/x.md')).text(),'não versionado');
  for(const p of ['/_ratoeira/arquivo/atalho.txt','/_ratoeira/arquivo/..%2Ffora.txt','/_ratoeira/arquivo/%2E%2E/fora.txt','/_ratoeira/arquivo/.git/config','/_ratoeira/arquivo/.git/HEAD','/_ratoeira/fonte/.git/config','/_ratoeira/ver/atalho.txt'])
    // O que importa é não servir o arquivo. Caminho que o fetch normaliza pra fora das rotas
    // do portal cai no repasse pro Paseo (502 sem Paseo no teste, 401/403 com ele).
    {const r=await get(p);const corpo=await r.text();assert.ok(r.status>=400,'bloqueado: '+p+' → '+r.status);assert.doesNotMatch(corpo,/fora do repo|\[core\]|refs\/heads/,'vazou: '+p);}
  assert.equal((await get('/_ratoeira/api/arquivos/arvore?caminho=..')).status,404);

  const md=await get('/_ratoeira/ver'+pasta+'/notas.md');const mdHtml=await md.text();
  assert.equal(md.status,200);assert.match(md.headers.get('content-security-policy'),/sandbox/);
  assert.ok(!md.headers.get('content-security-policy').includes('allow-same-origin'));
  assert.match(mdHtml,/<h1[^>]*>Título<\/h1>/);assert.match(mdHtml,/<table>/);assert.match(mdHtml,/<li>item<ul>/);

  const html=await get('/_ratoeira/ver'+pasta+'/pagina.html');
  assert.equal(await html.text(),'<h1>oi</h1><script>parent.x=1</script>');assert.match(html.headers.get('content-security-policy'),/sandbox allow-scripts/);
  // Passe da página isolada: a página em sandbox não manda cookie, então /ver/ redireciona pra um endereço com
  // passe e a imagem relativa abre sem login. Só mídia/CSS/JS, só dentro da pasta da página.
  const ida=await fetch(base+'/_ratoeira/ver'+pasta+'/pagina.html?x=1',{headers:auth,redirect:'manual'});
  assert.equal(ida.status,302);const destino=ida.headers.get('location');
  assert.match(destino,/^\/_ratoeira\/ver\/~[\w-]+\.[\w-]+\/Clientes\/Acme%20Cl%C3%ADnicas\/pagina\.html\?x=1$/);
  const comPasse=destino.replace(/pagina\.html.*$/,''),tok=destino.split('/')[3];
  const foto=await get(comPasse+'foto.png',{});assert.equal(foto.status,200,'imagem da pasta abre sem cookie');assert.equal(foto.headers.get('content-type'),'image/png');
  assert.equal((await get(comPasse+'notas.md',{})).status,401,'markdown não sai pelo passe');
  await writeFile(path.join(repoDir,'raiz.png'),Buffer.from([137,80,78,71]));
  assert.equal((await get('/_ratoeira/ver/'+tok+'/raiz.png',{})).status,401,'fora da pasta da página, não');
  assert.equal((await get(comPasse+'..%2F..%2Fraiz.png',{})).status,401,'sem subir de pasta');
  assert.equal((await get(comPasse.replace(tok,tok.slice(0,-2)+'xx')+'foto.png',{})).status,401,'passe adulterado, não');
  assert.equal((await fetch(base+comPasse+'foto.png',{method:'POST'})).status,401,'só leitura');
  assert.equal((await get(destino)).status,200,'com cookie, a página abre no endereço do passe');

  const svg=await get('/_ratoeira/arquivo'+pasta+'/logo.svg');assert.match(svg.headers.get('content-security-policy'),/sandbox/);
  const png=await get('/_ratoeira/arquivo'+pasta+'/foto.png');assert.equal(png.headers.get('content-type'),'image/png');assert.doesNotMatch(png.headers.get('content-security-policy'),/sandbox/);
  const bin=await get('/_ratoeira/arquivo'+pasta+'/dados.bin');assert.match(bin.headers.get('content-disposition'),/attachment/);
  const baixar=await get('/_ratoeira/arquivo'+pasta+'/notas.md?baixar=1');assert.match(baixar.headers.get('content-disposition'),/notas\.md/);
  assert.equal(baixar.headers.get('content-type'),'text/plain; charset=utf-8');assert.match(baixar.headers.get('content-security-policy'),/sandbox/);

  const fonte=await (await get('/_ratoeira/fonte'+pasta+'/pagina.html')).text();
  assert.match(fonte,/&lt;h1&gt;oi&lt;\/h1&gt;/);assert.doesNotMatch(fonte,/<script>parent/);
  const naoTexto=await get('/_ratoeira/fonte'+pasta+'/dados.bin');assert.equal(naoTexto.status,415);assert.match(naoTexto.headers.get('content-type'),/text\/html/);

  // Chat: o módulo é servido com o CSP do portal.
  const chatJs=await get('/_ratoeira/chat.js');assert.equal(chatJs.status,200);assert.match(chatJs.headers.get('content-security-policy'),/script-src 'self'/);

  // Arquivo novo abre na hora, sem esperar o git.
  await writeFile(path.join(repoDir,'novo.md'),'# novo');
  assert.equal((await get('/_ratoeira/ver/novo.md')).status,200);
});

test('histórico do arquivo, o que mudou, versão antiga e habilidades do repo',async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'ratoeira-historico-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const repoDir=await repoDeTeste(dir);
  const git=(...a)=>execFileSync('git',['-C',repoDir,...a],{stdio:'pipe'}).toString();
  const notas=path.join(repoDir,'Clientes','Acme Clínicas','notas.md');
  await writeFile(notas,'# Título novo\n');
  await mkdir(path.join(repoDir,'.claude','skills','resumo'),{recursive:true});
  await writeFile(path.join(repoDir,'.claude','skills','resumo','SKILL.md'),'---\nname: resumo\ndescription: >\n  Resume uma reunião\n  em tópicos.\n---\n# Resumo\n');
  await mkdir(path.join(repoDir,'Educacao','.agents','skills','aula'),{recursive:true});
  await writeFile(path.join(repoDir,'Educacao','.agents','skills','aula','SKILL.md'),'---\nname: "aula"\ndescription: Publica uma aula\n---\n');
  git('add','-A');git('-c','user.name=Beto','-c','user.email=beto@t','commit','-qm','muda o título');
  // um commit no meio que não mexe no arquivo: o diff da edição seguinte compara com a versão de antes dele
  await writeFile(path.join(repoDir,'outro.txt'),'x');git('add','-A');git('-c','user.name=t','-c','user.email=t@t','commit','-qm','outro');
  await writeFile(notas,'# Título novo\n\nmais uma linha\n');git('add','-A');git('-c','user.name=Beto','-c','user.email=beto@t','commit','-qm','mais uma linha');
  const portal=createPortal({hostname:'ratoeira.example.com',agentPath:'/new',dataDir:dir,pagesDir:path.join(dir,'pages'),repoDir},{runtime:{status:async()=>({}),launch:()=>{},backup:async()=>{}}});
  const gateway=createGateway({hostname:'ratoeira.example.com',password:'test',verify:async()=>({email:'ana@example.com',exp:Math.floor(Date.now()/1000)+300}),portal});
  await new Promise(r=>gateway.listen(0,'127.0.0.1',r));t.after(()=>gateway.shutdown());
  const get=async p=>{const r=await fetch('http://127.0.0.1:'+gateway.address().port+'/_ratoeira/api'+p,{headers:{'cf-access-jwt-assertion':'x'}});return {status:r.status,dados:await r.json()};};
  const caminho=encodeURIComponent('Clientes/Acme Clínicas/notas.md');

  const h=(await get('/arquivos/historico?caminho='+caminho)).dados;
  assert.deepEqual(h.itens.map(i=>[i.autor,i.mensagem]),[['Beto','mais uma linha'],['Beto','muda o título'],['t','x']],'mais recente primeiro, com autor, só os que mexeram no arquivo');
  const ultima=(await get('/arquivos/mudanca?caminho='+caminho+'&commit='+h.itens[0].commit)).dados;
  assert.equal(ultima.estado,'ok','o commit de antes não mexeu no arquivo, mas a versão anterior existe');assert.match(ultima.diff,/\n\+mais uma linha/);
  const m=(await get('/arquivos/mudanca?caminho='+caminho+'&commit='+h.itens[1].commit)).dados;
  assert.equal(m.estado,'ok');assert.match(m.diff,/^@@/);assert.match(m.diff,/\n-# Título\n/);assert.match(m.diff,/\n\+# Título novo/);
  assert.equal((await get('/arquivos/mudanca?caminho='+caminho+'&commit='+h.itens[2].commit)).dados.estado,'novo','primeira versão: tudo entrou');
  assert.match((await get('/arquivos/versao?caminho='+caminho+'&commit='+h.itens[2].commit)).dados.texto,/^# Título\n/);
  assert.equal((await get('/arquivos/versao?caminho='+caminho+'&commit=nao-e-hash')).status,404);
  assert.deepEqual((await get('/arquivos/historico?caminho=.env')).dados.itens,[],'fora do git abre, mas não tem versões');
  assert.equal((await get('/arquivos/historico?caminho=.git/config')).status,404,'a .git não');

  const hab=(await get('/habilidades')).dados.itens;
  assert.deepEqual(hab.map(x=>[x.nome,x.onde,x.de]),[['resumo','','claude'],['aula','Educacao','agents']],'raiz primeiro, depois por pasta');
  assert.equal(hab[0].descricao,'Resume uma reunião em tópicos.');
});

test('cabeçalho de SKILL.md: linha, aspas, bloco e continuação',async()=>{
  const {cabecalhoSkill}=await import('../files.mjs');
  assert.deepEqual(cabecalhoSkill('---\nname: x\ndescription: "Faz A: e B"\n---\n'),{name:'x',description:'Faz A: e B'});
  assert.equal(cabecalhoSkill('---\ndescription: |\n  linha 1\n  linha 2\n---').description,'linha 1\nlinha 2');
  assert.equal(cabecalhoSkill('---\ndescription: começa aqui\n  e continua\n---').description,'começa aqui e continua');
  assert.deepEqual(cabecalhoSkill('sem cabeçalho'),{});
});

test('registros: tabelas do markdown com o título da seção; nomes de chave sem as públicas',async()=>{
  const {lerTabelas,nomesDeChave}=await import('../files.mjs');
  const md='# Integrações\n\n> nota\n\n## Tráfego\n\n| integração | pra quê | estado |\n|---|---|---|\n| Meta Ads | campanhas | ligada |\n| GA4 | sites | |\n\n## Fora\n\n| integração | estado |\n|:--|--|\n| ClickUp | desligada |\n';
  const r=lerTabelas(md);
  assert.equal(r.titulo,'Integrações');
  assert.deepEqual(r.secoes.map(s=>[s.titulo,s.itens.length]),[['Tráfego',2],['Fora',1]]);
  assert.deepEqual(r.secoes[0].itens[0],{'integração':'Meta Ads','pra quê':'campanhas',estado:'ligada'});
  assert.deepEqual(nomesDeChave('RESEND_API_KEY=x\nPORT=1\nNEXT_PUBLIC_SUPABASE_ANON_KEY=y\nexport STRIPE_SECRET_KEY=z\nVITE_MAPBOX_TOKEN=w\n'),['RESEND_API_KEY','STRIPE_SECRET_KEY']);
});
