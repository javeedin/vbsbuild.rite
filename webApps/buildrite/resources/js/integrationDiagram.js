define([], function () {
  'use strict';

  // Integration diagrams (Application → Integrations), drawn as SVG from the scan (desktop/lib/integrations.js) — pure
  // (no DOM): the same picture in the page, in the PDF and saved as .svg.
  //
  //   landscape(m)      the app's flows (the source) → the systems they call (the targets); a line's thickness = calls
  //   system(m, id)     one system: the pages that call it → its endpoints (method, path) → the system
  //   page(m, id)       one page's integration flow: the page → what sets each call off (the page opening, a button…)
  //                     → what it calls, in the order its code calls it → the systems (pageBasic: the plain version,
  //                     for a scan without pageFlows)
  //   pages(m)          every page with calls → the systems it calls (grouped by flow); a line's thickness = calls
  //   pageFlow(m, id, { plain })  one page's flow in swimlanes (flowSwim(pageModel(m, id))): a lane for the page and one per system; each action starts at what
  //                     sets it off and goes down step by step, each call in the lane of the system it calls (Oracle
  //                     Fusion · GET Items → the app's backend · POST Items); a darker arrow = it moves on to another system;
  //                     plain: every call as a sentence ("Reads the list of projects from Oracle Fusion"), what sets it
  //                     off in words ("When the user clicks "Fetch"") — for a business reader
  //   flowSwim(model, { plain })  the same drawing for any flow model (a saved, edited flow: steps added by hand, notes)
  //   plainStep(call) / plainTrigger(text) / objectPhrase(object)  the plain-English wording
  //   systemFlow(m)     between systems, not page by page: the app ⇄ each system — what the app sends it (writes),
  //                     what it returns (reads) and the reports it runs, by business object
  //   journeys(m)       cross-system flows: each action that calls two or more systems, its systems in order
  //   each → { svg, w, h, title }     doc(d) → a small HTML document showing it (for a sandboxed iframe)
  //   KINDS: a system's kind → its colour and name (the categorical order: blue, orange, aqua, yellow, magenta, green,
  //   violet, red — identity is never colour alone: every box says its kind)

  var KINDS = {
    fusion: { color: '#2a78d6', label: 'Oracle Fusion Cloud' }, oic: { color: '#eb6834', label: 'Oracle Integration Cloud' },
    bip: { color: '#1baf7a', label: 'Oracle BI Publisher' }, ords: { color: '#eda100', label: 'Oracle APEX / ORDS' },
    jira: { color: '#e87ba4', label: 'Jira' }, rest: { color: '#6250d6', label: 'REST service' },
    bo: { color: '#008300', label: 'VB Business Objects' }, unknown: { color: '#e34948', label: 'Not resolved' }
  };
  var DIR = { Read: { fill: '#e6f0fc', ink: '#1d4f91' }, Write: { fill: '#fdeee6', ink: '#a8461b' }, Report: { fill: '#e3f6ef', ink: '#11704b' } };
  var FONT = "Inter, 'Segoe UI', Roboto, Arial, sans-serif";
  var MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  /** Cut to about `px` wide at `size` px (a rough average width), with an ellipsis. */
  function fit(s, px, size, mono) {
    var t = String(s == null ? '' : s), per = (size || 12) * (mono ? 0.61 : 0.56), max = Math.max(4, Math.floor(px / per));
    return t.length > max ? t.slice(0, max - 1) + '…' : t;
  }
  var kindOf = function (k) { return KINDS[k] || KINDS.rest; };
  var n = function (x, one, many) { return x + ' ' + (x === 1 ? one : (many || one + 's')); };
  /** A system's figures in words, the zero ones left out. */
  function figures(s) {
    return [n(s.calls, 'call'), s.reads ? n(s.reads, 'read') : '', s.writes ? n(s.writes, 'write') : '', s.reports ? n(s.reports, 'report') : '', n((s.endpoints || []).length, 'endpoint')].filter(Boolean).join(' · ');
  }
  function text(x, y, s, o) {
    var p = o || {};
    return '<text x="' + x + '" y="' + y + '" font-family="' + (p.mono ? MONO : FONT) + '" font-size="' + (p.size || 12) + '"' + (p.weight ? ' font-weight="' + p.weight + '"' : '') + ' fill="' + (p.fill || '#16212c') + '"'
      + (p.anchor ? ' text-anchor="' + p.anchor + '"' : '') + '>' + esc(s) + '</text>';
  }
  function box(x, y, w, h, o) {
    var p = o || {};
    return '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="' + (p.r == null ? 8 : p.r) + '" fill="' + (p.fill || '#ffffff') + '" stroke="' + (p.stroke || '#d5dde5') + '" stroke-width="' + (p.sw || 1) + '"/>';
  }
  /** A curve from (x1,y1) to (x2,y2), leaving and arriving level. */
  function curve(x1, y1, x2, y2, o) {
    var p = o || {}, d = Math.max(40, (x2 - x1) * 0.45);
    return '<path d="M' + x1 + ' ' + y1 + ' C' + (x1 + d) + ' ' + y1 + ' ' + (x2 - d) + ' ' + y2 + ' ' + x2 + ' ' + y2 + '" fill="none" stroke="' + (p.color || '#9aa6b2') + '" stroke-width="' + (p.w || 1.5)
      + '" stroke-opacity="' + (p.op || 0.7) + '" stroke-linecap="round"' + (p.marker ? ' marker-end="url(#' + p.marker + ')"' : '') + '>' + (p.title ? '<title>' + esc(p.title) + '</title>' : '') + '</path>';
  }
  /** n points spread inside [top, top + h], keeping clear of the corners. */
  function spread(n, top, h) { var out = [], pad = Math.min(14, h / 4); for (var i = 0; i < n; i++) out.push(n === 1 ? top + h / 2 : top + pad + (h - 2 * pad) * (i / (n - 1))); return out; }
  function arrowDefs(colors) {
    return '<defs>' + colors.map(function (c, i) { return '<marker id="ar' + i + '" viewBox="0 0 10 10" refX="9" refY="5" markerUnits="userSpaceOnUse" markerWidth="9" markerHeight="9" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="' + c + '"/></marker>'; }).join('') + '</defs>';
  }
  function legend(kinds, y, w, extra) {
    var x = 24, out = [];
    kinds.forEach(function (k) {
      var K = kindOf(k), label = K.label;
      out.push('<rect x="' + x + '" y="' + (y - 9) + '" width="10" height="10" rx="2" fill="' + K.color + '"/>' + text(x + 15, y, label, { size: 11, fill: '#3b4a58' }));
      x += 26 + label.length * 6.2;
      if (x > w - 160) { x = 24; y += 18; }
    });
    if (extra) out.push(text(Math.max(x, 24), y, extra, { size: 11, fill: '#6b7889' }));
    return { svg: out.join(''), y: y };
  }
  function wrap(w, h, body, title) {
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '" role="img" aria-label="' + esc(title) + '">'
      + '<rect width="' + w + '" height="' + h + '" fill="#ffffff"/>' + body + '</svg>';
  }

  /** The app's flows → the systems they call. */
  function landscape(m) {
    var W = 1100, LX = 24, LW = 310, RX = 740, RW = 336, top = 46;
    var flows = (m.flows || []).filter(function (f) { return f.calls > 0; });
    var systems = m.systems || [];
    var FH = 52, FG = 10, SH = 66, SG = 12;
    var leftH = flows.length * (FH + FG) - FG, rightH = systems.length * (SH + SG) - SG;
    var H0 = Math.max(leftH + 40, rightH);
    var fy = {}, sy = {};
    var lTop = top + Math.max(0, (H0 - leftH - 40) / 2), rTop = top + Math.max(0, (H0 - rightH) / 2);
    flows.forEach(function (f, i) { fy[f.flow] = lTop + 30 + i * (FH + FG); });
    systems.forEach(function (s, i) { sy[s.id] = rTop + i * (SH + SG); });
    var max = (m.matrix || []).reduce(function (a, x) { return Math.max(a, x.calls); }, 1);
    var colors = systems.map(function (s) { return kindOf(s.kind).color; });
    var out = [arrowDefs(colors)];
    out.push(text(LX, 24, (m.appName || m.app) + ' — the app (source)', { size: 13, weight: 700, fill: '#3b4a58' }));
    out.push(text(RX, 24, 'The systems it calls (target)', { size: 13, weight: 700, fill: '#3b4a58' }));
    // the app around its flows
    out.push(box(LX, lTop, LW, leftH + 40, { fill: '#f6f9fb', stroke: '#c9d6e0', r: 12 }));
    out.push(text(LX + 14, lTop + 20, fit(m.appName || m.app, LW - 28, 12), { size: 12, weight: 700, fill: '#00506c' }));
    // the edges first (under the boxes): each flow's out-points and each system's in-points, ordered to cross less
    var edges = (m.matrix || []).filter(function (x) { return fy[x.flow] != null && sy[x.system] != null; });
    var outs = {}, ins = {};
    edges.forEach(function (e) { (outs[e.flow] = outs[e.flow] || []).push(e); (ins[e.system] = ins[e.system] || []).push(e); });
    var pt = {};
    Object.keys(outs).forEach(function (f) { var es = outs[f].slice().sort(function (a, b) { return sy[a.system] - sy[b.system]; }); var ys = spread(es.length, fy[f], FH); es.forEach(function (e, i) { pt[e.flow + '|' + e.system] = { y1: ys[i] }; }); });
    Object.keys(ins).forEach(function (s) { var es = ins[s].slice().sort(function (a, b) { return fy[a.flow] - fy[b.flow]; }); var ys = spread(es.length, sy[s], SH); es.forEach(function (e, i) { pt[e.flow + '|' + e.system].y2 = ys[i]; }); });
    edges.forEach(function (e) {
      var s = systems.filter(function (x) { return x.id === e.system; })[0];
      var p = pt[e.flow + '|' + e.system];
      out.push(curve(LX + LW - 12, p.y1, RX - 2, p.y2, { color: kindOf(s.kind).color, w: 1.5 + 6 * (e.calls / max), op: 0.55, marker: 'ar' + systems.indexOf(s),
        title: e.flow + ' → ' + s.name + ': ' + figures({ calls: e.calls, reads: e.reads, writes: e.writes, reports: e.reports, endpoints: [] }).replace(/ · 0 endpoints$/, '') }));
    });
    flows.forEach(function (f) {
      var y = fy[f.flow];
      out.push('<g><title>' + esc(f.flow + ': ' + f.pages.length + ' pages with calls, ' + f.calls + ' calls') + '</title>' + box(LX + 12, y, LW - 24, FH, { stroke: '#c9d6e0' })
        + text(LX + 26, y + 21, fit(f.flow, LW - 52, 13), { size: 13, weight: 700 }) + text(LX + 26, y + 39, f.pages.length + ' page' + (f.pages.length === 1 ? '' : 's') + ' · ' + f.calls + ' call' + (f.calls === 1 ? '' : 's'), { size: 11, fill: '#5b6876' }) + '</g>');
    });
    systems.forEach(function (s) {
      var y = sy[s.id], K = kindOf(s.kind);
      out.push('<g><title>' + esc(s.name + ' — ' + s.kindLabel + (s.url ? ' · ' + s.url : '') + (s.auth ? ' · signs in: ' + s.auth : '')) + '</title>' + box(RX, y, RW, SH)
        + '<rect x="' + RX + '" y="' + y + '" width="6" height="' + SH + '" rx="3" fill="' + K.color + '"/>'
        + text(RX + 18, y + 20, fit(s.name, RW - 32, 13), { size: 13, weight: 700 })
        + text(RX + 18, y + 37, fit(s.kindLabel + (s.host ? ' · ' + s.host : ''), RW - 32, 11), { size: 11, fill: '#5b6876' })
        + text(RX + 18, y + 54, figures(s), { size: 11, fill: '#26323e' }) + '</g>');
    });
    var kinds = systems.map(function (s) { return s.kind; }).filter(function (k, i, a) { return a.indexOf(k) === i; });
    var lg = legend(kinds, top + H0 + 34, W, 'A line\'s thickness: the number of calls.');
    out.push(lg.svg);
    var H = lg.y + 18;
    return { svg: wrap(W, H, out.join(''), 'Integration landscape'), w: W, h: H, title: 'Integration landscape' };
  }

  var MAX_ROWS = 60;
  /** The folders every path starts with (two or more), e.g. /fscmRestApi/resources/11.13.18.05 — said once, not on each row. */
  function commonPrefix(paths) {
    var parts = paths.filter(Boolean).map(function (p) { return String(p).split('/'); });
    if (parts.length < 2) return '';
    var out = [];
    for (var i = 0; i < parts[0].length - 1; i++) {
      var seg = parts[0][i];
      if (!parts.every(function (x) { return x.length - 1 > i && x[i] === seg; })) break;
      out.push(seg);
    }
    var pre = out.join('/');
    return out.filter(Boolean).length >= 2 ? pre : '';
  }
  var short = function (path, pre) { return pre && String(path).indexOf(pre + '/') === 0 ? '…' + String(path).slice(pre.length) : path; };
  function badge(x, y, r) {
    var D = DIR[r.direction] || DIR.Read, label = String(r.method || r.direction || '').toUpperCase().slice(0, 6);
    return '<rect x="' + x + '" y="' + (y - 11) + '" width="52" height="18" rx="9" fill="' + D.fill + '"/>' + text(x + 26, y + 2, label, { size: 10, weight: 700, fill: D.ink, anchor: 'middle', mono: true });
  }

  /** One system: the pages that call it → its endpoints → the system. */
  function system(m, id) {
    var s = (m.systems || []).filter(function (x) { return x.id === id; })[0];
    if (!s) return { svg: '', w: 0, h: 0, title: '' };
    var K = kindOf(s.kind);
    var all = (m.endpoints || []).filter(function (e) { return e.system === id; });
    var eps = all.slice(0, MAX_ROWS);
    var more = all.length - eps.length;
    var pageIds = [];
    eps.forEach(function (e) { e.pages.forEach(function (p) { if (pageIds.indexOf(p) === -1) pageIds.push(p); }); });
    // each page placed by the average row of the endpoints it calls: fewer lines cross
    var at = {};
    pageIds.forEach(function (p) { var rows = []; eps.forEach(function (e, i) { if (e.pages.indexOf(p) !== -1) rows.push(i); }); at[p] = rows.reduce(function (a, b) { return a + b; }, 0) / rows.length; });
    pageIds.sort(function (a, b) { return at[a] - at[b]; });
    var pre = commonPrefix(eps.map(function (e) { return e.path; }));
    var labelOf = {};
    (m.pages || []).forEach(function (p) { labelOf[p.id] = p.label; });
    var W = 1100, PX = 24, PW = 250, EX = 360, EW = 470, SX = 900, SW = 176, top = 46, EH = 30, EG = 6, PH = 30, PG = 6;
    var eTop = top, eH = eps.length * (EH + EG) - EG + (more ? EH + EG : 0);
    var pH = pageIds.length * (PH + PG) - PG;
    var H0 = Math.max(eH, pH, 90);
    var pTop = top + Math.max(0, (H0 - pH) / 2);
    var ey = {}, py = {};
    eps.forEach(function (e, i) { ey[e.endpoint] = eTop + i * (EH + EG); });
    pageIds.forEach(function (p, i) { py[p] = pTop + i * (PH + PG); });
    var sH = Math.max(80, Math.min(H0, 160)), sTop = top + (H0 - sH) / 2;
    var out = [arrowDefs([K.color, '#9aa6b2'])];
    out.push(text(PX, 24, 'Pages that call it', { size: 13, weight: 700, fill: '#3b4a58' }));
    out.push(text(EX, 24, 'Its endpoints (' + all.length + ')', { size: 13, weight: 700, fill: '#3b4a58' }));
    if (pre) out.push(text(EX + 150, 24, fit('under ' + pre, EW - 150, 11, true), { size: 11, fill: '#6b7889', mono: true }));
    out.push(text(SX, 24, 'The system', { size: 13, weight: 700, fill: '#3b4a58' }));
    eps.forEach(function (e) {
      e.pages.forEach(function (p) { if (py[p] != null) out.push(curve(PX + PW, py[p] + PH / 2, EX - 2, ey[e.endpoint] + EH / 2, { color: '#9aa6b2', w: 1.2, op: 0.6, marker: 'ar1', title: (labelOf[p] || p) + ' → ' + e.method + ' ' + e.path })); });
      out.push(curve(EX + EW, ey[e.endpoint] + EH / 2, SX - 2, sTop + sH / 2, { color: K.color, w: 1.2, op: 0.45, marker: 'ar0' }));
    });
    pageIds.forEach(function (p) {
      out.push('<g><title>' + esc((labelOf[p] || p) + ' (' + p + ')') + '</title>' + box(PX, py[p], PW, PH) + text(PX + 12, py[p] + 19, fit(labelOf[p] || p, PW - 24, 12), { size: 12, weight: 600 }) + '</g>');
    });
    eps.forEach(function (e) {
      var y = ey[e.endpoint];
      out.push('<g><title>' + esc(e.method + ' ' + e.path + (e.summary ? ' — ' + e.summary : '') + ' · ' + e.pages.length + ' page(s)') + '</title>' + box(EX, y, EW, EH) + badge(EX + 8, y + EH / 2, e)
        + text(EX + 68, y + 19, fit(short(e.path || e.endpoint, pre), EW - 120, 11.5, true), { size: 11.5, mono: true }) + text(EX + EW - 10, y + 19, String(e.pages.length), { size: 11, fill: '#6b7889', anchor: 'end' }) + '</g>');
    });
    if (more) out.push(box(EX, eTop + eps.length * (EH + EG), EW, EH, { fill: '#f6f8fa', stroke: '#e1e7ee' }) + text(EX + EW / 2, eTop + eps.length * (EH + EG) + 19, '+ ' + more + ' more endpoints (all of them are in the data sheet)', { size: 11.5, fill: '#5b6876', anchor: 'middle' }));
    out.push('<g><title>' + esc(s.name + (s.url ? ' · ' + s.url : '')) + '</title>' + box(SX, sTop, SW, sH, { stroke: K.color, sw: 2, r: 12 }) + '<rect x="' + SX + '" y="' + sTop + '" width="' + SW + '" height="8" rx="4" fill="' + K.color + '"/>'
      + text(SX + SW / 2, sTop + 32, fit(s.name, SW - 16, 13), { size: 13, weight: 700, anchor: 'middle' }) + text(SX + SW / 2, sTop + 50, fit(s.kindLabel, SW - 16, 11), { size: 11, fill: '#5b6876', anchor: 'middle' })
      + text(SX + SW / 2, sTop + 68, fit(s.host || '', SW - 16, 10.5, true), { size: 10.5, fill: '#5b6876', anchor: 'middle', mono: true }) + '</g>');
    var y0 = top + H0 + 30;
    var lg = legend([], y0, W, '');
    out.push(['Read', 'Write', 'Report'].map(function (d, i) { var D = DIR[d]; return '<rect x="' + (24 + i * 90) + '" y="' + (y0 - 11) + '" width="16" height="14" rx="7" fill="' + D.fill + '"/>' + text(24 + i * 90 + 22, y0, d, { size: 11, fill: D.ink, weight: 600 }); }).join('')
      + text(300, y0, 'The number on an endpoint: the pages that call it.', { size: 11, fill: '#6b7889' }));
    var H = lg.y + 18;
    return { svg: wrap(W, H, out.join(''), s.name), w: W, h: H, title: s.name };
  }

  /** One page: the page → the endpoints it calls → their systems (the plain version). */
  function pageBasic(m, id) {
    var rows = (m.rows || []).filter(function (r) { return r.page === id; });
    var p = (m.pages || []).filter(function (x) { return x.id === id; })[0] || { id: id, label: id };
    var eps = [];
    rows.forEach(function (r) { if (!eps.some(function (e) { return e.endpoint === r.endpoint && e.system === r.system; })) eps.push(r); });
    eps = eps.slice(0, MAX_ROWS);
    var sysIds = [];
    eps.forEach(function (e) { if (sysIds.indexOf(e.system) === -1) sysIds.push(e.system); });
    eps.sort(function (a, b) { return sysIds.indexOf(a.system) - sysIds.indexOf(b.system) || a.path.localeCompare(b.path); });
    var systems = sysIds.map(function (sid) { return (m.systems || []).filter(function (s) { return s.id === sid; })[0]; }).filter(Boolean);
    var W = 1100, PX = 24, PW = 220, EX = 330, EW = 470, SX = 870, SW = 206, top = 46, EH = 30, EG = 6, SH = 66, SG = 14;
    var eH = Math.max(1, eps.length) * (EH + EG) - EG, sH = systems.length * (SH + SG) - SG;
    var H0 = Math.max(eH, sH, 80);
    var ey = {}, sy = {};
    eps.forEach(function (e, i) { ey[e.system + '|' + e.endpoint] = top + i * (EH + EG); });
    var sTop = top + Math.max(0, (H0 - sH) / 2);
    systems.forEach(function (s, i) { sy[s.id] = sTop + i * (SH + SG); });
    var pH = Math.min(Math.max(70, H0), 140), pTop = top + (H0 - pH) / 2;
    var colors = systems.map(function (s) { return kindOf(s.kind).color; });
    var pre = commonPrefix(eps.map(function (e) { return e.path; }));
    var out = [arrowDefs(colors.concat(['#9aa6b2']))];
    out.push(text(PX, 24, 'The page', { size: 13, weight: 700, fill: '#3b4a58' }));
    out.push(text(EX, 24, 'What it calls (' + eps.length + ')', { size: 13, weight: 700, fill: '#3b4a58' }));
    if (pre) out.push(text(EX + 130, 24, fit('under ' + pre, EW - 130, 11, true), { size: 11, fill: '#6b7889', mono: true }));
    out.push(text(SX, 24, 'The systems', { size: 13, weight: 700, fill: '#3b4a58' }));
    eps.forEach(function (e) {
      var y = ey[e.system + '|' + e.endpoint] + EH / 2;
      out.push(curve(PX + PW, pTop + pH / 2, EX - 2, y, { color: '#9aa6b2', w: 1.2, op: 0.6, marker: 'ar' + colors.length, title: e.trigger ? 'set off by ' + e.trigger : '' }));
      var si = sysIds.indexOf(e.system);
      if (sy[e.system] != null) out.push(curve(EX + EW, y, SX - 2, sy[e.system] + SH / 2, { color: colors[si], w: 1.4, op: 0.55, marker: 'ar' + si }));
    });
    out.push('<g><title>' + esc(p.label + ' (' + p.id + ')') + '</title>' + box(PX, pTop, PW, pH, { stroke: '#2e6fd8', sw: 2, r: 12 }) + text(PX + PW / 2, pTop + pH / 2 - 4, fit(p.label, PW - 20, 13), { size: 13, weight: 700, anchor: 'middle' })
      + text(PX + PW / 2, pTop + pH / 2 + 14, fit(p.id, PW - 20, 10.5, true), { size: 10.5, fill: '#5b6876', anchor: 'middle', mono: true }) + '</g>');
    eps.forEach(function (e) {
      var y = ey[e.system + '|' + e.endpoint];
      out.push('<g><title>' + esc(e.method + ' ' + e.path + (e.summary ? ' — ' + e.summary : '') + (e.trigger ? ' · set off by ' + e.trigger : '')) + '</title>' + box(EX, y, EW, EH) + badge(EX + 8, y + EH / 2, e)
        + text(EX + 68, y + 19, fit(short(e.path || e.endpoint, pre), EW - 80, 11.5, true), { size: 11.5, mono: true }) + '</g>');
    });
    systems.forEach(function (s) {
      var y = sy[s.id], K = kindOf(s.kind);
      out.push('<g><title>' + esc(s.name + (s.url ? ' · ' + s.url : '')) + '</title>' + box(SX, y, SW, SH) + '<rect x="' + SX + '" y="' + y + '" width="6" height="' + SH + '" rx="3" fill="' + K.color + '"/>'
        + text(SX + 16, y + 22, fit(s.name, SW - 26, 13), { size: 13, weight: 700 }) + text(SX + 16, y + 40, fit(s.kindLabel, SW - 26, 11), { size: 11, fill: '#5b6876' })
        + text(SX + 16, y + 56, fit(s.host || '', SW - 26, 10.5, true), { size: 10.5, fill: '#5b6876', mono: true }) + '</g>');
    });
    if (!eps.length) out.push(text(EX, top + 40, 'This page calls no web service.', { size: 13, fill: '#6b7889' }));
    var y0 = top + H0 + 30;
    out.push(['Read', 'Write', 'Report'].map(function (d, i) { var D = DIR[d]; return '<rect x="' + (24 + i * 90) + '" y="' + (y0 - 11) + '" width="16" height="14" rx="7" fill="' + D.fill + '"/>' + text(24 + i * 90 + 22, y0, d, { size: 11, fill: D.ink, weight: 600 }); }).join(''));
    var H = y0 + 18;
    return { svg: wrap(W, H, out.join(''), p.label), w: W, h: H, title: p.label };
  }

  // which way data goes between the app and a system: what the app sends (writes), what comes back (reads, reports)
  var LANES = [
    { key: 'sends', verb: 'Sends', out: true, ink: '#a8461b', tip: 'the app sends (writes)' },
    { key: 'returns', verb: 'Returns', out: false, ink: '#1d4f91', tip: 'the system returns (reads)' },
    { key: 'reports', verb: 'Reports', out: false, ink: '#11704b', tip: 'BI Publisher reports the app runs' }
  ];
  /** Items joined with " · " to about `px` wide, "+n more" for the rest. */
  function listFit(items, px, size) {
    var per = (size || 12) * 0.56, out = '', shown = 0;
    for (var i = 0; i < items.length; i++) {
      var next = (out ? out + ' · ' : '') + items[i];
      var room = px - (items.length - i - 1 ? 70 : 0);
      if (next.length * per > room) { if (!shown) { out = fit(items[i], room, size); shown = 1; } break; }
      out = next; shown++;
    }
    return out + (items.length > shown ? ' +' + (items.length - shown) + ' more' : '');
  }
  function lane(x, y, w, verb, ink, list, title) {
    return '<g><title>' + esc(title) + '</title><text x="' + x + '" y="' + y + '" font-family="' + FONT + '" font-size="12" fill="#26323e"><tspan font-weight="700" fill="' + ink + '">' + esc(verb) + '</tspan> '
      + esc(list) + '</text></g>';
  }

  /** Between systems: the app ⇄ each system, what goes each way, by business object. */
  function systemFlow(m) {
    var W = 1100, AX = 24, AW = 218, SX = 852, SW = 224, MX = AX + AW, top = 50, RH = 30, LG = 16;
    var flows = (m.systemFlows || []).filter(function (s) { return s.interfaces; });
    var lanes = flows.map(function (s) { var rows = LANES.filter(function (L) { return (s[L.key] || []).length; }); return { s: s, rows: rows, h: Math.max(76, rows.length * RH + 24) }; });
    var y = top;
    lanes.forEach(function (l) { l.y = y; y += l.h + LG; });
    var H0 = Math.max(90, y - top - LG);
    var out = [arrowDefs(LANES.map(function (L) { return L.ink; }))];
    out.push(text(AX, 26, 'The app', { size: 13, weight: 700, fill: '#3b4a58' }));
    out.push(text(MX + 30, 26, 'What goes between them (by business object)', { size: 13, weight: 700, fill: '#3b4a58' }));
    out.push(text(SX, 26, 'The systems', { size: 13, weight: 700, fill: '#3b4a58' }));
    var T = m.totals || {};
    out.push('<g><title>' + esc((m.appName || m.app) + ': ' + (T.interfaces || 0) + ' interfaces with ' + (T.systems || 0) + ' systems') + '</title>' + box(AX, top, AW, H0, { fill: '#f6f9fb', stroke: '#2e6fd8', sw: 2, r: 12 })
      + text(AX + AW / 2, top + H0 / 2 - 10, fit(m.appName || m.app, AW - 20, 15), { size: 15, weight: 700, anchor: 'middle' })
      + text(AX + AW / 2, top + H0 / 2 + 10, (T.interfaces || 0) + ' interfaces · ' + (T.systems || 0) + ' systems', { size: 11, fill: '#5b6876', anchor: 'middle' })
      + text(AX + AW / 2, top + H0 / 2 + 26, (T.calls || 0) + ' calls from ' + (T.pagesWith || 0) + ' pages', { size: 11, fill: '#5b6876', anchor: 'middle' }) + '</g>');
    lanes.forEach(function (l) {
      var s = l.s, K = kindOf(s.kind);
      var rows0 = l.y + (l.h - l.rows.length * RH) / 2;
      l.rows.forEach(function (L, i) {
        var items = s[L.key] || [];
        var ly = rows0 + i * RH + RH - 6;
        var li = LANES.indexOf(L);
        out.push(L.out ? '<line x1="' + (MX + 4) + '" y1="' + ly + '" x2="' + (SX - 3) + '" y2="' + ly + '" stroke="' + L.ink + '" stroke-width="1.6" stroke-opacity="0.75" marker-end="url(#ar' + li + ')"/>'
          : '<line x1="' + (SX - 4) + '" y1="' + ly + '" x2="' + (MX + 3) + '" y2="' + ly + '" stroke="' + L.ink + '" stroke-width="1.6" stroke-opacity="0.75" marker-end="url(#ar' + li + ')"/>');
        out.push(lane(MX + 18, ly - 7, SX - MX - 36, L.verb + (items.length > 1 ? ' ' + items.length : ''), L.ink, listFit(items, SX - MX - 110, 12), s.name + ' — ' + L.tip + ': ' + items.join(', ')));
      });
      out.push('<g><title>' + esc(s.name + ' — ' + s.kindLabel + ': ' + s.interfaces + ' interfaces, ' + s.calls + ' calls') + '</title>' + box(SX, l.y, SW, l.h)
        + '<rect x="' + SX + '" y="' + l.y + '" width="6" height="' + l.h + '" rx="3" fill="' + K.color + '"/>'
        + text(SX + 18, l.y + l.h / 2 - 8, fit(s.name, SW - 30, 13), { size: 13, weight: 700 })
        + text(SX + 18, l.y + l.h / 2 + 9, fit(s.kindLabel, SW - 30, 11), { size: 11, fill: '#5b6876' })
        + text(SX + 18, l.y + l.h / 2 + 25, s.interfaces + ' interface' + (s.interfaces === 1 ? '' : 's') + ' · ' + s.calls + ' call' + (s.calls === 1 ? '' : 's'), { size: 11, fill: '#26323e' }) + '</g>');
    });
    if (!lanes.length) out.push(text(MX + 30, top + 50, 'The app calls no system.', { size: 13, fill: '#6b7889' }));
    var y0 = top + H0 + 30, x = 24;
    LANES.forEach(function (L, i) {
      out.push('<line x1="' + x + '" y1="' + (y0 - 4) + '" x2="' + (x + 26) + '" y2="' + (y0 - 4) + '" stroke="' + L.ink + '" stroke-width="1.6" marker-end="url(#ar' + i + ')"/>' + text(x + 32, y0, L.verb + ': ' + L.tip, { size: 11, fill: '#3b4a58' }));
      x += 52 + (L.verb + ': ' + L.tip).length * 6.1;
    });
    var kinds = flows.map(function (s) { return s.kind; }).filter(function (k, i, a) { return a.indexOf(k) === i; });
    var lg = legend(kinds, y0 + 22, W, '');
    out.push(lg.svg);
    var H = lg.y + 18;
    return { svg: wrap(W, H, out.join(''), 'Flow between systems'), w: W, h: H, title: 'Flow between systems' };
  }

  var VERB = { Read: { word: 'reads', ink: '#1d4f91' }, Write: { word: 'writes', ink: '#a8461b' }, Report: { word: 'report', ink: '#11704b' } };
  var MAX_JOURNEYS = 40;
  /** Cross-system flows: each action that calls two or more systems — its systems in the order its code calls them. */
  function journeys(m) {
    var W = 1100, LX = 24, BX = 176, BW = 186, GAP = 46, BH = 74, PER = 4, top = 40;
    var all = m.journeys || [];
    var js = all.slice(0, MAX_JOURNEYS);
    var out = [arrowDefs(['#8a97a5'])];
    out.push(text(LX, 24, 'Cross-system flows', { size: 13, weight: 700, fill: '#3b4a58' }));
    out.push(text(BX, 24, 'One action (a button, a page opening) that calls two or more systems — in the order its code calls them; the app passes data between them.', { size: 11, fill: '#6b7889' }));
    var y = top;
    js.forEach(function (j) {
      var lines = Math.ceil(j.steps.length / PER);
      var h = lines * (BH + 16) + 22;
      out.push(box(LX - 8, y - 6, W - 2 * (LX - 8), h, { fill: '#fbfcfd', stroke: '#e4e9ef', r: 10 }));
      out.push(text(LX + 4, y + 20, j.id, { size: 14, weight: 700, fill: '#00506c' }));
      out.push(text(LX + 4, y + 38, j.actions.length + ' action' + (j.actions.length === 1 ? '' : 's'), { size: 11, fill: '#26323e' }));
      out.push(text(LX + 4, y + 53, j.pages.length + ' page' + (j.pages.length === 1 ? '' : 's'), { size: 11, fill: '#5b6876' }));
      j.steps.forEach(function (st, i) {
        var line = Math.floor(i / PER), col = i % PER;
        var bx = BX + col * (BW + GAP), by = y + line * (BH + 16);
        var K = kindOf(st.kind);
        if (col > 0) out.push('<line x1="' + (bx - GAP + 4) + '" y1="' + (by + BH / 2) + '" x2="' + (bx - 4) + '" y2="' + (by + BH / 2) + '" stroke="#8a97a5" stroke-width="1.6" marker-end="url(#ar0)"/>');
        else if (line > 0) out.push(text(bx - 22, by + BH / 2 + 5, '↳', { size: 16, fill: '#8a97a5' }));
        var dirs = ['Read', 'Write', 'Report'].filter(function (d) { return (st.dirs || []).indexOf(d) !== -1; }).map(function (d) { return VERB[d]; });
        var dx = bx + 14;
        var badges = dirs.map(function (v) { var t = text(dx, by + 40, v.word, { size: 11, weight: 700, fill: v.ink }); dx += v.word.length * 7 + 8; return t; }).join('');
        out.push('<g><title>' + esc((i + 1) + '. ' + st.systemName + ' — ' + st.direction + ': ' + st.objects.join(', ')) + '</title>' + box(bx, by, BW, BH)
          + '<rect x="' + bx + '" y="' + by + '" width="6" height="' + BH + '" rx="3" fill="' + K.color + '"/>'
          + text(bx + 14, by + 20, fit((i + 1) + '. ' + st.systemName, BW - 22, 12.5), { size: 12.5, weight: 700 }) + badges
          + text(bx + 14, by + 60, listFit(st.objects, BW - 20, 11), { size: 11, fill: '#3b4a58' }) + '</g>');
      });
      var a0 = j.actions[0] || {};
      var eg = 'e.g. ' + a0.pageLabel + (a0.trigger ? ' — ' + a0.trigger : '') + (a0.chain ? ' (' + a0.chain + ')' : '') + (j.actions.length > 1 ? ' · and ' + (j.actions.length - 1) + ' more' : '');
      out.push(text(BX, y + lines * (BH + 16) + 4, fit(eg, W - BX - 30, 11), { size: 11, fill: '#5b6876' }));
      y += h + 14;
    });
    if (!js.length) { out.push(text(BX, top + 30, 'No single action calls more than one system: each action talks to one system.', { size: 13, fill: '#6b7889' })); y = top + 50; }
    if (all.length > js.length) { out.push(text(BX, y + 6, '+ ' + (all.length - js.length) + ' more cross-system flows (all of them are in the Excel)', { size: 11.5, fill: '#5b6876' })); y += 20; }
    var kinds = [];
    js.forEach(function (j) { j.steps.forEach(function (st) { if (kinds.indexOf(st.kind) === -1) kinds.push(st.kind); }); });
    var lg = legend(kinds, y + 16, W, '');
    out.push(lg.svg);
    var H = lg.y + 18;
    return { svg: wrap(W, H, out.join(''), 'Cross-system flows'), w: W, h: H, title: 'Cross-system flows' };
  }

  var MAX_CALLS = 60;
  /** A trigger in one or two lines ('"Submit" (button); when the page opens' → two). */
  function triggerLines(t, px) {
    var parts = String(t || '').split(/;\s*/).filter(Boolean);
    if (parts.length <= 3) return parts.map(function (x) { return fit(x, px, 12); });
    return [fit(parts[0], px, 12), fit(parts[1], px, 12), fit('+ ' + (parts.length - 2) + ' more: ' + parts.slice(2).join(', '), px, 11)];
  }
  /** One page's integration flow: the page → what sets each call off → its calls, in order → the systems. */
  function page(m, id) {
    var pf = (m.pageFlows || []).filter(function (x) { return x.page === id; })[0];
    if (!pf) return pageBasic(m, id);
    var p = (m.pages || []).filter(function (x) { return x.id === id; })[0] || { id: id, label: pf.pageLabel };
    var W = 1100, PX = 24, PW = 176, TX = 232, TW = 214, CX = 478, CW = 392, SX = 902, SW = 174, top = 50, CH = 38, CG = 6, SG = 14, TMIN = 50;
    // the actions and their calls, cut at MAX_CALLS calls
    var steps = [], left = MAX_CALLS, more = 0;
    pf.steps.forEach(function (st) {
      if (left <= 0) { more += st.calls.length; return; }
      var calls = st.calls.slice(0, left);
      more += st.calls.length - calls.length;
      left -= calls.length;
      steps.push({ trigger: st.trigger, chain: st.chain, chains: st.chains || [], calls: calls });
    });
    var sysIds = [];
    steps.forEach(function (st) { st.calls.forEach(function (c) { if (sysIds.indexOf(c.system) === -1) sysIds.push(c.system); }); });
    var systems = sysIds.map(function (sid) { return (m.systems || []).filter(function (s) { return s.id === sid; })[0]; }).filter(Boolean);
    var pre = commonPrefix([].concat.apply([], steps.map(function (st) { return st.calls.map(function (c) { return c.path; }); })));
    var y = top;
    steps.forEach(function (st) {
      var h = st.calls.length * (CH + CG) - CG;
      st.lines = triggerLines(st.trigger, TW - 20);
      st.y = y; st.h = Math.max(h, TMIN, st.lines.length * 16 + (st.chain ? 16 : 0) + 14); st.cy = y + (st.h - h) / 2; y += st.h + SG;
    });
    var H0 = Math.max(90, y - top - SG + (more ? 30 : 0));
    // a tall page: the page box and the systems stay at the top (centred, they sat far down an empty column)
    var tall = H0 > 420;
    var SH = 64, SGAP = 14, sH = systems.length * (SH + SGAP) - SGAP, sTop = tall ? top : top + Math.max(0, (H0 - sH) / 2), sy = {};
    systems.forEach(function (s, i) { sy[s.id] = sTop + i * (SH + SGAP); });
    var pH = Math.min(Math.max(84, Math.min(H0, 180)), H0), pTop = tall ? top : top + (H0 - pH) / 2;
    var colors = systems.map(function (s) { return kindOf(s.kind).color; });
    var out = [arrowDefs(colors.concat(['#9aa6b2']))];
    var gi = colors.length;
    out.push(text(PX, 26, 'The page', { size: 13, weight: 700, fill: '#3b4a58' }));
    out.push(text(TX, 26, 'What sets it off', { size: 13, weight: 700, fill: '#3b4a58' }));
    out.push(text(CX, 26, 'What it calls, in order (' + (pf.actionCalls || pf.calls) + ')', { size: 13, weight: 700, fill: '#3b4a58' }));
    if (pre) out.push(text(CX + 200, 26, fit('under ' + pre, CW - 200, 11, true), { size: 11, fill: '#6b7889', mono: true }));
    out.push(text(SX, 26, 'The systems', { size: 13, weight: 700, fill: '#3b4a58' }));
    // edges under the boxes: page → each action, action → each call, call → its system
    steps.forEach(function (st) {
      out.push(curve(PX + PW, pTop + pH / 2, TX - 2, st.y + st.h / 2, { color: '#9aa6b2', w: 1.4, op: 0.7, marker: 'ar' + gi }));
      st.calls.forEach(function (c, i) {
        var cy = st.cy + i * (CH + CG) + CH / 2;
        out.push(curve(TX + TW, st.y + st.h / 2, CX - 2, cy, { color: '#9aa6b2', w: 1.2, op: 0.6, marker: 'ar' + gi }));
        var si = sysIds.indexOf(c.system);
        if (sy[c.system] != null) out.push(curve(CX + CW, cy, SX - 2, sy[c.system] + SH / 2, { color: colors[si], w: 1.3, op: 0.5, marker: 'ar' + si, title: c.method + ' ' + c.path + ' → ' + c.systemName }));
      });
    });
    out.push('<g><title>' + esc(p.label + ' (' + p.id + ') — ' + pf.calls + ' calls to ' + pf.systems.length + ' system(s)') + '</title>' + box(PX, pTop, PW, pH, { stroke: '#2e6fd8', sw: 2, r: 12 })
      + text(PX + PW / 2, pTop + pH / 2 - 10, fit(p.label, PW - 16, 13), { size: 13, weight: 700, anchor: 'middle' })
      + text(PX + PW / 2, pTop + pH / 2 + 8, fit(pf.flow, PW - 16, 11), { size: 11, fill: '#5b6876', anchor: 'middle' })
      + text(PX + PW / 2, pTop + pH / 2 + 24, pf.calls + ' call' + (pf.calls === 1 ? '' : 's') + ' · ' + pf.steps.length + ' action' + (pf.steps.length === 1 ? '' : 's'), { size: 11, fill: '#5b6876', anchor: 'middle' }) + '</g>');
    steps.forEach(function (st) {
      var lines = st.lines;
      var ty = st.y + st.h / 2 - (lines.length - 1) * 8 - (st.chain ? 6 : 0) + 4;
      out.push('<g><title>' + esc(st.trigger + (st.chain ? ' — chain ' + st.chain : '')) + '</title>' + box(TX, st.y, TW, st.h, { fill: '#f6f9fb', stroke: '#c9d6e0' })
        + lines.map(function (l, i) { return text(TX + 10, ty + i * 16, l, { size: i ? 11 : 12, weight: i ? 400 : 600, fill: i ? '#5b6876' : '#16212c' }); }).join('')
        + (st.chain ? text(TX + 10, ty + lines.length * 16, fit((st.chains.length > 1 ? st.chains.length + ' chains: ' : '') + st.chain, TW - 20, 10.5, true), { size: 10.5, fill: '#6b7889', mono: true }) : '') + '</g>');
      st.calls.forEach(function (c, i) {
        var cy = st.cy + i * (CH + CG);
        out.push('<g><title>' + esc((i + 1) + '. ' + c.method + ' ' + c.path + (c.summary ? ' — ' + c.summary : '') + ' → ' + c.systemName + (c.object ? ' · ' + c.object : '')) + '</title>' + box(CX, cy, CW, CH)
          + '<circle cx="' + (CX + 14) + '" cy="' + (cy + CH / 2) + '" r="9" fill="#eef3f7"/>' + text(CX + 14, cy + CH / 2 + 4, String(i + 1), { size: 10.5, weight: 700, fill: '#3b4a58', anchor: 'middle' })
          + badge(CX + 30, cy + 14, c)
          + text(CX + 90, cy + 16, fit(short(c.path || c.endpoint, pre), CW - 100, 11.5, true), { size: 11.5, mono: true })
          + text(CX + 90, cy + 31, fit((c.object || '') + (c.action ? ' (' + c.action + ')' : '') + ' → ' + c.systemName + (c.via ? ' · via ' + c.via : ''), CW - 100, 10.5), { size: 10.5, fill: '#5b6876' }) + '</g>');
      });
    });
    if (more) out.push(text(CX, top + H0 - 8, '+ ' + more + ' more calls (every one is in the data sheet)', { size: 11.5, fill: '#5b6876' }));
    systems.forEach(function (s) {
      var sy0 = sy[s.id], K = kindOf(s.kind);
      out.push('<g><title>' + esc(s.name + (s.url ? ' · ' + s.url : '')) + '</title>' + box(SX, sy0, SW, SH) + '<rect x="' + SX + '" y="' + sy0 + '" width="6" height="' + SH + '" rx="3" fill="' + K.color + '"/>'
        + text(SX + 16, sy0 + 22, fit(s.name, SW - 24, 12.5), { size: 12.5, weight: 700 }) + text(SX + 16, sy0 + 39, fit(s.kindLabel, SW - 24, 11), { size: 11, fill: '#5b6876' })
        + text(SX + 16, sy0 + 54, fit(s.host || '', SW - 24, 10, true), { size: 10, fill: '#5b6876', mono: true }) + '</g>');
    });
    var y0 = top + H0 + 30;
    out.push(['Read', 'Write', 'Report'].map(function (d, i) { var D = DIR[d]; return '<rect x="' + (24 + i * 90) + '" y="' + (y0 - 11) + '" width="16" height="14" rx="7" fill="' + D.fill + '"/>' + text(24 + i * 90 + 22, y0, d, { size: 11, fill: D.ink, weight: 600 }); }).join('')
      + text(300, y0, 'The numbers: the order each action\'s code makes its calls.', { size: 11, fill: '#6b7889' }));
    var H = y0 + 18;
    return { svg: wrap(W, H, out.join(''), p.label), w: W, h: H, title: p.label };
  }

  // ── Plain English: a call and what sets it off, said for a business reader ──────────────────────────────────────
  var ACR = /^(bu|po|so|lov|uom|gl|id|inv|oic|api|ar|ap|om|le|hr|sku|lpn|asn|rma|vat|url|pdf)$/i;
  /** "Equipment requests › lines" → "lines of equipment requests"; "Projects LOV" → "list of projects"; acronyms kept. */
  function objectPhrase(o) {
    var t = String(o || '').replace(/\s*\((integration|[A-Z0-9_]{3,})\)\s*$/, '').trim();
    var parts = t.split(/\s*›\s*/);
    var words = function (x) { return String(x).split(/\s+/).map(function (w) { return ACR.test(w) ? w.toUpperCase() : w.toLowerCase(); }).join(' '); };
    var lov = function (x) { var m = /^(.*?)\s+LOV$/i.exec(x); return m ? 'list of ' + words(m[1]) : words(x); };
    return parts.length > 1 ? lov(parts[parts.length - 1]) + ' of ' + lov(parts.slice(0, -1).join(' ')) : lov(t);
  }
  var third = function (w) { w = String(w || '').toLowerCase(); return /(s|sh|ch|x|z)$/.test(w) ? w + 'es' : /[^aeiou]y$/.test(w) ? w.slice(0, -1) + 'ies' : w + 's'; };
  var cap = function (t) { t = String(t || ''); return t.charAt(0).toUpperCase() + t.slice(1); };
  /** A call as a sentence: { verb, text, where, sentence } — "Reads the BU org mappings" "from the backend". */
  function plainStep(c) {
    var obj = String(c.object || '');
    var sys = c.systemName || c.system || 'the system';
    var verb, text;
    if (c.direction === 'Report' || c.kind === 'bip') {
      var rep = (/\(([A-Z0-9_]+)\)\s*$/.exec(obj) || [])[1];
      verb = 'Runs'; text = 'the ' + objectPhrase(obj).replace(/ report$/, '') + ' report';
      return { verb: verb, text: text, where: 'in ' + sys, sentence: verb + ' ' + text + ' in ' + sys + (rep ? ' (' + rep + ')' : '') };
    }
    if (/\(integration\)\s*$/.test(obj)) {
      verb = c.direction === 'Read' ? 'Asks' : 'Starts';
      text = 'the ' + obj.replace(/\s*\(integration\)\s*$/, '') + ' integration';
      return { verb: verb, text: text, where: 'in ' + sys, sentence: verb + ' ' + text + ' in ' + sys };
    }
    var op = String(c.action || '').trim();
    if (op) {
      var ow = op.split(/\s+/), first = ow[0].toLowerCase();
      var SPECIAL = { batch: ['Saves', 'a batch of'], bulk: ['Loads', 'in bulk:'], content: ['Downloads', 'the content of'], access: ['Gets', 'a link to'], count: ['Counts', 'the'], summary: ['Sums up', 'the'], preview: ['Previews', 'the'] };
      if (SPECIAL[first]) { verb = SPECIAL[first][0]; text = SPECIAL[first][1] + ' ' + (first === 'bulk' ? ow.slice(1).join(' ') + ' ' : '') + objectPhrase(obj); }
      else { verb = cap(third(first)); text = (ow.length > 1 ? ow.slice(1).join(' ') + ' for ' : '') + 'the ' + objectPhrase(obj); }
    } else {
      var M = String(c.method || '').toUpperCase();
      verb = M === 'GET' || M === 'HEAD' ? 'Reads' : M === 'POST' ? 'Creates' : M === 'PUT' || M === 'PATCH' ? 'Updates' : M === 'DELETE' ? 'Deletes' : 'Calls';
      text = 'the ' + objectPhrase(obj || c.endpoint || 'data');
    }
    var where = (verb === 'Reads' || verb === 'Deletes' || verb === 'Downloads' || verb === 'Gets' || verb === 'Counts') ? 'from ' + sys : 'in ' + sys;
    return { verb: verb, text: text.replace(/\s+/g, ' ').trim(), where: where, sentence: verb + ' ' + text.replace(/\s+/g, ' ').trim() + ' ' + where };
  }
  /** What sets an action off, for a business reader: "When the user clicks "Fetch"", "When the page opens"… */
  function plainTrigger(t) {
    var parts = String(t || '').split(/;\s*/).filter(Boolean);
    var one = function (x) {
      if (/^when the page opens/i.test(x)) return 'When the page opens';
      if (/page.s data/i.test(x)) return 'When the page\'s list loads';
      var b = /^"([\s\S]*)" \(button\)$/.exec(x);
      if (b) {
        var l = b[1];
        if (/selected row|row (changed|selection)|select(ed|ion) changed/i.test(l)) return 'When the user selects a row';
        if (/row action/i.test(l)) return 'When the user picks an action on a row';
        if (/filter criterion changed/i.test(l)) return 'When the user changes a filter';
        if (/value( item)? (changed|action)/i.test(l)) {
          var f = /label:\s*([^:"]+?)\s*(value|$)/i.exec(l) || /^([^:]{1,30}):\s*value/i.exec(l);
          var fld = f && f[1] ? f[1].trim() : '';
          return 'When the user changes ' + (fld && !/^(oj|label)/i.test(fld) ? 'the ' + fld.toLowerCase() : 'a value');
        }
        if (/primary action/i.test(l)) return 'When the user clicks the main button';
        if (/secondary action/i.test(l)) return 'When the user clicks a toolbar button';
        var clean = l.replace(/<!--[\s\S]*?-->|-->|<[^>]+>/g, ' ').replace(/^[^:]{0,24}:\s*/, function (m) { return /^oj|^label/i.test(m) ? '' : m; }).replace(/\s+/g, ' ').trim();
        return 'When the user clicks "' + (clean.length > 40 ? clean.slice(0, 39) + '…' : clean || 'a button') + '"';
      }
      var r = /^run by\s+([A-Za-z0-9_]+)/i.exec(x);
      if (r) return 'When the page runs "' + cap(r[1].replace(/Chain$/, '').replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase()) + '"';
      if (/module/i.test(x)) return 'From the page\'s own code';
      return cap(x);
    };
    var said = parts.map(one).filter(function (x, i, a) { return a.indexOf(x) === i; });
    // several clicks said once: When the user clicks "Edit", "Submit" or "Delete"
    var clicks = [], other = [];
    said.forEach(function (x) { var c = /^When the user clicks ("[^"]*")$/.exec(x); if (c) clicks.push(c[1]); else other.push(x); });
    if (clicks.length) other.unshift('When the user clicks ' + (clicks.length > 1 ? clicks.slice(0, -1).join(', ') + ' or ' + clicks[clicks.length - 1] : clicks[0]));
    var low = function (x, i) { return i ? x.replace(/^When/, 'when').replace(/^From/, 'from') : x; };
    other = other.map(low);
    return other.length > 1 ? other.slice(0, -1).join(', ') + ' or ' + other[other.length - 1] : (other[0] || 'When the page runs it');
  }
  /** Text in lines of about `px`, at most `max` lines (the last cut with an ellipsis). */
  function wrapLines(t, px, size, max) {
    var per = (size || 12) * 0.56, cap0 = Math.max(6, Math.floor(px / per)), out = [], line = '';
    String(t || '').split(/\s+/).filter(Boolean).forEach(function (w) {
      if ((line ? line + ' ' + w : w).length > cap0) { if (line) out.push(line); line = w; } else line = line ? line + ' ' + w : w;
    });
    if (line) out.push(line);
    if (out.length > max) { out = out.slice(0, max); out[max - 1] = fit(out[max - 1] + ' …', px, size); }
    return out.map(function (l) { return fit(l, px, size); });
  }

  /** A page's flow as a model: { id, label, sub, lanes: [systems], actions: [{ trigger, chain, chains, calls }] }. */
  function pageModel(m, id) {
    var pf = (m.pageFlows || []).filter(function (x) { return x.page === id; })[0];
    var p = (m.pages || []).filter(function (x) { return x.id === id; })[0] || { id: id, label: pf ? pf.pageLabel : id };
    if (!pf) return null;
    return { id: p.id, label: p.label, sub: pf.flow + ' · ' + pf.steps.length + ' action' + (pf.steps.length === 1 ? '' : 's'),
      lanes: pf.systems.map(function (sid) { return (m.systems || []).filter(function (s) { return s.id === sid; })[0]; }).filter(Boolean),
      actions: pf.steps.map(function (st) { return { trigger: st.trigger, chain: st.chain, chains: st.chains || [], calls: st.calls }; }) };
  }

  /** A flow in swimlanes (a page's, or one saved and edited): the page's lane (what sets each action off) and a lane
   *  per system; each action goes down step by step, every call in the lane of its system; a darker arrow where it
   *  moves on to another system. opts.plain: in plain English (a sentence per call, what sets it off in words, no
   *  paths or chains); a step's or an action's note is shown under it. */
  function flowSwim(model, opts) {
    var o = opts || {};
    var plain = !!o.plain;
    var systems = model.lanes || [];
    var X0 = 24, PW = 220, LW = Math.max(230, Math.floor((1100 - 2 * X0 - PW) / Math.max(1, systems.length)));
    var W = 2 * X0 + PW + LW * systems.length;
    var laneX = {};
    systems.forEach(function (s, i) { laneX[s.id] = X0 + PW + i * LW; });
    var BX = 18, BW = LW - 2 * BX, SH = 48, SG = 22, HEAD = 64, top = HEAD + 14;
    var pre = commonPrefix([].concat.apply([], (model.actions || []).map(function (st) { return st.calls.map(function (c) { return c.path; }); })));
    // layout: each action a band; its steps one under the other (cut at MAX_CALLS calls)
    var bands = [], y = top, left = MAX_CALLS, more = 0;
    (model.actions || []).forEach(function (st) {
      if (left <= 0) { more += st.calls.length; return; }
      var calls = st.calls.filter(function (c) { return laneX[c.system] != null; }).slice(0, left);
      more += st.calls.length - calls.length;
      left -= calls.length;
      var lines = plain ? wrapLines(st.title || plainTrigger(st.trigger), PW - 44, 12, 3) : triggerLines(st.trigger, PW - 44);
      var noteLines = st.note ? wrapLines(st.note, PW - 44, 10.5, 2) : [];
      var chainLine = !plain && st.chain;
      var pillH = Math.max(SH, lines.length * 16 + (chainLine ? 16 : 0) + noteLines.length * 14 + 14);
      var stepsH = Math.max(SH, calls.length * (SH + SG) - SG);
      var h = Math.max(pillH, stepsH) + 24;
      bands.push({ st: st, calls: calls, lines: lines, noteLines: noteLines, chainLine: chainLine, y: y, h: h, pillH: pillH });
      y += h;
    });
    var H0 = Math.max(60, y - top + (more ? 26 : 0));
    var colors = systems.map(function (s) { return kindOf(s.kind).color; });
    var out = [arrowDefs(['#b3bdc7', '#3b4a58'])];
    // the lanes: tinted by their system's colour, headed by its name and kind
    out.push('<rect x="' + X0 + '" y="0" width="' + PW + '" height="' + (top + H0 + 8) + '" fill="#f6f9fb"/>');
    systems.forEach(function (s, i) {
      var x = laneX[s.id];
      out.push('<rect x="' + x + '" y="0" width="' + LW + '" height="' + (top + H0 + 8) + '" fill="' + colors[i] + '" fill-opacity="0.045"/>'
        + '<line x1="' + x + '" y1="0" x2="' + x + '" y2="' + (top + H0 + 8) + '" stroke="#d5dde5" stroke-dasharray="4 4"/>');
    });
    bands.forEach(function (b, i) { if (i % 2) out.push('<rect x="' + X0 + '" y="' + b.y + '" width="' + (W - 2 * X0) + '" height="' + b.h + '" fill="#0b2a44" fill-opacity="0.025"/>'); });
    bands.forEach(function (b) { out.push('<line x1="' + X0 + '" y1="' + b.y + '" x2="' + (W - X0) + '" y2="' + b.y + '" stroke="#e4e9ef"/>'); });
    out.push('<g><title>' + esc(model.label + (model.id ? ' (' + model.id + ')' : '')) + '</title>' + text(X0 + 12, 24, model.kicker || 'The page', { size: 11, weight: 700, fill: '#6b7889' })
      + text(X0 + 12, 44, fit(model.label, PW - 24, 14), { size: 14, weight: 700, fill: '#2e6fd8' }) + text(X0 + 12, 60, fit(model.sub || '', PW - 24, 11), { size: 11, fill: '#5b6876' }) + '</g>');
    systems.forEach(function (s, i) {
      var x = laneX[s.id];
      out.push('<g><title>' + esc(s.name + ' — ' + (s.kindLabel || '') + (s.url ? ' · ' + s.url : '')) + '</title><rect x="' + x + '" y="0" width="' + LW + '" height="5" fill="' + colors[i] + '"/>'
        + text(x + 14, 30, fit(s.name, LW - 28, 14), { size: 14, weight: 700 }) + text(x + 14, 48, fit((s.kindLabel || '') + (s.host && !plain ? ' · ' + s.host : ''), LW - 28, 11), { size: 11, fill: '#5b6876' }) + '</g>');
    });
    out.push('<line x1="' + X0 + '" y1="' + HEAD + '" x2="' + (W - X0) + '" y2="' + HEAD + '" stroke="#c9d6e0" stroke-width="1.5"/>');
    var lane = function (sid) { return systems.map(function (s) { return s.id; }).indexOf(sid); };
    bands.forEach(function (b) {
      var st = b.st, y0 = b.y + 12;
      // what sets it off, in the page's lane
      var px = X0 + 12, pw = PW - 24;
      var used = b.lines.length * 16 + (b.chainLine ? 16 : 0) + b.noteLines.length * 14;
      var ty = y0 + (b.pillH - used) / 2 + 12;
      out.push('<g><title>' + esc((plain ? (st.title || plainTrigger(st.trigger)) : st.trigger) + (st.chain ? ' — chain ' + st.chain : '') + (st.note ? ' — note: ' + st.note : '')) + '</title>' + box(px, y0, pw, b.pillH, { fill: '#ffffff', stroke: '#2e6fd8', sw: 1.5, r: 22 })
        + '<circle cx="' + (px + 16) + '" cy="' + (y0 + b.pillH / 2) + '" r="5" fill="#2e6fd8"/>'
        + b.lines.map(function (l, i) { return text(px + 28, ty + i * 16, l, { size: plain ? 12 : (i ? 11 : 12), weight: plain ? 600 : (i ? 400 : 600), fill: plain || !i ? '#16212c' : '#5b6876' }); }).join('')
        + (b.chainLine ? text(px + 28, ty + b.lines.length * 16, fit((st.chains && st.chains.length > 1 ? st.chains.length + ' chains: ' : '') + st.chain, pw - 40, 10, true), { size: 10, fill: '#6b7889', mono: true }) : '')
        + b.noteLines.map(function (l, i) { return text(px + 28, ty + b.lines.length * 16 + (b.chainLine ? 16 : 0) + i * 14, l, { size: 10.5, fill: '#8a5a00' }); }).join('') + '</g>');
      var prev = { x: px + pw, y: y0 + Math.min(b.pillH, SH) / 2, lane: -1, right: true };
      if (!b.calls.length) out.push(text(X0 + PW + 18, y0 + 28, plain ? 'Nothing is called yet.' : 'No calls in this action yet.', { size: 11.5, fill: '#8a97a5' }));
      b.calls.forEach(function (c, i) {
        var li = lane(c.system);
        var bx = laneX[c.system] + BX, by = y0 + i * (SH + SG), cx = bx + BW / 2;
        var hand = prev.lane !== -1 && prev.lane !== li;
        // the arrow into this step: from what set it off (across), down the same lane, or over to another lane (darker)
        var path;
        if (prev.right) path = Math.abs(prev.y - (by + SH / 2)) > 1 ? 'M' + prev.x + ' ' + prev.y + ' H' + (bx - 14) + ' V' + (by + SH / 2) + ' H' + (bx - 4) : 'M' + prev.x + ' ' + prev.y + ' H' + (bx - 4);
        else if (!hand) path = 'M' + cx + ' ' + prev.y + ' V' + (by - 3);
        else path = 'M' + prev.x + ' ' + prev.y + ' V' + (by - SG / 2) + ' H' + cx + ' V' + (by - 3);
        out.push('<path d="' + path + '" fill="none" stroke="' + (hand ? '#3b4a58' : '#b3bdc7') + '" stroke-width="' + (hand ? 2 : 1.5) + '" marker-end="url(#ar' + (hand ? 1 : 0) + ')">'
          + (hand ? '<title>' + esc('then on to ' + c.systemName) + '</title>' : '') + '</path>');
        var D0 = DIR[c.direction] || DIR.Read;
        var ps = plainStep(c);
        var said = c.text || ps.sentence;
        var tip = (i + 1) + '. ' + (plain ? said : c.systemName + ' · ' + (c.manual ? (c.text || 'a step') : c.method + ' ' + c.path + (c.summary ? ' — ' + c.summary : '')) + (c.via ? ' · via ' + c.via : '')) + (c.note ? ' — note: ' + c.note : '');
        var body;
        var dot = c.note ? '<circle cx="' + (bx + BW - 10) + '" cy="' + (by + 10) + '" r="4" fill="#eda100"><title>' + esc('Note: ' + c.note) + '</title></circle>' : '';
        // a step's own words: up to two lines (then its note is the amber dot); else line two says the note, or where
        var own = function (t, sub, subFill, mono) {
          var ls = wrapLines(t, BW - 40, 12.5, 2);
          if (ls.length > 1) return text(bx + 32, by + 21, ls[0], { size: 12.5, weight: 600 }) + text(bx + 14, by + 39, ls[1], { size: 12.5, weight: 600 }) + dot;
          return text(bx + 32, by + 21, ls[0] || '', { size: 12.5, weight: 600 }) + text(bx + 14, by + 39, fit(sub, BW - 22, 10.5, mono), { size: 10.5, fill: subFill, mono: mono });
        };
        if (plain) {
          if (c.text) body = own(c.text, c.note ? 'Note: ' + c.note : ps.where, c.note ? '#8a5a00' : '#5b6876', false);
          else {
            // the sentence: its verb in the direction's colour, then what it does; under it the note (else where)
            var vw = ps.verb.length * 7.5 + 6;
            body = text(bx + 32, by + 21, ps.verb, { size: 12.5, weight: 700, fill: D0.ink }) + text(bx + 32 + vw, by + 21, fit(ps.text, BW - 40 - vw, 12.5), { size: 12.5 })
              + text(bx + 14, by + 39, fit(c.note ? 'Note: ' + c.note : ps.where, BW - 22, 10.5), { size: 10.5, fill: c.note ? '#8a5a00' : '#5b6876' });
          }
        } else if (c.manual) {
          body = own(c.text || 'A step', c.note ? 'Note: ' + c.note : 'added by hand', c.note ? '#8a5a00' : '#5b6876', false);
        } else {
          body = badge(bx + 32, by + 17, c) + text(bx + 92, by + 21, fit((c.object || c.endpoint) + (c.action ? ' (' + c.action + ')' : ''), BW - 100, 12.5), { size: 12.5, weight: 700 })
            + text(bx + 14, by + 39, fit(short(c.path || c.endpoint, pre) + (c.via ? ' · via ' + c.via : ''), BW - 22, 10.5, true), { size: 10.5, fill: '#5b6876', mono: true }) + dot;
        }
        out.push('<g><title>' + esc(tip) + '</title>' + box(bx, by, BW, SH, { stroke: hand ? '#3b4a58' : '#c9d6e0', sw: hand ? 1.5 : 1, fill: c.manual ? '#fffdf5' : '#ffffff' })
          + '<rect x="' + bx + '" y="' + by + '" width="5" height="' + SH + '" rx="2" fill="' + D0.ink + '" fill-opacity="0.55"/>'
          + '<circle cx="' + (bx + 18) + '" cy="' + (by + 17) + '" r="8" fill="#eef3f7"/>' + text(bx + 18, by + 21, String(i + 1), { size: 10, weight: 700, fill: '#3b4a58', anchor: 'middle' })
          + body + '</g>');
        prev = { x: cx, y: by + SH, lane: li, right: false };
      });
    });
    if (!bands.length) out.push(text(X0 + PW + 18, top + 30, 'No steps yet.', { size: 12, fill: '#8a97a5' }));
    if (more) out.push(text(X0 + PW + 14, top + H0 - 8, '+ ' + more + ' more calls (every one is in the data sheet)', { size: 11.5, fill: '#5b6876' }));
    var y1 = top + H0 + 34;
    out.push((plain ? [['Read', 'Reads'], ['Write', 'Creates · updates · deletes'], ['Report', 'Runs a report']] : [['Read', 'Read'], ['Write', 'Write'], ['Report', 'Report']]).map(function (d, i) { var D0 = DIR[d[0]]; return '<rect x="' + (24 + i * (plain ? 170 : 90)) + '" y="' + (y1 - 11) + '" width="16" height="14" rx="7" fill="' + D0.fill + '"/>' + text(24 + i * (plain ? 170 : 90) + 22, y1, d[1], { size: 11, fill: D0.ink, weight: 600 }); }).join(''));
    var lx = plain ? 560 : 300;
    out.push('<line x1="' + lx + '" y1="' + (y1 - 4) + '" x2="' + (lx + 30) + '" y2="' + (y1 - 4) + '" stroke="#3b4a58" stroke-width="2" marker-end="url(#ar1)"/>' + text(lx + 38, y1, 'moves on to another system', { size: 11, fill: '#3b4a58' })
      + (plain ? '' : '<line x1="520" y1="' + (y1 - 4) + '" x2="550" y2="' + (y1 - 4) + '" stroke="#b3bdc7" stroke-width="1.5" marker-end="url(#ar0)"/>' + text(558, y1, 'next call to the same system · the numbers: the order its code calls them', { size: 11, fill: '#6b7889' })));
    var H = y1 + 18;
    var title = model.title || (model.label + ' — flow');
    return { svg: wrap(W, H, out.join(''), title), w: W, h: H, title: title };
  }

  /** One page's flow in swimlanes (see flowSwim); opts.plain: in plain English. */
  function pageFlow(m, id, opts) {
    var model = pageModel(m, id);
    var p = (m.pages || []).filter(function (x) { return x.id === id; })[0] || { id: id, label: id };
    if (!model) return { svg: wrap(1100, 90, text(24, 50, 'This page calls no web service.', { size: 13, fill: '#6b7889' }), p.label), w: 1100, h: 90, title: p.label };
    return flowSwim(model, opts);
  }

  /** Every page with calls → the systems it calls, the pages grouped by flow; a line's thickness: its calls. */
  function pages(m) {
    var pfs = m.pageFlows || [];
    var W = 1100, LX = 24, LW = 380, RX = 760, RW = 316, top = 46, PH = 30, PG = 6, FH = 26;
    var systems = (m.systems || []).filter(function (s) { return pfs.some(function (p) { return p.systems.indexOf(s.id) !== -1; }); });
    // page × system calls, from the data sheet
    var cnt = {};
    (m.rows || []).forEach(function (r) { var k = r.page + '|' + r.system; cnt[k] = (cnt[k] || 0) + 1; });
    var max = Object.keys(cnt).reduce(function (a, k) { return Math.max(a, cnt[k]); }, 1);
    var y = top, py = {}, flowY = [], curFlow = null;
    pfs.forEach(function (p) {
      if (p.flow !== curFlow) { curFlow = p.flow; flowY.push({ flow: p.flow, y: y }); y += FH; }
      py[p.page] = y; y += PH + PG;
    });
    var leftH = Math.max(0, y - top - PG);
    var SH = 66, SGAP = 12, rightH = systems.length * (SH + SGAP) - SGAP;
    var H0 = Math.max(leftH, rightH, 80);
    var sTop = top + Math.max(0, (H0 - rightH) / 2), sy = {};
    systems.forEach(function (s, i) { sy[s.id] = sTop + i * (SH + SGAP); });
    var colors = systems.map(function (s) { return kindOf(s.kind).color; });
    var out = [arrowDefs(colors)];
    out.push(text(LX, 24, 'Each page with integrations (' + pfs.length + '), by flow', { size: 13, weight: 700, fill: '#3b4a58' }));
    out.push(text(RX, 24, 'The systems they call', { size: 13, weight: 700, fill: '#3b4a58' }));
    // the systems' in-points, ordered by the pages' rows so lines cross less
    var ins = {};
    pfs.forEach(function (p) { p.systems.forEach(function (sid) { (ins[sid] = ins[sid] || []).push(p.page); }); });
    var at = {};
    Object.keys(ins).forEach(function (sid) { if (sy[sid] == null) return; var ys = spread(ins[sid].length, sy[sid], SH); ins[sid].forEach(function (pg, i) { at[pg + '|' + sid] = ys[i]; }); });
    pfs.forEach(function (p) {
      var outs = p.systems.filter(function (sid) { return sy[sid] != null; }).sort(function (a, b) { return sy[a] - sy[b]; });
      var ys = spread(outs.length, py[p.page], PH);
      outs.forEach(function (sid, i) {
        var si = systems.map(function (s) { return s.id; }).indexOf(sid), c = cnt[p.page + '|' + sid] || 1;
        out.push(curve(LX + LW, ys[i], RX - 2, at[p.page + '|' + sid], { color: colors[si], w: 1.2 + 4 * (c / max), op: 0.5, marker: 'ar' + si, title: p.pageLabel + ' → ' + systems[si].name + ': ' + c + ' call' + (c === 1 ? '' : 's') }));
      });
    });
    flowY.forEach(function (f) { out.push(text(LX, f.y + 17, fit(f.flow, LW, 12), { size: 12, weight: 700, fill: '#00506c' })); });
    pfs.forEach(function (p) {
      var y1 = py[p.page];
      out.push('<g><title>' + esc(p.pageLabel + ' (' + p.page + '): ' + p.calls + ' calls · ' + p.steps.length + ' actions') + '</title>' + box(LX + 12, y1, LW - 12, PH)
        + text(LX + 24, y1 + 19, fit(p.pageLabel, LW - 130, 12), { size: 12, weight: 600 })
        + text(LX + LW - 10, y1 + 19, p.calls + ' call' + (p.calls === 1 ? '' : 's'), { size: 11, fill: '#5b6876', anchor: 'end' }) + '</g>');
    });
    systems.forEach(function (s) {
      var y1 = sy[s.id], K = kindOf(s.kind);
      out.push('<g><title>' + esc(s.name + ' — ' + s.kindLabel) + '</title>' + box(RX, y1, RW, SH) + '<rect x="' + RX + '" y="' + y1 + '" width="6" height="' + SH + '" rx="3" fill="' + K.color + '"/>'
        + text(RX + 18, y1 + 22, fit(s.name, RW - 30, 13), { size: 13, weight: 700 }) + text(RX + 18, y1 + 39, fit(s.kindLabel, RW - 30, 11), { size: 11, fill: '#5b6876' })
        + text(RX + 18, y1 + 55, s.pages.length + ' page' + (s.pages.length === 1 ? '' : 's') + ' · ' + s.calls + ' call' + (s.calls === 1 ? '' : 's'), { size: 11, fill: '#26323e' }) + '</g>');
    });
    if (!pfs.length) out.push(text(LX, top + 30, 'No page calls a web service.', { size: 13, fill: '#6b7889' }));
    var lg = legend(systems.map(function (s) { return s.kind; }).filter(function (k, i, a) { return a.indexOf(k) === i; }), top + H0 + 30, W, 'A line\'s thickness: the page\'s calls to that system.');
    out.push(lg.svg);
    var H = lg.y + 18;
    return { svg: wrap(W, H, out.join(''), 'Pages and the systems they call'), w: W, h: H, title: 'Pages and the systems they call' };
  }

  /** A small document showing a diagram, scaled to its frame (for a sandboxed iframe). */
  function doc(d) {
    return '<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:#fff}svg{display:block;width:100%;height:auto}</style>' + (d && d.svg ? d.svg : '');
  }

  return { landscape: landscape, system: system, page: page, pageBasic: pageBasic, pageFlow: pageFlow, pageModel: pageModel, flowSwim: flowSwim, plainStep: plainStep, plainTrigger: plainTrigger, objectPhrase: objectPhrase, wrapLines: wrapLines, pages: pages, systemFlow: systemFlow, journeys: journeys, listFit: listFit, doc: doc, KINDS: KINDS, DIR: DIR, esc: esc, fit: fit, figures: figures, commonPrefix: commonPrefix };
});
