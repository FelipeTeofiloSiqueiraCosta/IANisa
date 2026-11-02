import { build } from 'esbuild';
import {readFile,writeFile,rename} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const options={bundle:true,format:'iife',target:'es2020',minify:true,logLevel:'info'};
await Promise.all([
  build({...options,entryPoints:['src/app.js','src/access.js'],outdir:'assets'}),
  build({...options,entryPoints:['apresentacao/src/app.js','apresentacao/src/bootstrap.js'],outdir:'apresentacao/assets'}),
]);
const hash=createHash('sha256');
for(const file of ['assets/app.js','assets/access.js','workspace.css','access.css','brand.css','capabilities.css','index.html','access.html'])hash.update(await readFile(file));
await writeFile('assets/version.json.tmp',JSON.stringify({version:hash.digest('hex').slice(0,16)}));
await rename('assets/version.json.tmp','assets/version.json');
