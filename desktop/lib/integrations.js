'use strict';
/**
 * Integrations (Application → Integrations): every system your workspace's app talks to and every call it makes, read
 * from its code — the integration data sheet (source → target) and the facts its diagrams are drawn from.
 *
 *   scan(root, { app }) → { ok, app, appName, at, totals, systems, rows, endpoints, flows, matrix, pages, unresolved }
 *     systems    each backend the app's services go to (services/catalog.json + each service's openapi3.json): its
 *                name, kind (Oracle Fusion Cloud, Oracle Integration Cloud, BI Publisher, Oracle APEX / ORDS, Jira, a REST
 *                service), base URL and host, how it signs in, whether calls go through the VB proxy; its services,
 *                endpoints, calls (reads / writes / reports) and the pages that call it
 *     rows       one per page × endpoint (and per BI Publisher report): INT-0001…, the source (app, flow, page, the
 *                chains that call it, what sets it off — the page opening, a button, the page's data), the target
 *                (system, service, operation, method, path, URL, what it does), its direction (Read / Write / Report),
 *                its pattern (REST, SOAP), the values the page sends
 *     endpoints  each endpoint once, with the pages that call it
 *     flows      the app's flows (the source side); matrix: flow × system → calls (reads, writes, reports)
 *     unresolved the calls whose endpoint is not in services/ (a wrong name, or a service not checked in)
 *   Between systems, not page by page:
 *     interfaces   one per target system × business object (IF-001…): what the app reads from it, sends to it or runs
 *                  as a report, which way the data goes (in / out / both), its methods, endpoints, calls, pages, the
 *                  app's areas, and what sets it off (user actions, pages opening)
 *     systemFlows  per system: the objects it returns to the app, the objects the app sends it, its reports
 *     journeys     cross-system flows (SF-01…): one action (a chain) that calls two or more systems, in the order its
 *                  code calls them — e.g. reads customers from one system, then runs a report in another — each step
 *                  with its objects, and the actions (page, chain, what sets it off) that do it
 *     handoffs     system → system: two systems one action calls one after the other (the app usually passes what the
 *                  first returned on to the second)
 *   Each row also carries its business object (`object`), e.g. GET …/salesOrdersForOrderHub/{id}/child/lines →
 *   "Sales orders for order hub › lines", a BI Publisher report → "Customers report (CUSTOMERS_RP)"; a path ending in
 *   something done to the object (…/returns/plan, …/{id}/action/submit) → the object, the action kept in `action`.
 * Pure reading: nothing is written.
 */
const fs = require('fs');
const path = require('path');
const scan = require('./pageScan');

