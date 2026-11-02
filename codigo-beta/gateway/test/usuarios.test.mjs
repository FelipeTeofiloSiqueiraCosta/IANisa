import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { generateKeyPair, SignJWT } from 'jose';
import { WebSocket, WebSocketServer } from 'ws';
import { createAccessVerifier } from '../access.mjs';
import { createGateway } from '../server.mjs';
import { normalizeUsers, createAcesso } from '../usuarios.mjs';

// Multiusuário sem Paseo por pessoa (saiu em 09/10/2026): quem está no mapa não chega mais em Paseo nenhum
// (endereço do Paseo dá 404; chat, terminal e Contas de IA vão pelo servidor de agentes dela). Quem não
// está no mapa segue no Paseo único (porta), como no kit 0.1.0.
const pair = await generateKeyPair('RS256');
const issuer = 'https://test.cloudflareaccess.com';
const emails = ['ana@example.com','beto@example.com','caio@example.com','fin@example.com'];
const verify = createAccessVerifier({issuer, audience:'test-app', allowedEmails:emails}, pair.publicKey);
const login = async email => ({'cf-access-jwt-assertion':await new SignJWT({email}).setProtectedHeader({alg:'RS256'}).setIssuer(issuer).setAudience('test-app').setExpirationTime('2m').sign(pair.privateKey)});
const [ana, beto, caio, fin] = await Promise.all(emails.map(login));
const origin = 'https://ratoeira.example.com';
const secret = 'TEST_ONLY_DAEMON_PASSWORD';

const dir = mkdtempSync(path.join(tmpdir(), 'rt-sock-'));
const seen = {};
function fakePaseo(name) {
  const server = http.createServer((req, res) => {
    seen[name] = {path:req.url, headers:req.headers};
    res.setHeader('content-type','application/json'); res.end(JSON.stringify({paseo:name}));
  });
  const wss = new WebSocketServer({noServer:true});
  server.on('upgrade', (req, socket, head) => {
    seen[name] = {path:req.url, headers:req.headers, ws:true};
    wss.handleUpgrade(req, socket, head, ws => ws.send(name));
  });
  server.wss = wss;
  return server;
}
const paseoUnico = fakePaseo('unico');
await new Promise(r => paseoUnico.listen(0,'127.0.0.1', r));
const users = {'ana@example.com':'rt-ana', 'Beto@Example.com':{user:'rt-beto', repoDir:'/home/rt-beto/trabalho'}};
const paseoSocket = path.join(dir,'{user}.sock');
const gateway = createGateway({hostname:'ratoeira.example.com', upstreamPort:paseoUnico.address().port, password:secret, verify, users, paseoSocket,
  paseoCompartilhado:['caio@example.com'], apps:[{prefix:'/sistema', port:1}], restrictTo:{'fin@example.com':['/sistema']}});
await new Promise(r => gateway.listen(0,'127.0.0.1',r));
const base = `http://127.0.0.1:${gateway.address().port}`;
// sem senha: não existe Paseo único, só o mapa
const soMapa = createGateway({hostname:'ratoeira.example.com', verify, users, paseoSocket});
await new Promise(r => soMapa.listen(0,'127.0.0.1',r));
const baseSoMapa = `http://127.0.0.1:${soMapa.address().port}`;
after(async()=>{
  for (const c of paseoUnico.wss.clients) c.terminate();
  for (const s of [gateway, soMapa, paseoUnico]) s.closeAllConnections();
  await Promise.all([gateway, soMapa, paseoUnico].map(s => new Promise(r => s.close(r))));
  rmSync(dir, {recursive:true, force:true});
});

const wsOpen = (url, headers) => new Promise(resolve => {
  const ws = new WebSocket(url, ['paseo.bearer.salvo-no-navegador'], {headers});
  ws.on('message', data => { resolve({first:String(data), protocol:ws.protocol}); ws.close(); });
  ws.on('unexpected-response', (_q, res) => { res.resume(); resolve({status:res.statusCode}); });
  ws.on('error', () => resolve({status:'erro'}));
});

test('quem tem ambiente próprio não chega em Paseo nenhum: 404 no HTTP, recusa no WebSocket', async()=>{
  seen.unico = null;
  for (const quem of [ana, beto]) {
    const r = await fetch(base+'/api/agents?x=1', {headers:{...quem, authorization:'Bearer forjado'}});
    assert.equal(r.status, 404);
    assert.match(await r.text(), /não existe nesta Ratoeira/);
    assert.equal((await wsOpen(base.replace('http','ws')+'/ws', {...quem, origin})).status, 403);
  }
  assert.equal(seen.unico, null);
});

test('caso 1, sem users: todo mundo no Paseo único, como no kit 0.1.0', async()=>{
  const g = createGateway({hostname:'ratoeira.example.com', upstreamPort:paseoUnico.address().port, password:secret, verify});
  await new Promise(r => g.listen(0,'127.0.0.1',r));
  const b = `http://127.0.0.1:${g.address().port}`;
  for (const quem of [ana, caio]) assert.equal((await (await fetch(b+'/api/agents', {headers:quem})).json()).paseo, 'unico');
  assert.equal((await wsOpen(b.replace('http','ws')+'/ws', {...ana, origin})).first, 'unico');
  g.closeAllConnections(); await new Promise(r => g.close(r));
});

