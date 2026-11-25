// Teste do site (index.html) com jsdom: importação por arquivo/arrastar/colar, erros legíveis, editor e SQL.
// Requer jsdom (npm i jsdom, em qualquer pasta; use JSDOM_PATH=/caminho/para/jsdom se não estiver no projeto).
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
let JSDOM;
try { ({ JSDOM } = await import(process.env.JSDOM_PATH ? path.join(process.env.JSDOM_PATH, 'lib', 'api.js') : 'jsdom')); } catch { JSDOM = null; }
const skip = JSDOM ? false : 'jsdom não instalado';

const abertas = [];
after(() => abertas.forEach((w) => w.close()));
function abrir() {
  let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const core = fs.readFileSync(path.join(root, 'madb-core.js'), 'utf8');
  html = html.replace('<script src="madb-core.js"></script>', () => '<script>' + core + '</script>');
  const erros = [];
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://exemplo.test/', beforeParse(w) {
    w.addEventListener('error', (e) => erros.push(e.message));
    w.HTMLElement.prototype.scrollTo = () => {};
  } });
  abertas.push(dom.window);
  return { w: dom.window, erros, $: (s) => dom.window.document.querySelector(s), ev: (c) => dom.window.eval(c) };
}
const ex = (n) => fs.readFileSync(path.join(root, 'exemplos', n), 'utf8');
const ok = (w) => w.document.querySelector('#mOk').click();

test('site: abre sem erros, desenha o exemplo e gera SQL', { skip }, () => {
  const { w, erros, $, ev } = abrir();
  assert.deepEqual(erros, []);
  assert.equal(w.document.querySelectorAll('#svg .tb').length, 4);
  assert.match($('#code').value, /CREATE TABLE clientes/);
  assert.match($('#code').value, /CHECK \(quantidade > 0\)/);
  assert.equal(ev('S.tables.length'), 4);
});

test('site: importar JSON válido por colagem cria nova arquitetura (padrão do modal) e mostra o resumo', { skip }, () => {
  const { w, $, ev } = abrir();
  w.document.querySelector('.tab[data-t=json]').click();
  $('#code').value = ex('valido-completo.json');
  $('#bApply').click();
  assert.equal($('#modal').hidden, false, 'pergunta substituir ou nova');
  ok(w);
  assert.equal(ev('DB.ws.length'), 2);
  assert.equal(ev('cur().model.tables.length'), 4);
  assert.match($('#imp').textContent, /Importado/);
  assert.match(ev('cur().origin.text'), /importado de o JSON colado/);
  w.document.querySelector('.tab[data-t=sql]').click();
  assert.match($('#code').value, /CREATE TYPE vendas\.pedido_status AS ENUM/);
  assert.match($('#code').value, /PARTITION BY RANGE/);
  assert.match($('#code').value, /FOREIGN KEY \(pedido_id, cliente_id\)/);
});

test('site: JSON inválido não altera nada e mostra caminho e motivo', { skip }, () => {
  const { w, $, ev } = abrir();
  w.document.querySelector('.tab[data-t=json]').click();
  $('#code').value = ex('invalido-ref-inexistente.json');
  $('#bApply').click();
  assert.equal($('#modal').hidden, true);
  assert.equal(ev('DB.ws.length'), 1);
  assert.equal(ev('S.tables.length'), 4);
  assert.match($('#imp').textContent, /Não importei/);
  assert.match($('#imp').textContent, /tables\[1\]\.cols\[1\]\.ref/);
  assert.match($('#imp').textContent, /aponta para a tabela "t9", que não existe/);
  $('#code').value = ex('invalido-sintaxe.json');
  $('#bApply').click();
  assert.match($('#imp').textContent, /linha \d+, coluna \d+/);
});

test('site: arquivo e colagem dão o mesmo modelo; arrastar e soltar importa', { skip }, async () => {
  const a = abrir(), b = abrir();
  const texto = ex('valido-completo.json');
  a.ev('document.querySelector(".tab[data-t=json]").click()');
  a.$('#code').value = texto; a.$('#bApply').click(); ok(a.w);
  const arq = new b.w.File(['﻿' + texto.replace(/\n/g, '\r\n')], 'vendas.json', { type: 'application/json' });
  const dt = { files: [arq], types: ['Files'] };
  const drop = new b.w.Event('drop', { bubbles: true, cancelable: true }); drop.dataTransfer = dt;
  b.w.dispatchEvent(drop);
  await new Promise((r) => setTimeout(r, 50));
  ok(b.w);
  assert.equal(b.ev('MADB.exportJSON(cur().model)'), a.ev('MADB.exportJSON(cur().model)'));
  assert.match(b.ev('cur().name'), /vendas/);
});

