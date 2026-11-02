// E-mail da Ratoeira (Resend ou SMTP do próprio aluno) e o "Esqueci a senha" da tela de entrar.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {validarEmailConfig,enviarEmail,emailPublico} from '../email.mjs';
import {createContas} from '../contas.mjs';
import {tratarEntrada} from '../entrada.mjs';

const SENHA='uma frase bem comprida';
const SMTP={tipo:'smtp',de:'Ratoeira <ana@exemplo.com>',host:'smtp.gmail.com',porta:'587',usuario:'ana@exemplo.com',senha:'abcd efgh ijkl mnop'};

test('config: valida Resend e SMTP, mantém a senha guardada quando o campo vem vazio, e a tela não vê segredo',()=>{
  const c=validarEmailConfig(SMTP);
  assert.deepEqual(c,{tipo:'smtp',de:'Ratoeira <ana@exemplo.com>',host:'smtp.gmail.com',porta:587,usuario:'ana@exemplo.com',senha:'abcd efgh ijkl mnop'});
  assert.equal(validarEmailConfig({...SMTP,senha:''},c).senha,'abcd efgh ijkl mnop');
  assert.throws(()=>validarEmailConfig({...SMTP,senha:''}),{status:400});
  assert.throws(()=>validarEmailConfig({...SMTP,de:'sem arroba'}),/Remetente/);
  assert.throws(()=>validarEmailConfig({...SMTP,host:'smtp.gmail.com\nx'}),/Servidor/);
  assert.throws(()=>validarEmailConfig({...SMTP,porta:'22'}),/Porta/);
  assert.throws(()=>validarEmailConfig({tipo:'resend',de:'a@b.co',chave:'errada'}),/re_/);
  const r=validarEmailConfig({tipo:'resend',de:'a@b.co',chave:'re_abcdefghijkl'});
  assert.equal(validarEmailConfig({tipo:'resend',de:'a@b.co',chave:''},r).chave,'re_abcdefghijkl');
  assert.throws(()=>validarEmailConfig({...SMTP,senha:''},r),/senha/,'troca de tipo não herda segredo');
  const pub=emailPublico({...c,desde:'x'});assert.equal(pub.senha,undefined);assert.equal(pub.host,'smtp.gmail.com');
  assert.equal(emailPublico({...r}).chave,undefined);
});

test('envio: Resend pela API, SMTP pelo nodemailer, e o erro do servidor volta legível',async()=>{
  const pedidos=[];
  const fetch=async(url,o)=>{pedidos.push({url,o});return {ok:true,json:async()=>({})};};
  await enviarEmail({tipo:'resend',de:'a@b.co',chave:'re_x'},{para:'ana@x.com',assunto:'Oi',texto:'t'},{fetch});
  assert.equal(pedidos[0].url,'https://api.resend.com/emails');assert.equal(pedidos[0].o.headers.authorization,'Bearer re_x');
  assert.deepEqual(JSON.parse(pedidos[0].o.body),{from:'a@b.co',to:['ana@x.com'],subject:'Oi',text:'t'});
  await assert.rejects(enviarEmail({tipo:'resend',de:'a@b.co',chave:'re_x'},{para:'ana@x.com',assunto:'Oi',texto:'t'},
    {fetch:async()=>({ok:false,status:403,json:async()=>({message:'domain not verified'})})}),/403\): domain not verified/);
  let opcoes,mail;
  const transporte=o=>{opcoes=o;return {sendMail:async m=>{mail=m;},close(){}};};
  await enviarEmail(validarEmailConfig(SMTP),{para:'bia@x.com',assunto:'A',texto:'B'},{transporte});
  assert.equal(opcoes.port,587);assert.equal(opcoes.secure,false);assert.equal(opcoes.requireTLS,true);assert.equal(opcoes.auth.user,'ana@exemplo.com');
  assert.deepEqual(mail,{from:'Ratoeira <ana@exemplo.com>',to:'bia@x.com',subject:'A',text:'B'});
  await assert.rejects(enviarEmail(validarEmailConfig(SMTP),{para:'bia@x.com',assunto:'A',texto:'B'},
    {transporte:()=>({sendMail:async()=>{throw Object.assign(new Error('x'),{responseCode:535,response:'535 Username and Password not accepted'});},close(){}})}),/535.*not accepted/);
  await assert.rejects(enviarEmail(null,{para:'a@b.co'}),{status:409});
});

