// Ditado local da Ratoeira (ratoeira-ditado): transcrição de fala sem chave nem internet, pra quem não tem o
// AssemblyAI. Um serviço só pra máquina toda, ligado pelo systemd na primeira conexão (ratoeira-ditado.socket)
// e que sai sozinho depois de DITADO_OCIOSO_MIN parado: o modelo ocupa ~1,1 GB só enquanto alguém dita.
// Mora aqui em agentes/ pra ser publicado junto; o motor (sherpa-onnx-node, com o binário) e o modelo vêm da receita
// kit/receitas/ditado-local, em /opt/ratoeira/ditado (NODE_PATH) e /opt/ratoeira/modelos.
//
// Motor: NVIDIA Parakeet TDT 0.6B v3 int8 pelo sherpa-onnx-node (binário pronto, sem compilar). Ganhou o teste
// de 14/10/2026 numa VPS de 2 vCPUs: 15 s de fala em ~2 s, o mais preciso em português dos que rodam sem GPU.
// Decisão e números: docs/2026-10-10-ditado-no-chat.md, "Motor local".
//
// Protocolo (HTTP no socket unix):
//   POST /transcrever   corpo: o áudio cru (webm, ogg, mp4, wav...)  →  {texto, ms, segundos}
//   GET  /saude         →  {ok, carregado}
//   POST /aquecer       →  {ok}: carrega o modelo sem esperar (o navegador pede quando a pessoa aperta o microfone,
//                          e os ~8 s de carregar passam enquanto ela fala)
// Quem chama é o servidor de agentes de cada pessoa (agentes/transcrever.mjs), que corrige os termos pelo glossário.
import http from 'node:http';
import {spawn} from 'node:child_process';
import {existsSync,realpathSync} from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';

const TAXA=16000;
export const MAX_AUDIO=40*1024*1024;
const PEDACO_MAX=28*TAXA,PEDACO_MIN=18*TAXA,JANELA=Math.round(0.3*TAXA);

// Fala longa vai em pedaços de até 28 s, cortados no trecho mais quieto entre 18 e 28 s: o modelo lê o pedaço
// inteiro de uma vez (memória cresce com o tamanho) e cortar no meio de palavra estraga a frase.
export function pedacos(amostras){
  const r=[];let ini=0;
  while(amostras.length-ini>PEDACO_MAX){
    let melhor=ini+PEDACO_MAX,menor=Infinity;
    for(let i=ini+PEDACO_MIN;i+JANELA<=ini+PEDACO_MAX;i+=JANELA/2){
      let soma=0;for(let j=i;j<i+JANELA;j++)soma+=amostras[j]*amostras[j];
      if(soma<menor){menor=soma;melhor=i+JANELA/2;}
    }
    r.push(amostras.subarray(ini,melhor));ini=melhor;
  }
  if(amostras.length-ini>TAXA/10)r.push(amostras.subarray(ini));
  return r;
}

// Qualquer áudio que o navegador grava vira PCM 16 kHz mono float pelo ffmpeg.
export function decodificar(audio,{ffmpeg='ffmpeg',timeout=120000}={}){
  return new Promise((ok,falha)=>{
    const p=spawn(ffmpeg,['-hide_banner','-loglevel','error','-i','pipe:0','-f','f32le','-ac','1','-ar',String(TAXA),'pipe:1'],{stdio:['pipe','pipe','pipe']});
    const saida=[],erros=[];const t=setTimeout(()=>p.kill('SIGKILL'),timeout);
    p.stdout.on('data',d=>saida.push(d));p.stderr.on('data',d=>erros.push(d));
    p.on('error',e=>{clearTimeout(t);falha(Object.assign(new Error(e.code==='ENOENT'?'O ffmpeg não está instalado.':e.message),{publico:true}));});
    p.on('close',code=>{
      clearTimeout(t);
      if(code!==0)return falha(Object.assign(new Error('Não consegui ler esse áudio: '+String(Buffer.concat(erros)).trim().split('\n').pop().slice(0,160)),{publico:true}));
      const b=Buffer.concat(saida);ok(new Float32Array(b.buffer,b.byteOffset,Math.floor(b.length/4)));
    });
    p.stdin.on('error',()=>{});p.stdin.end(audio);
  });
}

