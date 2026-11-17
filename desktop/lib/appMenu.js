'use strict';
/**
 * How a workspace app's menu and its pages fit together (Change requests → New page): Build.Rite learns it from the
 * app's own code instead of assuming one layout, then a new page is linked the same way as the pages already there.
 *
 *   menu(root, app)              → { found, file, groups: [{ key, label, items: [{ id, label, icon, route, page }] }] }
 *                                  — the groups of items ({ key, label, items: [ { id, label, icon … } ] }) in the app's
 *                                  app-flow.js, a nav.js or the shell page, each item's route ({ flow, page }) from the
 *                                  item itself or a map 'nav-id': { flow, page } in the same file
 *   flows(root, app)             → [{ flow, file, pages: [name] }]   (each flow's -flow.json pages)
 *   registrations(root, app, ref) → { ref: { flow, page, navId, label }, places: [{ file, kind, lines: [{ n, text }] }] }
 *                                  — every file of the app (outside the page's own files) that names the page or its
 *                                  menu id: its flow's page list, the menu, route maps, the navigation chain…
 *                                  = what a new page "like it" needs too
 *   excerpts(root, places, opts) → the text of those files (whole when small, else the lines around each place), for
 *                                  the AI to copy SEARCH lines from
 *   kebab(text)                  → a page name from a title ("Equipment Returns Report" → equipment-returns-report)
 */
const fs = require('fs');
const path = require('path');

const str = (v) => (v === undefined || v === null ? '' : String(v));
const read = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch (e) { return ''; } };
const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch (e) { return false; } };
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const kebab = (t) => str(t).toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').replace(/^(\d)/, 'p-$1').slice(0, 60);

/** The index of the bracket that closes the one at `open` (strings and comments skipped); -1 when it does not close. */
function closeOf(src, open) {
  const pair = { '[': ']', '{': '}', '(': ')' };
  const want = [pair[src[open]]];
  for (let i = open + 1; i < src.length; i++) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') { const e = src.indexOf('\n', i); if (e === -1) return -1; i = e; continue; }
    if (c === '/' && src[i + 1] === '*') { const e = src.indexOf('*/', i + 2); if (e === -1) return -1; i = e + 1; continue; }
    if (c === '"' || c === "'" || c === '`') { for (i++; i < src.length && src[i] !== c; i++) if (src[i] === '\\') i++; continue; }
    if (pair[c]) want.push(pair[c]);
    else if (c === want[want.length - 1]) { want.pop(); if (!want.length) return i; }
  }
  return -1;
}

/** Each flow of the app with its pages (as named in its -flow.json). */
function flows(root, app) {
  const dir = path.join(root, 'webApps', app, 'flows');
  const out = [];
  (isDir(dir) ? fs.readdirSync(dir).sort() : []).forEach((flow) => {
    const file = path.join(dir, flow, flow + '-flow.json');
    let j = null;
    try { j = JSON.parse(read(file)); } catch (e) { j = null; }
    if (!j) return;
    const pages = Object.keys(j.pages || {}).map((k) => { const m = /([^/]+)-page$/.exec(str(j.pages[k] && j.pages[k].path)); return m ? m[1] : k; });
    out.push({ flow: flow, file: path.relative(root, file).split(path.sep).join('/'), pages: pages, defaultPage: str(j.defaultPage) });
  });
  return out;
}

