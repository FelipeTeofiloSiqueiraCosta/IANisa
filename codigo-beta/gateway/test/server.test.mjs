import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { generateKeyPair, SignJWT } from 'jose';
import { WebSocket, WebSocketServer } from 'ws';
import { createAccessVerifier } from '../access.mjs';
import { createGateway } from '../server.mjs';

const pair = await generateKeyPair('RS256');
const secret = 'TEST_ONLY_DAEMON_PASSWORD';
const issuer = 'https://test.cloudflareaccess.com';
const verify = createAccessVerifier({issuer, audience:'test-app', allowedEmails:['ana@example.com']}, pair.publicKey);
const jwt = await new SignJWT({email:'ana@example.com'}).setProtectedHeader({alg:'RS256'})
  .setIssuer(issuer).setAudience('test-app').setExpirationTime('2m').sign(pair.privateKey);
const auth = {'cf-access-jwt-assertion':jwt};
const origin = 'https://ratoeira.example.com';
const defaults = {
  landingPath:'/new?serverId=srv_test&dir=%2Fwork%2Fproject&name=Project&projectId=prj_test',
  agent:{provider:'claude',model:'claude-opus-5',thinkingOptionId:'high'},
};
let seenHeaders, seenPath, upgrades = 0;
const upstream = http.createServer((req, res) => {
  seenHeaders = req.headers; seenPath = req.url;
  if (req.url === '/' || req.url.startsWith('/new?') || req.url.startsWith('/h/')) {
    res.setHeader('content-type','text/html');
    // Paseo derives the first-browser connection hint from the proxy's public headers.
    const hint = {listen:req.headers.host,useTls:req.headers['x-forwarded-proto']==='https'};
    res.end('<html><head><title>Paseo</title><meta name="apple-mobile-web-app-title" content="Paseo" />'+
      `<script>window.__PASEO_INITIAL_DAEMON_CONNECTION__=${JSON.stringify(hint)}</script>`+
      '</head><body>Hello</body></html>');
  } else { res.setHeader('content-type','application/json'); res.end('{"ok":true}'); }
});
const wss = new WebSocketServer({noServer:true,verifyClient:({req})=>{
  // Paseo 0.7.2 compares public (non-loopback) WebSocket origins with Host literally.
  return req.headers.origin===`https://${req.headers.host}`;
}});
upstream.on('upgrade',(req,socket,head)=>{
  upgrades++; seenHeaders=req.headers;
  wss.handleUpgrade(req,socket,head,ws=>{
    ws.send('ready'); ws.on('message',data=>ws.send(data));
  });
});
await new Promise(resolve => upstream.listen(0,'127.0.0.1',resolve));
const gateway = createGateway({hostname:'ratoeira.example.com',upstreamPort:upstream.address().port,password:secret,verify,defaults});
await new Promise(resolve => gateway.listen(0,'127.0.0.1',resolve));
const base = `http://127.0.0.1:${gateway.address().port}`;
after(async()=>{
  for (const client of wss.clients) client.terminate();
  gateway.closeAllConnections(); upstream.closeAllConnections();
  await Promise.all([new Promise(r=>gateway.close(r)),new Promise(r=>upstream.close(r)),new Promise(r=>wss.close(r))]);
});

