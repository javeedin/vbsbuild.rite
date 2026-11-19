'use strict';
/**
 * Fusion Setups (Tools → Fusion SQL → Fusion Setups): a module-by-module checklist of a pod's setup. Each task holds a
 * check SQL that returns the records proving the setup exists (legal entities, ledgers, payment terms, inventory
 * organizations…); a check runs SELECT COUNT(*) FROM (<check SQL>) on the pod through Fusion SQL's query runner, and the
 * task is DONE when the count reaches its minimum rows, NOT DONE below it, ERROR when the pod refuses the SQL. The same
 * SQL drills down into the records. The starter checklist (lib/fusionSetupsSeed.js) comes first; tasks can be changed,
 * added and removed. Ported from the WMS app's Fusion SQL (fusionsql/setups.js), kept on this PC instead of APEX.
 *
 *   open({ file, run, now }) → store
 *     file  the checklist and its results (this app's data folder; never the project, never git)
 *     run   ({ sql, rowLimit, pod }) → Promise<{ ok, rows, error }>: lib/fusionSql.js execute
 *   list(pod)            { ok, modules: [{ code, name, total, done, missing, errors, unchecked }], tasks (with the pod's result), totals }
 *   check(pod, code)     runs one task's check → { ok, task (with its result) }
 *   save(task, by)       a task added or changed (its SQL must be one SELECT / WITH) → { ok, task }
 *   remove(code)         → { ok }
 *   starter()            the starter tasks not in the checklist yet, added (never over a task changed) → { ok, added }
 *   countSql(sql)        the check as it runs (pure)
 */
const fs = require('fs');
const path = require('path');
const SEED = require('./fusionSetupsSeed');
const { validate } = require('./fusionSql');

const str = (v) => (v == null ? '' : String(v));
const cut = (s, n) => { const t = str(s); return t.length > n ? t.slice(0, n) : t; };
const STATUSES = ['DONE', 'MISSING', 'ERROR'];

/** The check as it runs: the task's SQL counted; a {{placeholder}} becomes NULL (a check has no one to ask). */
function countSql(sql) {
  const s = str(sql).trim().replace(/;+\s*$/, '').replace(/\{\{\s*[\w.]+\s*\}\}/g, 'NULL');
  return 'SELECT COUNT(*) AS CNT FROM (\n' + s + '\n)';
}

