// Tela de Segurança: leitura da configuração do SSH (aceita senha?) e o passo "porta dos fundos".
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {sshSenha} from '../portal.mjs';
import {createContas} from '../contas.mjs';

test('SSH: o primeiro valor vale, Include em ordem de nome, provedor que liga a senha perde pro 10-ratoeira',async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'ratoeira-ssh-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const d=path.join(dir,'sshd_config.d'),main=path.join(dir,'sshd_config');await mkdir(d);
  await writeFile(main,`Include ${d}/*.conf\nKbdInteractiveAuthentication no\nX11Forwarding yes\n`);
  assert.equal(sshSenha(main),true,'sem nada dito, aceita senha');
  await writeFile(path.join(d,'50-cloud-init.conf'),'PasswordAuthentication yes\n');
  assert.equal(sshSenha(main),true);
  await writeFile(path.join(d,'10-ratoeira-senha.conf'),'# x\nPasswordAuthentication no\nPermitRootLogin prohibit-password\n');
  assert.equal(sshSenha(main),false);
  await writeFile(main,'PasswordAuthentication yes\nInclude '+d+'/*.conf\n');
  assert.equal(sshSenha(main),true,'o que vem antes do Include ganha');
  await writeFile(main,'Match User x\n  PasswordAuthentication no\n');
  assert.equal(sshSenha(main),true,'dentro de Match não conta');
  assert.equal(sshSenha(path.join(dir,'nao-existe')),null);
});

test('porta dos fundos: quem administra marca e desmarca; exigir segue separado',async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'ratoeira-seg-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const c=createContas({dir,agora:()=>Date.UTC(2026,9,28)});await c.iniciar();
  await c.usarLink(await c.primeiroAcesso(),{senha:'uma frase bem comprida',nome:'Caio',email:'caio@x.com'});
  assert.deepEqual(c.seguranca(),{exigirDois:false,portaDosFundos:null});
  assert.deepEqual(await c.definirSeguranca({portaDosFundos:true},'caio@x.com'),{exigirDois:false,portaDosFundos:{em:'2026-10-28T00:00:00.000Z',por:'caio@x.com'}});
  assert.equal((await c.definirSeguranca({portaDosFundos:false},'caio@x.com')).portaDosFundos,null);
  await assert.rejects(c.definirSeguranca({portaDosFundos:'sim'},'caio@x.com'),{status:400});
});
