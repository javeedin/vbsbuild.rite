'use strict';
/**
 * API Scenarios (Build.Rite → API Scenarios): a page's REST calls and BI Publisher reports put in order and run against
 * the real backend — purely through its APIs, no page and no sign-in screen — as the page would make them: a value one
 * call answers (an id) feeds the next, each answer checked, every run recorded.
 *
 *   list(page)                 → { ok, scenarios: [{ id, name, kind, steps, last }] }   the page's scenarios
 *   get(id)                    → { ok, scenario }
 *   save(scenario, by)         → { ok, scenario }   a new one (no id) or a change
 *   remove(id)                 → { ok }
 *   draft(page, facts, by)     → { ok, scenario }   its happy path drafted from the page's facts (lib/pageScan.js): its
 *                                chains in the order the page runs them (on entry first), the calls each makes; a call
 *                                needing a value (ProjectId) takes it from an earlier call's answer ("auto:" a field of
 *                                that name in its first row); calls that change data added last, held until allowed
 *   run(id, env, opts)         → { ok, run }       every step, for each row of its data (or once): sent with the app's
 *                                login (lib/apiTest.js run), its checks, the values it hands on; a step that changes data
 *                                only with opts.allowWrites and the scenario's own allowWrites, and never on a production
 *                                backend. The run kept on this PC (opts.by: who ran it).
 *   runs(page | scenarioId)    → { ok, runs: [summaries, newest first] };  runOf(runId) → { ok, run }
 *
 * A scenario: { id, page, name, kind ('happy' | 'edge' | 'role' | 'data'), notes, allowWrites, data: [{ var: value }],
 *   steps: [{ id, name, endpoint | report: { path }, params: { name: 'literal or {{var}}' }, extra, body,
 *             extract: [{ var, from }], expect: { status ('2xx', '200', '404'…), minRows, maxRows, maxMs, sameShape,
 *             fields: [{ path, equals }] }, writes }] }
 *   from (where a value is read in an answer): 'items[0].CustomerId', 'rows[1].PROJECT_ID' (a table's rows: a report's or
 *   a list's), '$count' (its rows), '$status' (the HTTP status), or 'auto:Name' (a field of that name, any case, in the first row or the answer itself).
 *
 * Kept on this PC only, in its own folder (o.dir()): answers hold live data, so neither scenarios' runs nor their
 * answers go into git. Plain Node.
 */
const fs = require('fs');
const path = require('path');

const KEEP_RUNS = 60; // runs kept per page
const SHOW = 4000; // an answer's text kept with a run
const MAX_ROWS = 50; // data rows run
const MAX_STEPS = 60;
const str = (v) => (v == null ? '' : String(v));
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const slug = (s) => str(s).replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 120) || 'x';
const PROD_FREE = /(dev|test|tst|uat|sit|stag|stg|demo|qa|sandbox|train|localhost|127\.0\.0\.1|example)/i;

/** A value read from an answer: 'items[0].CustomerId', 'rows[0].PROJECT_ID', '$count', '$status', 'auto:Name'. */
function readPath(answer, from) {
  const f = str(from).trim();
  if (!f) return undefined;
  if (f === '$status') return answer.status;
  if (f === '$count') return answer.rows ? answer.rows.length : (Array.isArray(answer.json) ? answer.json.length : undefined);
  if (/^auto:/i.test(f)) {
    const want = f.slice(5).trim().toLowerCase().replace(/[^a-z0-9]/g, '');
    const first = (answer.rows && answer.rows[0]) || (Array.isArray(answer.json) ? answer.json[0] : answer.json);
    const look = (o) => { if (!isObj(o)) return undefined; const k = Object.keys(o).filter((x) => x.toLowerCase().replace(/[^a-z0-9]/g, '') === want)[0]; return k === undefined ? undefined : o[k]; };
    const v = look(first);
    return v !== undefined ? v : look(answer.json);
  }
  let cur = /^rows(\[|\.|$)/.test(f) ? { rows: answer.rows } : answer.json;
  const parts = f.replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean);
  for (const p of parts) {
    if (cur == null) return undefined;
    cur = cur[/^\d+$/.test(p) && Array.isArray(cur) ? Number(p) : p];
  }
  return cur;
}

/** {{var}} filled from the values so far; the names missing listed. */
function fill(text, vars, missing) {
  return str(text).replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (m, k) => {
    if (vars[k] === undefined || vars[k] === null || vars[k] === '') { if (missing.indexOf(k) === -1) missing.push(k); return ''; }
    return str(vars[k]);
  });
}

