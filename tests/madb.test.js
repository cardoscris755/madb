// Testes do núcleo do MADB (sem dependências). Rode com: node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const M = require('../madb-core.js');

const ex = (f) => fs.readFileSync(path.join(__dirname, '..', 'exemplos', f), 'utf8');
const canon = (model) => M.stableStringify(M.serialize(model));

test('importa um JSON válido completo, sem erros nem avisos', () => {
  const r = M.load(ex('valido-completo.json'));
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.warnings, []);
  assert.deepEqual(M.summary(r.model), { tables: 4, cols: 19, fks: 2, enums: 1, functions: 2, constraints: 5, indexes: 2, triggers: 2, partitions: 3 });
});

test('ref apontando para id de tabela inexistente gera erro legível', () => {
  const r = M.load(ex('invalido-ref-inexistente.json'));
  assert.equal(r.errors.length, 1);
  assert.equal(r.errors[0].path, 'tables[1].cols[1].ref');
  assert.match(r.errors[0].message, /tables\[1\]\.cols\[1\]\.ref aponta para a tabela "t9", que não existe/);
  assert.match(r.errors[0].message, /pedidos\.cliente_id/);
});

test('ref apontando para id de coluna inexistente gera erro legível', () => {
  const r = M.load(ex('invalido-coluna-inexistente.json'));
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0].message, /id de coluna "t1c9", que não existe na tabela "a"/);
});

test('erro de sintaxe informa linha e coluna', () => {
  const r = M.load(ex('invalido-sintaxe.json'));
  assert.equal(r.model, null);
  assert.equal(r.errors[0].line, 4);
  assert.equal(r.errors[0].column, 3);
  assert.match(r.errors[0].message, /vírgula sobrando/);
});

test('ids duplicados são rejeitados', () => {
  const obj = JSON.parse(ex('valido-completo.json'));
  obj.tables[1].id = 't1';
  const r = M.loadObject(obj);
  assert.ok(r.errors.some((e) => /duplicado/.test(e.message) && e.path === 'tables[1].id'));
});

test('formato antigo (referências por nome) é aceito e convertido', () => {
  const r = M.load(ex('legado-por-nomes.json'));
  assert.deepEqual(r.errors, []);
  assert.equal(r.legacy, true);
  const [cli, ped] = r.model.tables;
  assert.deepEqual(ped.cols[1].ref, { t: cli.id, c: cli.cols[0].id });
  assert.ok(r.notes.some((n) => /Formato antigo/.test(n.message)));
});

test('"GENERATED ... AS IDENTITY" dentro do tipo vira o campo identity', () => {
  const r = M.loadObject({ tables: [{ id: 't1', name: 'a', schema: 'public', cols: [{ id: 't1c1', name: 'id', type: 'bigint GENERATED ALWAYS AS IDENTITY', pk: true }] }] });
  assert.deepEqual(r.errors, []);
  assert.equal(r.model.tables[0].cols[0].type, 'bigint');
  assert.equal(r.model.tables[0].cols[0].identity, 'ALWAYS');
  assert.match(M.toSQL(r.model), /id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY/);
});

test('colar o texto e abrir por arquivo (BOM e CRLF) dão o mesmo resultado', () => {
  const texto = ex('valido-completo.json');
  const comoArquivo = '﻿' + texto.replace(/\n/g, '\r\n');
  assert.equal(canon(M.load(texto).model), canon(M.load(comoArquivo).model));
});

test('round-trip: exportar e importar de volta não perde nada', () => {
  for (const f of ['valido-completo.json', 'legado-por-nomes.json']) {
    const a = M.load(ex(f)).model;
    const json1 = M.exportJSON(a);
    const b = M.load(json1);
    assert.deepEqual(b.errors, [], f);
    assert.equal(canon(b.model), canon(a), f + ' (modelo)');
    assert.equal(M.exportJSON(b.model), json1, f + ' (texto idêntico na segunda volta)');
    assert.equal(M.toSQL(b.model, { fkIndexes: true }), M.toSQL(a, { fkIndexes: true }), f + ' (SQL)');
  }
});

test('SQL: FK composta, enum, check, índice parcial, coluna gerada, trigger e partição', () => {
  const sql = M.toSQL(M.load(ex('valido-completo.json')).model, { fkIndexes: true });
  assert.match(sql, /CREATE TYPE vendas\.pedido_status AS ENUM \('rascunho', 'aberto', 'pago', 'cancelado'\);/);
  assert.match(sql, /FOREIGN KEY \(pedido_id, cliente_id\)\n\s+REFERENCES vendas\.pedidos \(id, cliente_id\) ON DELETE CASCADE;/);
  assert.match(sql, /CHECK \(total >= 0\)/);
  assert.match(sql, /CREATE UNIQUE INDEX uq_itens__pedido_sku ON vendas\.itens_pedido \(pedido_id, sku\) NULLS NOT DISTINCT WHERE quantidade > 0;/);
  assert.match(sql, /subtotal numeric\(14,2\) GENERATED ALWAYS AS \(quantidade \* preco_unit\) STORED NOT NULL/);
  assert.match(sql, /CREATE TRIGGER tg_auditorias__imutavel\n\s+BEFORE UPDATE OR DELETE ON vendas\.auditorias/);
  assert.match(sql, /\) PARTITION BY RANGE \(criado_em\);/);
  assert.match(sql, /CREATE TABLE vendas\.auditorias_default PARTITION OF vendas\.auditorias DEFAULT;/);
  assert.match(sql, /COMMENT ON COLUMN vendas\.itens_pedido\.subtotal IS 'Calculado pelo banco';/);
  // ordem: schemas, tipos, funções, tabelas, FKs, índices, checks, comentários, triggers
  const ordem = ['CREATE SCHEMA', 'CREATE TYPE', 'CREATE OR REPLACE FUNCTION', 'CREATE TABLE', 'ADD CONSTRAINT fk_itens', 'CREATE INDEX', 'CHECK (total', 'COMMENT ON', 'CREATE TRIGGER'];
  const pos = ordem.map((s) => sql.indexOf(s));
  assert.ok(pos.every((p) => p >= 0), 'todos presentes');
  assert.deepEqual(pos, pos.slice().sort((a, b) => a - b), 'ordem correta');
});

