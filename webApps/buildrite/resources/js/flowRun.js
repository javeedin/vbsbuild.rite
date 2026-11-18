define([], function () {
  'use strict';

  // A saved flow's steps run for real (▶ Run on a step, Run on an action, Run the flow): which steps can run, the values
  // each starts from, what is still missing, the request sent to the API tester (desktop/lib/apiTest.js through
  // resources/js/apiClient.js — the app's backend, the same login), and the answer as a chip and a short table.
  // Pure: no DOM, no calls. A step that changes data is only ever sent from its own panel, once confirmed.
  var str = function (x) { return x == null ? '' : String(x); };
  var SHOW_ROWS = 8;
  var SHOW_COLS = 8;
  var KEEP_PRETTY = 12000;

  /** The report a step runs: "report NAME" (a report through a module), else the name in its object "… (NAME)". */
  function reportName(s) {
    var m = /^report\s+([A-Za-z0-9_.-]+)\s*$/.exec(str(s && s.endpoint)) || /\(([A-Z][A-Z0-9_]*)\)\s*$/.exec(str(s && s.object));
    return m ? m[1] : '';
  }

  /** Whether a step can run, and how: { ok, kind: 'rest' | 'report', endpoint, report, why }. */
  function what(s) {
    if (!s) return { ok: false, why: 'This step is not in the flow any more.' };
    if (s.manual || (!s.endpoint && !s.path)) return { ok: false, why: 'Added by hand: it has no call in the app to run.' };
    var e = str(s.endpoint).trim();
    if (/^report\s+/.test(e)) return { ok: true, kind: 'report', endpoint: '', report: reportName(s) };
    if (/^[\w.-]+\/[\w.-]+$/.test(e)) return { ok: true, kind: 'rest', endpoint: e, report: s.direction === 'Report' ? reportName(s) : '' };
    return { ok: false, why: 'Its call (' + (e || str(s.method) + ' ' + str(s.path)) + ') is not one of the app\'s services, so it cannot be sent from here.' };
  }

  /** The values a step starts from: the ones last used for its call, else its default, else a value seen in an earlier
   *  answer (an id a list gave); the body last used, else its template. `from` says where each came from. */
  function start(desc, had) {
    var op = (desc && desc.op) || {};
    var saved = (desc && desc.saved) || {};
    var sp = saved.params || {};
    var sug = (desc && desc.suggest) || {};
    var keep = (had && had.params) || {};
    var params = {};
    var from = {};
    (op.params || []).forEach(function (p) {
      var n = p.name;
      if (str(keep[n]).trim()) { params[n] = str(keep[n]); from[n] = 'yours'; } else if (str(sp[n]).trim()) { params[n] = str(sp[n]); from[n] = 'last used'; } else if (str(p.def).trim()) { params[n] = str(p.def); from[n] = 'its default'; } else if (sug[n] && sug[n].length) { params[n] = str(sug[n][0].value); from[n] = 'from ' + str(sug[n][0].from).split(' · ')[0]; } else params[n] = '';
    });
    var body = had && had.body !== undefined && had.body !== null ? str(had.body) : (saved.body ? str(saved.body) : (op.body ? str(op.body.template) : ''));
    return { params: params, extra: had && had.extra !== undefined ? str(had.extra) : str(saved.extra), body: body, from: from };
  }

  /** What must be filled in before it can be sent: its required parameters (a path's are), a required body. */
  function missing(desc, vals) {
    var op = (desc && desc.op) || {};
    var p = (vals && vals.params) || {};
    var out = (op.params || []).filter(function (x) { return x.required && !str(p[x.name]).trim(); }).map(function (x) { return x.name; });
    if (op.body && op.body.required && !str(vals && vals.body).trim()) out.push('the body');
    return out;
  }

  /** The request for the API tester (apiClient.run): a REST call or a report, with the values; confirm = it changes data. */
  function request(desc, vals, confirm) {
    var op = (desc && desc.op) || {};
    var v = vals || {};
    var base = { params: v.params || {}, extra: str(v.extra), body: op.report ? '' : str(v.body), confirm: !!confirm };
    if (op.report) return Object.assign(base, { report: { path: op.reportPath, name: op.reportName, params: (op.params || []).map(function (p) { return p.name; }), rowTag: op.rowTag || '' } });
    return Object.assign(base, { endpoint: op.endpoint });
  }

  /** An answer kept on the screen (not the whole of it): its status, time, size, rows, a short table, the text. */
  function keep(r, at) {
    var b = r || {};
    var t = b.table || null;
    var pretty = str(b.pretty);
    return { ok: !!b.ok, status: b.status || 0, statusText: str(b.statusText), ms: b.ms || 0, sizeText: str(b.sizeText), method: str(b.method), url: str(b.url).slice(0, 600),
      error: str(b.error), fault: str(b.fault), rows: t ? t.total : null, table: t ? preview(t) : null, from: t ? str(t.from) : '', meta: t ? str(t.meta) : '',
      shape: b.shape ? str(b.shape.status) : '', shapeText: b.shape && b.shape.status === 'differs' ? shapeText(b.shape) : '',
      pretty: pretty.slice(0, KEEP_PRETTY), cut: pretty.length > KEEP_PRETTY || !!b.truncated, at: str(at) };
  }
  function shapeText(sh) {
    var c = sh.counts || {};
    return [c.missing ? c.missing + ' field' + (c.missing === 1 ? '' : 's') + ' gone' : '', c.changed ? c.changed + ' changed type' : ''].filter(Boolean).join(', ') || 'differs from the example';
  }

  /** The first rows and columns of an answer's table, with what is not shown. */
  function preview(t, maxRows, maxCols) {
    var mr = maxRows || SHOW_ROWS;
    var mc = maxCols || SHOW_COLS;
    var cols = (t && t.columns) || [];
    var rows = (t && t.rows) || [];
    var total = t && t.total != null ? t.total : rows.length;
    var more = [total > mr ? (total - Math.min(mr, rows.length)) + ' more row' + (total - Math.min(mr, rows.length) === 1 ? '' : 's') : '', cols.length > mc ? (cols.length - mc) + ' more column' + (cols.length - mc === 1 ? '' : 's') : ''].filter(Boolean).join(' and ');
    return { columns: cols.slice(0, mc), rows: rows.slice(0, mr).map(function (r) { return (r || []).slice(0, mc).map(function (c) { return str(c).slice(0, 80); }); }), more: more };
  }

  /** "340 ms · 1.2 KB · 12 rows" */
  function facts(k) {
    if (!k) return '';
    return [k.ms + ' ms', k.sizeText, k.rows != null ? k.rows + (k.rows === 1 ? ' row' : ' rows') : ''].filter(Boolean).join(' · ');
  }

  /** A step's last run as a chip: { cls: ok | warn | fail | held | skip | busy, text, title } — its newest try (a call held
   *  or not sent this time says so, though an earlier answer is still in its panel). */
  function chip(r) {
    if (!r) return null;
    if (r.busy) return { cls: 'busy', text: 'Running…', title: '' };
    var k = r.res;
    var tried = r.state && r.state !== 'done';
    if (k && k.status && !tried) {
      var bad = !k.ok;
      var warn = !bad && k.shape === 'differs';
      return { cls: bad ? 'fail' : warn ? 'warn' : 'ok', text: k.status + (k.rows != null ? ' · ' + k.rows + (k.rows === 1 ? ' row' : ' rows') : '') + ' · ' + k.ms + ' ms',
        title: (k.statusText ? k.status + ' ' + k.statusText : String(k.status)) + (k.fault || k.error ? ' — ' + (k.fault || k.error) : '') + (warn ? ' — its answer ' + k.shapeText : '') };
    }
    if (r.state === 'held') return { cls: 'held', text: 'Changes data — not sent', title: r.note || 'Open it (▶ Run) and send it yourself.' };
    if (r.state === 'skip') return { cls: 'skip', text: r.short || 'Not run', title: r.note || '' };
    if (r.state === 'missing') return { cls: 'held', text: 'Needs ' + (r.need || []).join(', '), title: r.note || '' };
    if (r.state === 'error') return { cls: 'fail', text: 'Not sent', title: r.note || '' };
    return null;
  }

  /** Every step to run, in the flow's order (one action's, or all): { id, n, action, step, what }. */
  function plan(flow, actionId) {
    var out = [];
    ((flow && flow.actions) || []).forEach(function (a, ai) {
      if (actionId && a.id !== actionId) return;
      (a.steps || []).forEach(function (s, si) { out.push({ id: s.id, n: (ai + 1) + '.' + (si + 1), action: a.id, step: s, what: what(s) }); });
    });
    return out;
  }

  /** What a run of several steps did, in words. */
  function tally(list) {
    var c = { ok: 0, fail: 0, held: 0, skip: 0 };
    (list || []).forEach(function (x) { if (x === 'ok' || x === 'warn') c.ok++; else if (x === 'fail') c.fail++; else if (x === 'held') c.held++; else c.skip++; });
    var parts = [c.ok + ' ok'];
    if (c.fail) parts.push(c.fail + ' failed');
    if (c.held) parts.push(c.held + ' held (change data or need a value — send them from their own panel)');
    if (c.skip) parts.push(c.skip + ' not run (no call to send)');
    return { counts: c, text: parts.join(', ') };
  }

  return { what: what, reportName: reportName, start: start, missing: missing, request: request, keep: keep, preview: preview, facts: facts, chip: chip, plan: plan, tally: tally };
});
