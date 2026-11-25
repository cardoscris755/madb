# 2. Arquitetura técnica

## Estrutura do repositório
```
madb/
├── index.html      site (HTML, CSS e JS num único arquivo)
├── madb-core.js    núcleo compartilhado (UMD: <script> no site, require no MCP)
├── FORMATO.md      documentação do JSON v2
├── exemplos/       valido-completo, invalido-*, legado-por-nomes
├── tests/          madb.test.js, mcp.test.mjs, site.test.mjs
├── conhecimento/   esta pasta
└── mcp/            index.js, package.json, README.md (node_modules fica fora do Git)
```
Regra de publicação: `index.html` e `madb-core.js` precisam subir **juntos**; sem o núcleo, o site não abre.

## Núcleo (`madb-core.js`)
Sem DOM e sem dependências. Exporta, entre outros: `load`, `loadObject`, `parseJSON`, `normalize`, `validate`, `serialize`, `exportJSON`, `toSQL`, `toMermaid`, `autoLayout`, `tableHeight`, `newId`, `findTable`, `findCol`, `tableById`, `colById`, `summary`, `emptyModel`, `prune`, `stableStringify`.

- `load(texto)` devolve `{model, errors[], warnings[], notes[], legacy}`. Com erro, não há modelo aplicável. Cada erro tem `path` e `message` em português (ex.: `tables[1].cols[1].ref aponta para a tabela "t9", que não existe`).
- Erro de sintaxe do JSON traz linha e coluna.
- `prune(model)` remove FKs, restrições, índices e partições que ficaram sem destino depois de apagar coluna ou tabela, e devolve a lista do que limpou.
- `toSQL(model, {fkIndexes, indexNaming, header})`.

## Formato v2 (resumo)
Modelo baseado em **ids**: `{version:2, options, schemas, enums, functions, tables:[{id,name,schema,x,y,comment, cols, constraints, indexes, triggers, partition, partitions}]}`. Campos novos são opcionais; o formato antigo por nomes (`ref:{table,col}`, sem ids) é aceito e convertido. Detalhes completos em `FORMATO.md`.

Esquema de ids gerado por `newId`: tabela `t<n>`, coluna `t1c<n>`, restrição `t1k<n>`, índice `t1i<n>`, trigger `t1g<n>`, partição `t1p<n>`, enum `e<n>`, função `f<n>`.

## Geração de SQL (PostgreSQL 15+)
Ordem: schemas → enums → funções → tabelas (PK/UNIQUE inline, `PARTITION BY`, depois cada `PARTITION OF`) → FKs (`ALTER TABLE ADD CONSTRAINT`) → índices (explícitos + opcionalmente um por FK) → CHECKs → `COMMENT ON` → triggers.
Convenções de nome de índice de FK: `idx_<tabela>_<colunas>` (padrão) ou `ix_<tabela>__<colunas>` (`options.indexNaming = "ix"`).
O SQL gerado foi validado com o parser real do PostgreSQL (`pglast`).

## Validações principais
Erros (bloqueiam importação): JSON inválido, tipos errados, ids duplicados, referências a tabela ou coluna inexistente, enum vazio. Avisos: FK para coluna sem PK/UNIQUE, tipos diferentes na FK, PK de tabela particionada sem a coluna de partição, identity em tipo não inteiro, generated/identity junto com DEFAULT, NULLS NOT DISTINCT sem UNIQUE, nomes duplicados, trigger com função não declarada.

## Site (`index.html`)
- **Áreas de trabalho** (várias arquiteturas) guardadas em `localStorage`, chave `madb_ws_v1`. Cada uma: id, nome, modelo, origem, vínculo (`link.name`), `auto`, `syncHash`, `fileStamp`.
- **Editor** da tabela (colunas, restrições, índices, triggers, particionamento) e chip **⚙ Modelo** (opções, schemas, enums, funções). Campos que referenciam colunas por nome usam texto separado por vírgula; nomes inexistentes mostram erro e não alteram o modelo.
- **Importação** por arquivo, arrastar e soltar ou colar. Valida antes; com conteúdo existente, pergunta "nova arquitetura" (padrão) ou "substituir". Limite de 8 MB.
- **Arquivo vinculado** (File System Access API, Chrome/Edge): o handle fica no IndexedDB (banco `madb`, store `h`) e num cache em memória. Funções: Vincular, Recarregar, Gravar no arquivo (manual, com confirmação se o arquivo mudou) e sincronização automática por leitura periódica (2 s) da data de modificação.
- **Conflitos:** o site compara um hash do modelo (sem x/y) com o do último sincronismo. Se arquivo e tela mudaram, pergunta: nova arquitetura (padrão) / usar o arquivo / manter a minha. Nada é sobrescrito sem escolha.
- **Permissão:** depois do F5 o navegador pode exigir nova permissão de leitura. O site não tenta pedir sozinho (falharia); mostra um aviso e o botão "Recarregar do arquivo" (um clique do usuário) reautoriza.

## MCP (`mcp/index.js`)
Node 22, ESM, `@modelcontextprotocol/sdk` 1.32.x e `zod`. Carrega o núcleo por `madb-core.js` na pasta acima de `mcp/` (ou ao lado). Versão 0.2.0.
- Estado em arquivo: cada ferramenta lê, altera e grava o arquivo inteiro.
- Arquivo no formato antigo é lido, convertido na primeira gravação e copiado para `modelo.json.bak-v1`.
- Ferramentas: ver `mcp/README.md` (schemas, enums, funções, tabelas, colunas, FKs, restrições, índices, triggers, partições, comentários, opções, validar, gerar SQL/Mermaid, exportar/importar JSON e arquivo, limpar). `madb_gerar_sql` e `madb_exportar_json` aceitam `salvar_em` para não despejar conteúdo grande na conversa.

## Testes (28)
- `node --test tests/madb.test.js` (16): importação válida e inválida, linha/coluna, ids duplicados, formato antigo, identity no tipo, arquivo x colagem, round-trip, SQL (FK composta, enum, check, índice parcial, gerada, trigger, partição), validações, Mermaid.
- `node --test tests/mcp.test.mjs` (4): MCP de ponta a ponta com o cliente do SDK, round-trip, importação inválida, migração do arquivo antigo, limpeza de referências. Exige `npm install` em `mcp/`.
- `JSDOM_PATH=<caminho>/node_modules/jsdom node --test tests/site.test.mjs` (8): site em jsdom (importação, drag-and-drop, editor, sincronização com conflito, persistência do "sincronizar sozinho").
