import {randomBytes,randomUUID} from 'node:crypto';
import {auth} from '@modelcontextprotocol/sdk/client/auth.js';
import {problem} from './accounts.mjs';
import {HIGGSFIELD,META_ADS,oauthConnector} from './connector-defaults.mjs';

// OAuth somente para provedores oficiais reconhecidos; não aceita destinos arbitrários.
export function createConnectorOAuth({origin,store,authenticate=auth,fetcher=fetch,now=Date.now}) {
 const flows=new Map(),refreshing=new Map(),owner=a=>a.organization.id+':'+a.user.id;
 const callback=origin+'/api/connector-oauth/callback';
 function purge(){for(const [id,f] of flows)if(f.expiresAt<=now()){f.verifier=null;f.credentials=null;flows.delete(id);}}
 const cleanup=setInterval(purge,60000);cleanup.unref?.();
 function publicFlow(f){return {id:f.id,connectorId:f.connectorId,provider:f.definition.key,name:f.definition.name,stage:f.stage,...(f.stage==='authorize'?{url:f.url}:{}),message:f.message};}
 function get(actor,id){purge();const f=flows.get(id);if(!f||f.owner!==owner(actor))throw problem(404,'A conexão expirou. Inicie uma nova tentativa na área de Conectores.');return publicFlow(f);}
 function provider(actor,id,context){
  const credentials=context.credentials,definition=context.definition;
  return {
   redirectUrl:callback,
   clientMetadata:{client_name:'IANiza',redirect_uris:[callback],grant_types:['authorization_code','refresh_token'],response_types:['code'],token_endpoint_auth_method:'none',scope:definition.scope},
   state:()=>context.state,
   clientInformation:()=>credentials.clientInformation,
   saveClientInformation:value=>{credentials.clientInformation=value;},
   tokens:()=>credentials.tokens,
   saveTokens:value=>{credentials.tokens={...value,refresh_token:value.refresh_token||credentials.tokens?.refresh_token};credentials.expiresAt=value.expires_in?now()+value.expires_in*1000:null;},
   saveCodeVerifier:value=>{context.verifier=value;},
   codeVerifier:()=>{if(!context.verifier)throw problem(409,'A autorização expirou. Inicie a conexão novamente.');return context.verifier;},
   redirectToAuthorization:url=>{if(!context.interactive)throw problem(409,'Reconecte sua conta de '+definition.name+' na área de Conectores.');if(url.origin!==definition.authorizationOrigin)throw new Error('Emissor OAuth inesperado.');context.url=url.href;},
   saveDiscoveryState:value=>{if(String(value.authorizationServerUrl).replace(/\/$/,'')!==definition.issuer||value.resourceMetadata?.resource!==definition.url)throw new Error('Metadados OAuth inesperados.');credentials.discovery=value;},
   discoveryState:()=>credentials.discovery,
   invalidateCredentials:scope=>{if(['all','client'].includes(scope))delete credentials.clientInformation;if(['all','tokens'].includes(scope))delete credentials.tokens;if(['all','discovery'].includes(scope))delete credentials.discovery;if(['all','verifier'].includes(scope))context.verifier=null;},
  };
 }
 async function run(actor,id,context,authorizationCode){
  const definition=context.definition,allowed=new Set(definition.allowedOrigins);
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);
  try{return await authenticate(provider(actor,id,context),{serverUrl:definition.url,resourceMetadataUrl:new URL(definition.resourceMetadataUrl),scope:definition.scope,...(authorizationCode?{authorizationCode}:{}),fetchFn:(url,init)=>{
   const parsed=new URL(typeof url==='string'||url instanceof URL?url:url.url);if(!allowed.has(parsed.origin)||parsed.username||parsed.password)throw new Error('Destino OAuth inesperado.');
   return fetcher(url,{...init,redirect:'error',signal:AbortSignal.any([controller.signal,...(init?.signal?[init.signal]:[])])});
  }});}finally{clearTimeout(timer);}
 }
 async function start(actor,id){
  purge();const target=store.oauthTarget(actor,id),definition=oauthConnector(target.builtin);if(!target.enabled)throw problem(409,'Ative '+definition.name+' antes de conectar sua conta.');
  for(const f of flows.values())if(f.org===actor.organization.id&&f.connectorId===id&&['starting','authorize','exchanging'].includes(f.stage)){
   if(f.owner!==owner(actor))throw problem(409,'Outro administrador está conectando este serviço. Aguarde a conclusão.');
   if(f.stage==='authorize')return publicFlow(f);throw problem(409,'A conexão já está sendo preparada. Aguarde um instante.');
  }
  const credentials=store.oauthCredentials(actor,id);if(definition.requiresClientId&&!credentials.clientInformation?.client_id)throw problem(409,'A Meta exige um App ID próprio. Configure o aplicativo Meta antes de iniciar o login.');delete credentials.tokens;delete credentials.expiresAt;if(!definition.requiresClientId&&credentials.redirectUrl&&credentials.redirectUrl!==callback)delete credentials.clientInformation;credentials.redirectUrl=callback;
  const f={id:randomUUID(),connectorId:id,org:actor.organization.id,owner:owner(actor),state:randomBytes(32).toString('base64url'),stage:'starting',definition,credentials,interactive:true,expiresAt:now()+10*60000};flows.set(f.id,f);
  try{const result=await run(actor,id,f);if(result!=='REDIRECT'||!f.url)throw new Error('Autorização não iniciada.');f.stage='authorize';f.message='Entre na sua conta e autorize a IANiza na página oficial de '+definition.name+'.';return publicFlow(f);}
  catch{f.stage='error';f.credentials=null;f.verifier=null;f.message='Não foi possível preparar o login de '+definition.name+'. Confira a configuração do aplicativo e tente novamente.';throw problem(502,f.message);}
 }
 async function complete(actor,params){
  purge();const f=[...flows.values()].find(f=>f.state===params.state);
  if(!f||f.owner!==owner(actor)||f.stage!=='authorize')throw problem(400,'A autorização expirou ou já foi usada. Inicie a conexão novamente.');
  store.oauthTarget(actor,f.connectorId);
  if(params.iss&&params.iss.replace(/\/$/,'')!==f.definition.issuer)throw problem(400,'A origem da autorização não corresponde ao serviço selecionado.');
  f.stage='exchanging';
  try{
   if(params.error)throw new Error('Autorização recusada.');
   if(typeof params.code!=='string'||!params.code||params.code.length>4096)throw new Error('Código ausente.');
   const result=await run(actor,f.connectorId,f,params.code);
   if(result!=='AUTHORIZED'||!f.credentials.tokens?.access_token)throw new Error('Token ausente.');
   store.saveOAuth(actor,f.connectorId,f.credentials);f.stage='complete';f.message='Conta de '+f.definition.name+' conectada. Agora você pode testar as ferramentas ou usar no chat.';return publicFlow(f);
  }catch{f.stage='error';f.message=params.error?'A autorização de '+f.definition.name+' não foi concluída. Você pode tentar novamente.':'Não foi possível concluir a conexão com '+f.definition.name+'. Confira o aplicativo e o endereço de retorno e inicie uma nova tentativa.';throw problem(400,f.message);}
  finally{f.credentials=null;f.verifier=null;f.url=null;}
 }
 function cancel(actor,id){get(actor,id);const saved=flows.get(id);if(saved.stage==='exchanging')throw problem(409,'A autorização já está sendo concluída.');saved.stage='cancelled';saved.credentials=null;saved.verifier=null;saved.url=null;saved.message='Tentativa de conexão cancelada.';return publicFlow(saved);}
 async function ready(actor,connectors){
  for(const selected of connectors){const definition=oauthConnector(selected.builtin);if(!definition||selected.manualAuth)continue;
   const credentials=store.runtimeOAuth.credentials(actor,selected.id);
   if(!credentials.tokens?.access_token)throw problem(409,'Conecte sua conta de '+definition.name+' na área de Conectores.');
   if(credentials.expiresAt&&credentials.expiresAt<=now()+60000){
    const key=actor.organization.id+':'+selected.id;
    if(!refreshing.has(key))refreshing.set(key,Promise.resolve().then(async()=>{
     const previousAccess=credentials.tokens.access_token;
     try{const context={credentials,definition,interactive:false};if(!credentials.tokens.refresh_token||await run(actor,selected.id,context)!=='AUTHORIZED')throw new Error('Renovação não autorizada.');if(store.runtimeOAuth.credentials(actor,selected.id).tokens?.access_token!==previousAccess)throw new Error('A conexão mudou.');store.runtimeOAuth.saveRenewed(actor,selected.id,credentials);}
     catch{if(store.runtimeOAuth.credentials(actor,selected.id).tokens?.access_token===previousAccess)store.runtimeOAuth.invalidate(actor,selected.id);throw problem(409,'Reconecte sua conta de '+definition.name+' na área de Conectores.');}
     finally{refreshing.delete(key);}
    }));
    await refreshing.get(key);
   }
  }
  return store.resolve(actor,connectors.map(c=>c.id));
 }
 function configuration(actor,id){const target=store.oauthTarget(actor,id);if(target.builtin!==META_ADS.key)throw problem(400,'Este conector não precisa de App ID próprio.');const credentials=store.oauthCredentials(actor,id);return {clientId:credentials.clientInformation?.client_id||'',callbackUrl:callback,provider:META_ADS.key};}
 function configure(actor,id,input){configuration(actor,id);const clientId=typeof input.clientId==='string'?input.clientId.trim():'';if(!/^\d{5,40}$/.test(clientId))throw problem(400,'Informe o App ID numérico do aplicativo Meta.');const old=store.oauthCredentials(actor,id);const credentials=old.clientInformation?.client_id===clientId?old:{};credentials.clientInformation={client_id:clientId,issuer:META_ADS.issuer};credentials.redirectUrl=callback;store.saveOAuth(actor,id,credentials);for(const f of flows.values())if(f.org===actor.organization.id&&f.connectorId===id){f.stage='cancelled';f.credentials=null;f.verifier=null;}return configuration(actor,id);}
 function disconnect(actor,id){store.disconnect(actor,id);for(const f of flows.values())if(f.org===actor.organization.id&&f.connectorId===id){f.stage='cancelled';f.credentials=null;f.verifier=null;f.url=null;}return {ok:true};}
 return {start,get,complete,cancel,ready,disconnect,configuration,configure,close(){clearInterval(cleanup);for(const f of flows.values()){f.credentials=null;f.verifier=null;}flows.clear();}};
}