/** Does a status meet what is expected ('2xx', '200', '404', '4xx', a list '200,201')? */
function statusOk(status, want) {
  const w = str(want || '2xx').split(/[\s,]+/).filter(Boolean);
  return w.some((x) => (/^\dxx$/i.test(x) ? Math.floor(status / 100) === Number(x[0]) : Number(x) === status));
}

function open(o) {
  const opt = o || {};
  const api = opt.api; // lib/apiTest.js open(): op, report, run
  const now = opt.now || (() => new Date());
  const dirNow = () => { const d = typeof opt.dir === 'function' ? opt.dir() : opt.dir; return d ? path.resolve(d) : ''; };
  const sDir = () => path.join(dirNow(), 'scenarios');
  const rDir = (page) => path.join(dirNow(), 'runs', slug(page));
  const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return d; } };
  const writeJson = (f, v) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(v, null, 1)); };
  const newId = (p) => p + now().getTime().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
  const no = (error, extra) => Object.assign({ ok: false, error }, extra || {});

  function all() {
    const d = sDir();
    let names = [];
    try { names = fs.readdirSync(d).filter((n) => /\.json$/.test(n)); } catch (e) { names = []; }
    return names.map((n) => readJson(path.join(d, n), null)).filter((s) => s && s.id);
  }
  const lastRun = (s) => { const r = runsOf(s.page).filter((x) => x.scenario === s.id)[0]; return r || null; };
  function runsOf(page) {
    const d = rDir(page);
    let names = [];
    try { names = fs.readdirSync(d).filter((n) => /\.json$/.test(n)).sort().reverse(); } catch (e) { names = []; }
    return names.slice(0, KEEP_RUNS).map((n) => { const r = readJson(path.join(d, n), null); return r ? summary(r) : null; }).filter(Boolean);
  }
  const summary = (r) => ({ id: r.id, scenario: r.scenario, name: r.name, page: r.page, at: r.at, by: r.by, ms: r.ms, ok: r.ok, passed: r.passed, failed: r.failed, skipped: r.skipped, rows: r.rows.length });

  /** A scenario as it may be kept: its steps' fields only, sizes bounded. */
  function clean(s, by, old) {
    const steps = (Array.isArray(s.steps) ? s.steps : []).slice(0, MAX_STEPS).map((x, i) => {
      const st = isObj(x) ? x : {};
      const ex = isObj(st.expect) ? st.expect : {};
      return { id: str(st.id) || 's' + (i + 1), name: str(st.name).slice(0, 200), endpoint: st.report ? '' : str(st.endpoint).slice(0, 200),
        report: st.report && st.report.path ? { path: str(st.report.path).slice(0, 300), name: str(st.report.name).replace(/[^\w.-]/g, '').slice(0, 120), rowTag: str(st.report.rowTag).replace(/[^\w.-]/g, '').slice(0, 60) } : null,
        params: isObj(st.params) ? Object.keys(st.params).slice(0, 60).reduce((a, k) => { a[str(k).slice(0, 80)] = str(st.params[k]).slice(0, 2000); return a; }, {}) : {},
        extra: str(st.extra).slice(0, 2000), body: str(st.body).slice(0, 50000),
        extract: (Array.isArray(st.extract) ? st.extract : []).slice(0, 20).map((e) => ({ var: str(e && e.var).replace(/[^\w.-]/g, '').slice(0, 60), from: str(e && e.from).slice(0, 200) })).filter((e) => e.var && e.from),
        expect: { status: str(ex.status || '2xx').slice(0, 40), minRows: ex.minRows === '' || ex.minRows == null ? null : Number(ex.minRows), maxRows: ex.maxRows === '' || ex.maxRows == null ? null : Number(ex.maxRows),
          maxMs: ex.maxMs === '' || ex.maxMs == null ? null : Number(ex.maxMs), sameShape: !!ex.sameShape,
          fields: (Array.isArray(ex.fields) ? ex.fields : []).slice(0, 20).map((f) => ({ path: str(f && f.path).slice(0, 200), equals: f && f.equals !== undefined && f.equals !== null ? str(f.equals).slice(0, 500) : null })).filter((f) => f.path) },
        writes: !!st.writes };
    });
    return { id: str(s.id) || (old && old.id) || newId('sc'), page: str(s.page || (old && old.page)), name: str(s.name).slice(0, 200) || 'Scenario',
      kind: ['happy', 'edge', 'role', 'data'].indexOf(s.kind) !== -1 ? s.kind : 'happy', notes: str(s.notes).slice(0, 4000), allowWrites: !!s.allowWrites,
      data: (Array.isArray(s.data) ? s.data : []).slice(0, MAX_ROWS).filter(isObj).map((r) => Object.keys(r).slice(0, 40).reduce((a, k) => { a[str(k).slice(0, 60)] = str(r[k]).slice(0, 2000); return a; }, {})),
      steps, by: (old && old.by) || str(by), createdAt: (old && old.createdAt) || now().toISOString(), updatedAt: now().toISOString(), updatedBy: str(by) };
  }

  const store = {
    list(page) {
      if (!dirNow()) return no('Set up your workspace first: scenarios are kept per VB Studio project.');
      const p = str(page);
      return { ok: true, scenarios: all().filter((s) => !p || s.page === p).sort((a, b) => (a.name < b.name ? -1 : 1)).map((s) => Object.assign({}, s, { last: lastRun(s) })) };
    },
    get(id) { const s = all().filter((x) => x.id === str(id))[0]; return s ? { ok: true, scenario: s } : no('No such scenario.'); },
    save(s, by) {
      if (!dirNow()) return no('Set up your workspace first.');
      if (!isObj(s) || !str(s.page)) return no('A scenario belongs to a page.');
      const old = s.id ? all().filter((x) => x.id === str(s.id))[0] : null;
      const c = clean(s, by, old);
      writeJson(path.join(sDir(), slug(c.id) + '.json'), c);
      return { ok: true, scenario: c };
    },
    remove(id) {
      const s = all().filter((x) => x.id === str(id))[0];
      if (!s) return no('No such scenario.');
      try { fs.unlinkSync(path.join(sDir(), slug(s.id) + '.json')); } catch (e) { return no('It could not be removed: ' + e.message); }
      return { ok: true };
    },

    /** The page's happy path, drafted from its facts: its chains in the order the page runs them, the calls each makes. */
    draft(page, facts, by, opts) {
      const f = facts || {};
      const rest = ((f.integrations && f.integrations.rest) || []).filter((r) => r && r.endpoint);
      if (!rest.length) return no('This page makes no REST call to put in order (its technical sheet lists none: Build the sheet first).');
      const chains = (f.logic && f.logic.chains) || [];
      const entry = new Set([].concat(...((f.features && f.features.lifecycle) || []).map((l) => (Array.isArray(l.chains) ? l.chains : [l.chain || l.name || '']).map(str))).concat(chains.filter((c) => /enter|load|init|fetch/i.test(c.name)).map((c) => c.name)));
      const order = chains.slice().sort((a, b) => (entry.has(b.name) ? 1 : 0) - (entry.has(a.name) ? 1 : 0));
      const seq = [];
      order.forEach((c) => (c.calls || []).forEach((e) => { if (seq.indexOf(e) === -1) seq.push(e); }));
      rest.forEach((r) => { if (seq.indexOf(r.endpoint) === -1) seq.push(r.endpoint); });
      const byEp = {};
      rest.forEach((r) => { byEp[r.endpoint] = r; });
      const steps = [];
      const known = {}; // var → the step that hands it on
      const start = []; // values no earlier step hands on: asked for in the data row
      const reports = ((f.integrations && f.integrations.reports) || []).slice(0, 5);
      // a report the page names (XX_RP) or gives as a path: its path and parameters as the API tester found them in the code
      const known0 = (isObj(opts) && Array.isArray(opts.reports) ? opts.reports : []).filter(isObj);
      const reportOf = (rp) => {
        const k = known0.filter((r) => r.name === str(rp) || r.path === str(rp))[0];
        const p = k && k.path ? str(k.path) : str(rp);
        return { path: p, name: (k && k.name) || path.posix.basename(p, '.xdo'), rowTag: (k && str(k.rowTag)) || '', params: (k && Array.isArray(k.params) ? k.params : []).map(str).filter(Boolean), guessed: !!(k && k.guessed) };
      };
      const reportSteps = () => reports.map((rp, i) => {
        const r = reportOf(rp);
        return { id: 'r' + (i + 1), name: 'Report ' + r.name + (r.guessed ? ' (its folder guessed: check the path)' : ''), endpoint: '', report: { path: r.path, name: r.name, rowTag: r.rowTag },
          params: r.params.reduce((a, n) => { a[n] = ''; return a; }, {}), extra: '', body: '', extract: [],
          expect: { status: '2xx', minRows: null, maxRows: null, maxMs: 15000, sameShape: false, fields: [] }, writes: false };
      });
      // BI Publisher's own SOAP call (any app's: /xmlpserver/…) is run as the page's reports, where the page calls it
      const isBip = (r) => /\/xmlpserver\//i.test(str(r && r.path));
      const reads = [], writes = [];
      seq.forEach((e) => {
        const op = api ? api.op(e) : { ok: false };
        const r = byEp[e] || {};
        if (isBip(r)) { if (reports.length && !reads.some((x) => x.bip)) reads.push({ bip: true }); return; }
        const isRead = op && op.ok ? !!op.op.reads : /^GET$/i.test(r.method || '');
        (isRead ? reads : writes).push({ e, op, r });
      });
      if (reports.length && !reads.some((x) => x.bip)) reads.push({ bip: true });
      let n = 0;
      reads.concat(writes).forEach((x) => {
        if (x.bip) { reportSteps().forEach((r) => steps.push(r)); return; }
        const params = {};
        const need = x.op && x.op.ok ? (x.op.op.params || []).filter((p) => p.required && !p.def) : [];
        need.forEach((p) => {
          params[p.name] = '{{' + p.name + '}}';
          if (known[p.name]) return;
          // an earlier step hands it on (a field of that name in its first row), or it is a value to start with
          const src = steps.filter((s) => !s.report).slice(-1)[0];
          if (src) { src.extract.push({ var: p.name, from: 'auto:' + p.name }); known[p.name] = src.id; } else { start.push(p.name); known[p.name] = 'start'; }
        });
        const isWrite = writes.indexOf(x) !== -1;
        n += 1;
        steps.push({ id: 's' + n, name: (x.r.summary || (x.op && x.op.ok && x.op.op.summary) || x.e).slice(0, 120), endpoint: x.e, report: null, params, extra: '',
          body: isWrite && x.op && x.op.ok && x.op.op.body ? str(x.op.op.body.template || '') : '', extract: [],
          expect: { status: '2xx', minRows: null, maxRows: null, maxMs: 10000, sameShape: !isWrite, fields: [] }, writes: isWrite });
      });
      const s = clean({ page: page, name: 'Happy path — ' + (f.label || str(page).split('/').pop()), kind: 'happy', steps,
        data: start.length ? [start.reduce((a, k) => { a[k] = ''; return a; }, {})] : [],
        notes: 'Drafted from the page\'s code: its chains in the order it runs them, the calls each makes. Calls that change data come last and run only when you allow writes.'
          + (start.length ? ' Give ' + start.join(', ') + ' under Data (the page gets ' + (start.length > 1 ? 'them' : 'it') + ' from the screen before it).' : '')
          + ' Check each step\'s values and checks, then run it.' }, by, null);
      return store.save(s, by);
    },

    /** Runs a scenario: each step, for each row of its data (or once). */
    async run(id, env, opts) {
      const op = opts || {};
      const s = all().filter((x) => x.id === str(id))[0];
      if (!s) return no('No such scenario.');
      if (!api) return no('The API tester is not here.');
      const t0 = Date.now();
      const rowsIn = s.data.length ? s.data : [{}];
      const rows = [];
      for (const row of rowsIn) {
        const vars = Object.assign({}, row);
        const steps = [];
        let stop = false;
        for (const st of s.steps) {
          const res = { step: st.id, name: st.name, call: st.report ? 'report ' + st.report.path : st.endpoint, state: 'skip', checks: [], extracted: {}, status: 0, ms: 0, rows: null };
          if (stop) { res.note = 'not run: an earlier step failed'; steps.push(res); continue; }
          const missing = [];
          const params = {};
          Object.keys(st.params || {}).forEach((k) => { params[k] = fill(st.params[k], vars, missing); });
          const extra = fill(st.extra, vars, missing);
          const body = fill(st.body, vars, missing);
          if (missing.length) { res.state = 'fail'; res.note = 'no value for ' + missing.join(', ') + ' — give it under Data, or hand it on from an earlier step'; steps.push(res); stop = true; continue; }
          let confirm = false;
          if (st.writes) {
            const info = st.endpoint ? api.op(st.endpoint, env) : null;
            const backend = info && info.ok && info.op ? info.op.backend : '';
            const b = backend && env && env.backend ? env.backend(backend) : null;
            const host = b && b.url ? String(b.url).replace(/^https?:\/\//, '').split('/')[0] : '';
            if (!s.allowWrites || !op.allowWrites) { res.note = 'changes data: not run (allow writes on the scenario, then Run with writes)'; steps.push(res); continue; }
            if (host && !PROD_FREE.test(host)) { res.note = 'changes data on ' + host + ', which looks like production: never run from a scenario'; steps.push(res); continue; }
            confirm = true;
          }
          // a report's parameters are the ones the step gives (the tester sends only those it is told of)
          const r = await api.run(st.report ? { report: Object.assign({}, st.report, { params: Object.keys(params) }), params, extra } : { endpoint: st.endpoint, params, extra, body, confirm }, env);
          if (r.needsConfirm || (r.ok === false && r.status === undefined)) { res.state = 'fail'; res.note = r.error || 'not sent'; steps.push(res); stop = true; continue; }
          let json;
          try { json = r.pretty ? JSON.parse(r.pretty) : undefined; } catch (e) { json = undefined; }
          const tableRows = r.table && Array.isArray(r.table.rows) ? r.table.rows.map((cells) => (r.table.columns || []).reduce((a, c, i) => { a[c] = cells[i]; return a; }, {})) : null;
          const answer = { status: r.status, json, rows: tableRows };
          const ex = st.expect || {};
          const check = (name, ok, detail) => res.checks.push({ name, ok: !!ok, detail: str(detail) });
          check('status ' + (ex.status || '2xx'), statusOk(r.status, ex.status), String(r.status) + (r.statusText ? ' ' + r.statusText : '') + (r.error ? ' — ' + r.error : ''));
          const n = r.table ? r.table.total : null;
          if (ex.minRows != null && !isNaN(ex.minRows)) check('at least ' + ex.minRows + ' row(s)', n != null && n >= ex.minRows, n == null ? 'no rows in the answer' : n + ' row(s)');
          if (ex.maxRows != null && !isNaN(ex.maxRows)) check('at most ' + ex.maxRows + ' row(s)', n != null && n <= ex.maxRows, n == null ? 'no rows in the answer' : n + ' row(s)');
          if (ex.maxMs != null && !isNaN(ex.maxMs)) check('within ' + ex.maxMs + ' ms', r.ms <= ex.maxMs, r.ms + ' ms');
          if (ex.sameShape && r.shape) check('same shape as before', r.shape.status !== 'differs', r.shape.status === 'differs' ? (r.shape.counts.missing + ' field(s) gone, ' + r.shape.counts.changed + ' changed type') : 'as the example');
          (ex.fields || []).forEach((fx) => {
            const v = readPath(answer, fx.path);
            check(fx.path + (fx.equals === null ? ' is there' : ' = ' + fx.equals), fx.equals === null ? v !== undefined && v !== null && v !== '' : str(v) === fx.equals, v === undefined ? 'not in the answer' : str(v).slice(0, 120));
          });
          (st.extract || []).forEach((e) => {
            const v = readPath(answer, e.from);
            if (v !== undefined && v !== null && v !== '') { vars[e.var] = v; res.extracted[e.var] = str(v).slice(0, 200); } else res.checks.push({ name: 'hands on ' + e.var, ok: false, detail: e.from + ': not in the answer' });
          });
          res.state = res.checks.every((c) => c.ok) ? 'ok' : 'fail';
          res.status = r.status; res.ms = r.ms; res.rows = n;
          res.request = { method: r.method, url: str(r.url).slice(0, 600) };
          res.answer = str(r.pretty).slice(0, SHOW);
          steps.push(res);
          if (res.state === 'fail' && Object.keys(res.extracted).length < (st.extract || []).length) stop = true; // what the next steps need is missing
        }
        rows.push({ vars: row, steps, ok: steps.every((x) => x.state !== 'fail') });
      }
      const flat = [].concat(...rows.map((r) => r.steps));
      const run = { id: now().toISOString().replace(/[:.]/g, '-') + '-' + Math.floor(Math.random() * 1e4), scenario: s.id, name: s.name, page: s.page, at: now().toISOString(), by: str(op.by),
        ms: Date.now() - t0, ok: rows.every((r) => r.ok), passed: flat.filter((x) => x.state === 'ok').length, failed: flat.filter((x) => x.state === 'fail').length,
        skipped: flat.filter((x) => x.state === 'skip').length, rows };
      writeJson(path.join(rDir(s.page), run.id + '.json'), run);
      // older runs of the page beyond KEEP_RUNS let go
      try { const d = rDir(s.page); fs.readdirSync(d).filter((x) => /\.json$/.test(x)).sort().reverse().slice(KEEP_RUNS).forEach((x) => fs.unlinkSync(path.join(d, x))); } catch (e) { /* kept */ }
      return { ok: true, run };
    },
    runs(page) { if (!dirNow()) return no('Set up your workspace first.'); return { ok: true, runs: runsOf(str(page)) }; },
    runOf(page, runId) { const r = readJson(path.join(rDir(page), slug(runId) + '.json'), null); return r ? { ok: true, run: r } : no('No such run.'); },
  };
  return store;
}

module.exports = { open, readPath, fill, statusOk };
