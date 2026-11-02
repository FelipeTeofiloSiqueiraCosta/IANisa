# Importação de skills: Markdown e ZIP

O envio aceita somente um `.md` ou `.zip`, em bytes, por um endpoint próprio. O navegador não converte imagens em JSON/base64 para o upload. Isso elimina a inconsistência em que uma prévia de 9 MB passava no cliente, mas o servidor rejeitava o corpo JSON maior.

1. Enviar o arquivo.
2. O servidor lê e valida o pacote; a interface mostra a prévia validada.
3. A confirmação instala a skill no catálogo da instalação.

Os arquivos originais do computador permanecem intactos. Uma pasta pode ser compactada em ZIP pelo Finder/Explorador; uma única pasta principal no arquivo é reconhecida. O arquivo avulso de Markdown é normalizado para SKILL.md internamente. O campo `name` admite nomes de exibição como “Criativos Estáticos que Convertem”, convertidos para um identificador estável.

## Limites

- Markdown avulso: 128 KB, UTF-8 e cabeçalho de skill válido.
- ZIP enviado: 24 MB; conteúdo expandido: 24 MB.
- Até 64 arquivos aceitos e 256 entradas totais, incluindo diretórios e metadados.
- Cada texto: 128 KB; todos os textos: 1 MB.
- Cada imagem: 8 MB, até 20 megapixels e 12.000 pixels por lado; os cabeçalhos são lidos sem decodificar pixels. Formatos PNG, JPG/JPEG e WebP, com MIME determinado pela assinatura real.
- Catálogo: até 40 skills no catálogo e 100 MB por instalação, incluindo lixeira e cópias anteriores às edições.
- Até quatro uploads simultâneos no processo, um por pessoa, e dez tentativas por minuto por pessoa.
- Preparações limitadas por instalação e pessoa; expiram em dez minutos.

Os valores em MB são limites binários calculados em bytes no servidor, não valores declarados pelo navegador.

## Proteções implementadas

A autenticação, a permissão de administrador, a origem e o CSRF são verificados antes de ler o upload. O tamanho é limitado durante a leitura. O tipo MIME informado pelo cliente não é usado como prova do formato. O antigo endpoint de importação por JSON foi desativado.

O leitor ZIP é `yauzl`, fixado no lockfile, com nomes estritos, leitura sequencial e validação de tamanhos. A aplicação também limita os bytes expandidos durante a leitura, verifica CRC, recusa expansão excessiva e aplica cotas antes da instalação.

São recusados caminhos absolutos, `..`, backslashes, controles/NUL, nomes duplicados ou colisões de maiúsculas, links simbólicos, arquivos especiais, ZIPs cifrados, compressões não suportadas, ZIPs aninhados e tipos não permitidos. Os caminhos são validados antes de ignorar arquivos ocultos ou remover a pasta principal. Metadados do macOS e arquivos ocultos, incluindo `.env`, não entram na skill nem no contexto do modelo.

O ZIP não é extraído por um comando de shell e seus nomes não são usados para extrair diretamente no sistema de arquivos. Somente os arquivos validados são materializados no destino privado da instalação. O pacote completo é escrito em uma pasta temporária e movido para o destino ao concluir a gravação; falhas anteriores ao commit removem a preparação incompleta. Scripts são referências de texto, guardados sem permissão de execução, e não são executados pelo importador.

A preparação fica em `.data/skill-imports/<UUID>.upload`, com permissão 0600 e sem rota pública. O identificador só pode ser confirmado/cancelado pela pessoa e organização que enviaram. O hash do temporário é conferido novamente na confirmação, e confirmações concorrentes são bloqueadas. Cancelar uma preparação durante a validação impede que ela seja instalada. Reiniciar descarta preparações não confirmadas, preservando o catálogo.

Textos e metadados são guardados em `skills.sqlite`; imagens ficam no diretório privado da skill. A rota de leitura das imagens exige sessão e confere a empresa desta instalação. A interface escapa o conteúdo textual e não renderiza HTML fornecido pela skill.

Na conversa, somente as skills selecionadas entram no contexto. A descoberta automática de skills/comandos locais do Claude é desligada; scripts não são habilitados como ferramentas. Importar uma skill não concede acesso ao terminal, aos arquivos do servidor ou a novos MCPs. As permissões dos conectores continuam independentes e cada chamada exige confirmação.

Esses controles mitigam classes específicas de ataque; não são uma garantia de ausência de vulnerabilidades ou um serviço de antivírus. Atualizações de dependências e configuração da VM continuam parte da operação.

## Verificação

Os testes incluem Zip Slip, links, arquivos proibidos, formatos falsos, corrupção, entradas excessivas, tamanhos falsos, expansão desproporcional, isolamento por pessoa/organização, expiração, cancelamento, adulteração do temporário, limites de requisição e upload real maior que o antigo limite JSON.

Os pacotes fornecidos foram testados pelo fluxo HTTP completo em uma instalação descartável: anúncios estáticos (2 arquivos), carrossel modular (22 arquivos, incluindo três templates) e criativo de impacto (Markdown avulso). Um template foi baixado novamente e comparado byte a byte com o original.

Referências de implementação: [OWASP: File Upload](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html), [documentação do yauzl](https://github.com/thejoshwolfe/yauzl), [isolamento de skills na sessão do Claude](https://code.claude.com/docs/en/cli-reference).
