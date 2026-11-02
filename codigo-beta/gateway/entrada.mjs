// Telas de entrada do login próprio (modo "senha"): entrar, link (primeiro acesso, convite,
// senha nova) e sair. HTML gerado aqui, sem JavaScript (CSP script-src 'none'), formulário
// normal. Quem chama já conferiu a origem do POST (server.mjs, allowedOrigin).
export const COOKIE='ratoeira_sessao';
// aparelho lembrado da verificação em dois passos: vai pra entrar e pra sair (sair esquece o aparelho).
// Até 28/10/2026 o caminho era /_ratoeira/entrar; o sair apaga esse também.
const APARELHO='ratoeira_aparelho';
const politica="default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; manifest-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'";
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export function lerCookie(req,nome=COOKIE){
  for(const parte of String(req.headers.cookie??'').split(';')){
    const i=parte.indexOf('=');if(i<0)continue;
    if(parte.slice(0,i).trim()===nome)return parte.slice(i+1).trim();
  }
  return null;
}
// Secure fora do localhost (túnel SSH em http://localhost não teria como mandar o cookie de volta no Safari).
function cookie(req,valor,maxAge){
  const local=/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(req.headers.host??'');
  return `${COOKIE}=${valor}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${local?'':'; Secure'}`;
}
function cookieAparelho(req,valor,maxAge,caminho='/_ratoeira/'){
  const local=/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(req.headers.host??'');
  return `${APARELHO}=${valor}; Path=${caminho}; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${local?'':'; Secure'}`;
}
// Só caminho do próprio site, nunca outro domínio (//x.com, /\x.com).
export function voltaSegura(v){
  const s=String(v??'');
  return /^\/(?![\/\\])[^\s]*$/.test(s)&&!s.startsWith('/_ratoeira/entrar')&&!s.startsWith('/_ratoeira/link/')?s:'/';
}

