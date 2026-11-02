// Login próprio da Ratoeira (modo "senha"): pessoas, senhas, sessões e links de uso único.
// Decisões em DECISOES.md ("Acesso, identidade e arquitetura"): e-mail e senha, sem serviço de
// fora; primeira conta por link de 1 h gerado na VPS; convite por link de 24 h; senha esquecida =
// admin gera link de 1 h; sessão vence com 14 dias sem uso; papel na Ratoeira: admin ou membro.
//
// Guardado em <dataDir>/contas/ (pasta 700, arquivos 600, troca atômica):
//   pessoas.json  {pessoas:[...], links:[...]}   senha só como hash scrypt; link só como hash
//   sessoes.json  {sessoes:[...]}                token só como hash
// Quem copia os arquivos não entra: não há senha nem token em claro em lugar nenhum.
import {randomBytes,randomUUID,scrypt as scryptCb,timingSafeEqual,createHash} from 'node:crypto';
import {existsSync} from 'node:fs';
import {mkdir,readFile,writeFile,rename,stat,appendFile} from 'node:fs/promises';
import path from 'node:path';
import {promisify} from 'node:util';
import {problem} from './catalog.mjs';
import {SOCKET_PADRAO} from './usuarios.mjs';
import * as dois from './dois-passos.mjs';
import {validarEmailConfig,emailPublico} from './email.mjs';

const scrypt=promisify(scryptCb);
const SCRYPT={N:2**15,r:8,p:1,maxmem:64*1024*1024};   // ~32 MB e ~100 ms por senha
export const PRAZOS={sessao:14*86400e3,primeiro:3600e3,convite:24*3600e3,senha:3600e3,
  desafio:10*60e3,ativarDois:15*60e3,aparelho:30*86400e3};   // 2FA: tela do código, QR pendente, aparelho lembrado
