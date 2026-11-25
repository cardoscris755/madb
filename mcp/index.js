#!/usr/bin/env node
// MADB MCP — modela bancos PostgreSQL por conversa (tabelas, FKs, enums, CHECKs, índices, triggers,
// partições, comentários), valida e gera SQL, Mermaid e o JSON do site MADB.
// O arquivo do modelo usa o MESMO formato do site (v2), então o site pode abri-lo ou sincronizá-lo direto.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/* ---------- núcleo compartilhado (madb-core.js, na raiz do repositório) ---------- */
function loadCore() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [path.join(here, "..", "madb-core.js"), path.join(here, "madb-core.js")];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      const mod = { exports: {} };
      new Function("module", "exports", "self", fs.readFileSync(p, "utf8"))(mod, mod.exports, undefined);
      return mod.exports;
    }
  }
  throw new Error("madb-core.js não encontrado. Ele deve estar na pasta acima de mcp/ (raiz do repositório) ou ao lado do index.js.");
}
const M = loadCore();

const FILE = process.env.MADB_MODELO || path.join(os.homedir(), ".madb", "modelo.json");
const expand = (p) => (p.startsWith("~") ? path.join(os.homedir(), p.slice(1)) : p);

/* ---------- persistência ---------- */
function formatErrors(list, max = 8) {
  const l = list.slice(0, max).map((e) => `- ${e.message}`);
  if (list.length > max) l.push(`- … e mais ${list.length - max}`);
  return l.join("\n");
}
function loadModel() {
  if (!fs.existsSync(FILE)) return { model: M.emptyModel(), legacy: false };
  const text = fs.readFileSync(FILE, "utf8");
  if (!text.trim()) return { model: M.emptyModel(), legacy: false };
  const p = M.parseJSON(text);
  if (!p.ok) throw new Error(`O arquivo do modelo (${FILE}) não é um JSON válido:\n${p.error.message}`);
  const n = M.normalize(p.value);
  if (n.errors.length) throw new Error(`O arquivo do modelo (${FILE}) tem problemas:\n${formatErrors(n.errors)}`);
  return { model: n.model, legacy: !!n.legacy };
}
let legacyBackupDone = false;
function saveModel(model, legacy) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  if (legacy && !legacyBackupDone && fs.existsSync(FILE)) {
    const bak = FILE + ".bak-v1";
    if (!fs.existsSync(bak)) fs.copyFileSync(FILE, bak);
    legacyBackupDone = true;
  }
  fs.writeFileSync(FILE, M.exportJSON(model));
}

/* ---------- helpers ---------- */
const txt = (s) => ({ content: [{ type: "text", text: s }] });
const fail = (e) => ({ isError: true, content: [{ type: "text", text: "Erro: " + (e?.message || e) }] });
function mutate(fn) {
  return async (args) => {
    try {
      const st = loadModel();
      const msg = await fn(st.model, args);
      saveModel(st.model, st.legacy);
      return txt(msg + problemas(st.model));
    } catch (e) { return fail(e); }
  };
}
function read(fn) {
  return async (args) => { try { return txt(await fn(loadModel().model, args)); } catch (e) { return fail(e); } };
}
function problemas(m) {
  const v = M.validate(m);
  let s = "";
  if (v.errors.length) s += `\n\nErros no modelo (${v.errors.length}):\n` + formatErrors(v.errors, 5);
  if (v.warnings.length) s += `\n\nAvisos: ${v.warnings.length} (use madb_validar para ver).`;
  return s;
}
function T(m, nome, schema) {
  const t = M.findTable(m, nome, schema);
  if (!t) {
    const names = m.tables.map(M.tname).slice(0, 30).join(", ") || "(nenhuma)";
    throw new Error(`Tabela "${nome}" não existe no modelo. Tabelas: ${names}.`);
  }
  return t;
}
function C(t, nome) {
  const c = M.findCol(t, nome);
  if (!c) throw new Error(`Coluna "${nome}" não existe em "${M.tname(t)}". Colunas: ${t.cols.map((x) => x.name).join(", ")}.`);
  return c;
}
// "tabela.coluna" ou "schema.tabela.coluna"
function parseRef(m, ref, selfTable) {
  const p = String(ref).split(".");
  if (p.length < 2 || p.length > 3) throw new Error(`Referência inválida "${ref}". Use "tabela.coluna" ou "schema.tabela.coluna".`);
  const col = p.pop(), tab = p.pop(), sch = p.pop();
  let t = selfTable && selfTable.name === tab && (!sch || sch === selfTable.schema) ? selfTable : M.findTable(m, tab, sch);
  if (!t) throw new Error(`Tabela "${tab}" não existe no modelo (referência "${ref}"). Crie as tabelas-pai antes.`);
  return { t, c: C(t, col) };
}
function remember(arr, id) { return arr.filter((x) => x.id !== id); }

