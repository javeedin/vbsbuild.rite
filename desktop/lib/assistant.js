'use strict';
/**
 * The AI Assistant (Build.Rite → Tools → AI Assistant): any question about the workspace's app — its code, its
 * integrations, its business processes — answered by the AI the team set up (AI settings, feature "AI Assistant"),
 * from what is relevant in the workspace, and formatted to read on screen (headings, steps, tables, code, callouts,
 * flows), with the sources it used and questions to ask next.
 *
 * Before each question it gathers the context (never the whole app): the app at a glance (its pages, its systems); the
 * pages the question is about (their facts read from the code: chains, calls, reports, variables; their AI-written
 * sheet when there is one); excerpts of the code files that match (with line numbers: words weighed by how rare they
 * are, file names counting more); the integrations (systems, interfaces, a page's calls in order); saved flows; the
 * functional design documents' sections. What is gathered depends on the scope: everything, code, integrations or
 * process; a page can be chosen. Each item is numbered, the AI cites them ([2]) and lists them; its follow-up questions
 * come in a ```followups block. Nothing leaves the PC but the question, the conversation so far and that context.
 *
 *   open({ dir, root, pages, flows, fdd, ai, scan, now }) → store
 *     dir: () → the folder conversations are kept in (per VB Studio project); root: () → the app's folder (the
 *     workspace's working folder); pages: lib/pages.js store (its sheets); flows: lib/savedFlows.js store; fdd:
 *     lib/fdd.js store; ai: lib/aiSql.js store (chat); scan: lib/integrations.js scan.
 *     ask({ question, scope, page, convId, redo, by }) → { ok, conv, turn } | { ok: false, error, conv, needsSetup }
 *     gather(question, { scope, page, before }) → { items: [{ n, kind, label, ref, text }], terms, chars, app }
 *     list() → { ok, convs: [{ id, title, updated, turns }] };  get(id) → { ok, conv };  remove(id);  rename(id, title)
 *     file(rel) → { ok, path, text, lines } (a file of the app, to show a source: inside the app's folder only)
 *     suggestions() → { ok, app, questions: [...] } (to start with: from the app's own pages and systems)
 *   prompt / parse / terms / snippets: pure, exported for tests.
 */
const fs = require('fs');
const path = require('path');

const SCOPES = ['all', 'code', 'integrations', 'process'];
const MAX_Q = 4000;
const BUDGET = 48000; // the context's characters (about 12k tokens)
const TURNS_SENT = 6; // the conversation so far, sent with a question
const KEEP_TURNS = 60;
const MAX_CONVS = 300;
const FILE_MAX = 400 * 1024; // a file looked at (bigger: skipped)
const MAX_FILES = 6000;
const CACHE_MS = 60 * 1000;
const EXTS = /\.(js|mjs|json|html|sql|xml|md|txt|xsd|wsdl|css|yaml|yml|properties)$/i;
const SKIP_DIR = /^(node_modules|\.git|\.svn|dist|build|out|coverage|bower_components|\.vscode|\.idea|tmp|temp|\.cache)$/i;
const SKIP_FILE = /(\.min\.js|\.map|package-lock\.json|yarn\.lock|\.bundle\.js)$/i;
const STOP = new Set(('a an and are as at be been but by can could did do does doing for from had has have how i if in into is it its '
  + 'me my of on or our please should so than that the their them then there these they this those to was we were what when where which '
  + 'while who whom why will with would you your yours show tell explain give list find get about all any each every some more most much '
  + 'one two use used uses using via also just like need needs want wants make makes made see look work works happen happens happening '
  + 'app application page pages code thing things way ways does done here there whole part parts know let lets').split(' '));

const str = (v) => (v == null ? '' : String(v));
const cut = (t, n) => { const s = str(t); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

/** The words a question is about: names kept whole (CustomerId, order-create, /shop/v1/orders) and split into their
 *  parts (customer, id; order, create), plurals also tried singular; common words left out. */
function terms(question) {
  const raw = str(question).match(/\/[\w${}.\/-]*[\w$}]|[A-Za-z_][\w$.-]*[\w$]|[A-Za-z]{2,}/g) || [];
  const out = [];
  const add = (w) => { const k = w.toLowerCase(); if (k.length >= 3 && !STOP.has(k) && !/^\d+$/.test(k) && out.indexOf(k) === -1) out.push(k); };
  raw.forEach((w) => {
    add(w);
    w.split(/[._/-]+/).forEach((p) => {
      add(p);
      p.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2').split(/\s+/).forEach(add);
    });
  });
  out.slice().forEach((k) => { if (/ies$/.test(k) && k.length > 4) add(k.slice(0, -3) + 'y'); else if (/[^siu]s$/.test(k) && k.length > 3) add(k.slice(0, -1)); });
  return out.slice(0, 40);
}

