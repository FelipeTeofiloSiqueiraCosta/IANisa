import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import http from 'node:http';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {criarDitado,pedacos,decodificar} from '../ditado-local.mjs';

const TAXA=16000;
// tom de 440 Hz com um silêncio no meio, em webm/opus (como o Chrome grava)
function audio(segundos,{silencioEm=null}={}){
  const f=path.join(mkdtempSync(path.join(tmpdir(),'ditado-')),'a.webm');
  const filtro=silencioEm==null?`sine=f=440:d=${segundos}`:`sine=f=440:d=${segundos},volume='if(between(t,${silencioEm},${silencioEm+0.6}),0,1)':eval=frame`;
  execFileSync('ffmpeg',['-loglevel','error','-f','lavfi','-i',filtro,'-c:a','libopus','-b:a','32k','-y',f]);
  return execFileSync('cat',[f],{maxBuffer:1<<26});
}

test('ffmpeg decodifica webm em 16 kHz mono',async()=>{
  const a=await decodificar(audio(2));
  assert.ok(Math.abs(a.length/TAXA-2)<0.1,'duração '+a.length/TAXA);
  await assert.rejects(decodificar(Buffer.from('não é áudio')),e=>e.publico&&/Não consegui ler/.test(e.message));
});

test('fala longa corta nas pausas, sem pedaço maior que 28 s',()=>{
  const n=70*TAXA,a=new Float32Array(n).fill(0.5);
  a.fill(0,Math.round(23.5*TAXA),24*TAXA);a.fill(0,50*TAXA,Math.round(50.5*TAXA));
  const p=pedacos(a);
  assert.equal(p.reduce((s,x)=>s+x.length,0),n);
  assert.ok(p.every(x=>x.length<=28*TAXA));
  assert.ok(Math.abs(p[0].length/TAXA-23.75)<0.3,'primeiro corte na pausa: '+p[0].length/TAXA);
  assert.equal(pedacos(new Float32Array(5*TAXA)).length,1);
});

test('serviço: transcreve pela fila, um por vez, e sai quando fica parado',async t=>{
  const visto=[];let rodando=0,max=0;
  const motor={transcrever:async a=>{rodando++;max=Math.max(max,rodando);await new Promise(r=>setTimeout(r,50));rodando--;visto.push(a.length);return 'oi';}};
  let saiu=false;
  const d=criarDitado({motor,ociosoMin:0,aoOcioso:()=>{saiu=true;}});
  const sock=path.join(mkdtempSync(path.join(tmpdir(),'ditado-')),'d.sock');
  await new Promise(r=>d.server.listen(sock,r));t.after(()=>d.fechar());
  const pedir=(metodo,rota,corpo)=>new Promise((ok,no)=>{
    const r=http.request({socketPath:sock,path:rota,method:metodo},res=>{let b='';res.on('data',c=>b+=c);res.on('end',()=>ok({status:res.statusCode,dados:JSON.parse(b)}));});
    r.on('error',no);if(corpo)r.end(corpo);else r.end();
  });
  assert.deepEqual((await pedir('GET','/saude')).dados,{ok:true,carregado:false});
  const a=audio(3);
  const [r1,r2]=await Promise.all([pedir('POST','/transcrever',a),pedir('POST','/transcrever',a)]);
  assert.equal(r1.status,200);assert.equal(r1.dados.texto,'oi');assert.ok(r1.dados.segundos>=2.9);
  assert.equal(max,1,'um de cada vez');
  assert.equal((await pedir('POST','/transcrever',Buffer.alloc(0))).status,400);
  assert.equal((await pedir('POST','/transcrever',Buffer.from('lixo'))).status,400);
  assert.deepEqual((await pedir('GET','/saude')).dados,{ok:true,carregado:true});
});
