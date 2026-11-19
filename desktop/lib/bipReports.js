'use strict';
/**
 * BIP Reporting (Tools → BIP Reporting): the BI Publisher catalog of a Fusion pod — browse it, index it for search, read a
 * report's parameters and output formats, run it (in date / value buckets, one runReport per bucket, the output joined into
 * one table), keep every run on this PC, favourites, and a dashboard of report cards. Ported from the WMS app's Oracle BIP
 * Reporting module (bip/ + BipService.cs + BipStore.cs); its rules are shared with the screen (resources/js/bipKit.js).
 *
 * It signs in with Fusion SQL's pods (lib/fusionSql.js soap(): the same users, the password never leaves the desktop, the
 * calls show in Fusion SQL → API Inspector with the password as ***). Every call is SOAP 1.1 to BI Publisher's v2 web
 * services: CatalogService getFolderContents / downloadObject, ReportService getReportDefinition / getReportParameters /
 * runReport / downloadReportDataChunk (big outputs come in chunks).
 *
 *   open({ dir, fq, now }) → store
 *     dir   this app's data folder for BIP (catalog cache per pod, runs, favourites, dashboard) — never the project, never git
 *     fq    the Fusion SQL store (settings, soap)
 *   settings()                         { pods, active, prefs: { chunkMb, timeoutS, indexRoot } }
 *   savePrefs(p)
 *   folder(pod, path, refresh)         a folder's items (from this PC's copy unless refresh) → { items, at, src }
 *   index(pod, { root, max, update, progressId })   the catalog walked breadth-first (4 folders at a time) → counts; update
 *                                      compares with the copy kept (added / changed / removed)
 *   search(pod, q)                     the index (or the folders read so far) searched → { items, indexed, at }
 *   definition(pod, path, refresh)     its parameters, output formats, data model → { def, at, src }
 *   dataModel(pod, path)               the data model's data sets (their SQL) and parameters
 *   run(pod, { path, name, values, params, plan, format, template, locale, progressId })   → { run, columns, rows }
 *   progress(id) / cancel(id)          a run or an index still going; Stop
 *   runs() / runRows(id, offset, limit) / removeRun(id) / runFile(id)   this PC's runs
 *   favorites() / toggleFavorite({ pod, path, name })
 *   cards() / saveCard(card) / removeCard(id) / runCard(pod, id)        the dashboard
 *
 * Pure helpers (exported for tests): itemsOf, definitionOf, xmlRows, csvTable, dataModelOf, runInner, paramXml, unzipEntry.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const E = require('../../webApps/buildrite/resources/js/bipKit.js');
const FQ = require('./fusionSql');

const str = (v) => (v == null ? '' : String(v));
const esc = (s) => str(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
const cut = (s, n) => { const t = str(s); return t.length > n ? t.slice(0, n) + '…' : t; };
const clamp = (n, lo, hi, d) => { const x = Number(n); return Number.isFinite(x) ? Math.min(hi, Math.max(lo, Math.round(x))) : d; };
const PREFS = { chunkMb: 8, timeoutS: 600, indexRoot: '/', maxFolders: 1500 };
const ROWS_KEPT = 200000; // rows kept for the grid per run (the whole output stays in its file)
const ROWS_SENT = 50000; // rows sent to the screen at once
const FORMATS = ['csv', 'xml', 'pdf', 'xlsx', 'excel', 'html', 'rtf', 'pptx', 'docx', 'text', 'mhtml', 'ppt', 'excel2000', 'xslfo', 'eft', 'etext'];
const EXT = { csv: 'csv', xml: 'xml', pdf: 'pdf', xlsx: 'xlsx', excel: 'xls', excel2000: 'xls', html: 'html', mhtml: 'mht', rtf: 'rtf', pptx: 'pptx', ppt: 'ppt', docx: 'docx', text: 'txt', eft: 'txt', etext: 'txt', xslfo: 'fo' };
const pathOk = (p) => /^\/[^<>"]{0,1000}$/.test(str(p));

// ── SOAP answers ────────────────────────────────────────────────────────────────────────────────────────────────────
const kid = (n, name) => (n && n.children ? n.children.filter((c) => c.name === name)[0] : null);
const kidText = (n, name) => { const k = kid(n, name); return k ? k.text.trim() : ''; };
const itemTexts = (n, name) => { const k = kid(n, name); return k ? k.children.filter((c) => c.name === 'item').map((c) => c.text.trim()) : (n && kidText(n, name) ? [kidText(n, name)] : []); };
function walk(node, out) { (node.children || []).forEach((c) => { out.push(c); walk(c, out); }); return out; }
const parentOf = (p) => { const s = str(p).replace(/\/+$/, ''); const i = s.lastIndexOf('/'); return i <= 0 ? '/' : s.slice(0, i); };
const bool = (s) => /^true$/i.test(str(s));

/** getFolderContents → the folder's items: folders first, then by name. */
function itemsOf(text) {
  const tree = FQ.xmlTree(text);
  if (!tree) return null;
  return walk(tree, []).filter((n) => n.name === 'item' && kid(n, 'absolutePath')).map((n) => {
    const p = kidText(n, 'absolutePath');
    return { absolutePath: p, displayName: kidText(n, 'displayName') || kidText(n, 'fileName') || p.split('/').pop(), fileName: kidText(n, 'fileName'), type: kidText(n, 'type'),
      parentAbsolutePath: kidText(n, 'parentAbsolutePath') || parentOf(p), lastModified: kidText(n, 'lastModified'), owner: kidText(n, 'owner') };
  }).sort((a, b) => (a.type === 'Folder' ? 0 : 1) - (b.type === 'Folder' ? 0 : 1) || a.displayName.localeCompare(b.displayName, undefined, { sensitivity: 'base' }));
}
function paramOf(n) {
  const def = kid(n, 'defaultValue');
  const defaults = def && def.children.length ? def.children.map((c) => c.text.trim()) : (def && def.text.trim() ? [def.text.trim()] : []);
  return { name: kidText(n, 'name'), label: kidText(n, 'label') || kidText(n, 'name'), dataType: kidText(n, 'dataType'), uiType: kidText(n, 'UIType') || kidText(n, 'uiType'),
    defaultValue: defaults, values: itemTexts(n, 'values'), lovLabels: itemTexts(n, 'lovLabels'), multiValuesAllowed: bool(kidText(n, 'multiValuesAllowed')),
    selectAsAll: bool(kidText(n, 'selectAsAll')), useNullForAll: bool(kidText(n, 'useNullForAll')), dateFormatString: kidText(n, 'dateFormatString'),
    dateFrom: kidText(n, 'dateFrom'), dateTo: kidText(n, 'dateTo'), mandatory: bool(kidText(n, 'mandatory')) };
}
/** getReportDefinition → its name, default output, data model, templates with their formats, parameters. */
function definitionOf(text) {
  const tree = FQ.xmlTree(text);
  if (!tree) return null;
  const r = walk(tree, []).filter((n) => n.name === 'getReportDefinitionReturn')[0] || tree;
  const tf = kid(r, 'listOfTemplateFormatsLabelValues');
  const templates = tf ? tf.children.filter((c) => c.name === 'item').map((it) => {
    const fl = kid(it, 'templateFormatsLabelValues');
    return { id: kidText(it, 'templateID'), type: kidText(it, 'templateType'), formats: fl ? fl.children.filter((c) => c.name === 'item').map((f) => ({ key: kidText(f, 'templateFormatLabel'), value: kidText(f, 'templateFormatValue') })) : [] };
  }) : [];
  const pv = kid(r, 'reportParameterNameValues');
  return { reportName: kidText(r, 'reportName'), description: kidText(r, 'reportDescription'), reportType: kidText(r, 'reportType'), defaultOutputFormat: kidText(r, 'defaultOutputFormat'),
    defaultTemplateId: kidText(r, 'defaultTemplateId'), dataModelUrl: kidText(r, 'dataModelURL'), templateIds: itemTexts(r, 'templateIds'), parameterNames: itemTexts(r, 'parameterNames'),
    templates, parameters: pv ? pv.children.filter((c) => c.name === 'item').map(paramOf) : [] };
}
function paramsOf(text) {
  const tree = FQ.xmlTree(text);
  if (!tree) return [];
  const ret = walk(tree, []).filter((n) => n.name === 'getReportParametersReturn')[0];
  if (!ret) return [];
  const list = ret.children.filter((c) => c.name === 'item' && kid(c, 'name')).map(paramOf);
  return list.length ? list : (kid(ret, 'name') ? [paramOf(ret)] : []);
}

