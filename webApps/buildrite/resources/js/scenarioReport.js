define([], function () {
  'use strict';

  // An API scenario's test results as a report: one model (resources/js/scenarioReport.js, pure — no DOM), shown three
  // ways — a printable A4 document (the PDF: previewed in a frame, printed to PDF by the desktop app), the sheets of an
  // Excel workbook (Summary, Steps, Checks, Evidence; written by exportKit.xlsxBook) and their preview.
  //
  // model(scenario, run, { pages, fmt, answers, madeBy, now }): the scenario as it is (its ID, name, type, page, flow) and
  // one of its runs (desktop/lib/apiScenarios.js run: rows of steps, each with its checks, request and answer).

  var KINDS = { happy: 'Happy path', edge: 'Edge case', role: 'Role', data: 'Data-driven' };
  var RESULT = { ok: 'Passed', fail: 'Failed', skip: 'Not run' };
  var MAX_ANSWER = 4000; // characters of an answer kept as evidence (Excel cell, PDF block)

  function str(v) { return v === undefined || v === null ? '' : String(v); }
  function lastPart(p) { return str(p).split('/').pop() || str(p); }
  function defaultFmt(iso) {
    if (!iso) return '';
    try {
      var d = new Date(iso);
      if (isNaN(d.getTime())) return str(iso);
      return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) + ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    } catch (e) { return str(iso); }
  }
  function seconds(ms) { return Math.round((Number(ms) || 0) / 100) / 10; }

  function model(sc, run, opts) {
    var o = opts || {};
    var s = sc || {};
    var r = run || {};
    var fmt = typeof o.fmt === 'function' ? o.fmt : defaultFmt;
    var answers = o.answers !== false;
    var labels = {};
    (o.pages || []).forEach(function (p) { if (p && p.id) labels[p.id] = p.label || ''; });
    (s.journey || []).forEach(function (j) { if (j && j.page && j.label) labels[j.page] = j.label; });
    var label = function (id) { return labels[id] || lastPart(id); };
    var byStep = {};
    (s.steps || []).forEach(function (st, i) { byStep[st.id] = { n: i + 1, st: st }; });
    var rows = r.rows || [];
    var multi = rows.length > 1;
    var steps = [];
    var checks = [];
    var evidence = [];
    rows.forEach(function (row, ri) {
      var rowText = multi ? 'Row ' + (ri + 1) + (row.vars && Object.keys(row.vars).length ? ': ' + Object.keys(row.vars).map(function (k) { return k + '=' + row.vars[k]; }).join(', ') : '') : '';
      (row.steps || []).forEach(function (x) {
        var at = byStep[x.step] || {};
        var st = at.st || {};
        var page = st.page || s.page || r.page || '';
        var method = x.request ? str(x.request.method) : (st.report ? 'REPORT' : str(st.api && st.api.method));
        var cs = x.checks || [];
        var okN = cs.filter(function (c) { return c.ok; }).length;
        var base = { row: ri + 1, rowText: rowText, n: at.n || '', step: str(x.name) };
        steps.push({ row: base.row, rowText: rowText, n: base.n, page: label(page), pagePath: page, name: base.step, method: method, call: str(x.call),
          url: x.request ? str(x.request.url) : '', state: x.state || 'skip', result: RESULT[x.state] || 'Not run',
          status: x.status ? Number(x.status) : '', ms: x.state === 'skip' && !x.status ? '' : (Number(x.ms) || 0), rows: x.rows === null || x.rows === undefined ? '' : Number(x.rows),
          checks: cs.length ? okN + ' of ' + cs.length : '', checksOk: okN, checksTotal: cs.length,
          handed: Object.keys(x.extracted || {}).map(function (k) { return k + ' = ' + x.extracted[k]; }).join(', '), note: str(x.note) });
        cs.forEach(function (c) {
          checks.push({ row: base.row, rowText: rowText, n: base.n, step: base.step, check: str(c.name), ok: !!c.ok, result: c.ok ? 'Passed' : 'Failed', detail: str(c.detail) });
        });
        if (answers && x.request) {
          var a = str(x.answer);
          evidence.push({ row: base.row, rowText: rowText, n: base.n, step: base.step, request: method + ' ' + str(x.request.url), status: x.status ? Number(x.status) : '',
            ms: Number(x.ms) || 0, answer: a.length > MAX_ANSWER ? a.slice(0, MAX_ANSWER) + '\n… (cut: ' + a.length + ' characters in all)' : a });
        }
      });
    });
    var checksOk = checks.filter(function (c) { return c.ok; }).length;
    var flow = (s.journey || []).map(function (j) { return label(j.page); });
    var scope = r.scope === 'main' ? 'Main page' : 'Whole flow';
    var verdict = r.ok ? 'PASSED' : 'FAILED';
    var code = str(s.code);
    var name = str(s.name || r.name);
    var pageId = str(s.page || r.page);
    var made = fmt(o.now || new Date().toISOString());
    var summary = [
      ['Scenario ID', code || '—'],
      ['Scenario', name],
      ['Type', KINDS[s.kind] || KINDS.happy],
      ['Page tested', label(pageId) + ' — ' + pageId],
      ['Flow', flow.length > 1 ? flow.join(' → ') : 'The page alone'],
      ['What ran', scope],
      ['Result', verdict],
      ['Run at', fmt(r.at)],
      ['Run by', str(r.by) || '—'],
      ['Steps', (r.passed || 0) + ' passed · ' + (r.failed || 0) + ' failed · ' + (r.skipped || 0) + ' not run'],
      ['Checks', checksOk + ' passed · ' + (checks.length - checksOk) + ' failed'],
      ['Time', seconds(r.ms) + ' s'],
      ['Data rows', String(rows.length || 1)],
      ['Writes allowed', s.allowWrites ? 'Yes' : 'No (calls that change data are held back)'],
      ['Notes', str(s.notes)],
      ['Report made', made + (o.madeBy ? ' by ' + o.madeBy : '')]
    ].map(function (p) { return { field: p[0], value: p[1] }; });
    return {
      title: (code ? code + ' · ' : '') + name,
      file: (code || 'scenario') + '-test-results',
      verdict: verdict, ok: !!r.ok, scope: scope, runAt: fmt(r.at), runBy: str(r.by), made: made,
      page: { id: pageId, label: label(pageId) }, flow: flow, kind: KINDS[s.kind] || KINDS.happy, code: code, name: name, notes: str(s.notes),
      counts: { passed: r.passed || 0, failed: r.failed || 0, skipped: r.skipped || 0, checksOk: checksOk, checksFailed: checks.length - checksOk, seconds: seconds(r.ms), rows: rows.length || 1 },
      multi: multi, summary: summary, steps: steps, checks: checks, evidence: evidence, answers: answers
    };
  }

  // ── Excel: the sheets (rows + columns, as exportKit.xlsxBook takes them) ─────────────────────────────────────────
  function sheets(m) {
    var rowCol = m.multi ? [{ key: 'rowText', label: 'Data row' }] : [];
    var out = [
      { name: 'Summary', rows: m.summary, columns: [{ key: 'field', label: 'Field' }, { key: 'value', label: 'Value' }] },
      { name: 'Steps', rows: m.steps, columns: rowCol.concat([
        { key: 'n', label: 'Step', type: 'number' }, { key: 'page', label: 'Page' }, { key: 'name', label: 'Step name' }, { key: 'method', label: 'Method' },
        { key: 'call', label: 'API' }, { key: 'result', label: 'Result' }, { key: 'status', label: 'HTTP status', type: 'number' }, { key: 'ms', label: 'Time (ms)', type: 'number' },
        { key: 'rows', label: 'Rows', type: 'number' }, { key: 'checks', label: 'Checks passed' }, { key: 'handed', label: 'Values handed on' }, { key: 'note', label: 'Note' },
        { key: 'url', label: 'Request' }]) },
      { name: 'Checks', rows: m.checks, columns: rowCol.concat([
        { key: 'n', label: 'Step', type: 'number' }, { key: 'step', label: 'Step name' }, { key: 'check', label: 'Check' }, { key: 'result', label: 'Result' }, { key: 'detail', label: 'Got' }]) }
    ];
    if (m.answers) {
      out.push({ name: 'Evidence', rows: m.evidence, columns: rowCol.concat([
        { key: 'n', label: 'Step', type: 'number' }, { key: 'step', label: 'Step name' }, { key: 'request', label: 'Request' }, { key: 'status', label: 'HTTP status', type: 'number' },
        { key: 'ms', label: 'Time (ms)', type: 'number' }, { key: 'answer', label: 'Answer' }]) });
    }
    return out;
  }

  /** The sheets as a preview shows them: head and body cells, a result cell marked passed / failed / not run. */
  function preview(m, maxRows) {
    var cap = maxRows || 200;
    var cls = function (v) { return v === 'Passed' || v === 'PASSED' ? 'ok' : v === 'Failed' || v === 'FAILED' ? 'bad' : v === 'Not run' ? 'skip' : ''; };
    return sheets(m).map(function (sh) {
      var body = (sh.rows || []).slice(0, cap).map(function (r, i) {
        return { n: String(i + 2), cells: sh.columns.map(function (c) {
          var v = r[c.key];
          var text = v === undefined || v === null ? '' : String(v);
          var shown = text.length > 300 ? text.slice(0, 300) + '…' : text;
          return { v: shown, full: text, cls: (c.key === 'result' || c.key === 'value' ? cls(text) : '') + (c.type === 'number' ? ' num' : ''), num: c.type === 'number' };
        }) };
      });
      return { name: sh.name, count: (sh.rows || []).length, more: Math.max(0, (sh.rows || []).length - cap),
        letters: sh.columns.map(function (c, i) { return colName(i); }), head: sh.columns.map(function (c) { return c.label; }), body: body };
    });
  }
  function colName(i) {
    var s = '';
    for (var n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
    return s;
  }

  // ── PDF: a printable document (A4 landscape), also its own preview ──────────────────────────────────────────────
  function esc(s) { return str(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  function html(m, opts) {
    var o = opts || {};
    var stateCls = function (st) { return st === 'ok' ? 'ok' : st === 'fail' ? 'bad' : 'skip'; };
    var kpi = function (n, what, cls) { return '<div class="kpi ' + (cls || '') + '"><b>' + esc(n) + '</b><span>' + esc(what) + '</span></div>'; };
    var rowCol = m.multi;
    var stepsHtml = !m.steps.length ? '<p class="none">No step ran.</p>'
      : '<table class="t steps"><thead><tr>' + (rowCol ? '<th>Data row</th>' : '') + '<th class="n">#</th><th>Page</th><th>Step</th><th>API</th><th>Result</th><th class="n">HTTP</th><th class="n">ms</th><th class="n">Rows</th><th>Checks</th><th>Note · values handed on</th></tr></thead><tbody>'
        + m.steps.map(function (s) {
          return '<tr>' + (rowCol ? '<td>' + esc(s.rowText) + '</td>' : '') + '<td class="n">' + esc(s.n) + '</td><td>' + esc(s.page) + '</td><td><b>' + esc(s.name) + '</b></td>'
            + '<td><span class="m">' + esc(s.method) + '</span> <code>' + esc(s.call) + '</code></td>'
            + '<td><span class="pill ' + stateCls(s.state) + '">' + esc(s.result) + '</span></td><td class="n">' + esc(s.status) + '</td><td class="n">' + esc(s.ms) + '</td><td class="n">' + esc(s.rows) + '</td>'
            + '<td>' + esc(s.checks) + '</td><td class="small">' + esc(s.note) + (s.note && s.handed ? '<br>' : '') + (s.handed ? 'hands on: ' + esc(s.handed) : '') + '</td></tr>';
        }).join('') + '</tbody></table>';
    var checksHtml = !m.checks.length ? '<p class="none">No check ran.</p>'
      : '<table class="t checks"><thead><tr>' + (rowCol ? '<th>Data row</th>' : '') + '<th class="n">#</th><th>Step</th><th>Check</th><th>Result</th><th>Got</th></tr></thead><tbody>'
        + m.checks.map(function (c) {
          return '<tr' + (c.ok ? '' : ' class="badrow"') + '>' + (rowCol ? '<td>' + esc(c.rowText) + '</td>' : '') + '<td class="n">' + esc(c.n) + '</td><td>' + esc(c.step) + '</td><td>' + esc(c.check) + '</td>'
            + '<td><span class="pill ' + (c.ok ? 'ok' : 'bad') + '">' + esc(c.result) + '</span></td><td class="small">' + esc(c.detail) + '</td></tr>';
        }).join('') + '</tbody></table>';
    var evidenceHtml = !m.answers ? '' : '<h2>Evidence: each request and its answer</h2>' + (!m.evidence.length ? '<p class="none">No request was sent.</p>'
      : m.evidence.map(function (e) {
        var a = e.answer.length > 1500 ? e.answer.slice(0, 1500) + '\n… (the full answer is in the Excel workbook)' : e.answer;
        return '<div class="ev"><div class="evh"><b>' + esc((e.n ? 'Step ' + e.n + ' · ' : '') + e.step) + '</b>' + (e.rowText ? ' <span class="small">' + esc(e.rowText) + '</span>' : '')
          + ' <span class="small">' + esc(e.status) + ' · ' + esc(e.ms) + ' ms</span></div><code class="req">' + esc(e.request) + '</code>' + (a ? '<pre>' + esc(a) + '</pre>' : '<p class="none">No answer body.</p>') + '</div>';
      }).join(''));
    var facts = m.summary.filter(function (f) { return f.field !== 'Notes' || f.value; }).map(function (f) {
      return '<tr><th>' + esc(f.field) + '</th><td>' + (f.field === 'Result' ? '<span class="pill ' + (m.ok ? 'ok' : 'bad') + '">' + esc(f.value) + '</span>' : esc(f.value)) + '</td></tr>';
    }).join('');
    return '<!doctype html><html><head><meta charset="utf-8"><title>' + esc('Test results — ' + m.title) + '</title><style>'
      + '@page { size: A4 landscape; margin: 11mm; }'
      + '* { box-sizing: border-box; }'
      + 'body { margin: 0; font: 9.5pt/1.4 "Oracle Sans", "Segoe UI", Arial, sans-serif; color: #111827; }'
      + '.doc { padding: 0; }'
      + '@media screen { body { background: #e7e9ee; padding: 16px; } .doc { background: #fff; max-width: 1120px; margin: 0 auto; padding: 28px 32px; box-shadow: 0 2px 12px rgba(15,23,42,.18); border-radius: 2px; } }'
      + '.band { display: flex; align-items: flex-start; gap: 16px; border-bottom: 3px solid #1f3a5f; padding-bottom: 10px; margin-bottom: 12px; }'
      + '.band .k { font-size: 8pt; letter-spacing: .08em; text-transform: uppercase; color: #5b6876; font-weight: 700; }'
      + 'h1 { font-size: 17pt; margin: 2px 0 2px; } .sub { color: #475569; }'
      + '.verdict { margin-left: auto; font-size: 15pt; font-weight: 800; padding: 6px 16px; border-radius: 6px; letter-spacing: .04em; }'
      + '.verdict.ok { background: #e3f5ea; color: #136c3a; border: 2px solid #2f9e5b; } .verdict.bad { background: #fde8e8; color: #9b1c1c; border: 2px solid #d64545; }'
      + '.kpis { display: flex; gap: 8px; margin: 0 0 12px; } .kpi { flex: 1; border: 1px solid #dfe3ea; border-radius: 6px; padding: 7px 10px; }'
      + '.kpi b { display: block; font-size: 15pt; } .kpi span { color: #5b6876; font-size: 8.5pt; } .kpi.ok b { color: #136c3a; } .kpi.bad b { color: #b42318; } .kpi.skip b { color: #8a5a00; }'
      + 'h2 { font-size: 11.5pt; margin: 16px 0 6px; color: #1f3a5f; }'
      + 'table.facts { border-collapse: collapse; width: 100%; } table.facts th { text-align: left; width: 150px; color: #5b6876; font-weight: 600; padding: 3px 8px 3px 0; vertical-align: top; } table.facts td { padding: 3px 0; }'
      + 'table.t { width: 100%; border-collapse: collapse; } table.t th { text-align: left; background: #f1f4f8; font-size: 8.5pt; color: #334155; padding: 5px 6px; border-bottom: 1px solid #cfd6e0; }'
      + 'table.t td { padding: 4px 6px; border-bottom: 1px solid #e5e9ef; vertical-align: top; } table.t tr { break-inside: avoid; } table.t thead { display: table-header-group; }'
      + '.n, table.t th.n { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; width: 1%; } .small { font-size: 8.5pt; color: #475569; }'
      + 'code { font: 8.5pt ui-monospace, Menlo, Consolas, monospace; word-break: break-all; } .m { font: 700 7.5pt ui-monospace, Menlo, Consolas, monospace; color: #1f3a5f; }'
      + '.pill { display: inline-block; padding: 1px 7px; border-radius: 9px; font-weight: 700; font-size: 8pt; white-space: nowrap; }'
      + '.pill.ok { background: #e3f5ea; color: #136c3a; } .pill.bad { background: #fde8e8; color: #9b1c1c; } .pill.skip { background: #fdf3dc; color: #8a5a00; }'
      + 'tr.badrow td { background: #fff7f7; } .none { color: #64748b; font-style: italic; }'
      + '.ev { border: 1px solid #e2e6ec; border-radius: 6px; padding: 7px 9px; margin: 0 0 8px; break-inside: avoid; } .evh { margin-bottom: 3px; } .req { display: block; color: #1f3a5f; margin-bottom: 4px; }'
      + 'pre { margin: 0; background: #f6f8fa; border: 1px solid #e5e9ef; border-radius: 4px; padding: 6px 8px; font: 8pt/1.35 ui-monospace, Menlo, Consolas, monospace; white-space: pre-wrap; word-break: break-all; max-height: none; }'
      + '.foot { margin-top: 18px; padding-top: 6px; border-top: 1px solid #e2e6ec; color: #64748b; font-size: 8pt; }'
      + '</style></head><body><div class="doc">'
      + '<div class="band"><div><div class="k">API test results' + (m.code ? ' · ' + esc(m.code) : '') + '</div><h1>' + esc(m.name) + '</h1>'
      + '<div class="sub">' + esc(m.page.label) + ' · <code>' + esc(m.page.id) + '</code> · ' + esc(m.scope) + ' · run ' + esc(m.runAt) + (m.runBy ? ' by ' + esc(m.runBy) : '') + '</div></div>'
      + '<div class="verdict ' + (m.ok ? 'ok' : 'bad') + '">' + esc(m.verdict) + '</div></div>'
      + '<div class="kpis">' + kpi(m.counts.passed, 'steps passed', 'ok') + kpi(m.counts.failed, 'steps failed', m.counts.failed ? 'bad' : '') + kpi(m.counts.skipped, 'not run', m.counts.skipped ? 'skip' : '')
      + kpi(m.counts.checksOk + ' / ' + (m.counts.checksOk + m.counts.checksFailed), 'checks passed', m.counts.checksFailed ? 'bad' : 'ok') + kpi(m.counts.seconds + ' s', 'time') + '</div>'
      + '<h2>The scenario and the run</h2><table class="facts">' + facts + '</table>'
      + '<h2>Steps</h2>' + stepsHtml
      + '<h2>Checks on the answers</h2>' + checksHtml
      + evidenceHtml
      + '<div class="foot">Made with Build.Rite · API Scenarios · ' + esc(m.made) + (o.madeBy ? ' · ' + esc(o.madeBy) : '') + '. The calls went through the app\'s own backends with the app\'s login; calls that change data run only when writes are allowed.</div>'
      + '</div></body></html>';
  }

  /** 'SC-0005-test-results-2026-11-17.pdf' */
  function fileName(m, ext, d) {
    var day = (d || new Date()).toISOString().slice(0, 10);
    return String(m.file || 'scenario-test-results').replace(/[^A-Za-z0-9._-]+/g, '-') + '-' + day + '.' + ext;
  }

  return { model: model, sheets: sheets, preview: preview, html: html, fileName: fileName, KINDS: KINDS };
});
