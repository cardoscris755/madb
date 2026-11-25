# MADB

MVP de gerenciamento de arquitetura de banco de dados em PostgreSQL.

O MADB é uma ferramenta web para modelar um banco de dados visualmente: você define tabelas, colunas e relacionamentos, acompanha o diagrama ER em tempo real e exporta o SQL pronto para o PostgreSQL.

**Acesse online:** https://cardoscris755.github.io/madb/

## Funcionalidades

- **Editor de tabelas e colunas:** nome, tipo, `PRIMARY KEY` (simples ou composta), `NOT NULL`, `UNIQUE` e `DEFAULT`.
- **Chaves estrangeiras:** escolha a coluna referenciada e a regra `ON DELETE` (`NO ACTION`, `CASCADE`, `SET NULL` ou `RESTRICT`).
- **Schemas:** cada tabela pode pertencer a um schema; o `CREATE SCHEMA` é gerado automaticamente.
- **Diagrama ER interativo:** tabelas arrastáveis, linhas de relacionamento com cardinalidade (1 / N), zoom e auto-organização.
- **Exportação:**
  - **SQL (DDL):** `CREATE TABLE`, chaves estrangeiras via `ALTER TABLE` e, opcionalmente, índices nas FKs.
  - **Mermaid:** diagrama `erDiagram`, para colar em documentação, README ou wikis que suportem Mermaid.
  - **JSON:** salva o modelo completo e permite importá-lo de volta.
- **Avisos automáticos:** tabela sem PK, nomes duplicados, FK com tipo diferente da coluna referenciada e FK apontando para coluna sem `PRIMARY KEY`/`UNIQUE`.
- **Várias arquiteturas (áreas de trabalho):** crie quantas quiser, cada uma com suas próprias tabelas e diagrama. Dá para começar do zero ou com o exemplo, alternar pelo seletor do cabeçalho, renomear, duplicar e excluir.
- **Salvamento local:** todas as arquiteturas ficam guardadas no navegador (`localStorage`) entre uma visita e outra.

## Como usar

1. Abra o site (ou o `index.html` localmente).
2. Para uma ideia nova, clique em **+ Nova arquitetura** no cabeçalho, dê um nome e escolha começar do zero ou com o exemplo. Para voltar a outra, use o seletor **Arquitetura**.
3. Clique em **+ Nova tabela** e defina o nome.
4. Adicione colunas com **+ Coluna** e configure tipo, PK, NOT NULL, UNIQUE e DEFAULT.
5. Para criar um relacionamento, escolha em **sem chave estrangeira** a coluna de destino.
6. Arraste as tabelas no diagrama para organizar o desenho, ou use **Auto-organizar**.
7. Na parte de baixo, copie o **SQL**, o **Mermaid** ou o **JSON** com o botão **Copiar**.

Para reabrir um modelo salvo, cole o JSON na aba **JSON** e clique em **Aplicar JSON**.

O exemplo de e-commerce (clientes, produtos, pedidos e itens do pedido) está disponível ao criar uma nova arquitetura.

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

**Ferramentas disponíveis:** `madb_ver_modelo`, `madb_criar_tabela`, `madb_adicionar_coluna`, `madb_definir_fk`, `madb_remover_coluna`, `madb_remover_tabela`, `madb_validar`, `madb_gerar_sql`, `madb_gerar_mermaid`, `madb_exportar_json`, `madb_importar_json` e `madb_limpar`.

**Fluxo sugerido:** peça ao Claude para modelar e validar o banco, peça *"exporte o JSON do madb"*, crie uma nova arquitetura no site, cole o texto na aba **JSON** e clique em **Aplicar JSON**. Mais detalhes em [`mcp/README.md`](mcp/README.md).

## Executar localmente

Não há dependências, build nem servidor. Basta baixar o repositório e abrir o arquivo `index.html` no navegador.

## Publicação

O projeto é um site estático de um único arquivo e funciona em qualquer hospedagem estática. A versão atual usa o **GitHub Pages**, com a branch `main` e a pasta raiz como origem. Para atualizar o site, basta alterar o `index.html` no repositório.

## Estrutura

```
madb/
├── index.html   # aplicação completa (HTML, CSS e JavaScript)
├── README.md
└── mcp/         # servidor MCP local (index.js, package.json, README.md)
```

## Limitações do MVP

- Os dados (e as arquiteturas) ficam apenas no navegador de quem usa; não há contas, nem banco de dados no servidor, nem compartilhamento entre pessoas.
- O diagrama é gerado apenas a partir do que você modela; ainda não é possível importar um schema existente (DDL ou conexão com o banco).
- Não há suporte a índices personalizados, `CHECK`, `ENUM`, views, partições nem migrations entre versões do modelo.
- A exportação é feita pelo botão **Copiar**; ainda não há download direto de arquivos.

## Próximos passos

- Download direto de `.sql`, `.json` e imagem (PNG/SVG) do diagrama.
- Importação de DDL existente.
- Índices, `CHECK` e `ENUM`.
- Geração de migrations entre duas versões do modelo.
- Vários projetos salvos e compartilhamento por link.

## Tecnologias

HTML, CSS e JavaScript puros (SVG para o diagrama), sem bibliotecas externas.
