import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createConnectorsStore} from '../server/connectors-store.mjs';
import {createConnectorOAuth} from '../server/connector-oauth.mjs';
import {HIGGSFIELD,META_ADS} from '../server/connector-defaults.mjs';
const admin={organization:{id:'11111111-1111-4111-8111-111111111111'},user:{id:'owner',name:'Teste',role:'admin'}},other={...admin,organization:{id:'22222222-2222-4222-8222-222222222222'}},member={...admin,user:{id:'member',role:'member'}};
async function fixture(t){const directory=await mkdtemp(path.join(tmpdir(),'ianiza-oauth-'));let clock=1000000,denied=false;const store=createConnectorsStore({directory,now:()=>clock});const requests=[];
 const fetcher=async(url,options)=>{
  const u=new URL(url),body=options?.body;requests.push({url:u.href,body:typeof body==='string'?body:body?.toString()});
  if(u.href===HIGGSFIELD.resourceMetadataUrl)return Response.json({resource:HIGGSFIELD.url,authorization_servers:[HIGGSFIELD.issuer],scopes_supported:HIGGSFIELD.scope.split(' ')});
  if(u.pathname==='/.well-known/oauth-authorization-server')return Response.json({issuer:HIGGSFIELD.issuer,authorization_endpoint:HIGGSFIELD.issuer+'/oauth/authorize',token_endpoint:HIGGSFIELD.issuer+'/oauth/token',registration_endpoint:HIGGSFIELD.issuer+'/oauth/register',response_types_supported:['code'],grant_types_supported:['authorization_code','refresh_token'],token_endpoint_auth_methods_supported:['none'],code_challenge_methods_supported:['S256']});
  if(u.pathname==='/oauth/register')return Response.json({...JSON.parse(body),client_id:'client-local-fixture'});
  if(u.pathname==='/oauth/token'){
   const params=new URLSearchParams(body);if(denied)return Response.json({error:'invalid_grant'},{status:400});
   if(params.get('grant_type')==='authorization_code'){assert.equal(params.get('code'),'codigo-de-teste');assert.ok(params.get('code_verifier')?.length>=43);assert.equal(params.get('redirect_uri'),'http://127.0.0.1:4173/api/connector-oauth/callback');}
   return Response.json({access_token:params.get('grant_type')==='refresh_token'?'token-renovado-local':'token-autorizado-local',refresh_token:'refresh-privado-local',token_type:'Bearer',expires_in:3600});
  }
  throw new Error('URL inesperada: '+u.href);
 };
 const oauth=createConnectorOAuth({origin:'http://127.0.0.1:4173',store,fetcher,now:()=>clock});t.after(async()=>{oauth.close();store.close();await rm(directory,{recursive:true,force:true});});
 const id=store.list(admin).connectors.find(c=>c.builtin==='higgsfield').id;
 return {directory,store,oauth,id,requests,tick(ms){clock+=ms;},deny(){denied=true;}};
}
async function connect(f){const flow=await f.oauth.start(admin,f.id),url=new URL(flow.url);return f.oauth.complete(admin,{state:url.searchParams.get('state'),code:'codigo-de-teste',iss:HIGGSFIELD.issuer});}

