# assets/briefings/

Aqui ficam os briefings salvos da marca do aluno. Cada arquivo `.json` representa uma configuração reutilizável.

## Como funciona

1. Aluno passa pelo briefing completo (8 perguntas) **uma vez**
2. Pede `salva config` no chat
3. A skill imprime um bloco JSON que ele cola num arquivo aqui (ex: `minha-marca.json`)
4. Nos próximos chats, ele escreve `usa config minha-marca` e a skill pula o briefing

## Estrutura

Ver `exemplo-marca.json` pra schema completo.

Campos obrigatórios:
- `marca`, `handle`, `nicho`, `cor_primaria`, `estilo`, `cta_default`, `engine_default`

Campos opcionais:
- `template_base` (caminho pro PNG/JPG se usa engine D)
- `hashtags_fixas` (sempre incluídas em toda caption)
- `expressoes_assinatura` (frases da marca, reforça voz)
- `expressoes_proibidas` (frases que a marca nunca usa)

## Várias marcas

Aluno que gerencia vários perfis salva 1 JSON por marca:
- `oscar-pessoal.json`
- `zapvoice-b2b.json`
- `cliente-imobiliaria.json`

E escolhe no briefing: `usa config zapvoice-b2b`.
