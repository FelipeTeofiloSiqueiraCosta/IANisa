// Atualizações da Ratoeira (só nas instalações; kit/instalador/atualizar). O gateway lê o estado que o
// atualizador grava (/var/lib/ratoeira/core/atualizacao.json) e o resultado do último pedido, e grava o pedido de
// um admin (<pedidos>/pedido.json: verificar, aplicar, voltar ou conectar) antes de ligar o ratoeira-atualizar.service sem
// esperar: a atualização reinicia o próprio gateway no meio. Como no core.mjs, o estado sai do disco, não da
// memória, e sobrevive ao gateway reiniciar.
// Sem "atualizar" na config (a nossa instância), o módulo nem é montado e nada disso aparece.
import {readFile,writeFile,rename,mkdir,unlink,stat} from 'node:fs/promises';
import path from 'node:path';
import {problem} from './catalog.mjs';

export const ACOES=['verificar','aplicar','voltar','conectar'];
export const VERSAO=/^\d+\.\d+\.\d+$/;
// um pedido sem resultado há mais que isso é de um atualizador que morreu: deixa pedir de novo
const VENCE_PEDIDO=30*60e3;
const LOG=80;

export function createAtualizacoes({estadoArquivo,pedidosDir,ligar,log=m=>console.log(m),agora=()=>Date.now()}){
  const lerJson=async arq=>{try{return JSON.parse(await readFile(arq,'utf8'));}catch{return null;}};
  const arqPedido=path.join(pedidosDir,'pedido.json'),arqResultado=path.join(pedidosDir,'resultado.json');
  async function pedidoAberto(){
    try{
      const s=await stat(arqPedido);
      if(agora()-s.mtimeMs>=VENCE_PEDIDO)return null;
      const p=await lerJson(arqPedido)??{};
      return {acao:ACOES.includes(p.acao)?p.acao:null,versao:typeof p.versao==='string'?p.versao:null,por:typeof p.por==='string'?p.por:null,desde:s.mtime.toISOString()};
    }catch{return null;}
  }
  const tentativa=u=>u&&typeof u==='object'?{ok:Boolean(u.ok),acao:u.acao??null,versao:u.versao??null,em:u.em??null,por:u.por??null,erro:u.erro??null,nada:Boolean(u.nada),
    log:Array.isArray(u.log)?u.log.slice(-LOG).map(String):[]}:null;
  const texto=(v,n)=>typeof v==='string'?v.slice(0,n):null;
  const conexaoDe=c=>c&&typeof c==='object'?{estado:texto(c.estado,20),email:texto(c.email,254),codigo:texto(c.codigo,9),
    url:typeof c.url==='string'&&/^https:\/\/[^\s"<>]+$/.test(c.url)?c.url.slice(0,300):null,expiraEm:c.expiraEm??null}:null;
  const versaoDe=v=>v&&typeof v==='object'?{versao:v.versao??null,em:v.em??null,por:v.por??null,commit:v.commit??null}:null;
  return {
    async estado(){
      const e=await lerJson(estadoArquivo)??{};
      const d=e.disponivel&&typeof e.disponivel==='object'?e.disponivel:null;
      return {
        noAr:versaoDe(e.noAr),anterior:versaoDe(e.anterior),canal:typeof e.canal==='string'?e.canal:null,verificadoEm:e.verificadoEm??null,
        disponivel:d?{versao:d.versao??null,nova:Boolean(d.nova),
          mudancas:(Array.isArray(d.mudancas)?d.mudancas:[]).slice(0,10).map(m=>({versao:String(m?.versao??''),titulo:String(m?.titulo??''),texto:String(m?.texto??'').slice(0,20000)}))}:null,
        ultima:tentativa(e.ultima),
        // a conta da plataforma ligada a esta Ratoeira e se ela libera versão nova (Comunidade ativa)
        conexao:conexaoDe(e.conexao),
        licenca:e.licenca&&typeof e.licenca==='object'?{ok:e.licenca.ok===false?false:Boolean(e.licenca.ok),motivo:texto(e.licenca.motivo,40),mensagem:texto(e.licenca.mensagem,400),em:e.licenca.em??null}:null,
        // o último pedido do gateway (inclui "verificar", que não entra em "ultima")
        resultado:tentativa(await lerJson(arqResultado)),
        pedido:await pedidoAberto(),
      };
    },
    async pedir({acao,versao}={},por){
      if(!ACOES.includes(acao))throw problem(400,`Ação inválida: use ${ACOES.join(', ')}.`);
      if(versao!==undefined&&versao!==null&&versao!==''){
        if(typeof versao!=='string'||!VERSAO.test(versao))throw problem(400,'Versão inválida (o formato é 1.2.3).');
        if(acao!=='aplicar')throw problem(400,'Versão só vale pra "aplicar".');
      }else versao=null;
      const aberto=await pedidoAberto();
      if(aberto)throw problem(409,`Já tem um pedido rodando (${aberto.acao??'?'}, desde ${aberto.desde}). Espera terminar.`);
      await mkdir(pedidosDir,{recursive:true,mode:0o750});
      await unlink(arqResultado).catch(()=>{});
      const pedido={acao,...(versao?{versao}:{}),por:String(por??'').slice(0,200),em:new Date(agora()).toISOString()};
      await writeFile(arqPedido+'.tmp',JSON.stringify(pedido)+'\n',{mode:0o640});
      await rename(arqPedido+'.tmp',arqPedido);
      log(`atualizar: ${acao}${versao?' '+versao:''} pedido por ${pedido.por}`);
      try{await ligar();}
      catch(e){await unlink(arqPedido).catch(()=>{});throw problem(502,`Não consegui ligar o ratoeira-atualizar.service (${e.message}). A regra do polkit e a unit estão instaladas?`);}
      return {estado:'pedido',acao,versao};
    },
  };
}
