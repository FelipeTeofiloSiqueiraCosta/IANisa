# Ratoeira

Portal pra trabalhar com Claude Code e Codex numa VPS, pelo navegador: a **Mesa** (os arquivos da tua pasta de
trabalho, com abas, editor e histórico), o **chat** com os agentes ao lado, o **terminal**, as **aplicações** que
tu cria com o agente, as **rotinas** que rodam sozinhas e um link pra publicar o que precisa sair pra fora.
Cada pessoa do time tem o seu login, o seu usuário Linux e as suas contas de IA.

Feita pela DobraLabs (Ratos de IA). **Versão beta**: o repositório é privado e só quem foi convidado instala.

## O que precisa

- Uma VPS **Ubuntu 24.04** limpa, com acesso de root por SSH. Recomendada: KVM 2 da Hostinger (2 vCPU,
  8 GB de memória, 100 GB de disco), que aguenta umas 5 pessoas. Com 4 GB funciona pra uma pessoa, apertado.
- Uma conta do Claude (Pro ou Max) e, se quiser, do ChatGPT pro Codex. Cada pessoa conecta a sua pela tela.
- Domínio é opcional: a Ratoeira abre no nome que a VPS já tem (na Hostinger, `srvNNNNNNN.hstgr.cloud`), com
  HTTPS.

## Instalar

Quem conduz é o agente do teu computador (Claude Code, com o Ratos OS se tiver): manda pra ele o
[`kit/instalador/RECEITA.md`](kit/instalador/RECEITA.md) e ele faz o passo a passo contigo.

Na mão, na VPS, como root:

```sh
# no beta: a chave de leitura que a equipe da Ratoeira te mandou, copiada pra /root/ratoeira-leitura
chmod 600 /root/ratoeira-leitura && apt-get update && apt-get install -y git
GIT_SSH_COMMAND="ssh -i /root/ratoeira-leitura -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new" \
  git clone --branch beta git@github.com:dobralabs/ratoeira.git /opt/ratoeira/fonte
bash /opt/ratoeira/fonte/instalar.sh --usuario <teu-nome> --chave /root/ratoeira-leitura
```

No fim, o instalador mostra o endereço da tua Ratoeira e um link de primeiro acesso (vale 1 hora) pra criar a
conta de quem administra. Leva uns 15 minutos. Opções: `bash instalar.sh --ajuda`.

## Atualizar

Em **Configurações › Atualizações**, botão Atualizar, ou pede pro agente ("atualiza a Ratoeira"). A versão nova é
montada ao lado da que está no ar, trocada de uma vez e conferida; se não subir, a de antes volta sozinha.
No terminal da VPS: `sudo ratoeira-atualizar estado | verificar | aplicar | voltar`.

## O que é teu e o que é do núcleo

| | Onde mora | Na atualização |
|---|---|---|
| **Núcleo** (portal, servidor de agentes, scripts de root, texto dos agentes, skills da Ratoeira) | `/opt/ratoeira`, `/usr/local/lib/ratoeira`, `/usr/local/sbin/ratoeira-*`, units `ratoeira-*` | trocado inteiro |
| **Configuração** (endereço, contas, áreas) | `/etc/ratoeira` | migrada, com cópia antes |
| **Teu trabalho** (pasta de trabalho, apps, skills tuas, rotinas) | `/srv/ratoeira/areas/<área>`, a home de cada pessoa | nunca tocado |
| **Dados** (contas, conversas, dados dos apps) | `/var/lib/ratoeira`, a home de cada pessoa | nunca tocados |

Não edita o núcleo, nem com sudo: a próxima atualização desfaz. Pra mudar o jeito de uma skill da Ratoeira,
cria outra com outro nome; pra ter uma tela nova, cria uma aplicação (o agente sabe como).

## Problema ou ideia

Botão **Reportar**, no pé da barra: manda pra equipe da Ratoeira o que tu escreveu, um print da tela e o rastro
de erros, e a gente responde.

## Licença

Software proprietário, em beta fechado. Ver [`LICENSE`](LICENSE). Avisos de terceiros em
[`kit/AVISOS.md`](kit/AVISOS.md).
