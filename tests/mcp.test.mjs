// Teste de ponta a ponta do MCP: sobe o servidor, modela via ferramentas, valida, gera SQL e faz round-trip.
// Requer `npm install` dentro de mcp/. Rode com: node --test tests/mcp.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const sdk = path.join(root, 'mcp', 'node_modules', '@modelcontextprotocol', 'sdk', 'dist', 'esm', 'client');
const { Client } = await import(path.join(sdk, 'index.js'));
const { StdioClientTransport } = await import(path.join(sdk, 'stdio.js'));
const M = createRequire(import.meta.url)(path.join(root, 'madb-core.js'));

async function sessao(modeloInicial) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'madb-'));
  const file = path.join(dir, 'modelo.json');
  if (modeloInicial) fs.writeFileSync(file, modeloInicial);
  const transport = new StdioClientTransport({ command: process.execPath, args: [path.join(root, 'mcp', 'index.js')], env: { ...process.env, MADB_MODELO: file } });
  const client = new Client({ name: 'teste', version: '1' });
  await client.connect(transport);
  const call = async (name, args = {}) => {
    const r = await client.callTool({ name, arguments: args });
    return { erro: !!r.isError, texto: r.content[0].text };
  };
  return { client, call, file, dir };
}

test('MCP: modela um banco real com FK composta, enum, check, índice parcial, gerada, trigger e partição', async () => {
  const { client, call, file } = await sessao();
  try {
    const tools = (await client.listTools()).tools.map((t) => t.name);
    for (const n of ['madb_criar_enum', 'madb_adicionar_restricao', 'madb_criar_indice', 'madb_criar_trigger', 'madb_definir_particao', 'madb_importar_arquivo']) assert.ok(tools.includes(n), n);

    assert.equal((await call('madb_criar_enum', { nome: 'pedido_status', schema: 'vendas', valores: ['aberto', 'pago'] })).erro, false);
    await call('madb_criar_tabela', { nome: 'clientes', schema: 'vendas', colunas: [{ nome: 'id', tipo: 'uuid', pk: true, padrao: 'gen_random_uuid()' }, { nome: 'documento', tipo: 'varchar(14)', nn: true }] });
    await call('madb_criar_tabela', { nome: 'pedidos', schema: 'vendas', colunas: [
      { nome: 'id', tipo: 'uuid', pk: true }, { nome: 'cliente_id', tipo: 'uuid', nn: true, ref: 'vendas.clientes.id', on_delete: 'RESTRICT' },
      { nome: 'status', tipo: 'vendas.pedido_status', nn: true }, { nome: 'pai_id', tipo: 'uuid', ref: 'pedidos.id' }] });
    await call('madb_adicionar_restricao', { tabela: 'pedidos', schema: 'vendas', tipo: 'unique', nome: 'uq_pedidos__id_cliente', colunas: ['id', 'cliente_id'] });
    const itens = await call('madb_criar_tabela', { nome: 'itens', schema: 'vendas', colunas: [
      { nome: 'id', tipo: 'uuid', pk: true }, { nome: 'pedido_id', tipo: 'uuid', nn: true }, { nome: 'cliente_id', tipo: 'uuid', nn: true },
      { nome: 'quantidade', tipo: 'integer', nn: true }, { nome: 'preco', tipo: 'numeric(14,2)', nn: true },
      { nome: 'subtotal', tipo: 'numeric(14,2)', gerada: 'quantidade * preco' }] });
    assert.equal(itens.erro, false);
    const fk = await call('madb_adicionar_restricao', { tabela: 'itens', schema: 'vendas', tipo: 'fk', nome: 'fk_itens__pedido_cliente', colunas: ['pedido_id', 'cliente_id'], destino: { tabela: 'pedidos', schema: 'vendas', colunas: ['id', 'cliente_id'] }, on_delete: 'CASCADE' });
    assert.equal(fk.erro, false, fk.texto);
    await call('madb_adicionar_restricao', { tabela: 'itens', schema: 'vendas', tipo: 'check', nome: 'ck_itens__quantidade', expressao: 'quantidade > 0' });
    await call('madb_criar_indice', { tabela: 'itens', schema: 'vendas', nome: 'uq_itens__pedido', unico: true, nulls_nao_distintos: true, colunas: ['pedido_id'], onde: 'quantidade > 0' });
    await call('madb_criar_funcao', { nome: 'touch', schema: 'vendas', sql: 'CREATE OR REPLACE FUNCTION vendas.touch() RETURNS trigger AS $$ BEGIN RETURN NEW; END; $$ LANGUAGE plpgsql;' });
    await call('madb_criar_trigger', { tabela: 'pedidos', schema: 'vendas', nome: 'tg_pedidos__touch', momento: 'BEFORE', eventos: ['UPDATE'], funcao: 'vendas.touch' });
    await call('madb_criar_tabela', { nome: 'auditorias', schema: 'vendas', colunas: [{ nome: 'id', tipo: 'bigint', pk: true, identity: 'ALWAYS' }, { nome: 'criado_em', tipo: 'timestamptz', pk: true, padrao: 'now()' }] });
    await call('madb_definir_particao', { tabela: 'auditorias', schema: 'vendas', metodo: 'RANGE', colunas: ['criado_em'] });
    await call('madb_adicionar_particao', { tabela: 'auditorias', schema: 'vendas', nome: 'auditorias_2026_11', limite: "FROM ('2026-11-01') TO ('2026-12-01')" });
    await call('madb_comentar', { alvo: 'tabela', tabela: 'clientes', schema: 'vendas', texto: 'Clientes' });
    await call('madb_definir_opcoes', { nomenclatura_indices: 'ix' });

    const v = await call('madb_validar');
    assert.match(v.texto, /Modelo válido/, v.texto);

    const sql = (await call('madb_gerar_sql', { indices_fk: true })).texto;
    assert.match(sql, /FOREIGN KEY \(pedido_id, cliente_id\)/);
    assert.match(sql, /CREATE INDEX ix_pedidos__cliente_id/);
    assert.match(sql, /GENERATED ALWAYS AS \(quantidade \* preco\) STORED/);
    assert.match(sql, /PARTITION BY RANGE \(criado_em\)/);
    assert.match(sql, /CREATE TYPE vendas\.pedido_status AS ENUM/);

    // o arquivo do modelo está no formato v2 do site e é aceito pelo núcleo
    const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(doc.version, 2);
    const r = M.load(fs.readFileSync(file, 'utf8'));
    assert.deepEqual(r.errors, []);
    assert.equal(M.toSQL(r.model, { fkIndexes: true }), sql);

    // round-trip pelo MCP: exportar, limpar, importar de volta
    const json = (await call('madb_exportar_json')).texto;
    await call('madb_limpar');
    assert.match((await call('madb_ver_modelo')).texto, /sem tabelas/);
    const imp = await call('madb_importar_json', { json });
    assert.equal(imp.erro, false, imp.texto);
    assert.equal((await call('madb_gerar_sql', { indices_fk: true })).texto, sql, 'o SQL é idêntico depois do round-trip');
    assert.equal((await call('madb_exportar_json')).texto, json, 'o JSON é idêntico depois do round-trip');
  } finally { await client.close(); }
});

