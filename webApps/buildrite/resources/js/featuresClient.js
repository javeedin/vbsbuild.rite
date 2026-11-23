define([], function () {
  'use strict';

  // Saved feature lists, for "Features" (insights/jira-features). The desktop app (or npm run serve) keeps them on this PC
  // (desktop/lib/featureLists.js at /__features/*, behind X-Build-Rite-Features); where there is no such server (VBCS)
  // this browser keeps them (localStorage). Either way the calls are the same and never throw. Only the grouping is kept
  // (a project → its features, each with a name, a one-line description and its story keys); the stories are read live.
  //
  //   get(project)    the saved list { project, features: [{ name, description, storyKeys }], by, source, at } or null
  //   save(item)      keeps a draft (replacing the project's last) → the saved item (with at, by), or null
  //   remove(project) forgets a project's list
  //   where()         'server' | 'local' once known (for the status line)

  var LS = 'eqr-feature-lists';
  var mode = ''; // 'server' | 'local'

  function proj(p) {
    var s = String(p == null ? '' : p).trim().toUpperCase();
    if (!s) return '_ALL';
    return /^[A-Z][A-Z0-9_]*$/.test(s) ? s : '';
  }
  function call(path, method, body) {
    if (typeof window === 'undefined' || typeof window.fetch !== 'function') return Promise.resolve({ ok: false, status: 0, body: {} });
    var opts = { method: method || 'GET', credentials: 'same-origin', cache: 'no-store', headers: { 'X-Build-Rite-Features': '1' } };
    if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    return window.fetch('/__features/' + path, opts).then(function (r) {
      return r.text().then(function (t) {
        var b = null;
        try { b = t ? JSON.parse(t) : null; } catch (e) { b = null; }
        return { ok: r.ok && !!b && b.ok !== false, status: r.status, body: b || {} };
      });
    }, function () { return { ok: false, status: 0, body: {} }; });
  }
  function lsRead() { try { var j = JSON.parse(window.localStorage.getItem(LS) || '{}'); return j && typeof j === 'object' ? j : {}; } catch (e) { return {}; } }
  function lsWrite(all) {
    try {
      var keys = Object.keys(all).sort(function (a, b) { return String(all[b].at).localeCompare(String(all[a].at)); });
      keys.slice(500).forEach(function (k) { delete all[k]; });
      window.localStorage.setItem(LS, JSON.stringify(all));
      return true;
    } catch (e) { return false; }
  }
  function clean(b) {
    var o = b || {};
    var seen = {};
    var features = (Array.isArray(o.features) ? o.features : []).slice(0, 500).map(function (f) {
      var ff = f || {};
      var keys = (Array.isArray(ff.storyKeys) ? ff.storyKeys : []).map(function (k) { return String(k || '').trim().toUpperCase(); })
        .filter(function (k) { return k && /^[A-Z][A-Z0-9]*-\d+$/.test(k) && !seen[k] && (seen[k] = true); });
      return { name: String(ff.name || '').slice(0, 200), description: String(ff.description || '').slice(0, 600), storyKeys: keys };
    }).filter(function (f) { return f.name || f.storyKeys.length; });
    return features;
  }

  function detect() {
    if (mode) return Promise.resolve(mode);
    return call('index').then(function (r) {
      mode = (r.status === 200 && r.body && r.body.ok) ? 'server' : 'local';
      return mode;
    });
  }

  function get(project) {
    var k = proj(project);
    if (!k) return Promise.resolve(null);
    return detect().then(function () {
      if (mode === 'server') return call('get?project=' + encodeURIComponent(k === '_ALL' ? '' : k)).then(function (r) { return r.ok && r.body.item ? r.body.item : null; });
      return lsRead()[k] || null;
    });
  }
  function save(item) {
    var b = item || {};
    var k = proj(b.project);
    if (!k) return Promise.resolve(null);
    var doc = { project: k === '_ALL' ? '' : k, features: clean(b), by: String(b.by || '').slice(0, 120), source: String(b.source || '').slice(0, 120) };
    return detect().then(function () {
      if (mode === 'server') return call('save', 'POST', doc).then(function (r) { return r.ok && r.body.item ? r.body.item : null; });
      var all = lsRead();
      doc.at = new Date().toISOString();
      all[k] = doc; lsWrite(all);
      return doc;
    });
  }
  function remove(project) {
    var k = proj(project);
    if (!k) return Promise.resolve({ ok: true });
    return detect().then(function () {
      if (mode === 'server') return call('remove', 'POST', { project: k === '_ALL' ? '' : k }).then(function (r) { return r.body || { ok: true }; });
      var all = lsRead(); delete all[k]; lsWrite(all);
      return { ok: true };
    });
  }

  return { get: get, save: save, remove: remove, where: function () { return mode; } };
});
