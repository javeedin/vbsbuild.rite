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
const MAX_VALUES = 300; // a list of values' values kept with a run (to pick from)
const MAX_ROWS = 50; // data rows run
const MAX_STEPS = 60;
const str = (v) => (v == null ? '' : String(v));
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const uniq = (a) => a.filter((x, i) => x && a.indexOf(x) === i);
const varsIn = (t) => Array.from(str(t).matchAll(/\{\{\s*([\w.-]+)\s*\}\}/g)).map((m) => m[1]);
const slug = (s) => str(s).replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 120) || 'x';
const PROD_FREE = /(dev|test|tst|uat|sit|stag|stg|demo|qa|sandbox|train|localhost|127\.0\.0\.1|example)/i;

/** A field of an object, its name in any case when not exactly (the page keeps taskId, the answer says TaskId). */
function field(o, name) {
  if (o === null || o === undefined || typeof o !== 'object') return undefined;
  if (name in o) return o[name];
  const k = Object.keys(o).filter((x) => x.toLowerCase() === String(name).toLowerCase())[0];
  return k === undefined ? undefined : o[k];
}

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
    const w = v !== undefined ? v : look(answer.json);
    // requestId from what a create answered: its own id
    if (w === undefined && /.id$/.test(want) && want !== 'id') { const o = isObj(answer.json) && answer.json.id !== undefined ? answer.json : first; return isObj(o) ? o.id : undefined; }
    return w;
  }
  let cur = /^rows(\[|\.|$)/.test(f) ? { rows: answer.rows } : answer.json;
  // a name, [n] (the nth row) or [field=value] (the row whose field is that value: a value picked from a list)
  for (const t of f.matchAll(/\[([\w.-]+)=([^\]]*)\]|\[(\d+)\]|([^.[\]]+)/g)) {
    if (cur == null) return undefined;
    if (t[1] !== undefined) cur = Array.isArray(cur) ? cur.filter((x) => isObj(x) && str(field(x, t[1])) === t[2])[0] : undefined;
    else if (t[3] !== undefined) cur = Array.isArray(cur) ? cur[Number(t[3])] : cur[t[3]];
    else if (/^\d+$/.test(t[4]) && Array.isArray(cur)) cur = cur[Number(t[4])];
    else cur = field(cur, t[4]);
  }
  return cur;
}

/** The rows of a list's answer: at its items path ('data', 'items'), else the answer itself, else its table. */
function listRows(answer, itemsPath) {
  const at = itemsPath ? readPath(answer, itemsPath) : answer.json;
  if (Array.isArray(at)) return at;
  if (isObj(answer.json)) { const k = ['items', 'data', 'rows', 'results'].filter((x) => Array.isArray(answer.json[x]))[0]; if (k) return answer.json[k]; }
  return Array.isArray(answer.rows) ? answer.rows : [];
}

