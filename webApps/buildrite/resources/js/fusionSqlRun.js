define(['resources/js/fusionSqlClient', 'resources/js/fusionSqlKit', 'resources/js/sqlWorksheet', 'resources/js/shellBus'], function (C, K, W, bus) {
  'use strict';

  // The Fusion SQL page's steps its chains share, on the page's variables (v):
  //   settings(v)              the pods again (st), the row limit from the pod in use
  //   statement(v)             what Run runs: the selection, else the statement under the cursor, else all of it
  //   run(v, sql, opts)        placeholders first (a dialog with remembered values), then runPlain
  //   runPlain(v, sql)         the pod's answer → res, the grid, a log line, the history
  //   regrid(v)                the page of the grid again (search, sort, page)
  //   schema(v, refresh)       owners and the object list of the owner and kind chosen (cached on the PC until Refresh)
  //   editor(v, sql)           puts SQL in the editor (and keeps it on this PC)
  var HIST = 'buildrite:fsql-history';
  var DRAFT = 'buildrite:fsql-editor';
  var PARAMS = 'buildrite:fsql-params';
  var ls = {
    get: function (k, d) { try { var x = window.localStorage.getItem(k); return x ? JSON.parse(x) : d; } catch (e) { return d; } },
    set: function (k, v) { try { window.localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* no storage */ } }
  };

  function activePod(v) { return ((v.st && v.st.pods) || []).filter(function (p) { return p.active; })[0] || null; }

  async function settings(v) {
    var r = await C.settings();
    if (r.body && r.body.unavailable) { v.available = false; return null; }
    v.available = true;
    var b = r.body || {};
    v.st = { pods: b.pods || [], active: b.active || '', suggest: b.suggest || {}, defaults: b.defaults || {}, keychain: !!b.keychain, runnerSql: b.runnerSql || '' };
    var p = activePod(v);
    if (p && !v.rowLimitSet) v.rowLimit = p.rowLimit || 100;
    return v.st;
  }

  function editor(v, sql) {
    v.sql = sql;
    ls.set(DRAFT, sql);
    var ed = typeof document !== 'undefined' && document.getElementById('fsqlEditor');
    if (ed) { ed.value = sql; ed.focus(); }
  }

  function statement(v) {
    var ed = typeof document !== 'undefined' && document.getElementById('fsqlEditor');
    var text = ed ? ed.value : (v.sql || '');
    if (ed && ed.selectionEnd > ed.selectionStart) return text.slice(ed.selectionStart, ed.selectionEnd);
    var list = W.split(text);
    if (list.length <= 1) return text;
    var hit = W.atCursor(text, ed ? ed.selectionStart : 0);
    return hit ? hit.text : text;
  }

  function regrid(v) { v.grid = K.view(v.res && v.res.ok ? v.res : null, v.view); }

  function log(v, text, ok) {
    var d = new Date();
    v.logs = [{ key: String(Date.now()) + Math.random(), at: d.toTimeString().slice(0, 8), text: text, ok: ok }].concat(v.logs || []).slice(0, 200);
  }

  async function runPlain(v, sql, opts) {
    var o = opts || {};
    var p = activePod(v);
    if (!p) { bus.toast('Add a Fusion pod first (Connection).', 'error'); v.tab = 'connection'; return null; }
    v.running = true;
    v.rtab = 'result';
    v.showRaw = false;
    v.exportOpen = false;
    var r;
    try { r = await C.run(sql, Number(v.rowLimit) || p.rowLimit || 100, p.id); } finally { v.running = false; }
    var b = r.body || {};
    var short = String(sql).replace(/\s+/g, ' ').trim().slice(0, 140);
    if (b.ok) {
      v.res = { ok: true, columns: b.columns || [], rows: b.rows || [], kinds: K.kinds(b.columns || [], b.rows || []), rowCount: b.rowCount || 0, capped: !!b.capped, cap: b.cap,
        ms: b.ms || 0, warning: b.warning || '', statement: sql, pod: b.pod || p.name, user: b.user || '', title: o.title || '' };
      v.view = { q: '', sortCol: '', sortDir: 1, page: 0 };
      log(v, b.rowCount + (b.rowCount === 1 ? ' row' : ' rows') + (b.capped ? ' (capped)' : '') + ' in ' + b.ms + ' ms — ' + short, true);
    } else {
      v.res = { ok: false, error: b.error || 'The pod did not answer.', raw: b.raw || '', decoded: b.decoded || '', statement: sql, ms: b.ms || 0 };
      log(v, 'ERROR: ' + String(b.error || '').split('\n')[0].slice(0, 200) + ' — ' + short, false);
      if (b.needsLogin || b.noPod) bus.toast(b.error, 'error');
    }
    regrid(v);
    var h = (v.history || []).filter(function (x) { return x.sql !== o.original && x.sql !== sql; });
    v.history = [{ sql: o.original || sql, at: new Date().toISOString() }].concat(h).slice(0, 30);
    ls.set(HIST, v.history);
    return b;
  }

  /** Run, asking first for the placeholders' values (remembered on this PC, per name). */
  async function run(v, sql, opts) {
    var text = String(sql || '').trim();
    if (!text) { bus.toast('Write a SELECT first.', 'error'); return null; }
    var names = K.params(text);
    if (names.length && !(opts && opts.values)) {
      var saved = ls.get(PARAMS, {});
      v.params = { sql: text, title: (opts && opts.title) || '', list: names.map(function (n) { return { name: n, value: saved[n.toUpperCase()] !== undefined ? saved[n.toUpperCase()] : '' }; }) };
      setTimeout(function () { var f = document.querySelector('#fsqlParams .nx-fsql-param'); if (f) f.focus(); }, 60);
      return null;
    }
    var values = (opts && opts.values) || {};
    if (names.length) {
      var keep = ls.get(PARAMS, {});
      Object.keys(values).forEach(function (k) { keep[k.toUpperCase()] = values[k]; });
      ls.set(PARAMS, keep);
    }
    return runPlain(v, names.length ? K.substitute(text, values) : text, { original: text, title: opts && opts.title });
  }

  async function schema(v, refresh) {
    var p = activePod(v);
    if (!p) return;
    var s = Object.assign({}, v.schema, { loading: true, error: '', found: null });
    v.schema = s;
    var o = await C.owners(p.id, refresh);
    var owners = o.ok ? o.body.owners : (v.schema.owners || []);
    var r = await C.objects(p.id, s.owner, s.kind, refresh);
    v.schema = Object.assign({}, v.schema, { loading: false, owners: owners, names: r.ok ? r.body.names : [], at: r.ok ? r.body.at : '', capped: r.ok && !!r.body.capped,
      error: !o.ok ? (o.body.error || '') : !r.ok ? (r.body.error || 'Could not read the list.') : '' });
  }

  return { settings: settings, statement: statement, run: run, runPlain: runPlain, regrid: regrid, schema: schema, editor: editor, activePod: activePod, log: log,
    HIST: HIST, DRAFT: DRAFT, PARAMS: PARAMS, ls: ls };
});
