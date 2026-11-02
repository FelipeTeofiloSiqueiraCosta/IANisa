import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,stat,utimes,writeFile,mkdir} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createAtualizacoes} from '../atualizacoes.mjs';
import {createGateway} from '../server.mjs';
import {createPortal} from '../portal.mjs';

// Atualizações (atualizacoes.mjs): o gateway lê o estado do atualizador (kit/instalador/atualizar), grava o pedido
// do admin em <pedidos>/pedido.json e liga a unit sem esperar. Sem "atualizar" na config, nada aparece.
const montarDir=async t=>{const d=await mkdtemp(path.join(tmpdir(),'ratoeira-atu-'));t.after(()=>rm(d,{recursive:true,force:true}));return d;};
const ESTADO={noAr:{versao:'0.5.0',commit:'abc',em:'2026-10-10T12:00:00+00:00',por:'terminal'},anterior:{versao:'0.4.2'},canal:'beta',verificadoEm:'2026-10-16T09:00:00+00:00',
  disponivel:{versao:'0.6.0',nova:true,mudancas:[{versao:'0.6.0',titulo:'0.6.0 (2026-10-16)',texto:'- Tela de Atualizações\n- `atualizar_ratoeira`'}]},
  ultima:{ok:false,acao:'aplicar',em:'2026-10-15T10:00:00+00:00',por:'a@x',versao:'0.5.1',erro:'gateway não subiu',log:Array.from({length:100},(_,i)=>'linha '+i)}};

test('pedido válido: grava pedido.json (640) atômico, liga a unit e o estado lê o disco',async t=>{
  const d=await montarDir(t),pedidos=path.join(d,'atualizar'),estadoArquivo=path.join(d,'atualizacao.json');
  await writeFile(estadoArquivo,JSON.stringify(ESTADO));
  let ligou=0;
  const a=createAtualizacoes({estadoArquivo,pedidosDir:pedidos,ligar:async()=>{ligou++;},log:()=>{}});
  const e0=await a.estado();
  assert.equal(e0.noAr.versao,'0.5.0');assert.equal(e0.disponivel.versao,'0.6.0');assert.equal(e0.disponivel.nova,true);
  assert.equal(e0.disponivel.mudancas[0].titulo,'0.6.0 (2026-10-16)');assert.equal(e0.anterior.versao,'0.4.2');
  assert.equal(e0.ultima.ok,false);assert.equal(e0.ultima.log.length,80);assert.equal(e0.pedido,null);assert.equal(e0.resultado,null);
  // resultado velho some quando entra pedido novo
  await mkdir(pedidos,{recursive:true});await writeFile(path.join(pedidos,'resultado.json'),JSON.stringify({ok:true,acao:'verificar',em:'x',log:['ok']}));
  assert.equal((await a.estado()).resultado.acao,'verificar');
  assert.deepEqual(await a.pedir({acao:'aplicar',versao:'0.6.0'},'caio@x.com'),{estado:'pedido',acao:'aplicar',versao:'0.6.0'});
  assert.equal(ligou,1);
  const arq=path.join(pedidos,'pedido.json');
  const p=JSON.parse(await readFile(arq,'utf8'));
  assert.equal(p.acao,'aplicar');assert.equal(p.versao,'0.6.0');assert.equal(p.por,'caio@x.com');assert.ok(p.em);
  assert.equal((await stat(arq)).mode&0o777,0o640);
  assert.ok(!existsSync(arq+'.tmp'));assert.ok(!existsSync(path.join(pedidos,'resultado.json')));
  const e1=await a.estado();
  assert.equal(e1.pedido.acao,'aplicar');assert.equal(e1.pedido.versao,'0.6.0');assert.ok(e1.pedido.desde);
  // pedido aberto: recusa outro
  await assert.rejects(a.pedir({acao:'verificar'},'caio@x.com'),e=>e.status===409);
  assert.equal(ligou,1);
  // pedido de mais de 30 min é de um atualizador que morreu: deixa pedir de novo
  const velho=new Date(Date.now()-31*60e3);await utimes(arq,velho,velho);
  assert.equal((await a.estado()).pedido,null);
  await a.pedir({acao:'voltar'},'caio@x.com');
  assert.equal(JSON.parse(await readFile(arq,'utf8')).acao,'voltar');
  assert.equal(JSON.parse(await readFile(arq,'utf8')).versao,undefined);
});