const APARELHOS_POR_PESSOA=10;
const TRAVA={porPar:5,porIp:30,janela:15*60e3};       // erros antes de travar, por 15 min
const IP_CONHECIDO=90*24*3600e3, IPS_POR_PESSOA=20;   // IP sem entrar há 90 dias volta a ser novo
const EMAIL=/^[^@\s<>"'\\]{1,64}@[^@\s<>"'\\]{1,190}$/;
const USUARIO=/^[a-z_][a-z0-9_-]{0,31}$/;
// Conta do Claude de quem tem ambiente:
// geral = usa a conta geral da Ratoeira (token de longa duração, claude setup-token);
// propria = precisa conectar a dela em Conexões; opcional = a dela se conectou, senão a geral.
export const CLAUDE_MODOS=['geral','propria','opcional'];
// Conta do Codex: os mesmos três modos. A geral é um login do ChatGPT (codex login) num arquivo só,
// que todo mundo usa pelo mesmo caminho: o Codex renova o token e grava ali, e os outros releem.
export const CODEX_MODOS=CLAUDE_MODOS;
const TOKEN_CLAUDE=/^sk-ant-oat01-[A-Za-z0-9_-]{20,300}$/;
// Cofre de chaves: token de service account do 1Password (ops_...). Só leitura, escopo decidido no próprio 1Password.
const TOKEN_COFRE=/^ops_[A-Za-z0-9_+/=.-]{20,4000}$/;
// chave do AssemblyAI (ditado do chat), a mesma regra do agentes/transcrever.mjs
const CHAVE_DITADO=/^[A-Za-z0-9_-]{16,128}$/;

// Boas-vindas: o que a tela pode pedir, e os itens da lista que a pessoa marca à mão (o resto se marca sozinho)
const BOAS_VINDAS_ACOES=['concluir','pular','zerar','fechar-lista','abrir-lista','marcar','desmarcar'];
const BOAS_VINDAS_ITENS=['comecar-do-zero','backup-vps'];

const b64=buf=>buf.toString('base64url');
export const hashToken=t=>createHash('sha256').update(String(t)).digest('base64url');
const novoToken=()=>b64(randomBytes(32));
// Escolhas do chat (modelo, esforço, modo de aprovação) de uma conversa nova: as do admin valem pra
// todo mundo, e a pessoa só sobrescreve o que mudou. Formato: {agente?, agentes:{<id>:{modelo?,esforco?,modo?}}}.
// Os valores são ids que o próprio agente devolve (ACP); aqui só confere o tamanho e o formato.
const CAMPOS_CHAT=['modelo','esforco','modo'];
const ID_CHAT=/^[a-z0-9_-]{1,40}$/,VALOR_CHAT=/^[^\x00-\x1f<>"'`]{1,200}$/;
function validarEscolhasChat(e,{pasta=false}={}){
  if(!e||typeof e!=='object'||Array.isArray(e))throw problem(400,'Escolhas inválidas.');
  const saida={agentes:{}};
  // pasta da última conversa nova (só nas escolhas da pessoa): relativa à pasta de trabalho, sem subir dela
  if(pasta&&e.pasta!=null&&e.pasta!==''){
    const r=String(e.pasta);
    if(r.length>300||r.startsWith('/')||/[\u0000-\u001f\\]/.test(r)||r.split('/').some(x=>!x||x==='.'||x==='..'))throw problem(400,'Pasta inválida.');
    saida.pasta=r;
  }
  if(e.agente!=null){if(!ID_CHAT.test(String(e.agente)))throw problem(400,'Agente inválido.');saida.agente=String(e.agente);}
  const ags=e.agentes??{};if(typeof ags!=='object'||Array.isArray(ags)||Object.keys(ags).length>10)throw problem(400,'Escolhas inválidas.');
  for(const [id,v] of Object.entries(ags)){
    if(!ID_CHAT.test(id)||!v||typeof v!=='object')throw problem(400,'Agente inválido.');
    const c={};for(const k of CAMPOS_CHAT)if(v[k]!=null&&v[k]!==''){if(!VALOR_CHAT.test(String(v[k])))throw problem(400,'Valor inválido em '+k+'.');c[k]=String(v[k]);}
    if(Object.keys(c).length)saida.agentes[id]=c;
  }
  return saida;
}
// Conta e plano do login do Codex, lidos do id_token (JWT, sem conferir a assinatura: é só pra mostrar na tela).
function identidadeCodex(idToken){
  try{
    const c=JSON.parse(Buffer.from(String(idToken).split('.')[1],'base64url').toString('utf8'));
    const conta=typeof c.email==='string'&&c.email.length<200?c.email:null;
    const plano=c['https://api.openai.com/auth']?.chatgpt_plan_type;
    return {conta,plano:typeof plano==='string'&&/^[a-z_-]{1,30}$/.test(plano)?plano:null};
  }catch{return {conta:null,plano:null};}
}

export async function hashSenha(senha){
  const sal=randomBytes(16);
  const chave=await scrypt(senha.normalize('NFC'),sal,32,SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${b64(sal)}$${b64(chave)}`;
}
export async function conferirSenha(senha,guardado){
  const partes=String(guardado??'').split('$');
  if(partes.length!==6||partes[0]!=='scrypt')return false;
  const [,N,r,p,sal,chave]=partes;
  const esperado=Buffer.from(chave,'base64url');
  const obtido=await scrypt(String(senha).normalize('NFC'),Buffer.from(sal,'base64url'),esperado.length,{N:+N,r:+r,p:+p,maxmem:SCRYPT.maxmem});
  return timingSafeEqual(obtido,esperado);
}
// Hash de mentira pra quem erra o e-mail gastar o mesmo tempo de quem erra a senha.
const HASH_FALSO=hashSenha(randomBytes(12).toString('hex'));

export function validarSenha(senha){
  if(typeof senha!=='string'||senha.length<10||senha.length>200)throw problem(400,'A senha precisa ter de 10 a 200 caracteres.');
}
function validarEmail(email){
  const e=String(email??'').trim().toLowerCase();
  if(!EMAIL.test(e))throw problem(400,'E-mail inválido.');
  return e;
}
function validarNome(nome){
  const n=String(nome??'').trim();
  if(!n||n.length>80||/[\x00-\x1f\x7f<>]/.test(n))throw problem(400,'Informe um nome de até 80 caracteres.');
  return n;
}

// appsPapeis: Map(prefixo → [papéis aceitos]), vindo de apps[].papeis na config.
// appsPadrao: Map(prefixo → papel de quem não tem nenhum definido | null). Na pessoa, apps[prefixo] = null bloqueia.
// appsDono: Map(prefixo → e-mail de quem publicou o app pela primeira vez). Ele e quem administra entram com o
// primeiro papel da lista (o que pode mais), seja qual for o nome; papel definido na tela de Pessoas vale mais.
// criarUsuario(user): cria o usuário Linux e liga o Paseo dele (ratoeira-adicionar@.service).
// pastaPadrao: onde fica a pasta de trabalho de quem ganha ambiente próprio e nenhuma área.
// areas: as áreas do time (repo compartilhado), [{id, caminho, nome}], criadas pelo criar-area.sh.
// aoMudarAcessos(pedido, usuariosQueMudaramDeArea): grava o pedido e liga o aplicar-acessos (main.mjs).
// existe(caminho): se a pasta de uma área está no disco (os testes trocam).
export function createContas({dir,appsPapeis=new Map(),appsPadrao=new Map(),appsDono=new Map(),criarUsuario=null,socketPattern=SOCKET_PADRAO,pastaPadrao='/home/{user}/trabalho',areas=[],aoMudarAcessos=null,claudePadrao='propria',codexPadrao='propria',agora=Date.now,aoRevogar=()=>{},restritas:comRestritas=true,existe=existsSync}){
  const areasPorId=new Map(areas.map(a=>[a.id,a]));
  const arqPessoas=path.join(dir,'pessoas.json'),arqSessoes=path.join(dir,'sessoes.json');
  let dados=null,sessoes=null,fila=Promise.resolve(),sujo=false,ultimoFlush=0,versao=null;
  const erros=new Map();   // "par:email|ip" ou "ip:ip" → {n, ate}
  // Registro de acessos (desde 28/10/2026): acessos.log (uma linha JSON por entrada, erro e trava) e ips.json
  // (de onde cada pessoa já entrou). aoAcesso avisa o gateway, que põe no sino (server.mjs).
  const arqAcessos=path.join(dir,'acessos.log'),arqIps=path.join(dir,'ips.json');
  let aoAcesso=()=>{};
  // Verificação em dois passos: depois da senha certa, a entrada vira um desafio (só na memória, 10 min):
  // 'codigo' (pede o código do app) ou 'ativar' (a organização exige e a pessoa ainda não tem).
  const desafios=new Map();   // hash do token → {email, ip, tipo, ate, segredo?}
  // "Esqueci a senha" por e-mail: no máximo 3 links por conta e 10 pedidos por IP a cada hora
  const pedidosSenha=new Map();   // "e:email" ou "i:ip" → [horários]
  const contarPedido=(chave,limite)=>{const t=agora(),l=(pedidosSenha.get(chave)??[]).filter(x=>t-x<3600e3);if(l.length>=limite){pedidosSenha.set(chave,l);return false;}l.push(t);pedidosSenha.set(chave,l);return true;};

  async function ler(arq,vazio){try{return JSON.parse(await readFile(arq,'utf8'));}catch(e){if(e.code==='ENOENT')return vazio;throw e;}}
  async function gravar(arq,valor){
    await mkdir(dir,{recursive:true,mode:0o700});
    const tmp=arq+'.'+b64(randomBytes(6))+'.tmp';
    await writeFile(tmp,JSON.stringify(valor,null,1)+'\n',{mode:0o600});await rename(tmp,arq);
    if(arq===arqPessoas)versao=await marca();
  }
  // O comando da VPS (conta.mjs) grava no mesmo arquivo com o gateway rodando: quando o arquivo
  // muda por fora, relê em vez de sobrescrever.
  const marca=async()=>{try{const s=await stat(arqPessoas);return s.mtimeMs+':'+s.size+':'+s.ino;}catch{return null;}};
  async function carregar(){
    if(dados&&versao!==await marca())dados=null;
    if(!dados){versao=await marca();dados=await ler(arqPessoas,{pessoas:[],links:[]});dados.pessoas??=[];dados.links??=[];dados.restritas??=[];
      // a conta geral (uma só, até 10/10/2026) vira a primeira da lista de contas do Claude da organização
      if(dados.claudeGeral&&!dados.claudeContas)dados.claudeContas=[{id:'geral',nome:'Conta da organização',desde:dados.claudeGeral.desde,token:dados.claudeGeral.token,hash:hashToken(dados.claudeGeral.token),pessoas:null}];
      delete dados.claudeGeral;dados.claudeContas??=[];
      // a conta geral do Codex (uma só, até 28/10/2026) vira a primeira das contas do Codex da organização, com o id
      // "geral" (o root deixa o login dela onde estava, /var/lib/ratoeira/codex-geral)
      if(dados.codexGeral&&!dados.codexContas){const g=dados.codexGeral;
        dados.codexContas=[{id:'geral',nome:'Conta da organização',desde:g.desde,...(g.conta?{conta:g.conta}:{}),...(g.plano?{plano:g.plano}:{}),pessoas:null,...(g.auth?{auth:g.auth}:{})}];}
      delete dados.codexGeral;dados.codexContas??=[];
      // Boas-vindas (17/10/2026): quem já existia quando elas chegaram conta como "já viu". Fica só na memória até a
      // próxima mudança gravar; se o arquivo for relido antes, a data anda pra frente e quem existia segue antes dela.
      dados.boasVindasDesde??=new Date(agora()).toISOString();}
    if(!sessoes){sessoes=(await ler(arqSessoes,{sessoes:[]})).sessoes??[];}
  }
  // Toda mudança passa pela fila: lê, muda, grava, nessa ordem, uma de cada vez.
  function mudar(fn){
    const acao=fila.then(async()=>{await carregar();const r=await fn();await gravar(arqPessoas,dados);return r;});
    fila=acao.catch(()=>{});return acao;
  }
  function gravarSessoes(){
    const acao=fila.then(async()=>{sujo=false;ultimoFlush=agora();await gravar(arqSessoes,{sessoes});});
    fila=acao.catch(()=>{});return acao;
  }
  const achar=email=>dados.pessoas.find(p=>p.email===email);
  const limparLinks=()=>{dados.links=dados.links.filter(l=>!l.usadoEm&&l.expira>agora());};
  function novoLink(tipo,email){
    limparLinks();
    // um link vivo por pessoa e tipo: gerar outro invalida o anterior
    dados.links=dados.links.filter(l=>!(l.email===email&&l.tipo===tipo));
    const token=novoToken();
    dados.links.push({hash:hashToken(token),tipo,email,expira:agora()+PRAZOS[tipo]});
    return token;
  }
  function publico(p){
    const {senha,dois:d,doisPendente,...resto}=p;
    return {...resto,temSenha:Boolean(senha),doisPassos:Boolean(d)};
  }
  function ambienteDe(p){
    if(!p||p.estado!=='ativa'||!p.ambiente)return null;
    if(p.ambiente.tipo==='compartilhado')return {unico:true};
    const {user,areas:ids=[]}=p.ambiente;
    return {pessoa:{user,socketPath:socketPattern.replaceAll('{user}',user),...(pastaDe(p.ambiente)?{repoDir:pastaDe(p.ambiente)}:{}),areas:areasValidas(ids)}};
  }
  // Área que saiu da config (apagada à mão, por exemplo) não vale mais, e a pasta de trabalho passa pra próxima área
  // cuja pasta existe; sem nenhuma, pra pasta padrão (ou a home, se ela também não existe). Antes a conta ficava presa
  // numa pasta que não existia: árvore com 404 e o Claude fora da conversa nova (reporte 36, 28/10/2026).
  function areasValidas(ids){return ids.filter(id=>areasPorId.has(id));}
  // A área aberta (escolhida na Mesa, desde 29/10/2026, reporte 35) vem antes da ordem das áreas; é só preferência:
  // a pessoa já tem acesso a todas as áreas dela, então trocar não refaz permissão nem religa nada.
  function pastaDe(amb){
    const ids=amb.areas??[];
    if(!ids.length)return amb.repoDir;
    const ordem=ids.includes(amb.areaAberta)?[amb.areaAberta,...ids.filter(id=>id!==amb.areaAberta)]:ids;
    const area=areasValidas(ordem).map(id=>areasPorId.get(id).caminho).find(c=>existe(c));
    if(area)return area;
    const padrao=pastaPadrao.replaceAll('{user}',amb.user);
    return existe(padrao)?padrao:'/home/'+amb.user;
  }
  function validarApps(apps){
    const saida={};
    for(const [prefixo,papel] of Object.entries(apps??{})){
      const aceitos=appsPapeis.get(prefixo);
      if(!aceitos)throw problem(400,'Aplicação desconhecida: '+prefixo);
      if(papel!==null&&!aceitos.includes(papel))throw problem(400,`Papel "${papel}" não existe em ${prefixo}.`);
      saida[prefixo]=papel;
    }
    return saida;
  }
  function validarModo(m){
    const modo=m??claudePadrao;
    if(!CLAUDE_MODOS.includes(modo))throw problem(400,'Modo de conta do Claude inválido.');
    return modo;
  }
  function validarModoCodex(m){
    const modo=m??codexPadrao;
    if(!CODEX_MODOS.includes(modo))throw problem(400,'Modo de conta do Codex inválido.');
    return modo;
  }
  // quem pode usar conta do Claude da organização (geral ou opcional): religa quando elas mudam
  const usamClaudeOrg=()=>dados.pessoas.filter(p=>p.ambiente?.tipo==='proprio'&&p.estado!=='desativada'&&(p.ambiente.claude??'propria')!=='propria').map(p=>p.ambiente.user);
  // aplica e, com o root instalado, esquece os tokens: daqui pra frente o arquivo dele é a verdade
  async function instalarClaude(mudaram){
    await aplicar(mudaram);
    if(aoMudarAcessos)await mudar(async()=>{for(const c of dados.claudeContas)delete c.token;});
  }
  const ID_CONTA=/^[a-z0-9]{1,20}$/;
  const nomeConta=n=>String(n??'').replace(/[\t\r\n]+/g,' ').trim().slice(0,60);
  // quem do cadastro pode usar (null = todos); só e-mail de quem existe
  function validarQuem(lista){
    if(lista==null)return null;
    if(!Array.isArray(lista))throw problem(400,'Lista de pessoas inválida.');
    const emails=[...new Set(lista.map(e=>String(e).toLowerCase()))];
    for(const e of emails)if(!achar(e))throw problem(400,'Pessoa não encontrada: '+e);
    return emails;
  }
  // quem pode usar conta do Codex da organização (geral ou opcional): religa quando elas mudam
  const usamCodexOrg=()=>dados.pessoas.filter(p=>p.ambiente?.tipo==='proprio'&&p.estado!=='desativada'&&(p.ambiente.codex??'propria')!=='propria').map(p=>p.ambiente.user);
  // aplica e, com o root instalado, esquece os logins: daqui pra frente o arquivo dele é a verdade (o Codex renova
  // o token lá, e reinstalar a cópia velha derrubaria todo mundo)
  async function instalarCodex(mudaram){
    await aplicar(mudaram);
    if(aoMudarAcessos)await mudar(async()=>{for(const c of dados.codexContas)delete c.auth;});
  }
  function validarAreas(lista){
    const ids=[...new Set((lista??[]).map(String))];
    for(const id of ids)if(!areasPorId.has(id))throw problem(400,'Área desconhecida: '+id);
    return ids;
  }
  // O que o root (aplicar-acessos) precisa saber: em que áreas cada usuário Linux entra e quem
  // pode cada pasta restrita. Desativada sai de todas as áreas.
  function pedidoAcessos(){
    const pessoas=dados.pessoas.filter(p=>p.ambiente?.tipo==='proprio'&&p.estado!=='desativada').map(p=>({user:p.ambiente.user,areas:areasValidas(p.ambiente.areas??[]),claude:p.ambiente.claude??'propria',codex:p.ambiente.codex??'propria',nome:p.nome,email:p.email}));
    // desativada sai também das pastas restritas: a ACL por nome daria acesso mesmo fora do grupo
    const userDe=email=>dados.pessoas.find(p=>p.email===email&&p.ambiente?.tipo==='proprio'&&p.estado!=='desativada')?.ambiente.user;
    // modo confiança (o padrão): sem pastas restritas; mandar a lista vazia desfaz no disco as que existiam
    const restritas=comRestritas?dados.restritas.map(r=>({area:r.area,pasta:r.pasta,users:r.pessoas.map(userDe).filter(Boolean)})):[];
    // o token geral vai pro root gravar num arquivo que só os grupos do Claude geral leem
    // contas do Codex da organização: o root grava uma pasta por conta, lida e gravada só por quem pode usar (mesma
    // regra das do Claude). O login só vai até o root instalar (instalarCodex).
    const codexContas=dados.codexContas.map(c=>({id:c.id,nome:c.nome,users:c.pessoas?c.pessoas.map(userDe).filter(Boolean):null,...(c.auth?{auth:c.auth}:{})}));
    // cofre: o root grava o token num arquivo que só o grupo ratoeira-cofre lê (todo mundo com ambiente)
    // contas do Claude da organização: o root grava um arquivo por conta, lido só por quem pode usar (users;
    // sem lista, todos que não estão no modo própria). O token só vai até o root instalar (instalarClaude).
    const claudeContas=dados.claudeContas.map(c=>({id:c.id,nome:c.nome,users:c.pessoas?c.pessoas.map(userDe).filter(Boolean):null,...(c.token?{token:c.token}:{})}));
    // ditado: a chave do AssemblyAI da organização vai pro root gravar num arquivo que o grupo ratoeira-pessoas lê
    return {pessoas,restritas,claudeContas,codexContas,cofre:dados.cofre?.token??null,ditado:dados.ditado?.chave??null};
  }
  // Aplica fora da fila de gravação (o aplicar-acessos pode levar minutos numa pasta grande).
  let aplicando=Promise.resolve();
  function aplicar(mudaram=[]){
    if(!aoMudarAcessos)return Promise.resolve();
    const pedido=pedidoAcessos();
    const r=aplicando.then(()=>aoMudarAcessos(pedido,mudaram));
    aplicando=r.catch(()=>{});return r;
  }
  function revogarSessoes(email){
    const antes=sessoes.length;sessoes=sessoes.filter(s=>s.email!==email);
    if(sessoes.length!==antes)sujo=true;
    aoRevogar(email);
  }

  // ── trava de tentativas ───────────────────────────────────────────────
  function travado(chave){const e=erros.get(chave);return e&&e.n>=(chave.startsWith('ip:')?TRAVA.porIp:TRAVA.porPar)&&e.ate>agora();}
  function errou(chave){const e=erros.get(chave);if(!e||e.ate<=agora())erros.set(chave,{n:1,ate:agora()+TRAVA.janela});else e.n++;}

  async function registrar(ev){
    try{await mkdir(dir,{recursive:true,mode:0o700});await appendFile(arqAcessos,JSON.stringify({em:new Date(agora()).toISOString(),...ev})+'\n',{mode:0o600});}catch{}
    try{aoAcesso(ev);}catch{}
  }
  // Anota o IP de quem entrou e diz se é novo. Sem IP (gateway não sabe) ou primeira entrada registrada: não é novo.
  async function anotarIp(email,ip){
    if(!ip)return false;
    const ips=await ler(arqIps,{}).catch(()=>({})),t=agora();
    const meus=Object.fromEntries(Object.entries(ips[email]??{}).filter(([,em])=>t-Date.parse(em)<IP_CONHECIDO));
    const novo=Object.keys(meus).length>0&&!meus[ip];
    meus[ip]=new Date(t).toISOString();
    ips[email]=Object.fromEntries(Object.entries(meus).sort((a,b)=>b[1].localeCompare(a[1])).slice(0,IPS_POR_PESSOA));
    try{await gravar(arqIps,ips);}catch{}
    return novo;
  }

  // Senha certa (login ou link): abre a sessão, ou devolve o desafio do segundo passo.
  async function depoisDaSenha(p,ip,aparelho){
    for(const [h,d] of desafios)if(d.ate<=agora())desafios.delete(h);
    let tipo=null;
    if(p.dois){
      const h=typeof aparelho==='string'&&aparelho.length<=100?hashToken(aparelho):null;
      if(!(h&&p.dois.aparelhos?.some(a=>a.hash===h&&a.ate>agora())))tipo='codigo';
    }else if(dados.exigirDois)tipo='ativar';
    if(!tipo){
      await registrar({evento:'entrou',email:p.email,ip,ipNovo:await anotarIp(p.email,ip)});
      return api.abrirSessao(p.email);
    }
    const token=novoToken();
    desafios.set(hashToken(token),{email:p.email,ip,tipo,ate:agora()+PRAZOS.desafio,...(tipo==='ativar'?{segredo:dois.novoSegredo()}:{})});
    return {desafio:token,tipo};
  }
  // código do app ou de reserva da pessoa: devolve true e já gasta (reserva) ou marca o contador (app)
  function gastarCodigo(p,digitado){
    const c=dois.conferir(p.dois.segredo,digitado,{agora:agora(),ultimo:p.dois.ultimo??-1});
    if(c!==null){p.dois.ultimo=c;return true;}
    if(dois.pareceReserva(digitado)){
      const h=dois.hashReserva(digitado),i=p.dois.reservas.indexOf(h);
      if(i>=0){p.dois.reservas.splice(i,1);return true;}
    }
    return false;
  }
  function ligarDois(p,segredo,c){
    const reservas=dois.novasReservas();
    p.dois={segredo,desde:new Date(agora()).toISOString(),ultimo:c,reservas:reservas.map(dois.hashReserva),aparelhos:[]};
    delete p.doisPendente;
    return reservas;
  }
  const qrDe=(email,segredo)=>{const e=dois.endereco(segredo,{email});return {segredo,endereco:e,qr:dois.qrSvg(e)};};

  const api={
    // aviso de acesso: {evento:'entrou'|'errou'|'travou', email, ip, ipNovo?}; 'errou' e 'travou' só de conta que existe
    aoAcesso(fn){aoAcesso=typeof fn==='function'?fn:()=>{};},
    // ── acesso, no formato do createAcesso (usuarios.mjs) ──
    ambiente:email=>ambienteDe(dados?.pessoas.find(p=>p.email===email)),
    ativa:email=>dados?.pessoas.find(p=>p.email===email)?.estado==='ativa',
    admins:()=>(dados?.pessoas??[]).filter(p=>p.estado==='ativa'&&p.papel==='admin').map(p=>p.email),
    ehAdmin:email=>{const p=dados?.pessoas.find(p=>p.email===email);return p?.estado==='ativa'&&p.papel==='admin';},
    // null = pode o portal; lista = só estas aplicações (quem não tem ambiente nem é admin)
    limite(email){
      const p=dados?.pessoas.find(p=>p.email===email);
      if(!p||p.estado!=='ativa')return [];
      if(p.papel==='admin'||p.ambiente)return null;
      // os apps liberados pra ela na tela + os que nascem liberados pra todos (menos os que ela tem bloqueados)
      const meus=p.apps??{};
      const dele=k=>appsDono.get(k)===p.email.toLowerCase();
      return [...new Set([...Object.keys(meus).filter(k=>meus[k]!==null),...[...appsPadrao.keys()].filter(k=>(appsPadrao.get(k)||dele(k))&&!Object.hasOwn(meus,k))])];
    },
    podeApp(email,prefixo){
      const p=dados?.pessoas.find(p=>p.email===email);
      if(!p||p.estado!=='ativa')return false;
      // papel definido na tela vale; null é bloqueio; sem nada, admin abre e o resto ganha o padrão do app
      if(p.apps&&Object.hasOwn(p.apps,prefixo))return p.apps[prefixo]!==null;
      return p.papel==='admin'||appsDono.get(prefixo)===email.toLowerCase()||Boolean(appsPadrao.get(prefixo));
    },
    papelNoApp(email,prefixo){
      const p=dados?.pessoas.find(p=>p.email===email);
      if(!p||p.estado!=='ativa')return null;
      if(p.apps&&Object.hasOwn(p.apps,prefixo))return p.apps[prefixo];
      if(p.papel==='admin'||appsDono.get(prefixo)===email.toLowerCase())return appsPapeis.get(prefixo)?.[0]??appsPadrao.get(prefixo)??null;
      return appsPadrao.get(prefixo)??null;
    },
    nome:email=>dados?.pessoas.find(p=>p.email===email)?.nome??null,
    usuarios(){return new Map((dados?.pessoas??[]).map(p=>[p.email,ambienteDe(p)?.pessoa]).filter(([,v])=>v));},

    async iniciar(){await fila;await carregar();},
    // o gateway chama de tempos em tempos (main.mjs), pra pegar o que o comando da VPS mudou
    recarregar(){const r=fila.then(carregar);fila=r.catch(()=>{});return r;},

    // ── sessão ──
    // ip null = o gateway não sabe o IP de verdade (proxy na frente sem ipHeader): trava só por e-mail.
    async entrar(emailBruto,senha,ip=null,opcoes={}){
      await carregar();
      const email=String(emailBruto??'').trim().toLowerCase();
      const par=`par:${email}|${ip??'-'}`,porIp=ip?`ip:${ip}`:null;
      if(travado(par)||(porIp&&travado(porIp)))throw problem(429,'Muitas tentativas. Espere 15 minutos e tente de novo.');
      const p=achar(email);
      const ok=p?.estado==='ativa'&&p.senha?await conferirSenha(String(senha??''),p.senha):(await conferirSenha('x',await HASH_FALSO),false);
      if(!ok){
        errou(par);if(porIp)errou(porIp);
        if(p){await registrar({evento:'errou',email,ip});if(travado(par))await registrar({evento:'travou',email,ip});}
        throw problem(401,'E-mail ou senha incorretos.');
      }
      erros.delete(par);
      return depoisDaSenha(p,ip,opcoes.aparelho);
    },
    // ── segundo passo da entrada ──
    verDesafio(token){
      if(typeof token!=='string'||token.length>100)return null;
      const d=desafios.get(hashToken(token));
      if(!d||d.ate<=agora())return null;
      return {tipo:d.tipo,email:d.email,...(d.tipo==='ativar'?qrDe(d.email,d.segredo):{})};
    },
    // Responde o desafio. 'codigo': código do app ou de reserva; lembrar = aparelho lembrado por 30 dias.
    // 'ativar': o código do app recém-configurado liga a verificação e devolve os códigos de reserva.
    async responderDesafio(token,{codigo,lembrar=false}={},ip=null){
      await carregar();
      const h=typeof token==='string'&&token.length<=100?hashToken(token):null,d=h&&desafios.get(h);
      if(!d||d.ate<=agora())throw problem(410,'A entrada venceu. Entre de novo com a senha.');
      const par=`par:${d.email}|${ip??'-'}`;
      if(travado(par))throw problem(429,'Muitas tentativas. Espere 15 minutos e tente de novo.');
      let reservas=null,aparelho=null;
      const ok=await mudar(async()=>{
        const p=achar(d.email);if(!p||p.estado!=='ativa')return false;
        if(d.tipo==='ativar'){
          const c=dois.conferir(d.segredo,codigo,{agora:agora()});
          if(c===null)return false;
          reservas=ligarDois(p,d.segredo,c);
        }else if(!p.dois||!gastarCodigo(p,codigo))return false;
        if(lembrar&&p.dois){
          const t=novoToken();aparelho=t;
          p.dois.aparelhos=[...(p.dois.aparelhos??[]).filter(a=>a.ate>agora()),{hash:hashToken(t),ate:agora()+PRAZOS.aparelho}].slice(-APARELHOS_POR_PESSOA);
        }
        return true;
      });
      if(!ok){
        errou(par);
        await registrar({evento:'errou',email:d.email,ip,passo:'codigo'});
        if(travado(par)){desafios.delete(h);await registrar({evento:'travou',email:d.email,ip});}
        throw problem(401,'Código incorreto.');
      }
      desafios.delete(h);erros.delete(par);
      await registrar({evento:'entrou',email:d.email,ip,ipNovo:await anotarIp(d.email,ip)});
      return {...await api.abrirSessao(d.email),...(reservas?{reservas}:{}),...(aparelho?{aparelho:{token:aparelho,maxAge:PRAZOS.aparelho/1000}}:{})};
    },
    // "Sair" num navegador lembrado: ele volta a pedir o código
    async esquecerAparelho(token){
      if(typeof token!=='string'||token.length>100)return;
      const h=hashToken(token);
      await carregar();
      if(!dados.pessoas.some(p=>p.dois?.aparelhos?.some(a=>a.hash===h)))return;
      await mudar(async()=>{for(const p of dados.pessoas)if(p.dois?.aparelhos)p.dois.aparelhos=p.dois.aparelhos.filter(a=>a.hash!==h);});
    },
    // ── verificação em dois passos (Tua conta) ──
    doisPassos(email){
      const p=dados?.pessoas.find(x=>x.email===email);if(!p)return null;
      return {ativo:Boolean(p.dois),desde:p.dois?.desde??null,reservas:p.dois?.reservas.length??0,exigido:Boolean(dados.exigirDois)};
    },
    // começa a configurar: segredo novo, guardado como pendente até a pessoa digitar o primeiro código
    async comecarDois(email){
      return mudar(async()=>{
        const p=achar(email);if(!p)throw problem(404,'Pessoa não encontrada.');
        if(p.dois)throw problem(409,'A verificação em dois passos já está ligada.');
        p.doisPendente={segredo:dois.novoSegredo(),ate:agora()+PRAZOS.ativarDois};
        return qrDe(email,p.doisPendente.segredo);
      });
    },
    async confirmarDois(email,codigo){
      return mudar(async()=>{
        const p=achar(email);if(!p)throw problem(404,'Pessoa não encontrada.');
        if(p.dois)throw problem(409,'A verificação em dois passos já está ligada.');
        if(!p.doisPendente||p.doisPendente.ate<=agora())throw problem(410,'O QR code venceu. Comece de novo.');
        const c=dois.conferir(p.doisPendente.segredo,codigo,{agora:agora()});
        if(c===null)throw problem(400,'Código incorreto. Confira se o relógio do celular está certo.');
        return {reservas:ligarDois(p,p.doisPendente.segredo,c)};
      });
    },
    // trocar os códigos de reserva ou desligar: pede um código (do app ou de reserva), como prova
    async novasReservas(email,codigo){
      return mudar(async()=>{
        const p=achar(email);if(!p?.dois)throw problem(409,'A verificação em dois passos não está ligada.');
        if(!gastarCodigo(p,codigo))throw problem(400,'Código incorreto.');
        const r=dois.novasReservas();p.dois.reservas=r.map(dois.hashReserva);
        return {reservas:r};
      });
    },
    async desligarDois(email,codigo){
      return mudar(async()=>{
        const p=achar(email);if(!p?.dois)throw problem(409,'A verificação em dois passos não está ligada.');
        if(dados.exigirDois)throw problem(409,'Esta Ratoeira exige a verificação em dois passos de todo mundo.');
        if(!gastarCodigo(p,codigo))throw problem(400,'Código incorreto.');
        delete p.dois;return {ativo:false};
      });
    },
    // quem administra (Pessoas) ou a VPS (conta.mjs zerar-2fa): a pessoa perdeu o celular e os códigos
    async zerarDois(email){
      return mudar(async()=>{
        const p=achar(email);if(!p)throw problem(404,'Pessoa não encontrada.');
        const tinha=Boolean(p.dois);delete p.dois;delete p.doisPendente;
        return {zerado:tinha,pessoa:publico(p)};
      });
    },
    // Organização: exigir de todo mundo. Só liga quem já tem a dela; ligar fecha as sessões de quem não tem
    // (na próxima entrada, a tela de entrar leva pra configurar).
    // portaDosFundos: quem administra conferiu que entra pelo terminal web do provedor (passo 0 da tela de Segurança)
    seguranca(){return {exigirDois:Boolean(dados?.exigirDois),portaDosFundos:dados?.portaDosFundos??null};},
    async definirSeguranca({exigirDois,portaDosFundos},quem){
      if(exigirDois!==undefined&&typeof exigirDois!=='boolean')throw problem(400,'Valor inválido.');
      if(portaDosFundos!==undefined&&typeof portaDosFundos!=='boolean')throw problem(400,'Valor inválido.');
      return mudar(async()=>{
        if(exigirDois&&quem&&!achar(quem)?.dois)throw problem(409,'Ative a tua verificação em dois passos antes de exigir dos outros.');
        if(exigirDois===true)dados.exigirDois=true;else if(exigirDois===false)delete dados.exigirDois;
        if(exigirDois)for(const p of dados.pessoas)if(!p.dois)revogarSessoes(p.email);
        if(portaDosFundos===true)dados.portaDosFundos={em:new Date(agora()).toISOString(),por:quem??null};
        else if(portaDosFundos===false)delete dados.portaDosFundos;
        return api.seguranca();
      }).then(async r=>{await api.flush();return r;});
    },
    async abrirSessao(email){
      await carregar();
      const token=novoToken();
      sessoes.push({hash:hashToken(token),email,criada:agora(),ultimoUso:agora()});
      await gravarSessoes();
      return {token,maxAge:PRAZOS.sessao/1000};
    },
    // Confere o cookie. Uso conta como atividade; grava no disco no máximo a cada 5 min.
    sessao(token){
      if(!dados||!sessoes||typeof token!=='string'||token.length>100)return null;
      const h=hashToken(token);const s=sessoes.find(x=>x.hash===h);
      if(!s)return null;
      const p=achar(s.email);
      if(!p||p.estado!=='ativa'||agora()-s.ultimoUso>PRAZOS.sessao){sessoes=sessoes.filter(x=>x!==s);sujo=true;return null;}
      if(agora()-s.ultimoUso>60e3){s.ultimoUso=agora();sujo=true;}
      if(sujo&&agora()-ultimoFlush>5*60e3)gravarSessoes().catch(()=>{});
      return {email:s.email,exp:Math.floor((s.ultimoUso+PRAZOS.sessao)/1000)};
    },
    async sair(token){
      await carregar();
      const h=hashToken(token);const antes=sessoes.length;sessoes=sessoes.filter(s=>s.hash!==h);
      if(sessoes.length!==antes)await gravarSessoes();
    },
    flush:()=>sujo?gravarSessoes():Promise.resolve(),

    // ── links ──
    async verLink(token){
      await carregar();
      if(typeof token!=='string'||token.length>100)return null;
      const l=dados.links.find(x=>x.hash===hashToken(token));
      if(!l||l.usadoEm||l.expira<=agora())return null;
      const p=l.email?achar(l.email):null;
      if(l.tipo!=='primeiro'&&(!p||p.estado==='desativada'))return null;
      return {tipo:l.tipo,email:l.email??null,nome:p?.nome??''};
    },
    // Define a senha (e, no primeiro acesso, cria o admin). Devolve a sessão já aberta.
    async usarLink(token,{senha,nome,email},ip=null){
      validarSenha(senha);
      const hash=await hashSenha(senha);
      const pessoa=await mudar(async()=>{
        const l=dados.links.find(x=>x.hash===hashToken(token));
        if(!l||l.usadoEm||l.expira<=agora())throw problem(410,'Este link venceu ou já foi usado. Peça um novo.');
        let p;
        if(l.tipo==='primeiro'){
          if(dados.pessoas.some(x=>x.papel==='admin'&&x.estado!=='desativada'))throw problem(409,'Esta Ratoeira já tem administrador.');
          const e=validarEmail(email);
          p=achar(e);
          if(p){p.papel='admin';p.estado='ativa';p.senha=hash;p.nome=validarNome(nome||p.nome);}
          else{p={email:e,nome:validarNome(nome),papel:'admin',estado:'ativa',ambiente:null,apps:{},senha:hash,criadaEm:new Date(agora()).toISOString()};dados.pessoas.push(p);}
          if(l.ambiente)p.ambiente=l.ambiente;
        }else{
          p=achar(l.email);
          if(!p||p.estado==='desativada')throw problem(410,'Este link venceu ou já foi usado. Peça um novo.');
          p.senha=hash;p.estado='ativa';if(nome)p.nome=validarNome(nome);
        }
        l.usadoEm=agora();
        // senha nova derruba as sessões antigas dessa pessoa (e os WebSockets dela)
        revogarSessoes(p.email);
        return p;
      });
      // nome e e-mail só existem agora: aplica os acessos (grupos, ~/.gitconfig) sem segurar o login
      if(pessoa.ambiente?.tipo==='proprio')aplicar([pessoa.ambiente.user]).catch(e=>console.log('acessos depois do link:',e.message));
      // quem tem verificação em dois passos (ou a organização exige) ainda passa pelo código
      return {pessoa:publico(pessoa),...await depoisDaSenha(pessoa,ip)};
    },
    // Só pela VPS (conta.mjs). ambiente:{tipo:'compartilhado'} = o admin usa o Paseo único.
    async primeiroAcesso({ambiente=null}={}){
      return mudar(async()=>{
        if(dados.pessoas.some(x=>x.papel==='admin'&&x.estado!=='desativada'))throw problem(409,'Esta Ratoeira já tem administrador. Use "redefinir".');
        dados.links=dados.links.filter(l=>l.tipo!=='primeiro');
        const token=novoToken();
        dados.links.push({hash:hashToken(token),tipo:'primeiro',email:null,expira:agora()+PRAZOS.primeiro,...(ambiente?{ambiente}:{})});
        return token;
      });
    },

    // ── pessoas (admin) ──
    async listar(){await carregar();return dados.pessoas.map(publico);},
    async convidar({email,nome,papel='membro',ambiente=false,usuario,apps,areas:areasPedidas,claude,codex}){
      const e=validarEmail(email),n=validarNome(nome);
      if(!['admin','membro'].includes(papel))throw problem(400,'Papel inválido.');
      const appsOk=validarApps(apps);
      await carregar();
      if(achar(e))throw problem(409,'Essa pessoa já existe. Gere um link novo pra ela.');
      let amb=null;
      if(ambiente){
        if(!criarUsuario)throw problem(400,'Esta instalação não cria ambientes. Convide sem ambiente.');
        const user=String(usuario??'').trim();
        if(!USUARIO.test(user))throw problem(400,'Usuário Linux inválido: letras minúsculas, números, - e _, começando com letra.');
        if(dados.pessoas.some(p=>p.ambiente?.user===user))throw problem(409,'Esse usuário Linux já é de outra pessoa.');
        // Com área, a pasta de trabalho é a do time (a primeira escolhida); sem, a da home dela.
        const ids=validarAreas(areasPedidas??[...areasPorId.keys()]);
        const modo=validarModo(claude),modoCodex=validarModoCodex(codex);
        // Cria antes de gravar: se falhar, o admin vê o erro e nada fica pela metade.
        await criarUsuario(user);
        amb={tipo:'proprio',user,areas:ids,claude:modo,codex:modoCodex,repoDir:ids.length?areasPorId.get(ids[0]).caminho:pastaPadrao.replaceAll('{user}',user)};
      }
      return mudar(async()=>{
        if(achar(e))throw problem(409,'Essa pessoa já existe. Gere um link novo pra ela.');
        const p={email:e,nome:n,papel,estado:'convidada',ambiente:amb,apps:appsOk,criadaEm:new Date(agora()).toISOString()};
        dados.pessoas.push(p);
        return {pessoa:publico(p),token:novoLink('convite',e)};
      }).then(async r=>{if(amb&&(amb.areas.length||amb.claude!=='propria'||amb.codex!=='propria'))await aplicar([amb.user]);return r;});
    },
    // Convidada ainda sem senha ganha convite novo (24 h); quem já tem senha, link de senha (1 h).
    async gerarLink(email,{zerarDois=false}={}){
      return mudar(async()=>{
        const p=achar(email);if(!p)throw problem(404,'Pessoa não encontrada.');
        if(p.estado==='desativada')throw problem(409,'Reative a pessoa antes.');
        if(zerarDois){delete p.dois;delete p.doisPendente;}
        const tipo=p.senha?'senha':'convite';
        return {tipo,token:novoLink(tipo,email),expira:new Date(agora()+PRAZOS[tipo]).toISOString()};
      });
    },
    async editar(email,{papel,apps,nome,areas:novasAreas,claude,codex,darAmbiente},quem){
      const appsOk=apps===undefined?undefined:validarApps(apps);
      const areasOk=novasAreas===undefined?undefined:validarAreas(novasAreas);
      const modoOk=claude===undefined?undefined:validarModo(claude);
      const codexOk=codex===undefined?undefined:validarModoCodex(codex);
      let mudouArea=null;
      // Dar ambiente a quem ainda não tem (ex.: alguém que só usava um app): cria o usuário
      // Linux antes de gravar, igual ao convite.
      if(darAmbiente){
        await carregar();
        const alvo=achar(email);if(!alvo)throw problem(404,'Pessoa não encontrada.');
        if(alvo.ambiente)throw problem(409,'Essa pessoa já tem ambiente.');
        if(!criarUsuario)throw problem(400,'Esta instalação não cria ambientes.');
        const user=String(darAmbiente.usuario??'').trim();
        if(!USUARIO.test(user))throw problem(400,'Usuário Linux inválido: letras minúsculas, números, - e _, começando com letra.');
        if(dados.pessoas.some(p=>p.ambiente?.user===user))throw problem(409,'Esse usuário Linux já é de outra pessoa.');
        const ids=validarAreas(novasAreas??[...areasPorId.keys()]);
        const modo=validarModo(claude),modoCodex=validarModoCodex(codex);
        await criarUsuario(user);
        await mudar(async()=>{const p=achar(email);p.ambiente={tipo:'proprio',user,areas:ids,claude:modo,codex:modoCodex,repoDir:ids.length?areasPorId.get(ids[0]).caminho:pastaPadrao.replaceAll('{user}',user)};});
        await aplicar([user]);
        return publico(achar(email));
      }
      const r=await mudar(async()=>{
        const p=achar(email);if(!p)throw problem(404,'Pessoa não encontrada.');
        if(papel!==undefined){
          if(!['admin','membro'].includes(papel))throw problem(400,'Papel inválido.');
          if(p.papel==='admin'&&papel!=='admin'&&!dados.pessoas.some(x=>x!==p&&x.papel==='admin'&&x.estado==='ativa'))throw problem(409,'Precisa sobrar pelo menos um administrador.');
          if(email===quem&&papel!=='admin')throw problem(409,'Você não pode tirar o seu próprio acesso de administrador.');
          p.papel=papel;
        }
        if(appsOk!==undefined)p.apps=appsOk;
        if(nome!==undefined)p.nome=validarNome(nome);
        if(modoOk!==undefined){
          if(p.ambiente?.tipo!=='proprio')throw problem(409,'Só quem tem ambiente próprio escolhe a conta do Claude.');
          if(modoOk!==(p.ambiente.claude??'propria'))mudouArea=p.ambiente.user;
          p.ambiente.claude=modoOk;
        }
        if(codexOk!==undefined){
          if(p.ambiente?.tipo!=='proprio')throw problem(409,'Só quem tem ambiente próprio escolhe a conta do Codex.');
          if(codexOk!==(p.ambiente.codex??'propria'))mudouArea=p.ambiente.user;
          p.ambiente.codex=codexOk;
        }
        if(areasOk!==undefined){
          if(p.ambiente?.tipo!=='proprio')throw problem(409,'Só quem tem ambiente próprio entra em área.');
          if(JSON.stringify(areasOk)!==JSON.stringify(p.ambiente.areas??[])){
            p.ambiente.areas=areasOk;mudouArea=p.ambiente.user;
            // a pasta de trabalho segue a primeira área; sem área, volta pra home
            p.ambiente.repoDir=areasOk.length?areasPorId.get(areasOk[0]).caminho:pastaPadrao.replaceAll('{user}',p.ambiente.user);
          }
        }
        return publico(p);
      });
      if(mudouArea)await aplicar([mudouArea]);
      return r;
    },
    async desativar(email,quem){
      const r=await mudar(async()=>{
        const p=achar(email);if(!p)throw problem(404,'Pessoa não encontrada.');
        if(email===quem)throw problem(409,'Você não pode desativar a si mesmo.');
        if(p.papel==='admin'&&!dados.pessoas.some(x=>x!==p&&x.papel==='admin'&&x.estado==='ativa'))throw problem(409,'Precisa sobrar pelo menos um administrador.');
        p.estado='desativada';
        dados.links=dados.links.filter(l=>l.email!==email);
        revogarSessoes(email);
        return publico(p);
      });
      await api.flush();
      // desativada sai das áreas (o usuário Linux fica, sem acesso ao repo do time)
      if(r.ambiente?.tipo==='proprio'&&r.ambiente.areas?.length)await aplicar([r.ambiente.user]);
      return r;
    },
    async reativar(email){
      const r=await mudar(async()=>{
        const p=achar(email);if(!p)throw problem(404,'Pessoa não encontrada.');
        p.estado=p.senha?'ativa':'convidada';
        return publico(p);
      });
      if(r.ambiente?.tipo==='proprio'&&r.ambiente.areas?.length)await aplicar([r.ambiente.user]);
      return r;
    },

    // ── áreas e pastas restritas ──
    areas:()=>[...areasPorId.values()].map(({id,nome,caminho})=>({id,nome:nome??id,caminho})),
    restritasLigadas:comRestritas,
    async listarRestritas(){await carregar();return comRestritas?dados.restritas.map(r=>({...r})):[];},
    // pasta = caminho relativo dentro da área; pessoas = e-mails liberados (o dono da área sempre pode)
    async restringir(area,pasta,pessoas){
      if(!comRestritas)throw problem(400,'Pasta restrita só existe no modo restrito. Nesta Ratoeira todo mundo confia em todo mundo (modo confiança).');
      if(!areasPorId.has(area))throw problem(400,'Área desconhecida.');
      const rel=String(pasta??'').trim().replace(/^\/+|\/+$/g,'');
      if(!rel||rel.split('/').some(x=>!x||x==='.'||x==='..'||x==='.git'||/[\x00-\x1f\\]/.test(x)))throw problem(400,'Informe o caminho da pasta dentro da área, ex.: financeiro ou clientes/acme.');
      const lista=[...new Set((pessoas??[]).map(e=>String(e).toLowerCase()))];
      await mudar(async()=>{
        for(const e of lista){const p=achar(e);if(!p||p.ambiente?.tipo!=='proprio'||!(p.ambiente.areas??[]).includes(area))throw problem(400,`${e} não trabalha nessa área.`);}
        dados.restritas=dados.restritas.filter(r=>!(r.area===area&&r.pasta===rel));
        dados.restritas.push({area,pasta:rel,pessoas:lista});
      });
      await aplicar();
      return {area,pasta:rel,pessoas:lista};
    },
    async liberarPasta(area,pasta){
      const rel=String(pasta??'').replace(/^\/+|\/+$/g,'');
      await mudar(async()=>{
        const antes=dados.restritas.length;
        dados.restritas=dados.restritas.filter(r=>!(r.area===area&&r.pasta===rel));
        if(dados.restritas.length===antes)throw problem(404,'Essa pasta não está restrita.');
      });
      await aplicar();
      return {ok:true};
    },
    // Pra área Arquivos: essa pessoa NÃO vê este caminho (relativo à área)? A regra do disco é a
    // mesma (aplicar-acessos); aqui só esconde da tela, porque o gateway lê tudo como o grupo dele.
    bloqueado(email,areaId,rel){
      if(!comRestritas)return false;
      for(const r of dados?.restritas??[]){
        if(r.area!==areaId||r.pessoas.includes(email))continue;
        if(rel===r.pasta||rel.startsWith(r.pasta+'/'))return true;
      }
      return false;
    },
    // o gateway reaplica ao ligar: depois do root instalar, tokens do Claude e logins do Codex saem do cadastro
    reaplicar:async()=>{await aplicar();if(aoMudarAcessos)await mudar(async()=>{for(const c of dados.claudeContas)delete c.token;for(const c of dados.codexContas)delete c.auth;});},

    // ── Contas do Claude da organização (tokens de `claude setup-token`, valem 1 ano). Várias desde 10/10/2026:
    // cada uma com nome e quem pode usar (pessoas: null = todos que não estão no modo própria). ──
    claudeContas(){return (dados?.claudeContas??[]).map(c=>({id:c.id,nome:c.nome,desde:c.desde,pessoas:c.pessoas??null,...(c.token?{pendente:true}:{})}));},
    async adicionarClaudeConta({nome,token,pessoas=null}={}){
      const t=String(token??'').trim();
      if(!TOKEN_CLAUDE.test(t))throw problem(400,'Token inválido: é o que o claude setup-token mostra no fim, começando com sk-ant-oat01-.');
      const quem=validarQuem(pessoas);
      await mudar(async()=>{
        if(dados.claudeContas.length>=20)throw problem(400,'Já são 20 contas.');
        // o token sai do cadastro depois de instalado; o hash fica, pra perceber a mesma conta de novo
        if(dados.claudeContas.some(c=>c.hash===hashToken(t)||c.token===t))throw problem(409,'Essa conta já está na lista.');
        let id;do{id=randomBytes(6).toString('hex').slice(0,8);}while(dados.claudeContas.some(c=>c.id===id));
        dados.claudeContas.push({id,nome:nomeConta(nome)||'Conta '+(dados.claudeContas.length+1),desde:new Date(agora()).toISOString(),token:t,hash:hashToken(t),pessoas:quem});
      });
      // conta nova não precisa religar ninguém: a lista do seletor lê o disco na hora
      await instalarClaude([]);
      return api.claudeContas();
    },
    async editarClaudeConta(id,{nome,pessoas}={}){
      if(!ID_CONTA.test(String(id)))throw problem(404,'Conta não encontrada.');
      const quem=pessoas===undefined?undefined:validarQuem(pessoas);
      const podem=c=>new Set(usamClaudeOrg().filter(u=>!c.pessoas||c.pessoas.some(e=>achar(e)?.ambiente?.user===u)));
      let perderam=[];
      await mudar(async()=>{
        const c=dados.claudeContas.find(x=>x.id===id);if(!c)throw problem(404,'Conta não encontrada.');
        if(nome!==undefined){const n=nomeConta(nome);if(!n)throw problem(400,'Dê um nome pra conta.');c.nome=n;}
        if(quem!==undefined){const antes=podem(c);c.pessoas=quem;const depois=podem(c);perderam=[...antes].filter(u=>!depois.has(u));}
      });
      // a ACL vale na hora; quem perdeu o acesso ainda tem o token na memória até religar
      await instalarClaude(perderam);
      return api.claudeContas();
    },
    async removerClaudeConta(id){
      await mudar(async()=>{const n=dados.claudeContas.length;dados.claudeContas=dados.claudeContas.filter(c=>c.id!==id);if(dados.claudeContas.length===n)throw problem(404,'Conta não encontrada.');});
      await instalarClaude(usamClaudeOrg());
      return api.claudeContas();
    },
    // ── Cofre de chaves (1Password): o token de uma service account, que os agentes de quem tem ambiente usam ──
    // info: o que o gateway leu do 1Password ao testar o token (conta e vaults visíveis), pra tela mostrar.
    // usuários Linux de quem tem ambiente próprio e está ativa (ligar o servidor de agentes de todo mundo no boot)
    usuariosLinux(){return (dados?.pessoas??[]).filter(p=>p.ambiente?.tipo==='proprio'&&p.estado!=='desativada').map(p=>p.ambiente.user);},
    cofre(){const c=dados?.cofre;return c?{configurado:true,desde:c.desde,...(c.conta?{conta:c.conta}:{}),vaults:c.vaults??[]}:{configurado:false};},
    async definirCofre(token,info={}){
      const t=String(token??'').trim();
      if(!TOKEN_COFRE.test(t))throw problem(400,'Token inválido: é o da service account do 1Password, que começa com ops_.');
      const vaults=Array.isArray(info.vaults)?info.vaults.map(String).slice(0,50):[];
      await mudar(async()=>{dados.cofre={token:t,desde:new Date(agora()).toISOString(),...(info.conta?{conta:String(info.conta)}:{}),vaults};});
      // o agente de cada um só pega o grupo novo quando religa
      await aplicar(dados.pessoas.filter(p=>p.ambiente?.tipo==='proprio'&&p.estado!=='desativada').map(p=>p.ambiente.user));
      return api.cofre();
    },
    async removerCofre(){
      await mudar(async()=>{delete dados.cofre;});
      await aplicar(dados.pessoas.filter(p=>p.ambiente?.tipo==='proprio'&&p.estado!=='desativada').map(p=>p.ambiente.user));
      return api.cofre();
    },
    // ── Ditado (microfone do chat): chave do AssemblyAI da organização. Sem ela, o ditado usa o motor da própria VPS.
    // O root grava num arquivo que o grupo ratoeira-pessoas já lê: vale na hora, ninguém religa. ──
    // ── E-mail da Ratoeira (email.mjs) e "Esqueci a senha" ──
    email(){return emailPublico(dados?.email,{esqueciSenha:Boolean(dados?.email&&dados?.esqueciSenha)});},
    emailConfig:()=>dados?.email??null,
    // valida sem gravar (a tela testa o envio antes de salvar); senha ou chave vazia = mantém a guardada
    validarEmail:c=>validarEmailConfig(c,dados?.email),
    async definirEmail(cfg){
      await mudar(async()=>{dados.email={...cfg,desde:new Date(agora()).toISOString()};});
      return api.email();
    },
    async removerEmail(){await mudar(async()=>{delete dados.email;delete dados.esqueciSenha;});return api.email();},
    async definirEsqueci(ligar){
      if(typeof ligar!=='boolean')throw problem(400,'Valor inválido.');
      await mudar(async()=>{
        if(ligar&&!dados.email)throw problem(409,'Configure o e-mail da Ratoeira antes.');
        if(ligar)dados.esqueciSenha=true;else delete dados.esqueciSenha;
      });
      return api.email();
    },
    esqueciLigado:()=>Boolean(dados?.email&&dados?.esqueciSenha),
    // Pedido da tela de entrar. Devolve {email, nome, token} pra mandar, ou null (conta que não existe, sem senha,
    // ou passou do limite). Quem pede vê a mesma resposta nos dois casos.
    async pedirLinkPorEmail(emailBruto,ip=null){
      await carregar();
      if(!api.esqueciLigado())return null;
      const email=String(emailBruto??'').trim().toLowerCase();
      if(!EMAIL.test(email))return null;
      if(ip&&!contarPedido('i:'+ip,10))return null;
      const p=achar(email);
      if(!p||p.estado!=='ativa'||!p.senha)return null;
      if(!contarPedido('e:'+email,3))return null;
      const token=await mudar(async()=>novoLink('senha',email));
      await registrar({evento:'pediu-senha',email,ip});
      return {email,nome:p.nome,token};
    },
    ditado(){const d=dados?.ditado;return d?{configurado:true,desde:d.desde}:{configurado:false};},
    async definirDitado(chave){
      const c=String(chave??'').trim();
      if(!CHAVE_DITADO.test(c))throw problem(400,'Isso não parece uma chave do AssemblyAI.');
      await mudar(async()=>{dados.ditado={chave:c,desde:new Date(agora()).toISOString()};});
      await aplicar([]);
      return api.ditado();
    },
    async removerDitado(){
      await mudar(async()=>{delete dados.ditado;});
      await aplicar([]);
      return api.ditado();
    },
    // ── Boas-vindas (docs/2026-10-17-boas-vindas.md): se a pessoa já passou por elas e o que marcou na lista ──
    async boasVindas(email){
      await carregar();const p=achar(email);if(!p)return null;
      const b=p.boasVindas??{},antiga=!b.zerado&&(!p.criadaEm||p.criadaEm<dados.boasVindasDesde);
      return {mostrar:!b.concluido&&!b.pulado&&!antiga,concluido:b.concluido??null,pulado:b.pulado??null,
        lista:!b.listaFechada&&!antiga,marcados:Array.isArray(b.marcados)?b.marcados:[]};
    },
    async definirBoasVindas(email,{acao,item}={}){
      if(!BOAS_VINDAS_ACOES.includes(acao))throw problem(400,'Ação inválida.');
      if((acao==='marcar'||acao==='desmarcar')&&!BOAS_VINDAS_ITENS.includes(item))throw problem(400,'Item inválido.');
      await mudar(async()=>{
        const p=achar(email);if(!p)throw problem(404,'Pessoa não encontrada.');
        const b=p.boasVindas??{},quando=new Date(agora()).toISOString();
        // zerar (pra testar, conta.mjs boas-vindas): volta a mostrar, até pra quem já existia antes delas
        if(acao==='zerar'){p.boasVindas={zerado:quando};return;}
        if(acao==='concluir')b.concluido=quando;
        if(acao==='pular')b.pulado=quando;
        if(acao==='fechar-lista')b.listaFechada=quando;
        if(acao==='abrir-lista')delete b.listaFechada;
        const m=new Set(b.marcados??[]);if(acao==='marcar')m.add(item);if(acao==='desmarcar')m.delete(item);
        if(m.size)b.marcados=[...m];else delete b.marcados;
        p.boasVindas=b;
      });
      return api.boasVindas(email);
    },
    // ── Padrão do chat (admin) e o que cada pessoa sobrescreveu ──
    chatPadrao(){return dados?.chatPadrao??{agentes:{}};},
    async definirChatPadrao(e){const v=validarEscolhasChat(e);await mudar(async()=>{dados.chatPadrao=v;});return v;},
    chatEscolhas(email){return achar(email)?.chat??{agentes:{}};},
    // ── Áreas da pessoa e a aberta na Mesa (null = não tem pra escolher: nenhuma ou uma só que existe) ──
    areasDe(email){
      const amb=ambienteDe(achar(email))?.pessoa;if(!amb)return null;
      const lista=amb.areas.map(id=>areasPorId.get(id)).filter(a=>existe(a.caminho)).map(a=>({id:a.id,nome:a.nome??a.id}));
      if(lista.length<2)return null;
      return {lista,aberta:amb.areas.map(id=>areasPorId.get(id)).find(a=>a.caminho===amb.repoDir)?.id??null};
    },
    async abrirArea(email,id){
      await mudar(async()=>{
        const p=achar(email);if(!p||p.estado!=='ativa'||p.ambiente?.tipo!=='proprio')throw problem(404,'Tua conta não tem ambiente nesta Ratoeira.');
        if(!areasValidas(p.ambiente.areas??[]).includes(id)||!existe(areasPorId.get(id).caminho))throw problem(400,'Essa área não é tua ou não existe mais.');
        p.ambiente.areaAberta=id;
      });
      return api.areasDe(email);
    },
    async definirChatEscolhas(email,e){
      const v=validarEscolhasChat(e,{pasta:true});
      await mudar(async()=>{const p=achar(email);if(!p)throw problem(404,'Pessoa não encontrada.');if(v.agente||v.pasta||Object.keys(v.agentes).length)p.chat=v;else delete p.chat;});
      return v;
    },
    // ── Contas do Codex da organização (login do ChatGPT feito pelo gateway, codex login --device-auth). Várias desde
    // 28/10/2026, como as do Claude: nome, conta e plano do login, e quem pode usar (pessoas: null = todos que não
    // estão no modo própria). auth: o auth.json que o login gerou, guardado só até o root instalar. ──
    codexContas(){return (dados?.codexContas??[]).map(c=>({id:c.id,nome:c.nome,desde:c.desde,...(c.conta?{conta:c.conta}:{}),...(c.plano?{plano:c.plano}:{}),pessoas:c.pessoas??null,...(c.auth?{pendente:true}:{})}));},
    // id: entrar de novo numa que já existe (o login venceu ou foi trocado); sem id, conta nova
    async adicionarCodexConta(auth,{nome,id:qual}={}){
      if(!auth||typeof auth!=='object'||auth.auth_mode!=='chatgpt'||typeof auth.tokens?.refresh_token!=='string'||!auth.tokens.refresh_token)
        throw problem(400,'O login do Codex não gerou uma conta do ChatGPT. Tente de novo.');
      const {conta,plano}=identidadeCodex(auth.tokens.id_token);let religar=[];
      await mudar(async()=>{
        const existe=qual&&dados.codexContas.find(c=>c.id===qual);
        if(existe){Object.assign(existe,{desde:new Date(agora()).toISOString(),auth});if(conta)existe.conta=conta;if(plano)existe.plano=plano;religar=usamCodexOrg();return;}
        if(dados.codexContas.length>=20)throw problem(400,'Já são 20 contas.');
        let id;do{id=randomBytes(6).toString('hex').slice(0,8);}while(dados.codexContas.some(c=>c.id===id));
        dados.codexContas.push({id,nome:nomeConta(nome)||conta||'Conta '+(dados.codexContas.length+1),desde:new Date(agora()).toISOString(),...(conta?{conta}:{}),...(plano?{plano}:{}),pessoas:null,auth});
      });
      // conta nova não precisa religar ninguém (a lista do seletor lê o disco na hora); login novo numa que existe, sim
      await instalarCodex(religar);
      return api.codexContas();
    },
    async editarCodexConta(id,{nome,pessoas}={}){
      if(!ID_CONTA.test(String(id)))throw problem(404,'Conta não encontrada.');
      const quem=pessoas===undefined?undefined:validarQuem(pessoas);
      const podem=c=>new Set(usamCodexOrg().filter(u=>!c.pessoas||c.pessoas.some(e=>achar(e)?.ambiente?.user===u)));
      let perderam=[];
      await mudar(async()=>{
        const c=dados.codexContas.find(x=>x.id===id);if(!c)throw problem(404,'Conta não encontrada.');
        if(nome!==undefined){const n=nomeConta(nome);if(!n)throw problem(400,'Dê um nome pra conta.');c.nome=n;}
        if(quem!==undefined){const antes=podem(c);c.pessoas=quem;const depois=podem(c);perderam=[...antes].filter(u=>!depois.has(u));}
      });
      // a ACL vale na hora; quem perdeu o acesso ainda tem o login na memória até religar
      await instalarCodex(perderam);
      return api.codexContas();
    },
    async removerCodexConta(id){
      await mudar(async()=>{const n=dados.codexContas.length;dados.codexContas=dados.codexContas.filter(c=>c.id!==id);if(dados.codexContas.length===n)throw problem(404,'Conta não encontrada.');});
      await instalarCodex(usamCodexOrg());
      return api.codexContas();
    },
    // Só pela VPS (conta.mjs ambiente): liga a conta a um usuário Linux que já existe (criado pelo
    // adicionar-pessoa), em todas as áreas. Usado pra tirar alguém do Paseo único (migrar-paseo-unico).
    async definirAmbiente(email,{user,claude}){
      if(!USUARIO.test(String(user??'')))throw problem(400,'Usuário Linux inválido.');
      const modo=validarModo(claude);
      const ids=[...areasPorId.keys()];
      const r=await mudar(async()=>{
        const p=achar(email);if(!p)throw problem(404,'Pessoa não encontrada.');
        if(dados.pessoas.some(x=>x!==p&&x.ambiente?.user===user))throw problem(409,'Esse usuário Linux já é de outra pessoa.');
        p.ambiente={tipo:'proprio',user,areas:ids,claude:modo,repoDir:ids.length?areasPorId.get(ids[0]).caminho:pastaPadrao.replaceAll('{user}',user)};
        return publico(p);
      });
      return r;
    },
    // Só pela VPS (conta.mjs): liga ou desliga o Paseo único pra alguém. Nunca pela tela:
    // esse Paseo roda como um usuário com sudo (o dono da instalação).
    async compartilhado(email,ligar){
      return mudar(async()=>{
        const p=achar(email);if(!p)throw problem(404,'Pessoa não encontrada.');
        if(ligar){if(p.ambiente?.tipo==='proprio')throw problem(409,'Essa pessoa já tem ambiente próprio.');p.ambiente={tipo:'compartilhado'};}
        else if(p.ambiente?.tipo==='compartilhado')p.ambiente=null;
        return publico(p);
      });
    },
  };
  return api;
}
