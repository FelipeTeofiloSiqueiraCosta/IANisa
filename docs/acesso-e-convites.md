# Acesso e convites · primeira implementação

> Atualização de escopo: a entrada atual é login → escritório vazio → perfil, sem sidebar. A gestão visual de convites foi preservada em `apresentacao/referencia/acesso-anterior.js`; as APIs permanecem no backend. O cérebro real está descrito em [Marca e cérebro](marca-e-cerebro.md). As seções de interface de convites abaixo registram a etapa anterior.

## Escopo

O acesso agora é funcional: servidor Node.js, banco SQLite persistente, conta própria por pessoa e permissões conferidas no servidor. Cada instalação atende uma única empresa e o setor de Marketing. Todos os convites pertencem a essa empresa, sem cadastro ou alternância de organizações. Essa é uma decisão do produto, não uma limitação provisória. O escritório, as tarefas e os agentes continuam como demonstração nesta etapa.

O `codigo-beta/` foi apenas consultado. Referências: `gateway/contas.mjs` e `gateway/entrada.mjs` (scrypt, sessão por cookie, primeiro administrador por link e convite de uso único). Não há importação, execução ou modificação daquela pasta.

## Primeiro acesso

1. Use Node.js 24 ou superior e execute `npm run dev`.
2. Na primeira inicialização, abra o link mostrado no terminal, válido por uma hora.
3. Informe empresa, nome, e-mail e uma senha com pelo menos 12 caracteres.
4. A primeira conta recebe o papel de administrador e entra no escritório vazio.

Não há cadastro público nem senha padrão. Cada inicialização sem organização gera outro link e invalida o anterior. Depois de criada a organização, essa rota não permite criar outro primeiro administrador.

## Sessões e senha

- Sem **Manter conectado**: sessão de 12 horas. Com a opção: até 14 dias. Ambas expiram após 24 horas de inatividade.
- A identidade do escritório vem da conta conectada.
- **Minha conta** permite sair e alterar a senha, exigindo a atual. Alterar a senha encerra os outros acessos.
- O servidor confere a sessão em cada requisição protegida. Telas abertas verificam a sessão a cada 30 segundos e ao recuperar foco.
- Sair revoga a sessão no servidor e avisa outras abas pelo BroadcastChannel.

## Pessoas e convites

| Papel | Acesso nesta etapa |
| --- | --- |
| Administrador | Escritório, convites, permissões, desativação/reativação e links para recuperação de senha |
| Membro | Escritório e a própria senha; não lista nem administra contas ou convites |

1. **Convidar pessoa** pede nome, e-mail e papel.
2. O servidor gera um link vinculado ao e-mail, válido por 24 horas e de uso único.
3. O administrador copia e compartilha diretamente. **Envio por e-mail ainda não está configurado.**
4. O destinatário confere empresa e permissão, define nome e senha e entra.
5. Em **Convites**, consulte o estado, gere outro link ou revogue um pendente. Gerar outro invalida o anterior.

O link completo aparece somente na geração e não é recuperável da listagem. Aceite simultâneo não duplica conta. O papel vem do servidor, nunca do formulário. Uma conta conectada diferente exige sair antes do aceite.

Desativar revoga sessões e links de recuperação. Reativar conserva a conta e senha. O administrador não pode remover seu próprio acesso; a organização conserva pelo menos um administrador ativo.

Para recuperar uma senha, um administrador gera um link de uma hora na gestão da pessoa. O uso é único e encerra as sessões anteriores. **Esqueci minha senha** explica esse caminho. Recuperação independente por e-mail, MFA ainda não faz parte desta etapa. Múltiplas organizações não fazem parte do produto; cada empresa instala a própria instância.

## Persistência e proteções

- `.data/access.sqlite`: fora das rotas públicas e ignorado pelo Git. Pasta com modo 0700 e banco com modo 0600; contém organização, contas, sessões, links, limites de tentativa e auditoria básica.
- Transações SQLite para criação, aceite e mudanças de acesso. O servidor lê as permissões atuais a cada operação.
- scrypt por senha com sal aleatório, N=32768, r=8, p=3; comparação constante e hash fictício para e-mail inexistente.
- Tokens aleatórios de 256 bits; somente hashes SHA-256 persistem. Senhas e tokens de autenticação nunca vão para localStorage.
- Cookie HttpOnly, SameSite=Lax, Path=/; Secure e prefixo `__Host-` em HTTPS.
- POST/PATCH exigem origem exata; mutações autenticadas exigem também CSRF derivado da sessão.
- Limites de tentativas por IP/conta, expiração e no máximo duas verificações de senha simultâneas.
- Host validado, CSP, no-store, no-referrer e bloqueio de frames. Lista explícita de arquivos públicos; não entrega `.data`, `.env`, servidor ou código beta.

Referências: [OWASP — senhas](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html) e [OWASP — sessões](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html).

## Desenvolvimento e publicação futura

O servidor escuta em `127.0.0.1:4173`. Convites com esse endereço funcionam na mesma máquina. Para outras máquinas, será necessário publicar com HTTPS e configurar `APP_ORIGIN` com a origem pública. Ela valida Host/Origin e gera links; headers de proxy não são fonte de identidade.

Variáveis: `PORT`, `APP_ORIGIN`, `IANIZA_DATA_DIR`. Veja `.env.example`. Para ler um arquivo de ambiente: `node --env-file=.env preview-server.mjs`. O banco não deve ir para repositórios. Esta persistência usa uma instalação Node com volume durável; escala em várias máquinas e recuperação operacional do proprietário precisam de implementação própria.

Os dados do escritório usam chaves de demonstração por organização e pessoa no navegador. O preview antigo permanece na chave original e não é atribuído à primeira conta. Isso evita misturar exemplos, mas não oferece sincronização ou proteção de dados de marketing entre usuários do mesmo navegador. O backend de marketing vem nas próximas etapas.

## Verificação

`npm test` verifica as regras existentes e o acesso: primeiro administrador único, credenciais inválidas, sessão persistente/expirada, logout, convite expirado/revogado/renovado, aceite simultâneo, papéis, desativação, reativação, recuperação, troca de senha, força bruta, origem, CSRF e arquivos privados. Os testes HTTP precisam abrir uma porta local temporária. A QA usa contas e banco descartáveis fora de `.data`; a instalação principal aguarda as credenciais do usuário.
