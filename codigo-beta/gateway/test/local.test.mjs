// Modo local: sem Cloudflare. A pessoa chega por túnel SSH em http://localhost:<porta>.
// O que protege é o Host (contra DNS rebinding) e a Origin (contra outro site no navegador).
import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {WebSocketServer, WebSocket} from 'ws';
import {createGateway} from '../server.mjs';

const secret='senha-local-123';
let visto=null;
const upstream=http.createServer((req,res)=>{visto=req.headers;res.writeHead(200,{'content-type':'text/plain'});res.end('ok');});
const wss=new WebSocketServer({noServer:true});
upstream.on('upgrade',(req,socket,head)=>{visto=req.headers;wss.handleUpgrade(req,socket,head,ws=>ws.send('ready'));});
await new Promise(r=>upstream.listen(0,'127.0.0.1',r));

// A porta pública precisa ser conhecida antes de criar o gateway: escuta primeiro, depois liga.
const probe=http.createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));
const port=probe.address().port;await new Promise(r=>probe.close(r));
const gateway=createGateway({upstreamPort:upstream.address().port,password:secret,access:{mode:'local',port,owner:'aluno'}});
await new Promise(r=>gateway.listen(port,'127.0.0.1',r));
after(async()=>{for(const c of wss.clients)c.terminate();gateway.shutdown();upstream.closeAllConnections();await new Promise(r=>upstream.close(r));await new Promise(r=>wss.close(r));});

// fetch não deixa trocar o Host; http.request deixa.
function pedir(path,{host=`localhost:${port}`,method='GET',headers={}}={}){
  return new Promise((ok,erro)=>{const r=http.request({host:'127.0.0.1',port,path,method,headers:{host,...headers}},res=>{let b='';res.on('data',c=>b+=c);res.on('end',()=>ok({status:res.statusCode,body:b}));});r.on('error',erro);r.end();});
}

test('local: entra por localhost e 127.0.0.1 sem login, e o Paseo recebe a senha e o host certos',async()=>{
  for(const host of [`localhost:${port}`,`127.0.0.1:${port}`]){
    visto=null;const r=await pedir('/api/agents',{host});
    assert.equal(r.status,200,host);
    assert.equal(visto.authorization,`Bearer ${secret}`);
    assert.equal(visto.host,host,'o Paseo vê o mesmo host:porta que o navegador');
    assert.equal(visto['x-forwarded-proto'],'http');
  }
});

test('local: Host de fora é recusado (DNS rebinding) e não chega ao Paseo',async()=>{
  for(const host of ['evil.example.com',`evil.example.com:${port}`,'localhost','localhost.evil.com:80',`127.0.0.1.evil.com:${port}`,'[::1]:80']){
    visto=null;const r=await pedir('/api/agents',{host});
    assert.equal(r.status,403,host);assert.equal(visto,null,'nada foi repassado: '+host);
    assert.match(r.body,/localhost/);
  }
});

test('local: o túnel pode usar outra porta no computador do aluno (LocalForward 7000 ...)',async()=>{
  visto=null;const r=await pedir('/api/agents',{host:'localhost:7000'});
  assert.equal(r.status,200);assert.equal(visto.host,'localhost:7000');
  const post=await pedir('/api/agents',{host:'localhost:7000',method:'POST',headers:{origin:'http://localhost:7000','content-type':'application/json'}});
  assert.equal(post.status,200);
  const cruzado=await pedir('/api/agents',{host:'localhost:7000',method:'POST',headers:{origin:`http://localhost:${port}`,'content-type':'application/json'}});
  assert.equal(cruzado.status,403,'origem tem que bater com o endereço usado');
});

test('local: outro site aberto no navegador não consegue mudar nada',async()=>{
  const r=await pedir('/api/agents',{method:'POST',headers:{origin:'https://evil.example.com','content-type':'application/json'}});
  assert.equal(r.status,403);
  const ok=await pedir('/api/agents',{method:'POST',headers:{origin:`http://localhost:${port}`,'content-type':'application/json'}});
  assert.equal(ok.status,200);
});

test('local: WebSocket só abre com Origin e Host locais, e a senha nunca volta pro navegador',async()=>{
  const abrir=(origin,host)=>new Promise(resolve=>{
    const ws=new WebSocket(`ws://127.0.0.1:${port}/ws`,['cliente'],{origin,headers:host?{host}:{}});
    ws.on('message',d=>{resolve({ok:String(d),protocolo:ws.protocol});ws.close();});
    ws.on('unexpected-response',(_,res)=>resolve({status:res.statusCode}));ws.on('error',()=>resolve({erro:true}));
  });
  const bom=await abrir(`http://localhost:${port}`,`localhost:${port}`);
  assert.equal(bom.ok,'ready');assert.equal(bom.protocolo,'cliente');
  assert.equal(visto['sec-websocket-protocol'],`paseo.bearer.${secret}`);
  assert.equal((await abrir('https://evil.example.com',`localhost:${port}`)).status,403);
  assert.equal((await abrir(`http://localhost:${port}`,'evil.example.com')).status,403);
});

test('local: exige a porta na configuração',()=>{
  assert.throws(()=>createGateway({password:secret,access:{mode:'local'}}),/Invalid gateway configuration/);
});
