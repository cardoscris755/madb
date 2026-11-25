# 1. Visão geral

## O que é
O **MADB** é uma ferramenta web gratuita para modelar bancos de dados **PostgreSQL**: tabelas, colunas e relacionamentos com diagrama ER em tempo real, e exportação de SQL (DDL), Mermaid e JSON. Nasceu como MVP e hoje cobre também enums, CHECKs, FKs compostas, índices, colunas geradas, identity, triggers, funções, partições, schemas e comentários.

## Endereços e locais
- Site: https://cardoscris755.github.io/madb/ (GitHub Pages, branch `main`, pasta raiz)
- Repositório (público): github.com/cardoscris755/madb
- Pasta local: `C:\MADB`
- Servidor MCP local: `C:\MADB\mcp` (registrado no Claude Code, escopo de usuário, com o nome `madb`)
- Arquivo do modelo do MCP: `~/.madb/modelo.json`, ou o caminho da variável `MADB_MODELO`

## Dois componentes
1. **Site** (`index.html` + `madb-core.js`): editor, diagrama, geradores, importação de JSON, várias arquiteturas, vínculo com arquivo local.
2. **MCP** (`mcp/index.js`): permite que o Claude (Claude Code, Orca, Claude Desktop) modele o banco por conversa. Não conecta a nenhum banco: só lê e grava o arquivo do modelo.

Os dois usam o **mesmo núcleo** (`madb-core.js`) e o **mesmo formato de JSON** (v2, documentado em `FORMATO.md`).

## Como o trabalho flui
```
Claude → MCP madb → modelo.json → (site vinculado a esse arquivo) → diagrama
                                 ↘ madb_gerar_sql → .sql
```
Também é possível o caminho inverso: montar no site, "Baixar .json" ou "Gravar no arquivo", e o agente ler com `madb_importar_arquivo`.

## Quem usa e como
O usuário trabalha no Windows, com Orca + Claude Code, e fala português. Os dados ficam **locais** (navegador e arquivo). O compartilhamento é por arquivo `.json`.
