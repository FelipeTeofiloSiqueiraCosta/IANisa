#!/usr/bin/env node
// Abre uma versão nova da Ratoeira: grava o número no VERSION, no package.json (e lock) do gateway e do
// servidor de agentes, e abre a entrada no CHANGELOG.md pra escrever o que mudou.
//   node kit/nova-versao.mjs 0.5.1
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const raiz=path.resolve(path.dirname(new URL(import.meta.url).pathname),'..');
const nova=process.argv[2];
if(!/^\d+\.\d+\.\d+$/.test(nova??''))throw new Error('uso: node kit/nova-versao.mjs <maior.menor.correção>');
const atual=readFileSync(path.join(raiz,'VERSION'),'utf8').trim();
const num=v=>v.split('.').map(Number);
const [a,b]=[num(atual),num(nova)];
if(!(b[0]>a[0]||(b[0]===a[0]&&(b[1]>a[1]||(b[1]===a[1]&&b[2]>a[2])))))throw new Error(`${nova} não é maior que ${atual}`);

writeFileSync(path.join(raiz,'VERSION'),nova+'\n');
for(const pasta of ['gateway','agentes'])for(const nome of ['package.json','package-lock.json']){
  const arq=path.join(raiz,pasta,nome);
  if(!existsSync(arq))continue;
  const d=JSON.parse(readFileSync(arq,'utf8'));
  d.version=nova;
  if(d.packages?.['']) d.packages[''].version=nova;
  writeFileSync(arq,JSON.stringify(d,null,2)+'\n');
}
const cl=path.join(raiz,'CHANGELOG.md');
const texto=readFileSync(cl,'utf8');
const hoje=new Date().toLocaleDateString('pt-BR',{timeZone:'America/Sao_Paulo'});
const i=texto.indexOf('\n## ');
writeFileSync(cl,texto.slice(0,i)+`\n## ${nova} (${hoje})\n\n- (escrever o que muda pra quem usa)\n`+texto.slice(i));
console.log(`${atual} → ${nova}. Escreve o que mudou no CHANGELOG.md e commita junto.`);
