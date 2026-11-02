// Diálogo Publicar: o que o servidor de agentes grava (foto, ao vivo, senha, regras de nome e de caminho).
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,mkdir,writeFile,readFile,readdir} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {prepararPublicacao,gravarPublicacao} from '../servidor.mjs';

async function repo(t){
  const raiz=await mkdtemp(path.join(tmpdir(),'ratoeira-pub-'));t.after(()=>rm(raiz,{recursive:true,force:true}));
  const d=path.join(raiz,'Clientes','Acme');await mkdir(path.join(d,'cortes'),{recursive:true});
  await writeFile(path.join(d,'simulacao.html'),'<img src="cortes/a.svg">');await writeFile(path.join(d,'cortes','a.svg'),'<svg/>');
  await writeFile(path.join(d,'cortes','.oculto'),'x');await writeFile(path.join(d,'gerar.py'),'print(1)');
  return raiz;
}
const ler=async f=>JSON.parse(await readFile(f,'utf8'));

test('foto: copia o arquivo e o que vai junto (sem oculto), grava o manifesto; refazer limpa o que saiu',async t=>{
  const raiz=await repo(t);
  const p=prepararPublicacao(raiz,{arquivo:'Clientes/Acme/simulacao.html',nome:'acme',acesso:'publico',junto:['cortes'],dono:'ana@x.com'},()=>new Date('2026-10-14T10:00:00Z'));
  gravarPublicacao(p);
  const item=path.join(raiz,'playground','acme');
  assert.deepEqual((await readdir(item)).sort(),['cortes','ratoeira-play.json','simulacao.html']);
  assert.deepEqual(await readdir(path.join(item,'cortes')),['a.svg']);
  const m=await ler(path.join(item,'ratoeira-play.json'));
  assert.equal(m.origem,'Clientes/Acme/simulacao.html');assert.equal(m.entrada,'simulacao.html');assert.equal(m.modo,'foto');
  assert.equal(m.acesso,'publico');assert.equal(m.publicado_em,'2026-10-14T10:00:00.000Z');assert.equal(m.dono,'ana@x.com');
  // de novo, sem a cortes: a pasta some da foto
  gravarPublicacao(prepararPublicacao(raiz,{arquivo:'Clientes/Acme/simulacao.html',nome:'acme',acesso:'publico',junto:[]}));
  assert.deepEqual((await readdir(item)).sort(),['ratoeira-play.json','simulacao.html']);
  // o mesmo link pra outro arquivo não
  assert.throws(()=>prepararPublicacao(raiz,{arquivo:'Clientes/Acme/gerar.py',nome:'acme'}),/HTML, PDF/);
  await writeFile(path.join(raiz,'Clientes','Acme','outra.html'),'x');
  assert.throws(()=>prepararPublicacao(raiz,{arquivo:'Clientes/Acme/outra.html',nome:'acme'}),/já é de outra publicação/);
});

test('ao vivo: só o manifesto, apontando pro original; senha guardada como sha256 e mantida quando não vem de novo',async t=>{
  const raiz=await repo(t);
  gravarPublicacao(prepararPublicacao(raiz,{arquivo:'Clientes/Acme/simulacao.html',nome:'acme',acesso:'senha',senha:'segredo123',junto:['cortes'],modo:'aovivo'}));
  const item=path.join(raiz,'playground','acme');
  assert.deepEqual(await readdir(item),['ratoeira-play.json']);
  const m=await ler(path.join(item,'ratoeira-play.json'));
  assert.equal(m.pasta,'Clientes/Acme');assert.equal(m.modo,'aovivo');
  assert.equal(m.senha_sha256,createHash('sha256').update('segredo123').digest('hex'));
  assert.ok(!JSON.stringify(m).includes('segredo123'));
  gravarPublicacao(prepararPublicacao(raiz,{arquivo:'Clientes/Acme/simulacao.html',nome:'acme',acesso:'senha',junto:['cortes'],modo:'aovivo'}));
  assert.equal((await ler(path.join(item,'ratoeira-play.json'))).senha_sha256,m.senha_sha256);
});

test('recusa: nome, caminho, junto inexistente ou com barra, senha curta, pasta que já existe',async t=>{
  const raiz=await repo(t);
  const base={arquivo:'Clientes/Acme/simulacao.html',nome:'acme'};
  assert.throws(()=>prepararPublicacao(raiz,{...base,nome:'Acme!'}),/minúsculas/);
  assert.throws(()=>prepararPublicacao(raiz,{...base,arquivo:'../fora.html'}),/HTML, PDF/);
  assert.throws(()=>prepararPublicacao(raiz,{...base,junto:['nao-existe']}),/não existe/);
  assert.throws(()=>prepararPublicacao(raiz,{...base,junto:['cortes/a.svg']}),/inválida/);
  assert.throws(()=>prepararPublicacao(raiz,{...base,acesso:'senha',senha:'123'}),/6 caracteres/);
  assert.throws(()=>prepararPublicacao(raiz,{...base,acesso:'senha'}),/Falta a senha/);
  await mkdir(path.join(raiz,'playground','n8n'),{recursive:true});
  assert.throws(()=>prepararPublicacao(raiz,{...base,nome:'n8n'}),/Já existe uma pasta/);
  assert.ok(!existsSync(path.join(raiz,'playground','acme')));
});
