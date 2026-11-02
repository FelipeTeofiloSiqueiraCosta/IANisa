// Conexões de quem tem ambiente próprio (multiusuário), pelo servidor de agentes da pessoa
// (agentes/, unit ratoeira-agentes@<usuário>), que roda como ela (antes era o terminal do
// Paseo, que saiu em 09/10/2026). O gateway não roda nada como a pessoa e não lê a home dela: pede pro
// servidor dela, por HTTP no socket unix, o status ou o login, com comandos fixos lá dentro.
// Mesmo formato do createCliRuntime: {status, backup, launch, confirm}, então o ConnectionManager
// e a tela de Conexões não mudam.
import http from 'node:http';
import {EventEmitter} from 'node:events';
import {parseStatus} from './connections.mjs';
import {problem} from './catalog.mjs';

const desligado=e=>['ENOENT','ECONNREFUSED'].includes(e?.code);

// ligar(): o servidor da pessoa não respondeu (saiu por ociosidade): pede pro systemd ligar.
export function createAgentesRuntime({socketPath,ligar=null,timeoutMs=20000}){
  function pedir(metodo,caminho,corpo){
    return new Promise((resolve,reject)=>{
      const req=http.request({socketPath,method:metodo,path:caminho,timeout:timeoutMs},res=>{
        let d='';res.setEncoding('utf8');res.on('data',c=>{d=(d+c).slice(-65536);});res.on('end',()=>resolve({status:res.statusCode,corpo:d}));
      });
      req.on('timeout',()=>req.destroy(Object.assign(new Error('timeout'),{code:'ETIMEDOUT'})));
      req.on('error',reject);req.end(corpo);
    });
  }

  const cache=new Map();
  function status(provider,{fresh=false}={}){
    const cached=cache.get(provider);if(!fresh&&cached&&Date.now()-cached.at<15000)return cached.promise;
    const promise=pedir('GET',`/conta/${provider}/status`).then(r=>{
      if(r.status!==200)throw new Error('status');
      const dados=JSON.parse(r.corpo);
      // propria: tem login próprio no disco (mesmo vencido); geralDisponivel: pode cair na geral ao desconectar
      const st={...parseStatus(provider,dados),propria:dados.propria===true,geralDisponivel:dados.geralDisponivel===true,geralFixa:dados.geralFixa===true};
      // Codex na conta geral do time (auth.json é atalho pro arquivo único)
      return dados.geral&&st.status==='connected'?{...st,via:'geral',message:'Usando a conta geral da Ratoeira.'}:st;
    }).catch(e=>{
      const ligando=desligado(e)&&Boolean(ligar);
      if(ligando)try{ligar();}catch{}
      return {...parseStatus(provider,{stdout:'',code:1}),message:ligando?'Ligando o seu ambiente. Atualiza sozinho em alguns segundos.':'Seu ambiente não respondeu. Tente de novo em alguns segundos.',...(ligando?{ligando:true}:{})};
    });
    cache.set(provider,{at:Date.now(),promise});
    promise.then(r=>{if(r.status==='unknown')cache.delete(provider);});
    return promise;
  }

  // Abre o login no servidor da pessoa e devolve algo com cara de processo filho pro ConnectionManager.
  // extra.nome e extra.id: claude-conta (login completo de uma conta pessoal, nova ou de novo numa que já existe)
  function launch(provider,extra={}){
    // claude-token: setup-token rodado como a pessoa, pra uma conta pessoal (o token volta por adicionarPessoal)
    if(!['claude','claude-token','claude-conta','codex','codex-conta'].includes(provider))throw problem(400,'Provedor inválido.');
    const q=['claude-conta','codex-conta'].includes(provider)?'?'+new URLSearchParams({nome:String(extra.nome??'').slice(0,60),id:/^[a-z0-9]{1,20}$/.test(String(extra.id??''))?extra.id:''}):'';
    cache.delete(provider);
    const child=new EventEmitter();
    child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.stdin=new EventEmitter();
    let fluxo=null,saiu=false,req=null;const pendente=[];let fila=Promise.resolve();
    const sair=(evento,valor)=>{if(saiu)return;saiu=true;req?.destroy();child.emit(evento,valor);};
    // Entrada em ordem (código e depois o Enter, em pedidos separados): cada uma espera a anterior.
    const mandar=texto=>{fila=fila.then(()=>pedir('POST',`/conta/fluxo/${fluxo}/entrada`,texto)).catch(()=>{});};
    child.stdin.write=data=>{if(saiu)return false;if(fluxo)mandar(String(data));else pendente.push(String(data));return true;};
    // fechar a resposta faz o servidor matar o login
    child.kill=()=>sair('exit',null);
    req=http.request({socketPath,method:'POST',path:`/conta/${provider}/login${q}`},res=>{
      if(res.statusCode!==200){res.resume();return sair('error',new Error(res.statusCode===409?'ocupado':'login'));}
      res.setEncoding('utf8');let resto='';
      res.on('data',d=>{
        resto+=d;let i;
        while((i=resto.indexOf('\n'))>=0){
          let o;try{o=JSON.parse(resto.slice(0,i));}catch{o={};}
          resto=resto.slice(i+1);
          if(o.fluxo){fluxo=o.fluxo;for(const t of pendente.splice(0))mandar(t);}
          if(typeof o.saida==='string')child.stdout.emit('data',Buffer.from(o.saida));
          if(Number.isInteger(o.fim)){saiu=true;child.emit('exit',o.fim);}
        }
      });
      res.on('end',()=>sair('exit',1));
      res.on('error',()=>sair('exit',1));
    });
    req.on('error',e=>{if(desligado(e))try{ligar?.();}catch{}sair('error',e);});
    req.end();
    return child;
  }
  // Desconectar a conta própria (o servidor dela volta pra geral, se a pessoa puder usar).
  async function sair(provider){
    if(!['claude','codex'].includes(provider))throw problem(400,'Provedor inválido.');
    cache.delete(provider);
    let r;try{r=await pedir('POST',`/conta/${provider}/sair`);}catch{throw problem(503,'Teu ambiente não respondeu. Tente de novo em alguns segundos.');}
    let d={};try{d=JSON.parse(r.corpo);}catch{}
    if(r.status!==200)throw problem(r.status===409?409:502,d.erro||'Não consegui desconectar.');
    return {religou:d.religou!==false};
  }
  // Várias contas do Claude e, desde 28/10/2026, do Codex (servidor de agentes: /conta/<agente>/contas, usar e pessoais).
  async function contaDe(agente,metodo,caminho,corpo){
    if(!['claude','codex'].includes(agente))throw problem(400,'Provedor inválido.');
    let r;try{r=await pedir(metodo,`/conta/${agente}/`+caminho,corpo===undefined?undefined:JSON.stringify(corpo));}catch{throw problem(503,'Teu ambiente não respondeu. Tente de novo em alguns segundos.');}
    let d={};try{d=JSON.parse(r.corpo);}catch{}
    if(r.status!==200)throw problem(r.status===409?409:502,d.erro||'Não consegui.');
    cache.delete(agente);return d;
  }
  const contas=(agente='claude')=>contaDe(agente,'GET','contas');
  const usar=(conta,agente='claude')=>contaDe(agente,'POST','usar',{conta});
  const adicionarPessoal=(nome,token)=>contaDe('claude','POST','pessoais',{nome,token});
  const removerPessoal=(id,agente='claude')=>{if(!/^[a-z0-9]{1,20}$/.test(String(id)))throw problem(404,'Conta não encontrada.');return contaDe(agente,'POST',`pessoais/${id}/remover`,{});};
  // O login é da própria pessoa, na home dela: não há conta compartilhada pra preservar.
  return {status,backup:async()=>{},launch,sair,contas,usar,adicionarPessoal,removerPessoal,confirm:provider=>status(provider,{fresh:true})};
}
