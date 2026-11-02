// Cloudflare + alsoLocal: o domínio passa pelo Access, e o túnel SSH segue entrando por localhost.
// É o que o aluno tem depois de ligar o passo opcional de domínio da receita.
import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {generateKeyPair, SignJWT} from 'jose';
import {createAccessVerifier} from '../access.mjs';
import {createGateway} from '../server.mjs';

const pair=await generateKeyPair('RS256');
const issuer='https://aluno.cloudflareaccess.com';
const verify=createAccessVerifier({issuer,audience:'aud-aluno',allowedEmails:['aluno@example.com']},pair.publicKey);
const jwt=await new SignJWT({email:'aluno@example.com'}).setProtectedHeader({alg:'RS256'})
  .setIssuer(issuer).setAudience('aud-aluno').setExpirationTime('2m').sign(pair.privateKey);
const secret='senha-dominio-123';
let visto=null;
const upstream=http.createServer((req,res)=>{visto=req.headers;res.writeHead(200,{'content-type':'text/plain'});res.end('ok');});
await new Promise(r=>upstream.listen(0,'127.0.0.1',r));
const probe=http.createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));
const port=probe.address().port;await new Promise(r=>probe.close(r));

function subir(access){
  const g=createGateway({hostname:'ratoeira.aluno.com',upstreamPort:upstream.address().port,password:secret,verify,access});
  return new Promise(r=>g.listen(port,'127.0.0.1',()=>r(g)));
}
function pedir(path,{host,method='GET',headers={}}){
  return new Promise((ok,erro)=>{const r=http.request({host:'127.0.0.1',port,path,method,agent:false,headers:{host,...headers}},res=>{res.resume();res.on('end',()=>ok(res.statusCode));});r.on('error',erro);r.end();});
}
after(()=>upstream.close());

test('domínio + túnel: localhost entra sem login, o domínio só com o login do Access',async()=>{
  const g=await subir({mode:'cloudflare',alsoLocal:true,port,owner:'aluno@example.com'});
  try{
    visto=null;assert.equal(await pedir('/api/agents',{host:`localhost:${port}`}),200,'túnel SSH');
    assert.equal(visto.host,`localhost:${port}`);assert.equal(visto['x-forwarded-proto'],'http');
    visto=null;assert.equal(await pedir('/api/agents',{host:'ratoeira.aluno.com'}),401,'domínio sem login');assert.equal(visto,null);
    assert.equal(await pedir('/api/agents',{host:'ratoeira.aluno.com',headers:{'cf-access-jwt-assertion':'forjado'}}),401);
    visto=null;assert.equal(await pedir('/api/agents',{host:'ratoeira.aluno.com',headers:{'cf-access-jwt-assertion':jwt}}),200,'domínio com login');
    assert.equal(visto.host,'ratoeira.aluno.com:443');assert.equal(visto['x-forwarded-proto'],'https');
    assert.equal(visto['cf-access-jwt-assertion'],undefined,'o token da Cloudflare não chega no Chat');
    assert.equal(await pedir('/api/agents',{host:'evil.example.com'}),401,'host estranho sem login');
    assert.equal(await pedir('/api/agents',{host:`localhost:${port}`,method:'POST',headers:{origin:'https://evil.example.com','content-type':'application/json'}}),403);
    assert.equal(await pedir('/api/agents',{host:`localhost:${port}`,method:'POST',headers:{origin:`http://localhost:${port}`,'content-type':'application/json'}}),200);
  }finally{g.shutdown();}
});

test('sem alsoLocal, o modo Cloudflare segue fechado pra localhost (instalação antiga)',async()=>{
  const g=await subir(undefined);
  try{
    visto=null;assert.equal(await pedir('/api/agents',{host:`localhost:${port}`}),401);assert.equal(visto,null);
    assert.equal(await pedir('/api/agents',{host:'ratoeira.aluno.com',headers:{'cf-access-jwt-assertion':jwt}}),200);
  }finally{g.shutdown();}
});