/** Where a list's value is read: its first row's key (as a user taking the first value), or the row picked. */
function lovFrom(lov, pick) {
  const base = lov.itemsPath ? lov.itemsPath : '';
  const k = lov.key || 'id';
  return (base ? base : '') + (pick !== undefined && pick !== null && str(pick) !== '' ? '[' + k + '=' + str(pick) + ']' : '[0]') + '.' + k;
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
        writes: !!st.writes, page: str(st.page).slice(0, 200), when: str(st.when).slice(0, 160),
        lov: isObj(st.lov) && str(st.lov.target) ? { field: str(st.lov.field).slice(0, 120), target: str(st.lov.target).replace(/[^\w.-]/g, '').slice(0, 60), key: str(st.lov.key).replace(/[^\w.-]/g, '').slice(0, 60),
          text: str(st.lov.text).replace(/[^\w.-]/g, '').slice(0, 60), sub: str(st.lov.sub).replace(/[^\w.-]/g, '').slice(0, 60), search: str(st.lov.search).replace(/[^\w.-]/g, '').slice(0, 60),
          itemsPath: str(st.lov.itemsPath).replace(/[^\w.[\]-]/g, '').slice(0, 120),
          picked: isObj(st.lov.picked) && str(st.lov.picked.key) ? { key: str(st.lov.picked.key).slice(0, 120), text: str(st.lov.picked.text).slice(0, 160), sub: str(st.lov.picked.sub).slice(0, 120) } : null } : null };
    });
    return { id: str(s.id) || (old && old.id) || newId('sc'), page: str(s.page || (old && old.page)), name: str(s.name).slice(0, 200) || 'Scenario',
      kind: ['happy', 'edge', 'role', 'data'].indexOf(s.kind) !== -1 ? s.kind : 'happy', notes: str(s.notes).slice(0, 4000), allowWrites: !!s.allowWrites,
      data: (Array.isArray(s.data) ? s.data : []).slice(0, MAX_ROWS).filter(isObj).map((r) => Object.keys(r).slice(0, 40).reduce((a, k) => { a[str(k).slice(0, 60)] = str(r[k]).slice(0, 2000); return a; }, {})),
      steps, choices: (Array.isArray(s.choices) ? s.choices : []).filter(isObj).slice(0, 12).map((c) => ({ target: str(c.target).replace(/[^\w.-]/g, '').slice(0, 60), field: str(c.field).slice(0, 120),
        values: (Array.isArray(c.values) ? c.values : []).filter(isObj).slice(0, 30).map((x) => ({ key: str(x.key).slice(0, 120), text: str(x.text).slice(0, 160) })), value: str(c.value).slice(0, 120),
        start: str(c.start).slice(0, 120), startFrom: str(c.startFrom).replace(/[^\w.-]/g, '').slice(0, 80) })).filter((c) => c.target && c.values.length),
      // a page the journey went on to keeps what it added (data columns, choices, where its notes start), so its link can be removed cleanly
      journey: (Array.isArray(s.journey) ? s.journey : []).filter(isObj).slice(0, 12).map((j) => Object.assign({ page: str(j.page).slice(0, 200), label: str(j.label).slice(0, 200) },
        Array.isArray(j.vars) ? { vars: j.vars.map((v) => str(v).replace(/[^\w.-]/g, '').slice(0, 60)).filter(Boolean).slice(0, 40) } : {},
        Array.isArray(j.choices) ? { choices: j.choices.map((v) => str(v).replace(/[^\w.-]/g, '').slice(0, 60)).filter(Boolean).slice(0, 12) } : {},
        Number.isFinite(Number(j.notesAt)) && j.notesAt !== null && j.notesAt !== '' ? { notesAt: Math.max(0, Math.min(4000, Math.round(Number(j.notesAt)))) } : {},
        str(j.linkedAt) ? { linkedAt: str(j.linkedAt).slice(0, 40), linkedBy: str(j.linkedBy).slice(0, 120) } : {})).filter((j) => j.page),
      by: (old && old.by) || str(by), createdAt: (old && old.createdAt) || now().toISOString(), updatedAt: now().toISOString(), updatedBy: str(by) };
  }

  /** What the draft says of itself: the lists to pick from, the values to give. */
  function notesOf(ctx, short) {
    const lf = uniq(ctx.lovFields);
    return (short ? '' : 'Drafted from the page\'s code as a user goes through it: its lists in the order the form shows them (a list that depends on another sends what that one handed on), then its other calls; calls that change data come last and run only when you allow writes.')
      + (lf.length ? ' ' + lf.join(', ') + (lf.length > 1 ? ' are lists of values' : ' is a list of values') + ' on the page: run once, then pick a value as a user would (the first is used until you pick one).' : '')
      + (ctx.start.length ? ' Give ' + ctx.start.join(', ') + ' under Data (the page gets ' + (ctx.start.length > 1 ? 'them' : 'it') + ' from the screen before it).' : '')
      + (short ? '' : ' Check each step\'s values and checks, then run it.');
  }

  /**
   * One page's steps, as a user goes through it: its lists of values in the order the form shows them (each list's
   * values from the call or report the page runs for it, lib/pageScan.js lovsOf; a list shown in one case only says
   * when), then its other reads (its chains' calls, those run as it opens first), then the calls that change data.
   * A value a step sends is one an earlier step hands on, else a value to start with (ctx.start, asked for under Data).
   *   ctx: { known: { var: stepId }, start: [var], lovFields: [field], prefix: 'p2-', page }
   */
  function stepsFor(facts, opts, ctx) {
    const f = facts || {};
    const integ = f.integrations || {};
    const rest = (integ.rest || []).filter((r) => r && r.endpoint);
    const byEp = {};
    rest.forEach((r) => { byEp[r.endpoint] = r; });
    const chains = (f.logic && f.logic.chains) || [];
    const entry = new Set([].concat(...((f.features && f.features.lifecycle) || []).map((l) => (Array.isArray(l.chains) ? l.chains : [l.chain || l.name || '']).map(str))).concat(chains.filter((c) => /enter|load|init|fetch/i.test(c.name)).map((c) => c.name)));
    let seq = [];
    chains.slice().sort((x, y) => (entry.has(y.name) ? 1 : 0) - (entry.has(x.name) ? 1 : 0)).forEach((c) => (c.calls || []).forEach((e) => { if (seq.indexOf(e) === -1) seq.push(e); }));
    rest.forEach((r) => { if (seq.indexOf(r.endpoint) === -1) seq.push(r.endpoint); });
    // the journey (the page's actions known): the calls run as it opens, then those of the actions that take a user on
    // (Next, Continue, Add to cart, Submit…, its primary action) with the modules their chains use — not every call in
    // its code (resuming a draft, removing from the cart, going back)
    const acts = f.features && Array.isArray(f.features.actions) ? f.features.actions : null;
    let journey = false;
    if (acts && !ctx.all) {
      const chainBy = {};
      chains.forEach((c) => { chainBy[c.name] = c; });
      const modCalls = {};
      ((f.logic && f.logic.modules) || []).forEach((m) => { modCalls[str(m.name)] = m.calls || []; });
      // a chain's calls; with the modules it uses (a submit builds its requests there) or not (as a page opens they are
      // helpers: a draft resumed, storage)
      const callsOf = (names, withModules) => {
        const out = [];
        const push = (e) => { if (out.indexOf(e) === -1) out.push(e); };
        names.forEach((n) => { const c = chainBy[n]; if (!c) return; (c.calls || []).forEach(push); if (withModules) (c.modules || []).forEach((m) => (modCalls[str(m).replace(/^resources\/js\//, '')] || []).forEach(push)); });
        return out;
      };
      const GO = /^(next|continue|proceed|add( selected)? to (the )?cart|go to (the )?cart|view cart|checkout|check out|submit|create|place|confirm|finish|done|send|search|save request|request)\b/i;
      const goChains = uniq([].concat(...acts.filter((a) => GO.test(str(a.label).trim()) || /primary action/i.test(str(a.label))).map((a) => a.chains || [])));
      const js = uniq(callsOf(Array.from(entry), false).concat(callsOf(goChains, true)));
      if (js.length || (integ.lovs || []).length) { seq = js; journey = true; }
    }
    const reports = (integ.reports || []).slice(0, 12);
    // a report the page names (XX_RP) or gives as a path: its path and parameters as the API tester found them in the code
    const known0 = (isObj(opts) && Array.isArray(opts.reports) ? opts.reports : []).filter(isObj);
    const reportOf = (rp) => {
      const k = known0.filter((r) => r.name === str(rp) || r.path === str(rp))[0];
      const p = k && k.path ? str(k.path) : str(rp);
      return { path: p, name: (k && k.name) || path.posix.basename(p, '.xdo'), rowTag: (k && str(k.rowTag)) || '', params: (k && Array.isArray(k.params) ? k.params : []).map(str).filter(Boolean), guessed: !!(k && k.guessed) };
    };
    const isBip = (e) => /runBIPReport$/i.test(e) || /\/xmlpserver\//i.test(str(byEp[e] && byEp[e].path));
    const lovs = (integ.lovs || []).filter((l) => isObj(l) && ((l.endpoint && !isBip(l.endpoint) && (l.source === 'chain' || l.source === 'service')) || (l.source === 'report' && l.report)));
    const known = ctx.known, start = ctx.start;
    const steps = [];
    let nS = 0, nR = 0;
    const pfx = str(ctx.prefix);
    // the last plain call (not a list), here or on the page before (a row of the list there is the one opened here)
    const lastPlain = () => steps.filter((x) => !x.report && !x.lov).slice(-1)[0] || (ctx.prev || []).filter((x) => !x.report && !x.lov && !x.writes).slice(-1)[0];
    // each {{var}} a step sends: handed on by an earlier step, else a value to start with
    const resolve = (st, need) => {
      Object.keys(st.params || {}).forEach((k) => Array.from(str(st.params[k]).matchAll(/\{\{\s*([\w.-]+)\s*\}\}/g)).map((m) => m[1]).forEach((v) => {
        if (known[v]) return;
        const src = (need || []).some((p) => p.name === v) ? lastPlain() : null; // a list of values holds what to pick, not this
        if (src) { src.extract.push({ var: v, from: 'auto:' + v }); known[v] = src.id; } else { start.push(v); known[v] = 'start'; }
      }));
    };
    const handOn = (st, l) => {
      if (!l || !l.target) return;
      ctx.lovFields.push(l.field);
      if (known[l.target]) return;
      st.extract.push({ var: l.target, from: lovFrom(st.lov && st.lov.target === l.target ? st.lov : { itemsPath: st.report ? 'rows' : str(l.itemsPath), key: str(l.keyFrom || l.key || l.target || 'id') }) });
      known[l.target] = st.id;
    };
    const restStep = (e, mine) => {
      const op = api ? api.op(e) : { ok: false };
      const r = byEp[e] || { endpoint: e };
      const isWrite = !(op && op.ok ? !!op.op.reads : /^GET$/i.test(r.method || ''));
      const need = op && op.ok ? (op.op.params || []).filter((p) => p.required && !p.def) : [];
      const params = {};
      need.forEach((p) => { params[p.name] = '{{' + p.name + '}}'; });
      // the values the page itself sends with the call (a page value → {{name}}), and its list's own parameters
      Object.assign(params, isObj(r.params) ? r.params : {}, mine[0] && isObj(mine[0].params) ? mine[0].params : {});
      const summary = str(r.summary || (op && op.ok && op.op.summary) || e).slice(0, 120);
      nS += 1;
      const st = { id: pfx + 's' + nS, page: ctx.page, name: summary, endpoint: e, report: null, params, extra: '',
        body: isWrite && op && op.ok && op.op.body ? str(op.op.body.template || '') : '', extract: [], lov: null, when: '',
        expect: { status: '2xx', minRows: null, maxRows: null, maxMs: 10000, sameShape: !isWrite, fields: [] }, writes: isWrite };
      if (mine.length) {
        const l = mine[0];
        st.name = ('List of values: ' + uniq(mine.map((x) => x.field)).join(', ') + ' — ' + summary).slice(0, 200);
        st.lov = { field: str(l.field), target: str(l.target), key: str(l.keyFrom || l.key || l.target || 'id'), text: str(l.textFrom || l.text || ''), sub: str(l.subFrom || ''), itemsPath: str(l.itemsPath), search: '' };
        st.when = str(l.when).slice(0, 160);
      }
      resolve(st, need);
      mine.forEach((l) => handOn(st, l));
      return st;
    };
    const reportStep = (name, l) => {
      const r = reportOf(name);
      const pathOf = l && l.reportPath && (r.guessed || !/\.xdo$/.test(r.path)) ? l.reportPath : r.path;
      nR += 1;
      const st = { id: pfx + 'r' + nR, page: ctx.page, name: 'Report ' + r.name + (r.guessed && !(l && l.reportPath) ? ' (its folder guessed: check the path)' : ''), endpoint: '',
        report: { path: pathOf, name: r.name, rowTag: (l && l.rowTag) || r.rowTag },
        params: Object.assign(r.params.reduce((a, n) => { a[n] = ''; return a; }, {}), l && isObj(l.params) ? l.params : {}), extra: '', body: '', extract: [], lov: null, when: '',
        expect: { status: '2xx', minRows: null, maxRows: null, maxMs: 15000, sameShape: false, fields: [] }, writes: false };
      if (l) {
        st.name = ('List of values: ' + l.field + ' — report ' + r.name + (l.search ? ' (a search as you type)' : '')).slice(0, 200);
        st.lov = { field: str(l.field), target: str(l.target), key: str(l.keyFrom || l.key || l.target), text: str(l.textFrom || l.text), sub: str(l.subFrom || l.sub), itemsPath: 'rows', search: str(l.search) };
        st.when = str(l.when).slice(0, 160);
      }
      resolve(st, []);
      if (l) handOn(st, l);
      return st;
    };
    // 1) its lists, in the order the form shows them
    const byCall = {};
    lovs.forEach((l) => {
      const k = l.source === 'report' ? 'report:' + l.report : l.endpoint;
      if (byCall[k]) { handOn(byCall[k], l); return; }
      const st = l.source === 'report' ? reportStep(l.report, l) : restStep(l.endpoint, lovs.filter((x) => x.endpoint === l.endpoint && x.source !== 'report'));
      byCall[k] = st;
      steps.push(st);
    });
    // 2) its other reads (its reports where the page calls BI Publisher), then 3) the calls that change data
    const writes = [];
    let bipAt = false;
    seq.forEach((e) => {
      if (byCall[e]) return;
      if (isBip(e)) {
        if (bipAt) return;
        bipAt = true;
        reports.filter((rp) => !byCall['report:' + rp]).forEach((rp) => { const st = reportStep(rp, null); byCall['report:' + rp] = st; steps.push(st); });
        return;
      }
      const op = api ? api.op(e) : { ok: false };
      const r = byEp[e] || {};
      const isRead = op && op.ok ? !!op.op.reads : /^GET$/i.test(r.method || '');
      if (isRead) { const st = restStep(e, []); byCall[e] = st; steps.push(st); } else writes.push(e);
    });
    if (!bipAt && !journey) reports.filter((rp) => !byCall['report:' + rp]).forEach((rp) => { const st = reportStep(rp, null); byCall['report:' + rp] = st; steps.push(st); });
    // what creates first (a POST to a collection), then what changes or removes what was made
    const rank = (e) => { const r = byEp[e] || {}; const m = str(r.method).toUpperCase(); return m === 'POST' && !/\{[^}]+\}/.test(str(r.path)) ? 0 : m === 'POST' ? 1 : m === 'DELETE' ? 3 : 2; };
    writes.map((e, i) => ({ e, i })).sort((x, y) => rank(x.e) - rank(y.e) || x.i - y.i).forEach((x) => { const st = restStep(x.e, []); byCall[x.e] = st; steps.push(st); });
    return steps;
  }

  /**
   * Every API a page's code calls (REST and BI Publisher reports), each as a step ready to test or add to a scenario,
   * with where the page uses it: as it opens, a list of values (its field, shown when…), an action that takes a user
   * on (Next, Submit…), or elsewhere. → [{ key, step, role, order, chains, field, when }]
   */
  function catalogOf(facts, opts) {
    const f = facts || {};
    const ctx = { known: {}, start: [], lovFields: [], prefix: 'api-', page: str(f.id || ''), all: true };
    const steps = stepsFor(f, opts, ctx);
    const chains = (f.logic && f.logic.chains) || [];
    const modCalls = {};
    ((f.logic && f.logic.modules) || []).forEach((m) => { modCalls[str(m.name)] = m.calls || []; });
    const callsOfChain = (c) => (c.calls || []).concat(...(c.modules || []).map((m) => modCalls[str(m).replace(/^resources\/js\//, '')] || []));
    const entry = new Set([].concat(...((f.features && f.features.lifecycle) || []).map((l) => (l.chains || []).map(str))));
    const GO = /^(next|continue|proceed|add( selected)? to (the )?cart|go to (the )?cart|view cart|checkout|check out|submit|create|place|confirm|finish|done|send|search|save request|request)\b/i;
    const acts = (f.features && f.features.actions) || [];
    const goChains = new Set([].concat(...acts.filter((a) => GO.test(str(a.label).trim()) || /primary action/i.test(str(a.label))).map((a) => a.chains || [])));
    const actOf = {}; // chain → the action's label
    acts.forEach((a) => (a.chains || []).forEach((c) => { if (!actOf[c]) actOf[c] = str(a.label).replace(/: sp primary action$/, ' (its primary action)'); }));
    const lovs = ((f.integrations && f.integrations.lovs) || []).filter(isObj);
    const reportName = (st) => (st.report ? str(st.report.name || path.posix.basename(str(st.report.path), '.xdo')) : '');
    return steps.map((st, i) => {
      const key = st.report ? 'report:' + reportName(st) : st.endpoint;
      const by = chains.filter((c) => (st.report ? (c.reports || []).indexOf(reportName(st)) !== -1 : callsOfChain(c).indexOf(st.endpoint) !== -1)).map((c) => c.name);
      const lovIdx = lovs.findIndex((l) => (st.report ? l.report === reportName(st) : l.endpoint === st.endpoint));
      const role = st.lov ? 'list' : by.some((c) => entry.has(c)) ? 'opens' : by.some((c) => goChains.has(c)) ? 'next' : 'other';
      const acting = by.filter((c) => actOf[c]).map((c) => actOf[c]);
      return { key, step: Object.assign({}, st, { extract: st.lov ? st.extract.filter((e) => st.lov && e.var === st.lov.target) : [] }), role, order: lovIdx >= 0 ? lovIdx : i,
        chains: by.slice(0, 6), actions: uniq(acting).slice(0, 4), field: st.lov ? st.lov.field : '', when: str(st.when) };
    });
  }

  /**
   * The order a scenario's steps should run in, and what they miss: a step after the one that hands it what it sends;
   * otherwise as the page does it (page by page in the journey; as it opens, its lists in the form's order, the actions
   * that go on; writes last, creates first). Missing: a value a step sends that no step hands on (nor Data, nor the
   * page's choices), with the API that would. → { ok, order: [id], changed, moves: [text], missing: [{ var, step, api }] }
   */
  function suggestFor(s, catalog) {
    const steps = (s.steps || []).slice();
    const cat = {};
    (catalog || []).forEach((c) => { cat[c.page + '|' + c.key] = c; cat['*|' + c.key] = cat['*|' + c.key] || c; });
    const pages = ((s.journey && s.journey.length ? s.journey.map((j) => j.page) : [s.page]));
    const keyOf = (st) => (st.report ? 'report:' + str(st.report.name || path.posix.basename(str(st.report.path), '.xdo')) : st.endpoint);
    const ROLE = { opens: 0, list: 1, next: 2, other: 3 };
    const base = (st, i) => {
      const c = cat[(st.page || s.page) + '|' + keyOf(st)] || cat['*|' + keyOf(st)];
      const pi = Math.max(0, pages.indexOf(st.page || s.page));
      const w = st.writes ? 4 + (/^(post)$/i.test(str(c && c.step && c.step.method)) ? 0 : 0) : 0;
      return pi * 100000 + (w + (c ? ROLE[c.role] : 3)) * 10000 + (c ? c.order : 500) * 10 + i * 0.001;
    };
    const handed = {};
    steps.forEach((st) => { (st.extract || []).forEach((e) => { if (!handed[e.var]) handed[e.var] = st.id; }); if (st.lov && st.lov.target && !handed[st.lov.target]) handed[st.lov.target] = st.id; });
    const needs = (st) => uniq([].concat(...Object.keys(st.params || {}).map((k) => varsIn(st.params[k])), varsIn(st.body), varsIn(st.extra)));
    const given = new Set(Object.keys((s.data && s.data[0]) || {}).concat((s.choices || []).map((c) => c.target)));
    const placed = [], done = new Set();
    const left = steps.map((st, i) => ({ st, b: base(st, i) }));
    while (left.length) {
      const ready = left.filter((x) => needs(x.st).every((v) => !handed[v] || handed[v] === x.st.id || done.has(handed[v])));
      const pick = (ready.length ? ready : left).slice().sort((a, b) => a.b - b.b)[0];
      placed.push(pick.st);
      done.add(pick.st.id);
      left.splice(left.indexOf(pick), 1);
    }
    const order = placed.map((x) => x.id);
    const moves = [];
    placed.forEach((st, i) => {
      const was = steps.indexOf(st);
      if (was === i) return;
      const why = needs(st).filter((v) => handed[v] && handed[v] !== st.id).map((v) => '{{' + v + '}} from ' + (steps.filter((x) => x.id === handed[v])[0] || {}).name);
      moves.push((i + 1) + '. ' + st.name + (why.length ? ' — after what hands it ' + why.join(', ') : ' — where the page runs it'));
    });
    const missing = [];
    steps.forEach((st) => needs(st).forEach((v) => {
      if (handed[v] || given.has(v)) return;
      const api = (catalog || []).filter((c) => (c.step.lov && c.step.lov.target === v) || (c.step.extract || []).some((e) => e.var === v))[0];
      missing.push({ var: v, step: st.name, stepId: st.id, api: api ? { key: api.key, name: api.step.name, page: api.page } : null });
    }));
    const list = placed.map((st, i) => {
      const why = needs(st).filter((v) => handed[v] && handed[v] !== st.id).map((v) => '{{' + v + '}} from ' + ((steps.filter((x) => x.id === handed[v])[0] || {}).name || v));
      return { id: st.id, name: st.name, moved: steps.indexOf(st) !== i, why: why.length ? 'after what hands it ' + why.join(', ') : '' };
    });
    return { ok: true, order, changed: order.some((id, i) => id !== steps[i].id), moves, missing, list };
  }

  /** A scenario as shown: each step with the values its call accepts (from its service), never kept with it. */
  function accepts(env) {
    const seen = {};
    const of = (e) => {
      if (!e || !api) return { accepts: [], api: null };
      if (!seen[e]) {
        const o = api.op(e, env);
        seen[e] = o && o.ok && o.op ? { accepts: (o.op.params || []).filter((p) => p && p.name && p.in !== 'body').slice(0, 40).map((p) => ({ name: str(p.name), required: !!p.required, in: str(p.in) })),
          // the call in full: its method, the backend's address (as this PC reaches it) and its path
          api: { method: str(o.op.method).toUpperCase(), path: str(o.op.path), base: o.backend ? str(o.backend.url) : '', backend: o.backend ? str(o.backend.name) : '' } } : { accepts: [], api: null };
      }
      return seen[e];
    };
    return (s) => Object.assign({}, s, { steps: (s.steps || []).map((st) => Object.assign({}, st, st.report ? { accepts: [], api: { method: 'REPORT', path: str(st.report.path), base: '', backend: 'BI Publisher' } } : of(st.endpoint))) });
  }

  /** A step not run (yet): its name and call. */
  const blank = (st) => ({ step: st.id, name: st.name, call: st.report ? 'report ' + st.report.path : st.endpoint, state: 'skip', checks: [], extracted: {}, status: 0, ms: 0, rows: null });

  /** One step: its values filled from vars (and what it hands on put there), sent, its answer checked. */
  /** The values the scenario chose for the page ({ requestTypeSel: 'INTERNAL' }). */
  const choiceVals = (s) => ((s && s.choices) || []).reduce((a, c) => { a[c.target] = c.value; return a; }, {});
  async function runOne(s, st, vars, env, op) {
    const res = blank(st);
    // a part of the page not shown for the values chosen (the other Customer field): not run, said why
    let offNote = '';
    if (st.when && evalWhen(st.when, choiceVals(s)) === false) {
      const why = (s.choices || []).filter((c) => new RegExp('\\b' + c.target + '\\b').test(st.when)).map((c) => c.field + ' is ' + ((c.values.filter((x) => x.key === c.value)[0] || {}).text || c.value)).join(', ');
      // a step run on its own (▶ Run) is sent all the same: you asked for that one
      if (op && op.anyCase) offNote = 'not on the page as chosen' + (why ? ' (' + why + ')' : '') + ': run because you asked';
      else {
        res.note = 'not on the page' + (why ? ' when ' + why : '') + ' (it shows only when ' + st.when.slice(0, 120) + ')';
        res.off = true;
        return res;
      }
    }
    const done = await runSent(s, st, vars, env, op, res);
    if (offNote) done.note = (done.note ? done.note + ' · ' : '') + offNote;
    return done;
  }
  /** A step sent: its values filled, the call made, its answer checked (runOne, once it is to run). */
  async function runSent(s, st, vars, env, op, res) {
    const missing = [];
    const params = {};
    Object.keys(st.params || {}).forEach((k) => { params[k] = fill(st.params[k], vars, missing); });
    const extra = fill(st.extra, vars, missing);
    const body = fill(st.body, vars, missing);
    if (missing.length) { res.state = 'fail'; res.note = 'no value for ' + missing.join(', ') + ' — give it under Data, or hand it on from an earlier step'; res.stop = true; return res; }
    let confirm = false;
    if (st.writes) {
      const info = st.endpoint ? api.op(st.endpoint, env) : null;
      const backend = info && info.ok && info.op ? info.op.backend : '';
      const b = backend && env && env.backend ? env.backend(backend) : null;
      const host = b && b.url ? String(b.url).replace(/^https?:\/\//, '').split('/')[0] : '';
      if (!s.allowWrites || !op.allowWrites) { res.note = 'changes data: not run (allow writes on the scenario, then Run with writes)'; return res; }
      if (host && !PROD_FREE.test(host)) { res.note = 'changes data on ' + host + ', which looks like production: never run from a scenario'; return res; }
      confirm = true;
    }
    // a report's parameters are the ones the step gives (the tester sends only those it is told of)
    const r = await api.run(st.report ? { report: Object.assign({}, st.report, { params: Object.keys(params) }), params, extra } : { endpoint: st.endpoint, params, extra, body, confirm }, env);
    if (r.needsConfirm || (r.ok === false && r.status === undefined)) { res.state = 'fail'; res.note = r.error || 'not sent'; res.stop = true; return res; }
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
    // a list of values: its values kept with the run (to pick from), as the page shows them
    if (st.lov) {
      const list = listRows(answer, st.lov.itemsPath).filter(isObj);
      const textOf = (r) => { const t = st.lov.text && field(r, st.lov.text) != null ? field(r, st.lov.text) : Object.keys(r).map((k) => r[k]).filter((x) => typeof x === 'string' && x.trim())[0]; return str(t).slice(0, 160); };
      res.lov = { field: st.lov.field, target: st.lov.target, key: st.lov.key, text: st.lov.text, total: list.length };
      res.values = list.slice(0, MAX_VALUES).map((r) => ({ key: str(field(r, st.lov.key || 'id')).slice(0, 120), text: textOf(r), sub: st.lov.sub && field(r, st.lov.sub) != null ? str(field(r, st.lov.sub)).slice(0, 120) : '' }));
      check('the list has values (' + st.lov.field + ')', list.length > 0, list.length + ' value(s)');
    }
    (st.extract || []).forEach((e) => {
      const v = readPath(answer, e.from);
      const picked = /\[[\w.-]+=([^\]]*)\]/.exec(e.from);
      if (v !== undefined && v !== null && v !== '') { vars[e.var] = v; res.extracted[e.var] = str(v).slice(0, 200); }
      else res.checks.push({ name: 'hands on ' + e.var, ok: false, detail: picked ? 'the value picked (' + picked[1] + ') is no longer in the list' : e.from + ': not in the answer' });
    });
    res.state = res.checks.every((c) => c.ok) ? 'ok' : 'fail';
    res.status = r.status; res.ms = r.ms; res.rows = n;
    res.request = { method: r.method, url: str(r.url).slice(0, 600) };
    res.answer = str(r.pretty).slice(0, SHOW);
    if (res.state === 'fail' && Object.keys(res.extracted).length < (st.extract || []).length) res.stop = true; // what the next steps need is missing
    return res;
  }

  const store = {
    list(page, env) {
      if (!dirNow()) return no('Set up your workspace first: scenarios are kept per VB Studio project.');
      const p = str(page);
      const acc = accepts(env);
      return { ok: true, scenarios: all().filter((s) => !p || s.page === p).sort((a, b) => (a.name < b.name ? -1 : 1)).map((s) => Object.assign(acc(s), { last: lastRun(s) })) };
    },
    get(id, env) { const s = all().filter((x) => x.id === str(id))[0]; return s ? { ok: true, scenario: accepts(env)(s) } : no('No such scenario.'); },
    save(s, by, env) {
      if (!dirNow()) return no('Set up your workspace first.');
      if (!isObj(s) || !str(s.page)) return no('A scenario belongs to a page.');
      const old = s.id ? all().filter((x) => x.id === str(s.id))[0] : null;
      const c = clean(s, by, old);
      writeJson(path.join(sDir(), slug(c.id) + '.json'), c);
      return { ok: true, scenario: accepts(env)(c) };
    },
    remove(id) {
      const s = all().filter((x) => x.id === str(id))[0];
      if (!s) return no('No such scenario.');
      try { fs.unlinkSync(path.join(sDir(), slug(s.id) + '.json')); } catch (e) { return no('It could not be removed: ' + e.message); }
      return { ok: true };
    },

    /** The page's happy path, drafted from its facts: its chains in the order the page runs them, the calls each makes. */
    /** Every API of a page, ready to test or add (catalogOf), its steps with what their calls accept; and its choices. */
    apis(page, facts, opts) {
      const f = Object.assign({}, facts || {}, { id: str(page) });
      const cat = catalogOf(f, opts).map((c) => Object.assign(c, { page: str(page) }));
      // BI Publisher's own SOAP service (runBIPReport): listed with the reports it runs (each a row of its own)
      const integ = f.integrations || {};
      const bip = (integ.rest || []).filter((r) => /runBIPReport$/i.test(str(r.endpoint)) || /\/xmlpserver\//i.test(str(r.path)))[0];
      if (bip) {
        const runs = (integ.reports || []).slice();
        cat.splice(cat.findIndex((c) => c.step.report) >= 0 ? cat.findIndex((c) => c.step.report) : cat.length, 0, { key: str(bip.endpoint), page: str(page), role: 'transport', order: 0, chains: (bip.usedBy || []).slice(0, 6), actions: [], field: '', when: '', runs,
          step: { id: 'api-bip', page: str(page), name: 'BI Publisher\'s own service — runs the page\'s reports', endpoint: str(bip.endpoint), report: null, params: {}, extra: '', body: '', extract: [], lov: null, when: '', expect: { status: '2xx', fields: [] }, writes: false } });
      }
      const acc = accepts(isObj(opts) ? opts.env : null);
      const shown = acc({ steps: cat.map((c) => c.step) }).steps;
      cat.forEach((c, i) => { c.step = shown[i]; });
      // the same counts Application pages shows for the page
      const overview = { rest: (integ.rest || []).length, reports: (integ.reports || []).length, chains: ((f.logic && f.logic.chains) || []).length,
        modules: ((f.logic && f.logic.modules) || []).length, actions: ((f.features && f.features.actions) || []).length, backends: (integ.backends || []).slice(0, 8) };
      return { ok: true, page: str(page), label: str(f.label || ''), apis: cat, choices: choicesOf(f), overview };
    },
    /** The order to run a scenario's steps in and what they miss (suggestFor), from the pages it goes through. */
    suggest(scenario, factsByPage, opts) {
      if (!isObj(scenario)) return no('No scenario.');
      const s = clean(scenario, '', null);
      if (!s.steps.length) return no('The scenario has no step yet: add APIs from "APIs of this page".');
      const catalog = [].concat(...Object.keys(factsByPage || {}).map((pg) => catalogOf(Object.assign({}, factsByPage[pg], { id: pg }), opts).map((c) => Object.assign(c, { page: pg }))));
      return suggestFor(s, catalog);
    },
    /** The page's happy path, drafted from its facts, as a user goes through it (stepsFor). */
    draft(page, facts, by, opts) {
      const f = facts || {};
      const ctx = { known: {}, start: [], lovFields: [], prefix: '', page: str(page) };
      const steps = stepsFor(f, opts, ctx);
      if (!steps.length) return no('This page makes no REST call to put in order (its technical sheet lists none: Build the sheet first).');
      const s = clean({ page: page, name: 'Happy path — ' + (f.label || str(page).split('/').pop()), kind: 'happy', steps,
        journey: [{ page: str(page), label: str(f.label || str(page).split('/').pop()) }], choices: choicesOf(f),
        data: ctx.start.length ? [ctx.start.reduce((a, k) => { a[k] = ''; return a; }, {})] : [],
        notes: notesOf(ctx) }, by, null);
      return store.save(s, by, isObj(opts) ? opts.env : null);
    },

    /**
     * The journey continued on the next page (Next → the catalog → the cart): that page's steps after these, with the
     * values picked so far handed on (a {{projectId}} the cart sends is the Project picked on the first page).
     */
    extend(scenario, page, facts, by, opts) {
      if (!isObj(scenario) || !str(scenario.page)) return no('No scenario to continue.');
      const f = facts || {};
      const s0 = clean(scenario, by, null);
      const known = {};
      (s0.steps || []).forEach((st) => { (st.extract || []).forEach((e) => { known[e.var] = st.id; }); if (st.lov && st.lov.target) known[st.lov.target] = st.id; });
      const start = Object.keys((s0.data && s0.data[0]) || {});
      start.forEach((k) => { if (!known[k]) known[k] = 'start'; });
      const journey = (s0.journey && s0.journey.length ? s0.journey : [{ page: s0.page, label: '' }]).slice();
      const ctx = { known, start: start.slice(), lovFields: [], prefix: 'p' + (journey.length + 1) + '-', page: str(page), prev: s0.steps };
      const more = stepsFor(f, opts, ctx);
      if (!more.length) return no('That page makes no call to add (its code lists none).');
      const row0 = (s0.data && s0.data[0]) || {};
      const addedVars = ctx.start.filter((k) => !(k in row0));
      const newChoices = choicesOf(f).filter((c) => !(s0.choices || []).some((x) => x.target === c.target));
      journey.push({ page: str(page), label: str(f.label || str(page).split('/').pop()), vars: addedVars, choices: newChoices.map((c) => c.target), notesAt: str(s0.notes).length,
        linkedAt: now().toISOString(), linkedBy: str(by) });
      const data = (s0.data && s0.data.length ? s0.data : [{}]).map((r, i) => (i ? r : Object.assign({}, r, ctx.start.filter((k) => !(k in r)).reduce((a, k) => { a[k] = ''; return a; }, {}))));
      const choices = (s0.choices || []).concat(newChoices);
      const s = Object.assign({}, s0, { steps: s0.steps.concat(more), journey, choices, data: data.some((r) => Object.keys(r).length) ? data : [],
        name: /^Happy path — /.test(s0.name) || /^Journey — /.test(s0.name) ? 'Journey — ' + journey.map((j) => j.label).filter(Boolean).join(' → ') : s0.name,
        notes: s0.notes + ' Then ' + (f.label || page) + ': ' + notesOf(ctx, true) });
      return store.save(s, by, isObj(opts) ? opts.env : null);
    },

    /**
     * The link to a page the journey went on to, removed: that page and every page after it (they came through it),
     * their steps, and what they added (data columns and choices nothing else uses, their notes). The journey can then be
     * continued again from the page before it. Saved at once.
     */
    unlink(scenario, page, by, opts) {
      if (!isObj(scenario) || !str(scenario.page)) return no('No scenario.');
      const s0 = clean(scenario, by, null);
      const j = s0.journey || [];
      const at = j.findIndex((x, i) => i > 0 && x.page === str(page));
      if (at < 1) return no(j.length && j[0].page === str(page) ? 'That is the page the scenario starts on: it has no link to remove.' : 'That page is not linked in this scenario.');
      const gone = j.slice(at);
      const goneP = gone.map((x) => x.page);
      const keepJ = j.slice(0, at);
      const isGone = (st) => goneP.indexOf(st.page) !== -1 || gone.some((x, k) => new RegExp('^p' + (at + k + 1) + '-').test(st.id));
      const steps = s0.steps.filter((st) => !isGone(st));
      const removedSteps = s0.steps.length - steps.length;
      const text = (st) => [JSON.stringify(st.params || {}), st.body || '', st.extra || '', st.when || ''].join(' ');
      const used = (k) => steps.some((st) => text(st).indexOf('{{' + k + '}}') !== -1);
      const dropVars = [].concat(...gone.map((x) => x.vars || [])).filter((k) => !used(k));
      const dropChoices = [].concat(...gone.map((x) => x.choices || [])).filter((t) => !steps.some((st) => str(st.when).indexOf(t) !== -1));
      const data = (s0.data || []).map((r) => Object.keys(r).filter((k) => dropVars.indexOf(k) === -1).reduce((a, k) => { a[k] = r[k]; return a; }, {})).filter((r, i) => i === 0 || Object.keys(r).length);
      const choices = (s0.choices || []).filter((c) => dropChoices.indexOf(c.target) === -1);
      // the notes as they were before that page was added
      let notes = s0.notes;
      if (Number.isFinite(gone[0].notesAt) && gone[0].notesAt <= notes.length) notes = notes.slice(0, gone[0].notesAt);
      else { const i = notes.indexOf(' Then ' + (gone[0].label || gone[0].page) + ':'); if (i !== -1) notes = notes.slice(0, i); }
      const labels = keepJ.map((x) => x.label).filter(Boolean);
      const name = /^Journey — /.test(s0.name) ? (keepJ.length > 1 ? 'Journey — ' + labels.join(' → ') : 'Happy path — ' + (labels[0] || str(s0.page).split('/').pop())) : s0.name;
      const s = Object.assign({}, s0, { steps, journey: keepJ, data: data.some((r) => Object.keys(r).length) ? data : [], choices, notes, name });
      const r = store.save(s, by, isObj(opts) ? opts.env : null);
      return r.ok ? Object.assign(r, { removed: { pages: gone.map((x) => ({ page: x.page, label: x.label })), steps: removedSteps, vars: dropVars, choices: dropChoices } }) : r;
    },
    /** A linked page read again from its code and linked anew (its link removed first: its steps come back fresh). */
    relink(scenario, page, facts, by, opts) {
      const u = store.unlink(scenario, page, by, opts);
      if (!u.ok) return u;
      const r = store.extend(u.scenario, page, facts, by, opts);
      return r.ok ? Object.assign(r, { removed: u.removed }) : r;
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
      const chosen = choiceVals(s);
      for (const row of rowsIn) {
        const vars = Object.assign({}, chosen, row);
        const steps = [];
        let stop = false;
        for (const st of s.steps) {
          if (stop) { steps.push(Object.assign(blank(st), { note: 'not run: an earlier step failed' })); continue; }
          const res = await runOne(s, st, vars, env, op);
          steps.push(res);
          if (res.stop) { stop = true; }
          delete res.stop;
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
    /**
     * One step tried on its own (the ▶ beside it), from the scenario as it is on the screen (saved or not), with the
     * values handed on so far (the last run's, the data row, the values picked): its answer, not kept as a run.
     */
    async tryStep(scenario, stepId, env, opts) {
      const o = opts || {};
      if (!api) return no('The API tester is not here.');
      if (!isObj(scenario)) return no('No scenario.');
      const s = clean(scenario, o.by, null);
      const st = s.steps.filter((x) => x.id === str(stepId))[0];
      if (!st) return no('No such step.');
      const vars = Object.assign({}, choiceVals(s));
      Object.keys(isObj(o.vars) ? o.vars : {}).slice(0, 200).forEach((k) => { if (/^[\w.-]+$/.test(k) && o.vars[k] !== null && o.vars[k] !== undefined && str(o.vars[k]) !== '') vars[k] = str(o.vars[k]).slice(0, 2000); });
      // a list of values searched as you type: the text typed sent as its search parameter (as the page sends it)
      if (o.search !== undefined && o.search !== null && st.lov && st.lov.search) st.params = Object.assign({}, st.params, { [st.lov.search]: str(o.search).slice(0, 200) });
      const res = await runOne(s, st, vars, env, { allowWrites: !!o.allowWrites, anyCase: true });
      delete res.stop;
      if (/^no value for /.test(str(res.note))) res.note = res.note.replace(/ — give it under Data, or hand it on from an earlier step$/, ' — run the steps before it (Save & run), pick it from a list of values, or give it under Data');
      return { ok: true, result: Object.assign(res, { at: now().toISOString() }), vars };
    },
    runs(page) { if (!dirNow()) return no('Set up your workspace first.'); return { ok: true, runs: runsOf(str(page)) }; },
    runOf(page, runId) { const r = readJson(path.join(rDir(page), slug(runId) + '.json'), null); return r ? { ok: true, run: r } : no('No such run.'); },
  };
  return store;
}

/**
 * Is a part of the page shown, for the values chosen (its oj-bind-if: "requestTypeSel !== 'EXTERNAL' || $application…")?
 * true / false, or null when it hangs on something else (a function, a value not chosen): then it is taken as shown.
 */
function evalWhen(expr, vals) {
  const v = isObj(vals) ? vals : {};
  const close = (t) => { let d = 0, q = ''; for (let i = 0; i < t.length; i++) { const c = t[i]; if (q) { if (c === q) q = ''; continue; } if (c === '"' || c === "'") { q = c; continue; } if (c === '(') d++; else if (c === ')' && --d === 0) return i; } return -1; };
  const strip = (t) => { let x = t.trim(); while (x[0] === '(' && close(x) === x.length - 1) x = x.slice(1, -1).trim(); return x; };
  const split = (t, op) => { const out = []; let d = 0, q = '', cur = ''; for (let i = 0; i < t.length; i++) { const c = t[i]; if (q) { cur += c; if (c === q) q = ''; continue; } if (c === '"' || c === "'") { q = c; cur += c; continue; } if (c === '(') d++; if (c === ')') d--; if (!d && t.substr(i, op.length) === op) { out.push(cur); cur = ''; i += op.length - 1; continue; } cur += c; } out.push(cur); return out; };
  const name = (x) => x.split('.').pop();
  const ev = (t0) => {
    const t = strip(t0);
    const ors = split(t, '||');
    if (ors.length > 1) { const r = ors.map(ev); return r.some((x) => x === true) ? true : (r.some((x) => x === null) ? null : false); }
    const ands = split(t, '&&');
    if (ands.length > 1) { const r = ands.map(ev); return r.some((x) => x === false) ? false : (r.some((x) => x === null) ? null : true); }
    let m = /^([\w$.]+)\s*(===|!==|==|!=)\s*(['"])(.*)\3$/.exec(t);
    if (!m) { const r = /^(['"])(.*)\1\s*(===|!==|==|!=)\s*([\w$.]+)$/.exec(t); if (r) m = [r[0], r[4], r[3], r[1], r[2]]; }
    if (m) { const n = name(m[1]); if (!(n in v)) return null; const eq = str(v[n]) === m[4]; return m[2][0] === '!' ? !eq : eq; }
    m = /^(!?)\s*([\w$.]+)$/.exec(t);
    if (m) { const n = name(m[2]); if (!(n in v)) return null; const b = !!v[n] && v[n] !== 'false'; return m[1] ? !b : b; }
    return null;
  };
  return str(expr).trim() ? ev(str(expr)) : true;
}

/** The choices a page makes on itself (Customer Type, Location Type: lists written in the code that its parts are shown by). */
function choicesOf(facts) {
  const lovs = ((facts && facts.integrations && facts.integrations.lovs) || []).filter(isObj);
  const whens = lovs.map((l) => str(l.when)).join('\n');
  const out = [];
  lovs.filter((l) => l.source === 'static' && l.target && Array.isArray(l.values) && l.values.length && new RegExp('\\b' + l.target + '\\b').test(whens)).forEach((l) => {
    if (out.some((c) => c.target === l.target)) return;
    const vals = l.values.filter((x) => x && str(x.key)).map((x) => ({ key: str(x.key), text: str(x.text || x.key) }));
    const start = l.start && vals.some((x) => x.key === l.start) ? str(l.start) : vals[0].key;
    out.push({ target: str(l.target), field: str(l.field), values: vals, value: start, start, startFrom: str(l.startFrom || '') });
  });
  return out;
}

/**
 * The page an address of the app shows (the app's window: http://localhost:…/vp/shell/customer-portal/project-create-request?x=1):
 * the page whose route ends the address's path, the longest match first. pages: [{ id, label, route: { url } }]. → page | null
 */
function pageOfUrl(pages, url) {
  let p = '';
  try { p = new URL(str(url), 'http://x').pathname; } catch (e) { p = str(url).split('?')[0]; }
  p = p.replace(/\/+$/, '');
  if (!p) return null;
  const tail = (r) => str(r).replace(/\/+$/, '');
  const hits = (pages || []).filter((x) => x && x.route && x.route.url && !x.deleted).map((x) => {
    const r = tail(x.route.url);
    const fp = '/' + str(x.id).split('/').slice(1).filter(Boolean).join('/'); // flow/page (an app's root page: /page)
    const n = p.endsWith(r) ? r.length : (fp.length > 1 && p.endsWith(fp) ? fp.length : 0);
    return { x, n };
  }).filter((h) => h.n > 0).sort((a, b) => b.n - a.n);
  return hits.length ? hits[0].x : null;
}

module.exports = { open, readPath, fill, statusOk, pageOfUrl, evalWhen, choicesOf };