test('caso 2, com users e sem lista: quem não está no mapa fica sem Paseo, mesmo com a senha configurada', async()=>{
  const g = createGateway({hostname:'ratoeira.example.com', upstreamPort:paseoUnico.address().port, password:secret, verify, users, paseoSocket});
  await new Promise(r => g.listen(0,'127.0.0.1',r));
  const b = `http://127.0.0.1:${g.address().port}`;
  seen.unico = null;
  const r = await fetch(b+'/api/agents', {headers:caio});
  assert.equal(r.status, 403);
  assert.match(await r.text(), /ainda não tem um ambiente/);
  assert.equal((await wsOpen(b.replace('http','ws')+'/ws', {...caio, origin})).status, 403);
  assert.equal(seen.unico, null);
  g.closeAllConnections(); await new Promise(r => g.close(r));
});

test('caso 3, com users e lista: só quem está em paseoCompartilhado chega no Paseo único, com a senha', async()=>{
  assert.equal((await (await fetch(base+'/api/agents', {headers:caio})).json()).paseo, 'unico');
  assert.equal(seen.unico.headers.authorization, 'Bearer '+secret);
  // o endereço que o Paseo devolve pro navegador sai do Host: segue o público
  assert.equal(seen.unico.headers.host, 'ratoeira.example.com:443');
  assert.equal(seen.unico.headers['cf-access-jwt-assertion'], undefined);
  // fin está fora do mapa e fora da lista (e preso a /sistema): nada de Paseo único
  assert.equal((await fetch(base+'/api/agents', {headers:fin})).status, 403);
});

test('WebSocket do Paseo único leva a senha e devolve ao navegador o protocolo dele', async()=>{
  const r = await wsOpen(base.replace('http','ws')+'/ws', {...caio, origin});
  assert.equal(r.first, 'unico');
  assert.equal(seen.unico.headers['sec-websocket-protocol'], 'paseo.bearer.'+secret);
  assert.equal(r.protocol, 'paseo.bearer.salvo-no-navegador');
});

test('origem de fora continua barrada antes de chegar no Paseo', async()=>{
  seen.unico = null;
  assert.equal((await wsOpen(base.replace('http','ws')+'/ws', {...caio, origin:'https://evil.example'})).status, 403);
  assert.equal((await fetch(base+'/api/agents', {method:'POST', headers:caio})).status, 403);
  assert.equal(seen.unico, null);
});

test('restrictTo segue valendo', async()=>{
  assert.equal((await fetch(base+'/api/agents', {headers:fin})).status, 403);
  assert.equal((await wsOpen(base.replace('http','ws')+'/ws', {...fin, origin})).status, 403);
});

test('sem Paseo único, quem não está no mapa não entra', async()=>{
  assert.equal((await fetch(baseSoMapa+'/api/agents', {headers:ana})).status, 404);
  const r = await fetch(baseSoMapa+'/api/agents', {headers:caio});
  assert.equal(r.status, 403);
  assert.match(await r.text(), /ainda não tem um ambiente/);
  assert.equal((await wsOpen(baseSoMapa.replace('http','ws')+'/ws', {...caio, origin})).status, 403);
});

test('mapa de usuários errado não sobe', ()=>{
  assert.throws(() => normalizeUsers({'ana@x.com':'../root'}));
  assert.throws(() => normalizeUsers({'ana@x.com':'Ana'}));
  assert.throws(() => normalizeUsers({'ana':'ana'}));
  assert.throws(() => normalizeUsers({'ana@x.com':{user:'ana', repoDir:'relativo'}}));
  assert.throws(() => normalizeUsers({'ana@x.com':{user:'ana', repoDir:'/home/ana/../beto'}}));
  assert.throws(() => normalizeUsers({'ana@x.com':'ana'}, '/run/fixo.sock'));
  assert.throws(() => createGateway({hostname:'r.example.com', verify}));
  // lista sem mapa, e-mail nos dois lugares, lista com Paseo único mas sem senha
  assert.throws(() => createAcesso({paseoCompartilhado:['caio@x.com']}));
  assert.throws(() => createAcesso({users:{'ana@x.com':'ana'}, paseoCompartilhado:['Ana@X.com']}));
  assert.throws(() => createAcesso({users:{'ana@x.com':'ana'}, paseoCompartilhado:'caio@x.com'}));
  assert.throws(() => createGateway({hostname:'r.example.com', verify, users:{'ana@x.com':'ana'}, paseoCompartilhado:['caio@x.com']}));
  // só mapa: a senha que sobrou no ambiente é ignorada, não trava a subida
  assert.doesNotThrow(() => createGateway({hostname:'r.example.com', verify, users:{'ana@x.com':'ana'}, password:'sobrou'}));
  const mapa = normalizeUsers({'Ana@X.com':{user:'ana', repoDir:'/home/ana/trabalho'}});
  assert.deepEqual(mapa.get('ana@x.com'), {user:'ana', socketPath:'/run/ratoeira-ana/paseo.sock', repoDir:'/home/ana/trabalho'});
});
