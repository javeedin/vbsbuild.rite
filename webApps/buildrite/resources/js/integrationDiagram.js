define([], function () {
  'use strict';

  // Integration diagrams (Application → Integrations), drawn as SVG from the scan (desktop/lib/integrations.js) — pure
  // (no DOM): the same picture in the page, in the PDF and saved as .svg.
  //
  //   landscape(m)      the app's flows (the source) → the systems they call (the targets); a line's thickness = calls
  //   system(m, id)     one system: the pages that call it → its endpoints (method, path) → the system
  //   page(m, id)       one page: the page → the endpoints it calls → their systems
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

  /** One page: the page → the endpoints it calls → their systems. */
  function page(m, id) {
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

  /** A small document showing a diagram, scaled to its frame (for a sandboxed iframe). */
  function doc(d) {
    return '<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:#fff}svg{display:block;width:100%;height:auto}</style>' + (d && d.svg ? d.svg : '');
  }

  return { landscape: landscape, system: system, page: page, doc: doc, KINDS: KINDS, DIR: DIR, esc: esc, fit: fit, figures: figures, commonPrefix: commonPrefix };
});
