// Servidor de agentes da Ratoeira: um por pessoa (ratoeira-agentes@<usuário>), rodando como ela.
// Fala ACP (Agent Client Protocol) com os adaptadores oficiais (claude-agent-acp, codex-acp e o que
// mais estiver em agentes.json) e atende o gateway por WebSocket num socket unix que só o gateway abre.
//
// Por que existe: segura a conversa viva com o navegador fechado. Guarda os eventos de cada conversa
// (quem reconecta recebe tudo de novo) e os pedidos de permissão até alguém responder.
// Desenho e teste: docs/2026-10-08-acp-no-lugar-do-paseo.md.
//
// Conversa dormindo (desde 14/10/2026): cada conversa carregada é um processo `claude` de ~200 MB. Parada há
// `dormirMin` (60, o tempo do cache), ou além das `maxAcordadas` (5) mais recentes, ela dorme: o processo
// fecha (session/close) e os eventos ficam aqui. Abrir uma dormindo só mostra o guardado; o processo volta
// (session/resume, sem repetir o histórico) quando ela precisa: mandar mensagem ou trocar opção.
// No dia 13/10 eram 21 processos de uma pessoa só (o chat abre todas as abas a cada reconexão) e a VPS foi pro swap.
//
// Protocolo com o navegador (JSON, um objeto por mensagem):
//   pedido   {id, op, ...}  →  {t:'resposta', id, ok, dados | erro}
//   op: agentes | opcoes {agente, cwd?, conta?} | listar {agente?, cwd?}
//       nova {agente, cwd, mcp?, opcoes?: {configId: valor}, texto? | blocos?} | abrir {agente, sessao, cwd?, mcp?, recarregar?}
//         (recarregar: conversa já aberta e parada volta a carregar, pra ganhar as ferramentas de `mcp`)
//       assinar {agente, sessao, desde} | soltar {agente, sessao} | enviar {agente, sessao, texto | blocos, aparelho?}
//         (blocos: os do ACP — text, image {mimeType, data}, resource_link {uri, name}; o chat manda imagem colada e arquivo citado com @)
//       cancelar {agente, sessao} | opcao {agente, sessao, opcao, valor}
//       permitir {agente, sessao, pedido, opcao} | responder {agente, sessao, pedido, resposta: {action, content?}}
//         (responder: pergunta com opções do agente, a AskUserQuestion do Claude, vinda como elicitation de formulário)
//       renomear {agente, sessao, titulo}  (título vazio volta ao do agente)
//       habilidades  (skills globais da pessoa: ~/.claude/skills e ~/.codex/skills)
//       comandos {agente} → [{name, description, input}]  (o menu do `/` da conversa nova: a última lista que o agente anunciou)
//       ler {raiz, caminho} → {texto, hash} | salvar {raiz, caminho, texto, base, forcar?} → {hash, commit} ou {conflito}
//       apagar {raiz, caminho} → {commit}  (só arquivo, pelo menu da árvore; commit "Apagado na tela" no nome da pessoa)
//       publicar {raiz, arquivo, nome, titulo?, acesso, senha?, junto[], modo, dono} → {nome, entrada, modo, commit}  (diálogo Publicar)
//       despublicar {raiz, nome} → {commit}
//       automacoes → {texto, estados, status} | automacao-alternar {linha, texto, ligar} | automacao-log {nome}
//       rotinas → [{id, nome, quando, agente, pasta, ligada, pedido, estado, sessao}] | rotina-alternar {rotina, ligar} | rotina-rodar {rotina}
//       rotina-salvar {rotina?, nome, quando, agente, pasta, pedido, avisar?, ligada} → {rotina, rotinas}  (sem rotina = nova) | rotina-apagar {rotina}
//       abertas → [{aparelho, tipo, em, conversas:[{agente, sessao, cwd, titulo}]}]  (mais recente primeiro)
//       abertas-gravar {aparelho, tipo: celular|computador, conversas}  (as abas de conversa deste navegador)
//       (`id` é o número do pedido: parâmetro de op nunca se chama id)
//       integracoes {cwd?, atualizar?} → {claude:[{nome,alvo,estado,origem}], codex:[...], em}
//       chaves-locais {raiz} → [{tipo:'env', nome, onde:[...]}]  (.env fora do git: só o nome das variáveis)
//       transcrever {audio (base64), mime, duracaoMs, raiz?} → {texto, ms, motor}  (ditado do compositor, transcrever.mjs:
//         AssemblyAI com chave, senão o ratoeira-ditado local)
//       ditado-estado {fresco?} → {motor, origem, local} | ditado-aquecer (o local carrega o modelo)
//       anexo {nome, dados (base64)} → {caminho, nome, tamanho}  (arquivo que não é imagem solto no chat; ver MAX_ANEXO)
//       terminais | terminal-abrir | terminal-assinar | terminal-entrada | terminal-tamanho | terminal-fechar
//         (o terminal da grade: o shell da pessoa num PTY; protocolo em terminal.mjs)
//   evento   {t:'evento', agente, sessao, seq, update}   (update no formato do ACP, mais os ratoeira_*)
//   enviar com a conversa rodando entra no turno em andamento (extensão _session/steering dos dois adaptadores):
//   o agente lê sem parar o que está fazendo, como no Claude Code do terminal
//   estado   {t:'estado', agente, sessao, estado}        (livre | rodando | esperando)
//   contas {agente} → {modo, ativa, podeTrocar, contas:[{id, tipo, nome, completa, limites}]} | conta-usar {agente, conta}
//     (várias contas do Claude: org:<id>, pessoal:<id>, propria; a escolhida é a padrão das conversas novas)
//   conversa-conta {agente, sessao, conta} → resumo   (desde 16/10/2026, a conta é de cada conversa: um adaptador
//     por conta; trocar faz a conversa dormir e acordar no adaptador da outra, com o mesmo histórico;
//     evento ratoeira_conta {conta} pra quem está com ela aberta). nova também aceita conta.
//   conversa-ultracode {agente, sessao, ligar} → resumo   (desde 16/10/2026: ultracode por conversa, só no Claude.
//     Vai nas configurações da sessão quando ela abre, então ligar ou desligar faz a conversa dormir e acordar
//     com o mesmo histórico, como a troca de conta; evento ratoeira_ultracode {ultracode}). nova aceita ultracode.
//   conta    {t:'conta', agente}                        (a conta mudou: quem mostra a lista relê)
//   presenca {t:'presenca', agente, sessao, pessoas:[{email, nome, convidado}]}   (quem está com a conversa aberta)
//   enfileirar {agente, sessao, blocos} → {item} | fila-tirar {agente, sessao, item} | fila-agora {agente, sessao, item}
//     (fila: espera o turno acabar e vai sozinha; evento ratoeira_fila {fila, parada})
//   digitando {agente, sessao, ativo} → pros outros: {t:'digitando', agente, sessao, pessoa, ativo}
//   nota {agente, sessao, texto, apos} → {id}   (nota interna: evento ratoeira_nota pra tela, nada pro agente;
//     guardada em ~/.local/state/ratoeira/notas/<agente>-<sessao>.json e repetida depois do histórico ao reabrir)
//
// Conversa compartilhada (desde 15/10/2026, docs/2026-10-15-conversa-compartilhada.md): o gateway põe em cada
// conexão o cabeçalho x-ratoeira-quem (base64url de {email, nome, convite?}). Quem vem com convite é uma pessoa
// entrando na conversa do dono deste servidor: só abre, assina e solta aquela conversa (modo ler) e, no modo
// entrar, também manda mensagem e para. A mensagem leva o autor (user_message_chunk com ratoeira_autor) e, se a
// conversa está marcada como compartilhada (POST /compartilhada), vai pro agente como "[Nome]: texto".
//
// Conexões (login do Claude e do Codex da pessoa), por HTTP no mesmo socket. Comandos fixos, nunca
// texto vindo de fora; o único dado que entra é o código colado no login do Claude, como entrada.
//   GET  /conta/<claude|codex>/status         →  {stdout, stderr, code, missing, propria, geralDisponivel, geralFixa}
//   POST /conta/<claude|codex>/login          →  NDJSON: {fluxo} e depois {saida}... e {fim: código}
//   POST /conta/<claude|codex>/sair           →  {ok, religou}: desconecta a própria (volta pra geral, se puder)
//   POST /conta/fluxo/<fluxo>/entrada (texto) →  204
//   GET  /conta/claude/contas | POST /conta/claude/usar {conta} | POST /conta/claude/pessoais {nome, token}
//   POST /conta/claude/pessoais/<id>/remover | POST /conta/claude-token/login (setup-token, pra conta pessoal)
//   POST /conta/claude-conta/login?nome=&id=  (login completo de uma conta pessoal, numa pasta de config só dela;
//     com id de uma que já existe, entra de novo nela)
// Fechar a resposta do login mata o processo. Um login por vez.
import http from 'node:http';
import {spawn,execFile,execFileSync} from 'node:child_process';
import {Readable,Writable} from 'node:stream';
import {randomUUID,createHash} from 'node:crypto';
import {accessSync,constants as fsc,cpSync,readFileSync,readlinkSync,rmSync,existsSync,statSync,lstatSync,unlinkSync,symlinkSync,mkdirSync,writeFileSync,renameSync,readdirSync,realpathSync,openSync,readSync,writeSync,closeSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {WebSocketServer} from 'ws';
import * as acp from '@agentclientprotocol/sdk';
import {criarTerminais} from './terminal.mjs';
import {criarTranscritor,MAX_AUDIO} from './transcrever.mjs';
import {ehPesado,ehTipoPesado,gravarGitignore,LIMITE as LIMITE_PESADO} from './pesados.mjs';
import {contasCodex,envDaContaCodex,prepararDirCodex,modoCodex,dirPessoais as dirPessoaisCodexDe,arqEscolha as arqEscolhaCodexDe} from './contas-codex.mjs';

const AQUI=path.dirname(fileURLToPath(import.meta.url));
const MAX_EVENTOS=5000;        // por conversa; o resto já está no histórico do próprio agente
const MAX_LISTA=200;
const caminhoOk=p=>typeof p==='string'&&p.startsWith('/')&&!p.includes('\0')&&p.length<4096;
const idOk=v=>typeof v==='string'&&/^[A-Za-z0-9_.:-]{1,200}$/.test(v);
const ID_CONTA=/^[a-z0-9]{1,20}$/;
// Anexo do chat (desde 15/10/2026): arquivo que não é imagem (PDF, planilha, zip...) solto na caixa de mensagem.
// Nenhum adaptador passa esses tipos pro modelo (o do Claude descarta, o do Codex manda base64 como texto): o
// arquivo fica em ~/.local/share/ratoeira/anexos/<dia>/ e o agente lê pelo caminho, com as ferramentas dele.
// Vale só pra conversa, fora do git, de propósito (pôr na pasta de trabalho é o upload da Mesa). Some em 30 dias.
export const MAX_ANEXO=14*1024*1024,DIAS_ANEXO=30;
export const nomeAnexo=n=>String(n??'').split(/[\\/]/).pop().replace(/[\0-\x1f\x7f]/g,'').replace(/^\.+/,'').trim().slice(-120)||'arquivo';
const TOKEN_CLAUDE=/^sk-ant-oat01-[A-Za-z0-9_-]{20,300}$/;
// Ferramentas MCP que um app da Ratoeira entrega pra conversa (ex.: as de um app de pedidos). Só HTTP e só
// nesta máquina: a conversa não vira ponte pra outro endereço.
export function mcpValidos(lista){
  if(lista==null)return [];
  if(!Array.isArray(lista)||lista.length>5)throw Object.assign(new Error('Ferramentas inválidas.'),{publico:true});
  return lista.map(m=>{
    let url;try{url=new URL(m?.url);}catch{}
    const headers=Array.isArray(m?.headers)?m.headers:[];
    if(m?.type!=='http'||!/^[a-z][a-z0-9_-]{0,30}$/.test(m?.name??'')||!url||url.protocol!=='http:'||!['127.0.0.1','localhost'].includes(url.hostname)
      ||headers.length>5||headers.some(h=>typeof h?.name!=='string'||typeof h?.value!=='string'||!/^[A-Za-z0-9-]{1,60}$/.test(h.name)||h.value.length>1000||/[\r\n]/.test(h.value)))
      throw Object.assign(new Error('Ferramentas inválidas.'),{publico:true});
    return {type:'http',name:m.name,url:url.href,headers:headers.map(h=>({name:h.name,value:h.value}))};
  });
}

export function carregarAgentes(arquivo=path.join(AQUI,'agentes.json'),base=AQUI){
  const lista=JSON.parse(readFileSync(arquivo,'utf8'));
  const agentes=new Map();
  for(const [id,def] of Object.entries(lista)){
    if(!/^[a-z][a-z0-9-]{0,30}$/.test(id)||typeof def?.comando!=='string')throw new Error(`agentes.json: agente inválido (${id})`);
    agentes.set(id,{id,nome:def.nome??id,comando:path.resolve(base,def.comando),args:Array.isArray(def.args)?def.args.map(String):[],
      env:def.env&&typeof def.env==='object'?Object.fromEntries(Object.entries(def.env).map(([k,v])=>[k,String(v)])):{},
      modoAutomatico:typeof def.modoAutomatico==='string'?def.modoAutomatico:null});
  }
  return agentes;
}

// Um processo de adaptador por agente e conta (o Claude tem várias contas); cada um atende várias conversas.
class Adaptador{
  constructor(def,{aoAtualizar,aoPedir,aoPerguntar,aoSair,abrirProcesso,log}){Object.assign(this,{def,aoAtualizar,aoPedir,aoPerguntar,aoSair,abrirProcesso,log});this.pronto=null;this.child=null;}
  conexao(){
    if(this.pronto)return this.pronto;
    const p=(async()=>{
      const child=this.abrirProcesso(this.def);this.child=child;
      child.stderr?.on('data',d=>this.log(`[${this.def.id}] ${String(d).trim().slice(0,500)}`));
      child.on('exit',code=>{if(this.child===child){this.child=null;this.pronto=null;this.aoSair(this.def.id,code);}});
      const conn=new acp.ClientSideConnection(()=>({
        sessionUpdate:params=>this.aoAtualizar(this.def.id,params),
        requestPermission:params=>this.aoPedir(this.def.id,params),
        // pergunta do agente em formulário (só form; url, de login de MCP, a gente não declara)
        createElicitation:params=>params?.mode==='url'?{action:'decline'}:this.aoPerguntar(this.def.id,params),
        completeElicitation:()=>{},
      }),acp.ndJsonStream(Writable.toWeb(child.stdin),Readable.toWeb(child.stdout)));
      // recommendedValue (extensão "air" do adaptador do Claude): em vez de "Default" no modelo e no esforço, ele manda
      // os valores concretos (Opus 5.5, medium) e aplica o esforço de verdade; quem não conhece a extensão ignora
      const ini=await conn.initialize({protocolVersion:acp.PROTOCOL_VERSION,clientCapabilities:{elicitation:{form:{}},
        _meta:{jetbrains:{air:{version:1,capabilities:['recommendedValue']}}}}});
      this.capacidades=ini.agentCapabilities??{};this.steering=ini._meta?.steering?.supported===true;
      return conn;
    })();
    this.pronto=p;
    p.catch(()=>{if(this.pronto===p){this.pronto=null;this.child?.kill();}});
    return p;
  }
  parar(){this.child?.kill();this.child=null;this.pronto=null;}
}

// Turno que falhou por falta de conta do agente (o authRequired do ACP, ou o texto dele quando vem sem código).
const CODIGO_SEM_LOGIN=acp.RequestError.authRequired().code;
const semLogin=e=>e?.code===CODIGO_SEM_LOGIN||/authentication required|not logged in|please run \/login/i.test(String(e?.message??''));

// Onde achar os CLIs e o login-runner.py (o mesmo do gateway: /opt/ratoeira/gateway na VPS).
function acharNoPath(nome){
  for(const dir of String(process.env.PATH??'').split(':'))if(dir.startsWith('/')){const f=path.join(dir,nome);try{if(statSync(f).isFile())return f;}catch{}}
  return null;
}
// Conta geral fixa (grupo ratoeira-claude-geral, ver kit/multiusuario/conta-claude): o token do
// ambiente é a conta que vale, mesmo com login próprio no disco.
function gruposDaPessoa(){try{return execFileSync('id',['-nG'],{encoding:'utf8'}).split(/\s+/).filter(Boolean);}catch{return [];}}
// Onde ficam as contas gerais (os mesmos caminhos do conta-claude): quem é do grupo opcional volta pra
// elas ao desconectar a própria.
const padraoContas=()=>{const grupos=gruposDaPessoa();return {
  clis:{claude:acharNoPath('claude'),codex:acharNoPath('codex')},
  // Pelo atalho (AGENTES_DIR=/opt/ratoeira/agentes) primeiro: o AQUI é o caminho resolvido da versão
  // (/opt/ratoeira/versoes/agentes/<versão>), onde não tem ../gateway. Sem isso o login saía na hora (14/10).
  runner:process.env.AGENTES_LOGIN_RUNNER??[process.env.AGENTES_DIR,AQUI].filter(Boolean).map(d=>path.join(d,'..','gateway','login-runner.py')).find(f=>existsSync(f))??path.join(AQUI,'..','gateway','login-runner.py'),
  python:'/usr/bin/python3',home:process.env.HOME??'/tmp',grupos,geralFixa:grupos.includes('ratoeira-claude-geral'),
  geralClaude:process.env.AGENTES_CLAUDE_GERAL??'/etc/ratoeira/claude-geral.token',
  orgClaude:process.env.AGENTES_CLAUDE_ORG??'/etc/ratoeira/claude-contas',
  geralCodex:process.env.AGENTES_CODEX_GERAL??'/var/lib/ratoeira/codex-geral/auth.json',
  orgCodex:process.env.AGENTES_CODEX_ORG??'/var/lib/ratoeira/codex-contas',
};};

// Nomes que a pessoa deu às conversas (renomear no chat). Ficam num arquivo dela, porque nem todo agente
// aceita renomear pelo ACP; valem por cima do título do agente na lista, ao abrir e nos eventos.
// Skills globais da pessoa (as do repo a área Arquivos lista sozinha, pelo índice do git). Só name e
// description do cabeçalho; é uma pasta por skill, então ler é rápido e não precisa de cache.
export function habilidadesGlobais(home=process.env.HOME??'/tmp'){
  const lista=[];
  for(const [de,base] of [['claude',path.join(home,'.claude','skills')],['codex',path.join(home,'.codex','skills')],['agents',path.join(home,'.agents','skills')]]){
    let nomes=[];try{nomes=readdirSync(base);}catch{continue;}
    for(const pasta of nomes.slice(0,300)){
      if(pasta.startsWith('.'))continue;
      let texto;try{const f=path.join(base,pasta,'SKILL.md');if(statSync(f).size>512*1024)continue;texto=readFileSync(f,'utf8');}catch{continue;}
      const cab=(texto.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1]??'');
      const campo=k=>{const m=cab.match(new RegExp('^'+k+':[ \\t]*(.*)((?:\\r?\\n[ \\t]+.*)*)','m'));if(!m)return '';let v=m[1].trim();const resto=m[2].split(/\r?\n/).map(l=>l.trim()).filter(Boolean);
        v=/^[|>][+-]?$/.test(v)?resto.join(' '):[v,...resto].join(' ');return v.replace(/^(['"])([\s\S]*)\1$/,'$2').trim();};
      lista.push({nome:campo('name')||pasta,descricao:campo('description'),de,pasta});
    }
  }
  return lista.sort((a,b)=>a.nome.localeCompare(b.nome,'pt-BR'));
}

// ── Editor de arquivo da área Arquivos ──
// Ler e salvar rodam aqui, como a pessoa: o Linux decide o que ela pode mexer (pastas restritas incluídas),
// igual quando o agente dela edita. Salvar confere se o arquivo mudou desde que ela abriu (hash) e commita
// só ele, no nome dela, como o commit-turno faz com o que o agente edita. O envio fica pro sync.
const MAX_EDITAR=2*1024*1024;
const hashDe=buf=>createHash('sha256').update(buf).digest('hex');
function arquivoEditavel(raiz,caminho,{limite=true}={}){
  const erroPublico=m=>Object.assign(new Error(m),{publico:true});
  if(!caminhoOk(raiz)||typeof caminho!=='string'||!caminho||caminho.length>4000)throw erroPublico('Arquivo inválido.');
  const partes=caminho.split('/');
  if(partes.some(p=>!p||p==='.'||p==='..'||p==='.git'||/[\\\x00-\x1f]/.test(p)))throw erroPublico('Arquivo inválido.');
  let atual=path.resolve(raiz);
  for(const p of partes){
    atual=path.join(atual,p);let st;
    try{st=lstatSync(atual);}catch{throw erroPublico('Arquivo não encontrado.');}
    if(st.isSymbolicLink())throw erroPublico('Atalho (symlink) não abre no editor.');
  }
  const st=statSync(atual);
  if(!st.isFile())throw erroPublico('Não é um arquivo.');
  if(limite&&st.size>MAX_EDITAR)throw erroPublico('Arquivo grande demais pro editor (até 2 MB).');
  return atual;
}
const gitArq=(raiz,args)=>new Promise(ok=>execFile('git',['-C',raiz,...args],{timeout:20000},(e,stdout,stderr)=>ok({code:e?(typeof e.code==='number'?e.code:1):0,stdout:String(stdout),stderr:String(stderr)})));
// apagado=true: o arquivo já saiu do disco (apagar), o caminho no repo vem da pasta dele. acao: começo da mensagem
async function commitarArquivo(raiz,rel,log,{apagado=false,acao=null}={}){
  const topo=await gitArq(raiz,['rev-parse','--show-toplevel']);if(topo.code)return null;   // pasta sem git: só salva
  const real=apagado?path.join(realpathSync(path.dirname(path.join(raiz,rel))),path.basename(rel)):realpathSync(path.join(raiz,rel));
  const repo=topo.stdout.trim(),relRepo=path.relative(realpathSync(repo),real);
  if((await gitArq(repo,['check-ignore','-q','--',relRepo])).code===0)return null;
  for(let i=0;i<10;i++){
    const novo=(await gitArq(repo,['ls-files','--error-unmatch','--',relRepo])).code!==0;
    if(novo&&apagado)return null;   // nunca foi pro git: sumir do disco basta
    if(novo&&(await gitArq(repo,['add','--intent-to-add','--',relRepo])).code)continue;
    const r=await gitArq(repo,['commit','--only','--no-verify','-q','-m',(acao??(apagado?'Apagado na tela: ':'Editado na tela: '))+relRepo,'--',relRepo]);
    if(r.code===0)return (await gitArq(repo,['rev-parse','--short','HEAD'])).stdout.trim();
    if(/nothing to commit|no changes added|nada a submeter/i.test(r.stdout+r.stderr))return null;
    // outra pessoa (ou o sync) com o índice preso: tenta de novo
    if(!/index\.lock/.test(r.stderr)){log(`[salvar] commit falhou: ${r.stderr.trim().slice(0,300)}`);return null;}
    await new Promise(ok=>setTimeout(ok,500));
  }
  return null;
}

// ── Enviar arquivo pela Mesa (desde 15/10/2026) ──
// Arrastar do computador pra uma pasta da árvore. Chega em pedaços (arquivo-enviar, arquivo-parte, arquivo-concluir),
// num rascunho em ~/.cache/ratoeira/envios, e só no fim vai pro lugar: arquivo pela metade nunca aparece na pasta
// nem vai pro git. Grava como a pessoa e commita no nome dela, a não ser que seja pesado (pesados.mjs).
export const MAX_ENVIO=2*1024*1024*1024,MAX_PARTE=8*1024*1024;
const falhaEnvio=m=>Object.assign(new Error(m),{publico:true});
// O caminho de destino (relativo à raiz), conferido parte por parte: nada de "..", oculto ou atalho no meio.
// Pasta que ainda não existe pode (vem de arrastar uma pasta inteira); ela nasce no concluir.
export function destinoEnvio(raiz,caminho){
  if(!caminhoOk(raiz)||!existsSync(raiz))throw falhaEnvio('Pasta de trabalho inválida.');
  if(typeof caminho!=='string'||!caminho||caminho.length>1000)throw falhaEnvio('Nome de arquivo inválido.');
  const partes=caminho.split('/');
  if(partes.some(p=>!p||p==='.'||p==='..'||p.startsWith('.')||p.length>255||/[\\\x00-\x1f\x7f]/.test(p)))
    throw falhaEnvio('Nome inválido: '+caminho+' (arquivo ou pasta começando com ponto não sobe por aqui).');
  let atual=path.resolve(raiz);
  for(let i=0;i<partes.length;i++){
    atual=path.join(atual,partes[i]);let st;
    try{st=lstatSync(atual);}catch{break;}
    if(st.isSymbolicLink())throw falhaEnvio(i<partes.length-1?'A pasta '+partes.slice(0,i+1).join('/')+' é um atalho (aponta pra outro lugar): não dá pra enviar pra dentro dela.':'Já existe um atalho com esse nome.');
    if(i<partes.length-1&&!st.isDirectory())throw falhaEnvio(partes.slice(0,i+1).join('/')+' é um arquivo, não uma pasta.');
    if(i===partes.length-1&&!st.isFile())throw falhaEnvio('Já existe uma pasta com o nome '+partes[i]+'.');
  }
  return {abs:path.join(path.resolve(raiz),...partes),existe:existsSync(path.join(path.resolve(raiz),...partes))};
}
// "foto.png" ocupado → "foto (2).png", "foto (3).png"...
export function nomeLivre(abs){
  if(!existsSync(abs))return abs;
  const ext=path.extname(abs),base=abs.slice(0,abs.length-ext.length);
  for(let n=2;n<10000;n++){const c=`${base} (${n})${ext}`;if(!existsSync(c))return c;}
  throw falhaEnvio('Nomes demais iguais nessa pasta.');
}

// ── Publicar (diálogo da Mesa; o gateway serve, aqui só se grava) ──
// Uma página publicada é playground/<nome>/ratoeira-play.json (o formato está em gateway/playground.mjs). Foto: copia
// o arquivo e o que foi marcado junto pra pasta do item. Ao vivo: só o manifesto, que aponta pro original e lista o
// que pode sair dele. Roda como a pessoa e commita só a pasta do item, no nome dela.
const PUBLICAVEL=/\.(html?|pdf|png|jpe?g|gif|webp|svg|avif|md)$/i;
const NOME_PUB=/^[a-z0-9][a-z0-9-]{0,40}$/;
const MAX_PUB=50*1024*1024;
const relSeguro=r=>typeof r==='string'&&r.length>0&&r.length<=1000&&!r.split('/').some(x=>!x||x==='..'||x.startsWith('.')||/[\\\x00-\x1f]/.test(x));
function tamanhoDe(f){const st=lstatSync(f);if(st.isSymbolicLink())return 0;if(!st.isDirectory())return st.size;let t=0;for(const n of readdirSync(f))if(!n.startsWith('.'))t+=tamanhoDe(path.join(f,n));return t;}
async function commitarPasta(raiz,rel,msg,log){return commitarCaminhos(raiz,[rel],msg,log);}
// Um commit só com o estado atual destes caminhos (arquivo ou pasta, existindo ou não): renomear leva o de e o pra.
async function commitarCaminhos(raiz,rels,msg,log){
  const topo=await gitArq(raiz,['rev-parse','--show-toplevel']);if(topo.code)return null;
  const repo=topo.stdout.trim(),base=realpathSync(repo),todos=rels.map(rel=>path.relative(base,path.join(realpathSync(raiz),rel)));
  // fica só o que o git conhece ou vai conhecer: o caminho que sumiu precisa ter sido versionado, e o que existe não
  // pode ser ignorado (senão o `git add` recusa e nada entra)
  const relsRepo=[];
  for(const r of todos){
    const existe=existsSync(path.join(base,r));
    if(!existe&&!(await gitArq(repo,['ls-files','--',r])).stdout.trim())continue;
    if(existe&&(await gitArq(repo,['check-ignore','-q','--',r])).code===0)continue;
    relsRepo.push(r);
  }
  if(!relsRepo.length)return null;
  for(let i=0;i<10;i++){
    const a=await gitArq(repo,['add','-A','--',...relsRepo]);
    if(a.code&&!/index\.lock/.test(a.stderr)){log(`[publicar] add falhou: ${a.stderr.trim().slice(0,300)}`);return null;}
    const r=a.code?{code:1,stdout:'',stderr:'index.lock'}:await gitArq(repo,['commit','--no-verify','-q','-m',msg,'--',...relsRepo]);
    if(r.code===0)return (await gitArq(repo,['rev-parse','--short','HEAD'])).stdout.trim();
    if(/nothing to commit|no changes added|nada a submeter/i.test(r.stdout+r.stderr))return null;
    if(!/index\.lock/.test(r.stderr)){log(`[publicar] commit falhou: ${r.stderr.trim().slice(0,300)}`);return null;}
    await new Promise(ok=>setTimeout(ok,500));
  }
  return null;
}
// Criar e renomear pela árvore (desde 19/10/2026). Nome com ponto na frente vale (.env): na árvore nada some.
// Só a .git, atalho no caminho e sair da pasta ficam de fora.
const NOME_RUIM=/[\/\\\x00-\x1f\x7f]/;
function partesOk(rel){return rel===''||rel.split('/').every(p=>p&&p!=='.'&&p!=='..'&&p!=='.git'&&p.length<=255&&!NOME_RUIM.test(p));}
function semAtalhoAte(raiz,rel){
  let atual=path.resolve(raiz);
  for(const p of rel?rel.split('/'):[]){atual=path.join(atual,p);let st;try{st=lstatSync(atual);}catch{return {abs:atual,existe:false};}if(st.isSymbolicLink())return {abs:atual,atalho:true};}
  return {abs:atual,existe:true};
}
export function caminhoNovo(raiz,pasta,nome){
  const falha=m=>Object.assign(new Error(m),{publico:true});
  if(!caminhoOk(raiz)||!existsSync(raiz))throw falha('Pasta de trabalho inválida.');
  pasta=typeof pasta==='string'?pasta.replace(/^\/+|\/+$/g,''):'';nome=typeof nome==='string'?nome.trim():'';
  if(!nome||nome==='.'||nome==='..'||nome==='.git'||nome.length>255||NOME_RUIM.test(nome))throw falha('Nome inválido. Sem barra, até 255 letras.');
  if(!partesOk(pasta))throw falha('Pasta inválida.');
  const dir=semAtalhoAte(raiz,pasta);
  if(dir.atalho)throw falha('Essa pasta é um atalho: não dá pra criar dentro dela.');
  if(!dir.existe||!statSync(dir.abs).isDirectory())throw falha('A pasta não existe mais.');
  const rel=pasta?pasta+'/'+nome:nome,abs=path.join(dir.abs,nome);
  let ja=false;try{lstatSync(abs);ja=true;}catch{}
  if(ja)throw falha('Já existe um arquivo ou pasta com esse nome aqui.');
  return {abs,rel};
}
export function itemExistente(raiz,rel){
  const falha=m=>Object.assign(new Error(m),{publico:true});
  if(!caminhoOk(raiz)||typeof rel!=='string'||!rel||!partesOk(rel))throw falha('Arquivo inválido.');
  const r=semAtalhoAte(raiz,rel);
  if(r.atalho)throw falha('Atalho (symlink) não se renomeia por aqui.');
  if(!r.existe)throw falha('Não achei esse arquivo. A árvore pode estar desatualizada.');
  return r.abs;
}
// Arquivo novo: markdown já nasce com o título; o resto, vazio.
export const conteudoInicial=nome=>/\.(md|markdown)$/i.test(nome)?'# '+nome.replace(/\.[^.]+$/,'')+'\n':'';
export function prepararPublicacao(raiz,{arquivo,nome,titulo,acesso='time',senha=null,junto=[],modo='foto',dono=''}={},agora=()=>new Date()){
  const falha=m=>Object.assign(new Error(m),{publico:true});
  if(!caminhoOk(raiz))throw falha('Pasta de trabalho inválida.');
  if(!relSeguro(arquivo)||!PUBLICAVEL.test(arquivo))throw falha('Dá pra publicar HTML, PDF, imagem ou markdown.');
  if(!NOME_PUB.test(nome??''))throw falha('O link aceita só letras minúsculas, números e hífen (até 41).');
  if(!['time','senha','publico'].includes(acesso))throw falha('Quem vê: só o time, com senha ou qualquer um.');
  if(!Array.isArray(junto)||junto.length>200||junto.some(j=>!relSeguro(j)||j.includes('/')))throw falha('Lista do que vai junto inválida.');
  modo=modo==='aovivo'?'aovivo':'foto';
  const origem=path.join(raiz,arquivo),dirOrigem=path.dirname(origem);
  let st;try{st=lstatSync(origem);}catch{throw falha('Arquivo não encontrado.');}
  if(!st.isFile())throw falha('Não é um arquivo.');
  for(const j of junto){try{lstatSync(path.join(dirOrigem,j));}catch{throw falha(`"${j}" não existe do lado do arquivo.`);}}
  const item=path.join(raiz,'playground',nome),manif=path.join(item,'ratoeira-play.json');
  let antes=null;if(existsSync(manif)){try{antes=JSON.parse(readFileSync(manif,'utf8'));}catch{antes={};}}
  if(antes&&antes.origem!==arquivo)throw falha(`O link "${nome}" já é de outra publicação. Escolha outro.`);
  if(!antes&&existsSync(item))throw falha(`Já existe uma pasta playground/${nome}. Escolha outro link.`);
  let sha=null;
  if(acesso==='senha'){
    if(typeof senha==='string'&&senha){if(senha.length<6||senha.length>200)throw falha('A senha precisa de 6 caracteres ou mais.');sha=createHash('sha256').update(senha).digest('hex');}
    else if(/^[a-f0-9]{64}$/.test(antes?.senha_sha256??''))sha=antes.senha_sha256;
    else throw falha('Falta a senha.');
  }
  const total=tamanhoDe(origem)+junto.reduce((t,j)=>t+tamanhoDe(path.join(dirOrigem,j)),0);
  if(modo==='foto'&&total>MAX_PUB)throw falha(`Ficou com ${Math.round(total/1048576)} MB (o limite é 50 MB). Tire algo do que vai junto ou use "Sozinho".`);
  const entrada=modo==='aovivo'?path.basename(arquivo):(antes?.modo!=='aovivo'&&relSeguro(antes?.entrada??'')&&!antes.entrada.includes('/')?antes.entrada:path.basename(arquivo));
  const m={nome,tipo:'pagina',titulo:String(titulo||antes?.titulo||path.basename(arquivo).replace(/\.[^.]+$/,'')).slice(0,80),
    ...(antes?.descricao?{descricao:antes.descricao}:{}),dono:String(antes?.dono||dono||'').slice(0,254),acesso,...(sha?{senha_sha256:sha}:{}),
    ...(antes?.dominio?{dominio:antes.dominio}:{}),origem:arquivo,entrada,junto,modo,...(modo==='aovivo'?{pasta:path.dirname(arquivo)}:{}),
    publicado_em:agora().toISOString(),publicado_por:String(dono||'').slice(0,254)};
  if(modo==='aovivo'&&m.pasta==='.')throw falha('Arquivo na raiz do repositório não publica "Sozinho": use "Quando eu mandar".');
  return {item,manif,m,origem,dirOrigem,entrada,junto,modo};
}
export function gravarPublicacao({item,manif,m,origem,dirOrigem,entrada,junto,modo}){
  mkdirSync(item,{recursive:true});
  // limpa a foto anterior (tudo da pasta do item menos o manifesto) e copia de novo
  for(const n of readdirSync(item))if(n!=='ratoeira-play.json')rmSync(path.join(item,n),{recursive:true,force:true});
  if(modo==='foto'){
    cpSync(origem,path.join(item,entrada));
    for(const j of junto)cpSync(path.join(dirOrigem,j),path.join(item,j),{recursive:true,verbatimSymlinks:true,filter:src=>!path.basename(src).startsWith('.')});
  }
  writeFileSync(manif,JSON.stringify(m,null,2)+'\n');
}

// ── Automações da pessoa ──
// Moram em ~/.config/ratoeira/crontab, que ela e o agente dela editam (o `crontab` não grava daqui:
// NoNewPrivileges). O ajudante de root (ratoeira-automacoes) instala o arquivo como crontab dela em até
// 1 minuto. O invólucro ratoeira-cron grava o resultado de cada uma em ~/.local/state/ratoeira/crons/.
const DESLIGADO='#desligado# ';
export function automacoesDe(home){
  const arq=path.join(home,'.config','ratoeira','crontab'),dir=path.join(home,'.local','state','ratoeira','crons');
  let texto=null;try{texto=readFileSync(arq,'utf8');}catch{}
  const estados={};
  try{for(const n of readdirSync(dir).slice(0,300))if(n.endsWith('.json'))try{estados[n.slice(0,-5)]=JSON.parse(readFileSync(path.join(dir,n),'utf8'));}catch{}}catch{}
  // aviso do ajudante de root (erro de sintaxe, quando instalou); a pasta é legível por quem é dono do status
  let status={};try{status=JSON.parse(readFileSync(path.join('/var/lib/ratoeira-automacoes/status',path.basename(home)+'.json'),'utf8'));}catch{}
  return {texto,estados,status};
}
export function alternarAutomacao(home,linha,esperado,ligar){
  const arq=path.join(home,'.config','ratoeira','crontab');
  const linhas=readFileSync(arq,'utf8').split('\n');
  if(!Number.isInteger(linha)||linha<0||linha>=linhas.length)throw Object.assign(new Error('Linha fora do arquivo. Recarregue a tela.'),{publico:true});
  const base=linhas[linha].startsWith(DESLIGADO)?linhas[linha].slice(DESLIGADO.length):linhas[linha];
  if(base!==esperado)throw Object.assign(new Error('O arquivo mudou desde que a tela abriu. Recarregue.'),{publico:true});
  linhas[linha]=ligar?base:DESLIGADO+base;
  writeFileSync(arq+'.tmp',linhas.join('\n'));renameSync(arq+'.tmp',arq);
}
// ── Rotinas: pedido pro agente num horário, em ~/.config/ratoeira/rotinas/<id>.md (cabeçalho + pedido).
// O ajudante de root põe no crontab dela; o ratoeira-rotina roda e grava qual conversa nasceu.
const ID_ROTINA=/^[a-z0-9][a-z0-9-]{0,59}$/;
const SIM=new Set(['sim','true','yes','1','ligada','on']);
export function cabecalhoRotina(texto){
  const m=String(texto).match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);if(!m)return null;
  const cab={};for(const l of m[1].split(/\r?\n/)){const k=l.match(/^([A-Za-z_]+):\s*(.*)$/);if(k)cab[k[1].toLowerCase()]=k[2].trim().replace(/^(['"])(.*)\1$/,'$2');}
  return {cab,pedido:m[2].trim()};
}
// avisar: quando o sino chama o dono (o ratoeira-rotina decide; falha avisa sempre). Sem o campo = quando-precisar.
const AVISOS_ROTINA=['quando-precisar','sempre','so-erro'];
const modoAviso=v=>{const m=String(v??'').toLowerCase().replace(/_/g,'-').replace(/ó/g,'o');return AVISOS_ROTINA.includes(m)?m:'quando-precisar';};
export function rotinasDe(home){
  const dir=path.join(home,'.config','ratoeira','rotinas'),est=path.join(home,'.local','state','ratoeira','crons');
  let nomes=[];try{nomes=readdirSync(dir);}catch{return [];}
  const out=[];
  for(const n of nomes.slice(0,200)){
    const id=n.replace(/\.md$/,'');if(!n.endsWith('.md')||!ID_ROTINA.test(id))continue;
    let r;try{r=cabecalhoRotina(readFileSync(path.join(dir,n),'utf8'));}catch{continue;}
    if(!r)continue;
    const ler=f=>{try{return JSON.parse(readFileSync(path.join(est,f),'utf8'));}catch{return null;}};
    out.push({id,nome:r.cab.nome||id,quando:r.cab.quando||'',agente:(r.cab.agente||'claude').toLowerCase(),pasta:r.cab.pasta||'',avisar:modoAviso(r.cab.avisar),ligada:SIM.has((r.cab.ligada||'sim').toLowerCase()),
      pedido:r.pedido,estado:ler('rotina-'+id+'.json'),sessao:ler('rotina-'+id+'.sessao')});
  }
  return out.sort((a,b)=>a.nome.localeCompare(b.nome,'pt-BR'));
}
export function alternarRotina(home,id,ligar){
  if(!ID_ROTINA.test(String(id)))throw Object.assign(new Error('Rotina inválida.'),{publico:true});
  const arq=path.join(home,'.config','ratoeira','rotinas',id+'.md');
  const texto=readFileSync(arq,'utf8');const m=texto.match(/^(---\r?\n)([\s\S]*?)(\r?\n---)/);
  if(!m)throw Object.assign(new Error('Rotina sem cabeçalho.'),{publico:true});
  const valor=ligar?'sim':'não';
  const cab=/^ligada:/m.test(m[2])?m[2].replace(/^ligada:.*$/m,'ligada: '+valor):m[2]+'\nligada: '+valor;
  writeFileSync(arq+'.tmp',m[1]+cab+m[3]+texto.slice(m[0].length));renameSync(arq+'.tmp',arq);
}

// ── Chaves em .env fora do git (aluno sem 1Password guarda tudo assim): só o NOME de cada variável com
// cara de chave, pra tela de Integrações avisar o que não está no registro. O valor nunca sai daqui.
const CHAVE=/(KEY|TOKEN|SECRET|PASSWORD|PASS|CREDENTIALS?)$/,PUBLICA=/^(NEXT_PUBLIC_|VITE_|PUBLIC_|EXPO_PUBLIC_)|PUBLISHABLE|ANON_KEY|SITE_KEY/;
export function chavesLocais(raiz){
  const arquivos=[];
  // com git: os .env que o .gitignore esconde; sem git: anda pela pasta (sem node_modules e ocultas, até 6 níveis)
  try{
    const r=execFileSync('git',['-C',raiz,'ls-files','-o','-i','--exclude-standard','-z','--',':(glob)**/.env',':(glob)**/.env.*',':(glob).env',':(glob).env.*'],{encoding:'utf8',timeout:20000,maxBuffer:1<<22,stdio:['ignore','pipe','ignore']});
    for(const f of r.split('\0'))if(f&&!f.includes('node_modules/'))arquivos.push(f);
  }catch{
    (function andar(dir,rel,prof){
      if(prof>6||arquivos.length>200)return;
      let itens=[];try{itens=readdirSync(dir,{withFileTypes:true});}catch{return;}
      for(const it of itens){
        if(it.isDirectory()){if(!it.name.startsWith('.')&&it.name!=='node_modules')andar(path.join(dir,it.name),rel?rel+'/'+it.name:it.name,prof+1);}
        else if(/^\.env(\..+)?$/.test(it.name))arquivos.push(rel?rel+'/'+it.name:it.name);
      }
    })(raiz,'',0);
  }
  const out=new Map();
  for(const rel of arquivos.slice(0,200)){
    let texto='';try{const f=path.join(raiz,rel);if(lstatSync(f).isSymbolicLink()||statSync(f).size>256*1024)continue;texto=readFileSync(f,'utf8');}catch{continue;}
    for(const l of texto.split('\n')){
      const m=l.match(/^\s*(?:export\s+)?([A-Z][A-Z0-9_]{2,})\s*=/);if(!m||!CHAVE.test(m[1])||PUBLICA.test(m[1]))continue;
      const x=out.get(m[1])??{tipo:'env',nome:m[1],onde:[]};if(x.onde.length<3&&!x.onde.includes(rel))x.onde.push(rel);out.set(m[1],x);
    }
  }
  return [...out.values()];
}

// Criar ou mudar uma rotina pela tela (modal de Automações). Sem `rotina` é nova: o id sai do nome, sem repetir.
// Mantém o que a tela não mostra (modelo, permissão…) quando a rotina já existia. Mesmo QUANDO_OK do ajudante de root.
const QUANDO_OK=/^(@(reboot|yearly|annually|monthly|weekly|daily|midnight|hourly)|([0-9A-Za-z*,/-]+\s+){4}[0-9A-Za-z*,/-]+)$/;
export function salvarRotina(home,{rotina=null,nome,quando,agente,pasta,pedido,avisar=null,ligada=true}={}){
  const falha=m=>Object.assign(new Error(m),{publico:true}),dir=path.join(home,'.config','ratoeira','rotinas');
  nome=String(nome??'').trim();quando=String(quando??'').trim().replace(/\s+/g,' ');agente=String(agente||'claude').toLowerCase();pasta=String(pasta??'').trim();pedido=String(pedido??'').trim();
  if(!nome||nome.length>60||/[\r\n]/.test(nome))throw falha('Dá um nome de até 60 caracteres.');
  if(!QUANDO_OK.test(quando))throw falha('Horário inválido.');
  if(!['claude','codex'].includes(agente))throw falha('Agente inválido.');
  if(pasta&&(!caminhoOk(pasta)||/[\r\n]/.test(pasta)||!existsSync(pasta)))throw falha('Essa pasta não existe.');
  if(!pedido||pedido.length>20000)throw falha('Escreve o pedido (até 20 mil caracteres).');
  if(avisar!=null&&!AVISOS_ROTINA.includes(avisar))throw falha('Aviso inválido.');
  let id=rotina,extra=[];
  if(id!=null){
    if(!ID_ROTINA.test(String(id))||!existsSync(path.join(dir,id+'.md')))throw falha('Rotina não encontrada.');
    const r=cabecalhoRotina(readFileSync(path.join(dir,id+'.md'),'utf8'));
    if(r)extra=Object.entries(r.cab).filter(([k])=>!['nome','quando','agente','pasta','ligada',...(avisar!=null?['avisar']:[])].includes(k)).map(([k,v])=>k+': '+v);
  }else{
    const base=nome.normalize('NFD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,50)||'rotina';
    id=base;for(let i=2;existsSync(path.join(dir,id+'.md'));i++)id=base+'-'+i;
  }
  mkdirSync(dir,{recursive:true});
  const arq=path.join(dir,id+'.md'),texto=['---','nome: '+nome,'quando: '+quando,'agente: '+agente,...(pasta?['pasta: '+pasta]:[]),...(avisar!=null?['avisar: '+avisar]:[]),'ligada: '+(ligada===false?'não':'sim'),...extra,'---',pedido,''].join('\n');
  writeFileSync(arq+'.tmp',texto);renameSync(arq+'.tmp',arq);
  return id;
}
export function apagarRotina(home,id){
  if(!ID_ROTINA.test(String(id)))throw Object.assign(new Error('Rotina inválida.'),{publico:true});
  try{unlinkSync(path.join(home,'.config','ratoeira','rotinas',id+'.md'));}catch{throw Object.assign(new Error('Rotina não encontrada.'),{publico:true});}
}

// ── Abertas em cada aparelho (desde 13/10/2026): cada navegador conta quais conversas tem em abas, e o outro
// aparelho mostra ("Abertas no celular", no Recentes e na Início). Só pra ver: nada sincroniza.
// Em ~/.config/ratoeira/abertas.json, uma entrada por aparelho; aparelho sem sinal há 14 dias sai.
const ID_APARELHO=/^[A-Za-z0-9-]{8,64}$/,ID_AGENTE=/^[a-z0-9-]{1,40}$/;
const VIDA_APARELHO=14*86400000,MAX_APARELHOS=10,MAX_ABERTAS=40;
const arqAbertas=home=>path.join(home,'.config','ratoeira','abertas.json');
function lerAbertas(home,agora){
  let o;try{o=JSON.parse(readFileSync(arqAbertas(home),'utf8'));}catch{o={};}
  if(!o||typeof o!=='object'||Array.isArray(o))o={};
  return Object.entries(o).filter(([id,a])=>ID_APARELHO.test(id)&&a&&Number.isFinite(a.em)&&agora-a.em<VIDA_APARELHO&&Array.isArray(a.conversas));
}
export function abertasDe(home,agora=Date.now()){
  return lerAbertas(home,agora).map(([aparelho,a])=>({aparelho,tipo:a.tipo==='celular'?'celular':'computador',em:a.em,conversas:a.conversas})).sort((a,b)=>b.em-a.em);
}
export function gravarAbertas(home,{aparelho,tipo,conversas}={},agora=Date.now()){
  if(!ID_APARELHO.test(String(aparelho))||!['celular','computador'].includes(tipo)||!Array.isArray(conversas))throw Object.assign(new Error('Aparelho inválido.'),{publico:true});
  const texto=(v,n)=>typeof v==='string'&&v.trim()?v.replace(/[\u0000-\u001f\u007f]+/g,' ').trim().slice(0,n):null;
  const lista=[],vistas=new Set();
  for(const c of conversas){
    if(!c||!ID_AGENTE.test(String(c.agente))||!idOk(c.sessao))continue;
    const k=c.agente+':'+c.sessao;if(vistas.has(k))continue;vistas.add(k);
    lista.push({agente:c.agente,sessao:c.sessao,cwd:texto(c.cwd,500),titulo:texto(c.titulo,120)});
    if(lista.length>=MAX_ABERTAS)break;
  }
  const todos=new Map(lerAbertas(home,agora));todos.delete(aparelho);
  todos.set(aparelho,{tipo,em:agora,conversas:lista});
  const final=[...todos].sort((a,b)=>b[1].em-a[1].em).slice(0,MAX_APARELHOS);
  const arq=arqAbertas(home);mkdirSync(path.dirname(arq),{recursive:true,mode:0o700});
  const tmp=arq+'.'+process.pid+'.tmp';writeFileSync(tmp,JSON.stringify(Object.fromEntries(final)),{mode:0o600});renameSync(tmp,arq);
}

// Conta pessoal com login completo (desde 16/10/2026): uma pasta de config do Claude só dela
// (CLAUDE_CONFIG_DIR), com o login (.credentials.json) e o .claude.json da conta (dados e caches da conta e
// da organização dela). O resto aponta pro ~/.claude de sempre (histórico, skills, settings, plugins), então a
// conversa continua depois de trocar de conta. O token do setup-token, o jeito de antes, só usa o modelo:
// sem conectores do claude.ai. Refeito a cada conta aplicada e antes de cada conversa: o que aparecer de novo
// no ~/.claude ganha o atalho, e os MCPs do ~/.claude.json (os de `claude mcp add --scope user`) valem em todas.
const DA_CONTA=new Set(['.claude.json','backups','cache','state','mcp-needs-auth-cache.json','policy-limits.json','policy-limits.json.stamp.json','remote-settings.json','.last-cleanup']);
const HERDADOS=['mcpServers','projects','hasCompletedOnboarding','lastOnboardingVersion','theme','installMethod','autoUpdates'];
export function prepararDirConta(dir,home){
  const base=path.join(home,'.claude');
  mkdirSync(dir,{recursive:true,mode:0o700});
  let nomes=[];try{nomes=readdirSync(base);}catch{}
  for(const n of nomes){
    if(DA_CONTA.has(n)||n.startsWith('.credentials'))continue;
    const alvo=path.join(dir,n);
    try{lstatSync(alvo);continue;}catch{}
    try{symlinkSync(path.join(base,n),alvo);}catch{}
  }
  const arq=path.join(dir,'.claude.json');
  let principal={};try{principal=JSON.parse(readFileSync(path.join(home,'.claude.json'),'utf8'))??{};}catch{}
  let atual=null;try{atual=JSON.parse(readFileSync(arq,'utf8'));}catch{}
  const ok=atual&&typeof atual==='object'&&!Array.isArray(atual);
  const novo=ok?{...atual}:Object.fromEntries(HERDADOS.filter(k=>k in principal).map(k=>[k,principal[k]]));
  const mcp={...(novo.mcpServers??{}),...(principal.mcpServers??{})};
  if(Object.keys(mcp).length)novo.mcpServers=mcp;
  if(!ok||JSON.stringify(novo)!==JSON.stringify(atual)){const t=arq+'.'+process.pid+'.tmp';writeFileSync(t,JSON.stringify(novo,null,2),{mode:0o600});renameSync(t,arq);}
  return dir;
}

// Conector do claude.ai que falhou por falta de login fica marcado "precisa de login" por 4 h em
// ~/.claude/mcp-needs-auth-cache.json, e o Claude nem tenta abrir. Quem conecta no claude.ai depois de
// tentar usar quer ver na conversa seguinte: antes de cada conversa sai a marca dos `claude.ai …` (só eles).
export function esquecerLoginClaudeAi(dir=process.env.CLAUDE_CONFIG_DIR??path.join(process.env.HOME??'/tmp','.claude')){
  const arq=path.join(dir,'mcp-needs-auth-cache.json');
  let o;try{o=JSON.parse(readFileSync(arq,'utf8'));}catch{return 0;}
  if(!o||typeof o!=='object'||Array.isArray(o))return 0;
  const tirar=Object.keys(o).filter(k=>k.startsWith('claude.ai '));if(!tirar.length)return 0;
  for(const k of tirar)delete o[k];
  const tmp=arq+'.'+process.pid+'.tmp';
  try{writeFileSync(tmp,JSON.stringify(o),{mode:0o600});renameSync(tmp,arq);}catch{try{unlinkSync(tmp);}catch{}return 0;}
  return tirar.length;
}

// MCPs da pessoa: `claude mcp list` (testa cada um, leva uns segundos; fica 2 min guardado) e `codex mcp list`.
export function lerMcpList(saida){
  const out=[];
  for(const l of String(saida).split('\n')){
    const m=l.match(/^(.+?): (.+) - ([✔✓✘✗!]) (.*)$/u);if(!m)continue;
    const nome=m[1].trim(),estado=/[✔✓]/u.test(m[3])?'conectado':m[3]==='!'?'autorizar':'falhou';
    let alvo=m[2].replace(/\s*\((HTTP|SSE|stdio)\)$/i,'').trim();
    // URL inteira pode levar chave: fica o host; comando, só o nome do programa
    try{alvo=new URL(alvo).hostname;}catch{alvo=alvo.split(/\s+/).slice(0,2).map(x=>path.basename(x)).join(' ');}
    out.push({nome,alvo,estado,detalhe:m[4].trim().slice(0,200),origem:nome.startsWith('claude.ai ')?'conta':nome.startsWith('plugin:')?'plugin':'instalado'});
  }
  return out;
}

const arquivoTitulosPadrao=()=>path.join(process.env.HOME??'/tmp','.local','state','ratoeira','titulos.json');
// De que aparelho saiu a última mensagem de cada conversa (desde 28/10/2026): a coluna de Conversas mostra o ícone.
// Ao lado do titulos.json; guarda as 500 mais recentes.
const TIPOS_APARELHO=new Set(['celular','computador']),MAX_ULTIMO_APARELHO=500;

// ── Trabalho no fundo (16/10/2026) ──
// Turno acabado não quer dizer conversa parada: o agente pode deixar comando, Monitor ou workflow rodando e esperar
// o aviso deles. Sem contar isso, a versão nova religou o servidor 9 s depois de um "sigo quando os avisos chegarem"
// e matou dois workflows que eram pra rodar a madrugada inteira (16/10/2026). Dois sinais do Claude Code:
// - comando (Bash na frente ou no fundo, Monitor): a saída vai pra /tmp/claude-<uid>/<pasta>/<sessão>/tasks/<id>.output,
//   então processo vivo com a saída lá é trabalho daquela conversa;
// - workflow e subagente: gravam o andamento em <config>/projects/<pasta>/<sessão>/subagents/.
const SAIDA_TAREFA=/\/claude-\d+\/[^/]+\/([0-9a-f-]{36})\/tasks\//;
let comandosVistos={em:0,sessoes:new Set()};
export function sessoesComComando(){
  if(Date.now()-comandosVistos.em<5000)return comandosVistos.sessoes;
  const sessoes=new Set();let pids=[];
  try{pids=readdirSync('/proc').filter(n=>/^\d+$/.test(n));}catch{}
  for(const pid of pids){try{const m=readlinkSync(`/proc/${pid}/fd/1`).match(SAIDA_TAREFA);if(m)sessoes.add(m[1]);}catch{}}
  comandosVistos={em:Date.now(),sessoes};return sessoes;
}
// algum arquivo da pasta (até `fundo` níveis abaixo) mexido desde `desde`
export function mexidoDesde(dir,desde,fundo=3){
  let itens;try{itens=readdirSync(dir,{withFileTypes:true});}catch{return false;}
  for(const d of itens){
    const f=path.join(dir,d.name);
    try{if(d.isDirectory()?fundo>0&&mexidoDesde(f,desde,fundo-1):d.isFile()&&statSync(f).mtimeMs>=desde)return true;}catch{}
  }
  return false;
}
// o Claude Code guarda a conversa em projects/<cwd com tudo que não é letra ou número trocado por "-">
export const pastaDoProjeto=cwd=>String(cwd).replace(/[^A-Za-z0-9]/g,'-');
// Hora da última mensagem de verdade (user/assistant) no .jsonl do Claude. A data do arquivo não serve: fechar e
// reabrir a conversa (servidor religado) acrescenta linhas de modo e custo e ela pulava pro topo como "agora"
// (20/10/2026). Lê só o fim do arquivo; guarda pelo tamanho e data, então a lista de 20 em 20 s fica num stat.
const ultimasMensagens=new Map();
export function ultimaMensagemClaude(arquivo){
  let st;try{st=statSync(arquivo);}catch{return null;}
  const memo=ultimasMensagens.get(arquivo);if(memo&&memo.tam===st.size&&memo.mt===st.mtimeMs)return memo.em;
  let em=null,fd;
  try{
    fd=openSync(arquivo,'r');
    for(let n=64*1024;!em;n*=4){
      const ini=Math.max(0,st.size-n),buf=Buffer.alloc(st.size-ini);readSync(fd,buf,0,buf.length,ini);
      const linhas=buf.toString('utf8').split('\n');if(ini>0)linhas.shift();
      for(let i=linhas.length-1;i>=0&&!em;i--){
        if(!/"type":"(user|assistant)"/.test(linhas[i]))continue;
        try{const o=JSON.parse(linhas[i]);if((o.type==='user'||o.type==='assistant')&&o.timestamp&&!Number.isNaN(Date.parse(o.timestamp)))em=new Date(o.timestamp).toISOString();}catch{}
      }
      if(ini===0||n>=16*1024*1024)break;
    }
  }catch{}finally{if(fd!=null)try{closeSync(fd);}catch{}}
  if(ultimasMensagens.size>2000)ultimasMensagens.clear();
  ultimasMensagens.set(arquivo,{tam:st.size,mt:st.mtimeMs,em});return em;
}
const FUNDO_ARQUIVO_MS=10*60000,SOZINHO_MS=3*60000;
// o que o agente manda quando está trabalhando (título e uso chegam depois do turno e não contam)
const SOZINHO=new Set(['agent_message_chunk','agent_thought_chunk','tool_call','tool_call_update','plan']);
// Memória apertada (16/10/2026): a pessoa passou de 80% do freio dela (MemoryHigh da unit) ou a máquina tem menos de
// 15% livre. Aí as conversas paradas dormem com 10 min em vez de 60: cada uma devolve uns 300 MB e acorda quando voltam a ela.
export function memoriaApertada(){
  try{
    const cg=readFileSync('/proc/self/cgroup','utf8').match(/^0::(.+)$/m)?.[1];
    if(cg){const d='/sys/fs/cgroup'+cg,alto=readFileSync(d+'/memory.high','utf8').trim();
      if(alto!=='max'&&Number(readFileSync(d+'/memory.current','utf8'))>0.8*Number(alto))return true;}
  }catch{}
  try{
    const m=readFileSync('/proc/meminfo','utf8'),v=k=>Number(m.match(new RegExp('^'+k+':\\s+(\\d+)','m'))?.[1]);
    if(v('MemAvailable')<0.15*v('MemTotal'))return true;
  }catch{}
  return false;
}
const DORMIR_APERTADO_MIN=10;
// Mensagem que o servidor manda sozinho, ao religar, pra conversa que estava trabalhando quando ele caiu.
const textoRetomar=motivo=>`[Mensagem automática da Ratoeira] O servidor de agentes religou (${motivo}) e o que estava rodando nesta conversa parou: o turno em andamento e os comandos, Monitors e workflows em segundo plano. Confere o que ficou pela metade, retoma de onde parou e segue o plano. Se precisar de uma decisão da pessoa, para e pergunta.`;

// Limite de uso da conta (o plano acabou): o Claude Code e o Codex mandam como texto do agente, em inglês
// ("You've hit your limit · resets 3pm (UTC)", "You've hit your usage limit. ... try again at 3:05 PM.").
// Os começos são os do USAGE_LIMIT_ERROR_PREFIXES do Agent SDK (o Codex usa o mesmo "You've hit your").
const LIMITE=/^(You've hit your|You've reached your|You're out of usage credits|Your org is out of usage)/;
export const ehLimite=texto=>typeof texto==='string'&&texto.length<1000&&LIMITE.test(texto.trim())&&/limit|usage|credits/i.test(texto);
const MESES=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
// Diferença (ms) entre a hora de parede num fuso e a UTC, no instante `ms`.
function desvio(ms,fuso){
  const p=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:fuso,hourCycle:'h23',year:'numeric',month:'numeric',day:'numeric',hour:'numeric',minute:'numeric',second:'numeric'})
    .formatToParts(new Date(ms)).map(x=>[x.type,Number(x.value)]));
  return Date.UTC(p.year,p.month-1,p.day,p.hour,p.minute,p.second)-Math.floor(ms/1000)*1000;
}
// Quando o limite volta (ms), lido do texto. O CLI escreve a hora no fuso dele (o da máquina, ou o que vem
// entre parênteses) e às vezes com a data na frente. Sem hora que dê pra ler: null.
export function voltaDoLimite(texto,{agora=Date.now(),fuso=Intl.DateTimeFormat().resolvedOptions().timeZone}={}){
  const m=String(texto??'').match(/(?:resets(?: at)?|try again at)\s+(.{1,80})/i);if(!m)return null;
  const resto=m[1];
  const tz=resto.match(/\(([A-Za-z_]+(?:\/[A-Za-z_+-]+)*)\)/)?.[1];
  if(tz)try{new Intl.DateTimeFormat('en-US',{timeZone:tz});fuso=tz;}catch{}
  let h,mi;const h12=resto.match(/\b(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m\b/i),h24=resto.match(/\b(\d{1,2}):(\d{2})\b/);
  if(h12){h=Number(h12[1])%12+(h12[3].toLowerCase()==='p'?12:0);mi=Number(h12[2]??0);}
  else if(h24){h=Number(h24[1]);mi=Number(h24[2]);}
  else return null;
  if(h>23||mi>59)return null;
  const hoje=new Date(agora+desvio(agora,fuso));
  let ano=hoje.getUTCFullYear(),mes=hoje.getUTCMonth(),dia=hoje.getUTCDate(),comData=false;
  const d1=resto.match(/\b([a-z]{3})[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b(?:,?\s+(\d{4}))?/i),d2=resto.match(/\b(\d{1,2})\s+([a-z]{3})[a-z]*\.?\s+(\d{4})\b/i);
  const usa=(mm,dd,aa)=>{const i=MESES.indexOf(mm.toLowerCase());if(i<0)return false;mes=i;dia=Number(dd);if(aa)ano=Number(aa);comData=true;return true;};
  if(!(d1&&usa(d1[1],d1[2],d1[3])))if(d2)usa(d2[2],d2[1],d2[3]);
  const parede=Date.UTC(ano,mes,dia,h,mi);
  let ms=parede-desvio(parede,fuso);ms=parede-desvio(ms,fuso);   // segunda volta acerta a troca de horário de verão
  if(!comData&&ms<agora-60e3)ms+=864e5;
  return ms;
}

// Ler outra conversa (desde 16/10/2026, ferramenta ler_conversa do MCP da Ratoeira): o gateway confere quem pode e
// pede aqui o texto da conversa do dono deste servidor. Mesmo formato da "Continuar numa cópia" do chat: mensagens
// com o nome de quem mandou, respostas do agente, notas internas (marcadas: o agente de lá não viu) e uma linha por
// ferramenta. Passando de `max` caracteres, ficam as mais recentes.
export const MAX_LEITURA=60000;
const AUTOR_NO_TEXTO=/^\[([^\]\n]{1,60})\]: /;
// <ratoeira-durante>: pedido que vai junto da mensagem do "Agora" (DURANTE, em createServidor); fora do 26 ao 29/10/2026
const limparPedido=t=>String(t).replace(/\s*<ratoeira-durante>[\s\S]*?<\/ratoeira-durante>\s*/g,' ')
  .replace(/^<ratoeira-contexto>[\s\S]*?<\/ratoeira-contexto>\s*/,'')
  .replace(/^<ratoeira-copia de="([^"]*)" titulo="([^"]*)"[^>]*>[\s\S]*?<\/ratoeira-copia>\s*/,(_,de,tit)=>`(contexto copiado da conversa "${tit}", de ${de})\n`);
export function textoDaConversa(eventos,notas=[],{dono='Dono',max=MAX_LEITURA}={}){
  const blocos=[],ferramentas=new Map();
  for(const {update:u} of eventos??[]){
    const t=u?.sessionUpdate,ultimo=blocos[blocos.length-1];
    const txt=u?.content?.type==='text'?u.content.text:'';
    if(t==='user_message_chunk'){
      if(u.content?.type==='image'){blocos.push({tipo:'user',texto:'(imagem)',autor:u.ratoeira_autor?.nome??null});continue;}
      if(ultimo?.tipo==='user'&&!(u.ratoeira_autor&&ultimo.autor&&ultimo.autor!==u.ratoeira_autor.nome))ultimo.texto+=txt;
      else blocos.push({tipo:'user',texto:txt,autor:u.ratoeira_autor?.nome??null});
    }
    else if(t==='agent_message_chunk'){if(ultimo?.tipo==='assistant')ultimo.texto+=txt;else if(txt)blocos.push({tipo:'assistant',texto:txt});}
    else if(t==='tool_call'||t==='tool_call_update'){
      let b=ferramentas.get(u.toolCallId);
      if(!b){b={tipo:'tool',item:{}};ferramentas.set(u.toolCallId,b);blocos.push(b);}
      for(const k of ['title','kind','rawInput'])if(u[k]!=null)b.item[k]=u[k];
    }
  }
  const linhas=[];let n=0,vistos=0;
  const notasDepois=(k,fim=false)=>{for(const nota of notas)if((fim?(nota.apos??0)>=k:(nota.apos??0)===k)&&nota.texto)linhas.push(`(nota de ${nota.autor?.nome||'alguém'}, o agente de lá não viu: ${nota.texto})`);};
  for(const b of blocos){
    if(b.tipo==='user'){
      let t=limparPedido(b.texto);const pre=t.match(AUTOR_NO_TEXTO);if(pre)t=t.slice(pre[0].length);
      if(!t.trim())continue;
      notasDepois(vistos);vistos++;
      linhas.push(`[${b.autor||pre?.[1]||dono}]: ${t.trim()}`);n++;
    }
    else if(b.tipo==='assistant'&&b.texto.trim())linhas.push('[Agente]: '+b.texto.trim());
    else if(b.tipo==='tool'){
      const it=b.item,ri=it.rawInput||{};const alvo=(Array.isArray(ri.command)?ri.command.join(' '):ri.command)||ri.file_path||ri.path||'';
      linhas.push(`(o agente usou ${String(it.title||it.kind||'uma ferramenta').split('\n')[0].slice(0,80)}${alvo&&!String(it.title||'').includes(String(alvo).split('\n')[0])?': '+String(alvo).split('\n')[0].slice(0,160):''})`);
    }
  }
  notasDepois(vistos,true);
  let texto=linhas.join('\n\n');
  if(texto.length>max)texto='(o começo foi cortado)\n\n'+texto.slice(-max);
  return {texto,mensagens:n};
}

// Cache do Claude: vale `ttl` depois da última chamada ao modelo (1 h no plano pelo SDK; 5 min em subagente
// ou sem plano). O adaptador não manda: lê do fim do histórico da conversa no disco. Sem histórico: null.
function historicoClaude(home,cwd,sessao){
  if(!idOk(sessao)||typeof cwd!=='string')return null;
  const base=path.join(home,'.claude','projects');let arq=path.join(base,cwd.replace(/[^a-zA-Z0-9]/g,'-'),sessao+'.jsonl');
  try{if(!existsSync(arq))arq=readdirSync(base).map(d=>path.join(base,d,sessao+'.jsonl')).find(a=>existsSync(a));}catch{return null;}
  return arq||null;
}
// Nome que o Claude deu (ou que a pessoa pôs no /rename) gravado no histórico. Numa conversa nova o adaptador ainda
// não mandou o nome quando a primeira resposta acaba, e o aviso "o agente terminou" saía sem nome (28/10/2026).
export function tituloDoHistorico(home,cwd,sessao){
  const arq=historicoClaude(home,cwd,sessao);if(!arq)return null;
  let texto;try{texto=readFileSync(arq,'utf8');}catch{return null;}
  let ai=null;
  for(const linha of texto.split('\n').reverse()){
    if(!linha.includes('-title"'))continue;
    let d;try{d=JSON.parse(linha);}catch{continue;}
    if(d.type==='custom-title'&&typeof d.customTitle==='string'&&d.customTitle.trim())return d.customTitle.trim().slice(0,120);
    if(d.type==='ai-title'&&typeof d.aiTitle==='string'&&d.aiTitle.trim())ai??=d.aiTitle.trim().slice(0,120);
  }
  return ai;
}
// sem nome nenhum: o começo do primeiro pedido, sem o bloco de contexto da tela
export function trechoDoPedido(texto){
  const t=String(texto??'').replace(/<ratoeira-contexto>[\s\S]*?<\/ratoeira-contexto>/g,' ').replace(/\s+/g,' ').trim();
  return t?(t.length>60?t.slice(0,59).trimEnd()+'…':t):null;
}
export function cacheDaConversa(home,cwd,sessao){
  const arq=historicoClaude(home,cwd,sessao);
  if(!arq)return null;
  let texto;
  try{
    const tam=statSync(arq).size,n=Math.min(tam,512*1024),buf=Buffer.alloc(n),fd=openSync(arq,'r');
    try{readSync(fd,buf,0,n,tam-n);}finally{closeSync(fd);}
    texto=buf.toString('utf8');
  }catch{return null;}
  let ultima=null,ttl=null;
  for(const linha of texto.split('\n').reverse()){
    if(!linha.includes('"assistant"'))continue;
    let d;try{d=JSON.parse(linha);}catch{continue;}
    if(d.type!=='assistant'||d.isSidechain||!d.message?.usage||d.message.model==='<synthetic>')continue;
    ultima??=Date.parse(d.timestamp);
    const cc=d.message.usage.cache_creation||{};
    if(cc.ephemeral_1h_input_tokens>0)ttl=3600e3;else if(cc.ephemeral_5m_input_tokens>0)ttl=300e3;
    if(ttl)break;
  }
  if(!Number.isFinite(ultima))return null;
  ttl??=3600e3;
  return {ate:ultima+ttl,ttl};
}
// Limites do plano (5 h e semana) que o Claude manda junto do uso, só o que a tela mostra.
export function limitesDe(info){
  const j=info?.unifiedWindows;if(!j)return null;
  const janela=w=>w&&Number.isFinite(w.utilization)?{uso:w.utilization,volta:Number(w.resetsAt)>0?w.resetsAt*1000:null}:null;
  const r={cinco:janela(j.five_hour),semana:janela(j.seven_day)};
  return r.cinco||r.semana?r:null;
}
// Limites do Codex (desde 28/10/2026): o adaptador recebe e só mostra no /status, mas o Codex grava a cada resposta no
// arquivo da conversa (evento token_count, campo rate_limits): janelas primary e secondary com used_percent (0 a 100),
// window_minutes (300 = 5 h, 10080 = semana) e resets_at (segundos), mais o plano. O arquivo é
// <sessions>/AAAA/MM/DD/rollout-<hora>-<sessão>.jsonl, e o id é um UUID v7: o começo dele é a hora em que nasceu.
const ROLLOUTS=new Map();
export function arquivoDoCodex(sessoes,sessao){
  if(!idOk(sessao)||!/^[0-9a-f-]{36}$/.test(sessao))return null;
  const memo=ROLLOUTS.get(sessao);if(memo&&existsSync(memo))return memo;
  const nasceu=parseInt(sessao.replace(/-/g,'').slice(0,12),16),dias=[];
  // a pasta do dia é a da hora local da máquina; um dia pra cada lado cobre qualquer fuso
  if(Number.isFinite(nasceu))for(const d of [0,-1,1]){const t=new Date(nasceu+d*864e5);dias.push([t.getFullYear(),String(t.getMonth()+1).padStart(2,'0'),String(t.getDate()).padStart(2,'0')]);}
  for(const [a,m,d] of dias){
    const dir=path.join(sessoes,String(a),m,d);let nomes=[];try{nomes=readdirSync(dir);}catch{continue;}
    const n=nomes.find(x=>x.endsWith('-'+sessao+'.jsonl'));
    if(n){const f=path.join(dir,n);if(ROLLOUTS.size>500)ROLLOUTS.clear();ROLLOUTS.set(sessao,f);return f;}
  }
  return null;
}
export function limitesDoCodex(sessoes,sessao){
  const arq=arquivoDoCodex(sessoes,sessao);if(!arq)return null;
  let texto;
  try{
    const tam=statSync(arq).size,n=Math.min(tam,512*1024),buf=Buffer.alloc(n),fd=openSync(arq,'r');
    try{readSync(fd,buf,0,n,tam-n);}finally{closeSync(fd);}
    texto=buf.toString('utf8');
  }catch{return null;}
  for(const linha of texto.split('\n').reverse()){
    if(!linha.includes('"rate_limits"'))continue;
    let d;try{d=JSON.parse(linha);}catch{continue;}
    const rl=d?.payload?.type==='token_count'?d.payload.rate_limits:null;if(!rl)continue;
    const r={};
    for(const w of [rl.primary,rl.secondary]){
      if(!w||!Number.isFinite(w.used_percent))continue;
      const j={uso:Math.max(0,w.used_percent)/100,volta:Number(w.resets_at)>0?w.resets_at*1000:null};
      // janela que não é de 5 h nem de semana (o Codex pode mudar): fica na mais perto
      if(Number(w.window_minutes)<=24*60)r.cinco??=j;else r.semana??=j;
    }
    if(!r.cinco&&!r.semana)continue;
    if(typeof rl.plan_type==='string')r.plano=rl.plan_type;
    return r;
  }
  return null;
}

export function createServidor({agentes,abrirProcesso,ociosoMin=30,dormirMin=60,maxAcordadas=5,agora=Date.now,log=()=>{},contas:contasCfg,arquivoTitulos=arquivoTitulosPadrao(),transcritor,trabalhoNoFundo,apertado=memoriaApertada}={}){
  // env com null tira a variável: a conta da conversa não herda o token nem a pasta da conta padrão
  abrirProcesso??=def=>{const env={...process.env,...def.env};for(const k of Object.keys(env))if(env[k]==null)delete env[k];return spawn(def.comando,def.args,{env,stdio:['pipe','pipe','pipe']});};
  const conversas=new Map();      // `${agente}:${sessao}` → conversa
  const clientes=new Set();
  let ultimo=agora();
  const chave=(a,s)=>`${a}:${s}`;
  // relido quando o arquivo muda: a rotina (ratoeira-rotina) grava ali o título da conversa que nasceu
  let titulos=null,titulosEm=0;
  function nomes(){
    let mt=0;try{mt=statSync(arquivoTitulos).mtimeMs;}catch{}
    if(titulos&&mt===titulosEm)return titulos;
    titulosEm=mt;
    try{const o=JSON.parse(readFileSync(arquivoTitulos,'utf8'));titulos=new Map(Object.entries(o).filter(([,v])=>typeof v==='string'));}catch{titulos=new Map();}
    return titulos;
  }
  const arquivoAparelhos=path.join(path.dirname(arquivoTitulos),'aparelhos.json');
  let aparelhosMap=null;
  function aparelhos(){
    if(!aparelhosMap)try{const o=JSON.parse(readFileSync(arquivoAparelhos,'utf8'));aparelhosMap=new Map(Object.entries(o).filter(([,v])=>TIPOS_APARELHO.has(v)));}catch{aparelhosMap=new Map();}
    return aparelhosMap;
  }
  function marcarAparelho(agente,sessao,tipo){
    if(!TIPOS_APARELHO.has(tipo)||!sessao)return;const k=chave(agente,sessao),m=aparelhos();
    if(m.get(k)===tipo)return;m.delete(k);m.set(k,tipo);while(m.size>MAX_ULTIMO_APARELHO)m.delete(m.keys().next().value);
    try{mkdirSync(path.dirname(arquivoAparelhos),{recursive:true,mode:0o700});const tmp=arquivoAparelhos+'.'+process.pid+'.tmp';
      writeFileSync(tmp,JSON.stringify(Object.fromEntries(m)),{mode:0o600});renameSync(tmp,arquivoAparelhos);}catch(e){log('aparelhos: '+e.message);}
  }
  function guardarNomes(){
    mkdirSync(path.dirname(arquivoTitulos),{recursive:true,mode:0o700});
    const tmp=arquivoTitulos+'.'+process.pid+'.tmp';
    writeFileSync(tmp,JSON.stringify(Object.fromEntries(nomes())),{mode:0o600});renameSync(tmp,arquivoTitulos);
  }
  // Conversas compartilhadas com outra pessoa (desde 15/10/2026): o gateway avisa quando o dono compartilha
  // (POST /compartilhada). Numa delas, toda mensagem vai pro agente com o nome de quem mandou ("[Ana]: ...").
  const arquivoCompartilhadas=path.join(path.dirname(arquivoTitulos),'compartilhadas.json');
  let compartilhadas=null;
  function lerCompartilhadas(){
    if(!compartilhadas)try{compartilhadas=new Set(JSON.parse(readFileSync(arquivoCompartilhadas,'utf8')).filter(x=>typeof x==='string'));}catch{compartilhadas=new Set();}
    return compartilhadas;
  }
  function marcarCompartilhada(agente,sessao,ligar){
    const s=lerCompartilhadas(),k=chave(agente,sessao);
    if(ligar===s.has(k))return;
    if(ligar)s.add(k);else s.delete(k);
    while(s.size>500)s.delete(s.values().next().value);
    try{
      mkdirSync(path.dirname(arquivoCompartilhadas),{recursive:true,mode:0o700});
      const tmp=arquivoCompartilhadas+'.'+process.pid+'.tmp';writeFileSync(tmp,JSON.stringify([...s]),{mode:0o600});renameSync(tmp,arquivoCompartilhadas);
    }catch(e){log(`compartilhadas: ${e.message}`);}
    const c=conversas.get(k);if(c)emitir(c,{sessionUpdate:'ratoeira_compartilhada',compartilhada:ligar});
  }
  const ehCompartilhada=c=>lerCompartilhadas().has(chave(c.agente,c.sessao));
  // Notas internas (desde 15/10/2026): conversa entre as pessoas dentro da conversa, que o agente não vê. Ficam
  // num arquivo por conversa, fora do histórico do agente. `apos` = quantas mensagens de gente a tela tinha quando
  // a nota foi escrita: é o que põe a nota de volta no lugar quando a conversa é reaberta (o histórico vem do agente).
  const MAX_NOTAS=500;
  const arquivoNotas=(agente,sessao)=>path.join(path.dirname(arquivoTitulos),'notas',`${agente}-${sessao}.json`);
  function lerNotas(c){try{const l=JSON.parse(readFileSync(arquivoNotas(c.agente,c.sessao),'utf8'));return Array.isArray(l)?l:[];}catch{return [];}}
  function guardarNota(c,nota){
    const lista=[...lerNotas(c),nota].slice(-MAX_NOTAS);const arq=arquivoNotas(c.agente,c.sessao);
    mkdirSync(path.dirname(arq),{recursive:true,mode:0o700});
    const tmp=arq+'.'+process.pid+'.tmp';writeFileSync(tmp,JSON.stringify(lista),{mode:0o600});renameSync(tmp,arq);
  }
  // depois de carregar o histórico do agente, as notas vão pra tela (cada uma no lugar dela pelo `apos`)
  function emitirNotas(c){for(const nota of lerNotas(c))emitir(c,{sessionUpdate:'ratoeira_nota',nota});}
  // Quem está em cada conexão, posto pelo gateway no cabeçalho (o socket só o gateway abre): {email, nome}
  // e, pra quem entra pela conversa de outra pessoa, o convite {agente, sessao, cwd, modo: ler|entrar}.
  function quemDe(req){
    let q=null;try{q=JSON.parse(Buffer.from(String(req?.headers?.['x-ratoeira-quem']??''),'base64url').toString('utf8'));}catch{}
    if(!q||typeof q.email!=='string'||!q.email.includes('@'))return {quem:null,convite:null};
    const quem={email:q.email.slice(0,200),nome:String(q.nome||q.email.split('@')[0]).replace(/[\u0000-\u001f\u007f[\]]+/g,' ').trim().slice(0,60)||q.email.split('@')[0]};
    const c=q.convite;
    const convite=c&&agentes.has(c.agente)&&idOk(c.sessao)&&caminhoOk(c.cwd)&&['ler','entrar'].includes(c.modo)?{agente:c.agente,sessao:c.sessao,cwd:c.cwd,modo:c.modo}:null;
    // cabeçalho de convidado que não fecha: a conexão não ganha nada (melhor que virar dona)
    return {quem,convite:c&&!convite?{invalido:true}:convite};
  }
  // Quem está com a conversa aberta agora, uma vez cada pessoa (pra faixa "vendo agora" do chat)
  function presenca(c){
    const vistos=new Map();for(const ws of c.assinantes)if(ws.quem&&!vistos.has(ws.quem.email))vistos.set(ws.quem.email,{...ws.quem,convidado:Boolean(ws.convite)});
    return [...vistos.values()];
  }
  // Avisos pro gateway (desde 15/10/2026): o agente terminou de responder ou está esperando alguém. O gateway
  // pergunta (GET /avisos?desde=<seq>) a cada poucos segundos e põe no sino e no celular de quem não estava vendo.
  // `vendo` = quem tinha a conversa aberta na hora; `inicio` muda quando este servidor religa (o gateway recomeça a conta).
  const avisos=[],inicioAvisos=randomUUID();let seqAvisos=0;
  function avisar(c,tipo){
    const vendo=[...new Set([...c.assinantes].map(ws=>ws.quem?.email).filter(Boolean))];
    if(!c.titulo&&c.agente==='claude')c.titulo=tituloDoHistorico(conta().home,c.cwd,c.sessao);
    avisos.push({seq:++seqAvisos,tipo,agente:c.agente,sessao:c.sessao,titulo:nomes().get(chave(c.agente,c.sessao))??c.titulo??c.primeiroPedido??null,
      vendo,por:c.ultimoAutor??null,compartilhada:ehCompartilhada(c),em:new Date(agora()).toISOString()});
    if(avisos.length>200)avisos.splice(0,avisos.length-200);
  }
  // Avisos das rotinas (desde 16/10/2026): o ratoeira-rotina roda fora deste servidor e deixa um arquivo por aviso em
  // <estado>/avisos-rotina/ (a rotina te chamou, terminou ou falhou). Entram na mesma fila, com tipo 'rotina', e o
  // gateway entrega só pro dono. Lidos na hora que o gateway pergunta, e apagados depois de entrar.
  const pastaAvisosRotina=path.join(path.dirname(arquivoTitulos),'avisos-rotina');
  function lerAvisosRotina(){
    let nomes=[];try{nomes=readdirSync(pastaAvisosRotina).filter(n=>n.endsWith('.json')).sort().slice(0,50);}catch{return;}
    for(const n of nomes){
      const f=path.join(pastaAvisosRotina,n);let a=null;
      try{a=JSON.parse(readFileSync(f,'utf8'));}catch{}
      try{unlinkSync(f);}catch{}
      if(!a||!['chama','terminou','falhou'].includes(a.motivo))continue;
      const txt=v=>typeof v==='string'&&v?v.slice(0,300):null;
      avisos.push({seq:++seqAvisos,tipo:'rotina',motivo:a.motivo,rotina:txt(a.nome)??txt(a.rotina)??'Rotina',texto:txt(a.texto),
        agente:txt(a.agente),sessao:txt(a.sessao),titulo:txt(a.titulo),vendo:[],por:null,compartilhada:false,em:txt(a.em)??new Date(agora()).toISOString()});
    }
    if(avisos.length>200)avisos.splice(0,avisos.length-200);
  }
  function avisarPresenca(c){const pessoas=presenca(c);for(const ws of c.assinantes)mandar(ws,{t:'presenca',agente:c.agente,sessao:c.sessao,pessoas});}
  // limites do plano, por agente e conta (a conta vale pra todas as conversas), guardados pra valer depois de religar
  const arquivoLimites=path.join(path.dirname(arquivoTitulos),'limites.json');
  let limites=null;
  function limitesDoAgente(agente){
    if(!limites)try{limites=JSON.parse(readFileSync(arquivoLimites,'utf8'));}catch{limites={};}
    return limites[agente]??null;
  }
  // as conversas do Codex (todas as contas usam a mesma pasta: ver contas do Codex)
  const sessoesCodex=()=>path.join(conta().home,'.codex','sessions');
  function guardarLimites(agente,l){
    const antes=limitesDoAgente(agente);
    if(antes&&JSON.stringify([antes.cinco,antes.semana,antes.plano])===JSON.stringify([l.cinco,l.semana,l.plano]))return;
    limites[agente]={...l,em:agora()};
    try{
      mkdirSync(path.dirname(arquivoLimites),{recursive:true,mode:0o700});
      const tmp=arquivoLimites+'.'+process.pid+'.tmp';writeFileSync(tmp,JSON.stringify(limites),{mode:0o600});renameSync(tmp,arquivoLimites);
    }catch(e){log(`limites: ${e.message}`);}
  }
  // cache e limites pra tela: no fim de cada resposta e ao abrir a conversa (o histórico repetido não traz)
  function emitirUso(c){
    // Codex: os limites estão no arquivo da conversa (o Claude manda junto do uso, no usage_update)
    if(c.agente==='codex'){const l=limitesDoCodex(sessoesCodex(),c.sessao);if(l)guardarLimites(chaveLimites(c.agente,c.conta),l);}
    emitir(c,{sessionUpdate:'ratoeira_uso',cache:c.agente==='claude'?cacheDaConversa(conta().home,c.cwd,c.sessao):null,limites:limitesDoAgente(chaveLimites(c.agente,c.conta))});
  }

  function emitir(c,update){
    c.seq++;const ev={seq:c.seq,update};
    c.eventos.push(ev);if(c.eventos.length>MAX_EVENTOS)c.eventos.splice(0,c.eventos.length-MAX_EVENTOS);
    for(const ws of c.assinantes)mandar(ws,{t:'evento',agente:c.agente,sessao:c.sessao,...ev});
  }
  // Troca de opção feita por nós (setSessionConfigOption) não gera aviso do agente. Sem este, quem abre a
  // conversa depois recebe na reprise o último aviso do agente, de antes da troca: a conversa nova nascia no
  // modelo escolhido e o rodapé mostrava o da conta.
  function avisarConfig(c){if(c.config.configOptions)emitir(c,{sessionUpdate:'config_option_update',configOptions:c.config.configOptions});}
  // conta trocada: todo navegador conectado relê a lista (o seletor de outras abas e janelas)
  function avisarConta(agente){for(const ws of clientes)if(!ws.convite)mandar(ws,{t:'conta',agente});}
  // convidado só fica sabendo da conversa dele
  const doConvite=(ws,c)=>!ws.convite||(ws.convite.agente===c.agente&&ws.convite.sessao===c.sessao);
  function mudarEstado(c,estado){
    if(c.estado===estado)return;
    // a hora em que parou de trabalhar: é ela que deixa a conversa uns minutos em "Terminou de responder" na barra
    if(estado==='livre')c.terminouEm=agora();
    c.estado=estado;ultimo=agora();
    for(const ws of clientes)if(doConvite(ws,c))mandar(ws,{t:'estado',agente:c.agente,sessao:c.sessao,estado});
  }
  function conversa(agente,sessao,cwd){
    const k=chave(agente,sessao);let c=conversas.get(k);
    // usoEm: última vez que a conversa precisou do processo (mandar, responder, trocar opção, carregar); olhar não conta
    if(!c){c={agente,sessao,cwd,seq:0,eventos:[],assinantes:new Set(),pedidos:new Map(),estado:'livre',turnos:0,titulo:null,config:{},mcp:[],usoEm:agora(),dormindo:false,conta:null,ultracode:false};conversas.set(k,c);}
    return c;
  }
  // As opções (modelo, esforço, modo) de cada agente e conta, da última conversa criada nela: a tela de conversa
  // nova mostra antes de existir conversa. Primeira vez: abre uma conversa só pra perguntar e fecha. Por conta
  // porque cada uma oferece os seus modelos, com nomes próprios (o Opus é `opus` no login completo e `opus[1m]`
  // na da organização); a lista de uma servindo a outra mandava um modelo que ela não tem.
  // Só conversa recém-criada: a retomada traz o modelo dela, não o de início da conta.
  const opcoesDe=new Map();
  // Agente sem login (o Codex de quem não conectou): a coluna de conversas lista a cada 20 s e o adaptador falhava igual
  // toda vez, enchendo o log. Marca o adaptador por 10 min e pula; login ou troca de conta (trocarConta) tira a marca na hora.
  const semLoginAte=new Map();
  const SEM_LOGIN_MS=10*60000;
  function semLoginAgora(k){const t=semLoginAte.get(k);if(t&&agora()<t)return true;semLoginAte.delete(k);return false;}
  function marcarSemLogin(k,e){
    if(!semLogin(e))return false;
    if(!semLoginAte.has(k))log(`[${k.split('|')[0]}] sem login: paro de perguntar por 10 min (volta na hora quando a conta conectar)`);
    semLoginAte.set(k,agora()+SEM_LOGIN_MS);return true;
  }
  const msgSemLogin=agente=>`Falta conectar a conta do ${agente==='codex'?'Codex':agente}. Conecta em Configurações › Contas de IA.`;
  const comandosDe=new Map();     // agente → a última lista de comandos (com as skills) que ele anunciou
  function guardarConfig(c,r){
    if(r?.configOptions)c.config.configOptions=r.configOptions;
    if(r?.modes)c.config.modes=r.modes;
    if(r?.models)c.config.models=r.models;
  }

  // Um adaptador por agente e conta. contaId undefined = a conta padrão (conversa nova, lista, opções).
  const adaptadores=new Map();
  const chaveAd=(agente,contaId)=>agente+'|'+(contaId??'');
  // conta que saiu (removida, tiraram o acesso): a conversa passa pra padrão
  const adaptadorDe=c=>{if(c.conta&&contaPara(c.agente,c.conta)!==c.conta){c.conta=contaPara(c.agente);gravarContaDaConversa(c);}return adaptador(c.agente,c.conta);};
  function adaptador(id,contaId){
    const def0=agentes.get(id);if(!def0)throw erro('Agente desconhecido.');
    if(contaId===undefined)contaId=contaPara(id);
    let a=adaptadores.get(chaveAd(id,contaId));
    // a conta entra no ambiente do processo (pasta de config ou token); sem conta, herda o do servidor
    const def=contaId?{...def0,env:{...def0.env,...envDaConta(id,contaId)}}:def0;
    const daqui=c=>c.agente===id&&(c.conta??null)===(contaId??null);
    if(!a){a=new Adaptador(def,{
      aoAtualizar:(agente,{sessionId,update})=>{
        // comandos e skills do `/`: vale também a conversa só de perguntar (opcoes), que ainda não é conversa aqui
        if(update?.sessionUpdate==='available_commands_update'&&Array.isArray(update.availableCommands))comandosDe.set(agente,update.availableCommands);
        const c=conversas.get(chave(agente,sessionId));if(!c||!update)return;
        if(update.sessionUpdate==='available_commands_update'&&Array.isArray(update.availableCommands))c.comandos=update.availableCommands;
        if(update.sessionUpdate==='config_option_update')c.config.configOptions=update.configOptions;
        if(update.sessionUpdate==='current_mode_update'&&c.config.modes)c.config.modes={...c.config.modes,currentModeId:update.currentModeId};
        if(update.sessionUpdate==='session_info_update'&&typeof update.title==='string'){
          c.titulo=update.title;const meu=nomes().get(chave(agente,sessionId));if(meu)update={...update,title:meu};
        }
        // acordando sem session/resume (loadSession): o histórico que ele repete já está na tela
        if(c.silencio)return;
        // o agente trabalhando sem turno aberto (voltou sozinho com o aviso de um comando ou workflow): conta como fundo
        if(c.estado==='livre'&&!c.carregando&&SOZINHO.has(update.sessionUpdate))c.sozinhoEm=agora();
        // o Claude manda o estado do limite junto do uso; "rejected" traz a hora certa de voltar
        const taxa=update.sessionUpdate==='usage_update'&&update._meta?.['_claude/rateLimit'];
        if(taxa){c.taxa=taxa;const l=limitesDe(taxa);if(l)guardarLimites(chaveLimites(agente,c.conta),l);}
        // limite do plano: no lugar do texto em inglês, um aviso com a hora que volta (e o erro que vem atrás não aparece)
        const txt=update.sessionUpdate==='agent_message_chunk'&&update.content?.type==='text'&&update.content.text;
        if(ehLimite(txt)){
          c.limite=true;
          // Codex: a janela que encheu, do arquivo da conversa (tem a hora exata; o texto às vezes só traz a hora)
          const cheia=c.agente==='codex'?(l=>[l?.cinco,l?.semana].filter(w=>w&&w.uso>=1&&w.volta).sort((a,b)=>b.volta-a.volta)[0])(limitesDoCodex(sessoesCodex(),c.sessao)):null;
          const volta=c.taxa?.status==='rejected'&&Number(c.taxa.resetsAt)>0?c.taxa.resetsAt*1000:cheia?.volta??voltaDoLimite(txt,{agora:agora()});
          return emitir(c,{sessionUpdate:'ratoeira_limite',agente:agentes.get(agente)?.nome??agente,volta,texto:txt.trim()});
        }
        emitir(c,update);
      },
      aoPedir:(agente,params)=>new Promise(resolve=>{
        const c=conversas.get(chave(agente,params.sessionId));
        if(!c)return resolve({outcome:{outcome:'cancelled'}});
        const pedido=randomUUID();
        c.pedidos.set(pedido,{resolve,params});mudarEstado(c,'esperando');avisar(c,'esperando');
        emitir(c,{sessionUpdate:'ratoeira_pedido',pedido,toolCall:params.toolCall,options:params.options});
      }),
      aoPerguntar:(agente,params)=>new Promise(resolve=>{
        const c=params?.sessionId&&conversas.get(chave(agente,params.sessionId));
        if(!c)return resolve({action:'cancel'});
        const pedido=randomUUID();
        c.pedidos.set(pedido,{resolve,params,tipo:'pergunta'});mudarEstado(c,'esperando');avisar(c,'esperando');
        emitir(c,{sessionUpdate:'ratoeira_pergunta',pedido,message:params.message,requestedSchema:params.requestedSchema,toolCallId:params.toolCallId??null});
      }),
      aoSair:(agente,code)=>{
        log(`[${agente}${contaId?' '+contaId:''}] adaptador saiu (${code})`);
        // as conversas desse adaptador perdem o processo; abrir de novo retoma pelo histórico do agente
        for(const c of conversas.values())if(daqui(c)&&!c.dormindo){
          // pro retomar: no desligamento o adaptador pode cair antes de a lista ir pro disco
          c.caiuTrabalhando=c.estado==='rodando'||noFundo(c);
          for(const p of c.pedidos.values())p.resolve(p.tipo==='pergunta'?{action:'cancel'}:{outcome:{outcome:'cancelled'}});
          c.pedidos.clear();
          if(c.estado!=='livre')emitir(c,{sessionUpdate:'ratoeira_erro',mensagem:'O agente parou no meio. Mande de novo pra continuar.'});
          c.turnos=0;mudarEstado(c,'livre');c.solta=true;
        }
      },
      abrirProcesso,log});adaptadores.set(chaveAd(id,contaId),a);}
    return a;
  }
  const erro=(m)=>Object.assign(new Error(m),{publico:true});
  // O Claude recusa abrir numa pasta que não existe (o Codex aceita) e a falha chegava como "o agente não respondeu".
  // Pasta que sumiu (área apagada, pasta movida) vira um aviso que a pessoa entende (reporte 36, 28/10/2026).
  const pastaQueExiste=cwd=>{if(!existsSync(cwd))throw erro(`A pasta ${cwd} não existe mais. Abra a conversa em outra pasta ou confira a tua área em Configurações › Pessoas.`);return cwd;};
  const ditado=()=>transcritor??=criarTranscritor({home:conta().home});

  // Respondeu o último pedido: volta a rodar se é de um turno nosso. Pedido que chegou sem turno (o agente trabalhando
  // no fundo pediu permissão) volta pra livre; antes ficava "rodando" pra sempre e a mensagem seguinte nunca saía.
  function depoisDoPedido(c){
    if(c.pedidos.size||c.estado!=='esperando')return;
    if(c.turnos)return mudarEstado(c,'rodando');
    mudarEstado(c,'livre');setImmediate(()=>proximaDaFila(c));
  }
  function resolverPedidos(c,resposta){
    for(const [id,p] of c.pedidos){p.resolve(p.tipo==='pergunta'?{action:'cancel'}:resposta);emitir(c,{sessionUpdate:'ratoeira_pedido_resolvido',pedido:id,resposta:'cancelado'});}
    c.pedidos.clear();
  }
  function resumo(c){
    return {agente:c.agente,sessao:c.sessao,cwd:c.cwd,titulo:nomes().get(chave(c.agente,c.sessao))??c.titulo,estado:c.estado,config:c.config,comandos:c.comandos??null,compartilhada:ehCompartilhada(c),conta:c.conta??null,ultracode:Boolean(c.ultracode),
      pedidos:[...c.pedidos].map(([pedido,p])=>p.tipo==='pergunta'?{pedido,tipo:'pergunta',message:p.params.message,requestedSchema:p.params.requestedSchema}:{pedido,toolCall:p.params.toolCall,options:p.params.options})};
  }

  // conectores do claude.ai ligados no agente (ENABLE_CLAUDEAI_MCP_SERVERS no agentes.json): tenta de novo os marcados sem login
  function conectoresDaConta(agente,contaId){
    if(agentes.get(agente)?.env?.ENABLE_CLAUDEAI_MCP_SERVERS!=='true')return;
    const dir=contaId?contasClaude().lista.find(x=>x.id===contaId)?.dir:process.env.CLAUDE_CONFIG_DIR;
    if(dir&&dir.startsWith(dirPessoais()+path.sep))try{prepararDirConta(dir,conta().home);}catch(e){log(`[${agente}] pasta da conta: ${e.message}`);}
    const n=esquecerLoginClaudeAi(dir||path.join(conta().home,'.claude'));if(n)log(`[${agente}] ${n} conector(es) do claude.ai sem login: tenta de novo`);
  }
  async function opcoes(agente,cwd,contaPedida=null){
    const contaId=contaPara(agente,contaPedida),k=chaveAd(agente,contaId);
    const c=opcoesDe.get(k);
    if(c&&agora()-c.em<10*60000)return c;
    if(semLoginAgora(k))throw erro(msgSemLogin(agente));
    const a=adaptador(agente,contaId);let conn,r;
    try{conn=await a.conexao();r=await conn.newSession({cwd,mcpServers:[]});}
    catch(e){if(marcarSemLogin(k,e))throw erro(msgSemLogin(agente));throw e;}
    semLoginAte.delete(k);
    opcoesDe.set(k,{configOptions:r.configOptions??[],modes:r.modes??null,conta:contaId,em:agora()});
    // conversa vazia, só pra perguntar: fecha (sem mensagem, o agente não grava nada). Espera uns segundos
    // porque a lista de comandos (o `/`) chega logo depois de a conversa nascer, e serve à conversa nova.
    if(a.capacidades?.sessionCapabilities?.close)setTimeout(()=>conn.closeSession?.({sessionId:r.sessionId}).catch(()=>{}),5000).unref?.();
    return opcoesDe.get(k);
  }
  async function nova(agente,cwd,mcpServers=[],escolhas={},blocos=null,contaPedida=null,ultracode=false){
    const contaId=contaPara(agente,contaPedida);pastaQueExiste(cwd);
    const a=adaptador(agente,contaId);const conn=await a.conexao();
    conectoresDaConta(agente,contaId);
    ultracode=ultracode&&agente==='claude';
    const r=await conn.newSession({cwd,mcpServers,...pastasExtras(a),...metaUltracode({agente,ultracode})});
    const c=conversa(agente,r.sessionId,cwd);guardarConfig(c,r);c.mcp=mcpServers;c.conta=contaId;gravarContaDaConversa(c);
    if(ultracode){c.ultracode=true;gravarUltracode(c);}
    if(r.configOptions)opcoesDe.set(chaveAd(agente,contaId),{configOptions:structuredClone(r.configOptions),modes:r.modes??null,conta:contaId,em:agora()});
    setImmediate(()=>apertar(c));
    // conversa nova já nasce no modo automático do agente: pedido que ainda vier vira botão
    const auto=agentes.get(agente).modoAutomatico;
    if(auto&&r.modes?.availableModes?.some(m=>m.id===auto)&&r.modes.currentModeId!==auto){
      await conn.setSessionMode({sessionId:r.sessionId,modeId:auto});
      c.config.modes={...c.config.modes,currentModeId:auto};
      const opMode=c.config.configOptions?.find(o=>o.id==='mode');if(opMode)opMode.currentValue=auto;
    }
    // o que a pessoa escolheu na tela (modelo, esforço, modo), na ordem em que veio
    for(const [configId,value] of Object.entries(escolhas)){
      const atual=c.config.configOptions?.find(o=>o.id===configId);
      if(!atual||atual.currentValue===value)continue;
      try{const r2=await conn.setSessionConfigOption({sessionId:r.sessionId,configId,value});if(r2?.configOptions)c.config.configOptions=r2.configOptions;}
      catch(e){log(`[${agente}] não aplicou ${configId}=${value}: ${e.message}`);}
    }
    if(Object.keys(escolhas).length)avisarConfig(c);
    if(blocos)await enviar(c,blocos);
    return resumo(c);
  }
  // Uma coisa por vez em cada conversa (abrir, acordar, dormir). Sem isso, quatro abas abrindo a mesma conversa
  // no mesmo segundo viravam quatro processos, e três ficavam órfãos no adaptador.
  const travas=new Map();
  function comTrava(k,fazer){
    // esperando a vez há muito tempo: fica no log (é o que aparece no Reportar), pra saber onde a conversa parou
    const antes=travas.get(k),aviso=antes?setTimeout(()=>log(`conversa ${k} esperando a vez há mais de 30 s`),30000):null;aviso?.unref?.();
    const vez=(antes??Promise.resolve()).then(()=>{clearTimeout(aviso);return fazer();});
    const fim=vez.catch(()=>{});travas.set(k,fim);
    fim.then(()=>{if(travas.get(k)===fim)travas.delete(k);});
    return vez;
  }
  const acordada=c=>!c.dormindo&&!c.solta;
  // fechar o processo mata o comando ou workflow que ficou rodando no fundo
  const podeDormir=c=>acordada(c)&&c.estado==='livre'&&!c.pedidos.size&&!noFundo(c);
  // Fecha o processo da conversa e guarda os eventos. Rodando ou esperando resposta, não mexe.
  function dormir(c,motivo){
    return comTrava(chave(c.agente,c.sessao),async()=>{
      if(!podeDormir(c))return false;
      const a=adaptadores.get(chaveAd(c.agente,c.conta));
      if(a?.child){
        if(!a.capacidades?.sessionCapabilities?.close)return false;
        const conn=await a.conexao();
        // "Session not found": o adaptador já não tinha processo pra ela, então ela já está dormindo
        try{await conn.closeSession({sessionId:c.sessao});}catch(e){if(!/not found/i.test(e?.message??'')){log(`[${c.agente}] não fechou ${c.sessao}: ${e.message}`);return false;}}
      }
      c.dormindo=true;log(`[${c.agente}] conversa ${c.sessao} dormiu (${motivo})`);
      return true;
    });
  }
  // Volta o processo de uma conversa dormindo, com as ferramentas de quando abriu. Chamado já com a trava.
  async function acordar(c){
    if(!c.dormindo)return;
    pastaQueExiste(c.cwd);
    const a=adaptadorDe(c);const conn=await a.conexao();
    conectoresDaConta(c.agente,c.conta);
    const params={sessionId:c.sessao,cwd:c.cwd,mcpServers:c.mcp??[],...pastasExtras(a),...metaUltracode(c)};
    const antes=Object.fromEntries((c.config.configOptions??[]).map(o=>[o.id,o.currentValue]));
    if(a.capacidades?.sessionCapabilities?.resume)guardarConfig(c,await conn.resumeSession(params));
    else{c.silencio=true;try{guardarConfig(c,await conn.loadSession(params));}finally{c.silencio=false;}}
    c.dormindo=false;c.usoEm=agora();log(`[${c.agente}] conversa ${c.sessao} acordou`);
    await reaplicar(c,conn,antes);
    setImmediate(()=>apertar(c));
  }
  // A conversa vai usar o processo: acorda se estiver dormindo e faz `fazer` na mesma vez da trava, pra ela
  // não voltar a dormir antes de a resposta começar.
  function usar(c,fazer){
    return comTrava(chave(c.agente,c.sessao),async()=>{
      c.usoEm=agora();
      if(c.dormindo)await acordar(c);
      if(c.solta)throw erro('Abra a conversa antes.');
      return fazer();
    });
  }
  // Além das `maxAcordadas`, dormem as paradas há mais tempo (a que acabou de acordar fica).
  async function apertar(fica){
    const livres=[...conversas.values()].filter(c=>c!==fica&&podeDormir(c)).sort((a,b)=>a.usoEm-b.usoEm);
    let sobra=[...conversas.values()].filter(acordada).length-maxAcordadas;
    for(const c of livres){if(sobra<=0)break;try{if(await dormir(c,'mais de '+maxAcordadas+' acordadas'))sobra--;}catch(e){log(`dormir: ${e.message}`);}}
  }
  // A cada minuto (e nos testes): dorme o que está parado há `dormirMin` (10 min com a memória apertada).
  async function dormirParadas(){
    let min=dormirMin;try{if(apertado())min=Math.min(dormirMin,DORMIR_APERTADO_MIN);}catch{}
    for(const c of [...conversas.values()])
      if(podeDormir(c)&&agora()-c.usoEm>=min*60000)try{await dormir(c,min+' min parada'+(min<dormirMin?', memória apertada':''));}catch(e){log(`dormir: ${e.message}`);}
  }

  function abrir(agente,sessao,cwd,mcpServers=[],recarregar=false){
    // já aberta aqui (acordada ou dormindo), sem nada pra trocar: só o resumo, sem esperar a vez. Assim a conversa
    // aparece mesmo com a trava ocupada (mandar mensagem, acordar), em vez de ficar em "Carregando a conversa…"
    const ativa=conversas.get(chave(agente,sessao));
    if(ativa&&!ativa.solta&&!ativa.carregando&&!recarregar&&!(ativa.soLeitura&&mcpServers.length>0))return Promise.resolve(resumo(ativa));
    return comTrava(chave(agente,sessao),()=>abrirJa(agente,sessao,cwd,mcpServers,recarregar));
  }
  async function abrirJa(agente,sessao,cwd,mcpServers,recarregar){
    const k=chave(agente,sessao);const ativa=conversas.get(k);
    // ferramenta (MCP) só entra quando a sessão carrega: ligar uma conversa aberta a um app recarrega ela
    if(recarregar&&ativa&&!ativa.solta&&ativa.estado!=='livre')throw erro('Espere a resposta atual terminar.');
    // dormindo: mostra o que está guardado, sem ligar processo; as ferramentas novas entram quando ela acordar
    // aberta só pra outra pessoa ler (ler-conversa): quem abre com as ferramentas é o dono, e elas valem
    const soLida=ativa?.soLeitura&&mcpServers.length>0;
    if(ativa?.dormindo){if(recarregar||soLida){ativa.mcp=mcpServers;delete ativa.soLeitura;}return {...resumo(ativa),...(recarregar?{recarregada:true}:{})};}
    if(ativa&&!ativa.solta&&!recarregar&&!soLida)return resumo(ativa);
    if(recarregar&&ativa)cwd??=ativa.cwd;
    // a conta da conversa: a que ela já tem aqui, a gravada da última vez, ou a padrão
    const contaId=contaPara(agente,ativa?.conta??contaGravada(agente,sessao));
    const a=adaptador(agente,contaId);const conn=await a.conexao();
    // sem a pasta (ex.: aba restaurada do layout salvo): o agente sabe onde a conversa nasceu
    if(!cwd&&a.capacidades?.sessionCapabilities?.list){
      for(let i=0,cursor;i<10&&!cwd;i++){const l=await conn.listSessions(cursor?{cursor}:{});cwd=l.sessions?.find(x=>x.sessionId===sessao)?.cwd;cursor=l.nextCursor;if(!cursor)break;}
    }
    if(!cwd)throw erro('Não achei essa conversa.');
    pastaQueExiste(cwd);
    const c=ativa??conversa(agente,sessao,cwd);
    delete c.soLeitura;c.solta=false;c.dormindo=false;c.caiuTrabalhando=false;c.eventos=[];c.seq=0;c.cwd=cwd;c.mcp=mcpServers;c.usoEm=agora();c.conta=contaId;
    if(!ativa)c.ultracode=ultracodeGravado(agente,sessao);
    // loadSession repete o histórico como eventos: quem abrir depois recebe a conversa inteira
    if(!a.capacidades?.loadSession)throw erro('Este agente não retoma conversas antigas.');
    conectoresDaConta(agente,contaId);
    c.carregando=true;
    let r;try{r=await conn.loadSession({sessionId:sessao,cwd,mcpServers,...pastasExtras(a),...metaUltracode(c)});}finally{c.carregando=false;}
    guardarConfig(c,r);emitirUso(c);emitirNotas(c);
    // a reconexão do chat abre todas as abas: as mais antigas dormem pra essa caber
    setImmediate(()=>apertar(c));
    // reabrir nem sempre repete o título: pergunta pro agente (a aba mostraria só "Conversa")
    if(!c.titulo&&a.capacidades?.sessionCapabilities?.list)try{
      for(let i=0,cursor;i<5;i++){const l=await conn.listSessions({cwd,...(cursor?{cursor}:{})});const s=l.sessions?.find(x=>x.sessionId===sessao);if(s){c.titulo=s.title??null;break;}cursor=l.nextCursor;if(!cursor)break;}
    }catch(e){log(`[${agente}] sem título: ${e.message}`);}
    return {...resumo(c),...(recarregar?{recarregada:true}:{})};
  }
  async function listar(agente,cwd){
    const ids=agente?[agente]:[...agentes.keys()];
    const lista=[];
    for(const id of ids){
      const k=chaveAd(id,contaPara(id));
      if(semLoginAgora(k))continue;
      try{
        const a=adaptador(id);const conn=await a.conexao();
        if(!a.capacidades?.sessionCapabilities?.list)continue;
        let cursor;
        // Claude: a hora vem da última mensagem no arquivo da conversa (a data dele muda só de reabrir)
        const x=id==='claude'?contasClaude().lista.find(y=>y.id===contaPara(id)):null;
        const dirs=id==='claude'?[...new Set([x?.dir,process.env.CLAUDE_CONFIG_DIR,path.join(conta().home,'.claude')].filter(Boolean))]:[];
        const horaDe=s=>{for(const d of dirs){const em=ultimaMensagemClaude(path.join(d,'projects',pastaDoProjeto(s.cwd),s.sessionId+'.jsonl'));if(em)return em;}return s.updatedAt??null;};
        for(let i=0;i<5&&lista.length<MAX_LISTA;i++){
          const r=await conn.listSessions({...(cwd?{cwd}:{}),...(cursor?{cursor}:{})});
          for(const s of r.sessions??[]){
            const c=conversas.get(chave(id,s.sessionId));
            lista.push({agente:id,sessao:s.sessionId,cwd:s.cwd,titulo:nomes().get(chave(id,s.sessionId))??s.title??c?.titulo??null,atualizada:horaDe(s),terminou:c?.terminouEm?new Date(c.terminouEm).toISOString():null,estado:c?.estado??'livre',pedidos:c?resumo(c).pedidos:[],aparelho:aparelhos().get(chave(id,s.sessionId))??null});
          }
          cursor=r.nextCursor;if(!cursor)break;
        }
        semLoginAte.delete(k);
      }catch(e){if(!marcarSemLogin(k,e))log(`[${id}] não listou: ${e.message}`);}
    }
    // conversa ativa que o agente ainda não gravou (acabou de nascer) também aparece
    for(const c of conversas.values())if(!lista.some(x=>x.agente===c.agente&&x.sessao===c.sessao)&&(!agente||c.agente===agente)&&(!cwd||c.cwd===cwd))
      lista.push({agente:c.agente,sessao:c.sessao,cwd:c.cwd,titulo:nomes().get(chave(c.agente,c.sessao))??c.titulo,atualizada:null,terminou:c.terminouEm?new Date(c.terminouEm).toISOString():null,estado:c.estado,pedidos:resumo(c).pedidos});
    return lista.sort((a,b)=>String(b.atualizada??'9').localeCompare(String(a.atualizada??'9')));
  }
  function ativa(agente,sessao){
    const c=conversas.get(chave(agente,sessao));
    if(!c||c.solta)throw erro('Abra a conversa antes.');
    return c;
  }
  // Numa conversa compartilhada, o agente recebe quem falou na frente do texto ("[Ana]: ..."), e isso fica no
  // histórico dele (é o que o chat lê pra pôr o nome quando a conversa é reaberta). A tela recebe o texto como foi
  // digitado e o autor à parte (ratoeira_autor).
  function comAutor(c,blocos,autor){
    if(!autor||!ehCompartilhada(c))return blocos;
    let feito=false;
    return blocos.map(b=>{if(feito||b.type!=='text')return b;feito=true;return {...b,text:`[${autor.nome}]: ${b.text}`};});
  }
  // Mensagem que entra no turno em andamento: sem pedido, o agente lê, responde no raciocínio (que a tela recolhe) ou
  // nem responde, e segue rodando ferramenta. A marca vai só pro agente; a tela esconde (chat.js, DURANTE).
  const DURANTE='<ratoeira-durante>A pessoa mandou esta mensagem com o teu trabalho em andamento. Antes da próxima ferramenta, responde a ela em texto de resposta, não no raciocínio: ela não vê o teu raciocínio. Se for pergunta ou pedido de explicação (um passo a passo, por exemplo), a resposta inteira vai nesse texto; se for mudança de rumo, uma ou duas linhas dizendo o que entendeu e o que vai fazer. Depois segue. Nunca diz que mandou ou mostrou algo que não está num texto de resposta.</ratoeira-durante>';
  async function enviar(c,blocos,autor=null){
    const a=adaptadorDe(c);
    const paraAgente=comAutor(c,blocos,autor),marca=autor?{ratoeira_autor:{nome:autor.nome,email:autor.email}}:{};
    c.primeiroPedido??=trechoDoPedido(blocos.find(b=>b.type==='text')?.text);
    // só entra no turno se tem um aberto por nós: "esperando" sem turno é o agente pedindo permissão do fundo
    // (subagente, workflow), e aí a mensagem vai como mensagem normal
    if(c.estado!=='livre'&&c.turnos>0){
      if(!a.steering)throw erro('Essa conversa ainda está respondendo. Espere ou pare antes.');
      const conn=await a.conexao();
      const r=await conn.extMethod('_session/steering',{sessionId:c.sessao,prompt:[...paraAgente,{type:'text',text:DURANTE}],_meta:{steering:{idleBehavior:'promptRequired'}}});
      // o turno acabou nesse meio tempo: vira mensagem normal (espera até 5 s o fim dele chegar aqui). Antes tentava
      // de novo pra sempre, com a trava da conversa presa: abrir a conversa ficava em "Carregando…" (20/10/2026)
      if(r?.outcome==='promptRequired'){
        for(let i=0;i<50&&c.turnos>0;i++)await new Promise(ok=>setTimeout(ok,100));
        if(c.turnos>0)log(`[${c.agente}] ${c.sessao}: o agente diz que não tem turno e o nosso não fechou; mando como mensagem nova`);
      }else{
        for(const b of blocos)if(b.type==='text'||b.type==='image')emitir(c,{sessionUpdate:'user_message_chunk',content:b,ratoeira_durante:true,...marca});
        return;
      }
    }
    const conn=await a.conexao();
    // a imagem também vai pra tela (quem abre depois vê o que foi mandado); o arquivo citado já está no texto como @caminho
    for(const b of blocos)if(b.type==='text'||b.type==='image')emitir(c,{sessionUpdate:'user_message_chunk',content:b,...marca});
    // turnos: quantos session/prompt nossos estão abertos. É o que diz se "rodando" é de verdade
    c.turnos++;mudarEstado(c,c.pedidos.size?'esperando':'rodando');c.limite=false;c.ultimoAutor=autor?.email??null;
    conn.prompt({sessionId:c.sessao,prompt:paraAgente})
      .then(r=>{emitir(c,{sessionUpdate:'ratoeira_fim',stopReason:r.stopReason});if(r.stopReason!=='cancelled')avisar(c,'terminou');else if(c.fila?.length){c.filaParada=true;emitirFila(c);}})
      // depois do aviso de limite o adaptador ainda falha o turno ("Internal error"): o aviso já disse tudo
      // sem conta (login não feito, vencido ou revogado): o adaptador falha com o authRequired do ACP; a tela troca o
      // "Authentication required" por um aviso que leva pra Contas de IA
      .catch(e=>emitir(c,c.limite?{sessionUpdate:'ratoeira_fim',stopReason:'end_turn'}:{sessionUpdate:'ratoeira_erro',mensagem:String(e?.message??e).slice(0,500),...(semLogin(e)?{motivo:'login'}:{})}))
      .finally(()=>{c.turnos=Math.max(0,c.turnos-1);emitirUso(c);c.usoEm=agora();if(c.turnos)return;
        resolverPedidos(c,{outcome:{outcome:'cancelled'}});mudarEstado(c,'livre');setImmediate(()=>proximaDaFila(c));});
  }

  // ── Fila (desde 15/10/2026): mensagem que espera a vez em vez de entrar no turno em andamento. Fica em memória
  // (servidor religou, a fila some) e vai sozinha quando o agente fica livre, na ordem. Alguém parou o agente: a fila
  // pausa até alguém mandar uma ("Mandar agora") ou mandar mensagem nova. Tela recebe ratoeira_fila com a fila inteira.
  const MAX_FILA=20;
  function emitirFila(c){emitir(c,{sessionUpdate:'ratoeira_fila',parada:Boolean(c.filaParada),fila:(c.fila??[]).map(({id,autor,blocos,em})=>({id,autor,em,
    texto:blocos.filter(b=>b.type==='text').map(b=>b.text).join(' ').slice(0,500),imagens:blocos.filter(b=>b.type==='image').length}))});}
  function proximaDaFila(c){
    if(!c.fila?.length||c.filaParada||c.estado!=='livre'||c.solta)return;
    const item=c.fila.shift();emitirFila(c);
    usar(c,()=>enviar(c,item.blocos,item.autor)).catch(e=>{emitir(c,{sessionUpdate:'ratoeira_erro',mensagem:'Não mandei a mensagem da fila: '+String(e?.message??e).slice(0,300)});});
  }
  // tirar ou mandar já um item da fila: quem escreveu, ou o dono (conexão sem convite)
  function itemDaFila(c,id,ws){
    const i=(c.fila??[]).findIndex(x=>x.id===id);if(i<0)throw erro('Essa mensagem já saiu da fila.');
    if(ws?.convite&&c.fila[i].autor?.email!==ws.quem?.email)throw erro('Só quem escreveu (ou o dono da conversa) mexe nessa mensagem.');
    return i;
  }
  function blocosValidos(blocos){
    if(!blocos.length||blocos.length>50||blocos.some(b=>!['text','image','resource_link','resource'].includes(b?.type)||(b.type==='text'&&(typeof b.text!=='string'||!b.text.trim()))
      ||(b.type==='image'&&(!/^image\/(png|jpeg|gif|webp)$/.test(b.mimeType)||typeof b.data!=='string'||!b.data))||(b.type==='resource_link'&&(typeof b.uri!=='string'||typeof b.name!=='string'))))
      throw erro('Mensagem vazia ou num formato que não dá pra mandar.');
    return blocos;
  }
  // Envios em andamento (Mesa). Some com a conexão que começou ou depois de 30 min parado.
  const envios=new Map();
  function soltarEnvio(e){envios.delete(e.id);if(e.fd!=null)try{closeSync(e.fd);}catch{}e.fd=null;rmSync(e.rascunho,{force:true});}
  function limparEnvios(){for(const e of [...envios.values()])if(agora()-e.em>30*60000)soltarEnvio(e);}
  function envioDe(id,ws){const e=envios.get(id);if(!e||e.ws!==ws)throw erro('Envio não encontrado (a conexão caiu?). Envie de novo.');return e;}
  // Depois que o arquivo está no lugar: pesado garante o bloco no .gitignore (e o caminho, se for grande) e fica fora
  // do git; o resto vira commit no nome da pessoa. Sem git, só grava.
  async function guardarEnviado(raiz,rel,tamanho){
    const topo=await gitArq(raiz,['rev-parse','--show-toplevel']);if(topo.code)return {commit:null,pesado:false};
    const repo=topo.stdout.trim(),relRepo=path.relative(realpathSync(repo),realpathSync(path.join(raiz,rel))).split(path.sep).join('/');
    let gitignore=null;
    if(ehPesado(relRepo,tamanho)&&gravarGitignore(repo,tamanho>LIMITE_PESADO&&!ehTipoPesado(relRepo)?[relRepo]:[]))
      gitignore=await commitarArquivo(repo,'.gitignore',log,{acao:'Pesado fora do git ('+relRepo+'): '});
    // o .gitignore do repo decide (uma exceção dele pode querer o vídeo versionado)
    if((await gitArq(repo,['check-ignore','-q','--',relRepo])).code===0)return {commit:gitignore,pesado:true};
    return {commit:await commitarArquivo(raiz,rel,log,{acao:'Enviado na tela: '}),pesado:false};
  }
  const ops={
    agentes:async()=>[...agentes.values()].map(({id,nome})=>({id,nome})),
    listar:async m=>listar(m.agente&&agentes.has(m.agente)?m.agente:null,caminhoOk(m.cwd)?m.cwd:null),
    // só pergunta modelos e modos: pasta que não existe usa a home, senão o Claude some da conversa nova
    opcoes:async m=>{if(!agentes.has(m.agente))throw erro('Agente desconhecido.');const casa=process.env.HOME??'/tmp';return opcoes(m.agente,caminhoOk(m.cwd)&&existsSync(m.cwd)?m.cwd:casa,idOk(m.conta)?m.conta:null);},
    nova:async m=>{
      if(!agentes.has(m.agente)||!caminhoOk(m.cwd))throw erro('Escolha o agente e a pasta.');
      const escolhas=m.opcoes&&typeof m.opcoes==='object'&&!Array.isArray(m.opcoes)?Object.fromEntries(Object.entries(m.opcoes).filter(([k,v])=>idOk(k)&&(typeof v==='string'||typeof v==='boolean')).slice(0,10)):{};
      const blocos=Array.isArray(m.blocos)?blocosValidos(m.blocos):typeof m.texto==='string'&&m.texto.trim()?[{type:'text',text:m.texto}]:null;
      const r=await nova(m.agente,m.cwd,mcpValidos(m.mcp),escolhas,blocos,typeof m.conta==='string'?m.conta:null,m.ultracode===true);
      if(blocos)marcarAparelho(m.agente,r?.sessao,m.aparelho);return r;
    },
    'conversa-ultracode':async m=>{if(!agentes.has(m.agente)||!idOk(m.sessao)||typeof m.ligar!=='boolean')throw erro('Conversa inválida.');return ultracodeDaConversa(m.agente,m.sessao,m.ligar);},
    'conversa-conta':async m=>{if(!agentes.has(m.agente)||!idOk(m.sessao))throw erro('Conversa inválida.');return trocarContaDaConversa(m.agente,m.sessao,String(m.conta??''));},
    abrir:async m=>{if(!agentes.has(m.agente)||!idOk(m.sessao)||(m.cwd!=null&&!caminhoOk(m.cwd)))throw erro('Conversa inválida.');return abrir(m.agente,m.sessao,m.cwd??null,mcpValidos(m.mcp),m.recarregar===true);},
    assinar:async(m,ws)=>{
      const c=ativa(m.agente,m.sessao);const novo=!c.assinantes.has(ws);c.assinantes.add(ws);ws.assinadas.add(c);
      const desde=Number.isInteger(m.desde)?m.desde:0;
      for(const ev of c.eventos)if(ev.seq>desde)mandar(ws,{t:'evento',agente:c.agente,sessao:c.sessao,...ev});
      if(novo)setImmediate(()=>avisarPresenca(c));
      return {seq:c.seq,estado:c.estado,presenca:presenca(c)};
    },
    soltar:async(m,ws)=>{const c=conversas.get(chave(m.agente,m.sessao));if(c&&c.assinantes.delete(ws)){ws.assinadas.delete(c);avisarPresenca(c);}return {};},
    enviar:async(m,ws)=>{
      const c=ativa(m.agente,m.sessao);const blocos=blocosValidos(Array.isArray(m.blocos)?m.blocos:[{type:'text',text:m.texto}]);
      if(c.filaParada){c.filaParada=false;emitirFila(c);}
      marcarAparelho(c.agente,c.sessao,m.aparelho);
      await usar(c,()=>enviar(c,blocos,ws?.quem??null));return {};
    },
    enfileirar:async(m,ws)=>{
      const c=ativa(m.agente,m.sessao);const blocos=blocosValidos(Array.isArray(m.blocos)?m.blocos:[{type:'text',text:m.texto}]);
      if((c.fila??=[]).length>=MAX_FILA)throw erro('A fila já tem '+MAX_FILA+' mensagens.');
      const item={id:randomUUID(),autor:ws?.quem??null,blocos,em:new Date(agora()).toISOString()};
      c.fila.push(item);emitirFila(c);marcarAparelho(c.agente,c.sessao,m.aparelho);setImmediate(()=>proximaDaFila(c));return {item:item.id};
    },
    'fila-tirar':async(m,ws)=>{const c=ativa(m.agente,m.sessao);const i=itemDaFila(c,m.item,ws);c.fila.splice(i,1);if(!c.fila.length)c.filaParada=false;emitirFila(c);return {};},
    // vai agora: livre, vira a próxima mensagem; rodando, entra no turno (como "Agora"). Destrava a fila parada.
    'fila-agora':async(m,ws)=>{
      const c=ativa(m.agente,m.sessao);const i=itemDaFila(c,m.item,ws);const [item]=c.fila.splice(i,1);c.filaParada=false;emitirFila(c);
      await usar(c,()=>enviar(c,item.blocos,item.autor));return {};
    },
    // "fulano está digitando": só repassa pros outros que estão com a conversa aberta (nada fica guardado)
    digitando:async(m,ws)=>{
      const c=ativa(m.agente,m.sessao);if(!ws?.quem)return {};
      for(const o of c.assinantes)if(o!==ws&&o.quem?.email!==ws.quem.email)mandar(o,{t:'digitando',agente:c.agente,sessao:c.sessao,pessoa:ws.quem,ativo:m.ativo!==false});
      return {};
    },
    // nota interna: vai só pras pessoas (tela), nunca pro agente; quem só lê também pode
    nota:async(m,ws)=>{
      const c=ativa(m.agente,m.sessao);
      const texto=typeof m.texto==='string'?m.texto.replace(/\r/g,'').trim():'';
      if(!texto||texto.length>4000)throw erro('Nota vazia ou grande demais (até 4000 caracteres).');
      const nota={id:randomUUID(),texto,autor:ws?.quem??{nome:'Dono',email:null},em:new Date(agora()).toISOString(),apos:Number.isInteger(m.apos)&&m.apos>=0?m.apos:0};
      guardarNota(c,nota);emitir(c,{sessionUpdate:'ratoeira_nota',nota});
      return {id:nota.id};
    },
    cancelar:async m=>{
      const c=ativa(m.agente,m.sessao);
      if(c.dormindo)return {};   // dormindo não tem nada rodando
      resolverPedidos(c,{outcome:{outcome:'cancelled'}});
      // pedido do fundo, sem turno nosso: Parar é o que tira do "esperando"
      if(!c.turnos)mudarEstado(c,'livre');
      const conn=await adaptadorDe(c).conexao();await conn.cancel({sessionId:c.sessao});return {};
    },
    opcao:async m=>{
      const c=ativa(m.agente,m.sessao);
      if(!idOk(m.opcao)||typeof m.valor!=='string'&&typeof m.valor!=='boolean')throw erro('Opção inválida.');
      return usar(c,async()=>{
        const conn=await adaptadorDe(c).conexao();
        const r=await conn.setSessionConfigOption({sessionId:c.sessao,configId:m.opcao,value:m.valor});
        if(r?.configOptions){c.config.configOptions=r.configOptions;avisarConfig(c);}
        return {config:c.config};
      });
    },
    habilidades:async()=>habilidadesGlobais(contasCfg?.home),
    comandos:async m=>{if(!agentes.has(m.agente))throw erro('Agente desconhecido.');return comandosDe.get(m.agente)??[];},
    // contas do agente (seletor da caixa do chat): a lista com o uso de cada uma, e trocar a que vale
    contas:async m=>{if(!agentes.has(m.agente))throw erro('Agente desconhecido.');return listaContas(m.agente);},
    'conta-usar':async m=>{if(!agentes.has(m.agente))throw erro('Agente desconhecido.');const r=usarConta(m.agente,String(m.conta??''));avisarConta(m.agente);return r;},
    automacoes:async()=>automacoesDe(conta().home),
    'automacao-alternar':async m=>{alternarAutomacao(conta().home,m.linha,String(m.texto??''),m.ligar===true);return automacoesDe(conta().home);},
    rotinas:async()=>rotinasDe(conta().home),
    'rotina-alternar':async m=>{alternarRotina(conta().home,m.rotina,m.ligar===true);return rotinasDe(conta().home);},
    'rotina-salvar':async m=>{const rotina=salvarRotina(conta().home,{rotina:m.rotina??null,nome:m.nome,quando:m.quando,agente:m.agente,pasta:m.pasta,pedido:m.pedido,avisar:m.avisar??null,ligada:m.ligada!==false});return {rotina,rotinas:rotinasDe(conta().home)};},
    'rotina-apagar':async m=>{apagarRotina(conta().home,m.rotina);return rotinasDe(conta().home);},
    // abas de conversa de cada aparelho da pessoa, com o nome que ela deu por cima do que o navegador mandou
    abertas:async()=>abertasDe(conta().home,agora()).map(a=>({...a,conversas:a.conversas.map(c=>({...c,titulo:nomes().get(chave(c.agente,c.sessao))??c.titulo}))})),
    'abertas-gravar':async m=>{gravarAbertas(conta().home,{aparelho:m.aparelho,tipo:m.tipo,conversas:m.conversas},agora());return {};},
    // Rodar agora: o mesmo caminho do cron (invólucro + ratoeira-rotina), solto deste processo
    'rotina-rodar':async m=>{
      if(!ID_ROTINA.test(String(m.rotina))||!rotinasDe(conta().home).some(r=>r.id===m.rotina))throw erro('Rotina não encontrada.');
      const filho=spawn('/usr/local/bin/ratoeira-cron',['rotina-'+m.rotina,'--','/usr/local/bin/ratoeira-rotina',m.rotina],{cwd:conta().home,detached:true,stdio:'ignore',env:{...process.env,HOME:conta().home}});
      filho.on('error',()=>{});filho.unref();ultimo=agora();
      return {ok:true};
    },
    'automacao-log':async m=>{
      const nome=String(m.nome??'');if(!/^[A-Za-z0-9._-]{1,60}$/.test(nome))throw erro('Automação inválida.');
      try{const t=readFileSync(path.join(conta().home,'.local','state','ratoeira','crons',nome+'.log'),'utf8');return {texto:t.slice(-60000)};}catch{return {texto:''};}
    },
    transcrever:async m=>{
      if(typeof m.audio!=='string'||!m.audio||m.audio.length>Math.ceil(MAX_AUDIO*4/3)+4)throw erro('O áudio veio vazio ou grande demais.');
      if(m.raiz!=null&&!caminhoOk(m.raiz))throw erro('Pasta inválida.');
      return ditado().transcrever({audio:Buffer.from(m.audio,'base64'),mime:m.mime,duracaoMs:Number.isFinite(m.duracaoMs)?m.duracaoMs:0,raiz:m.raiz??null});
    },
    // anexo do chat: grava e devolve o caminho, que o chat põe na mensagem pro agente ler
    anexo:async m=>{
      if(typeof m.dados!=='string'||!m.dados||m.dados.length>Math.ceil(MAX_ANEXO*4/3)+4)throw erro('O arquivo veio vazio ou passa de '+Math.round(MAX_ANEXO/1048576)+' MB.');
      const bytes=Buffer.from(m.dados,'base64');if(!bytes.length)throw erro('O arquivo veio vazio.');
      limparAnexos();
      const dia=new Date(agora()).toISOString().slice(0,10),pasta=path.join(pastaAnexos(),dia);
      mkdirSync(pasta,{recursive:true,mode:0o700});
      const nome=nomeAnexo(m.nome),caminho=path.join(pasta,randomUUID().slice(0,8)+'-'+nome);
      writeFileSync(caminho,bytes,{mode:0o600,flag:'wx'});
      return {caminho,nome,tamanho:bytes.length};
    },
    'ditado-estado':async m=>ditado().estado({fresco:m.fresco===true}),
    'ditado-aquecer':async()=>ditado().aquecer(),
    'chaves-locais':async m=>{if(!caminhoOk(m.raiz))throw erro('Pasta inválida.');return chavesLocais(m.raiz);},
    integracoes:async m=>{
      if(cacheMcp&&!m.atualizar&&agora()-cacheMcp.em<120000)return cacheMcp;
      const rodar=(cli,args,cwd)=>new Promise(ok=>{if(!cli)return ok(null);execFile(cli,args,{env:envCli('claude'),cwd,timeout:90000,maxBuffer:1<<20},(e,stdout)=>ok(e&&!stdout?null:String(stdout)));});
      const cwd=caminhoOk(m.cwd)&&existsSync(m.cwd)?m.cwd:conta().home;
      const [cl,cx]=await Promise.all([rodar(conta().clis.claude,['mcp','list'],cwd),rodar(conta().clis.codex,['mcp','list','--json'],conta().home)]);
      let codex=[];try{codex=(JSON.parse(cx||'[]')||[]).map(x=>({nome:String(x.name??x.id??''),alvo:(()=>{try{return new URL(x.url??x.transport?.url).hostname;}catch{return path.basename(String(x.command??x.transport?.command??''));}})(),estado:x.enabled===false?'desligado':'instalado',origem:'instalado'}));}catch{}
      cacheMcp={claude:cl==null?null:lerMcpList(cl),codex,em:agora()};
      return cacheMcp;
    },
    ler:async m=>{
      const f=arquivoEditavel(m.raiz,m.caminho);const buf=readFileSync(f);
      if(buf.subarray(0,8192).includes(0))throw erro('Este arquivo não é texto.');
      return {texto:buf.toString('utf8'),hash:hashDe(buf)};
    },
    salvar:async m=>{
      const f=arquivoEditavel(m.raiz,m.caminho);
      if(typeof m.texto!=='string'||Buffer.byteLength(m.texto)>MAX_EDITAR)throw erro('Texto grande demais pro editor (até 2 MB).');
      // mudou desde que a pessoa abriu (agente, outra pessoa, sync): não escreve por cima sem ela mandar
      if(!m.forcar&&hashDe(readFileSync(f))!==m.base)return {conflito:true};
      writeFileSync(f,m.texto);ultimo=agora();
      return {hash:hashDe(Buffer.from(m.texto)),commit:await commitarArquivo(path.resolve(m.raiz),m.caminho,log)};
    },
    publicar:async m=>{
      const p=prepararPublicacao(path.resolve(String(m.raiz??'')),{arquivo:m.arquivo,nome:m.nome,titulo:m.titulo,acesso:m.acesso,senha:m.senha,junto:m.junto??[],modo:m.modo,dono:m.dono});
      gravarPublicacao(p);ultimo=agora();
      return {nome:p.m.nome,entrada:p.entrada,modo:p.modo,commit:await commitarPasta(path.resolve(m.raiz),path.join('playground',p.m.nome),`Publicado na tela: ${p.m.nome} (${m.arquivo})`,log)};
    },
    despublicar:async m=>{
      const raiz=path.resolve(String(m.raiz??''));
      if(!caminhoOk(raiz)||!NOME_PUB.test(m.nome??''))throw erro('Publicação inválida.');
      const item=path.join(raiz,'playground',m.nome);
      let man;try{man=JSON.parse(readFileSync(path.join(item,'ratoeira-play.json'),'utf8'));}catch{throw erro('Essa publicação não existe.');}
      if((man.tipo??(man.porta!=null?'programa':'pagina'))!=='pagina')throw erro('Programa (Docker) se tira do ar pelo chat: ele tem container pra parar.');
      rmSync(item,{recursive:true,force:true});ultimo=agora();
      return {commit:await commitarPasta(raiz,path.join('playground',m.nome),`Tirado do ar na tela: ${m.nome}`,log)};
    },
    // Enviar arquivo (Mesa): começa, recebe as partes em ordem, conclui. Mesmo nome sem decisão: {existe:true},
    // e a tela pergunta (substituir, manter os dois ou pular).
    'arquivo-enviar':async(m,ws)=>{
      limparEnvios();
      const tamanho=m.tamanho;
      if(!Number.isSafeInteger(tamanho)||tamanho<0)throw erro('Tamanho inválido.');
      if(tamanho>MAX_ENVIO)throw erro('Arquivo grande demais (até 2 GB por arquivo).');
      if(envios.size>=16)throw erro('Envios demais ao mesmo tempo. Espere os outros terminarem.');
      const raiz=path.resolve(String(m.raiz??''));const d=destinoEnvio(raiz,m.caminho);
      if(d.existe&&!['substituir','manter'].includes(m.seExistir))return {existe:true};
      const dir=path.join(conta().home,'.cache','ratoeira','envios');mkdirSync(dir,{recursive:true,mode:0o700});
      const id=randomUUID(),rascunho=path.join(dir,id);
      envios.set(id,{id,ws,raiz,caminho:m.caminho,seExistir:m.seExistir??null,tamanho,recebido:0,rascunho,fd:openSync(rascunho,'wx',0o600),em:agora()});
      ultimo=agora();
      return {envio:id};
    },
    'arquivo-parte':async(m,ws)=>{
      const e=envioDe(m.envio,ws);
      if(m.pos!==e.recebido)throw erro('Parte fora de ordem. Envie de novo.');
      if(typeof m.dados!=='string')throw erro('Parte inválida.');
      const buf=Buffer.from(m.dados,'base64');
      if(buf.length>MAX_PARTE||e.recebido+buf.length>e.tamanho)throw erro('Parte maior que o arquivo.');
      let escrito=0;while(escrito<buf.length)escrito+=writeSync(e.fd,buf,escrito,buf.length-escrito,e.recebido+escrito);
      e.recebido+=buf.length;e.em=ultimo=agora();
      return {recebido:e.recebido};
    },
    'arquivo-concluir':async(m,ws)=>{
      const e=envioDe(m.envio,ws);
      if(e.recebido!==e.tamanho)throw erro('O arquivo não chegou inteiro. Envie de novo.');
      closeSync(e.fd);e.fd=null;envios.delete(e.id);
      try{
        // confere de novo: entre o começo e o fim alguém pode ter criado o mesmo nome (ou um atalho)
        const d=destinoEnvio(e.raiz,e.caminho);
        if(d.existe&&!e.seExistir)throw erro('Apareceu um arquivo com esse nome enquanto enviava. Envie de novo.');
        const alvo=d.existe&&e.seExistir==='manter'?nomeLivre(d.abs):d.abs;
        mkdirSync(path.dirname(alvo),{recursive:true});
        try{renameSync(e.rascunho,alvo);}catch(x){if(x.code!=='EXDEV')throw x;cpSync(e.rascunho,alvo);rmSync(e.rascunho,{force:true});}
        ultimo=agora();
        const rel=path.relative(path.resolve(e.raiz),alvo).split(path.sep).join('/');
        return {caminho:rel,...await guardarEnviado(e.raiz,rel,e.tamanho)};
      }finally{rmSync(e.rascunho,{force:true});}
    },
    'arquivo-cancelar':async(m,ws)=>{const e=envios.get(m.envio);if(e&&e.ws===ws)soltarEnvio(e);return {};},
    apagar:async m=>{
      const f=arquivoEditavel(m.raiz,m.caminho,{limite:false});
      unlinkSync(f);ultimo=agora();
      return {commit:await commitarArquivo(path.resolve(m.raiz),m.caminho,log,{apagado:true})};
    },
    'arquivo-criar':async m=>{
      const {abs,rel}=caminhoNovo(m.raiz,m.pasta,m.nome);
      // pasta vazia: o git não guarda, mas a árvore (que lê o disco) mostra
      if(m.tipo==='pasta'){mkdirSync(abs);ultimo=agora();return {caminho:rel,tipo:'pasta'};}
      writeFileSync(abs,conteudoInicial(m.nome),{flag:'wx'});ultimo=agora();
      return {caminho:rel,tipo:'arquivo',commit:await commitarArquivo(path.resolve(m.raiz),rel,log,{acao:'Criado na tela: '})};
    },
    'arquivo-renomear':async m=>{
      const de=itemExistente(m.raiz,m.caminho);
      const pasta=m.caminho.includes('/')?m.caminho.slice(0,m.caminho.lastIndexOf('/')):'';
      const {abs,rel}=caminhoNovo(m.raiz,pasta,m.nome);
      const pastaInteira=statSync(de).isDirectory();
      renameSync(de,abs);ultimo=agora();
      return {caminho:rel,tipo:pastaInteira?'pasta':'arquivo',commit:await commitarCaminhos(path.resolve(m.raiz),[m.caminho,rel],'Renomeado na tela: '+m.caminho+' → '+rel,log)};
    },
    renomear:async m=>{
      if(!agentes.has(m.agente)||!idOk(m.sessao)||typeof m.titulo!=='string')throw erro('Conversa inválida.');
      const titulo=m.titulo.replace(/[\u0000-\u001f\u007f]+/g,' ').trim().slice(0,200);
      const k=chave(m.agente,m.sessao);
      if(titulo)nomes().set(k,titulo);else nomes().delete(k);
      // não cresce sem fim: sai o nome mais antigo
      while(nomes().size>2000)nomes().delete(nomes().keys().next().value);
      guardarNomes();
      const c=conversas.get(k),final=titulo||c?.titulo||null;
      // as outras abas (e outros navegadores) com a conversa aberta recebem o nome novo
      if(c&&final)emitir(c,{sessionUpdate:'session_info_update',title:final});
      return {titulo:final};
    },
    responder:async m=>{
      const c=ativa(m.agente,m.sessao);const p=c.pedidos.get(m.pedido);
      if(!p||p.tipo!=='pergunta')throw erro('Essa pergunta já foi respondida.');
      const r=m.resposta;
      if(!r||!['accept','decline','cancel'].includes(r.action)||(r.action==='accept'&&(typeof r.content!=='object'||r.content===null||Array.isArray(r.content))))throw erro('Resposta inválida.');
      // só os campos que o formulário pediu, com valor simples
      const campos=p.params.requestedSchema?.properties??{};
      const content=r.action==='accept'?Object.fromEntries(Object.entries(r.content).filter(([k,v])=>Object.hasOwn(campos,k)&&(['string','number','boolean'].includes(typeof v)||(Array.isArray(v)&&v.every(x=>typeof x==='string'))))):undefined;
      c.pedidos.delete(m.pedido);p.resolve(r.action==='accept'?{action:'accept',content}:{action:r.action});
      emitir(c,{sessionUpdate:'ratoeira_pedido_resolvido',pedido:m.pedido,resposta:r.action,content:content??null});
      depoisDoPedido(c);
      return {};
    },
    permitir:async m=>{
      const c=ativa(m.agente,m.sessao);const p=c.pedidos.get(m.pedido);
      if(!p||p.tipo==='pergunta')throw erro('Esse pedido já foi respondido.');
      if(!p.params.options.some(o=>o.optionId===m.opcao))throw erro('Opção inválida.');
      c.pedidos.delete(m.pedido);p.resolve({outcome:{outcome:'selected',optionId:m.opcao}});
      emitir(c,{sessionUpdate:'ratoeira_pedido_resolvido',pedido:m.pedido,resposta:m.opcao});
      depoisDoPedido(c);
      return {};
    },
  };

  // Terminal (aba da grade da Mesa): o shell da pessoa num PTY, em terminal.mjs. Não conta como "ocupado":
  // sem ninguém conectado por `ociosoMin`, o servidor sai e leva o shell junto.
  const terminais=criarTerminais({python:()=>conta().python,home:()=>conta().home,env:()=>envCli('claude'),log,aoUsar:()=>{ultimo=agora();}});
  Object.assign(ops,terminais.ops);

  function mandar(ws,msg){if(ws.readyState===1)ws.send(JSON.stringify(msg));}
  // Convidado (entrou pela conversa de outra pessoa): só aquela conversa, e só olhar, ou olhar e falar.
  // Aprovar pedido do agente, trocar modelo, renomear, ferramentas de app: nada disso, é do dono.
  const OPS_LER=new Set(['agentes','abrir','assinar','soltar','nota','digitando']),OPS_ENTRAR=new Set([...OPS_LER,'enviar','cancelar','enfileirar','fila-tirar','fila-agora','anexo']);
  function travaConvite(ws,m){
    const cv=ws.convite;if(!cv)return null;
    if(cv.invalido)return 'Convite inválido.';
    if(!(cv.modo==='entrar'?OPS_ENTRAR:OPS_LER).has(m.op))
      return cv.modo==='ler'&&['enviar','cancelar'].includes(m.op)?'Essa conversa foi compartilhada contigo só pra leitura.':'Isso só quem é dono da conversa faz.';
    if(m.op==='agentes')return null;
    if(m.agente!==cv.agente||m.sessao!==cv.sessao)return 'Essa conversa não foi compartilhada contigo.';
    if(m.op==='abrir'){m.cwd=cv.cwd;delete m.mcp;delete m.recarregar;}
    return null;
  }
  async function tratar(ws,bruto){
    ultimo=agora();let m;
    try{m=JSON.parse(bruto);}catch{return;}
    const id=m?.id;const op=ops[m?.op];
    if(!op)return mandar(ws,{t:'resposta',id,ok:false,erro:'Pedido desconhecido.'});
    const barrado=travaConvite(ws,m);
    if(barrado)return mandar(ws,{t:'resposta',id,ok:false,erro:barrado});
    try{mandar(ws,{t:'resposta',id,ok:true,dados:await op(m,ws)});}
    catch(e){
      if(!e.publico)log(`[${m.op}] ${e?.message??e}`);
      mandar(ws,{t:'resposta',id,ok:false,erro:e.publico?e.message:'O agente não respondeu. Tente de novo.'});
    }
  }

  // Conexões. O token da conta geral (CLAUDE_CODE_OAUTH_TOKEN, posto pelo conta-claude) mascara o
  // status: só vale pra quem é da geral fixa, ou pra quem ainda não tem login próprio no disco.
  // No login ele sai sempre: quem conecta está conectando a própria conta.
  let contas=null;const conta=()=>contas??={...padraoContas(),...contasCfg};
  // Anexos do chat: a pasta entra na conversa como pasta extra (additionalDirectories do ACP), pro agente ler
  // o anexo sem pedir permissão de arquivo fora do projeto
  const pastaAnexos=()=>path.join(conta().home,'.local','share','ratoeira','anexos');
  function pastasExtras(a){
    if(!a.capacidades?.sessionCapabilities?.additionalDirectories)return {};
    try{mkdirSync(pastaAnexos(),{recursive:true,mode:0o700});return {additionalDirectories:[pastaAnexos()]};}catch{return {};}
  }
  function limparAnexos(){
    const limite=agora()-DIAS_ANEXO*86400000;
    try{for(const dia of readdirSync(pastaAnexos()))if(/^\d{4}-\d{2}-\d{2}$/.test(dia)&&Date.parse(dia)<limite)rmSync(path.join(pastaAnexos(),dia),{recursive:true,force:true});}catch{}
  }
  let cacheMcp=null;
  let login=null;
  function envCli(provider,{logando=false}={}){
    const env={...process.env,HOME:conta().home,BROWSER:'/bin/true',TERM:'xterm-256color',COLUMNS:'160',LINES:'30',NO_COLOR:'1'};
    if(provider==='claude'&&(logando||contasClaude().ativa?.tipo==='propria'))delete env.CLAUDE_CODE_OAUTH_TOKEN;
    // login: o da própria vai pro ~/.claude; o de uma conta pessoal, quem chama põe a pasta dela
    if(provider==='claude'&&logando)delete env.CLAUDE_CONFIG_DIR;
    // o status e o login da conta própria do Codex são os do ~/.codex, não os da conta padrão
    if(provider==='codex'){delete env.CODEX_HOME;delete env.CODEX_SQLITE_HOME;}
    return env;
  }
  // O arquivo também guarda os logins dos MCPs: conta própria é ter o login do Claude dentro dele.
  const credClaude=()=>path.join(conta().home,'.claude','.credentials.json');
  const claudePropria=()=>{try{return readFileSync(credClaude(),'utf8').includes('"claudeAiOauth"');}catch{return false;}};
  const codexPropria=()=>{try{return lstatSync(codexAuth()).isFile();}catch{return false;}};
  const doGrupo=(...g)=>g.some(x=>(conta().grupos??[]).includes(x));
  // ── Várias contas do Claude (desde 10/10/2026). Mesma regra do kit/multiusuario/conta-claude, que escolhe
  // a conta quando o servidor liga: as da organização (um token por arquivo, lido só por quem pode usar),
  // as pessoais (tokens de 1 ano que a pessoa adicionou) e o login próprio. A escolhida fica num arquivo
  // da pessoa; sem escolha (ou se ela não vale mais), a primeira da lista: login, pessoais, organização.
  const dirPessoais=()=>path.join(conta().home,'.config','ratoeira','claude-contas');
  const dirConta=id=>path.join(dirPessoais(),id);
  const temLogin=dir=>{try{return readFileSync(path.join(dir,'.credentials.json'),'utf8').includes('"claudeAiOauth"');}catch{return false;}};
  const arqEscolha=()=>path.join(conta().home,'.config','ratoeira','claude-conta');
  const lerContas=dir=>{try{return readFileSync(path.join(dir,'contas.tsv'),'utf8').split('\n').map(l=>l.split('\t')).filter(([id])=>ID_CONTA.test(id??'')).map(([id,nome])=>({id,nome:(nome||id).trim()}));}catch{return [];}};
  const legivel=f=>{try{accessSync(f,fsc.R_OK);return true;}catch{return false;}};
  const modoClaude=()=>doGrupo('ratoeira-claude-geral')||conta().geralFixa?'geral':doGrupo('ratoeira-claude')?'opcional':'propria';
  function contasClaude(){
    const modo=modoClaude(),org=conta().orgClaude,lista=[];
    if(modo!=='geral'){
      if(claudePropria())lista.push({id:'propria',tipo:'propria',nome:'Tua conta',completa:true});
      // pessoal: login completo (pasta de config dela) ou, do jeito antigo, token do setup-token
      for(const c of lerContas(dirPessoais())){
        const dir=dirConta(c.id),arq=path.join(dirPessoais(),c.id+'.token');
        if(temLogin(dir))lista.push({id:'pessoal:'+c.id,tipo:'pessoal',nome:c.nome,dir,completa:true});
        else if(legivel(arq))lista.push({id:'pessoal:'+c.id,tipo:'pessoal',nome:c.nome,arq,completa:false});
      }
    }
    if(modo!=='propria'){
      const daOrg=lerContas(org).map(c=>({...c,arq:path.join(org,c.id+'.token')})).filter(c=>legivel(c.arq));
      for(const c of daOrg)lista.push({id:'org:'+c.id,tipo:'org',nome:c.nome,arq:c.arq,completa:false});
      // o arquivo antigo, de uma conta só, até o root migrar (aplicar-acessos)
      if(!daOrg.length&&legivel(conta().geralClaude))lista.push({id:'org:geral',tipo:'org',nome:'Conta da organização',arq:conta().geralClaude,completa:false});
    }
    let escolha=null;try{escolha=readFileSync(arqEscolha(),'utf8').slice(0,64).trim();}catch{}
    return {modo,lista,ativa:lista.find(c=>c.id===escolha)??lista[0]??null};
  }
  // põe no ambiente do servidor a conta que vale agora (o adaptador e o terminal herdam quando ligam)
  function aplicarContaClaude(){
    const {ativa}=contasClaude();let t=null;
    if(ativa?.arq)try{t=readFileSync(ativa.arq,'utf8').trim()||null;}catch{}
    if(t)process.env.CLAUDE_CODE_OAUTH_TOKEN=t;else delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
    // conta pessoal com login completo: o Claude lê o login da pasta dela
    if(ativa?.dir){try{prepararDirConta(ativa.dir,conta().home);}catch(e){log(`conta: pasta ${e.message}`);}process.env.CLAUDE_CONFIG_DIR=ativa.dir;}
    else delete process.env.CLAUDE_CONFIG_DIR;
    contaAtivaId=ativa?.id??null;return ativa;
  }
  let contaAtivaId;
  // ── Várias contas do Codex (desde 28/10/2026), no jeito das do Claude: regra e pastas em contas-codex.mjs.
  // Cada conta é uma pasta de config (CODEX_HOME) com o login dela; os bancos ficam no ~/.codex (CODEX_SQLITE_HOME),
  // então as conversas de todas as contas são as mesmas e trocar a conta de uma conversa não perde nada.
  const cfgCodex=()=>({home:conta().home,org:conta().orgCodex,geral:conta().geralCodex,grupos:conta().grupos});
  const listaCodex=()=>contasCodex(cfgCodex());
  const dirPessoaisCodex=()=>dirPessoaisCodexDe(conta().home);
  const dirContaCodex=id=>path.join(dirPessoaisCodex(),id);
  const loginCodexEm=dir=>{try{const o=JSON.parse(readFileSync(path.join(dir,'auth.json'),'utf8'));return Boolean(o?.tokens?.refresh_token||o?.OPENAI_API_KEY);}catch{return false;}};
  let contaCodexAtivaId;
  // põe no ambiente do servidor a conta padrão do Codex (o terminal herda; cada adaptador recebe a da conversa)
  function aplicarContaCodex(){
    const {ativa}=listaCodex();let env={CODEX_HOME:null,CODEX_SQLITE_HOME:null};
    try{env=envDaContaCodex(ativa,conta().home);}catch(e){log(`conta do codex: pasta ${e.message}`);}
    for(const [k,v] of Object.entries(env))if(v==null)delete process.env[k];else process.env[k]=v;
    contaCodexAtivaId=ativa?.id??null;return ativa;
  }
  const contasDe=agente=>agente==='claude'?contasClaude():agente==='codex'?listaCodex():{modo:null,lista:[],ativa:null};
  const COM_CONTAS=new Set(['claude','codex']);
  const chaveLimites=(agente,contaId)=>agente==='claude'?'claude|'+(contaId??(contaAtivaId===undefined?(contaAtivaId=contasClaude().ativa?.id??null):contaAtivaId))
    :agente==='codex'?'codex|'+(contaId??(contaCodexAtivaId===undefined?(contaCodexAtivaId=listaCodex().ativa?.id??null):contaCodexAtivaId)):agente;
  function escreverPrivado(arq,texto){mkdirSync(path.dirname(arq),{recursive:true,mode:0o700});const t=arq+'.'+process.pid+'.tmp';writeFileSync(t,texto,{mode:0o600});renameSync(t,arq);}
  // lista pra tela: sem o caminho do arquivo, com o último uso visto de cada conta
  function listaContas(agente){
    if(!COM_CONTAS.has(agente))return {ativa:null,contas:[],podeTrocar:false};
    const {modo,lista,ativa}=contasDe(agente);
    // a padrão só vale pras conversas novas: dá pra trocar com conversa rodando
    return {modo,ativa:ativa?.id??null,podeTrocar:true,contas:lista.map(({id,tipo,nome,completa})=>({id,tipo,nome,completa,limites:limitesDoAgente(agente+'|'+id)}))};
  }
  function usarConta(agente,id){
    if(!COM_CONTAS.has(agente))throw erro('Este agente não tem várias contas.');
    const {lista}=contasDe(agente);
    if(!lista.some(c=>c.id===id))throw erro('Essa conta não está disponível pra ti.');
    // só a padrão (conversas novas, terminal, rotinas): as conversas abertas seguem na conta delas
    if(agente==='codex'){escreverPrivado(arqEscolhaCodexDe(conta().home),id+'\n');aplicarContaCodex();}
    else{escreverPrivado(arqEscolha(),id+'\n');aplicarContaClaude();}
    return listaContas(agente);
  }
  function removerPessoalCodex(id){
    const atuais=lerContas(dirPessoaisCodex());if(!atuais.some(c=>c.id===id))throw erro('Conta não encontrada.');
    escreverPrivado(path.join(dirPessoaisCodex(),'contas.tsv'),atuais.filter(c=>c.id!==id).map(c=>c.id+'\t'+c.nome+'\n').join(''));
    // rmSync não segue os atalhos pro ~/.codex, só apaga eles
    try{if(lstatSync(dirContaCodex(id)).isDirectory())rmSync(dirContaCodex(id),{recursive:true,force:true});}catch{}
    if(contaCodexAtivaId==='pessoal:'+id||listaCodex().ativa?.id!==contaCodexAtivaId){aplicarContaCodex();trocarConta('codex');}
  }
  function adicionarPessoal(nome,token){
    const t=String(token??'').trim(),n=String(nome??'').replace(/[\t\r\n]+/g,' ').trim().slice(0,60);
    if(!TOKEN_CLAUDE.test(t))throw erro('Token inválido: é o que o claude setup-token mostra no fim, começando com sk-ant-oat01-.');
    const atuais=lerContas(dirPessoais());if(atuais.length>=10)throw erro('Já são 10 contas pessoais.');
    const id=randomUUID().replace(/-/g,'').slice(0,10);
    escreverPrivado(path.join(dirPessoais(),id+'.token'),t);
    escreverPrivado(path.join(dirPessoais(),'contas.tsv'),[...atuais,{id,nome:n||'Conta pessoal '+(atuais.length+1)}].map(c=>c.id+'\t'+c.nome+'\n').join(''));
    return {id:'pessoal:'+id};
  }
  function removerPessoal(id){
    const atuais=lerContas(dirPessoais());if(!atuais.some(c=>c.id===id))throw erro('Conta não encontrada.');
    escreverPrivado(path.join(dirPessoais(),'contas.tsv'),atuais.filter(c=>c.id!==id).map(c=>c.id+'\t'+c.nome+'\n').join(''));
    try{unlinkSync(path.join(dirPessoais(),id+'.token'));}catch{}
    // a pasta da conta: rmSync não segue os atalhos pro ~/.claude, só apaga eles
    try{if(lstatSync(dirConta(id)).isDirectory())rmSync(dirConta(id),{recursive:true,force:true});}catch{}
    // era a que estava valendo: volta pra regra (e o adaptador religa, se nada estiver rodando)
    if(contaAtivaId==='pessoal:'+id||contasClaude().ativa?.id!==contaAtivaId){aplicarContaClaude();trocarConta('claude');}
  }
  // Conta trocada (login ou desconectar): o adaptador guarda a conta de quando ligou, então religa ele.
  // Com conversa rodando não mexe (vale quando o servidor religar); as paradas retomam na próxima mensagem.
  // Cada adaptador do agente que não tem conversa rodando religa (as paradas retomam na próxima mensagem).
  function trocarConta(agente){
    for(const k of semLoginAte.keys())if(k.startsWith(agente+'|'))semLoginAte.delete(k);
    let todos=true;
    for(const [k,a] of adaptadores){
      if(!k.startsWith(agente+'|')||!a.child)continue;
      const contaId=k.slice(agente.length+1)||null;
      const daqui=[...conversas.values()].filter(c=>c.agente===agente&&(c.conta??null)===contaId);
      if(daqui.some(c=>c.estado!=='livre')){todos=false;continue;}
      for(const c of daqui)if(!c.dormindo)c.solta=true;   // a dormindo acorda já no adaptador novo
      a.parar();
    }
    return todos;
  }
  // ── Conta de cada conversa (desde 16/10/2026) ──
  // contaPara: a pedida, se a pessoa pode usar; senão a padrão. Só o Claude tem contas.
  function contaPara(agente,pedida){
    if(!COM_CONTAS.has(agente))return null;
    const {lista,ativa}=contasDe(agente);
    return pedida&&lista.some(x=>x.id===pedida)?pedida:ativa?.id??null;
  }
  // o ambiente do processo de uma conta: pasta de config (login completo) ou token; null tira o herdado
  function envDaConta(agente,contaId){
    if(agente==='codex'){
      const x=listaCodex().lista.find(c=>c.id===contaId);if(!x)return {};
      try{return envDaContaCodex(x,conta().home);}catch(e){log(`conta do codex: pasta ${e.message}`);return {};}
    }
    const x=contasClaude().lista.find(c=>c.id===contaId);if(!x)return {};
    if(x.dir){try{prepararDirConta(x.dir,conta().home);}catch(e){log(`conta: pasta ${e.message}`);}return {CLAUDE_CONFIG_DIR:x.dir,CLAUDE_CODE_OAUTH_TOKEN:null};}
    if(x.arq){let t=null;try{t=readFileSync(x.arq,'utf8').trim()||null;}catch{}return {CLAUDE_CODE_OAUTH_TOKEN:t,CLAUDE_CONFIG_DIR:null};}
    return {CLAUDE_CODE_OAUTH_TOKEN:null,CLAUDE_CONFIG_DIR:null};   // própria: o ~/.claude de sempre
  }
  // a conta de cada conversa fica gravada, pra reabrir nela depois (servidor religado, aba fechada)
  const arqContaConversa=()=>path.join(conta().home,'.local','state','ratoeira','conta-conversa.json');
  function lerContaConversa(){try{const o=JSON.parse(readFileSync(arqContaConversa(),'utf8'));return o&&typeof o==='object'&&!Array.isArray(o)?o:{};}catch{return {};}}
  const contaGravada=(agente,sessao)=>COM_CONTAS.has(agente)?lerContaConversa()[sessao]??null:null;
  function gravarContaDaConversa(c){
    if(!COM_CONTAS.has(c.agente)||!c.conta)return;
    try{const o=lerContaConversa();delete o[c.sessao];o[c.sessao]=c.conta;
      const ks=Object.keys(o);for(const k of ks.slice(0,Math.max(0,ks.length-2000)))delete o[k];
      escreverPrivado(arqContaConversa(),JSON.stringify(o));}catch(e){log(`conta da conversa: ${e.message}`);}
  }
  // Trocar a conta de uma conversa: ela dorme no adaptador da conta velha e acorda no da nova na próxima
  // mensagem (resume, mesmo histórico). Rodando ou esperando resposta, não troca.
  async function trocarContaDaConversa(agente,sessao,contaId){
    if(!COM_CONTAS.has(agente))throw erro('Este agente não tem várias contas.');
    if(!contasDe(agente).lista.some(x=>x.id===contaId))throw erro('Essa conta não está disponível pra ti.');
    const c=conversas.get(chave(agente,sessao));
    if(!c){gravarContaDaConversa({agente,sessao,conta:contaId});return {conta:contaId};}
    if(c.conta===contaId)return resumo(c);
    if(c.estado!=='livre'||c.pedidos.size)throw erro('Espere a resposta terminar (ou pare) antes de trocar a conta desta conversa.');
    // Codex: o processo de uma conta segura a conversa (o "escritor" dela) até fechar, e o da outra conta não abre
    // ("session is in use by another Codex client"). Então o processo da conta de antes fecha: as outras conversas
    // paradas dela dormem junto e acordam sozinhas na próxima mensagem. Com outra rodando nela, espera.
    const antiga=c.conta??null,doCodex=agente==='codex'&&acordada(c);
    const vizinhas=doCodex?[...conversas.values()].filter(x=>x!==c&&x.agente==='codex'&&(x.conta??null)===antiga&&acordada(x)):[];
    if(vizinhas.some(x=>x.estado!=='livre'||x.pedidos.size||noFundo(x)))throw erro('Outra conversa do Codex está rodando nessa conta: espere ela terminar (ou pare) antes de trocar a conta desta.');
    if(acordada(c)&&!(await dormir(c,'troca de conta')))c.solta=true;
    if(doCodex){
      for(const x of vizinhas)if(acordada(x)&&!(await dormir(x,'troca de conta de outra conversa')))x.solta=true;
      adaptadores.get(chaveAd('codex',antiga))?.parar();
    }
    return comTrava(chave(agente,sessao),async()=>{
      c.conta=contaId;gravarContaDaConversa(c);
      emitir(c,{sessionUpdate:'ratoeira_conta',conta:contaId});emitirUso(c);
      log(`[${agente}] conversa ${sessao} agora na conta ${contaId}`);
      return resumo(c);
    });
  }
  // Ultracode (desde 16/10/2026): o Claude divide o trabalho em vários agentes (workflows). Vai nas configurações
  // da sessão (settings.ultracode) quando ela abre ou acorda; o adaptador mantém ligado quando o esforço muda.
  // Guardado por conversa, como a conta, pra voltar igual depois de dormir ou de o servidor religar.
  const metaUltracode=c=>c.agente==='claude'&&c.ultracode?{_meta:{claudeCode:{options:{settings:{ultracode:true}}}}}:{};
  const arqUltracode=()=>path.join(conta().home,'.local','state','ratoeira','ultracode-conversa.json');
  function lerUltracode(){try{const o=JSON.parse(readFileSync(arqUltracode(),'utf8'));return o&&typeof o==='object'&&!Array.isArray(o)?o:{};}catch{return {};}}
  const ultracodeGravado=(agente,sessao)=>agente==='claude'&&lerUltracode()[sessao]===true;
  function gravarUltracode(c){
    if(c.agente!=='claude')return;
    try{const o=lerUltracode();delete o[c.sessao];if(c.ultracode)o[c.sessao]=true;
      const ks=Object.keys(o);for(const k of ks.slice(0,Math.max(0,ks.length-2000)))delete o[k];
      escreverPrivado(arqUltracode(),JSON.stringify(o));}catch(e){log(`ultracode da conversa: ${e.message}`);}
  }
  async function ultracodeDaConversa(agente,sessao,ligar){
    if(agente!=='claude')throw erro('Só o Claude tem ultracode.');
    const c=conversas.get(chave(agente,sessao));
    if(!c){gravarUltracode({agente,sessao,ultracode:ligar});return {ultracode:ligar};}
    if(Boolean(c.ultracode)===ligar)return resumo(c);
    if(c.estado!=='livre'||c.pedidos.size)throw erro('Espere a resposta terminar (ou pare) antes de ligar ou desligar o ultracode.');
    if(acordada(c)&&!(await dormir(c,'ultracode')))c.solta=true;
    return comTrava(chave(agente,sessao),async()=>{
      c.ultracode=ligar;gravarUltracode(c);
      emitir(c,{sessionUpdate:'ratoeira_ultracode',ultracode:ligar});
      log(`[${agente}] conversa ${sessao} com ultracode ${ligar?'ligado':'desligado'}`);
      return resumo(c);
    });
  }
  // Acordou (resume): volta o modelo, o esforço e o resto que a pessoa tinha escolhido, se o agente ainda
  // oferece. Sem isso, trocar a conta ou o ultracode devolvia a conversa pro padrão.
  async function reaplicar(c,conn,antes){
    let mudou=false;
    for(const o of c.config.configOptions??[]){
      const v=antes[o.id];
      if(v==null||v===o.currentValue)continue;
      const vs=(o.options??[]).flatMap(x=>x.options?x.options:[x]).map(x=>x.value);
      if(o.type==='select'&&!vs.includes(v))continue;
      try{const r=await conn.setSessionConfigOption({sessionId:c.sessao,configId:o.id,value:v});if(r?.configOptions)c.config.configOptions=r.configOptions;mudou=true;}
      catch(e){log(`[${c.agente}] não voltou ${o.id}=${v}: ${e.message}`);}
    }
    if(mudou)avisarConfig(c);
  }
  // Conta geral do Codex: ~/.codex/auth.json vira atalho pro arquivo único do time (conta-claude).
  const codexAuth=()=>path.join(conta().home,'.codex','auth.json');
  const codexGeral=()=>{try{return lstatSync(codexAuth()).isSymbolicLink();}catch{return false;}};
  function statusConta(provider,res){
    const cli=conta().clis[provider];
    const responder=d=>{res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(d));};
    if(!cli)return responder({stdout:'',stderr:'',code:127,missing:true});
    const args=provider==='claude'?['auth','status','--json']:['login','status'];
    execFile(cli,args,{env:envCli(provider),cwd:conta().home,timeout:10000,maxBuffer:65536},(error,stdout,stderr)=>
      responder({stdout:String(stdout),stderr:String(stderr),code:typeof error?.code==='number'?error.code:error?1:0,missing:error?.code==='ENOENT',...(provider==='codex'&&codexGeral()?{geral:true}:{}),
        propria:provider==='claude'?claudePropria():codexPropria(),geralDisponivel:contasDe(provider).lista.some(c=>c.tipo==='org'),geralFixa:provider==='claude'?Boolean(conta().geralFixa):doGrupo('ratoeira-codex-geral')}));
  }
  // claude-token: o setup-token (token de 1 ano) pra uma conta pessoal; o gateway pega o token na saída e
  // devolve pra cá (POST /conta/claude/pessoais), que guarda na pasta da pessoa.
  function loginConta(provider,req,res){
    const base=provider==='claude-token'||provider==='claude-conta'?'claude':provider==='codex-conta'?'codex':provider;
    const cli=conta().clis[base];
    if(!cli){res.writeHead(404);return res.end();}
    if(login){res.writeHead(409);return res.end();}
    // login pessoal do Codex grava seguindo o atalho: apaga o atalho antes, senão escreve por cima da geral
    if(provider==='codex'&&codexGeral())try{unlinkSync(codexAuth());}catch{res.writeHead(500);return res.end();}
    // claude-conta: o login comum do Claude, mas gravado na pasta de uma conta pessoal (nova, ou uma que já existe)
    let env=envCli(base,{logando:true}),nova=null,contaDir=null;
    if(provider==='claude-conta'){
      if(modoClaude()==='geral'){res.writeHead(409);return res.end();}
      const q=new URL(req.url,'http://x').searchParams,atuais=lerContas(dirPessoais());
      let id=q.get('id')??'';
      if(!(ID_CONTA.test(id)&&atuais.some(c=>c.id===id))){
        if(atuais.length>=10){res.writeHead(409);return res.end();}
        id=randomUUID().replace(/-/g,'').slice(0,10);
        nova={id,nome:String(q.get('nome')??'').replace(/[\t\r\n]+/g,' ').trim().slice(0,60)||'Conta pessoal '+(atuais.length+1)};
      }
      try{prepararDirConta(dirConta(id),conta().home);}catch(e){log(`conta: pasta ${e.message}`);res.writeHead(500);return res.end();}
      env={...env,CLAUDE_CONFIG_DIR:dirConta(id)};contaDir=id;
    }
    // codex-conta (desde 28/10/2026): o login do Codex (código de dispositivo) gravado na pasta de uma conta pessoal dele
    let contaCodex=null;
    if(provider==='codex-conta'){
      if(modoCodex(conta().grupos)==='geral'){res.writeHead(409);return res.end();}
      const q=new URL(req.url,'http://x').searchParams,atuais=lerContas(dirPessoaisCodex());
      let id=q.get('id')??'';
      if(!(ID_CONTA.test(id)&&atuais.some(c=>c.id===id))){
        if(atuais.length>=10){res.writeHead(409);return res.end();}
        id=randomUUID().replace(/-/g,'').slice(0,10);
        nova={id,nome:String(q.get('nome')??'').replace(/[\t\r\n]+/g,' ').trim().slice(0,60)||'Conta pessoal '+(atuais.length+1)};
      }
      try{prepararDirCodex(dirContaCodex(id),conta().home);}catch(e){log(`conta do codex: pasta ${e.message}`);res.writeHead(500);return res.end();}
      env={...env,CODEX_HOME:dirContaCodex(id),CODEX_SQLITE_HOME:path.join(conta().home,'.codex')};contaCodex=id;
    }else if(base==='codex'){delete env.CODEX_HOME;delete env.CODEX_SQLITE_HOME;}   // a própria é o ~/.codex
    // o login-runner.py conhece claude, claude-token e codex: a conta pessoal usa o login comum de cada um
    const child=spawn(conta().python,[conta().runner,contaDir?'claude':contaCodex?'codex':provider,cli],{env,cwd:conta().home,stdio:['pipe','pipe','pipe']});
    const fluxo=randomUUID();login={fluxo,child};ultimo=agora();
    res.writeHead(200,{'content-type':'application/x-ndjson','cache-control':'no-store'});
    const linha=o=>{if(!res.writableEnded)res.write(JSON.stringify(o)+'\n');};
    linha({fluxo});
    const saida=d=>{ultimo=agora();linha({saida:String(d)});};
    child.stdout.on('data',saida);child.stderr.on('data',saida);
    child.stdin.on('error',()=>{});
    let acabou=false;
    const fim=code=>{if(acabou)return;acabou=true;if(login?.child===child)login=null;ultimo=agora();
      // conta pessoal: só conta como feita com o login gravado na pasta dela
      if(contaCodex){
        const ok=code===0&&loginCodexEm(dirContaCodex(contaCodex));
        try{
          if(ok&&nova)escreverPrivado(path.join(dirPessoaisCodex(),'contas.tsv'),[...lerContas(dirPessoaisCodex()),nova].map(c=>c.id+'\t'+c.nome+'\n').join(''));
          if(!ok&&nova)rmSync(dirContaCodex(contaCodex),{recursive:true,force:true});
        }catch(e){log(`conta do codex: ${e.message}`);}
        linha({fim:ok?0:(code||1)});res.end();
        if(!ok)return;
        if(contaCodexAtivaId==='pessoal:'+contaCodex||listaCodex().ativa?.id!==contaCodexAtivaId){aplicarContaCodex();trocarConta('codex');}
        avisarConta('codex');return;
      }
      if(contaDir){
        const ok=code===0&&temLogin(dirConta(contaDir));
        try{
          if(ok&&nova)escreverPrivado(path.join(dirPessoais(),'contas.tsv'),[...lerContas(dirPessoais()),nova].map(c=>c.id+'\t'+c.nome+'\n').join(''));
          if(ok)try{unlinkSync(path.join(dirPessoais(),contaDir+'.token'));}catch{}
          if(!ok&&nova)rmSync(dirConta(contaDir),{recursive:true,force:true});
        }catch(e){log(`conta: ${e.message}`);}
        linha({fim:ok?0:(code||1)});res.end();
        if(!ok)return;
        // entrou de novo na que está valendo: o adaptador religa com o login novo
        if(contaAtivaId==='pessoal:'+contaDir||contasClaude().ativa?.id!==contaAtivaId){aplicarContaClaude();trocarConta('claude');}
        avisarConta('claude');return;
      }
      linha({fim:code});res.end();
      // conta própria conectada: o adaptador religa nela (se nada estiver rodando)
      if(code!==0||provider==='claude-token')return;
      if(provider==='claude'){if(modoClaude()==='geral')return;try{escreverPrivado(arqEscolha(),'propria\n');}catch{}aplicarContaClaude();}
      if(provider==='codex'){if(modoCodex(conta().grupos)!=='geral')try{escreverPrivado(arqEscolhaCodexDe(conta().home),'propria\n');}catch{}aplicarContaCodex();avisarConta('codex');}
      trocarConta(provider);};
    child.on('exit',code=>fim(code??1));
    child.on('error',()=>fim(1));
    // quem pediu largou (cancelou, gateway reiniciou): o login não fica pendurado
    res.on('close',()=>{if(!acabou)child.kill('SIGTERM');});
  }
  // Desconectar a conta própria. Claude: tira só o login do Claude do arquivo (os logins dos MCPs ficam).
  // Codex: apaga o auth.json dela. Quem pode usar a geral volta pra ela na hora.
  function sairConta(provider,res){
    const responder=(s,d)=>{res.writeHead(s,{'content-type':'application/json'});res.end(JSON.stringify(d));};
    if(login)return responder(409,{erro:'Tem um login em andamento.'});
    try{
      if(provider==='claude'){
        if(modoClaude()==='geral')return responder(409,{erro:'Tua conta usa sempre a da organização.'});
        if(claudePropria()){
          const f=credClaude(),d=JSON.parse(readFileSync(f,'utf8'));delete d.claudeAiOauth;
          if(Object.keys(d).length){const t=f+'.tmp';writeFileSync(t,JSON.stringify(d),{mode:0o600});renameSync(t,f);}else unlinkSync(f);
        }
        aplicarContaClaude();
      }else{
        // desde 28/10/2026 as da organização são contas à parte (contas-codex.mjs): o atalho antigo pra geral também sai
        if(codexPropria()||codexGeral())unlinkSync(codexAuth());
        try{unlinkSync(codexAuth()+'.propria');}catch{}
        aplicarContaCodex();avisarConta('codex');
      }
    }catch(e){log(`[${provider}] não desconectou: ${e.message}`);return responder(500,{erro:'Não consegui desconectar.'});}
    responder(200,{ok:true,religou:trocarConta(provider)});
  }
  function responderJson(res,fazer){
    let s=200,d;try{d=fazer();}catch(e){s=e.publico?409:500;d={erro:e.publico?e.message:'Não consegui.'};if(!e.publico)log(`conta: ${e.message}`);}
    res.writeHead(s,{'content-type':'application/json'});res.end(JSON.stringify(d));
  }
  function lerJson(req,res,fazer){
    let corpo='',grande=false;
    req.on('data',d=>{corpo+=d;if(corpo.length>8192){grande=true;req.destroy();}});
    req.on('end',()=>{if(grande)return;let b={};try{b=corpo?JSON.parse(corpo):{};}catch{}responderJson(res,()=>fazer(b));});
  }
  function entradaConta(fluxo,req,res){
    let corpo='';let grande=false;
    req.on('data',d=>{corpo+=d;if(corpo.length>4096){grande=true;req.destroy();}});
    req.on('end',()=>{
      if(grande||!login||login.fluxo!==fluxo){res.writeHead(404);return res.end();}
      ultimo=agora();login.child.stdin.write(corpo);res.writeHead(204);res.end();
    });
  }

  const server=http.createServer((req,res)=>{
    // pro gateway saber se pode desligar (nada rodando, ninguém esperando)
    if(req.url==='/estado'&&req.method==='GET'){res.writeHead(200,{'content-type':'application/json'});return res.end(JSON.stringify(estado()));}
    const av=req.url.match(/^\/avisos\?desde=(\d{1,12})$/);
    if(av&&req.method==='GET'){lerAvisosRotina();const desde=Number(av[1]);res.writeHead(200,{'content-type':'application/json'});return res.end(JSON.stringify({inicio:inicioAvisos,seq:seqAvisos,avisos:avisos.filter(a=>a.seq>desde)}));}
    // o dono compartilhou (ou deixou de compartilhar) uma conversa: o gateway avisa, e as mensagens passam a levar o nome
    if(req.url==='/compartilhada'&&req.method==='POST')return lerJson(req,res,b=>{
      if(!agentes.has(b.agente)||!idOk(b.sessao))throw erro('Conversa inválida.');
      marcarCompartilhada(b.agente,b.sessao,b.ligar!==false);return {ok:true};
    });
    // o texto de uma conversa, pra ferramenta ler_conversa (quem pode ler, o gateway já conferiu). Conversa que não
    // estava aberta carrega só pra isso e volta a dormir: o processo não fica ocupando memória
    if(req.url==='/ler-conversa'&&req.method==='POST'){
      let corpo='';req.on('data',d=>{corpo+=d;if(corpo.length>8192)req.destroy();});
      req.on('end',async()=>{
        const responder=(s,d)=>{res.writeHead(s,{'content-type':'application/json'});res.end(JSON.stringify(d));};
        try{
          const b=JSON.parse(corpo||'{}');
          if(!agentes.has(b.agente)||!idOk(b.sessao))return responder(400,{erro:'Conversa inválida.'});
          const k=chave(b.agente,b.sessao);let c=conversas.get(k);const deFora=!c;
          if(!c||c.solta){await abrir(b.agente,b.sessao,caminhoOk(b.cwd)?b.cwd:null,c?.mcp??[]);c=conversas.get(k);}
          if(deFora&&c){c.soLeitura=true;dormir(c,'aberta só pra leitura').catch(()=>{});}
          responder(200,{titulo:nomes().get(k)??c.titulo??null,cwd:c.cwd,estado:c.estado,...textoDaConversa(c.eventos,lerNotas(c),{dono:b.dono||'Dono'})});
        }catch(e){responder(e?.publico?404:500,{erro:e?.publico?e.message:'Não consegui ler essa conversa.'});if(!e?.publico)log(`ler-conversa: ${e?.message}`);}
      });
      return;
    }
    const st=req.url.match(/^\/conta\/(claude|codex)\/status$/);
    if(st&&req.method==='GET')return statusConta(st[1],res);
    // várias contas do Claude: lista, troca e as pessoais (tokens de 1 ano da própria pessoa)
    const ct=req.url.match(/^\/conta\/(claude|codex)\/(contas|usar)$/);
    if(ct&&ct[2]==='contas'&&req.method==='GET')return responderJson(res,()=>listaContas(ct[1]));
    if(ct&&ct[2]==='usar'&&req.method==='POST')return lerJson(req,res,b=>{const r=usarConta(ct[1],String(b.conta??''));avisarConta(ct[1]);return r;});
    const rx=req.url.match(/^\/conta\/codex\/pessoais\/([a-z0-9]{1,20})\/remover$/);
    if(rx&&req.method==='POST')return lerJson(req,res,()=>{removerPessoalCodex(rx[1]);avisarConta('codex');return listaContas('codex');});
    if(req.url==='/conta/claude/pessoais'&&req.method==='POST')return lerJson(req,res,b=>{adicionarPessoal(b.nome,b.token);avisarConta('claude');return listaContas('claude');});
    const rp=req.url.match(/^\/conta\/claude\/pessoais\/([a-z0-9]{1,20})\/remover$/);
    if(rp&&req.method==='POST')return lerJson(req,res,()=>{removerPessoal(rp[1]);avisarConta('claude');return listaContas('claude');});
    const lg=req.url.match(/^\/conta\/(claude|claude-token|claude-conta|codex|codex-conta)\/login(?:\?[^#]*)?$/);
    if(lg&&req.method==='POST')return loginConta(lg[1],req,res);
    const sa=req.url.match(/^\/conta\/(claude|codex)\/sair$/);
    if(sa&&req.method==='POST')return sairConta(sa[1],res);
    const en=req.url.match(/^\/conta\/fluxo\/([0-9a-f-]{36})\/entrada$/);
    if(en&&req.method==='POST')return entradaConta(en[1],req,res);
    res.writeHead(404);res.end();
  });
  const wss=new WebSocketServer({server,path:'/ws',maxPayload:20*1024*1024});
  wss.on('connection',(ws,req)=>{
    Object.assign(ws,quemDe(req));
    ws.assinadas=new Set();clientes.add(ws);ultimo=agora();
    ws.on('message',d=>tratar(ws,String(d)));
    ws.on('close',()=>{clientes.delete(ws);for(const e of [...envios.values()])if(e.ws===ws)soltarEnvio(e);for(const c of ws.assinadas){c.assinantes.delete(ws);avisarPresenca(c);}terminais.soltar(ws);ultimo=agora();});
  });
  // Ping a cada 30 s: o proxy da frente (túnel, balanceador) pode fechar WebSocket parado, alguns em ~100 s,
  // e cada queda fazia o chat reassinar todas as conversas (a tela redesenhava e pulava pro fim).
  const pingar=setInterval(()=>{for(const ws of clientes)try{ws.ping();}catch{}},30000);pingar.unref();
  // Conversa livre que ainda trabalha: voltou sozinha há pouco (aviso de comando ou workflow) ou tem um rodando.
  // `trabalhoNoFundo` entra nos testes; o de verdade olha os rastros do Claude Code (sessoesComComando, mexidoDesde).
  function noFundo(c){
    if(c.sozinhoEm!=null&&agora()-c.sozinhoEm<SOZINHO_MS)return true;
    try{return Boolean((trabalhoNoFundo??fundoDoClaude)(c));}catch(e){log(`fundo: ${e.message}`);return false;}
  }
  function fundoDoClaude(c){
    if(c.agente!=='claude')return false;
    if(sessoesComComando().has(c.sessao))return true;
    const home=conta().home,x=c.conta?contasClaude().lista.find(y=>y.id===c.conta):null;
    const dirs=new Set([x?.dir,process.env.CLAUDE_CONFIG_DIR,path.join(home,'.claude')].filter(Boolean));
    const desde=Date.now()-FUNDO_ARQUIVO_MS;
    for(const d of dirs)if(mexidoDesde(path.join(d,'projects',pastaDoProjeto(c.cwd),c.sessao,'subagents'),desde))return true;
    return false;
  }
  function estado(){
    const ocupadas=[...conversas.values()].filter(c=>c.estado!=='livre').length;
    const fundo=[...conversas.values()].filter(c=>acordada(c)&&c.estado==='livre'&&noFundo(c)).length;
    // recursos: o gateway confere antes de ligar um convidado (servidor de antes ignorava o convite e daria tudo)
    // noFundo: conversas sem turno aberto e com comando ou workflow rodando; seguram a saída como as que rodam
    return {ocupado:ocupadas>0||Boolean(login)||envios.size>0||fundo>0,conversasRodando:ocupadas,noFundo:fundo,envios:envios.size,clientes:clientes.size,terminais:terminais.quantos(),recursos:['convite','avisos'],...(login?{login:true}:{})};
  }
  // ── Retomar depois de religar (16/10/2026) ──
  // A cada minuto (e ao sair) fica no disco a lista das conversas trabalhando. O servidor que sobe depois (versão nova,
  // queda, memória, reinício da máquina) abre cada uma e manda uma mensagem pra ela seguir, sem esperar alguém
  // perguntar "parou?". A mesma conversa só é retomada uma vez a cada 2 h: se é ela que derruba o servidor, não vira laço.
  const arqRetomar=path.join(path.dirname(arquivoTitulos),'retomar.json');
  function lerRetomar(){try{const o=JSON.parse(readFileSync(arqRetomar,'utf8'));return o&&typeof o==='object'&&!Array.isArray(o)?o:{};}catch{return {};}}
  let retomarGravado=null;
  function guardarRetomar(motivo=null){
    const lista=[...conversas.values()].filter(c=>c.caiuTrabalhando||acordada(c)&&(c.estado==='rodando'||noFundo(c)))
      .map(c=>({agente:c.agente,sessao:c.sessao,cwd:c.cwd,mcp:c.mcp??[]}));
    const texto=JSON.stringify({conversas:lista,motivo,retomadas:lerRetomar().retomadas??{}});
    if(texto===retomarGravado)return lista.length;
    try{escreverPrivado(arqRetomar,texto);retomarGravado=texto;}catch(e){log(`retomar: não gravei (${e.message})`);}
    return lista.length;
  }
  async function retomar(){
    const o=lerRetomar(),lista=Array.isArray(o.conversas)?o.conversas:[];
    const retomadas=Object.fromEntries(Object.entries(o.retomadas??{}).filter(([,em])=>Number.isFinite(em)&&agora()-em<24*3600000));
    const fazer=[];
    for(const x of lista){
      if(!agentes.has(x?.agente)||!idOk(x?.sessao)||!caminhoOk(x?.cwd))continue;
      const k=chave(x.agente,x.sessao);
      if(retomadas[k]&&agora()-retomadas[k]<2*3600000){log(`[${x.agente}] não retomo ${x.sessao}: já retomei há menos de 2 h`);continue;}
      retomadas[k]=agora();fazer.push(x);
    }
    retomarGravado=JSON.stringify({conversas:[],motivo:null,retomadas});
    try{escreverPrivado(arqRetomar,retomarGravado);}catch(e){log(`retomar: não gravei (${e.message})`);}
    const motivo=typeof o.motivo==='string'&&o.motivo.length<200?o.motivo:'caiu sem avisar';
    for(const x of fazer){
      try{
        let mcp=[];try{mcp=mcpValidos(x.mcp);}catch{}
        await abrir(x.agente,x.sessao,x.cwd,mcp);
        const c=conversas.get(chave(x.agente,x.sessao));
        await usar(c,()=>enviar(c,[{type:'text',text:textoRetomar(motivo)}]));
        log(`[${x.agente}] retomei ${x.sessao} (${motivo})`);
      }catch(e){log(`[${x.agente}] não retomei ${x.sessao}: ${e.message}`);}
    }
    return fazer.length;
  }
  // Sem ninguém conectado e nada rodando há `ociosoMin`: o processo sai (o gateway liga de novo quando precisar).
  function podeSair(){return clientes.size===0&&!estado().ocupado&&agora()-ultimo>=ociosoMin*60000;}
  function fechar(){clearInterval(pingar);login?.child.kill('SIGTERM');terminais.fecharTodos();for(const a of adaptadores.values())a.parar();for(const ws of clientes)ws.terminate();wss.close();server.close();}
  return {server,podeSair,fechar,estado,conversas,dormirParadas,guardarRetomar,retomar};
}

// Rodando de verdade (systemd): AGENTES_SOCKET é o socket; agentes.json fica ao lado deste arquivo.
// Compara o caminho resolvido: /opt/ratoeira/agentes é atalho pra pasta da versão e o import.meta.url já vem resolvido.
// Sem isso o servidor achava que tinha sido só importado e saía calado (14/10/2026, chat de todo mundo fora).
const chamadoDireto=()=>{try{return fileURLToPath(import.meta.url)===realpathSync(process.argv[1]);}catch{return false;}};
if(process.argv[1]&&chamadoDireto()){
  const socket=process.env.AGENTES_SOCKET;
  if(!caminhoOk(socket)){console.error('falta AGENTES_SOCKET');process.exit(2);}
  const s=createServidor({agentes:carregarAgentes(process.env.AGENTES_CONFIG??undefined),ociosoMin:Number(process.env.AGENTES_OCIOSO_MIN??30),
    dormirMin:Number(process.env.AGENTES_DORMIR_MIN??60),maxAcordadas:Number(process.env.AGENTES_MAX_ACORDADAS??5),log:m=>console.log(m)});
  rmSync(socket,{force:true});
  s.server.listen(socket,()=>{console.log(`agentes da Ratoeira em ${socket}`);s.retomar().catch(e=>console.log(`retomar: ${e.message}`));});
  // Publicaram versão nova (o publicar-core troca a pasta e grava um .versao novo): sai assim que estiver livre,
  // sem conversa rodando, login nem terminal. Quem está com o chat aberto reconecta e o gateway liga a nova.
  // Pelo caminho com que foi chamado (/opt/ratoeira/agentes/servidor.mjs), não pelo AQUI: desde 12/10/2026 a pasta é
  // um atalho pra versão no ar, e o Node resolve o atalho; pelo AQUI ele leria sempre o .versao da versão em que subiu.
  const arqVersao=path.join(path.dirname(path.resolve(process.argv[1])),'.versao');
  const lerVersao=()=>{try{return readFileSync(arqVersao,'utf8').trim();}catch{return null;}};
  const versao=lerVersao();
  // Comando ou workflow no fundo segura a versão nova, mas não pra sempre: um Monitor esquecido travaria a troca.
  // Passou do teto, sai assim mesmo, e a conversa é retomada pelo servidor novo.
  const FUNDO_MAX=Number(process.env.AGENTES_FUNDO_MAX_H??6)*3600000;
  let novaDesde=null;
  const sair=motivo=>{s.guardarRetomar(motivo);s.fechar();process.exit(0);};
  setInterval(()=>{
    s.dormirParadas().catch(e=>console.log(`dormir: ${e.message}`));
    if(s.podeSair()){console.log('ninguém usando: saindo');sair(null);}
    s.guardarRetomar();
    const agora=lerVersao(),e=s.estado();
    if(!agora||agora===versao||e.terminais)return;
    novaDesde??=Date.now();
    const soNoFundo=e.noFundo>0&&!e.conversasRodando&&!e.login&&!e.envios;
    if(!e.ocupado||(soNoFundo&&Date.now()-novaDesde>=FUNDO_MAX)){
      console.log('versão nova publicada ('+agora.split(' ')[0]+'): saindo pra religar'+(e.ocupado?` (${e.noFundo} conversa(s) com trabalho no fundo, retomadas depois)`:''));
      sair('versão nova da Ratoeira');
    }
  },60000).unref();
  // systemctl stop, reinício da máquina: o que estava trabalhando volta quando o servidor subir de novo
  for(const sinal of ['SIGTERM','SIGINT'])process.on(sinal,()=>sair('o servidor foi desligado, reinício da Ratoeira ou da máquina'));
}
