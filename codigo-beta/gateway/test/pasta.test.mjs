// Arquivos numa pasta sem git (a ~/trabalho do aluno) e num repo com arquivos ainda não commitados.
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtemp,mkdir,writeFile,symlink,rm,rename} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createRepoFiles,escondido} from '../files.mjs';

async function pastaDeTeste(raiz){
  const d=path.join(raiz,'trabalho');
  await mkdir(path.join(d,'projeto','sub'),{recursive:true});
  await writeFile(path.join(d,'teste.md'),'# Teste');
  await writeFile(path.join(d,'projeto','sub','pagina.html'),'<h1>oi</h1>');
  await writeFile(path.join(d,'.env'),'SEGREDO=cru');
  await mkdir(path.join(d,'.claude'));await writeFile(path.join(d,'.claude','settings.json'),'{}');
  await mkdir(path.join(d,'node_modules','x'),{recursive:true});await writeFile(path.join(d,'node_modules','x','i.js'),'');
  await writeFile(path.join(d,'servidor.pem'),'-----BEGIN');
  await writeFile(path.join(d,'id_ed25519'),'chave');
  await writeFile(path.join(d,'credentials.json'),'{}');
  await writeFile(path.join(raiz,'fora.txt'),'fora');
  await symlink(path.join(raiz,'fora.txt'),path.join(d,'atalho.txt'));
  await symlink(path.join(raiz),path.join(d,'pasta-atalho'));
  return d;
}

// Desde 19/10/2026 a árvore é o disco: nada some, fora a pasta .git. O que o git não guarda vem marcado foraDoGit.
test('pasta simples: lista tudo o que está na pasta, abre o .env, e atalho e saída da pasta seguem bloqueados',async t=>{
  const raiz=await mkdtemp(path.join(tmpdir(),'ratoeira-pasta-'));t.after(()=>rm(raiz,{recursive:true,force:true}));
  const files=createRepoFiles(await pastaDeTeste(raiz));
  const itens=(await files.listar('')).itens,nomes=itens.map(i=>i.nome);
  assert.deepEqual(nomes.sort(),['.claude','.env','atalho.txt','credentials.json','id_ed25519','node_modules','pasta-atalho','projeto','servidor.pem','teste.md'].sort());
  assert.ok(!itens.some(i=>i.foraDoGit),'sem git, ninguém leva o sinal');
  assert.equal(itens.find(i=>i.nome==='atalho.txt').tipo,'atalho');
  assert.equal(itens.find(i=>i.nome==='pasta-atalho').tipo,'atalho','symlink de pasta não é percorrido');
  await assert.rejects(files.listar('pasta-atalho'),e=>e.status===404,'nem listado por dentro');
  assert.deepEqual((await files.listar('projeto/sub')).itens.map(i=>i.nome),['pagina.html']);
  assert.equal((await files.buscar('pagina')).itens[0].caminho,'projeto/sub/pagina.html');
  assert.equal((await files.buscar('settings')).itens[0].caminho,'.claude/settings.json','oculto entra na busca');
  assert.deepEqual((await files.buscar('i.js')).itens,[],'dependência fica fora da busca (a árvore mostra)');
  for(const p of ['teste.md','.env','.claude/settings.json','node_modules/x/i.js'])assert.equal((await files.resolver(p)).rel,p);
  for(const p of ['atalho.txt','pasta-atalho/fora.txt','../fora.txt','.git/config'])
    await assert.rejects(files.resolver(p),e=>e.status===404,'bloqueado: '+p);
  assert.equal((await files.estado()).podeSincronizar,false,'sem autosync, sem botão');
});

test('pasta simples: arquivo que o agente acabou de criar aparece em segundos',async t=>{
  const raiz=await mkdtemp(path.join(tmpdir(),'ratoeira-pasta-'));t.after(()=>rm(raiz,{recursive:true,force:true}));
  const d=await pastaDeTeste(raiz);const files=createRepoFiles(d);
  await files.listar('');
  await writeFile(path.join(d,'novo.md'),'# novo');
  await new Promise(r=>setTimeout(r,5200));
  assert.ok((await files.listar('')).itens.some(i=>i.nome==='novo.md'));
});

