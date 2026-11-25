#!/usr/bin/env node
// MADB MCP — modelagem de bancos PostgreSQL (tabelas, FKs, DDL, Mermaid, JSON compatível com o site MADB)
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const FILE = process.env.MADB_MODELO || path.join(os.homedir(), ".madb", "modelo.json");

/* ---------- persistência (modelo baseado em nomes) ---------- */
function load() {
  try { return JSON.parse(fs.readFileSync(FILE, "utf8")); } catch { return { tables: [] }; }
}
function save(m) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(m, null, 2));
}

/* ---------- helpers ---------- */
const RES = new Set(["user","order","group","table","select","column","check","default","end","from","to","limit","offset","primary","references","unique","desc","asc","all","analyse","analyze","both","case","cast","create","current_user","distinct","do","else","for","grant","having","in","into","leading","not","null","on","only","or","placing","some","then","trailing","union","using","when","where","with"]);
const q = (n) => (/^[a-z_][a-z0-9_]*$/.test(n) && !RES.has(n)) ? n : '"' + String(n).replace(/"/g, '""') + '"';
const qt = (t) => (t.schema && t.schema !== "public" ? q(t.schema) + "." : "") + q(t.name);
const baseType = (ty) => { const l = String(ty).toLowerCase().trim(); return l === "serial" ? "integer" : l === "bigserial" ? "bigint" : l === "smallserial" ? "smallint" : l; };
const findT = (m, name, schema) => m.tables.find((t) => t.name === name && (!schema || t.schema === schema));
const findC = (t, name) => t && t.cols.find((c) => c.name === name);

function parseRef(m, ref) {
  const p = String(ref).split(".");
  if (p.length < 2 || p.length > 3) throw new Error(`Referência inválida "${ref}". Use "tabela.coluna" ou "schema.tabela.coluna".`);
  const col = p.pop(), tab = p.pop(), sch = p.pop();
  const t = findT(m, tab, sch);
  if (!t) throw new Error(`Tabela "${tab}" não existe no modelo.`);
  if (!findC(t, col)) throw new Error(`Coluna "${col}" não existe em "${tab}".`);
  return { table: t.name, schema: t.schema, col };
}
function refStr(r) { return r ? `${r.schema && r.schema !== "public" ? r.schema + "." : ""}${r.table}.${r.col}` : null; }
function refTarget(m, r) { const t = findT(m, r.table, r.schema); return { t, c: findC(t, r.col) }; }

const ColSchema = z.object({
  nome: z.string().min(1).describe("Nome da coluna"),
  tipo: z.string().default("text").describe("Tipo PostgreSQL, ex.: bigserial, varchar(120), numeric(12,2), timestamptz, uuid, jsonb"),
  pk: z.boolean().default(false).describe("Faz parte da chave primária (várias colunas pk = PK composta)"),
  nn: z.boolean().default(false).describe("NOT NULL (implícito para PK)"),
  uq: z.boolean().default(false).describe("UNIQUE"),
  padrao: z.string().default("").describe("Expressão DEFAULT, ex.: now(), 0, 'aberto'"),
  ref: z.string().optional().describe('Chave estrangeira: "tabela.coluna" (a tabela referenciada precisa já existir)'),
  on_delete: z.enum(["NO ACTION", "CASCADE", "SET NULL", "RESTRICT"]).default("NO ACTION"),
});
function toCol(m, c, selfTable) {
  let ref = null;
  if (c.ref) {
    const p = String(c.ref).split(".");
    // permite auto-referência (tabela ainda não gravada no modelo)
    if (selfTable && (p.length === 2 && p[0] === selfTable.name) ) {
      ref = { table: selfTable.name, schema: selfTable.schema, col: p[1] };
    } else ref = parseRef(m, c.ref);
  }
  return { name: c.nome, type: c.tipo || "text", pk: !!c.pk, nn: !!c.nn || !!c.pk, uq: !!c.uq, def: c.padrao ?? "", ref, del: c.on_delete || "NO ACTION" };
}

/* ---------- geradores ---------- */
function genSQL(m, indicesFk) {
  const out = ["-- Gerado por MADB MCP", "-- PostgreSQL", ""];
  const schemas = [...new Set(m.tables.map((t) => t.schema).filter((s) => s && s !== "public"))];
  schemas.forEach((s) => out.push(`CREATE SCHEMA IF NOT EXISTS ${q(s)};`));
  if (schemas.length) out.push("");
  m.tables.forEach((t) => {
    const pks = t.cols.filter((c) => c.pk);
    const lines = t.cols.map((c) => {
      let l = `  ${q(c.name)} ${c.type || "text"}`;
      if (c.pk && pks.length === 1) l += " PRIMARY KEY";
      else if (c.nn || c.pk) l += " NOT NULL";
      if (c.uq && !(c.pk && pks.length === 1)) l += " UNIQUE";
      if (c.def !== "") l += ` DEFAULT ${c.def}`;
      return l;
    });
    if (pks.length > 1) lines.push(`  CONSTRAINT ${q(t.name + "_pkey")} PRIMARY KEY (${pks.map((c) => q(c.name)).join(", ")})`);
    out.push(`CREATE TABLE ${qt(t)} (\n${lines.join(",\n")}\n);`, "");
  });
  const fks = [], idx = [];
  m.tables.forEach((t) => t.cols.forEach((c) => {
    if (!c.ref) return;
    const { t: rt, c: rc } = refTarget(m, c.ref); if (!rt || !rc) return;
    fks.push(`ALTER TABLE ${qt(t)}\n  ADD CONSTRAINT ${q(`${t.name}_${c.name}_fkey`)} FOREIGN KEY (${q(c.name)})\n  REFERENCES ${qt(rt)} (${q(rc.name)})${c.del && c.del !== "NO ACTION" ? ` ON DELETE ${c.del}` : ""};`);
    if (indicesFk) idx.push(`CREATE INDEX ${q(`idx_${t.name}_${c.name}`)} ON ${qt(t)} (${q(c.name)});`);
  }));
  if (fks.length) out.push("-- Chaves estrangeiras", ...fks.flatMap((f) => [f, ""]));
  if (idx.length) out.push("-- Índices", ...idx, "");
  if (!m.tables.length) out.push("-- (nenhuma tabela definida)");
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}
function genMMD(m) {
  const nm = (s) => String(s).replace(/[^A-Za-z0-9_]/g, "_") || "_";
  const ty = (s) => String(s).replace(/\(.*?\)/g, "").replace(/\[\]/g, "_arr").replace(/\s+/g, "_") || "text";
  let o = "erDiagram\n";
  m.tables.forEach((t) => {
    o += `  ${nm(t.name)} {\n`;
    t.cols.forEach((c) => {
      const k = [c.pk && "PK", c.ref && "FK", c.uq && !c.pk && "UK"].filter(Boolean).join(",");
      o += `    ${ty(c.type)} ${nm(c.name)}${k ? " " + k : ""}\n`;
    });
    o += "  }\n";
  });
  m.tables.forEach((t) => t.cols.forEach((c) => {
    if (!c.ref) return;
    const single = t.cols.filter((z) => z.pk).length === 1 && c.pk;
    const l = c.nn || c.pk ? "||" : "|o", r = c.uq || single ? "o|" : "o{";
    o += `  ${nm(c.ref.table)} ${l}--${r} ${nm(t.name)} : "${c.name}"\n`;
  }));
  return o;
}
function validar(m) {
  const w = [];
  const seen = {};
  m.tables.forEach((t) => {
    const k = `${t.schema}.${t.name}`.toLowerCase();
    seen[k] = (seen[k] || 0) + 1;
    if (!t.cols.length) w.push(`"${t.name}" não tem colunas.`);
    if (!t.cols.some((c) => c.pk)) w.push(`"${t.name}" não tem chave primária.`);
    const cn = {};
    t.cols.forEach((c) => {
      cn[c.name.toLowerCase()] = (cn[c.name.toLowerCase()] || 0) + 1;
      if (c.ref) {
        const { t: rt, c: rc } = refTarget(m, c.ref);
        if (!rt || !rc) { w.push(`FK ${t.name}.${c.name} aponta para ${refStr(c.ref)}, que não existe mais.`); return; }
        if (baseType(rc.type) !== baseType(c.type)) w.push(`FK ${t.name}.${c.name} (${c.type}) difere do tipo de ${rt.name}.${rc.name} (${rc.type}).`);
        if (!rc.pk && !rc.uq) w.push(`FK ${t.name}.${c.name} aponta para coluna sem PK/UNIQUE (o PostgreSQL vai recusar).`);
        if (c.del === "SET NULL" && (c.nn || c.pk)) w.push(`FK ${t.name}.${c.name} usa ON DELETE SET NULL mas a coluna é NOT NULL/PK.`);
      }
    });
    Object.entries(cn).forEach(([n, v]) => { if (v > 1) w.push(`"${t.name}" tem coluna duplicada: ${n}.`); });
  });
  Object.entries(seen).forEach(([n, v]) => { if (v > 1) w.push(`Tabela duplicada: ${n}.`); });
  return [...new Set(w)];
}

/* ---------- compatibilidade com o JSON do site MADB (ids + x/y) ---------- */
function toMadbJSON(m) {
  const tid = {}, cid = {};
  m.tables.forEach((t, i) => { tid[`${t.schema}.${t.name}`] = "t" + (i + 1); t.cols.forEach((c, j) => (cid[`${t.schema}.${t.name}.${c.name}`] = `t${i + 1}c${j + 1}`)); });
  const W = 230, gx = W + 90; let y = 40, rowMax = 0;
  const tables = m.tables.map((t, i) => {
    const col = i % 3, h = 34 + t.cols.length * 22 + 6;
    const x = 40 + col * gx, yy = y; rowMax = Math.max(rowMax, h);
    if (col === 2) { y += rowMax + 50; rowMax = 0; }
    return {
      id: tid[`${t.schema}.${t.name}`], name: t.name, schema: t.schema, x, y: yy,
      cols: t.cols.map((c) => ({
        id: cid[`${t.schema}.${t.name}.${c.name}`], name: c.name, type: c.type, pk: c.pk, nn: c.nn, uq: c.uq, def: c.def,
        ref: c.ref ? { t: tid[`${c.ref.schema}.${c.ref.table}`], c: cid[`${c.ref.schema}.${c.ref.table}.${c.ref.col}`] } : null,
        del: c.del,
      })),
    };
  });
  return { tables };
}
function fromAnyJSON(raw) {
  if (!raw || !Array.isArray(raw.tables)) throw new Error('JSON precisa ter a chave "tables" (lista).');
  const tById = {}, cById = {};
  raw.tables.forEach((t) => { if (t.id) tById[t.id] = t; (t.cols || []).forEach((c) => { if (c.id) cById[`${t.id}|${c.id}`] = { t, c }; }); });
  const tables = raw.tables.map((t, i) => ({
    name: String(t.name || `tabela_${i + 1}`), schema: String(t.schema || "public"),
    cols: (t.cols || []).map((c) => ({
      name: String(c.name || "coluna"), type: String(c.type || "text"), pk: !!c.pk, nn: !!c.nn || !!c.pk, uq: !!c.uq,
      def: c.def == null ? "" : String(c.def), del: c.del || "NO ACTION", _r: c.ref,
    })),
    _src: t,
  }));
  tables.forEach((t) => t.cols.forEach((c, j) => {
    const r = c._r; delete c._r; c.ref = null;
    if (r && typeof r === "object") {
      const hit = cById[`${r.t}|${r.c}`];
      if (hit) c.ref = { table: String(hit.t.name), schema: String(hit.t.schema || "public"), col: String(hit.c.name) };
      else if (r.table && r.col) c.ref = { table: r.table, schema: r.schema || "public", col: r.col };
    }
  }));
  tables.forEach((t) => delete t._src);
  return { tables };
}

/* ---------- servidor ---------- */
const server = new McpServer({ name: "madb", version: "0.1.0" });
const txt = (s) => ({ content: [{ type: "text", text: s }] });
const err = (e) => ({ isError: true, content: [{ type: "text", text: "Erro: " + (e?.message || e) }] });
const resumo = (m) => !m.tables.length ? "(modelo vazio)" : m.tables.map((t) =>
  `${t.schema !== "public" ? t.schema + "." : ""}${t.name}\n` + t.cols.map((c) =>
    `  - ${c.name} ${c.type}${c.pk ? " PK" : ""}${c.nn && !c.pk ? " NOT NULL" : ""}${c.uq ? " UNIQUE" : ""}${c.def !== "" ? ` DEFAULT ${c.def}` : ""}${c.ref ? ` -> ${refStr(c.ref)} (ON DELETE ${c.del})` : ""}`).join("\n")).join("\n");
const wrap = (fn) => async (args) => { try { return await fn(args); } catch (e) { return err(e); } };

server.registerTool("madb_ver_modelo", {
  description: "Mostra o modelo atual (tabelas, colunas, PKs e FKs) em texto. Use antes de editar para ver o estado.",
  inputSchema: {},
}, wrap(async () => txt(`Arquivo: ${FILE}\n\n${resumo(load())}`)));

server.registerTool("madb_criar_tabela", {
  description: "Cria uma tabela (ou substitui, se já existir com o mesmo nome e schema). Colunas com 'ref' viram chaves estrangeiras; a tabela referenciada precisa existir antes (crie as tabelas-pai primeiro).",
  inputSchema: {
    nome: z.string().min(1).describe("Nome da tabela, em snake_case"),
    schema: z.string().default("public").describe("Schema PostgreSQL"),
    colunas: z.array(ColSchema).min(1),
  },
}, wrap(async ({ nome, schema, colunas }) => {
  const m = load();
  const self = { name: nome, schema };
  const t = { name: nome, schema, cols: colunas.map((c) => toCol(m, c, self)) };
  const i = m.tables.findIndex((x) => x.name === nome && x.schema === schema);
  if (i >= 0) m.tables[i] = t; else m.tables.push(t);
  save(m);
  const w = validar(m);
  return txt(`Tabela ${schema}.${nome} ${i >= 0 ? "substituída" : "criada"} com ${t.cols.length} coluna(s).${w.length ? "\n\nAvisos:\n- " + w.join("\n- ") : ""}`);
}));

server.registerTool("madb_adicionar_coluna", {
  description: "Adiciona (ou substitui, se já existir) uma coluna em uma tabela existente.",
  inputSchema: { tabela: z.string(), schema: z.string().optional(), coluna: ColSchema },
}, wrap(async ({ tabela, schema, coluna }) => {
  const m = load(); const t = findT(m, tabela, schema);
  if (!t) throw new Error(`Tabela "${tabela}" não existe.`);
  const c = toCol(m, coluna, t);
  const i = t.cols.findIndex((x) => x.name === c.name);
  if (i >= 0) t.cols[i] = c; else t.cols.push(c);
  save(m);
  return txt(`Coluna ${tabela}.${c.name} ${i >= 0 ? "substituída" : "adicionada"}.`);
}));

server.registerTool("madb_definir_fk", {
  description: "Define (ou remove, se 'destino' for omitido) a chave estrangeira de uma coluna existente.",
  inputSchema: {
    tabela: z.string(), coluna: z.string(), schema: z.string().optional(),
    destino: z.string().optional().describe('"tabela.coluna" referenciada; omita para remover a FK'),
    on_delete: z.enum(["NO ACTION", "CASCADE", "SET NULL", "RESTRICT"]).default("NO ACTION"),
  },
}, wrap(async ({ tabela, coluna, schema, destino, on_delete }) => {
  const m = load(); const t = findT(m, tabela, schema); const c = findC(t, coluna);
  if (!t) throw new Error(`Tabela "${tabela}" não existe.`);
  if (!c) throw new Error(`Coluna "${coluna}" não existe em "${tabela}".`);
  if (!destino) { c.ref = null; save(m); return txt(`FK removida de ${tabela}.${coluna}.`); }
  c.ref = parseRef(m, destino); c.del = on_delete; save(m);
  const w = validar(m).filter((x) => x.includes(`${tabela}.${coluna}`));
  return txt(`FK ${tabela}.${coluna} -> ${destino} (ON DELETE ${on_delete}).${w.length ? "\n\nAvisos:\n- " + w.join("\n- ") : ""}`);
}));

server.registerTool("madb_remover_coluna", {
  description: "Remove uma coluna. FKs de outras tabelas que apontavam para ela também são removidas.",
  inputSchema: { tabela: z.string(), coluna: z.string(), schema: z.string().optional() },
}, wrap(async ({ tabela, coluna, schema }) => {
  const m = load(); const t = findT(m, tabela, schema);
  if (!t) throw new Error(`Tabela "${tabela}" não existe.`);
  if (!findC(t, coluna)) throw new Error(`Coluna "${coluna}" não existe.`);
  t.cols = t.cols.filter((c) => c.name !== coluna);
  let n = 0;
  m.tables.forEach((x) => x.cols.forEach((c) => { if (c.ref && c.ref.table === t.name && c.ref.schema === t.schema && c.ref.col === coluna) { c.ref = null; n++; } }));
  save(m);
  return txt(`Coluna removida.${n ? ` ${n} FK(s) que apontavam para ela foram removidas.` : ""}`);
}));

server.registerTool("madb_remover_tabela", {
  description: "Remove uma tabela. FKs de outras tabelas que apontavam para ela também são removidas.",
  inputSchema: { tabela: z.string(), schema: z.string().optional() },
}, wrap(async ({ tabela, schema }) => {
  const m = load(); const t = findT(m, tabela, schema);
  if (!t) throw new Error(`Tabela "${tabela}" não existe.`);
  m.tables = m.tables.filter((x) => x !== t);
  let n = 0;
  m.tables.forEach((x) => x.cols.forEach((c) => { if (c.ref && c.ref.table === t.name && c.ref.schema === t.schema) { c.ref = null; n++; } }));
  save(m);
  return txt(`Tabela removida.${n ? ` ${n} FK(s) que apontavam para ela foram removidas.` : ""}`);
}));

server.registerTool("madb_validar", {
  description: "Valida o modelo: tabela sem PK, nomes duplicados, FK com tipo diferente ou apontando para coluna sem PK/UNIQUE.",
  inputSchema: {},
}, wrap(async () => { const w = validar(load()); return txt(w.length ? "Avisos:\n- " + w.join("\n- ") : "Modelo válido: nenhum aviso."); }));

server.registerTool("madb_gerar_sql", {
  description: "Gera o DDL PostgreSQL (CREATE SCHEMA/TABLE, FKs via ALTER TABLE e, opcionalmente, índices nas FKs).",
  inputSchema: { indices_fk: z.boolean().default(false).describe("Criar índice em cada coluna FK") },
}, wrap(async ({ indices_fk }) => txt(genSQL(load(), indices_fk))));

server.registerTool("madb_gerar_mermaid", {
  description: "Gera o diagrama ER em Mermaid (erDiagram), para colar em README, wiki ou docs.",
  inputSchema: {},
}, wrap(async () => txt("```mermaid\n" + genMMD(load()) + "```")));

server.registerTool("madb_exportar_json", {
  description: "Exporta o modelo no formato JSON do site MADB (cole na aba JSON e clique em 'Aplicar JSON' para ver o diagrama).",
  inputSchema: {},
}, wrap(async () => txt(JSON.stringify(toMadbJSON(load()), null, 2))));

server.registerTool("madb_importar_json", {
  description: "Substitui o modelo atual por um JSON exportado do site MADB (aba JSON) ou no formato deste MCP.",
  inputSchema: { json: z.string().describe("Conteúdo JSON completo") },
}, wrap(async ({ json }) => {
  const m = fromAnyJSON(JSON.parse(json)); save(m);
  const w = validar(m);
  return txt(`Modelo importado: ${m.tables.length} tabela(s).${w.length ? "\n\nAvisos:\n- " + w.join("\n- ") : ""}`);
}));

server.registerTool("madb_limpar", {
  description: "Apaga todo o modelo atual. Só use quando o usuário pedir explicitamente para recomeçar.",
  inputSchema: {},
}, wrap(async () => { save({ tables: [] }); return txt("Modelo limpo."); }));

await server.connect(new StdioServerTransport());
