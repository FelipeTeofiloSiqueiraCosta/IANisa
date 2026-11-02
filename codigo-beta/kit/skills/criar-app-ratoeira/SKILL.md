---
name: criar-app-ratoeira
description: Cria ou muda uma aplicação que roda dentro da Ratoeira (sistema com servidor próprio que abre em aba da Ratoeira, usa o login e os papéis dela e conversa pelo chat dela com ferramentas MCP), seguindo o padrão do APPS.md da Ratoeira. Use quando pedirem "criar um app na Ratoeira", "fazer um sistema/painel/CRM que abra na Ratoeira", "pôr esse app na Ratoeira", "integrar esse app com o chat da Ratoeira", "criar ferramentas MCP pro app", ou quando for mexer em app que já está na Ratoeira. Não usar pra página HTML estática simples nem pra site público.
---

# Criar app na Ratoeira

Esta skill vem com a Ratoeira e é atualizada com ela (não editar: a próxima versão troca). O padrão inteiro está em `/usr/local/lib/ratoeira/APPS.md`. **Leia ele inteiro antes de escrever código** e siga na ordem. Esta skill só diz como usar.

1. Leia `/usr/local/lib/ratoeira/APPS.md`.
2. Antes de codar, confirme com a pessoa: nome do app, o que ele faz, os papéis (quem pode o quê), quais ações saem do app (e-mail, agenda, cobrança) e se ele precisa de chat (ferramentas MCP).
3. Monte o esqueleto do `APPS.md` (README, manifesto, `migracoes/`, `agente/AGENTS.md`) antes do resto. O código do app mora na pasta de trabalho, em `apps/<nome>/`, a não ser que o `AGENTS.md` do repositório diga outro lugar (siga o dele).
4. Construa seguindo as regras de ouro. Na dúvida entre jeitos, escolha o mais simples que cumpre o contrato. Dois pontos que costumam ficar de fora: toda página carrega `/_ratoeira/app.js`, e **toda janela interna** (card, gaveta, formulário) avisa o chat com `ratoeira.tela({detalhe})`, com o id no texto (seção "Tela" do `APPS.md`).
5. Teste local: rode o app com um cabeçalho de identidade gerado por um script de teste (mesmo segredo, HMAC), sem a Ratoeira, e confira o 401 sem ele.
6. "Pôr no ar" é com a ferramenta `publicar_app` do MCP `ratoeira` (seção "Pôr no ar" do `APPS.md`), que vem nas conversas de quem é admin. Não escreva unit, script de subida nem entrada na config do gateway, e não use sudo: deixe o manifesto completo (`preparar`, `iniciar`, `saude`, `pacotes`, `chaves`, `rotinas`), rode os testes, commite e chame `publicar_app` você mesmo; falhou, leia o log que ela devolve, corrija e publique de novo. Sem essa ferramenta (a pessoa não é admin), diga que está pronto e peça pra um admin publicar. Pacote do sistema fora da lista liberada: diga qual e peça pro admin. Chave que falta: peça o valor (ou a referência do cofre), grave em `~/.config/ratoeira/chaves-apps/<nome>.env` sem mostrar na conversa e chame `definir_chaves_app` (`APPS.md`, "Pôr no ar", item 4); sem a ferramenta, peça pro admin.
7. Rode o checklist do fim do `APPS.md` e diga, item por item, o que passou e o que ficou de fora.
8. Só diga que o app está pronto, ou mande a pessoa abrir em Apps, depois que `publicar_app` der ok (confira com `estado_publicacao`). Teste local, com cabeçalho de identidade de mentira ou "imitação da ponte", não é estar no ar: diga o que falta. Quando der ok, o app aparece sozinho no menu Apps quando tua resposta terminar, sem recarregar a página.
9. Não mande a pessoa trocar o próprio papel em Pessoas: quem publicou o app e quem administra a Ratoeira já entram com o primeiro papel da lista. Pessoas é pra dar papel aos outros ou bloquear.

Se já houver um app publicado nesta Ratoeira (a lista vem nas instruções da Ratoeira, "Apps publicados nesta Ratoeira"), leia o código dele como referência de como o padrão fica na prática.
