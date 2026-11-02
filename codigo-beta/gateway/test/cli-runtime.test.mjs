import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,mkdir,stat,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {once} from 'node:events';
import {createCliRuntime} from '../cli-runtime.mjs';

test('real PTY runner accepts one code without echo, stops on cancel, and backs up credentials privately',async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'ratoeira-cli-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const cli=path.join(dir,'fixture.py');
  await writeFile(cli,`#!/usr/bin/python3
import sys,os,json,time
if 'status' in sys.argv:
 print(json.dumps({'loggedIn':True,'email':'test@example.com','subscriptionType':'max'}) if '--json' in sys.argv else 'Logged in using ChatGPT')
 sys.exit(0)
assert sys.stdin.isatty()
assert 'PASEO_PASSWORD' not in os.environ
print('https://claude.com/cai/oauth/authorize?state=fixture',flush=True)
print('Paste code here',flush=True)
code=input()
assert code=='test-code#fixture'
print('Login successful.',flush=True)
`,{mode:0o700});
  const runtime=createCliRuntime({cli:{claude:cli,codex:cli},homeDir:dir,dataDir:path.join(dir,'state')});
  assert.equal((await runtime.status('claude')).status,'connected');
  await mkdir(path.join(dir,'.claude'));await writeFile(path.join(dir,'.claude','.credentials.json'),'PRIVATE_FIXTURE',{mode:0o600});
  await runtime.backup('claude');
  const {readdir}=await import('node:fs/promises');const backups=await readdir(path.join(dir,'state','auth-backups'));const saved=path.join(dir,'state','auth-backups',backups[0]);
  assert.equal((await stat(saved)).mode&0o777,0o600);assert.equal(await readFile(saved,'utf8'),'PRIVATE_FIXTURE');
  const child=runtime.launch('claude');let output='';let sent=false;
  child.stdout.on('data',chunk=>{output+=chunk.toString();if(!sent&&output.includes('Paste code here')){sent=true;child.stdin.write('test-code#fixture\n');}});
  const [code]=await once(child,'exit',{signal:AbortSignal.timeout(5000)});assert.equal(code,0);assert.ok(!output.includes('test-code#fixture'));
  const cancelled=runtime.launch('claude');await once(cancelled.stdout,'data',{signal:AbortSignal.timeout(5000)});cancelled.kill();await once(cancelled,'exit',{signal:AbortSignal.timeout(5000)});
});

test('codex-geral: login num CODEX_HOME só dele, lido e apagado no fim',async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'ratoeira-cli-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const cli=path.join(dir,'codex.py');
  await writeFile(cli,`#!/usr/bin/python3
import sys,os,json
assert sys.argv[1:]==['login','--device-auth']
h=os.environ['CODEX_HOME']
assert h!=os.path.join(os.environ['HOME'],'.codex')
json.dump({'auth_mode':'chatgpt','tokens':{'refresh_token':'r'}},open(os.path.join(h,'auth.json'),'w'))
`,{mode:0o700});
  const runtime=createCliRuntime({cli:{claude:cli,codex:cli},homeDir:dir,dataDir:path.join(dir,'state')});
  const child=runtime.launch('codex-geral');
  const [code]=await once(child,'exit',{signal:AbortSignal.timeout(5000)});assert.equal(code,0);
  assert.deepEqual(await runtime.lerCodexGeral(),{auth_mode:'chatgpt',tokens:{refresh_token:'r'}});
  await assert.rejects(stat(path.join(dir,'state','codex-geral-login')),{code:'ENOENT'});
  await assert.rejects(runtime.lerCodexGeral(),{status:502});
});
