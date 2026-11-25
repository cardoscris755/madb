# Formato do modelo MADB (v2)

O site e o MCP leem e gravam **o mesmo JSON**. Este documento é a referência. Exemplos prontos em [`exemplos/`](exemplos/).

Regras gerais:

- Todo campo novo é **opcional**. Um arquivo antigo (só tabelas e colunas) continua válido.
- Tabelas, colunas e demais objetos têm um `id` de texto, único dentro do seu nível. Os vínculos (`ref`, colunas de restrições etc.) apontam por **id**.
- Nas restrições, índices e partições, onde o formato pede ids, o importador também aceita o **nome** (`"pedidos"`, `"vendas.pedidos"`, `"cliente_id"`) e converte para id.
- Arquivo no formato antigo (referências por nome, sem ids: `"ref": {"table": "clientes", "col": "id"}`) é aceito e convertido.
- Ao importar, **nada é aplicado se houver erro**. Cada erro traz o caminho no JSON e o motivo.
- Alvo: PostgreSQL 15 ou superior (usa `NULLS NOT DISTINCT`, `GENERATED ... AS IDENTITY`, partições declarativas).

## Raiz

| Campo | Tipo | Obrigatório | Descrição |
|---|---|---|---|
| `version` | número | não | `2`. Se faltar, é tratado como arquivo antigo e convertido. |
| `options` | objeto | não | `indexNaming`: `"idx"` (`idx_<tabela>_<colunas>`, padrão) ou `"ix"` (`ix_<tabela>__<colunas>`) para os índices de FK gerados. |
| `schemas` | lista | não | `{ "name", "comment"? }`. Schemas usados por tabelas, enums e funções já são criados sozinhos. |
| `enums` | lista | não | `{ "id", "schema"?, "name", "values": ["a","b"], "comment"? }` |
| `functions` | lista | não | `{ "id", "schema"?, "name", "sql", "comment"? }`. `sql` é o `CREATE OR REPLACE FUNCTION ...` completo. |
| `tables` | lista | **sim** | Tabelas (abaixo). |

## Tabela

| Campo | Descrição |
|---|---|
| `id`, `name` | obrigatórios |
| `schema` | padrão `public` |
| `x`, `y` | posição no diagrama (opcional; se faltar, é organizada automaticamente) |
| `comment` | `COMMENT ON TABLE` |
| `cols` | colunas (abaixo) |
| `constraints` | `CHECK`, `UNIQUE` e FK composta |
| `indexes` | índices explícitos |
| `triggers` | triggers |
| `partition` | `{ "by": "RANGE"\|"LIST"\|"HASH", "cols": [idsDeColuna] }` torna a tabela particionada |
| `partitions` | partições filhas: `{ "id", "name", "schema"?, "bound" }`, em que `bound` é o texto depois de `FOR VALUES`: `FROM ('2026-01-01') TO ('2026-02-01')`, `IN ('A','B')`, `WITH (MODULUS 4, REMAINDER 0)` ou `DEFAULT` |

## Coluna

```json
{ "id": "t1c1", "name": "id", "type": "bigint", "pk": true, "nn": true, "uq": false,
  "def": "", "ref": null, "del": "NO ACTION",
  "identity": "ALWAYS", "generated": "quantidade * preco", "comment": "texto" }
```

- `ref`: `{ "t": idDaTabela, "c": idDaColuna }` para FK de uma coluna (ou `null`). `del`: `NO ACTION`, `CASCADE`, `SET NULL` ou `RESTRICT`.
- `identity`: `"ALWAYS"` ou `"BY DEFAULT"` (tipo inteiro; não combina com `def`).
- `generated`: expressão de coluna gerada (`GENERATED ALWAYS AS (...) STORED`; não combina com `def` nem `identity`).
- `type` pode ser o nome de um enum (`"vendas.pedido_status"`).
- Um `type` antigo como `"bigint GENERATED ALWAYS AS IDENTITY"` é convertido para o campo `identity` (com uma observação no resultado da importação).

## Restrições (`constraints`)

```json
{ "id": "t2k1", "name": "ck_itens__quantidade", "kind": "check", "expr": "quantidade > 0" }
{ "id": "t2k2", "name": "uq_pedidos__id_cliente", "kind": "unique", "cols": ["t2c1","t2c2"], "nullsNotDistinct": true }
{ "id": "t3k1", "name": "fk_itens__pedido_cliente", "kind": "fk",
  "cols": ["t3c2","t3c3"], "ref": { "t": "t2", "cols": ["t2c1","t2c2"] }, "del": "CASCADE" }
```

A FK composta exige que as colunas referenciadas formem PK ou UNIQUE na tabela de destino, na mesma ordem, e a mesma quantidade de colunas.

## Índices (`indexes`)

```json
{ "id": "t3i1", "name": "uq_itens__pedido", "unique": true, "nullsNotDistinct": true, "method": "btree",
  "cols": [ { "c": "t3c2", "order": "DESC", "nulls": "LAST" }, { "expr": "lower(codigo)" } ],
  "where": "quantidade > 0" }
```

Cada item de `cols` é uma coluna (`c`) **ou** uma expressão (`expr`), com `order` (`ASC`/`DESC`) e `nulls` (`FIRST`/`LAST`) opcionais. `where` cria índice parcial.

## Triggers (`triggers`)

```json
{ "id": "t2g1", "name": "tg_pedidos__touch", "timing": "BEFORE", "events": ["UPDATE"], "level": "ROW",
  "function": "vendas.touch", "when": "OLD.* IS DISTINCT FROM NEW.*" }
```

`timing`: `BEFORE`, `AFTER` ou `INSTEAD OF`. `events`: `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`. `level`: `ROW` ou `STATEMENT`. A função chamada deve estar em `functions` (senão a validação avisa).

## Ordem do SQL gerado

schemas → enums → funções → tabelas (PK e UNIQUE inline, `PARTITION BY`; depois cada `PARTITION OF`) → FKs (`ALTER TABLE ... ADD CONSTRAINT`) → índices (explícitos e, se pedido, um por FK) → CHECKs → `COMMENT ON` → triggers.

## Validações

- **Erros** (impedem a importação): JSON inválido (com linha e coluna), tipos errados, ids duplicados, `ref` para tabela ou coluna que não existe, enums/valores vazios, etc.
- **Avisos** (importa e avisa): FK para coluna sem PK/UNIQUE, tipos diferentes entre FK e destino, PK de tabela particionada sem a coluna de partição, `identity` em tipo não inteiro, `generated`/`identity` com `DEFAULT`, `NULLS NOT DISTINCT` sem UNIQUE, nomes duplicados, trigger com função não declarada.

## Exemplos

- [`exemplos/valido-completo.json`](exemplos/valido-completo.json): enum, funções, CHECK, UNIQUE e FK compostas, índice parcial, coluna gerada, identity, tabela particionada, comentários.
- [`exemplos/invalido-ref-inexistente.json`](exemplos/invalido-ref-inexistente.json): FK apontando para uma tabela que não existe.
- [`exemplos/invalido-coluna-inexistente.json`](exemplos/invalido-coluna-inexistente.json) e [`invalido-sintaxe.json`](exemplos/invalido-sintaxe.json).
- [`exemplos/legado-por-nomes.json`](exemplos/legado-por-nomes.json): formato antigo, por nomes.
