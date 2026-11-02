// Playground (13/10/2026): experimentos em Docker, fora do padrão de apps (APPS.md). Cada um é uma pasta
// <área>/playground/<nome>/ com um compose.yaml e um ratoeira-play.json; os containers levam a etiqueta
// ratoeira.play=<nome> e escutam só em 127.0.0.1. Todos moram num endereço só, o do Playground (Configurações ›
// Playground, ex.: apps.exemplo.com), cada um no seu caminho: apps.exemplo.com/<nome>/. O caminho chega inteiro no
// container (com o /<nome>/, e x-forwarded-prefix), então o experimento precisa funcionar debaixo dele, como os apps.
// Com "dominio" no manifesto, ele abre também na raiz desse domínio, e o caminho no endereço do Playground
// redireciona pra lá (um endereço de verdade por experimento).
// Dois tipos (14/10/2026): "programa" (com "porta": um container que o gateway repassa) e "pagina" (sem porta: HTML e
// arquivos servidos direto do disco, da pasta do item ou da "pasta" que o manifesto aponta no repo, sem Docker).
// Quem vê ("acesso"): "time" (padrão), "senha" (quem tem a senha do manifesto, guardada só como sha256; o time entra
// sem ela) ou "publico". Tudo sai com X-Robots-Tag: noindex, a não ser com "indexar": true.
// - time: só quem tem login na Ratoeira. O cookie da Ratoeira é só do endereço principal, então o
//   subdomínio ganha o dele por uma troca de código: sem cookie, vai pro endereço principal (/_ratoeira/play/entrar),
//   que confere o login e volta com um código de uso único (60 s); o gateway troca por um cookie só daquele endereço.
// - publico: abre sem login (é a chave de "expor pra fora").
// Nenhum cookie da Ratoeira chega no container. O estado dos containers (ligado, memória, CPU) vem do ajudante de root
// ratoeira-playground (kit/receitas/playground), que também desliga o que ficou 7 dias sem acesso, lendo o
// arquivo de últimos acessos que este módulo grava.
import http from 'node:http';
import path from 'node:path';
import { readFileSync, writeFileSync, renameSync, readdirSync, existsSync, mkdirSync, realpathSync, statSync, createReadStream } from 'node:fs';
import { createHmac, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { Marked } from 'marked';

export const COOKIE_PLAY='ratoeira_play';
export const COOKIE_SENHA='ratoeira_pub';
const TIPOS={'.html':'text/html; charset=utf-8','.htm':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8',
  '.json':'application/json; charset=utf-8','.txt':'text/plain; charset=utf-8','.md':'text/markdown; charset=utf-8','.csv':'text/csv; charset=utf-8','.xml':'application/xml',
  '.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.gif':'image/gif','.webp':'image/webp','.avif':'image/avif','.ico':'image/x-icon',
  '.pdf':'application/pdf','.mp4':'video/mp4','.webm':'video/webm','.mp3':'audio/mpeg','.wav':'audio/wav','.woff':'font/woff','.woff2':'font/woff2','.ttf':'font/ttf','.otf':'font/otf','.zip':'application/zip'};
const NOME=/^[a-z0-9][a-z0-9-]{0,40}$/;
const HOST=/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/;
const VALIDADE_COOKIE=14*86400;
// o que o diálogo Publicar aceita: só arquivo (HTML, PDF, imagem, markdown), pasta não
export const PUBLICAVEL=/\.(html?|pdf|png|jpe?g|gif|webp|svg|avif|md)$/i;
const marked=new Marked({gfm:true});
// caminho relativo seguro (sem .., sem oculto, sem barra invertida nem controle)
const relOk=r=>typeof r==='string'&&r.length>0&&r.length<=1000&&!r.split('/').some(x=>!x||x==='..'||x.startsWith('.')||/[\\\x00-\x1f]/.test(x));

// ratoeira-play.json → o experimento, ou null se inválido (com o motivo em .erro pra tela mostrar)
export function lerManifesto(texto,pasta){
  let m;try{m=JSON.parse(texto);}catch{return {nome:pasta,erro:'ratoeira-play.json não é JSON válido.'};}
  const nome=m?.nome??pasta;
  if(nome!==pasta||!NOME.test(nome))return {nome:pasta,erro:`"nome" precisa ser igual à pasta (${pasta}), em minúsculas, números e hífen.`};
  const tipo=m.tipo??(m.porta!=null?'programa':'pagina');
  if(!['programa','pagina'].includes(tipo))return {nome,erro:'"tipo" precisa ser "pagina" ou "programa".'};
  if(tipo==='programa'&&(!Number.isInteger(m.porta)||m.porta<1024||m.porta>65535))return {nome,erro:'"porta" precisa ser um número entre 1024 e 65535.'};
  const acesso=m.acesso??(m.publico===true?'publico':'time');
  if(!['time','senha','publico'].includes(acesso))return {nome,erro:'"acesso" precisa ser "time", "senha" ou "publico".'};
  const senha=typeof m.senha_sha256==='string'?m.senha_sha256.toLowerCase():null;
  if(acesso==='senha'&&!/^[a-f0-9]{64}$/.test(senha??''))return {nome,erro:'Com "acesso": "senha", falta "senha_sha256" (o sha256 da senha, em hexadecimal).'};
  const pastaRel=m.pasta==null||m.pasta===''?null:String(m.pasta).replace(/^\/+|\/+$/g,'');
  if(pastaRel&&(tipo!=='pagina'||pastaRel.split('/').some(x=>!x||x==='..'||x.startsWith('.'))))return {nome,erro:'"pasta" é só pra página, relativa à raiz do repositório, sem ".." nem pasta oculta.'};
  // publicada pelo diálogo: de onde veio, o arquivo de entrada, o que foi junto e se é foto ou ao vivo
  const origem=m.origem==null?null:String(m.origem);
  if(origem!=null&&(tipo!=='pagina'||!relOk(origem)))return {nome,erro:'"origem" inválida (caminho relativo à raiz do repositório).'};
  const entrada=m.entrada==null?null:String(m.entrada);
  if(entrada!=null&&(!relOk(entrada)||entrada.includes('/')))return {nome,erro:'"entrada" precisa ser um nome de arquivo.'};
  const junto=Array.isArray(m.junto)?m.junto.map(String):[];
  if(junto.some(j=>!relOk(j)||j.includes('/')))return {nome,erro:'"junto" é uma lista de nomes de arquivo ou pasta, do lado da origem.'};
  const modo=m.modo==='aovivo'?'aovivo':'foto';
  if(modo==='aovivo'&&(!origem||!pastaRel||!entrada))return {nome,erro:'Ao vivo precisa de "origem", "pasta" e "entrada".'};
  const dominio=m.dominio==null||m.dominio===''?null:String(m.dominio).toLowerCase();
  if(dominio&&!HOST.test(dominio))return {nome,erro:'"dominio" inválido (ex.: demo.exemplo.com).'};
  const texto1=(v,max)=>typeof v==='string'?v.slice(0,max):'';
  return {nome,titulo:texto1(m.titulo,80)||nome,descricao:texto1(m.descricao,300),dono:texto1(m.dono,254).toLowerCase(),tipo,porta:tipo==='programa'?m.porta:null,acesso,publico:acesso==='publico',senha,pastaRel,indexar:m.indexar===true,dominio,origem,entrada,junto,modo,
    publicadoEm:typeof m.publicado_em==='string'?m.publicado_em:null,publicadoPor:texto1(m.publicado_por,254).toLowerCase()};
}

export function createPlayground({areas=[],estadoDir,hostname,ipHeader,estadoArquivo='/var/lib/ratoeira/playground/estado.json',agora=Date.now,request=http.request}){
  if(estadoDir&&!existsSync(estadoDir))mkdirSync(estadoDir,{recursive:true});
  const arq=n=>path.join(estadoDir,n);
  const lerJson=(f,padrao)=>{try{return JSON.parse(readFileSync(f,'utf8'));}catch{return padrao;}};
  const gravar=(f,obj,modo=0o600)=>{writeFileSync(f+'.tmp',JSON.stringify(obj,null,1)+'\n',{mode:modo});renameSync(f+'.tmp',f);};
  // segredo do cookie: nasce na primeira vez, fica no estado do gateway
  let segredo;try{segredo=readFileSync(arq('playground-segredo'),'utf8').trim();}catch{}
  if(!segredo||segredo.length<32){segredo=randomBytes(32).toString('base64url');writeFileSync(arq('playground-segredo'),segredo+'\n',{mode:0o600});}
  // IP de quem acessa: só o cabeçalho que o proxy da frente grava (ipHeader da config: cf-connecting-ip no
  // Tunnel, x-real-ip no Caddy). Confiar no cf-connecting-ip sem Cloudflare na frente deixava trocar de "IP"
  // a cada tentativa e passar pela trava de senha.
  const ipDe=req=>String((ipHeader&&req.headers[ipHeader])||req.socket.remoteAddress||'').split(',')[0].trim();
  let cfg=lerJson(arq('playground.json'),{});
  const acessos=lerJson(arq('playground-acessos.json'),{});
  let acessosSujo=false;
  const gravarAcessos=()=>{if(!acessosSujo)return;acessosSujo=false;try{gravar(arq('playground-acessos.json'),acessos,0o640);}catch(e){console.log('playground: não gravei os acessos ('+e.message+')');}};
  const timer=setInterval(gravarAcessos,60e3);timer.unref();
  const codigos=new Map();   // código de uso único → {email, host, expira}

  // os experimentos, lidos das pastas (guardado por 5 s)
  let cache={em:0,lista:[]};
  function listar(){
    if(agora()-cache.em<5000)return cache.lista;
    const lista=[];
    for(const a of areas){
      const base=path.join(a.caminho,'playground');let pastas=[];
      try{pastas=readdirSync(base,{withFileTypes:true}).filter(d=>d.isDirectory()&&NOME.test(d.name)).map(d=>d.name);}catch{continue;}
      for(const p of pastas){
        let texto;try{texto=readFileSync(path.join(base,p,'ratoeira-play.json'),'utf8');}catch{continue;}
        const e={...lerManifesto(texto,p),area:a.id,pasta:path.join(base,p),raizArea:a.caminho};
        if(!e.erro&&e.tipo==='pagina')e.raiz=e.pastaRel?path.join(a.caminho,e.pastaRel):e.pasta;
        lista.push(e);
      }
    }
    cache={em:agora(),lista};return lista;
  }
  const base=()=>cfg.base??null;
  const limpo=host=>String(host??'').toLowerCase().replace(/:\d+$/,'');
  // o endereço é do Playground? (o endereço base ou o domínio de algum experimento)
  function ehHost(host){
    const h=limpo(host);
    if(!h||h===hostname)return false;
    return h===base()||listar().some(e=>!e.erro&&e.dominio===h);
  }
  // endereço + caminho → {e, prefixo}: no base, o primeiro pedaço do caminho é o nome; no domínio próprio, prefixo vazio
  function resolver(host,caminho){
    const h=limpo(host);
    const proprio=listar().find(e=>!e.erro&&e.dominio===h);
    if(proprio)return {e:proprio,prefixo:''};
    if(h!==base())return {e:null};
    const nome=String(caminho).split('/')[1]??'';
    const e=listar().find(x=>!x.erro&&x.nome===nome);
    return e?{e,prefixo:'/'+nome}:{e:null};
  }
  const enderecosDe=e=>[e.dominio?`https://${e.dominio}/`:null,base()?`https://${base()}/${e.nome}/`:null].filter(Boolean);

  // cookie do subdomínio: payload.assinatura, amarrado ao endereço
  const assinar=p=>createHmac('sha256',segredo).update(p).digest('base64url');
  function cookieValido(req,host){
    const v=(req.headers.cookie??'').split(';').map(x=>x.trim()).find(x=>x.startsWith(COOKIE_PLAY+'='))?.slice(COOKIE_PLAY.length+1);
    if(!v)return null;
    const [p,s]=v.split('.');if(!p||!s)return null;
    const a=Buffer.from(assinar(p)),b=Buffer.from(s);
    if(a.length!==b.length||!timingSafeEqual(a,b))return null;
    let d;try{d=JSON.parse(Buffer.from(p,'base64url').toString('utf8'));}catch{return null;}
    return d.host===host&&d.exp*1000>agora()?d:null;
  }
  function semCookiesDaRatoeira(cookie,outros){
    const fora=[COOKIE_PLAY+'=',COOKIE_SENHA+'=',...outros.map(c=>c+'=')];
    const l=String(cookie??'').split(';').map(x=>x.trim()).filter(x=>x&&!fora.some(f=>x.startsWith(f)));
    return l.length?l.join('; '):null;
  }
  function cabecalhos(req,host,email,cookiesFora,prefixo=''){
    const h={...req.headers};
    for(const n of Object.keys(h))if(n.startsWith('x-ratoeira-')||n.startsWith('cf-')||n.startsWith('x-forwarded-')||['forwarded','x-real-ip'].includes(n))delete h[n];
    const c=semCookiesDaRatoeira(h.cookie,cookiesFora);if(c)h.cookie=c;else delete h.cookie;
    h.host=host;h['x-forwarded-host']=host;h['x-forwarded-proto']='https';
    h['x-forwarded-for']=ipDe(req)||'0.0.0.0';
    if(prefixo)h['x-forwarded-prefix']=prefixo;
    if(email)h['x-ratoeira-email']=email;
    return h;
  }
  const marcar=nome=>{acessos[nome]=new Date(agora()).toISOString();acessosSujo=true;};
  const esc=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const pagina=(res,status,titulo,texto)=>{titulo=esc(titulo);res.writeHead(status,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});
    res.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${titulo}</title><body style="font:16px system-ui;max-width:34rem;margin:15vh auto;padding:0 16px;color:#222"><h1 style="font-size:1.3rem">${titulo}</h1><p>${texto}</p>`);};

  // Cookie de quem digitou a senha de um item: amarrado ao endereço, ao item e à senha (trocar a senha derruba)
  const marcaSenha=e=>e.senha.slice(0,12);
  function senhaValida(req,host,e){
    for(const x of (req.headers.cookie??'').split(';').map(x=>x.trim()).filter(x=>x.startsWith(COOKIE_SENHA+'='))){
      const [p,s]=x.slice(COOKIE_SENHA.length+1).split('.');if(!p||!s)continue;
      const a=Buffer.from(assinar(p)),b=Buffer.from(s);if(a.length!==b.length||!timingSafeEqual(a,b))continue;
      let d;try{d=JSON.parse(Buffer.from(p,'base64url').toString('utf8'));}catch{continue;}
      if(d.host===host&&d.nome===e.nome&&d.marca===marcaSenha(e)&&d.exp*1000>agora())return true;
    }
    return false;
  }
  const tentativas=new Map();   // ip|nome → {n, desde}
  function formSenha(res,e,prefixo,volta,erro=''){
    res.writeHead(erro?403:401,{'content-type':'text/html; charset=utf-8','cache-control':'no-store','x-robots-tag':'noindex, nofollow'});
    res.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta name="robots" content="noindex"><title>${esc(e.titulo)}</title>
<body style="font:16px system-ui;max-width:24rem;margin:18vh auto;padding:0 16px;color:#222"><h1 style="font-size:1.3rem">${esc(e.titulo)}</h1><p>Esta página pede senha.</p>
<form method="post" action="${esc(prefixo)}/_ratoeira/senha"><input type="hidden" name="volta" value="${esc(volta)}"><input name="senha" type="password" autofocus required autocomplete="current-password" aria-label="Senha" style="font:inherit;padding:10px;width:100%;box-sizing:border-box;border:1px solid #bbb;border-radius:8px">
${erro?`<p style="color:#b00020">${esc(erro)}</p>`:''}<button style="font:inherit;margin-top:12px;padding:10px 16px;border:0;border-radius:8px;background:#111;color:#fff">Entrar</button></form>`);
  }
  function tratarSenha(req,res,host,e,prefixo){
    let corpo='';req.setEncoding('utf8');
    req.on('data',c=>{corpo+=c;if(corpo.length>4096)req.destroy();});
    req.on('end',()=>{
      const f=new URLSearchParams(corpo),volta=f.get('volta')??'/';
      const ip=ipDe(req),k=ip+'|'+e.nome,t=tentativas.get(k);
      if(t&&agora()-t.desde<15*60e3&&t.n>=10)return formSenha(res,e,prefixo,volta,'Muitas tentativas. Espere uns minutos.');
      const dada=createHash('sha256').update(f.get('senha')??'').digest('hex');
      if(!timingSafeEqual(Buffer.from(dada),Buffer.from(e.senha))){
        tentativas.set(k,t&&agora()-t.desde<15*60e3?{...t,n:t.n+1}:{n:1,desde:agora()});
        return formSenha(res,e,prefixo,volta,'Senha errada.');
      }
      tentativas.delete(k);
      const p=Buffer.from(JSON.stringify({host,nome:e.nome,marca:marcaSenha(e),exp:Math.floor(agora()/1000)+VALIDADE_COOKIE})).toString('base64url');
      res.writeHead(303,{'location':volta.startsWith((prefixo||'')+'/')&&!volta.startsWith('//')?volta:(prefixo||'')+'/','cache-control':'no-store',
        'set-cookie':`${COOKIE_SENHA}=${p}.${assinar(p)}; Path=${prefixo||''}/; HttpOnly; Secure; SameSite=Lax; Max-Age=${VALIDADE_COOKIE}`});
      res.end();
    });
  }
  // Página: arquivo do disco, só de dentro da pasta dela (e da área), sem oculto nem o manifesto
  function servirPagina(req,res,e,url,prefixo){
    if(!['GET','HEAD'].includes(req.method)){res.writeHead(405,{allow:'GET, HEAD'});res.end();return;}
    let rel;try{rel=decodeURIComponent(url.pathname.slice(prefixo.length)||'/');}catch{return pagina(res,400,'Endereço inválido','');}
    let partes=rel.split('/').filter(Boolean);
    if(!partes.length&&e.entrada)partes=[e.entrada];
    // ao vivo: só a entrada e o que foi marcado junto, nada mais da pasta original
    if(e.modo==='aovivo'&&!(partes.length&&[e.entrada,...e.junto].includes(partes[0])))return pagina(res,404,'Não encontrado','Esse arquivo não existe nesta página.');
    if(partes.some(x=>x==='..'||x.startsWith('.')||x.includes('\\')||x.includes('\0'))||partes.at(-1)==='ratoeira-play.json')return pagina(res,404,'Não encontrado','Esse arquivo não existe nesta página.');
    let alvo=path.join(e.raiz,...partes),st;
    try{st=statSync(alvo);}catch{return pagina(res,404,'Não encontrado','Esse arquivo não existe nesta página.');}
    if(st.isDirectory()){
      if(!url.pathname.endsWith('/')){res.writeHead(301,{'location':url.pathname+'/'+url.search,'cache-control':'no-store'});res.end();return;}
      alvo=path.join(alvo,'index.html');try{st=statSync(alvo);}catch{return pagina(res,404,'Sem index.html','Esta pasta não tem um index.html.');}
    }
    // atalho que sai da área não vale
    let real;try{real=realpathSync(alvo);}catch{return pagina(res,404,'Não encontrado','');}
    const area=realpathSync(e.raizArea);
    if(!real.startsWith(area+path.sep)||!st.isFile())return pagina(res,404,'Não encontrado','Esse arquivo não existe nesta página.');
    const h={'content-type':TIPOS[path.extname(real).toLowerCase()]??'application/octet-stream','content-length':st.size,'cache-control':'no-cache','x-content-type-options':'nosniff',
      'last-modified':st.mtime.toUTCString()};
    if(!e.indexar)h['x-robots-tag']='noindex, nofollow';
    // markdown vira página (com o título do item); o resto sai como está
    if(/\.md$/i.test(real)&&st.size<=5*1024*1024){
      const corpo=marked.parse(readFileSync(real,'utf8').replace(/^---\n[\s\S]*?\n---\n/,''));
      const html=`<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(e.titulo)}</title>${e.indexar?'':'<meta name="robots" content="noindex">'}
<style>body{font:17px/1.6 system-ui,sans-serif;max-width:46rem;margin:0 auto;padding:40px 20px;color:#1d1d1b;background:#fff}img{max-width:100%}pre{overflow:auto;background:#f4f3ef;padding:12px;border-radius:8px}code{font-size:.9em}table{border-collapse:collapse}td,th{border:1px solid #ddd;padding:6px 10px}a{color:#0b57d0}@media(prefers-color-scheme:dark){body{background:#141413;color:#eee}pre{background:#222}a{color:#8ab4f8}}</style><body>${corpo}`;
      delete h['content-length'];h['content-type']='text/html; charset=utf-8';
      res.writeHead(200,h);return res.end(req.method==='HEAD'?undefined:html);
    }
    if(req.headers['if-modified-since']&&new Date(req.headers['if-modified-since'])>=new Date(st.mtime.toUTCString())){res.writeHead(304,h);res.end();return;}
    res.writeHead(200,h);
    if(req.method==='HEAD')return res.end();
    createReadStream(real).on('error',()=>res.destroy()).pipe(res);
  }

  // Pedido num endereço de experimento. Devolve true se tratou.
  // cookiesFora: os cookies da Ratoeira que não podem chegar no container (o de sessão).
  function tratar(req,res,{cookiesFora=[]}={}){
    const host=limpo(req.headers.host);
    if(!ehHost(host))return false;
    const url=new URL(req.url,'https://'+host);
    if(url.pathname==='/_ratoeira/play/voltar'){
      const c=codigos.get(url.searchParams.get('codigo')??'');codigos.delete(url.searchParams.get('codigo')??'');
      if(!c||c.host!==host||c.expira<agora())return pagina(res,400,'Link vencido','Abra o experimento de novo pela Ratoeira.'),true;
      const p=Buffer.from(JSON.stringify({email:c.email,host,exp:Math.floor(agora()/1000)+VALIDADE_COOKIE})).toString('base64url');
      const volta=url.searchParams.get('volta')??'/';
      res.writeHead(302,{'location':volta.startsWith('/')&&!volta.startsWith('//')?volta:'/','cache-control':'no-store',
        'set-cookie':`${COOKIE_PLAY}=${p}.${assinar(p)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${VALIDADE_COOKIE}`});
      res.end();return true;
    }
    const {e,prefixo}=resolver(host,url.pathname);
    if(!e)return pagina(res,404,'Nada aqui','Esse endereço não é de nenhum experimento do Playground.'),true;
    // com domínio próprio, o caminho no endereço do Playground leva pra lá
    if(prefixo&&e.dominio){res.writeHead(301,{'location':`https://${e.dominio}${url.pathname.slice(prefixo.length)||'/'}${url.search}`,'cache-control':'no-store'});res.end();return true;}
    if(prefixo&&url.pathname===prefixo){res.writeHead(301,{'location':prefixo+'/'+url.search,'cache-control':'no-store'});res.end();return true;}
    let email=null;
    if(url.pathname===prefixo+'/_ratoeira/senha'&&req.method==='POST'&&e.acesso==='senha'){tratarSenha(req,res,host,e,prefixo);return true;}
    const doTime=(()=>{const d=cookieValido(req,host);return d&&ativa(d.email)?d:null;})();
    if(e.acesso==='senha'&&!doTime&&!senhaValida(req,host,e)){
      if(['GET','HEAD'].includes(req.method))formSenha(res,e,prefixo,req.url);
      else pagina(res,401,'Senha','Esta página pede senha.');
      return true;
    }
    if(e.acesso==='time'){
      const d=doTime;
      if(!d){
        if(['GET','HEAD'].includes(req.method)){
          res.writeHead(302,{'location':`https://${hostname}/_ratoeira/play/entrar?host=${encodeURIComponent(host)}&volta=${encodeURIComponent(req.url)}`,'cache-control':'no-store'});
          res.end();return true;
        }
        pagina(res,401,'Faça login','Este experimento é só pra quem tem login na Ratoeira.');return true;
      }
      email=d.email;
    }else if(doTime)email=doTime.email;
    marcar(e.nome);
    if(e.tipo==='pagina'){servirPagina(req,res,e,url,prefixo);return true;}
    const up=request({host:'127.0.0.1',port:e.porta,path:req.url,method:req.method,headers:cabecalhos(req,host,email,cookiesFora,prefixo)},r=>{
      const h={...r.headers};delete h.connection;if(!e.indexar&&!h['x-robots-tag'])h['x-robots-tag']='noindex, nofollow';res.writeHead(r.statusCode,h);r.pipe(res);r.on('error',()=>res.destroy());
    });
    up.on('error',()=>{if(!res.headersSent)pagina(res,502,`${e.titulo} está desligado`,'Nada respondendo na porta dele. Peça no chat da Ratoeira pra ligar o experimento.');else res.destroy();});
    req.on('aborted',()=>up.destroy());req.pipe(up);
    return true;
  }
  // WebSocket num endereço de experimento (servidor de desenvolvimento com recarga, por exemplo)
  function tratarUpgrade(req,client,head,{cookiesFora=[]}={}){
    const host=limpo(req.headers.host);
    if(!ehHost(host))return false;
    const {e,prefixo}=resolver(host,req.url.split('?')[0]);
    if(!e||e.tipo==='pagina'){client.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');return true;}
    const d=cookieValido(req,host),doTime=d&&ativa(d.email)?d:null;
    if((e.acesso==='time'&&!doTime)||(e.acesso==='senha'&&!doTime&&!senhaValida(req,host,e))){client.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');return true;}
    const email=doTime?.email??null;
    marcar(e.nome);
    const h=cabecalhos(req,host,email,cookiesFora,prefixo);h.connection='Upgrade';h.upgrade=req.headers.upgrade??'websocket';
    const up=request({host:'127.0.0.1',port:e.porta,path:req.url,method:'GET',headers:h});
    up.on('upgrade',(r,remote,rhead)=>{
      if(client.destroyed){remote.destroy();return;}
      client.write(`HTTP/1.1 101 Switching Protocols\r\n`+Object.entries(r.headers).map(([k,v])=>`${k}: ${v}\r\n`).join('')+'\r\n');
      if(rhead.length)client.write(rhead);if(head.length)remote.write(head);
      client.pipe(remote);remote.pipe(client);
      client.on('error',()=>remote.destroy());remote.on('error',()=>client.destroy());
      client.on('close',()=>remote.destroy());remote.on('close',()=>client.destroy());
    });
    up.on('response',r=>{r.resume();client.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');});
    up.on('error',()=>client.destroy());client.on('error',()=>up.destroy());
    up.end();return true;
  }
  // No endereço principal, com login: emite o código e volta pro experimento
  function entrar(req,res,email){
    const url=new URL(req.url,'https://'+hostname);
    const host=limpo(url.searchParams.get('host'));
    if(!ehHost(host))return pagina(res,404,'Experimento não encontrado','Esse endereço não é de nenhum experimento do Playground desta Ratoeira.');
    const codigo=randomBytes(24).toString('base64url');
    for(const [k,v] of codigos)if(v.expira<agora())codigos.delete(k);
    codigos.set(codigo,{email,host,expira:agora()+60e3});
    const volta=url.searchParams.get('volta')??'/';
    res.writeHead(302,{'location':`https://${host}/_ratoeira/play/voltar?codigo=${codigo}&volta=${encodeURIComponent(volta.startsWith('/')&&!volta.startsWith('//')?volta:'/')}`,'cache-control':'no-store'});
    res.end();
  }
  // A lista pra tela: manifesto + o que o root viu nos containers + último acesso
  function paraTela(){
    const est=lerJson(estadoArquivo,null);
    const porNome=new Map();
    for(const c of est?.containers??[]){const l=porNome.get(c.nome)??[];l.push(c);porNome.set(c.nome,l);}
    const conhecidos=new Set();
    const itens=listar().map(e=>{
      conhecidos.add(e.nome);
      const cs=porNome.get(e.nome)??[];
      const rodando=cs.filter(c=>c.estado==='running');
      return {nome:e.nome,titulo:e.titulo??e.nome,descricao:e.descricao??'',dono:e.dono??'',area:e.area,erro:e.erro??null,publico:Boolean(e.publico),
        tipo:e.tipo??null,acesso:e.acesso??null,pasta:e.erro?null:path.relative(e.raizArea,e.raiz??e.pasta)||'.',
        // onde o item mora na Mesa: a pasta do item (playground/<nome>) e a raiz da área, pra busca e o globo da árvore
        item:path.relative(e.raizArea,e.pasta),raizArea:e.raizArea,
        origem:e.origem??null,entrada:e.entrada??null,junto:e.junto??[],modo:e.modo??null,publicadoEm:e.publicadoEm??null,publicadoPor:e.publicadoPor??null,
        mudou:e.erro?false:mudouDesde(e),
        enderecos:e.erro?[]:enderecosDe(e),porta:e.porta??null,
        estado:e.tipo==='pagina'?'pagina':!est?'desconhecido':!cs.length?'sem-container':rodando.length?'ligado':'desligado',
        containers:cs.length,memoriaMB:rodando.reduce((s,c)=>s+(c.memoriaMB??0),0)||null,cpu:rodando.reduce((s,c)=>s+(c.cpu??0),0)||null,
        ultimoAcesso:acessos[e.nome]??null,desligadoSozinho:est?.desligados?.[e.nome]??null};
    });
    // container com etiqueta mas sem pasta: aparece pra alguém limpar
    for(const [nome,cs] of porNome)if(!conhecidos.has(nome))itens.push({nome,titulo:nome,descricao:'',dono:'',area:null,erro:'Container sem pasta em playground/: apague ou crie o ratoeira-play.json.',publico:false,tipo:'programa',acesso:null,pasta:null,enderecos:[],porta:null,
      estado:cs.some(c=>c.estado==='running')?'ligado':'desligado',containers:cs.length,memoriaMB:null,cpu:null,ultimoAcesso:acessos[nome]??null,desligadoSozinho:null});
    return {base:base(),estadoEm:est?.em??null,itens};
  }
  // foto que ficou velha: o original (ou algo que foi junto) mudou depois de publicar
  const mudouCache=new Map();
  function mudouDesde(e){
    if(e.tipo!=='pagina'||e.modo!=='foto'||!e.origem||!e.publicadoEm)return false;
    const k=e.nome+'|'+e.publicadoEm,c=mudouCache.get(k);if(c&&agora()-c.em<5000)return c.v;
    const limite=Date.parse(e.publicadoEm),dir=path.dirname(path.join(e.raizArea,e.origem));let v=false,vistos=0;
    const olhar=f=>{if(v||vistos>2000)return;vistos++;let st;try{st=statSync(f);}catch{return;}
      if(st.isDirectory()){try{for(const n of readdirSync(f))if(!n.startsWith('.'))olhar(path.join(f,n));}catch{}}
      else if(st.mtimeMs>limite+1000)v=true;};
    olhar(path.join(e.raizArea,e.origem));for(const j of e.junto)olhar(path.join(dir,j));
    mudouCache.set(k,{em:agora(),v});return v;
  }
  // Pro diálogo Publicar: o arquivo, o que mora do lado dele (marcado se o HTML ou o markdown usa) e se já foi publicado
  function analisar(rel){
    const area=areas[0];
    if(!area||!relOk(rel)||!PUBLICAVEL.test(rel))throw Object.assign(new Error('Dá pra publicar HTML, PDF, imagem ou markdown.'),{status:400});
    const f=path.join(area.caminho,rel);let st;
    try{st=statSync(f);}catch{throw Object.assign(new Error('Arquivo não encontrado.'),{status:404});}
    if(!st.isFile())throw Object.assign(new Error('Não é um arquivo.'),{status:400});
    const dir=path.dirname(f),nomeArq=path.basename(f),ext=path.extname(nomeArq).toLowerCase();
    const tipo=/\.html?$/.test(ext)?'html':ext==='.md'?'md':ext==='.pdf'?'pdf':'imagem';
    // o que o arquivo referencia por caminho relativo: src/href/url() no HTML, ![](…) e [](…) no markdown
    const usados=new Set();
    if(tipo==='html'||tipo==='md'){
      const t=st.size<=20*1024*1024?readFileSync(f,'utf8'):'';
      const refs=[...t.matchAll(/(?:src|href|poster|data-src)\s*=\s*["']([^"'#?]+)/gi),...t.matchAll(/url\(\s*["']?([^"')#?]+)/gi),...t.matchAll(/!?\[[^\]]*\]\(\s*<?([^)\s>#?]+)/g),...t.matchAll(/srcset\s*=\s*["']([^"']+)/gi)]
        .flatMap(m=>m[1].split(',').map(x=>x.trim().split(/\s+/)[0]));
      for(const r of refs){
        if(!r||/^([a-z][a-z0-9+.-]*:|\/\/|\/)/i.test(r))continue;
        let n;try{n=path.posix.normalize(decodeURIComponent(r));}catch{continue;}
        if(n.startsWith('..')||n==='.')continue;
        usados.add(n.replace(/^\.\//,'').split('/')[0]);
      }
    }
    const junto=[];
    for(const d of readdirSync(dir,{withFileTypes:true})){
      if(d.name.startsWith('.')||d.name===nomeArq||d.isSymbolicLink())continue;
      const item={caminho:d.name,tipo:d.isDirectory()?'pasta':'arquivo',marcado:usados.has(d.name)};
      if(d.isDirectory()){let n=0,b=0;const contar=x=>{if(n>5000)return;for(const y of readdirSync(x,{withFileTypes:true})){if(y.name.startsWith('.'))continue;const c=path.join(x,y.name);if(y.isDirectory())contar(c);else if(y.isFile()){n++;b+=statSync(c).size;}}};try{contar(path.join(dir,d.name));}catch{}item.arquivos=n;item.tamanho=b;}
      else if(d.isFile())item.tamanho=statSync(path.join(dir,d.name)).size;
      else continue;
      junto.push(item);
    }
    junto.sort((a,b)=>Number(b.marcado)-Number(a.marcado)||a.caminho.localeCompare(b.caminho,'pt-BR'));
    // sugestão de nome: pasta + arquivo, sem acento
    const slug=t=>t.normalize('NFD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
    const nomeBase=slug(nomeArq.replace(/\.[^.]+$/,'')),generico=['index','readme','simulacao','proposta','pagina','relatorio'].includes(nomeBase);
    const naRaiz=!rel.includes('/');
    let sugestao=(naRaiz?nomeBase:generico?slug(path.basename(dir)):slug(path.basename(dir)+'-'+nomeBase)).slice(0,40).replace(/-$/,'')||'pagina';
    const usado=n=>listar().some(x=>x.nome===n);
    if(usado(sugestao)){for(let i=2;i<100;i++)if(!usado(sugestao.slice(0,37)+'-'+i)){sugestao=sugestao.slice(0,37)+'-'+i;break;}}
    const existente=listar().find(x=>!x.erro&&x.origem===rel)??null;
    return {arquivo:rel,tipo,tamanho:st.size,sugestao,junto,
      existente:existente?paraTela().itens.find(i=>i.nome===existente.nome)??null:null};
  }
  function definirBase(v){
    const p=v==null||v===''?null:String(v).trim().toLowerCase().replace(/^https?:\/\//,'').replace(/\/+$/,'');
    if(p&&!HOST.test(p))throw Object.assign(new Error('Use só o endereço, sem caminho: ex.: apps.exemplo.com'),{status:400});
    if(p&&p===hostname)throw Object.assign(new Error('O Playground precisa de um endereço diferente do da Ratoeira.'),{status:400});
    cfg={...cfg,base:p};delete cfg.padrao;gravar(arq('playground.json'),cfg);cache.em=0;return {base:p};
  }
  let ativa=()=>true;
  return {tratar,tratarUpgrade,entrar,paraTela,definirBase,listar,ehHost,analisar,
    usarContas(fn){ativa=fn;},
    fechar(){clearInterval(timer);gravarAcessos();}};
}
