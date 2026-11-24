'use strict';
/**
 * The functional design of a Jira story ("Create the functional design", under Analyze with AI): a design document
 * the AI writes from the story, its saved analysis, the FDD sections it matched and the app as it is in your working
 * folder — the pages the story touches (their fields, lists of values, actions, chains, modules, REST calls and BI
 * Publisher reports), the app's other pages and its backends — and Build.Rite lays out as a printable document (PDF):
 * document control, the functional design (FDD), wireframes drawn from what the AI describes, the technical design
 * (TDD), the integration touch points, a developer reference and the open questions.
 *
 *   relevantPages(pages, story, mappedIds, max, min)   the pages a story touches: those mapped to it, then those whose
 *                                                  words it shares most (at least min, 2 by default) → [id]
 *   pageText(facts)                                one page's facts, for the AI
 *   prompt({ story, storyText, analysis, fdd, pages, allPages, appName })   → { system, user }
 *   mdToHtml(markdown)                             the AI's Markdown → HTML (headings, lists, tables, code, wireframes)
 *   wireframe(spec)                                a screen drawn from { screen, page, sections: [{ title, fields:
 *                                                  [{ label, type, value, required }], table: { columns, rows } }],
 *                                                  actions: [label], notes }
 *   renderDocument({ meta, markdown })             the whole document (HTML, A4, print-ready): its cover and control
 *                                                  table, contents, the design
 *
 * Pure: no file, no network. The caller asks the AI (lib/aiSql.js), prints the HTML to PDF (the desktop app: Electron's
 * printToPDF) and keeps the files (lib/fdd.js saveDesign).
 */

const str = (v) => (v == null ? '' : String(v));
const esc = (s) => str(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const STOP = new Set('the and for with from that this when then into your their have will must should able each page pages user users list view data value values field fields show shows into only also more than what which where about after before under over equipment request'.split(' '));
const words = (t) => Array.from(new Set(str(t).toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 4 && !STOP.has(w))));

/** The pages a story touches: those mapped to it, then those whose words (label, id, fields, sections, actions) it shares most. */
function relevantPages(pages, story, mappedIds, max, min) {
  const want = words([story && story.summary, story && story.description, story && story.acceptance].join(' '));
  const mapped = (mappedIds || []).filter(Boolean);
  const scored = (pages || []).filter((p) => p && p.id && mapped.indexOf(p.id) === -1 && !p.deleted).map((p) => {
    const hay = words([p.label, p.id, p.description, (p.fields || []).join(' '), (p.sections || []).join(' '), (p.actions || []).join(' ')].join(' '));
    const hit = want.filter((w) => hay.indexOf(w) !== -1 || hay.some((h) => h.length > 5 && (h.indexOf(w) === 0 || w.indexOf(h) === 0)));
    return { id: p.id, n: hit.length };
  }).filter((x) => x.n >= (min || 2)).sort((a, b) => b.n - a.n);
  return mapped.concat(scored.map((x) => x.id)).slice(0, max || 4);
}

