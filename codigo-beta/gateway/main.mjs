import { existsSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import http from 'node:http';
import os from 'node:os';
import { createAccessVerifier } from './access.mjs';
import { createGateway, normalizeApps } from './server.mjs';
import { createPublicador, lerRegistro, juntarApps } from './publicar.mjs';
import { createCore } from './core.mjs';
import { createAtualizacoes } from './atualizacoes.mjs';
import { createPortal } from './portal.mjs';
import { createAcesso } from './usuarios.mjs';
import { createContas } from './contas.mjs';
import { problem } from './catalog.mjs';
import { carregarConfig } from './config.mjs';
import { createPlayground } from './playground.mjs';

// Config com versão e migração (config.mjs). Sem RATOEIRA_CONFIG não sobe: não tem mais reserva.
const config=carregarConfig(process.env.RATOEIRA_CONFIG);
const local=config.access?.mode==='local';
// Login próprio (contas.mjs). As contas moram ao lado do estado do portal.
const senha=config.access?.mode==='senha';
if(senha&&!config.portal?.enabled)throw new Error('O modo senha precisa do portal ligado (a tela de Pessoas mora nele).');
// Apps: os da config principal + os publicados pela tela (publicar.mjs), que o ajudante de root registra em
// config.publicar.registro (um JSON por app). Prefixo repetido: vale o da config. Entrada que não serve
// (ex.: segredo ilegível) fica de fora e o log diz por quê, sem derrubar o gateway.
const publicarCfg=config.publicar??null;
const lerApps=()=>juntarApps(config.apps??[],lerRegistro(publicarCfg?.registro,m=>console.log(m)),{valido:e=>normalizeApps([e],null),log:m=>console.log(m)});
let todosApps=lerApps();
// Papéis que cada aplicação do sistema aceita (apps[].papeis); sem lista, é só "acesso".
// appsPapeis, papeisMap e systemApps são trocados no lugar quando um app é publicado (recarregarApps).
// padrao: o papel de quem não tem nenhum definido na tela de Pessoas. App publicado pela tela nasce liberado pra
// todo mundo com o último papel da lista (o de menos poder); app da config principal só abre pra quem foi liberado,
// a não ser que a config diga "padrao". null = ninguém por padrão.
const daConfig=new Set((config.apps??[]).map(a=>a.prefix));
const papeisDe=list=>list.map(a=>{
  const papeis=Array.isArray(a.papeis)&&a.papeis.length?a.papeis.map(String):['acesso'];
  const pedido=a.padrao!==undefined?a.padrao:(daConfig.has(a.prefix)?null:papeis[papeis.length-1]);
  // dono: quem publicou o app pela primeira vez (registro do publicar-app); entra com o papel que pode mais
  return {prefix:a.prefix,name:String(a.name??a.prefix),papeis,padrao:papeis.includes(pedido)?pedido:null,dono:typeof a.dono==='string'?a.dono.toLowerCase():null};
});
const appsPapeis=papeisDe(todosApps);
const papeisMap=new Map(appsPapeis.map(a=>[a.prefix,a.papeis]));
const padraoMap=new Map(appsPapeis.map(a=>[a.prefix,a.padrao]));
const donoMap=new Map(appsPapeis.map(a=>[a.prefix,a.dono]));
let server;
// Convite com ambiente: cria o usuário Linux pela unit ratoeira-adicionar@<usuário> (roda o
// adicionar-pessoa.sh como root). O gateway só pode dar "start" nela (regra do polkit).
const criarUsuario=config.criaAmbiente?async user=>{
  try{await promisify(execFile)('systemctl',['start',`ratoeira-adicionar@${user}.service`],{timeout:180000});}
  catch{throw problem(502,`Não consegui criar o usuário Linux ${user}. Na VPS: journalctl -u ratoeira-adicionar@${user}`);}
}:null;
// Áreas do time (repo compartilhado, criar-area.sh): a cada mudança de área ou pasta restrita o
// gateway grava o pedido e liga o ratoeira-acessos (aplicar-acessos, como root). Quem mudou de
// área só ganha o grupo novo quando o servidor de agentes dela religa: para agora se estiver livre; ocupado,
// vale na próxima vez que ele ligar (ele sai sozinho depois de 30 min parado e o chat liga de novo).
const contasDir=config.contasDir??path.join(config.portal?.dataDir??'.','contas');
const aoMudarAcessos=senha&&criarUsuario?async(pedido,mudaram)=>{
  const arq=path.join(contasDir,'acessos.json'),tmp=arq+'.tmp';
  // no primeiro boot a pasta das contas ainda não existe
  mkdirSync(contasDir,{recursive:true,mode:0o700});
  writeFileSync(tmp,JSON.stringify(pedido,null,1)+'\n',{mode:0o600});renameSync(tmp,arq);
  try{await promisify(execFile)('systemctl',['start','ratoeira-acessos.service'],{timeout:900000});}
  catch{throw problem(502,'Salvei, mas não consegui aplicar as permissões no disco. Na VPS: journalctl -u ratoeira-acessos');}
  for(const user of mudaram)await pararAgentesSeLivre(user,'área ou conta nova');
}:null;
// O servidor de agentes (chat, terminal) só pega grupo novo quando religa. Livre (nenhuma conversa
// rodando, nenhum login nem terminal aberto), para: o gateway liga de novo quando o chat reconectar.
async function pararAgentesSeLivre(user,motivo){
  if(!config.agentes)return;
  const socketPath=(config.agentes.socket??'/run/ratoeira-agentes-{user}/agentes.sock').replaceAll('{user}',user);
  if(!existsSync(socketPath))return;
  const estado=await new Promise(ok=>{
    const req=http.get({socketPath,path:'/estado',timeout:5000},res=>{let d='';res.on('data',c=>{d+=c;});res.on('end',()=>{try{ok(JSON.parse(d));}catch{ok(null);}});});
    req.on('timeout',()=>req.destroy());req.on('error',()=>ok(null));
  });
  if(!estado||estado.ocupado||estado.terminais){console.log(`${user}: ${motivo} vale no chat quando o servidor de agentes religar`);return;}
  execFile('systemctl',['stop','--no-block',`ratoeira-agentes@${user}.service`],()=>{});
}
// Modo da Ratoeira (13/10/2026): "confianca" (padrão) = cada pessoa com o seu usuário Linux, todos com sudo, sem
// pastas restritas; "restrito" = o de antes (sem sudo, pastas restritas), guardado pra instalação enterprise.
// O sudo em si é da receita kit/receitas/modo-confianca; aqui só liga ou desliga o que o gateway faz.
const modo=config.modo==='restrito'?'restrito':'confianca';
const contas=senha?createContas({restritas:modo==='restrito',dir:contasDir,areas:config.areas??[],aoMudarAcessos,claudePadrao:config.claudePadrao,codexPadrao:config.codexPadrao,appsPapeis:papeisMap,appsPadrao:padraoMap,appsDono:donoMap,
  criarUsuario,socketPattern:config.paseoSocket,pastaPadrao:config.pastaPadrao,aoRevogar:email=>server?.revogar(email)}):null;
if(contas){await contas.iniciar();setInterval(()=>contas.recarregar().catch(()=>{}),5000).unref();}
// Ao ligar, reaplica áreas, pastas restritas, conta do Claude e autor dos commits: o disco volta a
// bater com o cadastro depois de qualquer atualização (sem religar ninguém).
if(contas&&aoMudarAcessos)contas.reaplicar().catch(e=>console.log('reaplicar acessos:',e.message));
// Cloudflare na frente e o túnel SSH como caminho de volta (ver server.mjs).
const alsoLocal=!local&&config.access?.alsoLocal===true;
// No modo local o dono da VPS é o único usuário, então é ele quem administra as conexões.
const owner=String(config.access?.owner??'dono').toLowerCase();const ownerEmail=owner.includes('@')?owner:`${owner}@localhost`;
const hostname=local?`localhost:${config.port}`:config.hostname;
// aplicações com servidor próprio (ver server.mjs): o portal mostra no menu, com link direto
// `chat` (opcional): a aplicação conversa pelo chat da grade. `sessao` e `mensagem` são rotas dela (relativas ao
// prefixo) que dão as ferramentas (MCP) e recebem cada mensagem; `cabecalhos` vão junto nesses pedidos (ex.: a
// trava contra formulário de outro site); `esconder` são seletores CSS do chat próprio dela, que somem quando ela
// abre como aba da Ratoeira (e `css`, regras a mais pro mesmo caso, ex.: tirar o espaço que o chat ocupava); `detalhe`
// são seletores do que abre por cima da tela sem mudar o endereço (ex.: o card de um cliente), e o texto do primeiro
// visível vai junto na etiqueta da tela; `ponte` é o objeto global com que as telas dela abrem o chat próprio ({nova(texto),
// sobre(dados)}), que a Ratoeira troca pelo dela; `recarregar` é a função global que a tela usa pra buscar os dados
// de novo, chamada quando o agente termina.
const chatDoApp=c=>{
  if(!c||typeof c!=='object')return undefined;
  const rota=v=>typeof v==='string'&&/^[a-z0-9/_-]{1,80}$/.test(v)?v:null;
  const r={sessao:rota(c.sessao),mensagem:rota(c.mensagem),esconder:typeof c.esconder==='string'&&c.esconder.length<300&&!/[{}<>]/.test(c.esconder)?c.esconder:'',
    cabecalhos:Object.fromEntries(Object.entries(c.cabecalhos&&typeof c.cabecalhos==='object'?c.cabecalhos:{}).filter(([k,v])=>/^X-[A-Za-z0-9-]{1,40}$/.test(k)&&typeof v==='string'&&/^[\x20-\x7e]{0,100}$/.test(v)).slice(0,5))};
  const nome=v=>typeof v==='string'&&/^[A-Za-z_$][\w$]{0,40}$/.test(v)?v:null;
  r.ponte=nome(c.ponte);r.recarregar=nome(c.recarregar);
  r.detalhe=typeof c.detalhe==='string'&&c.detalhe.length<300&&!/[{}<>]/.test(c.detalhe)?c.detalhe:'';
  r.css=typeof c.css==='string'&&c.css.length<1000&&!/[<>]|@import|url\(/i.test(c.css)?c.css:'';
  // jeito novo: o MCP do app passa pelo gateway (token e mensagem ficam com a Ratoeira, server.mjs); pasta é uma
  // rota opcional do app que devolve {pasta} com as instruções pro agente da pessoa
  r.mcp=typeof c.mcp==='string'?rota(c.mcp.replace(/^\//,'')):null;r.pasta=rota(c.pasta);
  return (r.sessao&&r.mensagem)||r.mcp?r:undefined;
};
const appDoSistema=a=>({name:String(a.name??a.prefix),description:String(a.description??''),url:a.prefix+'/',chat:chatDoApp(a.chat)});
const systemApps=todosApps.map(appDoSistema);
function recarregarApps(){
  todosApps=lerApps();
  appsPapeis.splice(0,appsPapeis.length,...papeisDe(todosApps));
  papeisMap.clear();padraoMap.clear();donoMap.clear();for(const a of appsPapeis){papeisMap.set(a.prefix,a.papeis);padraoMap.set(a.prefix,a.padrao);donoMap.set(a.prefix,a.dono);}
  systemApps.splice(0,systemApps.length,...todosApps.map(appDoSistema));
  server?.trocarApps(todosApps);
  console.log('apps: '+todosApps.map(a=>a.prefix).join(' '));
}
// "systemctl kill -s HUP ratoeira-gateway" relê o registro de apps sem reiniciar
process.on('SIGHUP',()=>{try{recarregarApps();}catch(e){console.log('recarregar apps:',e.message);}});
// Publicar app pela tela (só admin, nesta fase): grava o pedido e liga o ratoeira-publicar@<nome>
// (publicar-app como root; a regra do polkit libera só "start" nela). Terminou: relê o registro.
const publicador=publicarCfg?createPublicador({
  areas:config.areas?.length?config.areas:config.portal?.repoDir?[{id:'principal',caminho:config.portal.repoDir}]:[],
  pedidosDir:publicarCfg.pedidos??path.join(config.portal?.dataDir??'.','publicar'),registroDir:publicarCfg.registro,
  principais:()=>(config.apps??[]).map(a=>a.prefix),
  ligar:nome=>promisify(execFile)('systemctl',['start',`ratoeira-publicar@${nome}.service`],{timeout:1900000}),
  aoTerminar:async()=>recarregarApps()}):null;
// Publicar a própria Ratoeira pelo chat de um admin (core.mjs, docs/2026-10-09-publicar-core.md): grava o
// pedido e liga o ratoeira-publicar-core@<parte> sem esperar, porque a parte "gateway" reinicia este processo.
const core=config.core?.fonte&&config.core?.partes?.length?createCore({
  fonte:config.core.fonte,partes:config.core.partes,
  pedidosDir:config.core.pedidos??path.join(config.portal?.dataDir??'.','publicar-core'),
  versoesArquivo:config.core.versoes??'/var/lib/ratoeira/core/versoes.json',
  ligar:parte=>promisify(execFile)('systemctl',['start','--no-block',`ratoeira-publicar-core@${parte}.service`],{timeout:30000})}):null;
// Atualizações (atualizacoes.mjs, só nas instalações: a config do instalador traz "atualizar"). Grava o pedido do
// admin e liga o ratoeira-atualizar.service sem esperar, porque a atualização reinicia este processo.
const atualizacoes=config.atualizar?createAtualizacoes({
  estadoArquivo:config.atualizar.estado??'/var/lib/ratoeira/core/atualizacao.json',
  pedidosDir:config.atualizar.pedidos??path.join(config.portal?.dataDir??'.','atualizar'),
  ligar:()=>promisify(execFile)('systemctl',['start','--no-block','ratoeira-atualizar.service'],{timeout:30000})}):null;
const acesso=contas??createAcesso(config);
// Chat da Ratoeira por ACP (agentes/): um servidor por pessoa, ligado sob demanda.
// A regra do polkit libera "start" e "stop" de ratoeira-agentes@<usuário>.
const agentes=config.agentes?{socket:config.agentes.socket??'/run/ratoeira-agentes-{user}/agentes.sock',
  ligar:user=>execFile('systemctl',['start','--no-block',`ratoeira-agentes@${user}.service`],()=>{})}:undefined;
// Máquina acabou de ligar (16/10/2026): liga o servidor de agentes de cada pessoa uma vez, pra ele retomar as
// conversas que estavam trabalhando quando ela desligou (agentes/servidor.mjs, "Retomar"). Quem não tinha nada
// sai sozinho depois de 30 min sem ninguém. Gateway religado com a máquina já de pé (publicar) não liga ninguém.
if(agentes&&contas&&os.uptime()<600)for(const user of contas.usuariosLinux()){console.log(`máquina ligou: servidor de agentes de ${user}`);agentes.ligar(user);}
// Automações e integrações (kit/multiusuario/automacoes, como root): o gateway lê o inventário que ele monta,
// grava o pedido de liga/desliga do admin e dá "start" na unit pra valer na hora (regra do polkit).
const automacoes=config.automacoes?{
  inventario:config.automacoes.inventario??'/var/lib/ratoeira-automacoes/inventario.json',
  resultado:config.automacoes.resultado??'/var/lib/ratoeira-automacoes/pedido-resultado.json',
  pedido:config.automacoes.pedido??path.join(config.portal?.dataDir??'.','automacoes-pedido.json'),
  aplicar:async()=>{
    try{await promisify(execFile)('systemctl',['start','ratoeira-automacoes.service'],{timeout:120000});}
    catch{throw problem(502,'Não consegui aplicar agora (vale em até 1 minuto). Na VPS: journalctl -u ratoeira-automacoes');}
  }}:null;
// Playground (playground.mjs): experimentos em Docker por subdomínio. Só com login próprio (o subdomínio confere o login
// da Ratoeira pela troca de código). "playground": false na config desliga.
const playground=senha&&config.playground!==false&&config.portal?.dataDir?createPlayground({
  areas:config.areas?.length?config.areas:config.portal?.repoDir?[{id:'principal',caminho:config.portal.repoDir}]:[],
  estadoDir:config.portal.dataDir,hostname:config.hostname,ipHeader:config.ipHeader,
  ...(config.playground?.estado?{estadoArquivo:config.playground.estado}:{})}):null;
if(playground&&contas)playground.usarContas(email=>contas.ativa(email));
const portal=config.portal?.enabled?createPortal({...config.portal,modo,playground:Boolean(playground),agentes:Boolean(config.agentes),automacoes,publicador,atualizacoes,
  // Conexões de quem tem ambiente próprio pelo servidor de agentes (sem o terminal do Paseo)
  agentesConexoes:agentes&&config.conexoesPorAgentes!==false?agentes:null,acesso,contas,appsPapeis,criaAmbiente:Boolean(criarUsuario),claudeModos:Boolean(contas),
  // modo opcional: quem conecta a própria conta larga a geral quando o servidor de agentes religa
  aoContaPropria:user=>{if(contas?.ambiente&&[...contas.usuarios().values()].some(p=>p.user===user))pararAgentesSeLivre(user,'conta própria').catch(()=>{});},...(local?{adminEmails:[ownerEmail]}:{}),hostname,systemApps,agentPath:config.defaults?.landingPath??'/new'}):undefined;
// O Paseo por pessoa (ratoeira-paseo@, paseoOnDemand, paseoIdleMinutes) saiu em 09/10/2026: essas chaves da
// config não fazem mais nada.
server=createGateway({...config,playground,apps:todosApps,agentes,portal,contas,publicador,core,nucleoQuem:Array.isArray(config.core?.quem)?config.core.quem:null,atualizacoes,ligacoesArquivo:config.portal?.dataDir?path.join(config.portal.dataDir,'chat-ligacoes.json'):null,compartilhadasArquivo:config.portal?.dataDir?path.join(config.portal.dataDir,'chat-compartilhadas.json'):null,pushArquivo:config.portal?.dataDir?path.join(config.portal.dataDir,'push.json'):null,password:process.env.PASEO_PASSWORD||undefined,access:senha?{mode:'senha',alsoLocal,port:config.port}:local?{mode:'local',port:config.port,owner}:alsoLocal?{mode:'cloudflare',alsoLocal:true,port:config.port,owner}:undefined,verify:local||senha?undefined:createAccessVerifier(config)});
server.listen(config.port,'127.0.0.1',()=>console.log(`Ratoeira gateway listening on 127.0.0.1:${config.port}`));
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,async()=>{server.shutdown();await contas?.flush().catch(()=>{});process.exit(0);});
