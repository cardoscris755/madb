/*
 * MADB core — formato do modelo (v2), validação, geração de SQL PostgreSQL e Mermaid.
 * Sem DOM e sem dependências: o mesmo arquivo roda no site (<script>) e no MCP (require).
 *
 * Formato canônico (v2). Campos novos são opcionais; arquivos antigos continuam válidos.
 * Veja FORMATO.md para a documentação completa.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MADB = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var FORMAT_VERSION = 2;
  var DEL_ACTIONS = ['NO ACTION', 'CASCADE', 'SET NULL', 'RESTRICT'];
  var TRIGGER_EVENTS = ['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'];
  var TRIGGER_TIMING = ['BEFORE', 'AFTER', 'INSTEAD OF'];
  var PARTITION_METHODS = ['RANGE', 'LIST', 'HASH'];
  var INT_TYPES = ['smallint', 'integer', 'int', 'int2', 'int4', 'int8', 'bigint'];
  var RES = {};
  ('user order group table select column check default end from to limit offset primary references unique desc asc all analyse analyze both case cast create current_user distinct do else for grant having in into leading not null on only or placing some then trailing union using when where with')
    .split(' ').forEach(function (w) { RES[w] = 1; });

  /* ---------------- utilidades ---------------- */
  function isObj(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
  function str(v) { return v == null ? '' : String(v); }
  function num(v) { return typeof v === 'number' && isFinite(v) ? v : null; }
  function q(n) { return (/^[a-z_][a-z0-9_]*$/.test(n) && !RES[n]) ? n : '"' + String(n).replace(/"/g, '""') + '"'; }
  function qn(schema, name) { return (schema && schema !== 'public' ? q(schema) + '.' : '') + q(name); }
  function lit(s) { return "'" + String(s).replace(/'/g, "''") + "'"; }
  function baseType(ty) {
    var l = String(ty).toLowerCase().trim();
    if (l === 'serial' || l === 'serial4') return 'integer';
    if (l === 'bigserial' || l === 'serial8') return 'bigint';
    if (l === 'smallserial' || l === 'serial2') return 'smallint';
    if (l === 'int' || l === 'int4') return 'integer';
    if (l === 'int8') return 'bigint';
    if (l === 'int2') return 'smallint';
    return l;
  }
  function stableStringify(v) {
    if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']';
    if (isObj(v)) return '{' + Object.keys(v).sort().map(function (k) { return JSON.stringify(k) + ':' + stableStringify(v[k]); }).join(',') + '}';
    return JSON.stringify(v);
  }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  /* ---------------- JSON com localização de erro ---------------- */
  // Localiza o primeiro erro de sintaxe de um JSON (o JSON.parse nativo nem sempre informa a posição).
  function locateJSONError(text) {
    var i = 0, n = text.length;
    function fail(pos, msg) { throw { pos: pos, msg: msg }; }
    function ws() { while (i < n && ' \t\r\n'.indexOf(text[i]) >= 0) i++; }
    function string() {
      i++;
      while (i < n) {
        var c = text[i];
        if (c === '"') { i++; return; }
        if (c === '\\') { i += 2; continue; }
        if (c === '\n') fail(i, 'quebra de linha dentro de um texto entre aspas');
        i++;
      }
      fail(n, 'um texto entre aspas não foi fechado');
    }
    function number() {
      var re = /-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?/y; re.lastIndex = i;
      var m = re.exec(text); if (!m) fail(i, 'número inválido'); i += m[0].length;
    }
    function value() {
      ws();
      if (i >= n) fail(i, 'o texto terminou antes do esperado; falta um valor');
      var c = text[i];
      if (c === '{') return obj();
      if (c === '[') return arr();
      if (c === '"') return string();
      if (c === '-' || (c >= '0' && c <= '9')) return number();
      var words = ['true', 'false', 'null'];
      for (var k = 0; k < words.length; k++) if (text.substr(i, words[k].length) === words[k]) { i += words[k].length; return; }
      fail(i, 'caractere inesperado "' + c + '"');
    }
    function obj() {
      i++; ws();
      if (text[i] === '}') { i++; return; }
      for (;;) {
        ws();
        if (text[i] === '}') fail(i, 'vírgula sobrando antes de "}"');
        if (text[i] !== '"') fail(i, 'esperava o nome de uma propriedade entre aspas');
        string(); ws();
        if (text[i] !== ':') fail(i, 'esperava ":" depois do nome da propriedade');
        i++; value(); ws();
        if (text[i] === ',') { i++; continue; }
        if (text[i] === '}') { i++; return; }
        fail(i, 'esperava "," ou "}" (talvez falte uma vírgula entre propriedades)');
      }
    }
    function arr() {
      i++; ws();
      if (text[i] === ']') { i++; return; }
      for (;;) {
        ws();
        if (text[i] === ']') fail(i, 'vírgula sobrando antes de "]"');
        value(); ws();
        if (text[i] === ',') { i++; continue; }
        if (text[i] === ']') { i++; return; }
        fail(i, 'esperava "," ou "]" (talvez falte uma vírgula entre itens)');
      }
    }
    try { value(); ws(); if (i < n) fail(i, 'há conteúdo depois do fim do JSON'); return null; }
    catch (e) { if (e && typeof e.pos === 'number') return e; throw e; }
  }
  function lineCol(text, pos) {
    var before = text.slice(0, pos);
    return { line: before.split('\n').length, column: pos - before.lastIndexOf('\n') };
  }
  function parseJSON(text) {
    text = String(text == null ? '' : text).replace(/^﻿/, '');
    if (!text.trim()) return { ok: false, error: { path: '(JSON)', message: 'O conteúdo está vazio.', line: 1, column: 1 } };
    try { return { ok: true, value: JSON.parse(text) }; }
    catch (e) {
      var loc = null; try { loc = locateJSONError(text); } catch (_) { loc = null; }
      if (loc) {
        var lc = lineCol(text, loc.pos);
        return { ok: false, error: { path: '(JSON)', message: 'JSON inválido na linha ' + lc.line + ', coluna ' + lc.column + ': ' + loc.msg + '.', line: lc.line, column: lc.column } };
      }
      return { ok: false, error: { path: '(JSON)', message: 'JSON inválido: ' + String(e && e.message || e), line: null, column: null } };
    }
  }

  /* ---------------- ids ---------------- */
  function maxSuffix(ids, re) {
    var max = 0;
    ids.forEach(function (id) { var m = String(id).match(re); if (m) max = Math.max(max, +m[1]); });
    return max;
  }
  // Gera um id novo e único. kind: table | col | constraint | index | trigger | partition | enum | function
  function newId(model, kind, table) {
    var P = { table: 't', enum: 'e', function: 'f' };
    var S = { col: 'c', constraint: 'k', index: 'i', trigger: 'g', partition: 'p' };
    var list, prefix, re;
    if (P[kind]) {
      prefix = P[kind];
      list = kind === 'table' ? model.tables : kind === 'enum' ? (model.enums || []) : (model.functions || []);
      re = new RegExp('^' + prefix + '(\\d+)$');
      return prefix + (maxSuffix(list.map(function (x) { return x.id; }), re) + 1);
    }
    var key = { col: 'cols', constraint: 'constraints', index: 'indexes', trigger: 'triggers', partition: 'partitions' }[kind];
    prefix = table.id + S[kind];
    re = new RegExp('^' + prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(\\d+)$');
    return prefix + (maxSuffix((table[key] || []).map(function (x) { return x.id; }), re) + 1);
  }

  /* ---------------- consulta ---------------- */
  function findTable(model, name, schema) {
    var hits = model.tables.filter(function (t) { return t.name === name && (!schema || t.schema === schema); });
    return hits.length === 1 || (hits.length > 1 && schema) ? hits[0] : (hits.length > 1 ? hits.filter(function (t) { return t.schema === 'public'; })[0] || hits[0] : null);
  }
  function tableById(model, id) { return model.tables.filter(function (t) { return t.id === id; })[0] || null; }
  function findCol(table, name) { return table ? table.cols.filter(function (c) { return c.name === name; })[0] || null : null; }
  function colById(table, id) { return table ? table.cols.filter(function (c) { return c.id === id; })[0] || null : null; }
  function tname(t) { return (t.schema && t.schema !== 'public' ? t.schema + '.' : '') + t.name; }

  /* ---------------- normalização / leitura ---------------- */
  var IDENT_RE = /\s+GENERATED\s+(ALWAYS|BY\s+DEFAULT)\s+AS\s+IDENTITY\s*$/i;

  function normalize(raw) {
    var errors = [], warnings = [], notes = [];
    function E(path, message) { errors.push({ path: path, message: message }); }
    function N(path, message) { notes.push({ path: path, message: message }); }
    if (!isObj(raw) || !Array.isArray(raw.tables)) {
      E('(raiz)', 'O JSON precisa ser um objeto com a chave "tables" (uma lista de tabelas).');
      return { model: null, errors: errors, warnings: warnings, notes: notes };
    }
    var legacy = false;
    var model = { version: FORMAT_VERSION, options: {}, schemas: [], enums: [], functions: [], tables: [] };

    /* opções */
    if (isObj(raw.options)) {
      if (raw.options.indexNaming != null) {
        if (raw.options.indexNaming === 'idx' || raw.options.indexNaming === 'ix') model.options.indexNaming = raw.options.indexNaming;
        else E('options.indexNaming', 'indexNaming deve ser "idx" ou "ix".');
      }
    }
    /* schemas */
    (Array.isArray(raw.schemas) ? raw.schemas : []).forEach(function (s, i) {
      var name = isObj(s) ? str(s.name) : str(s);
      if (!name) { E('schemas[' + i + ']', 'schema sem nome.'); return; }
      var o = { name: name }; if (isObj(s) && s.comment) o.comment = str(s.comment);
      model.schemas.push(o);
    });

    /* tabelas — passo 1: estrutura e ids */
    var used = {}, list = [];
    raw.tables.forEach(function (rt, i) {
      var p = 'tables[' + i + ']';
      if (!isObj(rt)) { E(p, 'cada tabela precisa ser um objeto.'); return; }
      var t = { id: null, name: str(rt.name), schema: str(rt.schema) || 'public', x: num(rt.x), y: num(rt.y), cols: [], _raw: rt, _i: i, _p: p };
      if (!t.name) E(p + '.name', 'a tabela na posição ' + i + ' não tem nome.');
      if (rt.comment) t.comment = str(rt.comment);
      if (typeof rt.id === 'string' && rt.id) {
        if (used[rt.id] != null) E(p + '.id', 'o id "' + rt.id + '" está duplicado (também em tables[' + used[rt.id] + ']).');
        else { used[rt.id] = i; t.id = rt.id; }
      }
      list.push(t);
    });
    var seq = 0;
    list.forEach(function (t) {
      if (!t.id) { do { seq++; } while (used['t' + seq] != null); t.id = 't' + seq; used[t.id] = t._i; legacy = legacy || !t._raw.id; }
    });

    /* colunas */
    list.forEach(function (t) {
      var rc = Array.isArray(t._raw.cols) ? t._raw.cols : null;
      if (!rc) { E(t._p + '.cols', 'a tabela "' + t.name + '" precisa de uma lista "cols".'); return; }
      var usedC = {};
      rc.forEach(function (c, j) {
        var p = t._p + '.cols[' + j + ']';
        if (!isObj(c)) { E(p, 'cada coluna precisa ser um objeto.'); return; }
        var col = { id: null, name: str(c.name), type: str(c.type) || 'text', pk: !!c.pk, nn: !!c.nn || !!c.pk, uq: !!c.uq, def: c.def == null ? '' : str(c.def), ref: null, del: 'NO ACTION', _r: c.ref, _p: p };
        if (!col.name) E(p + '.name', 'coluna sem nome em "' + t.name + '" (posição ' + j + ').');
        if (c.del != null) {
          if (DEL_ACTIONS.indexOf(c.del) >= 0) col.del = c.del;
          else E(p + '.del', 'ON DELETE inválido "' + c.del + '" em ' + t.name + '.' + col.name + '. Use ' + DEL_ACTIONS.join(', ') + '.');
        }
        var identity = c.identity ? str(c.identity).toUpperCase().replace(/\s+/g, ' ') : null;
        var m = col.type.match(IDENT_RE);
        if (m) {
          col.type = col.type.replace(IDENT_RE, '').trim();
          identity = m[1].toUpperCase().replace(/\s+/g, ' ');
          N(p + '.type', 'A coluna ' + t.name + '.' + col.name + ' trazia "GENERATED … AS IDENTITY" dentro do tipo; movido para o campo "identity".');
        }
        if (identity) {
          if (identity === 'ALWAYS' || identity === 'BY DEFAULT') col.identity = identity;
          else E(p + '.identity', 'identity inválido "' + identity + '" em ' + t.name + '.' + col.name + '. Use ALWAYS ou BY DEFAULT.');
        }
        if (c.generated) col.generated = str(c.generated);
        if (c.comment) col.comment = str(c.comment);
        if (typeof c.id === 'string' && c.id) {
          if (usedC[c.id]) E(p + '.id', 'o id de coluna "' + c.id + '" está duplicado na tabela "' + t.name + '".');
          else { usedC[c.id] = 1; col.id = c.id; }
        }
        t.cols.push(col);
      });
      var s = 0;
      t.cols.forEach(function (col) { if (!col.id) { do { s++; } while (usedC[t.id + 'c' + s]); col.id = t.id + 'c' + s; usedC[col.id] = 1; } });
    });

    /* resolvedores flexíveis (id, "schema.nome" ou nome) */
    var byId = {}, byKey = {}, byName = {};
    list.forEach(function (t) { byId[t.id] = t; byKey[t.schema + '.' + t.name] = t; (byName[t.name] = byName[t.name] || []).push(t); });
    function resolveTable(x) {
      if (x == null) return null;
      if (isObj(x)) { if (x.t != null) return resolveTable(x.t); if (x.table != null) return resolveTable(x.schema ? x.schema + '.' + x.table : x.table); return null; }
      x = str(x);
      if (byId[x]) return byId[x];
      if (byKey[x]) return byKey[x];
      if (byName[x] && byName[x].length === 1) return byName[x][0];
      if (byName[x]) { var pub = byName[x].filter(function (t) { return t.schema === 'public'; }); if (pub.length === 1) return pub[0]; }
      return null;
    }
    function resolveCol(t, x) {
      if (x == null || !t) return null;
      x = str(x);
      return t.cols.filter(function (c) { return c.id === x; })[0] || t.cols.filter(function (c) { return c.name === x; })[0] || null;
    }
    function resolveCols(t, arr, path, label) {
      var out = [];
      if (!Array.isArray(arr) || !arr.length) { E(path, label + ': informe a lista de colunas.'); return null; }
      for (var k = 0; k < arr.length; k++) {
        var c = resolveCol(t, isObj(arr[k]) ? (arr[k].c != null ? arr[k].c : arr[k].name) : arr[k]);
        if (!c) { E(path + '[' + k + ']', label + ': a coluna "' + str(isObj(arr[k]) ? arr[k].c : arr[k]) + '" não existe na tabela "' + t.name + '".'); return null; }
        out.push(c.id);
      }
      return out;
    }

    /* FK simples (coluna) */
    list.forEach(function (t) {
      t.cols.forEach(function (col) {
        var r = col._r; delete col._r;
        if (r == null) return;
        var p = col._p + '.ref';
        if (!isObj(r)) { E(p, 'ref de ' + t.name + '.' + col.name + ' precisa ser null ou um objeto {"t": id da tabela, "c": id da coluna}.'); return; }
        var legacyRef = r.t == null && r.table != null;
        if (legacyRef) legacy = true;
        var rt = resolveTable(r);
        if (!rt) {
          E(p, p + ' aponta para ' + (legacyRef ? 'a tabela "' + (r.schema ? r.schema + '.' : '') + r.table + '"' : 'a tabela "' + str(r.t) + '"') + ', que não existe (FK de ' + t.name + '.' + col.name + ').');
          return;
        }
        var rcol = resolveCol(rt, legacyRef ? r.col : r.c);
        if (!rcol) {
          E(p, p + ' aponta para ' + (legacyRef ? 'a coluna "' + str(r.col) + '"' : 'o id de coluna "' + str(r.c) + '"') + ', que não existe na tabela "' + rt.name + '" (FK de ' + t.name + '.' + col.name + ').');
          return;
        }
        col.ref = { t: rt.id, c: rcol.id };
      });
      delete t._p;
    });

    /* detalhes por tabela: constraints, índices, triggers, partição */
    list.forEach(function (t) {
      var raw = t._raw, p = 'tables[' + t._i + ']';
      var usedIds = {};
      function takeId(rawId, kind, path) {
        if (typeof rawId === 'string' && rawId) {
          if (usedIds[rawId]) { E(path + '.id', 'o id "' + rawId + '" está duplicado dentro da tabela "' + t.name + '".'); return null; }
          usedIds[rawId] = 1; return rawId;
        }
        return null;
      }
      function fill(arr, suffix) {
        var n = 0;
        arr.forEach(function (o) { if (!o.id) { do { n++; } while (usedIds[t.id + suffix + n]); o.id = t.id + suffix + n; usedIds[o.id] = 1; } });
      }
      t.cols.forEach(function (c) { usedIds[c.id] = 1; });

      /* constraints */
      var cons = [];
      (Array.isArray(raw.constraints) ? raw.constraints : []).forEach(function (rk, i) {
        var pp = p + '.constraints[' + i + ']';
        if (!isObj(rk)) { E(pp, 'a restrição precisa ser um objeto.'); return; }
        var kind = str(rk.kind).toLowerCase();
        var k = { id: takeId(rk.id, 'k', pp), name: str(rk.name), kind: kind };
        if (['check', 'unique', 'fk'].indexOf(kind) < 0) { E(pp + '.kind', 'tipo de restrição inválido "' + str(rk.kind) + '" em "' + t.name + '". Use check, unique ou fk.'); return; }
        if (kind === 'check') {
          if (!str(rk.expr).trim()) { E(pp + '.expr', 'CHECK' + (k.name ? ' "' + k.name + '"' : '') + ' em "' + t.name + '" está sem expressão.'); return; }
          k.expr = str(rk.expr);
        } else if (kind === 'unique') {
          var uc = resolveCols(t, rk.cols, pp + '.cols', 'UNIQUE' + (k.name ? ' "' + k.name + '"' : '') + ' em "' + t.name + '"'); if (!uc) return;
          k.cols = uc; if (rk.nullsNotDistinct) k.nullsNotDistinct = true;
        } else {
          var fc = resolveCols(t, rk.cols, pp + '.cols', 'FK' + (k.name ? ' "' + k.name + '"' : '') + ' em "' + t.name + '"'); if (!fc) return;
          var ref = rk.ref;
          if (!isObj(ref)) { E(pp + '.ref', 'FK composta em "' + t.name + '" precisa de "ref": {"t": id da tabela, "cols": [ids das colunas]}.'); return; }
          var rt = resolveTable(ref);
          if (!rt) { E(pp + '.ref.t', 'a FK "' + (k.name || fc.join(',')) + '" de "' + t.name + '" aponta para a tabela "' + str(ref.t != null ? ref.t : ref.table) + '", que não existe.'); return; }
          var rcs = resolveCols(rt, ref.cols, pp + '.ref.cols', 'FK "' + (k.name || fc.join(',')) + '" de "' + t.name + '" → "' + rt.name + '"'); if (!rcs) return;
          if (rcs.length !== fc.length) { E(pp, 'a FK de "' + t.name + '" tem ' + fc.length + ' coluna(s) locais e ' + rcs.length + ' referenciada(s); as quantidades precisam ser iguais.'); return; }
          k.cols = fc; k.ref = { t: rt.id, cols: rcs };
          if (rk.del != null) { if (DEL_ACTIONS.indexOf(rk.del) >= 0) k.del = rk.del; else { E(pp + '.del', 'ON DELETE inválido "' + rk.del + '" em "' + t.name + '".'); return; } }
          else k.del = 'NO ACTION';
        }
        cons.push(k);
      });
      fill(cons, 'k');
      if (cons.length) t.constraints = cons;

      /* índices */
      var idxs = [];
      (Array.isArray(raw.indexes) ? raw.indexes : []).forEach(function (ri, i) {
        var pp = p + '.indexes[' + i + ']';
        if (!isObj(ri)) { E(pp, 'o índice precisa ser um objeto.'); return; }
        var x = { id: takeId(ri.id, 'i', pp), name: str(ri.name), cols: [] };
        if (!x.name) { E(pp + '.name', 'índice sem nome em "' + t.name + '".'); return; }
        if (!Array.isArray(ri.cols) || !ri.cols.length) { E(pp + '.cols', 'o índice "' + x.name + '" não tem colunas.'); return; }
        var bad = false;
        ri.cols.forEach(function (ic, k) {
          if (bad) return;
          var item = isObj(ic) ? ic : { c: ic };
          var e = {};
          if (item.expr != null) { if (!str(item.expr).trim()) { E(pp + '.cols[' + k + ']', 'expressão vazia no índice "' + x.name + '".'); bad = true; return; } e.expr = str(item.expr); }
          else {
            var c = resolveCol(t, item.c != null ? item.c : item.name);
            if (!c) { E(pp + '.cols[' + k + ']', 'o índice "' + x.name + '" usa a coluna "' + str(item.c != null ? item.c : item.name) + '", que não existe na tabela "' + t.name + '".'); bad = true; return; }
            e.c = c.id;
          }
          if (item.order) { var o = str(item.order).toUpperCase(); if (o === 'ASC' || o === 'DESC') e.order = o; else { E(pp + '.cols[' + k + '].order', 'ordem inválida "' + item.order + '" (use ASC ou DESC).'); bad = true; return; } }
          if (item.nulls) { var nn = str(item.nulls).toUpperCase(); if (nn === 'FIRST' || nn === 'LAST') e.nulls = nn; else { E(pp + '.cols[' + k + '].nulls', 'NULLS inválido "' + item.nulls + '" (use FIRST ou LAST).'); bad = true; return; } }
          x.cols.push(e);
        });
        if (bad) return;
        if (ri.unique) x.unique = true;
        if (ri.where) x.where = str(ri.where);
        if (ri.nullsNotDistinct) x.nullsNotDistinct = true;
        if (ri.method) x.method = str(ri.method).toLowerCase();
        idxs.push(x);
      });
      fill(idxs, 'i');
      if (idxs.length) t.indexes = idxs;

      /* triggers */
      var trs = [];
      (Array.isArray(raw.triggers) ? raw.triggers : []).forEach(function (rt2, i) {
        var pp = p + '.triggers[' + i + ']';
        if (!isObj(rt2)) { E(pp, 'o trigger precisa ser um objeto.'); return; }
        var g = { id: takeId(rt2.id, 'g', pp), name: str(rt2.name), timing: str(rt2.timing).toUpperCase(), events: [], level: str(rt2.level || 'ROW').toUpperCase(), function: str(rt2.function) };
        if (!g.name) { E(pp + '.name', 'trigger sem nome em "' + t.name + '".'); return; }
        if (TRIGGER_TIMING.indexOf(g.timing) < 0) { E(pp + '.timing', 'momento inválido "' + str(rt2.timing) + '" no trigger "' + g.name + '". Use ' + TRIGGER_TIMING.join(', ') + '.'); return; }
        var evs = Array.isArray(rt2.events) ? rt2.events.map(function (e) { return str(e).toUpperCase(); }) : [];
        if (!evs.length || evs.some(function (e) { return TRIGGER_EVENTS.indexOf(e) < 0; })) { E(pp + '.events', 'eventos inválidos no trigger "' + g.name + '". Use ' + TRIGGER_EVENTS.join(', ') + '.'); return; }
        g.events = evs;
        if (g.level !== 'ROW' && g.level !== 'STATEMENT') { E(pp + '.level', 'level inválido "' + g.level + '" no trigger "' + g.name + '" (use ROW ou STATEMENT).'); return; }
        if (!g.function) { E(pp + '.function', 'o trigger "' + g.name + '" não informa a função.'); return; }
        if (rt2.when) g.when = str(rt2.when);
        trs.push(g);
      });
      fill(trs, 'g');
      if (trs.length) t.triggers = trs;

      /* partição */
      if (raw.partition != null) {
        var pp2 = p + '.partition', pr = raw.partition;
        if (!isObj(pr)) E(pp2, 'partition precisa ser um objeto {"by": "RANGE", "cols": [...]}.');
        else {
          var by = str(pr.by).toUpperCase();
          if (PARTITION_METHODS.indexOf(by) < 0) E(pp2 + '.by', 'método de partição inválido "' + str(pr.by) + '" em "' + t.name + '". Use ' + PARTITION_METHODS.join(', ') + '.');
          else { var pcs = resolveCols(t, pr.cols, pp2 + '.cols', 'partição de "' + t.name + '"'); if (pcs) t.partition = { by: by, cols: pcs }; }
        }
      }
      var parts = [];
      (Array.isArray(raw.partitions) ? raw.partitions : []).forEach(function (rp, i) {
        var pp = p + '.partitions[' + i + ']';
        if (!isObj(rp)) { E(pp, 'a partição precisa ser um objeto.'); return; }
        var o = { id: takeId(rp.id, 'p', pp), name: str(rp.name), bound: str(rp.bound) };
        if (rp.schema) o.schema = str(rp.schema);
        if (!o.name) { E(pp + '.name', 'partição sem nome em "' + t.name + '".'); return; }
        if (!o.bound.trim()) { E(pp + '.bound', 'a partição "' + o.name + '" não tem limite ("bound"), ex.: "FROM (\'2026-11-01\') TO (\'2026-12-01\')" ou "DEFAULT".'); return; }
        parts.push(o);
      });
      fill(parts, 'p');
      if (parts.length) t.partitions = parts;
      if (parts.length && !t.partition) E(p + '.partitions', 'a tabela "' + t.name + '" tem partições mas não define "partition" (método e colunas).');
    });

    /* enums */
    var usedE = {};
    (Array.isArray(raw.enums) ? raw.enums : []).forEach(function (re, i) {
      var p = 'enums[' + i + ']';
      if (!isObj(re)) { E(p, 'o enum precisa ser um objeto.'); return; }
      var e = { id: null, schema: str(re.schema) || 'public', name: str(re.name), values: Array.isArray(re.values) ? re.values.map(str) : [] };
      if (!e.name) { E(p + '.name', 'enum sem nome.'); return; }
      if (!e.values.length) { E(p + '.values', 'o enum "' + e.name + '" não tem valores.'); return; }
      if (re.comment) e.comment = str(re.comment);
      if (typeof re.id === 'string' && re.id) { if (usedE[re.id]) { E(p + '.id', 'o id de enum "' + re.id + '" está duplicado.'); return; } usedE[re.id] = 1; e.id = re.id; }
      model.enums.push(e);
    });
    var en = 0; model.enums.forEach(function (e) { if (!e.id) { do { en++; } while (usedE['e' + en]); e.id = 'e' + en; usedE[e.id] = 1; } });

    /* funções */
    var usedF = {};
    (Array.isArray(raw.functions) ? raw.functions : []).forEach(function (rf, i) {
      var p = 'functions[' + i + ']';
      if (!isObj(rf)) { E(p, 'a função precisa ser um objeto.'); return; }
      var f = { id: null, schema: str(rf.schema) || 'public', name: str(rf.name), sql: str(rf.sql) };
      if (!f.name) { E(p + '.name', 'função sem nome.'); return; }
      if (!f.sql.trim()) { E(p + '.sql', 'a função "' + f.name + '" está sem o campo "sql" (CREATE OR REPLACE FUNCTION …).'); return; }
      if (rf.comment) f.comment = str(rf.comment);
      if (typeof rf.id === 'string' && rf.id) { if (usedF[rf.id]) { E(p + '.id', 'o id de função "' + rf.id + '" está duplicado.'); return; } usedF[rf.id] = 1; f.id = rf.id; }
      model.functions.push(f);
    });
    var fn = 0; model.functions.forEach(function (f) { if (!f.id) { do { fn++; } while (usedF['f' + fn]); f.id = 'f' + fn; usedF[f.id] = 1; } });

    /* finalização */
    list.forEach(function (t) { delete t._raw; delete t._i; model.tables.push(t); });
    autoLayout(model, false);
    if (legacy) N('(raiz)', 'Formato antigo detectado (ids ou referências por nome). O modelo foi convertido para o formato v2.');
    return { model: model, errors: errors, warnings: warnings, notes: notes, legacy: legacy };
  }

  /* ---------------- layout ---------------- */
  function tableHeight(t) { return 34 + t.cols.length * 22 + 6; }
  function autoLayout(model, force) {
    var W = 230, gx = W + 90, y = 40, rowMax = 0, i = 0;
    model.tables.forEach(function (t) {
      var col = i % 3;
      if (force || t.x == null || t.y == null) { t.x = 40 + col * gx; t.y = y; }
      rowMax = Math.max(rowMax, tableHeight(t)); i++;
      if (col === 2) { y += rowMax + 50; rowMax = 0; }
    });
    return model;
  }

  /* ---------------- serialização canônica ---------------- */
  function serialize(model) {
    var o = { version: FORMAT_VERSION };
    if (model.options && Object.keys(model.options).length) o.options = clone(model.options);
    if (model.schemas && model.schemas.length) o.schemas = clone(model.schemas);
    if (model.enums && model.enums.length) o.enums = clone(model.enums);
    if (model.functions && model.functions.length) o.functions = clone(model.functions);
    o.tables = model.tables.map(function (t) {
      var r = { id: t.id, name: t.name, schema: t.schema, x: t.x, y: t.y };
      if (t.comment) r.comment = t.comment;
      r.cols = t.cols.map(function (c) {
        var k = { id: c.id, name: c.name, type: c.type, pk: !!c.pk, nn: !!c.nn || !!c.pk, uq: !!c.uq, def: c.def || '', ref: c.ref ? { t: c.ref.t, c: c.ref.c } : null, del: c.del || 'NO ACTION' };
        if (c.identity) k.identity = c.identity;
        if (c.generated) k.generated = c.generated;
        if (c.comment) k.comment = c.comment;
        return k;
      });
      if (t.constraints && t.constraints.length) r.constraints = clone(t.constraints);
      if (t.indexes && t.indexes.length) r.indexes = clone(t.indexes);
      if (t.triggers && t.triggers.length) r.triggers = clone(t.triggers);
      if (t.partition) r.partition = clone(t.partition);
      if (t.partitions && t.partitions.length) r.partitions = clone(t.partitions);
      return r;
    });
    return o;
  }
  function exportJSON(model) { return JSON.stringify(serialize(model), null, 2); }

  /* ---------------- validação semântica ---------------- */
  function hasUniqueOn(t, ids) {
    var key = ids.slice().sort().join('|');
    var pk = t.cols.filter(function (c) { return c.pk; }).map(function (c) { return c.id; });
    if (pk.length && pk.slice().sort().join('|') === key) return true;
    if (ids.length === 1) { var c = colById(t, ids[0]); if (c && c.uq) return true; }
    if ((t.constraints || []).some(function (k) { return k.kind === 'unique' && k.cols.slice().sort().join('|') === key; })) return true;
    return (t.indexes || []).some(function (x) {
      return x.unique && !x.where && x.cols.every(function (e) { return e.c; }) && x.cols.map(function (e) { return e.c; }).sort().join('|') === key;
    });
  }
  function fkList(model) {
    var out = [];
    model.tables.forEach(function (t) {
      t.cols.forEach(function (c) {
        if (!c.ref) return;
        var rt = tableById(model, c.ref.t), rc = colById(rt, c.ref.c);
        if (rt && rc) out.push({ table: t, cols: [c], refTable: rt, refCols: [rc], del: c.del, name: t.name + '_' + c.name + '_fkey', source: 'col' });
      });
      (t.constraints || []).forEach(function (k) {
        if (k.kind !== 'fk') return;
        var rt = tableById(model, k.ref.t); if (!rt) return;
        var lc = k.cols.map(function (id) { return colById(t, id); }), rcs = k.ref.cols.map(function (id) { return colById(rt, id); });
        if (lc.some(function (x) { return !x; }) || rcs.some(function (x) { return !x; })) return;
        out.push({ table: t, cols: lc, refTable: rt, refCols: rcs, del: k.del || 'NO ACTION', name: k.name || (t.name + '_' + lc.map(function (c) { return c.name; }).join('_') + '_fkey'), source: 'constraint', constraint: k });
      });
    });
    return out;
  }
  function validate(model) {
    var errors = [], warnings = [];
    function E(path, message) { errors.push({ path: path, message: message }); }
    function W(path, message) { warnings.push({ path: path, message: message }); }
    var keys = {}, enumKeys = {}, enumSet = {}, fnSet = {}, idxNames = {};
    model.enums.forEach(function (e, i) {
      var k = e.schema + '.' + e.name;
      if (enumKeys[k]) E('enums[' + i + ']', 'enum duplicado: ' + k + '.'); enumKeys[k] = 1;
      enumSet[k] = 1; if (e.schema === 'public') enumSet[e.name] = 1;
      var seen = {}; e.values.forEach(function (v) { if (seen[v]) E('enums[' + i + '].values', 'valor repetido "' + v + '" no enum ' + k + '.'); seen[v] = 1; if (!v.length) E('enums[' + i + '].values', 'valor vazio no enum ' + k + '.'); });
    });
    model.functions.forEach(function (f, i) {
      var k = f.schema + '.' + f.name; if (fnSet[k]) E('functions[' + i + ']', 'função duplicada: ' + k + '.'); fnSet[k] = 1; if (f.schema === 'public') fnSet[f.name] = 1;
    });
    model.tables.forEach(function (t, ti) {
      var p = 'tables[' + ti + ']', k = t.schema + '.' + t.name;
      if (keys[k]) E(p, 'tabela duplicada: ' + k + '.'); keys[k] = 1;
      if (!t.cols.length) W(p, 'a tabela "' + tname(t) + '" não tem colunas.');
      var pkCols = t.cols.filter(function (c) { return c.pk; });
      if (!pkCols.length) W(p, 'a tabela "' + tname(t) + '" não tem chave primária.');
      var cn = {};
      t.cols.forEach(function (c, ci) {
        var pc = p + '.cols[' + ci + ']', w = tname(t) + '.' + c.name;
        var lk = c.name.toLowerCase(); if (cn[lk]) E(pc, 'coluna duplicada "' + c.name + '" em "' + tname(t) + '".'); cn[lk] = 1;
        if (c.identity) {
          if (INT_TYPES.indexOf(baseType(c.type)) < 0) E(pc, w + ' usa identity, mas o tipo "' + c.type + '" não é inteiro (smallint, integer ou bigint).');
          if (c.def !== '') E(pc, w + ' tem identity e DEFAULT ao mesmo tempo; o PostgreSQL não permite.');
          if (c.generated) E(pc, w + ' tem identity e coluna gerada ao mesmo tempo.');
        }
        if (c.generated && c.def !== '') E(pc, w + ' é coluna gerada e tem DEFAULT; o PostgreSQL não permite.');
        if (c.ref && c.del === 'SET NULL' && (c.nn || c.pk)) W(pc, 'FK ' + w + ' usa ON DELETE SET NULL, mas a coluna é NOT NULL/PK.');
        if (/^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$/i.test(c.type) && !enumSet[c.type.toLowerCase()] && !enumSet[c.type]) W(pc, w + ' usa o tipo "' + c.type + '", que não está declarado em "enums". Se for um tipo existente no banco, ignore.');
      });
      /* constraints */
      var cnames = {};
      (t.constraints || []).forEach(function (kk, ki) {
        var pk2 = p + '.constraints[' + ki + ']';
        if (kk.name) { if (cnames[kk.name]) E(pk2, 'restrição duplicada "' + kk.name + '" na tabela "' + tname(t) + '".'); cnames[kk.name] = 1; }
        if (kk.kind === 'fk') {
          var rt = tableById(model, kk.ref.t);
          if (rt) {
            if (!hasUniqueOn(rt, kk.ref.cols)) E(pk2, 'a FK "' + (kk.name || '(sem nome)') + '" de "' + tname(t) + '" referencia (' + kk.ref.cols.map(function (id) { return colById(rt, id).name; }).join(', ') + ') em "' + tname(rt) + '", mas esse conjunto não é PRIMARY KEY nem UNIQUE; o PostgreSQL vai recusar.');
            kk.cols.forEach(function (id, n) {
              var a = colById(t, id), b = colById(rt, kk.ref.cols[n]);
              if (a && b && baseType(a.type) !== baseType(b.type)) W(pk2, 'FK composta ' + tname(t) + '.' + a.name + ' (' + a.type + ') difere do tipo de ' + tname(rt) + '.' + b.name + ' (' + b.type + ').');
            });
          }
        }
      });
      /* FK simples: destino precisa ser único */
      t.cols.forEach(function (c, ci) {
        if (!c.ref) return;
        var rt = tableById(model, c.ref.t), rc = colById(rt, c.ref.c); if (!rt || !rc) return;
        var pc = p + '.cols[' + ci + '].ref';
        if (!hasUniqueOn(rt, [rc.id])) E(pc, 'a FK ' + tname(t) + '.' + c.name + ' aponta para ' + tname(rt) + '.' + rc.name + ', que não é PRIMARY KEY nem UNIQUE; o PostgreSQL vai recusar.');
        if (baseType(rc.type) !== baseType(c.type)) W(pc, 'FK ' + tname(t) + '.' + c.name + ' (' + c.type + ') difere do tipo de ' + tname(rt) + '.' + rc.name + ' (' + rc.type + ').');
      });
      /* índices */
      (t.indexes || []).forEach(function (x, xi) {
        var px = p + '.indexes[' + xi + ']', ik = t.schema + '.' + x.name;
        if (idxNames[ik]) E(px, 'já existe outro índice chamado "' + x.name + '" no schema "' + t.schema + '" (nomes de índice são únicos por schema).'); idxNames[ik] = 1;
        if (x.nullsNotDistinct && !x.unique) E(px, 'o índice "' + x.name + '" usa NULLS NOT DISTINCT, que só vale para índices UNIQUE.');
        if (x.name.length > 63) W(px, 'o nome do índice "' + x.name + '" passa de 63 caracteres e será truncado pelo PostgreSQL.');
      });
      /* triggers */
      (t.triggers || []).forEach(function (g, gi) {
        var fk = g.function.replace(/\(.*$/, '');
        if (!fnSet[fk]) W(p + '.triggers[' + gi + ']', 'o trigger "' + g.name + '" chama ' + g.function + ', que não está em "functions". Se a função já existe no banco, ignore.');
        if (g.timing === 'INSTEAD OF' && g.level !== 'ROW') E(p + '.triggers[' + gi + ']', 'o trigger INSTEAD OF "' + g.name + '" precisa ser FOR EACH ROW.');
      });
      /* partição */
      if (t.partition) {
        var pcols = t.partition.cols;
        if (pkCols.length) {
          var miss = pcols.filter(function (id) { return !colById(t, id).pk; });
          if (miss.length) E(p + '.partition', 'a tabela particionada "' + tname(t) + '" tem PRIMARY KEY, e ela precisa incluir a coluna de partição (' + miss.map(function (id) { return colById(t, id).name; }).join(', ') + ').');
        }
        (t.constraints || []).forEach(function (kk) {
          if (kk.kind === 'unique') {
            var m2 = pcols.filter(function (id) { return kk.cols.indexOf(id) < 0; });
            if (m2.length) E(p + '.constraints', 'o UNIQUE "' + (kk.name || '') + '" da tabela particionada "' + tname(t) + '" precisa incluir a coluna de partição.');
          }
        });
      }
    });
    /* nomes de FK longos */
    fkList(model).forEach(function (f) { if (f.name.length > 63) W('tables', 'o nome gerado da FK "' + f.name + '" passa de 63 caracteres e será truncado pelo PostgreSQL. Dê um nome à restrição.'); });
    return { errors: errors, warnings: warnings };
  }

  /* ---------------- leitura completa a partir de texto ---------------- */
  function load(text) {
    var p = parseJSON(text);
    if (!p.ok) return { model: null, errors: [p.error], warnings: [], notes: [] };
    return loadObject(p.value);
  }
  function loadObject(obj) {
    var n = normalize(obj);
    if (!n.model) return n;
    var v = validate(n.model);
    return { model: n.model, errors: n.errors.concat(v.errors), warnings: n.warnings.concat(v.warnings), notes: n.notes, legacy: n.legacy };
  }

  /* ---------------- geração de SQL ---------------- */
  function indexNameFor(model, opts, t, cols) {
    var naming = (opts && opts.indexNaming) || (model.options && model.options.indexNaming) || 'idx';
    var names = cols.map(function (c) { return c.name; }).join('_');
    return naming === 'ix' ? 'ix_' + t.name + '__' + names : 'idx_' + t.name + '_' + names;
  }
  function boundSQL(b) {
    b = b.trim();
    if (/^default$/i.test(b)) return 'DEFAULT';
    if (/^for\s+values/i.test(b)) return b;
    return 'FOR VALUES ' + b;
  }
  function toSQL(model, opts) {
    opts = opts || {};
    var out = [];
    out.push('-- ' + (opts.header || 'Gerado por MADB'));
    out.push('-- PostgreSQL 15+', '');
    var schemas = [], seenS = {};
    function addSchema(s) { if (s && s !== 'public' && !seenS[s]) { seenS[s] = 1; schemas.push(s); } }
    (model.schemas || []).forEach(function (s) { addSchema(s.name); });
    model.enums.forEach(function (e) { addSchema(e.schema); });
    model.functions.forEach(function (f) { addSchema(f.schema); });
    model.tables.forEach(function (t) { addSchema(t.schema); (t.partitions || []).forEach(function (pp) { addSchema(pp.schema); }); });
    schemas.forEach(function (s) { out.push('CREATE SCHEMA IF NOT EXISTS ' + q(s) + ';'); });
    if (schemas.length) out.push('');
    if (model.enums.length) {
      out.push('-- Tipos (enums)');
      model.enums.forEach(function (e) { out.push('CREATE TYPE ' + qn(e.schema, e.name) + ' AS ENUM (' + e.values.map(lit).join(', ') + ');'); });
      out.push('');
    }
    if (model.functions.length) {
      out.push('-- Funções');
      model.functions.forEach(function (f) { var s = f.sql.trim(); out.push(/;\s*$/.test(s) ? s : s + ';'); out.push(''); });
    }
    /* tabelas */
    model.tables.forEach(function (t) {
      var pks = t.cols.filter(function (c) { return c.pk; });
      var lines = t.cols.map(function (c) {
        var l = '  ' + q(c.name) + ' ' + (c.type || 'text');
        if (c.identity) l += ' GENERATED ' + c.identity + ' AS IDENTITY';
        if (c.generated) l += ' GENERATED ALWAYS AS (' + c.generated + ') STORED';
        if (c.pk && pks.length === 1) l += ' PRIMARY KEY';
        else if (c.nn || c.pk) l += ' NOT NULL';
        if (c.uq && !(c.pk && pks.length === 1)) l += ' UNIQUE';
        if (c.def !== '' && !c.identity && !c.generated) l += ' DEFAULT ' + c.def;
        return l;
      });
      if (pks.length > 1) lines.push('  CONSTRAINT ' + q(t.name + '_pkey') + ' PRIMARY KEY (' + pks.map(function (c) { return q(c.name); }).join(', ') + ')');
      (t.constraints || []).forEach(function (k) {
        if (k.kind !== 'unique') return;
        lines.push('  ' + (k.name ? 'CONSTRAINT ' + q(k.name) + ' ' : '') + 'UNIQUE ' + (k.nullsNotDistinct ? 'NULLS NOT DISTINCT ' : '') + '(' + k.cols.map(function (id) { return q(colById(t, id).name); }).join(', ') + ')');
      });
      var head = 'CREATE TABLE ' + qn(t.schema, t.name) + ' (\n' + lines.join(',\n') + '\n)';
      if (t.partition) head += ' PARTITION BY ' + t.partition.by + ' (' + t.partition.cols.map(function (id) { return q(colById(t, id).name); }).join(', ') + ')';
      out.push(head + ';', '');
      (t.partitions || []).forEach(function (pp) {
        out.push('CREATE TABLE ' + qn(pp.schema || t.schema, pp.name) + ' PARTITION OF ' + qn(t.schema, t.name) + ' ' + boundSQL(pp.bound) + ';');
      });
      if ((t.partitions || []).length) out.push('');
    });
    /* FKs */
    var fks = fkList(model);
    if (fks.length) {
      out.push('-- Chaves estrangeiras');
      fks.forEach(function (f) {
        out.push('ALTER TABLE ' + qn(f.table.schema, f.table.name) + '\n  ADD CONSTRAINT ' + q(f.name) + ' FOREIGN KEY (' + f.cols.map(function (c) { return q(c.name); }).join(', ') + ')\n  REFERENCES ' + qn(f.refTable.schema, f.refTable.name) + ' (' + f.refCols.map(function (c) { return q(c.name); }).join(', ') + ')' + (f.del && f.del !== 'NO ACTION' ? ' ON DELETE ' + f.del : '') + ';', '');
      });
    }
    /* índices */
    var idx = [];
    model.tables.forEach(function (t) {
      (t.indexes || []).forEach(function (x) {
        var cols = x.cols.map(function (e) {
          var s = e.expr ? '(' + e.expr + ')' : q(colById(t, e.c).name);
          if (e.order) s += ' ' + e.order;
          if (e.nulls) s += ' NULLS ' + e.nulls;
          return s;
        }).join(', ');
        idx.push('CREATE ' + (x.unique ? 'UNIQUE ' : '') + 'INDEX ' + q(x.name) + ' ON ' + qn(t.schema, t.name) + (x.method && x.method !== 'btree' ? ' USING ' + x.method : '') + ' (' + cols + ')' + (x.nullsNotDistinct ? ' NULLS NOT DISTINCT' : '') + (x.where ? ' WHERE ' + x.where : '') + ';');
      });
    });
    if (opts.fkIndexes) {
      fks.forEach(function (f) {
        var ids = f.cols.map(function (c) { return c.id; });
        var covered = (f.table.indexes || []).some(function (x) { return x.cols.length >= ids.length && ids.every(function (id, n) { return x.cols[n] && x.cols[n].c === id; }); });
        if (!covered) idx.push('CREATE INDEX ' + q(indexNameFor(model, opts, f.table, f.cols)) + ' ON ' + qn(f.table.schema, f.table.name) + ' (' + f.cols.map(function (c) { return q(c.name); }).join(', ') + ');');
      });
    }
    if (idx.length) { out.push('-- Índices'); idx.forEach(function (s) { out.push(s); }); out.push(''); }
    /* checks */
    var chk = [];
    model.tables.forEach(function (t) {
      var n = 0;
      (t.constraints || []).forEach(function (k) {
        if (k.kind !== 'check') return; n++;
        chk.push('ALTER TABLE ' + qn(t.schema, t.name) + '\n  ADD CONSTRAINT ' + q(k.name || (t.name + '_check_' + n)) + ' CHECK (' + k.expr + ');');
      });
    });
    if (chk.length) { out.push('-- Restrições CHECK'); chk.forEach(function (s) { out.push(s, ''); }); }
    /* comentários */
    var com = [];
    (model.schemas || []).forEach(function (s) { if (s.comment) com.push('COMMENT ON SCHEMA ' + q(s.name) + ' IS ' + lit(s.comment) + ';'); });
    model.enums.forEach(function (e) { if (e.comment) com.push('COMMENT ON TYPE ' + qn(e.schema, e.name) + ' IS ' + lit(e.comment) + ';'); });
    model.tables.forEach(function (t) {
      if (t.comment) com.push('COMMENT ON TABLE ' + qn(t.schema, t.name) + ' IS ' + lit(t.comment) + ';');
      t.cols.forEach(function (c) { if (c.comment) com.push('COMMENT ON COLUMN ' + qn(t.schema, t.name) + '.' + q(c.name) + ' IS ' + lit(c.comment) + ';'); });
    });
    if (com.length) { out.push('-- Comentários'); com.forEach(function (s) { out.push(s); }); out.push(''); }
    /* triggers */
    var trg = [];
    model.tables.forEach(function (t) {
      (t.triggers || []).forEach(function (g) {
        trg.push('CREATE TRIGGER ' + q(g.name) + '\n  ' + g.timing + ' ' + g.events.join(' OR ') + ' ON ' + qn(t.schema, t.name) + '\n  FOR EACH ' + g.level + (g.when ? '\n  WHEN (' + g.when + ')' : '') + '\n  EXECUTE FUNCTION ' + (/\(/.test(g.function) ? g.function : g.function + '()') + ';');
      });
    });
    if (trg.length) { out.push('-- Triggers'); trg.forEach(function (s) { out.push(s, ''); }); }
    if (!model.tables.length) out.push('-- (nenhuma tabela definida)');
    return out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
  }

  /* ---------------- Mermaid ---------------- */
  function toMermaid(model) {
    var nm = function (s) { return String(s).replace(/[^A-Za-z0-9_]/g, '_') || '_'; };
    var ty = function (s) { return String(s).replace(/\(.*?\)/g, '').replace(/\[\]/g, '_arr').replace(/\s+/g, '_') || 'text'; };
    var ent = function (t) { return nm(t.schema && t.schema !== 'public' ? t.schema + '_' + t.name : t.name); };
    var o = 'erDiagram\n';
    model.tables.forEach(function (t) {
      var fkCols = {};
      fkList(model).forEach(function (f) { if (f.table === t) f.cols.forEach(function (c) { fkCols[c.id] = 1; }); });
      o += '  ' + ent(t) + ' {\n';
      t.cols.forEach(function (c) {
        var k = [c.pk && 'PK', fkCols[c.id] && 'FK', c.uq && !c.pk && 'UK'].filter(Boolean).join(',');
        o += '    ' + ty(c.type) + ' ' + nm(c.name) + (k ? ' ' + k : '') + '\n';
      });
      o += '  }\n';
    });
    fkList(model).forEach(function (f) {
      var single = f.cols.length === 1;
      var notNull = f.cols.every(function (c) { return c.nn || c.pk; });
      var pks = f.table.cols.filter(function (c) { return c.pk; });
      var unique = single && (f.cols[0].uq || (f.cols[0].pk && pks.length === 1));
      o += '  ' + ent(f.refTable) + ' ' + (notNull ? '||' : '|o') + '--' + (unique ? 'o|' : 'o{') + ' ' + ent(f.table) + ' : "' + f.cols.map(function (c) { return c.name; }).join('_') + '"\n';
    });
    return o;
  }

  /* ---------------- resumo ---------------- */
  function summary(model) {
    var cols = 0, cons = 0, idx = 0, trg = 0, parts = 0;
    model.tables.forEach(function (t) { cols += t.cols.length; cons += (t.constraints || []).length; idx += (t.indexes || []).length; trg += (t.triggers || []).length; parts += (t.partitions || []).length; });
    return { tables: model.tables.length, cols: cols, fks: fkList(model).length, enums: model.enums.length, functions: model.functions.length, constraints: cons, indexes: idx, triggers: trg, partitions: parts };
  }

  // Remove referências que ficaram sem destino (após remover colunas/tabelas). Devolve a lista do que foi limpo.
  function prune(m) {
    var out = [];
    m.tables.forEach(function (t) {
      var has = function (id) { return !!colById(t, id); };
      t.cols.forEach(function (c) {
        if (!c.ref) return;
        var rt = tableById(m, c.ref.t);
        if (!rt || !colById(rt, c.ref.c)) { out.push('FK ' + t.name + '.' + c.name + ' removida (destino não existe mais)'); c.ref = null; }
      });
      if (t.constraints) {
        t.constraints = t.constraints.filter(function (k) {
          var ok = k.kind === 'check' || k.cols.every(has);
          if (ok && k.kind === 'fk') { var rt = tableById(m, k.ref.t); ok = !!rt && k.ref.cols.every(function (id) { return colById(rt, id); }); }
          if (!ok) out.push('restrição ' + (k.name || k.kind) + ' de ' + t.name + ' removida (coluna ou destino não existe mais)');
          return ok;
        });
        if (!t.constraints.length) delete t.constraints;
      }
      if (t.indexes) {
        t.indexes = t.indexes.filter(function (x) { var ok = x.cols.every(function (e) { return e.expr || has(e.c); }); if (!ok) out.push('índice ' + x.name + ' de ' + t.name + ' removido (coluna não existe mais)'); return ok; });
        if (!t.indexes.length) delete t.indexes;
      }
      if (t.partition && !t.partition.cols.every(has)) { out.push('partição de ' + t.name + ' removida (coluna de partição não existe mais)'); delete t.partition; delete t.partitions; }
    });
    return out;
  }
  function emptyModel() { return { version: FORMAT_VERSION, options: {}, schemas: [], enums: [], functions: [], tables: [] }; }

  return {
    FORMAT_VERSION: FORMAT_VERSION, DEL_ACTIONS: DEL_ACTIONS, TRIGGER_EVENTS: TRIGGER_EVENTS, TRIGGER_TIMING: TRIGGER_TIMING, PARTITION_METHODS: PARTITION_METHODS,
    parseJSON: parseJSON, normalize: normalize, validate: validate, load: load, loadObject: loadObject,
    serialize: serialize, exportJSON: exportJSON, toSQL: toSQL, toMermaid: toMermaid, autoLayout: autoLayout, tableHeight: tableHeight,
    newId: newId, findTable: findTable, findCol: findCol, tableById: tableById, colById: colById, fkList: fkList, summary: summary, emptyModel: emptyModel,
    stableStringify: stableStringify, clone: clone, baseType: baseType, q: q, qn: qn, tname: tname, hasUniqueOn: hasUniqueOn, prune: prune
  };
});