// ── Output → rows ───────────────────────────────────────────────────────────────────────────────────────────────────
/** A CSV (RFC 4180: quotes, doubled quotes, newlines inside quotes) → { columns (the header, in order), rows }. */
function csvTable(text) {
  const t = str(text).replace(/^﻿/, '');
  const records = [];
  let field = '', rec = [], inQ = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (inQ) { if (ch === '"') { if (t[i + 1] === '"') { field += '"'; i++; } else inQ = false; } else field += ch; }
    else if (ch === '"') inQ = true;
    else if (ch === ',') { rec.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && t[i + 1] === '\n') i++;
      rec.push(field); field = '';
      if (!(rec.length === 1 && rec[0] === '')) records.push(rec);
      rec = [];
    } else field += ch;
  }
  if (field || rec.length) { rec.push(field); if (!(rec.length === 1 && rec[0] === '')) records.push(rec); }
  if (!records.length) return { columns: [], rows: [] };
  const columns = records[0].map((h, i) => h.trim() || 'COLUMN_' + (i + 1));
  return { columns, rows: records.slice(1).map((r) => { const d = {}; columns.forEach((c, i) => { if (i < r.length && r[i] !== '') d[c] = FQ.coerce(r[i]); }); return d; }) };
}
/**
 * BI Publisher data XML (DATA_DS / G_1 … or any layout) → { columns, rows }: the first element that repeats at depth 1–3 is a
 * row; its leaves are columns, a single nested group adds its leaves, a repeating nested group (header → lines) gives one row
 * per inner element with the parent's values repeated, like a join. Nothing repeats: the document's leaves are one row.
 */
