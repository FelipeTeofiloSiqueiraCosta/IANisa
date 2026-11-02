import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readdir,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createGateway} from '../server.mjs';
import {createPortal} from '../portal.mjs';
import {createReportes,limparSegredos} from '../reportes.mjs';
import {createCompartilhar} from '../compartilhar.mjs';

const png='data:image/png;base64,'+Buffer.from('\x89PNG\r\n\x1a\nfalso').toString('base64');
const agora=()=>new Date('2026-10-08T21:43:12Z');

test('reporte vira pasta com relato, print, trace e log, sem segredo',async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'ratoeira-rep-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const pedidos=[];
  const r=createReportes({dir,unidades:['ratoeira-gateway','ratoeira-agentes@{user}'],minutos:10},{agora,lerLog:async(u,m)=>{pedidos.push([u,m]);return 'linha 1\nAuthorization: Bearer abcdefghijklmnop\n';}});
  const {pasta}=await r.salvar({email:'caio@example.com'},{tipo:'bug',texto:'O chat não abre na aba Arquivos\n\nCliquei e nada.',print:png,trace:{tela:'Arquivos · Ratoeira',eventos:[{tipo:'fetch',url:'/x?token=segredo123'}],chave:'sk-ant-'+'api03-abcdefghijklmnop'}},{user:'caio',versao:'0.4.0'});
  assert.equal(pasta,'2026-10-08-1843-caio-o-chat-nao-abre-na-aba');
  assert.deepEqual(pedidos,[[['ratoeira-gateway','ratoeira-agentes@caio'],10]]);
  const arquivos=(await readdir(path.join(dir,pasta))).sort();
  assert.deepEqual(arquivos,['log.txt','print.png','relato.md','trace.json']);
  const relato=await readFile(path.join(dir,pasta,'relato.md'),'utf8');
  assert.match(relato,/^---\nstatus: novo\ntipo: bug\nquem: "caio@example.com"\nquando: 2026-10-08T18:43:12-03:00\ntela: "Arquivos · Ratoeira"\nversao: "0.4.0"\n---\n/);
  assert.match(relato,/# O chat não abre na aba Arquivos/);assert.match(relato,/Cliquei e nada\./);
  const trace=await readFile(path.join(dir,pasta,'trace.json'),'utf8');
  assert.doesNotMatch(trace,/segredo123|abcdefghijklmnop/);assert.match(trace,/token=\[removido\]/);
  assert.doesNotMatch(await readFile(path.join(dir,pasta,'log.txt'),'utf8'),/abcdefghijklmnop/);
  // mesmo minuto, mesmo título: não sobrescreve
  const outro=await r.salvar({email:'caio@example.com'},{tipo:'bug',texto:'O chat não abre na aba Arquivos'},{user:'caio'});
  assert.equal(outro.pasta,pasta+'-2');
  assert.deepEqual((await readdir(path.join(dir,outro.pasta))).sort(),['log.txt','relato.md','trace.json']);
});

test('reporte recusa o que não deve gravar',async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'ratoeira-rep-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const r=createReportes({dir,porHora:2},{agora,lerLog:async()=>''});
  const quem={email:'beto@example.com'};
  await assert.rejects(r.salvar(quem,{tipo:'outro',texto:'x'}),{status:400});
  await assert.rejects(r.salvar(quem,{tipo:'bug',texto:'   '}),{status:400});
  await assert.rejects(r.salvar(quem,{tipo:'bug',texto:'x',print:'data:text/html;base64,PGgxPg=='}),{status:400});
  await assert.rejects(r.salvar(quem,{tipo:'bug',texto:'x'.repeat(9000)}),{status:413});
  // sem {user}, unidade por pessoa fica de fora; sem unidade, sem log.txt
  const a=await r.salvar(quem,{tipo:'sugestao',texto:'Botão de tema maior'});
  assert.deepEqual((await readdir(path.join(dir,a.pasta))).sort(),['relato.md','trace.json']);
  await r.salvar(quem,{tipo:'sugestao',texto:'Outra'});
  await assert.rejects(r.salvar(quem,{tipo:'sugestao',texto:'Mais uma'}),{status:429});
  assert.equal(createReportes({}),null);
  assert.equal(limparSegredos('?code=abc&x=1'),'?code=[removido]&x=1');
});

