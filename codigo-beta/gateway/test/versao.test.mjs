import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { VERSAO } from '../versao.mjs';

const ler=rel=>readFileSync(new URL('../../'+rel,import.meta.url),'utf8');

test('a versão é uma só: VERSION, gateway e servidor de agentes', () => {
  const versao=ler('VERSION').trim();
  assert.match(versao,/^\d+\.\d+\.\d+$/);
  assert.equal(VERSAO,versao);
  assert.equal(JSON.parse(ler('agentes/package.json')).version,versao);
  for(const lock of ['gateway/package-lock.json','agentes/package-lock.json']){
    const d=JSON.parse(ler(lock));
    assert.equal(d.version,versao,lock);
    assert.equal(d.packages[''].version,versao,lock);
  }
});

test('o CHANGELOG tem a entrada da versão, em cima', () => {
  const primeira=ler('CHANGELOG.md').match(/^## (\S+)/m)?.[1];
  assert.equal(primeira,ler('VERSION').trim());
});
