'use strict';
/**
 * Process Flows (Application → Process Flows): a business/user process across the app's pages, written by hand — a name,
 * a description, and the pages it goes through in order (start → next → …), each with a short note — and turned into a
 * document (print-ready HTML → PDF). Kept per VB Studio project in this app's data folder (one JSON file per flow).
 *
 * A flow: { id (PF-0001, given on the first save), name, description, area, owner, status (draft|review|approved|retired),
 *   pages: [{ id, page (a catalog page id, optional), name, note, shot }], created / createdBy / at, updated / updatedBy }
 *   A page's shot: { src: 'page' (fetched from the page's catalog screenshot) | 'pasted' (pasted/uploaded), data (a
 *   data:image/… URL kept with the flow so the document is self-contained) }. APIs are not stored — the page lists them
 *   live (and attaches them per page, as `apis`, only when it asks for the document: cleanFlow keeps them for that).
 *
 *   open({ dir: string | () => string, now }) → store
 *     list(q)            the flows (newest code first), each slimmed for a list (no description/notes)
 *     get(id)            one flow in full
 *     save(flow, by)     create or update (its code kept; updated/by stamped) → { ok, flow }
 *     remove(id)
 *   renderDocument(flow, { app, date })   the whole document, one self-contained print-ready HTML string (pure)
 *   aiPrompt(flow)                        the prompt to draft/expand the description from the name and pages (pure)
 *   cleanFlow(flow, by, old)              a flow with every field within its size (pure; what the page sends is not trusted)
 */
const fs = require('fs');
const path = require('path');

const STATUSES = { draft: 'Draft', review: 'In review', approved: 'Approved', retired: 'Retired' };
const MAX = { pages: 60, name: 200, note: 4000, desc: 20000, shot: 6000000, apis: 60, apiText: 400, calls: 40, callText: 24000, url: 2000 };

