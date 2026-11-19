define([], function () {
  'use strict';

  // Fusion SQL's calls to the desktop app's local server (desktop/lib/fusionSql.js at /__fsql/*, this PC only, behind
  // X-Build-Rite-FSQL). Each resolves { ok, status, body } and never throws; body.error says what went wrong.
  function call(path, body) {
    if (typeof window === 'undefined' || typeof window.fetch !== 'function') return Promise.resolve({ ok: false, status: 0, body: { error: 'Not in a browser.' } });
    var opts = { method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store', headers: { 'X-Build-Rite-FSQL': '1' } };
    if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    return window.fetch('/__fsql/' + path, opts).then(function (r) {
      return r.text().then(function (t) {
        var b = null;
        try { b = t ? JSON.parse(t) : null; } catch (e) { b = { error: r.ok ? 'An answer that is not JSON.' : 'HTTP ' + r.status }; }
        return { ok: r.ok && !!b && b.ok !== false && !b.error, status: r.status, body: b || {} };
      });
    }, function (e) { return { ok: false, status: 0, body: { error: 'The local server did not answer: ' + ((e && e.message) || e) } }; });
  }
  var qs = function (o) { return Object.keys(o).filter(function (k) { return o[k] !== undefined && o[k] !== ''; }).map(function (k) { return k + '=' + encodeURIComponent(o[k]); }).join('&'); };

  return {
    settings: function () { return call('settings'); },
    savePod: function (p) { return call('pod/save', p); },
    removePod: function (id) { return call('pod/remove', { id: id }); },
    setActive: function (id) { return call('pod/active', { id: id }); },
    run: function (sql, rowLimit, pod) { return call('run', { sql: sql, rowLimit: rowLimit, pod: pod }); },
    test: function (pod) { return call('test', { pod: pod }); },
    deploy: function (pod) { return call('deploy', { pod: pod }); },
    calls: function (clear) { return clear ? call('calls/clear', {}) : call('calls'); },
    owners: function (pod, refresh) { return call('schema/owners?' + qs({ pod: pod, refresh: refresh ? 1 : '' })); },
    objects: function (pod, owner, kind, refresh) { return call('schema/objects?' + qs({ pod: pod, owner: owner, kind: kind, refresh: refresh ? 1 : '' })); },
    search: function (pod, owner, kind, q) { return call('schema/search?' + qs({ pod: pod, owner: owner, kind: kind, q: q })); },
    detail: function (pod, owner, kind, name, refresh) { return call('schema/detail?' + qs({ pod: pod, owner: owner, kind: kind, name: name, refresh: refresh ? 1 : '' })); },
    clearCache: function (pod) { return call('schema/clear', { pod: pod }); },
    cacheInfo: function (pod) { return call('schema/cache?' + qs({ pod: pod })); },
    queries: function () { return call('queries'); },
    saveQuery: function (q) { return call('queries/save', q); },
    removeQuery: function (id) { return call('queries/remove', { id: id }); },
    importQueries: function (list) { return call('queries/import', { queries: list }); },
    ranQuery: function (id) { return call('queries/ran', { id: id }); },
    ask: function (b) { return call('ask', b); },
    setups: function (pod) { return call('setups?' + qs({ pod: pod })); },
    setupCheck: function (pod, code) { return call('setups/check', { pod: pod, code: code }); },
    setupSave: function (task) { return call('setups/save', { task: task }); },
    setupRemove: function (code) { return call('setups/remove', { code: code }); },
    setupStarter: function () { return call('setups/starter', {}); },
    progress: function (id) { return call('ask/progress?' + qs({ id: id })); }
  };
});
