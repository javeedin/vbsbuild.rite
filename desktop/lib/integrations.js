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
  pages.forEach((p) => {
    const f = scan.analyze(root, p.id);
    if (!f) return;
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
      if (sys.id === 'unknown' || (!backend && !sv.url)) unresolved.push({ page: f.id, endpoint: r.endpoint });
    });
    // a BI Publisher report the page runs that no call above names (a report through a module of its own)
    (I.reports || []).filter((x) => !covered[x]).forEach((rep) => {
      const bipBackend = Object.keys(backends).filter((b) => /bip/i.test(b))[0] || 'bipService';
      const sys = sysOf(bipBackend, 'bipService', 'Oracle BI Publisher (SOAP)');
      sys.kind = 'bip'; sys.kindLabel = 'Oracle BI Publisher';
      rows.push(Object.assign({}, src, { via: [], trigger: '', system: sys.id, systemName: sys.name, kind: 'bip', kindLabel: sys.kindLabel, service: 'bipService', operation: 'runReport', endpoint: 'report ' + rep,
        method: 'SOAP', path: rep, summary: 'BI Publisher report ' + rep, url: sys.url, direction: 'Report', pattern: patternOf('bip'), params: [], report: rep }));
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
  const withCalls = Array.from(new Set(rows.map((r) => r.page))).length;
  return {
    ok: true, app: app, appName: scan.APPS[app] || app, at: new Date().toISOString(), root: root, apps: apps.map((a) => ({ app: a, pages: count[a] })),
    totals: { pages: pages.length, pagesWith: withCalls, systems: sysList.length, endpoints: endpoints.length, calls: rows.length,
      reads: rows.filter((r) => r.direction === 'Read').length, writes: rows.filter((r) => r.direction === 'Write').length, reports: rows.filter((r) => r.direction === 'Report').length, unresolved: unresolved.length },
    systems: sysList, rows: rows, endpoints: endpoints, flows: flowList, matrix: matrix, unresolved: unresolved,
    pages: pages.map((p) => ({ id: p.id, label: p.label || p.page, flow: p.flow || '(app shell)', calls: rows.filter((r) => r.page === p.id).length }))
  };
}

module.exports = { scan: scanApp, kindOf, backendsOf, servicesOf };
