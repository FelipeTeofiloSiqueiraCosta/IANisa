import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {ConnectionManager,parseLoginOutput,parseStatus} from '../connections.mjs';

const owner='ana@example.com';
function fakeChild(){const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.stdin=new PassThrough();child.killed=false;child.kill=()=>{child.killed=true;};return child;}
test('status allowlists account metadata and never returns raw CLI output or API secrets',()=>{
  const status=parseStatus('claude',{stdout:JSON.stringify({loggedIn:true,email:owner,subscriptionType:'max',accessToken:'SHOULD_NOT_ESCAPE'}),code:0});
  assert.equal(status.status,'connected');assert.equal(status.account,owner);assert.ok(!JSON.stringify(status).includes('SHOULD_NOT_ESCAPE'));
  assert.equal(parseStatus('codex',{stderr:'Logged in using ChatGPT',code:0}).status,'connected');
  assert.equal(parseStatus('codex',{stderr:'Not logged in',code:1}).status,'disconnected');
  assert.equal(parseStatus('claude',{stdout:'SHOULD_NOT_ESCAPE',code:1}).status,'unknown');
});
test('login parser emits only provider URLs and a device code, not arbitrary output',()=>{
  assert.deepEqual(parseLoginOutput('claude','https://evil.example/phish https://claude.com/cai/oauth/authorize?state=okay\nPaste code here'),{url:'https://claude.com/cai/oauth/authorize?state=okay',stage:'code'});
  assert.deepEqual(parseLoginOutput('codex','Open https://auth.openai.com/codex/device\n\x1b[32mABCD-1234\x1b[0m'),{url:'https://auth.openai.com/codex/device',deviceCode:'ABCD-1234',stage:'authorize'});
  assert.deepEqual(parseLoginOutput('claude','token=SHOULD_NOT_ESCAPE https://claude.com.evil.example/oauth/authorize'),{});
});
test('only the owner controls one active login, code goes to stdin once and is not retained',async t=>{
  const child=fakeChild();let launched=0;
  const manager=new ConnectionManager({launch:()=>{launched++;return child;},backup:async()=>{},status:async()=>({status:'connected'}),timeoutMs:1000,enterDelayMs:5}); t.after(()=>manager.close());
  const flow=await manager.start('claude',owner); assert.equal(flow.stage,'starting');
  await assert.rejects(manager.start('claude','other@example.com'),/andamento/);
  assert.equal(manager.current('other@example.com'),null);
  child.stdout.write('https://claude.com/cai/oauth/authorize?state=x\nPaste code here');
  assert.equal(manager.current(owner).stage,'code');
  assert.throws(()=>manager.submit(flow.id,'other@example.com','abc#state'),/encontrado/);
  let written=''; child.stdin.on('data',data=>written+=data);
  manager.submit(flow.id,owner,'abc123#state'); assert.equal(written,'abc123#state');
  // o Enter vai depois, separado: junto do código a tela do CLI trata como colagem e engole o \r
  await new Promise(r=>setTimeout(r,20)); assert.equal(written,'abc123#state\r');
  assert.throws(()=>manager.submit(flow.id,owner,'again#state'),/aguarde/i);
  assert.ok(!JSON.stringify(manager.current(owner)).includes('abc123#state'));
  child.emit('exit',0); await new Promise(r=>setImmediate(r));
  assert.equal(manager.current(owner).stage,'complete'); assert.equal(launched,1);
});
test('timeouts and cancellation stop only their login process and redact failure output',async t=>{
  const children=[];const manager=new ConnectionManager({launch:()=>{const c=fakeChild();children.push(c);return c;},backup:async()=>{},timeoutMs:25});t.after(()=>manager.close());
  await manager.start('codex',owner);children[0].stderr.write('fatal secret: SHOULD_NOT_ESCAPE');
  await new Promise(r=>setTimeout(r,40)); assert.equal(manager.current(owner).stage,'error'); assert.equal(children[0].killed,true);
  assert.ok(!JSON.stringify(manager.current(owner)).includes('SHOULD_NOT_ESCAPE'));
  const second=await manager.start('claude',owner); manager.cancel(second.id,owner); assert.equal(children[1].killed,true);assert.equal(manager.current(owner).stage,'cancelled');
  await assert.rejects(manager.start('arbitrary-command',owner));
});