test('repo: o ignorado e o repositório aninhado aparecem marcados fora do git; o versionado e o novo, não',async t=>{
  const raiz=await mkdtemp(path.join(tmpdir(),'ratoeira-repo-'));t.after(()=>rm(raiz,{recursive:true,force:true}));
  const d=await pastaDeTeste(raiz);
  await writeFile(path.join(d,'.gitignore'),'ignorado.md\n.env\nnode_modules/\n');await writeFile(path.join(d,'ignorado.md'),'x');
  const git=(...a)=>execFileSync('git',['-C',a[0]==='-'?a[1]:d,...a.slice(a[0]==='-'?2:0)],{stdio:'pipe'});
  git('init','-q');git('add','teste.md','.gitignore');git('-c','user.name=t','-c','user.email=t@t','commit','-qm','x');
  await writeFile(path.join(d,'solto.md'),'ainda não commitado');
  await mkdir(path.join(d,'cliente','src'),{recursive:true});await writeFile(path.join(d,'cliente','src','a.js'),'1');
  git('-',path.join(d,'cliente'),'init','-q');
  const files=createRepoFiles(d,{naoVersionados:true});
  const itens=(await files.listar('',{subpastas:true})),porNome=n=>itens.itens.find(i=>i.nome===n);
  assert.ok(!porNome('.git'),'a .git não aparece');
  for(const n of ['ignorado.md','.env','node_modules','cliente'])assert.ok(porNome(n)?.foraDoGit,'fora do git: '+n);
  for(const n of ['teste.md','solto.md','projeto','.gitignore'])assert.ok(porNome(n)&&!porNome(n).foraDoGit,'no git: '+n);
  assert.ok(itens.filhos['cliente'].every(i=>i.foraDoGit),'dentro do repositório aninhado, tudo fora');
  assert.ok((await files.listar('cliente/src')).itens[0].foraDoGit);
  assert.equal((await files.resolver('ignorado.md')).rel,'ignorado.md','ignorado abre');
  assert.ok((await files.buscar('ignorado')).itens[0]?.foraDoGit,'e a busca acha, marcado');
});

test('repo: a versão do estado acompanha o disco das pastas abertas (até pasta vazia)',async t=>{
  const raiz=await mkdtemp(path.join(tmpdir(),'ratoeira-repo-'));t.after(()=>rm(raiz,{recursive:true,force:true}));
  const d=await pastaDeTeste(raiz);
  const git=(...a)=>execFileSync('git',['-C',d,...a],{stdio:'pipe'});
  git('init','-q');git('add','teste.md');git('-c','user.name=t','-c','user.email=t@t','commit','-qm','x');
  const head=git('rev-parse','--short','HEAD').toString().trim();
  const files=createRepoFiles(d,{naoVersionados:true});
  const v0=(await files.estado({abertas:['projeto']})).versao;
  assert.ok(v0.startsWith(head),'começa no commit');
  await new Promise(r=>setTimeout(r,20));await mkdir(path.join(d,'projeto','vazia'));
  const v1=(await files.estado({abertas:['projeto']})).versao;
  assert.notEqual(v1,v0,'pasta vazia nova numa pasta aberta muda a versão');
  assert.ok((await files.listar('projeto')).itens.some(i=>i.nome==='vazia'),'e aparece');
  await new Promise(r=>setTimeout(r,20));await mkdir(path.join(d,'outra'));
  assert.notEqual((await files.estado()).versao.split('~')[1],v1.split('~')[1],'a raiz conta sempre');
  assert.ok((await files.estado({abertas:['../x','.git']})).versao,'pasta inválida é só ignorada');
});

