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

## Executar localmente

Não há dependências, build nem servidor. Basta baixar o repositório e abrir o arquivo `index.html` no navegador.

## Publicação

O projeto é um site estático de um único arquivo e funciona em qualquer hospedagem estática. A versão atual usa o **GitHub Pages**, com a branch `main` e a pasta raiz como origem. Para atualizar o site, basta alterar o `index.html` no repositório.

## Estrutura

```
madb/
├── index.html   # aplicação completa (HTML, CSS e JavaScript)
└── README.md
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
