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
      steps, journey: (Array.isArray(s.journey) ? s.journey : []).filter(isObj).slice(0, 12).map((j) => ({ page: str(j.page).slice(0, 200), label: str(j.label).slice(0, 200) })).filter((j) => j.page),
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
    if (acts) {
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
  async function runOne(s, st, vars, env, op) {
    const res = blank(st);
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
    /** The page's happy path, drafted from its facts, as a user goes through it (stepsFor). */
    draft(page, facts, by, opts) {
      const f = facts || {};
      const ctx = { known: {}, start: [], lovFields: [], prefix: '', page: str(page) };
      const steps = stepsFor(f, opts, ctx);
      if (!steps.length) return no('This page makes no REST call to put in order (its technical sheet lists none: Build the sheet first).');
      const s = clean({ page: page, name: 'Happy path — ' + (f.label || str(page).split('/').pop()), kind: 'happy', steps,
        journey: [{ page: str(page), label: str(f.label || str(page).split('/').pop()) }],
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
      journey.push({ page: str(page), label: str(f.label || str(page).split('/').pop()) });
      const data = (s0.data && s0.data.length ? s0.data : [{}]).map((r, i) => (i ? r : Object.assign({}, r, ctx.start.filter((k) => !(k in r)).reduce((a, k) => { a[k] = ''; return a; }, {}))));
      const s = Object.assign({}, s0, { steps: s0.steps.concat(more), journey, data: data.some((r) => Object.keys(r).length) ? data : [],
        name: /^Happy path — /.test(s0.name) || /^Journey — /.test(s0.name) ? 'Journey — ' + journey.map((j) => j.label).filter(Boolean).join(' → ') : s0.name,
        notes: s0.notes + ' Then ' + (f.label || page) + ': ' + notesOf(ctx, true) });
      return store.save(s, by, isObj(opts) ? opts.env : null);
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
      const vars = {};
      Object.keys(isObj(o.vars) ? o.vars : {}).slice(0, 200).forEach((k) => { if (/^[\w.-]+$/.test(k) && o.vars[k] !== null && o.vars[k] !== undefined && str(o.vars[k]) !== '') vars[k] = str(o.vars[k]).slice(0, 2000); });
      // a list of values searched as you type: the text typed sent as its search parameter (as the page sends it)
      if (o.search !== undefined && o.search !== null && st.lov && st.lov.search) st.params = Object.assign({}, st.params, { [st.lov.search]: str(o.search).slice(0, 200) });
      const res = await runOne(s, st, vars, env, { allowWrites: !!o.allowWrites });
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

module.exports = { open, readPath, fill, statusOk, pageOfUrl };
