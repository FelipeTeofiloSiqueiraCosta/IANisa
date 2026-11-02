import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, statSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { migrar, carregarConfig, migrarArquivo, VERSAO_CONFIG } from '../config.mjs';

// degraus de mentira: 1 → 2 renomeia "porta" pra "port"; 2 → 3 tira o "paseo"
const degraus=[
  {para:2,oque:'porta vira port',aplicar:c=>{c.port=c.porta;delete c.porta;return c;}},
  {para:3,oque:'sai o paseo',aplicar:c=>{delete c.paseo;return c;}},
];

test('config sem versão é a 1 e não passa por degrau nenhum quando o código também é 1', () => {
  const cfg={port:8780,escolha:'do aluno'};
  const r=migrar(cfg);
  assert.equal(VERSAO_CONFIG,1);
  assert.deepEqual(r,{config:cfg,de:1,para:1,passos:[],maisNova:false});
});

test('migra degrau por degrau, sem mexer no objeto original', () => {
  const cfg={porta:9000,paseo:true,fica:1};
  const r=migrar(cfg,degraus,3);
  assert.deepEqual(r.config,{port:9000,fica:1,versao:3});
  assert.deepEqual(r.passos,['1 → 2: porta vira port','2 → 3: sai o paseo']);
  assert.deepEqual(cfg,{porta:9000,paseo:true,fica:1});
  // já na 2: só o degrau que falta
  assert.deepEqual(migrar({versao:2,port:1,paseo:1},degraus,3).passos,['2 → 3: sai o paseo']);
});

test('config mais nova que o código sobe assim mesmo, sem mexer', () => {
  const r=migrar({versao:5,x:1},degraus,3);
  assert.equal(r.maisNova,true);
  assert.deepEqual(r.config,{versao:5,x:1});
});

test('degrau faltando, degrau que quebra e versão inválida param com erro claro', () => {
  assert.throws(()=>migrar({},[{para:3,oque:'pulei',aplicar:c=>c}],3),/Falta o degrau da config 1 → 2/);
  assert.throws(()=>migrar({},[degraus[0]],3),/ficou na versão 2; o código espera 3/);
  assert.throws(()=>migrar({versao:'1'}),/"versao" da config inválida/);
  assert.throws(()=>migrar([]),/objeto JSON/);
  assert.throws(()=>migrar({},[{para:2,oque:'x',aplicar:()=>{throw new Error('quebrou');}}],2),/quebrou/);
});

test('carregar: sem arquivo não sobe (não tem config de reserva)', () => {
  assert.throws(()=>carregarConfig(undefined),/Falta RATOEIRA_CONFIG/);
  assert.throws(()=>carregarConfig('/nao/existe.json'),/Não consegui ler a config/);
});

test('carregar migra só na memória e avisa no log', () => {
  const dir=mkdtempSync(path.join(tmpdir(),'cfg-'));
  const arq=path.join(dir,'gateway.config.json');
  writeFileSync(arq,JSON.stringify({porta:1,paseo:1}));
  const logs=[];
  const cfg=carregarConfig(arq,{log:m=>logs.push(m),migracoes:degraus,alvo:3});
  assert.deepEqual(cfg,{port:1,versao:3});
  assert.match(logs[0],/migrada na memória pra 3/);
  assert.deepEqual(JSON.parse(readFileSync(arq,'utf8')),{porta:1,paseo:1});
});

test('migrar o arquivo grava com cópia ao lado e mantém o modo', () => {
  const dir=mkdtempSync(path.join(tmpdir(),'cfg-'));
  const arq=path.join(dir,'gateway.config.json');
  writeFileSync(arq,JSON.stringify({porta:1,paseo:1}));
  chmodSync(arq,0o640);
  const r=migrarArquivo(arq,{migracoes:degraus,alvo:3,agora:new Date('2026-10-12T20:00:00Z')});
  assert.equal(r.copia,arq+'.antes-v1-20261012T200000Z');
  assert.deepEqual(JSON.parse(readFileSync(r.copia,'utf8')),{porta:1,paseo:1});
  assert.deepEqual(JSON.parse(readFileSync(arq,'utf8')),{port:1,versao:3});
  assert.equal(statSync(arq).mode&0o777,0o640);
  // em dia: não grava nem copia de novo
  assert.equal(migrarArquivo(arq,{migracoes:degraus,alvo:3}).copia,null);
  assert.equal(readdirSync(dir).length,2);
});

test('linha de comando: conferir diz a versão e não grava', () => {
  const dir=mkdtempSync(path.join(tmpdir(),'cfg-'));
  const arq=path.join(dir,'gateway.config.json');
  writeFileSync(arq,'{"port":1}');
  const saida=execFileSync(process.execPath,[new URL('../config.mjs',import.meta.url).pathname,'conferir',arq],{encoding:'utf8'});
  assert.match(saida,/versão 1, em dia/);
  assert.equal(readFileSync(arq,'utf8'),'{"port":1}');
});
