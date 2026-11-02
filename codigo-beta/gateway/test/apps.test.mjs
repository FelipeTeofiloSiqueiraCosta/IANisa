import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { generateKeyPair, SignJWT } from 'jose';
import { WebSocket } from 'ws';
import { createAccessVerifier } from '../access.mjs';
import { createGateway } from '../server.mjs';

// Aplicações com servidor próprio (ex.: um sistema em /sistema na porta X): o gateway repassa o caminho,
// deixa abrir sem login só o que é público e prende um email às aplicações liberadas pra ele.
const pair = await generateKeyPair('RS256');
const issuer = 'https://test.cloudflareaccess.com';
const verify = createAccessVerifier({issuer, audience:'test-app', allowedEmails:['ana@example.com','fin@example.com']}, pair.publicKey);
const token = email => new SignJWT({email}).setProtectedHeader({alg:'RS256'}).setIssuer(issuer).setAudience('test-app').setExpirationTime('2m').sign(pair.privateKey);
const time = {'cf-access-jwt-assertion':await token('ana@example.com')};
const fin = {'cf-access-jwt-assertion':await token('fin@example.com')};
const origin = 'https://ratoeira.example.com';

let seen, paseoHits = 0;
const app = http.createServer((req, res) => { seen = {path:req.url, method:req.method, headers:req.headers}; res.setHeader('content-type','text/html'); res.end('<p>sistema</p>'); });
const paseo = http.createServer((req, res) => { paseoHits++; res.setHeader('content-type','application/json'); res.end('{"ok":true}'); });
await new Promise(r => app.listen(0,'127.0.0.1',r));
await new Promise(r => paseo.listen(0,'127.0.0.1',r));
const gateway = createGateway({hostname:'ratoeira.example.com', upstreamPort:paseo.address().port, password:'TEST_ONLY_DAEMON_PASSWORD', verify,
  apps:[{prefix:'/sistema', port:app.address().port, public:['/p/','/d/']}], restrictTo:{'fin@example.com':['/sistema']}});
await new Promise(r => gateway.listen(0,'127.0.0.1',r));
const base = `http://127.0.0.1:${gateway.address().port}`;
after(async()=>{
  gateway.closeAllConnections(); app.closeAllConnections(); paseo.closeAllConnections();
  await Promise.all([gateway, app, paseo].map(s => new Promise(r => s.close(r))));
});

test('a aplicação pede o login da Ratoeira', async()=>{
  seen = null;
  const r = await fetch(base+'/sistema/clientes');
  assert.equal(r.status, 401);
  assert.equal(seen, null);
});

test('repassa o caminho como está, sem a identidade da Cloudflare e sem a senha do Paseo', async()=>{
  const r = await fetch(base+'/sistema/clientes?x=1', {headers:{...time, 'cf-connecting-ip':'200.1.2.3', 'x-forwarded-for':'6.6.6.6',
    authorization:'Bearer forjado', cookie:'CF_Authorization=abc; sistema=sessao'}});
  assert.equal(r.status, 200);
  assert.equal(await r.text(), '<p>sistema</p>');
  assert.equal(seen.path, '/sistema/clientes?x=1');
  assert.equal(seen.headers['cf-access-jwt-assertion'], undefined);
  assert.equal(seen.headers.authorization, undefined);
  assert.equal(seen.headers.cookie, 'sistema=sessao');
  assert.equal(seen.headers['x-forwarded-for'], '200.1.2.3');
  assert.equal(seen.headers['x-forwarded-proto'], 'https');
  assert.equal(seen.headers.host, 'ratoeira.example.com');
});

test('o link público abre sem login, e o formulário dele só vindo do próprio domínio', async()=>{
  assert.equal((await fetch(base+'/sistema/p/abc123')).status, 200);
  assert.equal((await fetch(base+'/sistema/d/abc123/atual/')).status, 200);
  assert.equal((await fetch(base+'/sistema/p/abc123', {method:'POST', body:'senha=x'})).status, 403);
  assert.equal((await fetch(base+'/sistema/p/abc123', {method:'POST', body:'senha=x', headers:{origin}})).status, 200);
  assert.equal(seen.method, 'POST');
});

test('o público não serve de atalho pro resto da aplicação', async()=>{
  for (const caminho of ['/sistema/p/../api/dados', '/sistema/p/%2e%2e/api/dados', '/sistema/p/x/%2E%2E/%2E%2E/api', '/sistema/clientes', '/sistema/api/dados']) {
    const r = await fetch(base+caminho);
    assert.equal(r.status, 401, caminho);
  }
  assert.equal((await fetch(base+'/sistema/p/abc', {method:'DELETE', headers:{origin}})).status, 401);
});

test('quem está preso a uma aplicação não chega no portal, no Paseo nem no WebSocket', async()=>{
  const home = await fetch(base+'/', {headers:fin, redirect:'manual'});
  assert.equal(home.status, 302);
  assert.equal(home.headers.get('location'), '/sistema/');
  assert.equal((await fetch(base+'/portal/', {headers:fin, redirect:'manual'})).headers.get('location'), '/sistema/');
  const antes = paseoHits;
  assert.equal((await fetch(base+'/api/agents', {headers:fin})).status, 403);
  assert.equal((await fetch(base+'/_ratoeira/api/portal', {headers:fin})).status, 403);
  assert.equal(paseoHits, antes);
  assert.equal((await fetch(base+'/sistema/', {headers:fin})).status, 200);
  const ws = new WebSocket(base.replace('http','ws')+'/ws', {headers:{...fin, origin}});
  const status = await new Promise(r => { ws.on('unexpected-response', (_q, res) => r(res.statusCode)); ws.on('open', () => r('aberto')); ws.on('error', () => r('erro')); });
  assert.equal(status, 403);
});

test('o time segue chegando no Paseo', async()=>{
  const antes = paseoHits;
  assert.equal((await fetch(base+'/api/agents', {headers:time})).status, 200);
  assert.equal(paseoHits, antes + 1);
});

test('configuração errada não sobe', ()=>{
  const ok = {hostname:'r.example.com', password:'x', verify};
  assert.throws(() => createGateway({...ok, apps:[{prefix:'/portal', port:9000}]}));
  assert.throws(() => createGateway({...ok, apps:[{prefix:'sistema', port:9000}]}));
  assert.throws(() => createGateway({...ok, apps:[{prefix:'/sistema', port:'9000'}]}));
  assert.throws(() => createGateway({...ok, apps:[{prefix:'/sistema', port:9000, public:['p']}]}));
  assert.throws(() => createGateway({...ok, apps:[{prefix:'/sistema', port:9000}], restrictTo:{'a@b.c':['/outro']}}));
});
