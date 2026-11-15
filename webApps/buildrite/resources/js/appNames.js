define([], function () {
  'use strict';

  // Your workspace's apps (webApps/<app>) as the screens show them: the app's own id, a short mark made from it, and one
  // of six colours picked from the id, so the same app always looks the same. No app is known in advance. Pure.
  var TONES = 6;

  /** 'my-app' → 'MA', 'portal' → 'POR'; '' → 'VB'. */
  function short(app) {
    var s = String(app || '').replace(/[^A-Za-z0-9_-]/g, '');
    if (!s) return 'VB';
    var parts = s.split(/[-_]+/).filter(Boolean);
    if (parts.length > 1) return parts.map(function (p) { return p.charAt(0); }).join('').slice(0, 4).toUpperCase();
    return s.slice(0, 3).toUpperCase();
  }

  /** The app's colour: 'c0' … 'c5' (CSS: nx-pg-appmark--c0, nx-is-app--c0…). */
  function tone(app) {
    var h = 0;
    String(app || '').split('').forEach(function (c) { h = (h * 31 + c.charCodeAt(0)) >>> 0; });
    return 'c' + (h % TONES);
  }

  /** The apps among these pages ({ app, appName }), sorted, each once: [{ id, label, short }]. */
  function appsOf(pages) {
    var seen = {};
    var out = [];
    (pages || []).forEach(function (p) {
      var id = (p && (p.app || String(p.id || '').split('/')[0])) || '';
      if (!id || seen[id]) return;
      seen[id] = true;
      out.push({ id: id, label: (p && p.appName) || id, short: short(id) });
    });
    return out.sort(function (a, b) { return a.id.localeCompare(b.id); });
  }

  return { short: short, tone: tone, appsOf: appsOf };
});
