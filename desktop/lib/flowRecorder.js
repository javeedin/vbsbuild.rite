'use strict';
/**
 * Flow recorder (Process Flows → "Record from the app"): turn the pages a person actually walked through in the real app
 * into an ordered list of process-flow steps. The desktop app opens the working-copy app in a window and collects the
 * URLs it navigates to (and a screenshot of each); this module is the pure brain that maps those URLs back to the app's
 * own pages (the Application pages catalog) and builds the ordered steps. No DOM, no Electron — unit-testable.
 *
 *   matchPage(url, pages)        the catalog page a visited URL belongs to (or null), by its route:
 *                                   route-based app  → /vp/shell/<flow>/<page>  (the path ends with <flow>/<page>)
 *                                   tab-shell app    → /?open=<navId>           (the url's ?open= matches)
 *   buildSteps(nav, pages)       { steps: [{ id, page, name, url, shot }], skipped }  — the distinct pages in order
 *                                   (consecutive repeats collapsed; URLs that match no page are skipped and counted)
 *
 * `pages` are the catalog entries ({ id, app, appName, flow, page, label, route: { url } }); `nav` is the recorder's
 * entries ({ url, shot }) in the order they happened (`shot` an optional data:image/… URL of that page).
 */

const str = (v) => (v === undefined || v === null ? '' : String(v));

