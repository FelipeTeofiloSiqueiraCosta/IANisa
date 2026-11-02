// Publicar app sem sudo (docs/2026-10-09-publicar-app-sem-sudo.md). O gateway acha os manifestos
// (<área>/apps/*/ratoeira-app.json), grava o pedido e liga o ratoeira-publicar@<nome>, que roda o
// publicar-app como root (kit/multiusuario, lista fechada de ações, regra do polkit). Responde na hora:
// instalar pacote e preparar o app pode levar minutos, mais do que um proxy na frente espera por uma resposta.
// O ajudante grava o resultado em <pedidos>/<nome>.resultado.json e o registro do app em <registro>/<nome>.json.
import {readFile,readdir,writeFile,rename,mkdir,unlink} from 'node:fs/promises';
import {readFileSync,readdirSync} from 'node:fs';
import path from 'node:path';
import {problem} from './catalog.mjs';

export const NOME_APP=/^[a-z][a-z0-9-]{1,30}$/;
const RESERVADOS=new Set(['portal','assets','api','ws','ratoeira']);   // ratoeira: o MCP da própria Ratoeira no chat

// Registro dos apps publicados: um JSON por app, escrito pelo ajudante de root. Arquivo ilegível é pulado.
export function lerRegistro(dir,log=()=>{}){
  if(!dir)return [];
  let nomes;try{nomes=readdirSync(dir).filter(n=>n.endsWith('.json')).sort();}catch{return [];}
  const r=[];
  for(const n of nomes){
    try{const e=JSON.parse(readFileSync(path.join(dir,n),'utf8'));if(e&&typeof e==='object'&&e.prefix==='/'+n.slice(0,-5))r.push(e);else log(`registro de apps: ${n} não bate com o nome do arquivo; pulei`);}
    catch(e){log(`registro de apps: não li ${n} (${e.message}); pulei`);}
  }
  return r;
}

// Apps da config principal + os do registro. Prefixo repetido: vale o da config principal.
// valido(entrada) lança se a entrada não serve (ex.: segredo ilegível); a entrada é pulada e o log diz por quê.
export function juntarApps(principais=[],registro=[],{valido=()=>{},log=()=>{}}={}){
  const vistos=new Set(principais.map(a=>a.prefix));const r=[...principais];
  for(const e of registro){
    if(vistos.has(e.prefix)){log(`registro de apps: ${e.prefix} também está na config principal; vale a da config`);continue;}
    try{valido(e);}catch(err){log(`registro de apps: ${e.prefix} não entrou (${err.message})`);continue;}
    vistos.add(e.prefix);r.push(e);
  }
  return r;
}

export function createPublicador({areas=[],pedidosDir,registroDir,principais=()=>[],ligar,aoTerminar=async()=>{},log=m=>console.log(m)}){
  const rodando=new Map();
  async function candidatos(){
    const r=[];
    for(const area of areas){
      let itens;try{itens=await readdir(path.join(area.caminho,'apps'),{withFileTypes:true});}catch{continue;}
      for(const d of itens){
        if(!d.isDirectory())continue;
        const pasta=path.join(area.caminho,'apps',d.name);
        let m;try{m=JSON.parse(await readFile(path.join(pasta,'ratoeira-app.json'),'utf8'));}catch{continue;}
        if(!m||typeof m!=='object'||typeof m.nome!=='string'||!NOME_APP.test(m.nome))continue;
        r.push({nome:m.nome,titulo:typeof m.titulo==='string'?m.titulo.slice(0,60):m.nome,descricao:typeof m.descricao==='string'?m.descricao.slice(0,300):'',area:area.id,areaNome:area.nome??area.id,pasta});
      }
    }
    return r;
  }
  async function estado(nome){
    if(rodando.has(nome))return {estado:'publicando',desde:rodando.get(nome).desde,por:rodando.get(nome).por};
    try{
      const r=JSON.parse(await readFile(path.join(pedidosDir,nome+'.resultado.json'),'utf8'));
      return {estado:r.ok?'ok':'erro',em:r.em,erro:r.erro??null,versao:r.versao??null,faltamChaves:r.faltamChaves??[],...(r.chavesNovas?{chavesNovas:r.chavesNovas,chavesIgnoradas:r.chavesIgnoradas??[]}:{}),log:Array.isArray(r.log)?r.log.slice(-80):[]};
    }catch{return null;}
  }
  return {
    async listar(){
      const reg=new Map(lerRegistro(registroDir).map(e=>[e.prefix,e]));const princ=new Set(principais());
      return Promise.all((await candidatos()).map(async c=>{
        const e=reg.get('/'+c.nome);
        return {...c,noAr:Boolean(e),versao:e?.versao??null,dono:e?.dono??null,naConfigPrincipal:princ.has('/'+c.nome),ultimo:await estado(c.nome)};
      }));
    },
    estado,
    // chavesDe: usuário Linux de quem pediu definir_chaves_app; o ajudante junta as chaves que ele deixou no arquivo dele
    async publicar({area,nome,chavesDe=null},por){
      if(typeof nome!=='string'||!NOME_APP.test(nome)||RESERVADOS.has(nome))throw problem(400,'Nome de app inválido.');
      if(principais().includes('/'+nome))throw problem(409,`/${nome} está na config principal do gateway (publicado à mão). Tire de lá antes de publicar por aqui.`);
      const c=(await candidatos()).find(x=>x.area===area&&x.nome===nome);
      if(!c)throw problem(404,'Não achei esse app (apps/<pasta>/ratoeira-app.json) nessa área.');
      if(rodando.has(nome))throw problem(409,'Esse app já está sendo publicado.');
      rodando.set(nome,{desde:new Date().toISOString(),por});
      try{
        await mkdir(pedidosDir,{recursive:true,mode:0o750});
        await unlink(path.join(pedidosDir,nome+'.resultado.json')).catch(()=>{});
        const arq=path.join(pedidosDir,nome+'.json');
        await writeFile(arq+'.tmp',JSON.stringify({nome,area,pasta:c.pasta,por,em:new Date().toISOString(),...(chavesDe?{chaves_de:chavesDe}:{})})+'\n',{mode:0o640});
        await rename(arq+'.tmp',arq);
      }catch(e){rodando.delete(nome);throw e;}
      log(`publicar ${nome}: pedido de ${por}`);
      // não espera: a tela acompanha pelo estado
      Promise.resolve().then(()=>ligar(nome)).catch(e=>log(`publicar ${nome}: ${e.message}`))
        .finally(async()=>{rodando.delete(nome);try{await aoTerminar(nome);}catch(e){log(`publicar ${nome}: recarregar apps falhou (${e.message})`);}});
      return {estado:'publicando'};
    },
  };
}
