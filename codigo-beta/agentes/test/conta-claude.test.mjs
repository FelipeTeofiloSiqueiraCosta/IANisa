// kit/multiusuario/conta-claude: qual conta do Claude o servidor de agentes e as rotinas recebem.
// Roda o script de verdade com as contas numa pasta de teste (CONTA_CLAUDE_*) e lê o token que sai.
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,chmodSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const SCRIPT=fileURLToPath(new URL('../../kit/multiusuario/conta-claude',import.meta.url));
const TK=n=>'sk-ant-oat01-'+String(n).padEnd(24,'x');

function cenario({org=[],pessoais=[],legado=false,propria=false,escolha=null,semLer=[]}={}){
  const raiz=mkdtempSync(path.join(tmpdir(),'conta-claude-'));
  const home=path.join(raiz,'home'),dirOrg=path.join(raiz,'org'),pess=path.join(home,'.config','ratoeira','claude-contas');
  mkdirSync(dirOrg,{recursive:true});mkdirSync(pess,{recursive:true});
  const lista=(dir,ids)=>{writeFileSync(path.join(dir,'contas.tsv'),ids.map(id=>`${id}\tConta ${id}\n`).join(''));for(const id of ids)writeFileSync(path.join(dir,id+'.token'),TK(id));};
  lista(dirOrg,org);lista(pess,pessoais);
  for(const id of semLer)chmodSync(path.join(dirOrg,id+'.token'),0o000);   // sem permissão de leitura (ACL não dá)
  if(legado)writeFileSync(path.join(raiz,'geral.token'),TK('legado'));
  if(propria){mkdirSync(path.join(home,'.claude'),{recursive:true});writeFileSync(path.join(home,'.claude','.credentials.json'),'{"claudeAiOauth":{}}');}
  if(escolha)writeFileSync(path.join(home,'.config','ratoeira','claude-conta'),escolha);
  return grupos=>{
    const saida=execFileSync('sh',[SCRIPT,'sh','-c','printf %s "${CLAUDE_CODE_OAUTH_TOKEN-nenhum}"'],{encoding:'utf8',
      env:{PATH:process.env.PATH,HOME:home,CLAUDE_CODE_OAUTH_TOKEN:'herdado',CONTA_CLAUDE_GRUPOS:grupos,CONTA_CLAUDE_ORG:dirOrg,CONTA_CLAUDE_GERAL:path.join(raiz,'geral.token')}});
    return saida==='nenhum'?null:saida.replace('sk-ant-oat01-','').replace(/x+$/,'');
  };
}
const GERAL='ratoeira-claude ratoeira-claude-geral',OPC='ratoeira-claude',PROPRIA='outro';

test('sem escolha: geral usa a primeira da organização que consegue ler; opcional prefere a própria',()=>{
  assert.equal(cenario({org:['a','b']})(GERAL),'a');
  assert.equal(cenario({org:['a','b'],semLer:['a']})(GERAL),'b');
  assert.equal(cenario({org:['a'],propria:true})(GERAL),'a');                 // geral fixa: a própria não passa na frente
  assert.equal(cenario({org:['a'],propria:true})(OPC),null);                  // login próprio: sem token no ambiente
  assert.equal(cenario({org:['a']})(OPC),'a');
  assert.equal(cenario({org:['a'],pessoais:['p']})(OPC),'p');                 // pessoal antes da organização
  assert.equal(cenario({org:['a']})(PROPRIA),null);                          // modo própria nunca usa a da organização
  assert.equal(cenario({pessoais:['p']})(PROPRIA),'p');
  assert.equal(cenario({legado:true})(GERAL),'legado');                       // o arquivo antigo, até o root migrar
});

test('escolha gravada vale enquanto puder; senão cai na regra de sempre',()=>{
  assert.equal(cenario({org:['a','b'],escolha:'org:b'})(OPC),'b');
  assert.equal(cenario({org:['a','b'],propria:true,escolha:'org:b'})(OPC),'b');
  assert.equal(cenario({org:['a'],pessoais:['p'],escolha:'pessoal:p'})(OPC),'p');
  assert.equal(cenario({org:['a'],propria:true,escolha:'propria'})(OPC),null);
  assert.equal(cenario({org:['a','b'],semLer:['b'],escolha:'org:b'})(OPC),'a');   // tiraram o acesso: volta pra regra
  assert.equal(cenario({org:['a'],escolha:'org:a'})(PROPRIA),null);                // modo própria não usa a da organização
  assert.equal(cenario({org:['a'],pessoais:['p'],escolha:'pessoal:p'})(GERAL),'a'); // geral fixa: só organização
  assert.equal(cenario({org:['a'],escolha:'org:../a'})(OPC),'a');                  // id torto é ignorado
  assert.equal(cenario({org:['a'],escolha:'propria'})(OPC),'a');                   // escolheu a própria, mas saiu do login
});