/** The app's menu: its groups of items, each item's route. */
function menu(root, app) {
  const base = path.join(root, 'webApps', app);
  const cands = ['app-flow.js', 'resources/js/nav.js', 'pages/shell-page.js', 'resources/js/menu.js', 'resources/js/navigation.js'];
  for (const rel of cands) {
    const src = read(path.join(base, rel));
    if (!src) continue;
    // routes kept apart from the items: 'nav-id': { flow: 'x', page: 'y' }
    const routes = {};
    let m;
    const rr = /'([a-z0-9-]+)'\s*:\s*\{\s*flow:\s*'([a-z0-9-]+)'\s*,\s*page:\s*'([a-z0-9-]+)'\s*\}/g;
    while ((m = rr.exec(src))) routes[m[1]] = { flow: m[2], page: m[3] };
    const groups = [];
    // a group: { key?: '…', label: '…', items: [ … ] } — its key and label are the last ones before "items: [" (after the
    // previous group's items closed)
    const gr = /\bitems:\s*\[/g;
    let prevEnd = 0;
    while ((m = gr.exec(src))) {
      const head = src.slice(Math.max(prevEnd, m.index - 600), m.index);
      const labels = head.match(/\blabel:\s*'([^']+)'/g) || [];
      if (!labels.length) continue;
      const label = /'([^']+)'/.exec(labels[labels.length - 1])[1];
      const keys = head.match(/\bkey:\s*'([^']+)'/g) || [];
      const key = keys.length ? /'([^']+)'/.exec(keys[keys.length - 1])[1] : kebab(label);
      const open = m.index + m[0].length - 1;
      const close = closeOf(src, open);
      if (close === -1) continue;
      prevEnd = close + 1;
      const block = src.slice(open + 1, close);
      const items = [];
      const ir = /\{\s*id:\s*'([^']+)'\s*,\s*label:\s*'([^']+)'/g;
      let x;
      while ((x = ir.exec(block))) {
        const oStart = block.lastIndexOf('{', x.index + 1);
        const oEnd = closeOf(block, oStart);
        const obj = block.slice(oStart, oEnd === -1 ? x.index + 400 : oEnd + 1);
        const icon = (/icon:\s*'([^']+)'/.exec(obj) || [])[1] || '';
        const own = /\bflow:\s*'([a-z0-9-]+)'\s*,\s*page:\s*'([a-z0-9-]+)'/.exec(obj);
        const route = own ? { flow: own[1], page: own[2] } : (routes[x[1]] || null);
        const extra = {};
        ['pageCode', 'navId', 'record'].forEach((k) => { const v = new RegExp(k + ":\\s*'([^']+)'").exec(obj); if (v) extra[k] = v[1]; });
        items.push(Object.assign({ id: x[1], label: x[2], icon: icon, route: route, page: route ? route.flow + '/' + route.page : '' }, extra));
      }
      if (items.length) groups.push({ key: key, label: label, items: items });
    }
    if (groups.length) return { found: true, file: 'webApps/' + app + '/' + rel, groups: groups };
  }
  return { found: false, file: '', groups: [] };
}

const SKIP_DIRS = /^(node_modules|\.git|build|dist|libs?|vendor|images?|fonts?|fdd|nls)$/i;
/** Every text file of the app worth reading (its code and its JSON), not libraries. */
function appFiles(root, app) {
  const base = path.join(root, 'webApps', app);
  const out = [];
  const walk = (d, depth) => {
    if (depth > 8 || out.length > 4000) return;
    let names = [];
    try { names = fs.readdirSync(d); } catch (e) { return; }
    names.forEach((n) => {
      const p = path.join(d, n);
      let st;
      try { st = fs.statSync(p); } catch (e) { return; }
      if (st.isDirectory()) { if (!SKIP_DIRS.test(n)) walk(p, depth + 1); return; }
      if (/\.(js|json|html)$/i.test(n) && st.size < 400000 && !/\.min\.js$/i.test(n)) out.push(p);
    });
  };
  walk(base, 0);
  return out;
}