test('MCP: importação inválida não altera o modelo e devolve erro legível', async () => {
  const { client, call } = await sessao();
  try {
    await call('madb_criar_tabela', { nome: 'a', colunas: [{ nome: 'id', tipo: 'uuid', pk: true }] });
    const ruim = fs.readFileSync(path.join(root, 'exemplos', 'invalido-ref-inexistente.json'), 'utf8');
    const r = await call('madb_importar_json', { json: ruim });
    assert.equal(r.erro, true);
    assert.match(r.texto, /aponta para a tabela "t9", que não existe/);
    assert.match((await call('madb_ver_modelo')).texto, /\na\n/, 'modelo anterior preservado');
    const sint = await call('madb_importar_json', { json: '{"tables": [,]}' });
    assert.match(sint.texto, /linha 1, coluna/);
  } finally { await client.close(); }
});

test('MCP: arquivo no formato antigo (por nomes) é lido, convertido e ganha backup', async () => {
  const antigo = fs.readFileSync(path.join(root, 'exemplos', 'legado-por-nomes.json'), 'utf8');
  const { client, call, file } = await sessao(antigo);
  try {
    assert.match((await call('madb_ver_modelo')).texto, /cliente_id bigint NOT NULL -> clientes\.id/);
    const r = await call('madb_adicionar_coluna', { tabela: 'clientes', coluna: { nome: 'nome', tipo: 'text' } });
    assert.equal(r.erro, false, r.texto);
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).version, 2, 'regravado no formato v2');
    assert.equal(fs.readFileSync(file + '.bak-v1', 'utf8'), antigo, 'backup do arquivo antigo');
  } finally { await client.close(); }
});

test('MCP: remover coluna/tabela limpa referências que ficaram sem destino', async () => {
  const { client, call } = await sessao();
  try {
    await call('madb_criar_tabela', { nome: 'a', colunas: [{ nome: 'id', tipo: 'uuid', pk: true }] });
    await call('madb_criar_tabela', { nome: 'b', colunas: [{ nome: 'id', tipo: 'uuid', pk: true }, { nome: 'a_id', tipo: 'uuid', ref: 'a.id' }] });
    const r = await call('madb_remover_tabela', { tabela: 'a' });
    assert.match(r.texto, /FK b\.a_id removida/);
    assert.doesNotMatch((await call('madb_ver_modelo')).texto, /->/);
  } finally { await client.close(); }
});
