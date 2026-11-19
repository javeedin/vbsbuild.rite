'use strict';
/**
 * Process Flows (Application → Process Flows): a business/user process across the app's pages, written by hand — a name,
 * a description, and the pages it goes through in order (start → next → …), each with a short note — and turned into a
 * document (print-ready HTML → PDF). Kept per VB Studio project in this app's data folder (one JSON file per flow).
 *
 * A flow: { id (PF-0001, given on the first save), name, description, area, owner, status (draft|review|approved|retired),
 *   pages: [{ id, page (a catalog page id, optional), name, note }], created / createdBy / at, updated / updatedBy }
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
const MAX = { pages: 60, name: 200, note: 4000, desc: 20000 };

const str = (v) => (v === undefined || v === null ? '' : String(v));
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const cut = (v, n) => str(v).slice(0, n);
const codeNo = (c) => { const m = /^PF-(\d+)$/.exec(str(c)); return m ? Number(m[1]) : 0; };
const codeOf = (n) => 'PF-' + String(n).padStart(4, '0');
const slug = (id) => str(id).replace(/[^A-Za-z0-9_-]/g, '');
const idOf = (v, n) => cut(str(v).replace(/[^A-Za-z0-9_.:/-]/g, ''), n || 120);
const esc = (s) => str(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** A flow with every field within its size and shape (what the page or a person sent is never kept as is). */
function cleanFlow(flow, by, old) {
  const f = isObj(flow) ? flow : {};
  const status = STATUSES[f.status] ? f.status : 'draft';
  let n = 0;
  const pages = (Array.isArray(f.pages) ? f.pages : []).filter(isObj).map((p) => ({
    id: idOf(p.id, 20) || 'p' + (++n), page: idOf(p.page), name: cut(p.name, MAX.name).trim(), note: cut(p.note, MAX.note) }))
    .filter((p) => p.name || p.page).slice(0, MAX.pages);
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
const CSS = `*{box-sizing:border-box}
@page{size:A4;margin:16mm 14mm}
body{font:11pt/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1d2b36;margin:0}
h1{font-size:22pt;margin:0 0 2px}
h2{font-size:14pt;margin:22px 0 8px;padding-bottom:4px;border-bottom:2px solid #2e6fd8;color:#13315c}
.kick{font-size:9pt;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#2e6fd8;margin-bottom:4px}
.ctl{border-collapse:collapse;width:100%;margin:14px 0 4px;font-size:10pt}
.ctl td{border:1px solid #dde3ea;padding:5px 9px;vertical-align:top}
.ctl td.k{background:#f5f7fa;font-weight:600;width:150px;color:#4a5865}
.desc p{margin:0 0 8px}
.strip{display:flex;flex-wrap:wrap;align-items:center;gap:4px;margin:6px 0 14px}
.box{border:1.5px solid #2e6fd8;border-radius:8px;padding:5px 10px;font-size:9.5pt;font-weight:600;background:#f3f7fe;color:#13315c;max-width:200px}
.box .lbl{display:block;font-size:7pt;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#6b7886}
.arr{color:#2e6fd8;font-weight:700;font-size:12pt}
ol.steps{list-style:none;counter-reset:s;padding:0;margin:0}
ol.steps>li{counter-increment:s;position:relative;padding:0 0 14px 44px;border-left:2px solid #e3e8ee;margin-left:16px}
ol.steps>li:last-child{border-left-color:transparent}
ol.steps>li::before{content:counter(s);position:absolute;left:-17px;top:0;width:32px;height:32px;border-radius:50%;background:#2e6fd8;color:#fff;font-weight:700;display:flex;align-items:center;justify-content:center;font-size:11pt}
.st-name{font-weight:700;font-size:12pt}
.st-tag{display:inline-block;font-size:7.5pt;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:#fff;background:#2e9d57;border-radius:4px;padding:1px 6px;margin-left:8px;vertical-align:2px}
.st-tag.end{background:#8a4b00}
.st-page{font-size:9pt;color:#6b7886;margin-top:1px}
.st-note{margin-top:5px;white-space:pre-wrap}
.foot{margin-top:28px;padding-top:8px;border-top:1px solid #dde3ea;font-size:8.5pt;color:#6b7886}
.empty{color:#6b7886;font-style:italic}`;

function paras(text) {
  const t = str(text).trim();
  if (!t) return '<p class="empty">No description.</p>';
  return t.split(/\n{2,}/).map((p) => '<p>' + esc(p.trim()).replace(/\n/g, '<br>') + '</p>').join('');
}
/** The whole document: cover + control table + description + the flow strip + the numbered steps. */
function renderDocument(flow, opts) {
  const o = opts || {};
  const f = cleanFlow(flow, flow && flow.updatedBy, flow);
  const pages = f.pages;
  const row = (k, v) => (v ? '<tr><td class="k">' + esc(k) + '</td><td>' + esc(v) + '</td></tr>' : '');
  const strip = pages.length
    ? '<div class="strip">' + pages.map((p, i) => '<span class="box">' + (i === 0 ? '<span class="lbl">Start</span>' : i === pages.length - 1 ? '<span class="lbl">End</span>' : '') + esc(p.name || p.page) + '</span>' + (i < pages.length - 1 ? '<span class="arr">→</span>' : '')).join('')
    + '</div>' : '';
  const steps = pages.length
    ? '<ol class="steps">' + pages.map((p, i) => '<li><span class="st-name">' + esc(p.name || p.page) + '</span>'
      + (i === 0 ? '<span class="st-tag">Start</span>' : i === pages.length - 1 ? '<span class="st-tag end">End</span>' : '')
      + (p.page && p.page !== p.name ? '<div class="st-page">' + esc(p.page) + '</div>' : '')
      + (p.note ? '<div class="st-note">' + esc(p.note).replace(/\n/g, '<br>') + '</div>' : '') + '</li>').join('') + '</ol>'
    : '<p class="empty">No pages yet.</p>';
  const date = o.date || new Date().toISOString().slice(0, 10);
  return '<!doctype html><html><head><meta charset="utf-8"><title>' + esc(f.name) + '</title><style>' + CSS + '</style></head><body>'
    + '<div class="kick">Process flow</div><h1>' + esc(f.name) + '</h1>'
    + '<table class="ctl">' + row('Name', f.name) + row('Code', f.id) + row('Area', f.area) + row('Owner', f.owner)
    + row('Status', STATUSES[f.status]) + row('Pages', pages.length ? pages.length + ' (' + pages.map((p) => p.name || p.page).join(' → ') + ')' : '')
    + row('Application', o.app) + row('Written', date) + '</table>'
    + '<h2>Description</h2><div class="desc">' + paras(f.description) + '</div>'
    + '<h2>The flow</h2>' + strip
    + '<h2>The pages, in order</h2>' + steps
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