test('limparSegredos pega os formatos de chave mais comuns e NOME=valor sem espaço antes',()=>{
  const casos=[
    ['op '+'ops_'+'eyJhbGciOiJIUzI1NiJ9abcdef','ops_[removido]'],
    ['resend '+'re_'+'AbCd1234_EfGh5678IjKl','re_[removido]'],
    ['google '+'AIza'+'SyA1234567890abcdefghijklmnopqrstu','AIza[removido]'],
    ['xai '+'xai-'+'abcdefghijklmnop1234','xai-[removido]'],
    ['jwt '+'eyJhbGciOi'+'JIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U','[jwt removido]'],
  ];
  for(const [entrada,esperado] of casos){
    const saida=limparSegredos(entrada);
    assert.ok(saida.includes(esperado),`${entrada} → ${saida}`);
  }
  const env=limparSegredos('linha:API_TOKEN=abc123xyz\nMEU_KEY=valor1\nX_SECRET="s3gr3d0"\nDB_PASSWORD=p4ss ok');
  assert.equal(env,'linha:API_TOKEN=[removido]\nMEU_KEY=[removido]\nX_SECRET="[removido]"\nDB_PASSWORD=[removido] ok');
  assert.ok(!limparSegredos('export OPENAI_API_KEY=sk1234').includes('sk1234'));
  // texto comum fica
  assert.equal(limparSegredos('o chat não abre na aba Arquivos'),'o chat não abre na aba Arquivos');
});

test('rota /reportes: só com config, exige login e origem, aceita print grande',async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'ratoeira-rep-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const runtime={status:async id=>({id}),launch:()=>{throw new Error();},backup:async()=>{}};
  const montar=async reportes=>{
    const portal=createPortal({hostname:'ratoeira.example.com',agentPath:'/new',dataDir:dir,pagesDir:dir,adminEmails:[],reportes},{runtime,lerLog:async()=>'log\n'});
    const gw=createGateway({hostname:'ratoeira.example.com',password:'test',verify:async token=>{if(!token)throw new Error();return {email:token+'@example.com',exp:Math.floor(Date.now()/1000)+300};},portal});
    await new Promise(ok=>gw.listen(0,'127.0.0.1',ok));t.after(()=>gw.shutdown());
    return 'http://127.0.0.1:'+gw.address().port;
  };
  const auth={'cf-access-jwt-assertion':'ana'},mutate={...auth,origin:'https://ratoeira.example.com','content-type':'application/json'};
  const sem=await montar(undefined);
  assert.equal((await (await fetch(sem+'/_ratoeira/api/portal',{headers:auth})).json()).reportes,false);
  assert.equal((await fetch(sem+'/_ratoeira/api/reportes',{method:'POST',headers:mutate,body:JSON.stringify({tipo:'bug',texto:'x'})})).status,404);
  const com=await montar({dir:path.join(dir,'reportes'),unidades:['ratoeira-gateway']});
  assert.equal((await (await fetch(com+'/_ratoeira/api/portal',{headers:auth})).json()).reportes,true);
  const body=JSON.stringify({tipo:'bug',texto:'Tela branca',print:'data:image/jpeg;base64,'+Buffer.alloc(300000,7).toString('base64'),trace:{eventos:[]}});
  assert.equal((await fetch(com+'/_ratoeira/api/reportes',{method:'POST',headers:{origin:'https://ratoeira.example.com','content-type':'application/json'},body})).status,401);
  assert.equal((await fetch(com+'/_ratoeira/api/reportes',{method:'POST',headers:{...mutate,origin:'https://outro.example.com'},body})).status,403);
  const ok=await fetch(com+'/_ratoeira/api/reportes',{method:'POST',headers:mutate,body});assert.equal(ok.status,201);
  const {pasta}=await ok.json();
  assert.deepEqual((await readdir(path.join(dir,'reportes',pasta))).sort(),['log.txt','print.jpg','relato.md','trace.json']);
  assert.equal((await readFile(path.join(dir,'reportes',pasta,'print.jpg'))).length,300000);
});

