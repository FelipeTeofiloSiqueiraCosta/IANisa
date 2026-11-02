// Login próprio: senhas, trava de tentativas, sessão, links de uso único e convite.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createContas,PRAZOS} from '../contas.mjs';

const SENHA='uma frase bem comprida';
async function montar(t,extra={}){
  const dir=await mkdtemp(path.join(tmpdir(),'ratoeira-contas-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  let agora=Date.UTC(2026,9,8);const revogados=[];
  const contas=createContas({dir,agora:()=>agora,aoRevogar:e=>revogados.push(e),appsPapeis:new Map([['/pedidos',['admin','equipe','financeiro']]]),...extra});
  await contas.iniciar();
  return {dir,contas,revogados,passar:ms=>{agora+=ms;}};
}
async function comAdmin(t,extra){
  const m=await montar(t,extra);
  const token=await m.contas.primeiroAcesso();
  await m.contas.usarLink(token,{senha:SENHA,nome:'Caio',email:'Caio@X.com'});
  return m;
}

test('primeiro acesso: cria o admin uma vez só, e o link não vale de novo',async t=>{
  const {contas}=await montar(t);
  const token=await contas.primeiroAcesso();
  assert.deepEqual(await contas.verLink(token),{tipo:'primeiro',email:null,nome:''});
  const r=await contas.usarLink(token,{senha:SENHA,nome:'Caio',email:'Caio@X.com'});
  assert.equal(r.pessoa.email,'caio@x.com');assert.equal(r.pessoa.papel,'admin');assert.equal(r.pessoa.senha,undefined);
  assert.equal(contas.sessao(r.token).email,'caio@x.com');
  assert.equal(await contas.verLink(token),null);
  await assert.rejects(contas.usarLink(token,{senha:SENHA,nome:'Outro',email:'o@x.com'}),{status:410});
  await assert.rejects(contas.primeiroAcesso(),{status:409});
});

test('links vencem: primeiro acesso em 1 h, convite em 24 h, senha nova em 1 h',async t=>{
  const m=await montar(t);
  const primeiro=await m.contas.primeiroAcesso();
  m.passar(PRAZOS.primeiro+1);
  assert.equal(await m.contas.verLink(primeiro),null);
  const ok=await m.contas.primeiroAcesso();
  await m.contas.usarLink(ok,{senha:SENHA,nome:'Caio',email:'caio@x.com'});
  const {token}=await m.contas.convidar({email:'ana@x.com',nome:'Ana'});
  m.passar(23*3600e3);assert.equal((await m.contas.verLink(token)).tipo,'convite');
  m.passar(3600e3+1);assert.equal(await m.contas.verLink(token),null);
  const novo=await m.contas.gerarLink('ana@x.com');assert.equal(novo.tipo,'convite');
  await m.contas.usarLink(novo.token,{senha:SENHA,nome:'Ana'});
  const senhaNova=await m.contas.gerarLink('ana@x.com');assert.equal(senhaNova.tipo,'senha');
  m.passar(PRAZOS.senha+1);assert.equal(await m.contas.verLink(senhaNova.token),null);
});

test('senha errada trava o par e-mail+IP depois de 5, sem travar outro IP',async t=>{
  const m=await comAdmin(t);
  for(let i=0;i<5;i++)await assert.rejects(m.contas.entrar('caio@x.com','errada errada','1.1.1.1'),{status:401});
  await assert.rejects(m.contas.entrar('caio@x.com',SENHA,'1.1.1.1'),{status:429});
  assert.ok((await m.contas.entrar('caio@x.com',SENHA,'2.2.2.2')).token);
  m.passar(15*60e3+1);
  assert.ok((await m.contas.entrar('caio@x.com',SENHA,'1.1.1.1')).token);
  // e-mail que não existe dá a mesma resposta
  await assert.rejects(m.contas.entrar('ninguem@x.com',SENHA,'3.3.3.3'),{status:401,message:'E-mail ou senha incorretos.'});
});

test('registro de acessos: entrada, erro e trava no acessos.log; IP novo só depois da primeira entrada',async t=>{
  const m=await comAdmin(t);const avisos=[];m.contas.aoAcesso(ev=>avisos.push(ev));
  assert.equal(m.contas.admins()[0],'caio@x.com');
  await m.contas.entrar('caio@x.com',SENHA,'1.1.1.1');
  await m.contas.entrar('caio@x.com',SENHA,'1.1.1.1');
  await m.contas.entrar('caio@x.com',SENHA,'2.2.2.2');
  await m.contas.entrar('caio@x.com',SENHA,null);
  assert.deepEqual(avisos.map(a=>a.ipNovo),[false,false,true,false]);
  // 90 dias sem entrar de um IP: ele volta a ser novo
  m.passar(91*24*3600e3);await m.contas.entrar('caio@x.com',SENHA,'2.2.2.2');
  await m.contas.entrar('caio@x.com',SENHA,'1.1.1.1');assert.equal(avisos.at(-1).ipNovo,true);
  avisos.length=0;
  for(let i=0;i<5;i++)await assert.rejects(m.contas.entrar('caio@x.com','errada errada','3.3.3.3'),{status:401});
  assert.deepEqual(avisos.map(a=>a.evento),['errou','errou','errou','errou','errou','travou']);
  // e-mail que não existe não vira aviso nem linha (robô chutando e-mail)
  avisos.length=0;await assert.rejects(m.contas.entrar('ninguem@x.com','x','4.4.4.4'),{status:401});assert.equal(avisos.length,0);
  const log=(await readFile(path.join(m.dir,'acessos.log'),'utf8')).trim().split('\n').map(l=>JSON.parse(l));
  assert.equal(log.filter(l=>l.evento==='travou').length,1);assert.equal(log.at(-1).ip,'3.3.3.3');
  assert.equal((await stat(path.join(m.dir,'acessos.log'))).mode&0o777,0o600);
});

test('muitos erros do mesmo IP, em e-mails diferentes, travam o IP',async t=>{
  const m=await comAdmin(t);
  for(let i=0;i<30;i++)await assert.rejects(m.contas.entrar(`x${i}@x.com`,'errada errada','9.9.9.9'),{status:401});
  await assert.rejects(m.contas.entrar('caio@x.com',SENHA,'9.9.9.9'),{status:429});
});

test('sem IP de verdade (proxy sem ipHeader), a trava é só por e-mail: os erros de um não travam o outro',async t=>{
  const m=await comAdmin(t);
  for(let i=0;i<40;i++)await assert.rejects(m.contas.entrar(`x${i}@x.com`,'errada errada',null),{status:401});
  assert.ok((await m.contas.entrar('caio@x.com',SENHA,null)).token);
  for(let i=0;i<5;i++)await assert.rejects(m.contas.entrar('caio@x.com','errada errada',null),{status:401});
  await assert.rejects(m.contas.entrar('caio@x.com',SENHA,null),{status:429});
});

test('sessão vence com 14 dias sem uso; usar renova',async t=>{
  const m=await comAdmin(t);
  const {token}=await m.contas.entrar('caio@x.com',SENHA,'1.1.1.1');
  m.passar(13*86400e3);assert.ok(m.contas.sessao(token));
  m.passar(13*86400e3);assert.ok(m.contas.sessao(token),'usada há 13 dias, segue valendo');
  m.passar(PRAZOS.sessao+1);assert.equal(m.contas.sessao(token),null);
  assert.equal(m.contas.sessao('inventado'),null);
  await m.contas.sair((await m.contas.entrar('caio@x.com',SENHA,'1.1.1.1')).token);
});

test('convite com ambiente cria o usuário Linux antes de gravar; se falhar, nada fica',async t=>{
  const criados=[];let falhar=false;
  const m=await comAdmin(t,{criarUsuario:async u=>{if(falhar)throw Object.assign(new Error('x'),{status:502});criados.push(u);}});
  const r=await m.contas.convidar({email:'ana@x.com',nome:'Ana',ambiente:true,usuario:'ana',apps:{'/pedidos':'equipe'}});
  assert.deepEqual(criados,['ana']);
  assert.deepEqual(r.pessoa.ambiente,{tipo:'proprio',user:'ana',areas:[],claude:'propria',codex:'propria',repoDir:'/home/ana/trabalho'});
  assert.equal(r.pessoa.estado,'convidada');
  // convidada ainda não tem ambiente nem entra
  assert.equal(m.contas.ambiente('ana@x.com'),null);
  await m.contas.usarLink(r.token,{senha:SENHA,nome:'Ana'});
  assert.equal(m.contas.ambiente('ana@x.com').pessoa.socketPath,'/run/ratoeira-ana/paseo.sock');
  await assert.rejects(m.contas.convidar({email:'bia@x.com',nome:'Bia',ambiente:true,usuario:'ana'}),{status:409});
  await assert.rejects(m.contas.convidar({email:'bia@x.com',nome:'Bia',ambiente:true,usuario:'../root'}),{status:400});
  await assert.rejects(m.contas.convidar({email:'bia@x.com',nome:'Bia',apps:{'/pedidos':'dono'}}),{status:400});
  await assert.rejects(m.contas.convidar({email:'bia@x.com',nome:'Bia',apps:{'/outro':'equipe'}}),{status:400});
  falhar=true;
  await assert.rejects(m.contas.convidar({email:'bia@x.com',nome:'Bia',ambiente:true,usuario:'bia'}),{status:502});
  assert.equal((await m.contas.listar()).some(p=>p.email==='bia@x.com'),false);
  const semCriar=await comAdmin(t);
  await assert.rejects(semCriar.contas.convidar({email:'bia@x.com',nome:'Bia',ambiente:true,usuario:'bia'}),{status:400});
});

test('app publicado nasce liberado: todo mundo ganha o papel padrão, e dá pra bloquear uma pessoa',async t=>{
  const appsPapeis=new Map([['/pedidos',['admin','equipe','financeiro']],['/sessoes',['membro']]]);
  const appsPadrao=new Map([['/pedidos',null],['/sessoes','membro']]);
  const m=await comAdmin(t,{criarUsuario:async()=>{},appsPapeis,appsPadrao});
  const ana=await m.contas.convidar({email:'ana@x.com',nome:'Ana',ambiente:true,usuario:'ana'});
  const lu=await m.contas.convidar({email:'lu@x.com',nome:'Lu',apps:{'/pedidos':'financeiro'}});
  for(const r of [ana,lu])await m.contas.usarLink(r.token,{senha:SENHA});
  // ninguém liberou nada: o padrão vale pra todos; o admin ganha o primeiro papel, que aqui é o único
  for(const e of ['caio@x.com','ana@x.com','lu@x.com']){assert.equal(m.contas.podeApp(e,'/sessoes'),true,e);assert.equal(m.contas.papelNoApp(e,'/sessoes'),'membro',e);}
  // app da config sem padrão segue fechado pra quem não foi liberado
  assert.equal(m.contas.podeApp('ana@x.com','/pedidos'),false);
  assert.deepEqual(m.contas.limite('lu@x.com'),['/pedidos','/sessoes']);
  // bloquear: null na tela de Pessoas
  await m.contas.editar('ana@x.com',{apps:{'/sessoes':null}},'caio@x.com');
  assert.equal(m.contas.podeApp('ana@x.com','/sessoes'),false);assert.equal(m.contas.papelNoApp('ana@x.com','/sessoes'),null);
  await m.contas.editar('lu@x.com',{apps:{'/pedidos':'financeiro','/sessoes':null}},'caio@x.com');
  assert.deepEqual(m.contas.limite('lu@x.com'),['/pedidos']);
  // tirar o bloqueio volta pro padrão
  await m.contas.editar('ana@x.com',{apps:{}},'caio@x.com');
  assert.equal(m.contas.papelNoApp('ana@x.com','/sessoes'),'membro');
});

test('quem publicou o app e quem administra entram com o primeiro papel, seja qual for o nome',async t=>{
  const appsPapeis=new Map([['/crm',['gestor','vendas','leitura']]]);
  const appsPadrao=new Map([['/crm','leitura']]);
  const appsDono=new Map([['/crm','gil@x.com']]);
  const m=await comAdmin(t,{criarUsuario:async()=>{},appsPapeis,appsPadrao,appsDono});
  const gil=await m.contas.convidar({email:'gil@x.com',nome:'Gil',apps:{}});
  const ana=await m.contas.convidar({email:'ana@x.com',nome:'Ana',ambiente:true,usuario:'ana'});
  for(const r of [gil,ana])await m.contas.usarLink(r.token,{senha:SENHA});
  assert.equal(m.contas.papelNoApp('caio@x.com','/crm'),'gestor');
  assert.equal(m.contas.papelNoApp('gil@x.com','/crm'),'gestor');assert.equal(m.contas.podeApp('gil@x.com','/crm'),true);
  assert.deepEqual(m.contas.limite('gil@x.com'),['/crm']);
  assert.equal(m.contas.papelNoApp('ana@x.com','/crm'),'leitura');
  // papel trocado na tela de Pessoas vale mais, até pro dono
  await m.contas.editar('gil@x.com',{apps:{'/crm':'vendas'}},'caio@x.com');
  assert.equal(m.contas.papelNoApp('gil@x.com','/crm'),'vendas');
  await m.contas.editar('gil@x.com',{apps:{'/crm':null}},'caio@x.com');
  assert.equal(m.contas.podeApp('gil@x.com','/crm'),false);assert.deepEqual(m.contas.limite('gil@x.com'),[]);
});

test('quem abre o quê: admin, pessoa com ambiente, pessoa só com app',async t=>{
  const m=await comAdmin(t,{criarUsuario:async()=>{}});
  const ana=await m.contas.convidar({email:'ana@x.com',nome:'Ana',ambiente:true,usuario:'ana'});
  const lu=await m.contas.convidar({email:'lu@x.com',nome:'Lu',apps:{'/pedidos':'financeiro'}});
  for(const r of [ana,lu])await m.contas.usarLink(r.token,{senha:SENHA});
  assert.equal(m.contas.limite('caio@x.com'),null);assert.equal(m.contas.podeApp('caio@x.com','/pedidos'),true);
  assert.equal(m.contas.papelNoApp('caio@x.com','/pedidos'),'admin');
  assert.equal(m.contas.limite('ana@x.com'),null);assert.equal(m.contas.podeApp('ana@x.com','/pedidos'),false);
  assert.deepEqual(m.contas.limite('lu@x.com'),['/pedidos']);assert.equal(m.contas.papelNoApp('lu@x.com','/pedidos'),'financeiro');
  assert.deepEqual(m.contas.limite('ninguem@x.com'),[]);
  assert.equal(m.contas.ambiente('caio@x.com'),null);
  // Paseo único só pelo comando da VPS
  await m.contas.compartilhado('caio@x.com',true);
  assert.deepEqual(m.contas.ambiente('caio@x.com'),{unico:true});
  await assert.rejects(m.contas.compartilhado('ana@x.com',true),{status:409});
  assert.deepEqual([...m.contas.usuarios().keys()],['ana@x.com']);
});

test('desativar derruba sessões e conexões; não vale pra si mesmo nem pro último admin',async t=>{
  const m=await comAdmin(t);
  const ana=await m.contas.convidar({email:'ana@x.com',nome:'Ana'});
  const {token}=await m.contas.usarLink(ana.token,{senha:SENHA});
  await assert.rejects(m.contas.desativar('caio@x.com','caio@x.com'),{status:409});
  await assert.rejects(m.contas.editar('caio@x.com',{papel:'membro'},'caio@x.com'),{status:409});
  await m.contas.desativar('ana@x.com','caio@x.com');
  assert.equal(m.contas.sessao(token),null);
  assert.ok(m.revogados.includes('ana@x.com'));
  await assert.rejects(m.contas.entrar('ana@x.com',SENHA,'1.1.1.1'),{status:401});
  await assert.rejects(m.contas.gerarLink('ana@x.com'),{status:409});
  await m.contas.reativar('ana@x.com');
  assert.ok((await m.contas.entrar('ana@x.com',SENHA,'1.1.1.1')).token);
});

test('senha nova derruba as sessões antigas',async t=>{
  const m=await comAdmin(t);
  const antiga=(await m.contas.entrar('caio@x.com',SENHA,'1.1.1.1')).token;
  const l=await m.contas.gerarLink('caio@x.com');
  await assert.rejects(m.contas.usarLink(l.token,{senha:'curta'}),{status:400});
  const nova=await m.contas.usarLink(l.token,{senha:'outra frase comprida'});
  assert.equal(m.contas.sessao(antiga),null);assert.ok(m.contas.sessao(nova.token));
  assert.ok(m.revogados.includes('caio@x.com'));
});

test('no disco: nada em claro, arquivos 600, e mudança feita pelo comando da VPS aparece no gateway',async t=>{
  const m=await comAdmin(t);
  const {token}=await m.contas.entrar('caio@x.com',SENHA,'1.1.1.1');
  await m.contas.flush();
  const l=await m.contas.gerarLink('caio@x.com');
  for(const arq of ['pessoas.json','sessoes.json']){
    const txt=await readFile(path.join(m.dir,arq),'utf8');
    assert.ok(!txt.includes(SENHA)&&!txt.includes(token)&&!txt.includes(l.token),arq);
    assert.equal((await stat(path.join(m.dir,arq))).mode&0o777,0o600);
  }
  // outro processo (conta.mjs) gera um link; o gateway enxerga sem reiniciar
  const cli=createContas({dir:m.dir});
  const r=await cli.gerarLink('caio@x.com');
  assert.equal((await m.contas.verLink(r.token)).tipo,'senha');
  await m.contas.convidar({email:'ana@x.com',nome:'Ana'});
  assert.ok((await createContas({dir:m.dir}).listar()).some(p=>p.email==='ana@x.com'));
});

import {mkdir,writeFile} from 'node:fs/promises';
import {createRepoFiles} from '../files.mjs';

test('áreas do time: convite entra na área, pasta de trabalho é a do time, e o root recebe o pedido',async t=>{
  const pedidos=[];
  const m=await comAdmin(t,{criarUsuario:async()=>{},areas:[{id:'time',caminho:'/srv/ratoeira/areas/time',nome:'Time'}],existe:()=>true,aoMudarAcessos:async(pedido,mudaram)=>{pedidos.push({pedido,mudaram});}});
  const ana=await m.contas.convidar({email:'ana@x.com',nome:'Ana',ambiente:true,usuario:'ana'});
  assert.deepEqual(ana.pessoa.ambiente,{tipo:'proprio',user:'ana',areas:['time'],claude:'propria',codex:'propria',repoDir:'/srv/ratoeira/areas/time'});
  assert.deepEqual(pedidos.at(-1),{pedido:{pessoas:[{user:'ana',areas:['time'],claude:'propria',codex:'propria',nome:'Ana',email:'ana@x.com'}],restritas:[],claudeContas:[],codexContas:[],cofre:null,ditado:null},mudaram:['ana']});
  const beto=await m.contas.convidar({email:'beto@x.com',nome:'Beto',ambiente:true,usuario:'beto',areas:[]});
  assert.equal(beto.pessoa.ambiente.repoDir,'/home/beto/trabalho');
  await assert.rejects(m.contas.convidar({email:'c@x.com',nome:'C',ambiente:true,usuario:'c',areas:['outra']}),{status:400});
  for(const r of [ana,beto])await m.contas.usarLink(r.token,{senha:SENHA});
  assert.deepEqual(m.contas.ambiente('ana@x.com').pessoa.areas,['time']);
  // beto entra na área depois: pasta muda e o Paseo dele precisa religar
  await m.contas.editar('beto@x.com',{areas:['time']},'caio@x.com');
  assert.equal(m.contas.ambiente('beto@x.com').pessoa.repoDir,'/srv/ratoeira/areas/time');
  assert.deepEqual(pedidos.at(-1).mudaram,['beto']);
  await assert.rejects(m.contas.editar('caio@x.com',{areas:['time']},'caio@x.com'),{status:409});
  // pasta restrita
  await assert.rejects(m.contas.restringir('time','../etc',['ana@x.com']),{status:400});
  await assert.rejects(m.contas.restringir('time','.git',['ana@x.com']),{status:400});
  await assert.rejects(m.contas.restringir('time','financeiro',['caio@x.com']),{status:400});
  await m.contas.restringir('time','/financeiro/',['ana@x.com']);
  assert.deepEqual(pedidos.at(-1).pedido.restritas,[{area:'time',pasta:'financeiro',users:['ana']}]);
  assert.equal(m.contas.bloqueado('beto@x.com','time','financeiro'),true);
  assert.equal(m.contas.bloqueado('beto@x.com','time','financeiro/notas.md'),true);
  assert.equal(m.contas.bloqueado('beto@x.com','time','financeiros'),false);
  assert.equal(m.contas.bloqueado('ana@x.com','time','financeiro/notas.md'),false);
  // desativada sai da área no pedido
  await m.contas.desativar('ana@x.com','caio@x.com');
  assert.deepEqual(pedidos.at(-1).pedido.pessoas,[{user:'beto',areas:['time'],claude:'propria',codex:'propria',nome:'Beto',email:'beto@x.com'}]);
  assert.deepEqual(pedidos.at(-1).pedido.restritas,[{area:'time',pasta:'financeiro',users:[]}]);
  await m.contas.liberarPasta('time','financeiro');
  assert.deepEqual(pedidos.at(-1).pedido.restritas,[]);
  await assert.rejects(m.contas.liberarPasta('time','financeiro'),{status:404});
});

test('área que sai da config ou perde a pasta não prende a conta numa pasta que não existe',async t=>{
  const pedidos=[],noDisco=new Set(['/srv/ratoeira/areas/time','/srv/ratoeira/areas/natus','/home/gil/trabalho']);
  const existe=c=>noDisco.has(c);
  const areas=[{id:'time',caminho:'/srv/ratoeira/areas/time',nome:'Time'},{id:'natus',caminho:'/srv/ratoeira/areas/natus',nome:'Natus'}];
  const m=await comAdmin(t,{criarUsuario:async()=>{},areas,existe,aoMudarAcessos:async pedido=>{pedidos.push(pedido);}});
  const gil=await m.contas.convidar({email:'gil@x.com',nome:'Gil',ambiente:true,usuario:'gil',areas:['natus','time']});
  await m.contas.usarLink(gil.token,{senha:SENHA});
  assert.equal(m.contas.ambiente('gil@x.com').pessoa.repoDir,'/srv/ratoeira/areas/natus');
  // a pasta da primeira área some do disco: vale a próxima que existe
  noDisco.delete('/srv/ratoeira/areas/natus');
  assert.equal(m.contas.ambiente('gil@x.com').pessoa.repoDir,'/srv/ratoeira/areas/time');
  // a área sai da config (o gateway religa sem ela): some da conta e do pedido pro root
  const sem=createContas({dir:m.dir,criarUsuario:async()=>{},areas:[areas[0]],existe,aoMudarAcessos:async pedido=>{pedidos.push(pedido);}});
  await sem.iniciar();await sem.reaplicar();
  assert.deepEqual(sem.ambiente('gil@x.com').pessoa.areas,['time']);
  assert.equal(sem.ambiente('gil@x.com').pessoa.repoDir,'/srv/ratoeira/areas/time');
  assert.deepEqual(pedidos.at(-1).pessoas.find(p=>p.user==='gil').areas,['time']);
  // nenhuma área sobrou: a pasta padrão, e sem ela a home
  const nenhuma=createContas({dir:m.dir,criarUsuario:async()=>{},areas:[],existe});
  await nenhuma.iniciar();
  assert.equal(nenhuma.ambiente('gil@x.com').pessoa.repoDir,'/home/gil/trabalho');
  noDisco.delete('/home/gil/trabalho');
  assert.equal(nenhuma.ambiente('gil@x.com').pessoa.repoDir,'/home/gil');
});

test('área aberta na Mesa: troca a pasta de trabalho sem pedir nada ao root, e some se a área sai da pessoa',async t=>{
  const pedidos=[],noDisco=new Set(['/srv/ratoeira/areas/time','/srv/ratoeira/areas/natus']);
  const areas=[{id:'time',caminho:'/srv/ratoeira/areas/time',nome:'Time'},{id:'natus',caminho:'/srv/ratoeira/areas/natus',nome:'Natus'}];
  const m=await comAdmin(t,{criarUsuario:async()=>{},areas,existe:c=>noDisco.has(c),aoMudarAcessos:async pedido=>{pedidos.push(pedido);}});
  const gil=await m.contas.convidar({email:'gil@x.com',nome:'Gil',ambiente:true,usuario:'gil',areas:['time','natus']});
  await m.contas.usarLink(gil.token,{senha:SENHA});
  assert.deepEqual(m.contas.areasDe('gil@x.com'),{lista:[{id:'time',nome:'Time'},{id:'natus',nome:'Natus'}],aberta:'time'});
  const antes=pedidos.length;
  assert.deepEqual(await m.contas.abrirArea('gil@x.com','natus'),{lista:[{id:'time',nome:'Time'},{id:'natus',nome:'Natus'}],aberta:'natus'});
  assert.equal(m.contas.ambiente('gil@x.com').pessoa.repoDir,'/srv/ratoeira/areas/natus');
  assert.equal(pedidos.length,antes);
  await assert.rejects(m.contas.abrirArea('gil@x.com','outra'),{status:400});
  await assert.rejects(m.contas.abrirArea('caio@x.com','time'),{status:404});
  // a pasta da aberta some: volta pra próxima; e com uma área só não tem o que escolher
  noDisco.delete('/srv/ratoeira/areas/natus');
  assert.equal(m.contas.ambiente('gil@x.com').pessoa.repoDir,'/srv/ratoeira/areas/time');
  assert.equal(m.contas.areasDe('gil@x.com'),null);
  await assert.rejects(m.contas.abrirArea('gil@x.com','natus'),{status:400});
  // o admin tira a área aberta da pessoa: vale a que sobrou
  noDisco.add('/srv/ratoeira/areas/natus');
  await m.contas.editar('gil@x.com',{areas:['time']},'caio@x.com');
  assert.equal(m.contas.ambiente('gil@x.com').pessoa.repoDir,'/srv/ratoeira/areas/time');
});

test('área Arquivos esconde a pasta restrita: árvore, busca e link direto',async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'ratoeira-restrita-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  await mkdir(path.join(dir,'financeiro'),{recursive:true});await mkdir(path.join(dir,'clientes'),{recursive:true});
  await writeFile(path.join(dir,'financeiro','caixa.md'),'# caixa');await writeFile(path.join(dir,'clientes','caixa-cliente.md'),'# c');
  const files=createRepoFiles(dir,{bloqueado:rel=>rel==='financeiro'||rel.startsWith('financeiro/')});
  assert.deepEqual((await files.listar('')).itens.map(i=>i.nome),['clientes']);
  await assert.rejects(files.listar('financeiro'),{status:404});
  assert.deepEqual((await files.buscar('caixa')).itens.map(i=>i.caminho),['clientes/caixa-cliente.md']);
  await assert.rejects(files.resolver('financeiro/caixa.md'),{status:404});
});

test('conta do Claude por pessoa: geral, própria ou opcional, e as contas da organização vão pro root',async t=>{
  const pedidos=[],criados=[];
  const m=await comAdmin(t,{criarUsuario:async u=>{criados.push(u);},claudePadrao:'geral',aoMudarAcessos:async(pedido,mudaram)=>{pedidos.push({pedido,mudaram});}});
  const ana=await m.contas.convidar({email:'ana@x.com',nome:'Ana',ambiente:true,usuario:'ana'});
  assert.equal(ana.pessoa.ambiente.claude,'geral');   // padrão da instalação
  const beto=await m.contas.convidar({email:'beto@x.com',nome:'Beto',ambiente:true,usuario:'beto',claude:'propria'});
  assert.equal(beto.pessoa.ambiente.claude,'propria');
  await assert.rejects(m.contas.convidar({email:'c@x.com',nome:'C',ambiente:true,usuario:'c',claude:'qualquer'}),{status:400});
  assert.deepEqual(criados,['ana','beto'],'modo inválido não chega a criar o usuário');
  assert.deepEqual(m.contas.claudeContas(),[]);
  await assert.rejects(m.contas.adicionarClaudeConta({nome:'Max 1',token:'sk-ant-api03-errado'}),{status:400});
  const TOKEN='sk-ant-oat01-'+'x'.repeat(40),TOKEN2='sk-ant-oat01-'+'z'.repeat(40);
  let lista=await m.contas.adicionarClaudeConta({nome:'Max 1',token:TOKEN});
  assert.equal(lista.length,1);assert.equal(lista[0].nome,'Max 1');assert.equal(lista[0].pessoas,null);
  // o token vai uma vez pro root (que grava o arquivo) e depois some do cadastro
  const idas=pedidos.filter(p=>p.pedido.claudeContas.some(c=>c.token===TOKEN));
  assert.equal(idas.length,1);assert.equal(idas[0].pedido.claudeGeral,undefined);
  assert.deepEqual(pedidos.at(-1).mudaram,[],'conta nova não religa ninguém');
  assert.equal(m.contas.claudeContas()[0].pendente,undefined);
  await assert.rejects(m.contas.adicionarClaudeConta({nome:'De novo',token:TOKEN}),{status:409});
  lista=await m.contas.adicionarClaudeConta({nome:'Max 2',token:TOKEN2,pessoas:['ana@x.com']});
  assert.equal(pedidos.at(-1).pedido.claudeContas[0].token,undefined,'a que já foi instalada não leva o token de novo');
  assert.deepEqual(pedidos.at(-1).pedido.claudeContas.map(c=>[c.nome,c.users]),[['Max 1',null],['Max 2',['ana']]]);
  // tirar a Ana da Max 2 religa só ela; nome e lista inválidos são recusados
  await m.contas.editarClaudeConta(lista[1].id,{pessoas:['beto@x.com']});
  assert.deepEqual(pedidos.at(-1).mudaram,['ana']);
  await assert.rejects(m.contas.editarClaudeConta(lista[1].id,{pessoas:['ninguem@x.com']}),{status:400});
  await assert.rejects(m.contas.editarClaudeConta(lista[1].id,{nome:'  '}),{status:400});
  await assert.rejects(m.contas.editarClaudeConta('naoexiste',{nome:'X'}),{status:404});
  // o token nunca aparece na lista de pessoas nem na de contas
  assert.ok(!JSON.stringify([await m.contas.listar(),m.contas.claudeContas()]).includes(TOKEN));
  // trocar o modo de alguém religa o Paseo dela
  await m.contas.editar('beto@x.com',{claude:'opcional'},'caio@x.com');
  assert.deepEqual(pedidos.at(-1).mudaram,['beto']);
  assert.deepEqual(pedidos.at(-1).pedido.pessoas.map(p=>[p.user,p.claude]),[['ana','geral'],['beto','opcional']]);
  await m.contas.removerClaudeConta(lista[1].id);
  assert.deepEqual(pedidos.at(-1).pedido.claudeContas.map(c=>c.nome),['Max 1']);
  // cofre de chaves (1Password): token vai pro root, nunca pra tela; todo mundo com ambiente religa
  assert.deepEqual(m.contas.cofre(),{configurado:false});
  await assert.rejects(m.contas.definirCofre('sk-ant-oat01-'+'x'.repeat(40)),{status:400});
  const OPS='ops_'+'y'.repeat(60);
  await m.contas.definirCofre(OPS,{conta:'time.1password.com',vaults:['Time']});
  assert.deepEqual(m.contas.cofre().vaults,['Time']);assert.equal(m.contas.cofre().conta,'time.1password.com');
  assert.equal(pedidos.at(-1).pedido.cofre,OPS);assert.deepEqual(pedidos.at(-1).mudaram.sort(),['ana','beto']);
  assert.ok(!JSON.stringify(m.contas.cofre()).includes(OPS)&&!JSON.stringify(await m.contas.listar()).includes(OPS),'o token nunca volta pra tela');
  await m.contas.removerCofre();assert.equal(pedidos.at(-1).pedido.cofre,null);
  // ditado: a chave do AssemblyAI da organização vai pro root (arquivo do grupo das pessoas), ninguém religa, nunca volta pra tela
  assert.deepEqual(m.contas.ditado(),{configurado:false});
  await assert.rejects(m.contas.definirDitado('curta'),{status:400});
  const AAI='a'.repeat(32);
  await m.contas.definirDitado(AAI);
  assert.equal(m.contas.ditado().configurado,true);assert.ok(m.contas.ditado().desde);
  assert.equal(pedidos.at(-1).pedido.ditado,AAI);assert.deepEqual(pedidos.at(-1).mudaram,[]);
  assert.ok(!JSON.stringify(m.contas.ditado()).includes(AAI)&&!JSON.stringify(await m.contas.listar()).includes(AAI),'a chave nunca volta pra tela');
  await m.contas.removerDitado();assert.equal(pedidos.at(-1).pedido.ditado,null);assert.deepEqual(m.contas.ditado(),{configurado:false});
  // dar ambiente a quem só tinha app
  const lu=await m.contas.convidar({email:'lu@x.com',nome:'Lu'});
  assert.equal(lu.pessoa.ambiente,null);
  const depois=await m.contas.editar('lu@x.com',{darAmbiente:{usuario:'lu'},claude:'propria'},'caio@x.com');
  assert.equal(depois.ambiente.user,'lu');assert.deepEqual(criados,['ana','beto','lu']);
  await assert.rejects(m.contas.editar('lu@x.com',{darAmbiente:{usuario:'lu2'}},'caio@x.com'),{status:409});
});

test('contas do Codex da organização: várias, o login vai pro root uma vez e sai do cadastro, e quem pode usar',async t=>{
  const pedidos=[];
  const m=await comAdmin(t,{criarUsuario:async()=>{},codexPadrao:'opcional',aoMudarAcessos:async(pedido,mudaram)=>{pedidos.push({pedido:structuredClone(pedido),mudaram});}});
  const ana=await m.contas.convidar({email:'ana@x.com',nome:'Ana',ambiente:true,usuario:'ana'});
  assert.equal(ana.pessoa.ambiente.codex,'opcional');   // padrão da instalação
  await m.contas.convidar({email:'beto@x.com',nome:'Beto',ambiente:true,usuario:'beto',codex:'propria'});
  await assert.rejects(m.contas.convidar({email:'c@x.com',nome:'C',ambiente:true,usuario:'c',codex:'qualquer'}),{status:400});
  assert.deepEqual(m.contas.codexContas(),[]);
  await assert.rejects(m.contas.adicionarCodexConta({auth_mode:'apikey',OPENAI_API_KEY:'sk-x'}),{status:400});
  const login=(email,plano,n)=>({auth_mode:'chatgpt',tokens:{id_token:'h.'+Buffer.from(JSON.stringify({email,'https://api.openai.com/auth':{chatgpt_plan_type:plano}})).toString('base64url')+'.s',access_token:'acesso-'+n,refresh_token:'renova-secreto-'+n}});
  // sem nome, a conta leva o e-mail do login
  const [a]=await m.contas.adicionarCodexConta(login('time@x.com','pro',1));
  assert.deepEqual(a,{id:a.id,nome:'time@x.com',desde:new Date(Date.UTC(2026,9,8)).toISOString(),conta:'time@x.com',plano:'pro',pessoas:null});
  const comLogin=pedidos.find(p=>p.pedido.codexContas?.some(c=>c.auth));
  assert.deepEqual(comLogin.pedido.codexContas,[{id:a.id,nome:'time@x.com',users:null,auth:login('time@x.com','pro',1)}]);
  assert.deepEqual(comLogin.mudaram,[],'conta nova: ninguém religa');
  // depois de instalado, o login sai do cadastro: o pedido seguinte só leva id, nome e quem
  const lista=await m.contas.adicionarCodexConta(login('plus@x.com','plus',2),{nome:'Plus do time'});
  assert.deepEqual(lista.map(c=>c.nome),['time@x.com','Plus do time']);
  // quem pode usar: só a Ana na segunda
  const b=lista[1].id;
  await m.contas.editarCodexConta(b,{pessoas:['ana@x.com'],nome:'Só da Ana'});
  assert.deepEqual(pedidos.at(-1).pedido.codexContas[1],{id:b,nome:'Só da Ana',users:['ana']});
  await assert.rejects(m.contas.editarCodexConta(b,{pessoas:['ninguem@x.com']}),{status:400});
  // entrar de novo numa que existe (o login venceu): troca o login dela e quem usa religa
  await m.contas.adicionarCodexConta(login('plus@x.com','plus',3),{id:b});
  const de_novo=pedidos.find(p=>p.pedido.codexContas?.[1]?.auth?.tokens.refresh_token==='renova-secreto-3');
  assert.deepEqual(de_novo.mudaram,['ana']);assert.equal(m.contas.codexContas().length,2);
  assert.ok(!(await readFile(path.join(m.dir,'pessoas.json'),'utf8')).includes('renova-secreto'));
  await m.contas.removerCodexConta(a.id);
  assert.deepEqual(pedidos.at(-1).pedido.codexContas.map(c=>c.id),[b]);
  await assert.rejects(m.contas.removerCodexConta('naoexiste'),{status:404});
});

test('a conta geral do Codex de antes (uma só) vira a conta "geral" da lista, e o login pendente vai pro root uma vez',async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'ratoeira-contas-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const auth={auth_mode:'chatgpt',tokens:{refresh_token:'renova-pendente'}};
  await writeFile(path.join(dir,'pessoas.json'),JSON.stringify({pessoas:[],links:[],codexGeral:{id:'00000000-0000-4000-8000-000000000000',desde:'2026-10-08T00:00:00.000Z',conta:'time@x.com',plano:'pro',auth}}));
  const pedidos=[];
  const contas=createContas({dir,aoMudarAcessos:async pedido=>{pedidos.push(pedido);}});
  await contas.iniciar();
  assert.deepEqual(contas.codexContas(),[{id:'geral',nome:'Conta da organização',desde:'2026-10-08T00:00:00.000Z',conta:'time@x.com',plano:'pro',pessoas:null,pendente:true}]);
  await contas.reaplicar();
  assert.deepEqual(pedidos.at(-1).codexContas,[{id:'geral',nome:'Conta da organização',users:null,auth}]);
  assert.equal(pedidos.at(-1).codexGeral,undefined);
  const salvo=JSON.parse(await readFile(path.join(dir,'pessoas.json'),'utf8'));
  assert.equal(salvo.codexGeral,undefined);assert.equal(salvo.codexContas[0].auth,undefined,'depois de instalado, o login sai do disco do gateway');
});

