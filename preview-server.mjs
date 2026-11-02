import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAppServer } from './server/http.mjs';
const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 4173);
const origin = process.env.APP_ORIGIN || `http://127.0.0.1:${port}`;
const { server, accounts } = await createAppServer({ root, origin, directory:process.env.IANIZA_DATA_DIR || path.join(root,'.data') });
server.on('error', error => { console.error(`Não foi possível iniciar a IANiza (${error.code}).`); accounts.close(); process.exitCode=1; });
server.listen(port,'127.0.0.1', () => {
  console.log(`IANiza: ${origin}`);
  const link = accounts.createSetupLink();
  if (link) console.log(`Primeiro acesso (válido por 1 hora): ${origin}/primeiro-acesso#token=${link.token}`);
});
for (const signal of ['SIGINT','SIGTERM']) process.on(signal, () => server.close(() => { accounts.close(); process.exit(0); }));