const prune = (m) => M.prune(m);
const cleaned = (l) => (l.length ? "\nLimpeza automática:\n- " + l.join("\n- ") : "");

function describe(m) {
  const L = [`Arquivo: ${FILE}`, `Resumo: ${JSON.stringify(M.summary(m))}`];
  if (m.options && m.options.indexNaming) L.push(`Nomenclatura de índices: ${m.options.indexNaming}`);
  (m.schemas || []).forEach((s) => L.push(`schema ${s.name}${s.comment ? " — " + s.comment : ""}`));
  m.enums.forEach((e) => L.push(`enum ${e.schema}.${e.name} (${e.values.join(", ")})`));
  m.functions.forEach((f) => L.push(`função ${f.schema}.${f.name}`));
  if (!m.tables.length) L.push("(sem tabelas)");
  const nameOf = (t, id) => M.colById(t, id)?.name ?? "?";
  m.tables.forEach((t) => {
    L.push("", `${M.tname(t)}${t.comment ? " — " + t.comment : ""}${t.partition ? ` [particionada por ${t.partition.by} (${t.partition.cols.map((i) => nameOf(t, i)).join(", ")})]` : ""}`);
    t.cols.forEach((c) => {
      const rt = c.ref ? M.tableById(m, c.ref.t) : null;
      L.push(`  - ${c.name} ${c.type}${c.identity ? ` IDENTITY(${c.identity})` : ""}${c.generated ? ` GERADA(${c.generated})` : ""}${c.pk ? " PK" : ""}${c.nn && !c.pk ? " NOT NULL" : ""}${c.uq ? " UNIQUE" : ""}${c.def !== "" ? ` DEFAULT ${c.def}` : ""}${rt ? ` -> ${M.tname(rt)}.${M.colById(rt, c.ref.c)?.name} (ON DELETE ${c.del})` : ""}`);
    });
    (t.constraints || []).forEach((k) => {
      if (k.kind === "check") L.push(`  * CHECK ${k.name || ""}: ${k.expr}`);
      else if (k.kind === "unique") L.push(`  * UNIQUE ${k.name || ""} (${k.cols.map((i) => nameOf(t, i)).join(", ")})${k.nullsNotDistinct ? " NULLS NOT DISTINCT" : ""}`);
      else { const rt = M.tableById(m, k.ref.t); L.push(`  * FK ${k.name || ""} (${k.cols.map((i) => nameOf(t, i)).join(", ")}) -> ${M.tname(rt)} (${k.ref.cols.map((i) => nameOf(rt, i)).join(", ")}) ON DELETE ${k.del}`); }
    });
    (t.indexes || []).forEach((x) => L.push(`  * ÍNDICE ${x.unique ? "UNIQUE " : ""}${x.name} (${x.cols.map((e) => e.expr ? `(${e.expr})` : nameOf(t, e.c) + (e.order ? " " + e.order : "")).join(", ")})${x.where ? " WHERE " + x.where : ""}`));
    (t.triggers || []).forEach((g) => L.push(`  * TRIGGER ${g.name}: ${g.timing} ${g.events.join(" OR ")} FOR EACH ${g.level} -> ${g.function}`));
    (t.partitions || []).forEach((p) => L.push(`  * PARTIÇÃO ${p.name}: ${p.bound}`));
  });
  return L.join("\n");
}

