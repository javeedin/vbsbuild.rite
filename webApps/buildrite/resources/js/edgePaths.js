define([], function () {
  'use strict';

  // Edge paths from a Process Flow (flows/insights process-flows → "Edge paths (AI)"): the recording is the HAPPY PATH —
  // the pages a user walked and the API calls each made. For every step this proposes the EDGE PATHS: what can happen
  // differently (bad input, no data, permission denied, a duplicate, a dependency/network failure, a timeout, a
  // concurrency conflict…) — each with a trigger, the behaviour the app should have, what API/validation it stresses, and
  // a severity. Pure: no page, no DOM, no network. The chain reads the flow, asks the shared Ask AI with the prompt built
  // here, parses the answer and builds the model; with no AI, autoDraft derives edges from each page's API calls.
  //
  //   pages(flow)            the flow's pages as items: { key:'P1', name, page, calls:[{ method, path, object }] } (assets out)
  //   prompt(flow)           { system, user } — asks for one ```edges JSON block:
  //                          [{ pageKey, edges:[{ name, trigger, expected, stresses, severity }] }]  (pageKey "*" = whole flow)
  //   parse(text)            that block (tolerant of truncation / a wrapper) → [{ pageKey, edges:[…] }]
  //   autoDraft(flow)        the same shape without AI: edges derived from each page's calls + a flow-wide group
  //   build(flow, drafted)   the model: { steps:[{ key, name, page, edges, counts }], general:[…], total, counts }
  //   rows(model) / COLUMNS           flat rows for CSV / Excel
  //   checkRows(model, checks) / CHECK_COLUMNS   the edge checklist (each edge, whether it is marked covered)
  //   summary(model) / summaryRows / SUM_COLUMNS the risk summary (severity counts, top risks)
  //   documentHtml(model, m)         a print-ready document (also the PDF / HTML export)

  var S = function (v) { return v == null ? '' : String(v); };
  function esc(s) { return S(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function cut(s, n) { s = S(s); return s.length > n ? s.slice(0, n - 1) + '…' : s; }

  function recPath(c) { var s = S(c && c.path); if (!s) { s = S(c && c.url).replace(/#.*$/, ''); var q = s.indexOf('?'); s = (q === -1 ? s : s.slice(0, q)).replace(/^[a-z]+:\/\/[^/]+/i, ''); } return s.replace(/[?#].*$/, '').replace(/\/+$/, '') || '/'; }
  /** A captured call that is page scaffolding (a script, style, image, descriptor…), not a business API call. */
  function isAsset(c) {
    if (!c || typeof c !== 'object') return true;
    var u = S(c.url);
    var p = recPath(c);
    if (!p || p === '/') return true;
    if (/\/(fscm|hcm|crm|scm|prc|fin|expenses|atk)RestApi\//i.test(u) || /\/ic\/api\/integration/i.test(u)) return false;
    if (/\.(css|js|mjs|cjs|map|json|jsonp|xml|html?|txt|md|markdown|wasm|woff2?|ttf|eot|otf|svg|png|jpe?g|gif|ico|webp|avif|bmp|mp4|webm|csv)$/i.test(p)) return true;
    if (/\/version_\d+\/|\/resources\/|\/webapps\/|\/deployments\/|\/dynamicLayouts?\/|requirejs|\/vb\/|\/fnd\/|openapi3?|app-flow|\/_currentuser\b|\/describe\b/i.test(u)) return true;
    if (/(^|\/)(fonts?|images?|img|icons?|assets|static|cdn|css|js)\//i.test(p)) return true;
    return false;
  }
  /** The business object a path names: its last meaningful segment (ids, {params} and version tags left out). */
  function objOf(path) {
    var segs = S(path).split('/').filter(Boolean).filter(function (s) { return !/^\{.*\}$/.test(s) && !/^:/.test(s) && !/^\d+$/.test(s) && !/^v\d+$/i.test(s); });
    return segs[segs.length - 1] || '';
  }
  /** A path's last object as plain words ("customer-refs" → "customer refs"). */
  function humanObj(object) { return S(object).replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim(); }
  /** Which system a call's path talks to (for phrasing a dependency-failure edge). */
  function sysOf(path) {
    var p = S(path);
    if (/xmlpserver|ReportWSSService|bipService/i.test(p)) return 'BI Publisher';
    if (/mapbox|\/styles\//i.test(p)) return 'the map service';
    if (/\/ic\/api\/integration|\.integration\.|integration\.ocp\.oraclecloud|\/soa-infra\//i.test(p)) return 'Oracle Integration (OIC)';
    if (/\/(fscm|hcm|crm|scm|prc|fin|expenses|atk)RestApi\//i.test(p)) return 'Oracle Fusion';
    if (/\/ords\//i.test(p)) return 'the backend';
    return 'the backend';
  }
  var EXTERNAL = { 'BI Publisher': 1, 'the map service': 1, 'Oracle Integration (OIC)': 1, 'Oracle Fusion': 1 };
  var isWrite = function (m) { return /^(POST|PUT|PATCH|DELETE)$/i.test(S(m)); };

  /** The flow's pages as items: a key, the page name, and its business API calls. */
  function pages(flow) {
    var f = flow && typeof flow === 'object' ? flow : {};
    return (Array.isArray(f.pages) ? f.pages : []).map(function (p, i) {
      var calls = (Array.isArray(p && p.calls) ? p.calls : []).filter(function (c) { return !isAsset(c); })
        .map(function (c) { var path = recPath(c); return { method: S(c.method || 'GET').toUpperCase(), path: path, object: objOf(path) }; });
      return { key: 'P' + (i + 1), name: S(p && (p.name || p.page)) || ('Page ' + (i + 1)), page: S(p && p.page), calls: calls };
    });
  }

  var SEV = { high: 1, medium: 2, low: 3 };
  function normSev(s) { var v = S(s).toLowerCase().trim(); return v === 'high' || v === 'low' ? v : 'medium'; }
  /** One edge within size, with a valid severity; '' name = dropped by the caller. */
  function cleanEdge(e) {
    var o = e && typeof e === 'object' ? e : {};
    return { name: S(o.name).trim().slice(0, 200), trigger: S(o.trigger).trim().slice(0, 600),
      expected: S(o.expected).trim().slice(0, 600), stresses: S(o.stresses || o.stress || o.api || o.stressed).trim().slice(0, 300),
      severity: normSev(o.severity) };
  }
  /** Clean + de-duplicate edges by name (case-insensitive, first wins), drop the nameless, cap at `max` (default 10). */
  function cleanEdges(a, max) {
    var seen = {};
    return (Array.isArray(a) ? a : []).map(cleanEdge).filter(function (e) { var k = e.name.toLowerCase(); if (!e.name || seen[k]) return false; seen[k] = 1; return true; }).slice(0, max || 10);
  }

  var SYSTEM = [
    'You are a QA and test analyst. You are given the HAPPY PATH a user walked through in one business process: the pages, in order, and the API calls each page makes (method, path).',
    'For EACH step (page), list the EDGE PATHS — everything that can happen DIFFERENTLY from the happy path and must be handled. Think about:',
    '  - invalid, missing or out-of-range input; boundary values',
    '  - no results / empty data; a very large result set',
    '  - the user cancelling, going back, or submitting twice',
    '  - permission denied; the record not found; a duplicate',
    '  - a dependency, integration or network failure; a timeout',
    '  - a concurrency conflict (someone else changed the same record).',
    'For EACH edge path give:',
    '  - name: a short title (3–7 words)',
    '  - trigger: what the user or system does that causes it',
    '  - expected: what the application SHOULD do (the correct behaviour)',
    '  - stresses: which API call or validation it exercises (use a method + path from the step when relevant)',
    '  - severity: "high", "medium" or "low".',
    'Ground every edge path in the step and its API calls (a POST/PUT that writes → validation, duplicates, server errors; a GET list → empty / large / slow results; a path like /orders/{id} → a missing or invalid id; a call to an outside system → that system being down).',
    'You may add ONE group with "pageKey":"*" for edge paths that span the whole flow (session expiry, loss of connection, a concurrent change).',
    'Rules:',
    '- Use ONLY the page keys given (or "*" for the whole flow). Never invent a page or a key.',
    '- 2 to 6 edge paths per step; do not repeat the same edge path.',
    'Answer with ONE fenced code block and nothing else:',
    '```edges',
    '[{"pageKey":"P1","edges":[{"name":"No matching records","trigger":"The search returns nothing","expected":"Show an empty state, not an error","stresses":"GET /items","severity":"low"}]}]',
    '```'
  ].join('\n');

  /** { system, user } to draft the edge paths from the recorded flow's pages and their calls. */
  function prompt(flow) {
    var f = flow && typeof flow === 'object' ? flow : {};
    var items = pages(f);
    var lines = items.map(function (p) {
      var calls = p.calls.length ? ' — calls: ' + p.calls.slice(0, 10).map(function (c) { return c.method + ' ' + c.path; }).join('; ') + (p.calls.length > 10 ? ' …' : '') : ' — no API calls';
      return p.key + ' [' + cut(p.name, 80) + ']' + calls;
    });
    var user = 'The happy path "' + (S(f.name) || 'recording') + '" walks through ' + items.length + ' step' + (items.length === 1 ? '' : 's') + ', in order:\n\n'
      + lines.join('\n') + '\n\nReturn only the ```edges JSON block, with the edge paths for each step (and, if useful, one "*" group for the whole flow).';
    return { system: SYSTEM, user: user };
  }

  /** Every complete top-level {…} object inside the first [ … ] of `body`, string-aware (a truncated last one is skipped). */
  function salvage(body) {
    var out = [];
    var start = body.indexOf('[');
    if (start === -1) return out;
    var depth = 0, objStart = -1, inStr = false, escq = false;
    for (var i = start + 1; i < body.length; i++) {
      var ch = body.charAt(i);
      if (inStr) { if (escq) escq = false; else if (ch === '\\') escq = true; else if (ch === '"') inStr = false; continue; }
      if (ch === '"') { inStr = true; continue; }
      if (ch === '{') { if (depth === 0) objStart = i; depth++; continue; }
      if (ch === '}') { depth--; if (depth === 0 && objStart !== -1) { try { out.push(JSON.parse(body.slice(objStart, i + 1))); } catch (e) { /* skip */ } objStart = -1; } continue; }
      if (ch === ']' && depth === 0) break;
    }
    return out;
  }
  function normKey(k) {
    var v = S(k).trim().toUpperCase();
    if (!v || v === '*' || v === 'ALL' || v === 'FLOW' || v === 'ANY' || v === 'GENERAL' || v === 'WHOLE FLOW') return '*';
    return v;
  }
  /** The ```edges block (or first JSON array) → [{ pageKey, edges:[…] }]; tolerant of truncation / a wrapper. */
  function parse(text) {
    var t = S(text);
    var m = /```(?:edges|json)?\s*([\s\S]*?)```/i.exec(t);
    var body = m ? m[1] : t;
    var arr = null;
    var a = body.indexOf('['), b = body.lastIndexOf(']');
    if (a !== -1 && b > a) { try { var j = JSON.parse(body.slice(a, b + 1)); if (Array.isArray(j)) arr = j; } catch (e) { /* messy / truncated */ } }
    if (!arr) { try { var o = JSON.parse(body.trim()); if (o && Array.isArray(o.steps)) arr = o.steps; else if (o && Array.isArray(o.edges) && o.pageKey) arr = [o]; else if (Array.isArray(o)) arr = o; } catch (e) { /* not clean */ } }
    if (!arr) arr = salvage(body);
    if (!arr || !arr.length) return [];
    return arr.filter(function (g) { return g && typeof g === 'object'; }).map(function (g) {
      return { pageKey: normKey(g.pageKey || g.key || g.page), edges: cleanEdges(g.edges || g.edgePaths || g.items) };
    }).filter(function (g) { return g.edges.length; });
  }

  /** Without AI: edges derived from each page's API calls (method → the things that can go wrong), plus a flow-wide group. */
  function autoDraft(flow) {
    var items = pages(flow);
    var anyWrite = false;
    var extSeen = {};
    var out = items.map(function (p) {
      var edges = [];
      edges.push({ name: 'Page fails to load', trigger: 'A call or resource the page needs fails when it opens', expected: 'Show a clear error with a retry, not a blank screen', stresses: p.calls[0] ? p.calls[0].method + ' ' + p.calls[0].path : 'page load', severity: 'medium' });
      edges.push({ name: 'User cancels or leaves', trigger: 'The user goes back or closes the step before finishing', expected: 'No half-saved data; prompt or keep a draft where needed', stresses: 'navigation / unsaved state', severity: 'low' });
      p.calls.forEach(function (c) {
        var ref = c.method + ' ' + c.path;
        var obj = humanObj(c.object) || 'the data';
        var sys = sysOf(c.path);
        if (EXTERNAL[sys] && !extSeen[sys]) { extSeen[sys] = 1; edges.push({ name: sys + ' is unavailable', trigger: 'The call to ' + sys + ' fails or times out', expected: 'Degrade gracefully, allow a retry, and tell the user', stresses: ref, severity: 'high' }); }
        if (/\{[^}]+\}|\/\d+(\/|$)/.test(c.path)) edges.push({ name: 'Invalid or missing identifier', trigger: 'The id in ' + c.path + ' is missing, wrong or no longer exists', expected: 'Show a “not found” message, not a crash', stresses: ref, severity: 'medium' });
        if (isWrite(c.method)) {
          anyWrite = true;
          if (c.method === 'DELETE') {
            edges.push({ name: 'Record already removed', trigger: 'The ' + obj + ' was deleted by someone else first', expected: 'Treat as already done and refresh the list', stresses: ref, severity: 'medium' });
            edges.push({ name: obj.charAt(0).toUpperCase() + obj.slice(1) + ' is in use', trigger: 'Something depends on the ' + obj + ' being deleted', expected: 'Explain the dependency; do not half-remove it', stresses: ref, severity: 'medium' });
          } else {
            edges.push({ name: 'Invalid or missing input', trigger: 'Required fields for ' + obj + ' are blank or fail validation', expected: 'Block the submit and show field-level errors', stresses: ref, severity: 'high' });
            edges.push({ name: 'Duplicate submission', trigger: 'The user submits ' + obj + ' twice (double-click or retry)', expected: 'Only one record is created; the button is disabled while sending', stresses: ref, severity: 'medium' });
            edges.push({ name: 'Server rejects the change', trigger: sys + ' returns 409 / 422 / 500 for ' + obj, expected: 'Keep what the user entered and show why it failed', stresses: ref, severity: 'high' });
          }
        } else {
          edges.push({ name: 'No matching records', trigger: 'The ' + obj + ' query returns nothing', expected: 'Show an empty state, not an error or a blank table', stresses: ref, severity: 'low' });
          edges.push({ name: 'Slow response or timeout', trigger: sys + ' is slow or times out loading ' + obj, expected: 'Show a loading state, then a timeout message with retry', stresses: ref, severity: 'medium' });
        }
      });
      return { pageKey: p.key, edges: cleanEdges(edges, 12) };
    });
    var flowEdges = [
      { name: 'Session expires mid-flow', trigger: 'The sign-in or session times out partway through', expected: 'Prompt to sign in again and resume without losing entered data', stresses: 'auth / session', severity: 'high' },
      { name: 'Connection is lost', trigger: 'Network drops between steps', expected: 'Show an offline state, allow a retry, lose no data silently', stresses: 'network', severity: 'medium' }
    ];
    if (anyWrite) flowEdges.push({ name: 'Concurrent edit conflict', trigger: 'Another user changes the same record during the flow', expected: 'Detect the conflict on save and let the user reconcile', stresses: 'concurrency', severity: 'medium' });
    out.push({ pageKey: '*', edges: cleanEdges(flowEdges, 8) });
    return out;
  }

  function countSev(edges, into) { edges.forEach(function (e) { into[e.severity] = (into[e.severity] || 0) + 1; }); }

  /** The model from the flow and a drafted set: every page is a step (edges matched by key, de-duplicated), with the edges
   *  for unknown / "*" keys gathered as the flow-wide `general` group. */
  function build(flow, drafted) {
    var items = pages(flow);
    var byKey = {};
    items.forEach(function (p) { byKey[p.key.toUpperCase()] = { key: p.key, name: p.name, page: p.page, calls: p.calls, edges: [] }; });
    var general = [];
    (Array.isArray(drafted) ? drafted : []).forEach(function (g) {
      var k = normKey(g && g.pageKey);
      var target = k !== '*' && byKey[k] ? byKey[k].edges : general;
      cleanEdges(g && g.edges).forEach(function (e) { target.push(e); });
    });
    var sev = { high: 0, medium: 0, low: 0 };
    var steps = items.map(function (p) {
      var st = byKey[p.key.toUpperCase()];
      var edges = cleanEdges(st.edges);
      var c = { high: 0, medium: 0, low: 0 };
      countSev(edges, c); countSev(edges, sev);
      return { key: p.key, name: p.name, page: p.page, calls: p.calls, edges: edges, counts: { edges: edges.length, high: c.high, medium: c.medium, low: c.low } };
    });
    general = cleanEdges(general);
    countSev(general, sev);
    var total = steps.reduce(function (n, s) { return n + s.edges.length; }, 0) + general.length;
    var withEdges = steps.filter(function (s) { return s.edges.length; }).length + (general.length ? 1 : 0);
    return { steps: steps, general: general, total: items.length,
      counts: { steps: steps.length, stepsWithEdges: withEdges, edges: total, general: general.length, high: sev.high, medium: sev.medium, low: sev.low } };
  }

  /** Does the model hold any edge path? */
  function hasEdges(model) { return !!(model && (((model.steps || []).some(function (s) { return s.edges.length; })) || (model.general || []).length)); }

  var COLUMNS = [
    { key: 'step', label: 'Step' }, { key: 'name', label: 'Edge path' }, { key: 'severity', label: 'Severity' },
    { key: 'trigger', label: 'Trigger' }, { key: 'expected', label: 'Expected behaviour' }, { key: 'stresses', label: 'Stresses' }
  ];
  /** Flat rows for CSV / Excel: one row per edge, under its step (the flow-wide group last). */
  function rows(model) {
    var out = [];
    ((model && model.steps) || []).forEach(function (s) { s.edges.forEach(function (e) { out.push({ step: s.name, name: e.name, severity: e.severity, trigger: e.trigger, expected: e.expected, stresses: e.stresses }); }); });
    ((model && model.general) || []).forEach(function (e) { out.push({ step: 'Across the whole flow', name: e.name, severity: e.severity, trigger: e.trigger, expected: e.expected, stresses: e.stresses }); });
    return out;
  }

  var CHECK_COLUMNS = [{ key: 'num', label: '#' }, { key: 'step', label: 'Step' }, { key: 'name', label: 'Edge path' }, { key: 'severity', label: 'Severity' }, { key: 'covered', label: 'Covered' }, { key: 'expected', label: 'Expected behaviour' }];
  /** The edge checklist: each edge numbered, with whether it is marked covered (`checks`: { "s:e": true } / { "g:e": true }). */
  function checkRows(model, checks) {
    var ch = checks || {};
    var out = [];
    var n = 0;
    ((model && model.steps) || []).forEach(function (s, si) {
      s.edges.forEach(function (e, ei) { n++; out.push({ num: n, step: s.name, name: e.name, severity: e.severity, covered: ch[si + ':' + ei] === true ? 'Yes' : 'No', expected: e.expected }); });
    });
    ((model && model.general) || []).forEach(function (e, ei) { n++; out.push({ num: n, step: 'Across the whole flow', name: e.name, severity: e.severity, covered: ch['g:' + ei] === true ? 'Yes' : 'No', expected: e.expected }); });
    return out;
  }

  var SEV_LABEL = { high: 'High', medium: 'Medium', low: 'Low' };
  /** A risk summary derived from the model: an overview, counts by severity, and the top risks (highest severity first). */
  function summary(model) {
    var c = (model && model.counts) || { edges: 0, high: 0, medium: 0, low: 0, stepsWithEdges: 0 };
    var all = [];
    ((model && model.steps) || []).forEach(function (s, si) { s.edges.forEach(function (e, ei) { all.push({ step: s.name, order: si, idx: ei, name: e.name, severity: e.severity, expected: e.expected }); }); });
    ((model && model.general) || []).forEach(function (e, ei) { all.push({ step: 'Across the whole flow', order: 9999, idx: ei, name: e.name, severity: e.severity, expected: e.expected }); });
    var top = all.slice().sort(function (a, b) { return (SEV[a.severity] - SEV[b.severity]) || (a.order - b.order) || (a.idx - b.idx); }).slice(0, 10);
    var bySeverity = ['high', 'medium', 'low'].map(function (k) { return { sev: k, label: SEV_LABEL[k], n: c[k] || 0 }; });
    var overview = (c.edges || 0) + ' edge path' + ((c.edges || 0) === 1 ? '' : 's') + ' across ' + (c.stepsWithEdges || 0) + ' step' + ((c.stepsWithEdges || 0) === 1 ? '' : 's')
      + ' — ' + (c.high || 0) + ' high, ' + (c.medium || 0) + ' medium, ' + (c.low || 0) + ' low.';
    return { overview: overview, bySeverity: bySeverity, top: top };
  }
  var SUM_COLUMNS = [{ key: 'section', label: 'Section' }, { key: 'item', label: 'Item' }, { key: 'detail', label: 'Detail' }];
  /** Flat rows for the Summary CSV / Excel: the overview, the severity counts, and the top risks. */
  function summaryRows(model) {
    var s = summary(model);
    var out = [{ section: 'Overview', item: '', detail: s.overview }];
    s.bySeverity.forEach(function (b) { out.push({ section: 'Severity', item: b.label, detail: String(b.n) }); });
    s.top.forEach(function (t) { out.push({ section: 'Top risk', item: SEV_LABEL[t.severity] + ' · ' + t.step, detail: t.name + (t.expected ? ' — ' + t.expected : '') }); });
    return out;
  }

  /** A print-ready HTML document: a risk summary, then each step with its edge paths (trigger → expected, severity badge). */
  function documentHtml(model, meta) {
    var m = model || { steps: [], general: [] };
    var mt = meta || {};
    var head = '<div class="ep-meta">Process ' + esc(mt.flow || '—') + (mt.by ? ' · ' + esc(mt.by) : '') + (mt.date ? ' · ' + esc(mt.date) : '')
      + ' · ' + ((m.counts && m.counts.edges) || 0) + ' edge path' + (((m.counts && m.counts.edges) || 0) === 1 ? '' : 's') + '</div>';
    var sm = summary(m);
    var sumHtml = '<section class="ep-sum"><h2>Risk summary</h2><p class="ep-over">' + esc(sm.overview) + '</p>'
      + '<div class="ep-sevs">' + sm.bySeverity.map(function (b) { return '<span class="ep-sev ep-sev--' + b.sev + '">' + b.n + ' ' + esc(b.label.toLowerCase()) + '</span>'; }).join('') + '</div>'
      + (sm.top.length ? '<h3>Top risks</h3><ol class="ep-top">' + sm.top.map(function (t) { return '<li><span class="ep-badge ep-badge--' + t.severity + '">' + esc(SEV_LABEL[t.severity]) + '</span> <b>' + esc(t.name) + '</b> <span class="ep-tstep">(' + esc(t.step) + ')</span>' + (t.expected ? '<div class="ep-exp">' + esc(t.expected) + '</div>' : '') + '</li>'; }).join('') + '</ol>' : '')
      + '</section>';
    var edgeHtml = function (e) {
      return '<li class="ep-edge"><div class="ep-ehead"><span class="ep-badge ep-badge--' + e.severity + '">' + esc(SEV_LABEL[e.severity]) + '</span> <b>' + esc(e.name) + '</b></div>'
        + (e.trigger ? '<div class="ep-row"><span class="ep-k">Trigger</span><span class="ep-v">' + esc(e.trigger) + '</span></div>' : '')
        + (e.expected ? '<div class="ep-row"><span class="ep-k">Expected</span><span class="ep-v">' + esc(e.expected) + '</span></div>' : '')
        + (e.stresses ? '<div class="ep-row"><span class="ep-k">Stresses</span><code class="ep-code">' + esc(e.stresses) + '</code></div>' : '') + '</li>';
    };
    var step = function (title, sub, edges, flowWide) {
      return '<section class="ep-step' + (flowWide ? ' ep-step--flow' : '') + '"><h2>' + esc(title) + ' <span class="ep-n">' + edges.length + ' edge path' + (edges.length === 1 ? '' : 's') + '</span></h2>'
        + (sub ? '<div class="ep-sub">' + esc(sub) + '</div>' : '')
        + (edges.length ? '<ul class="ep-edges">' + edges.map(edgeHtml).join('') + '</ul>' : '<div class="ep-none">No edge paths for this step.</div>') + '</section>';
    };
    var body = sumHtml + (m.steps || []).map(function (s, i) {
      var tag = i === 0 ? 'Start' : (i === (m.steps.length - 1) ? 'End' : 'Step ' + (i + 1));
      return step(tag + ' · ' + s.name, (s.calls && s.calls.length) ? s.calls.length + ' API call' + (s.calls.length === 1 ? '' : 's') : '', s.edges, false);
    }).join('');
    if ((m.general || []).length) body += step('Across the whole flow', 'Edge paths that span the process', m.general, true);
    var css = 'body{font:14px/1.5 system-ui,Segoe UI,Arial,sans-serif;color:#16212c;margin:24px;}h1{font-size:20px;margin:0 0 4px;}'
      + '.ep-meta{color:#5a6876;font-size:12px;margin-bottom:16px;}'
      + '.ep-sum{border:1px solid #e2e7ed;border-radius:10px;padding:12px 16px;margin:0 0 16px;background:#f7f9fc;}.ep-sum h3{font-size:13px;margin:12px 0 4px;color:#1d4f91;}'
      + '.ep-over{margin:0 0 8px;font-weight:600;}.ep-sevs{display:flex;gap:6px;flex-wrap:wrap;}'
      + '.ep-sev{font-size:12px;font-weight:700;border-radius:999px;padding:2px 10px;}'
      + '.ep-sev--high{background:#fdecec;color:#b42318;}.ep-sev--medium{background:#fef3e2;color:#9a5b00;}.ep-sev--low{background:#eef4fc;color:#1d4f91;}'
      + '.ep-top{margin:4px 0 0;padding-left:20px;}.ep-top li{margin:6px 0;}.ep-tstep{color:#5a6876;font-size:12px;}.ep-exp{color:#5a6876;font-size:12.5px;margin:2px 0 0;}'
      + '.ep-step{border:1px solid #e2e7ed;border-radius:10px;padding:12px 16px;margin:0 0 12px;}.ep-step--flow{border-style:dashed;background:#fafbfc;}'
      + 'h2{font-size:15px;margin:0 0 4px;}.ep-n{color:#5a6876;font-weight:400;font-size:12px;}.ep-sub{color:#5a6876;font-size:12px;margin:0 0 8px;}'
      + '.ep-edges{list-style:none;margin:0;padding:0;}.ep-edge{border-top:1px solid #eef1f4;padding:8px 0;}.ep-edge:first-child{border-top:0;}'
      + '.ep-ehead{display:flex;align-items:center;gap:8px;}.ep-badge{font-size:10px;font-weight:700;letter-spacing:.03em;text-transform:uppercase;border-radius:5px;padding:1px 6px;}'
      + '.ep-badge--high{background:#fdecec;color:#b42318;}.ep-badge--medium{background:#fef3e2;color:#9a5b00;}.ep-badge--low{background:#eef4fc;color:#1d4f91;}'
      + '.ep-row{display:flex;gap:8px;margin:2px 0 0 2px;}.ep-k{flex:none;width:72px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.03em;color:#6b7886;padding-top:1px;}'
      + '.ep-v{color:#22303c;}.ep-code{background:#eef4fc;color:#1d4f91;border-radius:4px;padding:1px 6px;font-size:12.5px;}.ep-none{color:#9aa6b2;font-size:12px;}';
    return '<!doctype html><html><head><meta charset="utf-8"><title>' + esc(mt.title || 'Edge paths') + '</title><style>' + css + '</style></head><body>'
      + '<h1>' + esc(mt.title || 'Edge paths') + '</h1>' + head + body + '</body></html>';
  }

  return { pages: pages, prompt: prompt, parse: parse, autoDraft: autoDraft, build: build, hasEdges: hasEdges,
    rows: rows, COLUMNS: COLUMNS, checkRows: checkRows, CHECK_COLUMNS: CHECK_COLUMNS,
    summary: summary, summaryRows: summaryRows, SUM_COLUMNS: SUM_COLUMNS, documentHtml: documentHtml, SYSTEM: SYSTEM };
});
