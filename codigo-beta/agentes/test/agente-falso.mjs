// Agente ACP falso pros testes: responde eco, pede permissão quando a mensagem tem "permissão",
// e fica rodando até ser cancelado quando tem "demorar". Anuncia dois comandos (o `/`) a cada conversa nova.
// `vivas` faz as vezes dos processos `claude` do adaptador de verdade: entra no new/load/resume e sai no close.
// Com FALSO_CONTAGEM, grava a contagem nesse arquivo a cada mudança (FALSO_SEM_FECHAR: sem session/close nem session/resume).
// Com FALSO_SEM_LOGIN (um arquivo), faz de conta que não tem conta: listar e conversa nova pedem login e anotam a tentativa ali.
import {Readable,Writable} from 'node:stream';
import * as acp from '@agentclientprotocol/sdk';
import {appendFileSync,writeFileSync} from 'node:fs';
const sessoes=new Map();let n=0,formulario=false;
const MODELO_DA_CONTA=process.env.CLAUDE_CONFIG_DIR?[{value:'so-'+process.env.CLAUDE_CONFIG_DIR.split('/').pop(),name:'Só desta conta'}]:[];
const conta={load:0,resume:0,close:0};const fecha=!process.env.FALSO_SEM_FECHAR;
const semLogin=op=>{if(!process.env.FALSO_SEM_LOGIN)return;appendFileSync(process.env.FALSO_SEM_LOGIN,op+'\n');throw acp.RequestError.authRequired();};
const gravar=()=>{if(process.env.FALSO_CONTAGEM)writeFileSync(process.env.FALSO_CONTAGEM,JSON.stringify({...conta,vivas:[...vivas]}));};
const vivas=new class extends Set{add(v){super.add(v);gravar();return this;}delete(v){const r=super.delete(v);gravar();return r;}};
// ultracode nas configurações da sessão (_meta.claudeCode.options.settings), como o claude-agent-acp lê
const ultra=p=>p?._meta?.claudeCode?.options?.settings?.ultracode===true;
const COMANDOS=[{name:'ajuda',description:'Mostra a ajuda',input:null},{name:'minha-skill',description:'Uma skill de exemplo',input:{hint:'conta'}}];
new acp.AgentSideConnection(conn=>({
  async initialize(p){formulario=!!p?.clientCapabilities?.elicitation?.form;return {protocolVersion:acp.PROTOCOL_VERSION,agentCapabilities:{loadSession:true,sessionCapabilities:{list:{},additionalDirectories:{},...(fecha?{close:{},resume:{}}:{})}},authMethods:[],...(process.env.FALSO_SEM_STEERING?{}:{_meta:{steering:{supported:true}}})};},
  // mensagem com a conversa rodando (_session/steering): entra no turno "demorar" em andamento
  async extMethod(method,params){
    if(method!=='_session/steering')throw new Error('método desconhecido');
    const s=sessoes.get(params.sessionId);const texto=params.prompt.map(b=>b.text??'').join(' ');
    if(!s?.cancelar)return {outcome:'promptRequired',reason:'noRunningTurn'};
    s.falas.push(texto);await conn.sessionUpdate({sessionId:params.sessionId,update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'li no meio: '+texto}}});
    if(texto.includes('termina'))s.cancelar('fim');
    return {outcome:'injected'};
  },
  async authenticate(){return {};},
  // conta pessoal (CLAUDE_CONFIG_DIR): oferece um modelo a mais, só dela, como as contas de verdade têm listas diferentes
  async newSession(p){semLogin('nova');const {cwd,mcpServers=[],additionalDirectories=[]}=p;
    const id='s'+(++n)+'-'+process.pid;sessoes.set(id,{cwd,modo:'default',falas:[],mcp:mcpServers.map(m=>m.name),extras:additionalDirectories,ultra:ultra(p)});vivas.add(id);
    // como os adaptadores de verdade: a lista do `/` chega logo depois de a conversa nascer
    setTimeout(()=>conn.sessionUpdate({sessionId:id,update:{sessionUpdate:'available_commands_update',availableCommands:COMANDOS}}).catch(()=>{}),0);
    return {sessionId:id,modes:{currentModeId:'default',availableModes:[{id:'default',name:'Padrão'},{id:'auto',name:'Automático'}]},
      configOptions:[{id:'model',name:'Modelo',type:'select',currentValue:'a',options:[{value:'a',name:'A'},{value:'b',name:'B'},...MODELO_DA_CONTA]}]};
  },
  async loadSession(p){const {sessionId,mcpServers=[]}=p;
    conta.load++;await new Promise(r=>setTimeout(r,30));   // demora como o de verdade: abrir ao mesmo tempo dá corrida
    const s=sessoes.get(sessionId)??{falas:['antiga']};sessoes.set(sessionId,s);s.mcp=mcpServers.map(m=>m.name);s.ultra=ultra(p);vivas.add(sessionId);
    for(const f of s.falas){
      await conn.sessionUpdate({sessionId,update:{sessionUpdate:'user_message_chunk',content:{type:'text',text:f}}});
      await conn.sessionUpdate({sessionId,update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'eco: '+f}}});
    }
    return {modes:{currentModeId:s.modo??'default',availableModes:[{id:'default',name:'Padrão'},{id:'auto',name:'Automático'}]}};
  },
  // retoma sem repetir o histórico (session/resume) e fecha (session/close), como o claude-agent-acp
  ...(fecha?{
    // de outro processo (outra conta), como o de verdade, que lê o histórico do disco
    async resumeSession(p){const {sessionId,mcpServers=[]}=p;conta.resume++;const s=sessoes.get(sessionId)??{falas:[]};sessoes.set(sessionId,s);s.mcp=mcpServers.map(m=>m.name);s.ultra=ultra(p);vivas.add(sessionId);
      // como o de verdade: acorda no modelo padrão (quem volta a escolha da pessoa é o servidor)
      return {modes:{currentModeId:s.modo??'default',availableModes:[{id:'default',name:'Padrão'},{id:'auto',name:'Automático'}]},
        configOptions:[{id:'model',name:'Modelo',type:'select',currentValue:'a',options:[{value:'a',name:'A'},{value:'b',name:'B'},...MODELO_DA_CONTA]}]};},
    async closeSession({sessionId}){conta.close++;if(!vivas.delete(sessionId))throw new Error('Session not found');return {};},
  }:{}),
  async listSessions(){semLogin('listar');return {sessions:[...sessoes].map(([sessionId,s])=>({sessionId,cwd:s.cwd??'/tmp',title:'conversa '+sessionId,updatedAt:new Date().toISOString()}))};},
  async setSessionMode({sessionId,modeId}){sessoes.get(sessionId).modo=modeId;await conn.sessionUpdate({sessionId,update:{sessionUpdate:'current_mode_update',currentModeId:modeId}});return {};},
  // como o claude-agent-acp: um aviso de config com o valor de antes chega primeiro, e a troca vem só na resposta
  async setSessionConfigOption({sessionId,configId,value}){
    await conn.sessionUpdate({sessionId,update:{sessionUpdate:'config_option_update',configOptions:[{id:configId,name:configId,type:'select',currentValue:'a',options:[{value:'a',name:'A'},{value:'b',name:'B'}]}]}});
    return {configOptions:[{id:configId,name:configId,type:'select',currentValue:value,options:[{value:'a',name:'A'},{value:'b',name:'B'}]}]};},
  async prompt({sessionId,prompt}){
    if(!vivas.has(sessionId))throw new Error('Session not found');
    const s=sessoes.get(sessionId);const texto=prompt.map(b=>b.text??'').join(' ');s.falas.push(texto);
    if(texto.includes('demorar')){const fim=await new Promise(r=>{s.cancelar=r;});s.cancelar=null;return {stopReason:fim===undefined?'cancelled':'end_turn'};}
    if(texto.includes('permissão')){
      const r=await conn.requestPermission({sessionId,toolCall:{toolCallId:'t1',title:'rm arquivo',kind:'execute',status:'pending'},
        options:[{optionId:'sim',name:'Sim',kind:'allow_once'},{optionId:'nao',name:'Não',kind:'reject_once'}]});
      await conn.sessionUpdate({sessionId,update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'resposta: '+(r.outcome.outcome==='selected'?r.outcome.optionId:'cancelado')}}});
      return {stopReason:'end_turn'};
    }
    // como um subagente ou workflow do Claude no fundo: o turno acaba e o pedido de permissão chega depois, sem turno aberto
    if(texto.includes('pedir no fundo')){
      setTimeout(()=>conn.requestPermission({sessionId,toolCall:{toolCallId:'t2',title:'rm no fundo',kind:'execute',status:'pending'},
        options:[{optionId:'sim',name:'Sim',kind:'allow_once'},{optionId:'nao',name:'Não',kind:'reject_once'}]})
        .then(r=>conn.sessionUpdate({sessionId,update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'fundo: '+(r.outcome.outcome==='selected'?r.outcome.optionId:'cancelado')}}})).catch(()=>{}),50);
      return {stopReason:'end_turn'};
    }
    if(texto.includes('morrer'))process.exit(3);
    if(texto.includes('sem-login'))throw acp.RequestError.authRequired();
    if(texto.includes('ultracode?')){await conn.sessionUpdate({sessionId,update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'ultracode: '+(s.ultra?'sim':'nao')}}});return {stopReason:'end_turn'};}
    // uso com os limites do plano, como o claude-agent-acp manda no rate_limit_event
    if(texto.includes('limites?')){
      await conn.sessionUpdate({sessionId,update:{sessionUpdate:'usage_update',used:1000,size:200000,_meta:{'_claude/rateLimit':{status:'allowed',rateLimitType:'five_hour',
        unifiedWindows:{five_hour:{utilization:0.86,resetsAt:1791618000},seven_day:{utilization:0.08,resetsAt:1791759600}}}}}});
      return {stopReason:'end_turn'};
    }
    // limite do plano, como o claude-agent-acp faz pra cliente sem falha tipada: o texto do CLI e depois o turno falha
    if(texto.includes('limite')){
      await conn.sessionUpdate({sessionId,update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:"You've hit your limit · resets 3pm (UTC)"}}});
      throw new Error('Internal error');
    }
    // pergunta com opções, como a AskUserQuestion do claude-agent-acp: só se o cliente declarou formulário
    if(texto.includes('pergunta?')){
      if(!formulario){await conn.sessionUpdate({sessionId,update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'sem formulário'}}});return {stopReason:'end_turn'};}
      const r=await conn.createElicitation({mode:'form',sessionId,message:'Qual cor?',requestedSchema:{type:'object',properties:{question_0:{type:'string',title:'Cor',oneOf:[{const:'Azul',title:'Azul'},{const:'Verde',title:'Verde'}]},question_0_custom:{type:'string',title:'Other'}}}});
      await conn.sessionUpdate({sessionId,update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'resposta: '+r.action+' '+JSON.stringify(r.content??{})}}});
      return {stopReason:'end_turn'};
    }
    // como o Claude com comando no fundo: o turno acaba e, quando o aviso chega, ele volta a falar sem ninguém pedir
    if(texto.includes('no fundo')){setTimeout(()=>conn.sessionUpdate({sessionId,update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'voltei sozinho'}}}).catch(()=>{}),50);return {stopReason:'end_turn'};}
    if(texto.includes('tipos?')){await conn.sessionUpdate({sessionId,update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'tipos: '+prompt.map(b=>b.type).join(',')}}});return {stopReason:'end_turn'};}
    if(texto.includes('pastas?')){await conn.sessionUpdate({sessionId,update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'pastas: '+(s.extras||[]).join(',')}}});return {stopReason:'end_turn'};}
    if(texto.includes('ferramentas?')){await conn.sessionUpdate({sessionId,update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'ferramentas: '+(s.mcp||[]).join(',')}}});return {stopReason:'end_turn'};}
    // com CLAUDE_CONFIG_DIR (conta pessoal), diz de qual pasta respondeu: o teste de conta por conversa confere
    const pasta=process.env.CLAUDE_CONFIG_DIR?'['+process.env.CLAUDE_CONFIG_DIR.split('/').pop()+'] ':'';
    await conn.sessionUpdate({sessionId,update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'eco: '+pasta+texto}}});
    return {stopReason:'end_turn'};
  },
  async cancel({sessionId}){sessoes.get(sessionId)?.cancelar?.();},
}),acp.ndJsonStream(Writable.toWeb(process.stdout),Readable.toWeb(process.stdin)));