/* ---------- esquemas de entrada ---------- */
const DEL = z.enum(["NO ACTION", "CASCADE", "SET NULL", "RESTRICT"]);
const ColSchema = z.object({
  nome: z.string().min(1).describe("Nome da coluna"),
  tipo: z.string().default("text").describe("Tipo PostgreSQL, ex.: uuid, bigint, varchar(120), numeric(14,2), timestamptz, jsonb ou o nome de um enum (schema.nome)"),
  pk: z.boolean().default(false).describe("Parte da chave primária (várias colunas com pk = PK composta)"),
  nn: z.boolean().default(false).describe("NOT NULL (implícito na PK)"),
  uq: z.boolean().default(false).describe("UNIQUE de coluna única"),
  padrao: z.string().default("").describe("Expressão DEFAULT, ex.: now(), 0, 'aberto', gen_random_uuid()"),
  ref: z.string().optional().describe('FK de uma coluna: "tabela.coluna" ou "schema.tabela.coluna"'),
  on_delete: DEL.default("NO ACTION"),
  identity: z.enum(["ALWAYS", "BY DEFAULT"]).optional().describe("GENERATED ALWAYS|BY DEFAULT AS IDENTITY (use tipo inteiro; não combine com padrao)"),
  gerada: z.string().optional().describe("Expressão de coluna gerada: GENERATED ALWAYS AS (expressão) STORED"),
  comentario: z.string().optional().describe("COMMENT ON COLUMN"),
});
function buildCol(m, t, c) {
  const col = { id: M.newId(m, "col", t), name: c.nome, type: c.tipo || "text", pk: !!c.pk, nn: !!c.nn || !!c.pk, uq: !!c.uq, def: c.padrao ?? "", ref: null, del: c.on_delete || "NO ACTION" };
  if (c.identity) col.identity = c.identity;
  if (c.gerada) col.generated = c.gerada;
  if (c.comentario) col.comment = c.comentario;
  return col;
}
const SCH = z.string().optional().describe("Schema da tabela (padrão: public; se omitido e houver só uma com esse nome, ela é usada)");

/* ---------- servidor ---------- */
const server = new McpServer({ name: "madb", version: "0.2.0" });
const reg = (name, description, inputSchema, handler) => server.registerTool(name, { description, inputSchema }, handler);

reg("madb_ver_modelo", "Mostra o modelo atual em texto (tabelas, colunas, PKs, FKs, enums, CHECKs, índices, triggers, partições). Use antes de editar.", {}, read((m) => describe(m)));
reg("madb_caminho_modelo", "Mostra o caminho do arquivo do modelo (formato v2 do site MADB). O site pode vincular esse arquivo e sincronizar sozinho.", {}, async () => txt(FILE));

reg("madb_criar_schema", "Declara um schema (CREATE SCHEMA IF NOT EXISTS) com comentário opcional. Schemas usados por tabelas e enums já são criados automaticamente.",
  { nome: z.string().min(1), comentario: z.string().optional() },
  mutate((m, { nome, comentario }) => {
    m.schemas = m.schemas.filter((s) => s.name !== nome);
    m.schemas.push(comentario ? { name: nome, comment: comentario } : { name: nome });
    return `Schema ${nome} declarado.`;
  }));

reg("madb_criar_enum", "Cria (ou substitui) um enum nomeado: CREATE TYPE schema.nome AS ENUM (...). Depois use 'schema.nome' como tipo de coluna.",
  { nome: z.string().min(1), schema: z.string().default("public"), valores: z.array(z.string().min(1)).min(1), comentario: z.string().optional() },
  mutate((m, { nome, schema, valores, comentario }) => {
    const old = m.enums.find((e) => e.name === nome && e.schema === schema);
    const e = { id: old ? old.id : M.newId(m, "enum"), schema, name: nome, values: valores };
    if (comentario) e.comment = comentario;
    m.enums = m.enums.filter((x) => x !== old); m.enums.push(e);
    return `Enum ${schema}.${nome} ${old ? "substituído" : "criado"} (${valores.length} valores).`;
  }));
reg("madb_remover_enum", "Remove um enum do modelo (não altera colunas que o usam como tipo).",
  { nome: z.string(), schema: z.string().default("public") },
  mutate((m, { nome, schema }) => {
    const n = m.enums.length; m.enums = m.enums.filter((e) => !(e.name === nome && e.schema === schema));
    if (m.enums.length === n) throw new Error(`Enum ${schema}.${nome} não existe.`);
    return `Enum ${schema}.${nome} removido.`;
  }));

