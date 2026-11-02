// Ditado do chat (botão de microfone do compositor): o navegador grava, manda o áudio por aqui e recebe
// o texto, que cai na caixa pra pessoa corrigir antes de enviar. Roda no servidor de agentes porque é ele
// que tem o cofre de chaves da pessoa e a pasta de trabalho (o glossário).
//
// Dois motores, e só um trabalha:
// - AssemblyAI (Universal-3.5 Pro), quando tem chave: até ~2 min pela API síncrona (texto em ~1 s); mais longo,
//   sobe o arquivo e espera a transcrição normal. Mais preciso em nome de marca e não gasta a CPU da VPS.
// - Local, de fábrica e sem chave: o serviço ratoeira-ditado da máquina (agentes/ditado-local.mjs, Parakeet v3), num
//   socket unix. Com chave ele nem acorda. Ele não aceita lista de palavras: os termos do glossário são corrigidos
//   depois, no texto (corrigirTermos).
// Pesquisa e decisão: docs/2026-10-10-ditado-no-chat.md.
//
// Chave, na ordem: ASSEMBLYAI_API_KEY no ambiente; a da organização em /etc/ratoeira/ditado.env (o admin cola em
// Configurações › Organização › Ditado e o aplicar-acessos grava, legível pelo grupo ratoeira-pessoas); o item
// "assemblyai" do cofre (1Password, quando o admin conectou), campo ASSEMBLYAI_API_KEY ou credential. Valor op://...
// é lido pelo op. Fica guardada um minuto: chave nova vale em até 1 min, sem religar ninguém.
//
// Glossário: o da pasta de trabalho (_contexto/glossario.md, um termo por linha ou separados por vírgula) primeiro,
// depois os termos técnicos de sempre. Vai pro AssemblyAI como keyterms_prompt (até 100) e corrige o texto do local.
import {execFile} from 'node:child_process';
import http from 'node:http';
import {readFileSync,existsSync} from 'node:fs';
import path from 'node:path';

const SYNC='https://sync.assemblyai.com/v1/transcribe',API='https://api.assemblyai.com';
export const SOCKET_LOCAL='/run/ratoeira-ditado/ditado.sock',ARQUIVO_ORG='/etc/ratoeira/ditado.env';
const MODELO='universal-3-5-pro';
const MAX_SYNC_MS=110000;            // a síncrona aceita até 120 s; com folga pra conta do navegador
export const MAX_AUDIO=15*1024*1024; // ~1 h de opus a 32 kbps; o navegador para em 10 min
const MAX_TERMOS=100,MAX_TERMO=50;
const TIPOS=/^audio\/(webm|ogg|mp4|mpeg|wav|x-wav|aac|x-m4a|m4a)$/;
const BASE=['Claude','Claude Code','Codex','Ratoeira','deploy','commit','push','pull request','branch','merge','rebase','gateway',
  'frontend','backend','API','MCP','skill','prompt','token','webhook','Supabase','Cloudflare','Vercel','GitHub','JavaScript','TypeScript',
  'Node','npm','Python','SQLite','JSON','YAML','markdown','README','AGENTS.md','CLAUDE.md','localhost','VPS','Playwright','1Password'];

const erro=m=>Object.assign(new Error(m),{publico:true});