function pagina(res,status,titulo,corpo,extra={}){
  res.writeHead(status,{'content-type':'text/html; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'same-origin','content-security-policy':politica,'x-frame-options':'DENY',...extra});
  res.end(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><link rel="manifest" href="/manifest.json"><link rel="apple-touch-icon" href="/_ratoeira/icon.png"><title>${esc(titulo)} · Ratoeira</title><style>
:root{--bg:#f6f5f1;--card:#fff;--tx:#1d1d1b;--mu:#6b6860;--li:#dcd9d1;--ac:#FFD600;--er:#b3261e;font:16px/1.5 system-ui,-apple-system,'Segoe UI',sans-serif;color:var(--tx);background:var(--bg)}
body{margin:0;min-height:100vh;display:grid;place-items:center;padding:16px;box-sizing:border-box}
main{width:100%;max-width:380px;background:var(--card);border:1px solid var(--li);border-radius:14px;padding:28px 24px;box-sizing:border-box}
.marca{display:flex;align-items:center;gap:10px;font-weight:800;font-size:18px;margin-bottom:18px}.marca img{width:28px;height:28px}
h1{font-size:22px;margin:0 0 6px}p{margin:0 0 16px;color:var(--mu)}label{display:block;font-size:14px;font-weight:600;margin:14px 0 6px}
input{width:100%;box-sizing:border-box;font:inherit;padding:10px 12px;border:1px solid var(--li);border-radius:8px;background:transparent;color:inherit}
input:focus{outline:2px solid var(--ac);outline-offset:1px}
button{margin-top:20px;width:100%;font:inherit;font-weight:700;padding:11px;border:0;border-radius:8px;background:var(--ac);color:#1d1d1b;cursor:pointer}
.erro{color:var(--er);font-weight:600}.dica{font-size:13px;margin-top:6px;color:var(--mu)}
.dica a{color:var(--tx)}code{font:12px ui-monospace,monospace;background:var(--bg);padding:1px 4px;border-radius:4px}
.qr{display:block;width:200px;height:200px;margin:4px auto 8px}.qr svg{width:100%;height:100%}
.segredo{font:13px/1.4 ui-monospace,monospace;word-break:break-all;background:var(--bg);padding:8px 10px;border-radius:8px;color:var(--tx)}
.marcar{display:flex;gap:8px;align-items:center;font-weight:400;margin-top:14px}.marcar input{width:auto}
.reservas{columns:2;font:15px/1.9 ui-monospace,monospace;background:var(--bg);padding:10px 14px;border-radius:8px;margin:0 0 12px;list-style:none}
a.botao{display:block;text-align:center;text-decoration:none;margin-top:20px;font-weight:700;padding:11px;border-radius:8px;background:var(--ac);color:#1d1d1b}
</style></head><body><main><div class="marca"><img src="/_ratoeira/icon.png" alt="">Ratoeira</div>${corpo}</main></body></html>`);
}

async function lerFormulario(req){
  if(!/^application\/x-www-form-urlencoded(?:\s*;|$)/i.test(req.headers['content-type']??''))return null;
  let tam=0;const partes=[];
  for await(const c of req){tam+=c.length;if(tam>8192)return null;partes.push(c);}
  return Object.fromEntries(new URLSearchParams(Buffer.concat(partes).toString('utf8')));
}

// Sem e-mail configurado, quem esqueceu pede pra quem administra; quem administra sozinho, pelo agente do computador.
const SEM_ESQUECI='Esqueceu a senha? Peça um link novo pra quem administra esta Ratoeira. Se for você quem administra, peça pro agente do seu computador (que entra na VPS por SSH) gerar um link de senha nova: <code>conta.mjs redefinir</code>, no gateway da Ratoeira.';
function telaEntrar(res,{erro='',email='',volta='/',status=200,esqueci=false}={}){
  pagina(res,status,'Entrar',`<h1>Entrar</h1>${erro?`<p class="erro" role="alert">${esc(erro)}</p>`:'<p>Use o e-mail e a senha da sua conta.</p>'}
<form method="post" action="/_ratoeira/entrar"><input type="hidden" name="volta" value="${esc(volta)}">
<label for="email">E-mail</label><input id="email" name="email" type="email" autocomplete="username" required value="${esc(email)}" autofocus>
<label for="senha">Senha</label><input id="senha" name="senha" type="password" autocomplete="current-password" required>
<button type="submit">Entrar</button></form><p class="dica" style="margin-top:16px">${esqueci?`<a href="/_ratoeira/esqueci">Esqueceu a senha?</a>`:SEM_ESQUECI}</p>`);
}

function telaEsqueci(res,{enviado=false,status=200}={}){
  if(enviado){pagina(res,status,'Esqueci a senha',`<h1>Confira o seu e-mail</h1><p>Se existir uma conta com esse e-mail, chega um link pra criar a senha nova em alguns minutos. Ele vale 1 hora. Veja também o spam.</p><p class="dica"><a href="/_ratoeira/entrar">Voltar pra entrar</a></p>`);return;}
  pagina(res,status,'Esqueci a senha',`<h1>Esqueci a senha</h1><p>Digite o e-mail da sua conta. Mandamos um link pra criar uma senha nova.</p>
<form method="post" action="/_ratoeira/esqueci"><label for="email">E-mail</label><input id="email" name="email" type="email" autocomplete="username" required autofocus>
<button type="submit">Mandar o link</button></form><p class="dica" style="margin-top:16px"><a href="/_ratoeira/entrar">Voltar pra entrar</a></p>`);
}

// Segundo passo: o código do app (tipo 'codigo') ou configurar agora, quando a organização exige ('ativar').
// O desafio vai no formulário; ele vale 10 min e só existe na memória do gateway.
function telaCodigo(res,desafio,info,{erro='',volta='/',status=200}={}){
  const campos=`<input type="hidden" name="desafio" value="${esc(desafio)}"><input type="hidden" name="volta" value="${esc(volta)}">`;
  if(info.tipo==='ativar'){
    pagina(res,status,'Verificação em dois passos',`<h1>Ative a verificação em dois passos</h1>
${erro?`<p class="erro" role="alert">${esc(erro)}</p>`:'<p>Esta Ratoeira pede um código do celular, além da senha. Leve um minuto pra configurar.</p>'}
<p>1. Instale um app autenticador no celular (Google Authenticator, Microsoft Authenticator, 1Password).</p>
<p>2. No app, adicione uma conta e aponte a câmera pro código abaixo.</p>
<div class="qr">${info.qr}</div>
<p class="dica">Sem câmera? Digite esta chave no app:</p><p class="segredo">${esc(info.segredo.replace(/(.{4})/g,'$1 ').trim())}</p>
<form method="post" action="/_ratoeira/entrar/codigo">${campos}
<label for="codigo">3. Digite o código de 6 dígitos que o app mostra</label><input id="codigo" name="codigo" inputmode="numeric" autocomplete="one-time-code" required maxlength="12" autofocus>
<button type="submit">Ativar e entrar</button></form>`);
    return;
  }
  pagina(res,status,'Código',`<h1>Código do app</h1>
${erro?`<p class="erro" role="alert">${esc(erro)}</p>`:`<p>Abra o app autenticador e digite o código da Ratoeira de ${esc(info.email)}.</p>`}
<form method="post" action="/_ratoeira/entrar/codigo">${campos}
<label for="codigo">Código</label><input id="codigo" name="codigo" inputmode="numeric" autocomplete="one-time-code" required maxlength="12" autofocus>
<label class="marcar"><input type="checkbox" name="lembrar" value="1"> Não pedir de novo neste aparelho por 30 dias</label>
<button type="submit">Entrar</button></form><p class="dica" style="margin-top:16px">Perdeu o celular? Digite um dos códigos de reserva no lugar. Sem eles, peça pra quem administra esta Ratoeira zerar a sua verificação.</p>`);
}
// Acabou de ativar: os códigos de reserva aparecem uma vez só. A sessão já está aberta.
function telaReservas(res,reservas,volta){
  pagina(res,200,'Códigos de reserva',`<h1>Guarde os códigos de reserva</h1>
<p>Se perder o celular, cada um destes códigos entra no lugar do código do app, uma vez só. Eles não aparecem de novo: anote num lugar seguro (um gerenciador de senhas, por exemplo).</p>
<ul class="reservas">${reservas.map(r=>`<li>${esc(r)}</li>`).join('')}</ul>
<a class="botao" href="${esc(volta)}">Já guardei, continuar</a>`);
}
// Depois da senha certa (entrar ou link): abre a sessão, ou mostra o segundo passo.
function seguir(req,res,contas,s,volta){
  if(s.desafio){telaCodigo(res,s.desafio,contas.verDesafio(s.desafio),{volta});return;}
  res.writeHead(303,{location:volta,'set-cookie':cookie(req,s.token,s.maxAge),'cache-control':'no-store'});res.end();
}

function telaLink(res,info,{erro='',status=200,nome}={}){
  const titulo={primeiro:'Criar a conta de administrador',convite:'Criar sua senha',senha:'Criar uma senha nova'}[info.tipo];
  const intro={primeiro:'Esta é a primeira conta desta Ratoeira. Ela vai administrar as outras.',convite:`Você foi convidado pra Ratoeira como ${esc(info.email)}.`,senha:`Senha nova pra ${esc(info.email)}. As sessões abertas com a senha antiga vão fechar.`}[info.tipo];
  pagina(res,status,titulo,`<h1>${esc(titulo)}</h1>${erro?`<p class="erro" role="alert">${esc(erro)}</p>`:''}<p>${intro}</p>
<form method="post">${info.tipo==='primeiro'?`<label for="email">E-mail</label><input id="email" name="email" type="email" autocomplete="username" required>`:`<input type="hidden" name="email" value="${esc(info.email)}" autocomplete="username">`}
<label for="nome">Nome</label><input id="nome" name="nome" required maxlength="80" value="${esc(nome??info.nome)}">
<label for="senha">Senha</label><input id="senha" name="senha" type="password" autocomplete="new-password" required minlength="10" maxlength="200">
<p class="dica">Pelo menos 10 caracteres. Uma frase serve bem.</p>
<label for="confirmar">Repita a senha</label><input id="confirmar" name="confirmar" type="password" autocomplete="new-password" required>
<button type="submit">Salvar e entrar</button></form>`);
}

const linkMorto=res=>pagina(res,410,'Link inválido','<h1>Este link não vale mais</h1><p>Ele venceu, já foi usado ou foi trocado por um mais novo. Peça um link novo pra quem administra esta Ratoeira.</p>');

// Responde as rotas de entrada. Devolve true se tratou o pedido.
// base: o endereço configurado da Ratoeira (nunca o Host do pedido, que quem pede escolhe) pro link do e-mail;
// mandarEmail({para, assunto, texto}): o envio pelo e-mail da Ratoeira (email.mjs), ou nada se não tem.
export async function tratarEntrada(req,res,{contas,ip,origemOk,base=null,mandarEmail=null}){
  const esqueci=Boolean(base&&mandarEmail&&contas.esqueciLigado?.());
  const url=new URL(req.url,'http://x');const caminho=url.pathname;
  if(caminho==='/_ratoeira/entrar'){
    if(req.method==='GET'||req.method==='HEAD'){
      // Já tem sessão: segue pra onde ia. No iPhone, quem pôs a Ratoeira na tela inicial a partir
      // desta tela ficou com ela como endereço de abertura e caía no formulário toda vez.
      const volta=voltaSegura(url.searchParams.get('volta'));
      if(contas.sessao(lerCookie(req))){res.writeHead(303,{location:volta,'cache-control':'no-store'});res.end();return true;}
      telaEntrar(res,{volta,esqueci});return true;
    }
    if(req.method!=='POST'){pagina(res,405,'Entrar','<h1>Método não aceito</h1>');return true;}
    if(!origemOk){pagina(res,403,'Entrar','<h1>Origem não permitida</h1>');return true;}
    const f=await lerFormulario(req);
    if(!f){telaEntrar(res,{erro:'Formulário inválido.',status:400,esqueci});return true;}
    const volta=voltaSegura(f.volta);
    try{
      seguir(req,res,contas,await contas.entrar(f.email,f.senha,ip,{aparelho:lerCookie(req,APARELHO)}),volta);
    }catch(e){telaEntrar(res,{erro:e.status?e.message:'Não deu pra entrar agora. Tente de novo.',email:f.email,volta,status:e.status??500,esqueci});}
    return true;
  }
  if(caminho==='/_ratoeira/esqueci'){
    if(!esqueci){pagina(res,404,'Esqueci a senha',`<h1>Esqueci a senha</h1><p>${SEM_ESQUECI}</p><p class="dica"><a href="/_ratoeira/entrar">Voltar pra entrar</a></p>`);return true;}
    if(req.method==='GET'||req.method==='HEAD'){telaEsqueci(res);return true;}
    if(req.method!=='POST'){pagina(res,405,'Esqueci a senha','<h1>Método não aceito</h1>');return true;}
    if(!origemOk){pagina(res,403,'Esqueci a senha','<h1>Origem não permitida</h1>');return true;}
    const f=await lerFormulario(req);
    if(!f){telaEsqueci(res,{status:400});return true;}
    // mesma resposta com conta ou sem, e o envio não segura a resposta (o tempo não entrega se a conta existe)
    contas.pedirLinkPorEmail(f.email,ip).then(r=>{
      if(!r)return;
      const host=base.replace(/^https?:\/\//,'');
      return mandarEmail({para:r.email,assunto:'Senha nova da Ratoeira',texto:`Olá, ${r.nome}.\n\nAlguém pediu pra trocar a senha da sua conta na Ratoeira (${host}). Se foi você, abra o link abaixo em até 1 hora e crie a senha nova:\n\n${base}/_ratoeira/link/${r.token}\n\nSe não foi você, ignore este e-mail: a senha de agora continua valendo.\n`});
    }).catch(e=>console.log('esqueci a senha: o e-mail não saiu:',e.message));
    telaEsqueci(res,{enviado:true});return true;
  }
  if(caminho==='/_ratoeira/entrar/codigo'){
    if(req.method!=='POST'){res.writeHead(303,{location:'/_ratoeira/entrar','cache-control':'no-store'});res.end();return true;}
    if(!origemOk){pagina(res,403,'Entrar','<h1>Origem não permitida</h1>');return true;}
    const f=await lerFormulario(req);
    const volta=voltaSegura(f?.volta),info=f&&contas.verDesafio(f.desafio);
    if(!info){telaEntrar(res,{erro:'A entrada venceu. Entre de novo com a senha.',volta,status:410,esqueci});return true;}
    try{
      const s=await contas.responderDesafio(f.desafio,{codigo:f.codigo,lembrar:f.lembrar==='1'},ip);
      const cookies=[cookie(req,s.token,s.maxAge),...(s.aparelho?[cookieAparelho(req,s.aparelho.token,s.aparelho.maxAge)]:[])];
      if(s.reservas){res.setHeader('set-cookie',cookies);telaReservas(res,s.reservas,volta);return true;}
      res.writeHead(303,{location:volta,'set-cookie':cookies,'cache-control':'no-store'});res.end();
    }catch(e){
      if(e.status===401&&contas.verDesafio(f.desafio))telaCodigo(res,f.desafio,info,{erro:e.message,volta,status:401});
      else telaEntrar(res,{erro:e.status?e.message:'Não deu pra entrar agora. Tente de novo.',volta,status:e.status??500,esqueci});
    }
    return true;
  }
  if(caminho.startsWith('/_ratoeira/link/')){
    const token=caminho.slice('/_ratoeira/link/'.length);
    const info=await contas.verLink(token);
    if(!info){linkMorto(res);return true;}
    if(req.method==='GET'||req.method==='HEAD'){telaLink(res,info);return true;}
    if(req.method!=='POST'){pagina(res,405,'Link','<h1>Método não aceito</h1>');return true;}
    if(!origemOk){pagina(res,403,'Link','<h1>Origem não permitida</h1>');return true;}
    const f=await lerFormulario(req);
    if(!f){telaLink(res,info,{erro:'Formulário inválido.',status:400});return true;}
    if(f.senha!==f.confirmar){telaLink(res,info,{erro:'As duas senhas não são iguais.',status:400,nome:f.nome});return true;}
    try{
      seguir(req,res,contas,await contas.usarLink(token,{senha:f.senha,nome:f.nome,email:f.email},ip),'/');
    }catch(e){
      if(e.status===410)linkMorto(res);
      else telaLink(res,info,{erro:e.status?e.message:'Não deu pra salvar agora. Tente de novo.',status:e.status??500,nome:f.nome});
    }
    return true;
  }
  if(caminho==='/_ratoeira/sair'){
    if(req.method!=='POST'){pagina(res,405,'Sair','<h1>Método não aceito</h1>');return true;}
    if(!origemOk){pagina(res,403,'Sair','<h1>Origem não permitida</h1>');return true;}
    const token=lerCookie(req);if(token)await contas.sair(token);
    // saiu de propósito: na próxima entrada deste navegador, o código do app volta a ser pedido
    const aparelho=lerCookie(req,APARELHO);if(aparelho)await contas.esquecerAparelho?.(aparelho);
    res.writeHead(303,{location:'/_ratoeira/entrar','set-cookie':[cookie(req,'',0),cookieAparelho(req,'',0),cookieAparelho(req,'',0,'/_ratoeira/entrar')],'cache-control':'no-store'});res.end();
    return true;
  }
  return false;
}
