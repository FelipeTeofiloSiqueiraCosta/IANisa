# assets/templates/

Pasta pra **templates base** usados pelo engine D (ver `references/07-templates-visuais.md`).

## Templates de exemplo que vêm na skill

| Arquivo | Estilo | Quando usar |
|---|---|---|
| `template-bege-classico.jpg` | Apple Notes (bege #F5F1E8) | Marca pessoal, conteúdo editorial leve, estilo Samuel Pereira |
| `template-dark-tech.jpg` | Dark tech (navy #0A192F + verde neon) | Perfis B2B SaaS, tech, startups |
| `template-editorial-branco.jpg` | Folha/NYT (branco com linhas finas) | Perfis sérios, jurídico, financeiro, B2B premium |

Pra usar: no briefing, escolha engine D e aponte: *"usa template assets/templates/template-bege-classico.jpg"*.

## O que colocar aqui

PNGs ou JPGs 1080×1350 com a identidade visual fixa do perfil do aluno. Cada template tem:

- Fundo (cor sólida ou textura sutil)
- Elementos fixos (topo: nome do perfil; rodapé: handle)
- **Área central vazia** pra receber título/texto via geração

## Exemplos de nome

- `template-base.jpg` (default da marca)
- `template-tech-dark.jpg` (variação fundo escuro)
- `template-meme.jpg` (variação fundo branco puro)
- `template-cliente-x.jpg` (template de cliente específico)

## Como criar

3 caminhos:

### 1. Canva / Figma (recomendado)

- Cria documento 1080×1350
- Adiciona elementos fixos (topo + rodapé)
- Centro fica vazio
- Exporta como JPG
- Salva aqui

### 2. Foto/imagem própria

- Tira foto do estúdio, mesa, ambiente da marca
- Edita pra deixar centro com bom contraste pra texto
- Exporta 1080×1350 JPG

### 3. Geração via IA (uma vez)

```bash
uv run ~/.claude/skills/carrossel-modular/scripts/generate_image_nano_banana.py \
  --prompt "Template 1080x1350 vertical, fundo cor sólida [HEX], \
  topo com texto '[NOME PERFIL]' em fonte sem-serifa pequena discreta, \
  rodapé com '@[handle]' alinhado à esquerda. \
  Centro 100% vazio, pronto pra receber título. \
  Estilo Apple Notes minimalista. Sem outros elementos. Sem texto no centro." \
  --filename "template-base.jpg" \
  --resolution 4K
```

Resultado vai pro diretório atual — move pra cá.

## Tamanho da pasta

Mantenha enxuta. 3-5 templates é suficiente. Se passou disso, provavelmente você criou variações demais — consolida.

## Versionamento

Os JPGs/PNGs **podem** entrar no git (são pequenos, 200-500KB cada). Útil pra time poder compartilhar templates.

Se algum cliente exige privacidade visual, adiciona ao `.gitignore`:
```
assets/templates/template-cliente-*.jpg
```
