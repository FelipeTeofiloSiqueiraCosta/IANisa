// Editor de arquivo da área Arquivos (CodeMirror 6, MIT). O build-chat.mjs empacota isto em public/editor.js,
// que o portal carrega só quando a pessoa clica em "Editar".
import {EditorView,basicSetup} from 'codemirror';
import {EditorState,Compartment} from '@codemirror/state';
import {keymap} from '@codemirror/view';
import {indentWithTab} from '@codemirror/commands';
import {HighlightStyle,syntaxHighlighting} from '@codemirror/language';
import {tags as t} from '@lezer/highlight';
import {markdown} from '@codemirror/lang-markdown';
import {javascript} from '@codemirror/lang-javascript';
import {json} from '@codemirror/lang-json';
import {css} from '@codemirror/lang-css';
import {html} from '@codemirror/lang-html';
import {python} from '@codemirror/lang-python';
import {yaml} from '@codemirror/lang-yaml';

const LINGUAS={md:markdown,markdown:markdown,js:javascript,mjs:javascript,cjs:javascript,ts:()=>javascript({typescript:true}),tsx:()=>javascript({typescript:true,jsx:true}),jsx:()=>javascript({jsx:true}),
  json:json,css:css,html:html,htm:html,svg:html,py:python,yaml:yaml,yml:yaml};
const lingua=caminho=>{const e=caminho.split('.').pop().toLowerCase();return LINGUAS[e]?.()??[];};

// Cores pelas variáveis do design Ilha: o editor segue o tema claro/escuro do portal sozinho.
const tema=EditorView.theme({
  '&':{height:'100%',fontSize:'13px',color:'var(--ink)',backgroundColor:'var(--island)'},
  '.cm-scroller':{fontFamily:'var(--mono)',lineHeight:'1.6'},
  '.cm-content':{caretColor:'var(--ink)',padding:'12px 0 40vh'},
  '.cm-gutters':{backgroundColor:'var(--island)',color:'var(--muted)',border:'none',paddingLeft:'6px'},
  '.cm-activeLine':{backgroundColor:'var(--hover)'},'.cm-activeLineGutter':{backgroundColor:'transparent',color:'var(--ink)'},
  '&.cm-focused':{outline:'none'},
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection':{backgroundColor:'var(--accent-soft) !important'},
  '.cm-cursor':{borderLeftColor:'var(--ink)'},
  '.cm-panels':{backgroundColor:'var(--surface)',color:'var(--ink)'},'.cm-panels.cm-panels-top':{borderBottom:'1px solid var(--line)'},
  '.cm-searchMatch':{backgroundColor:'var(--accent-soft)',outline:'1px solid var(--accent-line)'},
  '.cm-tooltip':{backgroundColor:'var(--island)',border:'1px solid var(--line)'},
});
const cores=HighlightStyle.define([
  {tag:t.heading,fontWeight:'700',color:'var(--ink)'},{tag:[t.strong],fontWeight:'700'},{tag:t.emphasis,fontStyle:'italic'},
  {tag:[t.link,t.url],color:'#2459b8',textDecoration:'underline'},{tag:[t.comment,t.meta],color:'var(--muted)',fontStyle:'italic'},
  {tag:[t.keyword,t.operatorKeyword,t.modifier],color:'#a3367a'},{tag:[t.string,t.special(t.string)],color:'#23733a'},
  {tag:[t.number,t.bool,t.null,t.atom],color:'#b8520d'},{tag:[t.propertyName,t.attributeName],color:'#2459b8'},
  {tag:[t.typeName,t.className,t.tagName],color:'#7a5d00'},{tag:[t.monospace],color:'#a3367a'},{tag:t.quote,color:'var(--muted)'},
]);

// O editor mora num shadow DOM: assim o CodeMirror põe os estilos dele em folhas construídas
// (adoptedStyleSheets), que a CSP do portal (style-src 'self') deixa passar. Num documento normal ele
// cria uma tag <style>, e a CSP bloqueia. As variáveis de cor do portal atravessam o shadow DOM.
export function criarEditor(pai,{texto,caminho,aoMudar,aoSalvar}){
  const somenteLeitura=new Compartment();
  const sombra=pai.attachShadow({mode:'open'});const alvo=document.createElement('div');alvo.style.height='100%';sombra.append(alvo);
  const view=new EditorView({parent:alvo,root:sombra,state:EditorState.create({doc:texto,extensions:[
    basicSetup,tema,syntaxHighlighting(cores),EditorView.lineWrapping,lingua(caminho),somenteLeitura.of(EditorState.readOnly.of(false)),
    keymap.of([{key:'Mod-s',preventDefault:true,run:()=>{aoSalvar?.();return true;}},indentWithTab]),
    EditorView.updateListener.of(u=>{if(u.docChanged)aoMudar?.();}),
  ]})});
  return {
    texto:()=>view.state.doc.toString(),
    trocar(novo){view.dispatch({changes:{from:0,to:view.state.doc.length,insert:novo}});},
    travar(sim){view.dispatch({effects:somenteLeitura.reconfigure(EditorState.readOnly.of(sim))});},
    focar:()=>view.focus(),
    destruir:()=>view.destroy(),
  };
}
