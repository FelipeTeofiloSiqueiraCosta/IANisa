// Adaptado do gateway/connections.mjs do código beta, mantido intacto.
import {randomUUID} from 'node:crypto';
import {problem} from './accounts.mjs';

const names={claude:'Claude Code','claude-token':'Claude geral','claude-conta':'Claude',codex:'Codex','codex-geral':'Codex geral','codex-conta':'Codex'};
const done=new Set(['complete','error','cancelled']);
const TOKEN=/sk-ant-oat01-[A-Za-z0-9_-]{20,300}/;
export function stripAnsi(text){return text.replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g,'').replace(/\x1b\[[0-?]*[ -/]*[@-~]/g,'').replace(/\r/g,'');}
export function parseStatus(provider,result){
  const base={id:provider,name:names[provider],installed:result.missing!==true,status:'unknown',checkedAt:new Date().toISOString()};
  if(result.missing)return {...base,message:'CLI não encontrado nesta instalação.'};
  if(provider==='claude'){
    try{
      const data=JSON.parse(result.stdout??'');
      if(typeof data.loggedIn!=='boolean')throw new Error('Unknown format');
      return {...base,status:data.loggedIn?'connected':'disconnected',
        ...(typeof data.email==='string'&&data.email.length<200?{account:data.email}:{}),
        ...(['max','pro','team','enterprise'].includes(data.subscriptionType)?{plan:data.subscriptionType}:{}),
        // oauth_token = token de longa duração no ambiente: é a conta geral da IANiza
        ...(data.loggedIn&&data.authMethod==='oauth_token'?{via:'geral'}:{}),
        message:data.loggedIn?(data.authMethod==='oauth_token'?'Usando a conta geral da IANiza.':'Login reconhecido pelo CLI.'):'Conecte uma conta para usar o agente.'};
    }catch{return {...base,message:'Não foi possível confirmar o login agora.'};}
  }
  const text=stripAnsi((result.stdout??'')+'\n'+(result.stderr??''));
  if(result.code===0&&/Logged in using ChatGPT/i.test(text))return {...base,status:'connected',plan:'ChatGPT',message:'Login reconhecido pelo CLI.'};
  if(result.code===0&&/Logged in using an? API key/i.test(text))return {...base,status:'connected',message:'Autenticação por chave configurada no CLI.'};
  if(/not logged in/i.test(text))return {...base,status:'disconnected',message:'Conecte uma conta para usar o agente.'};
  return {...base,message:'Não foi possível confirmar o login agora.'};
}

