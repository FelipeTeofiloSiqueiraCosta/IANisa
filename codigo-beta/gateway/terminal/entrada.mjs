// Terminal da grade da Mesa (xterm.js, MIT). O build-chat.mjs empacota isto em public/terminal.js, que o
// chat.js só carrega quando a pessoa abre o primeiro terminal. Quem fala com o shell é o chat.js
// (servidor de agentes da pessoa, ops terminal-*); aqui é só a tela.
import {Terminal} from '@xterm/xterm';
import {FitAddon} from '@xterm/addon-fit';
import {WebglAddon} from '@xterm/addon-webgl';
import cssXterm from '@xterm/xterm/css/xterm.css';

// o WebGL desenha com a fonte que já estiver carregada: espera a mono do portal (Geist Mono) antes
await Promise.race([document.fonts.load('13px "Geist Mono"'),new Promise(r=>setTimeout(r,1500))]).catch(()=>{});

// O CSP do portal é style-src 'self': <style> injetado não vale (e enche o console de erro). O xterm cria uns
// <style> dentro dele (barra de rolagem, cores) quando abre. Enquanto ele abre, quem pede um <style> ganha um
// <template> (não aparece nem passa pelo CSP), e o texto de cada um vira uma folha "adotada", que o CSP deixa
// (é o que o CodeMirror do editor também faz).
function semStyle(fn){
  const original=document.createElement;
  document.createElement=function(tag,...resto){return original.call(this,String(tag).toLowerCase()==='style'?'template':tag,...resto);};
  try{return fn();}finally{document.createElement=original;}
}
const folhas=new Map();
function adotar(){document.adoptedStyleSheets=[base,...folhas.values()];}
const base=new CSSStyleSheet();base.replaceSync(cssXterm);adotar();
function espelharEstilos(raiz){
  const copiar=s=>{let f=folhas.get(s);if(!f){f=new CSSStyleSheet();folhas.set(s,f);}try{f.replaceSync(s.textContent||'');}catch{}adotar();};
  const varrer=()=>{
    for(const s of raiz.querySelectorAll('template'))copiar(s);
    for(const s of [...folhas.keys()])if(!s.isConnected&&!raiz.contains(s)){folhas.delete(s);adotar();}
  };
  const obs=new MutationObserver(varrer);obs.observe(raiz,{subtree:true,childList:true,characterData:true});varrer();
  return ()=>{obs.disconnect();for(const s of raiz.querySelectorAll('template'))folhas.delete(s);adotar();};
}

// Cores do design Ilha (as variáveis do portal), relidas quando o tema muda.
function tema(){
  const v=n=>getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const escuro=document.documentElement.dataset.theme==='dark';
  return {background:v('--island'),foreground:v('--ink'),cursor:v('--ink'),cursorAccent:v('--island'),
    selectionBackground:escuro?'#5b5217':'#f3e3a0',
    ...(escuro?{}:{black:'#1f1e1b',brightBlack:'#67655d',white:'#d6d4cc',brightWhite:'#f4f3ef',yellow:'#8a6a00',brightYellow:'#a07c00',green:'#236c3b',brightGreen:'#2f8a4c',
      blue:'#2457b5',brightBlue:'#2f6bd6',cyan:'#0f6f80',brightCyan:'#178a9e',red:'#aa2e24',brightRed:'#c43b2f',magenta:'#8a3fa8',brightMagenta:'#a04fc2'})};
}

// el: a caixa onde o terminal desenha. Devolve o controle da tela.
export function criarTerminal(el,{aoDigitar,aoTamanho,aoTitulo}={}){
  const term=new Terminal({fontFamily:getComputedStyle(document.documentElement).getPropertyValue('--mono').trim()||'monospace',fontSize:13,lineHeight:1.15,
    cursorBlink:true,scrollback:5000,allowProposedApi:false,theme:tema(),macOptionIsMeta:true});
  const fit=new FitAddon();term.loadAddon(fit);
  const soltarEstilos=espelharEstilos(el);
  semStyle(()=>{
    term.open(el);
    // WebGL desenha mais rápido; sem ele (navegador velho, GPU fora) fica o desenho padrão
    try{const gl=new WebglAddon();gl.onContextLoss(()=>gl.dispose());term.loadAddon(gl);}catch{}
  });
  const d1=term.onData(d=>aoDigitar?.(d));
  const d2=term.onResize(({rows,cols})=>aoTamanho?.(rows,cols));
  const d3=term.onTitleChange(t=>aoTitulo?.(t));
  const obsTema=new MutationObserver(()=>{term.options.theme=tema();});
  obsTema.observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});
  let pendente=null;
  const ajustar=()=>{if(!el.clientWidth||!el.clientHeight)return;try{fit.fit();}catch{}};
  const obsTamanho=new ResizeObserver(()=>{cancelAnimationFrame(pendente);pendente=requestAnimationFrame(ajustar);});
  obsTamanho.observe(el);
  ajustar();
  return {
    escrever:t=>term.write(t),
    limpar:()=>term.reset(),
    ajustar,
    focar:()=>term.focus(),
    tamanho:()=>({linhas:term.rows,colunas:term.cols}),
    destruir:()=>{obsTamanho.disconnect();obsTema.disconnect();d1.dispose();d2.dispose();d3.dispose();soltarEstilos();term.dispose();},
  };
}