test('pedido inválido é recusado sem gravar nem ligar; unit que não liga desfaz o pedido',async t=>{
  const d=await montarDir(t),pedidos=path.join(d,'atualizar');
  let ligou=0;
  const a=createAtualizacoes({estadoArquivo:path.join(d,'nao-existe.json'),pedidosDir:pedidos,ligar:async()=>{ligou++;},log:()=>{}});
  for(const p of [{acao:'apagar'},{},{acao:'aplicar',versao:'1.2'},{acao:'aplicar',versao:'v1.2.3'},{acao:'aplicar',versao:'1.2.3;rm -rf /'},{acao:'aplicar',versao:7},{acao:'verificar',versao:'1.2.3'}])
    await assert.rejects(a.pedir(p,'a@x'),e=>e.status===400,JSON.stringify(p));
  assert.equal(ligou,0);assert.ok(!existsSync(path.join(pedidos,'pedido.json')));
  // sem arquivo de estado: tudo vazio, sem quebrar
  const e=await a.estado();
  assert.equal(e.noAr,null);assert.equal(e.disponivel,null);assert.equal(e.pedido,null);
  const b=createAtualizacoes({estadoArquivo:path.join(d,'x.json'),pedidosDir:pedidos,ligar:async()=>{throw new Error('Interactive authentication required');},log:()=>{}});
  await assert.rejects(b.pedir({acao:'verificar'},'a@x'),e=>e.status===502&&/polkit/.test(e.message));
  assert.ok(!existsSync(path.join(pedidos,'pedido.json')));
  assert.equal((await b.estado()).pedido,null);
});

test('rotas /atualizacoes: só com config e só admin, com conferência de origem',async t=>{
  const d=await montarDir(t);
  const runtime={status:async id=>({id}),launch:()=>{throw new Error();},backup:async()=>{}};
  const host='ratoeira.example.com';
  const montar=async atualizacoes=>{
    const portal=createPortal({hostname:host,agentPath:'/new',dataDir:d,pagesDir:d,adminEmails:['caio@example.com'],...(atualizacoes?{atualizacoes}:{})},{runtime});
    const gw=createGateway({hostname:host,password:'test',verify:async token=>{if(!token)throw new Error();return {email:token+'@example.com',exp:Math.floor(Date.now()/1000)+300};},portal});
    await new Promise(ok=>gw.listen(0,'127.0.0.1',ok));t.after(()=>gw.shutdown());
    return 'http://127.0.0.1:'+gw.address().port;
  };
  const caio={'cf-access-jwt-assertion':'caio'},ana={'cf-access-jwt-assertion':'ana'};
  const mutate=h=>({...h,origin:'https://'+host,'content-type':'application/json'});
  // sem config: nada aparece e a rota não existe
  const sem=await montar(null);
  assert.equal((await (await fetch(sem+'/_ratoeira/api/portal',{headers:caio})).json()).atualizacoes,false);
  assert.equal((await fetch(sem+'/_ratoeira/api/atualizacoes',{headers:caio})).status,404);
  assert.equal((await fetch(sem+'/_ratoeira/api/atualizacoes',{method:'POST',headers:mutate(caio),body:'{"acao":"verificar"}'})).status,404);
  // com config
  const pedidos=[];
  const falso={estado:async()=>({noAr:{versao:'0.5.0'},pedido:pedidos.length?{acao:pedidos.at(-1).acao}:null}),
    pedir:async(p,por)=>{if(p.acao==='inventada')throw Object.assign(new Error('Ação inválida'),{status:400});pedidos.push({...p,por});return {estado:'pedido'};}};
  const com=await montar(falso);
  assert.equal((await (await fetch(com+'/_ratoeira/api/portal',{headers:caio})).json()).atualizacoes,true);
  assert.equal((await (await fetch(com+'/_ratoeira/api/portal',{headers:ana})).json()).atualizacoes,false);
  assert.equal((await fetch(com+'/_ratoeira/api/atualizacoes',{headers:ana})).status,403);
  assert.equal((await fetch(com+'/_ratoeira/api/atualizacoes',{method:'POST',headers:mutate(ana),body:'{"acao":"verificar"}'})).status,403);
  const g=await fetch(com+'/_ratoeira/api/atualizacoes',{headers:caio});
  assert.equal(g.status,200);assert.equal((await g.json()).noAr.versao,'0.5.0');
  // POST de outra origem (ou sem login) não passa
  assert.equal((await fetch(com+'/_ratoeira/api/atualizacoes',{method:'POST',headers:{...mutate(caio),origin:'https://outro.example.com'},body:'{"acao":"verificar"}'})).status,403);
  assert.equal((await fetch(com+'/_ratoeira/api/atualizacoes',{method:'POST',headers:{origin:'https://'+host,'content-type':'application/json'},body:'{"acao":"verificar"}'})).status,401);
  assert.equal((await fetch(com+'/_ratoeira/api/atualizacoes',{method:'POST',headers:mutate(caio),body:'{"acao":"inventada"}'})).status,400);
  const p=await fetch(com+'/_ratoeira/api/atualizacoes',{method:'POST',headers:mutate(caio),body:JSON.stringify({acao:'aplicar',versao:'0.6.0'})});
  assert.equal(p.status,202);assert.equal((await p.json()).pedido.acao,'aplicar');
  assert.deepEqual(pedidos,[{acao:'aplicar',versao:'0.6.0',por:'caio@example.com'}]);
});

