import {execFile,spawn} from 'node:child_process';
import {copyFile,chmod,mkdir,lstat,readFile,rm} from 'node:fs/promises';
import {constants,rmSync,mkdirSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseStatus} from './connections.mjs';
import {problem} from './catalog.mjs';

export function createCliRuntime({cli,homeDir,dataDir}){
  const env={HOME:homeDir,USER:path.basename(homeDir),LOGNAME:path.basename(homeDir),PATH:`${homeDir}/.local/bin:${homeDir}/bin:/usr/local/bin:/usr/bin:/bin`,LANG:'C.UTF-8',TERM:'xterm-256color',COLUMNS:'160',LINES:'30',NO_COLOR:'1',BROWSER:'/bin/true'};
  const cache=new Map();
  async function status(provider,{fresh=false}={}){
    const cached=cache.get(provider);if(!fresh&&cached&&Date.now()-cached.at<15000)return cached.promise;
    const promise=new Promise(resolve=>{
      const args=provider==='claude'?['auth','status','--json']:['login','status'];
      execFile(cli[provider],args,{env,cwd:homeDir,timeout:10000,maxBuffer:65536},(error,stdout,stderr)=>resolve(parseStatus(provider,{stdout,stderr,code:error?.code??0,missing:error?.code==='ENOENT'})));
    });cache.set(provider,{at:Date.now(),promise});return promise;
  }
  async function backup(provider){
    const source=path.join(homeDir,provider==='claude'?'.claude/.credentials.json':'.codex/auth.json');
    try{const stat=await lstat(source);if(!stat.isFile()||stat.isSymbolicLink())throw new Error('Invalid credentials file');}
    catch(error){if(error.code==='ENOENT')return;throw problem(503,'Não foi possível preservar o login atual. Nenhuma tentativa foi iniciada.');}
    const dir=path.join(dataDir,'auth-backups');await mkdir(dir,{recursive:true,mode:0o700});
    const target=path.join(dir,`${provider}-${Date.now()}.json`);
    try{await copyFile(source,target,constants.COPYFILE_EXCL);await chmod(target,0o600);}
    catch{throw problem(503,'Não foi possível preservar o login atual. Nenhuma tentativa foi iniciada.');}
  }
  // Codex geral: o login sai numa pasta só dele (CODEX_HOME), vazia a cada tentativa, pra nunca
  // misturar com o Codex do próprio gateway. lerCodexGeral() devolve o auth.json e apaga a pasta.
  const codexGeralDir=path.join(dataDir,'codex-geral-login');
  function launch(provider){
    cache.delete(provider);
    let extra={};
    if(provider==='codex-geral'){rmSync(codexGeralDir,{recursive:true,force:true});mkdirSync(codexGeralDir,{recursive:true,mode:0o700});extra={CODEX_HOME:codexGeralDir};}
    const bin=cli[{'claude-token':'claude','codex-geral':'codex'}[provider]??provider];
    return spawn('/usr/bin/python3',[fileURLToPath(new URL('./login-runner.py',import.meta.url)),provider,bin],{env:{...env,...extra},cwd:homeDir,stdio:['pipe','pipe','pipe']});
  }
  async function lerCodexGeral(){
    try{return JSON.parse(await readFile(path.join(codexGeralDir,'auth.json'),'utf8'));}
    catch{throw problem(502,'O login do Codex terminou, mas não achei a conta gerada. Tente de novo.');}
    finally{await rm(codexGeralDir,{recursive:true,force:true}).catch(()=>{});}
  }
  return {status,backup,launch,confirm:provider=>status(provider,{fresh:true}),lerCodexGeral};
}
