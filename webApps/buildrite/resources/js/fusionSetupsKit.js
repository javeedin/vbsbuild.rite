define([], function () {
  'use strict';

  // Fusion Setups (Fusion SQL → Fusion Setups): the checklist's rules the page and its chain share. Pure, tested in node.
  //   shown(su)            the tasks the list shows: the module chosen, the filter, every word typed
  //   totals(tasks)        { total, done, missing, errors, unchecked } (inactive tasks left out)
  //   recount(mods, tasks) each module's counts again
  //   taskRows(su, now)    the list's lines: status label / class, rows found vs the minimum, when checked, the error
  //   moduleRows(su)       "All modules" + one per module with its counts and how much is done
  //   FILTERS              the filter buttons
  var FILTERS = [{ id: 'all', label: 'All' }, { id: 'missing', label: 'Not done' }, { id: 'error', label: 'Errors' }, { id: 'unchecked', label: 'Not checked' }, { id: 'done', label: 'Done' }];
  var STATUS = { DONE: { label: 'Done', cls: 'ok' }, MISSING: { label: 'Not done', cls: 'miss' }, ERROR: { label: 'Error', cls: 'err' } };

  function statusOf(t) { return t && t.result ? t.result.status : ''; }
  function inFilter(t, f) {
    var s = statusOf(t);
    if (f === 'missing') return s === 'MISSING';
    if (f === 'error') return s === 'ERROR';
    if (f === 'unchecked') return !s;
    if (f === 'done') return s === 'DONE';
    return true;
  }
  function shown(su) {
    var s = su || {};
    var words = String(s.q || '').toLowerCase().split(/\s+/).filter(Boolean);
    return (s.tasks || []).filter(function (t) {
      if (t.active === false || (s.module && t.module !== s.module) || !inFilter(t, s.filter || 'all')) return false;
      var hay = (t.name + ' ' + (t.fsm || '') + ' ' + (t.description || '') + ' ' + t.code + ' ' + (t.moduleName || '')).toLowerCase();
      return words.every(function (w) { return hay.indexOf(w) !== -1; });
    });
  }
  function totals(tasks) {
    var t = { total: 0, done: 0, missing: 0, errors: 0, unchecked: 0 };
    (tasks || []).forEach(function (x) {
      if (x.active === false) return;
      t.total++;
      var s = statusOf(x);
      if (s === 'DONE') t.done++; else if (s === 'MISSING') t.missing++; else if (s === 'ERROR') t.errors++; else t.unchecked++;
    });
    return t;
  }
  function recount(mods, tasks) {
    return (mods || []).map(function (m) { return Object.assign({}, m, totals((tasks || []).filter(function (x) { return x.module === m.code; }))); });
  }
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function ago(iso, now) {
    var d = new Date(iso);
    if (!iso || isNaN(d.getTime())) return '';
    var m = Math.max(0, Math.round(((now || Date.now()) - d.getTime()) / 60000));
    return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : m < 1440 ? Math.round(m / 60) + ' h ago' : d.getDate() + ' ' + MON[d.getMonth()] + ' ' + d.getFullYear();
  }
  function taskRows(su, now) {
    var busy = (su && su.busy) || {};
    var lastMod = '';
    return shown(su).map(function (t) {
      var r = t.result;
      var st = r ? STATUS[r.status] || { label: r.status, cls: '' } : { label: 'Not checked', cls: 'none' };
      var head = t.module !== lastMod;
      lastMod = t.module;
      return { code: t.code, name: t.name, fsm: t.fsm || '', description: t.description || '', module: t.module, moduleName: t.moduleName || t.module, head: head && !(su && su.module),
        status: busy[t.code] ? 'Checking…' : st.label, cls: busy[t.code] ? 'busy' : st.cls, busy: !!busy[t.code],
        count: r && r.count != null ? r.count.toLocaleString() + (r.count === 1 ? ' row' : ' rows') : '', min: t.minRows > 1 ? 'needs ' + t.minRows : '',
        when: r ? ago(r.at, now) + (r.ms != null ? ' · ' + (r.ms >= 1000 ? (r.ms / 1000).toFixed(1) + ' s' : r.ms + ' ms') : '') : '',
        error: r && r.status === 'ERROR' ? r.error || '' : '', optional: t.mandatory === false, own: t.source === 'USER' || t.source === 'CHANGED', source: t.source || '' };
    });
  }
  function pct(m) { return m.total ? Math.round(100 * m.done / m.total) : 0; }
  function moduleRows(su) {
    var s = su || {};
    var all = totals(s.tasks);
    return [{ code: '', name: 'All modules', on: !s.module, done: all.done, total: all.total, missing: all.missing, errors: all.errors, pct: pct(all) }]
      .concat((s.modules || []).map(function (m) { return { code: m.code, name: m.name, on: s.module === m.code, done: m.done, total: m.total, missing: m.missing, errors: m.errors, pct: pct(m) }; }));
  }

  return { FILTERS: FILTERS, shown: shown, totals: totals, recount: recount, taskRows: taskRows, moduleRows: moduleRows, ago: ago, pct: pct };
});
