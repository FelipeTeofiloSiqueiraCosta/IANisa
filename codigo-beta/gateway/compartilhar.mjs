// Conversa compartilhada (desde 15/10/2026, docs/2026-10-15-conversa-compartilhada.md): o dono de uma conversa
// convida outra pessoa da Ratoeira pra só ler ou pra entrar nela. A conversa continua no servidor de agentes do
// dono (usuário Linux e conta de IA dele); o gateway liga o convidado lá, só pra aquela conversa
// (/api/agentes/ws?convite=<id>). Aqui ficam os convites e as notificações (o sino), num JSON da pasta de dados.
import {readFileSync,writeFileSync,renameSync,mkdirSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import path from 'node:path';

export const MODOS=['ler','entrar'];
const ID=/^[A-Za-z0-9_-]{16,40}$/;
const idOk=v=>typeof v==='string'&&/^[A-Za-z0-9_.:-]{1,200}$/.test(v);
const caminhoOk=p=>typeof p==='string'&&p.startsWith('/')&&!p.includes('\0')&&p.length<4096;
const MAX_NOTIFICACOES=100;              // por pessoa: as mais velhas saem
const problema=(status,message)=>Object.assign(new Error(message),{status});

// Link de conversa (desde 16/10/2026, "Copiar link da conversa" no ⋯): /portal/?chat=<agente>:<sessao>&de=<email do
// dono>. Serve pra abrir a conversa e pra ferramenta ler_conversa. Aceita o endereço inteiro ou só o caminho.
// (`?conversa=` sozinho é outra coisa: a janela separada de uma conversa, ver chat.js.)
export function lerLinkConversa(texto){
  let u;try{u=new URL(String(texto??'').trim(),'http://x');}catch{return null;}
  const conv=u.searchParams.get('chat')??'',de=(u.searchParams.get('de')??'').toLowerCase();
  const m=conv.match(/^([a-z][a-z0-9-]{0,30}):([A-Za-z0-9_.:-]{1,200})$/);
  if(!m||!/^[^\s@]{1,100}@[^\s@]{1,200}$/.test(de))return null;
  return {agente:m[1],sessao:m[2],dono:de};
}

export function createCompartilhar({arquivo=null,agora=Date.now,aoNotificar=()=>{}}={}){
  let dados={compartilhadas:[],notificacoes:[]};
  if(arquivo)try{const d=JSON.parse(readFileSync(arquivo,'utf8'));dados={compartilhadas:Array.isArray(d.compartilhadas)?d.compartilhadas:[],notificacoes:Array.isArray(d.notificacoes)?d.notificacoes:[]};}catch{}
  const gravar=()=>{
    if(!arquivo)return;
    try{mkdirSync(path.dirname(arquivo),{recursive:true});const tmp=arquivo+'.tmp';writeFileSync(tmp,JSON.stringify(dados),{mode:0o600});renameSync(tmp,arquivo);}
    catch(e){console.log('conversas compartilhadas: não gravei ('+e.message+')');}
  };
  const novoId=()=>randomBytes(12).toString('base64url');
  const titulo=t=>String(t??'').replace(/[\u0000-\u001f\u007f]+/g,' ').trim().slice(0,120)||null;
  function notificar(para,n){
    const nova={id:novoId(),para,em:new Date(agora()).toISOString(),lida:false,...n};dados.notificacoes.push(nova);
    try{aoNotificar(nova);}catch{}
    const minhas=dados.notificacoes.filter(x=>x.para===para);
    if(minhas.length>MAX_NOTIFICACOES){const fora=new Set(minhas.slice(0,minhas.length-MAX_NOTIFICACOES));dados.notificacoes=dados.notificacoes.filter(x=>!fora.has(x));}
  }
  return {
    achar:id=>ID.test(String(id))?dados.compartilhadas.find(c=>c.id===id)??null:null,
    // as do dono e as que foram compartilhadas com a pessoa
    dePessoa:email=>({minhas:dados.compartilhadas.filter(c=>c.dono===email),comigo:dados.compartilhadas.filter(c=>c.convidado===email)}),
    // convidar de novo a mesma pessoa pra mesma conversa só troca o modo (e avisa outra vez)
    compartilhar({dono,donoNome,convidado,agente,sessao,cwd,titulo:t,modo}){
      if(!MODOS.includes(modo))throw problema(400,'Escolha "só ler" ou "pode entrar".');
      if(!idOk(agente)||!idOk(sessao)||!caminhoOk(cwd))throw problema(400,'Conversa inválida.');
      if(convidado===dono)throw problema(400,'A conversa já é tua.');
      let c=dados.compartilhadas.find(x=>x.dono===dono&&x.convidado===convidado&&x.agente===agente&&x.sessao===sessao);
      if(c)Object.assign(c,{modo,cwd,titulo:titulo(t)??c.titulo,em:new Date(agora()).toISOString()});
      else{c={id:novoId(),dono,convidado,agente,sessao,cwd,titulo:titulo(t),modo,em:new Date(agora()).toISOString()};dados.compartilhadas.push(c);}
      notificar(convidado,{tipo:'convite',de:dono,deNome:donoNome??null,compartilhada:c.id,titulo:c.titulo,modo});
      gravar();return c;
    },
    // o dono tira o acesso, ou o convidado sai; devolve o convite que saiu
    remover(id,quem){
      const c=dados.compartilhadas.find(x=>x.id===id);
      if(!c||(c.dono!==quem&&c.convidado!==quem))throw problema(404,'Esse compartilhamento não existe mais.');
      dados.compartilhadas=dados.compartilhadas.filter(x=>x!==c);
      dados.notificacoes=dados.notificacoes.filter(n=>n.compartilhada!==id);
      gravar();return c;
    },
    // o convite de uma pessoa pra uma conversa (ler_conversa confere por aqui)
    convite:({dono,convidado,agente,sessao})=>dados.compartilhadas.find(x=>x.dono===dono&&x.convidado===convidado&&x.agente===agente&&x.sessao===sessao)??null,
    // a conversa ainda tem alguém convidado? (o servidor de agentes só desliga o nome nas mensagens quando não)
    aindaCompartilhada:(dono,agente,sessao)=>dados.compartilhadas.some(x=>x.dono===dono&&x.agente===agente&&x.sessao===sessao),
    // Aconteceu algo numa conversa compartilhada (nota ou mensagem de alguém): avisa os outros dela (dono e convidados).
    // Aviso igual ainda não lido (mesma conversa, tipo e pessoa) só é atualizado, pra conversa animada não encher o sino.
    // Quem avisa é a tela de quem escreveu; quem é dono vê a dele pela conversa, convidado pelo convite.
    // `mencionados` (marcados com @): esses recebem "te marcou" no lugar do aviso comum.
    atividade({de,deNome,dono,agente,sessao,tipo,texto,mencionados=[]}){
      if(!['nota','mensagem'].includes(tipo))throw problema(400,'Tipo inválido.');
      const desta=dados.compartilhadas.filter(x=>x.dono===dono&&x.agente===agente&&x.sessao===sessao);
      if(!desta.length||(de!==dono&&!desta.some(x=>x.convidado===de)))throw problema(404,'Essa conversa não está compartilhada contigo.');
      const trecho=String(texto??'').replace(/\s+/g,' ').trim().slice(0,140);
      const titulo=desta[0].titulo;let n=0;
      const marcados=new Set(Array.isArray(mencionados)?mencionados.slice(0,20).map(String):[]);
      for(const para of [dono,...desta.map(x=>x.convidado)]){
        if(para===de)continue;
        const tipoAqui=marcados.has(para)?'mencao':tipo;
        const alvo=para===dono?{conversa:{agente,sessao}}:{compartilhada:desta.find(x=>x.convidado===para).id};
        const igual=dados.notificacoes.find(x=>x.para===para&&!x.lida&&x.tipo===tipoAqui&&x.de===de&&(x.compartilhada?x.compartilhada===alvo.compartilhada:x.conversa?.sessao===sessao));
        if(igual){Object.assign(igual,{texto:trecho,em:new Date(agora()).toISOString(),vezes:(igual.vezes??1)+1});try{aoNotificar(igual);}catch{}}
        else notificar(para,{tipo:tipoAqui,de,deNome:deNome??null,titulo,texto:trecho,...alvo});
        n++;
      }
      gravar();return n;
    },
    // Aviso do servidor de agentes (o agente terminou ou está esperando alguém). `para` é o dono ou um convidado; o alvo
    // muda conforme (a conversa dele ou o convite). Repetido ainda não lido da mesma conversa e tipo só é atualizado.
    avisoDoAgente({para,dono,agente,sessao,tipo,titulo:t,motivo,rotina,texto}){
      // rotina (desde 16/10/2026): só pro dono, cada execução é um aviso novo; sem conversa quando falhou antes de abrir
      if(tipo==='rotina'){
        if(para!==dono||!['chama','terminou','falhou'].includes(motivo))return null;
        notificar(para,{tipo,motivo,de:dono,rotina:String(rotina||'Rotina').slice(0,80),titulo:titulo(t),texto:texto?String(texto).slice(0,300):null,
          ...(agente&&sessao?{conversa:{agente,sessao}}:{})});
        gravar();return true;
      }
      if(!['terminou','esperando'].includes(tipo))return null;
      const conv=para===dono?null:dados.compartilhadas.find(x=>x.dono===dono&&x.convidado===para&&x.agente===agente&&x.sessao===sessao);
      if(para!==dono&&!conv)return null;
      const alvo=conv?{compartilhada:conv.id}:{conversa:{agente,sessao}};
      const tit=titulo(t)??conv?.titulo??null;
      const igual=dados.notificacoes.find(x=>x.para===para&&!x.lida&&x.tipo===tipo&&(x.compartilhada?x.compartilhada===alvo.compartilhada:x.conversa?.agente===agente&&x.conversa?.sessao===sessao));
      if(igual){Object.assign(igual,{titulo:tit??igual.titulo,em:new Date(agora()).toISOString(),de:dono});try{aoNotificar(igual);}catch{}}
      else notificar(para,{tipo,de:dono,titulo:tit,...alvo});
      gravar();return true;
    },
    // Volta de um reporte (reportes.mjs, retornos): a triagem marcou feito ou recusado e mandou o aviso. Aviso
    // de novo do mesmo reporte ainda não lido só é atualizado (recado corrigido).
    avisoDeReporte({para,reporte,titulo:t,status,recado,versao}){
      if(typeof para!=='string'||!para.includes('@')||!Number.isSafeInteger(reporte)||!['feito','recusado'].includes(status))return null;
      const campos={status,titulo:titulo(t),texto:recado?String(recado).replace(/\s+/g,' ').trim().slice(0,300)||null:null,versao:typeof versao==='string'&&/^[0-9A-Za-z][0-9A-Za-z.+-]{0,39}$/.test(versao)?versao:null};
      const igual=dados.notificacoes.find(x=>x.para===para&&!x.lida&&x.tipo==='reporte'&&x.reporte===reporte);
      if(igual){Object.assign(igual,campos,{em:new Date(agora()).toISOString()});try{aoNotificar(igual);}catch{}}
      else notificar(para,{tipo:'reporte',reporte,...campos});
      gravar();return true;
    },
    // Aviso de acesso (contas.mjs, desde 28/10/2026): entrada de IP novo ou conta travada por senha errada. Vai pra dona
    // da conta e pra quem administra. Repetido ainda não lido (mesma conta e motivo) só é atualizado.
    avisoDeAcesso({para,motivo,email,nome,ip}){
      if(typeof para!=='string'||!para.includes('@')||!['ip-novo','travou'].includes(motivo))return null;
      const campos={motivo,email:String(email).slice(0,200),propria:para===email,deNome:nome?String(nome).slice(0,80):null,ip:ip?String(ip).slice(0,64):null};
      const igual=dados.notificacoes.find(x=>x.para===para&&!x.lida&&x.tipo==='acesso'&&x.motivo===motivo&&x.email===campos.email);
      if(igual){Object.assign(igual,campos,{em:new Date(agora()).toISOString(),vezes:(igual.vezes??1)+1});try{aoNotificar(igual);}catch{}}
      else notificar(para,{tipo:'acesso',...campos});
      gravar();return true;
    },
    // participantes de uma conversa: o dono e quem foi convidado pra ela
    participantes:(dono,agente,sessao)=>[dono,...dados.compartilhadas.filter(x=>x.dono===dono&&x.agente===agente&&x.sessao===sessao).map(x=>x.convidado)],
    notificacoes(email){
      const itens=dados.notificacoes.filter(n=>n.para===email).reverse();
      return {itens,naoLidas:itens.filter(n=>!n.lida).length};
    },
    marcarLidas(email,ids=null){
      const so=Array.isArray(ids)?new Set(ids.map(String)):null;
      for(const n of dados.notificacoes)if(n.para===email&&(!so||so.has(n.id)))n.lida=true;
      gravar();
    },
  };
}