reg("madb_criar_funcao", "Cria (ou substitui) uma função SQL/PLpgSQL do modelo, informando o comando completo em 'sql' (CREATE OR REPLACE FUNCTION ...). Usada por triggers.",
  { nome: z.string().min(1), schema: z.string().default("public"), sql: z.string().min(1).describe("Comando CREATE OR REPLACE FUNCTION completo"), comentario: z.string().optional() },
  mutate((m, { nome, schema, sql, comentario }) => {
    const old = m.functions.find((f) => f.name === nome && f.schema === schema);
    const f = { id: old ? old.id : M.newId(m, "function"), schema, name: nome, sql };
    if (comentario) f.comment = comentario;
    m.functions = m.functions.filter((x) => x !== old); m.functions.push(f);
    return `Função ${schema}.${nome} ${old ? "substituída" : "criada"}.`;
  }));
reg("madb_remover_funcao", "Remove uma função do modelo.", { nome: z.string(), schema: z.string().default("public") },
  mutate((m, { nome, schema }) => {
    const n = m.functions.length; m.functions = m.functions.filter((f) => !(f.name === nome && f.schema === schema));
    if (m.functions.length === n) throw new Error(`Função ${schema}.${nome} não existe.`);
    return `Função ${schema}.${nome} removida.`;
  }));

reg("madb_criar_tabela",
  "Cria uma tabela (ou substitui as colunas de uma existente, preservando restrições, índices e triggers que continuem válidos). Colunas com 'ref' viram FKs; a tabela referenciada precisa existir (crie as tabelas-pai primeiro; auto-referência funciona).",
  { nome: z.string().min(1), schema: z.string().default("public"), comentario: z.string().optional(), colunas: z.array(ColSchema).min(1) },
  mutate((m, { nome, schema, comentario, colunas }) => {
    const old = m.tables.find((t) => t.name === nome && t.schema === schema);
    const t = old || { id: M.newId(m, "table"), name: nome, schema, x: null, y: null, cols: [] };
    const oldCols = old ? old.cols : [];
    t.cols = [];
    colunas.forEach((c) => {
      const col = buildCol(m, t, c);
      const prev = oldCols.find((x) => x.name === c.nome);
      if (prev) col.id = prev.id;
      t.cols.push(col);
    });
    if (!old) m.tables.push(t);
    if (comentario !== undefined) t.comment = comentario;
    colunas.forEach((c, i) => {
      if (!c.ref) return;
      const r = parseRef(m, c.ref, t);
      t.cols[i].ref = { t: r.t.id, c: r.c.id };
    });
    const dang = prune(m);
    M.autoLayout(m, false);
    return `Tabela ${schema}.${nome} ${old ? "atualizada" : "criada"} com ${t.cols.length} coluna(s).${cleaned(dang)}`;
  }));

reg("madb_adicionar_coluna", "Adiciona (ou substitui, se já existir) uma coluna em uma tabela.",
  { tabela: z.string(), schema: SCH, coluna: ColSchema },
  mutate((m, { tabela, schema, coluna }) => {
    const t = T(m, tabela, schema);
    const col = buildCol(m, t, coluna);
    const i = t.cols.findIndex((x) => x.name === col.name);
    if (i >= 0) col.id = t.cols[i].id;
    if (i >= 0) t.cols[i] = col; else t.cols.push(col);
    if (coluna.ref) { const r = parseRef(m, coluna.ref, t); col.ref = { t: r.t.id, c: r.c.id }; }
    return `Coluna ${tabela}.${col.name} ${i >= 0 ? "substituída" : "adicionada"}.`;
  }));

reg("madb_definir_fk", "Define (ou remove, omitindo 'destino') a FK de UMA coluna. Para FK composta use madb_adicionar_restricao com tipo 'fk'.",
  { tabela: z.string(), coluna: z.string(), schema: SCH, destino: z.string().optional().describe('"tabela.coluna" referenciada; omita para remover a FK'), on_delete: DEL.default("NO ACTION") },
  mutate((m, { tabela, coluna, schema, destino, on_delete }) => {
    const t = T(m, tabela, schema), c = C(t, coluna);
    if (!destino) { c.ref = null; return `FK removida de ${tabela}.${coluna}.`; }
    const r = parseRef(m, destino, t);
    c.ref = { t: r.t.id, c: r.c.id }; c.del = on_delete;
    return `FK ${tabela}.${coluna} -> ${destino} (ON DELETE ${on_delete}).`;
  }));

