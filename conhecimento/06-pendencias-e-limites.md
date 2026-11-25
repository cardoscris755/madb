# 6. Pendências, limites e próximos passos

## O que o MADB não faz
- Views, domínios, sequences avulsas, RLS, grants e extensões não são modelados.
- Não importa DDL existente nem conecta a banco.
- Não há contas, login nem compartilhamento por link (decisão: manter local).
- Não baixa o SQL como arquivo nem o diagrama como imagem pelo site (SQL e Mermaid: **Copiar**; o MCP grava SQL em arquivo com `salvar_em`).
- Não exporta nem importa todas as arquiteturas de uma vez (só uma por vez, pela aba JSON).

## Limites técnicos
- O vínculo com arquivo local depende da File System Access API (Chrome e Edge). Fora deles, usar "Abrir arquivo…".
- A sincronização automática só roda com a aba aberta e visível, e exige nova permissão do navegador depois de recarregar a página.
- Os dados do navegador são por endereço, navegador e perfil; limpar dados do site apaga as arquiteturas. Backup: baixar o `.json`.
- Importação limitada a 8 MB por arquivo.
- Se o arquivo do modelo for editado ao mesmo tempo pelo site e pelo agente, o site pergunta o que fazer; o MCP, por sua vez, grava o arquivo inteiro a cada ferramenta (última escrita vence).

## Riscos para ficar de olho
- Repositório **público**: não subir modelos reais, `.env`, credenciais, nem nomes internos de sistemas. O `.gitignore` já ignora `node_modules/` e `modelos/`.
- Depois de gravar arquivos na máquina do usuário, conferir que o conteúdo chegou atualizado.
- Mudou o `package.json` do MCP? Rodar `npm install` em `mcp/`.

## Pendências de negócio (não são da ferramenta)
Itens abertos do material de integração do modelo do ERP (por exemplo, regra de recompra e índice adicional) são decisões do negócio. O agente deve listá-los, não decidi-los.

## Próximos passos possíveis
1. **Exportar tudo / importar tudo** (backup de todas as arquiteturas num único `.json`).
2. Baixar SQL como arquivo e o diagrama como PNG/SVG.
3. Importar DDL existente.
4. Gerar migrations entre duas versões do modelo.
5. Se um dia houver necessidade de nuvem, reavaliar login com armazenamento (opção Supabase foi estudada e descartada por ora).
