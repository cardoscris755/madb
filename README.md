# MADB

MVP de gerenciamento de arquitetura de banco de dados em PostgreSQL.

O MADB é uma ferramenta web para modelar um banco de dados visualmente: você define tabelas, colunas e relacionamentos, acompanha o diagrama ER em tempo real e exporta o SQL pronto para o PostgreSQL.

**Acesse online:** https://cardoscris755.github.io/madb/

## Funcionalidades

- **Editor de tabelas e colunas:** nome, tipo, `PRIMARY KEY` (simples ou composta), `NOT NULL`, `UNIQUE`, `DEFAULT`, `GENERATED ... AS IDENTITY`, colunas geradas e comentários.
- **Chaves estrangeiras:** de uma coluna (com `ON DELETE`) ou **compostas**.
- **Restrições:** `CHECK`, `UNIQUE` composto (com `NULLS NOT DISTINCT`) e FK composta.
- **Índices:** nome, colunas em ordem (`ASC`/`DESC`, `NULLS FIRST/LAST`), expressões, `UNIQUE`, parciais (`WHERE`) e método.
- **Enums, funções e schemas** como itens do modelo (chip **⚙ Modelo**), **triggers** e **tabelas particionadas** (`RANGE`/`LIST`/`HASH`) com partições filhas.
- **Diagrama ER interativo:** tabelas arrastáveis, relacionamentos (inclusive compostos) com cardinalidade, zoom e auto-organização.
- **Exportação:**
  - **SQL (DDL) para PostgreSQL 15+**, na ordem certa (schemas, enums, funções, tabelas, FKs, índices, CHECKs, comentários, triggers), com índices opcionais nas FKs e duas convenções de nome.
  - **Mermaid:** diagrama `erDiagram`.
  - **JSON:** o formato completo do modelo, documentado em [`FORMATO.md`](FORMATO.md). Dá para baixar o `.json`.
- **Importação de JSON** por **arquivo**, **arrastar e soltar** ou **colar**, sempre validada antes de aplicar. Se houver erro, nada muda e a tela mostra o caminho e o motivo (ex.: `tables[1].cols[1].ref aponta para a tabela "t9", que não existe`). Se a arquitetura atual já tem conteúdo, você escolhe entre criar uma nova arquitetura (padrão) ou substituir.
- **Arquivo vinculado (Chrome/Edge):** vincule o `modelo.json` do MCP, recarregue com um clique ou ligue a sincronização automática. A barra de origem mostra de onde veio a última alteração. Se o arquivo e a tela mudarem ao mesmo tempo, o site pergunta o que fazer; nada é sobrescrito sem a sua escolha.
- **Avisos e erros automáticos:** tabela sem PK, FK com tipo diferente, FK para coluna sem PK/UNIQUE, PK de tabela particionada sem a coluna de partição, identity em tipo não inteiro, nomes duplicados e outros.
- **Várias arquiteturas (áreas de trabalho)** e **salvamento local** no navegador (`localStorage`).

## Como usar

1. Abra o site (ou o `index.html` localmente; precisa do `madb-core.js` ao lado).
2. Para uma ideia nova, clique em **+ Nova arquitetura**. Para voltar a outra, use o seletor **Arquitetura**.
3. **+ Nova tabela**, depois **+ Coluna**. Restrições, índices, triggers e particionamento ficam abaixo das colunas; enums, funções e schemas ficam no chip **⚙ Modelo**.
4. Para um relacionamento simples, escolha o destino em **sem chave estrangeira**; para FK composta, use **+ Restrição** e troque o tipo para *FK composta*.
5. Na parte de baixo, copie ou baixe o **SQL**, o **Mermaid** ou o **JSON**.
6. Para abrir um modelo salvo: **Abrir arquivo…**, arraste o `.json` para a página ou cole o texto na aba **JSON** e clique em **Aplicar JSON colado**.

## Integração com o agente (sem copiar e colar)

O MCP grava o modelo em `~/.madb/modelo.json` (ou onde `MADB_MODELO` apontar) **no mesmo formato do site**. No site, clique em **Vincular arquivo…** e escolha esse arquivo: a página lê o arquivo quando você clica em **Recarregar do arquivo** ou sozinha, com **sincronizar sozinho** ligado. **Gravar no arquivo** manda para o agente o que você mexeu na tela (sempre manual, com confirmação se o arquivo mudou). Funciona em navegadores com a File System Access API (Chrome, Edge); nos demais, use **Abrir arquivo…**. Por que não uma API com token: o site é estático (GitHub Pages), então não há servidor para receber chamadas do agente.

