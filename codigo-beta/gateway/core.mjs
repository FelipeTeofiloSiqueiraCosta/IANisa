// Publicar a própria Ratoeira pelo chat de um admin (docs/2026-10-09-publicar-core.md). O gateway grava o
// pedido e liga o ratoeira-publicar-core@<parte> sem esperar (a parte "gateway" reinicia este processo); o
// ajudante de root (kit/multiusuario/publicar-core) publica o que está commitado e grava o resultado.
// O estado sai do disco, não da memória: sobrevive ao gateway reiniciar no meio.
import {readFile,writeFile,rename,mkdir,unlink,stat} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import path from 'node:path';
import {problem} from './catalog.mjs';

export const PARTES=['telas','gateway','agentes','regras','kit','receita','pacotes'];
// receita e pacotes não publicam código: rodam uma instalação como root (ferramentas próprias no MCP)
export const PUBLICAVEIS=['telas','gateway','agentes','regras','kit'];
export const NOME_RECEITA=/^[a-z][a-z0-9-]{0,40}$/,ARG_RECEITA=/^[A-Za-z0-9._@:/=+-]{1,100}$/,PACOTE=/^[a-z0-9][a-z0-9.+-]{0,60}$/;
// o que cada parte lê do repositório (igual ao FONTES do publicar-core)
export const FONTES={telas:['gateway/public'],gateway:['gateway'],agentes:['agentes'],regras:['kit/agentes.md','kit/ratoeira-instrucoes','APPS.md','kit/skills'],kit:['kit/multiusuario'],receita:['kit/receitas']};
export const DESCRICAO={
  telas:'telas do portal (gateway/public), sem reiniciar nada',
  gateway:'gateway inteiro (código do servidor + telas + build), reinicia o gateway',
  agentes:'servidor de agentes (chat, terminal); o de cada pessoa religa sozinho quando fica livre (sem conversa rodando nem terminal), em até 1 min',
  regras:'texto fixo dos agentes (kit/agentes.md), APPS.md e as skills do produto (kit/skills)',
  kit:'scripts e units de root (kit/multiusuario)',
  receita:'script de instalação de kit/receitas, rodado como root',
  pacotes:'pacotes do apt',
};
// um pedido sem resultado há mais que isso é de um ajudante que morreu: deixa pedir de novo
const VENCE_PEDIDO=25*60e3;

const git=async(fonte,args)=>{
  const {stdout}=await promisify(execFile)('git',['-c','safe.directory=*','-C',fonte,...args],{timeout:20000,maxBuffer:1<<20});
  return stdout;
};

export function createCore({fonte,partes=[],pedidosDir,versoesArquivo,ligar,runGit=git,log=m=>console.log(m)}){
  const liberadas=PARTES.filter(p=>partes.includes(p));
  const lerJson=async arq=>{try{return JSON.parse(await readFile(arq,'utf8'));}catch{return null;}};
  async function pedidoAberto(parte){
    try{const s=await stat(path.join(pedidosDir,parte+'.json'));return Date.now()-s.mtimeMs<VENCE_PEDIDO?s.mtime.toISOString():null;}catch{return null;}
  }
  async function noRepo(parte){
    if(!FONTES[parte])return {commit:null,semCommit:[]};
    try{
      const [c,s]=await Promise.all([runGit(fonte,['log','-1','--format=%h %s','--',...FONTES[parte]]),runGit(fonte,['status','--porcelain','--untracked-files=all','--',...FONTES[parte]])]);
      return {commit:c.trim()||null,semCommit:s.split('\n').filter(l=>l.trim()).map(l=>l.slice(3))};
    }catch(e){return {commit:null,semCommit:[],erro:'git: '+String(e.message).split('\n')[0]};}
  }
  async function estado(parte){
    const versoes=await lerJson(versoesArquivo)??{};
    const r=await lerJson(path.join(pedidosDir,parte+'.resultado.json'));
    const desde=await pedidoAberto(parte);
    return {parte,descricao:DESCRICAO[parte],noAr:versoes[parte]??null,repo:await noRepo(parte),
      publicando:desde?{desde}:null,
      ultimo:r?{ok:Boolean(r.ok),em:r.em,erro:r.erro??null,log:Array.isArray(r.log)?r.log.slice(-40):[]}:null};
  }
  return {
    partes:liberadas,
    estado,
    async estados(){return Promise.all(liberadas.filter(p=>PUBLICAVEIS.includes(p)).map(estado));},
    // extra: {receita, args} pra "receita", {pacotes} pra "pacotes"; o ajudante de root valida de novo
    async publicar(parte,por,extra={}){
      if(!liberadas.includes(parte))throw problem(400,`Esta Ratoeira não publica "${parte}" por aqui. Partes liberadas: ${liberadas.join(', ')||'nenhuma'}.`);
      let campos={};
      if(parte==='receita'){
        const args=extra.args??[];
        if(typeof extra.receita!=='string'||!NOME_RECEITA.test(extra.receita))throw problem(400,'Nome de receita inválido (o nome do arquivo em kit/receitas: minúsculas, números e hífen).');
        if(!Array.isArray(args)||args.length>3||args.some(a=>typeof a!=='string'||!ARG_RECEITA.test(a)))throw problem(400,'Argumentos inválidos (até 3, sem espaço).');
        campos={receita:extra.receita,args};
      }else if(parte==='pacotes'){
        const p=extra.pacotes;
        if(!Array.isArray(p)||!p.length||p.length>20||p.some(x=>typeof x!=='string'||!PACOTE.test(x)))throw problem(400,'Lista de pacotes inválida (nomes de pacote do apt, de 1 a 20).');
        campos={pacotes:p};
      }
      if(await pedidoAberto(parte))throw problem(409,`Já tem uma publicação de ${parte} rodando.`);
      await mkdir(pedidosDir,{recursive:true,mode:0o750});
      await unlink(path.join(pedidosDir,parte+'.resultado.json')).catch(()=>{});
      const arq=path.join(pedidosDir,parte+'.json');
      await writeFile(arq+'.tmp',JSON.stringify({parte,por,...campos,em:new Date().toISOString()})+'\n',{mode:0o640});
      await rename(arq+'.tmp',arq);
      log(`publicar core ${parte}: pedido de ${por}`);
      try{await ligar(parte);}
      catch(e){await unlink(arq).catch(()=>{});throw problem(502,`Não consegui ligar o ratoeira-publicar-core@${parte} (${e.message}). A regra do polkit e a unit estão instaladas?`);}
      return {estado:'publicando'};
    },
  };
}
