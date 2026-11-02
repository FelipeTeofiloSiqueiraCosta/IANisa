import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createPublicador, lerRegistro, juntarApps } from '../publicar.mjs';
import { createGateway, normalizeApps } from '../server.mjs';

// Publicar app sem sudo (docs/2026-10-09-publicar-app-sem-sudo.md): o gateway acha os manifestos nas áreas,
// grava o pedido, liga o ajudante de root sem esperar e relê o registro quando ele termina.
const raiz = mkdtempSync(path.join(tmpdir(), 'publicar-'));
after(() => rmSync(raiz, {recursive:true, force:true}));
const area = path.join(raiz, 'area'), pedidos = path.join(raiz, 'pedidos'), registro = path.join(raiz, 'apps.d');
mkdirSync(path.join(area, 'apps', 'pedidos'), {recursive:true});
mkdirSync(path.join(area, 'apps', 'sem-manifesto'), {recursive:true});
mkdirSync(path.join(area, 'apps', 'quebrado'), {recursive:true});
mkdirSync(registro);
writeFileSync(path.join(area, 'apps', 'pedidos', 'ratoeira-app.json'), JSON.stringify({nome:'pedidos', titulo:'Pedidos', descricao:'Do orçamento à entrega.', porta:8791, iniciar:'./servidor'}));
writeFileSync(path.join(area, 'apps', 'quebrado', 'ratoeira-app.json'), '{nao é json');
const esperar = () => new Promise(r => setTimeout(r, 20));

function publicador(over={}) {
  return createPublicador({areas:[{id:'time', caminho:area}], pedidosDir:pedidos, registroDir:registro, principais:()=>['/crm'], ligar:async()=>{}, log:()=>{}, ...over});
}

test('lista só as pastas com manifesto válido, com a área e o estado', async () => {
  const apps = await publicador().listar();
  assert.deepEqual(apps.map(a => a.nome), ['pedidos']);
  assert.equal(apps[0].area, 'time');
  assert.equal(apps[0].titulo, 'Pedidos');
  assert.equal(apps[0].noAr, false);
  assert.equal(apps[0].ultimo, null);
});

test('publicar grava o pedido, responde sem esperar o ajudante e relê ao terminar', async () => {
  let soltar, terminou = 0, ligado = null;
  const p = publicador({ligar:nome => {ligado = nome; return new Promise(r => { soltar = r; });}, aoTerminar:async () => { terminou++; }});
  assert.deepEqual(await p.publicar({area:'time', nome:'pedidos'}, 'ana@exemplo.com'), {estado:'publicando'});
  const pedido = JSON.parse(readFileSync(path.join(pedidos, 'pedidos.json'), 'utf8'));
  assert.equal(pedido.pasta, path.join(area, 'apps', 'pedidos'));
  assert.equal(pedido.por, 'ana@exemplo.com');
  await esperar();
  assert.equal(ligado, 'pedidos');
  assert.equal((await p.estado('pedidos')).estado, 'publicando');
  await assert.rejects(p.publicar({area:'time', nome:'pedidos'}, 'ana@exemplo.com'), {status:409});
  writeFileSync(path.join(pedidos, 'pedidos.resultado.json'), JSON.stringify({ok:true, em:'agora', versao:'abc', faltamChaves:['X'], log:['no ar']}));
  soltar(); await esperar();
  assert.equal(terminou, 1);
  const e = await p.estado('pedidos');
  assert.equal(e.estado, 'ok');
  assert.deepEqual(e.faltamChaves, ['X']);
});

test('erro do ajudante vira estado de erro, e publicar de novo apaga o resultado velho', async () => {
  const p = publicador({ligar:async () => { throw new Error('saiu com código 1'); }});
  writeFileSync(path.join(pedidos, 'pedidos.resultado.json'), JSON.stringify({ok:true}));
  await p.publicar({area:'time', nome:'pedidos'}, 'ana@exemplo.com');
  assert.equal(existsSync(path.join(pedidos, 'pedidos.resultado.json')), false);
  writeFileSync(path.join(pedidos, 'pedidos.resultado.json'), JSON.stringify({ok:false, erro:'A porta 8791 já está em uso.'}));
  await esperar();
  const e = await p.estado('pedidos');
  assert.equal(e.estado, 'erro');
  assert.match(e.erro, /porta/);
});

test('recusa nome inválido, app de outra área e app que está na config principal', async () => {
  const p = publicador();
  await assert.rejects(p.publicar({area:'time', nome:'../etc'}, 'a'), {status:400});
  await assert.rejects(p.publicar({area:'time', nome:'api'}, 'a'), {status:400});
  await assert.rejects(p.publicar({area:'outra', nome:'pedidos'}, 'a'), {status:404});
  await assert.rejects(p.publicar({area:'time', nome:'crm'}, 'a'), {status:409});
});

test('registro: pula arquivo ilegível e arquivo cujo prefixo não bate com o nome', () => {
  writeFileSync(path.join(registro, 'pedidos.json'), JSON.stringify({prefix:'/pedidos', port:8791}));
  writeFileSync(path.join(registro, 'outro.json'), JSON.stringify({prefix:'/crm', port:1}));
  writeFileSync(path.join(registro, 'ruim.json'), '{');
  assert.deepEqual(lerRegistro(registro).map(e => e.prefix), ['/pedidos']);
  assert.deepEqual(lerRegistro(path.join(raiz, 'nao-existe')), []);
});

test('juntar: a config principal ganha no prefixo repetido; entrada inválida fica de fora', () => {
  const logs = [];
  const r = juntarApps([{prefix:'/crm', port:8790}], [{prefix:'/crm', port:9}, {prefix:'/pedidos', port:8791}, {prefix:'/ruim', port:8792, segredo:'/nao/existe'}],
    {valido:e => normalizeApps([e], null), log:m => logs.push(m)});
  assert.deepEqual(r.map(a => [a.prefix, a.port]), [['/crm', 8790], ['/pedidos', 8791]]);
  assert.equal(logs.length, 2);
});

test('o gateway passa a repassar um app novo sem reiniciar (trocarApps)', async () => {
  const app = http.createServer((req, res) => res.end('app novo ' + req.url));
  await new Promise(r => app.listen(0, '127.0.0.1', r));
  const gateway = createGateway({hostname:'ratoeira.example.com', password:'TEST_ONLY_DAEMON_PASSWORD', access:{mode:'local', port:1, owner:'dono'}, apps:[]});
  await new Promise(r => gateway.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${gateway.address().port}`;
  try {
    const antes = await fetch(base + '/pedidos/', {headers:{host:'ratoeira.example.com'}});
    assert.notEqual(await antes.text(), 'app novo /pedidos/');
    gateway.trocarApps([{prefix:'/pedidos', port:app.address().port}]);
    const depois = await fetch(base + '/pedidos/');
    assert.equal(await depois.text(), 'app novo /pedidos/');
  } finally {
    gateway.closeAllConnections(); app.closeAllConnections();
    await Promise.all([gateway, app].map(s => new Promise(r => s.close(r))));
  }
});
