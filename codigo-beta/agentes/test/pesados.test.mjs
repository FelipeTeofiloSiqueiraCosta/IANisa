import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,truncateSync,mkdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {ajustarGitignore,lerBlocos,ehPesado,padraoExato,marcarGrandes,LIMITE} from '../pesados.mjs';

test('pesado: tipo sem diferenciar maiúscula, ou tamanho acima do limite',()=>{
  for(const n of ['aula.mp4','AULA.MOV','capa.psd','pacote.zip','fotos/x.TIFF','logo.ai'])assert.ok(ehPesado(n),n);
  for(const n of ['notas.md','foto.png','openai.txt','aiff.md'])assert.ok(!ehPesado(n),n);
  assert.ok(ehPesado('banco.sqlite',LIMITE+1));
  assert.ok(!ehPesado('banco.sqlite',LIMITE));
});

test('.gitignore: tipos no começo (o repo ganha depois), grandes no fim, sem repetir, e lê de volta',()=>{
  const antes='node_modules\n*.mp4\n!sites/**/*.mp4\n';
  const um=ajustarGitignore(antes);
  assert.ok(um.startsWith('# >>> ratoeira: arquivos pesados'),'bloco no começo');
  assert.ok(um.endsWith(antes),'o que o repo tinha fica depois, intacto');
  assert.equal(ajustarGitignore(um),um,'segunda vez não muda nada');
  assert.ok(um.includes('*.[mM][pP]4')&&um.includes('*.[pP][sS][dD]'));
  const dois=ajustarGitignore(um,{grandes:['dados/banco grande.sqlite','[x]#.bin']});
  assert.ok(dois.trimEnd().endsWith('# <<< ratoeira: arquivos grandes'),'grandes no fim');
  const tres=ajustarGitignore(dois,{grandes:['dados/banco grande.sqlite','outro.bin']});
  assert.equal((tres.match(/banco grande/g)||[]).length,1,'não repete');
  const b=lerBlocos(tres);
  assert.deepEqual(b.grandes,['dados/banco grande.sqlite','[x]#.bin','outro.bin']);
  assert.equal(b.tipos.length,18);
  assert.equal(padraoExato('#a[1]*.bin'),'/#a\\[1\\]\\*.bin');
  assert.equal(padraoExato('!x'),'/!x');
});

test('o git respeita: tipo some, exceção do repo vale, grande entra pelo caminho exato',()=>{
  const repo=mkdtempSync(path.join(tmpdir(),'pesados-'));
  const git=(...a)=>execFileSync('git',['-C',repo,...a],{encoding:'utf8'});
  git('init','-q');
  writeFileSync(path.join(repo,'.gitignore'),ajustarGitignore('!site/*.mp4\n',{grandes:['dados/[x] grande.bin']}));
  mkdirSync(path.join(repo,'site'));mkdirSync(path.join(repo,'dados'));
  const ignorado=r=>{try{git('check-ignore','-q','--',r);return true;}catch{return false;}};
  assert.ok(ignorado('aula.MP4'));
  assert.ok(!ignorado('site/hero.mp4'),'a exceção do repo ganha do bloco de tipos');
  assert.ok(ignorado('dados/[x] grande.bin'));
  assert.ok(!ignorado('dados/[x] pequeno.bin'));
});

test('marcarGrandes: arquivo novo acima do limite entra no bloco; versionado e pequeno ficam',async()=>{
  const repo=mkdtempSync(path.join(tmpdir(),'grandes-'));
  const git=(...a)=>execFileSync('git',['-C',repo,...a],{encoding:'utf8'});
  git('init','-q');git('config','user.name','T');git('config','user.email','t@t');
  writeFileSync(path.join(repo,'versionado.bin'),'x');git('add','-A');git('commit','-qm','a');
  truncateSync(path.join(repo,'versionado.bin'),LIMITE+10);
  writeFileSync(path.join(repo,'novo.bin'),'');truncateSync(path.join(repo,'novo.bin'),LIMITE+10);
  writeFileSync(path.join(repo,'pequeno.txt'),'oi');
  const r=await marcarGrandes(repo);
  assert.deepEqual(r,{mudou:true,grandes:['novo.bin']});
  assert.deepEqual(lerBlocos(readFileSync(path.join(repo,'.gitignore'),'utf8')).grandes,['novo.bin']);
  assert.equal((await marcarGrandes(repo)).mudou,false,'de novo: nada');
});