test('padrão do chat: o admin define pra todo mundo, a pessoa guarda só o que sobrescreveu',async t=>{
  const m=await comAdmin(t);
  await m.contas.convidar({email:'ana@x.com',nome:'Ana'});
  assert.deepEqual(m.contas.chatPadrao(),{agentes:{}});
  const p=await m.contas.definirChatPadrao({agente:'claude',agentes:{claude:{modelo:'opus[1m]',esforco:'high',modo:'auto'},codex:{modelo:'',modo:'agent'}}});
  assert.deepEqual(p,{agente:'claude',agentes:{claude:{modelo:'opus[1m]',esforco:'high',modo:'auto'},codex:{modo:'agent'}}});
  await assert.rejects(m.contas.definirChatPadrao({agentes:{'../x':{modelo:'a'}}}),{status:400});
  await assert.rejects(m.contas.definirChatPadrao({agentes:{claude:{modelo:'<script>'}}}),{status:400});
  assert.deepEqual(m.contas.chatEscolhas('ana@x.com'),{agentes:{}});
  await m.contas.definirChatEscolhas('ana@x.com',{agentes:{claude:{esforco:'low'}}});
  assert.deepEqual(m.contas.chatEscolhas('ana@x.com'),{agentes:{claude:{esforco:'low'}}});
  // a pasta da última conversa nova fica junto (só nas escolhas da pessoa, nunca no padrão do admin)
  await m.contas.definirChatEscolhas('ana@x.com',{pasta:'clientes/acme',agentes:{claude:{esforco:'low'}}});
  assert.equal(m.contas.chatEscolhas('ana@x.com').pasta,'clientes/acme');
  for(const ruim of ['/etc','../fora','a/../b','a//b','a\\b'])await assert.rejects(m.contas.definirChatEscolhas('ana@x.com',{pasta:ruim,agentes:{}}),{status:400},ruim);
  assert.equal((await m.contas.definirChatPadrao({...p,pasta:'x'})).pasta,undefined);
  await m.contas.definirChatEscolhas('ana@x.com',{pasta:'so-a-pasta',agentes:{}});
  assert.deepEqual(m.contas.chatEscolhas('ana@x.com'),{agentes:{},pasta:'so-a-pasta'},'só a pasta já é escolha');
  // voltar tudo pro padrão apaga a escolha dela
  await m.contas.definirChatEscolhas('ana@x.com',{agentes:{}});
  assert.equal((await m.contas.listar()).find(x=>x.email==='ana@x.com').chat,undefined);
  // persiste no disco
  assert.deepEqual(createContas({dir:m.dir}).chatPadrao(),{agentes:{}},'antes de carregar não há dados');
  const outra=createContas({dir:m.dir});await outra.iniciar();
  assert.deepEqual(outra.chatPadrao(),p);
});