reg("madb_remover_coluna", "Remove uma coluna; FKs, restrições e índices que dependiam dela são removidos também.",
  { tabela: z.string(), coluna: z.string(), schema: SCH },
  mutate((m, { tabela, coluna, schema }) => {
    const t = T(m, tabela, schema); const c = C(t, coluna);
    t.cols = t.cols.filter((x) => x !== c);
    return `Coluna ${tabela}.${coluna} removida.${cleaned(prune(m))}`;
  }));
reg("madb_remover_tabela", "Remove uma tabela; FKs de outras tabelas que apontavam para ela são removidas.",
  { tabela: z.string(), schema: SCH },
  mutate((m, { tabela, schema }) => {
    const t = T(m, tabela, schema); m.tables = m.tables.filter((x) => x !== t);
    return `Tabela ${M.tname(t)} removida.${cleaned(prune(m))}`;
  }));

reg("madb_adicionar_restricao",
  "Adiciona (ou substitui, se o 'nome' já existir) uma restrição da tabela: 'check' (expressão livre), 'unique' (composta, com NULLS NOT DISTINCT opcional) ou 'fk' (composta, para colunas de outra tabela que formem PK ou UNIQUE). Dê nomes seguindo a convenção do projeto.",
  {
    tabela: z.string(), schema: SCH, tipo: z.enum(["check", "unique", "fk"]), nome: z.string().optional(),
    expressao: z.string().optional().describe("Só para check: expressão SQL, ex.: quantidade > 0"),
    colunas: z.array(z.string()).optional().describe("Para unique e fk: colunas desta tabela, em ordem"),
    destino: z.object({ tabela: z.string(), schema: z.string().optional(), colunas: z.array(z.string()).min(1) }).optional().describe("Só para fk: tabela e colunas referenciadas, na mesma ordem"),
    on_delete: DEL.default("NO ACTION"), nulls_nao_distintos: z.boolean().optional().describe("Só para unique (PostgreSQL 15+)"),
  },
  mutate((m, a) => {
    const t = T(m, a.tabela, a.schema);
    const k = { id: M.newId(m, "constraint", t), name: a.nome || "", kind: a.tipo };
    if (a.tipo === "check") {
      if (!a.expressao) throw new Error("Informe 'expressao' para o CHECK.");
      k.expr = a.expressao;
    } else {
      if (!a.colunas || !a.colunas.length) throw new Error("Informe 'colunas'.");
      k.cols = a.colunas.map((n) => C(t, n).id);
      if (a.tipo === "unique") { if (a.nulls_nao_distintos) k.nullsNotDistinct = true; }
      else {
        if (!a.destino) throw new Error("Informe 'destino' ({tabela, colunas}) para a FK.");
        const rt = T(m, a.destino.tabela, a.destino.schema);
        if (a.destino.colunas.length !== a.colunas.length) throw new Error(`A FK tem ${a.colunas.length} coluna(s) locais e ${a.destino.colunas.length} referenciada(s); precisam ser iguais.`);
        k.ref = { t: rt.id, cols: a.destino.colunas.map((n) => C(rt, n).id) };
        k.del = a.on_delete || "NO ACTION";
      }
    }
    t.constraints = (t.constraints || []).filter((x) => !(a.nome && x.name === a.nome));
    t.constraints.push(k);
    return `Restrição ${a.tipo}${a.nome ? " " + a.nome : ""} adicionada em ${M.tname(t)}.`;
  }));
reg("madb_remover_restricao", "Remove uma restrição (check/unique/fk composta) pelo nome.",
  { tabela: z.string(), schema: SCH, nome: z.string() },
  mutate((m, { tabela, schema, nome }) => {
    const t = T(m, tabela, schema); const n = (t.constraints || []).length;
    t.constraints = (t.constraints || []).filter((x) => x.name !== nome);
    if (t.constraints.length === n) throw new Error(`Restrição "${nome}" não existe em ${M.tname(t)}.`);
    if (!t.constraints.length) delete t.constraints;
    return `Restrição ${nome} removida.`;
  }));

