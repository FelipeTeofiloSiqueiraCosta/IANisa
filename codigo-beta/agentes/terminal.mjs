// Terminal da Ratoeira (aba da grade da Mesa): o shell da pessoa num PTY (terminal-pty.py), falando pelo
// mesmo WebSocket do chat. É o único terminal no navegador e o plano B quando o login de uma Conta de IA
// falha. Roda como a pessoa, com as mesmas travas do agente dela (a unit ratoeira-agentes@).
//
// O shell segue vivo sem ninguém olhando; a saída fica guardada (até GUARDA caracteres) e quem assina
// de novo recebe o que perdeu. Quem decide quando o processo inteiro sai é o servidor de agentes.
//
// ops (pedido {id, op, ...} do servidor.mjs):
//   terminais → [{terminal, cwd}]
//   terminal-abrir {cwd?, linhas, colunas} → {terminal, cwd}   (só abre; a saída vem ao assinar)
//   terminal-assinar {terminal, desde} → {cwd, inicio, desde, pos, dados}
//     (dados = a saída guardada a partir de `desde`; se esse pedaço já saiu da guarda, desde volta menor)
//   terminal-soltar {terminal} | terminal-entrada {terminal, dados} | terminal-tamanho {terminal, linhas, colunas}
//   terminal-fechar {terminal}
// mensagens soltas: {t:'terminal', terminal, pos, dados} (pos = onde o trecho acaba) · {t:'terminal-fim', terminal, code}
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {existsSync,statSync} from 'node:fs';
import {userInfo} from 'node:os';
import path from 'node:path';
import {StringDecoder} from 'node:string_decoder';
import {fileURLToPath} from 'node:url';

const PTY=path.join(path.dirname(fileURLToPath(import.meta.url)),'terminal-pty.py');
const MAX_TERMINAIS=8,GUARDA=256*1024;
// variáveis do servidor que não fazem sentido no shell da pessoa
const FORA=['COLUMNS','LINES','NO_COLOR','BROWSER','AGENTES_SOCKET','AGENTES_CONFIG','AGENTES_OCIOSO_MIN','AGENTES_DIR','AGENTES_LOGIN_RUNNER','RATOEIRA_GRUPO'];
const erro=m=>Object.assign(new Error(m),{publico:true});
const mandar=(ws,msg)=>{if(ws.readyState===1)ws.send(JSON.stringify(msg));};
const numero=(v,min,max)=>{const n=Number(v);if(!Number.isInteger(n)||n<min||n>max)throw erro('Tamanho inválido.');return n;};

// python, home, env: funções (o servidor resolve a conta só na hora). aoUsar: avisa que houve uso (ociosidade).
export function criarTerminais({python=()=>'/usr/bin/python3',home=()=>process.env.HOME??'/tmp',env=()=>({...process.env}),log=()=>{},aoUsar=()=>{}}={}){
  const terminais=new Map();
  const deWs=new WeakMap();   // ws → terminais que ele assina
  const assinar=(t,ws)=>{t.assinantes.add(ws);let s=deWs.get(ws);if(!s)deWs.set(ws,s=new Set());s.add(t);};

  function abrir(cwd,linhas,colunas){
    if(terminais.size>=MAX_TERMINAIS)throw erro('Muitos terminais abertos. Feche algum antes.');
    let shell=null;try{shell=userInfo().shell;}catch{}
    if(!shell||!shell.startsWith('/')||/(nologin|false)$/.test(shell)||!existsSync(shell))shell='/bin/bash';
    const e=env();for(const k of FORA)delete e[k];
    Object.assign(e,{TERM:'xterm-256color',COLORTERM:'truecolor',HOME:home()});
    const child=spawn(python(),[PTY,shell,cwd,String(linhas),String(colunas)],{cwd,env:e,stdio:['pipe','pipe','pipe','pipe']});
    const t={id:randomUUID(),cwd,child,saida:'',inicio:0,pos:0,assinantes:new Set(),decoder:new StringDecoder('utf8')};
    terminais.set(t.id,t);aoUsar();
    child.stdout.on('data',d=>{
      const s=t.decoder.write(d);if(!s)return;
      t.saida+=s;t.pos+=s.length;aoUsar();
      if(t.saida.length>GUARDA){
        // corta numa quebra de linha, pra repetição não começar no meio de uma sequência de cor
        let corte=t.saida.length-GUARDA;const nl=t.saida.indexOf('\n',corte);if(nl>=0&&nl-corte<4096)corte=nl+1;
        t.saida=t.saida.slice(corte);t.inicio+=corte;
      }
      for(const ws of t.assinantes)mandar(ws,{t:'terminal',terminal:t.id,pos:t.pos,dados:s});
    });
    child.stderr.on('data',d=>log(`[terminal] ${String(d).trim().slice(0,300)}`));
    for(const s of [child.stdin,child.stdio[3]])s.on('error',()=>{});
    let acabou=false;
    const fim=code=>{
      if(acabou)return;acabou=true;terminais.delete(t.id);aoUsar();
      for(const ws of t.assinantes){deWs.get(ws)?.delete(t);mandar(ws,{t:'terminal-fim',terminal:t.id,code});}
    };
    child.on('exit',code=>fim(code??1));
    child.on('error',e=>{log(`[terminal] não abriu: ${e.message}`);fim(127);});
    return t;
  }
  function terminal(id){const t=typeof id==='string'&&terminais.get(id);if(!t)throw erro('Esse terminal fechou.');return t;}

  const ops={
    terminais:async()=>[...terminais.values()].map(t=>({terminal:t.id,cwd:t.cwd})),
    'terminal-abrir':async m=>{
      const cwd=m.cwd==null?home():m.cwd;
      if(typeof cwd!=='string'||!cwd.startsWith('/')||cwd.includes('\0')||cwd.length>=4096||!existsSync(cwd)||!statSync(cwd).isDirectory())throw erro('Essa pasta não existe.');
      const t=abrir(cwd,numero(m.linhas??30,2,500),numero(m.colunas??100,10,1000));
      return {terminal:t.id,cwd:t.cwd};
    },
    'terminal-assinar':async(m,ws)=>{
      const t=terminal(m.terminal);
      const desde=Number.isInteger(m.desde)&&m.desde>=t.inicio&&m.desde<=t.pos?m.desde:t.inicio;
      assinar(t,ws);
      return {cwd:t.cwd,inicio:t.inicio,desde,pos:t.pos,dados:t.saida.slice(desde-t.inicio)};
    },
    'terminal-soltar':async(m,ws)=>{const t=terminais.get(m.terminal);if(t){t.assinantes.delete(ws);deWs.get(ws)?.delete(t);}return {};},
    'terminal-entrada':async m=>{
      const t=terminal(m.terminal);
      if(typeof m.dados!=='string'||!m.dados||m.dados.length>65536)throw erro('Entrada inválida.');
      t.child.stdin.write(m.dados);aoUsar();return {};
    },
    'terminal-tamanho':async m=>{const t=terminal(m.terminal);t.child.stdio[3].write(`${numero(m.linhas,2,500)} ${numero(m.colunas,10,1000)}\n`);return {};},
    'terminal-fechar':async m=>{terminais.get(m.terminal)?.child.kill('SIGTERM');return {};},
  };
  return {
    ops,
    soltar:ws=>{for(const t of deWs.get(ws)??[])t.assinantes.delete(ws);deWs.delete(ws);},
    fecharTodos:()=>{for(const t of terminais.values())t.child.kill('SIGTERM');},
    quantos:()=>terminais.size,
  };
}
