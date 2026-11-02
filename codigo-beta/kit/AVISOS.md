# Avisos de terceiros

A Ratoeira é um portal por cima do **Paseo** (https://github.com/getpaseo/paseo), de Mohamed Boudra, licenciado sob Apache 2.0. O texto da licença está em `licencas/paseo-LICENSE.txt`.

- O Paseo em si **não vem neste zip**: o `instalar.sh` instala a versão oficial pelo npm (`@getpaseo/cli`).
- O arquivo `gateway/public/markdown.js` leva `marked` (MIT) e `DOMPurify` (MPL-2.0 ou Apache-2.0); o `gateway/public/terminal.js` leva o `xterm.js` e os addons `fit` e `webgl` (MIT); o `gateway/public/editor.js` leva o CodeMirror 6 (MIT). Os avisos de cada um estão no fim do próprio arquivo.
- A Ratoeira troca nome, ícone e logo na tela do Paseo por CSS e HTML servidos pelo portal (`gateway/public/branding.css`, `gateway/server.mjs`). Os pacotes instalados do Paseo não são alterados, e os avisos de autoria dele continuam na tela.
- "Paseo" é marca do projeto original. A Ratoeira não é um produto oficial do Paseo.
- Fonte Bricolage Grotesque: SIL Open Font License 1.1, texto em `gateway/public/bricolage-OFL.txt`.
- Fontes Geist e Geist Mono (Vercel): SIL Open Font License 1.1, texto em `gateway/public/geist-OFL.txt`.
- O arquivo `gateway/public/screenshot.js` é o `modern-screenshot` (MIT, https://github.com/qq15725/modern-screenshot) sem modificação, usado pelo botão Reportar (desligado no kit).
- Dependências instaladas pelo `npm ci` do gateway: `jose` (MIT), `marked` (MIT) e `web-push` (MPL-2.0, sem modificação, https://github.com/web-push-libs/web-push; o aviso no aparelho usa ela pra mandar o push), com as dependências dela (`http_ece` MIT, `asn1.js` MIT, `jws` MIT, `https-proxy-agent` MIT, `minimist` MIT).