reg("madb_criar_indice",
  "Cria (ou substitui pelo nome) um índice: colunas em ordem (com ASC/DESC e NULLS FIRST/LAST) ou expressões, UNIQUE, condição WHERE (índice parcial), NULLS NOT DISTINCT e método (btree, gin, gist...).",
  {
    tabela: z.string(), schema: SCH, nome: z.string().min(1),
    colunas: z.array(z.union([z.string(), z.object({ coluna: z.string().optional(), expressao: z.string().optional(), ordem: z.enum(["ASC", "DESC"]).optional(), nulls: z.enum(["FIRST", "LAST"]).optional() })])).min(1),
    unico: z.boolean().default(false), onde: z.string().optional().describe("Condição WHERE do índice parcial"),
    nulls_nao_distintos: z.boolean().optional(), metodo: z.string().optional(),
  },
  mutate((m, a) => {
    const t = T(m, a.tabela, a.schema);
    const cols = a.colunas.map((c) => {
      const it = typeof c === "string" ? { coluna: c } : c; const e = {};
      if (it.expressao) e.expr = it.expressao; else e.c = C(t, it.coluna).id;
      if (it.ordem) e.order = it.ordem; if (it.nulls) e.nulls = it.nulls;
      return e;
    });
    const x = { id: M.newId(m, "index", t), name: a.nome, cols };
    if (a.unico) x.unique = true; if (a.onde) x.where = a.onde; if (a.nulls_nao_distintos) x.nullsNotDistinct = true; if (a.metodo) x.method = a.metodo;
    t.indexes = (t.indexes || []).filter((i) => i.name !== a.nome); t.indexes.push(x);
    return `Índice ${a.nome} criado em ${M.tname(t)}.`;
  }));
reg("madb_remover_indice", "Remove um índice explícito pelo nome.", { tabela: z.string(), schema: SCH, nome: z.string() },
  mutate((m, { tabela, schema, nome }) => {
    const t = T(m, tabela, schema); const n = (t.indexes || []).length;
    t.indexes = (t.indexes || []).filter((i) => i.name !== nome);
    if (t.indexes.length === n) throw new Error(`Índice "${nome}" não existe em ${M.tname(t)}.`);
    if (!t.indexes.length) delete t.indexes;
    return `Índice ${nome} removido.`;
  }));

reg("madb_criar_trigger", "Cria (ou substitui pelo nome) um trigger que chama uma função. Declare a função com madb_criar_funcao para ela sair no SQL.",
  {
    tabela: z.string(), schema: SCH, nome: z.string().min(1), momento: z.enum(["BEFORE", "AFTER", "INSTEAD OF"]),
    eventos: z.array(z.enum(["INSERT", "UPDATE", "DELETE", "TRUNCATE"])).min(1), nivel: z.enum(["ROW", "STATEMENT"]).default("ROW"),
    funcao: z.string().min(1).describe("Função chamada, ex.: schema.nome_da_funcao"), quando: z.string().optional().describe("Condição WHEN (opcional)"),
  },
  mutate((m, a) => {
    const t = T(m, a.tabela, a.schema);
    const g = { id: M.newId(m, "trigger", t), name: a.nome, timing: a.momento, events: a.eventos, level: a.nivel, function: a.funcao };
    if (a.quando) g.when = a.quando;
    t.triggers = (t.triggers || []).filter((x) => x.name !== a.nome); t.triggers.push(g);
    return `Trigger ${a.nome} criado em ${M.tname(t)}.`;
  }));
reg("madb_remover_trigger", "Remove um trigger pelo nome.", { tabela: z.string(), schema: SCH, nome: z.string() },
  mutate((m, { tabela, schema, nome }) => {
    const t = T(m, tabela, schema); const n = (t.triggers || []).length;
    t.triggers = (t.triggers || []).filter((x) => x.name !== nome);
    if (t.triggers.length === n) throw new Error(`Trigger "${nome}" não existe em ${M.tname(t)}.`);
    if (!t.triggers.length) delete t.triggers;
    return `Trigger ${nome} removido.`;
  }));

