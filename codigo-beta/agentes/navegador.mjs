// Navegador da Ratoeira de uma pessoa (ratoeira-navegador@<usuário>.service, roda como ela).
// Google Chrome com tela virtual (Xvfb) e o perfil dela no disco, servido pelo Playwright num endereço com um
// código secreto no caminho (ws://127.0.0.1:<porta>/<código>), que só ela lê. O agente conecta com
// `playwright-cli attach --endpoint=...` (o comando ratoeira-navegador entrega o endereço) e a tela ao vivo
// da Ratoeira vai usar o mesmo endereço. Vários clientes ao mesmo tempo, um navegador só, as mesmas abas.
// - Com tela (não headless) e sem as marcas de automação: o Google barra o Chrome headless pelo IP da VPS e
//   deixa este passar (teste de 14/10/2026, IDEIAS.md, "Navegador dos agentes").
// - Só ocupa memória enquanto usam: sem nenhuma conexão por NAVEGADOR_OCIOSO_MIN minutos, fecha e sai.
//   O systemd liga de novo no próximo pedido.
// - Fecha pelo próprio Chrome (Browser.close), que grava cookies e login antes de sair: matar o processo perde
//   o que mudou nos últimos ~30 s.
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

// conexões abertas na porta do servidor (estado 01 = ESTABLISHED, do lado de quem escuta)
export function conexoes(texto, p) {
  const hex = p.toString(16).toUpperCase().padStart(4, '0');
  let n = 0;
  for (const linha of texto.split('\n').slice(1)) {
    const c = linha.trim().split(/\s+/);
    if (c.length > 3 && c[1].endsWith(':' + hex) && c[3] === '01') n++;
  }
  return n;
}

// /opt/ratoeira/agentes é atalho pra pasta da versão: compara os caminhos reais
const principal = () => { try { return import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href; } catch { return false; } };
if (process.argv[1] && principal()) {
  const CASA = os.homedir();
  const DIR = process.env.NAVEGADOR_DIR || process.env.RUNTIME_DIRECTORY || path.join(CASA, '.cache/ratoeira/navegador-run');
  const PERFIL = process.env.NAVEGADOR_PERFIL || path.join(CASA, '.local/share/ratoeira/navegador/perfil');
  const OCIOSO_MS = Number(process.env.NAVEGADOR_OCIOSO_MIN || 10) * 60_000;
  const CHECA_MS = Number(process.env.NAVEGADOR_CHECA_MS || 15_000);
  const LARGURA = 1440, ALTURA = 900;
  // O Playwright é o do playwright-cli (kit/receitas/playwright): cliente e servidor têm que ser da mesma versão
  const PW = process.env.NAVEGADOR_PLAYWRIGHT || '/opt/ratoeira/playwright-cli/node_modules/@playwright/cli/';
  const {chromium} = createRequire(PW)('playwright-core');

  const log = (...a) => console.log(new Date().toISOString(), ...a);
  fs.mkdirSync(DIR, {recursive: true, mode: 0o700});
  fs.mkdirSync(PERFIL, {recursive: true, mode: 0o700});
  const ESTADO = path.join(DIR, 'estado.json');

  // tela virtual: o Xvfb escolhe um número livre e escreve no fd 3
  const xvfb = spawn('Xvfb', ['-displayfd', '3', '-screen', '0', `${LARGURA}x${ALTURA}x24`, '-nolisten', 'tcp'],
    {stdio: ['ignore', 'ignore', 'ignore', 'pipe']});
  const display = await new Promise((ok, falha) => {
    xvfb.once('exit', c => falha(new Error('Xvfb saiu: ' + c)));
    xvfb.stdio[3].once('data', d => ok(':' + String(d).trim()));
  });

  // Chrome que travou deixa a trava do perfil pra trás; com o processo morto, o Chrome segue sozinho
  const servidor = await chromium.launchServer({
    channel: 'chrome', headless: false, _userDataDir: PERFIL, _sharedBrowser: true,
    handleSIGTERM: false, handleSIGINT: false, handleSIGHUP: false,   // quem fecha somos nós, gravando o login
    host: '127.0.0.1', port: 0, wsPath: '/' + crypto.randomBytes(24).toString('base64url'),
    ignoreDefaultArgs: ['--enable-automation'],
    args: ['--disable-blink-features=AutomationControlled', `--window-size=${LARGURA},${ALTURA}`, '--window-position=0,0'],
    env: {...process.env, DISPLAY: display},
  });
  const endpoint = servidor.wsEndpoint();
  const porta = Number(new URL(endpoint).port);
  const tmp = ESTADO + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify({endpoint, pid: process.pid, display, desde: new Date().toISOString()}) + '\n', {mode: 0o600});
  fs.renameSync(tmp, ESTADO);
  log('no ar em', display, 'porta', porta);

  const ler = f => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } };

  let fechando = false;
  async function fechar(motivo) {
    if (fechando) return;
    fechando = true;
    log('fechando:', motivo);
    try {
      const b = await chromium.connect(endpoint, {timeout: 5000});
      const cdp = await b.newBrowserCDPSession();
      await cdp.send('Browser.close').catch(() => {});
    } catch (e) { log('Browser.close falhou:', e.message); }
    await new Promise(ok => { servidor.once('close', ok); setTimeout(ok, 10_000); });
    await servidor.close().catch(() => {});
    xvfb.kill();
    fs.rmSync(ESTADO, {force: true});
    process.exit(0);
  }

  let paradoDesde = Date.now();
  setInterval(() => {
    const n = conexoes(ler('/proc/net/tcp'), porta) + conexoes(ler('/proc/net/tcp6'), porta);
    if (n > 0) paradoDesde = Date.now();
    else if (Date.now() - paradoDesde >= OCIOSO_MS) fechar(`${OCIOSO_MS / 60_000} min sem ninguém conectado`);
  }, CHECA_MS).unref();

  servidor.on('close', () => { if (!fechando) { log('o Chrome fechou sozinho'); xvfb.kill(); fs.rmSync(ESTADO, {force: true}); process.exit(1); } });
  xvfb.on('exit', () => fechar('a tela virtual caiu'));
  for (const s of ['SIGTERM', 'SIGINT']) process.on(s, () => fechar(s));
}
