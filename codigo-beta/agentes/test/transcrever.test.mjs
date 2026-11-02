import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {WebSocket} from 'ws';
import {criarTranscritor,termosDoGlossario,montarTermos,lerEnv,corrigirTermos} from '../transcrever.mjs';
import http from 'node:http';
import {createServidor} from '../servidor.mjs';

const audio=Buffer.from('OggS falso');
// fetch de mentira: guarda cada chamada e responde pela fila
function falso(respostas){
  const chamadas=[];
  const f=async(url,op={})=>{chamadas.push({url,op});const r=respostas.shift();if(r instanceof Error)throw r;
    return {ok:r.status<400,status:r.status,json:async()=>r.corpo};};
  return {f,chamadas};
}

test('curto vai pela síncrona, com português e o glossário da pasta',async()=>{
  const raiz=mkdtempSync(path.join(tmpdir(),'ditado-'));mkdirSync(path.join(raiz,'_contexto'));
  writeFileSync(path.join(raiz,'_contexto','glossario.md'),'# Glossário\n<!-- quem alimenta: o time -->\n- Pedidos: o app de vendas\n- Ana, Beto\n- `acme.com.br`\n');
  const {f,chamadas}=falso([{status:200,corpo:{text:' faz o deploy da Ratoeira '}}]);
  const t=criarTranscritor({home:raiz,env:{ASSEMBLYAI_API_KEY:'k1'},fetch:f});
  const r=await t.transcrever({audio,mime:'audio/webm;codecs=opus',duracaoMs:8000,raiz});
  assert.equal(r.texto,'faz o deploy da Ratoeira');
  assert.equal(chamadas.length,1);
  const {url,op}=chamadas[0];
  assert.equal(url,'https://sync.assemblyai.com/v1/transcribe');
  assert.equal(op.headers.authorization,'k1');assert.equal(op.headers['x-aai-model'],'universal-3-5-pro');
  const config=JSON.parse(await op.body.get('config').text());
  assert.deepEqual(config.language_codes,['pt']);
  assert.deepEqual(config.keyterms_prompt.slice(0,4),['Pedidos','Ana','Beto','acme.com.br']);
  assert.ok(config.keyterms_prompt.includes('Supabase'));
  assert.equal(op.body.get('audio').type,'audio/webm');
});

test('longo sobe o arquivo e espera a transcrição normal',async()=>{
  const {f,chamadas}=falso([{status:200,corpo:{upload_url:'https://cdn/u1'}},{status:200,corpo:{id:'t1'}},{status:200,corpo:{status:'processing'}},{status:200,corpo:{status:'completed',text:'texto longo'}}]);
  const t=criarTranscritor({home:null,env:{ASSEMBLYAI_API_KEY:'k1'},fetch:f,esperar:async()=>{}});
  const r=await t.transcrever({audio,mime:'audio/mp4',duracaoMs:300000});
  assert.equal(r.texto,'texto longo');
  assert.deepEqual(chamadas.map(c=>c.url),['https://api.assemblyai.com/v2/upload','https://api.assemblyai.com/v2/transcript','https://api.assemblyai.com/v2/transcript/t1','https://api.assemblyai.com/v2/transcript/t1']);
  const corpo=JSON.parse(chamadas[1].op.body);
  assert.equal(corpo.audio_url,'https://cdn/u1');assert.equal(corpo.language_code,'pt');assert.deepEqual(corpo.speech_models,['universal-3-5-pro','universal-2']);
});

test('síncrona recusou o áudio: tenta pela normal',async()=>{
  const {f,chamadas}=falso([{status:400,corpo:{detail:'audio too long'}},{status:200,corpo:{upload_url:'u'}},{status:200,corpo:{id:'t2'}},{status:200,corpo:{status:'completed',text:'ok'}}]);
  const t=criarTranscritor({home:null,env:{ASSEMBLYAI_API_KEY:'k'},fetch:f,esperar:async()=>{}});
  assert.equal((await t.transcrever({audio,mime:'audio/webm',duracaoMs:100000})).texto,'ok');
  assert.equal(chamadas.length,4);
});

