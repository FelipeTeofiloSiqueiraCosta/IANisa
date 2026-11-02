import {readFile,readdir,writeFile,rename,mkdtemp,rm} from 'node:fs/promises';
import {Resolver} from 'node:dns/promises';
import {promisify} from 'node:util';
import {existsSync,readFileSync,readdirSync} from 'node:fs';
import {execFile} from 'node:child_process';
import {createHmac,randomBytes,timingSafeEqual} from 'node:crypto';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {AppCatalog,problem,readPage} from './catalog.mjs';
import {ConnectionManager,parseStatus} from './connections.mjs';
import {createCliRuntime} from './cli-runtime.mjs';
import {createAgentesRuntime} from './agentes-runtime.mjs';
import {createAcesso} from './usuarios.mjs';
import {createRepoFiles,sandboxPolicy} from './files.mjs';
import {createReportes} from './reportes.mjs';
// Fuso da máquina (o do cron): a tela de rotinas converte o horário de quem vê pra ele. Nem toda VPS fica em UTC (#239).
const fusoDaMaquina=()=>{try{return Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC';}catch{return 'UTC';}};
import {VERSAO} from './versao.mjs';
import {enviarEmail as enviarEmailPadrao} from './email.mjs';

const staticFiles=new Map([
  ['/portal/',['portal.html','text/html; charset=utf-8']],
  ['/_ratoeira/portal.css',['portal.css','text/css; charset=utf-8']],
  ['/_ratoeira/portal.js',['portal.js','application/javascript; charset=utf-8']],
  ['/_ratoeira/chat.js',['chat.js','application/javascript; charset=utf-8']],
  ['/_ratoeira/grid.js',['grid.js','application/javascript; charset=utf-8']],
  // boas-vindas da primeira vez, tour, lista "Primeiros passos" e Configurações › Endereços
  ['/_ratoeira/boas-vindas.js',['boas-vindas.js','application/javascript; charset=utf-8']],
  ['/_ratoeira/boas-vindas.css',['boas-vindas.css','text/css; charset=utf-8']],
  // ponte das aplicações com a Ratoeira (APPS.md, "Tela"): carregado pelas páginas de cada aplicação
  ['/_ratoeira/app.js',['app.js','application/javascript; charset=utf-8']],
  ['/_ratoeira/editor.js',['editor.js','application/javascript; charset=utf-8']],
  ['/_ratoeira/terminal.js',['terminal.js','application/javascript; charset=utf-8']],
  ['/_ratoeira/rastro.js',['rastro.js','application/javascript; charset=utf-8']],
  ['/_ratoeira/screenshot.js',['screenshot.js','application/javascript; charset=utf-8']],
  ['/_ratoeira/bricolage-400.ttf',['bricolage-400.ttf','font/ttf']],
  ['/_ratoeira/bricolage-800.ttf',['bricolage-800.ttf','font/ttf']],
  ['/_ratoeira/bricolage-OFL.txt',['bricolage-OFL.txt','text/plain; charset=utf-8']],
  ['/_ratoeira/geist.woff2',['geist.woff2','font/woff2']],
  ['/_ratoeira/geist-mono.woff2',['geist-mono.woff2','font/woff2']],
  ['/_ratoeira/geist-OFL.txt',['geist-OFL.txt','text/plain; charset=utf-8']],
]);
const pagePolicy="default-src 'self' https: data:; script-src 'self' 'unsafe-inline' https:; style-src 'self' 'unsafe-inline' https:; object-src 'none'; base-uri 'none'; frame-ancestors 'self'; sandbox allow-scripts allow-forms allow-downloads allow-popups";
const portalPolicy="default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-src 'self' https:; object-src 'none'; base-uri 'none'; frame-ancestors 'self'; form-action 'self'";
// O SSH aceita senha? Lê a configuração como o sshd lê (o primeiro valor vale, os Include na ordem do nome, para no
// primeiro Match), sem root: os arquivos do sshd são de leitura pra todo mundo. true = aceita, false = só chave,
// null = não deu pra ler. Passo "SSH só com chave" da tela de Segurança (receita ssh-so-chave).
export function sshSenha(arquivo='/etc/ssh/sshd_config'){
  try{
    const ler=(f,fundo=0)=>{
      if(fundo>4)return undefined;
      for(const linha of readFileSync(f,'utf8').split('\n')){
        const m=linha.trim().match(/^(\w+)\s+(.+?)\s*$/);if(!m)continue;
        const chave=m[1].toLowerCase();
        if(chave==='match')return null;
        if(chave==='passwordauthentication')return m[2].toLowerCase()!=='no';
        if(chave==='include')for(const padrao of m[2].split(/\s+/)){
          const abs=path.isAbsolute(padrao)?padrao:path.join('/etc/ssh',padrao),dir=path.dirname(abs),base=path.basename(abs);
          const re=new RegExp('^'+base.replace(/[.+^${}()|[\]\\]/g,'\\$&').replace(/\*/g,'.*').replace(/\?/g,'.')+'$');
          const nomes=base.includes('*')||base.includes('?')?(existsSync(dir)?readdirSync(dir).filter(n=>re.test(n)).sort():[]):[base];
          for(const n of nomes){const v=ler(path.join(dir,n),fundo+1);if(v!==undefined)return v;}
        }
      }
      return undefined;
    };
    const v=ler(arquivo);
    return v===undefined||v===null?true:v;   // sem nada dito, o padrão do OpenSSH é aceitar senha
  }catch{return null;}
}
function send(res,status,data,type='application/json; charset=utf-8',head=false,headers={}){
  res.writeHead(status,{'content-type':type,'cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer',...headers});
  res.end(head?undefined:(type.startsWith('application/json')&&!Buffer.isBuffer(data)?JSON.stringify(data):data));
}
async function json(req,limite=16384){
  if(!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type']??''))throw problem(415,'Envie os dados como JSON.');
  if(Number(req.headers['content-length'])>limite)throw problem(413,'O formulário excede o limite permitido.');
  const chunks=[];let size=0;
  for await(const chunk of req){size+=chunk.length;if(size>limite)throw problem(413,'O formulário excede o limite permitido.');chunks.push(chunk);}
  try{const value=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(!value||typeof value!=='object'||Array.isArray(value))throw new Error();return value;}
  catch{throw problem(400,'Dados de formulário inválidos.');}
}

// Markdown do chat empacotado (build-chat.mjs). URL leva o hash, então pode ter cache longo.
async function chatMarkdown(){
  try{return JSON.parse(await readFile(new URL('./public/markdown.json',import.meta.url),'utf8'));}catch{return null;}
}

// Cofre de chaves: confere o token da service account no próprio 1Password antes de guardar, e lê
// a conta e os vaults que ele enxerga (é o que a tela mostra). Config do op num diretório de uso único.
export async function testarCofrePadrao(token,{op='op'}={}){
  const dir=await mkdtemp(path.join(tmpdir(),'ratoeira-op-'));
  const rodar=args=>new Promise((ok,falha)=>execFile(op,args,{timeout:60000,maxBuffer:1<<20,env:{PATH:process.env.PATH??'/usr/bin:/bin',HOME:dir,OP_CONFIG_DIR:dir,OP_SERVICE_ACCOUNT_TOKEN:token}},
    (e,stdout,stderr)=>e?falha(Object.assign(e,{stderr:String(stderr)})):ok(String(stdout))));
  try{
    const vaults=JSON.parse(await rodar(['vault','list','--format','json'])).map(v=>v.name).filter(Boolean);
    let conta=null;try{conta=JSON.parse(await rodar(['whoami','--format','json'])).url??null;}catch{}
    return {vaults,conta};
  }catch(e){
    if(e.code==='ENOENT')throw problem(400,'O 1Password CLI (op) não está instalado nesta máquina. Quem administra a VPS instala uma vez (pede pro agente: "instala o 1Password CLI").');
    throw problem(400,'O 1Password recusou esse token: '+(String(e.stderr||e.message).split('\n').find(l=>l.trim())||'sem detalhe').replace(/^\[ERROR\]\s*\S+\s+\S+\s*/,'').slice(0,200));
  }finally{await rm(dir,{recursive:true,force:true}).catch(()=>{});}
}

// Ditado da organização: confere a chave no AssemblyAI antes de guardar (uma listagem vazia, que não gasta nada).
export async function testarDitadoPadrao(chave,{fetch:f=globalThis.fetch}={}){
  if(!/^[A-Za-z0-9_-]{16,128}$/.test(chave))throw problem(400,'Isso não parece uma chave do AssemblyAI.');
  let r;try{r=await f('https://api.assemblyai.com/v2/transcript?limit=1',{headers:{authorization:chave},signal:AbortSignal.timeout(15000)});}
  catch{throw problem(502,'Não consegui falar com o AssemblyAI pra testar a chave. Tenta de novo.');}
  if(r.status===401||r.status===403)throw problem(400,'O AssemblyAI recusou essa chave.');
  if(!r.ok)throw problem(502,'O AssemblyAI respondeu '+r.status+' no teste da chave. Tenta de novo.');
}

// Só com usuários do mapa (sem Paseo único) não há conta compartilhada nem CLI do gateway.
const semPaseoUnico={status:async id=>parseStatus(id,{missing:true}),launch:()=>{throw new Error('sem Paseo único');},backup:async()=>{}};

// ── Boas-vindas e Endereços ──
const NOME_DNS=/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/;
// endereço que veio com a VPS (nome da Hostinger, sslip.io, localhost) não conta como "próprio"
export const enderecoProprio=h=>Boolean(h)&&!/(^localhost(:\d+)?$)|(\.hstgr\.cloud$)|(\.sslip\.io$)|(\.nip\.io$)|(^\d+\.\d+\.\d+\.\d+$)/i.test(String(h));
async function resolverPublico(nome){
  const r=new Resolver({timeout:3000,tries:2});r.setServers(['1.1.1.1','8.8.8.8']);
  try{return (await r.resolve4(nome)).sort();}catch{return [];}
}
// IP público da VPS: o que o nome dela resolve no DNS público (na Hostinger o IP fica direto na interface, mas o
// gateway não precisa saber de interface). Guardado por 10 min.
let ipCache={em:0,ip:null,de:null};
async function ipDaVps(hostname){
  if(ipCache.de===hostname&&Date.now()-ipCache.em<600e3)return ipCache.ip;
  const ips=hostname&&!/^localhost/.test(hostname)?await resolverPublico(hostname.replace(/:\d+$/,'')):[];
  ipCache={em:Date.now(),ip:ips[0]??null,de:hostname};return ipCache.ip;
}
// A pasta de trabalho tem algo (fora os ocultos)? E tem um remoto (GitHub) pra onde ir uma cópia?
async function estadoDaPasta(pasta){
  if(!pasta)return {pastaComArquivos:false,remoto:false};
  let pastaComArquivos=false,remoto=false;
  try{pastaComArquivos=(await readdir(pasta)).some(n=>!n.startsWith('.'));}catch{}
  try{remoto=Boolean((await promisify(execFile)('git',['-c','safe.directory='+pasta,'-C',pasta,'remote'],{timeout:5000})).stdout.trim());}catch{}
  return {pastaComArquivos,remoto};
}

export function createPortal(config,{runtime=config.homeDir?createCliRuntime(config):semPaseoUnico,agentesRuntime=createAgentesRuntime,lerLog,testarCofre=token=>testarCofrePadrao(token,{op:config.cli?.op??'op'}),testarDitado=testarDitadoPadrao,enviarEmail=enviarEmailPadrao,
  pedirBackup=()=>promisify(execFile)('systemctl',['start','ratoeira-backup-tela.service'],{timeout:620000})}={}){
  const catalog=new AppCatalog(config.dataDir,config.hostname);
  // Botão "Reportar" (reportes.mjs): só aparece com portal.reportes.dir na config.
  // Cada reporte enviado leva o endereço desta Ratoeira e o e-mail de quem administra (a caixa de entrada cadastra a origem
  // com isso no primeiro). Admin: o primeiro ativo das contas; sem contas, o primeiro de adminEmails.
  const instalacao=async()=>{
    const pessoas=config.contas?await config.contas.listar():[];
    const quem=pessoas.find(p=>p.papel==='admin'&&p.estado==='ativa');
    const admin=quem?.email??(config.adminEmails??[])[0]??'';
    return {endereco:config.hostname??'',admin,nome:quem?.nome??'',pessoas:pessoas.filter(p=>p.estado==='ativa').length};
  };
  const reportes=config.reportes?createReportes(config.reportes,{...(lerLog?{lerLog}:{}),instalacao,versao:VERSAO,
    retornoArquivo:config.dataDir?path.join(config.dataDir,'reportes-retorno.json'):null,
    avisoArquivo:config.dataDir?path.join(config.dataDir,'reportes-instalacao.txt'):null}):null;
  // Pra onde vai o reporte, pro diálogo dizer antes de enviar: com enviar.nome, "vai pra {nome}"; sem envio, fica
  // guardado nesta Ratoeira; enviar sem nome (a nossa instância, caixa de entrada local) mantém o texto de sempre.
  const nomeEnvio=typeof config.reportes?.enviar?.nome==='string'?config.reportes.enviar.nome.trim().slice(0,80):'';
  const reportesDestino=!reportes?null:config.reportes.enviar?.url?{envia:true,nome:nomeEnvio||null}:{envia:false,nome:null};
  const admins=new Set((config.adminEmails??[]).map(e=>e.toLowerCase()));
  // modo senha: quem é admin, quem tem ambiente e as pessoas vêm das contas (contas.mjs)
  const contas=config.contas??null;
  const ehAdmin=email=>contas?contas.ehAdmin(email):admins.has(email);
  const fileRoutes=['/_ratoeira/arquivo/','/_ratoeira/ver/','/_ratoeira/fonte/'];
  // Passe da página isolada (20/10/2026): HTML e markdown abrem em sandbox sem allow-same-origin, e daí o Chrome
  // não manda o cookie de login nos pedidos da própria página (imagem, vídeo e script da pasta voltavam 401).
  // /ver/ de página redireciona pra /ver/~<passe>/<caminho>: os caminhos relativos herdam o passe, que libera sem
  // cookie só a leitura de mídia, fonte, CSS e JS de dentro da pasta da página, por 12 horas. O segredo é do processo:
  // reiniciou o gateway, a aba aberta pede um passe novo ao recarregar.
  const segredoPasse=randomBytes(32),PASSE_SEGUNDOS=12*3600,paginaComPasse=/\.(html?|md|markdown)$/i;
  const tiposPasse=new Set(['.png','.jpg','.jpeg','.webp','.gif','.avif','.ico','.svg','.mp4','.webm','.mov','.mp3','.m4a','.wav','.ogg','.woff','.woff2','.ttf','.otf','.css','.js','.mjs']);
  const assinarPasse=p=>createHmac('sha256',segredoPasse).update(p).digest('base64url');
  function criarPasse(email,rel){
    const d=path.posix.dirname(rel);
    const p=Buffer.from(JSON.stringify({e:email,d:d==='.'?'':d,x:Math.floor(Date.now()/1000)+PASSE_SEGUNDOS})).toString('base64url');
    return p+'.'+assinarPasse(p);
  }
  function lerPasse(pathname){
    const prefixo='/_ratoeira/ver/~';if(!pathname.startsWith(prefixo))return null;
    const resto=pathname.slice(prefixo.length),i=resto.indexOf('/');if(i<0)return null;
    const [p,sig]=resto.slice(0,i).split('.');if(!p||!sig)return null;
    const a=Buffer.from(sig),b=Buffer.from(assinarPasse(p));if(a.length!==b.length||!timingSafeEqual(a,b))return null;
    let dados,rel;try{dados=JSON.parse(Buffer.from(p,'base64url').toString('utf8'));rel=decodeURIComponent(resto.slice(i+1));}catch{return null;}
    if(typeof dados?.e!=='string'||typeof dados.d!=='string'||!(dados.x>Date.now()/1000))return null;
    return {email:dados.e,dir:dados.d,rel};
  }
  // Pedido sem cookie com passe válido: só GET/HEAD, só dentro da pasta da página, nada de ponto-arquivo nem "..",
  // só os tipos acima, e a pessoa ainda tem que ter ambiente aqui.
  function passe(req){
    if(!['GET','HEAD'].includes(req.method))return null;
    const v=lerPasse(req.url.split('?')[0]);if(!v)return null;
    const partes=v.rel.split('/');
    if(partes.some(x=>!x||x.startsWith('.')||x.includes('\\')))return null;
    if(v.dir&&!v.rel.startsWith(v.dir+'/'))return null;
    if(!tiposPasse.has(path.posix.extname(v.rel).toLowerCase()))return null;
    if(!acesso.ambiente(v.email))return null;
    return {email:v.email,exp:Math.floor(Date.now()/1000)+60};
  }
  // Quem não está no mapa de usuários usa o Paseo único: pasta, conexões e projeto da config.
  const unico={
    files:config.repoDir?createRepoFiles(config.repoDir,{syncRequestFile:config.syncRequestFile??null,syncStateFile:config.syncStateFile??null,naoVersionados:Boolean(config.naoVersionados)}):null,
    runtime,manager:new ConnectionManager({launch:runtime.launch,backup:runtime.backup,status:runtime.confirm??runtime.status}),
    pasta:config.repoDir,agentPath:config.agentPath,
  };
  // Multiusuário: cada pessoa tem a pasta dela e conecta a própria conta pelo servidor de agentes dela
  // (o Paseo por pessoa saiu em 09/10/2026; a aba Agentes só existe pra quem usa o Paseo único, o kit 0.1.0).
  // Montado na primeira visita.
  // Mesma regra do server.mjs (createAcesso): com usuários no mapa, o Paseo único (pasta e conta
  // compartilhada) só vale pra quem está em paseoCompartilhado. O resto não vê pasta nem conexão.
  const acesso=contas??config.acesso??createAcesso({});
  const semAmbiente={files:null,runtime:null,manager:null,pasta:null,agentPath:null,admin:false};
  const pessoas=new Map();
  function contexto(identity){
    const amb=acesso.ambiente(identity.email);
    if(!amb)return semAmbiente;
    if(amb.unico)return {...unico,admin:ehAdmin(identity.email)};
    const pessoa=amb.pessoa;
    // a chave inclui a pasta: mudar a área da pessoa troca a pasta de trabalho
    const chave=pessoa.user+'|'+(pessoa.repoDir??'');
    let c=pessoas.get(chave);
    if(!c){
      // Conexões pelo servidor de agentes da pessoa (config.agentesConexoes); sem ele, sem Conexões.
      const ac=config.agentesConexoes;
      const rt=ac?agentesRuntime({socketPath:ac.socket.replaceAll('{user}',pessoa.user),ligar:ac.ligar?()=>ac.ligar(pessoa.user):null}):null;
      const user=pessoa.user;
      // Na área do time, esconde as pastas restritas que essa pessoa não pode (contas.bloqueado).
      const area=contas?.areas().find(a=>a.caminho===pessoa.repoDir);
      const bloqueado=area?rel=>contas.bloqueado(identity.email,area.id,rel):()=>false;
      c={files:pessoa.repoDir?createRepoFiles(pessoa.repoDir,{naoVersionados:Boolean(config.naoVersionados),bloqueado}):null,
        runtime:rt,manager:rt?new ConnectionManager({launch:rt.launch,backup:rt.backup,status:rt.confirm,aoConcluir:provider=>{if(provider==='claude')config.aoContaPropria?.(user);},
          // conta pessoal por token de 1 ano: o gateway só repassa o token pro servidor de agentes da pessoa guardar
          aoToken:(t,flow)=>rt.adicionarPessoal(flow.nome,t),msgToken:'Conta adicionada. Escolha ela no seletor do chat ou aqui.'}):null,
        pasta:pessoa.repoDir,agentPath:null,admin:true};
      pessoas.set(chave,c);
    }
    return c;
  }
  // Conta geral do Claude (modo senha): o admin gera o token pelo fluxo oficial (setup-token),
  // rodado pelo CLI do próprio gateway (portal.cli.claude + portal.homeDir), ou cola o token.
  const podeGerarGeral=Boolean(contas&&config.homeDir&&config.cli?.claude);
  const geral=contas?new ConnectionManager({launch:runtime.launch,status:async()=>({}),aoToken:(t,flow)=>contas.adicionarClaudeConta({nome:flow.nome,token:t}),
    msgToken:'Conta adicionada. Quem pode usar já vê ela no seletor do chat.'}):null;
  // Contas do Codex da organização: login do ChatGPT pelo código de dispositivo, rodado pelo CLI do gateway num
  // CODEX_HOME só dele (cli-runtime.mjs); o root instala cada auth.json numa pasta que quem pode usar lê e grava.
  const podeGerarCodex=Boolean(contas&&config.homeDir&&config.cli?.codex&&runtime.lerCodexGeral);
  const codexGeral=podeGerarCodex?new ConnectionManager({launch:runtime.launch,status:async()=>({}),aoCodexGeral:async flow=>contas.adicionarCodexConta(await runtime.lerCodexGeral(),{nome:flow?.nome,id:flow?.id})}):null;
  // O chat fala com o servidor de agentes da pessoa (ACP, /api/agentes/ws): sem ele configurado, não tem chat.
  // padrao: modelo, esforço e modo que o admin escolheu pra todo mundo; minhas: o que a pessoa sobrescreveu.
  async function chatInfo(ctx,email){const meta=await chatMarkdown();return meta&&ctx.files&&config.agentes?{markdown:'/_ratoeira/markdown.js?v='+meta.hash,agentes:'/api/agentes/ws',pastaPadrao:ctx.pasta,
    ...(contas?{padrao:contas.chatPadrao(),minhas:contas.chatEscolhas(email),podeDefinirPadrao:ehAdmin(email)}:{})}:null;}
  // Inventário do ajudante de root, só pro admin: automações de cada pessoa (com o último resultado), crons e
  // timers da VPS, MCPs de cada um. Vem com nome e e-mail de cada usuário Linux, quando é uma pessoa da Ratoeira.
  let ultimoAplicar=0;
  async function automacoesInfo(identity,parte){
    const admin=ehAdmin(identity.email),meu=acesso.ambiente(identity.email)?.pessoa?.user??null;
    const base={admin,configurado:Boolean(config.automacoes),meuUsuario:meu};
    if(!admin||!config.automacoes)return base;
    let inv;try{inv=JSON.parse(await readFile(config.automacoes.inventario,'utf8'));}catch{return {...base,erro:'O inventário ainda não foi montado (ratoeira-automacoes.timer).'};}
    const gente=contas?await contas.listar():[];
    const quem=u=>{const p=gente.find(x=>x.ambiente?.user===u);return p?{nome:p.nome,email:p.email}:{};};
    const pessoas=(inv.pessoas??[]).map(p=>({...p,...quem(p.usuario)}));
    if(parte==='integracoes')return {...base,geradoEm:inv.geradoEm,pessoas:pessoas.map(({usuario,nome,email,mcps})=>({usuario,nome,email,mcps}))};
    return {...base,geradoEm:inv.geradoEm,pessoas:pessoas.map(({mcps,...p})=>p),sistema:inv.sistema??[],timers:inv.timers??[]};
  }
  return {
    reportes,passe,
    close:()=>{unico.manager.close();geral?.close();codexGeral?.close();for(const c of pessoas.values())c.manager?.close();},
    async handle(req,res,identity){
      const pathname=req.url.split('?')[0];const readOnly=['GET','HEAD'].includes(req.method);
      const asset=staticFiles.get(pathname);
      const fileRoute=fileRoutes.find(prefix=>pathname.startsWith(prefix));
      if(pathname!=='/portal'&&pathname!=='/_ratoeira/markdown.js'&&!asset&&!fileRoute&&!pathname.startsWith('/_ratoeira/api/')&&!pathname.startsWith('/_ratoeira/pages/'))return false;
      try{
        if(pathname==='/portal'&&readOnly){res.writeHead(302,{location:'/portal/','cache-control':'no-store'});res.end();return true;}
        if(pathname==='/_ratoeira/markdown.js'&&readOnly){
          const gzip=/\bgzip\b/.test(req.headers['accept-encoding']??'');
          const body=await readFile(new URL('./public/markdown.js'+(gzip?'.gz':''),import.meta.url)).catch(()=>{throw problem(404,'Chat não empacotado. Rode npm run build:chat.');});
          send(res,200,body,'application/javascript; charset=utf-8',req.method==='HEAD',{'cache-control':'private, max-age=604800, immutable','vary':'accept-encoding',...(gzip?{'content-encoding':'gzip'}:{})});return true;
        }
        if(asset&&readOnly){send(res,200,await readFile(new URL('./public/'+asset[0],import.meta.url)),asset[1],req.method==='HEAD',{'content-security-policy':portalPolicy});return true;}
        if(pathname.startsWith('/_ratoeira/pages/')&&readOnly){
          let relative;try{relative=decodeURIComponent(pathname.slice('/_ratoeira/pages/'.length));}catch{throw problem(404,'Página não encontrada.');}
          const page=await readPage(config.pagesDir,relative);send(res,200,page.body,page.type,req.method==='HEAD',{'content-security-policy':pagePolicy});return true;
        }
        const {files,runtime,manager,admin}=contexto(identity);
        if(fileRoute&&readOnly){
          if(!files)throw problem(404,'Arquivos não configurados.');
          let relative;try{relative=decodeURIComponent(pathname.slice(fileRoute.length));}catch{throw problem(404,'Arquivo não encontrado.');}
          if(fileRoute==='/_ratoeira/ver/'){
            const comPasse=lerPasse(pathname);
            if(comPasse)relative=comPasse.rel;
            else if(paginaComPasse.test(relative)){
              const q=req.url.indexOf('?');
              res.writeHead(302,{location:'/_ratoeira/ver/~'+criarPasse(identity.email,relative)+'/'+pathname.slice(fileRoute.length)+(q<0?'':req.url.slice(q)),'cache-control':'no-store','referrer-policy':'no-referrer'});res.end();return true;
            }
          }
          const head=req.method==='HEAD',params=new URL(req.url,'http://x').searchParams;
          // /ver/ mostra renderizado: md vira página; o resto sai como é (HTML, PDF, imagem e os assets relativos deles).
          if(fileRoute==='/_ratoeira/fonte/'){send(res,200,await files.renderFonte(relative),'text/html; charset=utf-8',head,{'content-security-policy':sandboxPolicy});return true;}
          if(fileRoute==='/_ratoeira/ver/'&&/\.(md|markdown)$/i.test(relative)){send(res,200,await files.renderMarkdown(relative),'text/html; charset=utf-8',head,{'content-security-policy':sandboxPolicy,'referrer-policy':'no-referrer'});return true;}
          await files.servir(res,relative,{head,baixar:params.has('baixar')});return true;
        }
        const route=pathname.slice('/_ratoeira/api'.length);
        const canManageConnections=admin;
        if(route==='/portal'&&req.method==='GET'){
          const ctx=contexto(identity);
          const nome=contas?(await contas.listar()).find(p=>p.email===identity.email)?.nome:null;
          send(res,200,{user:{email:identity.email,name:nome||identity.email.split('@')[0],canManageConnections,...(acesso.ambiente(identity.email)?.pessoa?{ownAccount:true,claudeModo:(await contas?.listar())?.find(p=>p.email===identity.email)?.ambiente?.claude??null,codexModo:(await contas?.listar())?.find(p=>p.email===identity.email)?.ambiente?.codex??null}:{}),...(contas?{isAdmin:ehAdmin(identity.email),signOut:'/_ratoeira/sair'}:{})},agentPath:ctx.agentPath??null,agents:Boolean(ctx.agentPath),areas:contas?.areasDe(identity.email)??null,apps:await catalog.list(),systemApps:config.systemApps??[],podePublicar:Boolean(config.publicador)&&ehAdmin(identity.email),reportes:Boolean(reportes),reportesDestino,meusReportes:Boolean(reportes?.temRetorno),atualizacoes:Boolean(config.atualizacoes)&&ehAdmin(identity.email),modo:config.modo??'confianca',playground:Boolean(config.playground),version:VERSAO,fuso:fusoDaMaquina(),pagesDirectory:config.pagesDir,files:Boolean(files),chat:await chatInfo(ctx,identity.email)});return true;
        }
        if(route==='/arquivos/arvore'&&req.method==='GET'){if(!files)throw problem(404,'Arquivos não configurados.');const q=new URL(req.url,'http://x').searchParams;send(res,200,await files.listar(q.get('caminho'),{subpastas:q.get('subpastas')==='1',fresco:q.get('fresco')==='1'}));return true;}
        if(route==='/arquivos/historico'&&req.method==='GET'){if(!files)throw problem(404,'Arquivos não configurados.');send(res,200,await files.historico(new URL(req.url,'http://x').searchParams.get('caminho')));return true;}
        if((route==='/arquivos/mudanca'||route==='/arquivos/versao')&&req.method==='GET'){if(!files)throw problem(404,'Arquivos não configurados.');const q=new URL(req.url,'http://x').searchParams;send(res,200,await files[route.slice(10)](q.get('caminho'),q.get('commit')));return true;}
        // ── Automações e integrações: o que é da própria pessoa vem do servidor de agentes dela (chat.js);
        // daqui sai o inventário de todo mundo (só admin), montado pelo ajudante de root (ratoeira-automacoes).
        // Publicar app (publicar.mjs, docs/2026-10-09-publicar-app-sem-sudo.md): só admin, nesta fase
        if(route==='/publicar'||route.startsWith('/publicar/')){
          if(!config.publicador)throw problem(404,'Publicar app não está ligado nesta Ratoeira.');
          if(!ehAdmin(identity.email))throw problem(403,'Só quem administra publica app, por enquanto.');
          if(route==='/publicar'&&req.method==='GET'){send(res,200,{apps:await config.publicador.listar()});return true;}
          if(route==='/publicar'&&req.method==='POST'){const b=await json(req);send(res,202,await config.publicador.publicar({area:String(b.area??''),nome:String(b.nome??'')},identity.email));return true;}
          const pm=route.match(/^\/publicar\/([a-z][a-z0-9-]{1,30})$/);
          if(pm&&req.method==='GET'){send(res,200,{estado:await config.publicador.estado(pm[1])});return true;}
        }
        // Atualizações (atualizacoes.mjs): só nas instalações (config "atualizar") e só admin. O POST grava o pedido e
        // liga o atualizador sem esperar; a tela consulta o GET até o pedido sumir (o gateway reinicia no meio).
        if(route==='/atualizacoes'){
          if(!config.atualizacoes)throw problem(404,'Atualizações não existem nesta Ratoeira.');
          if(!ehAdmin(identity.email))throw problem(403,'Só quem administra a Ratoeira mexe nas atualizações.');
          if(req.method==='GET'){send(res,200,await config.atualizacoes.estado());return true;}
          if(req.method==='POST'){const b=await json(req);await config.atualizacoes.pedir({acao:b.acao,versao:b.versao},identity.email);send(res,202,await config.atualizacoes.estado());return true;}
        }
        if(route==='/automacoes'&&req.method==='GET'){send(res,200,await automacoesInfo(identity,'automacoes'));return true;}
        if(route==='/integracoes'&&req.method==='GET'){send(res,200,await automacoesInfo(identity,'integracoes'));return true;}
        if(route==='/automacoes/aplicar'&&req.method==='POST'){
          await json(req);if(!config.automacoes)throw problem(404,'Automações não configuradas.');
          if(!acesso.ambiente(identity.email)?.pessoa)throw problem(403,'Tua conta não tem ambiente nesta Ratoeira.');
          if(Date.now()-ultimoAplicar>3000){ultimoAplicar=Date.now();await config.automacoes.aplicar();}
          send(res,200,{ok:true});return true;
        }
        if(route==='/automacoes/alternar'&&req.method==='POST'){
          const b=await json(req);if(!config.automacoes)throw problem(404,'Automações não configuradas.');
          if(!ehAdmin(identity.email))throw problem(403,'Só quem administra liga ou desliga automação de outra pessoa.');
          // rotina (pelo id do arquivo) ou automação (pela linha, conferindo o texto que a tela viu)
          const rotina=b.rotina!=null;
          if(!/^[a-z_][a-z0-9_-]{0,31}$/.test(String(b.usuario))||typeof b.ligar!=='boolean'
            ||(rotina?!/^[a-z0-9][a-z0-9-]{0,59}$/.test(String(b.rotina)):(!Number.isInteger(b.linha)||typeof b.texto!=='string')))throw problem(400,'Pedido inválido.');
          const pedido=rotina?{usuario:b.usuario,rotina:b.rotina,ligar:b.ligar}:{usuario:b.usuario,linha:b.linha,texto:b.texto,ligar:b.ligar};
          await writeFile(config.automacoes.pedido+'.tmp',JSON.stringify(pedido),{mode:0o600});
          await rename(config.automacoes.pedido+'.tmp',config.automacoes.pedido);
          await config.automacoes.aplicar();
          let r={ok:false,erro:'Sem resposta do ajudante.'};try{r=JSON.parse(await readFile(config.automacoes.resultado,'utf8'));}catch{}
          if(!r.ok)throw problem(409,r.erro||'Não consegui mudar.');
          send(res,200,await automacoesInfo(identity,'automacoes'));return true;
        }
        if(route==='/registros'&&req.method==='GET'){if(!files)throw problem(404,'Arquivos não configurados.');send(res,200,await files.registros());return true;}
        if(route==='/habilidades'&&req.method==='GET'){if(!files)throw problem(404,'Arquivos não configurados.');send(res,200,{itens:await files.habilidades()});return true;}
        if(route==='/arquivos/busca'&&req.method==='GET'){if(!files)throw problem(404,'Arquivos não configurados.');send(res,200,await files.buscar(new URL(req.url,'http://x').searchParams.get('q')));return true;}
        if(route==='/arquivos/estado'&&req.method==='GET'){if(!files)throw problem(404,'Arquivos não configurados.');
          // as pastas abertas na árvore, uma por linha: a versão acompanha a data delas (files.mjs, estado)
          const ab=new URL(req.url,'http://x').searchParams.get('abertas');
          send(res,200,await files.estado({abertas:ab?ab.split('\n').slice(0,60):[]}));return true;}
        if(route==='/arquivos/sincronizar'&&req.method==='POST'){if(!files)throw problem(404,'Arquivos não configurados.');await json(req);send(res,202,await files.pedirSync());return true;}
        if(route==='/reportes/meus'&&req.method==='GET'){if(!reportes)throw problem(404,'Reportes não configurados nesta Ratoeira.');send(res,200,await reportes.meus(identity.email));return true;}
        if(route==='/reportes'&&req.method==='POST'){
          if(!reportes)throw problem(404,'Reportes não configurados nesta Ratoeira.');
          // o print vem junto, em base64: limite maior que o dos outros formulários
          const user=acesso.ambiente(identity.email)?.pessoa?.user??null;
          send(res,201,await reportes.salvar(identity,await json(req,12*1024*1024),{user,versao:VERSAO}));return true;
        }
        if(route==='/apps'&&req.method==='POST'){send(res,201,await catalog.add(await json(req)));return true;}
        const appMatch=route.match(/^\/apps\/([a-zA-Z0-9-]{1,80})$/);
        if(appMatch&&req.method==='DELETE'){
          await json(req);
          send(res,200,await catalog.remove(appMatch[1]));return true;
        }
        // Cofre de chaves (1Password): todo mundo vê se está ligado e quais vaults; só admin conecta e desconecta.
        if(route.startsWith('/cofre')){
          if(!contas)throw problem(404,'Esta Ratoeira não usa login próprio.');
          const admin=ehAdmin(identity.email);
          if(route==='/cofre'&&req.method==='GET'){send(res,200,{...contas.cofre(),podeConfigurar:admin,temAmbiente:Boolean(acesso.ambiente(identity.email)?.pessoa)});return true;}
          if(req.method==='POST'){
            const body=await json(req);
            if(!admin)throw problem(403,'Só quem administra a Ratoeira conecta o cofre de chaves.');
            if(route==='/cofre/token'){const t=String(body.token??'').trim();if(!/^ops_/.test(t))throw problem(400,'Token inválido: é o da service account do 1Password, que começa com ops_.');
              send(res,200,await contas.definirCofre(t,await testarCofre(t)));return true;}
            if(route==='/cofre/remover'){send(res,200,await contas.removerCofre());return true;}
          }
        }
        // Contas do Claude da organização (várias desde 10/10/2026): o admin gera o token pelo fluxo oficial
        // (setup-token, rodado pelo CLI do próprio gateway) ou cola, dá nome e escolhe quem pode usar.
        // Ditado do chat (Configurações › Organização › Ditado), só admin: a chave do AssemblyAI vale pra todo mundo e
        // nunca volta pra tela. Sem ela, o ditado usa o motor da VPS (receita ditado-local), se estiver instalado.
        if(route.startsWith('/ditado')){
          if(!contas)throw problem(404,'Esta Ratoeira não usa login próprio.');
          if(!ehAdmin(identity.email))throw problem(403,'Só quem administra a Ratoeira mexe no ditado da organização.');
          const local=()=>existsSync(config.ditadoSocket??'/run/ratoeira-ditado/ditado.sock');
          if(route==='/ditado'&&req.method==='GET'){send(res,200,{...contas.ditado(),local:local()});return true;}
          if(req.method==='POST'){
            const body=await json(req);
            if(route==='/ditado/chave'){const c=String(body.chave??'').trim();await testarDitado(c);send(res,200,{...await contas.definirDitado(c),local:local()});return true;}
            if(route==='/ditado/remover'){send(res,200,{...await contas.removerDitado(),local:local()});return true;}
          }
          throw problem(404,'Recurso não encontrado.');
        }
        if(route.startsWith('/claude-contas')){
          if(!contas)throw problem(404,'Esta Ratoeira não usa login próprio.');
          if(!ehAdmin(identity.email))throw problem(403,'Só quem administra a Ratoeira mexe nas contas da organização.');
          if(route==='/claude-contas'&&req.method==='GET'){send(res,200,{contas:contas.claudeContas(),podeGerar:podeGerarGeral,flow:geral.current(identity.email)});return true;}
          if(req.method==='POST'){
            const body=await json(req);
            if(route==='/claude-contas/start'){if(!podeGerarGeral)throw problem(400,'Esta instalação não tem o CLI do Claude pro gateway. Cole o token.');send(res,202,await geral.start('claude-token',identity.email,{nome:String(body.nome??'').slice(0,60)}));return true;}
            if(route==='/claude-contas/token'){send(res,200,{contas:await contas.adicionarClaudeConta({nome:body.nome,token:body.token,pessoas:body.pessoas??null})});return true;}
            const c=route.match(/^\/claude-contas\/([a-z0-9]{1,20})\/(editar|remover)$/);
            if(c){send(res,200,{contas:c[2]==='editar'?await contas.editarClaudeConta(c[1],{nome:body.nome,pessoas:body.pessoas}):await contas.removerClaudeConta(c[1])});return true;}
            const f=route.match(/^\/claude-contas\/flow\/([a-zA-Z0-9-]{1,80})\/(code|cancel)$/);
            if(f){send(res,200,f[2]==='code'?geral.submit(f[1],identity.email,body.code):geral.cancel(f[1],identity.email));return true;}
          }
          throw problem(404,'Recurso não encontrado.');
        }
        if(route==='/chat/padrao'&&req.method==='POST'){
          if(!contas)throw problem(404,'Esta Ratoeira não usa login próprio.');
          if(!ehAdmin(identity.email))throw problem(403,'Só quem administra a Ratoeira define o padrão de todo mundo.');
          send(res,200,await contas.definirChatPadrao(await json(req)));return true;
        }
        // Boas-vindas (docs/2026-10-17-boas-vindas.md): se mostra, o que a pessoa já marcou e o que a lista
        // "Primeiros passos" confere sozinha (pasta com arquivos, GitHub ligado, gente no time, endereço próprio)
        if(route==='/boas-vindas'&&req.method==='GET'){
          const bv=contas?await contas.boasVindas(identity.email):null;
          if(!bv){send(res,200,{mostrar:false,lista:false,marcados:[]});return true;}
          const ctx=contexto(identity),admin=ehAdmin(identity.email);
          send(res,200,{...bv,admin,pasta:ctx.pasta??null,usuario:acesso.ambiente(identity.email)?.pessoa?.user??null,estado:{...(await estadoDaPasta(ctx.pasta)),...(admin?{pessoas:(await contas.listar()).filter(p=>p.estado!=='desativada').length,
            endereco:config.hostname??null,enderecoProprio:enderecoProprio(config.hostname)}:{})}});return true;
        }
        if(route==='/boas-vindas'&&req.method==='POST'){
          if(!contas)throw problem(404,'Esta Ratoeira não usa login próprio.');
          const b=await json(req);send(res,200,await contas.definirBoasVindas(identity.email,{acao:String(b.acao??''),item:b.item==null?undefined:String(b.item)}));return true;
        }
        // Configurações › Endereços (só admin): o endereço da Ratoeira e o dos Publicados, o IP desta VPS e a
        // conferência do DNS de um nome novo (pelo DNS público: o /etc/hosts da Hostinger engana)
        if(route==='/enderecos'||route==='/enderecos/conferir'){
          if(!ehAdmin(identity.email))throw problem(403,'Só quem administra a Ratoeira mexe nos endereços.');
          const ip=await ipDaVps(config.hostname);
          if(route==='/enderecos'&&req.method==='GET'){
            let publicados=null;try{publicados=JSON.parse(await readFile(path.join(config.dataDir,'playground.json'),'utf8')).base??null;}catch{}
            send(res,200,{ratoeira:config.hostname??null,ratoeiraProprio:enderecoProprio(config.hostname),publicados,publicadosProprio:enderecoProprio(publicados),ip});return true;
          }
          if(route==='/enderecos/conferir'&&req.method==='GET'){
            const nome=String(new URL(req.url,'http://x').searchParams.get('nome')??'').trim().toLowerCase().replace(/\.$/,'');
            if(!NOME_DNS.test(nome))throw problem(400,'Escreve só o endereço, sem https:// nem caminho (ex.: ratoeira.seudominio.com.br).');
            const ips=await resolverPublico(nome);
            send(res,200,{nome,ips,ip,aponta:Boolean(ip)&&ips.includes(ip)});return true;
          }
        }
        // trocar a área aberta na Mesa (só preferência: a pasta de trabalho muda, a permissão não)
        if(route==='/area'&&req.method==='POST'){
          if(!contas)throw problem(404,'Esta Ratoeira não usa login próprio.');
          const b=await json(req);if(typeof b?.id!=='string')throw problem(400,'Área inválida.');
          send(res,200,await contas.abrirArea(identity.email,b.id));return true;
        }
        if(route==='/chat/minhas'&&req.method==='POST'){
          if(!contas)throw problem(404,'Esta Ratoeira não usa login próprio.');
          send(res,200,await contas.definirChatEscolhas(identity.email,await json(req)));return true;
        }
        // contas do Codex da organização (várias desde 28/10/2026; era /codex-geral, uma só)
        if(route.startsWith('/codex-contas')){
          if(!contas)throw problem(404,'Esta Ratoeira não usa login próprio.');
          if(!ehAdmin(identity.email))throw problem(403,'Só quem administra a Ratoeira mexe nas contas da organização.');
          if(route==='/codex-contas'&&req.method==='GET'){send(res,200,{contas:contas.codexContas(),podeGerar:podeGerarCodex,flow:codexGeral?.current(identity.email)??null});return true;}
          if(req.method==='POST'){
            const body=await json(req);
            if(route==='/codex-contas/start'){if(!codexGeral)throw problem(400,'Esta instalação não tem o CLI do Codex pro gateway.');
              const id=String(body.id??'');send(res,202,await codexGeral.start('codex-geral',identity.email,{nome:String(body.nome??'').slice(0,60),...(/^[a-z0-9]{1,20}$/.test(id)?{id}:{})}));return true;}
            const c=route.match(/^\/codex-contas\/([a-z0-9]{1,20})\/(editar|remover)$/);
            if(c){send(res,200,{contas:c[2]==='editar'?await contas.editarCodexConta(c[1],{nome:body.nome,pessoas:body.pessoas}):await contas.removerCodexConta(c[1])});return true;}
            const f=route.match(/^\/codex-contas\/flow\/([a-zA-Z0-9-]{1,80})\/cancel$/);
            if(f&&codexGeral){send(res,200,codexGeral.cancel(f[1],identity.email));return true;}
          }
          throw problem(404,'Recurso não encontrado.');
        }
        // Backup fora da VPS (Segurança › Esta VPS, só admin): quem faz é o root (kit/backup, `ratoeira-backup tela`,
        // pela regra do polkit). A tela grava o pedido, liga o serviço e lê o estado sem segredo que ele deixa. A senha do
        // backup nasce aqui, vai no pedido e aparece uma vez pra quem configurou.
        if(route==='/backup'){
          if(!ehAdmin(identity.email))throw problem(403,'Só quem administra a Ratoeira mexe no backup.');
          const arqEstado=config.backup?.estado??'/var/lib/ratoeira/backup/estado.json',arqPedido=config.backup?.pedido??path.join(config.dataDir??'.','backup-pedido.json');
          const disponivel=config.backup?.disponivel??existsSync('/etc/systemd/system/ratoeira-backup-tela.service');
          const ler=async()=>{try{return JSON.parse(await readFile(arqEstado,'utf8'));}catch{return null;}};
          if(req.method==='GET'){send(res,200,{disponivel,estado:await ler()});return true;}
          if(req.method==='POST'){
            if(!disponivel)throw problem(409,'Esta Ratoeira ainda não tem o backup pela tela. Atualize a Ratoeira.');
            const b=await json(req),acao=String(b.acao??'');
            if(!['configurar','agora','ligar','desligar'].includes(acao))throw problem(400,'Pedido inválido.');
            const pedido={acao};let senha=null;
            if(acao==='configurar'){
              const d=b.destino??{},campo=k=>String(d[k]??'').trim().slice(0,400);
              pedido.destino={endpoint:campo('endpoint'),bucket:campo('bucket'),prefixo:campo('prefixo'),regiao:campo('regiao'),chave_id:campo('chave_id'),segredo:campo('segredo')};
              senha=randomBytes(24).toString('base64url');pedido.senha=senha;
            }
            const antes=new Date().toISOString().slice(0,19);
            const tmp=arqPedido+'.'+randomBytes(4).toString('hex');
            await writeFile(tmp,JSON.stringify(pedido),{mode:0o600,flag:'wx'});await rename(tmp,arqPedido);
            try{await pedirBackup();}catch{}
            const est=await ler(),r=est?.pedido;
            if(!r||r.acao!==acao||String(r.em??'').slice(0,19)<antes)throw problem(502,'O backup não respondeu. Tente de novo em um minuto.');
            if(!r.ok)throw problem(400,r.erro||'Não deu certo.');
            send(res,200,{disponivel,estado:est,...(senha?{senha}:{})});return true;
          }
        }
        // E-mail da Ratoeira (Organização › E-mail, só admin): o do próprio aluno (Resend ou SMTP). Salvar manda antes
        // um e-mail de teste pra quem está salvando: só grava se chegou no servidor de e-mail.
        if(route.startsWith('/email')){
          if(!contas)throw problem(404,'Esta Ratoeira não usa login próprio.');
          if(!ehAdmin(identity.email))throw problem(403,'Só quem administra a Ratoeira mexe no e-mail.');
          if(route==='/email'&&req.method==='GET'){send(res,200,contas.email());return true;}
          if(req.method==='POST'){
            const b=await json(req);
            if(route==='/email'){
              const cfg=contas.validarEmail(b);
              await enviarEmail(cfg,{para:identity.email,assunto:'Teste do e-mail da Ratoeira',texto:'Deu certo: a Ratoeira'+(config.hostname?' ('+config.hostname+')':'')+' consegue mandar e-mail por aqui.\n'});
              send(res,200,await contas.definirEmail(cfg));return true;
            }
            if(route==='/email/remover'){send(res,200,await contas.removerEmail());return true;}
            if(route==='/email/esqueci'){send(res,200,await contas.definirEsqueci(b.ligar));return true;}
          }
          throw problem(404,'Recurso não encontrado.');
        }
        // Verificação em dois passos (Tua conta) e Organização › Segurança (exigir de todo mundo). Desligar e trocar os
        // códigos de reserva pedem um código, como prova de que é a pessoa e não só uma sessão aberta.
        if(route.startsWith('/dois-passos')||route==='/seguranca'){
          if(!contas)throw problem(404,'Esta Ratoeira não usa login próprio.');
          if(route==='/dois-passos'&&req.method==='GET'){send(res,200,contas.doisPassos(identity.email));return true;}
          if(route==='/seguranca'&&req.method==='GET'){send(res,200,{...contas.seguranca(),...(ehAdmin(identity.email)?{ssh:sshSenha(config.sshdConfig)}:{})});return true;}
          if(req.method==='POST'){
            const b=await json(req),codigo=String(b.codigo??'');
            if(route==='/dois-passos/comecar'){send(res,200,await contas.comecarDois(identity.email));return true;}
            if(route==='/dois-passos/confirmar'){send(res,200,await contas.confirmarDois(identity.email,codigo));return true;}
            if(route==='/dois-passos/reservas'){send(res,200,await contas.novasReservas(identity.email,codigo));return true;}
            if(route==='/dois-passos/desligar'){send(res,200,await contas.desligarDois(identity.email,codigo));return true;}
            if(route==='/seguranca'){
              if(!ehAdmin(identity.email))throw problem(403,'Só quem administra a Ratoeira mexe na segurança da organização.');
              send(res,200,{...await contas.definirSeguranca({exigirDois:b.exigirDois,portaDosFundos:b.portaDosFundos},identity.email),ssh:sshSenha(config.sshdConfig)});return true;
            }
          }
          throw problem(404,'Recurso não encontrado.');
        }
        if(route.startsWith('/pessoas')){
          if(!contas)throw problem(404,'Esta Ratoeira não usa login próprio.');
          if(!ehAdmin(identity.email))throw problem(403,'Só quem administra a Ratoeira vê as pessoas.');
          const link=token=>'/_ratoeira/link/'+token;
          if(route==='/pessoas'&&req.method==='GET'){send(res,200,{claudePadrao:config.claudePadrao??'propria',codexPadrao:config.codexPadrao??'propria',codexGeral:contas.codexContas().length>0,pessoas:await contas.listar(),apps:config.appsPapeis??[],criaAmbiente:Boolean(config.criaAmbiente),areas:contas.areas(),restritas:await contas.listarRestritas()});return true;}
          if(route==='/pessoas/restritas'&&req.method==='POST'){const b=await json(req);send(res,200,await contas.restringir(b.area,b.pasta,b.pessoas));return true;}
          if(route==='/pessoas/restritas/liberar'&&req.method==='POST'){const b=await json(req);send(res,200,await contas.liberarPasta(b.area,b.pasta));return true;}
          if(route==='/pessoas'&&req.method==='POST'){const r=await contas.convidar(await json(req));send(res,201,{pessoa:r.pessoa,link:link(r.token)});return true;}
          const m=route.match(/^\/pessoas\/([^/]{3,260})\/(editar|desativar|reativar|link|zerar-dois)$/);
          if(m&&req.method==='POST'){
            let email;try{email=decodeURIComponent(m[1]).toLowerCase();}catch{throw problem(404,'Pessoa não encontrada.');}
            const body=await json(req);
            if(m[2]==='editar'){send(res,200,await contas.editar(email,{papel:body.papel,apps:body.apps,nome:body.nome,areas:body.areas,claude:body.claude,codex:body.codex,darAmbiente:body.darAmbiente},identity.email));return true;}
            if(m[2]==='desativar'){send(res,200,await contas.desativar(email,identity.email));return true;}
            if(m[2]==='reativar'){send(res,200,await contas.reativar(email));return true;}
            if(m[2]==='zerar-dois'){send(res,200,await contas.zerarDois(email));return true;}
            const r=await contas.gerarLink(email,{zerarDois:body.zerarDois===true});send(res,200,{tipo:r.tipo,expira:r.expira,link:link(r.token)});return true;
          }
          throw problem(404,'Recurso não encontrado.');
        }
        if(route.startsWith('/connections')&&!manager)throw problem(403,'Seu e-mail ainda não tem um ambiente nesta Ratoeira. Fale com quem administra.');
        if(route==='/connections'&&req.method==='GET'){send(res,200,{providers:await Promise.all(['claude','codex'].map(id=>runtime.status(id)))});return true;}
        if(route==='/connections/flow'&&req.method==='GET'){send(res,200,{flow:manager.current(identity.email)});return true;}
        const lc=route.match(/^\/connections\/(claude|codex)\/contas$/);
        if(lc&&req.method==='GET'){if(!runtime.contas)throw problem(404,'Esta Ratoeira não tem várias contas.');send(res,200,await runtime.contas(lc[1]));return true;}
        if(route.startsWith('/connections/')&&req.method==='POST'){
          if(!canManageConnections)throw problem(403,'Somente o administrador pode alterar as contas compartilhadas.');
          const body=await json(req);
          // várias contas do Claude da própria pessoa (servidor de agentes dela)
          const us=route.match(/^\/connections\/(claude|codex)\/usar$/);
          if(us){if(!runtime.usar)throw problem(404,'Esta Ratoeira não tem várias contas.');send(res,200,await runtime.usar(String(body.conta??''),us[1]));return true;}
          if(route==='/connections/claude/pessoais'){if(!runtime.adicionarPessoal)throw problem(404,'Esta Ratoeira não tem várias contas.');send(res,200,await runtime.adicionarPessoal(body.nome,body.token));return true;}
          const rp=route.match(/^\/connections\/(claude|codex)\/pessoais\/([a-z0-9]{1,20})\/remover$/);
          if(rp){if(!runtime.removerPessoal)throw problem(404,'Esta Ratoeira não tem várias contas.');send(res,200,await runtime.removerPessoal(rp[2],rp[1]));return true;}
          if(route==='/connections/claude-token/start'){if(!runtime.adicionarPessoal)throw problem(404,'Esta Ratoeira não tem várias contas.');send(res,202,await manager.start('claude-token',identity.email,{nome:String(body.nome??'').slice(0,60)}));return true;}
          // conta pessoal do Codex (desde 28/10/2026): login pelo código de dispositivo numa pasta só dela
          if(route==='/connections/codex-conta/start'){if(!runtime.adicionarPessoal)throw problem(404,'Esta Ratoeira não tem várias contas.');const id=String(body.id??'');send(res,202,await manager.start('codex-conta',identity.email,{nome:String(body.nome??'').slice(0,60),...(/^[a-z0-9]{1,20}$/.test(id)?{id}:{})}));return true;}
          // conta pessoal com login completo (nova, ou id de uma que já existe pra entrar de novo)
          if(route==='/connections/claude-conta/start'){if(!runtime.adicionarPessoal)throw problem(404,'Esta Ratoeira não tem várias contas.');const id=String(body.id??'');send(res,202,await manager.start('claude-conta',identity.email,{nome:String(body.nome??'').slice(0,60),...(/^[a-z0-9]{1,20}$/.test(id)?{id}:{})}));return true;}
          const saida=route.match(/^\/connections\/(claude|codex)\/sair$/);
          if(saida){if(!runtime.sair)throw problem(404,'Desconectar não existe nesta Ratoeira.');const r=await runtime.sair(saida[1]);send(res,200,{...r,provider:await runtime.status(saida[1],{fresh:true})});return true;}
          const start=route.match(/^\/connections\/(claude|codex)\/start$/);
          if(start){send(res,202,await manager.start(start[1],identity.email));return true;}
          const action=route.match(/^\/connections\/flow\/([a-zA-Z0-9-]{1,80})\/(code|cancel)$/);
          if(action){send(res,200,action[2]==='code'?manager.submit(action[1],identity.email,body.code):manager.cancel(action[1],identity.email));return true;}
        }
        throw problem(404,'Recurso não encontrado.');
      }catch(error){
        const message=error.status?error.message:'Não foi possível concluir a operação. Tente novamente.';
        // Dentro de uma aba de arquivo, o erro precisa ser legível, não JSON cru.
        if(!res.headersSent&&fileRoute)send(res,error.status??500,'<!doctype html><meta charset="utf-8"><meta name="color-scheme" content="light dark"><p style="font:15px system-ui;padding:40px 24px;color:#888">'+message.replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]))+'</p>','text/html; charset=utf-8',false,{'content-security-policy':sandboxPolicy});
        else if(!res.headersSent)send(res,error.status??500,{error:message});
        else res.destroy();
      }
      return true;
    },
  };
}