/** One page's facts (lib/pageScan.js analyze), for the AI: what it shows, its lists, actions, chains, calls, reports. */
function pageText(f) {
  if (!f) return '';
  const L = [];
  const feat = f.features || {}, integ = f.integrations || {}, logic = f.logic || {};
  L.push('### Page ' + f.id + ' — ' + str(f.label) + (f.route && f.route.url ? ' (opens at ' + f.route.url + ')' : ''));
  if (f.description) L.push('About: ' + str(f.description).slice(0, 300));
  (f.files || []).slice(0, 14).forEach((x, i) => { if (!i) L.push('Files: ' + (f.files || []).slice(0, 14).map((y) => y.path).join(', ')); });
  if ((feat.sections || []).length) L.push('Sections: ' + feat.sections.slice(0, 20).join(' · '));
  if ((feat.fields || []).length) L.push('Fields: ' + feat.fields.slice(0, 40).join(' · '));
  if ((feat.columns || []).length) L.push('Table columns: ' + feat.columns.slice(0, 30).join(' · '));
  if ((feat.actions || []).length) L.push('Actions: ' + feat.actions.slice(0, 25).map((a) => a.label + (a.chains && a.chains.length ? ' → ' + a.chains.join('+') : '')).join(' · '));
  (integ.lovs || []).slice(0, 20).forEach((l) => L.push('List of values "' + l.field + '": ' + (l.report ? 'BI Publisher report ' + l.report : l.endpoint || (l.source === 'static' ? 'values in the code' : '?'))
    + (l.target ? ' → sets ' + l.target : '') + (l.when ? ' (shown when ' + str(l.when).slice(0, 80) + ')' : '')));
  (integ.rest || []).slice(0, 40).forEach((r) => L.push('REST: ' + (r.method || '') + ' ' + (r.path || '') + ' — ' + r.endpoint + ' (' + (r.backendLabel || r.backend || '') + ')' + (r.summary ? ' — ' + r.summary : '')
    + (r.params ? ' sends ' + JSON.stringify(r.params) : '') + (r.usedBy && r.usedBy.length ? ' [used by ' + r.usedBy.slice(0, 3).join(', ') + ']' : '')));
  (integ.reports || []).slice(0, 12).forEach((r) => L.push('BI Publisher report: ' + r));
  (logic.chains || []).slice(0, 30).forEach((c) => L.push('Chain ' + c.name + ' (' + c.file + ')' + (c.about ? ': ' + str(c.about).slice(0, 160) : '') + (c.calls && c.calls.length ? ' — calls ' + c.calls.slice(0, 5).join(', ') : '')));
  (logic.modules || []).slice(0, 15).forEach((m) => L.push('Module ' + m.name + (m.file ? ' (' + m.file + ')' : '') + (m.about ? ': ' + str(m.about).slice(0, 140) : '')));
  return L.join('\n');
}

const OUTLINE = [
  '## 1. Overview',
  '## 2. Functional design (FDD)', '### 2.1 Business requirement', '### 2.2 Scope', '### 2.3 User roles', '### 2.4 User flow', '### 2.5 Business rules', '### 2.6 Acceptance criteria',
  '## 3. Wireframes',
  '## 4. Technical design (TDD)', '### 4.1 Pages and components', '### 4.2 Data model', '### 4.3 Integration touch points', '### 4.4 Action chains and modules', '### 4.5 Security and roles',
  '### 4.6 Error handling and messages', '### 4.7 Performance and limits',
  '## 5. Developer reference', '### 5.1 Files to change', '### 5.2 Existing patterns to reuse', '### 5.3 Build steps', '### 5.4 Test plan', '### 5.5 Prompts for Claude',
  '## 6. Assumptions and open questions'];