function xmlRows(text) {
  const tree = FQ.xmlTree(str(text).replace(/^﻿/, ''));
  if (!tree) return null;
  // the row: the shallowest element that repeats (a header's repeating lines are not the row; they join it)
  const counts = {}, order = [];
  (function scan(n, depth) {
    for (const c of n.children) {
      if (depth > 3) return;
      const k = depth + ':' + c.name;
      if (!counts[k]) order.push(k);
      counts[k] = (counts[k] || 0) + 1;
      scan(c, depth + 1);
    }
  }(tree, 1));
  const hit = order.filter((k) => counts[k] >= 2).sort((a, b) => Number(a.split(':')[0]) - Number(b.split(':')[0]))[0] || '';
  const rowName = hit ? hit.slice(hit.indexOf(':') + 1) : '', rowDepth = hit ? Number(hit.split(':')[0]) : -1;
  const columns = [];
  const seen = {};
  const add = (row) => { Object.keys(row).forEach((k) => { if (!seen[k]) { seen[k] = 1; columns.push(k); } }); return row; };
  const flatten = (el, inherited) => {
    const row = Object.assign({}, inherited || {});
    const groups = [];
    el.children.forEach((ch) => { if (ch.children.length) groups.push(ch); else if (ch.text.trim() !== '') row[ch.name] = FQ.coerce(ch.text.trim()); else if (!(ch.name in row)) row[ch.name] = undefined; });
    if (!groups.length) return [row];
    const byName = {};
    groups.forEach((g) => { (byName[g.name] = byName[g.name] || []).push(g); });
    const repeating = [];
    Object.keys(byName).forEach((k) => {
      if (byName[k].length > 1) { repeating.push(byName[k]); return; }
      const inner = flatten(byName[k][0], null);
      if (inner.length === 1) Object.keys(inner[0]).forEach((x) => { if (!(x in row)) row[x] = inner[0][x]; });
      else repeating.push(byName[k]);
    });
    if (!repeating.length) return [row];
    const out = [];
    repeating.forEach((grp) => grp.forEach((item) => flatten(item, row).forEach((r) => out.push(r))));
    return out;
  };
  const clean = (r) => { Object.keys(r).forEach((k) => { if (r[k] === undefined) delete r[k]; }); return r; };
  if (!rowName) {
    const leaves = walk(tree, []).filter((n) => !n.children.length);
    if (!leaves.length) return { columns: [], rows: [] };
    const one = {};
    leaves.forEach((l) => { one[l.name] = l.text.trim() === '' ? undefined : FQ.coerce(l.text.trim()); });
    add(one);
    return { columns, rows: [clean(one)] };
  }
  const rows = [];
  (function collect(n, depth) {
    for (const c of n.children) {
      if (depth === rowDepth && c.name === rowName) flatten(c, null).forEach((r) => rows.push(clean(add(r))));
      else if (depth < rowDepth) collect(c, depth + 1);
    }
  }(tree, 1));
  return { columns, rows };
}
/** One file out of a ZIP (stored or deflated), found through the central directory: the first name `want` matches. */
function unzipEntry(buf, want) {
  if (!Buffer.isBuffer(buf) || buf.length < 22 || buf.readUInt32LE(0) !== 0x04034b50) return null;
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) return null;
  const n = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const names = [];
  for (let k = 0; k < n && p + 46 <= buf.length; k++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20), nlen = buf.readUInt16LE(p + 28), xlen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32), off = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nlen).toString('utf8');
    names.push(name);
    if (want.test(name)) {
      const lnlen = buf.readUInt16LE(off + 26), lxlen = buf.readUInt16LE(off + 28);
      const data = buf.slice(off + 30 + lnlen + lxlen, off + 30 + lnlen + lxlen + csize);
      return { name, data: method === 8 ? zlib.inflateRawSync(data) : data };
    }
    p += 46 + nlen + xlen + clen;
  }
  return { name: '', data: null, names };
}
const attr = (attrs, name) => { const m = new RegExp('\\b' + name + '\\s*=\\s*"([^"]*)"').exec(str(attrs)); return m ? FQ.unescapeOnce(m[1]) : ''; };
const cdata = (s) => { const m = /<!\[CDATA\[([\s\S]*?)\]\]>/.exec(str(s)); return (m ? m[1] : FQ.unescapeOnce(str(s))).trim(); };
/** A data model (.xdm XML, or the zip downloadObject returns) → its data sets (SQL) and parameters. */
function dataModelOf(buf) {
  let xml = '';
  if (Buffer.isBuffer(buf) && buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4b) {
    const e = unzipEntry(buf, /\.xdm$/i) || {};
    const x = e.data ? e : unzipEntry(buf, /\.xml$/i) || {};
    if (!x.data) return { ok: false, error: 'The download holds no data model (.xdm)' + (e.names && e.names.length ? ': ' + e.names.slice(0, 10).join(', ') : '.') };
    xml = x.data.toString('utf8');
  } else xml = str(Buffer.isBuffer(buf) ? buf.toString('utf8') : buf);
  xml = xml.replace(/^﻿/, '');
  const root = /<(?:\w+:)?dataModel\b([^>]*)>/.exec(xml);
  if (!root) return { ok: false, error: 'That is not a BI Publisher data model.' };
  const dataSource = attr(root[1], 'defaultDataSourceRef');
  const dataSets = [];
  const re = /<(?:\w+:)?dataSet\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?dataSet>/g;
  let m;
  while ((m = re.exec(xml))) {
    const sql = /<(?:\w+:)?sql\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?sql>/.exec(m[2]);
    if (sql) dataSets.push({ name: attr(m[1], 'name'), dataSource: attr(sql[1], 'dataSourceRef') || dataSource, sql: cdata(sql[2]) });
  }
  const parameters = [];
  const pre = /<(?:\w+:)?parameter\b([^>]*?)(\/>|>([\s\S]*?)<\/(?:\w+:)?parameter>)/g;
  while ((m = pre.exec(xml))) {
    const name = attr(m[1], 'name');
    if (!name) continue;
    const label = /<(?:\w+:)?input\b[^>]*\blabel\s*=\s*"([^"]*)"/.exec(m[3] || '');
    parameters.push({ name, dataType: attr(m[1], 'dataType').replace(/^xsd:/, ''), defaultValue: attr(m[1], 'defaultValue'), label: label ? label[1] : name });
  }
  const desc = /<(?:\w+:)?description>([\s\S]*?)<\/(?:\w+:)?description>/.exec(xml);
  return { ok: true, dataSource, description: desc ? cdata(desc[1]) : '', dataSets, parameters };
}

