import test from 'node:test';
import {readFileSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {WebSocket} from 'ws';
import {createServidor,ehLimite,voltaDoLimite,cacheDaConversa,tituloDoHistorico,trechoDoPedido,limitesDe,limitesDoCodex,textoDaConversa} from '../servidor.mjs';

// o teste roda dentro de um agente da Ratoeira: a conta dele (pasta de config ou token) não pode vazar pros testes
delete process.env.CLAUDE_CONFIG_DIR;delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
const falso=fileURLToPath(new URL('./agente-falso.mjs',import.meta.url));
const agentes=new Map([['falso',{id:'falso',nome:'Falso',comando:process.execPath,args:[falso],env:{},modoAutomatico:'auto'}]]);

async function subir(t,opcoes={}){
  const s=createServidor({agentes,apertado:()=>false,arquivoTitulos:path.join(mkdtempSync(path.join(tmpdir(),'titulos-')),'titulos.json'),...opcoes});
  const sock=path.join(mkdtempSync(path.join(tmpdir(),'agentes-')),'a.sock');
  await new Promise(r=>s.server.listen(sock,r));
  t.after(()=>s.fechar());
  return {s,sock};
}
// cliente de teste: pedido → resposta, e guarda os eventos que chegam
async function cliente(t,sock,quem=null){
  const headers=quem?{'x-ratoeira-quem':Buffer.from(JSON.stringify(quem)).toString('base64url')}:{};
  const ws=new WebSocket(`ws+unix://${sock}:/ws`,{headers});await new Promise((r,e)=>{ws.on('open',r);ws.on('error',e);});
  t.after(()=>ws.close());
  let n=0;const espera=new Map();const eventos=[];const estados=[];const presencas=[];const digitandos=[];
  ws.on('message',d=>{const m=JSON.parse(d);if(m.t==='resposta')espera.get(m.id)?.(m);else if(m.t==='evento')eventos.push(m);else if(m.t==='estado')estados.push(m);else if(m.t==='presenca')presencas.push(m);else if(m.t==='digitando')digitandos.push(m);});
  const pedir=(op,dados={})=>new Promise((resolve,reject)=>{const id=++n;espera.set(id,m=>m.ok?resolve(m.dados):reject(new Error(m.erro)));ws.send(JSON.stringify({id,op,...dados}));});
  const ate=async(cond,ms=5000)=>{const fim=Date.now()+ms;while(!cond()){if(Date.now()>fim)throw new Error('não chegou');await new Promise(r=>setTimeout(r,20));}};
  return {ws,pedir,eventos,estados,presencas,digitandos,ate};
}
// POST no socket (como o gateway faz pra marcar conversa compartilhada)
async function postar(sock,caminho,corpo){
  const http=await import('node:http');
  return new Promise((ok,no)=>{const r=http.request({socketPath:sock,path:caminho,method:'POST',headers:{'content-type':'application/json'}},res=>{let d='';res.on('data',x=>d+=x);res.on('end',()=>ok({status:res.statusCode,corpo:JSON.parse(d||'{}')}));});r.on('error',no);r.end(JSON.stringify(corpo));});
}
const textos=(evs,tipo)=>evs.filter(e=>e.update.sessionUpdate===tipo).map(e=>e.update.content?.text);

test('conversa nova nasce no modo automático, responde e aparece na lista',async t=>{
  const {sock}=await subir(t);const c=await cliente(t,sock);
  assert.deepEqual(await c.pedir('agentes'),[{id:'falso',nome:'Falso'}]);
  const conv=await c.pedir('nova',{agente:'falso',cwd:'/tmp'});
  assert.equal(conv.config.modes.currentModeId,'auto');
  await c.pedir('assinar',{agente:'falso',sessao:conv.sessao,desde:0});
  await c.pedir('enviar',{agente:'falso',sessao:conv.sessao,texto:'oi'});
  await c.ate(()=>c.eventos.some(e=>e.update.sessionUpdate==='ratoeira_fim'));
  assert.deepEqual(textos(c.eventos,'user_message_chunk'),['oi']);
  assert.deepEqual(textos(c.eventos,'agent_message_chunk'),['eco: oi']);
  assert.ok(c.estados.some(e=>e.estado==='rodando')&&c.estados.at(-1).estado==='livre');
  const lista=await c.pedir('listar',{});
  assert.ok(lista.some(x=>x.sessao===conv.sessao&&x.titulo));
});

// 28/10/2026 (reporte 36): a pasta da área sumiu e o Claude, que recusa pasta inexistente, saía da conversa nova
test('pasta que não existe: opções saem da home, e conversa nova dá um aviso que a pessoa entende',async t=>{
  const {sock}=await subir(t);const c=await cliente(t,sock);
  const sumiu=path.join(mkdtempSync(path.join(tmpdir(),'area-')),'nao-existe');
  assert.ok(Array.isArray((await c.pedir('opcoes',{agente:'falso',cwd:sumiu})).configOptions));
  await assert.rejects(c.pedir('nova',{agente:'falso',cwd:sumiu}),/A pasta .*nao-existe não existe mais/);
});

test('pedido de permissão fica guardado até alguém responder, inclusive outro navegador',async t=>{
  const {sock}=await subir(t);const a=await cliente(t,sock);
  const conv=await a.pedir('nova',{agente:'falso',cwd:'/tmp'});
  await a.pedir('assinar',{agente:'falso',sessao:conv.sessao,desde:0});
  await a.pedir('enviar',{agente:'falso',sessao:conv.sessao,texto:'pode apagar? permissão'});
  await a.ate(()=>a.eventos.some(e=>e.update.sessionUpdate==='ratoeira_pedido'));
  a.ws.close();
  // outro navegador abre depois e vê o pedido pendente
  const b=await cliente(t,sock);
  const aberta=await b.pedir('abrir',{agente:'falso',sessao:conv.sessao,cwd:'/tmp'});
  assert.equal(aberta.estado,'esperando');assert.equal(aberta.pedidos.length,1);
  await assert.rejects(b.pedir('permitir',{agente:'falso',sessao:conv.sessao,pedido:aberta.pedidos[0].pedido,opcao:'inventada'}),/inválida/);
  await b.pedir('assinar',{agente:'falso',sessao:conv.sessao,desde:0});
  await b.pedir('permitir',{agente:'falso',sessao:conv.sessao,pedido:aberta.pedidos[0].pedido,opcao:'sim'});
  await b.ate(()=>b.eventos.some(e=>e.update.sessionUpdate==='ratoeira_fim'));
  assert.ok(textos(b.eventos,'agent_message_chunk').includes('resposta: sim'));
  // recebeu de novo tudo desde o começo, inclusive a pergunta
  assert.deepEqual(textos(b.eventos,'user_message_chunk'),['pode apagar? permissão']);
});

// 20/10/2026: o pedido do fundo deixava a conversa "rodando" pra sempre; a mensagem seguinte tentava entrar num turno
// que não existia, sem parar e com a trava presa, e abrir a conversa ficava em "Carregando a conversa…"
test('pedido de permissão do fundo, sem turno aberto: respondido volta pra livre, e a próxima mensagem sai normal',async t=>{
  const {sock}=await subir(t);const c=await cliente(t,sock);
  const conv=await c.pedir('nova',{agente:'falso',cwd:'/tmp'});
  await c.pedir('assinar',{agente:'falso',sessao:conv.sessao,desde:0});
  await c.pedir('enviar',{agente:'falso',sessao:conv.sessao,texto:'pedir no fundo'});
  await c.ate(()=>c.eventos.some(e=>e.update.sessionUpdate==='ratoeira_pedido'));
  const aberta=await c.pedir('abrir',{agente:'falso',sessao:conv.sessao,cwd:'/tmp'});
  assert.equal(aberta.estado,'esperando');
  await c.pedir('permitir',{agente:'falso',sessao:conv.sessao,pedido:aberta.pedidos[0].pedido,opcao:'sim'});
  await c.ate(()=>textos(c.eventos,'agent_message_chunk').includes('fundo: sim'));
  assert.equal(c.estados.filter(e=>e.sessao===conv.sessao).at(-1).estado,'livre');
  // a próxima é mensagem normal (com resposta e fim), não uma tentativa de entrar num turno que não existe
  const fins=()=>c.eventos.filter(e=>e.update.sessionUpdate==='ratoeira_fim').length,antes=fins();
  await c.pedir('enviar',{agente:'falso',sessao:conv.sessao,texto:'oi'});
  await c.ate(()=>fins()>antes&&textos(c.eventos,'agent_message_chunk').includes('eco: oi'));
  assert.equal((await c.pedir('abrir',{agente:'falso',sessao:conv.sessao,cwd:'/tmp'})).estado,'livre');
});

test('pedido do fundo pendente: mensagem nova sai como turno, e Parar tira do "esperando"',async t=>{
  const {sock}=await subir(t);const c=await cliente(t,sock);
  const conv=await c.pedir('nova',{agente:'falso',cwd:'/tmp'});
  await c.pedir('assinar',{agente:'falso',sessao:conv.sessao,desde:0});
  await c.pedir('enviar',{agente:'falso',sessao:conv.sessao,texto:'pedir no fundo'});
  await c.ate(()=>c.eventos.some(e=>e.update.sessionUpdate==='ratoeira_pedido'));
  await c.pedir('enviar',{agente:'falso',sessao:conv.sessao,texto:'e aí'});
  await c.ate(()=>textos(c.eventos,'agent_message_chunk').includes('eco: e aí'));
  assert.ok(!c.eventos.some(e=>e.update.ratoeira_durante),'não entrou como mensagem no meio do turno');
  // o fim do turno cancela o que ficou pendente, como sempre fez, e a conversa fica livre
  await c.ate(()=>textos(c.eventos,'agent_message_chunk').includes('fundo: cancelado'));
  assert.equal((await c.pedir('abrir',{agente:'falso',sessao:conv.sessao,cwd:'/tmp'})).estado,'livre');
  // de novo, e agora Parar: sem turno nosso, é ele que tira do "esperando"
  await c.pedir('enviar',{agente:'falso',sessao:conv.sessao,texto:'pedir no fundo'});
  await c.ate(()=>c.eventos.filter(e=>e.update.sessionUpdate==='ratoeira_pedido').length===2);
  assert.equal((await c.pedir('abrir',{agente:'falso',sessao:conv.sessao,cwd:'/tmp'})).estado,'esperando');
  await c.pedir('cancelar',{agente:'falso',sessao:conv.sessao});
  await c.ate(()=>textos(c.eventos,'agent_message_chunk').filter(x=>x==='fundo: cancelado').length===2);
  assert.equal((await c.pedir('abrir',{agente:'falso',sessao:conv.sessao,cwd:'/tmp'})).estado,'livre');
});

test('parar no meio, e agente sem steering não aceita mensagem enquanto responde',async t=>{
  const velho=new Map([['falso',{...agentes.get('falso'),env:{FALSO_SEM_STEERING:'1'}}]]);
  const {sock}=await subir(t,{agentes:velho});const c=await cliente(t,sock);
  const conv=await c.pedir('nova',{agente:'falso',cwd:'/tmp'});
  await c.pedir('assinar',{agente:'falso',sessao:conv.sessao,desde:0});
  await c.pedir('enviar',{agente:'falso',sessao:conv.sessao,texto:'demorar'});
  await assert.rejects(c.pedir('enviar',{agente:'falso',sessao:conv.sessao,texto:'outra'}),/respondendo/);
  await c.pedir('cancelar',{agente:'falso',sessao:conv.sessao});
  await c.ate(()=>c.eventos.some(e=>e.update.sessionUpdate==='ratoeira_fim'&&e.update.stopReason==='cancelled'));
});

test('limite do plano: vira aviso com a hora que volta, sem o texto em inglês nem o erro de trás',async t=>{
  const agora=Date.UTC(2026,9,10,13,0);
  const {sock}=await subir(t,{agora:()=>agora});const c=await cliente(t,sock);
  const conv=await c.pedir('nova',{agente:'falso',cwd:'/tmp'});
  await c.pedir('assinar',{agente:'falso',sessao:conv.sessao,desde:0});
  await c.pedir('enviar',{agente:'falso',sessao:conv.sessao,texto:'limite'});
  await c.ate(()=>c.eventos.some(e=>e.update.sessionUpdate==='ratoeira_fim'));
  const aviso=c.eventos.find(e=>e.update.sessionUpdate==='ratoeira_limite')?.update;
  assert.equal(aviso.agente,'Falso');assert.equal(aviso.volta,Date.UTC(2026,9,10,15,0));
  assert.deepEqual(textos(c.eventos,'agent_message_chunk'),[]);
  assert.ok(!c.eventos.some(e=>e.update.sessionUpdate==='ratoeira_erro'));
});

test('hora que o limite volta: formatos do Claude e do Codex, fuso, data e dia seguinte',()=>{
  const agora=Date.UTC(2026,9,10,13,0);   // 10/10 13:00 UTC
  const v=(t,fuso='UTC')=>voltaDoLimite(t,{agora,fuso});
  assert.equal(v("You've hit your limit · resets 3pm (UTC)"),Date.UTC(2026,9,10,15,0));
  assert.equal(v("You've hit your session limit · resets 3:30pm"),Date.UTC(2026,9,10,15,30));
  assert.equal(v("You've hit your limit · resets 9am (UTC)"),Date.UTC(2026,9,11,9,0));          // já passou hoje: amanhã
  assert.equal(v("You've hit your weekly limit · resets Oct 14, 3pm (UTC)"),Date.UTC(2026,9,14,15,0));
  assert.equal(v("You've hit your limit · resets 3pm (America/Sao_Paulo)"),Date.UTC(2026,9,10,18,0));
  assert.equal(v("You've hit your usage limit. Upgrade to Pro (https://chatgpt.com/explore/pro) or try again at 3:05 PM."),Date.UTC(2026,9,10,15,5));
  assert.equal(v("You've hit your usage limit. Try again at Oct 12th, 2026 3:05 PM."),Date.UTC(2026,9,12,15,5));
  assert.equal(v("You've hit your usage limit. Try again at 15:05 on 12 Oct 2026."),Date.UTC(2026,9,12,15,5));
  assert.equal(v("You've hit your limit"),null);
  assert.ok(ehLimite("You've hit your limit · resets 3pm (UTC)")&&ehLimite("You've hit your usage limit. Try again at 3:05 PM."));
  assert.ok(!ehLimite('Você bateu o limite? Não sei.')&&!ehLimite("You've hit your stride today")&&!ehLimite(undefined));
});

test('uso do plano: limites de 5 h e da semana chegam no fim da resposta e ficam guardados pra próxima conversa',async t=>{
  const dir=mkdtempSync(path.join(tmpdir(),'titulos-'));
  const {sock}=await subir(t,{arquivoTitulos:path.join(dir,'titulos.json')});const c=await cliente(t,sock);
  const conv=await c.pedir('nova',{agente:'falso',cwd:'/tmp'});
  await c.pedir('assinar',{agente:'falso',sessao:conv.sessao,desde:0});
  await c.pedir('enviar',{agente:'falso',sessao:conv.sessao,texto:'limites?'});
  await c.ate(()=>c.eventos.some(e=>e.update.sessionUpdate==='ratoeira_uso'));
  const uso=c.eventos.find(e=>e.update.sessionUpdate==='ratoeira_uso').update;
  assert.deepEqual({cinco:uso.limites.cinco,semana:uso.limites.semana},{cinco:{uso:0.86,volta:1791618000e3},semana:{uso:0.08,volta:1791759600e3}});
  assert.equal(JSON.parse(readFileSync(path.join(dir,'limites.json'),'utf8')).falso.cinco.uso,0.86);
  const outra=await c.pedir('nova',{agente:'falso',cwd:'/tmp'});
  await c.pedir('assinar',{agente:'falso',sessao:outra.sessao,desde:0});
  await c.pedir('enviar',{agente:'falso',sessao:outra.sessao,texto:'oi'});
  await c.ate(()=>c.eventos.filter(e=>e.update.sessionUpdate==='ratoeira_uso').length===2);
  assert.equal(c.eventos.filter(e=>e.update.sessionUpdate==='ratoeira_uso').at(-1).update.limites.semana.uso,0.08);
});

test('cache da conversa: última resposta da conversa principal + 1 h (ou 5 min), lido do histórico do Claude',()=>{
  const home=mkdtempSync(path.join(tmpdir(),'home-'));
  const pasta=path.join(home,'.claude','projects','-srv-areas-time');mkdirSync(pasta,{recursive:true});
  const msg=(ts,extra={},cc={ephemeral_1h_input_tokens:500})=>JSON.stringify({type:'assistant',timestamp:ts,message:{model:'claude-opus-5-5',usage:{input_tokens:1,cache_creation:cc}},...extra});
  escrever(path.join(pasta,'abc.jsonl'),[
    msg('2026-10-10T10:00:00Z'),
    JSON.stringify({type:'user',timestamp:'2026-10-10T10:05:00Z',message:{content:'oi'}}),
    msg('2026-10-10T10:06:00Z',{},{}),                                          // só leu do cache: o prazo vem da anterior
    msg('2026-10-10T10:07:00Z',{isSidechain:true},{ephemeral_5m_input_tokens:9}), // subagente não conta
    JSON.stringify({type:'assistant',timestamp:'2026-10-10T10:08:00Z',message:{model:'<synthetic>',usage:{}}}),
    'linha torta',''].join('\n'));
  assert.deepEqual(cacheDaConversa(home,'/srv/areas/time','abc'),{ate:Date.parse('2026-10-10T10:06:00Z')+3600e3,ttl:3600e3});
  assert.deepEqual(cacheDaConversa(home,'/outra/pasta','abc'),{ate:Date.parse('2026-10-10T10:06:00Z')+3600e3,ttl:3600e3}); // acha em outra pasta
  escrever(path.join(pasta,'cinco.jsonl'),msg('2026-10-10T10:00:00Z',{},{ephemeral_5m_input_tokens:10})+'\n');
  assert.equal(cacheDaConversa(home,'/srv/areas/time','cinco').ttl,300e3);
  assert.equal(cacheDaConversa(home,'/srv/areas/time','nao-tem'),null);
  assert.equal(cacheDaConversa(home,'/srv/areas/time','../../etc/passwd'),null);
  assert.equal(limitesDe({status:'allowed'}),null);
});

test('nome da conversa pro aviso: o do /rename vence o do Claude; sem nome, o começo do pedido',()=>{
  const home=mkdtempSync(path.join(tmpdir(),'home-'));
  const pasta=path.join(home,'.claude','projects','-srv-areas-time');mkdirSync(pasta,{recursive:true});
  const ai=t=>JSON.stringify({type:'ai-title',aiTitle:t,sessionId:'abc'});
  escrever(path.join(pasta,'abc.jsonl'),[ai('Velho'),JSON.stringify({type:'user',message:{content:'oi'}}),ai('Onboarding da Ratoeira'),''].join('\n'));
  assert.equal(tituloDoHistorico(home,'/srv/areas/time','abc'),'Onboarding da Ratoeira');
  escrever(path.join(pasta,'abc.jsonl'),[ai('Onboarding'),JSON.stringify({type:'custom-title',customTitle:'Meu nome',sessionId:'abc'}),ai('Depois'),''].join('\n'));
  assert.equal(tituloDoHistorico(home,'/srv/areas/time','abc'),'Meu nome');
  escrever(path.join(pasta,'sem.jsonl'),JSON.stringify({type:'user',message:{content:'oi'}})+'\n');
  assert.equal(tituloDoHistorico(home,'/srv/areas/time','sem'),null);
  assert.equal(tituloDoHistorico(home,'/srv/areas/time','nao-tem'),null);
  assert.equal(trechoDoPedido('<ratoeira-contexto>tela X</ratoeira-contexto>\n  arruma   o aviso'),'arruma o aviso');
  assert.equal(trechoDoPedido('a'.repeat(100)),'a'.repeat(59)+'…');
  assert.equal(trechoDoPedido('  '),null);
});

test('limites do Codex: lidos do arquivo da conversa (token_count), janela de 5 h e da semana, plano',()=>{
  const sessoes=path.join(mkdtempSync(path.join(tmpdir(),'codex-')),'sessions');
  const id='01a15c79-e8b4-70b3-952a-292b70d2b579';                 // UUID v7: nasceu em 21/10/2026 03:20 UTC
  const nasceu=new Date(parseInt(id.replace(/-/g,'').slice(0,12),16));
  const dir=path.join(sessoes,String(nasceu.getFullYear()),String(nasceu.getMonth()+1).padStart(2,'0'),String(nasceu.getDate()).padStart(2,'0'));
  mkdirSync(dir,{recursive:true});
  const tc=rl=>JSON.stringify({timestamp:'2026-10-21T03:21:13Z',type:'event_msg',payload:{type:'token_count',info:{},rate_limits:rl}});
  escrever(path.join(dir,`rollout-2026-10-21T03-20-55-${id}.jsonl`),[
    JSON.stringify({type:'session_meta',payload:{id}}),
    tc({primary:{used_percent:50,window_minutes:300,resets_at:1793000000},secondary:{used_percent:9,window_minutes:10080,resets_at:1793095252},plan_type:'plus'}),
    tc({primary:{used_percent:62.5,window_minutes:300,resets_at:1793000000},secondary:{used_percent:10,window_minutes:10080,resets_at:1793095252},plan_type:'plus'}),
    JSON.stringify({type:'event_msg',payload:{type:'token_count',info:{},rate_limits:null}}),   // sem limites: vale a anterior
    'linha torta',''].join('\n'));
  assert.deepEqual(limitesDoCodex(sessoes,id),{cinco:{uso:0.625,volta:1793000000e3},semana:{uso:0.1,volta:1793095252e3},plano:'plus'});
  // plano só com a janela da semana (o Pro Lite): sem a de 5 h
  const id2='01a15c79-a7e4-7090-80ac-d6cf1c18731c';
  escrever(path.join(dir,`rollout-2026-10-21T03-20-39-${id2}.jsonl`),tc({primary:{used_percent:1,window_minutes:10080,resets_at:1793095252},secondary:null,plan_type:'prolite'})+'\n');
  assert.deepEqual(limitesDoCodex(sessoes,id2),{semana:{uso:0.01,volta:1793095252e3},plano:'prolite'});
  assert.equal(limitesDoCodex(sessoes,'01a15c79-0000-7000-8000-000000000000'),null);
  assert.equal(limitesDoCodex(sessoes,'../../etc/passwd'),null);
});

test('agente sem conta: o erro do turno vem marcado pra tela levar pra Contas de IA',async t=>{
  const {sock}=await subir(t);const c=await cliente(t,sock);
  const conv=await c.pedir('nova',{agente:'falso',cwd:'/tmp'});
  await c.pedir('assinar',{agente:'falso',sessao:conv.sessao,desde:0});
  await c.pedir('enviar',{agente:'falso',sessao:conv.sessao,texto:'sem-login'});
  await c.ate(()=>c.eventos.some(e=>e.update.sessionUpdate==='ratoeira_erro'));
  const erro=c.eventos.find(e=>e.update.sessionUpdate==='ratoeira_erro').update;
  assert.equal(erro.motivo,'login');
  // a conversa segue: conectada a conta, é só mandar de novo
  await new Promise(r=>setTimeout(r,100));
  await c.pedir('enviar',{agente:'falso',sessao:conv.sessao,texto:'oi'});
  await c.ate(()=>c.eventos.some(e=>e.update.sessionUpdate==='ratoeira_fim'));
});

test('agente que cai no meio: avisa, e abrir de novo retoma pelo histórico dele',async t=>{
  const {sock}=await subir(t);const c=await cliente(t,sock);
  const conv=await c.pedir('nova',{agente:'falso',cwd:'/tmp'});
  await c.pedir('assinar',{agente:'falso',sessao:conv.sessao,desde:0});
  await c.pedir('enviar',{agente:'falso',sessao:conv.sessao,texto:'morrer'});
  await c.ate(()=>c.eventos.some(e=>e.update.sessionUpdate==='ratoeira_erro'));
  assert.equal(c.eventos.find(e=>e.update.sessionUpdate==='ratoeira_erro').update.motivo,undefined,'erro que não é de conta segue sem marca');
  await assert.rejects(c.pedir('enviar',{agente:'falso',sessao:conv.sessao,texto:'oi'}),/Abra a conversa/);
  // processo novo do agente: a sessão do falso não existe mais nele, então ele repete "antiga"
  const aberta=await c.pedir('abrir',{agente:'falso',sessao:conv.sessao,cwd:'/tmp'});
  assert.equal(aberta.estado,'livre');
  assert.equal(aberta.titulo,'conversa '+conv.sessao,'reaberta sem título: pergunta pro agente');
});

test('pedido malformado não derruba e opção do agente muda',async t=>{
  const {sock}=await subir(t);const c=await cliente(t,sock);
  c.ws.send('não é json');
  await assert.rejects(c.pedir('nada'),/desconhecido/);
  await assert.rejects(c.pedir('nova',{agente:'falso',cwd:'relativo'}),/pasta/);
  await assert.rejects(c.pedir('nova',{agente:'outro',cwd:'/tmp'}),/agente/i);
  const conv=await c.pedir('nova',{agente:'falso',cwd:'/tmp'});
  await assert.rejects(c.pedir('enviar',{agente:'falso',sessao:conv.sessao,texto:'  '}),/vazia/);
  const r=await c.pedir('opcao',{agente:'falso',sessao:conv.sessao,opcao:'model',valor:'b'});
  assert.equal(r.config.configOptions[0].currentValue,'b');
});

test('sai sozinho só sem ninguém conectado e sem nada rodando',async t=>{
  let relogio=0;const {s,sock}=await subir(t,{ociosoMin:1,agora:()=>relogio});
  const c=await cliente(t,sock);
  relogio=120000;assert.equal(s.podeSair(),false);   // tem gente conectada
  c.ws.close();await c.ate(()=>s.estado().clientes===0);
  relogio=300000;assert.equal(s.podeSair(),true);
});

import {mcpValidos} from '../servidor.mjs';
test('ferramentas MCP: só HTTP nesta máquina, com cabeçalho limpo',()=>{
  const ok=mcpValidos([{type:'http',name:'pedidos',url:'http://127.0.0.1:8790/mcp',headers:[{name:'Authorization',value:'Bearer abc'}]}]);
  assert.equal(ok[0].url,'http://127.0.0.1:8790/mcp');
  assert.deepEqual(mcpValidos(undefined),[]);
  for(const ruim of [[{type:'stdio',name:'x',command:'sh'}],[{type:'http',name:'x',url:'http://evil.com/mcp'}],[{type:'http',name:'x',url:'https://127.0.0.1/mcp'}],
    [{type:'http',name:'x',url:'http://127.0.0.1/mcp',headers:[{name:'A',value:'b\r\nc'}]}],'nada',new Array(6).fill({type:'http',name:'x',url:'http://127.0.0.1/'})])
    assert.throws(()=>mcpValidos(ruim),/inválidas/);
});

test('opções antes de existir conversa, conversa nova já com escolha e mensagem, e abrir sem saber a pasta',async t=>{
  const {sock}=await subir(t);const c=await cliente(t,sock);
  const op=await c.pedir('opcoes',{agente:'falso',cwd:'/tmp'});
  assert.equal(op.configOptions[0].id,'model');
  const conv=await c.pedir('nova',{agente:'falso',cwd:'/tmp',opcoes:{model:'b'},texto:'primeira'});
  assert.equal(conv.config.configOptions[0].currentValue,'b');
  await c.pedir('assinar',{agente:'falso',sessao:conv.sessao,desde:0});
  await c.ate(()=>c.eventos.some(e=>e.update.sessionUpdate==='ratoeira_fim'));
  assert.deepEqual(textos(c.eventos,'agent_message_chunk'),['eco: primeira']);
  // quem abre a conversa recebe na reprise, por último, o modelo escolhido (não o aviso velho do agente)
  const ultimaConfig=()=>c.eventos.filter(e=>e.update.sessionUpdate==='config_option_update').at(-1)?.update.configOptions[0].currentValue;
  assert.equal(ultimaConfig(),'b');
  // trocar na conversa aberta também avisa (outras abas e a reprise de quem abrir depois)
  await c.pedir('opcao',{agente:'falso',sessao:conv.sessao,opcao:'model',valor:'a'});
  await c.ate(()=>ultimaConfig()==='a');
  // a lista diz o estado e os pedidos de cada conversa
  const l=await c.pedir('listar',{});assert.deepEqual(l.find(x=>x.sessao===conv.sessao).pedidos,[]);
});

test('comandos do `/`: a conversa guarda a lista que o agente anuncia, e a conversa nova usa a última vista',async t=>{
  const {sock}=await subir(t);const c=await cliente(t,sock);
  assert.deepEqual(await c.pedir('comandos',{agente:'falso'}),[]);
  await c.pedir('opcoes',{agente:'falso',cwd:'/tmp'});
  let lista=[];for(let i=0;i<100&&!lista.length;i++){await new Promise(r=>setTimeout(r,20));lista=await c.pedir('comandos',{agente:'falso'});}
  assert.deepEqual(lista.map(x=>x.name),['ajuda','minha-skill']);
  const conv=await c.pedir('nova',{agente:'falso',cwd:'/tmp'});
  await c.pedir('assinar',{agente:'falso',sessao:conv.sessao,desde:0});
  await c.ate(()=>c.eventos.some(e=>e.update.sessionUpdate==='available_commands_update'));
  // quem abre depois recebe a lista no resumo, mesmo se o evento já tiver saído da fila
  const de_novo=await c.pedir('abrir',{agente:'falso',sessao:conv.sessao});
  assert.equal(de_novo.comandos[1].input.hint,'conta');
  await assert.rejects(c.pedir('comandos',{agente:'outro'}),/Agente desconhecido/);
});

test('mensagem com imagem colada e arquivo citado: chega ao agente, a imagem aparece na tela, e formato torto é recusado',async t=>{
  const {sock}=await subir(t);const c=await cliente(t,sock);
  const img={type:'image',mimeType:'image/png',data:'iVBORw0KGgo='};const link={type:'resource_link',uri:'file:///tmp/a.md',name:'a.md'};
  const conv=await c.pedir('nova',{agente:'falso',cwd:'/tmp',blocos:[{type:'text',text:'tipos? @a.md'},img,link]});
  await c.pedir('assinar',{agente:'falso',sessao:conv.sessao,desde:0});
  await c.ate(()=>c.eventos.some(e=>e.update.sessionUpdate==='ratoeira_fim'));
  assert.deepEqual(textos(c.eventos,'agent_message_chunk'),['tipos: text,image,resource_link']);
  assert.deepEqual(c.eventos.filter(e=>e.update.sessionUpdate==='user_message_chunk').map(e=>e.update.content.type),['text','image']);
  await assert.rejects(c.pedir('enviar',{agente:'falso',sessao:conv.sessao,blocos:[{type:'image',mimeType:'image/svg+xml',data:'x'}]}),/formato/);
  await assert.rejects(c.pedir('nova',{agente:'falso',cwd:'/tmp',blocos:[]}),/formato/);
});

test('pergunta com opções: chega como pedido, a resposta volta pro agente só com os campos do formulário, e responder duas vezes é recusado',async t=>{
  const {sock}=await subir(t);const c=await cliente(t,sock);
  const conv=await c.pedir('nova',{agente:'falso',cwd:'/tmp',texto:'pergunta?'});
  await c.pedir('assinar',{agente:'falso',sessao:conv.sessao,desde:0});
  await c.ate(()=>c.eventos.some(e=>e.update.sessionUpdate==='ratoeira_pergunta'));
  const ev=c.eventos.find(e=>e.update.sessionUpdate==='ratoeira_pergunta').update;
  assert.equal(ev.message,'Qual cor?');assert.equal(ev.requestedSchema.properties.question_0.oneOf[1].const,'Verde');
  // quem abre depois vê a pergunta pendente
  assert.equal((await c.pedir('abrir',{agente:'falso',sessao:conv.sessao})).pedidos[0].tipo,'pergunta');
  await assert.rejects(c.pedir('permitir',{agente:'falso',sessao:conv.sessao,pedido:ev.pedido,opcao:'x'}),/respondido/);
  await assert.rejects(c.pedir('responder',{agente:'falso',sessao:conv.sessao,pedido:ev.pedido,resposta:{action:'accept',content:[]}}),/inválida/);
  await c.pedir('responder',{agente:'falso',sessao:conv.sessao,pedido:ev.pedido,resposta:{action:'accept',content:{question_0:'Verde',intruso:'x'}}});
  await c.ate(()=>c.eventos.some(e=>e.update.sessionUpdate==='ratoeira_fim'));
  assert.deepEqual(textos(c.eventos,'agent_message_chunk'),['resposta: accept {"question_0":"Verde"}']);
  await assert.rejects(c.pedir('responder',{agente:'falso',sessao:conv.sessao,pedido:ev.pedido,resposta:{action:'cancel'}}),/respondida/);
});

test('mensagem com a conversa rodando entra no turno em andamento, e o turno segue até o fim',async t=>{
  const {sock}=await subir(t);const c=await cliente(t,sock);
  const conv=await c.pedir('nova',{agente:'falso',cwd:'/tmp',texto:'demorar'});
  await c.pedir('assinar',{agente:'falso',sessao:conv.sessao,desde:0});
  await c.ate(()=>c.estados.some(e=>e.estado==='rodando'));
  await c.pedir('enviar',{agente:'falso',sessao:conv.sessao,texto:'e mais isso'});
  await c.ate(()=>textos(c.eventos,'agent_message_chunk').some(t=>t.startsWith('li no meio: e mais isso')));
  assert.match(textos(c.eventos,'agent_message_chunk').find(t=>t.startsWith('li no meio')),/<ratoeira-durante>.*não no raciocínio/,'o agente recebe o pedido pra responder em texto');
  assert.ok(c.eventos.some(e=>e.update.sessionUpdate==='user_message_chunk'&&e.update.content.text==='e mais isso'),'aparece na tela');
  assert.ok(!c.eventos.some(e=>e.update.sessionUpdate==='user_message_chunk'&&e.update.content.text?.includes('ratoeira-durante')),'a marca não vai pra tela');
  await c.pedir('enviar',{agente:'falso',sessao:conv.sessao,texto:'termina'});
  await c.ate(()=>c.eventos.some(e=>e.update.sessionUpdate==='ratoeira_fim'));
  assert.equal(c.eventos.find(e=>e.update.sessionUpdate==='ratoeira_fim').update.stopReason,'end_turn');
});

// Conexões: login e status da conta da pessoa, por HTTP no mesmo socket (no lugar do terminal do Paseo).
import http from 'node:http';
import {spawn} from 'node:child_process';
import {mkdirSync,statSync,existsSync,writeFileSync as escrever} from 'node:fs';
const claudeFalso=fileURLToPath(new URL('./claude-falso.sh',import.meta.url));
const runner=fileURLToPath(new URL('../../gateway/login-runner.py',import.meta.url));
function pedirHttp(sock,metodo,caminho,corpo){
  return new Promise((resolve,reject)=>{
    const req=http.request({socketPath:sock,method:metodo,path:caminho},res=>{let d='';res.on('data',c=>d+=c);res.on('end',()=>resolve({status:res.statusCode,corpo:d}));});
    req.on('error',reject);req.end(corpo);
  });
}
async function subirContas(t,extra={}){
  const home=mkdtempSync(path.join(tmpdir(),'home-'));
  // contas gerais e grupos de mentira: sem isso, valem os de verdade da máquina (o token geral em /etc/ratoeira)
  const r=await subir(t,{contas:{clis:{claude:claudeFalso,codex:null},runner,python:'python3',home,geralFixa:false,grupos:[],
    geralClaude:path.join(home,'sem-geral.token'),orgClaude:path.join(home,'sem-org'),geralCodex:path.join(home,'sem-geral-codex.json'),orgCodex:path.join(home,'sem-org-codex'),...extra}});
  return {...r,home};
}

test('status da conta: sem login, com a geral no ambiente, e o login próprio passa na frente da geral',async t=>{
  const {sock,home}=await subirContas(t);
  let r=JSON.parse((await pedirHttp(sock,'GET','/conta/claude/status')).corpo);
  assert.equal(r.code,0);assert.equal(JSON.parse(r.stdout).loggedIn,false);
  assert.equal(JSON.parse((await pedirHttp(sock,'GET','/conta/codex/status')).corpo).missing,true);
  process.env.CLAUDE_CODE_OAUTH_TOKEN='sk-ant-oat01-teste';t.after(()=>delete process.env.CLAUDE_CODE_OAUTH_TOKEN);
  r=JSON.parse((await pedirHttp(sock,'GET','/conta/claude/status')).corpo);
  assert.equal(JSON.parse(r.stdout).authMethod,'oauth_token');
  // arquivo só com login de MCP não é conta própria: a geral continua valendo
  mkdirSync(path.join(home,'.claude'));escrever(path.join(home,'.claude','.credentials.json'),'{"mcpOAuth":{}}');
  r=JSON.parse((await pedirHttp(sock,'GET','/conta/claude/status')).corpo);
  assert.equal(JSON.parse(r.stdout).authMethod,'oauth_token');
  escrever(path.join(home,'.claude','.credentials.json'),'{"mcpOAuth":{},"claudeAiOauth":{}}');
  r=JSON.parse((await pedirHttp(sock,'GET','/conta/claude/status')).corpo);
  assert.equal(JSON.parse(r.stdout).email,'pessoa@exemplo.com');
});

test('login da conta: mostra o link, recebe o código, termina e só deixa um por vez',async t=>{
  const {s,sock,home}=await subirContas(t);
  process.env.CLAUDE_CODE_OAUTH_TOKEN='sk-ant-oat01-teste';t.after(()=>delete process.env.CLAUDE_CODE_OAUTH_TOKEN);
  const linhas=[];let fluxo;
  const fim=new Promise((resolve,reject)=>{
    const req=http.request({socketPath:sock,method:'POST',path:'/conta/claude/login'},res=>{
      let resto='';
      res.on('data',d=>{resto+=d;let i;while((i=resto.indexOf('\n'))>=0){const o=JSON.parse(resto.slice(0,i));resto=resto.slice(i+1);linhas.push(o);if(o.fluxo)fluxo=o.fluxo;}});
      res.on('end',resolve);
    });req.on('error',reject);req.end();
  });
  const ate=async cond=>{const lim=Date.now()+5000;while(!cond()){if(Date.now()>lim)throw new Error('não chegou');await new Promise(r=>setTimeout(r,20));}};
  await ate(()=>linhas.some(l=>l.saida?.includes('Paste code')));
  assert.equal(s.estado().ocupado,true);
  assert.equal((await pedirHttp(sock,'POST','/conta/claude/login')).status,409);
  assert.equal((await pedirHttp(sock,'POST','/conta/fluxo/00000000-0000-0000-0000-000000000000/entrada','x')).status,404);
  assert.equal((await pedirHttp(sock,'POST',`/conta/fluxo/${fluxo}/entrada`,'codigo-123')).status,204);
  assert.equal((await pedirHttp(sock,'POST',`/conta/fluxo/${fluxo}/entrada`,'\r')).status,204);
  await fim;
  assert.equal(linhas.at(-1).fim,0);
  assert.ok(linhas.map(l=>l.saida??'').join('').includes('Login ok (codigo-123)'));
  assert.equal(s.estado().ocupado,false);
  // conectou a própria: a geral sai do ambiente pras conversas novas
  assert.equal(process.env.CLAUDE_CODE_OAUTH_TOKEN,undefined);
  assert.ok(home);
});

test('Codex na conta geral: status avisa, e o login pessoal apaga o atalho antes (não escreve na geral)',async t=>{
  const codexFalso=path.join(mkdtempSync(path.join(tmpdir(),'cx-')),'codex');
  escrever(codexFalso,'#!/bin/sh\ncase "$1" in login) [ "$2" = status ] && { echo "Logged in using ChatGPT"; exit 0; }; [ -L "$HOME/.codex/auth.json" ] && exit 4; echo "https://auth.openai.com/codex/device ABCD-1234"; exit 0;; esac\n',{mode:0o755});
  const {sock,home}=await subirContas(t,{clis:{claude:claudeFalso,codex:codexFalso}});
  const geral=path.join(home,'geral.json');escrever(geral,'{"geral":1}');
  mkdirSync(path.join(home,'.codex'));(await import('node:fs')).symlinkSync(geral,path.join(home,'.codex','auth.json'));
  assert.equal(JSON.parse((await pedirHttp(sock,'GET','/conta/codex/status')).corpo).geral,true);
  const r=await pedirHttp(sock,'POST','/conta/codex/login');
  assert.equal(JSON.parse(r.corpo.trim().split('\n').at(-1)).fim,0);
  assert.equal(readFileSync(geral,'utf8'),'{"geral":1}');
  assert.equal(JSON.parse((await pedirHttp(sock,'GET','/conta/codex/status')).corpo).geral,undefined);
});

test('desconectar a própria: Claude tira só o login dele (MCPs ficam) e volta pra geral; Codex passa pra conta da organização',async t=>{
  const fs=await import('node:fs');
  const dir=mkdtempSync(path.join(tmpdir(),'geral-'));
  const geralClaude=path.join(dir,'claude.token');escrever(geralClaude,'sk-ant-oat01-geral\n');
  const geralCodex=path.join(dir,'codex.json');escrever(geralCodex,'{"geral":1}');
  const codexFalso=path.join(dir,'codex');escrever(codexFalso,'#!/bin/sh\nexit 1\n',{mode:0o755});
  const {sock,home}=await subirContas(t,{clis:{claude:claudeFalso,codex:codexFalso},grupos:['ratoeira-claude','ratoeira-codex'],geralClaude,geralCodex});
  t.after(()=>delete process.env.CLAUDE_CODE_OAUTH_TOKEN);
  mkdirSync(path.join(home,'.claude'));escrever(path.join(home,'.claude','.credentials.json'),'{"mcpOAuth":{"x":1},"claudeAiOauth":{}}');
  let st=JSON.parse((await pedirHttp(sock,'GET','/conta/claude/status')).corpo);
  assert.equal(st.propria,true);assert.equal(st.geralDisponivel,true);assert.equal(JSON.parse(st.stdout).email,'pessoa@exemplo.com');
  const r=await pedirHttp(sock,'POST','/conta/claude/sair');
  assert.equal(r.status,200);assert.equal(JSON.parse(r.corpo).ok,true);
  assert.deepEqual(JSON.parse(readFileSync(path.join(home,'.claude','.credentials.json'),'utf8')),{mcpOAuth:{x:1}});
  assert.equal(process.env.CLAUDE_CODE_OAUTH_TOKEN,'sk-ant-oat01-geral');
  st=JSON.parse((await pedirHttp(sock,'GET','/conta/claude/status')).corpo);
  assert.equal(st.propria,false);assert.equal(JSON.parse(st.stdout).authMethod,'oauth_token');
  // Codex com login próprio: sai, e a padrão passa pra conta da organização (pasta à parte, desde 28/10/2026; antes o
  // ~/.codex/auth.json virava atalho pra geral)
  mkdirSync(path.join(home,'.codex'));escrever(path.join(home,'.codex','auth.json'),'{"tokens":{"refresh_token":"r"}}');
  assert.equal(JSON.parse((await pedirHttp(sock,'GET','/conta/codex/status')).corpo).propria,true);
  assert.deepEqual(JSON.parse((await pedirHttp(sock,'GET','/conta/codex/contas')).corpo).contas.map(c=>c.id),['propria','org:geral']);
  assert.equal((await pedirHttp(sock,'POST','/conta/codex/sair')).status,200);
  assert.equal(fs.existsSync(path.join(home,'.codex','auth.json')),false);
  const cx=JSON.parse((await pedirHttp(sock,'GET','/conta/codex/contas')).corpo);
  assert.deepEqual([cx.ativa,cx.contas.map(c=>c.id)],['org:geral',['org:geral']]);
  // o terminal e o que mais herdar o ambiente do servidor ficam na pasta da conta, com o login como atalho pra geral
  assert.equal(fs.readlinkSync(path.join(process.env.CODEX_HOME,'auth.json')),geralCodex);
  assert.equal(process.env.CODEX_SQLITE_HOME,path.join(home,'.codex'));
  delete process.env.CODEX_HOME;delete process.env.CODEX_SQLITE_HOME;
});

test('várias contas do Claude: lista, troca (vale pra todas as conversas), pessoal e limites por conta',async t=>{
  const org=mkdtempSync(path.join(tmpdir(),'org-'));
  escrever(path.join(org,'contas.tsv'),'max1\tMax 1\nmax2\tMax 2\nfora\tSem acesso\n');
  escrever(path.join(org,'max1.token'),'sk-ant-oat01-'+'1'.repeat(24));escrever(path.join(org,'max2.token'),'sk-ant-oat01-'+'2'.repeat(24));
  const tk=JSON.stringify;const antes=process.env.CLAUDE_CODE_OAUTH_TOKEN;t.after(()=>{if(antes===undefined)delete process.env.CLAUDE_CODE_OAUTH_TOKEN;else process.env.CLAUDE_CODE_OAUTH_TOKEN=antes;});
  const {sock,home}=await subirContas(t,{grupos:['ratoeira-claude'],orgClaude:org});
  let r=JSON.parse((await pedirHttp(sock,'GET','/conta/claude/contas')).corpo);
  assert.deepEqual(r.contas.map(c=>c.id),['org:max1','org:max2']);   // "fora" não tem arquivo legível
  assert.equal(r.ativa,'org:max1');assert.equal(r.modo,'opcional');assert.equal(r.podeTrocar,true);
  // trocar: grava a escolha e o ambiente do servidor passa a ter o token da outra
  r=JSON.parse((await pedirHttp(sock,'POST','/conta/claude/usar',tk({conta:'org:max2'}))).corpo);
  assert.equal(r.ativa,'org:max2');assert.equal(process.env.CLAUDE_CODE_OAUTH_TOKEN,'sk-ant-oat01-'+'2'.repeat(24));
  assert.equal(readFileSync(path.join(home,'.config','ratoeira','claude-conta'),'utf8').trim(),'org:max2');
  assert.equal((await pedirHttp(sock,'POST','/conta/claude/usar',tk({conta:'org:fora'}))).status,409);
  // pessoal: token de 1 ano guardado na pasta da pessoa (600), entra na lista antes das da organização
  assert.equal((await pedirHttp(sock,'POST','/conta/claude/pessoais',tk({nome:'Minha',token:'curto'}))).status,409);
  r=JSON.parse((await pedirHttp(sock,'POST','/conta/claude/pessoais',tk({nome:'Minha\tMax',token:'sk-ant-oat01-'+'p'.repeat(24)}))).corpo);
  const pessoal=r.contas.find(c=>c.tipo==='pessoal');assert.equal(pessoal.nome,'Minha Max');assert.deepEqual(r.contas.map(c=>c.tipo),['pessoal','org','org']);
  const id=pessoal.id.slice(8);
  assert.equal(statSync(path.join(home,'.config','ratoeira','claude-contas',id+'.token')).mode&0o777,0o600);
  r=JSON.parse((await pedirHttp(sock,'POST','/conta/claude/usar',tk({conta:pessoal.id}))).corpo);
  assert.equal(process.env.CLAUDE_CODE_OAUTH_TOKEN,'sk-ant-oat01-'+'p'.repeat(24));
  // remover a que vale: volta pra regra (a primeira da lista)
  r=JSON.parse((await pedirHttp(sock,'POST',`/conta/claude/pessoais/${id}/remover`)).corpo);
  assert.equal(r.ativa,'org:max1');assert.equal(process.env.CLAUDE_CODE_OAUTH_TOKEN,'sk-ant-oat01-'+'1'.repeat(24));
  // pelo chat (WebSocket): a mesma lista, e a troca avisa os navegadores conectados
  const c=await cliente(t,sock);const avisos=[];c.ws.on('message',d=>{const m=JSON.parse(d);if(m.t==='conta')avisos.push(m.agente);});
  assert.equal((await c.pedir('contas',{agente:'falso'})).contas.length,0);
  await assert.rejects(c.pedir('conta-usar',{agente:'falso',conta:'org:max2'}),/não tem várias contas/);
});

test('modo própria não vê as da organização; geral fixa não vê a própria nem as pessoais',async t=>{
  const org=mkdtempSync(path.join(tmpdir(),'org-'));escrever(path.join(org,'contas.tsv'),'max1\tMax 1\n');escrever(path.join(org,'max1.token'),'sk-ant-oat01-'+'1'.repeat(24));
  const propria=await subirContas(t,{grupos:[],orgClaude:org});
  assert.deepEqual(JSON.parse((await pedirHttp(propria.sock,'GET','/conta/claude/contas')).corpo).contas,[]);
  const fixa=await subirContas(t,{grupos:['ratoeira-claude','ratoeira-claude-geral'],geralFixa:true,orgClaude:org});
  mkdirSync(path.join(fixa.home,'.claude'));escrever(path.join(fixa.home,'.claude','.credentials.json'),'{"claudeAiOauth":{}}');
  const r=JSON.parse((await pedirHttp(fixa.sock,'GET','/conta/claude/contas')).corpo);
  assert.deepEqual(r.contas.map(c=>c.id),['org:max1']);assert.equal(r.modo,'geral');
});

test('desconectar sem geral: fica sem conta; geral fixa não deixa desconectar',async t=>{
  const {existsSync}=await import('node:fs');
  const {sock,home}=await subirContas(t);
  process.env.CLAUDE_CODE_OAUTH_TOKEN='sk-ant-oat01-velho';t.after(()=>delete process.env.CLAUDE_CODE_OAUTH_TOKEN);
  mkdirSync(path.join(home,'.claude'));escrever(path.join(home,'.claude','.credentials.json'),'{"claudeAiOauth":{}}');
  assert.equal((await pedirHttp(sock,'POST','/conta/claude/sair')).status,200);
  assert.equal(existsSync(path.join(home,'.claude','.credentials.json')),false,'arquivo vazio some');
  assert.equal(process.env.CLAUDE_CODE_OAUTH_TOKEN,undefined);
  const fixa=await subirContas(t,{geralFixa:true});
  assert.equal((await pedirHttp(fixa.sock,'POST','/conta/claude/sair')).status,409);
});

test('renomear conversa: vale na lista, ao abrir, por cima do título do agente, e vazio volta ao dele',async t=>{
  const arquivoTitulos=path.join(mkdtempSync(path.join(tmpdir(),'titulos-')),'titulos.json');
  const {sock}=await subir(t,{arquivoTitulos});const c=await cliente(t,sock);
  const conv=await c.pedir('nova',{agente:'falso',cwd:'/tmp'});
  await c.pedir('assinar',{agente:'falso',sessao:conv.sessao,desde:0});
  assert.deepEqual(await c.pedir('renomear',{agente:'falso',sessao:conv.sessao,titulo:'  Proposta\nAcme '}),{titulo:'Proposta Acme'});
  await c.ate(()=>c.eventos.some(e=>e.update.sessionUpdate==='session_info_update'&&e.update.title==='Proposta Acme'));
  assert.equal((await c.pedir('listar',{})).find(x=>x.sessao===conv.sessao).titulo,'Proposta Acme');
  assert.equal(JSON.parse(readFileSync(arquivoTitulos,'utf8'))['falso:'+conv.sessao],'Proposta Acme','fica no arquivo da pessoa');
  await assert.rejects(c.pedir('renomear',{agente:'outro',sessao:conv.sessao,titulo:'x'}),/inválida/);
  await c.pedir('renomear',{agente:'falso',sessao:conv.sessao,titulo:''});
  assert.equal((await c.pedir('listar',{})).find(x=>x.sessao===conv.sessao).titulo,'conversa '+conv.sessao,'vazio volta ao título do agente');
});

test('aparelho da última mensagem: nova e enviar guardam, a lista mostra, tipo estranho não conta',async t=>{
  const arquivoTitulos=path.join(mkdtempSync(path.join(tmpdir(),'titulos-')),'titulos.json');
  const {sock}=await subir(t,{arquivoTitulos});const c=await cliente(t,sock);
  const conv=await c.pedir('nova',{agente:'falso',cwd:'/tmp',texto:'oi',aparelho:'celular'});
  const aparelho=async()=>(await c.pedir('listar',{})).find(x=>x.sessao===conv.sessao).aparelho;
  assert.equal(await aparelho(),'celular');
  await c.pedir('assinar',{agente:'falso',sessao:conv.sessao,desde:0});
  await c.ate(()=>c.eventos.some(e=>e.update?.sessionUpdate==='agent_message_chunk')).catch(()=>{});
  await c.pedir('enviar',{agente:'falso',sessao:conv.sessao,texto:'de novo',aparelho:'computador'});
  assert.equal(await aparelho(),'computador');
  await c.pedir('enviar',{agente:'falso',sessao:conv.sessao,texto:'sem dizer',aparelho:'torradeira'});
  assert.equal(await aparelho(),'computador','tipo desconhecido não troca');
  assert.equal(JSON.parse(readFileSync(path.join(path.dirname(arquivoTitulos),'aparelhos.json'),'utf8'))['falso:'+conv.sessao],'computador');
});

test('ligar uma conversa aberta às ferramentas de um app: recarrega com o MCP, e não no meio de uma resposta',async t=>{
  const {sock}=await subir(t);const c=await cliente(t,sock);
  const conv=await c.pedir('nova',{agente:'falso',cwd:'/tmp'});
  await c.pedir('assinar',{agente:'falso',sessao:conv.sessao,desde:0});
  const mcp=[{type:'http',name:'pedidos',url:'http://127.0.0.1:8790/mcp',headers:[{name:'Authorization',value:'Bearer x'}]}];
  // sem recarregar, conversa aberta segue como está (é o que o chat faz ao reabrir a aba)
  assert.equal((await c.pedir('abrir',{agente:'falso',sessao:conv.sessao,mcp})).recarregada,undefined);
  await c.pedir('enviar',{agente:'falso',sessao:conv.sessao,texto:'demorar'});
  await assert.rejects(c.pedir('abrir',{agente:'falso',sessao:conv.sessao,mcp,recarregar:true}),/Espere/);
  await c.pedir('cancelar',{agente:'falso',sessao:conv.sessao});
  await c.ate(()=>c.eventos.some(e=>e.update.sessionUpdate==='ratoeira_fim'));
  const r=await c.pedir('abrir',{agente:'falso',sessao:conv.sessao,mcp,recarregar:true});
  assert.equal(r.recarregada,true);assert.equal(r.cwd,'/tmp');
  const d=await c.pedir('assinar',{agente:'falso',sessao:conv.sessao,desde:0});
  c.eventos.length=0;
  await c.pedir('enviar',{agente:'falso',sessao:conv.sessao,texto:'ferramentas?'});
  await c.ate(()=>textos(c.eventos,'agent_message_chunk').some(x=>x?.startsWith('ferramentas:')));
  assert.ok(textos(c.eventos,'agent_message_chunk').includes('ferramentas: pedidos'));
  assert.ok(d.seq>=0);
});

test('habilidades globais: lê o cabeçalho de cada SKILL.md da pessoa',async()=>{
  const {habilidadesGlobais}=await import('../servidor.mjs');
  const {mkdirSync,writeFileSync}=await import('node:fs');
  const home=mkdtempSync(path.join(tmpdir(),'home-'));
  mkdirSync(path.join(home,'.claude','skills','resumo'),{recursive:true});
  writeFileSync(path.join(home,'.claude','skills','resumo','SKILL.md'),'---\nname: resumo\ndescription: >\n  Resume a reunião\n  em tópicos.\n---\n');
  mkdirSync(path.join(home,'.codex','skills','sem-cabecalho'),{recursive:true});
  writeFileSync(path.join(home,'.codex','skills','sem-cabecalho','SKILL.md'),'# nada\n');
  assert.deepEqual(habilidadesGlobais(home).map(h=>[h.nome,h.de,h.descricao]),[['resumo','claude','Resume a reunião em tópicos.'],['sem-cabecalho','codex','']]);
});

test('editor: lê, salva com commit no nome da pessoa, recusa sobrescrever o que mudou e caminho torto',async t=>{
  const {execFileSync}=await import('node:child_process');
  const {mkdirSync,writeFileSync,symlinkSync}=await import('node:fs');
  const raiz=mkdtempSync(path.join(tmpdir(),'editor-'));
  const git=(...a)=>execFileSync('git',['-C',raiz,...a],{encoding:'utf8'});
  git('init','-q');git('config','user.name','Beto');git('config','user.email','beto@exemplo.com');
  mkdirSync(path.join(raiz,'docs'));writeFileSync(path.join(raiz,'docs','notas.md'),'# Oi\n');writeFileSync(path.join(raiz,'fora.txt'),'x');
  symlinkSync(path.join(raiz,'fora.txt'),path.join(raiz,'atalho.md'));
  git('add','-A');git('commit','-qm','início');
  const {sock}=await subir(t);const c=await cliente(t,sock);
  const lido=await c.pedir('ler',{raiz,caminho:'docs/notas.md'});
  assert.equal(lido.texto,'# Oi\n');
  const salvo=await c.pedir('salvar',{raiz,caminho:'docs/notas.md',texto:'# Oi\n\nnovo\n',base:lido.hash});
  assert.ok(salvo.commit,'commitou');
  assert.equal(readFileSync(path.join(raiz,'docs','notas.md'),'utf8'),'# Oi\n\nnovo\n');
  assert.equal(git('log','-1','--format=%an|%s').trim(),'Beto|Editado na tela: docs/notas.md');
  // alguém mudou depois que o editor abriu: não escreve por cima sem forcar
  writeFileSync(path.join(raiz,'docs','notas.md'),'# do agente\n');
  assert.deepEqual(await c.pedir('salvar',{raiz,caminho:'docs/notas.md',texto:'minha versão',base:salvo.hash}),{conflito:true});
  assert.equal(readFileSync(path.join(raiz,'docs','notas.md'),'utf8'),'# do agente\n');
  await c.pedir('salvar',{raiz,caminho:'docs/notas.md',texto:'minha versão',base:salvo.hash,forcar:true});
  assert.equal(readFileSync(path.join(raiz,'docs','notas.md'),'utf8'),'minha versão');
  for(const caminho of ['../fora.txt','docs/../fora.txt','.git/config','atalho.md','docs','nao-existe.md'])
    await assert.rejects(c.pedir('ler',{raiz,caminho}),/inválido|symlink|Não é um arquivo|não encontrado/,caminho);
});

test('apagar pela árvore: commit no nome da pessoa, arquivo fora do git só some, e não apaga pasta, atalho nem fora da raiz',async t=>{
  const {execFileSync}=await import('node:child_process');
  const {mkdirSync,writeFileSync,symlinkSync,existsSync}=await import('node:fs');
  const raiz=mkdtempSync(path.join(tmpdir(),'apagar-'));
  const git=(...a)=>execFileSync('git',['-C',raiz,...a],{encoding:'utf8'});
  git('init','-q');git('config','user.name','Beto');git('config','user.email','beto@exemplo.com');
  mkdirSync(path.join(raiz,'docs'));writeFileSync(path.join(raiz,'docs','velho.md'),'x');writeFileSync(path.join(raiz,'fica.md'),'y');
  symlinkSync(path.join(raiz,'fica.md'),path.join(raiz,'atalho.md'));
  git('add','-A');git('commit','-qm','início');
  writeFileSync(path.join(raiz,'solto.txt'),'z');
  const {sock}=await subir(t);const c=await cliente(t,sock);
  const r=await c.pedir('apagar',{raiz,caminho:'docs/velho.md'});
  assert.ok(r.commit,'commitou');assert.equal(existsSync(path.join(raiz,'docs','velho.md')),false);
  assert.equal(git('log','-1','--format=%an|%s').trim(),'Beto|Apagado na tela: docs/velho.md');
  assert.equal(git('status','--porcelain','--','docs').trim(),'');
  assert.deepEqual(await c.pedir('apagar',{raiz,caminho:'solto.txt'}),{commit:null});
  assert.equal(existsSync(path.join(raiz,'solto.txt')),false);
  for(const caminho of ['docs','atalho.md','../fica.md','.git/config','nao-existe.md'])
    await assert.rejects(c.pedir('apagar',{raiz,caminho}),/inválido|symlink|Não é um arquivo|não encontrado/,caminho);
  assert.ok(existsSync(path.join(raiz,'fica.md')));
});

test('criar e renomear pela árvore: arquivo com commit, pasta vazia, nome repetido e caminho ruim recusados',async t=>{
  const {execFileSync}=await import('node:child_process');
  const {mkdirSync,writeFileSync,readFileSync,symlinkSync,existsSync}=await import('node:fs');
  const raiz=mkdtempSync(path.join(tmpdir(),'criar-'));
  const git=(...a)=>execFileSync('git',['-C',raiz,...a],{encoding:'utf8'});
  git('init','-q');git('config','user.name','Duda');git('config','user.email','duda@exemplo.com');
  mkdirSync(path.join(raiz,'docs'));writeFileSync(path.join(raiz,'docs','velho.md'),'x');writeFileSync(path.join(raiz,'.gitignore'),'.env\n');
  symlinkSync(path.join(raiz,'docs'),path.join(raiz,'atalho'));
  git('add','-A');git('commit','-qm','início');
  const {sock}=await subir(t);const c=await cliente(t,sock);
  // arquivo novo: markdown nasce com título, e o commit sai no nome da pessoa
  const novo=await c.pedir('arquivo-criar',{raiz,pasta:'docs',nome:'Plano de mídia.md',tipo:'arquivo'});
  assert.equal(novo.caminho,'docs/Plano de mídia.md');assert.ok(novo.commit);
  assert.equal(readFileSync(path.join(raiz,'docs','Plano de mídia.md'),'utf8'),'# Plano de mídia\n');
  assert.equal(git('log','-1','--format=%an|%s').trim(),'Duda|Criado na tela: docs/Plano de mídia.md');
  // .env: cria, mas é ignorado, então não tem commit
  assert.equal((await c.pedir('arquivo-criar',{raiz,pasta:'',nome:'.env',tipo:'arquivo'})).commit,null);
  // pasta vazia
  assert.deepEqual(await c.pedir('arquivo-criar',{raiz,pasta:'',nome:'clientes',tipo:'pasta'}),{caminho:'clientes',tipo:'pasta'});
  assert.ok(existsSync(path.join(raiz,'clientes')));
  await assert.rejects(c.pedir('arquivo-criar',{raiz,pasta:'',nome:'clientes',tipo:'pasta'}),/Já existe/);
  for(const [pasta,nome] of [['','a/b'],['','..'],['','.git'],['../','x'],['atalho','x'],['nao-existe','x'],['.git','x'],['','']])
    await assert.rejects(c.pedir('arquivo-criar',{raiz,pasta,nome,tipo:'arquivo'}),/inválid|atalho|não existe/,pasta+'|'+nome);
  // renomear arquivo versionado: um commit com o de e o pra
  const r=await c.pedir('arquivo-renomear',{raiz,caminho:'docs/velho.md',nome:'novo.md'});
  assert.equal(r.caminho,'docs/novo.md');assert.ok(r.commit);
  assert.equal(git('status','--porcelain','--','docs').trim(),'','sem nada pendente em docs');
  assert.ok(git('ls-files','docs').includes('docs/novo.md')&&!git('ls-files','docs').includes('velho.md'));
  // renomear pasta inteira
  const p=await c.pedir('arquivo-renomear',{raiz,caminho:'docs',nome:'documentos'});
  assert.equal(p.tipo,'pasta');assert.ok(git('ls-files').includes('documentos/novo.md'));
  // arquivo nunca commitado: renomeia e o novo nome entra no git
  writeFileSync(path.join(raiz,'solto.txt'),'z');
  assert.ok((await c.pedir('arquivo-renomear',{raiz,caminho:'solto.txt',nome:'preso.txt'})).commit);
  assert.ok(git('ls-files').includes('preso.txt'));
  await assert.rejects(c.pedir('arquivo-renomear',{raiz,caminho:'preso.txt',nome:'documentos'}),/Já existe/);
  for(const caminho of ['atalho','../fora','.git/config','nao-existe.md'])
    await assert.rejects(c.pedir('arquivo-renomear',{raiz,caminho,nome:'x'}),/inválido|Atalho|Não achei/,caminho);
});

test('automações: lê o arquivo e os resultados, liga/desliga conferindo a linha',async()=>{
  const {automacoesDe,alternarAutomacao}=await import('../servidor.mjs');
  const {mkdirSync,writeFileSync}=await import('node:fs');
  const home=mkdtempSync(path.join(tmpdir(),'home-'));
  mkdirSync(path.join(home,'.config','ratoeira'),{recursive:true});mkdirSync(path.join(home,'.local','state','ratoeira','crons'),{recursive:true});
  const cron='# ratoeira: Backup | copia as notas\n0 9 * * * /usr/local/bin/ratoeira-cron backup -- ./backup.sh\n';
  writeFileSync(path.join(home,'.config','ratoeira','crontab'),cron);
  writeFileSync(path.join(home,'.local','state','ratoeira','crons','backup.json'),'{"nome":"backup","inicio":"2026-10-09T09:00:00Z","fim":"2026-10-09T09:00:03Z","codigo":0}');
  const a=automacoesDe(home);
  assert.equal(a.texto,cron);assert.equal(a.estados.backup.codigo,0);
  const linha='0 9 * * * /usr/local/bin/ratoeira-cron backup -- ./backup.sh';
  alternarAutomacao(home,1,linha,false);
  assert.match(automacoesDe(home).texto,/^#desligado# 0 9 \* \* \*/m,'desligar comenta com a marca');
  assert.throws(()=>alternarAutomacao(home,1,'outra coisa',true),/mudou/,'linha diferente da que a tela viu: recusa');
  alternarAutomacao(home,1,linha,true);
  assert.equal(automacoesDe(home).texto,cron,'ligar volta exatamente como era');
  assert.equal(automacoesDe(mkdtempSync(path.join(tmpdir(),'vazio-'))).texto,null,'sem arquivo: nenhuma');
});

test('integrações: lê a saída do claude mcp list sem expor URL inteira',async()=>{
  const {lerMcpList}=await import('../servidor.mjs');
  const saida=`Checking MCP server health…

claude.ai Gmail: https://gmailmcp.googleapis.com/mcp/v1 - ✔ Connected
claude.ai Supabase: https://mcp.supabase.com/mcp - ! Needs authentication
plugin:google-ads-toolkit:google-ads: npx -y @anthropic/google-ads-mcp - ✘ Failed to connect — CONNECTION_CLOSED: Connection closed
composio: https://backend.composio.dev/v3/mcp/abc?api_key=SEGREDO (HTTP) - ✔ Connected
`;
  const l=lerMcpList(saida);
  assert.deepEqual(l.map(x=>[x.nome,x.alvo,x.estado,x.origem]),[
    ['claude.ai Gmail','gmailmcp.googleapis.com','conectado','conta'],
    ['claude.ai Supabase','mcp.supabase.com','autorizar','conta'],
    ['plugin:google-ads-toolkit:google-ads','npx -y','falhou','plugin'],
    ['composio','backend.composio.dev','conectado','instalado']]);
  assert.ok(!JSON.stringify(l).includes('SEGREDO'),'chave na URL não sai');
});

test('rotinas: lê cabeçalho, pedido, último resultado e a conversa; liga/desliga no cabeçalho',async()=>{
  const {rotinasDe,alternarRotina}=await import('../servidor.mjs');
  const {mkdirSync,writeFileSync}=await import('node:fs');
  const home=mkdtempSync(path.join(tmpdir(),'home-'));
  const dir=path.join(home,'.config','ratoeira','rotinas'),est=path.join(home,'.local','state','ratoeira','crons');
  mkdirSync(dir,{recursive:true});mkdirSync(est,{recursive:true});
  writeFileSync(path.join(dir,'resumo-dia.md'),'---\nnome: Resumo do dia\nquando: 0 21 * * 1-5\nagente: claude\npasta: /srv/x\n---\nResume o dia em 5 tópicos.\n');
  writeFileSync(path.join(dir,'Nome Torto.md'),'---\nnome: x\n---\ny');
  writeFileSync(path.join(est,'rotina-resumo-dia.json'),'{"inicio":"2026-10-09T21:00:00Z","fim":"2026-10-09T21:01:10Z","codigo":0}');
  writeFileSync(path.join(est,'rotina-resumo-dia.sessao'),'{"agente":"claude","sessao":"abc-123","titulo":"Rotina: Resumo do dia · 09/10 21:00 UTC"}');
  const [r]=rotinasDe(home);
  assert.deepEqual([r.id,r.nome,r.quando,r.agente,r.pasta,r.ligada,r.pedido],['resumo-dia','Resumo do dia','0 21 * * 1-5','claude','/srv/x',true,'Resume o dia em 5 tópicos.']);
  assert.equal(r.estado.codigo,0);assert.equal(r.sessao.sessao,'abc-123');
  assert.equal(rotinasDe(home).length,1,'nome de arquivo fora do padrão fica de fora');
  alternarRotina(home,'resumo-dia',false);assert.equal(rotinasDe(home)[0].ligada,false);
  alternarRotina(home,'resumo-dia',true);assert.equal(rotinasDe(home)[0].ligada,true);
  assert.equal(rotinasDe(home)[0].pedido,'Resume o dia em 5 tópicos.','o pedido não muda');
  assert.throws(()=>alternarRotina(home,'../x',true),/inválida/);
});

test('rotina-salvar e rotina-apagar: nova pelo nome, editar mantém o que a tela não mostra, valida tudo',async()=>{
  const {rotinasDe,salvarRotina,apagarRotina}=await import('../servidor.mjs');
  const {mkdirSync,writeFileSync,readFileSync}=await import('node:fs');
  const home=mkdtempSync(path.join(tmpdir(),'home-')),pasta=mkdtempSync(path.join(tmpdir(),'pasta-'));
  const id=salvarRotina(home,{nome:'Resumo da Semana!',quando:'0 12  * * 1',agente:'Claude',pasta,pedido:'Resume a semana.\n\n---\nlinha com traços'});
  assert.equal(id,'resumo-da-semana');
  assert.equal(salvarRotina(home,{nome:'Resumo da semana',quando:'0 9 * * *',pedido:'x'}),'resumo-da-semana-2','nome repetido ganha número');
  let r=rotinasDe(home).find(x=>x.id===id);
  assert.deepEqual([r.nome,r.quando,r.agente,r.pasta,r.ligada,r.pedido],['Resumo da Semana!','0 12 * * 1','claude',pasta,true,'Resume a semana.\n\n---\nlinha com traços']);
  const arq=path.join(home,'.config','ratoeira','rotinas',id+'.md');
  writeFileSync(arq,readFileSync(arq,'utf8').replace('ligada: sim','ligada: sim\nmodelo: opus\npermissao: auto'));
  salvarRotina(home,{rotina:id,nome:'Resumo',quando:'@daily',agente:'codex',pasta:'',pedido:'Novo pedido.',ligada:false});
  r=rotinasDe(home).find(x=>x.id===id);
  assert.deepEqual([r.nome,r.quando,r.agente,r.pasta,r.ligada,r.pedido],['Resumo','@daily','codex','',false,'Novo pedido.']);
  assert.match(readFileSync(arq,'utf8'),/modelo: opus\npermissao: auto/,'campos que a tela não mostra ficam');
  // avisar: sem o campo vale quando-precisar; a tela grava o que escolheu; sem mandar, o que estava fica
  assert.equal(r.avisar,'quando-precisar');
  salvarRotina(home,{rotina:id,nome:'Resumo',quando:'@daily',pedido:'Novo pedido.',avisar:'sempre'});
  assert.equal(rotinasDe(home).find(x=>x.id===id).avisar,'sempre');assert.equal(readFileSync(arq,'utf8').match(/^avisar:/gm).length,1);
  salvarRotina(home,{rotina:id,nome:'Resumo',quando:'@daily',agente:'codex',pasta:'',pedido:'Novo pedido.',ligada:false});
  assert.equal(rotinasDe(home).find(x=>x.id===id).avisar,'sempre');
  assert.throws(()=>salvarRotina(home,{rotina:id,nome:'Resumo',quando:'@daily',pedido:'x',avisar:'nunca'}),/Aviso/);
  for(const [dados,msg] of [[{nome:'',quando:'0 9 * * *',pedido:'x'},/nome/],[{nome:'a\nb',quando:'0 9 * * *',pedido:'x'},/nome/],[{nome:'a',quando:'0 9 * *',pedido:'x'},/Horário/],
    [{nome:'a',quando:'0 9 * * *; rm -rf /',pedido:'x'},/Horário/],[{nome:'a',quando:'0 9 * * *',agente:'bash',pedido:'x'},/Agente/],[{nome:'a',quando:'0 9 * * *',pasta:'/nao/existe/x',pedido:'x'},/pasta/],
    [{nome:'a',quando:'0 9 * * *',pedido:'  '},/pedido/],[{rotina:'../x',nome:'a',quando:'0 9 * * *',pedido:'x'},/não encontrada/],[{rotina:'outra',nome:'a',quando:'0 9 * * *',pedido:'x'},/não encontrada/]])
    assert.throws(()=>salvarRotina(home,dados),msg);
  apagarRotina(home,id);assert.equal(rotinasDe(home).some(x=>x.id===id),false);
  assert.throws(()=>apagarRotina(home,id),/não encontrada/);assert.throws(()=>apagarRotina(home,'../../x'),/inválida/);
});

test('rotina-rodar e rotina-alternar: o número do pedido volta certo (parâmetro não se chama id)',async t=>{
  const {mkdirSync,writeFileSync}=await import('node:fs');
  const home=mkdtempSync(path.join(tmpdir(),'home-'));mkdirSync(path.join(home,'.config','ratoeira','rotinas'),{recursive:true});
  writeFileSync(path.join(home,'.config','ratoeira','rotinas','teste.md'),'---\nnome: Teste\nquando: 0 9 * * 1\n---\nOi.\n');
  const {sock}=await subir(t,{contas:{home,clis:{},runner:'/bin/true',python:'/bin/true',geralFixa:false}});const c=await cliente(t,sock);
  const r=await c.pedir('rotina-alternar',{rotina:'teste',ligar:false});
  assert.equal(r[0].ligada,false,'respondeu ao pedido certo e desligou');
  await assert.rejects(c.pedir('rotina-rodar',{rotina:'nao-existe'}),/não encontrada/);
});

test('chaves locais: só o nome das variáveis com cara de chave, nos .env que o git ignora',async()=>{
  const {chavesLocais}=await import('../servidor.mjs');
  const {execFileSync}=await import('node:child_process');const {mkdirSync,writeFileSync}=await import('node:fs');
  const raiz=mkdtempSync(path.join(tmpdir(),'chaves-'));execFileSync('git',['-C',raiz,'init','-q']);
  writeFileSync(path.join(raiz,'.gitignore'),'.env\n.env.*\nnode_modules/\n');
  writeFileSync(path.join(raiz,'.env'),'RESEND_API_KEY=re_SEGREDO\nPORT=3000\nNEXT_PUBLIC_SUPABASE_ANON_KEY=x\n');
  mkdirSync(path.join(raiz,'app'));writeFileSync(path.join(raiz,'app','.env.local'),'export STRIPE_SECRET_KEY=sk_SEGREDO\n');
  mkdirSync(path.join(raiz,'node_modules','x'),{recursive:true});writeFileSync(path.join(raiz,'node_modules','x','.env'),'LIXO_TOKEN=1\n');
  const l=chavesLocais(raiz);
  assert.deepEqual(l.map(x=>[x.nome,x.onde]).sort(),[['RESEND_API_KEY',['.env']],['STRIPE_SECRET_KEY',['app/.env.local']]]);
  assert.ok(!JSON.stringify(l).includes('SEGREDO'),'valor nunca sai');
});

// cliente que também guarda a saída dos terminais
function comTerminal(c){
  const saida=new Map(),fins=new Map();
  c.ws.on('message',d=>{const m=JSON.parse(d);if(m.t==='terminal')saida.set(m.terminal,(saida.get(m.terminal)??'')+m.dados);else if(m.t==='terminal-fim')fins.set(m.terminal,m.code);});
  return {saida,fins};
}
test('terminal: shell de verdade, digita, reconecta e recebe o que perdeu; exit fecha',async t=>{
  const pasta=mkdtempSync(path.join(tmpdir(),'term-'));
  const {s,sock}=await subir(t,{contas:{home:pasta,python:'python3',clis:{}}});
  const a=await cliente(t,sock);const ta=comTerminal(a);
  await assert.rejects(a.pedir('terminal-abrir',{cwd:'/nao/existe',linhas:24,colunas:80}),/não existe/);
  const {terminal,cwd}=await a.pedir('terminal-abrir',{cwd:pasta,linhas:24,colunas:80});
  assert.equal(cwd,pasta);
  await a.pedir('terminal-assinar',{terminal,desde:0});
  await a.pedir('terminal-tamanho',{terminal,linhas:40,colunas:120});
  await a.pedir('terminal-entrada',{terminal,dados:'echo "ola $((40+2))"; stty size; pwd\n'});
  await a.ate(()=>/ola 42/.test(ta.saida.get(terminal)??'')&&/40 120/.test(ta.saida.get(terminal)));
  assert.match(ta.saida.get(terminal),new RegExp(path.basename(pasta)));
  assert.equal(s.estado().ocupado,false);assert.equal(s.estado().terminais,1);
  a.ws.close();
  // outro navegador: assina e recebe tudo de novo, e segue digitando no mesmo shell
  const b=await cliente(t,sock);const tb=comTerminal(b);
  assert.deepEqual((await b.pedir('terminais')).map(x=>x.terminal),[terminal]);
  const r=await b.pedir('terminal-assinar',{terminal,desde:0});
  assert.match(r.dados,/ola 42/);assert.equal(r.desde,0);
  await b.pedir('terminal-entrada',{terminal,dados:'exit\n'});
  await b.ate(()=>tb.fins.has(terminal));
  assert.equal(tb.fins.get(terminal),0);
  await assert.rejects(b.pedir('terminal-entrada',{terminal,dados:'x'}),/fechou/);
  assert.equal(s.estado().terminais,0);
});

test('abertas em cada aparelho: grava as abas deste navegador, lê as dos outros, limpa o velho e recusa formato torto',async t=>{
  const {abertasDe,gravarAbertas}=await import('../servidor.mjs');
  const {readFileSync,statSync}=await import('node:fs');
  const home=mkdtempSync(path.join(tmpdir(),'home-')),dia=86400000,t0=Date.parse('2026-10-13T12:00:00Z');
  assert.deepEqual(abertasDe(home,t0),[],'sem arquivo: nenhum aparelho');
  gravarAbertas(home,{aparelho:'celular-aaaa',tipo:'celular',conversas:[{agente:'claude',sessao:'s1',cwd:'/srv/x',titulo:'Proposta\nAcme'},{agente:'claude',sessao:'s1'},{agente:'../x',sessao:'s2'},{agente:'codex',sessao:'s 3'}]},t0);
  gravarAbertas(home,{aparelho:'computador-bbbb',tipo:'computador',conversas:[{agente:'codex',sessao:'s9'}]},t0+1000);
  const [pc,cel]=abertasDe(home,t0+2000);
  assert.equal(pc.aparelho,'computador-bbbb','mais recente primeiro');
  assert.deepEqual(cel.conversas,[{agente:'claude',sessao:'s1',cwd:'/srv/x',titulo:'Proposta Acme'}],'repetida e torta ficam de fora; título numa linha');
  assert.equal(statSync(path.join(home,'.config','ratoeira','abertas.json')).mode&0o777,0o600);
  gravarAbertas(home,{aparelho:'celular-aaaa',tipo:'celular',conversas:[]},t0+3000);
  assert.equal(abertasDe(home,t0+4000).find(a=>a.aparelho==='celular-aaaa').conversas.length,0,'fechar tudo vale');
  assert.deepEqual(abertasDe(home,t0+15*dia),[],'14 dias sem sinal: sai');
  gravarAbertas(home,{aparelho:'novo-cccccc',tipo:'computador',conversas:[]},t0+15*dia);
  assert.deepEqual(Object.keys(JSON.parse(readFileSync(path.join(home,'.config','ratoeira','abertas.json'),'utf8'))),['novo-cccccc'],'gravar leva embora os velhos');
  assert.throws(()=>gravarAbertas(home,{aparelho:'x',tipo:'celular',conversas:[]}),/inválido/);
  assert.throws(()=>gravarAbertas(home,{aparelho:'celular-aaaa',tipo:'tablet',conversas:[]}),/inválido/);
  // pelo servidor: o nome que a pessoa deu à conversa passa por cima do título que o navegador mandou
  const {sock}=await subir(t,{contas:{home}});const c=await cliente(t,sock);
  await c.pedir('abertas-gravar',{aparelho:'celular-aaaa',tipo:'celular',conversas:[{agente:'falso',sessao:'s1',titulo:'velho'}]});
  await c.pedir('renomear',{agente:'falso',sessao:'s1',titulo:'Nome novo'});
  const lidas=await c.pedir('abertas');
  assert.equal(lidas.find(a=>a.aparelho==='celular-aaaa').conversas[0].titulo,'Nome novo');
  await assert.rejects(c.pedir('abertas-gravar',{aparelho:'celular-aaaa',tipo:'celular'}),/inválido/);
});

// ── Conversa dormindo (14/10/2026): parada há 60 min ou além das 5 acordadas, o processo fecha e os eventos ficam.
function comContagem(extra={}){
  const arq=path.join(mkdtempSync(path.join(tmpdir(),'contagem-')),'c.json');
  const ag=new Map([['falso',{...agentes.get('falso'),env:{FALSO_CONTAGEM:arq,...extra}}]]);
  return {agentes:ag,contagem:()=>{try{return JSON.parse(readFileSync(arq,'utf8'));}catch{return {load:0,resume:0,close:0,vivas:[]};}}};
}

test('parada há 60 min dorme; abrir não liga processo; mandar acorda sem repetir o histórico',async t=>{
  const {agentes:ag,contagem}=comContagem();
  let relogio=0;const {s,sock}=await subir(t,{agentes:ag,agora:()=>relogio});const c=await cliente(t,sock);
  const conv=await c.pedir('nova',{agente:'falso',cwd:'/tmp',texto:'oi'});
  await c.pedir('assinar',{agente:'falso',sessao:conv.sessao,desde:0});
  await c.ate(()=>c.eventos.some(e=>e.update.sessionUpdate==='ratoeira_fim'));
  relogio=59*60000;await s.dormirParadas();
  assert.ok(contagem().vivas.includes(conv.sessao),'59 min: ainda acordada');
  relogio=60*60000;await s.dormirParadas();
  assert.ok(!contagem().vivas.includes(conv.sessao),'60 min: dormiu');
  // outro navegador abre: vem da memória, sem processo
  const b=await cliente(t,sock);
  await b.pedir('abrir',{agente:'falso',sessao:conv.sessao,cwd:'/tmp'});
  await b.pedir('assinar',{agente:'falso',sessao:conv.sessao,desde:0});
  assert.deepEqual(textos(b.eventos,'agent_message_chunk'),['eco: oi']);
  assert.equal(contagem().load,0);assert.ok(!contagem().vivas.includes(conv.sessao));
  // mandar acorda (resume) e responde; a tela não recebe o histórico de novo
  await b.pedir('enviar',{agente:'falso',sessao:conv.sessao,texto:'de novo'});
  await b.ate(()=>textos(b.eventos,'agent_message_chunk').includes('eco: de novo'));
  assert.deepEqual(textos(b.eventos,'agent_message_chunk'),['eco: oi','eco: de novo']);
  assert.equal(contagem().resume,1);assert.ok(contagem().vivas.includes(conv.sessao));
});

test('rodando ou esperando permissão não dorme, por mais tempo que passe',async t=>{
  const {agentes:ag,contagem}=comContagem();
  let relogio=0;const {s,sock}=await subir(t,{agentes:ag,agora:()=>relogio});const c=await cliente(t,sock);
  const a=await c.pedir('nova',{agente:'falso',cwd:'/tmp',texto:'demorar'});
  const b=await c.pedir('nova',{agente:'falso',cwd:'/tmp',texto:'pode? permissão'});
  await c.pedir('assinar',{agente:'falso',sessao:b.sessao,desde:0});
  await c.ate(()=>c.eventos.some(e=>e.update.sessionUpdate==='ratoeira_pedido'));
  relogio=5*3600000;await s.dormirParadas();
  assert.ok(contagem().vivas.includes(a.sessao)&&contagem().vivas.includes(b.sessao));
  assert.equal(contagem().close,0);
});

test('abrir a mesma conversa quatro vezes ao mesmo tempo carrega uma vez só',async t=>{
  const {agentes:ag,contagem}=comContagem();
  const {sock}=await subir(t,{agentes:ag});const c=await cliente(t,sock);
  const r=await Promise.all([1,2,3,4].map(()=>c.pedir('abrir',{agente:'falso',sessao:'velha1',cwd:'/tmp'})));
  assert.ok(r.every(x=>x.sessao==='velha1'));
  assert.equal(contagem().load,1);
});

test('além das acordadas, dormem as paradas há mais tempo e continuam abrindo da memória',async t=>{
  const {agentes:ag,contagem}=comContagem();
  let relogio=0;const {sock}=await subir(t,{agentes:ag,maxAcordadas:2,agora:()=>relogio});const c=await cliente(t,sock);
  for(const id of ['v1','v2','v3','v4']){relogio+=1000;await c.pedir('abrir',{agente:'falso',sessao:id,cwd:'/tmp'});}
  await c.ate(()=>contagem().vivas.length<=2);
  assert.deepEqual(contagem().vivas.sort(),['v3','v4']);
  // a que dormiu segue mostrando o histórico e responde quando mandam
  await c.pedir('abrir',{agente:'falso',sessao:'v1',cwd:'/tmp'});
  await c.pedir('assinar',{agente:'falso',sessao:'v1',desde:0});
  assert.ok(textos(c.eventos.filter(e=>e.sessao==='v1'),'agent_message_chunk').includes('eco: antiga'));
  await c.pedir('enviar',{agente:'falso',sessao:'v1',texto:'acorda'});
  await c.ate(()=>textos(c.eventos,'agent_message_chunk').includes('eco: acorda'));
  await c.ate(()=>contagem().vivas.length<=2&&contagem().vivas.includes('v1'));
});

test('agente sem session/close: nada dorme e a conversa segue',async t=>{
  const {agentes:ag,contagem}=comContagem({FALSO_SEM_FECHAR:'1'});
  let relogio=0;const {s,sock}=await subir(t,{agentes:ag,agora:()=>relogio});const c=await cliente(t,sock);
  const conv=await c.pedir('nova',{agente:'falso',cwd:'/tmp'});
  relogio=2*3600000;await s.dormirParadas();
  assert.ok(contagem().vivas.includes(conv.sessao));
  await c.pedir('assinar',{agente:'falso',sessao:conv.sessao,desde:0});
  await c.pedir('enviar',{agente:'falso',sessao:conv.sessao,texto:'oi'});
  await c.ate(()=>textos(c.eventos,'agent_message_chunk').includes('eco: oi'));
});

test('conversa compartilhada: convidado só lê, ou entra com o nome dele; o dono vê quem está dentro',async t=>{
  const {sock}=await subir(t);
  const dono=await cliente(t,sock,{email:'ana@exemplo.com',nome:'Ana'});
  const conv=await dono.pedir('nova',{agente:'falso',cwd:'/tmp'});
  const outra=await dono.pedir('nova',{agente:'falso',cwd:'/tmp'});
  await dono.pedir('assinar',{agente:'falso',sessao:conv.sessao,desde:0});
  // antes de compartilhar, a mensagem vai pro agente como foi digitada, com o autor só pra tela
  await dono.pedir('enviar',{agente:'falso',sessao:conv.sessao,texto:'oi'});
  await dono.ate(()=>dono.eventos.filter(e=>e.update.sessionUpdate==='ratoeira_fim').length===1);
  assert.deepEqual(textos(dono.eventos,'agent_message_chunk'),['eco: oi']);
  assert.deepEqual(dono.eventos.find(e=>e.update.sessionUpdate==='user_message_chunk').update.ratoeira_autor,{nome:'Ana',email:'ana@exemplo.com'});
  assert.equal((await postar(sock,'/compartilhada',{agente:'falso',sessao:conv.sessao,ligar:true})).status,200);
  await dono.ate(()=>dono.eventos.some(e=>e.update.sessionUpdate==='ratoeira_compartilhada'));
  // convidado só pra leitura: abre e assina a conversa dele, recebe o histórico, não manda nem mexe em outra
  const leitor=await cliente(t,sock,{email:'beto@exemplo.com',nome:'Beto',convite:{agente:'falso',sessao:conv.sessao,cwd:'/tmp',modo:'ler'}});
  const aberta=await leitor.pedir('abrir',{agente:'falso',sessao:conv.sessao,cwd:'/etc',mcp:[{type:'http',name:'x',url:'http://127.0.0.1:1/'}]});
  assert.equal(aberta.cwd,'/tmp');assert.equal(aberta.compartilhada,true);
  const a=await leitor.pedir('assinar',{agente:'falso',sessao:conv.sessao,desde:0});
  assert.deepEqual(a.presenca.map(p=>p.nome).sort(),['Ana','Beto']);
  assert.ok(textos(leitor.eventos,'agent_message_chunk').includes('eco: oi'));
  await assert.rejects(leitor.pedir('enviar',{agente:'falso',sessao:conv.sessao,texto:'posso?'}),/só pra leitura/);
  await assert.rejects(leitor.pedir('abrir',{agente:'falso',sessao:outra.sessao}),/não foi compartilhada/);
  await assert.rejects(leitor.pedir('listar',{}),/dono/);
  await assert.rejects(leitor.pedir('terminal-abrir',{cwd:'/tmp'}),/dono/);
  await assert.rejects(leitor.pedir('opcao',{agente:'falso',sessao:conv.sessao,opcao:'mode',valor:'x'}),/dono/);
  // o dono fica sabendo que o Beto entrou
  await dono.ate(()=>dono.presencas.some(p=>p.pessoas.some(x=>x.nome==='Beto'&&x.convidado)));
  // convidado que pode entrar: a mensagem vai pro agente com o nome dele, e o dono vê quem mandou
  const caio=await cliente(t,sock,{email:'caio@exemplo.com',nome:'Caio',convite:{agente:'falso',sessao:conv.sessao,cwd:'/tmp',modo:'entrar'}});
  await caio.pedir('abrir',{agente:'falso',sessao:conv.sessao});
  await caio.pedir('assinar',{agente:'falso',sessao:conv.sessao,desde:0});
  await caio.pedir('enviar',{agente:'falso',sessao:conv.sessao,texto:'e agora?'});
  await dono.ate(()=>dono.eventos.filter(e=>e.update.sessionUpdate==='ratoeira_fim').length===2);
  assert.ok(textos(dono.eventos,'agent_message_chunk').includes('eco: [Caio]: e agora?'));
  const dele=dono.eventos.filter(e=>e.update.sessionUpdate==='user_message_chunk').at(-1).update;
  assert.equal(dele.content.text,'e agora?');assert.equal(dele.ratoeira_autor.nome,'Caio');
  // o convidado só recebe o estado da conversa dele
  await dono.pedir('assinar',{agente:'falso',sessao:outra.sessao,desde:0});
  await dono.pedir('enviar',{agente:'falso',sessao:outra.sessao,texto:'só minha'});
  await dono.ate(()=>dono.estados.some(e=>e.sessao===outra.sessao&&e.estado==='livre'));
  assert.ok(!caio.estados.some(e=>e.sessao===outra.sessao));
  // cabeçalho de convite quebrado não vira dono
  const torto=await cliente(t,sock,{email:'x@x.com',nome:'X',convite:{agente:'falso',sessao:conv.sessao,modo:'tudo'}});
  await assert.rejects(torto.pedir('listar',{}),/inválido/);
  // quem sai some da presença
  leitor.ws.close();
  await dono.ate(()=>dono.presencas.at(-1)?.pessoas.every(p=>p.nome!=='Beto'));
});

test('nota interna: vai pras pessoas e não pro agente, quem só lê também escreve, e volta ao reabrir',async t=>{
  const {s,sock}=await subir(t);
  const dono=await cliente(t,sock,{email:'ana@exemplo.com',nome:'Ana'});
  const conv=await dono.pedir('nova',{agente:'falso',cwd:'/tmp'});
  await dono.pedir('assinar',{agente:'falso',sessao:conv.sessao,desde:0});
  await dono.pedir('enviar',{agente:'falso',sessao:conv.sessao,texto:'oi'});
  await dono.ate(()=>dono.eventos.some(e=>e.update.sessionUpdate==='ratoeira_fim'));
  const leitor=await cliente(t,sock,{email:'beto@exemplo.com',nome:'Beto',convite:{agente:'falso',sessao:conv.sessao,cwd:'/tmp',modo:'ler'}});
  await leitor.pedir('abrir',{agente:'falso',sessao:conv.sessao});await leitor.pedir('assinar',{agente:'falso',sessao:conv.sessao,desde:0});
  await leitor.pedir('nota',{agente:'falso',sessao:conv.sessao,texto:'acho que o preço tá alto',apos:1});
  await assert.rejects(leitor.pedir('nota',{agente:'falso',sessao:conv.sessao,texto:'   '}),/vazia/);
  await dono.ate(()=>dono.eventos.some(e=>e.update.sessionUpdate==='ratoeira_nota'));
  const n=dono.eventos.find(e=>e.update.sessionUpdate==='ratoeira_nota').update.nota;
  assert.equal(n.texto,'acho que o preço tá alto');assert.equal(n.autor.nome,'Beto');assert.equal(n.apos,1);
  // o agente não viu: a próxima resposta só ecoa a mensagem nova
  await dono.pedir('enviar',{agente:'falso',sessao:conv.sessao,texto:'segue'});
  await dono.ate(()=>dono.eventos.filter(e=>e.update.sessionUpdate==='ratoeira_fim').length===2);
  assert.ok(!textos(dono.eventos,'agent_message_chunk').some(t=>t.includes('preço')));
  // reabrir (o servidor solta e carrega de novo do histórico do agente): a nota volta
  s.conversas.get('falso:'+conv.sessao).solta=true;
  const outro=await cliente(t,sock,{email:'ana@exemplo.com',nome:'Ana'});
  await outro.pedir('abrir',{agente:'falso',sessao:conv.sessao,cwd:'/tmp'});await outro.pedir('assinar',{agente:'falso',sessao:conv.sessao,desde:0});
  await outro.ate(()=>outro.eventos.some(e=>e.update.sessionUpdate==='ratoeira_nota'));
});

test('avisos pro gateway: terminou e esperando, com quem estava vendo',async t=>{
  const {sock}=await subir(t);
  const pegar=async desde=>{const http=await import('node:http');return new Promise((ok,no)=>{http.get({socketPath:sock,path:'/avisos?desde='+desde},res=>{let d='';res.on('data',x=>d+=x);res.on('end',()=>ok(JSON.parse(d)));}).on('error',no);});};
  const dono=await cliente(t,sock,{email:'ana@exemplo.com',nome:'Ana'});
  const conv=await dono.pedir('nova',{agente:'falso',cwd:'/tmp'});
  const zero=await pegar(0);assert.equal(zero.seq,0);assert.ok(zero.inicio);
  // ninguém assinado: terminou sem ninguém vendo
  await dono.pedir('enviar',{agente:'falso',sessao:conv.sessao,texto:'oi'});
  for(let i=0;i<100&&(await pegar(0)).seq<1;i++)await new Promise(r=>setTimeout(r,30));
  const a=(await pegar(0)).avisos;assert.equal(a[0].tipo,'terminou');assert.deepEqual(a[0].vendo,[]);assert.equal(a[0].por,'ana@exemplo.com');
  // conversa nova, sem nome ainda: vai o começo do pedido, pro aviso não sair sem nome
  assert.equal(a[0].titulo,'oi');
  // vendo e pedindo permissão: esperando, com o dono na lista
  await dono.pedir('assinar',{agente:'falso',sessao:conv.sessao,desde:0});
  await dono.pedir('enviar',{agente:'falso',sessao:conv.sessao,texto:'pode apagar? permissão'});
  await dono.ate(()=>dono.eventos.some(e=>e.update.sessionUpdate==='ratoeira_pedido'));
  const b=(await pegar(1)).avisos;assert.equal(b.length,1);assert.equal(b[0].tipo,'esperando');assert.deepEqual(b[0].vendo,['ana@exemplo.com']);
});

test('avisos das rotinas: o arquivo que o ratoeira-rotina deixa entra na fila como rotina e sai da pasta',async t=>{
  const {writeFileSync,mkdirSync,readdirSync}=await import('node:fs');
  const dir=mkdtempSync(path.join(tmpdir(),'titulos-')),pasta=path.join(dir,'avisos-rotina');
  const {sock}=await subir(t,{arquivoTitulos:path.join(dir,'titulos.json')});
  const pegar=async desde=>{const http=await import('node:http');return new Promise((ok,no)=>{http.get({socketPath:sock,path:'/avisos?desde='+desde},res=>{let d='';res.on('data',x=>d+=x);res.on('end',()=>ok(JSON.parse(d)));}).on('error',no);});};
  mkdirSync(pasta,{recursive:true});
  writeFileSync(path.join(pasta,'1-leads.json'),JSON.stringify({rotina:'leads',nome:'Leads da semana',motivo:'chama',texto:'aprovo os 3 e-mails?',agente:'claude',sessao:'abc',titulo:'Rotina: Leads da semana · 16/10 11:00 UTC'}));
  writeFileSync(path.join(pasta,'2-backup.json'),JSON.stringify({rotina:'backup',nome:'Backup',motivo:'falhou',texto:'pasta não existe',agente:null,sessao:null}));
  writeFileSync(path.join(pasta,'3-lixo.json'),'{nao é json');
  const r=await pegar(0);
  assert.equal(r.avisos.length,2);
  assert.deepEqual(r.avisos.map(a=>[a.tipo,a.motivo,a.rotina]),[['rotina','chama','Leads da semana'],['rotina','falhou','Backup']]);
  assert.equal(r.avisos[0].texto,'aprovo os 3 e-mails?');assert.equal(r.avisos[0].sessao,'abc');assert.equal(r.avisos[1].sessao,null);
  assert.deepEqual(readdirSync(pasta),[]);
  assert.equal((await pegar(r.seq)).avisos.length,0);
});

test('fila: espera o turno acabar e vai sozinha; quem escreveu ou o dono tira; parar pausa a fila; digitando chega nos outros',async t=>{
  const {sock}=await subir(t);
  const dono=await cliente(t,sock,{email:'ana@exemplo.com',nome:'Ana'});
  const conv=await dono.pedir('nova',{agente:'falso',cwd:'/tmp'});const S={agente:'falso',sessao:conv.sessao};
  await dono.pedir('assinar',{...S,desde:0});
  await postar(sock,'/compartilhada',{...S,ligar:true});
  const caio=await cliente(t,sock,{email:'caio@exemplo.com',nome:'Caio',convite:{...S,cwd:'/tmp',modo:'entrar'}});
  await caio.pedir('abrir',S);await caio.pedir('assinar',{...S,desde:0});
  const leitor=await cliente(t,sock,{email:'beto@exemplo.com',nome:'Beto',convite:{...S,cwd:'/tmp',modo:'ler'}});
  await leitor.pedir('abrir',S);await leitor.pedir('assinar',{...S,desde:0});
  const fila=c=>c.eventos.filter(e=>e.update.sessionUpdate==='ratoeira_fila').at(-1)?.update;
  await dono.pedir('enviar',{...S,texto:'demorar'});
  await dono.ate(()=>dono.estados.some(e=>e.estado==='rodando'));
  const {item:primeira}=await caio.pedir('enfileirar',{...S,texto:'na fila 1'});
  await assert.rejects(leitor.pedir('enfileirar',{...S,texto:'eu também'}),/só pra leitura|dono/);
  const {item:segunda}=await dono.pedir('enfileirar',{...S,texto:'na fila 2'});
  await dono.ate(()=>fila(dono)?.fila.length===2);
  assert.equal(fila(dono).fila[0].autor.nome,'Caio');assert.equal(fila(dono).fila[0].texto,'na fila 1');
  await assert.rejects(caio.pedir('fila-tirar',{...S,item:segunda}),/Só quem escreveu/);
  await dono.pedir('fila-tirar',{...S,item:segunda});
  await dono.ate(()=>fila(dono)?.fila.length===1);
  // o turno acaba: a da fila vai sozinha, com o nome de quem escreveu
  await dono.pedir('enviar',{...S,texto:'termina'});
  await dono.ate(()=>textos(dono.eventos,'agent_message_chunk').includes('eco: [Caio]: na fila 1'));
  await dono.ate(()=>fila(dono)?.fila.length===0);
  assert.ok(primeira);
  // parar pausa a fila; "mandar agora" destrava
  await dono.ate(()=>dono.estados.at(-1)?.estado==='livre');
  await dono.pedir('enviar',{...S,texto:'demorar'});
  await dono.ate(()=>dono.estados.at(-1)?.estado==='rodando');
  const {item:pausada}=await caio.pedir('enfileirar',{...S,texto:'depois do parar'});
  await dono.pedir('cancelar',S);
  await dono.ate(()=>fila(dono)?.parada===true);
  await new Promise(r=>setTimeout(r,300));
  assert.ok(!textos(dono.eventos,'agent_message_chunk').includes('eco: [Caio]: depois do parar'));
  await caio.pedir('fila-agora',{...S,item:pausada});
  await dono.ate(()=>textos(dono.eventos,'agent_message_chunk').includes('eco: [Caio]: depois do parar'));
  // digitando: vai pros outros, não volta pra quem digita
  await caio.pedir('digitando',{...S,ativo:true});
  await dono.ate(()=>dono.digitandos.some(d=>d.pessoa.nome==='Caio'&&d.ativo));
  await leitor.ate(()=>leitor.digitandos.length>0);
  assert.equal(caio.digitandos.length,0);
});

test('enviar pela Mesa: em partes, commit no nome da pessoa, pesado fora do git, mesmo nome pergunta, caminho torto não',async t=>{
  const {execFileSync}=await import('node:child_process');
  const {mkdirSync,writeFileSync,symlinkSync,existsSync,readdirSync}=await import('node:fs');
  const raiz=mkdtempSync(path.join(tmpdir(),'enviar-')),home=mkdtempSync(path.join(tmpdir(),'home-'));
  const git=(...a)=>execFileSync('git',['-C',raiz,...a],{encoding:'utf8'});
  git('init','-q');git('config','user.name','Beto');git('config','user.email','beto@exemplo.com');
  mkdirSync(path.join(raiz,'docs'));writeFileSync(path.join(raiz,'docs','a.md'),'a');
  mkdirSync(path.join(raiz,'..',path.basename(raiz)+'-fora'),{recursive:true});
  symlinkSync(path.join(raiz,'..',path.basename(raiz)+'-fora'),path.join(raiz,'midia'));
  git('add','-A');git('commit','-qm','início');
  const {s,sock}=await subir(t,{contas:{home}});const c=await cliente(t,sock);
  const enviar=async(caminho,conteudo,extra={})=>{
    const buf=Buffer.from(conteudo);const r=await c.pedir('arquivo-enviar',{raiz,caminho,tamanho:buf.length,...extra});
    if(r.existe)return r;
    for(let pos=0;pos<buf.length;pos+=4)await c.pedir('arquivo-parte',{envio:r.envio,pos,dados:buf.subarray(pos,pos+4).toString('base64')});
    return c.pedir('arquivo-concluir',{envio:r.envio});
  };
  // texto numa pasta nova (veio de arrastar uma pasta): nasce a pasta, commit no nome da pessoa
  const r1=await enviar('docs/novo/relatorio.md','# relatório\n');
  assert.equal(r1.caminho,'docs/novo/relatorio.md');assert.equal(r1.pesado,false);assert.ok(r1.commit);
  assert.equal(git('log','-1','--format=%an|%s').trim(),'Beto|Enviado na tela: docs/novo/relatorio.md');
  // mesmo nome: pergunta; manter os dois dá (2); substituir troca
  assert.deepEqual(await enviar('docs/a.md','b'),{existe:true});
  assert.equal((await enviar('docs/a.md','b',{seExistir:'manter'})).caminho,'docs/a (2).md');
  await enviar('docs/a.md','c',{seExistir:'substituir'});
  assert.equal(readFileSync(path.join(raiz,'docs','a.md'),'utf8'),'c');
  // pesado: fica no disco, fora do git, e o .gitignore ganha o bloco num commit à parte
  const r2=await enviar('videos/aula.MOV','não é vídeo de verdade');
  assert.equal(r2.pesado,true);assert.ok(r2.commit,'commit do .gitignore');
  assert.ok(existsSync(path.join(raiz,'videos','aula.MOV')));
  assert.equal(git('ls-files','videos').trim(),'');
  assert.match(git('log','-1','--format=%s').trim(),/^Pesado fora do git \(videos\/aula\.MOV\): \.gitignore$/);
  // caminho torto, oculto, dentro de atalho: recusa
  for(const caminho of ['../fora.txt','docs/../x','.env','docs/.git/x','midia/x.png','docs/a.md/x'])
    await assert.rejects(c.pedir('arquivo-enviar',{raiz,caminho,tamanho:1}),/inválido|atalho|não uma pasta/,caminho);
  await assert.rejects(c.pedir('arquivo-enviar',{raiz,caminho:'x.bin',tamanho:3*1024**3}),/2 GB/);
  // parte fora de ordem e concluir antes da hora: recusa; cancelar limpa o rascunho
  const r3=await c.pedir('arquivo-enviar',{raiz,caminho:'docs/meio.txt',tamanho:10});
  await assert.rejects(c.pedir('arquivo-parte',{envio:r3.envio,pos:4,dados:'eHg='}),/fora de ordem/);
  await assert.rejects(c.pedir('arquivo-concluir',{envio:r3.envio}),/inteiro/);
  assert.equal(s.estado().ocupado,true,'envio pela metade segura o servidor ligado');
  await c.pedir('arquivo-cancelar',{envio:r3.envio});
  assert.equal(readdirSync(path.join(home,'.cache','ratoeira','envios')).length,0);
  assert.ok(!existsSync(path.join(raiz,'docs','meio.txt')),'arquivo pela metade nunca aparece');
  // outra conexão não mexe no envio de ninguém, e a conexão que cai leva o rascunho junto
  const r4=await c.pedir('arquivo-enviar',{raiz,caminho:'docs/outro.txt',tamanho:2});
  const c2=await cliente(t,sock);
  await assert.rejects(c2.pedir('arquivo-parte',{envio:r4.envio,pos:0,dados:'eHg='}),/não encontrado/);
  c.ws.close();await c2.ate(()=>!s.estado().ocupado);
  assert.equal(readdirSync(path.join(home,'.cache','ratoeira','envios')).length,0);
});

test('anexo do chat: grava fora do git com nome limpo, a pasta entra na conversa, recusa vazio e grande demais, apaga o velho',async t=>{
  const {mkdirSync,existsSync,statSync}=await import('node:fs');
  const {MAX_ANEXO,nomeAnexo}=await import('../servidor.mjs');
  const home=mkdtempSync(path.join(tmpdir(),'home-'));
  const pasta=path.join(home,'.local','share','ratoeira','anexos');mkdirSync(path.join(pasta,'2020-01-01'),{recursive:true});
  const {sock}=await subir(t,{contas:{home,clis:{},runner:'/bin/true',python:'/bin/true',geralFixa:false}});const c=await cliente(t,sock);
  const r=await c.pedir('anexo',{nome:'../../Relatório final.pdf',dados:Buffer.from('%PDF-1.4 oi').toString('base64')});
  assert.equal(r.nome,'Relatório final.pdf');assert.equal(r.tamanho,11);
  assert.ok(r.caminho.startsWith(pasta+'/')&&r.caminho.endsWith('-Relatório final.pdf'),r.caminho);
  assert.equal(readFileSync(r.caminho,'utf8'),'%PDF-1.4 oi');
  assert.equal(statSync(r.caminho).mode&0o777,0o600,'só a pessoa lê');
  assert.ok(!existsSync(path.join(pasta,'2020-01-01')),'o dia de mais de 30 dias foi embora');
  await assert.rejects(c.pedir('anexo',{nome:'x.pdf',dados:''}),/vazio/);
  await assert.rejects(c.pedir('anexo',{nome:'x.pdf',dados:'A'.repeat(Math.ceil(MAX_ANEXO*4/3)+8)}),/passa de/);
  assert.equal(nomeAnexo('.env'),'env');assert.equal(nomeAnexo('a\nb.txt'),'ab.txt');assert.equal(nomeAnexo(''),'arquivo');
  // a pasta dos anexos vai pra conversa como pasta extra: o agente lê sem pedir permissão
  const conv=await c.pedir('nova',{agente:'falso',cwd:'/tmp'});
  await c.pedir('assinar',{agente:'falso',sessao:conv.sessao,desde:0});
  await c.pedir('enviar',{agente:'falso',sessao:conv.sessao,texto:'pastas?'});
  await c.ate(()=>textos(c.eventos,'agent_message_chunk').some(x=>x?.startsWith('pastas:')));
  assert.ok(textos(c.eventos,'agent_message_chunk').includes('pastas: '+pasta));
  // convidado que só lê não manda anexo
  await postar(sock,'/compartilhada',{agente:'falso',sessao:conv.sessao,compartilhada:true}).catch(()=>{});
  const leitor=await cliente(t,sock,{email:'b@x.com',nome:'B',convite:{agente:'falso',sessao:conv.sessao,cwd:'/tmp',modo:'ler'}});
  await assert.rejects(leitor.pedir('anexo',{agente:'falso',sessao:conv.sessao,nome:'a.txt',dados:'b2k='}));
  const entra=await cliente(t,sock,{email:'c@x.com',nome:'C',convite:{agente:'falso',sessao:conv.sessao,cwd:'/tmp',modo:'entrar'}});
  assert.equal((await entra.pedir('anexo',{agente:'falso',sessao:conv.sessao,nome:'a.txt',dados:'b2k='})).tamanho,2);
});

test('esquecerLoginClaudeAi tira só a marca de "precisa de login" dos conectores do claude.ai', async()=>{
  const {esquecerLoginClaudeAi}=await import('../servidor.mjs');
  const {writeFileSync}=await import('node:fs');
  const dir=mkdtempSync(path.join(tmpdir(),'claude-cfg-'));
  assert.equal(esquecerLoginClaudeAi(dir),0);  // sem arquivo, nada
  const arq=path.join(dir,'mcp-needs-auth-cache.json');
  writeFileSync(arq,JSON.stringify({'claude.ai Notion':{timestamp:1,id:'mcpsrv_1'},'claude.ai Canva':{timestamp:2},'Supabase':{timestamp:3}}));
  assert.equal(esquecerLoginClaudeAi(dir),2);
  assert.deepEqual(JSON.parse(readFileSync(arq,'utf8')),{'Supabase':{timestamp:3}});
  assert.equal(esquecerLoginClaudeAi(dir),0);
  writeFileSync(arq,'{quebrado');assert.equal(esquecerLoginClaudeAi(dir),0);
});

test('prepararDirConta: login e .claude.json da conta, o resto aponta pro ~/.claude (e apagar não leva o histórico)', async()=>{
  const {prepararDirConta}=await import('../servidor.mjs');
  const {writeFileSync,mkdirSync,lstatSync,readlinkSync,existsSync,rmSync}=await import('node:fs');
  const home=mkdtempSync(path.join(tmpdir(),'home-conta-'));const base=path.join(home,'.claude');
  mkdirSync(path.join(base,'projects','p'),{recursive:true});writeFileSync(path.join(base,'projects','p','s.jsonl'),'{}');
  writeFileSync(path.join(base,'settings.json'),'{}');writeFileSync(path.join(base,'.credentials.json'),'{"claudeAiOauth":{"a":1}}');
  writeFileSync(path.join(base,'mcp-needs-auth-cache.json'),'{}');mkdirSync(path.join(base,'cache'));
  writeFileSync(path.join(home,'.claude.json'),JSON.stringify({oauthAccount:{emailAddress:'eu@x'},mcpServers:{c7:{type:'http'}},projects:{'/srv':{}},cachedGrowthBookFeatures:{a:1}}));
  const dir=path.join(home,'.config','ratoeira','claude-contas','abc');
  prepararDirConta(dir,home);
  assert.equal(readlinkSync(path.join(dir,'projects')),path.join(base,'projects'));
  assert.equal(readlinkSync(path.join(dir,'settings.json')),path.join(base,'settings.json'));
  for(const n of ['.credentials.json','mcp-needs-auth-cache.json','cache'])assert.equal(existsSync(path.join(dir,n)),false,n);
  const cj=JSON.parse(readFileSync(path.join(dir,'.claude.json'),'utf8'));
  assert.deepEqual(Object.keys(cj).sort(),['mcpServers','projects']);       // nada da conta principal (oauthAccount, caches)
  // a conta grava o dela; MCP novo no principal entra, o dela fica
  writeFileSync(path.join(dir,'.claude.json'),JSON.stringify({...cj,oauthAccount:{emailAddress:'outra@x'},mcpServers:{...cj.mcpServers,meu:{}}}));
  writeFileSync(path.join(home,'.claude.json'),JSON.stringify({mcpServers:{c7:{type:'http'},novo:{}}}));
  mkdirSync(path.join(base,'skills'));
  prepararDirConta(dir,home);
  const cj2=JSON.parse(readFileSync(path.join(dir,'.claude.json'),'utf8'));
  assert.equal(cj2.oauthAccount.emailAddress,'outra@x');
  assert.deepEqual(Object.keys(cj2.mcpServers).sort(),['c7','meu','novo']);
  assert.ok(lstatSync(path.join(dir,'skills')).isSymbolicLink());          // o que apareceu depois ganha o atalho
  rmSync(dir,{recursive:true,force:true});                                 // o que o removerPessoal faz
  assert.ok(existsSync(path.join(base,'projects','p','s.jsonl')));
});

// login completo de uma conta pessoal (claude-conta): o login comum, gravado numa pasta de config só dela
function loginHttp(sock,caminho){
  const linhas=[];let fluxo;
  const fim=new Promise((resolve,reject)=>{
    const req=http.request({socketPath:sock,method:'POST',path:caminho},res=>{
      if(res.statusCode!==200){res.resume();return resolve(res.statusCode);}
      let resto='';
      res.on('data',d=>{resto+=d;let i;while((i=resto.indexOf('\n'))>=0){const o=JSON.parse(resto.slice(0,i));resto=resto.slice(i+1);linhas.push(o);if(o.fluxo)fluxo=o.fluxo;}});
      res.on('end',()=>resolve(200));
    });req.on('error',reject);req.end();
  });
  const responder=async codigo=>{
    const lim=Date.now()+5000;while(!linhas.some(l=>l.saida?.includes('Paste code'))){if(Date.now()>lim)throw new Error('não chegou');await new Promise(r=>setTimeout(r,20));}
    await pedirHttp(sock,'POST',`/conta/fluxo/${fluxo}/entrada`,codigo);await pedirHttp(sock,'POST',`/conta/fluxo/${fluxo}/entrada`,'\r');
    await fim;return linhas.at(-1).fim;
  };
  return {fim,responder};
}
test('conta pessoal com login completo: entra na pasta dela, vale como CLAUDE_CONFIG_DIR, e a do token vira completa ao entrar de novo',async t=>{
  const antes={tk:process.env.CLAUDE_CODE_OAUTH_TOKEN,dir:process.env.CLAUDE_CONFIG_DIR};
  t.after(()=>{for(const [k,v] of [['CLAUDE_CODE_OAUTH_TOKEN',antes.tk],['CLAUDE_CONFIG_DIR',antes.dir]])if(v===undefined)delete process.env[k];else process.env[k]=v;});
  const {sock,home}=await subirContas(t,{grupos:['ratoeira-claude']});
  mkdirSync(path.join(home,'.claude','projects'),{recursive:true});escrever(path.join(home,'.claude.json'),'{"mcpServers":{"c7":{}}}');
  const pess=path.join(home,'.config','ratoeira','claude-contas');
  // nova: login recusado não deixa nada pra trás
  let l=loginHttp(sock,'/conta/claude-conta/login?nome=Startup');
  assert.equal(await l.responder('recusar'),1);
  assert.deepEqual(JSON.parse((await pedirHttp(sock,'GET','/conta/claude/contas')).corpo).contas,[]);
  // nova: login aceito vira conta pessoal completa, com a pasta montada
  l=loginHttp(sock,'/conta/claude-conta/login?nome=Startup');
  assert.equal(await l.responder('codigo-123'),0);
  let r=JSON.parse((await pedirHttp(sock,'GET','/conta/claude/contas')).corpo);
  const nova=r.contas.find(c=>c.nome==='Startup');assert.equal(nova.completa,true);assert.equal(nova.tipo,'pessoal');
  const dir=path.join(pess,nova.id.slice(8));
  assert.ok(readFileSync(path.join(dir,'.credentials.json'),'utf8').includes('claudeAiOauth'));
  assert.equal(existsSync(path.join(home,'.claude','.credentials.json')),false);   // a própria não foi tocada
  // usar: o servidor passa a ter a pasta e não tem token
  process.env.CLAUDE_CODE_OAUTH_TOKEN='sk-ant-oat01-'+'x'.repeat(24);
  r=JSON.parse((await pedirHttp(sock,'POST','/conta/claude/usar',JSON.stringify({conta:nova.id}))).corpo);
  assert.equal(process.env.CLAUDE_CONFIG_DIR,dir);assert.equal(process.env.CLAUDE_CODE_OAUTH_TOKEN,undefined);
  assert.equal(JSON.parse((await pedirHttp(sock,'GET','/conta/claude/status')).corpo).stdout.includes('pessoa@exemplo.com'),true);
  // a do jeito antigo (token) vira completa quando entra de novo nela, e o token sai
  r=JSON.parse((await pedirHttp(sock,'POST','/conta/claude/pessoais',JSON.stringify({nome:'Velha',token:'sk-ant-oat01-'+'v'.repeat(24)}))).corpo);
  const velha=r.contas.find(c=>c.nome==='Velha');assert.equal(velha.completa,false);
  l=loginHttp(sock,'/conta/claude-conta/login?id='+velha.id.slice(8));
  assert.equal(await l.responder('codigo-456'),0);
  r=JSON.parse((await pedirHttp(sock,'GET','/conta/claude/contas')).corpo);
  assert.equal(r.contas.find(c=>c.id===velha.id).completa,true);
  assert.equal(existsSync(path.join(pess,velha.id.slice(8)+'.token')),false);
  // remover a que vale: a pasta sai, o histórico fica, e o servidor larga a pasta
  await pedirHttp(sock,'POST',`/conta/claude/pessoais/${nova.id.slice(8)}/remover`);
  assert.equal(existsSync(dir),false);assert.ok(existsSync(path.join(home,'.claude','projects')));
  assert.notEqual(process.env.CLAUDE_CONFIG_DIR,dir);
});

// Ultracode por conversa (desde 16/10/2026): vai nas configurações da sessão quando ela abre; ligar ou desligar
// faz a conversa dormir e acordar com o mesmo histórico, como a troca de conta.
test('ultracode por conversa: nasce ligado se pedido, liga e desliga dormindo e acordando, e fica gravado',async t=>{
  const home=mkdtempSync(path.join(tmpdir(),'home-'));
  const ags=new Map([['claude',{id:'claude',nome:'Claude',comando:process.execPath,args:[falso],env:{},modoAutomatico:'auto'}]]);
  const {sock}=await subir(t,{agentes:ags,contas:{clis:{claude:claudeFalso,codex:null},runner,python:'python3',home,geralFixa:false,grupos:['ratoeira-claude'],
    geralClaude:path.join(home,'sem-geral.token'),orgClaude:path.join(home,'sem-org'),geralCodex:path.join(home,'sem-geral-codex.json')}});
  const c=await cliente(t,sock);
  const perguntar=async sessao=>{const antes=c.eventos.length;await c.pedir('enviar',{agente:'claude',sessao,texto:'ultracode?'});
    await c.ate(()=>c.eventos.slice(antes).some(e=>e.sessao===sessao&&e.update.sessionUpdate==='agent_message_chunk'&&e.update.content?.text?.startsWith('ultracode:')));
    return c.eventos.slice(antes).filter(e=>e.sessao===sessao&&e.update.content?.text?.startsWith('ultracode:')).at(-1).update.content.text;};
  const x=await c.pedir('nova',{agente:'claude',cwd:'/tmp',ultracode:true});assert.equal(x.ultracode,true);
  const y=await c.pedir('nova',{agente:'claude',cwd:'/tmp'});assert.equal(y.ultracode,false);
  for(const s of [x,y])await c.pedir('assinar',{agente:'claude',sessao:s.sessao,desde:0});
  assert.equal(await perguntar(x.sessao),'ultracode: sim');assert.equal(await perguntar(y.sessao),'ultracode: nao');
  const arq=path.join(home,'.local','state','ratoeira','ultracode-conversa.json');
  assert.equal(JSON.parse(readFileSync(arq,'utf8'))[x.sessao],true);
  // desligar: avisa quem está com ela aberta e a próxima mensagem já vai sem; a outra conversa não muda.
  // O modelo escolhido volta depois de acordar (o agente acorda no padrão)
  await c.pedir('opcao',{agente:'claude',sessao:x.sessao,opcao:'model',valor:'b'});
  const r=await c.pedir('conversa-ultracode',{agente:'claude',sessao:x.sessao,ligar:false});assert.equal(r.ultracode,false);
  assert.ok(c.eventos.some(e=>e.sessao===x.sessao&&e.update.sessionUpdate==='ratoeira_ultracode'&&e.update.ultracode===false));
  assert.equal(await perguntar(x.sessao),'ultracode: nao');
  assert.equal((await c.pedir('abrir',{agente:'claude',sessao:x.sessao})).config.configOptions.find(o=>o.id==='model').currentValue,'b');
  assert.equal(JSON.parse(readFileSync(arq,'utf8'))[x.sessao],undefined);
  // ligar na outra
  await c.pedir('conversa-ultracode',{agente:'claude',sessao:y.sessao,ligar:true});
  assert.equal(await perguntar(y.sessao),'ultracode: sim');
  // rodando: não troca
  await c.pedir('enviar',{agente:'claude',sessao:y.sessao,texto:'demorar'});
  await assert.rejects(c.pedir('conversa-ultracode',{agente:'claude',sessao:y.sessao,ligar:false}),/Espere a resposta terminar/);
  await c.pedir('cancelar',{agente:'claude',sessao:y.sessao});
});

// Conta por conversa (desde 16/10/2026): um adaptador por conta, e a conversa troca de conta dormindo numa e acordando na outra.
test('conta por conversa: cada conversa no adaptador da sua conta, troca sem mexer nas outras, e a padrão só vale pras novas',async t=>{
  const home=mkdtempSync(path.join(tmpdir(),'home-'));const pess=path.join(home,'.config','ratoeira','claude-contas');
  mkdirSync(pess,{recursive:true});escrever(path.join(pess,'contas.tsv'),'aaa\tConta A\nbbb\tConta B\n');
  for(const id of ['aaa','bbb']){mkdirSync(path.join(pess,id));escrever(path.join(pess,id,'.credentials.json'),'{"claudeAiOauth":{}}');}
  const ags=new Map([['claude',{id:'claude',nome:'Claude',comando:process.execPath,args:[falso],env:{},modoAutomatico:'auto'}]]);
  const abertos=[];
  const abrirProcesso=def=>{abertos.push(def.env.CLAUDE_CONFIG_DIR?.split('/').pop()??null);const env={...process.env,...def.env};for(const k of Object.keys(env))if(env[k]==null)delete env[k];return spawn(def.comando,def.args,{env,stdio:['pipe','pipe','pipe']});};
  const {sock}=await subir(t,{agentes:ags,abrirProcesso,contas:{clis:{claude:claudeFalso,codex:null},runner,python:'python3',home,geralFixa:false,grupos:['ratoeira-claude'],
    geralClaude:path.join(home,'sem-geral.token'),orgClaude:path.join(home,'sem-org'),geralCodex:path.join(home,'sem-geral-codex.json')}});
  const c=await cliente(t,sock);
  const conversar=async(sessao,texto)=>{await c.pedir('enviar',{agente:'claude',sessao,texto});await c.ate(()=>textos(c.eventos.filter(e=>e.sessao===sessao),'agent_message_chunk').some(x=>x.endsWith(texto)));};
  // sem escolha: a padrão é a primeira; pedida, a outra
  const x=await c.pedir('nova',{agente:'claude',cwd:'/tmp'});assert.equal(x.conta,'pessoal:aaa');
  const y=await c.pedir('nova',{agente:'claude',cwd:'/tmp',conta:'pessoal:bbb'});assert.equal(y.conta,'pessoal:bbb');
  assert.deepEqual(abertos,['aaa','bbb']);   // um processo por conta
  // a lista de modelos é a de cada conta (a criada por último, na B, não vira a da A)
  const modelos=async conta=>(await c.pedir('opcoes',{agente:'claude',cwd:'/tmp',...(conta?{conta}:{})})).configOptions[0].options.map(o=>o.value);
  assert.deepEqual(await modelos(),['a','b','so-aaa']);
  assert.deepEqual(await modelos('pessoal:bbb'),['a','b','so-bbb']);
  for(const s of [x,y])await c.pedir('assinar',{agente:'claude',sessao:s.sessao,desde:0});
  await conversar(x.sessao,'um');await conversar(y.sessao,'dois');
  const resp=s=>textos(c.eventos.filter(e=>e.sessao===s),'agent_message_chunk');
  assert.deepEqual(resp(x.sessao),['eco: [aaa] um']);assert.deepEqual(resp(y.sessao),['eco: [bbb] dois']);
  // trocar a da x pra B: avisa quem está com ela aberta, e a próxima mensagem sai pela B; a y nem percebe
  const r=await c.pedir('conversa-conta',{agente:'claude',sessao:x.sessao,conta:'pessoal:bbb'});assert.equal(r.conta,'pessoal:bbb');
  assert.ok(c.eventos.some(e=>e.sessao===x.sessao&&e.update.sessionUpdate==='ratoeira_conta'&&e.update.conta==='pessoal:bbb'));
  await conversar(x.sessao,'tres');assert.equal(resp(x.sessao).at(-1),'eco: [bbb] tres');
  await conversar(y.sessao,'quatro');assert.equal(resp(y.sessao).at(-1),'eco: [bbb] quatro');
  assert.deepEqual(abertos,['aaa','bbb']);   // não abriu processo novo: a B já estava de pé
  // gravada pra reabrir nela depois
  assert.equal(JSON.parse(readFileSync(path.join(home,'.local','state','ratoeira','conta-conversa.json'),'utf8'))[x.sessao],'pessoal:bbb');
  // conta que não existe: recusa
  await assert.rejects(c.pedir('conversa-conta',{agente:'claude',sessao:x.sessao,conta:'pessoal:zzz'}),/não está disponível/);
  // a padrão muda só as novas, mesmo com conversa aberta
  const l=await c.pedir('conta-usar',{agente:'claude',conta:'pessoal:bbb'});assert.equal(l.ativa,'pessoal:bbb');assert.equal(l.podeTrocar,true);
  assert.equal((await c.pedir('nova',{agente:'claude',cwd:'/tmp'})).conta,'pessoal:bbb');
});

// Várias contas do Codex (desde 28/10/2026): cada conta é uma pasta de config (CODEX_HOME) com atalhos pro ~/.codex, e os
// bancos ficam no ~/.codex (CODEX_SQLITE_HOME), então as conversas são as mesmas em todas as contas.
test('contas do Codex: própria, pessoal e da organização, cada conversa na sua, com a pasta e o login certos',async t=>{
  const fs=await import('node:fs');
  const home=mkdtempSync(path.join(tmpdir(),'home-')),org=mkdtempSync(path.join(tmpdir(),'org-codex-'));
  const login=JSON.stringify({tokens:{refresh_token:'r'}});
  mkdirSync(path.join(home,'.codex'));escrever(path.join(home,'.codex','auth.json'),login);escrever(path.join(home,'.codex','config.toml'),'model = "x"\n');
  escrever(path.join(home,'.codex','state_5.sqlite'),'');
  const pess=path.join(home,'.config','ratoeira','codex-contas');mkdirSync(path.join(pess,'ppp'),{recursive:true});
  escrever(path.join(pess,'contas.tsv'),'ppp\tMinha Plus\nvazia\tSem login\n');escrever(path.join(pess,'ppp','auth.json'),login);
  escrever(path.join(org,'contas.tsv'),'o1\tTime 1\nfora\tSem acesso\n');mkdirSync(path.join(org,'o1'));escrever(path.join(org,'o1','auth.json'),login);
  const ags=new Map([['codex',{id:'codex',nome:'Codex',comando:process.execPath,args:[falso],env:{},modoAutomatico:'auto'}]]);
  const abertos=[];
  const abrirProcesso=def=>{abertos.push(def.env.CODEX_HOME?path.basename(def.env.CODEX_HOME):null);if(def.env.CODEX_HOME)assert.equal(def.env.CODEX_SQLITE_HOME,path.join(home,'.codex'));
    const env={...process.env,...def.env};for(const k of Object.keys(env))if(env[k]==null)delete env[k];return spawn(def.comando,def.args,{env,stdio:['pipe','pipe','pipe']});};
  const antes={h:process.env.CODEX_HOME,s:process.env.CODEX_SQLITE_HOME};
  t.after(()=>{for(const [k,v] of [['CODEX_HOME',antes.h],['CODEX_SQLITE_HOME',antes.s]])if(v===undefined)delete process.env[k];else process.env[k]=v;});
  const {sock}=await subir(t,{agentes:ags,abrirProcesso,contas:{clis:{claude:null,codex:null},runner,python:'python3',home,geralFixa:false,grupos:['ratoeira-codex'],
    geralClaude:path.join(home,'sem-geral.token'),orgClaude:path.join(home,'sem-org'),geralCodex:path.join(home,'sem-geral-codex.json'),orgCodex:org}});
  let r=JSON.parse((await pedirHttp(sock,'GET','/conta/codex/contas')).corpo);
  assert.deepEqual(r.contas.map(c=>[c.id,c.nome]),[['propria','Tua conta'],['pessoal:ppp','Minha Plus'],['org:o1','Time 1']]);   // sem login e sem arquivo ficam fora
  assert.equal(r.ativa,'propria');assert.equal(r.modo,'opcional');
  const c=await cliente(t,sock);
  const x=await c.pedir('nova',{agente:'codex',cwd:'/tmp'});assert.equal(x.conta,'propria');
  const y=await c.pedir('nova',{agente:'codex',cwd:'/tmp',conta:'org:o1'});assert.equal(y.conta,'org:o1');
  assert.deepEqual(abertos,[null,'org-o1']);   // a própria é o ~/.codex de sempre
  // a pasta da conta da organização: login como atalho pro arquivo de todos, o resto pro ~/.codex, e nada de banco
  const dirO=path.join(pess,'org-o1');
  assert.equal(fs.readlinkSync(path.join(dirO,'auth.json')),path.join(org,'o1','auth.json'));
  assert.equal(fs.readlinkSync(path.join(dirO,'config.toml')),path.join(home,'.codex','config.toml'));
  assert.equal(fs.existsSync(path.join(dirO,'state_5.sqlite')),false);
  // trocar a conta de uma conversa: abre o processo da outra conta e grava pra reabrir nela
  await c.pedir('assinar',{agente:'codex',sessao:x.sessao,desde:0});
  assert.equal((await c.pedir('conversa-conta',{agente:'codex',sessao:x.sessao,conta:'pessoal:ppp'})).conta,'pessoal:ppp');
  await c.pedir('enviar',{agente:'codex',sessao:x.sessao,texto:'oi'});
  await c.ate(()=>abertos.includes('ppp'));
  assert.equal(fs.readlinkSync(path.join(pess,'ppp','config.toml')),path.join(home,'.codex','config.toml'));
  assert.equal(fs.lstatSync(path.join(pess,'ppp','auth.json')).isFile(),true);   // o login da pessoal fica onde está
  assert.equal(JSON.parse(readFileSync(path.join(home,'.local','state','ratoeira','conta-conversa.json'),'utf8'))[x.sessao],'pessoal:ppp');
  await assert.rejects(c.pedir('conversa-conta',{agente:'codex',sessao:x.sessao,conta:'org:fora'}),/não está disponível/);
  // a padrão: grava a escolha e o terminal (ambiente do servidor) passa pra pasta dela
  r=await c.pedir('conta-usar',{agente:'codex',conta:'org:o1'});assert.equal(r.ativa,'org:o1');
  assert.equal(readFileSync(path.join(home,'.config','ratoeira','codex-conta'),'utf8').trim(),'org:o1');
  assert.equal(process.env.CODEX_HOME,dirO);
  assert.equal((await c.pedir('nova',{agente:'codex',cwd:'/tmp'})).conta,'org:o1');
  // remover a pessoal: sai da lista e a pasta some (sem apagar o que os atalhos apontam)
  r=JSON.parse((await pedirHttp(sock,'POST','/conta/codex/pessoais/ppp/remover')).corpo);
  assert.deepEqual(r.contas.map(c=>c.id),['propria','org:o1']);
  assert.equal(fs.existsSync(path.join(pess,'ppp')),false);assert.equal(fs.existsSync(path.join(home,'.codex','config.toml')),true);
});

// ── Trabalho no fundo e retomar (16/10/2026): a versão nova religou o servidor 9 s depois de o agente dizer
// "sigo quando os avisos chegarem" e matou os workflows da madrugada; o servidor novo não chamou ninguém.
test('conversa com comando ou workflow no fundo conta como ocupada e não dorme',async t=>{
  const {agentes:ag,contagem}=comContagem();
  let relogio=0,fundo=true;
  const {s,sock}=await subir(t,{agentes:ag,agora:()=>relogio,trabalhoNoFundo:()=>fundo});const c=await cliente(t,sock);
  const conv=await c.pedir('nova',{agente:'falso',cwd:'/tmp',texto:'oi'});
  await c.pedir('assinar',{agente:'falso',sessao:conv.sessao,desde:0});
  await c.ate(()=>c.eventos.some(e=>e.update.sessionUpdate==='ratoeira_fim'));
  assert.deepEqual([s.estado().ocupado,s.estado().noFundo,s.estado().conversasRodando],[true,1,0]);
  relogio=5*3600000;await s.dormirParadas();
  assert.ok(contagem().vivas.includes(conv.sessao),'com trabalho no fundo não dorme');
  fundo=false;
  assert.equal(s.estado().ocupado,false);
  await s.dormirParadas();
  assert.ok(!contagem().vivas.includes(conv.sessao),'acabou o fundo: dorme');
});

test('agente que volta a falar sozinho, sem turno aberto, conta como trabalho por 3 min',async t=>{
  let relogio=0;
  const {s,sock}=await subir(t,{agora:()=>relogio});const c=await cliente(t,sock);
  const conv=await c.pedir('nova',{agente:'falso',cwd:'/tmp',texto:'vai no fundo'});
  await c.pedir('assinar',{agente:'falso',sessao:conv.sessao,desde:0});
  await c.ate(()=>textos(c.eventos,'agent_message_chunk').includes('voltei sozinho'));
  assert.equal(s.estado().conversasRodando,0);assert.equal(s.estado().noFundo,1);
  relogio=3*60000;assert.equal(s.estado().ocupado,false);
});

test('retomar: a conversa que trabalhava volta sozinha no servidor novo, uma vez a cada 2 h',async t=>{
  const titulos=path.join(mkdtempSync(path.join(tmpdir(),'retomar-')),'titulos.json');
  const arq=path.join(path.dirname(titulos),'retomar.json');
  const um=await subir(t,{arquivoTitulos:titulos});const a=await cliente(t,um.sock);
  const conv=await a.pedir('nova',{agente:'falso',cwd:'/tmp',texto:'demorar'});
  await a.ate(()=>um.s.estado().conversasRodando===1);
  assert.equal(um.s.guardarRetomar('versão nova da Ratoeira'),1);
  assert.equal(JSON.parse(readFileSync(arq,'utf8')).conversas[0].sessao,conv.sessao);
  um.s.fechar();
  // o servidor novo abre a conversa e manda a mensagem automática, com o motivo
  const dois=await subir(t,{arquivoTitulos:titulos});
  assert.equal(await dois.s.retomar(),1);
  const b=await cliente(t,dois.sock);
  await b.pedir('assinar',{agente:'falso',sessao:conv.sessao,desde:0});
  await b.ate(()=>textos(b.eventos,'agent_message_chunk').some(x=>x?.startsWith('eco: ')&&x.includes('[Mensagem automática da Ratoeira]')));
  assert.ok(textos(b.eventos,'user_message_chunk').some(x=>x.includes('religou (versão nova da Ratoeira)')));
  const depois=JSON.parse(readFileSync(arq,'utf8'));
  assert.deepEqual(depois.conversas,[]);assert.ok(depois.retomadas['falso:'+conv.sessao]);
  // caiu de novo logo depois com ela na lista: não retoma (se é ela que derruba o servidor, não vira laço)
  writeFileSync(arq,JSON.stringify({...depois,conversas:[{agente:'falso',sessao:conv.sessao,cwd:'/tmp',mcp:[]}]}));
  const tres=await subir(t,{arquivoTitulos:titulos});
  assert.equal(await tres.s.retomar(),0);
});

test('rastros do Claude Code: comando vivo com a saída na pasta da conversa, arquivo mexido, pasta do projeto',async t=>{
  const {sessoesComComando,mexidoDesde,pastaDoProjeto}=await import('../servidor.mjs');
  const {spawn}=await import('node:child_process');const {openSync,mkdirSync,closeSync}=await import('node:fs');
  const sessao='0a1b2c3d-1111-2222-3333-444455556666';
  const tasks=path.join(mkdtempSync(path.join(tmpdir(),'fundo-')),'claude-999','-srv-x',sessao,'tasks');mkdirSync(tasks,{recursive:true});
  const fd=openSync(path.join(tasks,'b1.output'),'w');
  const filho=spawn('sleep',['30'],{stdio:['ignore',fd,'ignore']});closeSync(fd);
  t.after(()=>filho.kill());
  await new Promise(r=>setTimeout(r,5100));   // a lista de processos fica 5 s em cache
  assert.ok(sessoesComComando().has(sessao));
  assert.equal(mexidoDesde(path.dirname(tasks),0),true);
  assert.equal(mexidoDesde(path.dirname(tasks),Date.now()+60000),false);
  assert.equal(mexidoDesde('/não/existe',0),false);
  assert.equal(pastaDoProjeto('/srv/ratoeira/areas/trabalho'),'-srv-ratoeira-areas-trabalho');
});

test('memória apertada: conversa parada dorme com 10 min em vez de 60',async t=>{
  const {agentes:ag,contagem}=comContagem();
  let relogio=0,aperto=false;
  const {s,sock}=await subir(t,{agentes:ag,agora:()=>relogio,apertado:()=>aperto});const c=await cliente(t,sock);
  const conv=await c.pedir('nova',{agente:'falso',cwd:'/tmp',texto:'oi'});
  await c.pedir('assinar',{agente:'falso',sessao:conv.sessao,desde:0});
  await c.ate(()=>c.eventos.some(e=>e.update.sessionUpdate==='ratoeira_fim'));
  relogio=10*60000;await s.dormirParadas();
  assert.ok(contagem().vivas.includes(conv.sessao),'sem aperto: 10 min não basta');
  aperto=true;await s.dormirParadas();
  assert.ok(!contagem().vivas.includes(conv.sessao),'com aperto: dormiu');
});

test('texto da conversa pra ler_conversa: nome de cada um, notas no lugar, ferramenta numa linha, e corta o começo',()=>{
  const u=(sessionUpdate,extra={})=>({update:{sessionUpdate,...extra}});
  const txt=t=>({content:{type:'text',text:t}});
  const ev=[
    u('user_message_chunk',txt('<ratoeira-contexto>tela</ratoeira-contexto>\nfaz a landing')),
    u('agent_message_chunk',txt('Vou ')),u('agent_message_chunk',txt('fazer.')),
    u('tool_call',{toolCallId:'t1',title:'Edit',kind:'edit',rawInput:{file_path:'/srv/x/index.html'}}),
    u('tool_call_update',{toolCallId:'t1',status:'completed'}),
    u('user_message_chunk',{...txt('[Bia Souza]: e o preço?'),ratoeira_autor:{nome:'Bia Souza',email:'a@x'}}),
    u('agent_message_chunk',txt('R$ 97.')),
    u('user_message_chunk',txt('[Caio]: blz <ratoeira-durante>rodando</ratoeira-durante>')),
  ];
  const notas=[{apos:1,texto:'confere o preço',autor:{nome:'Ana'}},{apos:9,texto:'no fim',autor:{nome:'Ana'}}];
  const r=textoDaConversa(ev,notas,{dono:'Ana'});
  assert.equal(r.mensagens,3);
  assert.equal(r.texto,['[Ana]: faz a landing','[Agente]: Vou fazer.','(o agente usou Edit: /srv/x/index.html)',
    '(nota de Ana, o agente de lá não viu: confere o preço)','[Bia Souza]: e o preço?','[Agente]: R$ 97.','[Caio]: blz','(nota de Ana, o agente de lá não viu: no fim)'].join('\n\n'));
  const longo=textoDaConversa([u('user_message_chunk',txt('a'.repeat(500))),u('agent_message_chunk',txt('fim'))],[],{max:100});
  assert.ok(longo.texto.startsWith('(o começo foi cortado)'));assert.ok(longo.texto.endsWith('[Agente]: fim'));
  // contexto copiado de outra conversa vira uma linha, não o texto inteiro de novo
  const copia=textoDaConversa([u('user_message_chunk',txt('<ratoeira-copia de="Caio" titulo="LP" mensagens="3">\nmuito texto\n</ratoeira-copia>\nsegue'))]);
  assert.equal(copia.texto,'[Dono]: (contexto copiado da conversa "LP", de Caio)\nsegue');
});

test('ler-conversa: devolve o texto da aberta; a que não estava aberta carrega, volta a dormir e o dono abre depois com as ferramentas dele',async t=>{
  delete process.env.CLAUDE_CONFIG_DIR;   // o teste da conta por conversa deixa a dele no ambiente, e o falso põe o nome dela na resposta
  const {agentes:ag,contagem}=comContagem();
  const {sock}=await subir(t,{agentes:ag});const c=await cliente(t,sock);
  const conv=await c.pedir('nova',{agente:'falso',cwd:'/tmp',texto:'oi'});
  await c.pedir('assinar',{agente:'falso',sessao:conv.sessao,desde:0});
  await c.ate(()=>c.eventos.some(e=>e.update.sessionUpdate==='ratoeira_fim'));
  const r=await postar(sock,'/ler-conversa',{agente:'falso',sessao:conv.sessao,dono:'Ana'});
  assert.equal(r.status,200);assert.equal(r.corpo.cwd,'/tmp');assert.equal(r.corpo.mensagens,1);
  assert.equal(r.corpo.texto,'[Ana]: oi\n\n[Agente]: eco: oi');
  assert.ok(contagem().vivas.includes(conv.sessao),'a aberta segue acordada');
  // não estava aberta neste servidor (ex.: religou): carrega pelo histórico do agente e dorme de novo
  const r2=await postar(sock,'/ler-conversa',{agente:'falso',sessao:'antiga-1',cwd:'/tmp'});
  assert.equal(r2.status,200);assert.equal(r2.corpo.texto,'[Dono]: antiga\n\n[Agente]: eco: antiga');
  await c.ate(()=>!contagem().vivas.includes('antiga-1'));
  // o dono abre com as ferramentas: elas valem (não fica presa sem MCP por ter sido aberta só pra leitura)
  const mcp=[{type:'http',name:'ratoeira',url:'http://127.0.0.1:8780/mcp',headers:[]}];
  await c.pedir('abrir',{agente:'falso',sessao:'antiga-1',cwd:'/tmp',mcp});
  await c.pedir('assinar',{agente:'falso',sessao:'antiga-1',desde:0});c.eventos.length=0;
  await c.pedir('enviar',{agente:'falso',sessao:'antiga-1',texto:'ferramentas?'});
  await c.ate(()=>textos(c.eventos,'agent_message_chunk').some(x=>x?.startsWith('ferramentas:')));
  assert.ok(textos(c.eventos,'agent_message_chunk').includes('ferramentas: ratoeira'));
  assert.equal((await postar(sock,'/ler-conversa',{agente:'nenhum',sessao:'x'})).status,400);
});

// ── Agente sem login (18/10/2026): a coluna de conversas lista a cada 20 s; o Codex de quem não conectou falhava toda vez.
test('agente sem login: lista sem ele por 10 min, tenta de novo depois, e as opções dizem pra conectar',async t=>{
  const arq=path.join(mkdtempSync(path.join(tmpdir(),'semlogin-')),'tentativas');writeFileSync(arq,'');
  const ag=new Map([['falso',agentes.get('falso')],['mudo',{...agentes.get('falso'),id:'mudo',nome:'Mudo',env:{FALSO_SEM_LOGIN:arq}}]]);
  const linhas=[];let relogio=1000;
  const {sock}=await subir(t,{agentes:ag,agora:()=>relogio,log:l=>linhas.push(l)});const c=await cliente(t,sock);
  const conv=await c.pedir('nova',{agente:'falso',cwd:'/tmp'});
  const tentativas=()=>readFileSync(arq,'utf8').split('\n').filter(Boolean);
  for(let i=0;i<3;i++){const l=await c.pedir('listar',{});assert.ok(l.some(x=>x.sessao===conv.sessao),'o outro agente segue listando');relogio+=20000;}
  assert.deepEqual(tentativas(),['listar'],'só pergunta uma vez');
  assert.equal(linhas.filter(l=>l.includes('[mudo]')).length,1,'uma linha no log, não uma a cada 20 s');
  await assert.rejects(c.pedir('opcoes',{agente:'mudo',cwd:'/tmp'}),/Contas de IA/);
  assert.deepEqual(tentativas(),['listar'],'opções também não pergunta de novo');
  relogio+=10*60000;await c.pedir('listar',{});
  assert.deepEqual(tentativas(),['listar','listar'],'depois de 10 min tenta de novo');
});

import {ultimaMensagemClaude} from '../servidor.mjs';
test('hora da conversa do Claude é a da última mensagem, não a das linhas de modo e custo do fim',()=>{
  const arq=path.join(mkdtempSync(path.join(tmpdir(),'ultima-')),'s.jsonl');
  const linhas=[{type:'user',timestamp:'2026-10-20T09:00:00.000Z'},{type:'assistant',timestamp:'2026-10-20T09:01:00.000Z',message:{content:'x'.repeat(100000)}},
    {type:'mode',mode:'normal'},{type:'cost-state',totalCostUSD:1}];
  writeFileSync(arq,linhas.map(l=>JSON.stringify(l)).join('\n')+'\n');
  assert.equal(ultimaMensagemClaude(arq),'2026-10-20T09:01:00.000Z');
  writeFileSync(arq,JSON.stringify({type:'mode',mode:'normal'})+'\n');
  assert.equal(ultimaMensagemClaude(arq),null,'sem mensagem: o servidor cai na data do agente');
  assert.equal(ultimaMensagemClaude(arq+'.nao'),null);
});

test('listar traz a hora em que a conversa parou de rodar',async t=>{
  const {sock}=await subir(t);const c=await cliente(t,sock);
  const conv=await c.pedir('nova',{agente:'falso',cwd:'/tmp'});
  assert.equal((await c.pedir('listar',{})).find(x=>x.sessao===conv.sessao).terminou,null,'nunca rodou');
  await c.pedir('assinar',{agente:'falso',sessao:conv.sessao,desde:0});
  await c.pedir('enviar',{agente:'falso',sessao:conv.sessao,texto:'oi'});
  await c.ate(()=>c.estados.at(-1)?.estado==='livre'&&c.estados.some(e=>e.estado==='rodando'));
  const t1=(await c.pedir('listar',{})).find(x=>x.sessao===conv.sessao).terminou;
  assert.ok(t1&&!Number.isNaN(Date.parse(t1)));
});