// KEY=valor por linha, como um .env (aspas em volta saem; comentário e linha sem = são ignorados)
export function lerEnv(texto){
  const r={};
  for(const l of String(texto).split('\n')){
    const m=l.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if(m)r[m[1]]=m[2].replace(/^(['"])(.*)\1$/,'$2');
  }
  return r;
}

// Termos do _contexto/glossario.md: um por linha (com ou sem "- "), ou vários separados por vírgula.
// Título, citação e comentário ficam de fora; `código` e **negrito** perdem a marcação.
export function termosDoGlossario(texto){
  const semComentario=String(texto).replace(/<!--[\s\S]*?-->/g,'');
  const termos=[];
  for(let l of semComentario.split('\n')){
    l=l.trim();if(!l||/^(#|>|```|\|)/.test(l))continue;
    l=l.replace(/^[-*+]\s+/,'').replace(/^\d+[.)]\s+/,'');
    // "Termo: explicação" ou "Termo — explicação": só o termo
    l=l.split(/\s+[—–]\s+|:\s/)[0];
    for(const t of l.split(','))termos.push(t.replace(/[`*_]/g,'').trim());
  }
  return termos;
}

export function montarTermos(raiz,{ler=f=>readFileSync(f,'utf8')}={}){
  let doTime=[];
  if(raiz){try{doTime=termosDoGlossario(ler(path.join(raiz,'_contexto','glossario.md')).slice(0,64*1024));}catch{}}
  const vistos=new Set(),r=[];
  for(const t of [...doTime,...BASE]){
    const k=t.toLowerCase();
    if(!t||t.length>MAX_TERMO||t.split(/\s+/).length>6||vistos.has(k))continue;
    vistos.add(k);r.push(t);if(r.length>=MAX_TERMOS)break;
  }
  return r;
}

// Correção pelo glossário, pro motor local (que não aceita lista de palavras): troca palavra parecida pelo termo
// certo. Compara sem acento, sem maiúscula e sem espaço ("supa base" = Supabase), em janelas de até 3 palavras.
// Igual: só acerta a grafia. Parecida (até 1 letra a cada 5, termo de 6 letras pra cima, mesmo número de palavras):
// troca. Termo curto só troca se for igual, pra "caiu" não virar "Caio".
const normal=t=>t.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
function distancia(a,b){
  if(Math.abs(a.length-b.length)>2)return 99;
  let ant=Array.from({length:b.length+1},(_,i)=>i);
  for(let i=1;i<=a.length;i++){const cur=[i];for(let j=1;j<=b.length;j++)cur[j]=Math.min(ant[j]+1,cur[j-1]+1,ant[j-1]+(a[i-1]===b[j-1]?0:1));ant=cur;}
  return ant[b.length];
}
export function corrigirTermos(texto,termos){
  const alvos=termos.map(t=>({t,k:normal(t),n:t.split(/\s+/).length})).filter(x=>x.k.length>=3);
  if(!alvos.length||!texto)return texto;
  const re=/[\p{L}\p{N}][\p{L}\p{N}.'’-]*/gu,palavras=[];let m;
  while((m=re.exec(texto)))palavras.push({ini:m.index,fim:m.index+m[0].length,txt:m[0].replace(/[.'’-]+$/,'')});
  for(const p of palavras)p.fim=p.ini+p.txt.length;
  const trocas=[];
  for(let i=0;i<palavras.length;){
    let achou=null;
    for(let tam=3;tam>=1&&!achou;tam--){
      if(i+tam>palavras.length)continue;
      const janela=palavras.slice(i,i+tam),k=normal(janela.map(p=>p.txt).join(''));
      // artigo e preposição ("o", "um", "de") não entram em troca aproximada
      const curta=janela.some(p=>normal(p.txt).length<3);
      for(const a of alvos){
        if(tam>a.n+1)continue;
        // palavra partida ("supa base") só junta se der o termo exato; parecida, só com o mesmo número de palavras
        const d=k===a.k?0:a.k.length>=6&&tam===a.n&&!curta?distancia(k,a.k):99;
        if(d===0||d<=Math.floor(a.k.length/5)){achou={tam,termo:a.t};break;}
      }
    }
    if(achou){const ini=palavras[i].ini,fim=palavras[i+achou.tam-1].fim;if(texto.slice(ini,fim)!==achou.termo)trocas.push({ini,fim,termo:achou.termo});i+=achou.tam;}
    else i++;
  }
  for(const t of trocas.reverse())texto=texto.slice(0,t.ini)+t.termo+texto.slice(t.fim);
  return texto;
}

// Fala com o serviço ratoeira-ditado (HTTP no socket unix). O systemd liga ele na primeira conexão.
function pedirLocal(socketPath,{metodo='POST',rota='/transcrever',corpo=null,tipo='application/octet-stream',timeout=120000}={}){
  return new Promise((ok,falha)=>{
    const req=http.request({socketPath,path:rota,method:metodo,headers:corpo?{'content-type':tipo,'content-length':corpo.length}:{}},res=>{
      const b=[];res.on('data',d=>b.push(d));res.on('end',()=>{let d={};try{d=JSON.parse(Buffer.concat(b));}catch{}
        res.statusCode<300?ok(d):falha(Object.assign(erro(d.erro||'O ditado local falhou ('+res.statusCode+').'),{status:res.statusCode}));});
    });
    req.setTimeout(timeout,()=>req.destroy(Object.assign(new Error('demorou'),{code:'ETIMEDOUT'})));
    req.on('error',e=>falha(['ENOENT','ECONNREFUSED','EACCES'].includes(e.code)
      ?Object.assign(erro('O ditado local não está instalado nesta Ratoeira e não tem chave do AssemblyAI. Quem administra roda a receita ditado-local, ou cola uma chave do AssemblyAI em Configurações › Organização › Ditado.'),{semLocal:true})
      :e.code==='ETIMEDOUT'?erro('O ditado local demorou demais (a VPS está ocupada?). O áudio ficou guardado: tenta de novo.')
      :erro('O ditado local não respondeu. O áudio ficou guardado: tenta de novo.')));
    req.end(corpo??undefined);
  });
}

function opPadrao(args,{env=process.env}={}){
  return new Promise((ok,falha)=>execFile('op',args,{env,timeout:20000,maxBuffer:1<<16},(e,stdout,stderr)=>e?falha(Object.assign(e,{stderr:String(stderr)})):ok(String(stdout).trim())));
}

// home: a da pessoa. fetch, op e agora entram nos testes.
export function criarTranscritor({home=process.env.HOME,env=process.env,fetch:f=globalThis.fetch,op=opPadrao,agora=Date.now,esperar=ms=>new Promise(r=>setTimeout(r,ms)),
  socketLocal=env.RATOEIRA_DITADO_SOCKET||SOCKET_LOCAL,local=pedirLocal,arquivoOrg=env.RATOEIRA_DITADO_ENV||ARQUIVO_ORG}={}){
  let cache=null; // {chave, origem, ate}: um minuto, com ou sem chave (o cofre é lento)

  async function resolver(valor){
    if(!valor)return null;
    if(!valor.startsWith('op://'))return valor;
    try{return await op(['read',valor],{env});}catch{throw erro('Não consegui ler a chave do AssemblyAI no cofre ('+valor.split('/').slice(0,4).join('/')+'). Confere se o item existe e se o cofre está conectado.');}
  }
  // a chave do AssemblyAI e de onde ela veio; null quando não tem nenhuma (aí o motor é o local)
  async function achar(){
    if(cache&&cache.ate>agora())return cache;
    let k=await resolver(env.ASSEMBLYAI_API_KEY),origem=k?'ambiente':null;
    if(!k){let arq={};try{arq=lerEnv(readFileSync(arquivoOrg,'utf8'));}catch{}k=await resolver(arq.ASSEMBLYAI_API_KEY);if(k)origem='organizacao';}
    // service account do op só busca dentro de um vault: tenta em cada um que ela enxerga
    if(!k&&env.OP_SERVICE_ACCOUNT_TOKEN){
      let vaults=[];try{vaults=JSON.parse(await op(['vault','list','--format','json'],{env})).map(v=>v.name).filter(Boolean);}catch{}
      busca:for(const v of vaults)for(const campo of ['ASSEMBLYAI_API_KEY','credential']){
        try{k=await op(['read',`op://${v}/assemblyai/${campo}`],{env});}catch{}
        if(k){origem='cofre';break busca;}
      }
    }
    cache={chave:k||null,origem,ate:agora()+60000};
    return cache;
  }

  async function chamar(url,opcoes,{timeout=60000}={}){
    let r;
    try{r=await f(url,{...opcoes,signal:AbortSignal.timeout(timeout)});}
    catch{throw erro('Não consegui falar com o AssemblyAI agora. O áudio ficou guardado: tenta de novo.');}
    if(r.status===401||r.status===403){const o=cache?.origem;cache=null;throw erro(o==='organizacao'?'O AssemblyAI recusou a chave da organização. Quem administra troca em Configurações › Organização › Ditado.':'O AssemblyAI recusou a chave. Quem administra confere o item "assemblyai" no cofre.');}
    let corpo=null;try{corpo=await r.json();}catch{}
    if(!r.ok){
      const detalhe=String(corpo?.error??corpo?.detail??corpo?.message??'').slice(0,200);
      throw Object.assign(erro(r.status>=500||r.status===429?'O AssemblyAI está fora do ar ou ocupado. O áudio ficou guardado: tenta de novo.':'O AssemblyAI não aceitou o áudio'+(detalhe?': '+detalhe:'.')),{status:r.status});
    }
    return corpo??{};
  }

  async function sincrono(k,audio,mime,termos){
    const form=new FormData();
    form.append('audio',new Blob([audio],{type:mime}),'ditado.'+(mime.split('/')[1]||'webm'));
    form.append('config',new Blob([JSON.stringify({language_codes:['pt'],keyterms_prompt:termos})],{type:'application/json'}));
    return (await chamar(SYNC,{method:'POST',headers:{authorization:k,'x-aai-model':MODELO},body:form})).text??'';
  }
  async function normal(k,audio,termos){
    const {upload_url}=await chamar(API+'/v2/upload',{method:'POST',headers:{authorization:k,'content-type':'application/octet-stream'},body:audio},{timeout:120000});
    if(!upload_url)throw erro('O AssemblyAI não devolveu o endereço do áudio. Tenta de novo.');
    const {id}=await chamar(API+'/v2/transcript',{method:'POST',headers:{authorization:k,'content-type':'application/json'},
      body:JSON.stringify({audio_url:upload_url,speech_models:[MODELO,'universal-2'],language_code:'pt',keyterms_prompt:termos})});
    if(!id)throw erro('O AssemblyAI não começou a transcrição. Tenta de novo.');
    const fim=agora()+10*60000;
    while(agora()<fim){
      await esperar(1000);
      const t=await chamar(API+'/v2/transcript/'+encodeURIComponent(id),{headers:{authorization:k}});
      if(t.status==='completed')return t.text??'';
      if(t.status==='error')throw erro('O AssemblyAI não conseguiu transcrever: '+String(t.error??'sem detalhe').slice(0,200));
    }
    throw erro('A transcrição demorou demais. O áudio ficou guardado: tenta de novo.');
  }

  return {
    // audio: Buffer; mime: o tipo que o MediaRecorder gravou (sem ;codecs); duracaoMs: o que o navegador mediu
    async transcrever({audio,mime,duracaoMs=0,raiz=null}){
      const tipo=String(mime??'').split(';')[0].trim().toLowerCase();
      if(!TIPOS.test(tipo))throw erro('Formato de áudio que não reconheço ('+tipo.slice(0,40)+').');
      if(!audio?.length)throw erro('O áudio veio vazio.');
      if(audio.length>MAX_AUDIO)throw erro('O áudio passou de 15 MB. Grava em pedaços menores.');
      const {chave:k}=await achar(),termos=montarTermos(raiz);
      const inicio=agora();
      let texto;
      if(!k){
        // sem chave: o motor local da máquina; o prazo acompanha a fala (2 vCPUs ocupadas chegam a ~1x o tempo dela)
        const r=await local(socketLocal,{corpo:audio,tipo,timeout:90000+2*Math.max(duracaoMs,audio.length/4)});
        return {texto:corrigirTermos(String(r.texto??'').trim(),termos),ms:agora()-inicio,motor:'local'};
      }
      if(duracaoMs>0&&duracaoMs<=MAX_SYNC_MS){
        // a síncrona recusa áudio longo: aí vai pela normal
        try{texto=await sincrono(k,audio,tipo,termos);}
        catch(e){if(e.status!==400&&e.status!==413&&e.status!==422)throw e;texto=await normal(k,audio,termos);}
      }else texto=await normal(k,audio,termos);
      return {texto:String(texto).trim(),ms:agora()-inicio,motor:'assemblyai'};
    },
    // pro painel Ditado das Configurações: qual motor está valendo e se o local está instalado (fresco: relê a chave)
    async estado({fresco=false}={}){
      if(fresco)cache=null;
      const {chave:k,origem}=await achar();
      // o socket existe quando o ratoeira-ditado.socket está instalado; olhar o arquivo não acorda o serviço
      const local=existsSync(socketLocal);
      return {motor:k?'assemblyai':local?'local':null,origem,local};
    },
    // a pessoa aperta o microfone: com o motor local, o modelo já começa a carregar enquanto ela fala
    async aquecer(){
      const {chave:k}=await achar();
      if(!k)local(socketLocal,{rota:'/aquecer',timeout:5000}).catch(()=>{});
      return {};
    },
  };

}