const count = (hay, w) => { let n = 0, i = 0; while (n < 40 && (i = hay.indexOf(w, i)) !== -1) { n++; i += w.length; } return n; };

/** The lines of a text around where its words are (numbered, as the editor shows them): up to `max` windows of ±pad
 *  lines, the densest first, put back in order; '…' between them. */
function snippets(text, words, opts) {
  const o = opts || {};
  const pad = o.pad == null ? 3 : o.pad, max = o.max || 3, limit = o.lines || 48;
  const lines = str(text).replace(/\r/g, '').split('\n');
  const hits = [];
  lines.forEach((l, i) => { const low = l.toLowerCase(); const s = words.reduce((a, w) => a + (low.indexOf(w) !== -1 ? (w.length > 5 ? 2 : 1) : 0), 0); if (s) hits.push({ i, s }); });
  if (!hits.length) return lines.length <= 30 ? lines.map((l, i) => (i + 1) + ': ' + l).join('\n') : '';
  const wins = [];
  hits.slice().sort((a, b) => b.s - a.s || a.i - b.i).forEach((h) => {
    if (wins.length >= max) return;
    if (wins.some((w) => h.i >= w.a - 1 && h.i <= w.b + 1)) return;
    wins.push({ a: Math.max(0, h.i - pad), b: Math.min(lines.length - 1, h.i + pad) });
  });
  wins.sort((x, y) => x.a - y.a);
  const merged = [];
  wins.forEach((w) => { const last = merged[merged.length - 1]; if (last && w.a <= last.b + 1) last.b = Math.max(last.b, w.b); else merged.push(Object.assign({}, w)); });
  const out = [];
  let used = 0;
  merged.forEach((w, k) => {
    if (used >= limit) return;
    if (k) out.push('…');
    for (let i = w.a; i <= w.b && used < limit; i++, used++) out.push((i + 1) + ': ' + cut(lines[i], 220));
  });
  return out.join('\n');
}

// What the AI is told: who it is, what it may use, and how to format what it says.
const SYSTEM = [
  'You are the AI Assistant of Build.Rite, the tools of a team that builds an Oracle Visual Builder (VBCS) app working with other systems (Oracle Fusion, OIC, BI Publisher, REST backends).',
  'You answer any question about that app: its code, its integrations, its business processes — and general questions about the technologies it uses.',
  'You get CONTEXT gathered from the team\'s workspace, each item numbered [n]: the app at a glance, pages (facts read from their code), code excerpts (with line numbers), integrations, saved flows and functional design sections.',
  '',
  'Rules:',
  '- Ground every statement about this app in the context. When the context does not show something, say so plainly and say where to look; never invent file names, endpoints, fields, numbers or steps.',
  '- Cite the context items you use inline as [n] right after the statement.',
  '- Be precise and practical; prefer the exact names (chains, variables, endpoints, pages) the context shows.',
  '',
  'Format the answer in GitHub-flavoured Markdown, to read on screen:',
  '- Start with a direct answer in 1–3 sentences, the key point in **bold**.',
  '- Then ## sections when the answer has parts (e.g. ## How it works, ## Where in the code, ## Steps, ## Data, ## Things to watch). Short answers need no sections.',
  '- Numbered lists for steps and processes; bullets for facts; a table when listing or comparing fields, endpoints, pages or systems.',
  '- Code, JSON, SQL and HTTP in fenced blocks with their language (```js, ```json, ```sql, ```http, ```xml); keep excerpts short and exact.',
  '- Refer to code as `path/to/file.js:42` with the path and line from the context, and to pages by their name.',
  '- Callouts for what matters, each on its own line: > [!NOTE] …, > [!TIP] …, > [!WARNING] …',
  '- A flow between systems or steps of a process may be drawn as a ```flow block, one step per line: `From -> To: what happens` (e.g. `New Order page -> Shop REST: GET /customers`).',
  '',
  'End with exactly these two parts:',
  'Sources: [1], [3] (the numbers of the context items you used; "none" when you used none)',
  '```followups',
  'three short follow-up questions the person may ask next, one per line',
  '```'
].join('\n');

