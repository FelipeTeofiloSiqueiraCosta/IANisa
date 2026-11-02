import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, utimesSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createCore, PARTES, FONTES } from '../core.mjs';

// Publicar a própria Ratoeira (docs/2026-10-09-publicar-core.md): o gateway só grava o pedido, liga o ajudante
// de root sem esperar e lê o estado do disco (versões, pedido aberto, resultado) e do git.
const raiz = mkdtempSync(path.join(tmpdir(), 'core-'));
after(() => rmSync(raiz, {recursive:true, force:true}));
const repo = path.join(raiz, 'repo'), fonte = path.join(repo, 'ratoeira'), pedidos = path.join(raiz, 'pedidos'), versoes = path.join(raiz, 'versoes.json');
const g = (...a) => execFileSync('git', ['-C', repo, ...a], {encoding:'utf8'});
mkdirSync(path.join(fonte, 'gateway', 'public'), {recursive:true});
mkdirSync(path.join(fonte, 'agentes'), {recursive:true});
writeFileSync(path.join(fonte, 'gateway', 'main.mjs'), '// gateway\n');
writeFileSync(path.join(fonte, 'gateway', 'public', 'portal.js'), '// tela\n');
writeFileSync(path.join(fonte, 'agentes', 'servidor.mjs'), '// agentes\n');
g('init', '-q'); g('-c', 'user.email=t@t', '-c', 'user.name=t', 'add', '.'); g('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'primeiro');

function core(over={}) {
  return createCore({fonte, partes:['telas', 'gateway', 'inventada'], pedidosDir:pedidos, versoesArquivo:versoes, ligar:async () => {}, log:() => {}, ...over});
}

test('as partes e as fontes batem com as do ajudante de root', () => {
  const py = readFileSync(new URL('../../kit/multiusuario/publicar-core', import.meta.url), 'utf8');
  assert.match(py, new RegExp(`PARTES = \\(${PARTES.map(p => `"${p}"`).join(', ')}\\)`));
  for (const [p, f] of Object.entries(FONTES)) assert.ok(py.includes(`"${p}": [${f.map(x => `"${x}"`).join(', ')}]`), p);
  const regra = readFileSync(new URL('../../kit/multiusuario/50-ratoeira.rules', import.meta.url), 'utf8');
  assert.ok(regra.includes(`ratoeira-publicar-core@(${PARTES.join('|')})`));
});

test('só as partes liberadas, na ordem de sempre; parte fora da lista é recusada', async () => {
  assert.deepEqual(core().partes, ['telas', 'gateway']);
  await assert.rejects(core().publicar('kit', 'a@x'), e => e.status === 400 && /telas, gateway/.test(e.message));
});

test('publicar grava o pedido, liga a unit e o estado vem do disco e do git', async () => {
  let ligada;
  const c = core({ligar:async p => { ligada = p; }});
  assert.deepEqual(await c.publicar('telas', 'ana@x'), {estado:'publicando'});
  assert.equal(ligada, 'telas');
  assert.equal(JSON.parse(readFileSync(path.join(pedidos, 'telas.json'), 'utf8')).por, 'ana@x');
  let e = await c.estado('telas');
  assert.ok(e.publicando);
  assert.match(e.repo.commit, /primeiro$/);
  assert.deepEqual(e.repo.semCommit, []);
  await assert.rejects(c.publicar('telas', 'ana@x'), e => e.status === 409);
  // o ajudante termina: apaga o pedido, grava o resultado e a versão
  rmSync(path.join(pedidos, 'telas.json'));
  writeFileSync(path.join(pedidos, 'telas.resultado.json'), JSON.stringify({ok:true, em:'2026-10-09T23:00:00+00:00', log:['ok']}));
  writeFileSync(versoes, JSON.stringify({telas:{commit:'abc primeiro', em:'2026-10-09T23:00:00+00:00', por:'ana@x'}}));
  e = await c.estado('telas');
  assert.equal(e.publicando, null);
  assert.equal(e.ultimo.ok, true);
  assert.equal(e.noAr.commit, 'abc primeiro');
  // mudança sem commit aparece só na parte dela
  writeFileSync(path.join(fonte, 'gateway', 'public', 'portal.js'), '// tela mudada\n');
  assert.deepEqual((await c.estado('telas')).repo.semCommit, ['ratoeira/gateway/public/portal.js']);
  assert.deepEqual((await core({partes:['agentes']}).estado('agentes')).repo.semCommit, []);
  g('checkout', '--', '.');
});

test('a unit não ligou: o pedido some e o erro diz o que conferir', async () => {
  const c = core({ligar:async () => { throw new Error('Interactive authentication required'); }});
  await assert.rejects(c.publicar('gateway', 'a@x'), e => e.status === 502 && /polkit/.test(e.message));
  assert.equal(existsSync(path.join(pedidos, 'gateway.json')), false);
});

test('pedido velho, de um ajudante que morreu, não trava a parte', async () => {
  mkdirSync(pedidos, {recursive:true});
  const arq = path.join(pedidos, 'gateway.json');
  writeFileSync(arq, '{}');
  const velho = new Date(Date.now() - 60 * 60e3);
  utimesSync(arq, velho, velho);
  assert.equal((await core().estado('gateway')).publicando, null);
  assert.deepEqual(await core().publicar('gateway', 'a@x'), {estado:'publicando'});
});

test('receita e pacotes: o pedido leva o que rodar, validado antes de ligar a unit', async () => {
  const ligadas = [];
  const c = core({partes:['receita', 'pacotes'], ligar:async p => { ligadas.push(p); }});
  await assert.rejects(c.publicar('receita', 'a@x', {receita:'../etc/passwd'}), e => e.status === 400);
  await assert.rejects(c.publicar('receita', 'a@x', {receita:'playwright', args:['1.6 ; rm -rf /']}), e => e.status === 400);
  await assert.rejects(c.publicar('pacotes', 'a@x', {pacotes:['ffmpeg', '--allow-unauthenticated']}), e => e.status === 400);
  await assert.rejects(c.publicar('pacotes', 'a@x', {pacotes:[]}), e => e.status === 400);
  assert.deepEqual(ligadas, []);
  await c.publicar('receita', 'a@x', {receita:'playwright', args:['1.62.0']});
  await c.publicar('pacotes', 'a@x', {pacotes:['ffmpeg']});
  assert.deepEqual(ligadas, ['receita', 'pacotes']);
  const r = JSON.parse(readFileSync(path.join(pedidos, 'receita.json'), 'utf8'));
  assert.equal(r.receita, 'playwright'); assert.deepEqual(r.args, ['1.62.0']);
  assert.deepEqual(JSON.parse(readFileSync(path.join(pedidos, 'pacotes.json'), 'utf8')).pacotes, ['ffmpeg']);
  // não entram no estado das partes publicáveis
  assert.deepEqual(await c.estados(), []);
});