async function montar(t){
  const dir=await mkdtemp(path.join(tmpdir(),'ratoeira-email-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  let agora=Date.UTC(2026,9,28,12);
  const contas=createContas({dir,agora:()=>agora});await contas.iniciar();
  await contas.usarLink(await contas.primeiroAcesso(),{senha:SENHA,nome:'Caio',email:'caio@x.com'});
  return {dir,contas,passar:ms=>{agora+=ms;}};
}

test('esqueci a senha: só com e-mail e ligado; 3 links por conta e 10 pedidos por IP a cada hora',async t=>{
  const m=await montar(t);
  assert.equal(await m.contas.pedirLinkPorEmail('caio@x.com','1.1.1.1'),null,'sem e-mail configurado');
  await assert.rejects(m.contas.definirEsqueci(true),{status:409});
  await m.contas.definirEmail(validarEmailConfig(SMTP));
  assert.equal(m.contas.email().esqueciSenha,false);
  assert.doesNotMatch(JSON.stringify(m.contas.email()),/abcd efgh/);
  await m.contas.definirEsqueci(true);
  // 10 pedidos do mesmo IP (contas que não existem contam também): o 11º, mesmo de conta certa, não sai
  for(let i=0;i<10;i++)await m.contas.pedirLinkPorEmail('x'+i+'@x.com','9.9.9.9');
  assert.equal(await m.contas.pedirLinkPorEmail('caio@x.com','9.9.9.9'),null);
  const r=await m.contas.pedirLinkPorEmail(' Caio@X.com ','1.1.1.1');
  assert.equal(r.email,'caio@x.com');assert.deepEqual(await m.contas.verLink(r.token),{tipo:'senha',email:'caio@x.com',nome:'Caio'});
  assert.equal(await m.contas.pedirLinkPorEmail('ninguem@x.com','1.1.1.1'),null);
  assert.ok(await m.contas.pedirLinkPorEmail('caio@x.com','1.1.1.2'));assert.ok(await m.contas.pedirLinkPorEmail('caio@x.com','1.1.1.3'));
  assert.equal(await m.contas.pedirLinkPorEmail('caio@x.com','1.1.1.4'),null,'quarto link na hora');
  m.passar(3600e3+1);
  assert.ok(await m.contas.pedirLinkPorEmail('caio@x.com','9.9.9.9'),'depois de 1 h, conta e IP voltam');
  assert.match(await readFile(path.join(m.dir,'acessos.log'),'utf8'),/"evento":"pediu-senha"/);
  await m.contas.removerEmail();assert.equal(m.contas.esqueciLigado(),false);
});

test('tela: sem e-mail, o texto manda pedir pra quem administra; com, o link vai pro endereço configurado',async t=>{
  const m=await montar(t);const mandados=[];
  const srv=http.createServer(async(req,res)=>{if(!await tratarEntrada(req,res,{contas:m.contas,ip:'5.5.5.5',origemOk:true,base:'https://r.exemplo.com',mandarEmail:async x=>{mandados.push(x);}})){res.writeHead(404);res.end();}});
  await new Promise(r=>srv.listen(0,'127.0.0.1',r));t.after(()=>srv.close());
  const pedir=(caminho,corpo)=>new Promise((ok,no)=>{const q=http.request({host:'127.0.0.1',port:srv.address().port,path:caminho,method:corpo?'POST':'GET',
    headers:{host:'atacante.com',...(corpo?{'content-type':'application/x-www-form-urlencoded'}:{})}},r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>ok({status:r.statusCode,texto:d}));});q.on('error',no);q.end(corpo?new URLSearchParams(corpo).toString():undefined);});
  let r=await pedir('/_ratoeira/entrar');assert.match(r.texto,/pra quem administra/);assert.doesNotMatch(r.texto,/href="\/_ratoeira\/esqueci"/);
  assert.equal((await pedir('/_ratoeira/esqueci')).status,404);
  await m.contas.definirEmail(validarEmailConfig(SMTP));await m.contas.definirEsqueci(true);
  r=await pedir('/_ratoeira/entrar');assert.match(r.texto,/href="\/_ratoeira\/esqueci"/);
  r=await pedir('/_ratoeira/esqueci',{email:'caio@x.com'});assert.match(r.texto,/Confira o seu e-mail/);
  const r2=await pedir('/_ratoeira/esqueci',{email:'ninguem@x.com'});assert.equal(r2.texto,r.texto,'mesma resposta sem conta');
  await new Promise(ok=>setTimeout(ok,50));
  assert.equal(mandados.length,1);assert.equal(mandados[0].para,'caio@x.com');
  assert.match(mandados[0].texto,/https:\/\/r\.exemplo\.com\/_ratoeira\/link\/[A-Za-z0-9_-]{40,}/);assert.doesNotMatch(mandados[0].texto,/atacante/);
});