function open(opts) {
  const o = opts || {};
  const now = typeof o.now === 'function' ? o.now : () => new Date();
  const fileNow = () => (typeof o.file === 'function' ? o.file() : o.file);
  const no = (error) => ({ ok: false, error });
  let data = null;
  function load() {
    if (data) return data;
    let d = null;
    try { d = JSON.parse(fs.readFileSync(fileNow(), 'utf8')); } catch (e) { d = null; }
    if (!d || !Array.isArray(d.tasks)) {
      // the first time: the starter checklist
      d = { v: 1, tasks: SEED.TASKS.map((t) => Object.assign({}, t, { active: true, source: 'STARTER' })), results: {} };
    }
    d.results = d.results && typeof d.results === 'object' ? d.results : {};
    data = d;
    return d;
  }
  function save() {
    const f = fileNow();
    if (!f) return;
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f + '.tmp', JSON.stringify(data, null, 1));
    fs.renameSync(f + '.tmp', f);
  }
  const moduleName = (code) => { const m = SEED.MODULES.filter((x) => x[0] === code)[0]; return m ? m[1] : code; };
  const order = (code) => { const i = SEED.MODULES.map((x) => x[0]).indexOf(code); return i === -1 ? 100 : i; };
  const sorted = (tasks) => tasks.slice().sort((a, b) => order(a.module) - order(b.module) || str(a.module).localeCompare(str(b.module)) || (a.seq || 0) - (b.seq || 0) || str(a.name).localeCompare(str(b.name)));
  const withResult = (t, pod) => Object.assign({}, t, { moduleName: t.moduleName || moduleName(t.module), result: ((load().results[pod] || {})[t.code]) || null });

  return {
    countSql,
    list(pod) {
      const d = load();
      const tasks = sorted(d.tasks).map((t) => withResult(t, str(pod)));
      const mods = [];
      tasks.forEach((t) => {
        let m = mods.filter((x) => x.code === t.module)[0];
        if (!m) { m = { code: t.module, name: t.moduleName, total: 0, done: 0, missing: 0, errors: 0, unchecked: 0 }; mods.push(m); }
        if (t.active === false) return;
        m.total++;
        const s = t.result ? t.result.status : '';
        if (s === 'DONE') m.done++; else if (s === 'MISSING') m.missing++; else if (s === 'ERROR') m.errors++; else m.unchecked++;
      });
      const sum = (k) => mods.reduce((a, m) => a + m[k], 0);
      return { ok: true, modules: mods, tasks, totals: { total: sum('total'), done: sum('done'), missing: sum('missing'), errors: sum('errors'), unchecked: sum('unchecked') }, starterMissing: SEED.TASKS.filter((s) => !d.tasks.some((t) => t.code === s.code)).length };
    },
    async check(pod, code) {
      const d = load();
      const t = d.tasks.filter((x) => x.code === str(code))[0];
      if (!t) return no('No such task.');
      if (!str(pod)) return no('Choose a pod first.');
      if (typeof o.run !== 'function') return no('Fusion SQL is not here.');
      const t0 = Date.now();
      let res;
      try {
        const r = await o.run({ sql: countSql(t.sql), rowLimit: 1, pod: str(pod) });
        if (r && r.ok) {
          const row = (r.rows || [])[0] || {};
          const n = Number(row.CNT != null ? row.CNT : row.cnt != null ? row.cnt : Object.keys(row).map((k) => row[k])[0]) || 0;
          res = { status: n >= (Number(t.minRows) || 1) ? 'DONE' : 'MISSING', count: n, error: '' };
        } else res = { status: 'ERROR', count: null, error: cut(str((r && r.error) || 'The pod did not answer.').split('\n').slice(0, 3).join(' '), 1000) };
      } catch (e) { res = { status: 'ERROR', count: null, error: cut(e.message, 1000) }; }
      res.ms = Date.now() - t0;
      res.at = now().toISOString();
      d.results[str(pod)] = Object.assign({}, d.results[str(pod)] || {}, { [t.code]: res });
      save();
      return { ok: true, task: withResult(t, str(pod)) };
    },
    save(task, by) {
      const d = load();
      const x = task || {};
      const name = cut(str(x.name).trim(), 300);
      if (!name) return no('Give the task a name.');
      const v = validate(x.sql);
      if (!v || v.error) return no('Its check SQL: ' + ((v && v.error) || 'write one SELECT.'));
      const module = cut(str(x.module).trim().toUpperCase().replace(/[^A-Z0-9_]/g, '') || 'OTHER', 20);
      const old = x.code ? d.tasks.filter((t) => t.code === str(x.code))[0] : null;
      const code = old ? old.code : 'USER_' + now().getTime().toString(36).toUpperCase();
      const t = Object.assign({}, old || { source: 'USER' }, { code, module, moduleName: cut(str(x.moduleName).trim(), 100) || (old && old.moduleName) || moduleName(module), name, seq: Number(x.seq) || (old && old.seq) || 100,
        fsm: cut(str(x.fsm).trim(), 300), description: cut(str(x.description).trim(), 2000), sql: str(x.sql).trim(), minRows: Math.max(1, Math.round(Number(x.minRows) || 1)),
        mandatory: x.mandatory !== false, active: x.active !== false, updated: now().toISOString(), updatedBy: str(by) });
      if (old) {
        if (old.source === 'STARTER' && (old.sql !== t.sql || old.minRows !== t.minRows)) t.source = 'CHANGED';
        d.tasks = d.tasks.map((y) => (y.code === code ? t : y));
        // its SQL changed: what was checked before no longer says anything
        if (old.sql !== t.sql || old.minRows !== t.minRows) Object.keys(d.results).forEach((p) => { if (d.results[p][code]) delete d.results[p][code]; });
      } else d.tasks.push(t);
      save();
      return { ok: true, task: t };
    },
    remove(code) {
      const d = load();
      if (!d.tasks.some((t) => t.code === str(code))) return no('No such task.');
      d.tasks = d.tasks.filter((t) => t.code !== str(code));
      Object.keys(d.results).forEach((p) => { delete d.results[p][str(code)]; });
      save();
      return { ok: true };
    },
    starter() {
      const d = load();
      const add = SEED.TASKS.filter((s) => !d.tasks.some((t) => t.code === s.code)).map((t) => Object.assign({}, t, { active: true, source: 'STARTER' }));
      d.tasks = d.tasks.concat(add);
      save();
      return { ok: true, added: add.length };
    },
    STATUSES
  };
}

module.exports = { open, countSql, MODULES: SEED.MODULES };