/** The question as sent: the context, the conversation so far, the question. */
function prompt(question, items, before, opts) {
  const o = opts || {};
  const ctx = items.map((it) => '[' + it.n + '] ' + it.label + '\n' + it.text).join('\n\n');
  const conv = (before || []).slice(-TURNS_SENT).map((t) => 'Q: ' + cut(t.q, 1500) + '\nA: ' + cut((t.a && t.a.text) || (t.a && t.a.error ? '(not answered)' : ''), 1800)).join('\n\n');
  return 'CONTEXT (gathered from the workspace' + (o.scope && o.scope !== 'all' ? ', scope: ' + o.scope : '') + (o.pageLabel ? ', about the page ' + o.pageLabel : '') + ')\n\n'
    + (ctx || '(nothing in the workspace matched — answer from general knowledge and say so)')
    + (conv ? '\n\nCONVERSATION SO FAR\n\n' + conv : '')
    + '\n\nQUESTION\n' + str(question).trim();
}

/** The AI's answer: its text (the Sources line and the follow-ups block taken out), the numbers it cited, its follow-ups. */
function parse(text, items) {
  let t = str(text).replace(/\r/g, '');
  let follow = [];
  t = t.replace(/```\s*follow-?ups?\s*\n([\s\S]*?)```/i, (m, body) => { follow = body.split('\n').map((l) => l.replace(/^\s*(?:(?:[-*•]|\d+[.)])\s*)+/, '').trim()).filter(Boolean); return ''; });
  const cited = [];
  const valid = (n) => items.some((it) => it.n === n);
  t = t.replace(/^[ \t]*(?:\*\*|__)?Sources?(?:\*\*|__)?\s*:?(?:\*\*|__)?[ \t]*(.*)$/im, (m, rest) => {
    (rest.match(/\d+/g) || []).map(Number).forEach((n) => { if (valid(n) && cited.indexOf(n) === -1) cited.push(n); });
    return '';
  });
  (t.match(/\[(\d{1,3})\]/g) || []).map((x) => Number(x.slice(1, -1))).forEach((n) => { if (valid(n) && cited.indexOf(n) === -1) cited.push(n); });
  return { text: t.replace(/\n{3,}/g, '\n\n').trim(), cited: cited.sort((a, b) => a - b), followups: follow.slice(0, 4).map((x) => cut(x, 200)) };
}

