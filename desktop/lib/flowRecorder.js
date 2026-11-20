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

/** The distinct pages walked through, in order (consecutive repeats collapsed), each as a step with its screenshot. */
function buildSteps(nav, pages) {
  const steps = [];
  let skipped = 0;
  let n = 0;
  (nav || []).forEach((entry) => {
    const e = entry && typeof entry === 'object' ? entry : { url: entry };
    const p = matchPage(e.url, pages);
    if (!p) { skipped += 1; return; }
    const last = steps[steps.length - 1];
    if (last && last.page === p.id) {
      // same page again in a row: keep the latest screenshot if this visit has one
      if (e.shot && /^data:image\//.test(str(e.shot))) last.shot = { src: 'page', data: str(e.shot) };
      return;
    }
    const step = { id: 'p' + (++n), page: p.id, name: p.label || p.page || p.id, url: str(e.url) };
    if (e.shot && /^data:image\//.test(str(e.shot))) step.shot = { src: 'page', data: str(e.shot) };
    steps.push(step);
  });
  return { steps, skipped };
}

module.exports = { matchPage, buildSteps, parse, routeTail, routeOpen };
