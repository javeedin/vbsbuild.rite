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

  function recPath(c) { var s = S(c && c.path); if (!s) { s = S(c && c.url).replace(/#.*$/, ''); var q = s.indexOf('?'); s = (q === -1 ? s : s.slice(0, q)).replace(/^[a-z]+:\/\/[^/]+/i, ''); } return s.replace(/[?#].*$/, '').replace(/\/+$/, '') || '/'; }
  /** A captured call that is page scaffolding (a script, style, image, descriptor…), not a business API call. */
  function isAsset(c) {
    if (!c || typeof c !== 'object') return true;
    var u = S(c.url);
    var p = recPath(c);
    if (!p || p === '/') return true;
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
    'Rules:',
    '- Use ONLY the page keys given. Never invent a page, a key, or a feature that no page supports.',
    '- Put each page under exactly one feature (its best fit). Every page must appear under some feature.',
    '- A feature groups the pages (and their calls) that serve one capability; related pages belong together.',
    '- Name each feature as a short capability (2–5 words, Title Case), not a sentence; write a one-line plain-English description of what it lets a user do, grounded in the pages and their calls.',
    '- Order features in the order the process flows.',
    'Answer with ONE fenced code block and nothing else:',
    '```features',
    '[{"name":"Feature name","description":"one line","pageKeys":["P1","P2"]}]',
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
        pageKeys: uniq((Array.isArray(f.pageKeys) ? f.pageKeys : (Array.isArray(f.keys) ? f.keys : (Array.isArray(f.pages) ? f.pages : []))).map(function (k) { return S(k).trim().toUpperCase(); }).filter(Boolean)) };
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
      return { name: S(f.name).trim() || 'Feature', description: S(f.description).trim(), pages: list, calls: calls, counts: { pages: list.length, calls: calls.length } };
    }).filter(function (f) { return f.pages.length; });
    var ungrouped = items.filter(function (p) { return !placed[p.key]; });
    var allCalls = items.reduce(function (n, p) { return n + p.calls.length; }, 0);
    return { features: features, ungrouped: ungrouped, total: items.length,
      counts: { features: features.length, pages: Object.keys(placed).length, ungrouped: ungrouped.length, calls: allCalls } };
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
      return '<section class="ff-feat' + (ung ? ' ff-feat--ung' : '') + '"><h2>' + esc(f.name) + ' <span class="ff-n">' + (f.pages || []).length + ' page' + ((f.pages || []).length === 1 ? '' : 's') + '</span></h2>'
        + (f.description ? '<p class="ff-desc">' + esc(f.description) + '</p>' : '') + pagesHtml + '</section>';
    };
    var body = (m.features || []).map(function (f) { return feat(f, false); }).join('');
    if ((m.ungrouped || []).length) body += feat({ name: 'Not grouped (' + m.ungrouped.length + ')', description: 'Pages in no feature.', pages: m.ungrouped }, true);
    var css = 'body{font:14px/1.5 system-ui,Segoe UI,Arial,sans-serif;color:#16212c;margin:24px;}h1{font-size:20px;margin:0 0 4px;}'
      + '.ff-meta{color:#5a6876;font-size:12px;margin-bottom:16px;}.ff-feat{border:1px solid #e2e7ed;border-radius:10px;padding:12px 16px;margin:0 0 12px;}'
      + '.ff-feat--ung{border-style:dashed;background:#fafbfc;}h2{font-size:15px;margin:0 0 4px;}.ff-n{color:#5a6876;font-weight:400;font-size:12px;}'
      + '.ff-desc{color:#5a6876;margin:0 0 8px;}.ff-page{margin:6px 0;}.ff-pname{font-weight:600;}.ff-calls{margin:2px 0 0;padding-left:18px;}'
      + '.ff-calls code{background:#eef4fc;color:#1d4f91;border-radius:4px;padding:1px 5px;}.ff-m{font-weight:700;color:#1d4f91;font-size:12px;}'
      + '.ff-o{color:#5a6876;font-size:12px;}.ff-nocalls{color:#9aa6b2;font-size:12px;}';
    return '<!doctype html><html><head><meta charset="utf-8"><title>' + esc(mt.title || 'Feature list') + '</title><style>' + css + '</style></head><body>'
      + '<h1>' + esc(mt.title || 'Feature list') + '</h1>' + head + body + '</body></html>';
  }

  return { pages: pages, prompt: prompt, parse: parse, autoDraft: autoDraft, build: build, rows: rows, COLUMNS: COLUMNS, documentHtml: documentHtml, SYSTEM: SYSTEM };
});