function open(opts) {
  const o = opts || {};
  const now = typeof o.now === 'function' ? o.now : () => new Date();
  const dirNow = () => { const d = typeof o.dir === 'function' ? o.dir() : o.dir; return d ? path.resolve(d) : ''; };
  const rootNow = () => { let r = ''; try { r = typeof o.root === 'function' ? str(o.root()) : str(o.root); } catch (e) { r = ''; } return r ? path.resolve(r) : ''; };
  const no = (error, extra) => Object.assign({ ok: false, error }, extra || {});

  // ── the app's files, read once a minute at most ──
  let files = { root: '', at: 0, list: [] };
  function appFiles() {
    const root = rootNow();
    if (!root) return [];
    if (files.root === root && Date.now() - files.at < CACHE_MS) return files.list;
    const list = [];
    const walk = (dir, rel) => {
      if (list.length >= MAX_FILES) return;
      let names = [];
      try { names = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
      names.forEach((d) => {
        if (list.length >= MAX_FILES) return;
        const r = rel ? rel + '/' + d.name : d.name;
        if (d.isDirectory()) { if (!SKIP_DIR.test(d.name) && !/^\./.test(d.name)) walk(path.join(dir, d.name), r); return; }
        if (!EXTS.test(d.name) || SKIP_FILE.test(d.name)) return;
        let st = null;
        try { st = fs.statSync(path.join(dir, d.name)); } catch (e) { return; }
        if (st.size > FILE_MAX) return;
        let text = '';
        try { text = fs.readFileSync(path.join(dir, d.name), 'utf8'); } catch (e) { return; }
        list.push({ path: r, text, low: text.toLowerCase(), lowPath: r.toLowerCase() });
      });
    };
    walk(root, '');
    files = { root, at: Date.now(), list };
    return list;
  }
  let scanned = { root: '', at: 0, m: null };
  function integ() {
    const root = rootNow();
    if (!root || typeof o.scan !== 'function') return null;
    if (scanned.root === root && Date.now() - scanned.at < CACHE_MS) return scanned.m;
    let m = null;
    try { m = o.scan(root, {}); } catch (e) { m = null; }
    scanned = { root, at: Date.now(), m: m && m.ok !== false ? m : null };
    return scanned.m;
  }
  let pagesKept = { root: '', at: 0, list: [] };
  function pageList() {
    const root = rootNow();
    if (!root) return [];
    if (pagesKept.root === root && Date.now() - pagesKept.at < CACHE_MS) return pagesKept.list;
    let list = [];
    try { list = require('./pageScan').list(root).filter((p) => p.page !== 'shell' && p.flow); } catch (e) { list = []; }
    pagesKept = { root, at: Date.now(), list };
    return list;
  }

  // ── what is gathered for a question ──
  const hitScore = (hay, ws) => ws.reduce((a, w) => a + (hay.indexOf(w) !== -1 ? (w.length > 5 ? 2 : 1) : 0), 0);
  /** A page's facts, as the AI reads them. */
  function pageText(id) {
    let facts = null, sheet = null;
    try { const s = o.pages && o.pages.sheet ? o.pages.sheet(id) : null; if (s && s.ok) { sheet = s.sheet; facts = sheet.facts; } } catch (e) { sheet = null; }
    try { if (rootNow()) facts = require('./pageScan').analyze(rootNow(), id) || facts; } catch (e) { /* the sheet's */ }
    if (!facts) return '';
    const L = facts.logic || {}, I = facts.integrations || {};
    const out = ['Page "' + facts.label + '" (' + facts.id + ')' + (facts.flow ? ' — flow ' + facts.flow : '') + (facts.route && facts.route.menu ? ' — menu ' + facts.route.menu : '')];
    if (facts.description) out.push('About: ' + cut(facts.description, 400));
    if ((facts.files || []).length) out.push('Files: ' + facts.files.slice(0, 12).map((f) => f.path + (f.lines ? ' (' + f.lines + ' lines)' : '')).join(', '));
    if ((L.chains || []).length) {
      out.push('Action chains:');
      L.chains.slice(0, 25).forEach((c) => out.push('- ' + c.name + (c.on && c.on.length ? ' (on ' + c.on.join(', ') + ')' : '') + (c.about ? ' — ' + cut(c.about, 240) : '')
        + (c.calls && c.calls.length ? '; calls ' + c.calls.join(', ') : '') + (c.reports && c.reports.length ? '; reports ' + c.reports.join(', ') : '')
        + (c.opens && c.opens.length ? '; opens ' + c.opens.join(', ') : '') + (c.file ? '; ' + c.file : '')));
    }
    if ((I.rest || []).length) {
      out.push('REST calls:');
      I.rest.slice(0, 30).forEach((r) => out.push('- ' + r.method + ' ' + r.path + ' (' + r.endpoint + ')' + (r.summary ? ' — ' + cut(r.summary, 140) : '') + (r.backendLabel ? '; backend ' + r.backendLabel : '') + (r.usedBy && r.usedBy.length ? '; used by ' + r.usedBy.join(', ') : '')));
    }
    if ((I.reports || []).length) out.push('BI Publisher reports: ' + I.reports.join(', '));
    if ((L.variables || []).length) out.push('Variables: ' + L.variables.slice(0, 40).map((v) => (isObj(v) ? v.name + (v.type ? ':' + v.type : '') : str(v))).join(', '));
    if ((L.modules || []).length) out.push('Modules: ' + L.modules.slice(0, 15).map((m0) => (isObj(m0) ? m0.name || m0.path : str(m0))).join(', '));
    if ((facts.next || []).length) out.push('Goes to: ' + facts.next.slice(0, 12).map((n) => (isObj(n) ? (n.label || n.id) : str(n))).join(', '));
    if (sheet && sheet.ai && sheet.ai.text) out.push('Its technical sheet (written by AI):\n' + cut(sheet.ai.text, 2500));
    if (sheet && (sheet.stories || []).length) out.push('Jira stories: ' + sheet.stories.join(', '));
    return out.join('\n');
  }

  function gather(question, opt) {
    const g = opt || {};
    const scope = SCOPES.indexOf(g.scope) !== -1 ? g.scope : 'all';
    const before = (g.before || []).slice(-2).map((t) => t.q).join(' ');
    const ws = terms(question);
    const wsBefore = terms(before).filter((w) => ws.indexOf(w) === -1).slice(0, 10);
    const all = ws.concat(wsBefore);
    const items = [];
    let chars = 0;
    const push = (kind, label, ref, text, cap) => {
      const t = cut(text, cap || 6000);
      if (!t.trim() || chars + t.length > BUDGET) return false;
      chars += t.length;
      items.push({ n: items.length + 1, kind, label, ref: ref || {}, text: t });
      return true;
    };
    const pages = pageList();
    const m = integ();
    const appName = (pages[0] && (pages[0].appName || pages[0].app)) || (m && m.app) || '';

    // the app at a glance: its pages and systems (any question may need them)
    const sys = (m && m.systems) || [];
    push('app', 'The app at a glance' + (appName ? ': ' + appName : ''), { type: 'app' },
      (pages.length ? 'Pages (' + pages.length + '): ' + pages.slice(0, 90).map((p) => p.label + ' [' + p.id + ']').join('; ') : 'No pages found in the workspace folder.')
      + (sys.length ? '\nSystems it talks to: ' + sys.map((s) => s.name + ' (' + (s.kindLabel || s.kind) + (s.calls ? ', ' + s.calls + ' calls' : '') + ')').join('; ') : ''), 7000);

    // the pages it is about: the one chosen, else the best matches
    // a page named in the question wins; then its name's words, its id's, then its menu and description
    const ql = str(question).toLowerCase() + ' ' + before.toLowerCase();
    const scored = pages.map((p) => {
      const label = str(p.label).toLowerCase();
      const s = (label.length >= 3 && ql.indexOf(label) !== -1 ? 30 : 0) + 3 * hitScore(label, all) + 2 * hitScore(str(p.id).toLowerCase(), all) + hitScore((str(p.menu) + ' ' + str(p.description)).toLowerCase(), all)
        + (g.page && p.id === g.page ? 100 : 0);
      return { p, s };
    }).filter((x) => x.s > 0).sort((a, b) => b.s - a.s);
    const nPages = scope === 'code' ? 3 : scope === 'process' ? 1 : 2;
    const chosen = scored.slice(0, nPages).map((x) => x.p);
    if (g.page && !chosen.some((p) => p.id === g.page)) { const p = pages.filter((x) => x.id === g.page)[0]; if (p) chosen.unshift(p); }
    if (scope !== 'integrations' || g.page) chosen.forEach((p) => push('page', 'Page: ' + p.label, { type: 'page', id: p.id }, pageText(p.id), 7000));

    // the integrations: what matches, the chosen pages' calls in order
    if (m && scope !== 'code') {
      const ints = (m.interfaces || []).map((x) => ({ x, s: hitScore((x.object + ' ' + x.system + ' ' + (x.endpoints || []).join(' ') + ' ' + (x.pages || []).join(' ')).toLowerCase(), all) }))
        .filter((y) => y.s > 0).sort((a, b) => b.s - a.s).slice(0, scope === 'integrations' ? 14 : 6);
      if (ints.length) {
        push('interfaces', 'Interfaces (object × system)', { type: 'integrations' }, ints.map((y) => {
          const x = y.x;
          return '- ' + x.id + ' ' + x.object + ' ↔ ' + ((sys.filter((s) => s.id === x.system)[0] || {}).name || x.system) + ': ' + (x.direction || '') + ' (' + (x.methods || []).join('/') + ')'
            + (x.endpoints && x.endpoints.length ? '; endpoints ' + x.endpoints.slice(0, 4).join(', ') : '') + (x.pages && x.pages.length ? '; pages ' + x.pages.slice(0, 5).join(', ') : '');
        }).join('\n'), 5000);
      }
      const flowPages = chosen.length ? chosen : scored.slice(0, 1).map((y) => y.p);
      flowPages.forEach((p) => {
        const pf = (m.pageFlows || []).filter((x) => x.page === p.id)[0];
        if (!pf) return;
        push('pageflow', 'Integration flow of the page ' + (pf.pageLabel || p.label), { type: 'pageflow', id: p.id }, pf.steps.map((st) => 'When ' + st.trigger + (st.chain ? ' (' + st.chain + ')' : '') + ':\n'
          + st.calls.map((c, i) => '  ' + (i + 1) + '. ' + c.method + ' ' + (c.path || c.endpoint) + ' — ' + (c.object || '') + (c.action ? ' (' + c.action + ')' : '') + ' → ' + c.systemName + ' [' + c.direction + ']' + (c.via ? ' via ' + c.via : '')).join('\n')).join('\n'), 4000);
      });
      if (scope === 'integrations' || scope === 'process') {
        const js = (m.journeys || []).map((j) => ({ j, s: hitScore(JSON.stringify(j).toLowerCase(), all) })).filter((y) => y.s > 0).sort((a, b) => b.s - a.s).slice(0, 3);
        if (js.length) push('journeys', 'Cross-system flows', { type: 'integrations' }, js.map((y) => '- ' + (y.j.id || '') + ' ' + (y.j.page || y.j.pageLabel || '') + ': ' + (y.j.path || (y.j.steps || []).map((s) => s.system || s.systemName).join(' → '))).join('\n'), 3000);
      }
    }

    // saved flows and the functional design: how the business works
    if (scope === 'all' || scope === 'process') {
      let fl = [];
      try { const r = o.flows && o.flows.list ? o.flows.list('') : null; fl = (r && r.ok && r.flows) || []; } catch (e) { fl = []; }
      fl.map((f) => ({ f, s: hitScore((f.name + ' ' + (f.purpose || '') + ' ' + (f.area || '') + ' ' + (f.tags || []).join(' ') + ' ' + JSON.stringify(f.actions || [])).toLowerCase(), all) }))
        .filter((y) => y.s > 0).sort((a, b) => b.s - a.s).slice(0, scope === 'process' ? 4 : 2).forEach((y) => {
          const f = y.f;
          const lane = (id) => ((f.lanes || []).filter((l) => l.id === id)[0] || {}).name || id || 'the page';
          push('flow', 'Saved flow ' + f.id + ': ' + f.name, { type: 'flow', id: f.id }, (f.purpose ? 'Purpose: ' + f.purpose + '\n' : '') + (f.area ? 'Area: ' + f.area + '\n' : '') + 'Status: ' + (f.statusText || f.status || '') + '\n'
            + (f.actions || []).map((a, i) => (i + 1) + '. ' + (a.title || a.trigger || 'When …') + (a.note ? ' (note: ' + a.note + ')' : '') + '\n' + (a.steps || []).map((s, j) => '   ' + (i + 1) + '.' + (j + 1) + ' ' + (s.text || ((s.method || '') + ' ' + (s.path || s.endpoint || '') + ' ' + (s.object || ''))) + ' — ' + lane(s.system) + (s.note ? ' (note: ' + s.note + ')' : '')).join('\n')).join('\n')
            + ((f.stickies || []).length ? '\nSticky notes: ' + f.stickies.map((n) => n.text).filter(Boolean).join(' | ') : ''), 4000);
        });
      let docs = [];
      try { const inf = o.fdd && o.fdd.info ? o.fdd.info() : null; docs = (inf && inf.ok && inf.docs) || []; } catch (e) { docs = []; }
      const secs = [];
      docs.slice(0, 6).forEach((d) => {
        let j = null;
        try { j = JSON.parse(fs.readFileSync(path.join(o.fdd.root, 'webApps/buildrite/resources/fdd', d.id + '.json'), 'utf8')); } catch (e) { j = null; }
        ((j && j.sections) || []).forEach((s) => { const sc = hitScore((s.t + ' ' + s.t + ' ' + s.x).toLowerCase(), all); if (sc > 0) secs.push({ d, s, sc }); });
      });
      secs.sort((a, b) => b.sc - a.sc).slice(0, scope === 'process' ? 6 : 3).forEach((y) => push('fdd', 'Design document "' + y.d.name + '"' + (y.d.version ? ' v' + y.d.version : '') + ' — ' + (y.s.n ? y.s.n + ' ' : '') + y.s.t,
        { type: 'fdd', id: y.d.id, section: y.s.n || y.s.t }, cut(y.s.x, 2200), 2400));
    }

    // the code: files weighed by the question's words (rarer words count more; in the file's name, more still)
    if (scope !== 'process') {
      const list = appFiles();
      if (list.length && all.length) {
        const df = {};
        all.forEach((w) => { df[w] = list.reduce((a, f) => a + (f.low.indexOf(w) !== -1 ? 1 : 0), 0); });
        const weight = (w) => (df[w] ? Math.log(1 + list.length / df[w]) : 0) * (ws.indexOf(w) !== -1 ? 1 : 0.5);
        const ranked = list.map((f) => {
          let s = 0;
          all.forEach((w) => { const c = count(f.low, w); if (c) s += weight(w) * (1 + Math.log(c)); if (f.lowPath.indexOf(w) !== -1) s += weight(w) * 3; });
          if (g.page && chosen[0] && chosen[0].id && f.lowPath.indexOf(chosen[0].page) !== -1) s += 4;
          return { f, s };
        }).filter((x) => x.s > 0).sort((a, b) => b.s - a.s);
        const nFiles = scope === 'code' ? 8 : scope === 'integrations' ? 4 : 6;
        ranked.slice(0, nFiles).forEach((x) => {
          const snip = snippets(x.f.text, all, { pad: 3, max: 3, lines: 44 });
          if (snip) push('file', x.f.path, { type: 'file', path: x.f.path, line: Number((/^(\d+):/.exec(snip) || [])[1]) || 1 }, snip, 4200);
        });
      }
    }
    return { items, terms: ws, chars, app: appName, scope };
  }

  // ── conversations, kept on this PC per project ──
  const file = (id) => path.join(dirNow(), str(id).replace(/[^\w-]/g, '') + '.json');
  const read = (id) => { try { const c = JSON.parse(fs.readFileSync(file(id), 'utf8')); return isObj(c) && c.id ? c : null; } catch (e) { return null; } };
  const write = (c) => { fs.mkdirSync(dirNow(), { recursive: true }); const f = file(c.id); fs.writeFileSync(f + '.tmp', JSON.stringify(c, null, 1)); fs.renameSync(f + '.tmp', f); };
  const allConvs = () => {
    const d = dirNow();
    if (!d) return [];
    let names = [];
    try { names = fs.readdirSync(d).filter((x) => /^C-[\w-]+\.json$/.test(x)); } catch (e) { return []; }
    return names.map((n) => read(n.replace(/\.json$/, ''))).filter(Boolean);
  };
  const newId = () => 'C-' + now().getTime().toString(36) + Math.floor(Math.random() * 1296).toString(36).padStart(2, '0');

  return {
    SCOPES,
    gather,
    async ask(b) {
      let q = str(b && b.question).trim().slice(0, MAX_Q);
      if (!dirNow()) return no('Set up your workspace first: conversations are kept per VB Studio project.');
      let conv = b && b.convId ? read(b.convId) : null;
      let again = null;
      // asked again: the last turn replaced (its question, scope and page, unless new ones are given)
      if (b && b.redo && conv && conv.turns.length) { again = conv.turns[conv.turns.length - 1]; conv.turns = conv.turns.slice(0, -1); q = q || again.q; }
      if (!q) return no('Write your question first.');
      if (!o.ai || typeof o.ai.chat !== 'function') return no('Set up AI first (Tools → AI settings).', { needsSetup: true });
      if (!conv) conv = { id: newId(), title: cut(q.replace(/\s+/g, ' '), 80), created: now().toISOString(), by: str(b && b.by), turns: [] };
      const scope = SCOPES.indexOf(b && b.scope) !== -1 ? b.scope : (again && again.scope) || 'all';
      const page = str((b && b.page) || (again && !(b && b.scope) ? again.page : ''));
      const ctx = gather(q, { scope, page, before: conv.turns });
      const pageLabel = page ? ((pageList().filter((p) => p.id === page)[0] || {}).label || page) : '';
      const t0 = now().getTime();
      const r = await o.ai.chat({ feature: 'assistant', system: SYSTEM, user: prompt(q, ctx.items, conv.turns, { scope, pageLabel }), maxTokens: 4000 });
      const turn = { q, scope, page, pageLabel, at: now().toISOString(), by: str(b && b.by),
        looked: ctx.items.map((it) => ({ n: it.n, kind: it.kind, label: it.label, ref: it.ref, text: cut(it.text, 6000) })), terms: ctx.terms };
      if (!r || !r.ok) {
        turn.a = { error: (r && r.error) || 'The AI did not answer.', ms: now().getTime() - t0 };
      } else {
        const p = parse(r.text, ctx.items);
        turn.a = { text: p.text, cited: p.cited, followups: p.followups, provider: str(r.provider), model: str(r.model), ms: r.ms || now().getTime() - t0 };
      }
      conv.turns = conv.turns.concat([turn]).slice(-KEEP_TURNS);
      conv.updated = now().toISOString();
      write(conv);
      // the oldest let go beyond MAX_CONVS
      const every = allConvs();
      if (every.length > MAX_CONVS) every.sort((a, c) => str(a.updated).localeCompare(str(c.updated))).slice(0, every.length - MAX_CONVS).forEach((c) => { try { fs.unlinkSync(file(c.id)); } catch (e) { /* gone */ } });
      return turn.a.error ? no(turn.a.error, { conv, turn, needsSetup: !!(r && r.needsSetup) }) : { ok: true, conv, turn };
    },
    list() {
      if (!dirNow()) return no('Set up your workspace first: conversations are kept per VB Studio project.');
      return { ok: true, convs: allConvs().sort((a, c) => str(c.updated).localeCompare(str(a.updated))).map((c) => ({ id: c.id, title: c.title, updated: c.updated, created: c.created, turns: (c.turns || []).length })) };
    },
    get(id) { const c = read(id); return c ? { ok: true, conv: c } : no('No such conversation.'); },
    remove(id) { const c = read(id); if (!c) return no('No such conversation.'); try { fs.unlinkSync(file(id)); } catch (e) { return no('It could not be removed: ' + e.message); } return { ok: true }; },
    rename(id, title) { const c = read(id); if (!c) return no('No such conversation.'); c.title = cut(str(title).trim() || c.title, 120); write(c); return { ok: true, conv: c }; },
    /** A file of the app (a source the AI used), whole: only inside the app's folder, only text it may read. */
    file(rel) {
      const root = rootNow();
      const r = str(rel).replace(/\\/g, '/').replace(/^\/+/, '');
      if (!root || !r || /(^|\/)\.\.(\/|$)/.test(r) || !EXTS.test(r)) return no('Not a file of the app.');
      const abs = path.resolve(root, r);
      if (abs.indexOf(root + path.sep) !== 0) return no('Not a file of the app.');
      let text = '';
      try { const st = fs.statSync(abs); if (st.size > 2 * 1024 * 1024) return no('It is too big to show here.'); text = fs.readFileSync(abs, 'utf8'); } catch (e) { return no('It could not be read: ' + r); }
      return { ok: true, path: r, text, lines: text.split('\n').length };
    },
    /** Questions to start with, from the app itself (its pages and systems). */
    suggestions() {
      const pages = pageList();
      const m = integ();
      const sys = ((m && m.systems) || []).filter((s) => s.kind !== 'unknown');
      const pf = ((m && m.pageFlows) || []).slice().sort((a, b) => (b.calls || []).length - (a.calls || []).length);
      const busy = pf[0] ? (pages.filter((p) => p.id === pf[0].page)[0] || { label: pf[0].pageLabel }) : pages[0];
      const write0 = ((m && m.interfaces) || []).filter((x) => /Write|out/i.test(x.direction || x.dataFlow || ''))[0];
      const q = [];
      if (busy) q.push('How does the ' + busy.label + ' page work, step by step?');
      if (sys[0]) q.push('Which pages call ' + sys[0].name + ', and for what?');
      if (write0) q.push('Where does the app write ' + write0.object.toLowerCase() + ', and what does it send?');
      if (sys.length > 1) q.push('Draw the flow between the app and ' + sys.map((s) => s.name).slice(0, 3).join(', ') + '.');
      q.push('What should I check before changing a page that calls Oracle Fusion?');
      if (pages[1]) q.push('Explain the variables and action chains of the ' + pages[1].label + ' page.');
      return { ok: true, app: (pages[0] && (pages[0].appName || pages[0].app)) || '', pages: pages.map((p) => ({ id: p.id, label: p.label })), questions: q.slice(0, 6) };
    }
  };
}

module.exports = { open, SYSTEM, SCOPES, terms, snippets, prompt, parse };