test('status do Claude pelo token de longa duração aparece como conta geral',()=>{
  const r=parseStatus('claude',{stdout:JSON.stringify({loggedIn:true,authMethod:'oauth_token'}),code:0});
  assert.equal(r.status,'connected');assert.equal(r.via,'geral');assert.match(r.message,/conta geral/);
  assert.equal(parseStatus('claude',{stdout:JSON.stringify({loggedIn:true,authMethod:'claude.ai',email:'a@x.com'}),code:0}).via,undefined);
});

test('link do login em hyperlink de terminal (OSC 8), com o texto visível quebrado',()=>{
  const url='https://claude.com/cai/oauth/authorize?code=true&client_id=9d1c&response_type=code&scope=user%3Ainference&state=abc123XYZ';
  const raw=`Browser didn't open? Use the url below\r\n\x1b]8;id=w;${url}\x1b\\${url.slice(0,60)}\x1b]8;;\x1b\\\r\n\x1b]8;id=w;${url}\x1b\\${url.slice(60)}\x1b]8;;\x1b\\\r\n\r\nPaste code here if prompted >`;
  const r=parseLoginOutput('claude-token',raw);
  assert.equal(r.url,url);assert.equal(r.stage,'code');
});

test('claude-token guarda o token assim que aparece, sem esperar o CLI sair',async t=>{
  const child=fakeChild();let guardado;
  const manager=new ConnectionManager({launch:()=>child,timeoutMs:1000,enterDelayMs:1,aoToken:async tk=>{guardado=tk;}});t.after(()=>manager.close());
  const flow=await manager.start('claude-token',owner);
  child.stdout.write('https://claude.com/cai/oauth/authorize?state=x\nPaste code here if prompted >');
  manager.submit(flow.id,owner,'abc123#state');
  const token='sk-ant-oat01-'+'A'.repeat(90);
  child.stdout.write(`\x1b[32mYour OAuth token (valid for 1 year):\x1b[0m\r\n${token}\r\nPress Enter to continue`);
  await new Promise(r=>setTimeout(r,10));
  assert.equal(guardado,token);assert.equal(manager.current(owner).stage,'complete');assert.equal(child.killed,true);
  assert.ok(!JSON.stringify(manager.current(owner)).includes(token));
});
test('claude-token com código recusado vira erro e encerra o CLI',async t=>{
  const child=fakeChild();
  const manager=new ConnectionManager({launch:()=>child,timeoutMs:1000,enterDelayMs:1,aoToken:async()=>{}});t.after(()=>manager.close());
  const flow=await manager.start('claude-token',owner);
  child.stdout.write('https://claude.com/cai/oauth/authorize?state=x\nPaste code here if prompted >');
  manager.submit(flow.id,owner,'abc123#state');
  child.stdout.write('OAuth error: Request failed with status code 400 Press Enter to retry.');
  assert.equal(manager.current(owner).stage,'error');assert.match(manager.current(owner).message,/recusou/);assert.equal(child.killed,true);
});

test('codex-geral mostra o link e o código do dispositivo e guarda a conta quando o login termina bem',async t=>{
  const child=fakeChild();let chamado=0;
  const manager=new ConnectionManager({launch:()=>child,timeoutMs:1000,aoCodexGeral:async()=>{chamado++;}});t.after(()=>manager.close());
  await manager.start('codex-geral',owner);
  child.stdout.write('Open https://auth.openai.com/codex/device and enter ABCD-12345\n');
  await new Promise(r=>setTimeout(r,5));
  assert.equal(manager.current(owner).url,'https://auth.openai.com/codex/device');assert.equal(manager.current(owner).deviceCode,'ABCD-12345');
  child.emit('exit',0);await new Promise(r=>setTimeout(r,5));
  assert.equal(chamado,1);assert.equal(manager.current(owner).stage,'complete');
});
test('codex-geral sem conta gerada vira erro',async t=>{
  const child=fakeChild();
  const manager=new ConnectionManager({launch:()=>child,timeoutMs:1000,aoCodexGeral:async()=>{throw Object.assign(new Error('Não achei a conta.'),{status:502});}});t.after(()=>manager.close());
  await manager.start('codex-geral',owner);child.emit('exit',0);await new Promise(r=>setTimeout(r,5));
  assert.equal(manager.current(owner).stage,'error');assert.equal(manager.current(owner).message,'Não achei a conta.');
});