test('com enviar, o reporte vai pra caixa de entrada; se ela falha, cai na pasta (ou dá 502 sem pasta)',async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'ratoeira-rep-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const chaveArquivo=path.join(dir,'chave');await writeFile(chaveArquivo,'rep_chave-de-teste\n');
  const pedidos=[];let resposta={status:201,body:{id:7}};
  const fetchFn=async(url,o)=>{pedidos.push({url,headers:o.headers,body:JSON.parse(o.body)});return new Response(JSON.stringify(resposta.body),{status:resposta.status});};
  const enviar={url:'https://ratoeira.example.com/reportes/receber/reporte',chaveArquivo};
  const r=createReportes({dir:path.join(dir,'pasta'),enviar,unidades:['ratoeira-gateway']},{agora,fetchFn,lerLog:async()=>'log com Bearer abcdefghijklmnop\n'});
  assert.deepEqual(await r.salvar({email:'caio@example.com'},{tipo:'sugestao',texto:'Tema escuro',print:png,trace:{tela:'Início · Ratoeira'}},{versao:'0.5.0'}),{id:7});
  const [p]=pedidos;
  assert.equal(p.url,enviar.url);
  assert.equal(p.headers['x-reportes-chave'],'rep_chave-de-teste');assert.equal(p.headers.origin,'https://ratoeira.example.com');
  assert.equal(p.body.quem,'caio@example.com');assert.equal(p.body.tipo,'sugestao');assert.equal(p.body.tela,'Início · Ratoeira');
  assert.equal(p.body.versao,'0.5.0');assert.equal(p.body.print,png);assert.equal(p.body.quando,'2026-10-08T18:43:12-03:00');
  assert.doesNotMatch(p.body.log,/abcdefghijklmnop/);
  await assert.rejects(readdir(path.join(dir,'pasta')),{code:'ENOENT'});
  // caixa de entrada fora: grava na pasta
  resposta={status:503,body:{erro:'fora'}};
  const {pasta}=await r.salvar({email:'caio@example.com'},{tipo:'bug',texto:'Caiu'});
  assert.ok((await readdir(path.join(dir,'pasta',pasta))).includes('relato.md'));
  // sem pasta: erro claro
  const so=createReportes({enviar:{url:enviar.url,chave:'rep_x'}},{agora,fetchFn,lerLog:async()=>''});
  await assert.rejects(so.salvar({email:'caio@example.com'},{tipo:'bug',texto:'Caiu'}),{status:502});
});

test('o reporte enviado leva o endereço da Ratoeira e quem administra (a caixa de entrada cadastra a origem com isso)',async()=>{
  const corpos=[];
  const fetchFn=async(url,o)=>{corpos.push(JSON.parse(o.body));return new Response('{"id":1}',{status:201});};
  const r=createReportes({enviar:{url:'https://caixa.example/reportes/receber/reporte',chave:'rep_x'}},{agora,fetchFn,lerLog:async()=>'',instalacao:async()=>({endereco:'srv1.exemplo.cloud',admin:'ana@example.com'})});
  await r.salvar({email:'caio@example.com'},{tipo:'bug',texto:'Caiu'});
  assert.deepEqual(corpos[0].instalacao,{endereco:'srv1.exemplo.cloud',admin:'ana@example.com'});
  // sem como saber (ou dando erro), manda sem
  const sem=createReportes({enviar:{url:'https://caixa.example/reportes/receber/reporte',chave:'rep_x'}},{agora,fetchFn,lerLog:async()=>'',instalacao:async()=>{throw new Error('x');}});
  await sem.salvar({email:'caio@example.com'},{tipo:'bug',texto:'Caiu'});
  assert.equal('instalacao' in corpos[1],false);
});

test('volta: busca os retornos com a chave, trata cada um e só depois anda o cursor; meus reportes',async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'ratoeira-rep-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const chaveArquivo=path.join(dir,'chave');await writeFile(chaveArquivo,'rep_chave\n');
  const pedidos=[];let fila=[{id:7,seq:3,quem:'ana@x.com',titulo:'Foto',status:'feito',recado:'Arrumado.',versao:'0.6.0',em:'2026-10-16T12:00:00Z'}];
  const fetchFn=async(url,o)=>{pedidos.push({url,chave:o.headers['x-reportes-chave']});
    const u=new URL(url);
    if(u.pathname.endsWith('/retornos')){const desde=Number(u.searchParams.get('desde'));const itens=fila.filter(i=>i.seq>desde);return new Response(JSON.stringify({itens,ate:itens.at(-1)?.seq??desde}));}
    if(u.pathname.endsWith('/meus'))return new Response(JSON.stringify({reportes:[{id:7,titulo:'Foto',status:'feito',recado:'Arrumado.'}]}));
    return new Response('{}',{status:404});};
  const retornoArquivo=path.join(dir,'retorno.json');
  const r=createReportes({enviar:{url:'https://caixa.example/reportes/receber/reporte',chaveArquivo}},{fetchFn,retornoArquivo});
  assert.equal(r.temRetorno,true);
  // tratar falhou: o cursor não anda, e na próxima vem de novo
  await assert.rejects(r.retornos(async()=>{throw new Error('sino fora');}));
  assert.equal(pedidos[0].url,'https://caixa.example/reportes/receber/retornos?desde=0');assert.equal(pedidos[0].chave,'rep_chave');
  const vistos=[];
  assert.equal(await r.retornos(async it=>vistos.push(it.id)),1);
  assert.deepEqual(vistos,[7]);
  assert.deepEqual(JSON.parse(await readFile(retornoArquivo,'utf8')),{desde:3});
  assert.equal(await r.retornos(async it=>vistos.push(it.id)),0);
  assert.equal(pedidos.at(-1).url,'https://caixa.example/reportes/receber/retornos?desde=3');
  assert.deepEqual((await r.meus('ana+x@x.com')).reportes.map(x=>x.id),[7]);
  assert.equal(pedidos.at(-1).url,'https://caixa.example/reportes/receber/meus?quem=ana%2Bx%40x.com');
  // caixa fora do ar: 502 com mensagem pra pessoa
  const fora=createReportes({enviar:{url:'https://caixa.example/reportes/receber/reporte',chave:'rep_x'}},{fetchFn:async()=>new Response('{}',{status:500})});
  await assert.rejects(fora.meus('ana@x.com'),{status:502});
  // só pasta local: sem volta
  const local=createReportes({dir},{});
  assert.equal(local.temRetorno,false);assert.equal(await local.retornos(async()=>{}),0);
  await assert.rejects(local.meus('ana@x.com'),{status:404});
});

