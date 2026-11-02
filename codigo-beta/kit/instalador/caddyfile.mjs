#!/usr/bin/env node
// Gera o Caddyfile da Ratoeira. O Caddy põe HTTPS (Let's Encrypt, renovado sozinho) no endereço do portal e no dos
// Publicados e leva tudo pro gateway, que só escuta em 127.0.0.1. O gateway separa portal e Publicados pelo nome
// (Host), que o Caddy repassa como veio; o IP de quem acessa vai no X-Real-IP, que o Caddy escreve com o endereço da
// conexão (o que vier de fora nesse cabeçalho é trocado).
//   node caddyfile.mjs --endereco srvNNNN.hstgr.cloud --porta 6768 [--publicados apps.1-2-3-4.sslip.io] [--antigo nome]
// --antigo (receita "endereco", quando a pessoa troca pro domínio dela): o endereço de antes segue com HTTPS e leva
// pro novo, pra link salvo e app no celular não quebrarem.
// Domínio próprio de um item dos Publicados ainda não entra aqui (precisa do on_demand_tls com a lista do gateway).
const args=process.argv.slice(2);
const opcao=nome=>{const i=args.indexOf(nome);return i>=0?args[i+1]:undefined;};
const HOST=/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/;
const endereco=opcao('--endereco'),publicados=opcao('--publicados'),antigo=opcao('--antigo'),porta=Number(opcao('--porta')??6768);
if(!HOST.test(endereco??''))throw new Error(`--endereco inválido: ${endereco}`);
if(publicados!==undefined&&!HOST.test(publicados))throw new Error(`--publicados inválido: ${publicados}`);
if(antigo!==undefined&&(!HOST.test(antigo)||antigo===endereco||antigo===publicados))throw new Error(`--antigo inválido: ${antigo}`);
if(!Number.isInteger(porta)||porta<1024||porta>65535)throw new Error('--porta inválida');
const nomes=[endereco,publicados].filter(Boolean).join(', ');
process.stdout.write(`# Gerado pelo instalador da Ratoeira (kit/instalador/caddyfile.mjs). Rodar o instalador de novo reescreve.
# Portal${publicados?' e Publicados':''}: HTTPS automático, tudo pro gateway em 127.0.0.1:${porta}.
{
\t# HTTP/1.1 e HTTP/2 (sem HTTP/3, que pede a 443/udp aberta)
\tservers {
\t\tprotocols h1 h2
\t}
}

${nomes} {
\treverse_proxy 127.0.0.1:${porta} {
\t\t# o IP de quem acessa, que o gateway lê (ipHeader); o Host segue como veio, pra ele separar portal e Publicados
\t\theader_up X-Real-IP {remote_host}
\t}
}
${antigo?`
# Endereço antigo da Ratoeira: leva pro novo, com o mesmo caminho
${antigo} {
\tredir https://${endereco}{uri} permanent
}
`:''}`);
