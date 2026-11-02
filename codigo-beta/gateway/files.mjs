// Arquivos: a pasta de trabalho na VPS, como ela é no disco (desde 19/10/2026).
// A árvore lê cada pasta do disco quando a pessoa abre (readdir), e nada some: .env, .claude, node_modules e o que
// o .gitignore lista aparecem. A única exceção é a pasta .git (a engrenagem do histórico, não arquivo da pessoa).
// O git só marca: o que ele não guarda (ignorado, ou dentro de um repositório aninhado) vem com foraDoGit, e a tela
// põe um sinal discreto. Antes a árvore era o índice do git, e cada desencontro com o disco (arquivo novo, movido,
// apagado, pasta vazia, repositório dentro de repositório) parecia bug.
// A busca segue num índice (git ls-files, rápido no repo grande), com os ignorados e sem as pastas de dependência.
// Symlink aparece na árvore, mas nunca é aberto.
import {execFile} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {lstat,open,readFile,readdir,realpath,stat,writeFile,rename} from 'node:fs/promises';
import path from 'node:path';
import {promisify} from 'node:util';
import {Marked} from 'marked';
import {problem} from './catalog.mjs';

const run=promisify(execFile);
const MAX_RENDER=5*1024*1024;   // md e "ver original" montam a página inteira na memória
const MAX_BUSCA=200;
const tipos={'.html':'text/html; charset=utf-8','.htm':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.gif':'image/gif','.avif':'image/avif','.svg':'image/svg+xml','.ico':'image/x-icon','.woff':'font/woff','.woff2':'font/woff2','.ttf':'font/ttf','.otf':'font/otf','.pdf':'application/pdf','.mp4':'video/mp4','.webm':'video/webm','.mov':'video/quicktime','.mp3':'audio/mpeg','.m4a':'audio/mp4','.wav':'audio/wav','.ogg':'audio/ogg','.txt':'text/plain; charset=utf-8','.csv':'text/plain; charset=utf-8'};
// Estes o navegador mostra sozinho sem executar nada na origem do portal.
const inertes=new Set(['.png','.jpg','.jpeg','.webp','.gif','.avif','.ico','.pdf','.mp4','.webm','.mov','.mp3','.m4a','.wav','.ogg','.woff','.woff2','.ttf','.otf']);
export const sandboxPolicy="default-src 'self' https: data:; script-src 'self' 'unsafe-inline' https:; style-src 'self' 'unsafe-inline' https:; object-src 'none'; base-uri 'none'; frame-ancestors 'self'; sandbox allow-scripts allow-forms allow-downloads allow-popups";

const MAX_ARQUIVOS=20000;   // pasta simples: teto da varredura da busca, pra uma pasta gigante não travar o portal
const MAX_POR_PASTA=3000;   // árvore: itens de uma pasta só (o resto vem com limitado)
// Fora do portal: só a pasta .git. Tudo o mais aparece.
export const escondido=nome=>nome==='.git';
// A busca não entra nelas (não é esconder: senão "index" devolve 3 mil arquivos de dependência). A árvore mostra.
export const PASTAS_DEPENDENCIA=new Set(['node_modules','.venv','venv','__pycache__','.next']);
const naBusca=rel=>!rel.split('/').some(p=>escondido(p)||PASTAS_DEPENDENCIA.has(p));

// "Clínicas" → "clinicas". NFD separa o acento da letra; o \p{M} tira as marcas.
export const semAcento=t=>String(t).normalize('NFD').replace(/\p{M}/gu,'').toLowerCase();

export function normalizar(entrada){
  const rel=String(entrada??'').replace(/^\/+|\/+$/g,'');
  if(rel==='')return '';
  const partes=rel.split('/');
  if(partes.some(p=>!p||p==='.'||p==='..'||p==='.git'||/[\\\x00-\x1f]/.test(p)))throw problem(404,'Arquivo não encontrado.');
  return partes.join('/');
}

// Arquivo pesado (vídeo, áudio, PSD, pacote, ou acima de 50 MB) fica fora do git: o servidor de agentes escreve dois
// blocos no .gitignore da raiz (agentes/pesados.mjs). Desde 19/10/2026 a árvore mostra todo ignorado, não só esses;
// a função fica pra quem ainda lê os blocos.
export function pathspecsPesados(gitignore){
  const entre=(ini,fim)=>{const a=gitignore.indexOf(ini);if(a<0)return [];const b=gitignore.indexOf(fim,a);if(b<0)return [];
    return gitignore.slice(a,b).split('\n').slice(1).filter(l=>l.trim()&&!l.startsWith('#'));};
  return [...entre('# >>> ratoeira: arquivos pesados','# <<< ratoeira: arquivos pesados').map(p=>':(glob)**/'+p),
    ...entre('# >>> ratoeira: arquivos grandes','# <<< ratoeira: arquivos grandes').map(p=>':(literal)'+p.slice(1).replace(/\\(.)/g,'$1'))];
}

// bloqueado(rel): pasta restrita que esta pessoa não pode ver (área do time, contas.mjs). Some da
// árvore e da busca, e o arquivo não abre nem pelo link direto.
export function createRepoFiles(repoDir,{git='git',syncRequestFile=null,syncStateFile=null,naoVersionados=false,bloqueado=()=>false}={}){
  let ultimoPedido=0;
  // No multiusuário a pasta é de outra pessoa: sem safe.directory o git recusa ("dubious ownership").
  const gitBase=['-c','safe.directory='+repoDir,'-C',repoDir];
  let cache=null;   // {chave, arquivos:Map(rel→{link,pesado}), pastas:Map(rel→[filhos])}
  // Os ignorados (pra busca) saem de um `git ls-files --ignored` (meio segundo no repo grande): cache próprio de 30 s,
  // que cai quando o .gitignore muda ou quando a tela pede fresco (depois de enviar um arquivo).
  let pesadosCache=null,frescoEm=0;
  const SEM_DEPENDENCIA=[...PASTAS_DEPENDENCIA].map(p=>':(exclude,glob)**/'+p+'/**');
  async function pesados(fresco=false){
    let mt=0;
    try{mt=(await stat(path.join(repoDir,'.gitignore'))).mtimeMs;}catch{}
    const agora=Date.now();
    if(fresco&&agora-frescoEm>2000){frescoEm=agora;pesadosCache=null;}
    if(pesadosCache&&pesadosCache.mt===mt&&agora-pesadosCache.em<30000)return pesadosCache.lista;
    let lista=[];
    try{
      const {stdout}=await run(git,[...gitBase,'ls-files','-z','--others','--ignored','--exclude-standard','--','.',...SEM_DEPENDENCIA],{maxBuffer:64*1024*1024});
      lista=stdout.split('\0').filter(rel=>rel&&naBusca(rel)).slice(0,MAX_ARQUIVOS);
    }catch{}
    pesadosCache={mt,em:agora,lista};return lista;
  }
  const marked=new Marked({gfm:true});

  function montar(entradas){
    const arquivos=new Map(),pastas=new Map([['',new Map()]]);
    for(const [rel,link,pesado] of entradas){
      arquivos.set(rel,pesado?{link,pesado}:{link});
      const partes=rel.split('/');let pai='';
      for(let i=0;i<partes.length;i++){
        const atual=partes.slice(0,i+1).join('/');const ehArquivo=i===partes.length-1;
        pastas.get(pai).set(partes[i],ehArquivo?'arquivo':'pasta');
        if(!ehArquivo&&!pastas.has(atual))pastas.set(atual,new Map());
        pai=atual;
      }
    }
    // Versão sem acento/maiúscula de cada pasta e arquivo, pra busca. Calculada uma vez por índice.
    const normal=new Map();
    for(const rel of pastas.keys())if(rel)normal.set(rel,{nome:semAcento(rel.split('/').pop()),caminho:semAcento(rel),tipo:'pasta'});
    for(const rel of arquivos.keys())normal.set(rel,{nome:semAcento(rel.split('/').pop()),caminho:semAcento(rel),tipo:'arquivo'});
    return {arquivos,pastas,normal};
  }

  async function varrer(){
    const entradas=[];
    async function descer(rel){
      if(entradas.length>=MAX_ARQUIVOS)return;
      let itens;try{itens=await readdir(path.join(repoDir,rel),{withFileTypes:true});}catch{return;}
      for(const item of itens){
        if(escondido(item.name)||PASTAS_DEPENDENCIA.has(item.name))continue;
        const filho=rel?rel+'/'+item.name:item.name;
        if(item.isDirectory())await descer(filho);
        else if(item.isFile()||item.isSymbolicLink())entradas.push([filho,item.isSymbolicLink()]);
        if(entradas.length>=MAX_ARQUIVOS)return;
      }
    }
    await descer('');return entradas;
  }

  async function indice({fresco=false}={}){
    let temGit=true,chaveGit=0;
    try{chaveGit=(await stat(path.join(repoDir,'.git','index'))).mtimeMs;}catch{temGit=false;}
    // O índice do git muda a cada pull/commit; a data dele invalida o cache. Arquivo solto
    // (pasta simples ou não versionado) não mexe no índice: aí vale um cache curto.
    const curto=!temGit||naoVersionados;
    const pes=temGit?await pesados(fresco):[];
    const assinaPes=pes.length?createHash('sha1').update(pes.join('\0')).digest('hex').slice(0,8):'';
    if(cache&&cache.chave===chaveGit&&cache.assinaPes===assinaPes&&(!curto||Date.now()-cache.em<5000))return cache;
    let entradas,soltos='',sumidos='';
    if(temGit){
      const {stdout}=await run(git,[...gitBase,'ls-files','-s','-z'],{maxBuffer:64*1024*1024});
      entradas=stdout.split('\0').filter(Boolean).map(linha=>[linha.slice(linha.indexOf('\t')+1),linha.startsWith('120000')]).filter(([rel])=>naBusca(rel));
      if(naoVersionados){
        // Versionado que saiu do disco (mv ou rm sem commit) sai da árvore na hora, não só depois do commit:
        // senão a pasta movida aparece no lugar velho e no novo.
        sumidos=(await run(git,[...gitBase,'ls-files','-z','--deleted'],{maxBuffer:64*1024*1024})).stdout;
        if(sumidos){const fora=new Set(sumidos.split('\0').filter(Boolean));entradas=entradas.filter(([rel])=>!fora.has(rel));}
        soltos=(await run(git,[...gitBase,'ls-files','-z','--others','--exclude-standard'],{maxBuffer:64*1024*1024})).stdout;
        for(const rel of soltos.split('\0'))if(rel&&naBusca(rel)){
          let link=false;try{link=(await lstat(path.join(repoDir,rel))).isSymbolicLink();}catch{continue;}
          entradas.push([rel,link]);
        }
      }
      for(const rel of pes){
        let link=false;try{link=(await lstat(path.join(repoDir,rel))).isSymbolicLink();}catch{continue;}
        entradas.push([rel,link,true]);
      }
    }else entradas=await varrer();
    // Assinatura dos não versionados, dos apagados e dos pesados: arquivo novo, movido ou apagado não muda o HEAD,
    // então entra na versão do estado.
    const assinatura=soltos||sumidos||pes.length?createHash('sha1').update(soltos+'\0'+sumidos+'\0'+assinaPes).digest('hex').slice(0,8):'';
    cache={chave:chaveGit,em:Date.now(),assinatura,assinaPes,...montar(entradas)};return cache;
  }

  async function sincronizadoEm(){
    try{return (await stat(path.join(repoDir,'.git','FETCH_HEAD'))).mtime.toISOString();}catch{return null;}
  }

  // Caminho dentro da pasta, sem atalho (symlink) em nenhum ponto: o que a árvore lista e o que se abre.
  async function semAtalho(rel){
    let atual=repoDir;
    for(const parte of rel?rel.split('/'):[]){atual=path.join(atual,parte);let st;try{st=await lstat(atual);}catch{return null;}if(st.isSymbolicLink())return null;}
    return atual;
  }
  // Uma pasta, do disco: nome, tipo, tamanho e data. Fora só a .git e o que a pessoa não pode ver (pasta restrita).
  async function lerPasta(rel){
    if(rel&&bloqueado(rel))throw problem(404,'Pasta não encontrada.');
    const abs=await semAtalho(rel);let entradas;
    try{if(!abs)throw 0;entradas=await readdir(abs,{withFileTypes:true});}catch{throw problem(404,'Pasta não encontrada.');}
    const itens=[];
    for(const e of entradas){
      if(escondido(e.name))continue;
      const caminho=rel?rel+'/'+e.name:e.name;if(bloqueado(caminho))continue;
      const tipo=e.isDirectory()?'pasta':e.isSymbolicLink()?'atalho':e.isFile()?'arquivo':null;if(!tipo)continue;
      const item={nome:e.name,caminho,tipo};
      if(tipo!=='pasta')try{const st=await lstat(path.join(abs,e.name));item.tamanho=st.size;item.modificado=st.mtime.toISOString();}catch{continue;}
      // atalho pra pasta: o seletor de pasta e o botão direito oferecem conversar nela (só o tipo do destino; o conteúdo segue fora)
      if(tipo==='atalho')try{if((await stat(path.join(abs,e.name))).isDirectory())item.alvo='pasta';}catch{}
      itens.push(item);
    }
    itens.sort((a,b)=>(a.tipo==='pasta'?0:1)-(b.tipo==='pasta'?0:1)||a.nome.localeCompare(b.nome,'pt-BR',{numeric:true,sensitivity:'base'}));
    return itens.length>MAX_POR_PASTA?{itens:itens.slice(0,MAX_POR_PASTA),limitado:true,total:itens.length}:{itens};
  }
  // Marca foraDoGit no que o git não guarda: ignorado pelo .gitignore, ou dentro de um repositório aninhado (pasta com
  // .git própria, que o git de fora não enxerga por dentro). Um `git check-ignore` só pra todas as pastas pedidas.
  async function marcarForaDoGit(listas){
    if(!await comGit())return;
    const aninhado=new Map();
    const ehRepo=async rel=>{if(!rel)return false;if(!aninhado.has(rel)){let r=false;try{await lstat(path.join(repoDir,rel,'.git'));r=true;}catch{}aninhado.set(rel,r);}return aninhado.get(rel);};
    const dentroDeAninhado=async rel=>{const p=rel?rel.split('/'):[];for(let i=1;i<=p.length;i++)if(await ehRepo(p.slice(0,i).join('/')))return true;return false;};
    const perguntar=[];
    for(const [dir,itens] of listas){
      const todos=await dentroDeAninhado(dir);
      for(const it of itens){
        if(todos||(it.tipo==='pasta'&&await ehRepo(it.caminho)))it.foraDoGit=true;else perguntar.push(it);
      }
    }
    if(!perguntar.length)return;
    try{
      const filho=execFile(git,[...gitBase,'check-ignore','-z','-v','-n','--stdin'],{maxBuffer:16*1024*1024});
      const saida=new Promise(ok=>{let d='';filho.stdout.on('data',x=>{d+=x;});filho.on('close',()=>ok(d));filho.on('error',()=>ok(''));});
      filho.stdin.on('error',()=>{});filho.stdin.end(perguntar.map(it=>it.caminho).join('\0')+'\0');
      const campos=(await saida).split('\0'),ignorado=new Set();
      for(let i=0;i+3<campos.length;i+=4)if(campos[i])ignorado.add(campos[i+3]);
      for(const it of perguntar)if(ignorado.has(it.caminho))it.foraDoGit=true;
    }catch{}
  }
  // subpastas: junto, o conteúdo de cada subpasta (até 60), pra abrir a próxima pasta sem ir na rede de novo.
  async function listar(entrada,{subpastas=false}={}){
    const rel=normalizar(entrada);const lida=await lerPasta(rel);
    const listas=[[rel,lida.itens]],filhos={};
    if(subpastas)for(const i of lida.itens.filter(i=>i.tipo==='pasta').slice(0,60)){
      try{const sub=await lerPasta(i.caminho);filhos[i.caminho]=sub.itens;listas.push([i.caminho,sub.itens]);}catch{}
    }
    await marcarForaDoGit(listas);
    // `pesado` era o nome antigo do sinal (Apagar ainda lê): mesmo valor
    for(const [,itens] of listas)for(const it of itens)if(it.foraDoGit)it.pesado=true;
    const r={caminho:rel,itens:lida.itens,...(lida.limitado?{limitado:true,total:lida.total}:{}),sincronizadoEm:await sincronizadoEm()};
    if(subpastas)r.filhos=filhos;
    return r;
  }

  // Busca por palavras, sem acento e sem maiúscula, em qualquer ordem: cada palavra só precisa estar contida.
  //  1. todas as palavras no NOME (pasta ou arquivo): o caso principal;
  //  2. com 2+ palavras (ou "/"), vale espalhar pelo CAMINHO, desde que ao menos uma esteja no nome.
  //     Com 1 palavra só, não: "acme" acharia cada arquivo dentro da pasta Acme.
  // Ordem: nome que começa com a 1ª palavra, depois nome que contém, depois caminho; pastas antes; caminho curto antes.
  // O texto normalizado sai pronto do índice (montar), então cada busca é só um laço de includes().
  async function buscar(termo){
    const bruto=String(termo??'').trim();const palavras=semAcento(bruto).split(/[\s/]+/).filter(Boolean);
    if(bruto.length<2||!palavras.length)return {itens:[]};
    const {arquivos,normal}=await indice();const porCaminho=palavras.length>1||bruto.includes('/');const achados=[];
    for(const [rel,{nome,caminho,tipo}] of normal){
      if(bloqueado(rel))continue;
      let peso;
      if(palavras.every(p=>nome.includes(p)))peso=nome.startsWith(palavras[0])?0:1;
      else if(porCaminho&&palavras.every(p=>caminho.includes(p))&&palavras.some(p=>nome.includes(p)))peso=2;
      else continue;
      achados.push({nome:rel.split('/').pop(),caminho:rel,tipo:tipo==='pasta'?'pasta':arquivos.get(rel).link?'atalho':'arquivo',...(tipo!=='pasta'&&arquivos.get(rel).pesado?{pesado:true,foraDoGit:true}:{}),_p:peso*2+(tipo==='pasta'?0:1),_n:rel.length});
    }
    achados.sort((a,b)=>a._p-b._p||a._n-b._n);
    const itens=achados.slice(0,MAX_BUSCA).map(({_p,_n,...item})=>item);
    return {itens,limitado:achados.length>MAX_BUSCA,total:achados.length};
  }

  // abertas: as pastas abertas na árvore. A data de uma pasta muda quando algo entra, sai ou troca de nome nela, então
  // a versão acompanha o disco (pasta nova, vazia, ignorada) e não só o git.
  async function estado({abertas=[]}={}){
    let ultimo=null;
    if(syncStateFile){try{ultimo=JSON.parse(await readFile(syncStateFile,'utf8'));}catch{}}
    // Commit atual do checkout: a tela recarrega a árvore sozinha quando ele muda.
    let versao=null;try{versao=(await run(git,[...gitBase,'rev-parse','--short','HEAD'])).stdout.trim()||null;}catch{}
    // Arquivo novo (naoVersionados) ou pesado (fora do git) também muda a versão, e a árvore recarrega.
    if(versao){try{const {assinatura}=await indice();if(assinatura)versao+='+'+assinatura;}catch{}}
    const datas=[];
    for(const a of ['',...abertas].slice(0,60)){let rel;try{rel=normalizar(a);}catch{continue;}if(rel&&bloqueado(rel))continue;
      try{const abs=await semAtalho(rel);datas.push(rel+':'+(abs?(await stat(abs)).mtimeMs:'-'));}catch{datas.push(rel+':-');}}
    versao=(versao??'disco')+'~'+createHash('sha1').update(datas.join('\n')).digest('hex').slice(0,8);
    return {sincronizadoEm:await sincronizadoEm(),ultimo,versao,podeSincronizar:Boolean(syncRequestFile)};
  }

  // O gateway não roda git (o repo é somente leitura pra ele). Só toca um arquivo;
  // uma unidade .path do systemd vê a mudança e roda o sync como o dono do repo.
  async function pedirSync(){
    if(!syncRequestFile)throw problem(404,'Atualização manual não configurada.');
    const agora=Date.now();if(agora-ultimoPedido<15000)return {aceito:false,motivo:'Já pedido há pouco. Aguarde alguns segundos.'};
    ultimoPedido=agora;const temp=syncRequestFile+'.'+agora+'.tmp';
    await writeFile(temp,new Date(agora).toISOString()+'\n',{mode:0o600});await rename(temp,syncRequestFile);
    return {aceito:true,pedidoEm:new Date(agora).toISOString()};
  }

  // Resolve um arquivo da pasta (do disco, como a árvore) para o caminho real, recusando symlink em qualquer ponto,
  // a pasta .git (normalizar) e pasta restrita.
  async function resolver(entrada){
    const rel=normalizar(entrada);if(!rel||bloqueado(rel))throw problem(404,'Arquivo não encontrado.');
    const atual=await semAtalho(rel);if(!atual)throw problem(404,'Arquivo não encontrado.');
    const base=await realpath(repoDir);const real=await realpath(atual);
    if(!real.startsWith(base+path.sep))throw problem(404,'Arquivo não encontrado.');
    const s=await stat(real);if(!s.isFile())throw problem(404,'Arquivo não encontrado.');
    return {rel,real,tamanho:s.size,ext:path.extname(rel).toLowerCase()};
  }

  async function ehTexto(real){
    const fd=await open(real,'r');try{const buf=Buffer.alloc(8192);const {bytesRead}=await fd.read(buf,0,8192,0);return !buf.subarray(0,bytesRead).includes(0);}finally{await fd.close();}
  }

  // Entrega o arquivo como ele é. Tudo que pode executar script (HTML, SVG, texto
  // que o navegador poderia sniffar) vai com sandbox sem allow-same-origin.
  async function servir(res,entrada,{head=false,baixar=false}={}){
    const f=await resolver(entrada);
    let tipo=tipos[f.ext]??((await ehTexto(f.real))?'text/plain; charset=utf-8':'application/octet-stream');
    const headers={'content-type':tipo,'content-length':f.tamanho,'cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer'};
    headers['content-security-policy']=inertes.has(f.ext)?"frame-ancestors 'self'":sandboxPolicy;
    if(baixar||tipo==='application/octet-stream')headers['content-disposition']="attachment; filename*=UTF-8''"+encodeURIComponent(path.basename(f.rel));
    res.writeHead(200,headers);
    if(head){res.end();return;}
    await new Promise((ok,erro)=>{const s=createReadStream(f.real);s.on('error',erro);res.on('close',ok);s.pipe(res);});
  }

  async function lerTexto(entrada){
    const f=await resolver(entrada);
    if(f.tamanho>MAX_RENDER)throw problem(413,'Arquivo grande demais para mostrar aqui. Use “Baixar”.');
    if(!await ehTexto(f.real))throw problem(415,'Este arquivo não é texto.');
    return {...f,texto:await readFile(f.real,'utf8')};
  }

  async function renderMarkdown(entrada){
    const f=await lerTexto(entrada);
    const corpo=marked.parse(f.texto.replace(/^---\n[\s\S]*?\n---\n/,''));
    return paginaDoc(f.rel,`<article class="md">${corpo}</article>`);
  }

  async function renderFonte(entrada){
    const f=await lerTexto(entrada);
    const linhas=f.texto.replace(/\n$/,'').split('\n').map((l,i)=>`<span id="L${i+1}">${esc(l)||' '}</span>`).join('');
    return paginaDoc(f.rel,`<pre class="fonte">${linhas}</pre>`);
  }

  // ── Histórico de um arquivo (git log) ──
  // O checkout pode ser clone parcial (blob:none): o histórico de commits está todo lá, mas versão antiga de
  // arquivo pode faltar, e pedir uma que falta faria o git buscar no remoto (o gateway não tem chave: trava
  // e falha). Por isso: rede desligada no git daqui, e antes de ler uma versão o rev-list --missing=print
  // diz se ela está aqui (30 ms). Versão que falta vira aviso na tela, não espera.
  const gitSemRede={...process.env,GIT_SSH_COMMAND:'/bin/false',GIT_TERMINAL_PROMPT:'0',GIT_NO_LAZY_FETCH:'1'};
  const gitLer=(args,opcoes={})=>run(git,[...gitBase,...args],{env:gitSemRede,timeout:10000,maxBuffer:16*1024*1024,...opcoes});
  async function comGit(){try{await stat(path.join(repoDir,'.git'));return true;}catch{return false;}}
  const commitOk=c=>{if(!/^[0-9a-f]{7,40}$/.test(String(c??'')))throw problem(404,'Versão não encontrada.');return c;};
  async function historico(entrada){
    const f=await resolver(entrada);
    if(!await comGit())return {disponivel:false,itens:[]};
    const {stdout}=await gitLer(['log','-n','60','--format=%H%x1f%h%x1f%an%x1f%ae%x1f%aI%x1f%s%x1e','--',f.rel]);
    const itens=stdout.split('\x1e').map(r=>r.trim()).filter(Boolean).map(r=>{const [commit,curto,autor,email,quando,mensagem]=r.split('\x1f');return {commit,curto,autor,email,quando,mensagem};});
    return {disponivel:true,itens};
  }
  // A versão do arquivo num commit: {oid} se está aqui, {falta:true} se é do clone parcial, null se o arquivo não existia.
  // Pela árvore do commit (ls-tree): o rev-list com caminho pulava o commit que não mexeu no arquivo.
  async function blobEm(commit,rel){
    let linha;try{linha=(await gitLer(['ls-tree',commit,'--',rel])).stdout.trim();}catch{return null;}
    const m=linha.match(/^\d+ blob ([0-9a-f]+)\t/);if(!m)return null;
    // presença sem buscar no remoto: com a versão faltando, sai "?oid" ou erro de objeto, na hora
    try{if((await gitLer(['rev-list','--objects','--missing=print','--no-walk',m[1]])).stdout.trim().startsWith('?'))return {falta:true};}catch{return {falta:true};}
    return {oid:m[1]};
  }
  async function blobTexto(oid){
    const {stdout}=await gitLer(['cat-file','-p',oid],{encoding:'buffer'});
    if(stdout.length>MAX_RENDER)throw problem(413,'Versão grande demais para mostrar aqui.');
    if(stdout.subarray(0,8192).includes(0))throw problem(415,'Este arquivo não é texto.');
    return stdout.toString('utf8');
  }
  // O que mudou no arquivo naquele commit: diff da versão de antes (1º pai) pra versão do commit.
  async function mudanca(entrada,commit){
    const f=await resolver(entrada);commitOk(commit);
    const depois=await blobEm(commit,f.rel);
    const antes=await blobEm(commit+'^',f.rel);
    if(depois?.falta||antes?.falta)return {estado:'falta'};
    if(!depois)return {estado:'apagado'};
    if(!antes){const texto=await blobTexto(depois.oid);return {estado:'novo',diff:texto.split('\n').map(l=>'+'+l).join('\n').slice(0,400000)};}
    let diff;try{diff=(await gitLer(['diff','--no-color','-U3',antes.oid,depois.oid])).stdout;}catch(e){if(e.code===1)diff=e.stdout;else throw e;}
    diff=diff.split('\n');const i=diff.findIndex(l=>l.startsWith('@@'));
    return {estado:'ok',diff:(i<0?'':diff.slice(i).join('\n')).slice(0,400000)};
  }
  async function versao(entrada,commit){
    const f=await resolver(entrada);commitOk(commit);
    const b=await blobEm(commit,f.rel);
    if(!b)throw problem(404,'O arquivo não existia nessa versão.');
    if(b.falta)return {estado:'falta'};
    return {estado:'ok',texto:await blobTexto(b.oid)};
  }

  // ── Habilidades: as skills (.claude/skills e .agents/skills) em qualquer pasta do repo ──
  // Sem varrer o disco: sai do índice que a árvore já guarda (git ls-files). O `find` levou 4,7 s na VPS;
  // isto é instantâneo. Só o cabeçalho de cada SKILL.md é lido, uma vez por versão do índice.
  let cacheSkills=null;
  async function habilidades(){
    const ind=await indice();
    if(cacheSkills?.ind===ind)return cacheSkills.lista.filter(h=>!bloqueado(h.caminho));
    const lista=[];
    for(const [rel,info] of ind.arquivos){
      const m=rel.match(/^(?:(.*)\/)?\.(claude|agents)\/skills\/([^/]+)\/SKILL\.md$/);if(!m||info.link||info.pesado)continue;
      let cab={};try{cab=cabecalhoSkill((await lerTexto(rel)).texto);}catch{continue;}
      lista.push({nome:cab.name||m[3],descricao:cab.description||'',caminho:rel,onde:m[1]??'',de:m[2]});
    }
    lista.sort((a,b)=>(a.onde?1:0)-(b.onde?1:0)||a.onde.localeCompare(b.onde,'pt-BR')||a.nome.localeCompare(b.nome,'pt-BR'));
    cacheSkills={ind,lista};
    return lista.filter(h=>!bloqueado(h.caminho));
  }

  // ── Registros do time (convenção do Ratos OS): _contexto/integracoes.md (ou o nome antigo, ferramentas.md)
  // e _contexto/automacoes.md. As tabelas viram linhas {coluna: valor}, com o título da seção. ──
  // Índice mudou (o sync roda a cada 15 min): devolve o anterior na hora e refaz por trás.
  let cacheRegistros=null,refazendo=null;
  async function registros(){
    const ind=await indice();
    if(cacheRegistros?.ind===ind)return cacheRegistros.r;
    if(cacheRegistros){refazendo??=montarRegistros(ind).finally(()=>{refazendo=null;});refazendo.catch(()=>{});return cacheRegistros.r;}
    return montarRegistros(ind);
  }
  async function montarRegistros(ind){
    const ler=async rel=>{if(!ind.arquivos.has(rel)||bloqueado(rel))return null;try{return {arquivo:rel,...lerTabelas((await lerTexto(rel)).texto)};}catch{return null;}};
    const r={integracoes:await ler('_contexto/integracoes.md')??await ler('_contexto/ferramentas.md'),automacoes:await ler('_contexto/automacoes.md'),sinais:await sinaisDeIntegracao(ind)};
    cacheRegistros={ind,r};return r;
  }
  // Sinais de integração no repo, pra avisar o que está sem registro: referências op:// (1Password), servidores
  // de .mcp.json e nomes de chave em .env versionado. Só nomes, nunca valores.
  async function sinaisDeIntegracao(ind){
    const out=new Map();const anota=(tipo,nome,rel)=>{const k=tipo+':'+nome;const x=out.get(k)??{tipo,nome,onde:[]};if(x.onde.length<3&&!x.onde.includes(rel))x.onde.push(rel);out.set(k,x);};
    if(!await comGit())return [];
    try{
      // só scripts, configs e .env: no repo inteiro levava 3,8 s; assim, 0,4 s
      const {stdout}=await gitLer(['grep','-I','-o','-E','op://[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+','--','*.sh','*.py','*.js','*.mjs','*.cjs','*.ts','*.json','*.toml','*.yaml','*.yml','*.ps1','.env*','*/.env*'],{maxBuffer:8*1024*1024});
      for(const l of stdout.split('\n')){const m=l.match(/^(.*?):op:\/\/([^/]+)\/(.+)$/);if(!m||bloqueado(m[1]))continue;
        if(/^(vault|vault-equipe|Vault)$/i.test(m[2])||/^(item|ferramenta-x|\.\.\.)$/i.test(m[3]))continue;anota('op',m[2]+'/'+m[3],m[1]);}
    }catch(e){if(e.code!==1)throw e;}
    for(const rel of ind.arquivos.keys()){
      if(bloqueado(rel))continue;const nome=rel.split('/').pop();
      if(nome==='.mcp.json'){try{for(const k of Object.keys(JSON.parse((await lerTexto(rel)).texto).mcpServers??{}))anota('mcp',k,rel);}catch{}}
      else if(/^\.env(\..+)?$/.test(nome)){try{for(const v of nomesDeChave((await lerTexto(rel)).texto))anota('env',v,rel);}catch{}}
    }
    return [...out.values()];
  }

  return {listar,buscar,resolver,servir,renderMarkdown,renderFonte,estado,pedirSync,historico,mudanca,versao,habilidades,registros};
}

// Nomes de variável com cara de chave (o valor nunca sai daqui). Chave pública (vai pro navegador) não conta.
const PUBLICA=/^(NEXT_PUBLIC_|VITE_|PUBLIC_|EXPO_PUBLIC_)|PUBLISHABLE|ANON_KEY|SITE_KEY/;
export function nomesDeChave(texto){
  const out=new Set();
  for(const l of String(texto).split('\n')){const m=l.match(/^\s*(?:export\s+)?([A-Z][A-Z0-9_]{2,})\s*=/);if(m&&/(KEY|TOKEN|SECRET|PASSWORD|PASS|CREDENTIALS?)$/.test(m[1])&&!PUBLICA.test(m[1]))out.add(m[1]);}
  return [...out];
}
// Tabelas de um markdown, com o título da seção (## ...) de cada uma.
export function lerTabelas(texto){
  const linhas=String(texto).split('\n');const secoes=[];let titulo='',i=0;
  const celulas=l=>l.trim().replace(/^\|/,'').replace(/\|$/,'').split('|').map(c=>c.trim());
  while(i<linhas.length){
    const l=linhas[i];const h=l.match(/^#{1,3}\s+(.*)$/);if(h){titulo=h[1].trim();i++;continue;}
    if(/^\s*\|/.test(l)&&/^\s*\|?\s*:?-+:?\s*(\||$)/.test(linhas[i+1]??'')){
      const colunas=celulas(l).map(c=>c.toLowerCase());i+=2;const itens=[];
      while(i<linhas.length&&/^\s*\|/.test(linhas[i])){const c=celulas(linhas[i]);if(c.some(Boolean))itens.push(Object.fromEntries(colunas.map((k,j)=>[k,c[j]??''])));i++;}
      secoes.push({titulo,colunas,itens});continue;
    }
    i++;
  }
  return {titulo:(String(texto).match(/^#\s+(.*)$/m)?.[1]??'').trim(),secoes};
}

// Cabeçalho (frontmatter) de um SKILL.md: name e description, com valor numa linha, entre aspas,
// em bloco (| ou >) ou continuado nas linhas indentadas de baixo.
export function cabecalhoSkill(texto){
  const m=String(texto).match(/^---\r?\n([\s\S]*?)\r?\n---/);if(!m)return {};
  const linhas=m[1].split(/\r?\n/),out={};
  for(let i=0;i<linhas.length;i++){
    const k=linhas[i].match(/^([A-Za-z_][\w-]*):\s*(.*)$/);if(!k)continue;
    let v=k[2].trim();const partes=[];
    while(i+1<linhas.length&&(/^\s+\S/.test(linhas[i+1])||linhas[i+1].trim()===''&&/^\s/.test(linhas[i+2]??''))){partes.push(linhas[++i].trim());}
    if(/^[|>][+-]?$/.test(v))v=partes.join(k[2].startsWith('|')?'\n':' ');else if(partes.length)v=[v,...partes].join(' ');
    v=v.replace(/^(['"])([\s\S]*)\1$/,'$2').trim();
    out[k[1]]=v;
  }
  return out;
}

const esc=s=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function paginaDoc(rel,corpo){
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><title>${esc(rel.split('/').pop())}</title><style>
:root{--bg:#fbfaf7;--tx:#1d1d1b;--mu:#6b6860;--li:#e6e3dc;--chip:#f1efe9;--ac:#FFD600;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:var(--tx);background:var(--bg)}
@media(prefers-color-scheme:dark){:root{--bg:#141413;--tx:#ecebe6;--mu:#a19d93;--li:#34332f;--chip:#242421}}
body{margin:0}.md{max-width:780px;margin:0 auto;padding:36px 20px 80px;line-height:1.65;font-size:16px;overflow-wrap:break-word}
.md h1{font-size:30px;line-height:1.2;letter-spacing:-.02em}.md h2{font-size:22px;margin-top:2em}.md h3{font-size:18px;margin-top:1.6em}
.md a{color:inherit;text-underline-offset:3px}.md code{font:.88em ui-monospace,SFMono-Regular,Menlo,monospace;background:var(--chip);padding:1px 5px;border-radius:4px}
.md pre{background:var(--chip);padding:14px 16px;border-radius:8px;overflow-x:auto}.md pre code{background:none;padding:0}
.md table{border-collapse:collapse;display:block;overflow-x:auto;font-size:14.5px}.md th,.md td{border:1px solid var(--li);padding:6px 10px;text-align:left;vertical-align:top}.md th{background:var(--chip)}
.md blockquote{margin:1em 0;padding:2px 16px;border-left:4px solid var(--ac);color:var(--mu)}.md img{max-width:100%}.md hr{border:0;border-top:1px solid var(--li);margin:2em 0}
.fonte{margin:0;padding:16px 0 60px;font:13px/1.55 ui-monospace,SFMono-Regular,Menlo,monospace;counter-reset:l;white-space:pre-wrap;overflow-wrap:anywhere;tab-size:2}
.fonte span{display:block;padding:0 16px 0 64px;position:relative}.fonte span:before{counter-increment:l;content:counter(l);position:absolute;left:0;width:48px;text-align:right;color:var(--mu);user-select:none}
.fonte span:hover{background:var(--chip)}
.fonte span:target{background:var(--chip);box-shadow:inset 3px 0 0 #e0b400;scroll-margin-top:30vh}
</style></head><body>${corpo}</body></html>`;
}
