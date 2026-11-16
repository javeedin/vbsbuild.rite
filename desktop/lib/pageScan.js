'use strict';
/**
 * Reads the Visual Builder pages in the project (every app under webApps/) and works out each one's technical facts
 * straight from its files — what the Application pages screen shows and "Analyze with AI" reads:
 *
 *   features      the sections it shows (headings), the actions (buttons → the listener → the chains they run), the
 *                 fields people fill in, the Oracle JET / Redwood components it uses, what it is opened with (inputs)
 *   logic         each action chain (what its own comment says it does, the services it calls, the modules it uses,
 *                 the pages it opens) and each rules module (resources/js/*.js) with what its comment says
 *   integrations  every REST call: the endpoint (service/operation) → its HTTP method and path and summary (from
 *                 services/<service>/openapi3.json) → the backend it goes to (the app's own REST, Fusion, OIC, BI Publisher,
 *                 Jira…); the BI Publisher reports it runs; the desktop app's local services it uses
 *   links         the other screens it opens
 *   codeHash      a hash of its files, so a sheet can say "the code changed since"
 *
 *   list(root)            [{ id, app, appName, flow, page, label, description, route, next: [ids], menu }]  — every page,
 *                         with where it goes (next: the pages its code opens) and its menu entry, if any
 *   analyze(root, id)     the facts of one page (above, with next: [{ id, label, via }] and unresolved links), or null
 *   links(root)           { edges: [{ from, to, via }], menus: { app: [{ label, group, to }] }, unresolved: { id: [raw] } }
 *                         — the navigation between every page: navigateToPage / navigateToFlow (through the flow's page
 *                         list), a tab-shell app's records and menu items (resources/js/nav.js), and each app's menu (app-flow.js NAV_GROUPS)
 *
 * Pure reading: nothing is written. An id is "<app>/<flow>/<page>" ("myapp/main/workbench"); an app's root
 * pages (its shell) are "<app>//<page>".
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const vm = require('vm');

// An app's name as people know it: Build.Rite's own; any other app goes by its folder's name.
const APPS = { buildrite: 'Build.Rite' };
// Backends known by name (Oracle's own, Jira); any other is named after its service connection.
const BACKENDS = {
  fusion: 'Oracle Fusion REST', ics: 'Oracle Integration Cloud (OIC)', bipService: 'Oracle BI Publisher (SOAP)', jira: 'Jira Cloud',
};
const LOCAL = {
  __ai: 'Saved AI analyses (on this PC)', __fdd: 'FDD library (git)', __pages: 'Application pages (git)', __minutes: 'Standup minutes (on this PC)',
  __followups: 'Follow-ups (on this PC)', __sql: 'SQL worksheet / Ask AI (on this PC)', __jira: 'Jira connection (on this PC)', __rec: 'Test evidence (on this PC)',
  __services: 'Web services log',
};

const read = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch (e) { return ''; } };
const exists = (f) => { try { return fs.statSync(f).isFile(); } catch (e) { return false; } };
const isDir = (f) => { try { return fs.statSync(f).isDirectory(); } catch (e) { return false; } };
const uniq = (a) => a.filter((x, i) => x && a.indexOf(x) === i);
const rel = (root, f) => path.relative(root, f).split(path.sep).join('/');
const clean = (s) => String(s || '').replace(/\[\[[\s\S]*?\]\]/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ').trim();
const humanize = (id) => String(id || '').replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

/** The first comment of a file: its header ("// …" lines or a block), as one paragraph. */
function headerComment(src, max) {
  const s = String(src || '');
  const lines = s.split('\n');
  const out = [];
  let started = false, inBlock = false;
  for (let i = 0; i < Math.min(lines.length, 120); i++) {
    const t = lines[i].trim();
    if (inBlock) {
      if (t.indexOf('*/') !== -1) { out.push(t.replace(/\*\/.*$/, '').replace(/^\*\s?/, '')); break; }
      out.push(t.replace(/^\*\s?/, ''));
      continue;
    }
    if (/^\/\*\*?/.test(t)) { started = true; inBlock = true; const rest = t.replace(/^\/\*\*?/, '').replace(/\*\/.*$/, ''); if (rest.trim()) out.push(rest); if (t.indexOf('*/') > 1) break; continue; }
    if (/^\/\//.test(t)) { started = true; out.push(t.replace(/^\/\/\s?/, '')); continue; }
    if (started && t === '') break;
    if (started) break;
  }
  const text = out.join(' ').replace(/\s+/g, ' ').replace(/^(Run|Rules|Pure)\b.*$/, '').trim();
  return max && text.length > max ? text.slice(0, max - 1).replace(/\s+\S*$/, '') + '…' : text;
}

/** Every page of every app: [{ id, app, appName, flow, page, json, html, js, chainsDir }]. */
function pagesOf(root) {
  const web = path.join(root, 'webApps');
  const out = [];
  const add = (app, flow, dir, file) => {
    const page = file.replace(/-page\.json$/, '');
    const base = path.join(dir, page + '-page');
    out.push({ id: app + '/' + flow + '/' + page, app: app, appName: APPS[app] || app, flow: flow, page: page,
      json: base + '.json', html: base + '.html', js: base + '.js', chainsDir: base + '-chains' });
  };
  (isDir(web) ? fs.readdirSync(web) : []).sort().forEach((app) => {
    const appDir = path.join(web, app);
    if (!isDir(appDir) || !exists(path.join(appDir, 'app-flow.json'))) return;
    const rootPages = path.join(appDir, 'pages');
    if (isDir(rootPages)) fs.readdirSync(rootPages).filter((f) => /-page\.json$/.test(f)).sort().forEach((f) => add(app, '', rootPages, f));
    const flows = path.join(appDir, 'flows');
    (isDir(flows) ? fs.readdirSync(flows) : []).sort().forEach((flow) => {
      const pd = path.join(flows, flow, 'pages');
      if (isDir(pd)) fs.readdirSync(pd).filter((f) => /-page\.json$/.test(f)).sort().forEach((f) => add(app, flow, pd, f));
    });
  });
  return out;
}

// A tab-shell app's menu (resources/js/nav.js exporting GROUPS, as Build.Rite's own): which screen a flow/page is, and
// how it is opened.
const navCache = {};
/** A tab-shell app's menu (resources/js/nav.js), by route: { 'flow/page': { navId, label, group } }; {} for another app. */
function navOf(root, app) {
  const f = path.join(root, 'webApps', app, 'resources', 'js', 'nav.js');
  const src = read(f);
  const c = navCache[app] || (navCache[app] = {});
  if (c.src === src) return c.value;
  let N = null;
  try {
    const sb = { console: { log() {}, warn() {} }, define: (deps, factory) => { N = factory({ isFeatureEnabled: () => true }, {}, {}); } };
    vm.createContext(sb);
    vm.runInContext(src, sb, { timeout: 2000 });
  } catch (e) { N = null; }
  const byRoute = {};
  const items = {}, records = {};
  if (N && N.GROUPS) N.GROUPS.forEach((g) => (g.items || []).forEach((it) => {
    if (!it.route) return;
    byRoute[it.route.flow + '/' + it.route.page] = { navId: it.id, label: it.label, group: g.label || '' };
    items[it.id] = { flow: it.route.flow, page: it.route.page, label: it.label, group: g.label || '' };
  }));
  if (N && N.RECORDS) Object.keys(N.RECORDS).forEach((k) => {
    const r = N.RECORDS[k]; const key = r.flow + '/' + r.page;
    records[k] = { flow: r.flow, page: r.page };
    if (!byRoute[key]) byRoute[key] = { record: k, label: '', group: '' };
  });
  Object.defineProperty(byRoute, '_items', { value: items, enumerable: false });
  Object.defineProperty(byRoute, '_records', { value: records, enumerable: false });
  c.src = src; c.value = byRoute;
  return byRoute;
}
/** Whether the app is a tab shell: its screens open as tabs from its menu (resources/js/nav.js GROUPS). */
function isTabShell(root, app) { return Object.keys(navOf(root, app)._items || {}).length > 0; }

/** A page's name, as people know it: its menu label, else its page title, its first heading, its description. */
function labelOf(root, p, html, json) {
  if (isTabShell(root, p.app)) { const n = navOf(root, p.app)[p.flow + '/' + p.page]; if (n && n.label) return n.label; }
  const title = /page-title="([^"[]+)"/.exec(html) || /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
  const t = title ? clean(title[1]) : '';
  if (t && t.length <= 80) return t;
  const d = String((json && json.description) || '').split(/[.:(—]/)[0].trim();
  if (d && d.length <= 60) return d;
  return humanize(p.page);
}

/** How the page is opened in its app (what a screenshot loads). */
function routeOf(root, p) {
  // a tab shell: a screen opens in a tab from the menu (?open=<item>); its own address only shows the home tab
  if (isTabShell(root, p.app)) {
    const n = navOf(root, p.app)[p.flow + '/' + p.page];
    if (n && n.navId) return { url: '/?open=' + n.navId, menu: (n.group ? n.group + ' › ' : '') + n.label, needs: '' };
    if (n && n.record) return { url: '', menu: '', needs: 'Opened from another screen (record "' + n.record + '"): capture it there, or upload a screenshot.' };
    return { url: '', menu: '', needs: 'Not in the menu: upload a screenshot.' };
  }
  if (!p.flow) return { url: '/', menu: '', needs: '' };
  return { url: '/vp/shell/' + p.flow + '/' + p.page, menu: '', needs: '' };
}

/** The services: endpoint "service/operationId" → { method, path, summary, backend }. */
const svcCache = {};
function serviceOps(root) {
  const dir = path.join(root, 'services');
  const key = isDir(dir) ? fs.readdirSync(dir).join(',') : '';
  if (svcCache.key === key && svcCache.root === root) return svcCache.value;
  const ops = {};
  (isDir(dir) ? fs.readdirSync(dir) : []).forEach((svc) => {
    const f = path.join(dir, svc, 'openapi3.json');
    if (!exists(f)) return;
    let d;
    try { d = JSON.parse(read(f)); } catch (e) { return; }
    const srv = ((d.servers || [])[0] || {}).url || '';
    const backend = (/backends\/([^/]+)/.exec(srv) || [])[1] || '';
    Object.keys(d.paths || {}).forEach((p) => {
      Object.keys(d.paths[p]).forEach((m) => {
        const o = d.paths[p][m];
        if (o && o.operationId) ops[svc + '/' + o.operationId] = { method: m.toUpperCase(), path: p, summary: o.summary || '', backend: backend, backendLabel: BACKENDS[backend] || backend };
      });
    });
  });
  svcCache.key = key; svcCache.root = root; svcCache.value = ops;
  return ops;
}

/** What a piece of code does to the outside: endpoints, reports, local services, screens it opens, modules it uses. */
/**
 * Code without its comments ("// This used to call OLD_REPORT_RP" names nothing the page does): strings kept as they are
 * ('http://…' is not a comment), // taken as a comment only where code would have ended or begun a part.
 */
function stripComments(src) {
  const s = String(src || '');
  let out = '', q = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { out += c; if (c === '\\') { out += s[++i] || ''; } else if (c === q) q = ''; continue; }
    if (c === '"' || c === "'" || c === '`') { q = c; out += c; continue; }
    if (c === '/' && s[i + 1] === '*') { const e = s.indexOf('*/', i + 2); const gap = s.slice(i, e < 0 ? s.length : e + 2); out += gap.replace(/[^\n]/g, ' '); i = e < 0 ? s.length : e + 1; continue; }
    if (c === '/' && s[i + 1] === '/' && /(^|[\s;{}(),=:[])$/.test(out.slice(-1) || '\n')) { const e = s.indexOf('\n', i); i = (e < 0 ? s.length : e) - 1; continue; }
    out += c;
  }
  return out;
}

function scanCode(src) {
  const s = stripComments(src);
  const all = (re, g) => { const out = []; let m; const r = new RegExp(re.source, 'g'); while ((m = r.exec(s))) out.push(m[g || 1]); return uniq(out); };
  return {
    endpoints: all(/endpoint['"]?\s*:\s*['"]([A-Za-z0-9_-]+\/[A-Za-z0-9_]+)['"]/),
    reports: uniq(all(/\b([A-Z][A-Z0-9_]{2,}_RP)\b/).concat(all(/\/Custom\/[^'"\s]+\/([A-Za-z0-9_]+)\.xdo/))),
    local: all(/['"`]\/(__[a-z]+)\//),
    opens: uniq(all(/record:\s*['"]([a-z0-9-]+)['"]/).map((r) => 'record ' + r).concat(all(/navId:\s*['"]([a-z0-9-]+)['"]/).map((n) => 'menu ' + n))
      .concat(all(/navigateToPage[\s\S]{0,80}?page:\s*['"]([A-Za-z0-9/_-]+)['"]/).map((x) => 'page ' + x))
      .concat(all(/navigateToFlow[\s\S]{0,80}?flow:\s*['"]([A-Za-z0-9/_-]+)['"]/).map((x) => 'flow ' + x))),
    modules: all(/['"](resources\/js\/[A-Za-z0-9_/-]+)['"]/),
  };
}

// ── Navigation: where a page's code goes, as page ids ──────────────────────────────────────────────────────────────
/** An app's flows: { flowId: { pages: { pageKey: fileBase }, defaultPage } } (from <flow>-flow.json); '' is its root. */
function appFlows(root, app) {
  const out = {};
  const appDir = path.join(root, 'webApps', app);
  const flowsDir = path.join(appDir, 'flows');
  const pagesOfJson = (f) => {
    let d = {};
    try { d = JSON.parse(read(f)); } catch (e) { d = {}; }
    const pages = {};
    Object.keys(d.pages || {}).forEach((k) => { const pth = String((d.pages[k] && d.pages[k].path) || ''); const m = /([^/]+)-page$/.exec(pth); pages[k] = m ? m[1] : k; });
    return { pages: pages, defaultPage: d.defaultPage || '' };
  };
  out[''] = pagesOfJson(path.join(appDir, 'app-flow.json'));
  (isDir(flowsDir) ? fs.readdirSync(flowsDir) : []).forEach((flow) => { out[flow] = pagesOfJson(path.join(flowsDir, flow, flow + '-flow.json')); });
  return out;
}

/** One raw link ("page x", "flow y", "record z", "menu w") from a page → the page id it opens, or ''. */
function resolveLink(root, from, raw, flowsByApp, ids) {
  const app = from.app;
  const flows = flowsByApp[app] || (flowsByApp[app] = appFlows(root, app));
  const has = (id) => ids.has(id);
  const inFlow = (flow, key) => {
    const f = flows[flow];
    if (!f) return '';
    const file = f.pages[key] || key;
    const id = app + '/' + flow + '/' + file;
    return has(id) ? id : '';
  };
  const m = /^(page|flow|record|menu) (.+)$/.exec(raw);
  if (!m) return '';
  const kind = m[1], target = m[2];
  if (kind === 'page') {
    const parts = target.split('/').filter(Boolean);
    if (parts.length >= 2) { const r = inFlow(parts[parts.length - 2], parts[parts.length - 1]); if (r) return r; }
    const key = parts[parts.length - 1];
    const here = inFlow(from.flow, key);
    if (here) return here;
    const other = Object.keys(flows).filter((f) => f && flows[f].pages[key]);
    if (other.length) return inFlow(other[0], key);
    const byFile = Array.from(ids).filter((id) => id.indexOf(app + '/') === 0 && id.split('/')[2] === key);
    return byFile[0] || '';
  }
  if (kind === 'flow') {
    const f = flows[target];
    return f ? inFlow(target, f.defaultPage) : '';
  }
  if (isTabShell(root, app)) {
    const nav = navOf(root, app);
    const r = kind === 'record' ? nav._records[target] : nav._items[target];
    if (r) { const id = app + '/' + r.flow + '/' + r.page; if (has(id)) return id; const viaFlow = inFlow(r.flow, r.page); if (viaFlow) return viaFlow; }
  }
  return '';
}

/** Each app's menu (app-flow.js NAV_GROUPS; a tab shell: resources/js/nav.js): [{ label, group, to }]. */
function menusOf(root, ids) {
  const out = {};
  const apps = Array.from(new Set(Array.from(ids).map((id) => id.split('/')[0])));
  apps.forEach((app) => {
    const list = [];
    if (isTabShell(root, app)) {
      const items = navOf(root, app)._items || {};
      Object.keys(items).forEach((k) => { const it = items[k]; const id = app + '/' + it.flow + '/' + it.page; if (ids.has(id)) list.push({ label: it.label, group: it.group, to: id }); });
    } else {
      const src = read(path.join(root, 'webApps', app, 'app-flow.js'));
      const flows = appFlows(root, app);
      // an item: { id: …, label: '…', … flow: 'x', page: 'y' } or { … label: '…', … route: { flow: 'x', page: 'y' } }
      const re = /label:\s*'([^']{1,60})'((?:(?!label:)[\s\S]){0,400}?)\bflow:\s*'([a-z0-9-]+)'\s*,\s*page:\s*'([a-z0-9-]+)'/g;
      const add = (label, flow, page) => {
        const f = flows[flow];
        const file = f ? (f.pages[page] || page) : page;
        const id = app + '/' + flow + '/' + file;
        if (ids.has(id) && !list.some((x) => x.to === id)) list.push({ label: label, group: '', to: id });
      };
      let m;
      while ((m = re.exec(src))) add(m[1], m[3], m[4]);
      // items { id, label } in NAV_GROUPS, their routes in a map ('nav-id': { flow, page })
      const routes = {};
      const rr = /'([a-z0-9-]+)'\s*:\s*\{\s*flow:\s*'([a-z0-9-]+)'\s*,\s*page:\s*'([a-z0-9-]+)'\s*\}/g;
      while ((m = rr.exec(src))) routes[m[1]] = { flow: m[2], page: m[3] };
      const ri = /\{\s*id:\s*'([a-z0-9-]+)'\s*,\s*label:\s*'([^']{1,60})'/g;
      while ((m = ri.exec(src))) { const r = routes[m[1]]; if (r) add(m[2], r.flow, r.page); }
    }
    out[app] = list;
  });
  return out;
}

/** What a page's own files open (its page module and its chains). */
function opensOf(p) {
  const out = [];
  const add = (raw, via) => { const e = out.filter((x) => x.raw === raw)[0]; if (e) { if (via && e.via.indexOf(via) === -1) e.via.push(via); } else out.push({ raw: raw, via: via ? [via] : [] }); };
  scanCode(read(p.js)).opens.forEach((r) => add(r, ''));
  if (isDir(p.chainsDir)) fs.readdirSync(p.chainsDir).filter((f) => /\.js$/.test(f)).forEach((f) => scanCode(read(path.join(p.chainsDir, f))).opens.forEach((r) => add(r, f.replace(/\.js$/, ''))));
  return out;
}

const linkCache = { key: '', value: null };
function links(root) {
  const pages = pagesOf(root);
  // cheap freshness check: the chain folders' and page modules' sizes and times
  const key = root + '|' + pages.map((p) => { try { const a = fs.statSync(p.js); return p.id + a.mtimeMs + (isDir(p.chainsDir) ? fs.statSync(p.chainsDir).mtimeMs : 0); } catch (e) { return p.id; } }).join(',');
  if (linkCache.key === key) return linkCache.value;
  const ids = new Set(pages.map((p) => p.id));
  const flowsByApp = {};
  const edges = [], unresolved = {};
  pages.forEach((p) => {
    opensOf(p).forEach((o) => {
      const to = resolveLink(root, p, o.raw, flowsByApp, ids);
      if (to && to !== p.id) { if (!edges.some((e) => e.from === p.id && e.to === to)) edges.push({ from: p.id, to: to, via: o.via }); }
      else if (!to) (unresolved[p.id] = unresolved[p.id] || []).push(o.raw);
    });
  });
  const value = { edges: edges, menus: menusOf(root, ids), unresolved: unresolved };
  linkCache.key = key; linkCache.value = value;
  return value;
}

function list(root) {
  const L = links(root);
  const menuOf = {};
  Object.keys(L.menus).forEach((app) => L.menus[app].forEach((mi) => { if (!menuOf[mi.to]) menuOf[mi.to] = (mi.group ? mi.group + ' › ' : '') + mi.label; }));
  return pagesOf(root).map((p) => {
    const html = read(p.html);
    let json = {};
    try { json = JSON.parse(read(p.json)); } catch (e) { json = {}; }
    return { id: p.id, app: p.app, appName: p.appName, flow: p.flow, page: p.page, label: labelOf(root, p, html, json),
      description: String(json.description || '').slice(0, 400), route: routeOf(root, p),
      next: L.edges.filter((e) => e.from === p.id).map((e) => e.to), menu: menuOf[p.id] || '' };
  });
}

const isObjS = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const firstKey = (k) => String(Array.isArray(k) ? k[0] || '' : k || '');
/** Splits at a character outside quotes and brackets ("a: 'x,y', b: f(1, 2)" at ',' → ["a: 'x,y'", " b: f(1, 2)"]). */
function splitTop(s, ch) {
  const out = [];
  let q = '', d = 0, cur = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { cur += c; if (c === '\\') { cur += s[++i] || ''; } else if (c === q) q = ''; continue; }
    if (c === '"' || c === "'" || c === '`') { q = c; cur += c; continue; }
    if ('([{'.indexOf(c) !== -1) d++;
    if (')]}'.indexOf(c) !== -1) d--;
    if (c === ch && d === 0) { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  out.push(cur);
  return out;
}
/** One statement from where it starts: up to its ';' (or a blank line) outside quotes and brackets, at most 4000 characters. */
function stmtOf(s) {
  let q = '', d = 0;
  const n = Math.min(s.length, 4000);
  for (let i = 0; i < n; i++) {
    const c = s[i];
    if (q) { if (c === '\\') i++; else if (c === q) q = ''; continue; }
    if (c === '"' || c === "'" || c === '`') { q = c; continue; }
    if (c === '/' && s[i + 1] === '/') { const e = s.indexOf('\n', i); i = e < 0 ? n : e; continue; }
    if ('([{'.indexOf(c) !== -1) d++;
    else if (')]}'.indexOf(c) !== -1) { if (--d < 0) return s.slice(0, i); }
    else if (d === 0 && (c === ';' || (c === '\n' && /^\s*\n/.test(s.slice(i + 1, i + 40))))) return s.slice(0, i);
  }
  return s.slice(0, n);
}
/**
 * A value as the page sends it, as a scenario value: "{{ $variables.formData.customerRefId }}", $page.variables.x.y,
 * request.projectId or a bare name → "{{customerRefId}}"; 'OPEN', 500, true stay; "'ProjectId=' + request.projectId" →
 * "ProjectId={{projectId}}". Anything else (a call, a condition) → '' (not known).
 */
function valueOf(expr) {
  let s = String(expr == null ? '' : expr).trim().replace(/^\{\{\s*([\s\S]*?)\s*\}\}$/, '$1');
  if (!s) return '';
  const parts = splitTop(s, '+').map((x) => x.trim());
  let out = '';
  for (const x of parts) {
    let m;
    if ((m = /^(['"`])([^'"`]*)\1$/.exec(x))) out += m[2];
    else if (/^-?\d+(\.\d+)?$/.test(x) || /^(true|false)$/.test(x)) out += x;
    else if ((m = /^(?:Number|String|parseInt)\(\s*([\w$.]+)\s*\)$/.exec(x)) || (m = /^([\w$]+(?:\.[\w$]+)*)$/.exec(x))) {
      const seg = m[1].split('.').pop();
      if (!/^[A-Za-z_]\w*$/.test(seg) || /^(null|undefined|this|context)$/.test(seg)) return '';
      out += '{{' + seg + '}}';
    } else return '';
  }
  return out;
}
/** A chain's own names for page values: const contractId = $page.variables.selectedContractId → { contractId: 'selectedContractId' }. */
function aliasesOf(src) {
  const out = {};
  for (const m of String(src || '').matchAll(/(?:const|let|var)\s+(\w+)\s*=\s*(?:context\.)?\$(?:page|flow|app)\.variables\.([\w.]+)\s*(?:\|\|[^;\n]*)?[;\n]/g)) out[m[1]] = m[2].split('.').pop();
  for (const m of String(src || '').matchAll(/(?:const|let|var)\s*\{([^}]+)\}\s*=\s*(?:context\.)?\$(?:page|flow|app)\.variables(?:\.[\w.]+)?\s*;/g)) m[1].split(',').map((x) => x.trim().split(':')[0].trim()).filter((x) => /^\w+$/.test(x)).forEach((x) => { out[x] = x; });
  return out;
}
/** {{name}} as the page value a chain's local name stands for. */
const unalias = (v, al) => String(v == null ? '' : v).replace(/\{\{(\w+)\}\}/g, (m, n) => '{{' + (al && al[n] ? al[n] : n) + '}}');

/** The text of a call's object literal "callRest(context, { … })" from where it starts (braces balanced). */
function objectAt(src, from) {
  const i = src.indexOf('{', from);
  if (i < 0) return '';
  let d = 0;
  for (let j = i; j < Math.min(src.length, i + 3000); j++) { const c = src[j]; if (c === '{') d++; else if (c === '}' && --d === 0) return src.slice(i, j + 1); }
  return src.slice(i, i + 3000);
}
/** The values a chain sends with each call: uriParams: { customerId: $page.variables.formData.customerRefId, status: 'OPEN' }. */
function callParamsOf(srcs) {
  const out = {};
  srcs.forEach((src) => {
    const al = aliasesOf(src);
    for (const m of src.matchAll(/callRest\(\s*context\s*,/g)) {
      const obj = objectAt(src, m.index);
      const ep = (/endpoint\s*:\s*['"]([\w-]+\/\w+)['"]/.exec(obj) || [])[1];
      const ui = obj.search(/uriParams\s*:\s*\{/);
      if (!ep || ui < 0 || out[ep]) continue;
      const params = {};
      const body = objectAt(obj, ui).slice(1, -1);
      splitTop(body, ',').forEach((kv) => {
        const at = splitTop(kv, ':');
        if (at.length < 2) return;
        const k = at[0].trim().replace(/^['"]|['"]$/g, '');
        const v = unalias(valueOf(at.slice(1).join(':')), al);
        if (/^[\w-]+$/.test(k) && v !== '') params[k] = v;
      });
      if (Object.keys(params).length) out[ep] = params;
    }
  });
  return out;
}
/** A method's body in a page module: "name(…) { … }" (braces balanced), or ''. */
function methodOf(src, name) {
  const m = new RegExp('(?:^|[\\s,{;])' + name + '\\s*\\([^)]*\\)\\s*\\{').exec(src);
  return m ? objectAt(src, m.index + m[0].length - 1) : '';
}
/** A list mapped from rows ({ CustomerId: r.CUSTOMERID, label: (h.agreementNumber || …) }): the row's own field for a name. */
function mapFrom(text) {
  const re = (k, f) => new RegExp('\\b' + k + '\\s*:\\s*\\(?\\s*(?:Number|String|parseInt)?\\(?\\s*\\w+\\.(\\w+)', f);
  return (k) => (k ? ((re(k, '').exec(text) || re(k, 'i').exec(text) || [])[1] || '') : '');
}
/**
 * The BI Publisher report a chain runs: its path, the row element it decodes, and its parameters — a value as written
 * stays, a page value becomes {{name}}; in a search (typeahead) the one given the typed text is its search parameter.
 *   → { report, reportPath, rowTag, params: { P_X: value }, search }
 */
function reportCallOf(src, typeahead) {
  const pm = /['"`](\/[^'"`\s]+?\/([A-Za-z0-9_]+)\.xdo)['"`]/.exec(src);
  if (!pm) return { report: '' };
  const out = { report: pm[2], reportPath: pm[1], rowTag: '', params: {}, search: '' };
  const tag = /(?:decodeReportRows|parseXmlRows)\([^,()]+,\s*['"]([A-Za-z0-9_]+)['"]((?:\s*,\s*['"][A-Za-z0-9_]+['"])*)/.exec(src);
  if (tag) {
    out.rowTag = tag[1];
    // decodeReportRows(body, 'G_1', 'CONTRACT_ID', 'CONTRACT_NUMBER', 'STATUS'): the columns a shared helper names id, label, label2
    out.cols = Array.from(String(tag[2] || '').matchAll(/['"]([A-Za-z0-9_]+)['"]/g)).map((x) => x[1]);
  }
  for (const x of src.matchAll(/name\s*:\s*['"](P_\w+)['"]\s*,\s*values?\s*:\s*(\[[^\]]*\]|[^,}\n]+)/g)) {
    const raw = x[2].trim().replace(/^\[\s*|\s*\]$/g, '');
    const lit = /^(['"`])([^'"`]*)\1$/.exec(raw);
    if (lit) out.params[x[1]] = lit[2];
    else if (typeahead && !out.search) { out.search = x[1]; out.params[x[1]] = ''; }
    else { const v = unalias(valueOf(raw), aliasesOf(src)); out.params[x[1]] = v; }
  }
  return out;
}
/**
 * The page's lists of values: each dropdown (oj-select-single, oj-combobox-one…), the field it fills (label-hint), what
 * it shows (item-text) and keeps (the data provider's keyAttributes), the page value it sets (value="{{ … }}"), and where
 * its values come from: a call (a ServiceDataProvider's endpoint, or the call whose answer a chain puts in the array the
 * provider reads), a BI Publisher report, or values written in the code.
 *   → [{ field, component, target, text, key, textFrom, keyFrom, source: 'service'|'chain'|'report'|'static'|'',
 *        endpoint, report, itemsPath, params, values, via }]
 */
function lovsOf(htmlSrc, json, chainSrcs) {
  const vars = (json && json.variables) || {};
  const out = [];
  const html = String(htmlSrc || '');
  const listeners = (json && json.eventListeners) || {};
  const pageJs = (chainSrcs.filter((c) => c.name === 'page module')[0] || {}).src || '';
  const byName = {};
  chainSrcs.forEach((c) => { byName[c.name] = c.src; });
  const re = /<(oj-(?:c-)?(?:select-single|select-many|select-one|combobox-one|combobox-many))\b((?:\s+[^\s=>]+(?:="[^"]*"|='[^']*')?)*)\s*\/?>/g;
  // the conditions a part of the page is shown under (<oj-bind-if test="…">): a field shown in one case only says so
  const ifs = [];
  for (const t of html.matchAll(/<oj-bind-if\b[^>]*\btest="([^"]*)"[^>]*>|<\/oj-bind-if>/g)) ifs.push({ at: t.index, open: t[0][1] !== '/', test: t[1] || '' });
  const whenAt = (pos) => {
    const st = [];
    ifs.forEach((x) => { if (x.at >= pos) return; if (x.open) st.push(x.test); else st.pop(); });
    const clean1 = (t) => t.replace(/^\s*\[\[\s*|\s*\]\]\s*$/g, '').replace(/\$(?:page\.|flow\.|app\.)?variables\./g, '').replace(/\s+/g, ' ').trim();
    const all = st.map(clean1).filter(Boolean);
    return (all.length > 1 ? all.map((t) => '(' + t + ')').join(' && ') : (all[0] || '')).slice(0, 300);
  };
  for (const m of html.matchAll(re)) {
    const a = m[2];
    const attr = (n) => { const x = new RegExp('(?:^|\\s)' + n + '="([^"]*)"').exec(a); return x ? x[1] : ''; };
    const close = html.indexOf('</' + m[1] + '>', m.index);
    const inner = close > 0 ? html.slice(m.index + m[0].length, close) : '';
    const dv = (/\$(?:page\.|flow\.|app\.)?variables\.(\w+)/.exec(attr('data') || attr('options')) || [])[1] || '';
    const fn = (/\$functions\.(\w+)\s*\(/.exec(attr('data') || attr('options')) || [])[1] || '';
    // the page value it sets: the longest path in value="…" (selectedCustomerObj.CustomerId → CustomerId)
    const paths = Array.from(attr('value').matchAll(/variables\.([\w.]+)/g)).map((x) => x[1]).sort((x, y) => y.length - x.length);
    const target = (paths[0] || '').split('.').pop();
    const it = attr('item-text');
    // a second line in its item template ($current.data.CustomerNumber under $current.data.Customer)
    const shown = uniq(Array.from(inner.matchAll(/\$current\.data\.(\w+)/g)).map((x) => x[1]));
    const lov = { field: clean(attr('label-hint') || attr('aria-label') || attr('placeholder') || attr('label')) || humanize(target || dv), component: m[1], target,
      text: /[[{]/.test(it) ? '' : it, key: '', textFrom: '', keyFrom: '', sub: '', subFrom: '', source: '', endpoint: '', report: '', reportPath: '', rowTag: '', search: '',
      itemsPath: '', params: {}, values: [], via: '', when: whenAt(m.index) };
    lov.sub = shown.filter((x) => x !== lov.text)[0] || '';
    const v = vars[dv] || {};
    const def = isObjS(v.defaultValue) ? v.defaultValue : {};
    lov.key = firstKey(def.keyAttributes);
    if (/ServiceDataProvider/.test(String(v.type || ''))) {
      lov.source = 'service'; lov.endpoint = String(def.endpoint || ''); lov.itemsPath = String(def.itemsPath || '');
      // in the page JSON a value is written as it is ('Y'), a page value in {{ }}
      Object.keys(isObjS(def.uriParameters) ? def.uriParameters : {}).forEach((k) => { const raw = String(def.uriParameters[k] == null ? '' : def.uriParameters[k]); const x = /\{\{/.test(raw) ? valueOf(raw) : raw; if (x !== '') lov.params[k] = x; });
    } else if (Array.isArray(def.data) && def.data.length) {
      lov.source = 'static';
      lov.values = def.data.slice(0, 50).filter(isObjS).map((r) => ({ key: String(r[lov.key || 'value'] == null ? '' : r[lov.key || 'value']), text: String(r[lov.text || 'label'] == null ? '' : r[lov.text || 'label']) }));
    } else if (fn) {
      // a provider in the page module (a search as you type): the event it fires, the chain that answers it
      const body = methodOf(pageJs, fn);
      const prop = (/return\s+this\.(\w+)/.exec(body) || [])[1];
      let ctx = body;
      if (prop) { const as = new RegExp('this\\.' + prop + '\\s*=(?!=)').exec(pageJs); if (as) ctx += '\n' + stmtOf(pageJs.slice(as.index + as[0].length)); }
      const evs = uniq(Array.from(ctx.matchAll(/['"]([\w-]+)['"]/g)).map((x) => x[1]).filter((n) => listeners[n]));
      const keyLit = (/,\s*['"](\w+)['"]\s*\)\s*;?\s*$/.exec(ctx.trim()) || [])[1] || '';
      lov.key = target || keyLit;
      for (const ev of evs) {
        const names = ((listeners[ev] && listeners[ev].chains) || []).map((c) => c.chain).filter((n) => byName[n]);
        const src = names.map((n) => byName[n])[0];
        if (!src) continue;
        lov.via = names[0];
        const rc = reportCallOf(src, true);
        if (rc.report) Object.assign(lov, { source: 'report' }, rc);
        else {
          const eps = Array.from(src.matchAll(/endpoint\s*:\s*['"]([\w-]+\/\w+)['"]/g)).map((e) => e[1]).filter((e) => !/runBIPReport/i.test(e));
          if (!eps.length) continue;
          lov.source = 'chain'; lov.endpoint = eps[0];
        }
        const from = mapFrom(src);
        lov.keyFrom = from(lov.key); lov.textFrom = from(lov.text); lov.subFrom = from(lov.sub);
        break;
      }
    } else if (dv && (() => { const a = (/variables\.(\w+)/.exec(String(def.data || '')) || [])[1]; const d = a && vars[a] && vars[a].defaultValue; return Array.isArray(d) && d.length; })()) {
      // the provider reads an array whose values are written in the page ("{{ $page.variables.requestTypeArray }}")
      const a = (/variables\.(\w+)/.exec(String(def.data || '')) || [])[1];
      lov.source = 'static';
      lov.values = vars[a].defaultValue.slice(0, 50).filter(isObjS).map((r) => ({ key: String(r[lov.key || 'value'] == null ? '' : r[lov.key || 'value']), text: String(r[lov.text || 'label'] == null ? '' : r[lov.text || 'label']) }));
    } else if (dv) {
      // the array the provider reads ("{{ $page.variables.customerRefsArray }}"), filled in a chain from a call's answer
      const arr = (/variables\.(\w+)/.exec(String(def.data || '')) || [])[1];
      const names = uniq([arr, dv]).filter(Boolean).join('|');
      for (const c of chainSrcs) {
        const src = c.src;
        const as = new RegExp('variables\\.(?:' + names + ')(?:\\.data)?\\s*=(?!=)').exec(src);
        if (!as) continue;
        const expr = stmtOf(src.slice(as.index + as[0].length));
        // the answers' names: const res = await Actions.callRest(…endpoint…); const [a, b] = await Promise.all([callRest(…), callRest(…)])
        const named = {};
        for (const x of src.matchAll(/(?:const|let|var)\s+(\w+)\s*=\s*await\s+Actions\.callRest\(\s*context\s*,/g)) { const ep = (/endpoint\s*:\s*['"]([\w-]+\/\w+)['"]/.exec(objectAt(src, x.index)) || [])[1]; if (ep) named[x[1]] = ep; }
        for (const x of src.matchAll(/(?:const|let|var)\s*\[([^\]]+)\]\s*=\s*await\s+Promise\.all\(\s*\[([\s\S]*?)\]\s*\)/g)) {
          const ns = x[1].split(',').map((s) => s.trim());
          const eps = Array.from(x[2].matchAll(/endpoint\s*:\s*['"]([\w-]+\/\w+)['"]/g)).map((e) => e[1]);
          ns.forEach((n, i) => { if (/^\w+$/.test(n) && eps[i]) named[n] = eps[i]; });
        }
        // followed back through the chain's own names (options ← headers ← headersResp), nearest first
        const decl = {};
        for (const x of src.slice(0, as.index).matchAll(/(?:const|let|var)\s+(\w+)\s*=\s*/g)) decl[x[1]] = stmtOf(src.slice(x.index + x[0].length));
        const idsIn = (t) => uniq(Array.from(t.matchAll(/\b([A-Za-z_]\w*)\b/g)).map((x) => x[1]));
        let used = '', texts = [expr], frontier = [expr];
        const seen = {};
        for (let hop = 0; hop < 4 && !used; hop++) {
          const next = [];
          for (const t of frontier) {
            const hit = idsIn(t).filter((n) => named[n])[0];
            if (hit) { used = hit; break; }
            idsIn(t).forEach((n) => { if (decl[n] && !seen[n]) { seen[n] = 1; next.push(decl[n]); } });
          }
          texts = texts.concat(next);
          frontier = next;
        }
        const all = texts.join('\n');
        const calls = Array.from(src.matchAll(/endpoint\s*:\s*['"]([\w-]+\/\w+)['"]/g)).map((e) => e[1]);
        const ep = used ? named[used] : (uniq(calls).length === 1 ? calls[0] : '');
        const rp = (/\b([A-Z][A-Z0-9_]*_RP)\b/.exec(expr) || [])[1] || (/decodeReportRows|parseXmlRows/.test(expr) ? (Array.from(src.slice(0, as.index).matchAll(/\/([A-Za-z0-9_]+)\.xdo/g)).map((e) => e[1]).pop() || '') : '');
        // a report's rows (decoded where the list is filled, or a name or two back): the report the chain runs
        const rc = (rp && (/decodeReportRows|parseXmlRows/.test(expr) || !ep)) || /runBIPReport/i.test(ep) || /decodeReportRows|parseXmlRows/.test(all) ? reportCallOf(src, false) : { report: '' };
        if (rc.report) { Object.assign(lov, { source: 'report', endpoint: '' }, rc); } else if (rp && !ep) { lov.source = 'report'; lov.report = rp; } else if (ep) { lov.source = 'chain'; lov.endpoint = ep; }
        else continue;
        const cols = rc.cols || [];
        lov.via = c.name;
        if (used) { const ip = new RegExp('\\b' + used + '\\.body\\.(\\w+)').exec(all) || new RegExp('\\b' + used + '\\.body\\.(\\w+)').exec(src); lov.itemsPath = ip ? ip[1] : ''; }
        // a list mapped from the answer ({ id: Number(c.id), customerName: c.customerName || … }): the answer's own fields
        const from = mapFrom(all);
        lov.keyFrom = from(lov.key); lov.textFrom = from(lov.text); lov.subFrom = from(lov.sub);
        // rows a helper made from the report's columns (id, label, label2): the columns themselves
        if (!lov.keyFrom && cols[0] && /^(id|value|key)$/i.test(lov.key || 'id')) lov.keyFrom = cols[0];
        if (!lov.textFrom && cols[1] && /^(label|text|name)$/i.test(lov.text || 'label')) lov.textFrom = cols[1];
        if (!lov.subFrom && cols[2] && (!lov.sub || /^label2$/i.test(lov.sub))) lov.subFrom = cols[2];
        delete lov.cols;
        break;
      }
    }
    // a list written in the code: the value its page value starts with, if the page gives one
    if (lov.source === 'static' && target && vars[target] && vars[target].defaultValue !== undefined && vars[target].defaultValue !== null) lov.start = String(vars[target].defaultValue);
    // the same dropdown twice (shown in one case or another) once
    if (!out.some((x) => x.field === lov.field && x.target === lov.target && x.endpoint === lov.endpoint && x.source === lov.source && x.report === lov.report)) out.push(lov);
  }
  return out.slice(0, 40);
}

function analyze(root, id) {
  const p = pagesOf(root).filter((x) => x.id === id)[0];
  if (!p) return null;
  const appDir = path.join(root, 'webApps', p.app);
  const htmlSrc = read(p.html), jsSrc = read(p.js), jsonSrc = read(p.json);
  let json = {};
  try { json = JSON.parse(jsonSrc); } catch (e) { json = {}; }
  const chainFiles = isDir(p.chainsDir) ? fs.readdirSync(p.chainsDir).filter((f) => /\.js$/.test(f)).sort() : [];
  const files = [p.json, p.html, p.js].filter(exists).concat(chainFiles.map((f) => path.join(p.chainsDir, f)));
  const hash = crypto.createHash('sha1');
  files.forEach((f) => hash.update(rel(root, f) + '\n' + read(f)));
  const ops = serviceOps(root);

  // ── features ──
  const sections = uniq(Array.from(htmlSrc.matchAll(/(?:page-title|header-text|drawer-title|dialog-title)="([^"[]+)"/g)).map((m) => clean(m[1]))
    .concat(Array.from(htmlSrc.matchAll(/<h([1-3])\b[^>]*>([\s\S]*?)<\/h\1>/gi)).map((m) => clean(m[2])))
    .filter((t) => t && t.length <= 90)).slice(0, 40);
  // table and grid columns: Redwood tables declare them in the page JSON (headerText), the hand-made grids in HTML
  const columns = uniq(Array.from((jsonSrc + htmlSrc.replace(/&quot;/g, '"')).matchAll(/["']?headerText["']?\s*:\s*["']([^"']{1,60})["']/g)).map((m) => m[1])
    .concat(Array.from(htmlSrc.matchAll(/role="columnheader"[^>]*>([\s\S]*?)<\/span>/g)).map((m) => clean(m[1]))).filter(Boolean)).slice(0, 60);
  const listeners = json.eventListeners || {};
  const chainsOf = (name) => ((listeners[name] && listeners[name].chains) || []).map((c) => c.chain).filter(Boolean);
  const actions = [];
  Array.from(htmlSrc.matchAll(/<(button|oj-button|a|oj-c-button)\b([^>]*)>([\s\S]*?)<\/\1>/gi)).forEach((m) => {
    const attrs = m[2];
    const lis = (/on-(?:click|oj-action|ojAction)="\[\[\s*\$listeners\.(\w+)\s*\]\]"/.exec(attrs) || [])[1];
    if (!lis) return;
    // the text shown, else the words inside its binding ('✨ Re-run analysis'), else its title, else its id
    const lits = Array.from(String(m[3]).matchAll(/'([^'\]]{2,60})'/g)).map((x) => x[1].trim()).filter((x) => /[A-Za-z]/.test(x) && !/^[.#]|\$|===/.test(x));
    const label = clean(m[3]) || lits.sort((a, b) => b.length - a.length)[0] || clean((/(?:title|aria-label|label)="([^"[]+)"/.exec(attrs) || [])[1])
      || humanize(((/\bid="([^"[]+)"/.exec(attrs) || [])[1] || lis).replace(/^on/, ''));
    if (!actions.some((a) => a.label === label && a.listener === lis)) actions.push({ label: label.slice(0, 80), listener: lis, chains: chainsOf(lis) });
  });
  // everything else that reacts: a component's event (a row picked, a tab changed, a filter set) and its chains
  Array.from(htmlSrc.matchAll(/<([a-z][a-z0-9-]*)\b([^>]*?)>/g)).forEach((m) => {
    const tag = m[1], attrs = m[2];
    if (/^(button|oj-button|a|oj-c-button)$/.test(tag)) return;
    Array.from(attrs.matchAll(/on-([a-z-]+)="\[\[\s*\$listeners\.(\w+)\s*\]\]"/g)).forEach((e) => {
      const what = clean((/(?:aria-label|label|title)="([^"[]+)"/.exec(attrs) || [])[1]);
      const label = (what ? what + ': ' : (tag.indexOf('oj-') === 0 ? tag + ': ' : '')) + e[1].replace(/-/g, ' ');
      if (!actions.some((a) => a.listener === e[2])) actions.push({ label: label.slice(0, 80), listener: e[2], chains: chainsOf(e[2]) });
    });
  });
  const LIFE = { vbBeforeEnter: 'before the page opens', vbEnter: 'when the page opens', vbExit: 'when it is left', vbAfterNavigate: 'after it navigates', vbNotification: 'on a notification' };
  const lifecycle = Object.keys(listeners).filter((l) => LIFE[l]).map((l) => ({ when: LIFE[l], chains: chainsOf(l) }));
  const fields = [];
  Array.from(htmlSrc.matchAll(/<label\b[^>]*>([\s\S]*?)<\/label>/gi)).forEach((m) => { const t = clean(m[1]); if (t && t.length <= 60 && fields.indexOf(t) === -1) fields.push(t); });
  Array.from(htmlSrc.matchAll(/label-hint="([^"[]+)"/g)).forEach((m) => { const t = clean(m[1]); if (t && fields.indexOf(t) === -1) fields.push(t); });
  Array.from(htmlSrc.matchAll(/placeholder="([^"[]+)"/g)).forEach((m) => { const t = clean(m[1]); if (t && t.length <= 60 && fields.indexOf(t) === -1 && !/^filter$/i.test(t)) fields.push(t); });
  const components = uniq(Object.keys((json.imports && json.imports.components) || {}).concat(Array.from(htmlSrc.matchAll(/<(oj-[a-z0-9-]+)/g)).map((m) => m[1])))
    .filter((c) => !/^oj-bind-/.test(c)).sort();
  const vars = json.variables || {};
  const inputs = Object.keys(vars).filter((k) => vars[k] && vars[k].input).map((k) => ({ name: k, about: vars[k].description || '' }));

  // ── logic ──
  const pageCode = scanCode(jsSrc);
  const chains = chainFiles.map((f) => {
    const src = read(path.join(p.chainsDir, f));
    const code = scanCode(src);
    // the comment inside the define (after 'use strict'), or above the class
    const inner = src.replace(/^[\s\S]*?'use strict';/, '');
    const usedBy = Object.keys(listeners).filter((l) => chainsOf(l).indexOf(f.replace(/\.js$/, '')) !== -1);
    return { name: f.replace(/\.js$/, ''), file: rel(root, path.join(p.chainsDir, f)), about: headerComment(inner, 600) || headerComment(src, 600),
      calls: code.endpoints, reports: code.reports, local: code.local, opens: code.opens, modules: code.modules, on: usedBy, lines: src.split('\n').length };
  });
  // the modules the page and its chains use, and the ones those use (two levels): their services count too
  let moduleIds = uniq(pageCode.modules.concat(...chains.map((c) => c.modules)));
  for (let depth = 0; depth < 2; depth++) {
    const more = [];
    moduleIds.forEach((m) => scanCode(read(path.join(appDir, m + '.js'))).modules.forEach((x) => { if (moduleIds.indexOf(x) === -1 && more.indexOf(x) === -1) more.push(x); }));
    if (!more.length) break;
    moduleIds = moduleIds.concat(more);
  }
  const modules = moduleIds.map((m) => {
    const f = path.join(appDir, m + '.js');
    const src = read(f);
    const code = scanCode(src);
    return { name: m.replace(/^resources\/js\//, ''), file: exists(f) ? rel(root, f) : '', about: headerComment(src, 500), local: code.local, calls: code.endpoints, reports: code.reports, lines: src ? src.split('\n').length : 0 };
  });

  // ── integrations ──
  // a ServiceDataProvider in the page JSON (a table's or a dropdown's data) calls its endpoint itself
  const sdp = uniq(Object.keys(vars).map((k) => vars[k]).filter((v) => v && /ServiceDataProvider/.test(String(v.type || '')) && v.defaultValue && typeof v.defaultValue.endpoint === 'string')
    .map((v) => v.defaultValue.endpoint).filter((e) => /^[\w-]+\/\w+$/.test(e)));
  const endpoints = uniq(pageCode.endpoints.concat(...chains.map((c) => c.calls), ...modules.map((m) => m.calls), sdp));
  const rest = endpoints.map((e) => {
    const o = ops[e] || {};
    const usedBy = chains.filter((c) => c.calls.indexOf(e) !== -1).map((c) => c.name).concat(modules.filter((m) => m.calls.indexOf(e) !== -1).map((m) => m.name))
      .concat(sdp.indexOf(e) !== -1 ? ['the page\'s data (ServiceDataProvider)'] : []);
    return { endpoint: e, service: e.split('/')[0], operation: e.split('/')[1], method: o.method || '', path: o.path || '', summary: o.summary || '',
      backend: o.backend || '', backendLabel: o.backendLabel || (o.backend ? o.backend : 'not in services/ (check the name)'), usedBy: uniq(usedBy) };
  });
  const reports = uniq(pageCode.reports.concat(...chains.map((c) => c.reports), ...modules.map((m) => m.reports))).sort();
  const local = uniq(pageCode.local.concat(...chains.map((c) => c.local), ...modules.map((m) => m.local))).map((l) => ({ route: '/' + l + '/', what: LOCAL[l] || l }));
  const backends = uniq(rest.map((r) => r.backendLabel).concat(reports.length ? ['Oracle BI Publisher (SOAP)'] : []));
  // the values the page sends with each call, and its lists of values (the dropdowns and the calls that fill them)
  const chainSrcs = chainFiles.map((f) => ({ name: f.replace(/\.js$/, ''), src: stripComments(read(path.join(p.chainsDir, f))) })).concat([{ name: 'page module', src: stripComments(jsSrc) }]);
  const sent = callParamsOf(chainSrcs.map((c) => c.src));
  rest.forEach((r) => { if (sent[r.endpoint]) r.params = sent[r.endpoint]; });
  const lovs = lovsOf(htmlSrc, json, chainSrcs);
  // a choice the page makes on itself (Customer Type): the value its opening chains set (SeedCustomerTypeChain: 'INTERNAL')
  const opening = new Set([].concat(...lifecycle.map((l) => l.chains || [])));
  lovs.filter((l) => l.source === 'static' && (l.values || []).length && !l.start).forEach((l) => {
    // a value the chain sets (= 'X', ? … : 'X', || 'X', key: 'X'), not one it compares with (=== 'X'); a chain that
    // restores a saved draft (Hydrate, Resume, Restore) is not how the page starts fresh
    for (const c of chainSrcs) {
      if (!opening.has(c.name) || /hydrate|resume|restore|reload/i.test(c.name)) continue;
      const hit = l.values.map((x) => x.key).filter((k) => k && new RegExp('(?:[^=!<>]=|[:?]|\\|\\|)\\s*[\'"`]' + k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[\'"`]').test(c.src))[0];
      if (hit) { l.start = hit; l.startFrom = c.name; break; }
    }
  });

  const L = links(root); // the app's navigation, once for this page
  return {
    id: p.id, app: p.app, appName: p.appName, flow: p.flow, page: p.page,
    label: labelOf(root, p, htmlSrc, json), description: String(json.description || ''), route: routeOf(root, p),
    files: files.map((f) => ({ path: rel(root, f), lines: read(f).split('\n').length })), codeHash: hash.digest('hex').slice(0, 16),
    features: { sections: sections, actions: actions.slice(0, 80), fields: fields.slice(0, 80), columns: columns, components: components, inputs: inputs, lifecycle: lifecycle },
    logic: { chains: chains, modules: modules, variables: Object.keys(vars).length },
    integrations: { rest: rest, reports: reports, local: local, backends: backends, lovs: lovs },
    links: uniq(pageCode.opens.concat(...chains.map((c) => c.opens))),
    next: (() => { const byId = {}; pagesOf(root).forEach((x) => { byId[x.id] = x; });
      return L.edges.filter((e) => e.from === p.id).map((e) => ({ id: e.to, label: byId[e.to] ? labelOf(root, byId[e.to], read(byId[e.to].html), (() => { try { return JSON.parse(read(byId[e.to].json)); } catch (x) { return {}; } })()) : e.to, via: e.via })); })(),
    unresolvedLinks: L.unresolved[p.id] || [],
  };
}

module.exports = { stripComments, list, analyze, links, appFlows, pagesOf, headerComment, scanCode, serviceOps, APPS, BACKENDS };