// ── Requests ────────────────────────────────────────────────────────────────────────────────────────────────────────
/** The parameter values BI Publisher receives ({ name: [values] }); a name with several values says multiValuesAllowed. */
function paramXml(params) {
  const names = Object.keys(params || {}).filter((k) => /^[\w$#.:-]{1,200}$/.test(k));
  if (!names.length) return '';
  return '<v2:parameterNameValues><v2:listOfParamNameValues>' + names.map((k) => {
    const vals = (Array.isArray(params[k]) ? params[k] : [params[k]]).filter((v) => v != null).map(str);
    return '<v2:item><v2:name>' + esc(k) + '</v2:name>' + (vals.length > 1 ? '<v2:multiValuesAllowed>true</v2:multiValuesAllowed>' : '')
      + '<v2:values>' + (vals.length ? vals.map((v) => '<v2:item>' + esc(v) + '</v2:item>').join('') : '<v2:item></v2:item>') + '</v2:values></v2:item>';
  }).join('') + '</v2:listOfParamNameValues></v2:parameterNameValues>';
}
function runInner(req) {
  const r = req || {};
  return '<v2:reportRequest><v2:attributeFormat>' + esc(str(r.format || 'csv').toLowerCase()) + '</v2:attributeFormat>'
    + (r.locale ? '<v2:attributeLocale>' + esc(r.locale) + '</v2:attributeLocale>' : '') + (r.template ? '<v2:attributeTemplate>' + esc(r.template) + '</v2:attributeTemplate>' : '')
    + '<v2:byPassCache>true</v2:byPassCache><v2:flattenXML>false</v2:flattenXML>' + paramXml(r.params)
    + '<v2:reportAbsolutePath>' + esc(r.path) + '</v2:reportAbsolutePath><v2:sizeOfDataChunkDownload>' + (r.chunkBytes > 0 ? r.chunkBytes : -1) + '</v2:sizeOfDataChunkDownload></v2:reportRequest>';
}

function open(opts) {
  const o = opts || {};
  const now = typeof o.now === 'function' ? o.now : () => new Date();
  const dirNow = () => (typeof o.dir === 'function' ? o.dir() : o.dir);
  const no = (error, extra) => Object.assign({ ok: false, error }, extra || {});
  const jobs = {}; // progress of runs and index walks: { steps, done, cancel, at }
  const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return d; } };
  const writeJson = (f, v) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f + '.tmp', JSON.stringify(v)); fs.renameSync(f + '.tmp', f); };
  const mainFile = () => path.join(dirNow(), 'bip.json');
  const readMain = () => { const d = readJson(mainFile(), {}); d.favorites = d.favorites || []; d.cards = d.cards || []; d.prefs = Object.assign({}, PREFS, d.prefs || {}); return d; };
  const writeMain = (d) => writeJson(mainFile(), d);

  const pods = () => { const s = o.fq ? o.fq.settings() : { pods: [], active: '' }; return { pods: (s.pods || []).map((p) => ({ id: p.id, name: p.name, url: p.url, active: p.active, username: p.username })), active: s.active }; };
  const podOf = (id) => { const s = pods(); return s.pods.filter((p) => p.id === (str(id) || s.active))[0] || null; };
  const cacheFile = (p) => path.join(dirNow(), 'catalog-' + str(new URL(p.url).host).replace(/[^\w.-]/g, '_').slice(0, 120) + '.json');
  const readCache = (p) => { const c = readJson(cacheFile(p), {}); c.folders = c.folders || {}; c.defs = c.defs || {}; return c; };
  const call = (p, service, op, inner, timeoutMs, kind) => o.fq.soap(p.id, service, op, inner, { timeoutMs, kind });
  const job = (id) => { const k = str(id).slice(0, 60); if (!k) return null; jobs[k] = jobs[k] || { steps: [], done: false, cancel: false, at: Date.now() }; Object.keys(jobs).forEach((x) => { if (Date.now() - jobs[x].at > 3600000) delete jobs[x]; }); return jobs[k]; };
  const step = (j, s) => { if (j) { j.steps.push(Object.assign({ at: now().toISOString() }, s)); if (j.steps.length > 400) j.steps.splice(0, j.steps.length - 400); j.last = s; } };

  async function listFolder(p, folderPath) {
    const r = await call(p, 'catalog', 'getFolderContents', '<v2:folderAbsolutePath>' + esc(folderPath) + '</v2:folderAbsolutePath>', 120000, 'getFolderContents');
    if (!r.ok) return no(r.error, { needsLogin: r.needsLogin });
    const items = itemsOf(r.text);
    if (!items) return no('An answer that is not XML: ' + cut(str(r.text).replace(/\s+/g, ' '), 200));
    return { ok: true, items };
  }

  return {
    settings() { const s = pods(); return { ok: true, pods: s.pods, active: s.active, prefs: readMain().prefs }; },
    savePrefs(b) {
      const d = readMain();
      const x = b || {};
      d.prefs = { chunkMb: clamp(x.chunkMb, 1, 64, PREFS.chunkMb), timeoutS: clamp(x.timeoutS, 30, 7200, PREFS.timeoutS), indexRoot: pathOk(x.indexRoot) ? str(x.indexRoot) : PREFS.indexRoot,
        maxFolders: clamp(x.maxFolders, 10, 5000, PREFS.maxFolders) };
      writeMain(d);
      return { ok: true, prefs: d.prefs };
    },
    async folder(podId, folderPath, refresh) {
      const p = podOf(podId);
      if (!p) return no('Add a Fusion pod first (Fusion SQL → Connection).', { noPod: true });
      const fp = str(folderPath) || '/';
      if (!pathOk(fp)) return no('A catalog path starts with /.');
      const c = readCache(p);
      if (!refresh && c.folders[fp]) return { ok: true, items: c.folders[fp].items, at: c.folders[fp].at, src: 'cache', path: fp };
      const r = await listFolder(p, fp);
      if (!r.ok) {
        // Fusion said no: the index still knows what is in it
        const known = ((c.index && c.index.items) || []).filter((it) => it.parentAbsolutePath === fp);
        if (known.length) return { ok: true, items: known, at: c.index.at, src: 'index', path: fp, warning: r.error };
        return r;
      }
      const at = now().toISOString();
      c.folders[fp] = { at, items: r.items };
      writeJson(cacheFile(p), c);
      return { ok: true, items: r.items, at, src: 'fusion', path: fp };
    },
    async index(podId, b) {
      const p = podOf(podId);
      if (!p) return no('Add a Fusion pod first (Fusion SQL → Connection).', { noPod: true });
      const x = b || {};
      const prefs = readMain().prefs;
      const root = pathOk(x.root) ? str(x.root) : prefs.indexRoot;
      const max = clamp(x.max, 1, 5000, prefs.maxFolders);
      const j = job(x.progressId);
      const t0 = Date.now();
      const queue = [root], seen = { [root]: true }, items = [], errors = [];
      let folders = 0, capped = false;
      const c = readCache(p);
      const at = now().toISOString();
      const worker = async () => {
        while (queue.length) {
          if (j && j.cancel) return;
          const fp = queue.shift();
          folders++;
          step(j, { kind: 'folder', label: fp, folders, items: items.length });
          const r = await listFolder(p, fp);
          if (!r.ok) { errors.push(fp + ': ' + str(r.error).split('\n')[0]); if (r.needsLogin) { queue.length = 0; } continue; }
          c.folders[fp] = { at, items: r.items };
          r.items.forEach((it) => {
            items.push({ absolutePath: it.absolutePath, displayName: it.displayName, type: it.type, lastModified: it.lastModified, owner: it.owner, parentAbsolutePath: it.parentAbsolutePath });
            if (it.type === 'Folder' && !seen[it.absolutePath]) { if (folders + queue.length < max) { seen[it.absolutePath] = true; queue.push(it.absolutePath); } else capped = true; }
          });
        }
      };
      await Promise.all([worker(), worker(), worker(), worker()]);
      if (j) j.done = true;
      if (!items.length && errors.length) return no(errors[0], { errors });
      const prev = c.index && c.index.root === root ? c.index.items : (c.index ? c.index.items.filter((it) => it.absolutePath.indexOf(root === '/' ? '/' : root + '/') === 0) : []);
      const before = {};
      prev.forEach((it) => { before[it.absolutePath] = it; });
      const now2 = {};
      items.forEach((it) => { now2[it.absolutePath] = it; });
      const added = items.filter((it) => !before[it.absolutePath]).length;
      const changed = items.filter((it) => before[it.absolutePath] && (before[it.absolutePath].lastModified !== it.lastModified || before[it.absolutePath].displayName !== it.displayName || before[it.absolutePath].type !== it.type)).length;
      const removed = prev.filter((it) => !now2[it.absolutePath]).length;
      const stopped = !!(j && j.cancel);
      c.index = { at, root, items: stopped && c.index ? c.index.items : items, folders, capped, mode: x.update && c.index ? 'update' : 'full', added, changed, removed, ms: Date.now() - t0, errors: errors.slice(0, 20), since: c.index ? c.index.at : '' };
      if (!stopped) writeJson(cacheFile(p), c);
      return { ok: true, stopped, root, folders, items: items.length, reports: items.filter((it) => it.type === 'Report').length, capped, added, changed, removed, mode: c.index.mode, since: c.index.since, at, ms: c.index.ms, errors: errors.slice(0, 20) };
    },
    progress(id) { const j = jobs[str(id)]; return j ? { ok: true, steps: j.steps.slice(-30), last: j.last || null, done: j.done } : { ok: true, steps: [], done: true }; },
    cancel(id) { const j = jobs[str(id)]; if (j) j.cancel = true; return { ok: true }; },
    search(podId, q) {
      const p = podOf(podId);
      if (!p) return no('Add a Fusion pod first.', { noPod: true });
      const c = readCache(p);
      const fromFolders = () => { const all = {}; Object.keys(c.folders).forEach((f) => c.folders[f].items.forEach((it) => { all[it.absolutePath] = it; })); return Object.keys(all).map((k) => all[k]); };
      const list = c.index ? c.index.items : fromFolders();
      return { ok: true, items: E.search(list, q, 60), indexed: !!c.index, at: c.index ? c.index.at : '', count: list.length,
        index: c.index ? { at: c.index.at, root: c.index.root, folders: c.index.folders, items: c.index.items.length, mode: c.index.mode, added: c.index.added, changed: c.index.changed, removed: c.index.removed, since: c.index.since } : null };
    },
    async definition(podId, reportPath, refresh) {
      const p = podOf(podId);
      if (!p) return no('Add a Fusion pod first.', { noPod: true });
      if (!pathOk(reportPath)) return no('A report path starts with /.');
      const c = readCache(p);
      if (!refresh && c.defs[reportPath]) return { ok: true, def: c.defs[reportPath].def, at: c.defs[reportPath].at, src: 'cache' };
      const r = await call(p, 'report', 'getReportDefinition', '<v2:reportAbsolutePath>' + esc(reportPath) + '</v2:reportAbsolutePath>', 120000, 'getReportDefinition');
      if (!r.ok) return no(r.error, { needsLogin: r.needsLogin });
      const def = definitionOf(r.text);
      if (!def) return no('An answer that is not XML: ' + cut(str(r.text).replace(/\s+/g, ' '), 200));
      if (!def.parameters.length && def.parameterNames.length) {
        // the definition named its parameters without their details: ask for them
        const pr = await call(p, 'report', 'getReportParameters', '<v2:reportRequest><v2:attributeFormat>xml</v2:attributeFormat><v2:reportAbsolutePath>' + esc(reportPath)
          + '</v2:reportAbsolutePath><v2:sizeOfDataChunkDownload>-1</v2:sizeOfDataChunkDownload></v2:reportRequest>', 120000, 'getReportParameters');
        if (pr.ok) def.parameters = paramsOf(pr.text);
        if (!def.parameters.length) def.parameters = def.parameterNames.map((n) => ({ name: n, label: n, dataType: 'String', defaultValue: [], values: [], lovLabels: [] }));
      }
      const at = now().toISOString();
      c.defs[reportPath] = { at, def };
      writeJson(cacheFile(p), c);
      return { ok: true, def, at, src: 'fusion' };
    },
    async dataModel(podId, dmPath) {
      const p = podOf(podId);
      if (!p) return no('Add a Fusion pod first.', { noPod: true });
      if (!pathOk(dmPath)) return no('A data model path starts with /.');
      const r = await call(p, 'catalog', 'downloadObject', '<v2:reportAbsolutePath>' + esc(dmPath) + '</v2:reportAbsolutePath>', 300000, 'downloadObject');
      if (!r.ok) return no(r.error, { needsLogin: r.needsLogin });
      const b64 = FQ.readSoap(r.text, 'downloadObjectReturn').value;
      if (!str(b64).trim()) return no('downloadObject returned nothing for ' + dmPath + ' (is the user allowed to read the data model?).');
      return Object.assign({ path: dmPath }, dataModelOf(Buffer.from(str(b64).replace(/\s/g, ''), 'base64')));
    },
    async run(podId, b) {
      const p = podOf(podId);
      if (!p) return no('Add a Fusion pod first (Fusion SQL → Connection).', { noPod: true });
      const x = b || {};
      if (!pathOk(x.path) || !/\.xdo$/i.test(str(x.path))) return no('Choose a report (its path ends in .xdo).');
      let format = str(x.format || 'csv').toLowerCase();
      if (format === 'data') format = 'xml';
      if (FORMATS.indexOf(format) === -1) return no('Not an output format: ' + format + '.');
      const data = E.isData(format);
      const plan = Array.isArray(x.plan) && x.plan.length ? x.plan.slice(0, 400) : [{ label: '', params: {} }];
      if (!data && plan.length > 1) return no('Buckets need CSV or XML output: their rows are joined into one table.');
      const prefs = readMain().prefs;
      const chunkBytes = clamp(prefs.chunkMb, 1, 64, 8) * 1024 * 1024;
      const timeoutMs = clamp(prefs.timeoutS, 30, 7200, 600) * 1000;
      const j = job(x.progressId);
      const id = now().toISOString().replace(/[-:T]/g, '').slice(0, 14) + '-' + crypto.randomBytes(3).toString('hex');
      const folder = path.join(dirNow(), 'runs', id);
      fs.mkdirSync(folder, { recursive: true });
      const meta = { id, podId: p.id, pod: p.name, user: p.username, path: str(x.path), name: str(x.name) || str(x.path).split('/').pop().replace(/\.xdo$/i, ''), format,
        template: str(x.template), values: x.values || {}, params: x.params || {}, buckets: plan.length, status: 'RUNNING', started: now().toISOString(), parts: [] };
      writeJson(path.join(folder, 'run.json'), meta);
      const t0 = Date.now();
      let table = { columns: [], rows: [] }, bytes = 0, contentType = '';
      const seen = {};
      for (let i = 0; i < plan.length; i++) {
        if (j && j.cancel) { meta.parts.push({ label: plan[i].label, ok: false, error: 'Stopped.' }); continue; }
        const params = Object.assign({}, x.params || {}, plan[i].params || {});
        const part = path.join(folder, 'part-' + (i + 1) + '.' + (EXT[format] || 'out'));
        const tb = Date.now();
        step(j, { kind: 'bucket', label: plan.length > 1 ? 'Bucket ' + (i + 1) + ' of ' + plan.length + (plan[i].label ? ': ' + plan[i].label : '') : 'Fusion is running the report…', i, n: plan.length });
        let r = await call(p, 'report', 'runReport', runInner({ format, template: x.template, locale: x.locale, params, path: x.path, chunkBytes }), timeoutMs, 'runReport (' + format + ')');
        if (!r.ok) { meta.parts.push({ label: plan[i].label, ok: false, error: r.error, ms: Date.now() - tb }); if (r.needsLogin) break; continue; }
        let b64 = str(FQ.readSoap(r.text, 'reportBytes').value).replace(/\s/g, '');
        const fileId = str(FQ.readSoap(r.text, 'reportFileID').value).trim();
        contentType = contentType || str(FQ.readSoap(r.text, 'reportContentType').value).trim();
        let buf = Buffer.from(b64, 'base64');
        fs.writeFileSync(part, buf);
        let size = buf.length, chunks = 1, error = '';
        while (fileId && buf.length >= chunkBytes && !(j && j.cancel)) {
          step(j, { kind: 'chunk', label: 'Receiving chunk ' + (chunks + 1) + '… ' + E.fmtBytes(size), i, n: plan.length });
          r = await call(p, 'report', 'downloadReportDataChunk', '<v2:fileID>' + esc(fileId) + '</v2:fileID><v2:beginIdx>' + size + '</v2:beginIdx><v2:size>' + chunkBytes + '</v2:size>', Math.max(timeoutMs, 300000), 'downloadReportDataChunk');
          if (!r.ok) { error = 'Chunk ' + (chunks + 1) + ': ' + r.error; break; }
          b64 = str(FQ.readSoap(r.text, 'reportDataChunk').value || FQ.readSoap(r.text, 'reportBytes').value).replace(/\s/g, '');
          buf = Buffer.from(b64, 'base64');
          fs.appendFileSync(part, buf);
          size += buf.length;
          chunks++;
          if (chunks > 10000) { error = 'The report did not end after 10,000 chunks.'; break; }
        }
        b64 = null; buf = null;
        bytes += size;
        if (error) { meta.parts.push({ label: plan[i].label, ok: false, error, bytes: size, ms: Date.now() - tb }); continue; }
        let rowsHere = null;
        if (data) {
          const text = fs.readFileSync(part, 'utf8');
          const t = format === 'csv' ? csvTable(text) : xmlRows(text);
          if (!t) { meta.parts.push({ label: plan[i].label, ok: false, error: 'The output is not ' + format.toUpperCase() + ' data: ' + cut(text.replace(/\s+/g, ' '), 160), bytes: size, ms: Date.now() - tb }); continue; }
          t.columns.forEach((c) => { if (!seen[c]) { seen[c] = 1; table.columns.push(c); } });
          rowsHere = t.rows.length;
          for (const row of t.rows) { if (table.rows.length >= ROWS_KEPT) { table.capped = true; break; } if (plan.length > 1) row.BUCKET = plan[i].label; table.rows.push(row); }
        }
        meta.parts.push({ label: plan[i].label, ok: true, rows: rowsHere, bytes: size, chunks, ms: Date.now() - tb, file: path.basename(part) });
      }
      if (j) j.done = true;
      if (data && plan.length > 1 && table.rows.length) table.columns.push('BUCKET');
      const good = meta.parts.filter((x2) => x2.ok).length;
      meta.status = !good ? 'FAILED' : good < plan.length ? 'PARTIAL' : 'DONE';
      meta.stopped = !!(j && j.cancel);
      meta.ms = Date.now() - t0;
      meta.bytes = bytes;
      meta.contentType = contentType;
      meta.rows = data ? table.rows.length : null;
      meta.capped = !!table.capped;
      meta.columns = table.columns.length;
      meta.error = good ? '' : (meta.parts[0] && meta.parts[0].error) || 'Nothing came back.';
      meta.ended = now().toISOString();
      // the output: one bucket = its file; several = their rows as one CSV
      if (good === 1 && plan.length === 1) { const f = meta.parts[0].file; meta.file = 'output.' + (EXT[format] || 'out'); fs.renameSync(path.join(folder, f), path.join(folder, meta.file)); meta.parts[0].file = meta.file; }
      else if (good && data) { meta.file = 'output.csv'; fs.writeFileSync(path.join(folder, meta.file), E.csvOf ? E.csvOf(table.rows, table.columns) : csvOf(table.rows, table.columns)); }
      if (data) writeJson(path.join(folder, 'rows.json'), table);
      writeJson(path.join(folder, 'run.json'), meta);
      return { ok: good > 0, error: meta.error, run: meta, columns: table.columns, rows: table.rows.slice(0, ROWS_SENT), sent: Math.min(ROWS_SENT, table.rows.length) };
    },
    runs() {
      const d = path.join(dirNow(), 'runs');
      let ids = [];
      try { ids = fs.readdirSync(d).filter((n) => /^[\w-]+$/.test(n)); } catch (e) { ids = []; }
      const list = ids.map((n) => readJson(path.join(d, n, 'run.json'), null)).filter(Boolean).sort((a, b) => str(b.started).localeCompare(str(a.started)));
      return { ok: true, runs: list.slice(0, 300) };
    },
    runRows(id, offset, limit) {
      if (!/^[\w-]+$/.test(str(id))) return no('No such run.');
      const folder = path.join(dirNow(), 'runs', str(id));
      const meta = readJson(path.join(folder, 'run.json'), null);
      if (!meta) return no('No such run.');
      const t = readJson(path.join(folder, 'rows.json'), null);
      const off = clamp(offset, 0, 1e9, 0), lim = clamp(limit, 1, ROWS_SENT, ROWS_SENT);
      return { ok: true, run: meta, columns: t ? t.columns : [], rows: t ? t.rows.slice(off, off + lim) : [], total: t ? t.rows.length : 0 };
    },
    removeRun(id) {
      if (!/^[\w-]+$/.test(str(id))) return no('No such run.');
      const folder = path.join(dirNow(), 'runs', str(id));
      if (!fs.existsSync(path.join(folder, 'run.json'))) return no('No such run.');
      fs.rmSync(folder, { recursive: true, force: true });
      return { ok: true };
    },
    runFile(id) {
      if (!/^[\w-]+$/.test(str(id))) return no('No such run.');
      const folder = path.join(dirNow(), 'runs', str(id));
      const meta = readJson(path.join(folder, 'run.json'), null);
      if (!meta || !meta.file) return no('That run has no output file.');
      return { ok: true, file: path.join(folder, meta.file), folder, name: meta.name + '.' + meta.file.split('.').pop() };
    },
    favorites() { return { ok: true, favorites: readMain().favorites }; },
    toggleFavorite(b) {
      const x = b || {};
      if (!pathOk(x.path)) return no('Not a catalog path.');
      const d = readMain();
      const has = d.favorites.some((f) => f.path === x.path && f.pod === str(x.pod));
      d.favorites = has ? d.favorites.filter((f) => !(f.path === x.path && f.pod === str(x.pod))) : d.favorites.concat([{ pod: str(x.pod), path: str(x.path), name: str(x.name) || str(x.path).split('/').pop(), type: str(x.type) || 'Report', at: now().toISOString() }]);
      writeMain(d);
      return { ok: true, favorite: !has, favorites: d.favorites };
    },
    cards() { return { ok: true, cards: readMain().cards }; },
    saveCard(card) {
      const x = card || {};
      if (!pathOk(x.path)) return no('Choose a report first.');
      const d = readMain();
      const old = d.cards.filter((c) => c.id === x.id)[0];
      const c = Object.assign({}, old || {}, { id: (old && old.id) || 'c' + crypto.randomBytes(4).toString('hex'), pod: str(x.pod), path: str(x.path), name: cut(str(x.name).trim() || str(x.path).split('/').pop(), 120),
        format: E.isData(x.format) ? str(x.format) : 'csv', template: str(x.template), values: x.values || {}, params: x.params || {}, show: x.show === 'table' ? 'table' : 'number',
        measure: x.measure || { mode: 'count' }, rolling: x.rolling && x.rolling.from && x.rolling.to ? { from: str(x.rolling.from), to: str(x.rolling.to), days: clamp(x.rolling.days, 0, 3660, 30), fmtFrom: str(x.rolling.fmtFrom), fmtTo: str(x.rolling.fmtTo) } : null });
      d.cards = old ? d.cards.map((y) => (y.id === c.id ? c : y)) : d.cards.concat([c]);
      writeMain(d);
      return { ok: true, card: c };
    },
    removeCard(id) { const d = readMain(); const before = d.cards.length; d.cards = d.cards.filter((c) => c.id !== id); if (d.cards.length === before) return no('No such card.'); writeMain(d); return { ok: true }; },
    async runCard(podId, id) {
      const d = readMain();
      const card = d.cards.filter((c) => c.id === id)[0];
      if (!card) return no('No such card.');
      const params = Object.assign({}, card.params);
      if (card.rolling) {
        // dates that move with today: the last n days up to today
        const to = new Date(now().getFullYear(), now().getMonth(), now().getDate());
        params[card.rolling.from] = [E.format(E.addDays(to, -card.rolling.days), card.rolling.fmtFrom)];
        params[card.rolling.to] = [E.format(to, card.rolling.fmtTo)];
      }
      const r = await this.run(card.pod || podId, { path: card.path, name: card.name, values: card.values, params, format: card.format, template: card.template });
      const last = r.ok ? { at: now().toISOString(), ok: true, rows: r.run.rows, columns: r.columns.slice(0, 8), preview: r.rows.slice(0, 8), value: E.cardValue(r.rows, card.measure), ms: r.run.ms, runId: r.run.id }
        : { at: now().toISOString(), ok: false, error: r.error, runId: r.run ? r.run.id : '' };
      const d2 = readMain();
      d2.cards = d2.cards.map((c) => (c.id === id ? Object.assign({}, c, { last }) : c));
      writeMain(d2);
      return { ok: true, card: d2.cards.filter((c) => c.id === id)[0] };
    }
  };
}
function csvOf(rows, columns) {
  const q = (v) => { if (v == null) return ''; const s = String(v); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  return columns.map(q).join(',') + '\r\n' + rows.map((r) => columns.map((c) => q(r[c])).join(',')).join('\r\n') + '\r\n';
}

module.exports = { open, itemsOf, definitionOf, paramsOf, xmlRows, csvTable, dataModelOf, runInner, paramXml, unzipEntry, csvOf, FORMATS };