test('reportes: o portal diz pra onde vai o reporte (nome do destino, guardado aqui, ou o texto de sempre)',async t=>{
  const d=await montarDir(t);
  const runtime={status:async id=>({id}),launch:()=>{throw new Error();},backup:async()=>{}};
  const host='ratoeira.example.com';
  const destino=async reportes=>{
    const portal=createPortal({hostname:host,agentPath:'/new',dataDir:d,pagesDir:d,adminEmails:[],...(reportes?{reportes}:{})},{runtime});
    const gw=createGateway({hostname:host,password:'test',verify:async token=>({email:token+'@example.com',exp:Math.floor(Date.now()/1000)+300}),portal});
    await new Promise(ok=>gw.listen(0,'127.0.0.1',ok));t.after(()=>gw.shutdown());
    return (await (await fetch('http://127.0.0.1:'+gw.address().port+'/_ratoeira/api/portal',{headers:{'cf-access-jwt-assertion':'ana'}})).json()).reportesDestino;
  };
  assert.equal(await destino(null),null);
  assert.deepEqual(await destino({dir:path.join(d,'r')}),{envia:false,nome:null});
  assert.deepEqual(await destino({dir:path.join(d,'r'),enviar:{url:'https://caixa.example.com/receber',chave:'k',nome:'a equipe da Ratoeira'}}),{envia:true,nome:'a equipe da Ratoeira'});
  // a nossa instância: envio pra caixa local, sem nome (o diálogo mantém o texto de sempre)
  assert.deepEqual(await destino({dir:path.join(d,'r'),enviar:{url:'http://127.0.0.1:9/receber',chave:'k'}}),{envia:true,nome:null});
});

test('conta da plataforma: "conectar" vira pedido e o estado mostra conexão e bloqueio, sem URL que não seja https',async t=>{
  const d=await montarDir(t),pedidos=path.join(d,'atualizar'),estadoArquivo=path.join(d,'atualizacao.json');
  await writeFile(estadoArquivo,JSON.stringify({...ESTADO,conexao:{estado:'esperando',codigo:'ABCD-EFGH',url:'https://plataforma.exemplo.com/ratoeira/conectar?codigo=ABCD-EFGH',segredo:'rcx_nunca'},
    licenca:{ok:false,motivo:'sem-comunidade',mensagem:'Sem Comunidade ativa.'}}));
  const a=createAtualizacoes({estadoArquivo,pedidosDir:pedidos,ligar:async()=>{},log:()=>{}});
  const e=await a.estado();
  assert.deepEqual(e.conexao,{estado:'esperando',email:null,codigo:'ABCD-EFGH',url:'https://plataforma.exemplo.com/ratoeira/conectar?codigo=ABCD-EFGH',expiraEm:null});
  assert.deepEqual([e.licenca.ok,e.licenca.motivo,e.licenca.mensagem],[false,'sem-comunidade','Sem Comunidade ativa.']);
  await writeFile(estadoArquivo,JSON.stringify({conexao:{estado:'esperando',url:'javascript:alert(1)'}}));
  assert.equal((await a.estado()).conexao.url,null);
  assert.deepEqual(await a.pedir({acao:'conectar'},'caio@x.com'),{estado:'pedido',acao:'conectar',versao:null});
  await rm(path.join(pedidos,'pedido.json'));
  await assert.rejects(a.pedir({acao:'conectar',versao:'1.2.3'},'a@x'),e=>e.status===400);
});
