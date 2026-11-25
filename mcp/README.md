# MADB MCP

Servidor [MCP](https://modelcontextprotocol.io) local do **MADB**, a ferramenta de modelagem de bancos PostgreSQL com diagrama ER.

Com ele, o Claude (Claude Code ou Claude Desktop) modela o banco por conversa: cria tabelas, colunas e chaves estrangeiras, valida o modelo e gera **SQL (DDL)**, **diagrama Mermaid** e o **JSON** que o site MADB importa para mostrar o diagrama.

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

Use um arquivo por projeto para manter modelos separados e versioná-los no Git. Prefira caminhos **absolutos** em `MADB_MODELO`.

## Ferramentas

| Ferramenta | O que faz |
|---|---|
| `madb_ver_modelo` | Mostra tabelas, colunas, PKs e FKs do modelo atual |
| `madb_criar_tabela` | Cria (ou substitui) uma tabela com colunas, PK, NOT NULL, UNIQUE, DEFAULT e FK |
| `madb_adicionar_coluna` | Adiciona ou substitui uma coluna em uma tabela existente |
| `madb_definir_fk` | Define ou remove a chave estrangeira de uma coluna (com `ON DELETE`) |
| `madb_remover_coluna` | Remove uma coluna e as FKs que apontavam para ela |
| `madb_remover_tabela` | Remove uma tabela e as FKs que apontavam para ela |
| `madb_validar` | Aponta problemas no modelo (veja abaixo) |
| `madb_gerar_sql` | Gera o DDL PostgreSQL; opção `indices_fk` cria índice em cada FK |
| `madb_gerar_mermaid` | Gera o diagrama ER em Mermaid (`erDiagram`) |
| `madb_exportar_json` | Exporta no formato do site MADB |
| `madb_importar_json` | Importa um JSON exportado pelo site MADB (substitui o modelo atual) |
| `madb_limpar` | Apaga o modelo atual |

### Campos de uma coluna

Usados em `madb_criar_tabela` e `madb_adicionar_coluna`.

| Campo | Tipo | Padrão | Descrição |
|---|---|---|---|
| `nome` | texto | | Nome da coluna |
| `tipo` | texto | `text` | Tipo PostgreSQL, ex.: `bigserial`, `varchar(120)`, `numeric(12,2)`, `timestamptz`, `uuid`, `jsonb` |
| `pk` | booleano | `false` | Chave primária. Várias colunas com `pk` formam uma PK composta |
| `nn` | booleano | `false` | `NOT NULL` (implícito na PK) |
| `uq` | booleano | `false` | `UNIQUE` |
| `padrao` | texto | vazio | Expressão `DEFAULT`, ex.: `now()`, `0`, `'aberto'` |
| `ref` | texto | | Chave estrangeira no formato `tabela.coluna` ou `schema.tabela.coluna` |
| `on_delete` | texto | `NO ACTION` | `NO ACTION`, `CASCADE`, `SET NULL` ou `RESTRICT` |

### Validações (`madb_validar`)

- tabela sem colunas ou sem chave primária;
- tabelas ou colunas com nomes duplicados;
- FK com tipo diferente da coluna referenciada (`serial` e `bigserial` são tratados como `integer` e `bigint`);
- FK apontando para coluna sem `PRIMARY KEY` ou `UNIQUE` (o PostgreSQL recusaria);
- FK que aponta para algo que não existe mais;
- `ON DELETE SET NULL` em coluna `NOT NULL` ou PK.

## Exemplo de uso

Peça ao Claude, por exemplo:

> Use o madb para modelar um banco de controle de estoque com produtos, fornecedores e movimentações. Valide e gere o SQL com índices nas FKs.

O Claude chama as ferramentas na ordem (tabelas-pai primeiro), valida e devolve o DDL. Exemplo de saída:

```sql
CREATE TABLE clientes (
  id bigserial PRIMARY KEY,
  email varchar(255) NOT NULL UNIQUE
);

CREATE TABLE pedidos (
  id bigserial PRIMARY KEY,
  cliente_id bigint NOT NULL
);

-- Chaves estrangeiras
ALTER TABLE pedidos
  ADD CONSTRAINT pedidos_cliente_id_fkey FOREIGN KEY (cliente_id)
  REFERENCES clientes (id) ON DELETE RESTRICT;
```

## Levar o modelo para o site MADB

1. Peça ao Claude: *"exporte o JSON do madb"*.
2. No site, crie uma nova arquitetura (**+ Nova arquitetura**, começando do zero).
3. Abra a aba **JSON**, cole o texto e clique em **Aplicar JSON**.

O diagrama aparece organizado em grade, e você pode arrastar as tabelas. O caminho inverso também funciona: copie o JSON da aba **JSON** do site e use `madb_importar_json`.

> **Atenção:** tanto o **Aplicar JSON** do site quanto o `madb_importar_json` **substituem** o conteúdo atual. Crie uma nova arquitetura antes de colar, para não sobrescrever uma existente.

## Observações

- **Ordem de criação:** a tabela referenciada precisa existir antes da FK. Crie as tabelas-pai primeiro, ou use `madb_definir_fk` depois.
- **Auto-referência** (ex.: `pedidos.pai_id → pedidos.id`) funciona no formato `tabela.coluna`.
- **Substituição:** `madb_criar_tabela` com um nome já existente substitui a tabela inteira.
- **Remoção em cascata no modelo:** ao remover uma tabela ou coluna, as FKs que apontavam para ela são removidas também.
- O modelo do MCP e as arquiteturas do site são independentes: o site guarda os dados no navegador, e o MCP, em um arquivo.

## Solução de problemas

| Sintoma | O que fazer |
|---|---|
| `node não é reconhecido` | Instale o Node.js e abra um terminal novo |
| `madb` não aparece em `/mcp` | Confira o caminho do `index.js`, use `\\` no JSON e reinicie a sessão |
| Erro ao subir o servidor | Rode `node index.js` na pasta e leia a mensagem. Quase sempre faltou o `npm install` |
| `Tabela "x" não existe no modelo` | Crie a tabela referenciada antes de criar a FK |
| O modelo "sumiu" ao trocar de projeto | Cada `MADB_MODELO` é um arquivo; confira qual caminho está configurado |

## Estrutura

```
mcp/
├── index.js        # servidor MCP (stdio)
├── package.json
└── README.md
```

## Tecnologias

Node.js (ES modules), [`@modelcontextprotocol/sdk`](https://www.npmjs.com/package/@modelcontextprotocol/sdk) e [`zod`](https://www.npmjs.com/package/zod).
