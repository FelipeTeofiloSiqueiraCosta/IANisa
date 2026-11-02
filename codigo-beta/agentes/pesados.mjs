// ── Arquivo pesado fica fora do git (desde 15/10/2026, docs/2026-10-14-upload-e-arquivos-pesados.md) ──
// Pesado é vídeo, áudio, PSD, pacote (por tipo) ou qualquer arquivo acima de 50 MB. A pessoa nunca escolhe:
// a regra mora em dois blocos gerados no .gitignore da raiz do repositório, e é deles que o resto lê
// (a árvore da Mesa mostra o que eles escondem, marcado "só aqui").
//   - tipos, no COMEÇO do arquivo: o que o repo já tinha vem depois e ganha (uma exceção !sites/**/*.mp4 continua valendo);
//   - grandes, no FIM: o caminho exato de cada arquivo acima do limite, que ganha de tudo (senão o GitHub
//     recusa o push, acima de 100 MB, e o sync de todo mundo trava).
// Uso pelo terminal (o sync da pasta roda antes do `git add -A`): node pesados.mjs <pasta do repo>
import {execFile} from 'node:child_process';
import {readFileSync,writeFileSync,renameSync,lstatSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const TIPOS=['mp4','mov','m4v','webm','avi','mkv','wav','mp3','m4a','aac','aif','aiff','psd','psb','ai','zip','tif','tiff'];
export const LIMITE=50*1024*1024;
const RE_TIPO=new RegExp('\\.('+TIPOS.join('|')+')$','i');
export const ehTipoPesado=nome=>RE_TIPO.test(String(nome));
export const ehPesado=(nome,tamanho=0)=>ehTipoPesado(nome)||tamanho>LIMITE;

const TIPOS_INI='# >>> ratoeira: arquivos pesados',TIPOS_FIM='# <<< ratoeira: arquivos pesados';
const GRANDES_INI='# >>> ratoeira: arquivos grandes',GRANDES_FIM='# <<< ratoeira: arquivos grandes';
// no Linux o git diferencia maiúscula: *.mp4 deixava passar o .MP4 do celular
const semCaixa=ext=>'*.'+[...ext].map(c=>/[a-z]/.test(c)?`[${c}${c.toUpperCase()}]`:c).join('');
const BLOCO_TIPOS=[TIPOS_INI+' (gerado pela Ratoeira; não edite entre as marcas)',
  '# Vídeo, áudio, PSD e pacote ficam na VPS, fora do git. Pra versionar um mesmo assim,',
  '# ponha uma exceção (!caminho/arquivo.mp4) mais abaixo neste arquivo.',
  ...TIPOS.map(semCaixa),TIPOS_FIM].join('\n');

// caminho exato no .gitignore: âncora na raiz (o / da frente já tira o sentido de # e !) e escape do que o git leria como padrão
export const padraoExato=rel=>'/'+rel.replace(/[\\*?[\]]/g,'\\$&').replace(/ $/,'\\ ');
const desescapar=p=>p.slice(1).replace(/\\(.)/g,'$1');

function bloco(texto,ini,fim){
  const a=texto.indexOf('\n'+ini)>=0?texto.indexOf('\n'+ini)+1:texto.startsWith(ini)?0:-1;
  if(a<0)return null;
  const b=texto.indexOf(fim,a);if(b<0)return null;
  return {a,b:b+fim.length,linhas:texto.slice(a,b).split('\n').slice(1)};
}

// O que os blocos dizem hoje: os padrões de tipo e os caminhos grandes (relativos à raiz).
export function lerBlocos(texto){
  const t=bloco(texto,TIPOS_INI,TIPOS_FIM),g=bloco(texto,GRANDES_INI,GRANDES_FIM);
  const util=l=>l.trim()&&!l.startsWith('#');
  return {tipos:t?t.linhas.filter(util):[],grandes:g?g.linhas.filter(util).map(desescapar):[]};
}

// O .gitignore com o bloco de tipos garantido no começo e os grandes somados ao bloco do fim.
export function ajustarGitignore(texto,{grandes=[]}={}){
  let novo=String(texto??'');
  if(!bloco(novo,TIPOS_INI,TIPOS_FIM))novo=BLOCO_TIPOS+'\n'+(novo?'\n'+novo:'');
  const g=bloco(novo,GRANDES_INI,GRANDES_FIM);
  const ja=new Set(g?g.linhas.filter(l=>l.trim()&&!l.startsWith('#')).map(desescapar):[]);
  const somar=[...new Set(grandes)].filter(r=>r&&!ja.has(r));
  if(!somar.length)return novo;
  const linhas=somar.map(padraoExato);
  if(g)return novo.slice(0,g.b-GRANDES_FIM.length)+linhas.join('\n')+'\n'+novo.slice(g.b-GRANDES_FIM.length);
  return novo.replace(/\n*$/,'\n')+'\n'+[GRANDES_INI+' (acima de 50 MB; gerado pela Ratoeira, ficam fora do git)',...linhas,GRANDES_FIM].join('\n')+'\n';
}

const git=(repo,args)=>new Promise(ok=>execFile('git',['-c','safe.directory=*','-C',repo,...args],{timeout:60000,maxBuffer:64*1024*1024},(e,stdout,stderr)=>ok({code:e?(typeof e.code==='number'?e.code:1):0,stdout:String(stdout),stderr:String(stderr)})));

// Grava o .gitignore de `repo` (a raiz) com os blocos e os grandes somados. Devolve se mudou.
export function gravarGitignore(repo,grandes=[]){
  const arq=path.join(repo,'.gitignore');let antes='';
  try{antes=readFileSync(arq,'utf8');}catch{}
  const depois=ajustarGitignore(antes,{grandes});
  if(depois===antes)return false;
  const tmp=arq+'.'+process.pid+'.tmp';writeFileSync(tmp,depois);renameSync(tmp,arq);
  return true;
}

// Arquivo novo (fora do git e não ignorado) acima do limite: entra no bloco dos grandes antes que alguém o commite.
// Arquivo já versionado que cresceu fica como está: tirar do git apagaria o arquivo na máquina dos outros.
export async function marcarGrandes(repo){
  const r=await git(repo,['ls-files','-z','--others','--exclude-standard']);
  if(r.code)return {mudou:false,grandes:[]};
  const grandes=[];
  for(const rel of r.stdout.split('\0')){
    if(!rel)continue;
    try{const st=lstatSync(path.join(repo,rel));if(st.isFile()&&st.size>LIMITE)grandes.push(rel);}catch{}
  }
  return {mudou:gravarGitignore(repo,grandes),grandes};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const repo=process.argv[2];
  if(!repo){console.error('uso: node pesados.mjs <pasta do repo>');process.exit(2);}
  const topo=await git(repo,['rev-parse','--show-toplevel']);
  if(topo.code){console.error('não é um repositório git: '+repo);process.exit(0);}
  const {mudou,grandes}=await marcarGrandes(topo.stdout.trim());
  if(mudou)console.log('.gitignore ajustado'+(grandes.length?': '+grandes.length+' arquivo(s) acima de 50 MB fora do git: '+grandes.join(', '):''));
}