reg("madb_definir_particao", "Define a tabela como particionada (PARTITION BY RANGE|LIST|HASH). Atenção: a PK e os UNIQUEs precisam incluir as colunas de partição. Omita 'metodo' para remover a partição (e suas partições filhas do modelo).",
  { tabela: z.string(), schema: SCH, metodo: z.enum(["RANGE", "LIST", "HASH"]).optional(), colunas: z.array(z.string()).optional() },
  mutate((m, { tabela, schema, metodo, colunas }) => {
    const t = T(m, tabela, schema);
    if (!metodo) { delete t.partition; delete t.partitions; return `Particionamento removido de ${M.tname(t)}.`; }
    if (!colunas || !colunas.length) throw new Error("Informe 'colunas' de partição.");
    t.partition = { by: metodo, cols: colunas.map((n) => C(t, n).id) };
    return `${M.tname(t)} agora é particionada por ${metodo} (${colunas.join(", ")}).`;
  }));
reg("madb_adicionar_particao", "Adiciona (ou substitui pelo nome) uma partição filha. 'limite' é o trecho depois de FOR VALUES: \"FROM ('2026-11-01') TO ('2026-12-01')\", \"IN ('A','B')\", \"WITH (MODULUS 4, REMAINDER 0)\" ou \"DEFAULT\".",
  { tabela: z.string(), schema: SCH, nome: z.string().min(1), limite: z.string().min(1), schema_particao: z.string().optional() },
  mutate((m, a) => {
    const t = T(m, a.tabela, a.schema);
    if (!t.partition) throw new Error(`${M.tname(t)} não é particionada. Use madb_definir_particao antes.`);
    const p = { id: M.newId(m, "partition", t), name: a.nome, bound: a.limite };
    if (a.schema_particao) p.schema = a.schema_particao;
    t.partitions = (t.partitions || []).filter((x) => x.name !== a.nome); t.partitions.push(p);
    return `Partição ${a.nome} adicionada a ${M.tname(t)}.`;
  }));
reg("madb_remover_particao", "Remove uma partição filha pelo nome.", { tabela: z.string(), schema: SCH, nome: z.string() },
  mutate((m, { tabela, schema, nome }) => {
    const t = T(m, tabela, schema); const n = (t.partitions || []).length;
    t.partitions = (t.partitions || []).filter((x) => x.name !== nome);
    if (t.partitions.length === n) throw new Error(`Partição "${nome}" não existe em ${M.tname(t)}.`);
    if (!t.partitions.length) delete t.partitions;
    return `Partição ${nome} removida.`;
  }));

reg("madb_comentar", "Define o comentário (COMMENT ON) de uma tabela, coluna, schema ou enum. Texto vazio remove.",
  { alvo: z.enum(["tabela", "coluna", "schema", "enum"]), tabela: z.string().optional(), coluna: z.string().optional(), nome: z.string().optional().describe("Nome do schema ou do enum"), schema: z.string().optional(), texto: z.string() },
  mutate((m, a) => {
    const set = (o) => { if (a.texto) o.comment = a.texto; else delete o.comment; };
    if (a.alvo === "tabela") set(T(m, a.tabela, a.schema));
    else if (a.alvo === "coluna") set(C(T(m, a.tabela, a.schema), a.coluna));
    else if (a.alvo === "schema") {
      let s = m.schemas.find((x) => x.name === a.nome); if (!s) { s = { name: a.nome }; m.schemas.push(s); } set(s);
    } else {
      const e = m.enums.find((x) => x.name === a.nome && x.schema === (a.schema || "public")); if (!e) throw new Error(`Enum "${a.nome}" não existe.`); set(e);
    }
    return "Comentário atualizado.";
  }));

reg("madb_definir_opcoes", "Define opções do modelo. nomenclatura_indices: 'idx' (idx_<tabela>_<colunas>) ou 'ix' (ix_<tabela>__<colunas>) para os índices de FK gerados.",
  { nomenclatura_indices: z.enum(["idx", "ix"]) },
  mutate((m, { nomenclatura_indices }) => { m.options = Object.assign({}, m.options, { indexNaming: nomenclatura_indices }); return `Nomenclatura de índices: ${nomenclatura_indices}.`; }));

