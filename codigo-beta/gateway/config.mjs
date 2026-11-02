import { readFileSync, writeFileSync, renameSync, statSync, chmodSync, chownSync, copyFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Configuração do gateway (/etc/ratoeira/gateway.config.json) com número de versão e migração em degraus.
//
// - O gateway nunca escreve a config (é do root): ao subir, aplica na memória os degraus que faltam e avisa no
//   log. Quem grava a config migrada é o atualizador, como root, com cópia antes: `node config.mjs migrar <arquivo>`.
// - Config sem "versao" é a versão 1 (o formato de 12/10/2026). Não roda degrau nenhum nela por engano: é o
//   que mordeu o Hermes (config sem número passava por todos os degraus e perdia escolha do usuário).
// - Config mais nova que o código (voltaram o núcleo depois de migrar): sobe assim mesmo, avisa, e o que não
//   conhece fica ignorado. O atualizador, ao voltar, restaura a cópia de antes da migração.
//
// Degrau novo: acrescentar no fim de MIGRACOES {para, oque, aplicar(cfg)} e subir VERSAO_CONFIG junto.
// aplicar recebe uma cópia e devolve a config do degrau seguinte; não lê disco nem rede.
export const VERSAO_CONFIG=1;
export const MIGRACOES=[];

export function migrar(cfg,migracoes=MIGRACOES,alvo=VERSAO_CONFIG){
  if(!cfg||typeof cfg!=='object'||Array.isArray(cfg))throw new Error('A config do gateway precisa ser um objeto JSON.');
  const de=cfg.versao===undefined?1:cfg.versao;
  if(!Number.isInteger(de)||de<1)throw new Error(`"versao" da config inválida: ${JSON.stringify(cfg.versao)}.`);
  if(de>alvo)return {config:cfg,de,para:de,passos:[],maisNova:true};
  let atual=structuredClone(cfg),versao=de;
  const passos=[];
  for(const m of migracoes){
    if(m.para<=versao)continue;
    if(m.para!==versao+1)throw new Error(`Falta o degrau da config ${versao} → ${versao+1}.`);
    atual=m.aplicar(structuredClone(atual));
    // o número só sobe depois que o degrau passou
    atual.versao=versao=m.para;
    passos.push(`${m.para-1} → ${m.para}: ${m.oque}`);
    if(versao===alvo)break;
  }
  if(versao!==alvo)throw new Error(`A config ficou na versão ${versao}; o código espera ${alvo}.`);
  return {config:atual,de,para:versao,passos,maisNova:false};
}

export function carregarConfig(arquivo,{log=m=>console.log(m),migracoes=MIGRACOES,alvo=VERSAO_CONFIG}={}){
  // Sem reserva de propósito: cair numa config guardada no repositório subiria com a config de outra instalação.
  if(!arquivo)throw new Error('Falta RATOEIRA_CONFIG (o caminho da config do gateway, ex.: /etc/ratoeira/gateway.config.json).');
  let cfg;
  try{cfg=JSON.parse(readFileSync(arquivo,'utf8'));}
  catch(e){throw new Error(`Não consegui ler a config do gateway em ${arquivo}: ${e.message}`);}
  const r=migrar(cfg,migracoes,alvo);
  if(r.maisNova)log(`config na versão ${r.de}, mais nova que a deste código (${alvo}): subindo assim mesmo; o que eu não conheço fica ignorado`);
  else if(r.passos.length)log(`config na versão ${r.de}, migrada na memória pra ${r.para} (${r.passos.join('; ')}). Pra gravar: node config.mjs migrar ${arquivo}`);
  return r.config;
}

// Grava a config migrada no lugar, com cópia ao lado (<arquivo>.antes-v<versão>-<carimbo>), mesmo dono e modo.
export function migrarArquivo(arquivo,{migracoes=MIGRACOES,alvo=VERSAO_CONFIG,agora=new Date()}={}){
  const cfg=JSON.parse(readFileSync(arquivo,'utf8'));
  const r=migrar(cfg,migracoes,alvo);
  if(!r.passos.length)return {...r,copia:null};
  const st=statSync(arquivo);
  const carimbo=agora.toISOString().replace(/[-:]/g,'').replace(/\.\d+Z$/,'Z');
  const copia=`${arquivo}.antes-v${r.de}-${carimbo}`;
  copyFileSync(arquivo,copia);
  const tmp=arquivo+'.migrando';
  writeFileSync(tmp,JSON.stringify(r.config,null,2)+'\n',{mode:st.mode&0o777});
  chmodSync(tmp,st.mode&0o777);
  try{chownSync(tmp,st.uid,st.gid);chownSync(copia,st.uid,st.gid);}catch{}
  renameSync(tmp,arquivo);
  return {...r,copia};
}

// Linha de comando (o atualizador roda como root):
//   node config.mjs conferir <arquivo>   diz a versão e os degraus que faltam (não grava)
//   node config.mjs migrar <arquivo>     grava a config migrada, com cópia ao lado
if(process.argv[1]&&fileURLToPath(import.meta.url)===path.resolve(process.argv[1])){
  const [acao,arquivo]=process.argv.slice(2);
  if(!['conferir','migrar'].includes(acao)||!arquivo){console.error('uso: node config.mjs conferir|migrar <arquivo>');process.exit(2);}
  try{
    if(acao==='conferir'){
      const r=migrar(JSON.parse(readFileSync(arquivo,'utf8')));
      console.log(r.maisNova?`versão ${r.de}, mais nova que este código (${VERSAO_CONFIG})`:r.passos.length?`versão ${r.de}; faltam: ${r.passos.join('; ')}`:`versão ${r.de}, em dia`);
    }else{
      const r=migrarArquivo(arquivo);
      console.log(r.copia?`migrada de ${r.de} pra ${r.para} (${r.passos.join('; ')}); cópia em ${r.copia}`:r.maisNova?`versão ${r.de}, mais nova que este código: não mexi`:`versão ${r.de}, em dia: não mexi`);
    }
  }catch(e){console.error(e.message);process.exit(1);}
}
