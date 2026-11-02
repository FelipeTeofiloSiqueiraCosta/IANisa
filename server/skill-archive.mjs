import yauzl from 'yauzl';
import {crc32} from 'node:zlib';
import {problem} from './accounts.mjs';
import {validateSkillPackage} from './skills-store.mjs';
import {SKILL_LIMITS,isHiddenSkillPath} from '../shared/skill-import.js';
export const MAX_SKILL_UPLOAD=24*1024*1024;
const textExtensions=/\.(md|txt|json|ya?ml|sh|py|js|css|csv)$/i,imageExtensions=/\.(png|jpe?g|webp)$/i;
function text(data){try{return new TextDecoder('utf-8',{fatal:true}).decode(data);}catch{throw problem(400,'Os arquivos de texto da skill precisam estar em UTF-8.');}}
export function skillUploadName(name){
 if(typeof name!=='string'||!name||name.length>180||/[\\/\x00-\x1f\x7f]/.test(name)||name.startsWith('.')||!/^.+\.(md|zip)$/i.test(name))throw problem(415,'Envie somente um arquivo .md ou .zip.');
 return name;
}
function safeEntry(name){
 if(typeof name!=='string'||name.length>400||/[\\\x00-\x1f\x7f]/.test(name)||name.startsWith('/')||/^[a-zA-Z]:/.test(name))throw problem(400,'O ZIP contém um caminho de arquivo não permitido.');
 const trimmed=name.endsWith('/')?name.slice(0,-1):name;
 if(!trimmed||trimmed.split('/').some(p=>!p||p==='.'||p==='..'||p.length>180))throw problem(400,'O ZIP contém um caminho de arquivo não permitido.');
 return trimmed.normalize('NFC');
}
async function readZip(data){
 let zip;const files=[],names=new Set();let declared=0,actual=0,textTotal=0,entries=0,ignored=0;
 try{
  zip=await yauzl.fromBufferPromise(data,{lazyEntries:true,decodeStrings:true,validateEntrySizes:true,strictFileNames:true});
  if(zip.entryCount>256)throw problem(413,'O ZIP tem entradas demais. Use uma única skill com até 64 arquivos.');
  for await(const entry of zip.eachEntry()){
   if(++entries>256)throw problem(413,'O ZIP tem entradas demais.');
   const name=safeEntry(entry.fileName),mode=(entry.externalFileAttributes>>>16)&0o170000;
   if(mode&&mode!==0o100000&&mode!==0o040000)throw problem(400,'Atalhos, links simbólicos e arquivos especiais não são permitidos no ZIP.');
   if(entry.generalPurposeBitFlag&0x41||![0,8].includes(entry.compressionMethod))throw problem(400,'Use um ZIP sem senha, com compactação padrão.');
   if(!Number.isSafeInteger(entry.uncompressedSize)||entry.uncompressedSize<0||!Number.isSafeInteger(entry.compressedSize))throw problem(400,'Tamanho inválido no ZIP.');
   declared+=entry.uncompressedSize;if(declared>SKILL_LIMITS.total)throw problem(413,'O conteúdo expandido do ZIP ultrapassa 24 MB.');
   const key=name.toLowerCase();if(names.has(key))throw problem(400,'O ZIP contém caminhos repetidos ou nomes que diferem apenas em maiúsculas.');names.add(key);
   if(entry.fileName.endsWith('/')){if(entry.uncompressedSize!==0)throw problem(400,'Diretório inválido no ZIP.');continue;}
   if(isHiddenSkillPath(name)){ignored++;continue;}
   const image=imageExtensions.test(name);if(!image&&!textExtensions.test(name))throw problem(415,'O ZIP contém um tipo de arquivo não permitido. Use textos, scripts de referência e imagens PNG, JPG ou WebP.');
   if(files.length>=SKILL_LIMITS.files)throw problem(413,'A skill pode conter até 64 arquivos.');
   const limit=image?SKILL_LIMITS.image:SKILL_LIMITS.text;
   if(entry.uncompressedSize>limit)throw problem(413,image?'Uma imagem do ZIP ultrapassa 8 MB.':'Um texto do ZIP ultrapassa 128 KB.');
   if(entry.uncompressedSize>Math.max(1024*1024,entry.compressedSize*200))throw problem(413,'O ZIP tem uma taxa de expansão excessiva.');
   const stream=await zip.openReadStreamPromise(entry),chunks=[];let bytes=0,checksum=0;
   for await(const chunk of stream){bytes+=chunk.length;actual+=chunk.length;checksum=crc32(chunk,checksum);if(bytes>limit||actual>SKILL_LIMITS.total){stream.destroy();throw problem(413,'O conteúdo expandido do ZIP ultrapassa os limites.');}chunks.push(chunk);}
   if(bytes!==entry.uncompressedSize||checksum!==entry.crc32)throw problem(400,'Um arquivo do ZIP está corrompido. Gere o ZIP novamente.');
   const contents=Buffer.concat(chunks,bytes);
   if(image)files.push({path:name,base64:contents.toString('base64')});
   else{textTotal+=bytes;if(textTotal>SKILL_LIMITS.textTotal)throw problem(413,'Os textos do ZIP devem somar até 1 MB.');files.push({path:name,text:text(contents)});}
  }
 }catch(e){if(e.status)throw e;throw problem(400,'Não foi possível ler o ZIP. Confira se ele está íntegro, sem senha e com compactação padrão.');}
 finally{zip?.close();}
 // Aceita uma pasta principal, como o ZIP criado pelo Finder. Nunca extrai nomes do ZIP no disco.
 for(let i=0;i<4&&files.length;i++){
  const root=files[0].path.split('/')[0];if(!files.every(f=>f.path.startsWith(root+'/')))break;
  for(const file of files)file.path=file.path.slice(root.length+1);
 }
 if(!files.length)throw problem(400,'O ZIP não contém arquivos de skill.');
 return {files,ignored};
}
export async function parseSkillUpload(name,data){
 skillUploadName(name);if(!Buffer.isBuffer(data)||!data.length||data.length>MAX_SKILL_UPLOAD)throw problem(413,'Envie um arquivo de até 24 MB.');
 if(/\.md$/i.test(name)){if(data.length>SKILL_LIMITS.text)throw problem(413,'O Markdown avulso deve ter até 128 KB.');const files=[{path:name,text:text(data)}];return {pkg:validateSkillPackage(files),files,ignored:0};}
 if(data.length<22||!['504b0304','504b0506'].includes(data.subarray(0,4).toString('hex')))throw problem(415,'O conteúdo enviado não corresponde a um arquivo ZIP.');
 const extracted=await readZip(data);return {pkg:validateSkillPackage(extracted.files),files:extracted.files,ignored:extracted.ignored};
}