test('volta no sino: aviso do tipo reporte, repetido não lido só atualiza',()=>{
  const avisados=[];
  const c=createCompartilhar({aoNotificar:n=>avisados.push(n)});
  assert.equal(c.avisoDeReporte({para:'ana@x.com',reporte:7,titulo:'Foto',status:'aceito'}),null);
  assert.equal(c.avisoDeReporte({para:'ana@x.com',reporte:7,titulo:'Foto',status:'feito',recado:'Arrumado.',versao:'0.6.0'}),true);
  c.avisoDeReporte({para:'ana@x.com',reporte:7,titulo:'Foto',status:'feito',recado:'Arrumado de vez.',versao:'0.6 0'});
  const {itens}=c.notificacoes('ana@x.com');
  assert.equal(itens.length,1);
  assert.deepEqual({tipo:itens[0].tipo,reporte:itens[0].reporte,status:itens[0].status,texto:itens[0].texto,versao:itens[0].versao},{tipo:'reporte',reporte:7,status:'feito',texto:'Arrumado de vez.',versao:null});
  assert.equal(avisados.length,2);
  c.marcarLidas('ana@x.com',null);
  c.avisoDeReporte({para:'ana@x.com',reporte:7,titulo:'Foto',status:'recusado'});
  assert.equal(c.notificacoes('ana@x.com').itens.length,2);
});

test('aviso de instalação: manda quando muda (ou num dia novo), com nome, versão e número de pessoas; sem mudança, não manda',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),"aviso-"));
  const pedidos=[];let dia='2026-10-20T12:00:00Z';let inst={endereco:'ratoeira.gil.com.br',admin:'',nome:'',pessoas:0};let falhar=false;
  const fetchFn=async(url,o)=>{pedidos.push({url,chave:o.headers['x-reportes-chave'],corpo:JSON.parse(o.body)});return falhar?new Response('{"erro":"x"}',{status:500}):new Response('{"ok":true}');};
  const r=createReportes({enviar:{url:'https://caixa.example/reportes/receber/reporte',chave:'rep_x'}},
    {fetchFn,agora:()=>new Date(dia),versao:'0.8.2',avisoArquivo:path.join(dir,'aviso.txt'),instalacao:async()=>inst});
  // terminou de instalar
  assert.equal(await r.avisarInstalacao(),true);
  assert.equal(pedidos[0].url,'https://caixa.example/reportes/receber/instalacao');assert.equal(pedidos[0].chave,'rep_x');
  assert.deepEqual(pedidos[0].corpo,{instalacao:{endereco:'ratoeira.gil.com.br',admin:'',nome:''},versao:'0.8.2',pessoas:0});
  // nada mudou: não manda
  assert.equal(await r.avisarInstalacao(),false);assert.equal(pedidos.length,1);
  // quem administra entrou; a caixa fora do ar não grava a marca, então tenta de novo
  inst={...inst,admin:'gil@x.com',nome:'Gil',pessoas:1};falhar=true;
  await assert.rejects(r.avisarInstalacao());
  falhar=false;
  assert.equal(await r.avisarInstalacao(),true);assert.equal(pedidos.at(-1).corpo.instalacao.admin,'gil@x.com');assert.equal(pedidos.at(-1).corpo.pessoas,1);
  // outro dia: manda de novo (a Ratoeira está viva)
  dia='2026-10-21T12:00:00Z';
  assert.equal(await r.avisarInstalacao(),true);assert.equal(pedidos.length,4);
  // só pasta local, ou sem arquivo de marca: não manda nada
  assert.equal(await createReportes({dir},{}).avisarInstalacao(),false);
});
