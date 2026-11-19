#!/usr/bin/env node
'use strict';
/**
 * Fusion SQL → Fusion Setups: the checklist store (desktop/lib/fusionSetups.js) and the rules the page shares
 * (webApps/buildrite/resources/js/fusionSetupsKit.js). The starter checklist (13 modules, valid read-only SQL, unique
 * codes); a check counted on the pod (DONE at the minimum rows, NOT DONE below, ERROR with the pod's words, kept per pod,
 * the {{placeholders}} as NULL); a task added (its SQL refused unless one SELECT), changed (its old results dropped, a
 * starter task marked changed), removed, the starter tasks added back; kept across a restart; the list's filter, search,
 * counts and lines.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const H = require('./_harness');
const S = require('../desktop/lib/fusionSetups');
const SEED = require('../desktop/lib/fusionSetupsSeed');
const F = require('../desktop/lib/fusionSql');

const T0 = H.makeAsserter();
// eq compares with ===: structures are compared as JSON
const T = Object.assign({}, T0, { eq: (name, a, b) => T0.eq(name, JSON.stringify(a), JSON.stringify(b)) });
let SK = null;
new Function('define', fs.readFileSync(path.join(__dirname, '..', 'webApps', 'buildrite', 'resources', 'js', 'fusionSetupsKit.js'), 'utf8'))((d, f) => { SK = f(); });

(async () => {
  T.section('the starter checklist');
  T.eq('13 modules, Enterprise Structures first', [SEED.MODULES.length, SEED.MODULES[0][1]], [13, 'Enterprise Structures']);
  T.check('83 tasks, every code unique', SEED.TASKS.length === 83 && new Set(SEED.TASKS.map((t) => t.code)).size === 83);
  T.check('every check is one read-only SELECT / WITH Fusion SQL accepts', SEED.TASKS.every((t) => !F.validate(t.sql).error));
  T.check('every task is in a module of the list and has a name and a minimum', SEED.TASKS.every((t) => SEED.MODULES.some((m) => m[0] === t.module) && t.name && t.minRows >= 1));

  T.section('the check as it runs');
  T.eq('counted, a trailing ; dropped', S.countSql('SELECT id FROM t;'), 'SELECT COUNT(*) AS CNT FROM (\nSELECT id FROM t\n)');
  T.eq('a {{placeholder}} becomes NULL', S.countSql('SELECT id FROM t WHERE bu = {{ BU_ID }}'), 'SELECT COUNT(*) AS CNT FROM (\nSELECT id FROM t WHERE bu = NULL\n)');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'br-fsu-'));
  const file = path.join(dir, 'fusion-setups.json');
  const ran = [];
  // a stand-in runner: legal entities 2, ledgers 0, payment terms refused
  const run = async (x) => {
    ran.push(x);
    if (/xle_entity_profiles/i.test(x.sql)) return { ok: true, rows: [{ CNT: 2 }] };
    if (/gl_ledgers/i.test(x.sql)) return { ok: true, rows: [{ CNT: '0' }] };
    if (/oops/i.test(x.sql)) throw new Error('socket hang up');
    return { ok: false, error: 'ORA-00942: table or view does not exist\nline two\nline three\nline four' };
  };
  let clock = new Date('2026-11-19T09:00:00Z');
  let st = S.open({ file, run, now: () => clock });

  T.section('a fresh checklist');
  let l = st.list('POD1');
  T.eq('every starter task, none checked', [l.tasks.length, l.totals.unchecked, l.totals.done, l.starterMissing], [83, 83, 0, 0]);
  T.eq('modules in the starter order, each counted', [l.modules[0].code, l.modules[0].name, l.modules[0].total > 0], ['COMMON', 'Enterprise Structures', true]);
  T.check('nothing written until something changes', !fs.existsSync(file));

  T.section('checks');
  const le = SEED.TASKS.filter((t) => /xle_entity_profiles/i.test(t.sql))[0];
  const gl = SEED.TASKS.filter((t) => /gl_ledgers/i.test(t.sql))[0];
  let r = await st.check('POD1', le.code);
  T.eq('a count at the minimum: DONE, with the count', [r.ok, r.task.result.status, r.task.result.count], [true, 'DONE', 2]);
  T.eq('run once, row limit 1, on the pod asked', [ran.length, ran[0].rowLimit, ran[0].pod, /^SELECT COUNT\(\*\) AS CNT FROM \(/.test(ran[0].sql)], [1, 1, 'POD1', true]);
  r = await st.check('POD1', gl.code);
  T.eq('below the minimum: NOT DONE (MISSING), the count kept', [r.task.result.status, r.task.result.count], ['MISSING', 0]);
  const other = SEED.TASKS.filter((t) => !/xle_entity_profiles|gl_ledgers/i.test(t.sql))[0];
  r = await st.check('POD1', other.code);
  T.eq('refused by the pod: ERROR, the first 3 lines of what it said', [r.task.result.status, r.task.result.error], ['ERROR', 'ORA-00942: table or view does not exist line two line three']);
  T.check('when and how long, kept', r.task.result.at === '2026-11-19T09:00:00.000Z' && typeof r.task.result.ms === 'number');
  T.eq('no such task / no pod', [(await st.check('POD1', 'NOPE')).error, (await st.check('', le.code)).error], ['No such task.', 'Choose a pod first.']);
  l = st.list('POD1');
  T.eq('the counts follow', [l.totals.done, l.totals.missing, l.totals.errors, l.totals.unchecked], [1, 1, 1, 80]);
  T.eq('results are per pod', st.list('POD2').totals.unchecked, 83);

  T.section('your own task');
  T.eq('a name first', st.save({ sql: 'SELECT 1 FROM dual' }).error, 'Give the task a name.');
  T.check('its SQL must be one SELECT', /read-only/.test(st.save({ name: 'X', sql: 'DELETE FROM ap_terms_tl' }).error));
  clock = new Date('2026-11-19T10:00:00Z');
  let s = st.save({ module: 'ap', name: 'Payment terms in use', fsm: 'Manage Payment Terms', sql: "SELECT term_id FROM oops_terms", minRows: '3', mandatory: false }, 'Robin');
  T.eq('saved with a code of its own, module upper-case, by and when', [s.ok, /^USER_/.test(s.task.code), s.task.module, s.task.moduleName, s.task.minRows, s.task.mandatory, s.task.updatedBy, s.task.source],
    [true, true, 'AP', 'Payables', 3, false, 'Robin', 'USER']);
  r = await st.check('POD1', s.task.code);
  T.eq('a runner that throws: ERROR with its message', [r.task.result.status, r.task.result.error], ['ERROR', 'socket hang up']);
  const s2 = st.save(Object.assign({}, s.task, { sql: 'SELECT term_id FROM ap_terms_b' }));
  T.eq('its SQL changed: same code, the old results dropped', [s2.task.code, st.list('POD1').tasks.filter((t) => t.code === s.task.code)[0].result], [s.task.code, null]);
  const changed = st.save(Object.assign({}, le, { minRows: 5 }));
  T.eq('a starter task changed: marked CHANGED, its results dropped', [changed.task.source, st.list('POD1').tasks.filter((t) => t.code === le.code)[0].result], ['CHANGED', null]);
  T.eq('a new module of your own is listed after the starter ones', [st.save({ module: 'zz9', name: 'Custom', sql: 'SELECT 1 FROM dual' }).task.module, st.list('P').modules.slice(-1)[0].code], ['ZZ9', 'ZZ9']);

  T.section('remove, starter tasks back, kept across a restart');
  T.eq('removed, with its results', [st.remove(gl.code).ok, st.list('POD1').tasks.some((t) => t.code === gl.code), st.list('POD1').starterMissing], [true, false, 1]);
  T.eq('no such task', st.remove('NOPE').error, 'No such task.');
  st = S.open({ file, run, now: () => clock });
  l = st.list('POD1');
  T.check('a restart reads it back: your tasks, the change, the results', l.tasks.some((t) => t.code === s.task.code) && l.tasks.filter((t) => t.code === le.code)[0].minRows === 5 && l.tasks.filter((t) => t.code === other.code)[0].result.status === 'ERROR');
  T.eq('the starter task removed is added back; a changed one is left as it is', [st.starter().added, st.list('POD1').starterMissing, st.list('POD1').tasks.filter((t) => t.code === le.code)[0].minRows], [1, 0, 5]);
  T.check('the file is JSON in the data folder, no temp left', JSON.parse(fs.readFileSync(file, 'utf8')).v === 1 && !fs.existsSync(file + '.tmp'));

  T.section('the page\'s rules (fusionSetupsKit)');
  const tasks = [
    { code: 'A', module: 'GL', moduleName: 'General Ledger', name: 'Ledgers', fsm: 'Manage Primary Ledgers', minRows: 1, mandatory: true, result: { status: 'DONE', count: 1200, at: '2026-11-19T09:00:00Z', ms: 1500 } },
    { code: 'B', module: 'GL', moduleName: 'General Ledger', name: 'Calendars', minRows: 2, result: { status: 'MISSING', count: 1, at: '2026-11-19T08:58:00Z', ms: 40 } },
    { code: 'C', module: 'AP', moduleName: 'Payables', name: 'Payment terms', description: 'Terms exist', result: { status: 'ERROR', error: 'ORA-00942', at: '2026-11-18T09:00:00Z' } },
    { code: 'D', module: 'AP', moduleName: 'Payables', name: 'Distribution sets', mandatory: false, source: 'USER' },
    { code: 'E', module: 'AP', moduleName: 'Payables', name: 'Old one', active: false },
  ];
  const su = { tasks, modules: [{ code: 'GL', name: 'General Ledger' }, { code: 'AP', name: 'Payables' }], filter: 'all', q: '', module: '', busy: { D: true } };
  T.eq('totals leave inactive tasks out', SK.totals(tasks), { total: 4, done: 1, missing: 1, errors: 1, unchecked: 1 });
  T.eq('filters', ['all', 'missing', 'error', 'unchecked', 'done'].map((f) => SK.shown(Object.assign({}, su, { filter: f })).map((t) => t.code).join('')), ['ABCD', 'B', 'C', 'D', 'A']);
  T.eq('a module; every word typed, in name / FSM task / description', [SK.shown(Object.assign({}, su, { module: 'AP' })).length, SK.shown(Object.assign({}, su, { q: 'primary manage' })).map((t) => t.code), SK.shown(Object.assign({}, su, { q: 'terms exist' })).map((t) => t.code)],
    [2, ['A'], ['C']]);
  const rows = SK.taskRows(su, new Date('2026-11-19T09:05:00Z').getTime());
  T.eq('a line: status, rows with separators, when and how long', [rows[0].status, rows[0].cls, rows[0].count, rows[0].when, rows[0].head], ['Done', 'ok', '1,200 rows', '5 min ago · 1.5 s', true]);
  T.eq('NOT DONE shows the minimum; the module heading only once', [rows[1].status, rows[1].count, rows[1].min, rows[1].head], ['Not done', '1 row', 'needs 2', false]);
  T.eq('an error keeps its words; a day-old check shows its date', [rows[2].cls, rows[2].error, rows[2].when, rows[2].head], ['err', 'ORA-00942', '18 Nov 2026', true]);
  T.eq('being checked; optional; yours', [rows[3].status, rows[3].busy, rows[3].optional, rows[3].own], ['Checking…', true, true, true]);
  T.eq('no heading when one module is chosen', SK.taskRows(Object.assign({}, su, { module: 'AP' })).some((x) => x.head), false);
  const mods = SK.moduleRows(Object.assign({}, su, { modules: SK.recount(su.modules, tasks) }));
  T.eq('modules: All first, then each with done / total and %', mods.map((m) => [m.code, m.done, m.total, m.pct, m.on]), [['', 1, 4, 25, true], ['GL', 1, 2, 50, false], ['AP', 0, 2, 0, false]]);

  T.report();
})().catch((e) => { console.error(e); process.exit(1); });
