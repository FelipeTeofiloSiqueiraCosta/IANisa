import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createAgentesRuntime} from '../agentes-runtime.mjs';
import {ConnectionManager} from '../connections.mjs';

// Servidor de agentes de mentira, no mesmo protocolo de /conta (agentes/servidor.mjs).
async function falso(t){
  const sock=path.join(mkdtempSync(path.join(tmpdir(),'agrt-')),'a.sock');
  const entradas=[];const logins=[];let login=null;
  const server=http.createServer((req,res)=>{
    if(req.url==='/conta/claude/status'){res.writeHead(200);return res.end(JSON.stringify({stdout:JSON.stringify({loggedIn:Boolean(entradas.length),email:'ana@example.com'}),stderr:'',code:0,propria:entradas.length>0,geralDisponivel:true}));}
    if(req.url==='/conta/claude/sair'&&req.method==='POST'){entradas.length=0;res.writeHead(200);return res.end(JSON.stringify({ok:true,religou:false}));}
    if(req.url==='/conta/codex/sair'){res.writeHead(409);return res.end(JSON.stringify({erro:'O Codex já está na conta da organização.'}));}
    if(/^\/conta\/claude(-conta)?\/login(\?|$)/.test(req.url)){logins.push(req.url);
      if(login){res.writeHead(409);return res.end();}
      login=res;res.writeHead(200);
      res.write(JSON.stringify({fluxo:'11111111-1111-1111-1111-111111111111'})+'\n');
      res.write(JSON.stringify({saida:'Abra https://claude.com/cai/oauth/authorize?state=x\nPaste code here'})+'\n');
      return;
    }
    // conta pessoal do Codex: o login pelo código de dispositivo termina sozinho quando a pessoa autoriza lá
    if(/^\/conta\/codex-conta\/login(\?|$)/.test(req.url)){logins.push(req.url);res.writeHead(200);
      res.write(JSON.stringify({fluxo:'22222222-2222-2222-2222-222222222222'})+'\n');
      res.write(JSON.stringify({saida:'1. Open https://auth.openai.com/codex/device\n2. Enter this one-time code ABCD-EFGHI\n'})+'\n');
      setTimeout(()=>res.end(JSON.stringify({fim:0})+'\n'),50);return;
    }
    if(/^\/conta\/codex\/(contas|usar)$/.test(req.url)){res.writeHead(200);return res.end(JSON.stringify({ativa:'propria',contas:[{id:'propria'}],url:req.url}));}
    if(req.url==='/conta/fluxo/11111111-1111-1111-1111-111111111111/entrada'){
      let d='';req.on('data',c=>d+=c);req.on('end',()=>{entradas.push(d);res.writeHead(204);res.end();
        if(d==='\r'){login.write(JSON.stringify({saida:'Login ok'})+'\n');login.end(JSON.stringify({fim:0})+'\n');login=null;}});return;
    }
    res.writeHead(404);res.end();
  });
  await new Promise(r=>server.listen(sock,r));t.after(()=>server.close());
  return {sock,entradas,logins};
}

test('status e login pelo servidor de agentes da pessoa, com o código e o Enter em ordem',async t=>{
  const {sock,entradas}=await falso(t);
  const rt=createAgentesRuntime({socketPath:sock});
  assert.equal((await rt.status('claude')).status,'disconnected');
  const manager=new ConnectionManager({launch:rt.launch,backup:rt.backup,status:rt.confirm,timeoutMs:5000,enterDelayMs:5});t.after(()=>manager.close());
  const flow=await manager.start('claude','ana@example.com');
  const ate=async cond=>{const lim=Date.now()+3000;while(!cond()){if(Date.now()>lim)throw new Error('não chegou');await new Promise(r=>setTimeout(r,10));}};
  await ate(()=>manager.current('ana@example.com').stage==='code');
  manager.submit(flow.id,'ana@example.com','codigo-1234567');
  await ate(()=>manager.current('ana@example.com').stage==='complete');
  assert.deepEqual(entradas,['codigo-1234567','\r']);
});

