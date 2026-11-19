define([], function () {
  'use strict';

  // BIP Reporting's calls to the desktop app's local server (desktop/lib/bipReports.js at /__bip/*, this PC only, behind
  // X-Build-Rite-BIP). Each resolves { ok, status, body } and never throws; body.error says what went wrong.
  function call(path, body) {
    if (typeof window === 'undefined' || typeof window.fetch !== 'function') return Promise.resolve({ ok: false, status: 0, body: { error: 'Not in a browser.' } });
    var opts = { method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store', headers: { 'X-Build-Rite-BIP': '1' } };
    if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    return window.fetch('/__bip/' + path, opts).then(function (r) {
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
    savePrefs: function (p) { return call('prefs', p); },
    folder: function (pod, path, refresh) { return call('folder?' + qs({ pod: pod, path: path, refresh: refresh ? 1 : '' })); },
    index: function (b) { return call('index', b); },
    progress: function (id) { return call('progress?' + qs({ id: id })); },
    cancel: function (id) { return call('cancel', { id: id }); },
    search: function (pod, q) { return call('search?' + qs({ pod: pod, q: q })); },
    definition: function (pod, path, refresh) { return call('definition?' + qs({ pod: pod, path: path, refresh: refresh ? 1 : '' })); },
    dataModel: function (pod, path) { return call('datamodel?' + qs({ pod: pod, path: path })); },
    run: function (b) { return call('run', b); },
    runs: function () { return call('runs'); },
    runRows: function (id, offset, limit) { return call('run?' + qs({ id: id, offset: offset, limit: limit })); },
    removeRun: function (id) { return call('run/remove', { id: id }); },
    openRun: function (id, folder) { return call('run/open', { id: id, folder: !!folder }); },
    fileUrl: function (id) { return '/__bip/run/file?' + qs({ id: id }); },
    favorites: function () { return call('favorites'); },
    toggleFavorite: function (f) { return call('favorite', f); },
    cards: function () { return call('cards'); },
    saveCard: function (card) { return call('card/save', { card: card }); },
    removeCard: function (id) { return call('card/remove', { id: id }); },
    runCard: function (pod, id) { return call('card/run', { pod: pod, id: id }); }
  };
});
