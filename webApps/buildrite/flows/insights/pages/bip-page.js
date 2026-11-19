define(['resources/js/bipKit', 'resources/js/shellBus'], (E, bus) => {
  'use strict';

  // BIP Reporting: binding helpers (none uses `this`). Enter in a parameter's box presses Run. Another screen can hand this
  // one a report to open: bus.focus('bip', { path, pod }).
  if (typeof window !== 'undefined' && typeof document !== 'undefined' && !window.__brBipKeys) {
    window.__brBipKeys = true;
    document.addEventListener('keydown', function (e) {
      var t = e.target;
      if (t && t.classList && t.classList.contains('nx-bip-param') && t.tagName === 'INPUT' && e.key === 'Enter') { var b = document.getElementById('bipRun'); if (b && !b.disabled) { e.preventDefault(); b.click(); } }
    }, true);
  }

  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function ago(iso) {
    var d = new Date(iso);
    if (!iso || isNaN(d.getTime())) return '';
    var m = Math.max(0, Math.round((Date.now() - d.getTime()) / 60000));
    return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : m < 1440 ? Math.round(m / 60) + ' h ago' : d.getDate() + ' ' + MON[d.getMonth()] + ' ' + d.getFullYear();
  }
  var ICON = { Folder: 'oj-ux-ico-folder', Report: 'oj-ux-ico-file-text', DataModel: 'oj-ux-ico-database' };
  var TYPE = { Folder: 'Folder', Report: 'Report', DataModel: 'Data model', SubTemplate: 'Sub-template', StyleTemplate: 'Style template' };
  var BY = [['none', 'One run'], ['days', 'Every n days'], ['week', 'Week'], ['month', 'Month'], ['quarter', 'Quarter'], ['year', 'Year']];
  var STATUS = { DONE: ['Done', 'ok'], PARTIAL: ['Partly done', 'miss'], FAILED: ['Failed', 'err'], RUNNING: ['Running', 'busy'] };
  function isFav(favs, pod, p) { return (favs || []).some(function (f) { return f.path === p && f.pod === pod; }); }
  function pairs(rep) { return rep && rep.def ? E.datePairs(rep.def.parameters) : []; }
  function labelOf(rep, name) { var p = ((rep && rep.def && rep.def.parameters) || []).filter(function (x) { return x.name === name; })[0]; return p ? (p.label || p.name) : name; }

  class PageModule {
    constructor(context) {
      var helper = context && typeof context.getEventHelper === 'function' ? context.getEventHelper() : null;
      if (bus && typeof bus.onFocus === 'function') bus.onFocus('bip', function () { if (helper) helper.fireCustomEvent('focusRequest', {}); });
    }
    whoText(st, pod) { var p = ((st && st.pods) || []).filter(function (x) { return x.id === pod; })[0]; return p ? 'as ' + (p.username || 'no login yet') : ''; }
    tabs(runs, cards, rep) {
      return [{ id: 'catalog', label: 'Catalog' }, { id: 'run', label: rep ? 'Run · ' + rep.name : 'Run' }, { id: 'dashboard', label: 'Dashboard' + ((cards || []).length ? ' (' + cards.length + ')' : '') },
        { id: 'history', label: 'History' + ((runs || []).length ? ' (' + runs.length + ')' : '') }, { id: 'settings', label: 'Settings' }];
    }
    favRows(favs, pod) { return (favs || []).filter(function (f) { return f.pod === pod; }).map(function (f) { return { path: f.path, name: f.name, type: f.type || 'Report', icon: ICON[f.type] || ICON.Report }; }); }
    recentRows(runs) {
      var seen = {};
      return (runs || []).filter(function (r) { if (seen[r.path]) return false; seen[r.path] = 1; return true; }).slice(0, 6)
        .map(function (r) { return { id: r.id, path: r.path, name: r.name, when: ago(r.started), cls: (STATUS[r.status] || ['', ''])[1] }; });
    }
    crumbs(p) {
      var out = [{ path: '/', label: 'Catalog' }];
      var acc = '';
      String(p || '/').split('/').filter(Boolean).forEach(function (seg) { acc += '/' + seg; out.push({ path: acc, label: seg }); });
      return out;
    }
    parentOf(p) { var s = String(p || ''); var i = s.lastIndexOf('/'); return i <= 0 ? '/' : s.slice(0, i); }
    indexLabel(ix) { return ix ? 'Update the index' : 'Index the catalog'; }
    indexTitle(ix) {
      return ix ? 'Walk the catalog again from ' + ix.root + ' and keep what changed since ' + ago(ix.at) + ' (' + ix.items + ' items in ' + ix.folders + ' folders now)'
        : 'Walk the catalog once (every folder) so the search box finds any report';
    }
    srcText(cat) {
      if (!cat) return '';
      if (cat.indexing) return 'Indexing… ' + cat.indexing.folders + ' folders, ' + cat.indexing.items + ' items' + (cat.indexing.label ? ' · ' + cat.indexing.label : '');
      var ix = cat.index;
      var idx = ix ? 'Index: ' + ix.items.toLocaleString() + ' items in ' + ix.folders + ' folders, ' + ago(ix.at) + (ix.mode === 'update' ? ' (' + ix.added + ' new, ' + ix.changed + ' changed, ' + ix.removed + ' gone)' : '') : 'Not indexed yet: the search box finds what was opened so far.';
      if (cat.found) return cat.found.length + ' found for “' + cat.q + '”' + (ix ? '' : ' in the folders opened so far') + ' · ' + idx;
      var src = cat.src === 'cache' ? 'From this PC, read ' + ago(cat.at) + ' — Refresh reads it again' : cat.src === 'fusion' ? 'From Fusion ' + ago(cat.at) + ', kept on this PC' : cat.src === 'index' ? 'From the index (Fusion did not list it)' : '';
      return [src, idx].filter(Boolean).join(' · ');
    }
    catRows(cat) {
      if (!cat) return [];
      var favs = cat.favorites || [];
      var list = cat.found || cat.items || [];
      return list.map(function (it) {
        return { path: it.absolutePath, name: it.displayName, type: it.type, typeLabel: TYPE[it.type] || it.type, icon: ICON[it.type] || 'oj-ux-ico-file',
          sub: cat.found ? it.parentAbsolutePath : [it.lastModified ? 'changed ' + ago(it.lastModified) : '', it.owner ? 'by ' + it.owner : ''].filter(Boolean).join(' · '), fav: isFav(favs, cat.podId, it.absolutePath) };
      });
    }
    isFav(favs, pod, p) { return isFav(favs, pod, p); }
    defNote(rep) {
      if (!rep || !rep.def) return '';
      var d = rep.def;
      return [d.defaultOutputFormat ? 'Default output ' + d.defaultOutputFormat.toUpperCase() : '', (d.templates || []).length ? (d.templates.length === 1 ? '1 layout' : d.templates.length + ' layouts') : 'no layout (data only)',
        d.dataModelUrl ? 'data model ' + d.dataModelUrl.split('/').pop() : '', rep.src === 'cache' ? 'parameters read ' + ago(rep.at) : ''].filter(Boolean).join(' · ');
    }
    paramNote(rep) { var n = rep && rep.def ? rep.def.parameters.length : 0; return n ? n + (n === 1 ? ' parameter' : ' parameters') + ' · dates in your format, sent in the report\'s' : 'This report takes no parameter.'; }
    paramRows(rep) {
      if (!rep || !rep.def) return [];
      var vals = rep.values || {};
      return rep.def.parameters.map(function (p) {
        var k = E.kind(p), v = vals[p.name];
        var row = { name: p.name, label: p.label || p.name, kind: k, value: v == null ? '' : (Array.isArray(v) ? v.join(', ') : String(v)), checked: v === true || v === 'true', multi: !!p.multiValuesAllowed, options: [],
          hint: [p.label && p.label !== p.name ? p.name : '', p.dateFormatString ? p.dateFormatString : '', k === 'hidden' ? 'hidden' : '', p.multiValuesAllowed ? 'several' : ''].filter(Boolean).join(' · ') };
        if (k === 'menu') {
          var values = (p.values && p.values.length ? p.values : p.lovLabels) || [];
          var chosen = Array.isArray(v) ? v.map(String) : (v == null || v === '' ? [] : [String(v)]);
          var opts = [];
          if (p.multiValuesAllowed || p.selectAsAll) opts.push({ value: '__ALL__', label: 'All', on: chosen.indexOf('__ALL__') !== -1 });
          else opts.push({ value: '', label: '—', on: !chosen.length });
          values.forEach(function (x, i) { opts.push({ value: String(x), label: (p.lovLabels && p.lovLabels[i]) || String(x), on: chosen.indexOf(String(x)) !== -1 }); });
          row.options = opts;
        }
        return row;
      });
    }
    formatRows(rep) {
      if (!rep || !rep.def) return [];
      var list = E.formats(rep.def), d = E.defaultFormat(rep.def, list);
      return list.map(function (f) { return { value: f.value, label: f.label + (f.value === d ? ' (default)' : '') + (f.data ? ' · rows' : ''), on: f.value === rep.format }; });
    }
    pairRows(rep) {
      var cur = rep && rep.bucket ? rep.bucket.pair : '';
      return [{ id: '', label: '—', on: !cur }].concat(pairs(rep).map(function (p) { var id = p.from + '|' + p.to; return { id: id, label: labelOf(rep, p.from) + ' → ' + labelOf(rep, p.to), on: id === cur }; }));
    }
    byRows(by) { return BY.map(function (b) { return { id: b[0], label: b[1], on: (by || 'none') === b[0] }; }); }
    planText(rep) {
      if (!rep || !rep.bucket || rep.bucket.by === 'none') return '';
      var pr = String(rep.bucket.pair || '').split('|');
      if (pr.length !== 2) return 'Choose the two dates to cut.';
      var v = rep.values || {};
      var list = E.buckets({ from: v[pr[0]], to: v[pr[1]], by: rep.bucket.by, n: rep.bucket.by === 'days' ? rep.bucket.n : 1 });
      if (!list.length) return 'Give ' + labelOf(rep, pr[0]) + ' and ' + labelOf(rep, pr[1]) + ': the range is cut between them.';
      return list.length + (list.length === 1 ? ' run' : ' runs') + ' (' + list[0].label + (list.length > 1 ? ' … ' + list[list.length - 1].label : '') + '), their rows joined into one table with a BUCKET column.';
    }
    statusCls(s) { return (STATUS[s] || ['', ''])[1]; }
    statusLabel(run) { return run ? (STATUS[run.status] || [run.status])[0] + (run.stopped ? ' · stopped' : '') : ''; }
    resText(res, grid) {
      if (!res || !res.run) return '';
      var r = res.run;
      var bits = [];
      if (r.rows != null) bits.push((grid && grid.shown !== grid.total ? grid.shown.toLocaleString() + ' of ' : '') + r.rows.toLocaleString() + (r.rows === 1 ? ' row' : ' rows') + (r.capped ? ' (cut)' : '') + ' · ' + r.columns + ' columns');
      bits.push(r.format.toUpperCase() + ' ' + E.fmtBytes(r.bytes || 0));
      if (r.buckets > 1) bits.push(r.buckets + ' buckets');
      bits.push(E.fmtMs(r.ms || 0));
      bits.push(r.pod);
      if (res.sent && r.rows > res.sent) bits.push('the first ' + res.sent.toLocaleString() + ' rows shown (all in the file)');
      return bits.join(' · ');
    }
    partErrors(run) { return ((run && run.parts) || []).filter(function (p) { return !p.ok; }).map(function (p) { return (p.label ? p.label + ': ' : '') + p.error; }); }
    anyBusy(m) { return Object.keys(m || {}).some(function (k) { return m[k]; }); }
    cardRows(cards, busy) {
      return (cards || []).map(function (c) {
        var l = c.last;
        var cols = l && l.columns ? l.columns.slice(0, 5) : [];
        var cells = [];
        if (l && l.preview) l.preview.slice(0, 5).forEach(function (row) { cols.forEach(function (k) { cells.push(row[k] == null ? '' : String(row[k])); }); });
        return { id: c.id, name: c.name, busy: !!(busy && busy[c.id]), sub: c.path.split('/').pop().replace(/\.xdo$/i, '') + (c.rolling ? ' · the last ' + c.rolling.days + ' days' : '') + (c.measure && c.measure.mode !== 'count' ? ' · ' + c.measure.mode + ' of ' + c.measure.column : ''),
          value: busy && busy[c.id] ? 'Running…' : l ? (l.ok ? E.fmtNum(l.value) : '—') : 'Not run yet', meta: l ? (l.ok ? (l.rows != null ? l.rows.toLocaleString() + ' rows · ' : '') + ago(l.at) + ' · ' + E.fmtMs(l.ms || 0) : ago(l.at)) : '',
          error: l && !l.ok ? l.error : '', cols: cols, preview: cells };
      });
    }
    histRows(runs, q) {
      var words = String(q || '').toLowerCase().split(/\s+/).filter(Boolean);
      return (runs || []).filter(function (r) { var hay = (r.name + ' ' + r.path + ' ' + r.pod + ' ' + r.format + ' ' + r.status).toLowerCase(); return words.every(function (w) { return hay.indexOf(w) !== -1; }); })
        .map(function (r) {
          var st = STATUS[r.status] || [r.status, ''];
          return { id: r.id, name: r.name, status: st[0] + (r.stopped ? ' · stopped' : ''), cls: st[1], sub: r.pod + ' · ' + r.path + ' · ' + String(r.format).toUpperCase() + (r.buckets > 1 ? ' · ' + r.buckets + ' buckets' : ''),
            meta: [ago(r.started), r.rows != null ? r.rows.toLocaleString() + ' rows' : '', E.fmtBytes(r.bytes || 0), E.fmtMs(r.ms || 0)].filter(Boolean).join(' · '), error: r.status === 'FAILED' ? r.error : '',
            hasRows: r.rows != null && r.rows > 0, hasFile: !!r.file };
        });
    }
    dmNote(dm) { return dm && dm.ok ? (dm.dataSets.length + (dm.dataSets.length === 1 ? ' data set' : ' data sets') + (dm.dataSource ? ' · data source ' + dm.dataSource : '') + (dm.parameters.length ? ' · parameters ' + dm.parameters.map(function (p) { return p.name; }).join(', ') : '')) : ''; }
    dmRows(dm) { return dm && dm.ok ? dm.dataSets.map(function (d, i) { return { i: String(i), name: d.name, dataSource: d.dataSource, sql: d.sql }; }) : []; }
  }

  return PageModule;
});