/** What the AI is given and asked for. */
function prompt(c) {
  const ctx = c || {};
  const system = 'You are a senior Oracle Visual Builder (VBCS) and Oracle Fusion solution architect. You write the functional and technical design of one Jira story for the team that will build it, '
    + 'in Markdown, with exactly the headings given, in plain language. You use only the pages, files, chains, modules, REST endpoints, BI Publisher reports, objects and roles that appear in the context; '
    + 'anything new you mark "NEW" and say where it goes. You cite the FDD as [FDD n] where it says so. You never invent system names, people or values.';
  const U = [];
  U.push('Write the functional design of this story, from the context below.');
  U.push('');
  U.push('Use exactly these headings, in this order (every one, even if short):');
  U.push(OUTLINE.join('\n'));
  U.push('');
  U.push('Under "## 3. Wireframes", draw each screen the story adds or changes as a fenced block ```wireframe with one JSON object (no comments) like:');
  U.push('{"screen": "Equipment detail — watch", "page": "app/flow/page or NEW: flow/page", "sections": [{"title": "Notifications", "fields": [{"label": "Notify me about", "type": "select", "value": "ALL", "required": true}], '
    + '"table": {"columns": ["Equipment", "Preference", "Channel"], "rows": 2}}], "actions": ["Save", "Cancel"], "notes": "what changes on this screen"}');
  U.push('Field types: text, number, date, select, multiselect, textarea, toggle, checkbox, search, readonly. After each block, one line saying what the user does there.');
  U.push('Under "### 4.3 Integration touch points", a Markdown table: | # | System | Endpoint or report | Method | Purpose | Sends | Uses from the answer | (existing ones by their endpoint id, new ones marked NEW).');
  U.push('Under "### 4.2 Data model", a table per object: | Field | Type | Key | Notes |.');
  U.push('Make "## 5. Developer reference" detailed enough that a developer can build the feature from it alone:');
  U.push('Under "### 5.1 Files to change", list every real file from the context that changes, grouped by area (backend/store, routes, page variables & chains, markup, styles, tests). Each as a bullet: the path in `code`, then exactly what to add or change in it — the variables, action chains, event listeners, the markup elements, the CSS classes, the module functions — and why. Put NEW before a file that does not exist yet and give the folder it goes in.');
  U.push('Under "### 5.2 Existing patterns to reuse", name a real existing page, chain or module in THIS app (with its file path) that already does the same shape of thing, so the developer copies it rather than inventing.');
  U.push('Under "### 5.3 Build steps", the exact commands to build and run, where to run them, and how to see the change working in the app.');
  U.push('Under "### 5.4 Test plan", the API scenario (the calls in order) and the UI checks, plus the test files to add or update.');
  U.push('Under "### 5.5 Prompts for Claude", write a short numbered series of copy-paste prompts a developer can give to Claude Code (an AI coding assistant working in this repository) to build the feature step by step. Put EACH prompt in its own fenced ```prompt block. Each prompt must be self-contained: start with the Jira key and a one-line goal, name the exact files to create or change (the paths from 5.1), name the existing pattern to copy (from 5.2), describe the behaviour and the acceptance criteria it must satisfy, and end by asking Claude to build and run the tests. Order them so each builds on the last — 1) data model / store + routes, 2) page variables + action chains, 3) markup + styles, 4) wiring, validation and messages, 5) tests. Keep each prompt to one or two tight paragraphs and use only the real names from this design (never invented files, systems or values).');
  U.push('');
  U.push('# Story');
  U.push(str(ctx.storyText) || ([ctx.story && ctx.story.key, ctx.story && ctx.story.summary].filter(Boolean).join(' — ')));
  if (ctx.analysis) { U.push(''); U.push('# Its AI analysis (already written)'); U.push(str(ctx.analysis).slice(0, 12000)); }
  if (ctx.fdd && ctx.fdd.text) { U.push(''); U.push('# The FDD (' + str(ctx.fdd.name) + ') — the sections it matched'); U.push(str(ctx.fdd.text).slice(0, 16000)); }
  U.push('');
  U.push('# The app' + (ctx.appName ? ' (' + ctx.appName + ')' : '') + ' as it is in the working folder');
  if ((ctx.pages || []).length) { U.push('## The pages the story touches'); ctx.pages.forEach((f) => { U.push(pageText(f)); U.push(''); }); }
  if ((ctx.backends || []).length) U.push('Backends: ' + ctx.backends.join(', '));
  if ((ctx.allPages || []).length) { U.push('## Every page of the app (id — title)'); U.push(ctx.allPages.slice(0, 160).map((p) => p.id + ' — ' + p.label).join('\n')); }
  return { system, user: U.join('\n').slice(0, 60000) };
}

// ── Markdown → HTML ──────────────────────────────────────────────────────────────────────────────────────────────

function inline(t) {
  let s = esc(t);
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<i>$2</i>');
  s = s.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2">$1</a>');
  s = s.replace(/\[(FDD [^\]]+)\]/g, '<span class="cite">$1</span>');
  s = s.replace(/\bNEW\b/g, '<span class="new">NEW</span>');
  return s;
}