/** A URL split into { path, query } with the query as a plain object (only what we need; never throws). */
function parse(u) {
  const s = str(u);
  const hashless = s.replace(/#.*$/, '');
  const qi = hashless.indexOf('?');
  const path = (qi === -1 ? hashless : hashless.slice(0, qi)).replace(/^[a-z]+:\/\/[^/]+/i, '');
  const query = {};
  if (qi !== -1) {
    hashless.slice(qi + 1).split('&').forEach((kv) => {
      if (!kv) return;
      const eq = kv.indexOf('=');
      const k = decodeURIComponent(eq === -1 ? kv : kv.slice(0, eq));
      const v = eq === -1 ? '' : decodeURIComponent(kv.slice(eq + 1).replace(/\+/g, ' '));
      if (!(k in query)) query[k] = v;
    });
  }
  // the VB shell carries the open tab in a #hash fragment sometimes (…/index.html#...open=x); fold it in too
  const hm = /[#?&]open=([^&#]+)/.exec(s);
  if (hm && !query.open) query.open = decodeURIComponent(hm[1]);
  return { path: path.replace(/\/+$/, '') || '/', query };
}

/** The 'flow/page' a route url points at (route-based app), or '' (so tab-shell pages match by ?open instead). */
function routeTail(routeUrl) {
  const m = /\/vp\/shell\/(.+)$/.exec(str(routeUrl).replace(/[?#].*$/, '').replace(/\/+$/, ''));
  return m ? m[1] : '';
}
/** The navId a route url opens (tab-shell app), or ''. */
function routeOpen(routeUrl) {
  const m = /[?&]open=([^&#]+)/.exec(str(routeUrl));
  return m ? decodeURIComponent(m[1]) : '';
}

/** The catalog page a visited URL belongs to, or null. Prefers the most specific (longest) match. */
function matchPage(url, pages) {
  const u = parse(url);
  let best = null;
  let bestLen = -1;
  (pages || []).forEach((p) => {
    if (!p || p.deleted) return;
    const routeUrl = (p.route && p.route.url) || '';
    const open = routeOpen(routeUrl);
    if (open) {
      // tab-shell: the open tab matches
      if (u.query.open && u.query.open === open && open.length > bestLen) { best = p; bestLen = open.length; }
      return;
    }
    // route-based: the path ends with <flow>/<page> (from the route, else the page's own flow/page)
    const tail = routeTail(routeUrl) || ((p.flow ? p.flow + '/' : '') + str(p.page));
    if (!tail || !str(p.page)) return;
    const needle = '/' + tail.replace(/^\/+/, '');
    if ((u.path === needle || u.path.slice(-needle.length) === needle) && needle.length > bestLen) { best = p; bestLen = needle.length; }
  });
  return best;
}

const MAX_CALLS = 40;
const CAP = 20000;
/** Keep a decoded response to a readable preview + a small table: columns and the first rows. */
function trimTable(tb) {
  if (!tb || !tb.columns || !tb.columns.length) return null;
  const columns = tb.columns.slice(0, 24);
  const rows = (tb.rows || []).slice(0, 20).map((r) => (Array.isArray(r) ? r.slice(0, 24).map((x) => str(x).slice(0, 200)) : []));
  return { columns, rows, total: typeof tb.total === 'number' ? tb.total : rows.length, from: str(tb.from).slice(0, 60) };
}
/** Make a captured response readable: JSON pretty-printed (+ a row table), a BI Publisher answer decoded from its
 *  base64 reportBytes into its XML rows (+ a table), XML/HTML tidied, anything else left as text. Returns
 *  { kind: 'json'|'bip'|'xml'|'text'|'', pretty, table }. Reuses the API tester's decoders so it matches Test output. */
function decodeResponse(mime, text) {
  let AT = null; try { AT = require('./apiTest'); } catch (e) { AT = null; }
  const t = str(text);
  const m = str(mime);
  if (!t) return { kind: '', pretty: '', table: null };
  if (AT && /reportBytes>/.test(t)) { // a BI Publisher report: base64 XML inside <…reportBytes>
    let xml = '';
    try { xml = Buffer.from(AT.reportBytesOf(t), 'base64').toString('utf8'); } catch (e) { xml = ''; }
    const x = xml ? AT.xmlRows(xml) : null;
    const table = x ? trimTable(Object.assign(AT.rowsOf(x.rows) || {}, { from: '<' + x.tag + '>' })) : null;
    return { kind: 'bip', pretty: (AT.prettyXml ? AT.prettyXml(xml) : xml).slice(0, CAP), table: table };
  }
  if (/json/i.test(m) || /^\s*[[{]/.test(t)) {
    try { const j = JSON.parse(t); return { kind: 'json', pretty: JSON.stringify(j, null, 2).slice(0, CAP), table: AT ? trimTable(AT.rowsOf(j)) : null }; } catch (e) { /* not JSON after all */ }
  }
  if (/xml|soap|html/i.test(m) || /^\s*</.test(t)) return { kind: 'xml', pretty: (AT && AT.prettyXml ? AT.prettyXml(t) : t).slice(0, CAP), table: null };
  return { kind: 'text', pretty: t.slice(0, CAP), table: null };
}
/** One captured network call, trimmed for storage: method, url, query, request body, status, and the response made
 *  readable (JSON pretty / BIP rows) with a small table when it has rows. */
function trimCall(c) {
  const o = c && typeof c === 'object' ? c : {};
  const url = str(o.url);
  const call = { method: str(o.method || 'GET').toUpperCase(), url, path: parse(url).path, query: str(o.query || (url.indexOf('?') !== -1 ? url.slice(url.indexOf('?') + 1) : '')) };
  if (o.body !== undefined && o.body !== null && str(o.body)) call.body = str(o.body).slice(0, CAP);
  if (o.status !== undefined && o.status !== null && o.status !== '') call.status = Number(o.status) || str(o.status);
  if (o.response !== undefined && o.response !== null && str(o.response)) {
    const d = decodeResponse(o.mime, o.response);
    call.response = d.pretty || str(o.response).slice(0, CAP);
    if (d.kind) call.respKind = d.kind;
    if (d.table) call.table = d.table;
  }
  return call;
}

/** A URL that is not an app screen at all — the sign-in / OAuth round-trip, a blank tab. These are the only screens we
 *  drop; everything else the person walked through is kept, matched to the catalog or not. */
function isNonApp(url) {
  const u = str(url);
  return /^(about:|data:|chrome:|devtools:|blob:)/.test(u) || /\/oauth|\/login\b|\/signin|\/logout|\/sso\/|\.well-known|accounts\.|login\./i.test(u);
}
/** A readable name from a URL when we have nothing better (the last path segment, spaced and capitalised). */
function nameFromUrl(url) {
  const path = parse(url).path.replace(/\/+$/, '');
  const seg = path.split('/').filter(Boolean).pop() || path || 'Screen';
  return seg.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()).slice(0, 80);
}
/** The SCREENS walked through, in order, each a step with its screenshot and the API calls the app made while on it.
 *  A "screen" is a page that was navigated to, or — when the recorder reports it (entry.screen / entry.kind) — a dialog
 *  / wizard step that appeared without the web address changing. EVERY screen the person walked is kept: if it is in the
 *  Application pages catalog it takes that page's name (and its APIs resolve), otherwise it is still a step named from
 *  its title or URL. Only the sign-in / OAuth round-trip is dropped. Consecutive repeats of the same screen collapse,
 *  except a manual capture (pressing "Capture this screen" is always its own step). */
function buildSteps(nav, pages, calls) {
  const steps = [];
  const byStep = {}; // step.id → [trimmed call]
  let skipped = 0;
  let n = 0;
  const pathOf = (u) => parse(u).path;
  (nav || []).forEach((entry) => {
    const e = entry && typeof entry === 'object' ? entry : { url: entry };
    const p = matchPage(e.url, pages);
    if (!p && isNonApp(e.url)) { skipped += 1; return; }   // only the sign-in / blank screens are dropped
    const base = p ? p.id : ('url:' + pathOf(e.url));        // unmatched pages are still distinct steps, by their URL
    const screenId = str(e.screen).trim();
    const kind = str(e.kind).trim() === 'dialog' || screenId.indexOf('dialog:') === 0 ? 'dialog' : 'page';
    const key = base + (screenId ? '::' + screenId : '');   // a page can show more than one screen (a dialog, a wizard step)
    const title = str(e.title).trim();
    const last = steps[steps.length - 1];
    // Collapse consecutive repeats of the same screen — but NOT a manual capture: pressing "Capture this screen" is a
    // deliberate step, so each press is its own step even when the screen looks the same as the one before it.
    if (last && last.key === key && !e.manual && !last.manual) {
      if (e.shot && /^data:image\//.test(str(e.shot))) last.shot = { src: 'page', data: str(e.shot) };
      return;
    }
    const step = { id: 'p' + (++n), key: key, manual: !!e.manual, page: p ? p.id : '', name: title || (p && (p.label || p.page || p.id)) || nameFromUrl(e.url), url: str(e.url), kind: kind };
    if (title) step.title = title;
    if (e.shot && /^data:image\//.test(str(e.shot))) step.shot = { src: 'page', data: str(e.shot) };
    steps.push(step);
  });
  // assign each captured call to the step it fired on: the latest step on the same catalog page, else on the same URL path
  (calls || []).forEach((c) => {
    const cu = str(c && c.pageUrl);
    const p = matchPage(cu, pages);
    const cp = pathOf(cu);
    let target = null;
    for (let i = steps.length - 1; i >= 0; i--) { const s = steps[i]; if ((p && s.page === p.id) || pathOf(s.url) === cp) { target = s; break; } }
    if (!target) return;
    (byStep[target.id] = byStep[target.id] || []).push(trimCall(c));
  });
  steps.forEach((s) => { const list = byStep[s.id]; if (list && list.length) s.calls = list.slice(0, MAX_CALLS); delete s.key; delete s.manual; });
  return { steps, skipped };
}

/** The catalog API's path pattern (/a/b/{id}) → a tester: does a captured call's URL path belong to this API? */
function pathMatches(apiPath, urlPath) {
  const pat = str(apiPath).replace(/[?#].*$/, '').replace(/\/+$/, '');
  const got = str(urlPath).replace(/[?#].*$/, '').replace(/\/+$/, '');
  if (!pat) return false;
  if (got === pat || got.slice(-pat.length) === pat) return true;
  const rx = new RegExp(pat.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\{[^/}]+\\\}/g, '[^/]+') + '$');
  return rx.test(got);
}
/** The captured call that belongs to a catalog API (same method, and the path matches its pattern), or null. */
function callForApi(api, calls) {
  if (!api || !calls || !calls.length) return null;
  const method = str(api.method || 'GET').toUpperCase();
  const apiPath = str(api.path || '');
  if (!apiPath) return null;
  const hits = calls.filter((c) => str(c.method || 'GET').toUpperCase() === method && pathMatches(apiPath, c.path || parse(c.url || '').path));
  // prefer the one whose path is the closest length (most specific), else the first
  hits.sort((a, b) => Math.abs(str(a.path).length - apiPath.length) - Math.abs(str(b.path).length - apiPath.length));
  return hits[0] || null;
}

// ── Turn a recorded walkthrough into an API-scenario (desktop/lib/apiScenarios.js) ─────────────────────────────────────
/** Decode a URL-encoded value ("a%20b", "a+b" → "a b"); kept readable when it is not encoded. */
function dec(s) { try { return decodeURIComponent(str(s).replace(/\+/g, ' ')); } catch (e) { return str(s); } }
/** A query string ("?a=1&b=2" or "a=1&b=2") as { a: '1', b: '2' } (values decoded, last of a repeat wins). */
function queryParams(q) {
  const out = {};
  str(q).replace(/^\?/, '').split('&').forEach((p) => {
    if (!p) return;
    const i = p.indexOf('=');
    const k = dec(i === -1 ? p : p.slice(0, i)).trim();
    if (k) out[k] = i === -1 ? '' : dec(p.slice(i + 1));
  });
  return out;
}
/** The path parameters of a catalog pattern filled from a concrete path: /a/b/{id} ↔ /a/b/42 → { id: '42' } (aligned
 *  from the end, so a longer concrete prefix does not throw the mapping off). */
function pathParamsOf(apiPath, urlPath) {
  const a = str(apiPath).replace(/[?#].*$/, '').replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);
  const u = str(urlPath).replace(/[?#].*$/, '').replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);
  const off = Math.max(0, u.length - a.length);
  const out = {};
  a.forEach((seg, idx) => { const m = /^\{(.+)\}$/.exec(seg); if (m) out[m[1]] = dec(u[off + idx] || ''); });
  return out;
}
/** Is a captured call a BI Publisher report run (its SOAP transport), by its url, decoded kind, or run-report body? */
function isReportCall(c) {
  if (!c) return false;
  if (c.respKind === 'bip') return true;
  const u = str(c.url);
  if (/\/xmlpserver\//i.test(u) || /runBIPReport/i.test(u) || /runReport/i.test(str(c.path))) return true;
  return /<\w*:?(?:reportAbsolutePath|runReport)\b/i.test(str(c.body));
}
/** The report path named in a run-report SOAP body, e.g. /Custom/Reports/Thing.xdo (its parameters are not parsed). */
function reportPathOf(body) {
  const m = /<(?:\w+:)?reportAbsolutePath>\s*([^<]+?)\s*<\/(?:\w+:)?reportAbsolutePath>/i.exec(str(body));
  return m ? m[1].trim() : '';
}
/** Two report paths that name the same report (whole path, else the .xdo file name). */
function reportPathsEqual(a, b) {
  const x = str(a); const y = str(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const base = (s) => s.replace(/[?#].*$/, '').split('/').filter(Boolean).pop();
  return base(x) === base(y);
}
/** What a scenario step expects, from the captured answer: the status it returned (exact, so a create's 201 is kept),
 *  and, when its answer had rows, at least one row — so a run passing means the call still returns what it did. */
function expectFromCall(c) {
  const ex = { status: '2xx' };
  if (c && c.status !== undefined && c.status !== null && c.status !== '') {
    const n = Number(c.status);
    ex.status = (n >= 100 && n < 600) ? String(n) : str(c.status);
  }
  if (c && c.table && typeof c.table.total === 'number' && c.table.total > 0) ex.minRows = 1;
  return ex;
}
/** A short step name from the call: "POST requests" / "GET requests/42", or "Report — Name". */
function stepNameOf(entry, call) {
  if (entry && entry.kind === 'report') return 'Report — ' + (str(entry.report && entry.report.name) || str(entry.report && entry.report.path).split('/').filter(Boolean).pop() || 'report');
  const method = str(call.method || 'GET').toUpperCase();
  const path = str(call.path || parse(call.url || '').path);
  const tail = path.split('/').filter(Boolean).slice(-2).join('/');
  return method + ' ' + (tail || str(entry && entry.endpoint) || path || '').trim();
}
/** A run of identical steps collapses to one (the same call sending the same values). */
function sameSent(a, b) {
  if (!a || !b) return false;
  if (!!a.report !== !!b.report) return false;
  if (a.report && b.report) return str(a.report.path) === str(b.report.path);
  return str(a.endpoint) === str(b.endpoint) && str(a.body) === str(b.body) && JSON.stringify(a.params || {}) === JSON.stringify(b.params || {});
}
/**
 * Build ordered API-scenario steps from a recorded flow, so a walkthrough becomes a runnable scenario — only when a
 * person asks for it, never on its own. Each captured call becomes a step in the order it fired (pages in flow order),
 * pre-filled with the data the app sent (the query as params, the request body) and expecting the status it returned
 * (and a row when its answer had rows). A call is matched to the page's catalog so the scenario runner can resolve it:
 * REST by method + path pattern, a BI Publisher run by the report path in its body (else the page's next report).
 * Calls with no catalog match are reported (unmatched), never invented.
 *   apisByPage: { <pageId>: [ { kind:'rest', endpoint, method, path, writes }
 *                           | { kind:'report', endpoint, report:{ path, name, rowTag } } ] }
 *   → { steps: [scenario step], matched, unmatched: [{ page, method, path }], pages: [pageId] }
 */
function scenarioFromFlow(flow, apisByPage) {
  const f = (flow && typeof flow === 'object') ? flow : {};
  const byPage = (apisByPage && typeof apisByPage === 'object') ? apisByPage : {};
  const made = [];
  const unmatched = [];
  const pages = [];
  (Array.isArray(f.pages) ? f.pages : []).forEach((p) => {
    const pageId = str(p && p.page);
    if (pageId && pages.indexOf(pageId) === -1) pages.push(pageId);
    const entries = Array.isArray(byPage[pageId]) ? byPage[pageId] : [];
    const rest = entries.filter((e) => e && e.kind === 'rest');
    const reports = entries.filter((e) => e && e.kind === 'report');
    const usedReport = {};
    (Array.isArray(p && p.calls) ? p.calls : []).forEach((c) => {
      if (!c || typeof c !== 'object') return;
      const method = str(c.method || 'GET').toUpperCase();
      const path = str(c.path || parse(c.url || '').path);
      if (isReportCall(c)) {
        const want = reportPathOf(c.body);
        let e = want ? reports.filter((r) => r.report && reportPathsEqual(r.report.path, want))[0] : null;
        if (!e) e = reports.filter((r) => r.report && !usedReport[r.report.path])[0] || reports[0] || null;
        if (!e) { unmatched.push({ page: pageId, method: 'REPORT', path: want || path }); return; }
        usedReport[str(e.report.path)] = true;
        made.push({ id: '', name: stepNameOf(e, c), endpoint: str(e.endpoint || ''),
          report: { path: str((e.report && e.report.path) || want), name: str(e.report && e.report.name), rowTag: str(e.report && e.report.rowTag) },
          params: {}, extra: '', body: '', extract: [], expect: expectFromCall(c), writes: false, page: pageId, from: 'recording' });
        return;
      }
      const e = rest.filter((x) => str(x.method || 'GET').toUpperCase() === method && pathMatches(str(x.path), path))
        .sort((a, b) => Math.abs(str(a.path).length - path.length) - Math.abs(str(b.path).length - path.length))[0];
      if (!e) { unmatched.push({ page: pageId, method, path }); return; }
      const params = Object.assign({}, pathParamsOf(str(e.path), path), queryParams(c.query || (str(c.url).indexOf('?') !== -1 ? str(c.url).slice(str(c.url).indexOf('?') + 1) : '')));
      made.push({ id: '', name: stepNameOf(e, c), endpoint: str(e.endpoint),
        report: null, params, extra: '', body: str(c.body || ''), extract: [], expect: expectFromCall(c), writes: !!e.writes, page: pageId, from: 'recording' });
    });
  });
  const steps = [];
  made.forEach((st) => { if (!sameSent(steps[steps.length - 1], st)) steps.push(st); });
  steps.forEach((st, i) => { st.id = 's' + (i + 1); });
  return { steps, matched: steps.length, unmatched, pages };
}

module.exports = { matchPage, buildSteps, callForApi, pathMatches, trimCall, decodeResponse, scenarioFromFlow, queryParams, isReportCall, reportPathOf, parse, routeTail, routeOpen };
