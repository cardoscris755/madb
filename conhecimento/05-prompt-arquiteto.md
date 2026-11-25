# 5. Prompt para o agente arquiteto

Cole na sessão do agente que vai modelar o banco usando o MCP `madb`.

````
O MADB foi atualizado (MCP v0.2 + site). Daqui em diante, use o MCP `madb` para modelar o banco e entregue o resultado já pronto para o site, sem copiar e colar.

## O que mudou
O MADB agora suporta: enums nomeados (CREATE TYPE ... AS ENUM); CHECK, UNIQUE composto (com NULLS NOT DISTINCT) e FK composta; índices com nome, colunas em ordem (ASC/DESC, NULLS FIRST/LAST), UNIQUE, parciais (WHERE) e expressões; colunas geradas e identity; funções e triggers; tabelas particionadas (RANGE/LIST/HASH) com partições filhas; schemas e comentários. O SQL sai em PostgreSQL 15+, na ordem: schemas, enums, funções, tabelas, FKs, índices, CHECKs, comentários, triggers.

## Ferramentas do MCP
madb_ver_modelo, madb_caminho_modelo, madb_criar_schema, madb_criar_enum, madb_criar_funcao, madb_criar_tabela, madb_adicionar_coluna, madb_definir_fk, madb_adicionar_restricao (check | unique | fk composta), madb_criar_indice, madb_criar_trigger, madb_definir_particao, madb_adicionar_particao, madb_comentar, madb_definir_opcoes, madb_validar, madb_gerar_sql, madb_gerar_mermaid, madb_exportar_json, madb_importar_json, madb_importar_arquivo, madb_limpar e as de remoção (madb_remover_*).

## Como trabalhar
1. Rode madb_ver_modelo e madb_caminho_modelo antes de editar. Não use madb_limpar sem eu pedir.
2. Crie na ordem: schemas e enums, funções, tabelas-pai, tabelas-filha, e só então restrições, índices, triggers e partições. Use `schema.nome_do_enum` como tipo de coluna.
3. FK de uma coluna: `ref` em madb_criar_tabela ou madb_definir_fk. FK composta: madb_adicionar_restricao com tipo "fk". O destino precisa ser PK ou UNIQUE, com as colunas na mesma ordem.
4. Em tabela particionada, a PK e os UNIQUEs precisam incluir a coluna de partição.
5. Nomeie restrições e índices pela convenção do projeto (idx_<tabela>_<colunas> ou ix_<tabela>__<colunas>; ajuste com madb_definir_opcoes).
6. Rode madb_validar depois de cada bloco. Corrija os erros. Explique os avisos e só ignore os intencionais, dizendo quais.
7. Para o SQL completo, use madb_gerar_sql com `salvar_em` e `indices_fk` conforme a decisão do projeto.

## Entrega
- Informe o caminho do arquivo do modelo. Eu vinculo esse arquivo no site (Vincular arquivo…) e o diagrama atualiza sozinho.
- Para um JSON avulso, use madb_exportar_json com `salvar_em`.
- No fim de cada rodada, resuma: o que foi criado ou alterado, o resultado do madb_validar e o que ficou pendente.

## Regras
- Não invente tabelas, colunas, regras ou decisões de negócio. Se não estiver nos documentos do projeto, pergunte.
- Não decida as pendências abertas; liste-as para eu decidir.
- Não grave o modelo real da empresa em repositório público (github.com/cardoscris755/madb é público).
- Se madb_importar_json ou madb_importar_arquivo devolver erro, nada foi alterado: leia o caminho e o motivo, corrija e tente de novo.
- Não altere o modelo que eu estiver editando no site sem me avisar. Se o arquivo tiver mudanças que você não reconhece, rode madb_ver_modelo e pergunte antes de sobrescrever.

Para começar: rode madb_ver_modelo e madb_caminho_modelo e me diga o estado atual.
````

Opcional, para versionar o modelo: acrescentar *"Ao terminar cada rodada, valide, faça commit do arquivo do modelo (repositório privado) com uma mensagem descrevendo a mudança e me avise."*
