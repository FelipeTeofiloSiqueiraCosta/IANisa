// Comando da VPS pro login próprio (modo "senha"). Roda como o usuário do gateway, com a mesma
// config, e grava nas mesmas contas (o gateway percebe a mudança sozinho).
//   node conta.mjs primeiro-acesso [--usuario <u>]    link de 1 h pra criar o admin (só sem admin); com
//                                                       --usuario, o admin já nasce com o ambiente desse usuário
//                                                       Linux (que o instalador criou) em todas as áreas
//   node conta.mjs redefinir <email> [--zerar-2fa]     link de senha nova (porta dos fundos do admin); com
//                                                       --zerar-2fa, desliga a verificação em dois passos junto
//   node conta.mjs zerar-2fa <email>                   desliga a verificação em dois passos (perdeu o celular)
//   node conta.mjs compartilhado <email> sim|nao       liga/desliga o Paseo único pra essa pessoa
//   node conta.mjs ambiente <email> <usuário> [--claude geral|propria|opcional]   tira do Paseo único
//   node conta.mjs listar
//   node conta.mjs tem-admin                           sai 0 se já tem admin ativo, 1 se não (o instalador usa)
//   node conta.mjs cofre < arquivo-com-o-token          conecta o cofre de chaves (1Password); o token vem
//                                                       pela entrada, nunca na linha de comando
//   node conta.mjs cofre remover
//   node conta.mjs boas-vindas <email> zerar          mostra as boas-vindas de novo no próximo acesso (pra testar)
// --compartilhado e "compartilhado" existem só aqui, nunca na tela: o Paseo único roda como um
// usuário com sudo (o dono da instalação).
import path from 'node:path';
import {createContas} from './contas.mjs';
import {carregarConfig} from './config.mjs';
import {testarCofrePadrao} from './portal.mjs';

const config=carregarConfig(process.env.RATOEIRA_CONFIG,{log:()=>{}});
if(config.access?.mode!=='senha'){console.error('Esta Ratoeira não usa login próprio (access.mode não é "senha").');process.exit(process.argv[2]==='tem-admin'?2:1);}
const contas=createContas({dir:config.contasDir??path.join(config.portal.dataDir,'contas'),areas:config.areas??[],socketPattern:config.paseoSocket,pastaPadrao:config.pastaPadrao});
// Endereço que a pessoa abre: o público, ou o do túnel SSH quando é só local.
const base=config.hostname&&!/^localhost(:|$)/.test(config.hostname)?`https://${config.hostname}`:`http://localhost:${config.port}`;
const [cmd,...args]=process.argv.slice(2);
try{
  if(cmd==='primeiro-acesso'){
    const iu=args.indexOf('--usuario');
    let ambiente=args.includes('--compartilhado')?{tipo:'compartilhado'}:null;
    if(iu>=0){
      const user=args[iu+1]??'';
      if(!/^[a-z_][a-z0-9_-]{0,31}$/.test(user))throw new Error('Usuário Linux inválido: letras minúsculas, números, - e _, começando com letra.');
      const ids=contas.areas().map(a=>a.id);
      ambiente={tipo:'proprio',user,areas:ids,claude:config.claudePadrao??'propria',codex:config.codexPadrao??'propria',
        repoDir:ids.length?contas.areas()[0].caminho:(config.pastaPadrao??'/home/{user}/trabalho').replaceAll('{user}',user)};
    }
    const token=await contas.primeiroAcesso({ambiente});
    console.log(`Abra em até 1 hora pra criar a conta de administrador:\n${base}/_ratoeira/link/${token}`);
  }else if(cmd==='redefinir'&&args[0]){
    const r=await contas.gerarLink(args[0].toLowerCase(),{zerarDois:args.includes('--zerar-2fa')});
    console.log(`Link de ${r.tipo==='convite'?'convite':'senha nova'} (vale até ${new Date(r.expira).toLocaleString('pt-BR')}):\n${base}/_ratoeira/link/${r.token}`);
  }else if(cmd==='zerar-2fa'&&args[0]){
    const r=await contas.zerarDois(args[0].toLowerCase());
    console.log(r.zerado?`${r.pessoa.email}: verificação em dois passos desligada. Na próxima entrada, a senha basta${contas.seguranca().exigirDois?' (e a Ratoeira pede pra configurar de novo)':''}.`:`${r.pessoa.email} não tinha verificação em dois passos.`);
  }else if(cmd==='compartilhado'&&args[0]&&['sim','nao'].includes(args[1])){
    const p=await contas.compartilhado(args[0].toLowerCase(),args[1]==='sim');
    console.log(`${p.email}: ${p.ambiente?.tipo==='compartilhado'?'usa':'não usa'} o Paseo único.`);
  }else if(cmd==='ambiente'&&args[0]&&args[1]){
    // o usuário Linux já tem que existir (adicionar-pessoa); o gateway aplica grupos e git ao religar
    const i=args.indexOf('--claude');
    const p=await contas.definirAmbiente(args[0].toLowerCase(),{user:args[1],claude:i>=0?args[i+1]:'propria'});
    console.log(`${p.email}: ambiente ${p.ambiente.user}, pasta ${p.ambiente.repoDir}, Claude ${p.ambiente.claude}. Reinicie o gateway pra aplicar.`);
  }else if(cmd==='cofre'&&args[0]==='remover'){
    await contas.removerCofre();console.log('Cofre desconectado. Reinicie o gateway pra aplicar.');
  }else if(cmd==='cofre'&&!args.length){
    // o token chega pela entrada (arquivo ou pipe): na linha de comando ele ficaria no histórico e no ps
    let token='';for await(const c of process.stdin)token+=c;
    token=token.trim().replace(/^OP_SERVICE_ACCOUNT_TOKEN=/,'').replace(/^(['"])(.*)\1$/,'$2');
    const info=await testarCofrePadrao(token,{op:config.portal?.cli?.op??config.cli?.op??'op'});
    const c=await contas.definirCofre(token,info);
    console.log(`Cofre conectado${c.conta?' a '+c.conta:''}. Vaults: ${c.vaults.join(', ')||'nenhum'}. Reinicie o gateway pra aplicar.`);
  }else if(cmd==='tem-admin'){
    const tem=(await contas.listar()).some(p=>p.papel==='admin'&&p.estado==='ativa');
    console.log(tem?'sim':'não');process.exit(tem?0:1);
  }else if(cmd==='boas-vindas'&&args[0]&&args[1]==='zerar'){
    await contas.definirBoasVindas(args[0].toLowerCase(),{acao:'zerar'});
    console.log(`${args[0]}: as boas-vindas aparecem de novo no próximo acesso.`);
  }else if(cmd==='listar'){
    for(const p of await contas.listar())console.log([p.email,p.nome,p.papel,p.estado,p.doisPassos?'2fa':'sem 2fa',p.ambiente?.tipo==='proprio'?'ambiente '+p.ambiente.user:p.ambiente?.tipo==='compartilhado'?'Paseo único':'sem ambiente',Object.entries(p.apps??{}).map(([a,r])=>a+'='+r).join(',')].join('  '));
  }else{
    console.log('Uso: node conta.mjs primeiro-acesso [--usuario <u>] | redefinir <email> [--zerar-2fa] | zerar-2fa <email> | compartilhado <email> sim|nao | ambiente <email> <usuário> [--claude modo] | listar | tem-admin | cofre < token | cofre remover | boas-vindas <email> zerar');
    process.exit(2);
  }
}catch(e){console.error(e.status?e.message:e);process.exit(cmd==='tem-admin'?2:1);}