test('a conta geral de antes (uma só) vira a primeira conta da lista, instalada uma vez, sem ninguém logar de novo',async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'ratoeira-contas-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const TOKEN='sk-ant-oat01-'+'g'.repeat(40);
  await mkdir(path.join(dir),{recursive:true});
  await writeFile(path.join(dir,'pessoas.json'),JSON.stringify({pessoas:[],links:[],claudeGeral:{token:TOKEN,desde:'2026-10-08T00:00:00.000Z'}}));
  const pedidos=[];
  const contas=createContas({dir,aoMudarAcessos:async pedido=>{pedidos.push(pedido);}});
  await contas.iniciar();
  assert.deepEqual(contas.claudeContas(),[{id:'geral',nome:'Conta da organização',desde:'2026-10-08T00:00:00.000Z',pessoas:null,pendente:true}]);
  await contas.reaplicar();   // o gateway reaplica ao ligar
  assert.deepEqual(pedidos.at(-1).claudeContas,[{id:'geral',nome:'Conta da organização',users:null,token:TOKEN}]);
  assert.equal(pedidos.at(-1).claudeGeral,undefined,'sem a chave antiga: o root apaga o arquivo antigo');
  const salvo=JSON.parse(await readFile(path.join(dir,'pessoas.json'),'utf8'));
  assert.equal(salvo.claudeGeral,undefined);assert.equal(salvo.claudeContas[0].token,undefined,'depois de instalado, o token sai do disco do gateway');
  await assert.rejects(contas.adicionarClaudeConta({nome:'Repetida',token:TOKEN}),{status:409});
});