## MCP do MADB (opcional)

A pasta [`mcp/`](mcp/) traz um servidor MCP local que deixa o Claude (Claude Code ou Claude Desktop) modelar o banco por conversa: cria tabelas, colunas e chaves estrangeiras, valida o modelo e gera SQL, Mermaid e o JSON que o site importa. O servidor só lê e grava um arquivo de modelo, **não conecta a nenhum banco de dados**.

**Instalação** (requer Node.js 18 ou superior):

```
cd mcp
npm install
```

**Conectar ao Claude Code:**

```
claude mcp add madb --scope user -- node C:\caminho\para\madb\mcp\index.js
```

Ou, para um modelo por projeto, crie um `.mcp.json` na raiz do projeto:

```json
{
  "mcpServers": {
    "madb": {
      "command": "node",
      "args": ["C:\\caminho\\para\\madb\\mcp\\index.js"],
      "env": { "MADB_MODELO": "C:\\projetos\\meu-banco\\modelo-madb.json" }
    }
  }
}
```

Reinicie a sessão do Claude Code depois de configurar. Sem `MADB_MODELO`, o modelo fica em `~/.madb/modelo.json`.

**Ferramentas disponíveis:** tabelas e colunas (`madb_criar_tabela`, `madb_adicionar_coluna`, `madb_definir_fk`, `madb_remover_*`), `madb_criar_enum`, `madb_criar_schema`, `madb_criar_funcao`, `madb_adicionar_restricao` (CHECK, UNIQUE e FK compostas), `madb_criar_indice`, `madb_criar_trigger`, `madb_definir_particao`/`madb_adicionar_particao`, `madb_comentar`, `madb_definir_opcoes`, `madb_validar`, `madb_gerar_sql`, `madb_gerar_mermaid`, `madb_exportar_json`, `madb_importar_json`, `madb_importar_arquivo`, `madb_caminho_modelo`, `madb_ver_modelo` e `madb_limpar`.

**Fluxo sugerido:** peça ao Claude para modelar e validar o banco; no site, vincule o arquivo do modelo (veja *Integração com o agente*). Sem File System Access API, peça *"exporte o JSON do madb para um arquivo"* e use **Abrir arquivo…**. Mais detalhes em [`mcp/README.md`](mcp/README.md).

## Executar localmente

Não há build nem servidor. Abra o `index.html` no navegador (ele carrega o `madb-core.js` da mesma pasta). Para as funções de arquivo vinculado, o navegador pode exigir `https://` ou `localhost`; use o site publicado ou `npx serve .`.

## Testes

```
node --test tests/madb.test.js            # núcleo: importação, validação, SQL, round-trip
cd mcp && npm install && cd ..
node --test tests/mcp.test.mjs            # MCP ponta a ponta (cliente do SDK)
npm i jsdom                               # em qualquer pasta
JSDOM_PATH=/caminho/node_modules/jsdom node --test tests/site.test.mjs   # site
```

## Publicação

Site estático: `index.html` + `madb-core.js` na raiz da branch `main` (GitHub Pages). **Os dois arquivos precisam ser enviados juntos.** Não coloque modelos reais da empresa no repositório público.

## Estrutura

```
madb/
├── index.html      # site (HTML, CSS e JavaScript)
├── madb-core.js    # núcleo compartilhado: formato, validação, SQL, Mermaid (site e MCP)
├── FORMATO.md      # documentação do JSON (v2)
├── exemplos/       # JSONs de exemplo (válido, inválidos, formato antigo)
├── tests/          # testes
└── mcp/            # servidor MCP local (index.js, package.json, README.md)
```

## Limitações

- Os dados ficam apenas no navegador; não há contas nem compartilhamento entre pessoas.
- Não há importação de DDL existente nem conexão com banco.
- Views, domínios, sequences avulsas, RLS, grants e extensões não são modelados.
- O vínculo com arquivo local depende da File System Access API (Chrome/Edge).

## Próximos passos

- Download de imagem (PNG/SVG) do diagrama.
- Importação de DDL existente.
- Geração de migrations entre duas versões do modelo.

## Tecnologias

HTML, CSS e JavaScript puros (SVG para o diagrama), sem bibliotecas externas no site. MCP em Node.js com `@modelcontextprotocol/sdk` e `zod`.
