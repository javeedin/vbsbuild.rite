define([], function () {
  'use strict';

  // Process Flows' calls to the desktop app's local server (desktop/lib/processFlows.js at /__pflow/*, this PC only, behind
  // X-Build-Rite-PFLOW). Each resolves { ok, status, body } and never throws; body.error says what went wrong.
  function call(path, body) {
    if (typeof window === 'undefined' || typeof window.fetch !== 'function') return Promise.resolve({ ok: false, status: 0, body: { error: 'Not in a browser.' } });
    var opts = { method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store', headers: { 'X-Build-Rite-PFLOW': '1' } };
    if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    return window.fetch('/__pflow/' + path, opts).then(function (r) {
      return r.text().then(function (t) {
        var b = null;
        try { b = t ? JSON.parse(t) : null; } catch (e) { b = { error: r.ok ? 'An answer that is not JSON.' : 'HTTP ' + r.status }; }
        return { ok: r.ok && !!b && b.ok !== false && !b.error, status: r.status, body: b || {} };
      });
    }, function (e) { return { ok: false, status: 0, body: { error: 'The local server did not answer: ' + ((e && e.message) || e) } }; });
  }
  var qs = function (o) { return Object.keys(o).filter(function (k) { return o[k] !== undefined && o[k] !== ''; }).map(function (k) { return k + '=' + encodeURIComponent(o[k]); }).join('&'); };

  return {
    list: function (q) { return call('list?' + qs({ q: q })); },
    get: function (id) { return call('get?' + qs({ id: id })); },
    save: function (flow) { return call('save', { flow: flow }); },
    remove: function (id) { return call('remove', { id: id }); },
    document: function (flow, app) { return call('document', { flow: flow, app: app }); },
    pdf: function (flow, app) { return call('pdf', { flow: flow, app: app }); },
    ai: function (flow) { return call('ai', { flow: flow }); }
  };
});