test('repo com naoVersionados: pasta movida sem commit sai do lugar velho, e apagar muda a versão',async t=>{
  const raiz=await mkdtemp(path.join(tmpdir(),'ratoeira-repo-'));t.after(()=>rm(raiz,{recursive:true,force:true}));
  const d=await pastaDeTeste(raiz);
  const git=(...a)=>execFileSync('git',['-C',d,...a],{stdio:'pipe'});
  git('init','-q');git('add','teste.md','projeto');git('-c','user.name=t','-c','user.email=t@t','commit','-qm','x');
  await mkdir(path.join(d,'cliente'));await rename(path.join(d,'projeto'),path.join(d,'cliente','projeto'));
  const files=createRepoFiles(d,{naoVersionados:true});
  const nomes=(await files.listar('')).itens.map(i=>i.nome);
  assert.ok(!nomes.includes('projeto'),'o lugar velho sumiu');
  assert.ok(nomes.includes('cliente'));
  assert.deepEqual((await files.listar('cliente/projeto/sub')).itens.map(i=>i.nome),['pagina.html']);
  await assert.rejects(files.resolver('projeto/sub/pagina.html'),e=>e.status===404);
  const antes=(await createRepoFiles(d,{naoVersionados:true}).estado()).versao;
  await rm(path.join(d,'teste.md'));
  const depois=createRepoFiles(d,{naoVersionados:true});
  assert.notEqual((await depois.estado()).versao,antes,'rm sem arquivo novo também muda a versão');
  assert.ok(!(await depois.listar('')).itens.some(i=>i.nome==='teste.md'));
});

test('escondido: só a pasta .git',()=>{
  assert.ok(escondido('.git'));
  for(const n of ['.env','.claude','node_modules','id_rsa','credentials.json','.gitignore'])assert.ok(!escondido(n),n);
});

test('pesados e ignorados: aparecem marcados e abrem; a busca acha, menos dentro de dependência',async t=>{
  const raiz=await mkdtemp(path.join(tmpdir(),'ratoeira-repo-'));t.after(()=>rm(raiz,{recursive:true,force:true}));
  const d=await pastaDeTeste(raiz);
  const {ajustarGitignore}=await import('../../agentes/pesados.mjs');
  await writeFile(path.join(d,'.gitignore'),ajustarGitignore('ignorado.md\nsegredo.mp4\nnode_modules/\n',{grandes:['dados/[a] grande.bin']}));
  for(const f of ['aula.MOV','ignorado.md','segredo.mp4','node_modules/x.mp4'])await writeFile(path.join(d,f),'x');
  await mkdir(path.join(d,'dados'),{recursive:true});await writeFile(path.join(d,'dados','[a] grande.bin'),'x');
  const git=(...a)=>execFileSync('git',['-C',d,...a],{stdio:'pipe'});
  git('init','-q');git('add','teste.md','.gitignore');git('-c','user.name=t','-c','user.email=t@t','commit','-qm','x');
  const f=createRepoFiles(d);
  const itens=(await f.listar('')).itens;
  for(const n of ['aula.MOV','segredo.mp4','ignorado.md','node_modules'])assert.ok(itens.find(i=>i.nome===n)?.foraDoGit,'marcado: '+n);
  assert.ok(itens.find(i=>i.nome==='aula.MOV').pesado,'o nome antigo do sinal segue junto (Apagar lê)');
  assert.ok((await f.listar('dados')).itens[0].foraDoGit,'grande pelo caminho exato');
  assert.equal((await f.resolver('aula.MOV')).rel,'aula.MOV','pesado abre e baixa');
  assert.deepEqual((await f.buscar('aula')).itens.map(i=>i.caminho),['aula.MOV']);
  assert.ok(!(await f.buscar('x.mp4')).itens.some(i=>i.caminho.startsWith('node_modules/')),'busca não entra em dependência');
  await writeFile(path.join(d,'outra.mp3'),'x');
  assert.ok((await f.listar('')).itens.some(i=>i.nome==='outra.mp3'),'aparece na hora');
});
