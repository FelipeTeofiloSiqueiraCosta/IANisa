import { readFileSync } from 'node:fs';

// Versão do produto. A fonte é o VERSION da raiz da Ratoeira; o kit/nova-versao.mjs copia o número pro
// package.json do gateway e do servidor de agentes, que vão junto pra produção (o VERSION fica no repo).
// test/versao.test.mjs trava os três iguais e o CHANGELOG com a entrada da versão.
export const VERSAO=JSON.parse(readFileSync(new URL('./package.json',import.meta.url),'utf8')).version;
