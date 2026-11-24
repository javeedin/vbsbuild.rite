(function (factory) {
  'use strict';
  // the SQL screen (AMD, in the app) and the Node tests (CommonJS) share it — no DOM, no network.
  if (typeof define === 'function' && define.amd) define([], factory);
  else if (typeof module === 'object' && module.exports) module.exports = factory();
  else (this || window).Infolets = factory();
}(function () {
  'use strict';

  // Turn a SQL result ({ columns, rows }) into a small chart for a dashboard — a KPI number, bar / column / line / pie,
  // or a short table. Pure: compute() makes a plain model, cardHtml() makes the self-contained HTML (inline SVG, CSS
  // bars) the page drops into a slot, and suggest() picks a sensible chart for a result. Everything an infolet needs is
  // its own SQL + a spec { kind, title, label, value, agg, limit } — the page runs the SQL, this draws it.

  var KINDS = ['kpi', 'bar', 'column', 'line', 'pie', 'table'];
  var PALETTE = ['#1d4f91', '#eb6834', '#227e9e', '#2a9d5c', '#9a5bd1', '#d6a400', '#c2415a', '#5a6876', '#0f8b8d', '#7a5195'];

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function colName(c) { return c && typeof c === 'object' ? c.name : c; }
  function names(columns) { return (columns || []).map(colName); }
  function isId(c) { return /(^|_)(ID|NUMBER|NUM|NO)$|ID$|NUMBER$/i.test(String(c || '')); }

  function num(v) {
    if (v == null || v === '') return null;
    if (typeof v === 'number') return isFinite(v) ? v : null;
    var n = Number(String(v).replace(/[, ]+/g, ''));
    return isFinite(n) && /\d/.test(String(v)) ? n : null;
  }

  // which columns hold numbers worth measuring (not an *_ID), and which read as labels
  function kinds(columns, rows) {
    var nm = names(columns), measures = [], dims = [];
    nm.forEach(function (c, i) {
      var any = false, allNum = true;
      for (var r = 0; r < (rows || []).length && r < 500; r++) {
        var v = rows[r][i];
        if (v == null || v === '') continue;
        any = true;
        if (num(v) == null) { allNum = false; break; }
      }
      if (any && allNum && !isId(c)) measures.push(i); else dims.push(i);
    });
    return { measures: measures, dims: dims };
  }

  function trim1(x) { return x.toFixed(1).replace(/\.0$/, ''); }
  function fmtNum(n) {
    if (n == null) return '—';
    var neg = n < 0, a = Math.abs(n), s;
    if (a >= 1e9) s = trim1(a / 1e9) + 'B';
    else if (a >= 1e6) s = trim1(a / 1e6) + 'M';
    else if (a >= 1e4) s = trim1(a / 1e3) + 'K';
    else s = (Math.round(a * 100) / 100).toLocaleString('en-US');
    return (neg ? '-' : '') + s;
  }

  // A good first chart for a fresh result: one number → KPI, a label + a measure → bar, a date-ish label → line.
  function suggest(columns, rows) {
    var nm = names(columns), k = kinds(columns, rows);
    var title = '';
    if (!nm.length) return { kind: 'table', title: title };
    if ((rows || []).length <= 1 && k.measures.length >= 1) return { kind: 'kpi', title: title, value: nm[k.measures[0]], agg: 'none' };
    if (k.dims.length >= 1 && k.measures.length >= 1) {
      var labelCol = nm[k.dims[0]], valueCol = nm[k.measures[0]];
      var dateish = /date|month|day|period|year|week/i.test(labelCol);
      return { kind: dateish ? 'line' : 'bar', title: title, label: labelCol, value: valueCol, agg: 'sum', limit: 12 };
    }
    if (k.measures.length >= 1) return { kind: 'kpi', title: title, value: nm[k.measures[0]], agg: 'sum' };
    return { kind: 'table', title: title };
  }

  function idxOf(nm, name, fallback) { var i = nm.indexOf(name); return i >= 0 ? i : (fallback == null ? -1 : fallback); }

  // group rows by the label column and aggregate the value column
  function groups(data, spec) {
    var nm = names(data.columns), rows = data.rows || [];
    var li = idxOf(nm, spec.label, kinds(data.columns, rows).dims[0]);
    var vi = idxOf(nm, spec.value, kinds(data.columns, rows).measures[0]);
    var agg = spec.agg || 'sum', order = [], by = {};
    rows.forEach(function (r) {
      var label = li >= 0 ? String(r[li] == null ? '' : r[li]) : '';
      var v = vi >= 0 ? num(r[vi]) : null;
      if (!by[label]) { by[label] = { label: label, sum: 0, count: 0, n: 0 }; order.push(label); }
      var g = by[label];
      g.count++;
      if (v != null) { g.sum += v; g.n++; }
    });
    var out = order.map(function (l) {
      var g = by[l];
      var value = agg === 'count' ? g.count : agg === 'avg' ? (g.n ? g.sum / g.n : 0) : g.sum;
      return { label: g.label, value: value };
    });
    if (spec.limit && out.length > spec.limit) {
      out.sort(function (a, b) { return b.value - a.value; });
      var top = out.slice(0, spec.limit - 1);
      var restVal = out.slice(spec.limit - 1).reduce(function (s, x) { return s + x.value; }, 0);
      top.push({ label: 'Others', value: restVal, other: true });
      out = top;
    }
    var max = out.reduce(function (m, x) { return Math.max(m, x.value); }, 0) || 1;
    var total = out.reduce(function (s, x) { return s + x.value; }, 0) || 0;
    out.forEach(function (x, i) { x.pct = max ? x.value / max : 0; x.share = total ? x.value / total : 0; x.color = PALETTE[i % PALETTE.length]; });
    return { items: out, max: max, total: total, labelCol: nm[li] || '', valueCol: nm[vi] || '' };
  }

  // compute(spec, data) → a plain model the page can render or a test can read; never throws.
  function compute(spec, data) {
    spec = spec || {};
    data = data || { columns: [], rows: [] };
    var kind = KINDS.indexOf(spec.kind) >= 0 ? spec.kind : 'table';
    var nm = names(data.columns), rows = data.rows || [];
    var model = { kind: kind, title: spec.title || '', columns: nm, rowCount: rows.length, error: '' };
    if (!nm.length) { model.error = 'The query returned no columns.'; return model; }
    if (kind === 'kpi') {
      var k = kinds(data.columns, rows);
      var vi = idxOf(nm, spec.value, k.measures[0] != null ? k.measures[0] : 0);
      var agg = spec.agg || (rows.length > 1 ? 'sum' : 'none');
      var value;
      if (agg === 'none') value = rows.length ? num(rows[0][vi]) : null;
      else if (agg === 'count') value = rows.length;
      else {
        var s = 0, c = 0;
        rows.forEach(function (r) { var v = num(r[vi]); if (v != null) { s += v; c++; } });
        value = agg === 'avg' ? (c ? s / c : 0) : s;
      }
      model.kpi = { value: value, formatted: value == null ? '—' : fmtNum(value), sub: (agg === 'none' ? '' : agg + ' of ') + (nm[vi] || ''), raw: value };
      return model;
    }
    if (kind === 'table') {
      model.table = { columns: nm, rows: rows.slice(0, spec.limit || 50), more: rows.length > (spec.limit || 50) };
      return model;
    }
    var g = groups(data, spec);
    model.items = g.items; model.max = g.max; model.total = g.total; model.labelCol = g.labelCol; model.valueCol = g.valueCol;
    if (!g.items.length) model.error = 'Nothing to chart (no rows).';
    return model;
  }

  // ── renderers: each returns an HTML string; cardHtml() is the whole infolet body ──
  function barHtml(model, vertical) {
    if (model.error) return '<p class="nx-if-empty">' + esc(model.error) + '</p>';
    if (vertical) {
      return '<div class="nx-if-cols">' + model.items.map(function (it) {
        return '<div class="nx-if-col" title="' + esc(it.label + ': ' + fmtNum(it.value)) + '">' +
          '<span class="nx-if-colv">' + esc(fmtNum(it.value)) + '</span>' +
          '<span class="nx-if-colbar" style="height:' + (it.pct * 100).toFixed(1) + '%;background:' + it.color + '"></span>' +
          '<span class="nx-if-collbl">' + esc(it.label) + '</span></div>';
      }).join('') + '</div>';
    }
    return '<div class="nx-if-bars">' + model.items.map(function (it) {
      return '<div class="nx-if-bar" title="' + esc(it.label + ': ' + fmtNum(it.value)) + '">' +
        '<span class="nx-if-lbl">' + esc(it.label) + '</span>' +
        '<span class="nx-if-track"><span class="nx-if-fill" style="width:' + (it.pct * 100).toFixed(1) + '%;background:' + it.color + '"></span></span>' +
        '<span class="nx-if-val">' + esc(fmtNum(it.value)) + '</span></div>';
    }).join('') + '</div>';
  }

  function lineHtml(model) {
    if (model.error) return '<p class="nx-if-empty">' + esc(model.error) + '</p>';
    var it = model.items, n = it.length;
    if (n === 1) return barHtml(model, false);
    var top = model.max || 1;
    var pts = it.map(function (x, i) { return ((n === 1 ? 50 : (i / (n - 1)) * 100)).toFixed(2) + ',' + (100 - (x.value / top) * 100).toFixed(2); }).join(' ');
    var dots = it.map(function (x, i) { return '<circle cx="' + (n === 1 ? 50 : (i / (n - 1)) * 100).toFixed(2) + '" cy="' + (100 - (x.value / top) * 100).toFixed(2) + '" r="1.6" fill="#1d4f91" vector-effect="non-scaling-stroke"/>'; }).join('');
    var svg = '<svg class="nx-if-svg" viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="' + esc(model.title || 'line chart') + '">' +
      '<polyline points="' + pts + '" fill="none" stroke="#1d4f91" stroke-width="2" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>' + dots + '</svg>';
    var axis = '<div class="nx-if-xaxis"><span>' + esc(it[0].label) + '</span><span>' + esc(it[n - 1].label) + '</span></div>';
    return '<div class="nx-if-line"><div class="nx-if-linebox">' + svg + '</div>' + axis + '</div>';
  }

  function arc(cx, cy, r, a0, a1) {
    var p = function (a) { return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; };
    var s = p(a0), e = p(a1), large = (a1 - a0) > Math.PI ? 1 : 0;
    return 'M' + cx + ',' + cy + ' L' + s[0].toFixed(2) + ',' + s[1].toFixed(2) + ' A' + r + ',' + r + ' 0 ' + large + ' 1 ' + e[0].toFixed(2) + ',' + e[1].toFixed(2) + ' Z';
  }
  function pieHtml(model) {
    if (model.error) return '<p class="nx-if-empty">' + esc(model.error) + '</p>';
    var total = model.total || 0, a = -Math.PI / 2, paths = '';
    if (total <= 0) return '<p class="nx-if-empty">Nothing to chart.</p>';
    model.items.forEach(function (it) {
      var frac = it.value / total, a1 = a + frac * Math.PI * 2;
      paths += '<path d="' + arc(50, 50, 48, a, frac >= 0.9999 ? a1 - 0.0001 : a1) + '" fill="' + it.color + '"><title>' + esc(it.label + ': ' + fmtNum(it.value) + ' (' + Math.round(frac * 100) + '%)') + '</title></path>';
      a = a1;
    });
    var svg = '<svg class="nx-if-pie" viewBox="0 0 100 100" role="img" aria-label="' + esc(model.title || 'pie chart') + '">' + paths + '</svg>';
    var legend = '<ul class="nx-if-legend">' + model.items.map(function (it) {
      return '<li><span class="nx-if-dot" style="background:' + it.color + '"></span>' + esc(it.label) + ' <b>' + esc(fmtNum(it.value)) + '</b> <span class="nx-if-pct">' + Math.round(it.share * 100) + '%</span></li>';
    }).join('') + '</ul>';
    return '<div class="nx-if-pierow">' + svg + legend + '</div>';
  }

  function tableHtml(model) {
    var t = model.table;
    if (!t || !t.columns.length) return '<p class="nx-if-empty">No columns.</p>';
    var head = '<tr>' + t.columns.map(function (c) { return '<th>' + esc(c) + '</th>'; }).join('') + '</tr>';
    var body = t.rows.map(function (r) { return '<tr>' + r.map(function (v) { return '<td>' + esc(v == null ? '' : v) + '</td>'; }).join('') + '</tr>'; }).join('');
    return '<div class="nx-if-tablewrap"><table class="nx-if-table"><thead>' + head + '</thead><tbody>' + body + '</tbody></table>' +
      (t.more ? '<p class="nx-if-more">First ' + t.rows.length + ' rows.</p>' : '') + '</div>';
  }

  function kpiHtml(model) {
    if (model.error) return '<p class="nx-if-empty">' + esc(model.error) + '</p>';
    return '<div class="nx-if-kpi"><div class="nx-if-kpiv">' + esc(model.kpi.formatted) + '</div>' +
      (model.kpi.sub ? '<div class="nx-if-kpis">' + esc(model.kpi.sub) + '</div>' : '') + '</div>';
  }

  function bodyHtml(model) {
    switch (model.kind) {
      case 'kpi': return kpiHtml(model);
      case 'bar': return barHtml(model, false);
      case 'column': return barHtml(model, true);
      case 'line': return lineHtml(model);
      case 'pie': return pieHtml(model);
      default: return tableHtml(model);
    }
  }

  // cardHtml(model, { title }) → the infolet body (no outer frame; the page wraps it with its own header/toolbar)
  function cardHtml(model, opts) {
    opts = opts || {};
    if (!model) return '<p class="nx-if-empty">Nothing to show.</p>';
    return '<div class="nx-if-body nx-if-body--' + model.kind + '">' + bodyHtml(model) + '</div>';
  }

  // render(spec, data, opts) → { model, html } in one call
  function render(spec, data, opts) { var model = compute(spec, data); return { model: model, html: cardHtml(model, opts) }; }

  return {
    KINDS: KINDS, PALETTE: PALETTE,
    kinds: kinds, suggest: suggest, compute: compute, cardHtml: cardHtml, render: render,
    fmtNum: fmtNum, esc: esc
  };
}));
