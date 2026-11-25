# MADB MCP

Servidor [MCP](https://modelcontextprotocol.io) local do **MADB**, a ferramenta de modelagem de bancos PostgreSQL com diagrama ER.

Com ele, o Claude (Claude Code ou Claude Desktop) modela o banco por conversa: cria tabelas, colunas, chaves estrangeiras (inclusive compostas), enums, CHECKs, índices, triggers e partições, valida o modelo e gera **SQL (DDL) PostgreSQL 15+**, **diagrama Mermaid** e o **JSON** do site MADB. O modelo fica num arquivo no **mesmo formato do site** ([`FORMATO.md`](../FORMATO.md)), então o site pode vinculá-lo e sincronizar sem copiar e colar.

- Site: https://cardoscris755.github.io/madb/
- Roda localmente, em stdio, sem custo e sem conta.
- Só lê e grava um arquivo de modelo. **Não conecta a nenhum banco de dados.**

## Requisitos

- [Node.js](https://nodejs.org) 18 ou superior
- Claude Code ou Claude Desktop

## Instalação

Dentro da pasta `mcp/` do repositório (ou da pasta onde estiverem os arquivos):

```
npm install
```

Para testar se o servidor sobe:

```
node index.js
```

Ele fica parado e sem imprimir nada, porque aguarda o Claude se conectar. Se não aparecer erro, está certo. Feche com `Ctrl+C`.

## Conectar ao Claude Code

**Para todos os projetos:**

```
claude mcp add madb --scope user -- node C:\caminho\para\mcp\index.js
```

**Um modelo por projeto:** crie um arquivo `.mcp.json` na raiz do projeto.

```json
{
  "mcpServers": {
    "madb": {
      "command": "node",
      "args": ["C:\\caminho\\para\\mcp\\index.js"],
      "env": { "MADB_MODELO": "C:\\projetos\\meu-banco\\modelo-madb.json" }
    }
  }
}
```

No JSON, use barras duplas `\\` nos caminhos do Windows. Na primeira vez, o Claude Code pede aprovação para o servidor do projeto.

Reinicie a sessão do Claude Code e confira com `claude mcp list` ou, dentro do Claude Code, com `/mcp`. O servidor `madb` deve aparecer como conectado.

## Conectar ao Claude Desktop

Em **Settings → Developer → Edit Config**, adicione dentro de `mcpServers`:

```json
{
  "mcpServers": {
    "madb": {
      "command": "node",
      "args": ["C:\\caminho\\para\\mcp\\index.js"]
    }
  }
}
```

Feche e abra o Claude Desktop de novo.

## Onde o modelo é salvo

| Configuração | Arquivo do modelo |
|---|---|
| Padrão | `~/.madb/modelo.json` (pasta do seu usuário) |
| Com `MADB_MODELO` | o caminho que você definir |

Use um arquivo por projeto para manter modelos separados. Prefira caminhos **absolutos** em `MADB_MODELO`. A ferramenta `madb_caminho_modelo` mostra qual arquivo está em uso.

**Atualização da v0.1:** se o arquivo existente estiver no formato antigo (por nomes), ele é lido, convertido para o formato v2 na primeira alteração e uma cópia fica em `modelo.json.bak-v1`.

O servidor precisa do `madb-core.js` (na pasta acima de `mcp/`, ou ao lado do `index.js`). Se você copiar só a pasta `mcp`, copie também esse arquivo.

## Ferramentas

| Ferramenta | O que faz |
|---|---|
| `madb_ver_modelo` / `madb_caminho_modelo` | Mostra o modelo em texto / o caminho do arquivo |
| `madb_criar_tabela` | Cria (ou atualiza) uma tabela com colunas, PK, NOT NULL, UNIQUE, DEFAULT, FK, `identity`, coluna `gerada` e comentário |
| `madb_adicionar_coluna`, `madb_remover_coluna`, `madb_remover_tabela` | Edição de colunas e tabelas (limpam FKs, restrições e índices que dependiam do que saiu) |
| `madb_definir_fk` | FK de uma coluna (com `ON DELETE`), ou remove |
| `madb_criar_schema` | Declara um schema com comentário |
| `madb_criar_enum`, `madb_remover_enum` | Enums nomeados; use `schema.nome` como tipo de coluna |
| `madb_criar_funcao`, `madb_remover_funcao` | Funções (`CREATE OR REPLACE FUNCTION ...`) usadas por triggers |
| `madb_adicionar_restricao`, `madb_remover_restricao` | `check`, `unique` (composto, `NULLS NOT DISTINCT`) e `fk` composta |
| `madb_criar_indice`, `madb_remover_indice` | Índices com ordem, expressões, `UNIQUE`, `WHERE`, método e `NULLS NOT DISTINCT` |
| `madb_criar_trigger`, `madb_remover_trigger` | Triggers que chamam uma função |
| `madb_definir_particao`, `madb_adicionar_particao`, `madb_remover_particao` | Tabela particionada (`RANGE`/`LIST`/`HASH`) e partições filhas |
| `madb_comentar` | `COMMENT ON` de tabela, coluna, schema ou enum |
| `madb_definir_opcoes` | Convenção dos índices de FK: `idx` ou `ix` |
| `madb_validar` | Erros e avisos (veja [`FORMATO.md`](../FORMATO.md)) |
| `madb_gerar_sql` | DDL completo; `indices_fk` cria índice em cada FK; `salvar_em` grava num `.sql` e devolve só um resumo |
| `madb_gerar_mermaid` | Diagrama `erDiagram` |
| `madb_exportar_json` | JSON v2; `salvar_em` grava num arquivo |
| `madb_importar_json`, `madb_importar_arquivo` | Substituem o modelo por um JSON (texto ou arquivo). Validam antes: com erro, nada muda e o erro vem com caminho e motivo |
| `madb_limpar` | Apaga o modelo atual |

### Campos de uma coluna

| Campo | Padrão | Descrição |
|---|---|---|
| `nome` | | Nome da coluna |
| `tipo` | `text` | Tipo PostgreSQL ou enum (`schema.nome`) |
| `pk` / `nn` / `uq` | `false` | Chave primária (várias = PK composta), NOT NULL, UNIQUE |
| `padrao` | vazio | Expressão `DEFAULT` |
| `ref` | | `"tabela.coluna"` ou `"schema.tabela.coluna"`; a tabela de destino precisa existir antes |
| `on_delete` | `NO ACTION` | `NO ACTION`, `CASCADE`, `SET NULL`, `RESTRICT` |
| `identity` | | `ALWAYS` ou `BY DEFAULT` |
| `gerada` | | Expressão de coluna gerada |
| `comentario` | | `COMMENT ON COLUMN` |

## Exemplo de uso

> *"Crie o schema vendas com o enum pedido_status (aberto, pago, cancelado), as tabelas clientes e pedidos, um CHECK de total >= 0 e um índice único parcial em pedidos (cliente_id) onde status = 'aberto'. Valide e gere o SQL."*

O Claude chama `madb_criar_enum`, `madb_criar_tabela`, `madb_adicionar_restricao`, `madb_criar_indice`, `madb_validar` e `madb_gerar_sql`.

## Levar o modelo para o site MADB

1. No site, clique em **Vincular arquivo…** e escolha o arquivo do modelo (veja `madb_caminho_modelo`). Use **Recarregar do arquivo** ou **sincronizar sozinho**.
2. Sem File System Access API (Firefox, Safari): peça `madb_exportar_json` com `salvar_em`, e use **Abrir arquivo…** ou arraste o `.json` para a página.

O site nunca sobrescreve alterações suas sem perguntar, e o botão **Gravar no arquivo** é sempre manual.

## Observações

- O servidor **não conecta a nenhum banco**: só lê e grava o arquivo do modelo.
- Para modelos grandes, use `salvar_em` em `madb_gerar_sql` e `madb_exportar_json` para não despejar o conteúdo na conversa.
- Não deixe modelos reais da empresa em repositório público.

## Solução de problemas

| Sintoma | O que fazer |
|---|---|
| `madb-core.js não encontrado` | Copie o `madb-core.js` para a pasta acima de `mcp/` (raiz do repositório) |
| `node não é reconhecido` | Instale o Node.js e abra um terminal novo |
| `madb` não aparece em `/mcp` | Confira o caminho do `index.js`, use `\\` no JSON e reinicie a sessão |
| Erro ao subir o servidor | Rode `node index.js` na pasta e leia a mensagem. Quase sempre faltou o `npm install` |
| `Tabela "x" não existe no modelo` | Crie a tabela referenciada antes de criar a FK |
| O modelo "sumiu" ao trocar de projeto | Cada `MADB_MODELO` é um arquivo; confira qual caminho está configurado |

## Estrutura

```
mcp/
├── index.js        # servidor MCP
├── package.json
└── README.md
../madb-core.js     # núcleo compartilhado (formato, validação, SQL, Mermaid)
```

## Testes

`node --test tests/mcp.test.mjs` (na raiz do repositório, depois de `npm install` em `mcp/`).

## Tecnologias

Node.js (ESM), `@modelcontextprotocol/sdk`, `zod`.
