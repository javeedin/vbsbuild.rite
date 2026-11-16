define([], function () {
  'use strict';

  // AI settings (the desktop app's desktop/lib/aiSql.js, /__sql/ai/*): the AIs set up on this PC — Claude Code on your
  // subscription, or an API key (Anthropic, OpenAI, Gemini, OCI, any OpenAI-compatible) — the default for everything and
  // the one each feature uses. Every answer: { ok, status, body }. Keys never come back.
  var BASE = '/__sql/ai/';
  function call(path, method, body) {
    if (typeof window === 'undefined' || typeof window.fetch !== 'function') return Promise.resolve({ ok: false, status: 0, body: { error: 'Not in a browser.' } });
    var opts = { method: method || 'GET', credentials: 'same-origin', cache: 'no-store', headers: { 'X-Build-Rite-SQL': '1' } };
    if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    return window.fetch(BASE + path, opts).then(function (r) {
      return r.text().then(function (t) {
        var b = null;
        try { b = t ? JSON.parse(t) : null; } catch (e) { b = { error: r.ok ? 'An answer that is not JSON.' : 'HTTP ' + r.status }; }
        return { ok: r.ok && !(b && b.error), status: r.status, body: b || {} };
      });
    }, function (e) { return { ok: false, status: 0, body: { error: 'The desktop app did not answer: ' + ((e && e.message) || e) } }; });
  }
  return {
    settings: function () { return call('settings'); },
    /** An AI's settings (its fields, key, model); makeDefault: false keeps the default as it is. */
    save: function (b) { return call('settings', 'POST', b); },
    forget: function (provider) { return call('forget', 'POST', { provider: provider }); },
    models: function (provider) { return call('models', 'POST', { provider: provider }); },
    setDefault: function (provider) { return call('default', 'POST', { provider: provider || '' }); },
    /** The AI one feature uses ('' = the default). */
    use: function (feature, provider) { return call('use', 'POST', { feature: feature, provider: provider || '' }); },
    // Claude Code on this PC: found? install (npm), sign in (a window of its own), test
    claude: function () { return call('claude'); },
    claudeInstall: function () { return call('claude/install', 'POST', {}); },
    claudeSignIn: function () { return call('claude/signin', 'POST', {}); },
    claudeCheck: function () { return call('claude/check', 'POST', {}); },
    /** A short question to the AI a feature uses, to see it answer (which one, how long). */
    test: function (feature) { return call('chat', 'POST', { feature: feature, system: 'Answer with one short sentence.', user: 'Say that you are ready, and name the AI you are.', maxTokens: 60 }); }
  };
});
