// Leitor de DDL (SQL do PostgreSQL) -> modelo: exemplo, erros e ida e volta com toSQL.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const core = require('../madb-core.js');
const here = path.dirname(fileURLToPath(import.meta.url));
const sql = fs.readFileSync(path.join(here, 'ddl-exemplo.sql'), 'utf8');

test('DDL de exemplo vira modelo válido (tabelas, enum, partição, FK composta, índices, função)', () => {
  const d = core.fromDDL(sql);
  const r = core.load(JSON.stringify(d.json));
  assert.deepEqual(r.errors, []);
  assert.equal(r.model.tables.length, 3);
  assert.equal(r.model.enums[0].name, 'pedido_status');
  const pedidos = r.model.tables.find((t) => t.name === 'pedidos');
  assert.equal(pedidos.partition.by, 'RANGE');
  assert.equal(pedidos.partitions[0].name, 'pedidos_jan');
  const itens = r.model.tables.find((t) => t.name === 'itens');
  assert.equal(itens.constraints.find((k) => k.kind === 'fk').cols.length, 2);
  assert.equal(r.model.functions[0].name, 'f_x');
  assert.match(core.toSQL(r.model, {}), /CREATE TYPE vendas\.pedido_status AS ENUM/);
});

test('ida e volta: SQL gerado pelo MADB é lido de volta sem perder tabelas nem enums', () => {
  const m = core.load(JSON.stringify(core.fromDDL(sql).json)).model;
  const back = core.load(JSON.stringify(core.fromDDL(core.toSQL(m, {})).json));
  assert.deepEqual(back.errors, []);
  assert.equal(back.model.tables.length, m.tables.length);
  assert.equal(back.model.enums.length, m.enums.length);
});

test('comandos sem suporte viram aviso, não erro', () => {
  const d = core.fromDDL('CREATE VIEW v AS SELECT 1;\nCREATE TABLE a (id int PRIMARY KEY);');
  assert.equal(d.json.tables.length, 1);
  assert.ok(d.warnings.some((w) => /sem suporte/.test(w.message)));
});

test('FK com número diferente de colunas gera aviso', () => {
  const d = core.fromDDL('CREATE TABLE p (a int, b int, PRIMARY KEY (a, b));\nCREATE TABLE c (x int, FOREIGN KEY (x) REFERENCES p (a, b));');
  assert.ok(d.warnings.some((w) => /1 coluna\(s\) mas referencia 2/.test(w.message)));
});

test('looksLikeDDL reconhece SQL e não confunde com JSON', () => {
  assert.equal(core.looksLikeDDL(sql), true);
  assert.equal(core.looksLikeDDL('{"version":2,"tables":[]}'), false);
});