// modelo: pasta com encoder/decoder/joiner (.int8.onnx) e tokens.txt; motor injetável nos testes
export function criarDitado({modelo,threads=2,ociosoMin=10,aoOcioso=()=>process.exit(0),motor,decod=decodificar,log=()=>{},agora=Date.now}={}){
  let rec=null,fila=Promise.resolve(),ultimo=agora(),ocupados=0;
  function carregar(){
    if(rec)return rec;
    if(motor){rec=motor;return rec;}
    const arq=n=>path.join(modelo,n);
    for(const n of ['encoder.int8.onnx','decoder.int8.onnx','joiner.int8.onnx','tokens.txt'])
      if(!existsSync(arq(n)))throw Object.assign(new Error('O modelo do ditado local não está instalado (falta '+n+'). Quem administra roda a receita ditado-local.'),{publico:true});
    const require=createRequire(import.meta.url);const sherpa=require('sherpa-onnx-node');
    const t=agora();
    const r=new sherpa.OfflineRecognizer({featConfig:{sampleRate:TAXA,featureDim:80},decodingMethod:'greedy_search',
      modelConfig:{transducer:{encoder:arq('encoder.int8.onnx'),decoder:arq('decoder.int8.onnx'),joiner:arq('joiner.int8.onnx')},
        tokens:arq('tokens.txt'),modelType:'nemo_transducer',numThreads:threads,provider:'cpu',debug:0}});
    rec={transcrever:async amostras=>{const s=r.createStream();s.acceptWaveform({sampleRate:TAXA,samples:amostras});await r.decodeAsync(s);return r.getResult(s).text.trim();}};
    log(`modelo carregado em ${((agora()-t)/1000).toFixed(1)} s`);
    return rec;
  }
  // um ditado por vez: com 2 vCPUs, dois ao mesmo tempo disputam os mesmos núcleos e nenhum sai antes
  function transcrever(audio){
    ocupados++;
    const vez=fila.then(async()=>{
      const t=agora();
      const amostras=await decod(audio);
      const segundos=amostras.length/TAXA;
      if(segundos<0.2)return {texto:'',ms:agora()-t,segundos};
      const m=carregar();
      const partes=[];for(const p of pedacos(amostras))partes.push(await m.transcrever(p));
      return {texto:partes.filter(Boolean).join(' ').replace(/\s+/g,' ').trim(),ms:agora()-t,segundos:Math.round(segundos*10)/10};
    });
    fila=vez.catch(()=>{});
    return vez.finally(()=>{ocupados--;ultimo=agora();});
  }
  const server=http.createServer((req,res)=>{
    const responder=(s,d)=>{res.writeHead(s,{'content-type':'application/json; charset=utf-8'});res.end(JSON.stringify(d));};
    ultimo=agora();
    if(req.method==='GET'&&req.url==='/saude')return responder(200,{ok:true,carregado:Boolean(rec)});
    if(req.method==='POST'&&req.url==='/aquecer'){
      responder(202,{ok:true});
      if(!rec)setImmediate(()=>{fila=fila.then(()=>{try{carregar();}catch(e){log('aquecer: '+e.message);}});});
      return;
    }
    if(req.method!=='POST'||req.url!=='/transcrever')return responder(404,{erro:'Recurso não encontrado.'});
    const partes=[];let tam=0,grande=false;
    req.on('data',d=>{tam+=d.length;if(tam>MAX_AUDIO){grande=true;req.destroy();}else partes.push(d);});
    req.on('end',async()=>{
      if(grande)return;
      if(!tam)return responder(400,{erro:'O áudio veio vazio.'});
      try{responder(200,await transcrever(Buffer.concat(partes)));}
      catch(e){if(!e.publico)log('erro: '+(e?.stack??e));responder(e.publico?400:500,{erro:e.publico?e.message:'O ditado local falhou. Tenta de novo.'});}
    });
  });
  server.requestTimeout=15*60000;server.headersTimeout=60000;
  const relogio=setInterval(()=>{if(!ocupados&&agora()-ultimo>=ociosoMin*60000){log('parado há '+ociosoMin+' min: saindo');clearInterval(relogio);server.close();aoOcioso();}},30000);
  relogio.unref();
  return {server,transcrever,carregado:()=>Boolean(rec),fechar(){clearInterval(relogio);server.close();}};
}

// Rodando de verdade: o systemd entrega o socket já aberto no fd 3 (LISTEN_FDS); sem ele, DITADO_SOCKET.
// /opt/ratoeira/agentes é atalho pra pasta da versão: compara os caminhos já resolvidos
if(process.argv[1]&&realpathSync(fileURLToPath(import.meta.url))===realpathSync(path.resolve(process.argv[1]))){
  const modelo=process.env.DITADO_MODELO??'/opt/ratoeira/modelos/parakeet-tdt-0.6b-v3-int8';
  const d=criarDitado({modelo,threads:Number(process.env.DITADO_THREADS??2),ociosoMin:Number(process.env.DITADO_OCIOSO_MIN??10),log:m=>console.log(m)});
  if(Number(process.env.LISTEN_FDS)>=1)d.server.listen({fd:3},()=>console.log('ditado local no socket do systemd'));
  else{const s=process.env.DITADO_SOCKET;if(!s){console.error('falta DITADO_SOCKET (ou rodar pelo ratoeira-ditado.socket)');process.exit(2);}
    d.server.listen(s,()=>console.log('ditado local em '+s));}
  for(const sinal of ['SIGTERM','SIGINT'])process.on(sinal,()=>{d.fechar();process.exit(0);});
}