export function parseLoginOutput(provider,raw){
  const text=stripAnsi(raw);let url;
  // O Claude Code manda o link como hyperlink de terminal (OSC 8: ESC]8;id=..;URL ESC\\ texto ESC]8;;).
  // O link inteiro só existe dentro do código; o texto visível sai quebrado quando passa da largura.
  const hiperlinks=[...String(raw).matchAll(/\x1b\]8;[^;\x07\x1b]*;(https:\/\/[^\x07\x1b]+)(?:\x07|\x1b\\)/g)].map(m=>m[1]);
  for(const candidate of [...(text.match(/https:\/\/[^\s<>"'\x00-\x1f]+/g)??[]),...hiperlinks]){
    try{
      const parsed=new URL(candidate.replace(/[),.;]+$/,''));
      const allowed=provider.startsWith('claude')
        ? (['claude.com','claude.ai'].includes(parsed.hostname)&&['/cai/oauth/authorize','/oauth/authorize'].includes(parsed.pathname))
        : (parsed.hostname==='auth.openai.com'&&parsed.pathname==='/codex/device');
      if(allowed&&!parsed.username&&!parsed.password&&!parsed.port&&!['access_token','refresh_token','token'].some(key=>parsed.searchParams.has(key)))url=parsed.href;
    }catch{}
  }
  if(!url)return {};
  if(provider.startsWith('claude'))return {url,stage:/paste|code here|código/i.test(text)?'code':'authorize'};
  const code=text.match(/\b[A-Z0-9]{4}-[A-Z0-9]{4,5}\b/)?.[0];
  return {url,...(code?{deviceCode:code}:{}),stage:'authorize'};
}

export class ConnectionManager {
  // aoToken(token): no fluxo claude-token (setup-token), recebe o token que o CLI mostrou no fim.
  // aoCodexGeral(): no fluxo codex-geral, chamado quando o login termina bem; guarda o login gerado.
  // msgToken: o que a tela diz quando o token foi guardado (conta da organização ou pessoal).
  constructor({launch,backup=async()=>{},status,timeoutMs=600000,aoToken=null,aoCodexGeral=null,aoConcluir=null,enterDelayMs=400,msgToken='Conta conectada.'}={}){this.launch=launch;this.msgToken=msgToken;this.enterDelayMs=enterDelayMs;this.backup=backup;this.status=status;this.timeoutMs=timeoutMs;this.aoToken=aoToken;this.aoCodexGeral=aoCodexGeral;this.aoConcluir=aoConcluir;this.flows=new Map();this.starting=false;}
  public(flow){
    const {id,provider,stage,url,deviceCode,expiresAt,message}=flow;
    return {id,provider,stage,...(url?{url}:{}),...(deviceCode?{deviceCode}:{}),expiresAt,...(message?{message}:{})};
  }
  current(owner){const found=[...this.flows.values()].reverse().find(f=>f.owner===owner);return found?this.public(found):null;}
  get(id,owner){const flow=this.flows.get(id);if(!flow||flow.owner!==owner)throw problem(404,'Fluxo não encontrado.');return flow;}
  // extra: guardado no fluxo e entregue ao aoToken (ex.: o nome da conta nova)
  async start(provider,owner,extra={}){
    if(!names[provider])throw problem(400,'Provedor inválido.');
    if(this.starting||[...this.flows.values()].some(f=>!done.has(f.stage)))throw problem(409,'Já existe uma conexão em andamento. Conclua ou cancele a tentativa atual.');
    this.starting=true;
    try{
      await this.backup(provider);
      // Keep a small in-memory history; never persist OAuth URLs or codes.
      if(this.flows.size>=20)this.flows.delete(this.flows.keys().next().value);
      const flow={...extra,id:randomUUID(),provider,owner,stage:'starting',expiresAt:new Date(Date.now()+this.timeoutMs).toISOString(),buffer:'',submitted:false};
      let child;try{child=this.launch(provider,extra);}catch{throw problem(503,'Não foi possível abrir o login nesta instalação.');}
      flow.child=child;this.flows.set(flow.id,flow);
      const update=chunk=>{
        if(done.has(flow.stage))return;
        flow.buffer=(flow.buffer+chunk.toString()).slice(-65536);
        const parsed=parseLoginOutput(provider,flow.buffer);
        if(flow.submitted)delete parsed.stage;
        Object.assign(flow,parsed);
        if(provider!=='claude-token'||!flow.submitted)return;
        // O setup-token pode mostrar o token (ou o erro) e ficar esperando um Enter: não espera ele sair.
        const visivel=stripAnsi(flow.buffer);
        if(TOKEN.test(visivel))return this.guardarToken(flow,visivel,true);
        if(/OAuth error|Press Enter to retry/i.test(visivel))this.finish(flow,'error','A Anthropic recusou o código. Inicie uma nova tentativa e cole o código logo depois de autorizar.',true);
      };
      child.stdout.on('data',update);child.stderr.on('data',update);
      child.stdin.on('error',()=>this.finish(flow,'error','O terminal de login foi encerrado. Tente novamente.'));
      child.on('error',()=>this.finish(flow,'error','Não foi possível iniciar o CLI. Tente novamente.'));
      child.on('exit',async code=>{
        if(done.has(flow.stage))return;
        if(code!==0)return this.finish(flow,'error','A autorização não foi concluída. Tente novamente ou use o terminal da IANiza.');
        if(provider==='claude-token')return this.guardarToken(flow,stripAnsi(flow.buffer));
        // conta pessoal com login completo: o servidor de agentes só sai com 0 quando o login ficou gravado e a conta, na lista
        if(provider==='claude-conta')return this.finish(flow,'complete','Conta conectada, com login completo: os conectores do claude.ai vêm junto.');
        // conta pessoal do Codex (desde 28/10/2026): mesma regra da claude-conta, o servidor só sai com 0 com o login gravado
        if(provider==='codex-conta')return this.finish(flow,'complete','Conta do Codex adicionada. Escolha ela no seletor do chat ou aqui.');
        if(provider==='codex-geral'){
          try{if(!this.aoCodexGeral)throw new Error();await this.aoCodexGeral(flow);}
          catch(e){return this.finish(flow,'error',e.status?e.message:'O login terminou, mas não consegui guardar a conta. Tente de novo.');}
          return this.finish(flow,'complete','Conta do Codex conectada. Quem pode usar já vê ela no seletor do chat.');
        }
        let status;try{status=await this.status?.(provider);}catch{}
        if(done.has(flow.stage))return;
        this.finish(flow,status?.status==='connected'?'complete':'error',status?.status==='connected'?'Conta conectada. Novas sessões já podem usar este login.':'O comando terminou, mas o login ainda não foi confirmado. Atualize o status.');
      });
      flow.timer=setTimeout(()=>this.finish(flow,'error','O prazo de autorização terminou. Inicie uma nova tentativa.',true),this.timeoutMs);flow.timer.unref();
      return this.public(flow);
    }finally{this.starting=false;}
  }
  submit(id,owner,code){
    const flow=this.get(id,owner);
    if(!['claude','claude-token','claude-conta'].includes(flow.provider)||done.has(flow.stage)||flow.submitted||!flow.url)throw problem(409,'Aguarde a autorização ou inicie uma nova tentativa.');
    if(typeof code!=='string'||!/^[A-Za-z0-9_#=.+/\-]{10,4096}$/.test(code.trim()))throw problem(400,'Cole o código completo mostrado na página oficial do Claude.');
    flow.submitted=true;flow.stage='authorize';flow.message='Conferindo a autorização…';flow.buffer='';
    // \r e não \n: o setup-token é uma tela interativa (modo raw), onde só o \r vale como Enter.
    // No login comum (modo de linha) o terminal converte \r em \n, então serve pros dois.
    // O Enter vai num write separado: junto do código, a tela trata o bloco como colagem e o \r vira texto
    // (testado: junto fica parado, separado o CLI responde na hora).
    flow.child.stdin.write(code.trim());
    setTimeout(()=>{if(!done.has(flow.stage))flow.child.stdin.write('\r');},this.enterDelayMs).unref?.();
    return this.public(flow);
  }
  async guardarToken(flow,visivel,stop=false){
    if(flow.guardando||done.has(flow.stage))return;
    // o token vem inteiro numa linha (terminal de 250 colunas no login-runner.py)
    const token=visivel.match(TOKEN)?.[0];
    if(!token||!this.aoToken)return this.finish(flow,'error','O comando terminou, mas não achei o token na saída. Tente de novo ou cole o token.',stop);
    flow.guardando=true;
    try{await this.aoToken(token,flow);}catch(e){return this.finish(flow,'error',e.status?e.message:'Não consegui guardar o token.',stop);}
    this.finish(flow,'complete',this.msgToken,stop);
  }
  finish(flow,stage,message,stop=false){
    if(done.has(flow.stage))return;
    // conta própria conectada: quem estava na conta geral (modo opcional) precisa religar o Paseo
    if(stage==='complete')Promise.resolve().then(()=>this.aoConcluir?.(flow.provider)).catch(()=>{});
    flow.stage=stage;flow.message=message;flow.buffer='';delete flow.url;delete flow.deviceCode;clearTimeout(flow.timer);
    if(stop)flow.child?.kill();
  }
  cancel(id,owner){const flow=this.get(id,owner);this.finish(flow,'cancelled','Tentativa cancelada.',true);return this.public(flow);}
  close(){for(const flow of this.flows.values())this.finish(flow,'cancelled','O serviço foi reiniciado. Inicie uma nova tentativa.',true);}
}