test('servidor desligado: pede pra ligar e avisa que está ligando',async()=>{
  let ligou=0;
  const rt=createAgentesRuntime({socketPath:path.join(tmpdir(),'nao-existe-'+process.pid+'.sock'),ligar:()=>{ligou++;}});
  const s=await rt.status('claude');
  assert.equal(s.status,'unknown');assert.equal(s.ligando,true);assert.equal(ligou,1);
  const child=rt.launch('codex');
  await new Promise(r=>child.on('error',r));
  assert.equal(ligou,2);
  assert.throws(()=>rt.launch('codex-geral'),/inválido/);   // login da conta da organização é do gateway, não da pessoa
});

test('desconectar: repassa pro servidor da pessoa, esquece o status guardado e traduz a recusa',async t=>{
  const {sock,entradas}=await falso(t);entradas.push('x');
  const rt=createAgentesRuntime({socketPath:sock});
  const antes=await rt.status('claude');assert.equal(antes.propria,true);assert.equal(antes.geralDisponivel,true);
  assert.deepEqual(await rt.sair('claude'),{religou:false});
  assert.equal((await rt.status('claude')).propria,false,'não usa o status de antes do desconectar');
  await assert.rejects(rt.sair('codex'),e=>e.status===409&&/organização/.test(e.message));
  await assert.rejects(rt.sair('outro'),/inválido/);
});

test('conta pessoal com login completo: leva nome e id pro servidor da pessoa e termina sem pedir status',async t=>{
  const {sock,entradas,logins}=await falso(t);
  const rt=createAgentesRuntime({socketPath:sock});
  const manager=new ConnectionManager({launch:rt.launch,backup:rt.backup,status:async()=>{throw new Error('não devia pedir status');},timeoutMs:5000,enterDelayMs:5});t.after(()=>manager.close());
  const flow=await manager.start('claude-conta','ana@example.com',{nome:'Startup & cia',id:'../x'});
  const ate=async cond=>{const lim=Date.now()+3000;while(!cond()){if(Date.now()>lim)throw new Error('não chegou');await new Promise(r=>setTimeout(r,10));}};
  await ate(()=>manager.current('ana@example.com').stage==='code');
  assert.equal(logins[0],'/conta/claude-conta/login?nome=Startup+%26+cia&id=');   // id torto não passa
  manager.submit(flow.id,'ana@example.com','codigo-1234567');
  await ate(()=>manager.current('ana@example.com').stage==='complete');
  assert.match(manager.current('ana@example.com').message,/conectores/);
  assert.deepEqual(entradas,['codigo-1234567','\r']);
});

test('contas do Codex da pessoa (desde 28/10/2026): login de conta pessoal pelo código de dispositivo, lista e padrão',async t=>{
  const {sock,logins}=await falso(t);
  const rt=createAgentesRuntime({socketPath:sock});
  const manager=new ConnectionManager({launch:rt.launch,backup:rt.backup,status:async()=>{throw new Error('não devia pedir status');},timeoutMs:5000});t.after(()=>manager.close());
  await manager.start('codex-conta','ana@example.com',{nome:'Minha Plus',id:'abc123'});
  const ate=async cond=>{const lim=Date.now()+3000;while(!cond()){if(Date.now()>lim)throw new Error('não chegou');await new Promise(r=>setTimeout(r,10));}};
  await ate(()=>manager.current('ana@example.com').stage==='complete');
  assert.equal(logins[0],'/conta/codex-conta/login?nome=Minha+Plus&id=abc123');
  assert.match(manager.current('ana@example.com').message,/Codex adicionada/);
  assert.equal((await rt.contas('codex')).url,'/conta/codex/contas');
  assert.equal((await rt.usar('pessoal:abc123','codex')).url,'/conta/codex/usar');
  await assert.rejects(rt.contas('outro'),/inválido/);
});