test('chave: ambiente, depois a da organização (ditado.env), depois o item do cofre; op:// é lido pelo op',async()=>{
  const home=mkdtempSync(path.join(tmpdir(),'ditado-home-'));const org=path.join(home,'ditado.env');
  const ops=[];const op=async args=>{ops.push(args.join(' '));if(args[0]==='vault')return JSON.stringify([{name:'Pessoal'},{name:'Time'}]);
    if(args[1]?.startsWith('op://Time/assemblyai/credential'))return 'do-item';if(args[1]?.startsWith('op://Time/assemblyai/')||args[1]?.startsWith('op://Pessoal/'))throw new Error('não tem');return 'do-ref';};
  const usar=async env=>{const {f,chamadas}=falso([{status:200,corpo:{text:'x'}}]);await criarTranscritor({home,env,fetch:f,op,arquivoOrg:org,socketLocal:'/nao/existe.sock'}).transcrever({audio,mime:'audio/webm',duracaoMs:1000});return chamadas[0].op.headers.authorization;};
  assert.equal(await usar({ASSEMBLYAI_API_KEY:'op://Meu/ditado/chave'}),'do-ref');
  assert.equal(ops.at(-1),'read op://Meu/ditado/chave');
  writeFileSync(org,'ASSEMBLYAI_API_KEY=da-organizacao\n');
  assert.equal(await usar({}),'da-organizacao');
  writeFileSync(org,'');
  assert.equal(await usar({OP_SERVICE_ACCOUNT_TOKEN:'ops_x'}),'do-item');
  assert.deepEqual(ops.slice(-5),['vault list --format json','read op://Pessoal/assemblyai/ASSEMBLYAI_API_KEY','read op://Pessoal/assemblyai/credential','read op://Time/assemblyai/ASSEMBLYAI_API_KEY','read op://Time/assemblyai/credential']);
  await assert.rejects(usar({}),/não tem chave do AssemblyAI/);
});

test('erros viram mensagem pra pessoa; chave recusada sai do cache',async()=>{
  const {f}=falso([new Error('rede'),{status:401,corpo:{}},{status:503,corpo:{}},{status:200,corpo:{text:'voltou'}}]);
  let lidas=0;const env={get ASSEMBLYAI_API_KEY(){lidas++;return 'k';}};
  const t=criarTranscritor({home:null,env,fetch:f});
  const pedir=()=>t.transcrever({audio,mime:'audio/webm',duracaoMs:1000});
  await assert.rejects(pedir(),e=>e.publico&&/ficou guardado/.test(e.message));
  await assert.rejects(pedir(),/recusou a chave/);
  await assert.rejects(pedir(),/fora do ar ou ocupado/);
  assert.equal((await pedir()).texto,'voltou');
  assert.equal(lidas,2);
  await assert.rejects(t.transcrever({audio,mime:'video/mp4',duracaoMs:1}),/Formato/);
  await assert.rejects(t.transcrever({audio:Buffer.alloc(0),mime:'audio/webm',duracaoMs:1}),/vazio/);
});

test('glossário: termo por linha ou por vírgula, sem título nem explicação, até 100',()=>{
  assert.deepEqual(termosDoGlossario('# T\n> nota\n- **Acme Pro** — o curso\n1. AcmePay\nPedidosWeb, Entregas\n| a | b |\n'),['Acme Pro','AcmePay','PedidosWeb','Entregas']);
  const muitos=Array.from({length:150},(_,i)=>'termo'+i).join('\n');
  const t=montarTermos('/x',{ler:()=>muitos});
  assert.equal(t.length,100);assert.equal(t[0],'termo0');
  assert.ok(montarTermos('/x',{ler:()=>{throw new Error();}}).includes('deploy'));
  assert.deepEqual(lerEnv('export A=1\nB = "dois"\n# C=3\n'),{A:'1',B:'dois'});
});

test('op transcrever no servidor: valida e devolve o texto',async t=>{
  const pedidos=[];
  const s=createServidor({agentes:new Map(),arquivoTitulos:path.join(mkdtempSync(path.join(tmpdir(),'titulos-')),'t.json'),
    transcritor:{transcrever:async p=>{pedidos.push(p);return {texto:'oi',ms:5};}}});
  const sock=path.join(mkdtempSync(path.join(tmpdir(),'agentes-')),'a.sock');
  await new Promise(r=>s.server.listen(sock,r));t.after(()=>s.fechar());
  const ws=new WebSocket(`ws+unix://${sock}:/ws`);await new Promise((r,e)=>{ws.on('open',r);ws.on('error',e);});t.after(()=>ws.close());
  let n=0;const pedir=(op,d)=>new Promise((ok,no)=>{const id=++n;ws.on('message',x=>{const m=JSON.parse(x);if(m.id===id)m.ok?ok(m.dados):no(new Error(m.erro));});ws.send(JSON.stringify({...d,op,id}));});
  assert.deepEqual(await pedir('transcrever',{audio:audio.toString('base64'),mime:'audio/webm',duracaoMs:1200,raiz:'/srv/area'}),{texto:'oi',ms:5});
  assert.equal(pedidos[0].audio.toString(),'OggS falso');assert.equal(pedidos[0].raiz,'/srv/area');assert.equal(pedidos[0].duracaoMs,1200);
  await assert.rejects(pedir('transcrever',{audio:'',mime:'audio/webm'}),/vazio/);
  await assert.rejects(pedir('transcrever',{audio:'AAAA',mime:'audio/webm',raiz:'relativa'}),/Pasta inválida/);
});

