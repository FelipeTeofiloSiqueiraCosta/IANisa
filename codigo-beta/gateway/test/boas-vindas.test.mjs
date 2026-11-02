// Boas-vindas (docs/2026-10-17-boas-vindas.md): quem chega depois delas vê, quem já existia não; concluir, pular,
// lista e itens marcados ficam guardados por pessoa; zerar mostra de novo; o que vale como "endereço próprio".
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createContas} from '../contas.mjs';
import {enderecoProprio} from '../portal.mjs';

const SENHA='uma frase bem comprida';
async function montar(t){
  const dir=await mkdtemp(path.join(tmpdir(),'ratoeira-bv-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  let agora=Date.UTC(2026,9,17);
  const contas=createContas({dir,agora:()=>agora});await contas.iniciar();
  return {dir,contas,passar:ms=>{agora+=ms;}};
}

test('admin novo vê as boas-vindas; concluir guarda e não mostra mais',async t=>{
  const {contas,passar}=await montar(t);
  const token=await contas.primeiroAcesso();passar(1000);
  await contas.usarLink(token,{senha:SENHA,nome:'Ana',email:'ana@x.com'});
  let bv=await contas.boasVindas('ana@x.com');
  assert.equal(bv.mostrar,true);assert.equal(bv.lista,true);assert.deepEqual(bv.marcados,[]);
  bv=await contas.definirBoasVindas('ana@x.com',{acao:'marcar',item:'backup-vps'});
  assert.deepEqual(bv.marcados,['backup-vps']);
  bv=await contas.definirBoasVindas('ana@x.com',{acao:'concluir'});
  assert.equal(bv.mostrar,false);assert.ok(bv.concluido);assert.equal(bv.lista,true);
  bv=await contas.definirBoasVindas('ana@x.com',{acao:'fechar-lista'});
  assert.equal(bv.lista,false);
  await assert.rejects(contas.definirBoasVindas('ana@x.com',{acao:'apagar-tudo'}),{status:400});
  await assert.rejects(contas.definirBoasVindas('ana@x.com',{acao:'marcar',item:'qualquer'}),{status:400});
  assert.equal(await contas.boasVindas('ninguem@x.com'),null);
});

test('quem já existia quando as boas-vindas chegaram conta como "já viu"; zerar mostra de novo',async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'ratoeira-bv-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  // pessoas.json de antes das boas-vindas: sem boasVindasDesde, uma pessoa criada ontem e uma sem data
  await mkdir(dir,{recursive:true});
  await writeFile(path.join(dir,'pessoas.json'),JSON.stringify({pessoas:[
    {email:'bia@x.com',nome:'Bia',papel:'admin',estado:'ativa',ambiente:null,apps:{},criadaEm:'2026-10-16T12:00:00.000Z'},
    {email:'gil@x.com',nome:'Gil',papel:'membro',estado:'ativa',ambiente:null,apps:{}}],links:[]}));
  const contas=createContas({dir,agora:()=>Date.UTC(2026,9,17)});await contas.iniciar();
  for(const e of ['bia@x.com','gil@x.com']){const bv=await contas.boasVindas(e);assert.equal(bv.mostrar,false);assert.equal(bv.lista,false);}
  const bv=await contas.definirBoasVindas('bia@x.com',{acao:'zerar'});
  assert.equal(bv.mostrar,true);assert.equal(bv.lista,true);
  // a data de corte foi gravada junto: reler o arquivo não muda quem já existia
  const salvo=JSON.parse(await readFile(path.join(dir,'pessoas.json'),'utf8'));
  assert.equal(salvo.boasVindasDesde,'2026-10-17T00:00:00.000Z');
  assert.equal((await contas.boasVindas('gil@x.com')).mostrar,false);
});

test('pular também não mostra mais, mas deixa a lista',async t=>{
  const {contas,passar}=await montar(t);
  const token=await contas.primeiroAcesso();passar(1000);
  await contas.usarLink(token,{senha:SENHA,nome:'Caio',email:'caio@x.com'});
  const bv=await contas.definirBoasVindas('caio@x.com',{acao:'pular'});
  assert.equal(bv.mostrar,false);assert.ok(bv.pulado);assert.equal(bv.lista,true);
});

test('endereço do provedor não conta como próprio',()=>{
  for(const h of ['srv123456.hstgr.cloud','203-0-113-7.sslip.io','apps.1-2-3-4.sslip.io','localhost:6768','10.0.0.1',null,''])assert.equal(enderecoProprio(h),false,h);
  for(const h of ['ratoeira.exemplo.com.br','apps.exemplo.com'])assert.equal(enderecoProprio(h),true,h);
});