test('conta pessoal com login completo vai como CLAUDE_CONFIG_DIR e ganha do token',()=>{
  const raiz=mkdtempSync(path.join(tmpdir(),'conta-claude-'));
  const home=path.join(raiz,'home'),pess=path.join(home,'.config','ratoeira','claude-contas');
  mkdirSync(pess,{recursive:true});
  writeFileSync(path.join(pess,'contas.tsv'),'velha\tVelha\nnova\tNova\n');
  writeFileSync(path.join(pess,'velha.token'),TK('velha'));
  mkdirSync(path.join(pess,'nova'));writeFileSync(path.join(pess,'nova','.credentials.json'),'{"claudeAiOauth":{}}');
  writeFileSync(path.join(pess,'velha.token'),TK('velha'));
  const rodar=(escolha,grupos=OPC)=>{
    if(escolha)writeFileSync(path.join(home,'.config','ratoeira','claude-conta'),escolha);
    return execFileSync('sh',[SCRIPT,'sh','-c','printf "%s|%s" "${CLAUDE_CODE_OAUTH_TOKEN-nenhum}" "${CLAUDE_CONFIG_DIR-nenhum}"'],{encoding:'utf8',
      env:{PATH:process.env.PATH,HOME:home,CLAUDE_CODE_OAUTH_TOKEN:'herdado',CLAUDE_CONFIG_DIR:'/herdado',CONTA_CLAUDE_GRUPOS:grupos,CONTA_CLAUDE_ORG:path.join(raiz,'org'),CONTA_CLAUDE_GERAL:path.join(raiz,'geral.token')}});
  };
  assert.equal(rodar(null),TK('velha')+'|nenhum');                         // sem escolha: a primeira da lista, token
  assert.equal(rodar('pessoal:nova'),'nenhum|'+path.join(pess,'nova'));   // login completo: pasta, sem token
  assert.equal(rodar('pessoal:velha'),TK('velha')+'|nenhum');             // a do jeito antigo segue com token
  writeFileSync(path.join(pess,'contas.tsv'),'nova\tNova\nvelha\tVelha\n');
  assert.equal(rodar('pessoal:sumiu'),'nenhum|'+path.join(pess,'nova'));  // escolha que não vale: primeira, completa
  mkdirSync(path.join(home,'.claude'),{recursive:true});writeFileSync(path.join(home,'.claude','.credentials.json'),'{"claudeAiOauth":{}}');
  assert.equal(rodar('propria'),'nenhum|nenhum');                         // própria: ~/.claude de sempre
});

// Codex (desde 28/10/2026): o conta-claude pergunta ao contas-codex.mjs a pasta da conta padrão e põe no ambiente.
test('Codex: a conta padrão vira CODEX_HOME (a própria não põe nada) e o atalho antigo pra geral sai',async()=>{
  const {readlinkSync,existsSync,symlinkSync,readFileSync}=await import('node:fs');
  const raiz=mkdtempSync(path.join(tmpdir(),'conta-codex-'));
  const home=path.join(raiz,'home'),org=path.join(raiz,'org'),geral=path.join(raiz,'geral.json');
  const login='{"tokens":{"refresh_token":"r"}}';
  mkdirSync(path.join(home,'.codex'),{recursive:true});mkdirSync(path.join(org,'o1'),{recursive:true});
  writeFileSync(path.join(org,'contas.tsv'),'o1\tTime\n');writeFileSync(path.join(org,'o1','auth.json'),login);writeFileSync(geral,login);
  const rodar=grupos=>execFileSync('sh',[SCRIPT,'sh','-c','printf "%s|%s" "${CODEX_HOME-nenhum}" "${CODEX_SQLITE_HOME-nenhum}"'],{encoding:'utf8',
    env:{PATH:process.env.PATH,HOME:home,CODEX_HOME:'herdado',CONTA_CLAUDE_GRUPOS:grupos,CONTA_CLAUDE_ORG:path.join(raiz,'sem'),CONTA_CLAUDE_GERAL:path.join(raiz,'sem.token'),
      CONTA_CODEX_ORG:org,CONTA_CODEX_GERAL:geral,CONTA_CODEX_MODULO:fileURLToPath(new URL('../contas-codex.mjs',import.meta.url))}});
  // sem login próprio: a da organização, na pasta dela com o login como atalho
  const [dir,sqlite]=rodar('ratoeira-codex').split('|');
  assert.equal(dir,path.join(home,'.config','ratoeira','codex-contas','org-o1'));assert.equal(sqlite,path.join(home,'.codex'));
  assert.equal(readlinkSync(path.join(dir,'auth.json')),path.join(org,'o1','auth.json'));
  // modo própria: nada da organização, e o herdado não vaza
  assert.equal(rodar('outro'),'nenhum|nenhum');
  // o jeito antigo (auth.json atalho pra geral, a própria guardada ao lado): volta o login da pessoa, que vira a padrão
  symlinkSync(geral,path.join(home,'.codex','auth.json'));writeFileSync(path.join(home,'.codex','auth.json.propria'),login);
  assert.equal(rodar('ratoeira-codex'),'nenhum|nenhum');
  assert.equal(readFileSync(path.join(home,'.codex','auth.json'),'utf8'),login);assert.equal(existsSync(path.join(home,'.codex','auth.json.propria')),false);
});
