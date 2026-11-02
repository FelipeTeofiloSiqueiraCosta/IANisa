import {DatabaseSync} from 'node:sqlite';
import {randomUUID,randomBytes,createCipheriv,createDecipheriv} from 'node:crypto';
import {mkdirSync,chmodSync,readFileSync,writeFileSync,existsSync} from 'node:fs';
import path from 'node:path';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {problem} from './accounts.mjs';
import {HIGGSFIELD,META_ADS,OAUTH_CONNECTORS,oauthConnector} from './connector-defaults.mjs';

export function connectorURL(value) {
 let url;try{url=new URL(value);}catch{throw problem(400,'Informe o endereço completo do servidor MCP.');}
 if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.hash||url.href.length>2048)throw problem(400,'Use um endereço HTTP ou HTTPS, sem senha ou fragmento.');
 if([...url.searchParams.keys()].some(k=>/token|secret|password|key|auth|credential/i.test(k)))throw problem(400,'Coloque credenciais nos campos de autenticação, sem incluí-las no endereço.');
 if(url.protocol==='http:'&&!['localhost','127.0.0.1','[::1]'].includes(url.hostname))throw problem(400,'Use HTTPS para servidores externos. HTTP é permitido somente no localhost.');
 return url.href;
}
function headersFor(input) {
 if(!Array.isArray(input)||input.length>8)throw problem(400,'Adicione até oito cabeçalhos.');
 const seen=new Set();
 return input.map(h=>{
  if(typeof h?.name!=='string'||!/^[-A-Za-z0-9]{1,60}$/.test(h.name)||typeof h.value!=='string'||h.value.length>4096||/[\r\n\x00]/.test(h.value))throw problem(400,'Cabeçalho inválido.');
  const name=h.name.toLowerCase();if(seen.has(name)||['host','cookie','content-length','content-type','accept','connection','origin','mcp-session-id','mcp-protocol-version'].includes(name))throw problem(400,'Cabeçalho repetido ou reservado pelo protocolo MCP.');seen.add(name);
  return {name:h.name,value:h.value};
 });
}
export async function inspectMCP(server) {
 const client=new Client({name:'ianiza-connection-test',version:'0.2.0'}),abort=new AbortController();
 const timer=setTimeout(()=>abort.abort(),10000);
 const transport=new StreamableHTTPClientTransport(new URL(server.url),{
  requestInit:{headers:Object.fromEntries(server.headers.map(h=>[h.name,h.value])),redirect:'error'},
  fetch:(url,init)=>fetch(url,{...init,redirect:'error',signal:AbortSignal.any([abort.signal,...(init?.signal?[init.signal]:[])])}),
 });
 try{
  await client.connect(transport,{timeout:10000});if(!client.getServerCapabilities()?.tools)return {tools:[]};let cursor,tools=[],pages=0;
  do {const result=await client.listTools(cursor?{cursor}:{},{timeout:10000});tools.push(...result.tools.map(t=>({name:String(t.name).slice(0,180),description:String(t.description||'').slice(0,1000)})));cursor=result.nextCursor;if(++pages>=5||tools.length>200)break;}while(cursor);
  return {tools:tools.slice(0,200)};
 }finally{clearTimeout(timer);await client.close().catch(()=>{});await transport.close().catch(()=>{});}
}
export function createConnectorsStore({directory,inspect=inspectMCP,now=Date.now}) {
 mkdirSync(directory,{recursive:true,mode:0o700});
 const keyfile=path.join(directory,'.connector-key');if(!existsSync(keyfile))writeFileSync(keyfile,randomBytes(32),{flag:'wx',mode:0o600});
 const key=readFileSync(keyfile);if(key.length!==32)throw new Error('Chave de conectores inválida.');chmodSync(keyfile,0o600);
 const filename=path.join(directory,'connectors.sqlite'),db=new DatabaseSync(filename);chmodSync(filename,0o600);
 db.exec(`PRAGMA busy_timeout=5000;CREATE TABLE IF NOT EXISTS connectors(id TEXT PRIMARY KEY,org_id TEXT NOT NULL,name TEXT NOT NULL,url TEXT NOT NULL,headers TEXT NOT NULL,enabled INTEGER NOT NULL,status TEXT NOT NULL,tools TEXT NOT NULL,tested_at INTEGER,at INTEGER NOT NULL,created_by TEXT NOT NULL);`);
 if(!db.prepare('PRAGMA table_info(connectors)').all().some(c=>c.name==='builtin'))db.exec("ALTER TABLE connectors ADD COLUMN builtin TEXT");
 db.exec('CREATE TABLE IF NOT EXISTS connector_oauth(connector_id TEXT PRIMARY KEY,org_id TEXT NOT NULL,credentials TEXT NOT NULL);');
 const get=(sql,...a)=>db.prepare(sql).get(...a),all=(sql,...a)=>db.prepare(sql).all(...a),run=(sql,...a)=>db.prepare(sql).run(...a);
 const jobs=new Set();
 const admin=actor=>{if(actor.user.role!=='admin')throw problem(403,'Somente administradores podem configurar conectores.');};
 function seal(headers,org,id){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(Buffer.from(org+':'+id));const data=Buffer.concat([cipher.update(JSON.stringify(headers)),cipher.final()]);return [iv,cipher.getAuthTag(),data].map(b=>b.toString('base64')).join('.');}
 function unseal(row){const [iv,tag,data]=row.headers.split('.').map(s=>Buffer.from(s,'base64'));const cipher=createDecipheriv('aes-256-gcm',key,iv);cipher.setAAD(Buffer.from(row.org_id+':'+row.id));cipher.setAuthTag(tag);return JSON.parse(Buffer.concat([cipher.update(data),cipher.final()]).toString());}
 function seed(actor){const org=actor.organization.id;
  for(const provider of OAUTH_CONNECTORS){
   if(get('SELECT id FROM connectors WHERE org_id=? AND builtin=?',org,provider.key))continue;
   const existing=get('SELECT * FROM connectors WHERE org_id=? AND url=? ORDER BY at LIMIT 1',org,provider.url);
   if(existing){run('UPDATE connectors SET builtin=?,name=? WHERE id=?',provider.key,provider.name,existing.id);continue;}
   const id=randomUUID();run('INSERT INTO connectors(id,org_id,name,url,headers,enabled,status,tools,tested_at,at,created_by,builtin) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',id,org,provider.name,provider.url,seal([],org,id),1,'auth-required','[]',null,now(),actor.user.id,provider.key);
  }
 }
 function rowFor(actor,id){seed(actor);const r=get('SELECT * FROM connectors WHERE org_id=? AND id=?',actor.organization.id,id);if(!r)throw problem(404,'Conector não encontrado.');return r;}
 function credentialsFor(r){const saved=get('SELECT credentials FROM connector_oauth WHERE connector_id=? AND org_id=?',r.id,r.org_id);return saved?unseal({headers:saved.credentials,org_id:r.org_id,id:r.id+':oauth'}):{};}
 function manualAuth(r){return r.builtin===META_ADS.key&&unseal(r).some(h=>h.name.toLowerCase()==='authorization'&&/^Bearer \S/.test(h.value));}
 function summary(r){const credentials=credentialsFor(r),authorized=Boolean(credentials.tokens?.access_token)||manualAuth(r),provider=oauthConnector(r.builtin);return {id:r.id,name:r.name,url:r.url,source:r.builtin?'default':'custom',builtin:r.builtin,authType:r.builtin?'oauth':'headers',setupRequired:Boolean(provider?.requiresClientId)&&!credentials.clientInformation?.client_id,requiresConnection:Boolean(r.builtin)&&!authorized,enabled:Boolean(r.enabled),status:r.builtin&&!authorized?'auth-required':r.status,tools:JSON.parse(r.tools),testedAt:r.tested_at,hasCredentials:authorized||unseal(r).length>0};}
 function list(actor){seed(actor);return {connectors:all('SELECT * FROM connectors WHERE org_id=? ORDER BY builtin DESC,at',actor.organization.id).map(summary),editable:actor.user.role==='admin'};}
 function create(actor,input){admin(actor);const name=String(input.name||'').trim();if(!name||name.length>80)throw problem(400,'Dê um nome de até 80 caracteres ao conector.');
  const url=connectorURL(input.url),headers=headersFor(input.headers||[]),id=randomUUID(),org=actor.organization.id;
  seed(actor);const included=OAUTH_CONNECTORS.find(p=>p.url===url);if(included)throw problem(409,'O '+included.name+' já está incluído nos conectores. Use Conectar '+included.name+' para autorizar sua conta.');
  if(get('SELECT count(*) AS n FROM connectors WHERE org_id=?',org).n>=30)throw problem(413,'A empresa pode cadastrar até 30 conectores.');
  run('INSERT INTO connectors(id,org_id,name,url,headers,enabled,status,tools,tested_at,at,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?)',id,org,name,url,seal(headers,org,id),1,'configured','[]',null,now(),actor.user.id);return summary(rowFor(actor,id));
 }
 function update(actor,id,input){admin(actor);const r=rowFor(actor,id);if(jobs.has(id))throw problem(409,'Espere o teste de conexão terminar.');
  if(typeof input.enabled==='boolean'&&Object.keys(input).length===1){run('UPDATE connectors SET enabled=? WHERE id=?',input.enabled?1:0,id);return summary(rowFor(actor,id));}
  if(r.builtin)throw problem(400,'O nome e o endereço do conector padrão são definidos pela IANiza. Você pode conectar, desconectar ou desativar.');
  const name=String(input.name||'').trim();if(!name||name.length>80)throw problem(400,'Dê um nome de até 80 caracteres ao conector.');
  const url=connectorURL(input.url),headers=input.headers===undefined?unseal(r):headersFor(input.headers);
  run('UPDATE connectors SET name=?,url=?,headers=?,status=?,tools=?,tested_at=NULL WHERE id=?',name,url,seal(headers,r.org_id,id),'configured','[]',id);return summary(rowFor(actor,id));
 }
 function descriptor(r){let headers=unseal(r);if(r.builtin&&!manualAuth(r)){const tokens=credentialsFor(r).tokens;if(!tokens?.access_token)throw problem(409,'Para usar '+r.name+', clique em Conectar '+r.name+' na área de Conectores. Se o botão não aparecer, atualize a página.');headers=[{name:'Authorization',value:'Bearer '+tokens.access_token}];}return {type:'http',name:'mcp_'+r.id.replace(/-/g,''),url:r.url,headers};}
 async function test(actor,id){admin(actor);const r=rowFor(actor,id);if(jobs.has(id))throw problem(409,'Este conector já está sendo testado.');jobs.add(id);
  try{const result=await inspect(descriptor(r));run('UPDATE connectors SET status=?,tools=?,tested_at=? WHERE id=?','tested',JSON.stringify(result.tools),now(),id);return {connector:summary(rowFor(actor,id)),message:`Conexão verificada. ${result.tools.length} ferramentas disponíveis.`};}
  catch(e){const auth=e.code===401||e.code===403||e.name==='UnauthorizedError'||/401|403/.test(String(e.message));if(auth&&r.builtin)disconnect(actor,id);run('UPDATE connectors SET status=?,tools=?,tested_at=? WHERE id=?',auth?'auth-required':'error','[]',now(),id);throw problem(422,auth?(r.builtin?'A autorização de '+r.name+' expirou ou foi recusada. Reconecte a conta na área de Conectores.':'O serviço pediu autenticação. Confira o token. Serviços que exigem OAuth precisam de uma integração de autorização própria.'):'Não foi possível consultar este MCP. Confira o endereço, as credenciais e se o servidor está disponível.');}
  finally{jobs.delete(id);}
 }
 function resolve(actor,ids){if(!Array.isArray(ids)||ids.length>5||new Set(ids).size!==ids.length||ids.some(id=>typeof id!=='string'))throw problem(400,'Escolha até cinco conectores diferentes.');
  return ids.map(id=>{const r=rowFor(actor,id);if(!r.enabled)throw problem(409,'O conector '+r.name+' está desativado.');return {id:r.id,title:r.name,builtin:r.builtin,manualAuth:manualAuth(r),...descriptor(r)};});
 }
 function runtimeTarget(actor,id){const r=rowFor(actor,id);if(!oauthConnector(r.builtin)||r.url!==oauthConnector(r.builtin).url)throw problem(400,'Este conector não tem um fluxo de autorização integrado.');return summary(r);}
 function oauthTarget(actor,id){admin(actor);return runtimeTarget(actor,id);}
 function runtimeCredentials(actor,id){runtimeTarget(actor,id);return credentialsFor(rowFor(actor,id));}
 function oauthCredentials(actor,id){admin(actor);return runtimeCredentials(actor,id);}
 function saveCredentials(actor,id,value,{renew=false}={}){runtimeTarget(actor,id);run('INSERT INTO connector_oauth VALUES (?,?,?) ON CONFLICT(connector_id) DO UPDATE SET credentials=excluded.credentials',id,actor.organization.id,seal(value,actor.organization.id,id+':oauth'));if(!renew)run('UPDATE connectors SET status=?,tools=?,tested_at=NULL WHERE id=?',value.tokens?.access_token?'authorized':'auth-required','[]',id);}
 function saveOAuth(actor,id,value,options){admin(actor);saveCredentials(actor,id,value,options);}
 function invalidateRuntime(actor,id){const target=runtimeTarget(actor,id),credentials=runtimeCredentials(actor,id);run('DELETE FROM connector_oauth WHERE connector_id=? AND org_id=?',id,actor.organization.id);if(target.builtin===META_ADS.key&&credentials.clientInformation)saveCredentials(actor,id,{clientInformation:credentials.clientInformation,redirectUrl:credentials.redirectUrl});run('UPDATE connectors SET status=?,tools=?,tested_at=NULL,headers=? WHERE id=?','auth-required','[]',seal([],actor.organization.id,id),id);return summary(rowFor(actor,id));}
 function disconnect(actor,id){admin(actor);return invalidateRuntime(actor,id);}
 // Uso exclusivamente interno do transporte: membros podem usar a conexão autorizada
 // da instalação, sem ler tokens pela API nem administrar OAuth.
 const runtimeOAuth={credentials:runtimeCredentials,saveRenewed:(actor,id,value)=>saveCredentials(actor,id,value,{renew:true}),invalidate:invalidateRuntime};

 return {list,create,update,test,resolve,oauthTarget,oauthCredentials,saveOAuth,disconnect,runtimeOAuth,close(){db.close();}};
}