const str = (v) => (v === undefined || v === null ? '' : String(v));
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const cut = (v, n) => str(v).slice(0, n);
const codeNo = (c) => { const m = /^PF-(\d+)$/.exec(str(c)); return m ? Number(m[1]) : 0; };
const codeOf = (n) => 'PF-' + String(n).padStart(4, '0');
const slug = (id) => str(id).replace(/[^A-Za-z0-9_-]/g, '');
const idOf = (v, n) => cut(str(v).replace(/[^A-Za-z0-9_.:/-]/g, ''), n || 120);
const esc = (s) => str(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** A page's screenshot, kept as a data:image/… URL (so the document is self-contained), within size, or null. */
function cleanShot(s) {
  if (!isObj(s)) return null;
  const data = str(s.data);
  if (!/^data:image\/[a-zA-Z0-9.+-]+;base64,/.test(data) || data.length > MAX.shot) return null;
  return { src: s.src === 'page' ? 'page' : 'pasted', data };
}
/** A page's APIs (only kept for the document, when opts.keepApis): method, name, path, each within size. */
function cleanApis(a) {
  return (Array.isArray(a) ? a : []).filter(isObj).slice(0, MAX.apis)
    .map((x) => ({ method: cut(x.method, 12), name: cut(x.name, MAX.name), path: cut(x.path, MAX.apiText), writes: !!x.writes }))
    .filter((x) => x.name || x.path);
}
/** A page's recorded API calls (method, url, query, request body, status, short response), kept as the test data. */
function cleanCalls(a) {
  return (Array.isArray(a) ? a : []).filter(isObj).slice(0, MAX.calls).map((c) => {
    const out = { method: (cut(c.method, 12) || 'GET').toUpperCase(), url: cut(c.url, MAX.url), path: cut(c.path, MAX.url) };
    if (c.query) out.query = cut(c.query, 4000);
    if (c.body) out.body = cut(c.body, MAX.callText);
    if (c.status !== undefined && c.status !== null && c.status !== '') out.status = typeof c.status === 'number' ? c.status : cut(c.status, 20);
    if (c.response) out.response = cut(c.response, MAX.callText);
    if (c.respKind === 'json' || c.respKind === 'bip' || c.respKind === 'xml' || c.respKind === 'text') out.respKind = c.respKind;
    if (isObj(c.table) && Array.isArray(c.table.columns) && c.table.columns.length) {
      out.table = { columns: c.table.columns.slice(0, 24).map((x) => cut(x, 80)),
        rows: (Array.isArray(c.table.rows) ? c.table.rows : []).slice(0, 20).map((r) => (Array.isArray(r) ? r.slice(0, 24).map((x) => cut(x, 200)) : [])),
        total: typeof c.table.total === 'number' ? c.table.total : 0, from: cut(c.table.from, 60) };
    }
    return out;
  }).filter((c) => c.url || c.path);
}
/** A flow with every field within its size and shape (what the page or a person sent is never kept as is). */
function cleanFlow(flow, by, old, opts) {
  const f = isObj(flow) ? flow : {};
  const keepApis = !!(opts && opts.keepApis);
  const status = STATUSES[f.status] ? f.status : 'draft';
  let n = 0;
  const pages = (Array.isArray(f.pages) ? f.pages : []).filter(isObj).map((p) => {
    const out = { id: idOf(p.id, 20) || 'p' + (++n), page: idOf(p.page), name: cut(p.name, MAX.name).trim(), note: cut(p.note, MAX.note) };
    if (p.url) out.url = cut(p.url, MAX.url);
    if (p.kind === 'dialog' || p.kind === 'page') out.kind = p.kind;
    const shot = cleanShot(p.shot);
    if (shot) out.shot = shot;
    const calls = cleanCalls(p.calls);
    if (calls.length) out.calls = calls;
    if (keepApis) { const apis = cleanApis(p.apis); if (apis.length) out.apis = apis; }
    return out;
  }).filter((p) => p.name || p.page).slice(0, MAX.pages);
  const at = (old && old.createdAt) || null;
  return {
    id: old ? old.id : str(f.id),
    name: cut(f.name, MAX.name).trim() || 'Untitled process flow',
    description: cut(f.description, MAX.desc),
    area: cut(f.area, 120), owner: cut(f.owner, 120), status,
    pages,
    created: (old && old.created) || str(by), createdAt: at,
    updatedBy: str(by) };
}

// ── The document ──────────────────────────────────────────────────────────────────────────────────────────────────
// A modern, card-based process-flow document: a cover banner, a facts grid, the description, then the pages as a
// vertical timeline of cards (a numbered badge + a connecting line, Start / End tags, screenshot and APIs per card).
const CSS = `*{box-sizing:border-box}
@page{size:A4;margin:14mm 12mm}
body{font:11pt/1.55 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1f2a37;margin:0;background:#fff}
.cover{background:#fff;color:#1f2a37;border:1px solid #e3e8ee;border-radius:16px;padding:26px 30px}
.cover .kick{font-size:8.5pt;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#2e6fd8}
.cover h1{font-size:25pt;margin:4px 0 10px;line-height:1.15;color:#13315c}
.cover .meta{display:flex;flex-wrap:wrap;gap:8px 12px;align-items:center;font-size:9.5pt;color:#4a5865}
.cover .meta b{color:#8a97a5;font-weight:600}
.pill{display:inline-block;font-size:8pt;font-weight:700;letter-spacing:.05em;text-transform:uppercase;border-radius:999px;padding:3px 11px;background:#eef1f5;color:#44506a}
.pill.draft{background:#eef1f5;color:#44506a} .pill.review{background:#2a63c6;color:#fff} .pill.approved{background:#1f8a4c;color:#fff} .pill.retired{background:#6b7280;color:#fff}
h2{font-size:12.5pt;color:#13315c;margin:26px 0 12px;display:flex;align-items:center;gap:9px}
h2::before{content:'';width:4px;height:17px;background:#2e6fd8;border-radius:2px;display:inline-block}
.facts{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-top:16px}
.fact{border:1px solid #e3e8ee;border-radius:10px;padding:8px 12px;background:#fafbfd}
.fact .k{font-size:7.5pt;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#6b7886}
.fact .v{font-weight:600;font-size:10.5pt;margin-top:1px;overflow-wrap:anywhere}
.about p{margin:0 0 9px}
.cards{margin-top:4px}
.step{display:grid;grid-template-columns:46px 1fr;gap:14px}
.rail{display:flex;flex-direction:column;align-items:center}
.badge{width:40px;height:40px;border-radius:50%;background:#2e6fd8;color:#fff;font-weight:700;font-size:13pt;display:flex;align-items:center;justify-content:center;box-shadow:0 1px 3px rgba(16,32,64,.22)}
.badge.start{background:#1f8a4c} .badge.end{background:#b06400}
.line{flex:1;width:2px;background:#d6dee8;margin:5px 0;min-height:14px}
.card{border:1px solid #e3e8ee;border-radius:14px;padding:13px 16px;margin-bottom:16px;box-shadow:0 1px 3px rgba(16,32,64,.05);break-inside:avoid}
.card-head{display:flex;align-items:baseline;gap:9px;flex-wrap:wrap}
.card-head h3{font-size:13pt;margin:0;color:#13315c}
.tag{font-size:7.5pt;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:#fff;background:#8792a3;border-radius:999px;padding:2px 9px}
.tag.start{background:#1f8a4c} .tag.end{background:#b06400} .tag.dialog{background:#7c5cd6} .tag.screen{background:#2a63c6}
.path{font-size:8.5pt;color:#6b7886;margin-top:2px;overflow-wrap:anywhere}
.note{margin:8px 0 0;white-space:pre-wrap}
.shot{margin-top:10px}
.shot img{max-width:100%;max-height:300px;border:1px solid #e3e8ee;border-radius:9px;display:block}
.apis{margin-top:11px;border-top:1px dashed #e3e8ee;padding-top:9px}
.apis h4{font-size:7.5pt;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:#6b7886;margin:0 0 5px}
.apis ul{list-style:none;margin:0;padding:0}
.apis li{display:flex;gap:9px;align-items:baseline;padding:3px 0;border-top:1px solid #f1f3f6;font-size:9.5pt}
.apis li:first-child{border-top:0}
.m{display:inline-block;font-size:7.5pt;font-weight:700;color:#13315c;background:#e8eefb;border-radius:5px;padding:2px 6px;min-width:48px;text-align:center}
.apis code{font-size:8.5pt;color:#6b7886;overflow-wrap:anywhere}
.apis li{flex-direction:column;align-items:stretch}
.api-head{display:flex;gap:9px;align-items:baseline;flex-wrap:wrap}
.calldata{margin:6px 0 2px 2px;padding:7px 10px;border-left:3px solid #cfe0fb;background:#f7f9fc;border-radius:0 8px 8px 0;display:grid;gap:4px}
.cd-row{display:grid;gap:2px}
.cd-k{font-size:7pt;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:#6b7886}
.cd-v{font-size:9pt;color:#22303c;overflow-wrap:anywhere}
.cd-kind{display:inline-block;margin-left:6px;font-size:7pt;font-weight:700;letter-spacing:.03em;text-transform:uppercase;color:#2e6fd8;background:#eaf1fd;border:1px solid #cfe0fb;border-radius:999px;padding:0 6px}
.cd-pre{margin:3px 0 0;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:8pt;line-height:1.45;white-space:pre-wrap;overflow-wrap:anywhere;color:#22303c;background:#fff;border:1px solid #e6eaef;border-radius:6px;padding:5px 7px;max-height:280px;overflow:auto}
.cd-tbl{white-space:pre;overflow-wrap:normal}
.cd-det{margin:0}
.cd-det>summary{cursor:pointer;font-size:7pt;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:#6b7886;padding:2px 0;list-style:none;user-select:none}
.cd-det>summary::-webkit-details-marker{display:none}
.cd-det>summary::before{content:"\\25B8  ";color:#9aa6b2}
.cd-det[open]>summary::before{content:"\\25BE  ";color:#9aa6b2}
@media print{.cd-det>:not(summary){display:block !important}.cd-pre{max-height:none}}
.chip{font-size:7.5pt;font-weight:700;color:#8a4b00;background:#fdecd2;border-radius:999px;padding:1px 8px}
.foot{margin-top:30px;padding-top:10px;border-top:1px solid #e3e8ee;font-size:8.5pt;color:#6b7886}
.empty{color:#6b7886;font-style:italic}`;

function paras(text) {
  const t = str(text).trim();
  if (!t) return '<p class="empty">No description yet.</p>';
  return t.split(/\n{2,}/).map((p) => '<p>' + esc(p.trim()).replace(/\n/g, '<br>') + '</p>').join('');
}
// Match a recorded call to a catalog API by method + path pattern (mirrors flowRecorder.callForApi), so the document can
// show the data captured for each API, and know which recorded calls did not map to one.
function docPathOf(u) { const s = str(u).replace(/#.*$/, ''); const q = s.indexOf('?'); return (q === -1 ? s : s.slice(0, q)).replace(/^[a-z]+:\/\/[^/]+/i, '').replace(/\/+$/, '') || '/'; }
function docPathMatches(apiPath, got) {
  const pat = str(apiPath).replace(/[?#].*$/, '').replace(/\/+$/, '');
  const g = str(got).replace(/\/+$/, '');
  if (!pat) return false;
  if (g === pat || (pat.length && g.slice(-pat.length) === pat)) return true;
  try { return new RegExp(pat.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\{[^/}]+\\\}/g, '[^/]+') + '$').test(g); } catch (e) { return false; }
}
function docCallFor(api, calls) {
  if (!api || !api.path || !calls || !calls.length) return null;
  const m = str(api.method || 'GET').toUpperCase();
  const hits = calls.filter((c) => str(c.method || 'GET').toUpperCase() === m && docPathMatches(api.path, c.path || docPathOf(c.url)));
  hits.sort((a, b) => Math.abs(str(a.path || docPathOf(a.url)).length - api.path.length) - Math.abs(str(b.path || docPathOf(b.url)).length - api.path.length));
  return hits[0] || null;
}
/** A decoded row table as an aligned monospace table: columns padded to a common width (capped), all-empty columns
 *  dropped, long values clipped — so it reads as a grid rather than ragged pipes. */
function alignedTable(columns, rows) {
  const cols = (Array.isArray(columns) ? columns : []).map(str);
  if (!cols.length) return '';
  const data = (Array.isArray(rows) ? rows : []).map((r) => (Array.isArray(r) ? r.map(str) : []));
  let keep = cols.map((_, i) => data.some((r) => str(r[i]).trim() !== ''));
  if (!keep.some(Boolean)) keep = cols.map(() => true);
  const idx = cols.map((_, i) => i).filter((i) => keep[i]);
  const CAP = 34;
  const w = idx.map((i) => Math.min(CAP, Math.max(cols[i].length, 1, ...data.map((r) => str(r[i]).length))));
  const pad = (s, n) => { let v = str(s); if (v.length > n) v = v.slice(0, n - 1) + '…'; return v + ' '.repeat(Math.max(0, n - v.length)); };
  const line = (cells) => idx.map((i, k) => pad(cells[i], w[k])).join(' | ');
  const sep = w.map((n) => '-'.repeat(n)).join('-+-');
  return line(cols) + '\n' + sep + '\n' + data.map(line).join('\n');
}
/** JSON pretty-printed when the text is JSON (so a one-line request body reads nicely); otherwise the text as is. */
function prettyMaybeJson(t) {
  const s = str(t).trim();
  if (!s || !/^[[{]/.test(s)) return str(t);
  try { return JSON.stringify(JSON.parse(s), null, 2); } catch (e) { return str(t); }
}
/** The data captured for one call, as document HTML: its query / request body and its decoded response (JSON pretty, or a
 *  BI Publisher row table), each large block in a collapsible <details> (expand / collapse). Empty when there is no call. */
function callDataHtml(c) {
  if (!isObj(c)) return '';
  const row = (k, v) => (v ? '<div class="cd-row"><span class="cd-k">' + esc(k) + '</span><span class="cd-v">' + esc(v) + '</span></div>' : '');
  const det = (label, v, open, cls) => (v ? '<details class="cd-det"' + (open ? ' open' : '') + '><summary>' + esc(label) + '</summary><pre class="cd-pre' + (cls ? ' ' + cls : '') + '">' + esc(v) + '</pre></details>' : '');
  const kind = c.respKind === 'bip' ? 'BIP XML' : c.respKind === 'json' ? 'JSON' : c.respKind === 'xml' ? 'XML' : c.respKind === 'text' ? 'Text' : '';
  let rows = '';
  if (isObj(c.table) && Array.isArray(c.table.columns) && c.table.columns.length) {
    const n = typeof c.table.total === 'number' ? c.table.total : (c.table.rows ? c.table.rows.length : 0);
    rows = det('Rows (' + n + (c.table.from ? ' · ' + c.table.from : '') + ')', alignedTable(c.table.columns, c.table.rows), true, 'cd-tbl');
  }
  const statusLine = (c.status !== undefined && c.status !== null && c.status !== '' ? 'HTTP ' + c.status : '') + (kind ? (c.status ? ' · ' : '') + kind : '');
  // request body open (usually small), the decoded rows open (the useful bit), the raw response body collapsed by default
  return '<div class="calldata">'
    + row('Request', (str(c.method || 'GET').toUpperCase()) + ' ' + (c.path || docPathOf(c.url)))
    + row('Query', c.query)
    + det('Request body', prettyMaybeJson(c.body), true)
    + row('Response', statusLine)
    + rows
    + det('Response body' + (kind ? ' (' + kind + ')' : ''), c.response, !rows)
    + '</div>';
}
/** The whole document: a cover banner, a facts grid, the description, then the pages as a vertical card timeline. */
function renderDocument(flow, opts) {
  const o = opts || {};
  const f = cleanFlow(flow, flow && flow.updatedBy, flow, { keepApis: true });
  const pages = f.pages;
  const date = o.date || new Date().toISOString().slice(0, 10);
  const apiList = (p) => {
    const calls = (p.calls && p.calls.length) ? p.calls : [];
    const used = [];
    const list = (p.apis && p.apis.length)
      ? '<div class="apis"><h4>APIs on this page (' + p.apis.length + ')</h4><ul>'
        + p.apis.map((a) => {
          const call = docCallFor(a, calls);
          if (call) used.push(call);
          return '<li><div class="api-head"><span class="m">' + esc(a.method || 'CALL') + '</span><b>' + esc(a.name || '') + '</b>'
            + (a.path ? ' <code>' + esc(a.path) + '</code>' : '') + (a.writes ? ' <span class="chip">changes data</span>' : '') + '</div>'
            + callDataHtml(call) + '</li>';
        }).join('')
        + '</ul></div>'
      : '';
    // recorded calls that did not map to a catalog API — still shown, so the captured data is never hidden
    const extra = calls.filter((c) => used.indexOf(c) === -1);
    const extraHtml = extra.length
      ? '<div class="apis"><h4>Other recorded calls (' + extra.length + ')</h4><ul>'
        + extra.map((c) => '<li><div class="api-head"><span class="m">' + esc(str(c.method || 'GET').toUpperCase()) + '</span>'
          + '<code>' + esc(c.path || docPathOf(c.url)) + '</code></div>' + callDataHtml(c) + '</li>').join('')
        + '</ul></div>'
      : '';
    return list + extraHtml;
  };
  const shotImg = (p) => (p.shot && p.shot.data ? '<div class="shot"><img src="' + p.shot.data + '" alt="Screenshot of ' + esc(p.name || p.page) + '"></div>' : '');
  const fact = (k, v) => (v ? '<div class="fact"><div class="k">' + esc(k) + '</div><div class="v">' + esc(v) + '</div></div>' : '');
  const metaBits = [f.area, f.owner ? 'Owner: ' + f.owner : '', date].filter(Boolean).map((x) => esc(x)).join('<b> · </b>');
  const cards = pages.length
    ? '<div class="cards">' + pages.map((p, i) => {
      const start = i === 0; const end = i === pages.length - 1;
      return '<div class="step"><div class="rail"><span class="badge ' + (start ? 'start' : end ? 'end' : '') + '">' + (i + 1) + '</span>' + (end ? '' : '<span class="line"></span>') + '</div>'
        + '<div class="card"><div class="card-head"><h3>' + esc(p.name || p.page) + '</h3>'
        + (p.kind === 'dialog' ? '<span class="tag dialog">Dialog</span>' : p.kind === 'page' ? '<span class="tag screen">Screen</span>' : '')
        + (start ? '<span class="tag start">Start</span>' : end ? '<span class="tag end">End</span>' : '<span class="tag">Step ' + (i + 1) + '</span>') + '</div>'
        + (p.url ? '<div class="path">' + esc(p.url) + '</div>' : (p.page && p.page !== p.name ? '<div class="path">' + esc(p.page) + '</div>' : ''))
        + (p.note ? '<div class="note">' + esc(p.note).replace(/\n/g, '<br>') + '</div>' : '')
        + shotImg(p) + apiList(p) + '</div></div>';
    }).join('') + '</div>'
    : '<p class="empty">No pages yet.</p>';
  return '<!doctype html><html><head><meta charset="utf-8"><title>' + esc(f.name) + '</title><style>' + CSS + '</style></head><body>'
    + '<div class="cover"><div class="kick">Process flow</div><h1>' + esc(f.name) + '</h1>'
    + '<div class="meta"><span class="pill ' + f.status + '">' + esc(STATUSES[f.status]) + '</span>' + (metaBits ? '<span>' + metaBits + '</span>' : '') + '</div></div>'
    + '<div class="facts">' + fact('Code', f.id) + fact('Area', f.area) + fact('Owner', f.owner) + fact('Status', STATUSES[f.status])
    + fact('Pages', String(pages.length)) + fact('Application', o.app) + '</div>'
    + '<h2>About this process</h2><div class="about">' + paras(f.description) + '</div>'
    + '<h2>The flow, step by step</h2>' + cards
    + '<div class="foot">Generated by Build.Rite' + (date ? ' on ' + esc(date) : '') + '. A process flow written by the team; review before use.</div>'
    + '</body></html>';
}

/** The prompt to draft or expand the description from the flow's name and its pages (optional "Draft with AI"). */
function aiPrompt(flow) {
  const f = cleanFlow(flow, '', flow);
  const list = f.pages.length ? f.pages.map((p, i) => (i + 1) + '. ' + (p.name || p.page) + (p.note ? ' — ' + p.note : '')).join('\n') : '(no pages listed yet)';
  return 'Write a clear, plain-English description of a business process for a process-flow document. '
    + 'Do not invent pages or steps that are not listed. Keep it factual and concise.\n\n'
    + 'Process name: ' + f.name + '\n'
    + (f.area ? 'Area: ' + f.area + '\n' : '')
    + 'The pages it goes through, in order:\n' + list + '\n\n'
    + (str(f.description).trim() ? 'What the author has written so far (improve and expand on it, keep its meaning):\n' + f.description + '\n\n' : '')
    + 'Write: one short overview paragraph of what the process achieves and who does it; then one short paragraph per page '
    + 'saying what the user does on it and why it comes at that point; then a one-line closing note. Plain paragraphs, no headings, no lists.';
}

function open(opts) {
  const o = opts || {};
  const now = typeof o.now === 'function' ? o.now : () => new Date();
  const dirNow = () => { const d = typeof o.dir === 'function' ? o.dir() : o.dir; return d ? path.resolve(d) : ''; };
  const no = (error) => ({ ok: false, error });
  const NO_DIR = 'Set up your workspace first: process flows are kept per VB Studio project.';
  const file = (id) => path.join(dirNow(), slug(id) + '.json');
  const read = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return null; } };
  const write = (fl) => { const d = dirNow(); fs.mkdirSync(d, { recursive: true }); const f = file(fl.id); fs.writeFileSync(f + '.tmp', JSON.stringify(fl, null, 2)); fs.renameSync(f + '.tmp', f); };
  const all = () => { const d = dirNow(); if (!d) return []; try { return fs.readdirSync(d).filter((n) => /^PF-\d+\.json$/.test(n)).map((n) => read(path.join(d, n))).filter(Boolean); } catch (e) { return []; } };

  return {
    STATUSES,
    list(q) {
      if (!dirNow()) return no(NO_DIR);
      const words = str(q).toLowerCase().split(/\s+/).filter(Boolean);
      const flows = all().filter((f) => { const hay = (f.name + ' ' + f.area + ' ' + f.id + ' ' + (f.pages || []).map((p) => p.name).join(' ')).toLowerCase(); return words.every((w) => hay.indexOf(w) !== -1); })
        .sort((a, b) => codeNo(b.id) - codeNo(a.id))
        .map((f) => ({ id: f.id, name: f.name, area: f.area, owner: f.owner, status: f.status, pages: (f.pages || []).length,
          names: (f.pages || []).map((p) => p.name || p.page), updated: f.updatedAt || '', updatedBy: f.updatedBy || f.created || '' }));
      return { ok: true, flows };
    },
    get(id) { if (!dirNow()) return no(NO_DIR); const f = read(file(str(id))); return f ? { ok: true, flow: f } : no('No such process flow.'); },
    save(flow, by) {
      if (!dirNow()) return no(NO_DIR);
      if (!isObj(flow)) return no('No flow.');
      const old = flow.id ? read(file(str(flow.id))) : null;
      const at = now().toISOString();
      const f = cleanFlow(flow, by, old);
      if (!f.id) f.id = codeOf(all().reduce((m, x) => Math.max(m, codeNo(x.id)), 0) + 1);
      if (!f.created) f.created = str(by);
      if (!f.createdAt) f.createdAt = at;
      f.updatedAt = at;
      write(f);
      return { ok: true, flow: f };
    },
    remove(id) {
      if (!dirNow()) return no(NO_DIR);
      if (!read(file(str(id)))) return no('No such process flow.');
      try { fs.unlinkSync(file(str(id))); } catch (e) { return no('It could not be removed: ' + e.message); }
      return { ok: true };
    },
  };
}

module.exports = { open, STATUSES, renderDocument, aiPrompt, cleanFlow };
