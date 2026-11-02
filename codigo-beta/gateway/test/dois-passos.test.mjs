// Verificação em dois passos: código do app (TOTP), reserva, aparelho lembrado, exigir de todos, zerar.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createContas,PRAZOS} from '../contas.mjs';
import * as dois from '../dois-passos.mjs';

const SENHA='uma frase bem comprida';
async function montar(t){
  const dir=await mkdtemp(path.join(tmpdir(),'ratoeira-dois-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  let agora=Date.UTC(2026,9,28,12);
  const contas=createContas({dir,agora:()=>agora});
  await contas.iniciar();
  const token=await contas.primeiroAcesso();
  await contas.usarLink(token,{senha:SENHA,nome:'Caio',email:'caio@x.com'});
  const cod=segredo=>dois.codigo(segredo,Math.floor(agora/dois.PASSO));
  return {dir,contas,cod,passar:ms=>{agora+=ms;}};
}
async function ligar(m,email='caio@x.com'){
  const q=await m.contas.comecarDois(email);
  const {reservas}=await m.contas.confirmarDois(email,m.cod(q.segredo));
  m.passar(dois.PASSO);
  return {segredo:q.segredo,reservas};
}

test('TOTP: vetores do RFC 6238 e janela de um passo pra cada lado',()=>{
  const s=dois.base32(Buffer.from('12345678901234567890'));
  assert.equal(dois.codigo(s,1),'287082');assert.equal(dois.codigo(s,Math.floor(1111111109/30)),'081804');
  const agora=Date.UTC(2026,9,28);const c=Math.floor(agora/dois.PASSO);
  assert.equal(dois.conferir(s,dois.codigo(s,c-1),{agora}),c-1);
  assert.equal(dois.conferir(s,dois.codigo(s,c-2),{agora}),null);
  assert.equal(dois.conferir(s,dois.codigo(s,c),{agora,ultimo:c}),null,'o mesmo código não vale duas vezes');
  assert.match(dois.qrSvg(dois.endereco(s,{email:'a@b.c'})),/^<svg[^>]*>.*<\/svg>$/s);
  assert.doesNotMatch(dois.qrSvg('x'),/<script|on\w+=/i);
});

test('ativar em Tua conta: QR pendente, código certo liga e dá 10 reservas; o segredo não sai na lista',async t=>{
  const m=await montar(t);
  const q=await m.contas.comecarDois('caio@x.com');
  assert.match(q.endereco,/^otpauth:\/\/totp\/Ratoeira:caio%40x\.com\?secret=[A-Z2-7]+&issuer=Ratoeira/);
  await assert.rejects(m.contas.confirmarDois('caio@x.com','000000'),{status:400});
  const {reservas}=await m.contas.confirmarDois('caio@x.com',m.cod(q.segredo));
  assert.equal(reservas.length,10);assert.match(reservas[0],/^[a-z0-9]{4}-[a-z0-9]{4}$/);
  const p=(await m.contas.listar())[0];
  assert.equal(p.doisPassos,true);assert.equal(p.dois,undefined);assert.equal(p.doisPendente,undefined);
  assert.doesNotMatch(await readFile(path.join(m.dir,'pessoas.json'),'utf8'),new RegExp(reservas[0]));
  assert.deepEqual({...m.contas.doisPassos('caio@x.com'),desde:null},{ativo:true,desde:null,reservas:10,exigido:false});
});

test('QR pendente vence em 15 minutos',async t=>{
  const m=await montar(t);
  const q=await m.contas.comecarDois('caio@x.com');m.passar(PRAZOS.ativarDois+1);
  await assert.rejects(m.contas.confirmarDois('caio@x.com',m.cod(q.segredo)),{status:410});
});

test('entrar com 2FA: senha certa vira desafio; código do app abre a sessão; reserva vale uma vez',async t=>{
  const m=await montar(t);const {segredo,reservas}=await ligar(m);
  const r=await m.contas.entrar('caio@x.com',SENHA,'1.1.1.1');
  assert.equal(r.token,undefined);assert.equal(r.tipo,'codigo');
  assert.deepEqual(m.contas.verDesafio(r.desafio),{tipo:'codigo',email:'caio@x.com'});
  await assert.rejects(m.contas.responderDesafio(r.desafio,{codigo:'123456'},'1.1.1.1'),{status:401});
  const s=await m.contas.responderDesafio(r.desafio,{codigo:m.cod(segredo)},'1.1.1.1');
  assert.ok(m.contas.sessao(s.token));assert.equal(s.aparelho,undefined);
  assert.equal(m.contas.verDesafio(r.desafio),null,'desafio usado some');
  // reserva: vale com ou sem hífen e maiúscula, uma vez só
  const r2=await m.contas.entrar('caio@x.com',SENHA,'1.1.1.1');
  assert.ok((await m.contas.responderDesafio(r2.desafio,{codigo:reservas[0].toUpperCase().replace('-','')},'1.1.1.1')).token);
  const r3=await m.contas.entrar('caio@x.com',SENHA,'1.1.1.1');
  await assert.rejects(m.contas.responderDesafio(r3.desafio,{codigo:reservas[0]},'1.1.1.1'),{status:401});
  assert.equal(m.contas.doisPassos('caio@x.com').reservas,9);
});

test('código errado 5 vezes trava e derruba o desafio; desafio vence em 10 minutos',async t=>{
  const m=await montar(t);await ligar(m);
  const r=await m.contas.entrar('caio@x.com',SENHA,'1.1.1.1');
  for(let i=0;i<5;i++)await assert.rejects(m.contas.responderDesafio(r.desafio,{codigo:'000000'},'1.1.1.1'),{status:401});
  await assert.rejects(m.contas.responderDesafio(r.desafio,{codigo:'000000'},'1.1.1.1'),{status:410});
  await assert.rejects(m.contas.entrar('caio@x.com',SENHA,'1.1.1.1'),{status:429});
  const r2=await m.contas.entrar('caio@x.com',SENHA,'2.2.2.2');m.passar(PRAZOS.desafio+1);
  assert.equal(m.contas.verDesafio(r2.desafio),null);
});

test('lembrar este aparelho: 30 dias sem pedir o código; zerar o 2FA esquece os aparelhos',async t=>{
  const m=await montar(t);const {segredo}=await ligar(m);
  const r=await m.contas.entrar('caio@x.com',SENHA,'1.1.1.1');
  const s=await m.contas.responderDesafio(r.desafio,{codigo:m.cod(segredo),lembrar:true},'1.1.1.1');
  assert.equal(s.aparelho.maxAge,30*86400);
  assert.ok((await m.contas.entrar('caio@x.com',SENHA,'1.1.1.1',{aparelho:s.aparelho.token})).token);
  assert.ok((await m.contas.entrar('caio@x.com',SENHA,'1.1.1.1',{aparelho:'outro'})).desafio);
  m.passar(PRAZOS.aparelho+1);
  assert.ok((await m.contas.entrar('caio@x.com',SENHA,'1.1.1.1',{aparelho:s.aparelho.token})).desafio);
});

test('desligar e trocar reservas pedem código; admin zera; link de senha nova pede o código depois',async t=>{
  const m=await montar(t);const {segredo,reservas}=await ligar(m);
  await assert.rejects(m.contas.novasReservas('caio@x.com','000000'),{status:400});
  const nov=await m.contas.novasReservas('caio@x.com',reservas[1]);assert.equal(nov.reservas.length,10);
  // link de senha nova (admin gerou): a senha muda, mas a sessão só abre depois do código
  const l=await m.contas.gerarLink('caio@x.com');
  const u=await m.contas.usarLink(l.token,{senha:'outra frase comprida'},'1.1.1.1');
  assert.equal(u.token,undefined);assert.equal(u.tipo,'codigo');
  // com "zerar junto", o link entra direto
  const l2=await m.contas.gerarLink('caio@x.com',{zerarDois:true});
  assert.ok((await m.contas.usarLink(l2.token,{senha:'mais uma frase longa'})).token);
  assert.equal(m.contas.doisPassos('caio@x.com').ativo,false);
  // liga de novo e desliga com o código do app
  const q=await m.contas.comecarDois('caio@x.com');await m.contas.confirmarDois('caio@x.com',m.cod(q.segredo));m.passar(dois.PASSO);
  await m.contas.desligarDois('caio@x.com',m.cod(q.segredo));assert.equal(m.contas.doisPassos('caio@x.com').ativo,false);
  assert.ok(segredo);
});

test('exigir de todo mundo: só quem já tem liga; quem não tem cai na tela de ativar e sai com reservas',async t=>{
  const m=await montar(t);
  await assert.rejects(m.contas.definirSeguranca({exigirDois:true},'caio@x.com'),{status:409});
  await ligar(m);
  const conv=await m.contas.convidar({email:'ana@x.com',nome:'Ana'});
  const sAna=await m.contas.usarLink(conv.token,{senha:SENHA});
  assert.ok(m.contas.sessao(sAna.token));
  await m.contas.definirSeguranca({exigirDois:true},'caio@x.com');
  assert.equal(m.contas.sessao(sAna.token),null,'sessão de quem não tem 2FA fecha');
  const r=await m.contas.entrar('ana@x.com',SENHA,'3.3.3.3');
  assert.equal(r.tipo,'ativar');
  const d=m.contas.verDesafio(r.desafio);assert.equal(d.tipo,'ativar');assert.match(d.qr,/^<svg/);
  const s=await m.contas.responderDesafio(r.desafio,{codigo:m.cod(d.segredo)},'3.3.3.3');
  assert.ok(m.contas.sessao(s.token));assert.equal(s.reservas.length,10);
  await assert.rejects(m.contas.desligarDois('ana@x.com',s.reservas[0]),{status:409});
  assert.equal((await m.contas.listar()).find(p=>p.email==='ana@x.com').doisPassos,true);
});

test('telas de entrar: senha → código → sessão, com aparelho lembrado; ativar mostra QR e reservas',async t=>{
  const http=await import('node:http');const {tratarEntrada}=await import('../entrada.mjs');
  const m=await montar(t);const {segredo}=await ligar(m);
  const srv=http.createServer(async(req,res)=>{if(!await tratarEntrada(req,res,{contas:m.contas,ip:'9.9.9.9',origemOk:true})){res.writeHead(404);res.end();}});
  await new Promise(r=>srv.listen(0,'127.0.0.1',r));t.after(()=>srv.close());
  const pedir=(caminho,corpo,cookie)=>new Promise((ok,no)=>{const q=http.request({host:'127.0.0.1',port:srv.address().port,path:caminho,method:'POST',
    headers:{host:'r.exemplo.com','content-type':'application/x-www-form-urlencoded',...(cookie?{cookie}:{})}},r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>ok({status:r.statusCode,headers:r.headers,texto:d}));});q.on('error',no);q.end(new URLSearchParams(corpo).toString());});
  const desafioDe=html=>html.match(/name="desafio" value="([^"]+)"/)[1];
  // senha certa: tela do código, sem cookie de sessão
  let r=await pedir('/_ratoeira/entrar',{email:'caio@x.com',senha:SENHA,volta:'/portal/'});
  assert.equal(r.status,200);assert.match(r.texto,/Código do app/);assert.equal(r.headers['set-cookie'],undefined);
  // código errado: mesma tela, com erro
  const d=desafioDe(r.texto);
  r=await pedir('/_ratoeira/entrar/codigo',{desafio:d,codigo:'000000',volta:'/portal/'});
  assert.equal(r.status,401);assert.match(r.texto,/Código incorreto/);
  // certo + lembrar: sessão e cookie do aparelho só pro caminho de entrar
  r=await pedir('/_ratoeira/entrar/codigo',{desafio:d,codigo:m.cod(segredo),lembrar:'1',volta:'/portal/'});
  assert.equal(r.status,303);assert.equal(r.headers.location,'/portal/');
  const [sessao,aparelho]=r.headers['set-cookie'];
  assert.match(sessao,/^ratoeira_sessao=.+; Path=\/; HttpOnly/);assert.match(aparelho,/^ratoeira_aparelho=.+; Path=\/_ratoeira\/; HttpOnly; SameSite=Lax; Max-Age=2592000; Secure/);
  // com o aparelho lembrado, a senha basta
  r=await pedir('/_ratoeira/entrar',{email:'caio@x.com',senha:SENHA},aparelho.split(';')[0]);
  assert.equal(r.status,303);assert.match(r.headers['set-cookie'][0],/^ratoeira_sessao=/);
  // sair de propósito esquece o aparelho (nos dois caminhos do cookie): a próxima entrada pede o código
  r=await pedir('/_ratoeira/sair',{},r.headers['set-cookie'][0].split(';')[0]+'; '+aparelho.split(';')[0]);
  assert.equal(r.status,303);
  assert.ok(r.headers['set-cookie'].some(c=>/^ratoeira_aparelho=; Path=\/_ratoeira\/; .*Max-Age=0/.test(c)));
  assert.ok(r.headers['set-cookie'].some(c=>/^ratoeira_aparelho=; Path=\/_ratoeira\/entrar; .*Max-Age=0/.test(c)));
  r=await pedir('/_ratoeira/entrar',{email:'caio@x.com',senha:SENHA},aparelho.split(';')[0]);
  assert.match(r.texto,/Código do app/,'mesmo com o cookie velho, o servidor esqueceu o aparelho');
  // desafio vencido ou inventado volta pra senha
  r=await pedir('/_ratoeira/entrar/codigo',{desafio:'inventado',codigo:'123456'});
  assert.equal(r.status,410);assert.match(r.texto,/Entre de novo com a senha/);
  // organização exige: quem não tem vê o QR e sai com os códigos de reserva
  await m.contas.definirSeguranca({exigirDois:true},'caio@x.com');
  const conv=await m.contas.convidar({email:'ana@x.com',nome:'Ana'});
  r=await pedir('/_ratoeira/link/'+conv.token,{senha:SENHA,confirmar:SENHA,nome:'Ana'});
  assert.match(r.texto,/Ative a verificação em dois passos/);assert.match(r.texto,/<svg/);
  const seg=r.texto.match(/class="segredo">([^<]+)</)[1].replace(/\s/g,'');
  r=await pedir('/_ratoeira/entrar/codigo',{desafio:desafioDe(r.texto),codigo:m.cod(seg)});
  assert.equal(r.status,200);assert.match(r.texto,/Guarde os códigos de reserva/);assert.equal(r.texto.match(/<li>/g).length,10);
  assert.match(r.headers['set-cookie'][0],/^ratoeira_sessao=/);
});