test('blocks unauthenticated HTTP even with a forged email header', async()=>{
  const r=await fetch(base+'/api/agents',{headers:{'cf-access-authenticated-user-email':'ana@example.com'}});
  assert.equal(r.status,401);
});
test('opens the configured project only after login and preserves conversation links',async()=>{
  const denied=await fetch(base+'/',{redirect:'manual'});
  assert.equal(denied.status,401);
  assert.equal(denied.headers.get('location'),null);
  const root=await fetch(base+'/',{headers:auth,redirect:'manual'});
  assert.equal(root.status,302);
  assert.equal(root.headers.get('location'),defaults.landingPath);
  assert.equal(root.headers.get('cache-control'),'no-store');
  const conversation=await fetch(base+'/h/srv_test/workspace/wks_existing',{headers:auth,redirect:'manual'});
  assert.equal(conversation.status,200);
  assert.equal(conversation.headers.get('location'),null);
  const html=await conversation.text();
  const config=html.match(/<script type="application\/json" id="ratoeira-defaults">([^<]+)<\/script>/);
  assert.ok(config,'Initial model preferences must be available before the app starts');
  assert.deepEqual(JSON.parse(config[1]),defaults.agent);
  assert.ok(!html.includes(secret));
});
test('forwards authenticated HTTP with private daemon auth and original path',async()=>{
  const r=await fetch(base+'/api/agents?limit=2',{headers:{...auth,authorization:'Bearer attacker',cookie:'CF_Authorization=private; theme=light'}});
  assert.equal(r.status,200); assert.equal(seenPath,'/api/agents?limit=2');
  assert.equal(seenHeaders.authorization,'Bearer '+secret);
  assert.equal(seenHeaders['cf-access-jwt-assertion'],undefined);
  assert.equal(seenHeaders.cookie,'theme=light');
  assert.equal(seenHeaders.host,'ratoeira.example.com:443');
  assert.equal(seenHeaders['x-forwarded-proto'],'https');
  assert.ok(!(await r.text()).includes(secret));
});
test('rejects cross-site requests and unsafe methods without Origin',async()=>{
  for(const options of [{headers:{...auth,origin:'https://evil.example'}},{method:'POST',headers:auth}]){
    assert.equal((await fetch(base+'/api/agents',options)).status,403);
  }
  assert.equal((await fetch(base+'/api/agents',{method:'POST',headers:{...auth,origin}})).status,200);
});
test('bootstraps a new browser with an explicit public HTTPS port',async()=>{
  const html=await (await fetch(base+'/',{headers:auth})).text();
  const match=html.match(/window\.__PASEO_INITIAL_DAEMON_CONNECTION__=(\{[^<]+\})<\/script>/);
  assert.ok(match,'The daemon connection hint must survive HTML branding');
  const hint=JSON.parse(match[1]);
  // Paseo normalizeHostPort rejects a bare hostname, even for default HTTPS port 443.
  assert.equal(hint.listen,'ratoeira.example.com:443');
  assert.equal(hint.useTls,true);
  assert.equal(hint.password,undefined);
});
test('serves Ratos icons and app metadata without revealing the daemon password',async()=>{
  const html=await (await fetch(base+'/',{headers:auth})).text();
  assert.match(html,/<title>Ratoeira<\/title>/); assert.ok(!html.includes(secret));
  for(const path of ['/favicon.ico','/apple-touch-icon.png','/assets/assets/images/favicon-dark.8005ed36ac07a5a7c60de25780897bd4.png']) {
    const r=await fetch(base+path,{headers:auth}); assert.equal(r.status,200); assert.ok((await r.arrayBuffer()).byteLength>100);
  }
  const r=await fetch(base+'/manifest.json',{headers:auth});
  assert.equal((await r.json()).name,'Ratoeira');
});
test('rejects WebSocket before upstream when unauthenticated or cross-origin',async()=>{
  for(const headers of [{origin},{...auth,origin:'https://evil.example'}]){
    const before=upgrades;
    await new Promise((resolve,reject)=>{
      const ws=new WebSocket(base.replace('http:','ws:')+'/ws',{headers});
      ws.on('unexpected-response',(_req,res)=>{assert.ok([401,403].includes(res.statusCode));res.resume();ws.terminate();resolve();});
      ws.on('open',()=>reject(new Error('Unauthorized socket opened')));ws.on('error',()=>{});
    });
    assert.equal(upgrades,before);
  }
});
test('connects a fresh browser socket with no Paseo password and relays data',async()=>{
  const ws=new WebSocket(base.replace('http:','ws:')+'/ws',{headers:{...auth,origin}});
  const [first]=await Promise.all([once(ws,'message'),once(ws,'open')]);
  assert.equal(String(first[0]),'ready'); assert.equal(ws.protocol,'');
  assert.equal(seenHeaders['sec-websocket-protocol'],'paseo.bearer.'+secret);
  const echoed=once(ws,'message'); ws.send('hello'); assert.equal(String((await echoed)[0]),'hello');
  ws.close(); await once(ws,'close');
});
test('preserves clients that already have a saved Paseo connection',async()=>{
  const ws=new WebSocket(base.replace('http:','ws:')+'/ws',['paseo.bearer.old-browser-value'],{headers:{...auth,origin}});
  await once(ws,'open'); assert.equal(ws.protocol,'paseo.bearer.old-browser-value');
  ws.close(); await once(ws,'close');
});
test('closes a connected WebSocket when the Access identity expires',async()=>{
  const expires = Math.floor(Date.now()/1000)+2;
  const shortJwt=await new SignJWT({email:'ana@example.com'}).setProtectedHeader({alg:'RS256'})
    .setIssuer(issuer).setAudience('test-app').setExpirationTime(expires).sign(pair.privateKey);
  const ws=new WebSocket(base.replace('http:','ws:')+'/ws',{headers:{'cf-access-jwt-assertion':shortJwt,origin}});
  await once(ws,'open');
  await once(ws,'close',{signal:AbortSignal.timeout(4000)});
  assert.ok(Date.now()>=expires*1000);
});