const TYPE_MARK = { select: '▾', multiselect: '▾', date: '📅', search: '🔍', number: '#' };
/** A screen drawn from the AI's description. */
function wireframe(spec) {
  const w = spec && typeof spec === 'object' ? spec : {};
  const field = (f) => {
    const t = str(f.type || 'text').toLowerCase();
    const val = str(f.value);
    const box = t === 'toggle' ? '<span class="wf-toggle' + (/^(on|true|yes)$/i.test(val) ? ' wf-toggle--on' : '') + '"></span>'
      : t === 'checkbox' ? '<span class="wf-check">' + (/^(on|true|yes|x)$/i.test(val) ? '✓' : '') + '</span>'
        : '<span class="wf-in wf-' + esc(t) + '">' + (val ? esc(val) : '<span class="wf-ph">' + (t === 'readonly' ? '—' : esc(f.label || '')) + '</span>') + (TYPE_MARK[t] ? '<span class="wf-mark">' + TYPE_MARK[t] + '</span>' : '') + '</span>';
    return '<div class="wf-f' + (t === 'textarea' ? ' wf-f--wide' : '') + '"><span class="wf-l">' + esc(f.label || '') + (f.required ? ' <i>*</i>' : '') + '</span>' + box + '</div>';
  };
  const table = (tb) => {
    const cols = (tb && Array.isArray(tb.columns) ? tb.columns : []).slice(0, 8);
    if (!cols.length) return '';
    const n = Math.min(4, Math.max(1, Number(tb.rows) || 2));
    return '<table class="wf-t"><tr>' + cols.map((c) => '<th>' + esc(c) + '</th>').join('') + '</tr>' + Array.from({ length: n }).map(() => '<tr>' + cols.map(() => '<td><span class="wf-line"></span></td>').join('') + '</tr>').join('') + '</table>';
  };
  const secs = (Array.isArray(w.sections) ? w.sections : []).slice(0, 8).map((s) => '<div class="wf-sec">' + (s.title ? '<div class="wf-st">' + esc(s.title) + '</div>' : '')
    + ((s.fields || []).length ? '<div class="wf-grid">' + s.fields.slice(0, 18).map(field).join('') + '</div>' : '') + table(s.table) + '</div>').join('');
  const acts = (Array.isArray(w.actions) ? w.actions : []).slice(0, 6).map((a, i) => '<span class="wf-btn' + (i === 0 ? ' wf-btn--p' : '') + '">' + esc(a) + '</span>').join('');
  return '<figure class="wf"><div class="wf-bar"><span class="wf-dots"><i></i><i></i><i></i></span><b>' + esc(w.screen || 'Screen') + '</b>' + (w.page ? '<span class="wf-page">' + esc(w.page) + '</span>' : '') + '</div>'
    + '<div class="wf-body">' + (secs || '<div class="wf-sec"><span class="wf-ph">—</span></div>') + (acts ? '<div class="wf-acts">' + acts + '</div>' : '') + '</div>'
    + (w.notes ? '<figcaption>' + esc(w.notes) + '</figcaption>' : '') + '</figure>';
}

