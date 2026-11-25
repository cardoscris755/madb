# 3. Decisões e motivos

| Tema | Decisão | Motivo / alternativa descartada |
|---|---|---|
| Hospedagem | GitHub Pages, site estático, branch `main`, raiz | Gratuito. Exige que o arquivo principal se chame `index.html` (houve um 404 inicial por nome errado) |
| Nome | MADB | Escolha do usuário |
| MCP | Local, via stdio, no computador do usuário | Pedido do usuário. Não conecta a banco, só grava o arquivo do modelo |
| Escopo do MCP | Modelar e gerar DDL | Escolha do usuário na criação |
| Várias arquiteturas | Áreas de trabalho no site, guardadas no navegador | Pedido do usuário "desde o começo" |
| Núcleo único | `madb-core.js` compartilhado por site e MCP | Evita dois formatos e duas validações que divergem |
| Formato | v2 por ids, campos novos opcionais, aceita o formato antigo por nomes | Compatibilidade com o que já existia e com o JSON do modelo da empresa |
| Referências em restrições | Aceita id, `schema.nome` ou nome | Facilita a escrita por agentes |
| Importação | Valida tudo antes; com erro, não muda nada; erro com caminho e motivo | O normalizador antigo descartava `ref` inválida em silêncio |
| Colar x arquivo | Mesmo resultado (BOM e CRLF tolerados) | Requisito do pedido de integração |
| Integração com o agente | Arquivo local vinculado + sincronização opcional | API com token exigiria servidor; o GitHub Pages é estático. Pasta observada é, na prática, o que foi feito, com o "Recarregar" manual como alternativa |
| Navegadores sem File System Access | "Abrir arquivo…" manual | Firefox e Safari não suportam |
| Gravar no arquivo | Sempre manual, com confirmação se o arquivo mudou | Nunca sobrescrever alterações sem perguntar |
| Conflito | Pergunta com padrão "nova arquitetura" | Guarda as duas versões; menor risco de perda |
| Armazenamento | **Local** (navegador + arquivos). Compartilhar por `.json` | Decisão final do usuário em 25/11: mais seguro. **Login com nuvem (Supabase) foi considerado e descartado**: o modelo ficaria em serviço de terceiros |
| Modelos reais | Nunca no repositório público | O repositório é público; os exemplos são sintéticos |
| Identidade no Git | E-mail `noreply` do GitHub | O e-mail corporativo foi exposto num commit inicial e corrigido (`git commit --amend --reset-author`, `git push --force-with-lease`) |
| Validação do SQL | Parser real do PostgreSQL (`pglast`) além dos testes | Garantir que o DDL é aceito de verdade |
| Pendências de negócio | Não decididas pela ferramenta (ex.: recompra, índice extra) | São decisão do negócio, listadas para o usuário |

## Incidentes e lições
- **Dados "sumindo":** o armazenamento do navegador é por endereço e por navegador. O mesmo site no GitHub Pages, na cópia do claude.ai ou em `file://` são lugares diferentes. A versão nova migra o formato antigo sem perder dados (testado).
- **"Sincronizar sozinho" desmarcava no F5:** a escolha só era gravada junto de outra renderização, e a permissão do arquivo expira ao recarregar. Corrigido: grava na hora e mostra aviso de permissão.
- **Gravação desatualizada em `C:\MADB`:** uma cópia do `index.html` saiu defasada na primeira tentativa. Lição: depois de gravar arquivos no computador do usuário, conferir o conteúdo (tamanho ou `cmp`) antes de dizer que está atualizado.
- **`git push` com "Everything up-to-date":** significa que não há commit novo. Falta o `git commit` (arquivos em verde só estão preparados).
- **MCP não aparecia no Orca:** sessões antigas não recarregam o servidor; abrir sessão nova ou usar `claude --continue`.