test('modo confiança: sem pastas restritas, e as que existiam saem do disco no próximo pedido',async t=>{
  const pedidos=[];const areas=[{id:'time',caminho:'/srv/ratoeira/areas/time',nome:'Time'}];
  const aoMudarAcessos=async(pedido,mudaram)=>{pedidos.push({pedido,mudaram});};
  const m=await comAdmin(t,{criarUsuario:async()=>{},areas,aoMudarAcessos});
  const ana=await m.contas.convidar({email:'ana@x.com',nome:'Ana',ambiente:true,usuario:'ana'});
  await m.contas.usarLink(ana.token,{senha:SENHA});
  await m.contas.restringir('time','financeiro',['ana@x.com']);
  await m.contas.flush();
  // a mesma Ratoeira religada no modo confiança
  const c=createContas({dir:m.dir,areas,aoMudarAcessos,restritas:false});await c.iniciar();
  assert.equal(c.restritasLigadas,false);
  assert.deepEqual(await c.listarRestritas(),[]);
  assert.equal(c.bloqueado('caio@x.com','time','financeiro/notas.md'),false);
  await assert.rejects(c.restringir('time','outra',['ana@x.com']),{status:400});
  await c.reaplicar();
  assert.deepEqual(pedidos.at(-1).pedido.restritas,[]);
});