test('site: editor adiciona CHECK, FK composta, índice parcial, trigger e partição e o SQL reflete', { skip }, () => {
  const { w, $, ev } = abrir();
  ev(`sel=S.tables.find(t=>t.name==='itens_pedido').id;renderAll()`);
  const click = (a) => w.document.querySelector(`#editor [data-a=${a}]`).click();
  click('addK'); click('addI'); click('addG');
  const t = ev('tOf(sel)');
  assert.equal(t.constraints.length, 2); assert.equal(t.indexes.length, 1); assert.equal(t.triggers.length, 1);
  // índice parcial único com nulls not distinct, digitando e disparando change
  const set = (sel, v, evt = 'change') => { const el = w.document.querySelector(sel); el.value = v; el.dispatchEvent(new w.Event('input', { bubbles: true })); el.dispatchEvent(new w.Event(evt, { bubbles: true })); };
  set('#editor [data-k=idx] [data-f=icols]', 'quantidade DESC NULLS LAST');
  set('#editor [data-k=idx] [data-f=iwhere]', 'quantidade > 0', 'input');
  const u = w.document.querySelector('#editor [data-k=idx] [data-f=iuq]'); u.checked = true; u.dispatchEvent(new w.Event('change', { bubbles: true }));
  assert.match($('#code').value, /CREATE UNIQUE INDEX .* \(quantidade DESC NULLS LAST\)\s+WHERE quantidade > 0/);
  // nome de coluna inexistente mostra erro e não altera o modelo
  set('#editor [data-k=idx] [data-f=icols]', 'nao_existe');
  assert.match($('#editor').textContent, /Não entendi: nao_existe/);
  assert.equal(ev('tOf(sel).indexes[0].cols.length'), 1);
  // FK composta: segunda restrição vira fk
  set(`#editor [data-k=con][data-id="${ev('tOf(sel).constraints[1].id')}"] [data-f=ckind]`, 'fk');
  assert.equal(ev('tOf(sel).constraints[1].kind'), 'fk');
  // partição
  set('#editor [data-f=pby]', 'RANGE');
  assert.equal(ev('tOf(sel).partition.by'), 'RANGE');
  assert.match($('#code').value, /PARTITION BY RANGE/);
});

test('site: modelo (schemas/enums/funções) e tipo enum sugerido nas colunas', { skip }, () => {
  const { w, $, ev } = abrir();
  ev(`sel='__model';renderAll()`);
  w.document.querySelector('#editor [data-a=addE]').click();
  assert.equal(ev('S.enums.length'), 1);
  assert.match(w.document.querySelector('#types').innerHTML, /novo_enum/);
  assert.match($('#code').value, /CREATE TYPE novo_enum AS ENUM \('valor1', 'valor2'\)/);
});

test('site: sincronização com arquivo vinculado detecta mudança, avisa conflito e não sobrescreve', { skip }, async () => {
  const { w, $, ev } = abrir();
  // simula um handle de arquivo local
  let conteudo = ex('valido-completo.json'), stamp = 1000;
  const handle = { name: 'modelo.json', queryPermission: async () => 'granted', requestPermission: async () => 'granted',
    getFile: async () => ({ lastModified: stamp, name: 'modelo.json', text: async () => conteudo, size: conteudo.length }) };
  w.__h = handle;
  ev(`cur().link={name:'modelo.json'};handles[cur().id]=__h;link={handle:__h};`);
  await ev('pullFromFile(true)');
  // arquivo difere e o modelo local nunca foi sincronizado -> pergunta
  assert.equal($('#modal').hidden, false);
  ok(w); // padrão: nova arquitetura
  assert.equal(ev('DB.ws.length'), 2);
  assert.match(ev('cur().origin.text'), /recebido do arquivo modelo\.json/);
  // agora sincronizado: mudança externa sem alteração local -> aplica sozinha
  const novo = JSON.parse(conteudo); novo.tables[0].comment = 'mudou pelo agente'; conteudo = JSON.stringify(novo); stamp = 2000;
  await ev('pullFromFile(false)');
  assert.equal($('#modal').hidden, true);
  assert.equal(ev('S.tables[0].comment'), 'mudou pelo agente');
  // alteração local + mudança externa -> conflito, 'manter a minha' preserva
  ev(`S.tables[0].comment='meu texto';`);
  const n2 = JSON.parse(conteudo); n2.tables[0].comment = 'outro texto do agente'; conteudo = JSON.stringify(n2); stamp = 3000;
  await ev('pullFromFile(false)');
  assert.equal($('#modal').hidden, false);
  w.document.querySelector('#mExtra input[value=minha]').checked = true; w.document.querySelector('#mExtra input[value=novo]').checked = false;
  ok(w);
  assert.equal(ev('S.tables[0].comment'), 'meu texto');
  await ev('pullFromFile(false)'); // mesma versão do arquivo: não pergunta de novo
  assert.equal($('#modal').hidden, true);
});

test('site: "sincronizar sozinho" sobrevive ao F5 e, sem permissão, avisa em vez de falhar calado', { skip }, async () => {
  const { w, $, ev } = abrir();
  const handle = { name: 'modelo.json', queryPermission: async () => 'prompt', requestPermission: async () => 'granted',
    getFile: async () => ({ lastModified: 1, name: 'modelo.json', text: async () => ex('valido-completo.json'), size: 10 }) };
  w.__h = handle;
  ev(`cur().link={name:'modelo.json'};handles[cur().id]=__h;link={handle:__h};renderStatus();`);
  const c = $('#optAuto'); c.checked = true; c.dispatchEvent(new w.Event('change', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 30));
  const salvo = JSON.parse(w.localStorage.getItem('madb_ws_v1'));
  assert.equal(salvo.ws[0].auto, true, 'a escolha foi gravada');
  assert.equal(salvo.ws[0].link.name, 'modelo.json');
  // leitura automática sem permissão não pede nada nem quebra: mostra o aviso
  await ev('pullFromFile(false)');
  assert.match($('#origin').textContent, /nova permissão/);
});
