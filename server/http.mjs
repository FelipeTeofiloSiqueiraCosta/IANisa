import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createAccounts, problem } from './accounts.mjs';
import { createAIRuntime } from './ai-runtime.mjs';
import { createBrandStore, MAX_BRAND_FILE } from './brand-store.mjs';
import {createSkillsStore} from './skills-store.mjs';
import {createSkillImports,MAX_SKILL_UPLOAD,skillUploadName} from './skill-imports.mjs';
import {createConnectorsStore} from './connectors-store.mjs';
import {createToolPermissions} from './tool-permissions.mjs';
import {createConnectorOAuth} from './connector-oauth.mjs';
import {createAgentsStore} from './agents-store.mjs';
import {HIGGSFIELD_IMAGE_ORIGINS} from '../shared/chat-media.mjs';

export async function createAppServer({ root, directory = path.join(root, '.data'), origin = 'http://127.0.0.1:4173', now, aiRuntime }) {
  const base = new URL(origin);
  if (base.origin !== origin || !['http:','https:'].includes(base.protocol)) throw new Error('APP_ORIGIN deve conter somente a origem, sem barra final.');
  if (base.protocol !== 'https:' && !['127.0.0.1','localhost','[::1]'].includes(base.hostname)) throw new Error('Use HTTPS em APP_ORIGIN fora do localhost.');
  const accounts = await createAccounts({ directory, now });
  const ai = aiRuntime || createAIRuntime({cwd:directory});
  const permissions=createToolPermissions();
  let skills,agents;
  const connectors=createConnectorsStore({directory,now});
  const connectorOAuth=createConnectorOAuth({origin,store:connectors,now});
  const runWithConnectors=async({actor,requestId,...input})=>{
    if(input.connectors?.length)input.onProgress?.({type:'phase',id:'connectors'});
    try{const activeConnectors=await connectorOAuth.ready(actor,input.connectors);return await ai.runTurn({...input,connectors:activeConnectors.map(c=>({...c,permission:input.connectors.find(old=>old.id===c.id)?.permission??'ask'})),onPermission:params=>permissions.ask(actor,requestId,params,activeConnectors,{mode:server=>{try{connectors.resolve(actor,[server.id]);return input.agent?agents.connectorMode(actor,input.agent.id,server.id):'ask';}catch{return 'deny';}}})});}
    finally{permissions.cancel(actor,requestId);}
  };
  const brain = createBrandStore({directory,resolveSkills:(actor,ids)=>skills.resolve(actor,ids),resolveConnectors:connectors.resolve,runTurn:runWithConnectors,now});
  skills=createSkillsStore({directory,generatedSkill:actor=>brain.exportSkill(actor),now});
  agents=createAgentsStore({directory,skills,connectors,approvedBrand:actor=>brain.view(actor).confirmed,runTurn:runWithConnectors,now});
  const skillImports=createSkillImports({directory,store:skills,now});
  const secure = base.protocol === 'https:', cookieName = secure ? '__Host-ianiza_session' : 'ianiza_session';
  const sessionToken = req => String(req.headers.cookie ?? '').split(';').map(s => s.trim()).find(s => s.startsWith(cookieName + '='))?.slice(cookieName.length + 1);
  const setCookie = (res, s) => res.setHeader('set-cookie', `${cookieName}=${s.token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${s.maxAge}${secure ? '; Secure' : ''}`);
  const clearCookie = res => setCookie(res, { token:'', maxAge:0 });
  function json(res, status, data) { res.writeHead(status, { 'content-type':'application/json; charset=utf-8' }); res.end(JSON.stringify(data)); }
  function redirect(res, location) { res.writeHead(303, { location }); res.end(); }
  async function body(req, limit=16384) {
    if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] ?? '')) throw problem(415, 'Envie os dados como JSON.');
    let size = 0; const chunks = [];
    for await (const chunk of req) { size += chunk.length; if (size > limit) throw problem(413, 'Os dados enviados são muito grandes.'); chunks.push(chunk); }
    let value; try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw problem(400, 'Não foi possível ler os dados enviados.'); }
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw problem(400, 'Dados inválidos.');
    return value;
  }
  function csrf(req, raw) {
    const a = accounts.authenticated(raw);
    if (req.headers['x-csrf-token'] !== a.csrf) throw problem(403, 'Atualize a página antes de continuar.');
    return a;
  }
  function editor(req,raw) {const a=csrf(req,raw);if(a.user.role!=='admin')throw problem(403,'Somente administradores podem configurar a IA.');return a;}
  const types = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'application/javascript; charset=utf-8', '.json':'application/json; charset=utf-8', '.woff2':'font/woff2', '.txt':'text/plain; charset=utf-8' };
  const server = http.createServer(async (req, res) => {
    res.setHeader('cache-control', 'no-store');
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('referrer-policy', 'no-referrer');
    res.setHeader('x-frame-options', 'DENY');
    res.setHeader('content-security-policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: "+HIGGSFIELD_IMAGE_ORIGINS.join(' ')+"; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
    if (secure) res.setHeader('strict-transport-security', 'max-age=31536000');
    try {
      if (req.headers.host !== base.host) throw problem(421, 'Abra o endereço configurado para esta instalação.');
      const url = new URL(req.url, origin), route = url.pathname, raw = sessionToken(req), ip = req.socket.remoteAddress ?? 'unknown';
      if (!['GET','HEAD','POST','PATCH'].includes(req.method)) throw problem(405, 'Método não permitido.');
      if (route.startsWith('/api/')) {
        if (req.method === 'HEAD') throw problem(405, 'Método não permitido.');
        if (req.method !== 'GET' && (req.headers.origin !== origin || req.headers['sec-fetch-site'] === 'cross-site')) throw problem(403, 'Origem não permitida.');
        if (req.method === 'GET' && route === '/api/auth/status') return json(res, 200, { initialized:accounts.initialized(), installationMode:'single-company' });
        if (req.method === 'GET' && route === '/api/auth/me') return json(res, 200, accounts.authenticated(raw));
        if(req.method==='GET'&&route==='/api/connector-oauth/callback'){
          const a=accounts.authenticated(raw);try{await connectorOAuth.complete(a,Object.fromEntries(url.searchParams));return redirect(res,'/?connectorAuth=complete');}catch{return redirect(res,'/?connectorAuth=error');}
        }
        if (req.method === 'POST' && route === '/api/auth/login') { const s = await accounts.login(await body(req), ip); if (raw) accounts.logout(raw); setCookie(res,s); return json(res,200,{user:s.user}); }
        if (req.method === 'POST' && route === '/api/auth/setup') { const s = await accounts.setup(await body(req), ip); setCookie(res,s); return json(res,201,{user:s.user}); }
        if (req.method === 'POST' && route === '/api/auth/link-info') { const b = await body(req); if (!['setup','invite','reset'].includes(b.kind)) throw problem(400,'Tipo de link inválido.'); return json(res,200,accounts.inspectLink(b.token,b.kind)); }
        if (req.method === 'POST' && route === '/api/auth/accept') { const s = await accounts.accept(await body(req), ip, raw); setCookie(res,s); return json(res,200,{user:s.user}); }
        if (req.method === 'POST' && route === '/api/auth/logout') { csrf(req,raw); accounts.logout(raw); clearCookie(res); return json(res,200,{ok:true}); }
        if (req.method === 'POST' && route === '/api/account/password') { csrf(req,raw); const s = await accounts.changePassword(raw,await body(req),ip); setCookie(res,s); return json(res,200,{ok:true}); }
        if(req.method==='GET'&&route==='/api/agents')return json(res,200,agents.list(accounts.authenticated(raw)));
        const agentConnectors=route.match(/^\/api\/agents\/([a-z-]+)\/connectors$/);
        if(agentConnectors&&req.method==='GET')return json(res,200,agents.connectorAccess(accounts.authenticated(raw),agentConnectors[1]));
        if(agentConnectors&&req.method==='PATCH'){const a=editor(req,raw),result=agents.updateConnectors(a,agentConnectors[1],await body(req));permissions.reconcile();return json(res,200,result);}
        const agentRoute=route.match(/^\/api\/agents\/([a-z-]+)(\/messages)?$/);
        if(agentRoute&&req.method==='GET'&&!agentRoute[2])return json(res,200,agents.view(accounts.authenticated(raw),agentRoute[1]));
        if(agentRoute&&req.method==='POST'&&agentRoute[2])return json(res,200,await agents.send(csrf(req,raw),agentRoute[1],await body(req,65536)));
        if(req.method==='GET'&&route==='/api/skills')return json(res,200,skills.list(accounts.authenticated(raw)));
        if(req.method==='POST'&&route==='/api/skills'){editor(req,raw);throw problem(415,'A importação mudou. Atualize a página e envie somente um arquivo .md ou .zip.');}
        if(req.method==='POST'&&route==='/api/skills/imports'){
          const a=editor(req,raw),release=skillImports.reserve(a);
          try{
            if(!/^application\/octet-stream(?:;|$)/i.test(req.headers['content-type']||''))throw problem(415,'Envie o arquivo pelo botão de upload de skill.');
            let name;try{name=decodeURIComponent(req.headers['x-skill-filename']||'');}catch{throw problem(400,'Nome de arquivo inválido.');}skillUploadName(name);
            if(Number(req.headers['content-length'])>MAX_SKILL_UPLOAD)throw problem(413,'O arquivo deve ter até 24 MB.');
            let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>MAX_SKILL_UPLOAD)throw problem(413,'O arquivo deve ter até 24 MB.');chunks.push(chunk);}
            return json(res,201,await skillImports.prepare(a,name,Buffer.concat(chunks,size)));
          }finally{release();}
        }
        const skillImportRoute=route.match(/^\/api\/skills\/imports\/([a-f0-9-]{36})\/(confirm|cancel)$/);
        if(skillImportRoute&&req.method==='POST'){const a=editor(req,raw);return json(res,200,skillImportRoute[2]==='confirm'?await skillImports.confirm(a,skillImportRoute[1]):skillImports.cancel(a,skillImportRoute[1]));}
        const skillFileRoute=route.match(/^\/api\/skills\/([^/]+)\/file$/);
        if(skillFileRoute&&req.method==='GET'){const file=skills.fileFor(accounts.authenticated(raw),decodeURIComponent(skillFileRoute[1]),url.searchParams.get('path'));res.writeHead(200,{'content-type':file.mime,'content-disposition':`inline; filename*=UTF-8''${encodeURIComponent(file.name)}`});return res.end(file.data);}
        if(req.method==='GET'&&route==='/api/skills/deleted')return json(res,200,skills.deleted(accounts.authenticated(raw)));
        const skillAction=route.match(/^\/api\/skills\/([^/]+)\/(remove|restore)$/);
        if(skillAction&&req.method==='POST'){const a=editor(req,raw),input=await body(req);return json(res,200,skills[skillAction[2]](a,decodeURIComponent(skillAction[1]),input.version));}
        const skillRoute=route.match(/^\/api\/skills\/([^/]+)$/);
        if(skillRoute&&req.method==='GET')return json(res,200,skills.detail(accounts.authenticated(raw),decodeURIComponent(skillRoute[1])));
        if(skillRoute&&req.method==='PATCH'){const a=editor(req,raw),input=await body(req,1024*1024),id=decodeURIComponent(skillRoute[1]);return json(res,200,Object.keys(input).length===1&&Object.hasOwn(input,'enabled')?skills.toggle(a,id,input.enabled):skills.update(a,id,input));}
        if(req.method==='GET'&&route==='/api/connectors')return json(res,200,connectors.list(accounts.authenticated(raw)));
        if(req.method==='POST'&&route==='/api/connectors'){const a=editor(req,raw);return json(res,201,connectors.create(a,await body(req,50000)));}
        const connectorRoute=route.match(/^\/api\/connectors\/([a-f0-9-]{36})(\/(?:test|connect|disconnect|oauth-client))?$/);
        if(connectorRoute&&req.method==='GET'&&connectorRoute[2]==='/oauth-client')return json(res,200,connectorOAuth.configuration(accounts.authenticated(raw),connectorRoute[1]));
        if(connectorRoute&&req.method==='PATCH'&&!connectorRoute[2]){const a=editor(req,raw);const result=connectors.update(a,connectorRoute[1],await body(req,50000));permissions.reconcile();return json(res,200,result);}
        if(connectorRoute&&req.method==='POST'&&connectorRoute[2]){const a=editor(req,raw),id=connectorRoute[1];
          if(connectorRoute[2]==='/oauth-client')return json(res,200,connectorOAuth.configure(a,id,await body(req)));
          if(connectorRoute[2]==='/connect')return json(res,200,await connectorOAuth.start(a,id));
          if(connectorRoute[2]==='/disconnect'){const result=connectorOAuth.disconnect(a,id);permissions.reconcile();return json(res,200,result);}
          await connectorOAuth.ready(a,connectors.resolve(a,[id]));return json(res,200,await connectors.test(a,id));
        }
        const connectorFlow=route.match(/^\/api\/connector-oauth\/flows\/([a-f0-9-]{36})(\/cancel)?$/);
        if(connectorFlow&&req.method==='GET'&&!connectorFlow[2])return json(res,200,connectorOAuth.get(accounts.authenticated(raw),connectorFlow[1]));
        if(connectorFlow&&req.method==='POST'&&connectorFlow[2])return json(res,200,connectorOAuth.cancel(editor(req,raw),connectorFlow[1]));
        if(req.method==='GET'&&route==='/api/tool-permissions')return json(res,200,permissions.list(accounts.authenticated(raw)));
        const permissionRoute=route.match(/^\/api\/tool-permissions\/([a-f0-9-]{36})$/);
        if(permissionRoute&&req.method==='POST'){const a=csrf(req,raw);return json(res,200,permissions.decide(a,permissionRoute[1],(await body(req)).allow));}
        if (req.method === 'GET' && route === '/api/brain') return json(res,200,brain.view(accounts.authenticated(raw)));
        if (req.method === 'POST' && route === '/api/brain/messages') {const a=csrf(req,raw);return json(res,200,await brain.send(a,await body(req,65536)));}
        if (req.method === 'POST' && route === '/api/brain/review') return json(res,200,brain.review(csrf(req,raw)));
        if (req.method === 'PATCH' && route === '/api/brain/profile') {const a=csrf(req,raw);return json(res,200,brain.patch(a,await body(req,300000)));}
        if (req.method === 'POST' && route === '/api/brain/confirm') {const a=csrf(req,raw);return json(res,200,brain.confirm(a,await body(req)));}
        if (req.method === 'POST' && route === '/api/brain/dismiss') return json(res,200,brain.dismiss(csrf(req,raw)));
        if (req.method === 'GET' && route === '/api/brain/skill') {const text=brain.exportSkill(accounts.authenticated(raw));res.writeHead(200,{'content-type':'text/markdown; charset=utf-8','content-disposition':'attachment; filename="SKILL.md"'});return res.end(text);}
        if (req.method === 'POST' && route === '/api/brain/files') {
          const a=editor(req,raw),contentType=req.headers['content-type']||'';
          if(!contentType.startsWith('multipart/form-data;'))throw problem(415,'Envie o arquivo pelo botão de anexar.');
          let bytes=0;const chunks=[];for await(const chunk of req){bytes+=chunk.length;if(bytes>MAX_BRAND_FILE+65536)throw problem(413,'O arquivo precisa ter até 8 MB.');chunks.push(chunk);}
          let form;try{form=await new Request(origin,{method:'POST',headers:{'content-type':contentType},body:Buffer.concat(chunks)}).formData();}catch{throw problem(400,'Não foi possível ler o arquivo enviado.');}
          const file=form.get('file');if(form.getAll('file').length!==1||!file||typeof file.arrayBuffer!=='function')throw problem(400,'Selecione um arquivo.');
          return json(res,201,{file:brain.upload(a,file.name,Buffer.from(await file.arrayBuffer()))});
        }
        const brainFile=route.match(/^\/api\/brain\/files\/([a-f0-9-]{36})$/);
        if(req.method==='GET'&&brainFile){const f=brain.fileFor(accounts.authenticated(raw),brainFile[1]);res.writeHead(200,{'content-type':f.mime,'content-disposition':`attachment; filename*=UTF-8''${encodeURIComponent(f.name)}`});return res.end(f.data);}
        if(req.method==='GET'&&route==='/api/ai/status'){const a=accounts.authenticated(raw);if(a.user.role!=='admin')throw problem(403,'Acesso restrito aos administradores.');const [claude,codex]=await Promise.all([ai.status('claude',{fresh:url.searchParams.has('fresh')}),ai.status('codex',{fresh:url.searchParams.has('fresh')})]);return json(res,200,{claude,codex});}
        const connect=route.match(/^\/api\/ai\/(claude|codex)\/login$/);
        if(req.method==='POST'&&connect){const a=editor(req,raw);return json(res,200,await ai.connections.start(connect[1],a.organization.id+':'+a.user.id));}
        const flow=route.match(/^\/api\/ai\/flows\/([a-f0-9-]{36})(?:\/(code|cancel))?$/);
        if(flow){const a=req.method==='GET'?accounts.authenticated(raw):editor(req,raw);if(a.user.role!=='admin')throw problem(403,'Acesso restrito aos administradores.');const owner=a.organization.id+':'+a.user.id;
          if(req.method==='GET'&&!flow[2])return json(res,200,ai.connections.public(ai.connections.get(flow[1],owner)));
          if(req.method==='POST'&&flow[2]==='cancel')return json(res,200,ai.connections.cancel(flow[1],owner));
          if(req.method==='POST'&&flow[2]==='code')return json(res,200,ai.connections.submit(flow[1],owner,(await body(req)).code));
        }
        if (req.method === 'GET' && route === '/api/team') return json(res,200,accounts.list(raw));
        if (req.method === 'POST' && route === '/api/team/invitations') { csrf(req,raw); const l = accounts.invite(raw,await body(req)); return json(res,201,{...l,token:undefined,url:`${origin}/convite#token=${l.token}`}); }
        const invitation = route.match(/^\/api\/team\/invitations\/([a-f0-9-]+)\/(renew|revoke)$/);
        if (req.method === 'POST' && invitation) { csrf(req,raw); if (invitation[2] === 'revoke') { accounts.revokeInvite(raw,invitation[1]); return json(res,200,{ok:true}); } const l = accounts.renewInvite(raw,invitation[1]); return json(res,200,{...l,token:undefined,url:`${origin}/convite#token=${l.token}`}); }
        const user = route.match(/^\/api\/team\/users\/([a-f0-9-]+)(\/reset-link)?$/);
        if (user && req.method === 'PATCH' && !user[2]) { csrf(req,raw); return json(res,200,{user:accounts.updateUser(raw,user[1],await body(req))}); }
        if (user && req.method === 'POST' && user[2]) { csrf(req,raw); const l = accounts.resetLink(raw,user[1]); return json(res,200,{...l,token:undefined,url:`${origin}/nova-senha#token=${l.token}`}); }
        throw problem(404, 'Página não encontrada.');
      }
      if (!['GET','HEAD'].includes(req.method)) throw problem(405,'Método não permitido.');
      let file;
      if (['/','/index.html'].includes(route)) { try { accounts.authenticated(raw); } catch { return redirect(res,'/login'); } file = 'index.html'; }
      else if (route === '/pessoas') { try { accounts.authenticated(raw); } catch { return redirect(res,'/login'); } return redirect(res,'/conta'); }
      else if (route === '/conta') { try { accounts.authenticated(raw); } catch { return redirect(res,'/login'); } file = 'access.html'; }
      else if (route === '/apresentacao') return redirect(res,'/apresentacao/');
      else if (['/apresentacao/','/apresentacao/index.html'].includes(route)) { try { accounts.authenticated(raw); } catch { return redirect(res,'/login'); } file = 'apresentacao/index.html'; }
      else if (['/login','/primeiro-acesso','/convite','/nova-senha','/recuperar'].includes(route)) file = 'access.html';
      else if (['/access.css','/workspace.css','/brand.css','/capabilities.css','/apresentacao/styles.css','/apresentacao/direction.css','/apresentacao/access.css'].includes(route) || /^\/(?:apresentacao\/)?assets\/[a-zA-Z0-9_.-]+$/.test(route)) file = route.slice(1);
      else throw problem(404,'Página não encontrada.');
      let content; try { content = await readFile(path.join(root,file)); } catch(e) { if(e.code==='ENOENT') throw problem(404,'Página não encontrada.'); throw e; }
      if(['index.html','access.html'].includes(file)){
        let version;try{version=JSON.parse(await readFile(path.join(root,'assets/version.json'),'utf8')).version;}catch{}
        if(/^[a-f0-9]{16}$/.test(version||''))content=content.toString().replace('<html lang="pt-BR">',`<html lang="pt-BR" data-build="${version}">`).replace(/((?:src|href)="\/(?:assets\/[^"?]+\.(?:js|css)|workspace\.css|access\.css|brand\.css|capabilities\.css))"/g,`$1?v=${version}"`);
      }
      res.writeHead(200,{'content-type':types[path.extname(file)] || 'application/octet-stream'});
      res.end(req.method==='HEAD' ? undefined : content);
    } catch(e) {
      if (res.headersSent) { res.end(); return; }
      if (e.status === 401) clearCookie(res);
      if (e.status === 429) res.setHeader('retry-after',String(Number.isInteger(e.retryAfter)?e.retryAfter:900));
      if (!e.status) console.error('Falha no servidor IANiza:', e.code ?? e.name);
      json(res,e.status ?? 500,{error:e.status ? e.message : 'Não foi possível concluir agora. Tente novamente.'});
    }
  });
  server.requestTimeout = 60000; server.headersTimeout = 10000;
  server.on('close',()=>{skillImports.close();permissions.close();connectorOAuth.close();ai.close();agents.close();brain.close();skills.close();connectors.close();});
  return { server, accounts, brain, ai, skills, connectors, connectorOAuth, permissions, agents, origin };
}
