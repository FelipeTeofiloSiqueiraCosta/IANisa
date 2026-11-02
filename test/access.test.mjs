import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createAccounts, TTL } from '../server/accounts.mjs';

const secret='Uma frase de senha para teste 123!';
async function fixture(t) {
  const directory=await mkdtemp(path.join(tmpdir(),'ianiza-access-'));
  let clock=Date.now(), store=await createAccounts({directory,now:()=>clock});
  t.after(async()=>{store.close();await rm(directory,{recursive:true,force:true});});
  const setup=store.createSetupLink();
  const owner=await store.setup({token:setup.token,organization:'Estúdio Teste',name:'Pessoa Admin',email:'ADMIN@EXAMPLE.COM',password:secret},'setup');
  return { get store(){return store;},owner,setup,directory,advance(ms){clock+=ms;},async reopen(){store.close();store=await createAccounts({directory,now:()=>clock});} };
}
test('primeiro acesso é único, exige link válido e cria um administrador com senha protegida',async t=>{
  const f=await fixture(t);assert.equal(f.owner.user.role,'admin');assert.equal(f.owner.user.email,'admin@example.com');
  assert.equal(f.store.createSetupLink(),null);
  await assert.rejects(f.store.setup({token:f.setup.token},'other'),{status:410});
  const bytes=await readFile(path.join(f.directory,'access.sqlite'));
  for(const value of [secret,f.owner.token,f.setup.token])assert.equal(bytes.includes(Buffer.from(value)),false);
  assert.equal(f.store.authenticated(f.owner.token).user.name,'Pessoa Admin');
});
test('login verifica credenciais e sessão expira, sai e persiste após reiniciar',async t=>{
  const f=await fixture(t);
  await assert.rejects(f.store.login({email:'admin@example.com',password:'incorreta'},'bad'),{status:401});
  await assert.rejects(f.store.login({email:'unknown@example.com',password:'incorreta'},'unknown'),{status:401});
  const s=await f.store.login({email:'admin@example.com',password:secret,remember:true},'login');
  assert.equal(s.maxAge,TTL.remember/1000);assert.notEqual(s.token,f.owner.token);
  await f.reopen();assert.equal(f.store.authenticated(s.token).user.id,f.owner.user.id);
  f.store.logout(s.token);assert.throws(()=>f.store.authenticated(s.token),{status:401});
  f.advance(TTL.session+1);assert.throws(()=>f.store.authenticated(f.owner.token),{status:401});
});
test('sessão lembrada respeita tanto inatividade quanto prazo absoluto',async t=>{
  const f=await fixture(t),s=await f.store.login({email:'admin@example.com',password:secret,remember:true},'login');
  f.advance(TTL.idle+1);assert.throws(()=>f.store.authenticated(s.token),{status:401});
  const another=await f.store.login({email:'admin@example.com',password:secret,remember:true},'again');
  for(let day=0;day<28;day++){f.advance(TTL.idle/2);if(day<27)f.store.authenticated(another.token);}
  assert.throws(()=>f.store.authenticated(another.token),{status:401});
});
test('convite é pessoal, tem uso único e conserva a permissão escolhida pelo administrador',async t=>{
  const f=await fixture(t),link=f.store.invite(f.owner.token,{name:'Nova Pessoa',email:'MEMBRO@EXAMPLE.COM',role:'member'});
  assert.equal(f.store.inspectLink(link.token,'invite').email,'membro@example.com');
  const member=await f.store.accept({token:link.token,name:'Pessoa Convidada',password:secret,role:'admin'},'accept');
  assert.equal(member.user.role,'member');assert.equal(f.store.authenticated(member.token).organization.id,f.owner.organization.id);
  await assert.rejects(f.store.accept({token:link.token,name:'Reuso',password:secret},'reuse'),{status:410});
  assert.throws(()=>f.store.list(member.token),{status:403});
  assert.throws(()=>f.store.invite(member.token,{name:'Outra',email:'x@example.com',role:'admin'}),{status:403});
  assert.throws(()=>f.store.updateUser(member.token,f.owner.user.id,{status:'disabled'}),{status:403});
  assert.equal(f.store.list(f.owner.token).invitations[0].status,'used');
});
test('regerar ou revogar invalida o link anterior; convite expirado não cria conta',async t=>{
  const f=await fixture(t),invite=f.store.invite(f.owner.token,{name:'Pessoa',email:'new@example.com',role:'member'});
  assert.throws(()=>f.store.invite(f.owner.token,{name:'Dupla',email:'new@example.com',role:'admin'}),{status:409});
  const renewed=f.store.renewInvite(f.owner.token,invite.id);
  assert.throws(()=>f.store.inspectLink(invite.token,'invite'),{status:410});
  f.store.revokeInvite(f.owner.token,renewed.id);assert.throws(()=>f.store.inspectLink(renewed.token,'invite'),{status:410});
  const final=f.store.renewInvite(f.owner.token,renewed.id);
  f.advance(TTL.invite+1);await assert.rejects(f.store.accept({token:final.token,name:'Pessoa',password:secret},'expired'),{status:410});
});
test('não troca a conta conectada ao aceitar convite para outra pessoa',async t=>{
  const f=await fixture(t),link=f.store.invite(f.owner.token,{name:'Pessoa',email:'new@example.com',role:'member'});
  await assert.rejects(f.store.accept({token:link.token,name:'Pessoa',password:secret},'accept',f.owner.token),{status:409});
  assert.equal(f.store.inspectLink(link.token,'invite').email,'new@example.com');
});
test('aceites simultâneos não duplicam contas nem reutilizam o convite',async t=>{
  const f=await fixture(t),link=f.store.invite(f.owner.token,{name:'Pessoa',email:'new@example.com',role:'member'});
  const results=await Promise.allSettled([1,2].map(n=>f.store.accept({token:link.token,name:'Pessoa '+n,password:secret},'accept'+n)));
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(results.find(r=>r.status==='rejected').reason.status,410);
  assert.equal(f.store.list(f.owner.token).users.length,2);
});
test('desativação revoga sessões e links; autoexclusão de administrador é impedida',async t=>{
  const f=await fixture(t),l=f.store.invite(f.owner.token,{name:'Pessoa',email:'new@example.com',role:'admin'});
  const m=await f.store.accept({token:l.token,name:'Pessoa',password:secret},'accept');
  const reset=f.store.resetLink(f.owner.token,m.user.id);
  f.store.updateUser(f.owner.token,m.user.id,{status:'disabled'});
  assert.throws(()=>f.store.authenticated(m.token),{status:401});
  assert.throws(()=>f.store.inspectLink(reset.token,'reset'),{status:410});
  await assert.rejects(f.store.login({email:m.user.email,password:secret},'disabled'),{status:401});
  assert.throws(()=>f.store.updateUser(f.owner.token,f.owner.user.id,{role:'member'}),{status:409});
  assert.throws(()=>f.store.updateUser(f.owner.token,f.owner.user.id,{status:'disabled'}),{status:409});
  f.store.updateUser(f.owner.token,m.user.id,{status:'active',role:'member'});
  const login=await f.store.login({email:m.user.email,password:secret},'reactivated');assert.equal(login.user.role,'member');
});
test('nova senha exige a atual, revoga sessões antigas e invalida links de recuperação',async t=>{
  const f=await fixture(t),reset=f.store.resetLink(f.owner.token,f.owner.user.id);
  await assert.rejects(f.store.changePassword(f.owner.token,{currentPassword:'errada',password:secret},'change'),{status:400});
  const next='Uma outra frase segura de teste 456!';
  const s=await f.store.changePassword(f.owner.token,{currentPassword:secret,password:next},'change');
  assert.throws(()=>f.store.authenticated(f.owner.token),{status:401});
  assert.throws(()=>f.store.inspectLink(reset.token,'reset'),{status:410});
  assert.equal(f.store.authenticated(s.token).user.id,f.owner.user.id);
  await assert.rejects(f.store.login({email:f.owner.user.email,password:secret},'old'),{status:401});
  assert.equal((await f.store.login({email:f.owner.user.email,password:next},'new')).user.id,f.owner.user.id);
});
test('recuperação é de uso único e encerra todos os acessos anteriores',async t=>{
  const f=await fixture(t),link=f.store.resetLink(f.owner.token,f.owner.user.id);
  const s=await f.store.accept({token:link.token,password:'Outra frase de senha segura 987!'},'reset');
  assert.throws(()=>f.store.authenticated(f.owner.token),{status:401});
  assert.equal(f.store.authenticated(s.token).user.role,'admin');assert.throws(()=>f.store.inspectLink(link.token,'reset'),{status:410});
});
test('limite de tentativas bloqueia força bruta e libera após a janela',async t=>{
  const f=await fixture(t);
  for(let n=0;n<5;n++)await assert.rejects(f.store.login({email:'admin@example.com',password:'erro'},'same-ip'),{status:401});
  await assert.rejects(f.store.login({email:'admin@example.com',password:secret},'same-ip'),{status:429});
  f.advance(15*60000+1);assert.equal((await f.store.login({email:'admin@example.com',password:secret},'same-ip')).user.role,'admin');
});
test('senhas curtas e permissões desconhecidas são rejeitadas sem consumir convite',async t=>{
  const f=await fixture(t);
  assert.throws(()=>f.store.invite(f.owner.token,{name:'Pessoa',email:'x@example.com',role:'superadmin'}),{status:400});
  const l=f.store.invite(f.owner.token,{name:'Pessoa',email:'x@example.com',role:'member'});
  await assert.rejects(f.store.accept({token:l.token,name:'Pessoa',password:'curta'},'weak'),{status:400});
  assert.equal(f.store.inspectLink(l.token,'invite').email,'x@example.com');
});
