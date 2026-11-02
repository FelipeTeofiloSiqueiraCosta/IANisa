// E-mail da Ratoeira (desde 28/10/2026): o de quem instalou, nunca um nosso. Resend (chave da API) ou qualquer SMTP
// (Gmail com senha de app, o do provedor do domínio). Serve o "Esqueci a senha" da tela de entrar.
// A config fica com as contas (contas.mjs, pessoas.json, 600) e a senha ou chave nunca volta pra tela.
// SMTP da própria VPS não serve: a maioria dos provedores fecha a porta 25 e e-mail saído de IP de VPS cai no spam.
import nodemailer from 'nodemailer';

const EMAIL=/^[^@\s<>"'\\]{1,64}@[^@\s<>"'\\]{1,190}$/;
const HOST=/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/i;
const erro=(status,mensagem)=>Object.assign(new Error(mensagem),{status});

// Confere e normaliza o que veio da tela. `antiga`: a config de antes, pra manter a senha/chave quando o campo vem vazio.
export function validarEmailConfig(c,antiga=null){
  const tipo=c?.tipo;
  if(!['resend','smtp'].includes(tipo))throw erro(400,'Escolha Resend ou SMTP.');
  const de=String(c.de??'').trim();
  // "Nome <email>" ou só o e-mail
  const m=de.match(/^(?:([^<>"\r\n]{1,80})\s*<([^<>\s]+)>|([^<>\s]+))$/);
  const endereco=m?(m[2]??m[3]):null;
  if(!endereco||!EMAIL.test(endereco))throw erro(400,'Remetente inválido. Ex.: Ratoeira <ratoeira@seudominio.com.br>');
  const mesma=antiga?.tipo===tipo?antiga:null;
  if(tipo==='resend'){
    const chave=String(c.chave??'').trim()||mesma?.chave||'';
    if(!/^re_[A-Za-z0-9_-]{10,200}$/.test(chave))throw erro(400,'A chave do Resend começa com re_.');
    return {tipo,de,chave};
  }
  const host=String(c.host??'').trim().toLowerCase(),porta=Number(c.porta||587),usuario=String(c.usuario??'').trim();
  const senha=String(c.senha??'')||mesma?.senha||'';
  if(!HOST.test(host))throw erro(400,'Servidor SMTP inválido. Ex.: smtp.gmail.com');
  if(![25,465,587,2525].includes(porta))throw erro(400,'Porta do SMTP: 587 (a mais comum), 465 ou 2525.');
  if(!usuario||usuario.length>200||/[\r\n]/.test(usuario))throw erro(400,'Informe o usuário do SMTP (em geral, o próprio e-mail).');
  if(!senha||senha.length>500||/[\r\n]/.test(senha))throw erro(400,'Informe a senha do SMTP (no Gmail, uma senha de app).');
  return {tipo,de,host,porta,usuario,senha};
}

// Manda um e-mail. `fetch` e `transporte` trocáveis pros testes.
export async function enviarEmail(cfg,{para,assunto,texto},{fetch:f=globalThis.fetch,transporte=nodemailer.createTransport}={}){
  if(!cfg)throw erro(409,'Esta Ratoeira não tem e-mail configurado.');
  if(!EMAIL.test(String(para??'')))throw erro(400,'Destinatário inválido.');
  if(cfg.tipo==='resend'){
    const r=await f('https://api.resend.com/emails',{method:'POST',signal:AbortSignal.timeout(15000),
      headers:{authorization:'Bearer '+cfg.chave,'content-type':'application/json'},body:JSON.stringify({from:cfg.de,to:[para],subject:assunto,text:texto})});
    if(!r.ok){let m='';try{m=(await r.json()).message??'';}catch{}throw erro(502,'O Resend recusou ('+r.status+')'+(m?': '+m:'.'));}
    return true;
  }
  const t=transporte({host:cfg.host,port:cfg.porta,secure:cfg.porta===465,requireTLS:cfg.porta===587,auth:{user:cfg.usuario,pass:cfg.senha},
    connectionTimeout:15000,greetingTimeout:15000,socketTimeout:20000});
  try{await t.sendMail({from:cfg.de,to:para,subject:assunto,text:texto});}
  catch(e){throw erro(502,'O servidor de e-mail recusou'+(e.responseCode?' ('+e.responseCode+')':'')+': '+String(e.response||e.message||'').slice(0,200));}
  finally{t.close?.();}
  return true;
}

// O que a tela pode ver: sem senha nem chave
export const emailPublico=(cfg,extra={})=>cfg?{configurado:true,tipo:cfg.tipo,de:cfg.de,...(cfg.tipo==='smtp'?{host:cfg.host,porta:cfg.porta,usuario:cfg.usuario}:{}),desde:cfg.desde??null,...extra}:{configurado:false,...extra};
