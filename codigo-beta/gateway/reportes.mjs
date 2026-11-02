// Reportes (botão "Reportar" no pé da barra): bug ou sugestão de quem usa a Ratoeira.
// Com config.reportes.enviar, o reporte vai pra caixa de entrada configurada (o app Reportes de quem mantém a Ratoeira),
// com a chave da origem desta Ratoeira; a triagem é lá. Se o envio falha e tem dir, ou se só tem dir,
// vira uma pasta em config.reportes.dir com relato.md, print (se veio), trace.json (o que o navegador viu)
// e log.txt (journal do servidor de alguns minutos antes até agora).
// A volta (desde 16/10/2026): quando a triagem marca feito ou recusado com aviso, o gateway busca (retornos) e põe
// no sino de quem reportou; "Meus reportes" (meus) lista os da pessoa. Os dois pela mesma porta e com a mesma chave
// do envio: o app nunca chama esta Ratoeira, que pode nem ter endereço público.
// Origem sozinha (desde 17/10/2026): a instalação gera a chave desta Ratoeira, e todo reporte leva junto o endereço
// dela e o e-mail de quem administra (instalacao); no primeiro, o app Reportes cadastra a origem com isso.
// Aviso de instalação (desde 20/10/2026): pela mesma porta (/receber/instalacao), a Ratoeira avisa que terminou de
// instalar, que quem administra entrou e que mudou de versão, sem esperar um reporte. Vai só o endereço, a versão,
// o nome e o e-mail de quem administra e quantas pessoas têm conta; só quando algo muda e uma vez por dia.
import {mkdir,readFile,rename,writeFile} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import path from 'node:path';
import {problem} from './catalog.mjs';

const TIPOS={bug:'Algo deu errado',sugestao:'Sugestão'};
const PRINT=/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/;
const MAX_PRINT=8*1024*1024,MAX_TRACE=512*1024,MAX_TEXTO=8000,MAX_LOG=1024*1024;