test('sem chave vai pro motor local, com o texto corrigido pelo glossário; com chave o local nem acorda',async()=>{
  const raiz=mkdtempSync(path.join(tmpdir(),'ditado-'));mkdirSync(path.join(raiz,'_contexto'));
  writeFileSync(path.join(raiz,'_contexto','glossario.md'),'- Ratoeira\n- Caio\n');
  const chamadasLocal=[];
  const local=async(sock,o)=>{chamadasLocal.push({sock,...o});return {texto:'faz o deploy da ratoeira e manda pra supa base, o site caiu'};};
  const t=criarTranscritor({home:raiz,env:{},local,socketLocal:'/x/d.sock',arquivoOrg:'/nao/existe',fetch:async()=>{throw new Error('não era pra chamar o AssemblyAI');}});
  const r=await t.transcrever({audio,mime:'audio/webm',duracaoMs:4000,raiz});
  assert.equal(r.motor,'local');
  assert.equal(r.texto,'faz o deploy da Ratoeira e manda pra Supabase, o site caiu');
  assert.equal(chamadasLocal[0].sock,'/x/d.sock');assert.equal(chamadasLocal[0].tipo,'audio/webm');assert.equal(chamadasLocal[0].corpo,audio);
  await t.aquecer();assert.equal(chamadasLocal.at(-1).rota,'/aquecer');
  assert.deepEqual(await t.estado(),{motor:null,origem:null,local:false});

  const {f}=falso([{status:200,corpo:{text:'ok'}}]);
  const n=chamadasLocal.length;
  const t2=criarTranscritor({home:raiz,env:{ASSEMBLYAI_API_KEY:'k'},local,fetch:f});
  assert.equal((await t2.transcrever({audio,mime:'audio/webm',duracaoMs:1000})).motor,'assemblyai');
  await t2.aquecer();
  assert.equal(chamadasLocal.length,n,'com chave o local não é chamado nem pra aquecer');
});

test('motor local fora do ar: a mensagem diz o que fazer',async t=>{
  const tr=criarTranscritor({home:null,env:{},arquivoOrg:'/nao/existe',socketLocal:path.join(mkdtempSync(path.join(tmpdir(),'ditado-')),'nao.sock')});
  await assert.rejects(tr.transcrever({audio,mime:'audio/webm',duracaoMs:1000}),e=>e.publico&&/receita ditado-local/.test(e.message));
  // serviço de verdade (HTTP no socket) devolvendo erro
  const sock=path.join(mkdtempSync(path.join(tmpdir(),'ditado-')),'d.sock');
  const srv=http.createServer((req,res)=>{req.resume();req.on('end',()=>{res.writeHead(req.url==='/transcrever'?400:202,{'content-type':'application/json'});res.end(JSON.stringify(req.url==='/transcrever'?{erro:'Não consegui ler esse áudio: lixo'}:{ok:true}));});});
  await new Promise(r=>srv.listen(sock,r));t.after(()=>srv.close());
  const tr2=criarTranscritor({home:null,env:{},arquivoOrg:'/nao/existe',socketLocal:sock});
  await assert.rejects(tr2.transcrever({audio,mime:'audio/webm',duracaoMs:1000}),/Não consegui ler esse áudio/);
  assert.equal((await tr2.estado()).motor,'local');
});

test('corrigirTermos: junta palavra partida, acerta grafia, troca parecida longa e deixa termo curto em paz',()=>{
  const termos=['Supabase','Claude Code','Ratoeira','Caio','Cloudflare','pull request','gateway'];
  assert.equal(corrigirTermos('manda pro supa base e pro pupabase',termos),'manda pro Supabase e pro Supabase');
  assert.equal(corrigirTermos('abre o claude code. A ratoeira, e o GATEWAY',termos),'abre o Claude Code. A Ratoeira, e o gateway');
  assert.equal(corrigirTermos('o site caiu de novo',termos),'o site caiu de novo');
  assert.equal(corrigirTermos('abre um pull-request',termos),'abre um pull request');
  assert.equal(corrigirTermos('',termos),'');
  assert.equal(corrigirTermos('nada a ver aqui',[]),'nada a ver aqui');
});
