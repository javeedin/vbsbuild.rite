define(['resources/js/integrationDiagram'], function (D) {
  'use strict';

  // The integrations report (Application → Integrations → PDF / Excel) — pure (no DOM): from the scan
  // (desktop/lib/integrations.js), a printable A4 landscape document and the Excel sheets.
  //
  //   html(m, { by, systems: true, pages: 'all' | [ids] }) → '<!doctype html>…' (pages 'all': a Page by page section — every
  //       page's integration flow, after the pages → systems diagram)  the cover and its figures; the landscape
  //       diagram; between systems (the app ⇄ each system by business object, system → system handoffs); the
  //       interfaces (system × business object); the cross-system flows; the systems; the integration data sheet
  //       (source → target); the endpoints; flow × system; one page per system with its diagram and endpoints (and the
  //       page diagrams asked for); what could not be resolved
  //   sheets(m)            → [{ name, rows, columns }]  Summary, Interfaces, Cross-system flows, System to system,
  //                          Page flows (each page's actions and their calls in order), Systems, Integrations,
  //                          Endpoints, Flows × systems
  //   flowText(x, app)     → "Oracle Fusion → app" / "app → Oracle Fusion" / "app ⇄ Oracle Fusion": which way an
  //                          interface's data goes
  //   fileName(m, ext)     → integrations-<app>-<yyyy-mm-dd>.<ext>

  var esc = D.esc;
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function when(at) { var d = new Date(at); if (isNaN(d.getTime())) return ''; var p = function (n) { return (n < 10 ? '0' : '') + n; }; return d.getDate() + ' ' + MON[d.getMonth()] + ' ' + d.getFullYear() + ', ' + p(d.getHours()) + ':' + p(d.getMinutes()); }
  function day(at) { var d = new Date(at); if (isNaN(d.getTime())) d = new Date(); var p = function (n) { return (n < 10 ? '0' : '') + n; }; return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); }
  var sysName = function (m, id) { var s = (m.systems || []).filter(function (x) { return x.id === id; })[0]; return s ? s.name : id; };
  var plural = function (n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); };

  function fileName(m, ext) { return 'integrations-' + String((m && m.app) || 'app').replace(/[^A-Za-z0-9_-]+/g, '-') + '-' + day(m && m.at) + '.' + (ext || 'pdf'); }

  function table(cols, rows, cls) {
    return '<table class="' + (cls || '') + '"><thead><tr>' + cols.map(function (c) { return '<th' + (c.w ? ' style="width:' + c.w + '"' : '') + '>' + esc(c.label) + '</th>'; }).join('') + '</tr></thead><tbody>'
      + rows.map(function (r) { return '<tr>' + cols.map(function (c) { var v = c.html ? c.html(r) : esc(c.get ? c.get(r) : r[c.key]); return '<td' + (c.cls ? ' class="' + c.cls + '"' : '') + '>' + v + '</td>'; }).join('') + '</tr>'; }).join('')
      + '</tbody></table>';
  }
  /** Which way an interface's data goes: from the system to the app (reads, reports), the other way, or both. */
  function flowText(x, app) {
    var a = app || 'app', sname = x.systemName || '';
    return x.dataFlow === 'out' ? a + ' → ' + sname : x.dataFlow === 'both' ? a + ' ⇄ ' + sname : sname + ' → ' + a;
  }
  var stepsText = function (j) { return (j.steps || []).map(function (st, i) { return (i + 1) + '. ' + st.systemName + ' (' + st.direction.toLowerCase() + ': ' + st.objects.join(', ') + ')'; }).join(' → '); };
  var dot = function (kind) { var K = D.KINDS[kind] || D.KINDS.rest; return '<span class="dot" style="background:' + K.color + '"></span>'; };
  var dir = function (d) { return '<span class="dir dir-' + esc(String(d || '').toLowerCase()) + '">' + esc(d) + '</span>'; };

  function html(m, opts) {
    var o = opts || {};
    var T = m.totals || {};
    var parts = [];
    var tiles = [[T.systems, 'systems'], [T.interfaces || 0, 'interfaces (system × object)'], [T.journeys || 0, 'cross-system flows'], [T.endpoints, 'endpoints'], [T.calls, 'calls (page × endpoint)'],
      [T.pagesWith + ' / ' + T.pages, 'pages with integrations'], [T.reads, 'reads'], [T.writes, 'writes'], [T.reports, 'reports']];
    parts.push('<section class="cover"><div class="kicker">Integration data sheet</div><h1>' + esc(m.appName || m.app) + '</h1>'
      + '<p class="sub">Every system the app talks to and every call it makes, read from its code (services and pages) — scanned ' + esc(when(m.at)) + (o.by ? ' by ' + esc(o.by) : '') + '.</p>'
      + '<div class="tiles">' + tiles.map(function (t) { return '<div class="tile"><b>' + esc(t[0]) + '</b><span>' + esc(t[1]) + '</span></div>'; }).join('') + '</div>'
      + '<ol class="toc"><li>Integration landscape</li><li>Flow between systems</li><li>Interfaces (system × business object)</li><li>Cross-system flows</li><li>Systems</li><li>Integration data sheet (source → target)</li><li>Endpoints</li><li>Flows × systems</li>'
      + (o.systems !== false ? '<li>Each system: its diagram and endpoints</li>' : '') + (o.pages === 'all' ? '<li>Page by page: each page\'s integration flow</li>' : (o.pages || []).length ? '<li>Page diagrams</li>' : '') + '</ol></section>');
    var land = D.landscape(m);
    parts.push('<section class="brk"><h2>1. Integration landscape</h2><p class="note">The app\'s flows (the source) and the systems they call (the target). A line\'s thickness: the number of calls.</p><div class="dia">' + land.svg + '</div></section>');
    // between systems, not page by page
    var app = m.appName || m.app;
    var sf = D.systemFlow(m);
    parts.push('<section class="brk"><h2>2. Flow between systems</h2><p class="note">What goes between the app and each system, by business object: what the app sends (writes), what the system returns (reads) and the reports it runs.</p><div class="dia">' + sf.svg + '</div>'
      + ((m.handoffs || []).length ? '<h3>System to system</h3><p class="note">Two systems one action calls one after the other — the app usually passes what the first returned on to the second.</p>' + table([
        { label: 'From', html: function (h) { return dot(h.fromKind) + esc(h.fromName); }, w: '16%' }, { label: 'To', html: function (h) { return dot(h.toKind) + esc(h.toName); }, w: '16%' },
        { label: 'Actions', key: 'actions', cls: 'num', w: '7%' }, { label: 'From the first', get: function (h) { return h.fromObjects.join(', '); }, w: '22%' },
        { label: 'To the second', get: function (h) { return h.toObjects.join(', '); }, w: '22%' }, { label: 'Pages', get: function (h) { return h.pages.join(', '); } }
      ], m.handoffs) : '') + '</section>');
    parts.push('<section class="brk"><h2>3. Interfaces</h2><p class="note">One line per system and business object: which way the data goes, how, and what sets it off — not page by page (the data sheet has every page).</p>' + table([
      { label: 'ID', key: 'id', cls: 'mono', w: '6%' },
      { label: 'Data', html: function (x) { return esc(flowText(x, app)); }, w: '15%' },
      { label: 'Business object', html: function (x) { return '<b>' + esc(x.object) + '</b>' + (x.ops.length ? '<div class="note">' + esc(x.ops.join(', ')) + '</div>' : ''); }, w: '19%' },
      { label: 'Direction', html: function (x) { return x.dirs.map(dir).join(' '); }, w: '10%' },
      { label: 'Methods', get: function (x) { return x.methods.join(', '); }, cls: 'mono', w: '7%' },
      { label: 'Set off by', key: 'setOffBy', w: '17%' },
      { label: 'Endpoints', get: function (x) { return x.endpoints.length; }, cls: 'num', w: '6%' }, { label: 'Calls', key: 'calls', cls: 'num', w: '5%' },
      { label: 'Pages', get: function (x) { return x.pageLabels.join(', '); } }
    ], m.interfaces || [], 'sheet') + '</section>');
    var jd = D.journeys(m);
    parts.push('<section class="brk"><h2>4. Cross-system flows</h2><p class="note">One action (a button, a page opening) that calls two or more systems, in the order its code calls them.</p><div class="dia">' + jd.svg + '</div>'
      + ((m.journeys || []).length ? table([
        { label: 'ID', key: 'id', cls: 'mono', w: '6%' }, { label: 'Systems in order', get: stepsText, w: '52%' }, { label: 'Actions', get: function (j) { return j.actions.length; }, cls: 'num', w: '7%' },
        { label: 'Where', get: function (j) { return j.actions.slice(0, 6).map(function (a) { return a.pageLabel + (a.trigger ? ' — ' + a.trigger : ''); }).join('; ') + (j.actions.length > 6 ? '; and ' + (j.actions.length - 6) + ' more' : ''); } }
      ], m.journeys, 'sheet') : '') + '</section>');
    parts.push('<section class="brk"><h2>5. Systems</h2>' + table([
      { label: 'System', html: function (s) { return dot(s.kind) + '<b>' + esc(s.name) + '</b>' + (s.about ? '<div class="note">' + esc(s.about.slice(0, 220)) + '</div>' : ''); }, w: '22%' },
      { label: 'Kind', key: 'kindLabel', w: '10%' }, { label: 'Base URL', key: 'url', cls: 'mono', w: '22%' }, { label: 'Signs in', get: function (s) { return [s.auth, s.proxy].filter(Boolean).join('; '); }, w: '16%' },
      { label: 'Calls', key: 'calls', cls: 'num', w: '5%' }, { label: 'Reads', key: 'reads', cls: 'num', w: '5%' }, { label: 'Writes', key: 'writes', cls: 'num', w: '5%' }, { label: 'Reports', key: 'reports', cls: 'num', w: '5%' },
      { label: 'Endpoints', get: function (s) { return s.endpoints.length; }, cls: 'num', w: '5%' }, { label: 'Pages', get: function (s) { return s.pages.length; }, cls: 'num', w: '5%' }
    ], m.systems || []) + '</section>');
    parts.push('<section class="brk"><h2>6. Integration data sheet</h2><p class="note">One row per page and endpoint: the source (the page, what sets the call off) and the target (the system and the endpoint it calls).</p>' + table([
      { label: 'ID', key: 'id', cls: 'mono', w: '6%' },
      { label: 'Source', html: function (r) { return '<b>' + esc(r.pageLabel) + '</b><div class="note">' + esc(r.flow) + '</div>'; }, w: '12%' },
      { label: 'Set off by', key: 'trigger', w: '12%' },
      { label: 'Target system', html: function (r) { return dot(r.kind) + esc(r.systemName); }, w: '12%' },
      { label: 'Method', key: 'method', cls: 'mono', w: '5%' },
      { label: 'Endpoint', html: function (r) { return '<span class="mono">' + esc(r.path || r.endpoint) + '</span><div class="note">' + esc(r.endpoint) + (r.report ? ' · report ' + esc(r.report) : '') + '</div>'; }, w: '22%' },
      { label: 'What it does', html: function (r) { return esc(r.summary) + (r.object ? '<div class="note">' + esc(r.object) + (r.action ? ' · ' + esc(r.action) : '') + '</div>' : ''); }, w: '13%' },
      { label: 'Direction', html: function (r) { return dir(r.direction); }, w: '6%' },
      { label: 'Values sent', get: function (r) { return (r.params || []).join(', '); }, w: '8%' },
      { label: 'Via', get: function (r) { return (r.via || []).join(', '); }, w: '8%' }
    ], m.rows || [], 'sheet') + '</section>');
    parts.push('<section class="brk"><h2>7. Endpoints</h2><p class="note">Each endpoint once, with the pages that call it.</p>' + table([
      { label: 'System', html: function (e) { return dot(e.kind) + esc(e.systemName); }, w: '14%' }, { label: 'Method', key: 'method', cls: 'mono', w: '6%' },
      { label: 'Path', key: 'path', cls: 'mono', w: '30%' }, { label: 'What it does', key: 'summary', w: '18%' }, { label: 'Direction', html: function (e) { return dir(e.direction); }, w: '7%' },
      { label: 'Pages', get: function (e) { return e.pageLabels.join(', '); } }
    ], m.endpoints || [], 'sheet') + '</section>');
    var sysIds = (m.systems || []).map(function (s) { return s.id; });
    var flows = (m.flows || []).filter(function (f) { return f.calls; });
    parts.push('<section class="brk"><h2>8. Flows × systems</h2><p class="note">Calls from each flow of the app to each system (reads / writes / reports).</p>' + table(
      [{ label: 'Flow', html: function (f) { return '<b>' + esc(f.flow) + '</b><div class="note">' + plural(f.pages.length, 'page') + '</div>'; } }].concat(sysIds.map(function (sid) {
        return { label: sysName(m, sid), cls: 'num', get: function (f) { var x = (m.matrix || []).filter(function (y) { return y.flow === f.flow && y.system === sid; })[0]; return x ? x.calls + ' (' + x.reads + '/' + x.writes + '/' + x.reports + ')' : ''; } };
      })).concat([{ label: 'Total', key: 'calls', cls: 'num' }]), flows) + '</section>');
    if (o.systems !== false) {
      (m.systems || []).forEach(function (s, i) {
        var d = D.system(m, s.id);
        parts.push('<section class="brk"><h2>9.' + (i + 1) + ' ' + esc(s.name) + '</h2><p class="note">' + dot(s.kind) + esc(s.kindLabel) + (s.url ? ' · <span class="mono">' + esc(s.url) + '</span>' : '') + (s.auth ? ' · signs in: ' + esc(s.auth) : '')
          + ' · ' + esc(D.figures(s)) + ' · ' + plural(s.pages.length, 'page') + '</p><div class="dia">' + d.svg + '</div></section>');
      });
    }
    if (o.pages === 'all') {
      var all = D.pages(m);
      parts.push('<section class="brk"><h2>10. Page by page</h2><p class="note">Each page with integrations and the systems it calls; then each page\'s flow in swimlanes and its details — what sets each call off, its calls in the order its code makes them, the systems.</p><div class="dia">' + all.svg + '</div></section>');
      (m.pageFlows || []).forEach(function (pf, i) {
        var fl = D.pageFlow(m, pf.page);
        parts.push('<section class="brk"><h2>10.' + (i + 1) + ' ' + esc(pf.pageLabel) + ' — flow</h2><p class="note">In swimlanes: a lane for the page and one per system; each action goes down call by call, a dark arrow where it moves on to another system.</p><div class="dia">' + fl.svg + '</div></section>');
        var d = D.page(m, pf.page);
        parts.push('<section class="brk"><h2>10.' + (i + 1) + ' ' + esc(pf.pageLabel) + ' — details</h2><p class="note">' + esc(pf.flow) + ' · <span class="mono">' + esc(pf.page) + '</span> · ' + plural(pf.calls, 'call') + ' to ' + plural(pf.systems.length, 'system')
          + ' · ' + plural(pf.steps.length, 'action') + (pf.reads ? ' · ' + plural(pf.reads, 'read') : '') + (pf.writes ? ' · ' + plural(pf.writes, 'write') : '') + (pf.reports ? ' · ' + plural(pf.reports, 'report') : '') + '</p><div class="dia">' + d.svg + '</div></section>');
      });
    }
    (o.pages === 'all' ? [] : o.pages || []).forEach(function (pid) {
      var d = D.page(m, pid);
      if (d.svg) parts.push('<section class="brk"><h2>Page: ' + esc(d.title) + '</h2><div class="dia">' + d.svg + '</div></section>');
    });
    if ((m.unresolved || []).length) {
      parts.push('<section class="brk"><h2>Not resolved</h2><p class="note">Calls whose endpoint is not in the app\'s services/ — a wrong name, or a service not checked in.</p>'
        + table([{ label: 'Page', key: 'page', cls: 'mono' }, { label: 'Endpoint', key: 'endpoint', cls: 'mono' }], m.unresolved) + '</section>');
    }
    return '<!doctype html><html><head><meta charset="utf-8"><title>' + esc('Integrations — ' + (m.appName || m.app)) + '</title><style>'
      + '@page{size:A4 landscape;margin:12mm 10mm}*{box-sizing:border-box}body{margin:0;font:10.5px/1.45 Inter,"Segoe UI",Roboto,Arial,sans-serif;color:#16212c}'
      + 'h1{font-size:30px;margin:4px 0 8px}h2{font-size:17px;margin:0 0 6px;color:#00506c}h3{font-size:13px;margin:14px 0 4px;color:#00506c}.kicker{font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#6b7889}'
      + '.sub{font-size:13px;color:#3b4a58;max-width:900px}.note{color:#5b6876;font-size:10px;margin:2px 0 8px}.brk{page-break-before:always}'
      + '.tiles{display:flex;flex-wrap:wrap;gap:10px;margin:18px 0}.tile{border:1px solid #d8e0e8;border-radius:10px;padding:10px 14px;min-width:120px}.tile b{display:block;font-size:22px}.tile span{color:#5b6876}'
      + '.toc{color:#3b4a58;font-size:12px;line-height:1.8}.dia svg{width:100%;height:auto;border:1px solid #e4e9ef;border-radius:8px}'
      + 'table{width:100%;border-collapse:collapse;table-layout:fixed}th{background:#eef3f7;text-align:left;font-size:9.5px;text-transform:uppercase;letter-spacing:.04em;color:#3b4a58;padding:5px 6px;border-bottom:1px solid #c9d6e0}'
      + 'td{padding:5px 6px;border-bottom:1px solid #e8edf2;vertical-align:top;overflow-wrap:anywhere}tr{page-break-inside:avoid}thead{display:table-header-group}.num{text-align:right;white-space:nowrap}'
      + '.mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:9.5px}.sheet td{font-size:9.5px}'
      + '.dot{display:inline-block;width:8px;height:8px;border-radius:2px;margin-right:5px;vertical-align:0}'
      + '.dir{display:inline-block;padding:1px 7px;border-radius:8px;font-size:9px;font-weight:700}.dir-read{background:#e6f0fc;color:#1d4f91}.dir-write{background:#fdeee6;color:#a8461b}.dir-report{background:#e3f6ef;color:#11704b}'
      + '</style></head><body>' + parts.join('') + '</body></html>';
  }

  function sheets(m) {
    var T = m.totals || {};
    return [
      { name: 'Summary', rows: [
        { field: 'App', value: m.appName || m.app }, { field: 'Scanned', value: when(m.at) }, { field: 'Systems', value: T.systems }, { field: 'Endpoints', value: T.endpoints },
        { field: 'Calls (page × endpoint)', value: T.calls }, { field: 'Pages with integrations', value: T.pagesWith + ' of ' + T.pages }, { field: 'Reads', value: T.reads }, { field: 'Writes', value: T.writes },
        { field: 'Reports', value: T.reports }, { field: 'Interfaces (system × business object)', value: T.interfaces || 0 }, { field: 'Cross-system flows', value: T.journeys || 0 },
        { field: 'Actions that call two or more systems', value: T.crossActions || 0 }, { field: 'Not resolved', value: T.unresolved }], columns: [{ key: 'field', label: 'Field' }, { key: 'value', label: 'Value' }] },
      { name: 'Interfaces', rows: (m.interfaces || []).map(function (x) {
        return { id: x.id, data: flowText(x, m.appName || m.app), system: x.systemName, kind: x.kindLabel, object: x.object, ops: x.ops.join(', '), direction: x.direction, methods: x.methods.join(', '), patterns: x.patterns.join('; '),
          setOffBy: x.setOffBy, endpoints: x.endpoints.length, endpointList: x.endpoints.join(', '), calls: x.calls, pages: x.pages.length, pageList: x.pageLabels.join(', '), flows: x.flows.join(', ') };
      }), columns: [{ key: 'id', label: 'ID' }, { key: 'data', label: 'Data (from → to)' }, { key: 'system', label: 'System' }, { key: 'kind', label: 'Kind' }, { key: 'object', label: 'Business object' }, { key: 'ops', label: 'Actions on it' },
        { key: 'direction', label: 'Direction' }, { key: 'methods', label: 'Methods' }, { key: 'patterns', label: 'Pattern' }, { key: 'setOffBy', label: 'Set off by' }, { key: 'endpoints', label: 'Endpoints', type: 'number' },
        { key: 'endpointList', label: 'Endpoint list' }, { key: 'calls', label: 'Calls', type: 'number' }, { key: 'pages', label: 'Pages', type: 'number' }, { key: 'pageList', label: 'Pages that use it' }, { key: 'flows', label: 'App areas (flows)' }] },
      { name: 'Cross-system flows', rows: (m.journeys || []).map(function (j) {
        return { id: j.id, path: j.path, steps: stepsText(j), actions: j.actions.length, pages: j.pages.length, where: j.actions.map(function (a) { return a.pageLabel + (a.trigger ? ' — ' + a.trigger : '') + ' (' + a.chain + ')'; }).join('; ') };
      }), columns: [{ key: 'id', label: 'ID' }, { key: 'path', label: 'Systems in order' }, { key: 'steps', label: 'Steps (what each reads, writes, reports)' }, { key: 'actions', label: 'Actions', type: 'number' },
        { key: 'pages', label: 'Pages', type: 'number' }, { key: 'where', label: 'Where (page — set off by (chain))' }] },
      { name: 'Page flows', rows: [].concat.apply([], (m.pageFlows || []).map(function (pf) {
        return [].concat.apply([], pf.steps.map(function (st, si) {
          return st.calls.map(function (c, ci) {
            return { flow: pf.flow, page: pf.pageLabel, pageId: pf.page, action: si + 1, trigger: st.trigger, chains: st.chain, n: ci + 1, method: c.method, path: c.path, object: c.object + (c.action ? ' (' + c.action + ')' : ''), system: c.systemName, direction: c.direction, via: c.via || '', row: c.id };
          });
        }));
      })), columns: [{ key: 'flow', label: 'Flow' }, { key: 'page', label: 'Page' }, { key: 'pageId', label: 'Page id' }, { key: 'action', label: 'Action #', type: 'number' }, { key: 'trigger', label: 'Set off by' }, { key: 'chains', label: 'Chains' },
        { key: 'n', label: 'Call # (in order)', type: 'number' }, { key: 'method', label: 'Method' }, { key: 'path', label: 'Path' }, { key: 'object', label: 'Business object' }, { key: 'system', label: 'System' }, { key: 'direction', label: 'Direction' },
        { key: 'via', label: 'Via module' }, { key: 'row', label: 'Data sheet row' }] },
      { name: 'System to system', rows: (m.handoffs || []).map(function (h) { return { from: h.fromName, to: h.toName, actions: h.actions, fromObjects: h.fromObjects.join(', '), toObjects: h.toObjects.join(', '), pages: h.pages.join(', ') }; }),
        columns: [{ key: 'from', label: 'From' }, { key: 'to', label: 'To' }, { key: 'actions', label: 'Actions', type: 'number' }, { key: 'fromObjects', label: 'From the first' }, { key: 'toObjects', label: 'To the second' }, { key: 'pages', label: 'Pages' }] },
      { name: 'Systems', rows: (m.systems || []).map(function (s) { return { name: s.name, kind: s.kindLabel, url: s.url, host: s.host, auth: s.auth, proxy: s.proxy, calls: s.calls, reads: s.reads, writes: s.writes, reports: s.reports, endpoints: s.endpoints.length, pages: s.pages.length, services: s.services.join(', '), about: s.about || '' }; }),
        columns: [{ key: 'name', label: 'System' }, { key: 'kind', label: 'Kind' }, { key: 'url', label: 'Base URL' }, { key: 'host', label: 'Host' }, { key: 'auth', label: 'Signs in' }, { key: 'proxy', label: 'Proxy' },
          { key: 'calls', label: 'Calls', type: 'number' }, { key: 'reads', label: 'Reads', type: 'number' }, { key: 'writes', label: 'Writes', type: 'number' }, { key: 'reports', label: 'Reports', type: 'number' },
          { key: 'endpoints', label: 'Endpoints', type: 'number' }, { key: 'pages', label: 'Pages', type: 'number' }, { key: 'services', label: 'Services' }, { key: 'about', label: 'About' }] },
      { name: 'Integrations', rows: (m.rows || []).map(function (r) { return Object.assign({}, r, { via: (r.via || []).join(', '), params: (r.params || []).join(', ') }); }),
        columns: [{ key: 'id', label: 'ID' }, { key: 'app', label: 'App' }, { key: 'flow', label: 'Source flow' }, { key: 'pageLabel', label: 'Source page' }, { key: 'page', label: 'Page id' }, { key: 'trigger', label: 'Set off by' },
          { key: 'via', label: 'Via (chains)' }, { key: 'systemName', label: 'Target system' }, { key: 'kindLabel', label: 'Target kind' }, { key: 'object', label: 'Business object' }, { key: 'action', label: 'Action on it' }, { key: 'service', label: 'Service' }, { key: 'operation', label: 'Operation' },
          { key: 'method', label: 'Method' }, { key: 'path', label: 'Path' }, { key: 'url', label: 'URL' }, { key: 'summary', label: 'What it does' }, { key: 'direction', label: 'Direction' }, { key: 'pattern', label: 'Pattern' },
          { key: 'params', label: 'Values sent' }, { key: 'report', label: 'Report' }] },
      { name: 'Endpoints', rows: (m.endpoints || []).map(function (e) { return Object.assign({}, e, { pages: e.pages.length, pageList: e.pageLabels.join(', ') }); }),
        columns: [{ key: 'systemName', label: 'System' }, { key: 'endpoint', label: 'Endpoint' }, { key: 'method', label: 'Method' }, { key: 'path', label: 'Path' }, { key: 'summary', label: 'What it does' },
          { key: 'direction', label: 'Direction' }, { key: 'pages', label: 'Pages', type: 'number' }, { key: 'pageList', label: 'Pages that call it' }, { key: 'url', label: 'URL' }] },
      { name: 'Flows x systems', rows: (m.matrix || []).map(function (x) { return Object.assign({}, x, { systemName: sysName(m, x.system) }); }),
        columns: [{ key: 'flow', label: 'Flow' }, { key: 'systemName', label: 'System' }, { key: 'calls', label: 'Calls', type: 'number' }, { key: 'reads', label: 'Reads', type: 'number' }, { key: 'writes', label: 'Writes', type: 'number' }, { key: 'reports', label: 'Reports', type: 'number' }] }
    ];
  }

  return { html: html, sheets: sheets, fileName: fileName, when: when, flowText: flowText };
});