// Tira do texto o que parece segredo: tokens de API (Anthropic, OpenAI, GitHub, Slack, AWS, 1Password, Resend,
// Google, xAI), JWT solto, Bearer, cookies, parâmetros de token em URL e NOME_DO_SEGREDO=valor (como num .env).
// É o melhor esforço: o diálogo diz "a Ratoeira tenta tirar", não promete.
export function limparSegredos(s){
  return String(s)
    .replace(/\b(sk-ant-|sk-|ghp_|gho_|ghs_|ghu_|github_pat_|xox[abp]-|AKIA|ops_|re_|xai-)[A-Za-z0-9_-]{8,}/g,'$1[removido]')
    .replace(/\bAIza[A-Za-z0-9_-]{20,}/g,'AIza[removido]')
    .replace(/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/g,'[jwt removido]')
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi,'$1 [removido]')
    .replace(/\b(cookie|set-cookie|authorization)(["']?\s*[:=]\s*["']?)[^"'\n]{4,}/gi,'$1$2[removido]')
    .replace(/\b([A-Za-z0-9_]*(?:token|secret|senha|password|passwd|api_?key|_key|chave))=(["']?)[^\s&"';]+/gi,'$1=$2[removido]')
    .replace(/([?&;\s"'](?:token|senha|password|secret|key|code|sessao|session)=)[^&\s"';]+/gi,'$1[removido]')
    .replace(/(["'](?:token|senha|password|secret|apiKey|api_key)["']\s*:\s*["'])[^"']+/gi,'$1[removido]');
}

const slug=s=>String(s).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').split('-').slice(0,6).join('-').slice(0,48)||'sem-titulo';

// Data e hora no fuso de quem usa (config.reportes.fuso), nos dois formatos que a pasta precisa.
function quando(agora,fuso){
  const p=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:fuso,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(agora).map(x=>[x.type,x.value]));
  const local=Date.UTC(+p.year,+p.month-1,+p.day,+p.hour,+p.minute,+p.second);
  const off=Math.round((local-Math.floor(agora.getTime()/1000)*1000)/60000),sinal=off<0?'-':'+',a=Math.abs(off);
  return {pasta:`${p.year}-${p.month}-${p.day}-${p.hour}${p.minute}`,iso:`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}${sinal}${String(Math.floor(a/60)).padStart(2,'0')}:${String(a%60).padStart(2,'0')}`};
}

function journal(unidades,minutos){
  return new Promise(ok=>{
    const args=['--no-pager','-o','short-iso','--since',`-${minutos}min`,...unidades.flatMap(u=>['-u',u])];
    execFile('journalctl',args,{timeout:10000,maxBuffer:4*MAX_LOG},(err,out,errOut)=>{
      if(err&&!out)ok(`(não consegui ler o journal: ${String(errOut||err.message).trim().slice(0,300)})\n`);else ok(out);
    });
  });
}

// Manda pro app Reportes (POST <url>, cabeçalho x-reportes-chave). Origin = a do destino: o gateway de lá
// recusa POST público sem ele. Devolve o id lá ou lança.
const lerChave=async({chave,chaveArquivo})=>(chave??(chaveArquivo?await readFile(chaveArquivo,'utf8'):'')).trim();
// .../receber/reporte → .../receber/<rota>
const urlDe=(url,rota)=>url.replace(/\/reporte\/?$/,'/'+rota);
async function mandar({url,chave,chaveArquivo},corpo,fetchFn){
  const k=await lerChave({chave,chaveArquivo});
  if(!url||!k)throw new Error('reportes.enviar sem url ou chave');
  const r=await fetchFn(url,{method:'POST',headers:{'content-type':'application/json',origin:new URL(url).origin,'x-reportes-chave':k},
    body:JSON.stringify(corpo),signal:AbortSignal.timeout(20000)});
  const j=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(`caixa de entrada respondeu ${r.status}: ${String(j.erro??'').slice(0,200)}`);
  return j.id;
}

// opts: dir e/ou enviar ({url, chave | chaveArquivo}), unidades (["ratoeira-gateway","ratoeira-agentes@{user}"]), minutos (10),
// fuso ("America/Sao_Paulo"), porHora (20 por pessoa). lerLog e agora são injetáveis nos testes.
// retornoArquivo: onde fica o último aviso já tratado (o cursor), pra não avisar duas vezes.
// instalacao: async () => ({endereco, admin, nome, pessoas}), que vai junto de cada reporte enviado.
// avisoArquivo: onde fica o último aviso de instalação mandado (pra só mandar de novo quando mudar); versao: a desta Ratoeira.
export function createReportes({dir,enviar=null,unidades=[],minutos=10,fuso='America/Sao_Paulo',porHora=20},{lerLog=journal,agora=()=>new Date(),fetchFn=fetch,retornoArquivo=null,avisoArquivo=null,versao='',instalacao=async()=>null}={}){
  if(!dir&&!enviar?.url)return null;
  const recentes=new Map();
  async function pegar(rota){
    const k=await lerChave(enviar);if(!k)throw new Error('reportes.enviar sem chave');
    const r=await fetchFn(urlDe(enviar.url,rota),{headers:{'x-reportes-chave':k},signal:AbortSignal.timeout(20000)});
    const j=await r.json().catch(()=>({}));
    if(!r.ok)throw new Error(`caixa de entrada respondeu ${r.status}: ${String(j.erro??'').slice(0,200)}`);
    return j;
  }
  const lerCursor=async()=>{try{const n=JSON.parse(await readFile(retornoArquivo,'utf8')).desde;return Number.isSafeInteger(n)&&n>0?n:0;}catch{return 0;}};
  async function gravarCursor(desde){const tmp=retornoArquivo+'.tmp';await writeFile(tmp,JSON.stringify({desde})+'\n');await rename(tmp,retornoArquivo);}
  return {
    // tem volta: só quando manda pra caixa de entrada (com só a pasta local, a triagem é na mão)
    temRetorno:Boolean(enviar?.url),
    // Aviso de instalação: manda se mudou algo desde o último (ou se é outro dia). Devolve true se mandou.
    async avisarInstalacao(){
      if(!enviar?.url||!avisoArquivo)return false;
      const inst=await instalacao().catch(()=>null);if(!inst)return false;
      const corpo={instalacao:{endereco:inst.endereco??'',admin:inst.admin??'',nome:inst.nome??''},versao:versao??'',
        pessoas:Number.isSafeInteger(inst.pessoas)?inst.pessoas:null};
      const marca=JSON.stringify(corpo)+' '+agora().toISOString().slice(0,10);
      let antes='';try{antes=(await readFile(avisoArquivo,'utf8')).trim();}catch{}
      if(antes===marca)return false;
      await mandar({...enviar,url:urlDe(enviar.url,'instalacao')},corpo,fetchFn);
      const tmp=avisoArquivo+'.tmp';await writeFile(tmp,marca+'\n');await rename(tmp,avisoArquivo);
      return true;
    },
    // Busca os avisos novos e chama tratar(item) em cada um; o cursor só anda depois de tratar todos.
    // item: {id, seq, quem, titulo, status: 'feito'|'recusado', recado, versao, em}
    async retornos(tratar){
      if(!enviar?.url||!retornoArquivo)return 0;
      const desde=await lerCursor();
      const j=await pegar('retornos?desde='+desde);
      const itens=Array.isArray(j.itens)?j.itens:[];
      for(const it of itens)if(it&&typeof it.quem==='string')await tratar(it);
      const ate=Number.isSafeInteger(j.ate)?j.ate:desde;
      if(ate!==desde)await gravarCursor(ate);
      return itens.length;
    },
    // os reportes que esta pessoa mandou daqui, com o status e o recado da triagem
    async meus(email){
      if(!enviar?.url)throw problem(404,'Esta Ratoeira não manda os reportes pra uma caixa de entrada.');
      try{const j=await pegar('meus?quem='+encodeURIComponent(email));return {reportes:Array.isArray(j.reportes)?j.reportes:[]};}
      catch(e){console.error('reportes: não consegui ler os meus reportes:',e.message);throw problem(502,'Não consegui buscar teus reportes agora. Tenta de novo em instantes.');}
    },
    async salvar(identity,body,{user=null,versao=null}={}){
      const tipo=Object.hasOwn(TIPOS,body?.tipo)?body.tipo:null;
      if(!tipo)throw problem(400,'Escolha se é algo que deu errado ou uma sugestão.');
      const texto=typeof body.texto==='string'?body.texto.replace(/\r\n?/g,'\n').trim():'';
      if(!texto)throw problem(400,'Escreva o que aconteceu.');
      if(texto.length>MAX_TEXTO)throw problem(413,'O texto passou do limite. Resuma um pouco.');
      let print=null;
      if(body.print!=null&&body.print!==''){
        const m=typeof body.print==='string'&&body.print.match(PRINT);
        if(!m)throw problem(400,'O print veio num formato que não reconheço.');
        print={ext:m[1]==='jpeg'?'jpg':m[1],dados:Buffer.from(m[2],'base64')};
        if(print.dados.length>MAX_PRINT)throw problem(413,'O print ficou grande demais. Envie sem ele.');
      }
      const trace=body.trace&&typeof body.trace==='object'&&!Array.isArray(body.trace)?body.trace:{};
      const traceTxt=limparSegredos(JSON.stringify(trace,null,1));
      if(traceTxt.length>MAX_TRACE)throw problem(413,'Os dados da tela vieram grandes demais.');
      // trava simples contra clique repetido ou loop: N por pessoa por hora
      const agoraMs=agora().getTime(),janela=(recentes.get(identity.email)??[]).filter(t=>agoraMs-t<3600000);
      if(janela.length>=porHora)throw problem(429,'Muitos reportes na última hora. Tente de novo mais tarde.');
      janela.push(agoraMs);recentes.set(identity.email,janela);

      const q=quando(agora(),fuso);
      const units=unidades.filter(u=>user||!u.includes('{user}')).map(u=>u.replaceAll('{user}',user??'')).filter(u=>/^[A-Za-z0-9@._-]{1,80}$/.test(u));
      let log=units.length?limparSegredos(await lerLog(units,minutos)):'';
      if(log.length>MAX_LOG)log='(cortado: só o fim)\n'+log.slice(-MAX_LOG);
      const tela=typeof trace.tela==='string'?trace.tela.replace(/\s+/g,' ').slice(0,200):'';

      if(enviar?.url){
        try{
          const inst=await instalacao().catch(()=>null);
          const id=await mandar(enviar,{tipo,texto,quem:identity.email,quando:q.iso,tela,versao:versao??'',trace:traceTxt+'\n',
            log:units.length?log:null,print:print?body.print:null,...(inst?{instalacao:inst}:{})},fetchFn);
          return {id};
        }catch(e){
          console.error('reportes: não consegui mandar pra caixa de entrada:',e.message);
          if(!dir)throw problem(502,'Não consegui enviar o reporte agora. Tente de novo em instantes.');
        }
      }

      const quem=slug(identity.email.split('@')[0]);
      const titulo=texto.split('\n').find(l=>l.trim())?.trim().slice(0,90)??'';
      const base=`${q.pasta}-${quem}-${slug(titulo)}`;
      await mkdir(dir,{recursive:true});
      let nome=base,pasta;
      for(let i=2;;i++){
        pasta=path.join(dir,nome);
        try{await mkdir(pasta);break;}catch(e){if(e.code!=='EEXIST'||i>50)throw e;nome=`${base}-${i}`;}
      }
      const arquivos=[print&&`- \`print.${print.ext}\`: a tela na hora do clique (o que roda dentro de iframe pode sair em branco)`,
        '- `trace.json`: o que o navegador viu (erros, requisições que falharam, quedas de conexão, últimas ações)',
        units.length&&`- \`log.txt\`: journal de ${units.join(', ')} de ${minutos} min antes até o reporte`].filter(Boolean);
      const relato=['---','status: novo',`tipo: ${tipo}`,`quem: ${JSON.stringify(identity.email)}`,`quando: ${q.iso}`,
        tela?`tela: ${JSON.stringify(tela)}`:null,versao?`versao: ${JSON.stringify(versao)}`:null,'---','',
        `# ${titulo.replace(/^#+\s*/,'')}`,'',`**${TIPOS[tipo]}**, por ${identity.email}.`,'','## Relato','',texto,'','## Anexos','',...arquivos,'',
        '<!-- Triagem: troque o status pra aceito, recusado ou feito. Quem resolver, anota embaixo o que fez e o commit. -->',''].filter(l=>typeof l==='string').join('\n');
      await writeFile(path.join(pasta,'relato.md'),relato);
      await writeFile(path.join(pasta,'trace.json'),traceTxt+'\n');
      if(print)await writeFile(path.join(pasta,'print.'+print.ext),print.dados);
      if(units.length)await writeFile(path.join(pasta,'log.txt'),log);
      return {pasta:nome};
    },
  };
}