/** The AI's Markdown → HTML: headings (with ids for the contents), lists (nested), tables, code, wireframes, quotes. */
function mdToHtml(md) {
  const lines = str(md).replace(/\r/g, '').split('\n');
  const out = [];
  const heads = [];
  let i = 0, para = [];
  const flush = () => { if (para.length) { out.push('<p>' + inline(para.join(' ')) + '</p>'); para = []; } };
  while (i < lines.length) {
    const line = lines[i];
    let m;
    if ((m = /^```\s*([\w-]*)\s*$/.exec(line))) {
      flush();
      const lang = m[1].toLowerCase();
      const body = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) body.push(lines[i++]);
      i++;
      if (lang === 'wireframe' || lang === 'json' && /"sections"\s*:/.test(body.join('\n'))) {
        let spec = null;
        try { spec = JSON.parse(body.join('\n')); } catch (e) { spec = null; }
        out.push(spec ? wireframe(spec) : '<pre><code>' + esc(body.join('\n')) + '</code></pre>');
      } else if (lang === 'prompt') {
        // a ready-to-paste prompt for Claude Code — shown as a labelled box you can select and copy
        out.push('<div class="dd-prompt"><div class="dd-prompt-h"><span class="dd-prompt-tag">▸ Prompt for Claude — select and copy</span></div><pre class="dd-prompt-body"><code>' + esc(body.join('\n')) + '</code></pre></div>');
      } else out.push('<pre><code>' + esc(body.join('\n')) + '</code></pre>');
      continue;
    }
    if ((m = /^(#{1,4})\s+(.+?)\s*#*\s*$/.exec(line))) {
      flush();
      const lvl = Math.min(4, m[1].length + (m[1].length === 1 ? 1 : 0));
      const id = 'h' + (heads.length + 1);
      if (lvl <= 3) heads.push({ id, lvl, text: m[2] });
      out.push('<h' + lvl + ' id="' + id + '">' + inline(m[2]) + '</h' + lvl + '>');
      i++;
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
      flush();
      const row = (l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      const head = row(line);
      i += 2;
      const rows = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) rows.push(row(lines[i++]));
      out.push('<table class="tbl"><thead><tr>' + head.map((h) => '<th>' + inline(h) + '</th>').join('') + '</tr></thead><tbody>'
        + rows.map((r) => '<tr>' + head.map((h, k) => '<td>' + inline(r[k] || '') + '</td>').join('') + '</tr>').join('') + '</tbody></table>');
      continue;
    }
    if (/^\s*([-*+]|\d+[.)])\s+/.test(line)) {
      flush();
      // a list, nested by its indent
      const stack = [];
      while (i < lines.length && (/^\s*([-*+]|\d+[.)])\s+/.test(lines[i]) || (/^\s{2,}\S/.test(lines[i]) && stack.length))) {
        const l = lines[i];
        const lm = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(l);
        if (!lm) { out.push(' ' + inline(l.trim())); i++; continue; }
        const depth = Math.floor(lm[1].replace(/\t/g, '  ').length / 2);
        const tag = /\d/.test(lm[2]) ? 'ol' : 'ul';
        while (stack.length > depth + 1 || (stack.length === depth + 1 && stack[stack.length - 1] !== tag)) out.push('</li></' + stack.pop() + '>');
        if (stack.length === depth + 1) out.push('</li>');
        while (stack.length < depth + 1) { out.push('<' + tag + '>'); stack.push(tag); }
        out.push('<li>' + inline(lm[3]));
        i++;
      }
      while (stack.length) out.push('</li></' + stack.pop() + '>');
      continue;
    }
    if (/^\s*>\s?/.test(line)) { flush(); const q = []; while (i < lines.length && /^\s*>\s?/.test(lines[i])) q.push(lines[i++].replace(/^\s*>\s?/, '')); out.push('<blockquote>' + inline(q.join(' ')) + '</blockquote>'); continue; }
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) { flush(); out.push('<hr>'); i++; continue; }
    if (!line.trim()) { flush(); i++; continue; }
    para.push(line.trim());
    i++;
  }
  flush();
  return { html: out.join('\n'), heads };
}

const CSS = `
@page { size: A4; margin: 16mm 14mm 18mm; }
* { box-sizing: border-box; }
body { font: 10.5pt/1.45 "Segoe UI", "Helvetica Neue", Arial, sans-serif; color: #1d2b36; margin: 0; }
.cover { border-bottom: 3px solid #1d4f91; padding-bottom: 10px; margin-bottom: 14px; }
.cover .kind { font-size: 9pt; font-weight: 700; letter-spacing: .08em; color: #1d4f91; text-transform: uppercase; }
.cover h1 { font-size: 20pt; margin: 4px 0 2px; }
.cover .sub { color: #4a5865; }
table.ctl { border-collapse: collapse; width: 100%; margin: 8px 0 14px; font-size: 9.5pt; }
table.ctl th { text-align: left; width: 22%; background: #f1f5f9; }
table.ctl th, table.ctl td { border: 1px solid #d3dce6; padding: 4px 8px; vertical-align: top; }
.toc { border: 1px solid #d3dce6; border-radius: 6px; padding: 8px 14px; margin: 0 0 16px; font-size: 9.5pt; columns: 2; }
.toc b { display: block; column-span: all; margin-bottom: 4px; }
.toc a { color: #1d2b36; text-decoration: none; display: block; }
.toc .l3 { padding-left: 14px; color: #4a5865; }
h2 { font-size: 14pt; color: #1d4f91; border-bottom: 1px solid #cfdcec; padding-bottom: 3px; margin: 20px 0 8px; page-break-after: avoid; }
h3 { font-size: 11.5pt; margin: 14px 0 6px; page-break-after: avoid; }
h4 { font-size: 10.5pt; margin: 10px 0 4px; }
p { margin: 4px 0 8px; }
ul, ol { margin: 4px 0 8px; padding-left: 20px; }
li { margin: 2px 0; }
code { font: 9pt Consolas, "Courier New", monospace; background: #f1f5f9; border-radius: 3px; padding: 0 3px; }
pre { background: #f6f8fa; border: 1px solid #e0e6ec; border-radius: 6px; padding: 8px; overflow-wrap: anywhere; white-space: pre-wrap; font-size: 8.5pt; }
.dd-prompt { border: 1px solid #c7dbf5; border-radius: 8px; margin: 8px 0; overflow: hidden; break-inside: avoid; }
.dd-prompt-h { background: #eef4fc; padding: 4px 10px; }
.dd-prompt-tag { font-size: 8.5pt; font-weight: 700; color: #1d4f91; letter-spacing: .02em; }
.dd-prompt-body { margin: 0; border: 0; border-radius: 0; background: #fbfdff; }
table.tbl { border-collapse: collapse; width: 100%; margin: 6px 0 12px; font-size: 9pt; page-break-inside: auto; }
table.tbl th { background: #eef3f8; text-align: left; }
table.tbl th, table.tbl td { border: 1px solid #d3dce6; padding: 4px 6px; vertical-align: top; overflow-wrap: anywhere; }
blockquote { border-left: 3px solid #cfdcec; margin: 6px 0; padding: 2px 10px; color: #4a5865; }
.cite { font-size: 8.5pt; font-weight: 700; color: #1d4f91; background: #e6f0fc; border-radius: 6px; padding: 0 5px; }
.new { font-size: 8pt; font-weight: 700; color: #8a5300; background: #fff1db; border-radius: 6px; padding: 0 4px; }
.wf { border: 1px solid #9aa9b8; border-radius: 8px; margin: 10px 0 6px; page-break-inside: avoid; overflow: hidden; }
.wf-bar { background: #e8edf2; border-bottom: 1px solid #9aa9b8; padding: 5px 10px; display: flex; gap: 10px; align-items: center; font-size: 9.5pt; }
.wf-dots i { display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: #b8c4cf; margin-right: 3px; }
.wf-page { margin-left: auto; font: 8pt Consolas, monospace; color: #4a5865; }
.wf-body { padding: 10px; background: repeating-linear-gradient(45deg, #fff, #fff 10px, #fbfcfd 10px, #fbfcfd 20px); }
.wf-sec { border: 1px dashed #b8c4cf; border-radius: 6px; padding: 8px; margin-bottom: 8px; background: #fff; }
.wf-st { font-weight: 700; font-size: 9.5pt; margin-bottom: 6px; }
.wf-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px 10px; }
.wf-f { display: grid; gap: 2px; font-size: 8.5pt; }
.wf-f--wide { grid-column: 1 / -1; }
.wf-l { color: #4a5865; }
.wf-l i { color: #b42318; font-style: normal; }
.wf-in { border: 1px solid #9aa9b8; border-radius: 4px; padding: 4px 6px; min-height: 22px; display: flex; justify-content: space-between; background: #fff; }
.wf-textarea { min-height: 44px; }
.wf-readonly { background: #f1f5f9; border-style: dashed; }
.wf-ph { color: #9aa9b8; }
.wf-mark { color: #4a5865; margin-left: 6px; }
.wf-toggle { display: inline-block; width: 30px; height: 16px; border-radius: 8px; background: #c9d3dd; position: relative; }
.wf-toggle::after { content: ''; position: absolute; top: 2px; left: 2px; width: 12px; height: 12px; border-radius: 50%; background: #fff; }
.wf-toggle--on { background: #2e6fd8; } .wf-toggle--on::after { left: 16px; }
.wf-check { display: inline-flex; width: 14px; height: 14px; border: 1px solid #9aa9b8; border-radius: 3px; align-items: center; justify-content: center; font-size: 9pt; }
.wf-t { border-collapse: collapse; width: 100%; font-size: 8.5pt; margin-top: 4px; }
.wf-t th { background: #eef3f8; text-align: left; }
.wf-t th, .wf-t td { border: 1px solid #c9d3dd; padding: 3px 6px; }
.wf-line { display: block; height: 7px; border-radius: 3px; background: #e3e8ee; width: 70%; }
.wf-acts { display: flex; gap: 6px; justify-content: flex-end; }
.wf-btn { border: 1px solid #9aa9b8; border-radius: 14px; padding: 3px 12px; font-size: 8.5pt; background: #fff; }
.wf-btn--p { background: #1d4f91; border-color: #1d4f91; color: #fff; }
.wf figcaption { font-size: 8.5pt; color: #4a5865; padding: 5px 10px; border-top: 1px solid #e0e6ec; background: #fafbfc; }
.foot { margin-top: 20px; border-top: 1px solid #d3dce6; padding-top: 6px; font-size: 8pt; color: #6b7886; }
@media screen { html { background: #e9edf1; } body { background: #fff; max-width: 210mm; margin: 18px auto; padding: 16mm 14mm 18mm; box-shadow: 0 1px 4px rgba(15, 23, 42, .18); } }
`;

/** The whole document: its cover and control table, its contents, the design. meta: { key, title, sprint, epic, assignee, due, status, version, date, author, fdd, app, pages, provider } */
function renderDocument(o) {
  const meta = (o && o.meta) || {};
  const r = mdToHtml((o && o.markdown) || '');
  const row = (k, v) => (v ? '<tr><th>' + esc(k) + '</th><td>' + esc(v) + '</td></tr>' : '');
  const toc = r.heads.filter((h) => h.lvl <= 3).map((h) => '<a class="l' + h.lvl + '" href="#' + h.id + '">' + esc(h.text) + '</a>').join('');
  return '<!doctype html><html><head><meta charset="utf-8"><title>' + esc((meta.key ? meta.key + ' — ' : '') + 'Functional design') + '</title><style>' + CSS + '</style></head><body>'
    + '<div class="cover"><div class="kind">Functional &amp; technical design</div><h1>' + esc(meta.key ? meta.key + ' · ' + str(meta.title) : str(meta.title)) + '</h1>'
    + '<div class="sub">' + esc([meta.app, meta.sprint ? 'Sprint ' + meta.sprint : '', meta.version ? 'Version ' + meta.version : '', meta.date].filter(Boolean).join(' · ')) + '</div></div>'
    + '<table class="ctl">' + row('Story', meta.key ? meta.key + ' — ' + str(meta.title) : meta.title) + row('Sprint', meta.sprint) + row('Epic', meta.epic) + row('Assignee', meta.assignee)
    + row('Due', meta.due) + row('Status', meta.status) + row('Document version', meta.version ? 'v' + meta.version : '') + row('Date', meta.date) + row('Prepared by', meta.author)
    + row('Read against', meta.fdd) + row('Application', meta.app) + row('Pages considered', (meta.pages || []).join(', ')) + row('Written by', meta.provider ? meta.provider + ' (AI), from the story, its analysis, the FDD and the app\'s code' : '') + '</table>'
    + (toc ? '<nav class="toc"><b>Contents</b>' + toc + '</nav>' : '')
    + r.html
    + '<div class="foot">Generated by Build.Rite from the working folder\'s code' + (meta.date ? ' on ' + esc(meta.date) : '') + '. Review before use: names, values and decisions are for the team to confirm.</div>'
    + '</body></html>';
}

module.exports = { relevantPages, pageText, prompt, mdToHtml, wireframe, renderDocument, OUTLINE };
