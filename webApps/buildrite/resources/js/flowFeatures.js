define([], function () {
  'use strict';

  // Features from a Process Flow (flows/insights process-flows → "Features list from the recording"): take the pages a
  // user walked through and the API calls each page made, and draft the product's FEATURE LIST — the user-facing
  // capabilities this process exercises, each with a one-line description and the pages (and their calls) under it. Pure:
  // no page, no DOM, no network. The chain reads the recorded flow, asks the shared Ask AI with the prompt built here,
  // parses the answer and builds the model; or, with no AI, autoDraft makes one feature per page.
  //
  //   pages(flow)            the flow's pages as items: { key:'P1', name, page, calls:[{ method, path, object }] } (assets out)
  //   prompt(flow)           { system, user } — asks the AI to group the pages into features, answer with one ```features
  //                          JSON block: [{ name, description, pageKeys:[…] }]
  //   parse(text)            that block (tolerant of truncation / a {"features":[…]} wrapper) → [{ name, description, pageKeys }]
  //   autoDraft(flow)        the same shape without AI: one feature per page
  //   build(flow, drafted)   the model: { features:[{ name, description, pages:[…], calls:[…], counts }], ungrouped, total, counts }
  //   rows(model) / COLUMNS  flat rows for CSV / Excel
  //   documentHtml(model,m)  a print-ready document (also the PDF / HTML export)

  var S = function (v) { return v == null ? '' : String(v); };
  function esc(s) { return S(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function cut(s, n) { s = S(s); return s.length > n ? s.slice(0, n - 1) + '…' : s; }
  function uniq(a) { var seen = {}; return (a || []).filter(function (x) { var k = S(x); if (seen[k]) return false; seen[k] = 1; return true; }); }
  /** Trim strings and drop blanks / case-insensitive duplicates (keeps the first), capped at `max` (default 12). */
  function cleanCaps(a, max) { var seen = {}; return (Array.isArray(a) ? a : []).map(function (x) { return S(x).trim(); }).filter(function (x) { var k = x.toLowerCase(); if (!x || seen[k]) return false; seen[k] = 1; return true; }).slice(0, max || 12); }

  function recPath(c) { var s = S(c && c.path); if (!s) { s = S(c && c.url).replace(/#.*$/, ''); var q = s.indexOf('?'); s = (q === -1 ? s : s.slice(0, q)).replace(/^[a-z]+:\/\/[^/]+/i, ''); } return s.replace(/[?#].*$/, '').replace(/\/+$/, '') || '/'; }
  /** A captured call that is page scaffolding (a script, style, image, descriptor…), not a business API call. */
  function isAsset(c) {
    if (!c || typeof c !== 'object') return true;
    var u = S(c.url);
    var p = recPath(c);
    if (!p || p === '/') return true;
    // Fusion / OIC REST endpoints are business integrations, not assets (keep them even though their path has /resources/)
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

  /** The flow's pages as items the AI groups: a key, the page name, and its business API calls. */
  function pages(flow) {
    var f = flow && typeof flow === 'object' ? flow : {};
    return (Array.isArray(f.pages) ? f.pages : []).map(function (p, i) {
      var calls = (Array.isArray(p && p.calls) ? p.calls : []).filter(function (c) { return !isAsset(c); })
        .map(function (c) { var path = recPath(c); return { method: S(c.method || 'GET').toUpperCase(), path: path, object: objOf(path) }; });
      return { key: 'P' + (i + 1), name: S(p && (p.name || p.page)) || ('Page ' + (i + 1)), page: S(p && p.page), calls: calls };
    });
  }

  var SYSTEM = [
    'You are a product analyst. You are given the pages a user walks through in one business process, in order, and the API calls each page makes (method, path).',
    'Group the pages into the product\'s FEATURES — the user-facing capabilities this process exercises (for example "Order capture", "Credit check", "Shipment confirmation").',
    'For EACH feature also write its CAPABILITIES: 2 to 6 DISTINCT, plain-English statements of what the application lets a user do — one concrete idea each, in a product-feature voice, for example:',
    '  "The application lets a user raise an internal request by selecting the nearest location."',
    '  "The equipment catalogue shows the equipment available for the selected location."',
    'Ground each capability in the pages and their API calls (e.g. a POST means the user creates or submits something; a GET that loads a list means the screen shows that list). Do not repeat the same capability in two features.',
    'Rules:',
    '- Use ONLY the page keys given. Never invent a page, a key, or a feature that no page supports.',
    '- Put each page under exactly one feature (its best fit). Every page must appear under some feature.',
    '- A feature groups the pages (and their calls) that serve one capability; related pages belong together.',
    '- Name each feature as a short capability (2–5 words, Title Case), not a sentence; write a one-line description, and the capabilities list described above.',
    '- Order features in the order the process flows.',
    'Answer with ONE fenced code block and nothing else:',
    '```features',
    '[{"name":"Feature name","description":"one line","pageKeys":["P1","P2"],"capabilities":["The application lets a user …","The … screen shows …"]}]',
    '```'
  ].join('\n');

  /** { system, user } to draft the feature list from the recorded flow's pages and their calls. */
  function prompt(flow) {
    var f = flow && typeof flow === 'object' ? flow : {};
    var items = pages(f);
    var lines = items.map(function (p) {
      var calls = p.calls.length ? ' — calls: ' + p.calls.slice(0, 10).map(function (c) { return c.method + ' ' + c.path; }).join('; ') + (p.calls.length > 10 ? ' …' : '') : ' — no API calls';
      return p.key + ' [' + cut(p.name, 80) + ']' + calls;
    });
    var user = 'The process "' + (S(f.name) || 'recording') + '" walks through ' + items.length + ' page' + (items.length === 1 ? '' : 's') + ', in order:\n\n'
      + lines.join('\n') + '\n\nReturn only the ```features JSON block, with every page key placed under exactly one feature.';
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
  /** The ```features block (or first JSON array) → [{ name, description, pageKeys }]; tolerant of truncation / a wrapper. */
  function parse(text) {
    var t = S(text);
    var m = /```(?:features|json)?\s*([\s\S]*?)```/i.exec(t);
    var body = m ? m[1] : t;
    var arr = null;
    var a = body.indexOf('['), b = body.lastIndexOf(']');
    if (a !== -1 && b > a) { try { var j = JSON.parse(body.slice(a, b + 1)); if (Array.isArray(j)) arr = j; } catch (e) { /* messy / truncated */ } }
    if (!arr) { try { var o = JSON.parse(body.trim()); if (o && Array.isArray(o.features)) arr = o.features; else if (Array.isArray(o)) arr = o; } catch (e) { /* not clean */ } }
    if (!arr) arr = salvage(body);
    if (!arr || !arr.length) return [];
    return arr.filter(function (f) { return f && typeof f === 'object'; }).map(function (f) {
      return { name: S(f.name).trim(), description: S(f.description).trim(),
        pageKeys: uniq((Array.isArray(f.pageKeys) ? f.pageKeys : (Array.isArray(f.keys) ? f.keys : (Array.isArray(f.pages) ? f.pages : []))).map(function (k) { return S(k).trim().toUpperCase(); }).filter(Boolean)),
        capabilities: cleanCaps(f.capabilities || f.features || f.statements) };
    }).filter(function (f) { return f.name; });
  }

  /** Without AI: one feature per page, its calls under it. */
  function autoDraft(flow) {
    return pages(flow).map(function (p) {
      return { name: p.name, description: 'The ' + p.name + ' screen' + (p.calls.length ? ' and its ' + p.calls.length + ' API call' + (p.calls.length === 1 ? '' : 's') : '') + '.', pageKeys: [p.key] };
    });
  }

  /** The model from the flow and a drafted grouping: features with their real pages (unknown keys dropped), empty ones out; pages placed in no feature gathered as `ungrouped`. */
  function build(flow, drafted) {
    var items = pages(flow);
    var byKey = {};
    items.forEach(function (p) { byKey[p.key.toUpperCase()] = p; });
    var placed = {};
    var features = (Array.isArray(drafted) ? drafted : []).map(function (f) {
      var list = uniq((f.pageKeys || []).map(function (k) { return S(k).toUpperCase(); })).map(function (k) { return byKey[k]; }).filter(Boolean);
      list.forEach(function (p) { placed[p.key] = true; });
      var calls = [];
      list.forEach(function (p) { p.calls.forEach(function (c) { calls.push(Object.assign({ page: p.name }, c)); }); });
      var desc = S(f.description).trim();
      var caps = cleanCaps(f.capabilities);
      if (!caps.length && desc) caps = [desc]; // no capabilities drafted (e.g. Group by page): the one-line description stands in
      return { name: S(f.name).trim() || 'Feature', description: desc, pages: list, calls: calls, capabilities: caps, counts: { pages: list.length, calls: calls.length, capabilities: caps.length } };
    }).filter(function (f) { return f.pages.length; });
    var ungrouped = items.filter(function (p) { return !placed[p.key]; });
    var allCalls = items.reduce(function (n, p) { return n + p.calls.length; }, 0);
    var allCaps = features.reduce(function (n, f) { return n + f.capabilities.length; }, 0);
    return { features: features, ungrouped: ungrouped, total: items.length,
      counts: { features: features.length, pages: Object.keys(placed).length, ungrouped: ungrouped.length, calls: allCalls, capabilities: allCaps } };
  }

  /** The distinct feature statements across the whole model, under their feature (first occurrence wins, case-insensitive). */
  function capList(model) {
    var seen = {};
    return ((model && model.features) || []).map(function (f) {
      var items = (f.capabilities || []).filter(function (c) { var k = S(c).trim().toLowerCase(); if (!k || seen[k]) return false; seen[k] = 1; return true; });
      return { feature: f.name, items: items };
    }).filter(function (g) { return g.items.length; });
  }
  var CAP_COLUMNS = [{ key: 'num', label: '#' }, { key: 'feature', label: 'Feature' }, { key: 'capability', label: 'Capability' }, { key: 'kept', label: 'Kept' }];
  /** Flat rows for the Capabilities CSV / Excel: each distinct statement with its feature and whether it is ticked (`checks`: { "i:j": true }). */
  function capRows(model, checks) {
    var ch = checks || {};
    var out = [];
    var n = 0;
    ((model && model.features) || []).forEach(function (f, i) {
      (f.capabilities || []).forEach(function (c, j) { n++; out.push({ num: n, feature: f.name, capability: c, kept: ch[i + ':' + j] === false ? 'No' : 'Yes' }); });
    });
    return out;
  }

  /** Which system a call's path talks to, for the technical summary. */
  function sysOf(path) {
    var p = S(path);
    if (/xmlpserver|ReportWSSService|bipService/i.test(p)) return 'BI Publisher (reports)';
    if (/mapbox|\/styles\//i.test(p)) return 'Map service';
    if (/\/ic\/api\/integration|\.integration\.|integration\.ocp\.oraclecloud|\/soa-infra\//i.test(p)) return 'Oracle Integration (OIC)';
    if (/\/(fscm|hcm|crm|scm|prc|fin|expenses|atk)RestApi\//i.test(p)) return 'Oracle Fusion REST';
    if (/\/events?(\/|\b|v\d)/i.test(p)) return 'Analytics / telemetry';
    if (/\/ords\//i.test(p)) return 'Oracle APEX (ORDS)';
    return 'Application API';
  }
  // The application's own backend is "internal"; everything else is an inbound/outbound integration with another system.
  var INTERNAL_SYS = { 'Application API': 1, 'Oracle APEX (ORDS)': 1 };
  function isInternalSystem(n) { return !!INTERNAL_SYS[n]; }
  var isWrite = function (m) { return /^(POST|PUT|PATCH|DELETE)$/i.test(S(m)); };
  /** A path's last object as plain words ("customer-refs" → "customer refs"). */
  function humanObj(object) { return S(object).replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim(); }
  /** One technical feature statement for a call, in plain English ("The application fetches customer refs from …"). */
  function techStatement(c) {
    var sys = sysOf(c.path);
    if (/BI Publisher/.test(sys)) return 'The application runs a BI Publisher report.';
    if (/Map service/.test(sys)) return 'The application loads a street map from the map service.';
    if (/Analytics/.test(sys)) return 'The application sends usage analytics / events.';
    var obj = humanObj(c.object) || 'data';
    var m = S(c.method).toUpperCase();
    var short = sys.replace(' REST', '').replace(' (ORDS)', ' (ORDS)');
    if (m === 'GET') return 'The application fetches ' + obj + ' from ' + short + '.';
    if (m === 'POST') return 'The application submits ' + obj + ' to ' + short + '.';
    if (m === 'PUT' || m === 'PATCH') return 'The application updates ' + obj + ' in ' + short + '.';
    if (m === 'DELETE') return 'The application deletes ' + obj + ' in ' + short + '.';
    return 'The application calls ' + obj + ' on ' + short + ' (' + m + ').';
  }
  /**
   * Distinct technical feature statements grouped by system (what the app does over the APIs it calls). With
   * opts.externalOnly, the application's own backend (the eqp APIs) is left out and only the inbound / outbound
   * integrations with other systems (Oracle Fusion, OIC, BI Publisher, the map service, analytics…) are listed.
   */
  function techFeatures(model, opts) {
    var externalOnly = !!(opts && opts.externalOnly);
    var feats = (model && model.features) || [];
    var bySys = {};
    var order = [];
    var seen = {};
    feats.forEach(function (f) {
      (f.calls || []).forEach(function (c) {
        var sys = sysOf(c.path);
        if (externalOnly && isInternalSystem(sys)) return;
        var st = techStatement(c);
        var k = st.toLowerCase();
        if (seen[k]) return;
        seen[k] = 1;
        if (!bySys[sys]) { bySys[sys] = []; order.push(sys); }
        bySys[sys].push(st);
      });
    });
    return order.map(function (s) { return { system: s, items: bySys[s] }; });
  }
  /**
   * A refined, summarised view of the model, in two voices:
   *   functional — one line per feature (the grouping is the consolidation): { name, line, caps, pages }
   *   technical  — flow-level facts: systems and their call counts, reads vs writes, reports, distinct data objects, patterns
   * Plus an `overview` sentence. Derived from the model (no extra AI call), so it is always available.
   */
  function summary(model, opts) {
    var feats = (model && model.features) || [];
    var calls = [];
    feats.forEach(function (f) { (f.calls || []).forEach(function (c) { calls.push(c); }); });
    var sysCount = {};
    var objSeen = {};
    var objs = [];
    var reads = 0, writes = 0, reports = 0, maps = false, events = false;
    calls.forEach(function (c) {
      var s = sysOf(c.path);
      sysCount[s] = (sysCount[s] || 0) + 1;
      if (isWrite(c.method)) writes++; else reads++;
      if (/BI Publisher/.test(s)) reports++;
      if (/Map service/.test(s)) maps = true;
      if (/Analytics/.test(s)) events = true;
      var o = S(c.object).trim();
      if (o && !objSeen[o.toLowerCase()]) { objSeen[o.toLowerCase()] = 1; objs.push(o); }
    });
    var systems = Object.keys(sysCount).sort(function (a, b) { return sysCount[b] - sysCount[a]; }).map(function (n) { return { name: n, calls: sysCount[n] }; });
    var functional = feats.map(function (f) {
      return { name: f.name, line: S(f.description).trim() || S((f.capabilities || [])[0] || '').trim(), caps: (f.capabilities || []).length, pages: (f.pages || []).length };
    });
    var technical = [];
    technical.push({ label: 'Systems', detail: systems.length ? systems.map(function (s) { return s.name + ' (' + s.calls + ')'; }).join(' · ') : 'none recorded' });
    technical.push({ label: 'Operations', detail: reads + ' read' + (reads === 1 ? '' : 's') + ' · ' + writes + ' write' + (writes === 1 ? '' : 's') + (reports ? ' · ' + reports + ' report call' + (reports === 1 ? '' : 's') : '') });
    if (objs.length) technical.push({ label: 'Data objects', detail: objs.slice(0, 16).join(', ') + (objs.length > 16 ? ' …' : '') });
    var notes = [];
    if (reports) notes.push('BI Publisher reports');
    if (maps) notes.push('interactive maps / geolocation');
    if (events) notes.push('usage analytics');
    if (notes.length) technical.push({ label: 'Notable', detail: notes.join(', ') });
    var overview = feats.length + ' feature' + (feats.length === 1 ? '' : 's') + ' across ' + (model && model.total || 0) + ' page' + ((model && model.total) === 1 ? '' : 's')
      + ' and ' + calls.length + ' API call' + (calls.length === 1 ? '' : 's') + ' to ' + systems.length + ' system' + (systems.length === 1 ? '' : 's') + '.';
    return { overview: overview, functional: functional, technical: technical, technicalFeatures: techFeatures(model, opts), systems: systems };
  }
  var SUM_COLUMNS = [{ key: 'section', label: 'Section' }, { key: 'item', label: 'Item' }, { key: 'detail', label: 'Detail' }];
  /** Flat rows for the Summary CSV / Excel: the functional one-liners, the API-derived technical features, and the technical facts. */
  function summaryRows(model, opts) {
    var s = summary(model, opts);
    var out = [{ section: 'Overview', item: '', detail: s.overview }];
    s.functional.forEach(function (f) { out.push({ section: 'Functional feature', item: f.name, detail: f.line }); });
    s.technicalFeatures.forEach(function (g) { g.items.forEach(function (st) { out.push({ section: 'Technical feature', item: g.system, detail: st }); }); });
    s.technical.forEach(function (t) { out.push({ section: 'Technical', item: t.label, detail: t.detail }); });
    return out;
  }

  var COLUMNS = [
    { key: 'feature', label: 'Feature' }, { key: 'description', label: 'Description' }, { key: 'page', label: 'Page' },
    { key: 'method', label: 'Method' }, { key: 'path', label: 'API path' }, { key: 'object', label: 'Object' }
  ];
  /** Flat rows for CSV / Excel: one row per API call under its feature's page (a page with no calls gives one row), plus the ungrouped pages. */
  function rows(model) {
    var out = [];
    ((model && model.features) || []).forEach(function (f) {
      if (!f.pages.length) return;
      f.pages.forEach(function (p) {
        if (p.calls.length) p.calls.forEach(function (c) { out.push({ feature: f.name, description: f.description, page: p.name, method: c.method, path: c.path, object: c.object }); });
        else out.push({ feature: f.name, description: f.description, page: p.name, method: '', path: '', object: '' });
      });
    });
    ((model && model.ungrouped) || []).forEach(function (p) {
      if (p.calls.length) p.calls.forEach(function (c) { out.push({ feature: '(ungrouped)', description: '', page: p.name, method: c.method, path: c.path, object: c.object }); });
      else out.push({ feature: '(ungrouped)', description: '', page: p.name, method: '', path: '', object: '' });
    });
    return out;
  }

  /** A print-ready HTML document: the features, each with its description, pages and their calls; a "not grouped" section. */
  function documentHtml(model, meta) {
    var m = model || { features: [], ungrouped: [] };
    var mt = meta || {};
    var head = '<div class="ff-meta">Process ' + esc(mt.flow || '—') + (mt.by ? ' · ' + esc(mt.by) : '') + (mt.date ? ' · ' + esc(mt.date) : '')
      + ' · ' + ((m.features || []).length) + ' feature' + ((m.features || []).length === 1 ? '' : 's') + ' · ' + (m.total || 0) + ' page' + ((m.total || 0) === 1 ? '' : 's') + '</div>';
    var feat = function (f, ung) {
      var pagesHtml = (f.pages || []).map(function (p) {
        var calls = (p.calls || []).map(function (c) { return '<li><span class="ff-m">' + esc(c.method) + '</span> <code>' + esc(c.path) + '</code>' + (c.object ? ' <span class="ff-o">' + esc(c.object) + '</span>' : '') + '</li>'; }).join('');
        return '<div class="ff-page"><div class="ff-pname">' + esc(p.name) + '</div>' + (calls ? '<ul class="ff-calls">' + calls + '</ul>' : '<div class="ff-nocalls">no API calls</div>') + '</div>';
      }).join('');
      var caps = (f.capabilities || []).length ? '<ol class="ff-caps">' + f.capabilities.map(function (c) { return '<li>' + esc(c) + '</li>'; }).join('') + '</ol>' : '';
      return '<section class="ff-feat' + (ung ? ' ff-feat--ung' : '') + '"><h2>' + esc(f.name) + ' <span class="ff-n">' + (f.pages || []).length + ' page' + ((f.pages || []).length === 1 ? '' : 's') + '</span></h2>'
        + (f.description ? '<p class="ff-desc">' + esc(f.description) + '</p>' : '') + caps + pagesHtml + '</section>';
    };
    // a summary first: an overview, the functional features, and the API-derived technical features
    var sm = summary(m, { externalOnly: !!mt.externalOnly });
    var sumHtml = '<section class="ff-sum"><h2>Summary</h2><p class="ff-over">' + esc(sm.overview) + '</p>'
      + '<h3>Functional features</h3><ul class="ff-fl">' + sm.functional.map(function (f) { return '<li><b>' + esc(f.name) + '</b>' + (f.line ? ' — ' + esc(f.line) : '') + '</li>'; }).join('') + '</ul>'
      + '<h3>Technical features</h3>' + (sm.technicalFeatures.length ? sm.technicalFeatures.map(function (g) { return '<div class="ff-tg"><div class="ff-tgs">' + esc(g.system) + '</div><ul class="ff-tl">' + g.items.map(function (st) { return '<li>' + esc(st) + '</li>'; }).join('') + '</ul></div>'; }).join('') : '<p class="ff-nocalls">no API calls recorded</p>')
      + '<h3>At a glance</h3><ul class="ff-tech">' + sm.technical.map(function (t) { return '<li><b>' + esc(t.label) + ':</b> ' + esc(t.detail) + '</li>'; }).join('') + '</ul></section>';
    var body = sumHtml + (m.features || []).map(function (f) { return feat(f, false); }).join('');
    if ((m.ungrouped || []).length) body += feat({ name: 'Not grouped (' + m.ungrouped.length + ')', description: 'Pages in no feature.', pages: m.ungrouped }, true);
    var css = 'body{font:14px/1.5 system-ui,Segoe UI,Arial,sans-serif;color:#16212c;margin:24px;}h1{font-size:20px;margin:0 0 4px;}'
      + '.ff-sum{border:1px solid #e2e7ed;border-radius:10px;padding:12px 16px;margin:0 0 16px;background:#f7f9fc;}.ff-sum h3{font-size:13px;margin:12px 0 4px;color:#1d4f91;}'
      + '.ff-over{margin:0 0 4px;font-weight:600;}.ff-fl,.ff-tl,.ff-tech{margin:2px 0 0;padding-left:18px;}.ff-fl li,.ff-tl li,.ff-tech li{margin:2px 0;}'
      + '.ff-tg{margin:4px 0;}.ff-tgs{font-weight:600;font-size:12px;color:#5a6876;}'
      + '.ff-meta{color:#5a6876;font-size:12px;margin-bottom:16px;}.ff-feat{border:1px solid #e2e7ed;border-radius:10px;padding:12px 16px;margin:0 0 12px;}'
      + '.ff-feat--ung{border-style:dashed;background:#fafbfc;}h2{font-size:15px;margin:0 0 4px;}.ff-n{color:#5a6876;font-weight:400;font-size:12px;}'
      + '.ff-desc{color:#5a6876;margin:0 0 8px;}.ff-page{margin:6px 0;}.ff-pname{font-weight:600;}.ff-calls{margin:2px 0 0;padding-left:18px;}'
      + '.ff-calls code{background:#eef4fc;color:#1d4f91;border-radius:4px;padding:1px 5px;}.ff-m{font-weight:700;color:#1d4f91;font-size:12px;}'
      + '.ff-o{color:#5a6876;font-size:12px;}.ff-nocalls{color:#9aa6b2;font-size:12px;}'
      + '.ff-caps{margin:0 0 8px;padding-left:20px;}.ff-caps li{margin:2px 0;}';
    return '<!doctype html><html><head><meta charset="utf-8"><title>' + esc(mt.title || 'Feature list') + '</title><style>' + css + '</style></head><body>'
      + '<h1>' + esc(mt.title || 'Feature list') + '</h1>' + head + body + '</body></html>';
  }

  return { pages: pages, prompt: prompt, parse: parse, autoDraft: autoDraft, build: build, rows: rows, COLUMNS: COLUMNS,
    capList: capList, capRows: capRows, CAP_COLUMNS: CAP_COLUMNS, summary: summary, summaryRows: summaryRows, SUM_COLUMNS: SUM_COLUMNS,
    techFeatures: techFeatures, documentHtml: documentHtml, SYSTEM: SYSTEM };
});
