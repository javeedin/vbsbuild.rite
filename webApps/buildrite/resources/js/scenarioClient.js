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
    // draft from the page; into = the scenario open (its id, name and notes kept, its main page's steps read again)
    // a run's report (its printable HTML) printed to PDF by the desktop app: { base64, size }
    pdf: function (html, name) { return call('/pdf', 'POST', { html: html, name: name || '' }); },
    draft: function (page, into) { return call('/draft', 'POST', { page: page, into: into || null }); },
    // the journey continued on a page the last one goes to; where a page goes next
    extend: function (scenario, page) { return call('/extend', 'POST', { scenario: scenario, page: page }); },
    unlink: function (scenario, page) { return call('/unlink', 'POST', { scenario: scenario, page: page }); },
    relink: function (scenario, page) { return call('/relink', 'POST', { scenario: scenario, page: page }); },
    next: function (page) { return call('/next?' + q('page', page)); },
    // the page's flow (every page it leads to, how far each is tested); a journey along a path of it
    flow: function (page) { return call('/flow?' + q('page', page)); },
    path: function (scenario, pages) { return call('/path', 'POST', { scenario: scenario || null, pages: pages || [] }); },
    // every API of a page (to test one, or build a scenario from them); the order to run a scenario's steps in
    apis: function (page) { return call('/apis?' + q('page', page)); },
    suggest: function (scenario) { return call('/suggest', 'POST', { scenario: scenario }); },
    // scope 'main': the scenario's own page only; else the whole flow
    run: function (id, allowWrites, scope) { return call('/run', 'POST', { id: id, allowWrites: !!allowWrites, scope: scope || '' }); },
    // one step tried on its own, from the scenario as it is on the screen, with the values handed on so far
    tryStep: function (scenario, step, vars, allowWrites, search) { return call('/try', 'POST', { scenario: scenario, step: step, vars: vars || {}, allowWrites: !!allowWrites, search: search }); },
    // the page your app's window is on: { open, url, page, label }
    where: function () { return call('/where'); },
    runs: function (page) { return call('/runs?' + q('page', page)); },
    runOf: function (page, run) { return call('/run-of?' + q('page', page) + '&' + q('run', run)); }
  };
});