/** What a place in a file is, in words (from its file and line). */
function kindOf(rel, line, menuFile) {
  if (/-flow\.json$/.test(rel)) return 'its flow\'s list of pages';
  if (/\/flows\/[^/]+\/pages\/[^/]+-page(-chains\/|\.)/.test(rel)) return 'another page opens it (a link)';
  if (rel === menuFile && /\bid:\s*'/.test(line)) return 'the menu (an item)';
  if (/flow:\s*'[^']+'\s*,\s*page:/.test(line)) return 'a route map (menu id → flow and page)';
  if (/-chains\//.test(rel)) return 'a navigation chain';
  if (/^\s*'[^']+'\s*:\s*'[^']+'/.test(line)) return 'a lookup map (page → menu id, or a code)';
  return 'a reference';
}

/** Where a page (and its menu id) is named across the app, outside its own files. */
function registrations(root, app, ref) {
  const r = ref || {};
  const page = str(r.page), flow = str(r.flow);
  if (!page) return { ref: r, places: [] };
  const m = menu(root, app);
  const item = m.groups.reduce((a, g) => a.concat(g.items), []).filter((it) => it.route && it.route.page === page && (!flow || it.route.flow === flow))[0] || null;
  const navId = item ? item.id : '';
  const names = [page].concat(navId && navId !== page ? [navId] : []);
  const re = new RegExp('[\'"](' + names.map(esc).join('|') + ')[\'"]');
  const own = 'webApps/' + app + '/flows/' + flow + '/pages/' + page + '-page';
  const places = [];
  appFiles(root, app).forEach((p) => {
    const rel = path.relative(root, p).split(path.sep).join('/');
    if (rel.indexOf(own) === 0) return; // its own files and chains
    const lines = read(p).split('\n');
    const hits = [];
    lines.forEach((l, i) => { if (re.test(l) && hits.length < 20) hits.push({ n: i + 1, text: l.trim().slice(0, 200) }); });
    // another page that opens it is a link, not where the app registers its pages: listed, not needed for a new page
    if (hits.length) places.push({ file: rel, kind: kindOf(rel, hits[0].text, m.file), kinds: Array.from(new Set(hits.map((h) => kindOf(rel, h.text, m.file)))), lines: hits,
      needed: !/\/flows\/[^/]+\/pages\/[^/]+-page(-chains\/|\.)/.test(rel) });
  });
  // the flow's page list and the menu first, then the rest
  const order = (pl) => (!pl.needed ? 9 : /-flow\.json$/.test(pl.file) ? 0 : pl.file === m.file ? 1 : /-chains\//.test(pl.file) ? 2 : 3);
  places.sort((a, b) => order(a) - order(b) || a.file.localeCompare(b.file));
  return { ref: { flow: flow, page: page, navId: navId, label: item ? item.label : '', group: item ? (m.groups.filter((g) => g.items.indexOf(item) !== -1)[0] || {}).label : '' }, menuFile: m.file, places: places.slice(0, 14) };
}

/** The files of the places, for the AI: whole when small, else the lines around each place (exact, to copy SEARCH from). */
function excerpts(root, places, opts) {
  const o = opts || {};
  const small = o.small || 12000, around = o.around || 8, budget = o.budget || 60000;
  let used = 0;
  const out = [];
  (places || []).forEach((pl) => {
    if (used >= budget) return;
    const text = read(path.join(root, pl.file)).replace(/\r\n/g, '\n');
    if (!text) return;
    let block;
    if (text.length <= small) block = '=== FILE ' + pl.file + ' (complete) ===\n' + text;
    else {
      const lines = text.split('\n');
      const spans = [];
      pl.lines.forEach((h) => { const a = Math.max(1, h.n - around), b = Math.min(lines.length, h.n + around); const last = spans[spans.length - 1]; if (last && a <= last[1] + 1) last[1] = Math.max(last[1], b); else spans.push([a, b]); });
      block = spans.map((s) => '=== FILE ' + pl.file + ' (lines ' + s[0] + '–' + s[1] + ' of ' + lines.length + ', an excerpt) ===\n' + lines.slice(s[0] - 1, s[1]).join('\n')).join('\n');
    }
    if (used + block.length > budget) block = block.slice(0, Math.max(0, budget - used)) + '\n(… cut: too long)';
    used += block.length;
    out.push(block);
  });
  return out.join('\n\n');
}

module.exports = { menu, flows, registrations, excerpts, kebab, closeOf };
