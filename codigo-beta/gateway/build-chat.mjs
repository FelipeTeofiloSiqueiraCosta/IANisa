// Monta o que o navegador carrega à parte (public/): o markdown do chat, o print do botão Reportar, o editor
// de arquivo e o terminal. O cliente do Paseo (paseo-client.js, paseo-node.mjs) saiu em 09/10/2026, junto com
// o Paseo por pessoa.
import {build} from 'esbuild';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,rmSync} from 'node:fs';
import {gzipSync} from 'node:zlib';
import path from 'node:path';

const aqui=path.dirname(new URL(import.meta.url).pathname);

// Markdown do chat da área Arquivos: marked + DOMPurify, uns 100 KB.
const entradaMd=path.join(aqui,'.markdown-entrada.mjs');
writeFileSync(entradaMd,`export {Marked} from 'marked';\nexport {default as DOMPurify} from 'dompurify';\n`);
const saidaMd=path.join(aqui,'public/markdown.js');
try{await build({entryPoints:[entradaMd],bundle:true,format:'esm',platform:'browser',target:'es2022',minify:true,legalComments:'eof',outfile:saidaMd,logLevel:'warning'});}
finally{rmSync(entradaMd,{force:true});}
const corpoMd=readFileSync(saidaMd);
writeFileSync(saidaMd+'.gz',gzipSync(corpoMd,{level:9}));
writeFileSync(path.join(aqui,'public/markdown.json'),JSON.stringify({hash:createHash('sha256').update(corpoMd).digest('hex').slice(0,16)})+'\n');
console.log(`markdown.js: ${(corpoMd.length/1e3).toFixed(0)} KB`);

// Print da tela do botão "Reportar" (portal.js carrega só quando a pessoa clica): modern-screenshot (MIT).
const ms=path.join(aqui,'node_modules/modern-screenshot');
const msVersao=JSON.parse(readFileSync(path.join(ms,'package.json'),'utf8')).version;
writeFileSync(path.join(aqui,'public/screenshot.js'),`/*! modern-screenshot ${msVersao} | MIT License | https://github.com/qq15725/modern-screenshot */\n`+readFileSync(path.join(ms,'dist/index.js'),'utf8'));
console.log(`screenshot.js: modern-screenshot ${msVersao}`);

// Editor de arquivo (área Arquivos): CodeMirror 6 (MIT) com as linguagens mais comuns do repo.
// O portal só carrega quando alguém clica em "Editar".
{
  const saidaEd=path.join(aqui,'public/editor.js');
  await build({entryPoints:[path.join(aqui,'editor/entrada.mjs')],bundle:true,format:'esm',platform:'browser',target:'es2022',minify:true,legalComments:'eof',outfile:saidaEd,logLevel:'warning'});
  const corpoEd=readFileSync(saidaEd);
  console.log(`editor.js: ${(corpoEd.length/1e3).toFixed(0)} KB (${(gzipSync(corpoEd).length/1e3).toFixed(0)} KB gzip)`);
}

// Terminal da grade da Mesa: xterm.js (MIT) + fit + webgl. O chat.js só carrega quando abre um terminal.
{
  const saidaTerm=path.join(aqui,'public/terminal.js');
  await build({entryPoints:[path.join(aqui,'terminal/entrada.mjs')],bundle:true,format:'esm',platform:'browser',target:'es2022',minify:true,legalComments:'eof',loader:{'.css':'text'},outfile:saidaTerm,logLevel:'warning'});
  const corpoTerm=readFileSync(saidaTerm);
  console.log(`terminal.js: ${(corpoTerm.length/1e3).toFixed(0)} KB (${(gzipSync(corpoTerm).length/1e3).toFixed(0)} KB gzip)`);
}
