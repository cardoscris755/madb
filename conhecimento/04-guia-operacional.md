# 4. Guia operacional

## Publicar uma alteração no site
Na pasta `C:\MADB`:
```
git status
git add -A
git commit -m "mensagem descrevendo a mudança"
git push
```
- Arquivos em verde no `git status` estão só preparados: **falta o commit**. `git push` com "Everything up-to-date" também indica que falta o commit.
- Depois do push, o GitHub Pages leva de 1 a 3 minutos (aba **Actions**, "pages build and deployment"). Abra o site com **Ctrl + F5**.
- Confirmar no GitHub que o arquivo subiu: abra `github.com/cardoscris755/madb/blob/main/index.html` e procure um trecho novo com Ctrl + F.
- Se o push for recusado: `git pull --rebase` e `git push` de novo.
- Sempre subir `index.html` e `madb-core.js` juntos.

## Instalar ou atualizar o MCP
```
cd C:\MADB\mcp
npm install
```
Registro no Claude Code (uma vez só):
```
claude mcp add madb --scope user -- node C:\MADB\mcp\index.js
```
Conferir: `claude mcp get madb` e `claude mcp list`. Se já existir, remova e adicione de novo. Reinicie a sessão (nova sessão ou `claude --continue`) para carregar as ferramentas novas.

Um modelo por projeto: crie um `.mcp.json` na raiz do projeto:
```json
{ "mcpServers": { "madb": { "command": "node",
  "args": ["C:\\MADB\\mcp\\index.js"],
  "env": { "MADB_MODELO": "C:\\caminho\\do\\projeto\\modelo-madb.json" } } } }
```
`madb_caminho_modelo` mostra qual arquivo está em uso. Se o modelo for versionado no Git, use um repositório **privado**.

## Ligar o site ao arquivo do MCP
1. Chrome ou Edge, site aberto.
2. **Vincular arquivo…** e escolher o arquivo do modelo (`C:\Users\<usuário>\.madb\modelo.json` por padrão; a pasta `.madb` pode estar oculta).
3. Marcar **sincronizar sozinho** e deixar a aba aberta e visível.
4. Depois de reiniciar o navegador ou dar F5, se aparecer o aviso de nova permissão, clicar em **Recarregar do arquivo** uma vez.

## Compartilhar e guardar
- **Exportar:** aba JSON → **Baixar .json**. SQL e Mermaid: **Copiar**.
- **Receber:** **Abrir arquivo…** ou arrastar o `.json` para a página; vira uma arquitetura nova, sem mexer nas existentes.
- Cada pessoa tem seus projetos no próprio navegador. Para backup, baixe o `.json` de cada arquitetura.

## Rodar os testes
```
node --test tests/madb.test.js
cd mcp && npm install && cd ..
node --test tests/mcp.test.mjs
npm i jsdom        (em qualquer pasta)
JSDOM_PATH=<pasta>\node_modules\jsdom node --test tests/site.test.mjs
```
No PowerShell, defina a variável antes: `$env:JSDOM_PATH="C:\caminho\node_modules\jsdom"`.

## Solução de problemas
| Sintoma | O que fazer |
|---|---|
| Site em branco | `madb-core.js` não subiu; conferir `git status` e `git log --stat -1` |
| Site antigo depois do push | Esperar o deploy em Actions e usar Ctrl + F5; testar em janela anônima |
| Dados sumiram | Ver o endereço e o navegador usados antes; no Console (F12): `Object.keys(localStorage)` — procurar `madb_ws_v1` e `madb_backup_*` |
| "O navegador pediu nova permissão" | Clicar em **Recarregar do arquivo** |
| "O navegador não guardou o acesso ao arquivo" | **Vincular arquivo…** de novo |
| MCP sem ferramentas novas | `npm install` em `mcp/` e reiniciar a sessão |
| `madb-core.js não encontrado` | O arquivo deve estar em `C:\MADB`, acima da pasta `mcp` |
| Importação recusada | Ler o caminho e o motivo na tela; nada foi alterado |
| Commit com e-mail errado | Configurar o e-mail `noreply` do GitHub, `git commit --amend --reset-author --no-edit`, `git push --force-with-lease` |
