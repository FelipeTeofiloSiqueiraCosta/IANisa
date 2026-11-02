import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createConnectorsStore} from '../server/connectors-store.mjs';
import {createConnectorOAuth} from '../server/connector-oauth.mjs';
import {META_ADS} from '../server/connector-defaults.mjs';
const actor={organization:{id:'11111111-1111-4111-8111-111111111111'},user:{id:'owner',role:'admin'}},other={...actor,organization:{id:'22222222-2222-4222-8222-222222222222'}};
async function fixture(t){const directory=await mkdtemp(path.join(tmpdir(),'ianiza-meta-'));let clock=1000000;const store=createConnectorsStore({directory}),calls=[];
 const fetcher=async(url,options)=>{url=new URL(url);calls.push(url.href);
  if(url.href===META_ADS.resourceMetadataUrl)return Response.json({resource:META_ADS.url,authorization_servers:[META_ADS.issuer],scopes_supported:META_ADS.scope.split(' ')});
  if(url.pathname==='/.well-known/oauth-authorization-server/ads')return Response.json({issuer:META_ADS.issuer,authorization_endpoint:'https://www.facebook.com/v26.0/dialog/oauth',token_endpoint:'https://graph.facebook.com/v26.0/oauth/access_token',registration_endpoint:'https://mcp.facebook.com/.well-known/register/ads',response_types_supported:['code'],grant_types_supported:['authorization_code','refresh_token'],code_challenge_methods_supported:['S256'],token_endpoint_auth_methods_supported:['none']});
  if(url.hostname==='graph.facebook.com'){const params=new URLSearchParams(options.body);assert.equal(params.get('client_id'),'123456789012345');assert.equal(params.get('code'),'codigo-meta-local');assert.ok(params.get('code_verifier').length>=43);assert.equal(params.has('client_secret'),false);return Response.json({access_token:'token-meta-fixture',token_type:'Bearer',expires_in:3600});}
  throw new Error('Destino inesperado: '+url.href);
 };
 const oauth=createConnectorOAuth({origin:'http://127.0.0.1:4173',store,fetcher,now:()=>clock}),id=store.list(actor).connectors.find(c=>c.builtin==='meta-ads').id;
 t.after(async()=>{oauth.close();store.close();await rm(directory,{recursive:true,force:true});});return {store,oauth,id,calls,tick(ms){clock+=ms;}};
}
test('Meta exige configurar App ID e não tenta cadastro dinâmico bloqueado pelo provedor',async t=>{
 const f=await fixture(t);assert.equal(f.store.oauthTarget(actor,f.id).setupRequired,true);await assert.rejects(f.oauth.start(actor,f.id),{status:409});assert.equal(f.calls.length,0);assert.throws(()=>f.oauth.configure(actor,f.id,{clientId:'invalido'}),{status:400});assert.throws(()=>f.oauth.configure(other,f.id,{clientId:'123456789012345'}),{status:404});
 const result=f.oauth.configure(actor,f.id,{clientId:'123456789012345'});assert.equal(result.callbackUrl,'http://127.0.0.1:4173/api/connector-oauth/callback');assert.equal(f.store.oauthTarget(actor,f.id).setupRequired,false);assert.equal(f.store.oauthTarget(actor,f.id).requiresConnection,true);
});
test('login da Meta usa o App ID cadastrado, PKCE e endpoints oficiais específicos',async t=>{
 const f=await fixture(t);f.oauth.configure(actor,f.id,{clientId:'123456789012345'});const flow=await f.oauth.start(actor,f.id),url=new URL(flow.url);assert.equal(flow.name,'Meta Ads');assert.equal(url.origin,'https://www.facebook.com');assert.equal(url.pathname,'/v26.0/dialog/oauth');assert.equal(url.searchParams.get('client_id'),'123456789012345');assert.equal(url.searchParams.get('code_challenge_method'),'S256');assert.ok(url.searchParams.get('scope').includes('ads_read'));assert.equal(f.calls.some(c=>c.includes('/register/')),false);
 const done=await f.oauth.complete(actor,{state:url.searchParams.get('state'),code:'codigo-meta-local',iss:META_ADS.issuer});assert.equal(done.stage,'complete');const selected=f.store.resolve(actor,[f.id]);assert.equal(selected[0].headers[0].value,'Bearer token-meta-fixture');assert.equal(f.store.oauthTarget(actor,f.id).requiresConnection,false);
 f.tick(3600000);await assert.rejects(f.oauth.ready(actor,selected),{status:409});assert.equal(f.store.oauthTarget(actor,f.id).requiresConnection,true);assert.equal(f.store.oauthTarget(actor,f.id).setupRequired,false);assert.equal(f.oauth.configuration(actor,f.id).clientId,'123456789012345');
});
