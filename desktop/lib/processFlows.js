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
const MAX = { pages: 60, name: 200, note: 4000, desc: 20000, shot: 6000000, apis: 60, apiText: 400 };

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
/** A flow with every field within its size and shape (what the page or a person sent is never kept as is). */
function cleanFlow(flow, by, old, opts) {
  const f = isObj(flow) ? flow : {};
  const keepApis = !!(opts && opts.keepApis);
  const status = STATUSES[f.status] ? f.status : 'draft';
  let n = 0;
  const pages = (Array.isArray(f.pages) ? f.pages : []).filter(isObj).map((p) => {
    const out = { id: idOf(p.id, 20) || 'p' + (++n), page: idOf(p.page), name: cut(p.name, MAX.name).trim(), note: cut(p.note, MAX.note) };
    const shot = cleanShot(p.shot);
    if (shot) out.shot = shot;
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
.cover{background:linear-gradient(125deg,#13315c 0%,#1e498f 55%,#2e6fd8 100%);color:#fff;border-radius:16px;padding:26px 30px}
.cover .kick{font-size:8.5pt;font-weight:700;letter-spacing:.14em;text-transform:uppercase;opacity:.82}
.cover h1{font-size:25pt;margin:4px 0 10px;line-height:1.15}
.cover .meta{display:flex;flex-wrap:wrap;gap:8px 12px;align-items:center;font-size:9.5pt;opacity:.95}
.cover .meta b{opacity:.7;font-weight:600}
.pill{display:inline-block;font-size:8pt;font-weight:700;letter-spacing:.05em;text-transform:uppercase;border-radius:999px;padding:3px 11px;background:rgba(255,255,255,.18);color:#fff}
.pill.draft{background:rgba(255,255,255,.2)} .pill.review{background:#2a63c6} .pill.approved{background:#1f8a4c} .pill.retired{background:#6b7280}
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
.tag.start{background:#1f8a4c} .tag.end{background:#b06400}
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
.chip{font-size:7.5pt;font-weight:700;color:#8a4b00;background:#fdecd2;border-radius:999px;padding:1px 8px}
.foot{margin-top:30px;padding-top:10px;border-top:1px solid #e3e8ee;font-size:8.5pt;color:#6b7886}
.empty{color:#6b7886;font-style:italic}`;

function paras(text) {
  const t = str(text).trim();
  if (!t) return '<p class="empty">No description yet.</p>';
  return t.split(/\n{2,}/).map((p) => '<p>' + esc(p.trim()).replace(/\n/g, '<br>') + '</p>').join('');
}
/** The whole document: a cover banner, a facts grid, the description, then the pages as a vertical card timeline. */
function renderDocument(flow, opts) {
  const o = opts || {};
  const f = cleanFlow(flow, flow && flow.updatedBy, flow, { keepApis: true });
  const pages = f.pages;
  const date = o.date || new Date().toISOString().slice(0, 10);
  const apiList = (p) => (p.apis && p.apis.length
    ? '<div class="apis"><h4>APIs on this page (' + p.apis.length + ')</h4><ul>'
      + p.apis.map((a) => '<li><span class="m">' + esc(a.method || 'CALL') + '</span><b>' + esc(a.name || '') + '</b>'
        + (a.path ? ' <code>' + esc(a.path) + '</code>' : '') + (a.writes ? ' <span class="chip">changes data</span>' : '') + '</li>').join('')
      + '</ul></div>' : '');
  const shotImg = (p) => (p.shot && p.shot.data ? '<div class="shot"><img src="' + p.shot.data + '" alt="Screenshot of ' + esc(p.name || p.page) + '"></div>' : '');
  const fact = (k, v) => (v ? '<div class="fact"><div class="k">' + esc(k) + '</div><div class="v">' + esc(v) + '</div></div>' : '');
  const metaBits = [f.area, f.owner ? 'Owner: ' + f.owner : '', date].filter(Boolean).map((x) => esc(x)).join('<b> · </b>');
  const cards = pages.length
    ? '<div class="cards">' + pages.map((p, i) => {
      const start = i === 0; const end = i === pages.length - 1;
      return '<div class="step"><div class="rail"><span class="badge ' + (start ? 'start' : end ? 'end' : '') + '">' + (i + 1) + '</span>' + (end ? '' : '<span class="line"></span>') + '</div>'
        + '<div class="card"><div class="card-head"><h3>' + esc(p.name || p.page) + '</h3>'
        + (start ? '<span class="tag start">Start</span>' : end ? '<span class="tag end">End</span>' : '<span class="tag">Step ' + (i + 1) + '</span>') + '</div>'
        + (p.page && p.page !== p.name ? '<div class="path">' + esc(p.page) + '</div>' : '')
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
