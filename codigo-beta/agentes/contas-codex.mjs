// Várias contas do Codex (desde 28/10/2026), no jeito das do Claude: as da organização, as pessoais e o login próprio.
// Cada conta é uma pasta de config do Codex (CODEX_HOME) com o login dela (auth.json) e atalhos pro resto do ~/.codex
// (config, skills, ganchos, conversas). Os bancos do Codex (lista de conversas, histórico, memórias) ficam sempre no
// ~/.codex (CODEX_SQLITE_HOME): trocar a conta de uma conversa não perde a conversa, e as de todas as contas aparecem
// juntas. A própria é o ~/.codex de sempre, sem variável nenhuma.
//   própria:  ~/.codex/auth.json (arquivo de verdade; atalho é o jeito antigo da conta geral, ver conta-claude)
//   pessoal:  ~/.config/ratoeira/codex-contas/<id>/auth.json (login pelo código de dispositivo, em Contas de IA),
//             lista e nomes em ~/.config/ratoeira/codex-contas/contas.tsv
//   da organização: /var/lib/ratoeira/codex-contas/<id>/auth.json, um login do ChatGPT por conta, que só quem pode
//             usar lê e grava (ACL, aplicar-acessos); o Codex renova o token gravando ali e os outros releem, então a
//             pasta da pessoa (~/.config/ratoeira/codex-contas/org-<id>/) tem o auth.json como atalho pra ele, nunca
//             uma cópia (uma renovação derrubaria as outras). A "geral" de antes, /var/lib/ratoeira/codex-geral/auth.json,
//             é a conta de id `geral`.
// A escolhida (a padrão: conversas novas, terminal, rotinas) fica em ~/.config/ratoeira/codex-conta. Sem escolha, ou
// escolha que não vale mais: própria, pessoais, organização. Modo pela tela de Pessoas, como no Claude:
// ratoeira-codex-geral só usa as da organização, ratoeira-codex escolhe, sem grupo só as dela.
//
// Também roda como comando (conta-claude, antes de ligar o servidor, uma automação ou uma rotina):
//   node contas-codex.mjs env   →  linhas de shell que põem (ou tiram) CODEX_HOME e CODEX_SQLITE_HOME da conta padrão
import {accessSync,constants as fsc,existsSync,lstatSync,mkdirSync,readFileSync,readdirSync,readlinkSync,symlinkSync,unlinkSync,realpathSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const ID_CONTA=/^[a-z0-9]{1,20}$/;
// o que é de cada conta (o resto é atalho pro ~/.codex): o login, os modelos que ela tem e caches
const DA_CONTA=new Set(['auth.json','models_cache.json','cache','tmp','.tmp']);
const BANCO=/\.sqlite(-wal|-shm|-journal)?$/;

export function padroes(home=process.env.HOME??'/tmp'){
  return {home,org:'/var/lib/ratoeira/codex-contas',geral:'/var/lib/ratoeira/codex-geral/auth.json',grupos:null};
}
const lerContas=dir=>{try{return readFileSync(path.join(dir,'contas.tsv'),'utf8').split('\n').map(l=>l.split('\t')).filter(([id])=>ID_CONTA.test(id??'')).map(([id,nome])=>({id,nome:(nome||id).trim()}));}catch{return [];}};
const podeUsar=f=>{try{accessSync(f,fsc.R_OK|fsc.W_OK);return true;}catch{return false;}};
// login do ChatGPT (ou chave) de verdade no arquivo
function temLogin(f){try{const o=JSON.parse(readFileSync(f,'utf8'));return Boolean(o?.tokens?.refresh_token||o?.OPENAI_API_KEY);}catch{return false;}}
const ehArquivo=f=>{try{return lstatSync(f).isFile();}catch{return false;}};

export const dirPessoais=home=>path.join(home,'.config','ratoeira','codex-contas');
export const arqEscolha=home=>path.join(home,'.config','ratoeira','codex-conta');
export const authDaOrg=(cfg,id)=>id==='geral'?cfg.geral:path.join(cfg.org,id,'auth.json');

export function modoCodex(grupos){
  const g=grupos??[];
  return g.includes('ratoeira-codex-geral')?'geral':g.includes('ratoeira-codex')?'opcional':'propria';
}
export function contasCodex(cfg){
  const {home}=cfg,modo=modoCodex(cfg.grupos),lista=[];
  if(modo!=='geral'){
    const propria=path.join(home,'.codex','auth.json');
    if(ehArquivo(propria)&&temLogin(propria))lista.push({id:'propria',tipo:'propria',nome:'Tua conta',completa:true});
    for(const c of lerContas(dirPessoais(home))){
      const dir=path.join(dirPessoais(home),c.id);
      if(ehArquivo(path.join(dir,'auth.json'))&&temLogin(path.join(dir,'auth.json')))lista.push({id:'pessoal:'+c.id,tipo:'pessoal',nome:c.nome,dir,completa:true});
    }
  }
  if(modo!=='propria'){
    const daOrg=lerContas(cfg.org).filter(c=>podeUsar(authDaOrg(cfg,c.id)));
    // a geral de antes, até o gateway mandar a lista nova (aplicar-acessos)
    if(!daOrg.length&&!existsSync(path.join(cfg.org,'contas.tsv'))&&podeUsar(cfg.geral))daOrg.push({id:'geral',nome:'Conta da organização'});
    for(const c of daOrg)lista.push({id:'org:'+c.id,tipo:'org',nome:c.nome,dir:path.join(dirPessoais(home),'org-'+c.id),auth:authDaOrg(cfg,c.id),completa:true});
  }
  let escolha=null;try{escolha=readFileSync(arqEscolha(home),'utf8').slice(0,64).trim();}catch{}
  return {modo,lista,ativa:lista.find(c=>c.id===escolha)??lista[0]??null};
}

// Monta a pasta de config de uma conta: atalho pra cada coisa do ~/.codex (menos o que é da conta e os bancos), e o
// login (o atalho pro arquivo da organização, ou o auth.json que o login da conta pessoal gravou ali). Refeito antes de
// cada uso: o que aparecer de novo no ~/.codex ganha o atalho, e atalho pra coisa que sumiu sai.
export function prepararDirCodex(dir,home,{auth=null}={}){
  const base=path.join(home,'.codex');
  mkdirSync(base,{recursive:true,mode:0o700});
  mkdirSync(dir,{recursive:true,mode:0o700});
  for(const n of readdirSync(dir)){
    const f=path.join(dir,n);let alvo=null;try{alvo=readlinkSync(f);}catch{continue;}
    if(n==='auth.json')continue;
    if(!existsSync(f)||path.dirname(alvo)!==base)unlinkSync(f);
  }
  for(const n of readdirSync(base)){
    if(DA_CONTA.has(n)||BANCO.test(n))continue;
    const f=path.join(dir,n);
    try{lstatSync(f);continue;}catch{}
    symlinkSync(path.join(base,n),f);
  }
  if(auth){
    const f=path.join(dir,'auth.json');let atual=null;try{atual=readlinkSync(f);}catch{}
    if(atual!==auth){try{unlinkSync(f);}catch{}symlinkSync(auth,f);}
  }
  return dir;
}
// O ambiente do processo de uma conta: null tira a variável (a própria é o ~/.codex de sempre)
export function envDaContaCodex(x,home){
  if(!x?.dir)return {CODEX_HOME:null,CODEX_SQLITE_HOME:null};
  prepararDirCodex(x.dir,home,{auth:x.auth??null});
  return {CODEX_HOME:x.dir,CODEX_SQLITE_HOME:path.join(home,'.codex')};
}

// como comando: o shell (conta-claude) avalia a saída
const aspas=s=>"'"+String(s).replace(/'/g,"'\\''")+"'";
const chamadoDireto=()=>{try{return fileURLToPath(import.meta.url)===realpathSync(process.argv[1]);}catch{return false;}};
if(process.argv[1]&&chamadoDireto()&&process.argv[2]==='env'){
  const cfg=padroes();
  try{cfg.grupos=String(execFileSync('id',['-nG'],{encoding:'utf8'})).trim().split(/\s+/);}catch{cfg.grupos=[];}
  if(process.env.CONTA_CODEX_ORG)cfg.org=process.env.CONTA_CODEX_ORG;
  if(process.env.CONTA_CODEX_GERAL)cfg.geral=process.env.CONTA_CODEX_GERAL;
  if(process.env.CONTA_CODEX_GRUPOS!=null)cfg.grupos=process.env.CONTA_CODEX_GRUPOS.split(/\s+/).filter(Boolean);
  let env={CODEX_HOME:null,CODEX_SQLITE_HOME:null};
  try{env=envDaContaCodex(contasCodex(cfg).ativa,cfg.home);}catch(e){console.error('contas-codex: '+e.message);}
  for(const [k,v] of Object.entries(env))console.log(v==null?`unset ${k}`:`${k}=${aspas(v)}; export ${k}`);
}