reg("madb_validar", "Valida o modelo e lista erros (SQL inválido ou recusado pelo PostgreSQL) e avisos.", {},
  read((m) => {
    const v = M.validate(m);
    if (!v.errors.length && !v.warnings.length) return "Modelo válido: nenhum erro nem aviso.";
    let s = "";
    if (v.errors.length) s += `Erros (${v.errors.length}):\n` + formatErrors(v.errors, 50);
    if (v.warnings.length) s += `${s ? "\n\n" : ""}Avisos (${v.warnings.length}):\n` + formatErrors(v.warnings, 50);
    return s;
  }));

function writeOut(p, content) {
  const f = path.resolve(expand(p));
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, content);
  return f;
}
reg("madb_gerar_sql", "Gera o DDL PostgreSQL 15+ completo: schemas, enums, funções, tabelas (identity, colunas geradas, partições), PK/UNIQUE, FKs (simples e compostas), índices (parciais, NULLS NOT DISTINCT), CHECKs, comentários e triggers. Com 'salvar_em', grava num arquivo e devolve só um resumo (recomendado para modelos grandes).",
  { indices_fk: z.boolean().default(false).describe("Criar índice em cada FK"), nomenclatura_indices: z.enum(["idx", "ix"]).optional(), salvar_em: z.string().optional().describe("Caminho do arquivo .sql a gravar") },
  read((m, { indices_fk, nomenclatura_indices, salvar_em }) => {
    const sql = M.toSQL(m, { fkIndexes: indices_fk, indexNaming: nomenclatura_indices });
    const v = M.validate(m);
    const aviso = v.errors.length ? `\n(Atenção: o modelo tem ${v.errors.length} erro(s); rode madb_validar.)` : "";
    if (salvar_em) return `SQL gravado em ${writeOut(salvar_em, sql)} (${sql.split("\n").length} linhas).${aviso}`;
    return sql + aviso;
  }));
reg("madb_gerar_mermaid", "Gera o diagrama ER em Mermaid (erDiagram).", {}, read((m) => "```mermaid\n" + M.toMermaid(m) + "```"));

reg("madb_exportar_json", "Exporta o modelo no formato v2 do site MADB. Com 'salvar_em', grava num arquivo (que o site pode abrir ou sincronizar) e devolve só um resumo; sem ele devolve o JSON inteiro (pode ser grande).",
  { salvar_em: z.string().optional() },
  read((m, { salvar_em }) => {
    const json = M.exportJSON(m);
    if (salvar_em) return `JSON gravado em ${writeOut(salvar_em, json)} (${json.length} caracteres).`;
    return json;
  }));

function importText(text, origem) {
  const r = M.load(text);
  if (!r.model || r.errors.length) throw new Error(`Importação cancelada (${origem}). O modelo atual não foi alterado.\n${formatErrors(r.errors, 20)}`);
  saveModel(r.model, false);
  const notes = r.notes.length ? "\n\nObservações:\n" + formatErrors(r.notes, 10) : "";
  const warn = r.warnings.length ? `\n\nAvisos: ${r.warnings.length} (use madb_validar).` : "";
  return `Modelo importado (${origem}): ${JSON.stringify(M.summary(r.model))}.${notes}${warn}`;
}
reg("madb_importar_json", "Substitui o modelo atual por um JSON (formato v2 do site, ou o formato antigo por nomes). Valida antes: se houver erro, nada é alterado e o erro vem legível.",
  { json: z.string().min(1) },
  async ({ json }) => { try { return txt(importText(json, "texto")); } catch (e) { return fail(e); } });
reg("madb_importar_arquivo", "Substitui o modelo atual pelo conteúdo de um arquivo .json no disco (mesmas regras de madb_importar_json).",
  { caminho: z.string().min(1) },
  async ({ caminho }) => {
    try {
      const f = path.resolve(expand(caminho));
      if (!fs.existsSync(f)) throw new Error(`Arquivo não encontrado: ${f}`);
      return txt(importText(fs.readFileSync(f, "utf8"), f));
    } catch (e) { return fail(e); }
  });

reg("madb_limpar", "Apaga todo o modelo atual (use só quando o usuário pedir para recomeçar).", {},
  async () => { try { saveModel(M.emptyModel(), false); return txt("Modelo limpo."); } catch (e) { return fail(e); } });

await server.connect(new StdioServerTransport());