test('SQL: opção de índices nas FKs e convenção de nomes ix_', () => {
  const m = M.load(ex('valido-completo.json')).model;
  assert.doesNotMatch(M.toSQL(m), /ix_pedidos__cliente_id/);
  assert.match(M.toSQL(m, { fkIndexes: true }), /CREATE INDEX ix_pedidos__cliente_id ON vendas\.pedidos \(cliente_id\);/);
  assert.match(M.toSQL(m, { fkIndexes: true, indexNaming: 'idx' }), /CREATE INDEX idx_pedidos_cliente_id/);
});

test('validação: FK composta para colunas sem PK/UNIQUE é erro', () => {
  const obj = JSON.parse(ex('valido-completo.json'));
  obj.tables[1].constraints = obj.tables[1].constraints.filter((k) => k.kind !== 'unique');
  const r = M.loadObject(obj);
  assert.ok(r.errors.some((e) => /não é PRIMARY KEY nem UNIQUE|não é PRIMARY KEY/.test(e.message) || /esse conjunto não é PRIMARY KEY nem UNIQUE/.test(e.message)));
});

test('validação: identity em tipo não inteiro, gerada com default e partição sem PK', () => {
  const r = M.loadObject({ tables: [
    { id: 't1', name: 'a', schema: 'public', cols: [
      { id: 't1c1', name: 'id', type: 'text', pk: true, identity: 'ALWAYS' },
      { id: 't1c2', name: 'v', type: 'integer', generated: 'id * 2', def: '1' },
      { id: 't1c3', name: 'dt', type: 'date' }
    ], partition: { by: 'RANGE', cols: ['dt'] } }
  ] });
  const msgs = r.errors.map((e) => e.message).join('\n');
  assert.match(msgs, /identity, mas o tipo "text" não é inteiro/);
  assert.match(msgs, /coluna gerada e tem DEFAULT/);
  assert.match(msgs, /PRIMARY KEY, e ela precisa incluir a coluna de partição \(dt\)/);
});

test('validação: aridade da FK composta e referências por nome em constraints', () => {
  const r = M.loadObject({ tables: [
    { id: 't1', name: 'a', schema: 'public', cols: [{ id: 't1c1', name: 'x', type: 'int', pk: true }, { id: 't1c2', name: 'y', type: 'int', pk: true }] },
    { id: 't2', name: 'b', schema: 'public', cols: [{ id: 't2c1', name: 'x', type: 'int' }, { id: 't2c2', name: 'y', type: 'int' }],
      constraints: [{ kind: 'fk', cols: ['x', 'y'], ref: { t: 'a', cols: ['x'] } }] }
  ] });
  assert.ok(r.errors.some((e) => /2 coluna\(s\) locais e 1 referenciada/.test(e.message)));
  const ok = M.loadObject({ tables: [
    { id: 't1', name: 'a', schema: 'public', cols: [{ id: 't1c1', name: 'x', type: 'int', pk: true }, { id: 't1c2', name: 'y', type: 'int', pk: true }] },
    { id: 't2', name: 'b', schema: 'public', cols: [{ id: 't2c1', name: 'x', type: 'int' }, { id: 't2c2', name: 'y', type: 'int' }],
      constraints: [{ kind: 'fk', cols: ['x', 'y'], ref: { t: 'a', cols: ['x', 'y'] } }] }
  ] });
  assert.deepEqual(ok.errors, [], 'nomes no lugar de ids são aceitos e resolvidos');
  assert.deepEqual(ok.model.tables[1].constraints[0].cols, ['t2c1', 't2c2']);
});

test('Mermaid inclui as relações, também as compostas', () => {
  const mmd = M.toMermaid(M.load(ex('valido-completo.json')).model);
  assert.match(mmd, /^erDiagram/);
  assert.match(mmd, /vendas_pedidos \|\|--o\{ vendas_itens_pedido : "pedido_id_cliente_id"/);
});

test('newId gera ids únicos', () => {
  const m = M.load(ex('valido-completo.json')).model;
  assert.equal(M.newId(m, 'table'), 't5');
  assert.equal(M.newId(m, 'col', m.tables[0]), 't1c4');
  assert.equal(M.newId(m, 'enum'), 'e2');
  assert.equal(M.newId(m, 'constraint', m.tables[1]), 't2k3');
});