test('Higgsfield já aparece como padrão por organização, sem login falso nem duplicação',async t=>{
 const f=await fixture(t),first=f.store.list(admin).connectors.find(c=>c.id===f.id);assert.equal(first.name,'Higgsfield');assert.equal(first.url,HIGGSFIELD.url);assert.equal(first.source,'default');assert.equal(first.requiresConnection,true);assert.equal(first.hasCredentials,false);assert.equal(first.status,'auth-required');assert.equal(f.store.list(admin).connectors.length,2);assert.notEqual(f.store.list(other).connectors.find(c=>c.builtin==='higgsfield').id,f.id);
 assert.throws(()=>f.store.resolve(admin,[f.id]),{status:409});assert.throws(()=>f.store.create(admin,{name:'Duplicado',url:HIGGSFIELD.url}),{status:409});assert.throws(()=>f.store.update(admin,f.id,{name:'Outro',url:'https://example.test/mcp'}),{status:400});
 f.store.update(admin,f.id,{enabled:false});assert.equal(f.store.list(admin).connectors.find(c=>c.id===f.id).enabled,false);assert.equal(f.store.list(other).connectors.find(c=>c.builtin==='higgsfield').enabled,true);await assert.rejects(f.oauth.start(admin,f.id),{status:409});assert.equal(f.requests.length,0);
});
test('OAuth usa descoberta, PKCE e callback de uso único; tokens ficam criptografados',async t=>{
 const f=await fixture(t),flow=await f.oauth.start(admin,f.id),url=new URL(flow.url);assert.equal(url.origin,HIGGSFIELD.issuer);assert.equal(url.searchParams.get('code_challenge_method'),'S256');assert.ok(url.searchParams.get('state'));assert.equal(url.searchParams.get('redirect_uri'),'http://127.0.0.1:4173/api/connector-oauth/callback');assert.doesNotMatch(JSON.stringify(flow),/code_verifier|refresh-privado-local/);
 await assert.rejects(f.oauth.complete(member,{state:url.searchParams.get('state'),code:'codigo-de-teste'}),{status:400});assert.throws(()=>f.oauth.get(other,flow.id),{status:404});
 const done=await f.oauth.complete(admin,{state:url.searchParams.get('state'),code:'codigo-de-teste',iss:HIGGSFIELD.issuer});assert.equal(done.stage,'complete');assert.equal(done.url,undefined);await assert.rejects(f.oauth.complete(admin,{state:url.searchParams.get('state'),code:'codigo-de-teste'}),{status:400});
 const row=f.store.list(admin).connectors.find(c=>c.id===f.id);assert.equal(row.status,'authorized');assert.equal(row.requiresConnection,false);assert.equal(row.hasCredentials,true);assert.doesNotMatch(JSON.stringify(row),/token-autorizado-local|refresh-privado-local/);assert.equal((await readFile(path.join(f.directory,'connectors.sqlite'))).includes(Buffer.from('token-autorizado-local')),false);
 assert.equal(f.store.resolve(admin,[f.id])[0].headers[0].value,'Bearer token-autorizado-local');assert.throws(()=>f.store.oauthCredentials(member,f.id),{status:403});assert.throws(()=>f.store.oauthCredentials(other,f.id),{status:404});
 assert.equal(f.requests.filter(r=>r.url.endsWith('/oauth/register')).length,1);f.oauth.disconnect(admin,f.id);assert.equal(f.store.list(admin).connectors.find(c=>c.id===f.id).requiresConnection,true);
});
test('renova token antes do turno; falha exige reconexão e não envia token expirado',async t=>{
 const f=await fixture(t);await connect(f);const selected=f.store.resolve(admin,[f.id]);const before=f.requests.length;assert.equal((await f.oauth.ready(admin,selected))[0].headers[0].value,'Bearer token-autorizado-local');assert.equal(f.requests.length,before);
 f.tick(3600*1000);const [a,b]=await Promise.all([f.oauth.ready(member,selected),f.oauth.ready(admin,selected)]);assert.equal(a[0].headers[0].value,'Bearer token-renovado-local');assert.equal(b[0].headers[0].value,'Bearer token-renovado-local');assert.equal(f.requests.filter(r=>r.body?.includes('grant_type=refresh_token')).length,1);
 f.tick(3600*1000);f.deny();await assert.rejects(f.oauth.ready(member,selected),{status:409});assert.equal(f.store.list(admin).connectors.find(c=>c.id===f.id).requiresConnection,true);
});
test('cancelamento, expiração e troca de emissor não conectam uma conta',async t=>{
 const f=await fixture(t);let flow=await f.oauth.start(admin,f.id),state=new URL(flow.url).searchParams.get('state');f.oauth.cancel(admin,flow.id);await assert.rejects(f.oauth.complete(admin,{state,code:'codigo-de-teste'}),{status:400});
 flow=await f.oauth.start(admin,f.id);state=new URL(flow.url).searchParams.get('state');await assert.rejects(f.oauth.complete(admin,{state,code:'codigo-de-teste',iss:'https://outro.example'}),{status:400});assert.equal(f.store.list(admin).connectors.find(c=>c.id===f.id).requiresConnection,true);f.tick(11*60000);await assert.rejects(f.oauth.complete(admin,{state,code:'codigo-de-teste'}),{status:400});
 await assert.rejects(f.oauth.start(member,f.id),{status:403});assert.equal(f.store.list(admin).connectors.find(c=>c.id===f.id).hasCredentials,false);
});
test('OAuth sobrevive reinício com tokens por empresa, e padrão adota cadastro anterior',async t=>{
 const f=await fixture(t);await connect(f);const second=createConnectorsStore({directory:f.directory});assert.equal(second.list(admin).connectors.find(c=>c.id===f.id).requiresConnection,false);assert.equal(second.resolve(admin,[f.id])[0].headers[0].value,'Bearer token-autorizado-local');second.close();
 const custom=f.store.create(other,{name:'Nome anterior',url:'https://example.test/mcp'});f.store.update(other,custom.id,{enabled:false});const db=new DatabaseSync(path.join(f.directory,'connectors.sqlite'));db.prepare('DELETE FROM connectors WHERE org_id=? AND builtin=?').run(other.organization.id,'higgsfield');db.prepare('UPDATE connectors SET url=? WHERE id=?').run(HIGGSFIELD.url,custom.id);db.close();
 const adopted=f.store.list(other).connectors;assert.equal(adopted.length,2);const adoptedHiggsfield=adopted.find(c=>c.builtin==='higgsfield');assert.equal(adoptedHiggsfield.id,custom.id);assert.equal(adoptedHiggsfield.enabled,false);
});
