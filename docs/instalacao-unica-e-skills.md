# Uma empresa por instalação

A IANiza é entregue para a pessoa instalar na própria VPS. Cada instalação possui uma empresa, seus usuários convidados, seu cérebro, suas skills e suas conexões. Não há registro público de novas empresas nem alternância entre organizações.

O primeiro acesso cria a empresa e o administrador. Depois disso, o ingresso de outras pessoas é por convite para a mesma empresa. Além da verificação na aplicação, um índice único no banco de acesso impede inserir uma segunda empresa.

Os campos `organization` e `org_id` dos bancos e das sessões anteriores continuam como identificadores internos de compatibilidade. Isso preserva login, histórico, anexos e tokens. Não significam que o produto oferece várias organizações. Uma nova VPS usa seu próprio diretório de dados e a própria autenticação dos CLIs.

## Skills que acompanham o projeto

Os pacotes reutilizáveis foram copiados, com os arquivos completos, da pasta indicada pelo usuário para `server/skills-defaults/`:

- Extrator de marca.
- Texto humano.
- Benchmark de mercado.
- Carrossel modular, incluindo os três templates de imagem.
- Criativos estáticos que convertem.

Essa pasta faz parte da distribuição do projeto. Não depende do UUID da empresa que criou a instalação atual. `minha-marca` contém as informações da entrevista da empresa e continua nos dados privados; não acompanha o código distribuído.

No primeiro uso do catálogo, cada pacote padrão é copiado para `<IANIZA_DATA_DIR>/skills/<nome>/`, usando permissões privadas. O catálogo fica em `skills.sqlite`. Os padrões passam pelas mesmas validações de arquivos usadas no importador; scripts continuam como referência, sem execução.

## Edição, exclusão e atualizações

Administradores podem editar nome de exibição, descrição e instruções pelo perfil, em **Skills → Editar**. O identificador interno é preservado para manter as referências do histórico. Templates e arquivos auxiliares são conservados. A edição exige a versão atual para evitar sobrescrever alterações feitas em outra tela; há cópia privada da versão anterior em `skill-trash/`.

**Excluir** retira a skill do catálogo e a move para **Excluídas**, com recuperação explícita por **Restaurar**. Ela deixa de poder ser selecionada ou usada em novas mensagens. As conversas anteriores permanecem intactas. Não há exclusão definitiva pela interface.

A tabela `skill_default_seeds` registra quais padrões já foram fornecidos. Reiniciar ou atualizar o projeto não sobrescreve uma edição nem recria uma skill excluída. Se uma versão futura trouxer um padrão com nome novo, ele poderá ser fornecido uma única vez. Edições em uma VPS não alteram os modelos distribuídos para outras instalações.

O limite de 100 MB considera catálogo, lixeira e versões anteriores, evitando crescimento ilimitado do armazenamento. Há até 40 pacotes no catálogo. Uma skill gerada pelo cérebro é atualizada no próprio cérebro, onde ficam os dados e suas versões.

## Migração da instalação atual

Os pacotes existentes em `organizations/<id>/.claude/skills/` são copiados para `skills/`, sem apagar a pasta original. Skills já importadas que agora são padrão mantêm o ID, o texto, as imagens e as preferências de ativação. Elas passam a aparecer como **Padrão do projeto**. Os dois padrões antigos também conservam sua ativação.

A pasta legada do cérebro e os UUIDs dos outros bancos são preservados por compatibilidade. O catálogo aceita somente a empresa à qual esta instalação está vinculada; não mistura dados de bancos copiados parcialmente de outras instalações.

## Distribuição e backup

Entregue o código e `server/skills-defaults/`. Não distribua `.data/`, `.env`, chaves, tokens ou a autenticação dos CLIs da instalação de desenvolvimento. Uma instalação nova cria seus próprios dados e recebe os pacotes padrão automaticamente.

Na VPS, `IANIZA_DATA_DIR` deve apontar para armazenamento persistente do usuário de serviço, por exemplo `/var/lib/ianiza`. Para atualizar uma instalação existente, preserve esse diretório. Faça backup completo dos bancos, `skills/`, `skill-trash/`, anexos, pasta legada e `.connector-key`; a chave deve acompanhar o banco de conectores.

Os testes verificam instalações novas com UUIDs diferentes, migração sem perda de IDs ou texto, persistência de edições e exclusões, restauração, manutenção dos templates, bloqueio de alterações concorrentes, permissões e a restrição de uma empresa no banco de acesso.
