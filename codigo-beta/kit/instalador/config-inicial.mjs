#!/usr/bin/env node
// Config inicial do gateway numa instalação nova (o instalador grava em /etc/ratoeira/gateway.config.json só se
// ainda não existe; depois a config é da pessoa e só muda por migração, com cópia antes). Escreve na saída padrão.
//   node config-inicial.mjs --endereco srvNNNN.hstgr.cloud --porta 6768 --area trabalho:/srv/ratoeira/areas/trabalho
//        [--reportes-url https://…/reportes/receber/reporte]
// O endereço dos Publicados não mora aqui: é o playground.json do estado do gateway (o instalador grava).
// Login próprio (modo senha), multiusuário (convite cria o usuário Linux), modo confiança, cada pessoa com a sua conta
// do Claude e do Codex. O núcleo vem da fonte do produto e se atualiza pelo atualizador: nenhuma parte publicável
// pelo chat (isso é só da instância onde a Ratoeira é desenvolvida).
import {VERSAO_CONFIG} from '../../gateway/config.mjs';

const args=process.argv.slice(2);
const opcao=nome=>{const i=args.indexOf(nome);return i>=0?args[i+1]:undefined;};
const HOST=/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/;
const endereco=opcao('--endereco'),porta=Number(opcao('--porta')??6768),area=opcao('--area')??'trabalho:/srv/ratoeira/areas/trabalho';
const reportesUrl=opcao('--reportes-url');
if(!HOST.test(endereco??''))throw new Error(`--endereco inválido: ${endereco}`);
const [areaId,areaCaminho]=area.split(':');
if(!/^[a-z][a-z0-9-]{0,30}$/.test(areaId??'')||!/^\/srv\/ratoeira\/areas\/[a-z0-9-]+$/.test(areaCaminho??''))throw new Error(`--area inválida: ${area}`);
if(reportesUrl&&!/^https:\/\/[^\s]+$/.test(reportesUrl))throw new Error('--reportes-url precisa ser https');

const DADOS='/var/lib/ratoeira';
const config={
  versao:VERSAO_CONFIG,
  hostname:endereco,
  port:porta,
  // alsoLocal: a porta dos fundos (ssh -L 6768:127.0.0.1:6768 e abrir http://localhost:6768) segue funcionando
  access:{mode:'senha',alsoLocal:true},
  // o Caddy da frente escreve o X-Real-IP com o endereço da conexão (kit/instalador/caddyfile.mjs)
  ipHeader:'x-real-ip',
  modo:'confianca',
  criaAmbiente:true,
  claudePadrao:'propria',
  codexPadrao:'propria',
  areas:[{id:areaId,caminho:areaCaminho,nome:areaId.charAt(0).toUpperCase()+areaId.slice(1)}],
  agentes:{socket:'/run/ratoeira-agentes-{user}/agentes.sock'},
  automacoes:{},
  publicar:{registro:'/etc/ratoeira/apps.d'},
  core:{fonte:'/opt/ratoeira/fonte',partes:[]},
  // Atualizações (Configurações › Organização › Atualizações e a ferramenta atualizar_ratoeira do agente de um admin):
  // o gateway lê o estado do atualizador e grava o pedido que o ratoeira-atualizar.service atende (kit/instalador/atualizar)
  atualizar:{estado:'/var/lib/ratoeira/core/atualizacao.json',pedidos:`${DADOS}/gateway-estado/atualizar`},
  portal:{
    enabled:true,
    dataDir:`${DADOS}/gateway-estado`,
    // HOME do gateway pros logins da organização (Contas de IA › da organização)
    homeDir:`${DADOS}/claude-home`,
    pagesDir:`${DADOS}/pages`,
    cli:{claude:'/opt/ratoeira/bin/claude',codex:'/opt/ratoeira/bin/codex'},
    repoDir:areaCaminho,
    naoVersionados:true,
    reportes:{
      dir:`${DADOS}/reportes`,
      unidades:['ratoeira-gateway','ratoeira-agentes@{user}'],
      // com a chave do beta, vai pra caixa de entrada da equipe da Ratoeira; o diálogo diz isso antes de enviar
      ...(reportesUrl?{enviar:{url:reportesUrl,chaveArquivo:'/etc/ratoeira/reportes.chave',nome:'a equipe da Ratoeira'}}:{}),
    },
  },
  defaults:{agent:{provider:'claude'}},
};
process.stdout.write(JSON.stringify(config,null,2)+'\n');
