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
/** One captured network call, trimmed for storage: method, url, query, request body, status, a short response preview. */
function trimCall(c) {
  const o = c && typeof c === 'object' ? c : {};
  const url = str(o.url);
  const call = { method: str(o.method || 'GET').toUpperCase(), url, path: parse(url).path, query: str(o.query || (url.indexOf('?') !== -1 ? url.slice(url.indexOf('?') + 1) : '')) };
  if (o.body !== undefined && o.body !== null && str(o.body)) call.body = str(o.body).slice(0, CAP);
  if (o.status !== undefined && o.status !== null && o.status !== '') call.status = Number(o.status) || str(o.status);
  if (o.response !== undefined && o.response !== null && str(o.response)) call.response = str(o.response).slice(0, CAP);
  return call;
}

/** The distinct SCREENS walked through, in order, each as a step with its screenshot and the API calls the app made
 *  while on it. A "screen" is a page that loaded, or — when the recorder's observer reports it (entry.screen /
 *  entry.kind) — a dialog / drawer / wizard step that appeared without the web address changing. So one page can be
 *  several steps: the page itself, then a dialog on it. Each step carries its url and kind (page | dialog) so you can
 *  tell a screen from a dialog within that screen. Backward compatible: entries without `screen` behave as before (one
 *  step per page, consecutive repeats collapsed). */
function buildSteps(nav, pages, calls) {
  const steps = [];
  const byStep = {}; // step.id → [trimmed call]
  let skipped = 0;
  let n = 0;
  (nav || []).forEach((entry) => {
    const e = entry && typeof entry === 'object' ? entry : { url: entry };
    const p = matchPage(e.url, pages);
    if (!p) { skipped += 1; return; }
    const screenId = str(e.screen).trim();
    const kind = str(e.kind).trim() === 'dialog' || screenId.indexOf('dialog:') === 0 ? 'dialog' : 'page';
    const key = p.id + (screenId ? '::' + screenId : ''); // a page can show more than one screen (a dialog, a wizard step)
    const title = str(e.title).trim();
    const last = steps[steps.length - 1];
    if (last && last.key === key) { // the same screen again: keep the newest shot
      if (e.shot && /^data:image\//.test(str(e.shot))) last.shot = { src: 'page', data: str(e.shot) };
      return;
    }
    const step = { id: 'p' + (++n), key: key, page: p.id, name: title || p.label || p.page || p.id, url: str(e.url), kind: kind };
    if (title) step.title = title;
    if (e.shot && /^data:image\//.test(str(e.shot))) step.shot = { src: 'page', data: str(e.shot) };
    steps.push(step);
  });
  // assign each captured call to the step whose page was open when it fired (matchPage of the call's pageUrl)
  (calls || []).forEach((c) => {
    const p = matchPage(str(c && c.pageUrl), pages);
    if (!p) return;
    // the latest step for that page (a page can appear more than once; keep calls with the most recent visit)
    let target = null;
    for (let i = steps.length - 1; i >= 0; i--) { if (steps[i].page === p.id) { target = steps[i]; break; } }
    if (!target) return;
    (byStep[target.id] = byStep[target.id] || []).push(trimCall(c));
  });
  steps.forEach((s) => { const list = byStep[s.id]; if (list && list.length) s.calls = list.slice(0, MAX_CALLS); delete s.key; });
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

module.exports = { matchPage, buildSteps, callForApi, pathMatches, trimCall, parse, routeTail, routeOpen };