const str = (v) => (v === undefined || v === null ? '' : String(v));
const read = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch (e) { return ''; } };
const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch (e) { return false; } };
const json = (p) => { try { return JSON.parse(read(p)); } catch (e) { return null; } };
const hostOf = (u) => { const m = /^[a-z]+:\/\/([^/:?#]+)/i.exec(str(u)); return m ? m[1] : ''; };

// a system's kind, from its name and its address (Oracle's own products by their URL paths)
const KINDS = [
  ['fusion', 'Oracle Fusion Cloud', /fusion|fscmRestApi|hcmRestApi|crmRestApi|fa-[a-z0-9]+\.oraclecloud/i],
  ['oic', 'Oracle Integration Cloud', /\bics\b|\boic\b|integration\.ocp|\/ic\/api|integration cloud/i],
  ['bip', 'Oracle BI Publisher', /bip|xmlpserver|bi publisher/i],
  ['ords', 'Oracle APEX / ORDS', /\bords\b|apex|\/ords\//i],
  ['jira', 'Jira', /jira|atlassian/i],
  ['bo', 'VB Business Objects', /businessObjects|\/rest\/[a-z0-9_]+\/[0-9.]+\/|business object/i]
];
function kindOf(name, url, label) {
  const hay = [name, url, label].map(str).join(' ');
  // BI Publisher before Fusion: its address is the Fusion pod's
  const order = ['bip', 'oic', 'fusion', 'ords', 'jira', 'bo'];
  for (const k of order) { const d = KINDS.filter((x) => x[0] === k)[0]; if (d[2].test(hay)) return { kind: d[0], kindLabel: d[1] }; }
  return { kind: 'rest', kindLabel: 'REST service' };
}

/** The app's backends (services/catalog.json): { name: { url, description, auth, proxy } }. */
function backendsOf(root) {
  const cat = json(path.join(root, 'services', 'catalog.json')) || {};
  const out = {};
  Object.keys(cat.backends || {}).forEach((name) => {
    const b = cat.backends[name] || {};
    const srv = (b.servers || [])[0] || {};
    const x = srv['x-vb'] || {};
    const au = x.authentication || {};
    const authd = au.authenticated && au.authenticated.type ? au.authenticated.type : '';
    const anon = au.anonymous && au.anonymous.type ? au.anonymous.type : '';
    const AUTH = { basic: 'Basic (user and password)', oauth2: 'OAuth 2.0', oauth: 'OAuth', propagate: 'The signed-in user (propagated)', as_authenticated_user: 'as the signed-in user', none: 'None', apiKey: 'API key', jwt: 'JWT' };
    out[name] = { url: str(srv.url), description: str(b.description || srv.description), auth: authd ? (AUTH[authd] || authd) + (anon ? '; anonymous: ' + (AUTH[anon] || anon) : '') : (x.anonymousAccess ? 'Anonymous' : ''),
      proxy: x.forceProxy ? 'Through the VB proxy (' + x.forceProxy + ')' : '' };
  });
  return out;
}
/** Each service: { svc: { backend, url } } (its openapi3.json servers). */
function servicesOf(root) {
  const dir = path.join(root, 'services');
  const out = {};
  (isDir(dir) ? fs.readdirSync(dir) : []).forEach((svc) => {
    const d = json(path.join(dir, svc, 'openapi3.json'));
    if (!d) return;
    const url = str(((d.servers || [])[0] || {}).url);
    out[svc] = { backend: (/backends\/([^/]+)/.exec(url) || [])[1] || '', url: url, title: str(d.info && d.info.title) };
  });
  return out;
}

/** What sets a chain off on the page: its opening, a button, its data — else another chain. */
function triggersOf(facts, used) {
  const out = [];
  const f = facts.features || {};
  const L = facts.logic || {};
  const chainNames = (L.chains || []).map((c) => c.name);
  // a module the call is in: the chains that use it (directly, or through a module that uses it)
  const viaModule = (m) => {
    const id = 'resources/js/' + m;
    const users = (L.modules || []).filter((x) => (x.uses || []).indexOf(id) !== -1).map((x) => 'resources/js/' + x.name);
    return (L.chains || []).filter((c) => (c.modules || []).some((x) => x === id || users.indexOf(x) !== -1)).map((c) => c.name);
  };
  const chains = [];
  const extra = [];
  (used || []).forEach((n) => {
    if (chainNames.indexOf(n) !== -1 || /ServiceDataProvider/.test(n)) { chains.push(n); return; }
    const cs = viaModule(n);
    if (cs.length) cs.forEach((c) => { if (chains.indexOf(c) === -1) chains.push(c); });
    else extra.push('the page\'s code (module ' + n + ')');
  });
  chains.forEach((c) => {
    if (/ServiceDataProvider/.test(c)) { out.push('the page\'s data (a table or list loads it)'); return; }
    (f.lifecycle || []).forEach((l) => { if ((l.chains || []).indexOf(c) !== -1) out.push(l.when); });
    (f.actions || []).forEach((a) => { if ((a.chains || []).indexOf(c) !== -1) out.push('"' + a.label + '" (button)'); });
  });
  const u = out.concat(extra).filter((x, i) => x && out.concat(extra).indexOf(x) === i);
  return u.length ? u : (chains.length ? ['run by ' + chains.join(', ')] : []);
}
// ── Business objects: what a call is about — from its path, its report or its operation ──────────────────────────────
/** salesOrdersForOrderHub → "Sales orders for order hub"; CREATE_ORDER → "Create order"; get-items → "Get items". */
// the business acronyms an UPPER_SNAKE name keeps (CREATE_SO_IN_FUSION → "Create SO in fusion")
const ACRONYMS = /^(SO|PO|AP|AR|GL|OM|BU|LE|ID|UOM|LPN|ASN|SKU|WMS|ERP|HCM|SCM|CRM|API|PDF|OIC|VB|BIP|INV|FA|HR|IR|ISO|EDI|XML|JSON|CSV|RMA|ATP|MRP|QOH|LOV|URL)$/;
function humanize(v) {
  let t = str(v).replace(/\.(xdo|json)$/i, '').trim();
  if (!t) return '';
  if (/^[A-Z0-9_]+$/.test(t)) t = t.split(/_+/).filter(Boolean).map((w) => (ACRONYMS.test(w) ? w : w.toLowerCase())).join(' ');
  else t = t.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2').replace(/[_-]+/g, ' ');
  t = t.trim().split(/\s+/).map((w) => (/^[A-Z]{2,}s?$/.test(w) ? w : w.toLowerCase())).join(' ');
  return t.charAt(0).toUpperCase() + t.slice(1);
}
// folders that say nothing about the object: API words, versions, Oracle's REST roots
const NOISE = /^(resources|rest|api|apis|ords|ic|integration|integrations|flows|soap|services?|latest|describe|xmlpserver|[a-z]+RestApi|v?\d+([._]\d+)*[a-z]?|[A-Za-z]*(WSS|WS)Service|ReportService)$/i;
// the last folder of a path that is something done to the object before it (…/returns/plan, …/lines/batch,
// …/misc-transactions/post, …/equipment-classes/bulk-from-fusion): grouped under that object, the action kept apart
const ACTION = /^(batch|bulk|post|promote|plan|reset|release|refresh|submit|approve|reject|cancel|close|reopen|sync|run|validate|process|apply|copy|clone|lock|unlock|import|export|upload|download|content|access|count|summary|preview|start|stop|retry|complete|send|notify|generate|recalc|recalculate|calculate|assign|unassign|confirm|book|reserve|ship|receive|merge|split|archive|restore|publish|activate|deactivate|enable|disable|execute|trigger|schedule|reprocess|resubmit|acknowledge|mark|create|update|delete|remove)/i;
const reportObject = (x) => ({ key: 'report:' + x.toLowerCase(), label: humanize(x.replace(/_(RP|RPT|REPORT)$/i, '')) + ' report (' + x + ')', op: '' });
/** A row's business objects: [{ key, label, op }] — one, or one per BI Publisher report it runs. */
function objectsOf(r, kind) {
  const reps = kind === 'bip' ? str(r.report).split(/,\s*/).filter(Boolean) : [];
  return reps.length ? reps.map(reportObject) : [objectOf(r, kind)];
}
/** A row's business object: { key, label, op } (op: the action done to it, when the path names one). */
function objectOf(r, kind) {
  if (kind === 'bip') {
    const reps = str(r.report).split(/,\s*/).filter(Boolean);
    if (reps.length === 1) return reportObject(reps[0]);
    if (reps.length) return { key: 'report:' + reps.join(',').toLowerCase(), label: reps.map((x) => reportObject(x).label).join(', '), op: '' };
  }
  const segs = str(r.path).split('?')[0].split('/').filter(Boolean);
  // an OIC integration: …/flows/rest/<INTEGRATION>/<version>/…
  const fl = segs.findIndex((x, i) => /^flows$/i.test(x) && /^(rest|soap)$/i.test(segs[i + 1] || ''));
  if (fl !== -1 && segs[fl + 2]) { const label = humanize(segs[fl + 2]); return { key: 'oic:' + label.toLowerCase(), label: label + ' (integration)', op: '' }; }
  // an action on a record: …/<object>/{id}/action/<name> (Oracle Fusion's custom actions)
  const ai = segs.lastIndexOf('action');
  if (ai > 0 && segs[ai + 1]) {
    const parent = segs.slice(0, ai).filter((x) => !/^[{:]/.test(x) && !NOISE.test(x)).pop();
    if (parent) { const label = humanize(parent); return { key: label.toLowerCase(), label: label, op: humanize(segs[ai + 1]).toLowerCase() }; }
  }
  const words = segs.filter((x) => !/^[{:]/.test(x) && !NOISE.test(x) && !/^(child|action)$/i.test(x));
  // a child collection: <parent>/{id}/child/<child>
  const ci = segs.lastIndexOf('child');
  if (ci > 0 && segs[ci + 1] && !/^[{:]/.test(segs[ci + 1])) {
    const parent = segs.slice(0, ci).filter((x) => !/^[{:]/.test(x) && !NOISE.test(x)).pop();
    const label = (parent ? humanize(parent) + ' › ' : '') + humanize(segs[ci + 1]).toLowerCase();
    return { key: label.toLowerCase(), label: label.charAt(0).toUpperCase() + label.slice(1), op: '' };
  }
  const last = words[words.length - 1];
  if (last) {
    const isParam = (x) => /^[{:]/.test(str(x));
    let at = segs.lastIndexOf(last);
    let op = '';
    // the last folder is an action on the object before it — right before it, or with a record's {id} between
    // only {ids} and API folders (versions…) between two folders
    const between = (a, b) => segs.slice(a + 1, b).every((x) => isParam(x) || NOISE.test(x));
    const prev = words[words.length - 2];
    if (prev && ACTION.test(last)) { const pi = segs.lastIndexOf(prev, at - 1); if (pi >= 0 && between(pi, at)) { op = last; at = pi; } }
    // a record's own collection: <parent>/{id}/<collection> → "Parent › collection"
    let label = humanize(segs[at]);
    let j = at - 1;
    while (j >= 0 && (isParam(segs[j]) || NOISE.test(segs[j]))) j--;
    if (j >= 0 && segs.slice(j + 1, at).some(isParam)) label = humanize(segs[j]) + ' › ' + label.toLowerCase();
    return { key: label.toLowerCase(), label: label, op: op ? humanize(op).toLowerCase() : '' };
  }
  // no path to go by: the operation without its verb
  const op = str(r.operation).replace(/^(getall|get|post|create|update|patch|put|delete|remove|list|fetch|run|find|search|load|save)[_]?/i, '');
  const label = humanize(op || r.operation || r.endpoint || 'Call');
  return { key: label.toLowerCase(), label: label, op: '' };
}
const DIR_ORDER = ['Read', 'Write', 'Report'];
/** The directions of an interface in words, and which way its data goes: in (to the app), out (from it), both. */
function dirsOf(list) {
  const d = DIR_ORDER.filter((x) => list.indexOf(x) !== -1);
  const words = d.map((x, i) => (i ? x.toLowerCase() : x));
  return { direction: words.length > 1 ? words.slice(0, -1).join(', ') + ' & ' + words[words.length - 1] : (words[0] || ''), flow: d.indexOf('Write') === -1 ? 'in' : (d.length === 1 ? 'out' : 'both') };
}
/** What sets a row off, in one word: a user action (a button), a page opening (or its data loading), else other. */
const whenOf = (trigger) => (/\(button\)/.test(trigger) ? 'action' : /open|load|enter|page.s data|before/i.test(trigger) ? 'open' : 'other');

const direction = (method, kind) => (kind === 'bip' ? 'Report' : (/^(GET|HEAD|OPTIONS)$/.test(str(method).toUpperCase()) || !method ? 'Read' : 'Write'));
const patternOf = (kind, method) => (kind === 'bip' ? 'SOAP · BI Publisher report' : kind === 'oic' ? 'REST · OIC integration (synchronous)' : 'REST · synchronous' + (method ? ' (' + method + ')' : ''));

function scanApp(root, opts) {
  const o = opts || {};
  const all = scan.list(root);
  // the apps, the most pages first; the workspace's app: the one asked, else the biggest that is not Build.Rite's own
  const count = {};
  all.forEach((p) => { count[p.app] = (count[p.app] || 0) + 1; });
  const apps = Object.keys(count).sort((a, b) => count[b] - count[a] || a.localeCompare(b));
  const app = (str(o.app) && count[str(o.app)] ? str(o.app) : '') || apps.filter((a) => a !== 'buildrite')[0] || apps[0] || '';
  if (!app) return { ok: false, error: 'No VB app found in ' + root + ' (no webApps/<app>).' };
  const pages = all.filter((p) => p.app === app);
  const backends = backendsOf(root);
  const services = servicesOf(root);
  const systems = {};
  const sysOf = (backend, svc, label) => {
    const id = backend || (svc ? 'svc:' + svc : 'unknown');
    if (systems[id]) return systems[id];
    const b = backends[backend] || {};
    const s = services[svc] || {};
    const url = b.url || (backend ? '' : s.url);
    // its name: Oracle's own by name; else a short description that is not an address; else the backend's name
    const desc = str(b.description).trim();
    const short = desc && desc.length <= 48 && !/^(https?:\/\/|\d{1,3}(\.\d{1,3}){3})/.test(desc) ? desc : '';
    const name = scan.BACKENDS[backend] || short || (label && label !== backend && !/not in services/i.test(label) ? label : '') || backend || (svc ? svc : 'Not in services/');
    const k = id === 'unknown' ? { kind: 'unknown', kindLabel: 'Not resolved' } : kindOf(backend + ' ' + svc, url, name);
    systems[id] = { id: id, name: name, backend: backend, kind: k.kind, kindLabel: k.kindLabel, url: url, host: hostOf(url), auth: b.auth || '', proxy: b.proxy || '', about: desc && desc !== name ? desc.slice(0, 600) : '',
      services: [], endpoints: [], calls: 0, reads: 0, writes: 0, reports: 0, pages: [] };
    return systems[id];
  };
  const rows = [];
  const unresolved = [];
  const chainFlows = [];
  const objs = new Map(); // row → its business objects
  const setObject = (row, kind) => { const ob = objectOf(row, kind); row.object = ob.label; row.objectKey = ob.key; row.action = ob.op || ''; objs.set(row, objectsOf(row, kind)); };
  pages.forEach((p) => {
    const f = scan.analyze(root, p.id);
    if (!f) return;
    const first = rows.length;
    const I = f.integrations || {};
    const src = { app: app, flow: f.flow || '(app shell)', page: f.id, pageLabel: f.label || f.page };
    const covered = {};
    (I.rest || []).forEach((r) => {
      const sv = services[r.service] || {};
      const backend = r.backend || sv.backend || '';
      const sys = sysOf(r.service && !backend && !sv.url ? '' : backend, r.service, r.backendLabel);
      const chains = r.usedBy || [];
      const chainReports = (f.logic && f.logic.chains || []).filter((c) => chains.indexOf(c.name) !== -1).reduce((a, c) => a.concat(c.reports || []), []);
      if (sys.kind === 'bip') chainReports.forEach((x) => { covered[x] = true; });
      const dir = direction(r.method, sys.kind);
      rows.push(Object.assign({}, src, { via: chains, trigger: triggersOf(f, chains).join('; '), system: sys.id, systemName: sys.name, kind: sys.kind, kindLabel: sys.kindLabel,
        service: r.service, operation: r.operation, endpoint: r.endpoint, method: r.method || '', path: r.path || '', summary: r.summary || '', url: (sys.url || '').replace(/\/$/, '') + (r.path || ''),
        direction: dir, pattern: patternOf(sys.kind, r.method), params: r.params ? Object.keys(r.params) : [], report: sys.kind === 'bip' ? chainReports.filter((x, i) => chainReports.indexOf(x) === i).join(', ') : '' }));
      setObject(rows[rows.length - 1], sys.kind);
      if (sys.id === 'unknown' || (!backend && !sv.url)) unresolved.push({ page: f.id, endpoint: r.endpoint });
    });
    // a BI Publisher report the page runs that no call above names (a report through a module of its own)
    (I.reports || []).filter((x) => !covered[x]).forEach((rep) => {
      const bipBackend = Object.keys(backends).filter((b) => /bip/i.test(b))[0] || 'bipService';
      const sys = sysOf(bipBackend, 'bipService', 'Oracle BI Publisher (SOAP)');
      sys.kind = 'bip'; sys.kindLabel = 'Oracle BI Publisher';
      rows.push(Object.assign({}, src, { via: [], trigger: '', system: sys.id, systemName: sys.name, kind: 'bip', kindLabel: sys.kindLabel, service: 'bipService', operation: 'runReport', endpoint: 'report ' + rep,
        method: 'SOAP', path: rep, summary: 'BI Publisher report ' + rep, url: sys.url, direction: 'Report', pattern: patternOf('bip'), params: [], report: rep }));
      setObject(rows[rows.length - 1], 'bip');
    });
    // each chain's calls in the order its code makes them (its own, then its modules'): the systems one action touches
    const mine = rows.slice(first);
    const L = f.logic || {};
    const modCalls = (id) => ((L.modules || []).filter((x) => 'resources/js/' + x.name === id)[0] || {}).calls || [];
    (L.chains || []).forEach((c) => {
      const eps = (c.calls || []).concat(...(c.modules || []).map(modCalls));
      const steps = [];
      eps.forEach((ep) => {
        const r = mine.filter((x) => x.endpoint === ep)[0];
        if (!r) return;
        let st = steps[steps.length - 1];
        if (!st || st.system !== r.system) { st = { system: r.system, objects: [], dirs: [] }; steps.push(st); }
        objs.get(r).forEach((ob) => { if (st.objects.indexOf(ob.label) === -1) st.objects.push(ob.label); });
        if (st.dirs.indexOf(r.direction) === -1) st.dirs.push(r.direction);
      });
      if (new Set(steps.map((x) => x.system)).size < 2) return;
      chainFlows.push({ page: f.id, pageLabel: f.label || f.page, flow: f.flow || '(app shell)', chain: c.name, trigger: triggersOf(f, [c.name]).join('; '), steps: steps });
    });
  });
  // numbered in a stable order: flow, page, system, endpoint
  rows.sort((a, b) => a.flow.localeCompare(b.flow) || a.pageLabel.localeCompare(b.pageLabel) || a.systemName.localeCompare(b.systemName) || a.endpoint.localeCompare(b.endpoint));
  rows.forEach((r, i) => { r.id = 'INT-' + String(i + 1).padStart(4, '0'); });

  // each system's figures; each endpoint once
  const eps = {};
  rows.forEach((r) => {
    const s = systems[r.system];
    s.calls++;
    if (r.direction === 'Read') s.reads++; else if (r.direction === 'Write') s.writes++; else s.reports++;
    if (s.pages.indexOf(r.page) === -1) s.pages.push(r.page);
    if (r.service && s.services.indexOf(r.service) === -1) s.services.push(r.service);
    const k = r.system + '|' + r.endpoint;
    if (!eps[k]) { eps[k] = { endpoint: r.endpoint, system: r.system, systemName: r.systemName, kind: r.kind, service: r.service, operation: r.operation, method: r.method, path: r.path, summary: r.summary, direction: r.direction, url: r.url, pages: [], pageLabels: [], calls: 0 }; s.endpoints.push(r.endpoint); }
    eps[k].calls++;
    if (eps[k].pages.indexOf(r.page) === -1) { eps[k].pages.push(r.page); eps[k].pageLabels.push(r.pageLabel); }
  });
  const endpoints = Object.keys(eps).map((k) => eps[k]).sort((a, b) => a.systemName.localeCompare(b.systemName) || b.pages.length - a.pages.length || a.endpoint.localeCompare(b.endpoint));
  const sysList = Object.keys(systems).map((k) => systems[k]).filter((s) => s.calls).sort((a, b) => b.calls - a.calls || a.name.localeCompare(b.name));
  // the source side: the flows, and flow × system
  const flows = {};
  rows.forEach((r) => { const x = flows[r.flow] || (flows[r.flow] = { flow: r.flow, pages: [], calls: 0 }); x.calls++; if (x.pages.indexOf(r.page) === -1) x.pages.push(r.page); });
  pages.forEach((p) => { const fl = p.flow || '(app shell)'; if (!flows[fl]) flows[fl] = { flow: fl, pages: [], calls: 0 }; });
  const flowList = Object.keys(flows).map((k) => flows[k]).sort((a, b) => b.calls - a.calls || a.flow.localeCompare(b.flow));
  const matrix = [];
  rows.forEach((r) => {
    let m = matrix.filter((x) => x.flow === r.flow && x.system === r.system)[0];
    if (!m) { m = { flow: r.flow, system: r.system, calls: 0, reads: 0, writes: 0, reports: 0 }; matrix.push(m); }
    m.calls++;
    if (r.direction === 'Read') m.reads++; else if (r.direction === 'Write') m.writes++; else m.reports++;
  });
  // ── between systems ──
  const order = sysList.map((x) => x.id);
  const ifs = {};
  rows.forEach((r) => objs.get(r).forEach((ob) => {
    const k = r.system + '|' + ob.key;
    const x = ifs[k] || (ifs[k] = { system: r.system, systemName: r.systemName, kind: r.kind, kindLabel: r.kindLabel, object: ob.label, objectKey: ob.key, dirs: [], methods: [], patterns: [], endpoints: [], ops: [], pages: [], pageLabels: [], flows: [], actions: [], calls: 0, onAction: 0, onOpen: 0, other: 0, _open: [], _act: [], _other: [] });
    x.calls++;
    if (ob.op && x.ops.indexOf(ob.op) === -1) x.ops.push(ob.op);
    [['dirs', r.direction], ['methods', r.method], ['patterns', r.pattern], ['endpoints', r.endpoint], ['flows', r.flow]].forEach((y) => { if (y[1] && x[y[0]].indexOf(y[1]) === -1) x[y[0]].push(y[1]); });
    if (x.pages.indexOf(r.page) === -1) { x.pages.push(r.page); x.pageLabels.push(r.pageLabel); }
    // what sets it off, counted in pages (a page with two such calls counts once)
    const w = whenOf(r.trigger);
    const set = w === 'action' ? x._act : w === 'open' ? x._open : x._other;
    if (set.indexOf(r.page) === -1) set.push(r.page);
    x.onAction = x._act.length; x.onOpen = x._open.length; x.other = x._other.length;
    (str(r.trigger).match(/"([^"]+)" \(button\)/g) || []).forEach((b) => { const lb = b.replace(/ \(button\)$/, '').replace(/"/g, ''); if (x.actions.indexOf(lb) === -1) x.actions.push(lb); });
  }));
  const interfaces = Object.keys(ifs).map((k) => ifs[k]).sort((a, b) => order.indexOf(a.system) - order.indexOf(b.system) || b.calls - a.calls || a.object.localeCompare(b.object));
  interfaces.forEach((x, i) => {
    const d = dirsOf(x.dirs);
    x.id = 'IF-' + String(i + 1).padStart(3, '0');
    x.direction = d.direction; x.dataFlow = d.flow;
    // "Submit" button · when 3 pages open · other code on 1 page
    x.setOffBy = [x.actions.length ? x.actions.slice(0, 3).map((a) => '"' + a + '"').join(', ') + (x.actions.length > 3 ? ' and ' + (x.actions.length - 3) + ' more' : '') + (x.actions.length === 1 ? ' button' : ' buttons') : (x.onAction ? 'a user action' : ''),
      x.onOpen ? 'when ' + (x.onOpen === 1 ? '1 page opens' : x.onOpen + ' pages open') : '', x.other ? 'other code on ' + (x.other === 1 ? '1 page' : x.other + ' pages') : ''].filter(Boolean).join(' · ');
    delete x._open; delete x._act; delete x._other;
  });
  const systemFlows = sysList.map((x) => {
    const mineIf = interfaces.filter((y) => y.system === x.id);
    return { system: x.id, name: x.name, kind: x.kind, kindLabel: x.kindLabel, calls: x.calls, interfaces: mineIf.length,
      returns: mineIf.filter((y) => y.dirs.indexOf('Read') !== -1).map((y) => y.object), sends: mineIf.filter((y) => y.dirs.indexOf('Write') !== -1).map((y) => y.object),
      reports: mineIf.filter((y) => y.dirs.indexOf('Report') !== -1).map((y) => y.object) };
  });
  const nameOf = (id) => (systems[id] || {}).name || id;
  const js = {};
  chainFlows.forEach((c) => {
    const k = c.steps.map((x) => x.system).join('>');
    const j = js[k] || (js[k] = { key: k, steps: c.steps.map((x) => ({ system: x.system, systemName: nameOf(x.system), kind: (systems[x.system] || {}).kind, objects: [], dirs: [] })), actions: [] });
    c.steps.forEach((x, i) => { x.objects.forEach((o) => { if (j.steps[i].objects.indexOf(o) === -1) j.steps[i].objects.push(o); }); x.dirs.forEach((d) => { if (j.steps[i].dirs.indexOf(d) === -1) j.steps[i].dirs.push(d); }); });
    j.actions.push({ page: c.page, pageLabel: c.pageLabel, flow: c.flow, chain: c.chain, trigger: c.trigger });
  });
  const journeys = Object.keys(js).map((k) => js[k]).sort((a, b) => b.actions.length - a.actions.length || b.steps.length - a.steps.length || a.key.localeCompare(b.key));
  journeys.forEach((j, i) => {
    j.id = 'SF-' + String(i + 1).padStart(2, '0');
    j.steps.forEach((x) => { x.direction = dirsOf(x.dirs).direction; });
    j.path = j.steps.map((x) => x.systemName).join(' → ');
    j.pages = j.actions.map((a) => a.page).filter((x, n, a) => a.indexOf(x) === n);
  });
  const hs = {};
  chainFlows.forEach((c) => {
    for (let i = 1; i < c.steps.length; i++) {
      const a = c.steps[i - 1], b = c.steps[i];
      const k = a.system + '>' + b.system;
      const h = hs[k] || (hs[k] = { from: a.system, fromName: nameOf(a.system), fromKind: (systems[a.system] || {}).kind, to: b.system, toName: nameOf(b.system), toKind: (systems[b.system] || {}).kind, fromObjects: [], toObjects: [], actions: 0, pages: [] });
      h.actions++;
      a.objects.forEach((o) => { if (h.fromObjects.indexOf(o) === -1) h.fromObjects.push(o); });
      b.objects.forEach((o) => { if (h.toObjects.indexOf(o) === -1) h.toObjects.push(o); });
      if (h.pages.indexOf(c.pageLabel) === -1) h.pages.push(c.pageLabel);
    }
  });
  const handoffs = Object.keys(hs).map((k) => hs[k]).sort((a, b) => b.actions - a.actions || a.fromName.localeCompare(b.fromName));

  const withCalls = Array.from(new Set(rows.map((r) => r.page))).length;
  return {
    ok: true, app: app, appName: scan.APPS[app] || app, at: new Date().toISOString(), root: root, apps: apps.map((a) => ({ app: a, pages: count[a] })),
    totals: { pages: pages.length, pagesWith: withCalls, systems: sysList.length, endpoints: endpoints.length, calls: rows.length,
      reads: rows.filter((r) => r.direction === 'Read').length, writes: rows.filter((r) => r.direction === 'Write').length, reports: rows.filter((r) => r.direction === 'Report').length, unresolved: unresolved.length,
      interfaces: interfaces.length, journeys: journeys.length, crossActions: chainFlows.length },
    systems: sysList, rows: rows, endpoints: endpoints, flows: flowList, matrix: matrix, unresolved: unresolved,
    interfaces: interfaces, systemFlows: systemFlows, journeys: journeys, handoffs: handoffs,
    pages: pages.map((p) => ({ id: p.id, label: p.label || p.page, flow: p.flow || '(app shell)', calls: rows.filter((r) => r.page === p.id).length }))
  };
}

module.exports = { scan: scanApp, kindOf, backendsOf, servicesOf, objectOf, objectsOf, humanize, dirsOf };
