import {mkdir,readFile,writeFile,rename,realpath,lstat} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {isIP} from 'node:net';

export function problem(status,message){return Object.assign(new Error(message),{status});}
const guide={id:'guia',name:'Guia da Ratoeira',description:'O que dá pra fazer aqui e por onde começar.',url:'/_ratoeira/pages/guia/'};

export function validateApp(input,hostname='') {
  if(!input||typeof input!=='object'||Array.isArray(input))throw problem(400,'Dados de aplicação inválidos.');
  const name=typeof input.name==='string'?input.name.trim():'';
  const description=typeof input.description==='string'?input.description.trim():'';
  const raw=typeof input.url==='string'?input.url.trim():'';
  if(!name||name.length>60||description.length>240||raw.length>2048||/[\x00-\x1f\x7f]/.test(name+description+raw))throw problem(400,'Informe um nome de até 60 caracteres e um endereço válido.');
  let url=raw;
  if(raw.startsWith('/')) {
    if(!/^\/_ratoeira\/pages\/[a-z0-9][a-z0-9-]{0,63}\/$/.test(raw))throw problem(400,'Use /_ratoeira/pages/nome-da-pagina/ para páginas da VPS.');
  } else {
    let parsed;try{parsed=new URL(raw);}catch{throw problem(400,'Informe um endereço HTTPS completo.');}
    const host=parsed.hostname.toLowerCase();
    if(parsed.protocol!=='https:'||parsed.username||parsed.password||parsed.port||host===hostname||isIP(host)||host.startsWith('[')||!host.includes('.')||host.endsWith('.local')||host.endsWith('.localhost')||host==='localhost'||raw.includes('\\'))throw problem(400,'Use HTTPS público, sem senha ou porta no endereço.');
    url=parsed.href;
  }
  return {name,description,url};
}

export class AppCatalog {
  constructor(dataDir,hostname=''){this.dataDir=dataDir;this.hostname=hostname;this.file=path.join(dataDir,'apps.json');this.queue=Promise.resolve();}
  async list(){
    try{
      const data=JSON.parse(await readFile(this.file,'utf8'));
      if(!Array.isArray(data)||data.length>100)throw new Error('Invalid catalog');
      return data.map(item=>{
        if(typeof item.id!=='string'||!(/^[a-zA-Z0-9-]{1,80}$/).test(item.id))throw new Error('Invalid catalog');
        return {id:item.id,...validateApp(item,this.hostname)};
      });
    }catch(error){if(error.code==='ENOENT')return [{...guide}];throw problem(503,'Não foi possível ler a lista de aplicações. Os dados foram preservados.');}
  }
  change(update){
    const action=this.queue.then(async()=>{
      const items=await this.list();const result=update(items);
      await mkdir(this.dataDir,{recursive:true,mode:0o700});
      const temp=this.file+'.'+randomUUID()+'.tmp';
      await writeFile(temp,JSON.stringify(items,null,2)+'\n',{mode:0o600});
      await rename(temp,this.file);return result;
    });
    this.queue=action.catch(()=>{});return action;
  }
  add(input){
    const validated=validateApp(input,this.hostname);
    return this.change(items=>{
      if(items.length>=100)throw problem(409,'O portal aceita até 100 aplicações.');
      if(items.some(item=>item.url===validated.url))throw problem(409,'Esse endereço já está no portal.');
      const item={id:randomUUID(),...validated};items.push(item);return item;
    });
  }
  remove(id){return this.change(items=>{const index=items.findIndex(item=>item.id===id);if(index===-1)throw problem(404,'Aplicação não encontrada.');items.splice(index,1);return {ok:true};});}
}

const contentTypes={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'application/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.gif':'image/gif','.svg':'image/svg+xml','.ico':'image/x-icon','.woff':'font/woff','.woff2':'font/woff2','.pdf':'application/pdf'};
export async function readPage(pagesDir,relative){
  const parts=relative.split('/');
  if(!/^[a-z0-9][a-z0-9-]{0,63}$/.test(parts[0]??'')||parts.some((part,i)=>part.startsWith('.')||/[\\%\x00-\x1f]/.test(part)||(!part&&i!==parts.length-1)))throw problem(404,'Página não encontrada.');
  const suffix=relative.endsWith('/')?'index.html':'';
  const target=path.join(pagesDir,relative,suffix);
  const type=contentTypes[path.extname(target).toLowerCase()];if(!type)throw problem(404,'Arquivo não publicado.');
  try{
    const base=await realpath(pagesDir);const actual=await realpath(target);
    if(!actual.startsWith(base+path.sep))throw problem(404,'Página não encontrada.');
    // Reject every symlink, even one that points inside the public tree.
    let current=pagesDir;
    for(const part of [...parts.filter(Boolean),...(suffix?[suffix]:[])]){current=path.join(current,part);if((await lstat(current)).isSymbolicLink())throw problem(404,'Página não encontrada.');}
    const stat=await lstat(actual);if(!stat.isFile()||stat.size>10*1024*1024)throw problem(404,'Arquivo não publicado.');
    return {body:await readFile(actual),type};
  }catch(error){if(error.status)throw error;throw problem(404,'Página não encontrada.');}
}
