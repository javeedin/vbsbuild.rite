define([], function () {
  'use strict';

  // API Scenarios (desktop/lib/apiScenarios.js, /__api/scenarios*): a page's calls in order, run purely through the APIs.
  // Every answer: { ok, status, body }.
  function call(path, method, body) {
    if (typeof window === 'undefined' || typeof window.fetch !== 'function') return Promise.resolve({ ok: false, status: 0, body: { error: 'Not in a browser.' } });
    var opts = { method: method || 'GET', credentials: 'same-origin', cache: 'no-store', headers: { 'X-Build-Rite-Api': '1' } };
    if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    return window.fetch('/__api/scenarios' + path, opts).then(function (r) {
      return r.text().then(function (t) {
        var b = null;
        try { b = t ? JSON.parse(t) : null; } catch (e) { b = { error: r.ok ? 'An answer that is not JSON.' : 'HTTP ' + r.status }; }
        return { ok: r.ok && !!b && b.ok !== false && !b.error, status: r.status, body: b || {} };
      });
    }, function (e) { return { ok: false, status: 0, body: { error: 'The desktop app did not answer: ' + ((e && e.message) || e) } }; });
  }
  var q = function (k, v) { return k + '=' + encodeURIComponent(v || ''); };
  return {
    list: function (page) { return call('?' + q('page', page)); },
    get: function (id) { return call('/get?' + q('id', id)); },
    save: function (scenario) { return call('/save', 'POST', { scenario: scenario }); },
    remove: function (id) { return call('/remove', 'POST', { id: id }); },
    draft: function (page) { return call('/draft', 'POST', { page: page }); },
    run: function (id, allowWrites) { return call('/run', 'POST', { id: id, allowWrites: !!allowWrites }); },
    runs: function (page) { return call('/runs?' + q('page', page)); },
    runOf: function (page, run) { return call('/run-of?' + q('page', page) + '&' + q('run', run)); }
  };
});
