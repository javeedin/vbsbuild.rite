define([
  'vb/action/actionChain',
  'resources/js/fusionSqlClient',
  'resources/js/fusionSqlRun',
  'resources/js/fusionSqlKit',
  'resources/js/exportKit',
  'resources/js/shellBus',
  'resources/js/fusionSetupsKit',
], (ActionChain, C, R, K, exportKit, bus, SK) => {
  'use strict';

  // Fusion Setups: the module-by-module setup checklist of the pod in use (desktop/lib/fusionSetups.js).
  //   open (the tab; the checklist of the pod in use) · reload · module (value: a module, '' = every one) · filter
  //   (all | missing | error | unchecked | done) · search (input)
  //   check (id: a task) · checkShown (every task shown, one after another) · stop
  //   add · edit (id) · dlgField (value: key, input) · dlgTest · dlgAi · dlgSave · dlgCancel · remove (id) · starter
  //   data (id: its records, 1,000 at most) · dataSearch / dataSort / dataPage / dataExport (value) · dataSql (open it in
  //   the SQL tab) · dataClose · report (value: xlsx | csv | pdf | copy)
  const BLANK = { code: '', module: 'COMMON', moduleName: '', name: '', fsm: '', description: '', sql: '', minRows: 1, mandatory: true, busy: '', test: null };

  class setupChain extends ActionChain {
    async run(context, { op, id, value, input }) {
      const v = context.$page.variables;
      // copies: a VB variable's proxy dies when the variable is replaced, and these are read after that
      const copy = (x) => (x ? JSON.parse(JSON.stringify(x)) : x);
      const su = copy(v.setups);
      const pod = () => (R.activePod(v) || {}).id || '';
      const set = (x) => { v.setups = Object.assign({}, v.setups, x); };
      const load = async () => {
        set({ loading: true, error: '' });
        const r = await C.setups(pod());
        const b = r.body || {};
        if (!r.ok) { set({ loading: false, error: b.error || 'The checklist could not be read.' }); return; }
        set({ loading: false, pod: pod(), modules: b.modules || [], tasks: b.tasks || [], totals: b.totals || {}, starterMissing: b.starterMissing || 0 });
      };
      /** One task checked on the pod; its line and the counts follow. */
      const checkOne = async (code) => {
        set({ busy: Object.assign({}, v.setups.busy, { [code]: true }) });
        const r = await C.setupCheck(pod(), code);
        const b = r.body || {};
        const busy = Object.assign({}, v.setups.busy);
        delete busy[code];
        if (!r.ok || !b.task) { set({ busy }); bus.toast(b.error || 'The check did not run.', 'error'); return null; }
        const tasks = v.setups.tasks.map((t) => (t.code === code ? b.task : t));
        set({ busy, tasks, modules: SK.recount(v.setups.modules, tasks), totals: SK.totals(tasks) });
        return b.task.result;
      };

      if (op === 'open') { v.tab = 'setups'; if (!su.pod || su.pod !== pod()) await load(); return; }
      if (op === 'reload') { await load(); return; }
      if (op === 'module') { set({ module: String(value || '') }); return; }
      if (op === 'filter') { set({ filter: String(value || 'all') }); return; }
      if (op === 'search') { set({ q: String(input || '') }); return; }
      if (op === 'check') { if (!pod()) { bus.toast('Add a Fusion pod first (Connection).', 'error'); return; } await checkOne(id); return; }
      if (op === 'stop') { set({ stop: true }); return; }
      if (op === 'checkShown') {
        if (!pod()) { bus.toast('Add a Fusion pod first (Connection).', 'error'); return; }
        const list = SK.shown(su);
        if (!list.length || su.run) return;
        const where = su.module ? 'the ' + ((su.modules || []).filter((m) => m.code === su.module)[0] || {}).name + ' tasks' : 'every task';
        let yes = true;
        try { yes = list.length < 10 || window.confirm('Check ' + (list.length === su.tasks.length ? where : list.length + ' tasks') + ' on ' + (R.activePod(v) || {}).name + ', one after another? Each runs a COUNT(*) through the query runner.'); } catch (e) { /* no DOM */ }
        if (!yes) return;
        set({ run: { done: 0, total: list.length, label: '', ok: 0, missing: 0, errors: 0 }, stop: false });
        for (let i = 0; i < list.length; i++) {
          if (v.setups.stop) break;
          set({ run: Object.assign({}, v.setups.run, { label: list[i].name }) });
          const res = await checkOne(list[i].code);
          const r = v.setups.run;
          set({ run: Object.assign({}, r, { done: r.done + 1, ok: r.ok + (res && res.status === 'DONE' ? 1 : 0), missing: r.missing + (res && res.status === 'MISSING' ? 1 : 0), errors: r.errors + (!res || res.status === 'ERROR' ? 1 : 0) }) });
        }
        const r = v.setups.run;
        bus.toast((v.setups.stop ? 'Stopped after ' : 'Checked ') + r.done + ' of ' + r.total + ': ' + r.ok + ' done, ' + r.missing + ' not done, ' + r.errors + ' errors.', r.errors ? 'warning' : 'success');
        set({ run: null, stop: false });
        return;
      }
      if (op === 'starter') {
        const r = await C.setupStarter();
        bus.toast(r.ok ? 'Added ' + r.body.added + ' starter task(s).' : (r.body.error || 'Could not add them.'), r.ok ? 'success' : 'error');
        await load();
        return;
      }
      if (op === 'remove') {
        const t = (su.tasks || []).filter((x) => x.code === id)[0];
        if (!t) return;
        let yes = true;
        try { yes = window.confirm('Remove the task "' + t.name + '" and its results?'); } catch (e) { /* no DOM */ }
        if (!yes) return;
        const r = await C.setupRemove(id);
        if (!r.ok) { bus.toast(r.body.error || 'Could not remove it.', 'error'); return; }
        await load();
        return;
      }
      // the task editor
      if (op === 'add') { v.setupDlg = Object.assign({}, BLANK, { module: su.module || 'COMMON' }); setupChain.focus('fsuName'); return; }
      if (op === 'edit') {
        const t = (su.tasks || []).filter((x) => x.code === id)[0];
        if (!t) return;
        v.setupDlg = Object.assign({}, BLANK, t, { busy: '', test: null });
        return;
      }
      if (op === 'dlgCancel') { v.setupDlg = null; return; }
      const d = copy(v.setupDlg);
      if (op === 'dlgField' && d) {
        const k = String(value || '');
        if (k === 'mandatory') { v.setupDlg = Object.assign({}, d, { mandatory: !d.mandatory }); return; }
        if (['module', 'moduleName', 'name', 'fsm', 'description', 'sql', 'minRows'].indexOf(k) !== -1) v.setupDlg = Object.assign({}, d, { [k]: String(input || '') });
        return;
      }
      if (op === 'dlgTest' && d) {
        if (!pod()) { bus.toast('Add a Fusion pod first (Connection).', 'error'); return; }
        const sql = setupChain.boxSql(d);
        v.setupDlg = Object.assign({}, d, { sql, busy: 'test', test: null });
        const r = await C.run(sql, 5, pod());
        const b = r.body || {};
        const n = Number(d.minRows) || 1;
        v.setupDlg = Object.assign({}, v.setupDlg, { busy: '', test: b.ok
          ? { ok: true, text: b.rowCount + (b.capped ? '+' : '') + (b.rowCount === 1 ? ' row' : ' rows') + ' (first 5 read) in ' + b.ms + ' ms' + (b.rowCount >= n ? ' — it would be DONE.' : ' — fewer than ' + n + ': NOT DONE.'), cols: (b.columns || []).join(', ') }
          : { ok: false, text: String(b.error || 'The pod refused it.').split('\n').slice(0, 4).join(' ') } });
        return;
      }
      if (op === 'dlgAi' && d) {
        if (!pod()) { bus.toast('Add a Fusion pod first (Connection).', 'error'); return; }
        if (!String(d.name).trim()) { bus.toast('Give the task a name first: the AI writes its check from it.', 'error'); return; }
        v.setupDlg = Object.assign({}, d, { busy: 'ai', test: null });
        const q = 'Write ONE Oracle Fusion Cloud SELECT that lists the records proving this setup exists on the pod (a setup checklist check: it passes when it returns at least '
          + (Number(d.minRows) || 1) + ' row). Setup: ' + d.name + (d.fsm ? '. FSM task: ' + d.fsm : '') + (d.description ? '. ' + d.description : '')
          + '. Use the base tables / views Fusion keeps it in, a few identifying columns, no placeholders.';
        const r = await C.ask({ question: q, pod: pod(), askId: 'fsu' + Date.now().toString(36) });
        const b = r.body || {};
        if (!r.ok || !b.sql) {
          v.setupDlg = Object.assign({}, v.setupDlg, { busy: '', test: { ok: false, text: b.error || 'The AI gave no SQL: ' + String(b.answer || '').slice(0, 300) } });
          if (b.needsSetup) bus.toast('Set up AI first (Tools → AI settings).', 'error');
          return;
        }
        v.setupDlg = Object.assign({}, v.setupDlg, { busy: '', sql: b.sql, test: { ok: !!b.checked, text: b.checked ? 'The AI wrote it and Build.Rite checked it on the pod.' : 'The AI wrote it, but the pod did not accept it: ' + String(b.checkError || '').split('\n')[0] } });
        const box = document.getElementById('fsuSql');
        if (box) box.value = b.sql;
        return;
      }
      if (op === 'dlgSave' && d) {
        const sql = setupChain.boxSql(d);
        v.setupDlg = Object.assign({}, d, { sql, busy: 'save' });
        const r = await C.setupSave({ code: d.code, module: d.module, moduleName: d.moduleName, name: d.name, fsm: d.fsm, description: d.description, sql, minRows: d.minRows, mandatory: d.mandatory });
        if (!r.ok) { v.setupDlg = Object.assign({}, v.setupDlg, { busy: '', test: { ok: false, text: r.body.error || 'Could not save it.' } }); return; }
        v.setupDlg = null;
        bus.toast('Saved "' + r.body.task.name + '".', 'success');
        await load();
        if (r.body.task) set({ module: r.body.task.module });
        return;
      }
      // the records behind a task
      if (op === 'data') {
        const t = (su.tasks || []).filter((x) => x.code === id)[0];
        if (!t) return;
        if (!pod()) { bus.toast('Add a Fusion pod first (Connection).', 'error'); return; }
        v.setupData = { task: t, busy: true, res: null, view: { q: '', sortCol: '', sortDir: 1, page: 0 }, grid: K.view(null, {}) };
        const r = await C.run(t.sql, 1000, pod());
        const b = r.body || {};
        const res = b.ok ? { ok: true, columns: b.columns || [], rows: b.rows || [], kinds: K.kinds(b.columns || [], b.rows || []), rowCount: b.rowCount || 0, capped: !!b.capped, ms: b.ms || 0 }
          : { ok: false, error: b.error || 'The pod did not answer.' };
        if (!v.setupData) return;
        v.setupData = Object.assign({}, v.setupData, { busy: false, res, grid: K.view(res.ok ? res : null, v.setupData.view) });
        return;
      }
      const sd = v.setupData;
      if (op === 'dataClose') { v.setupData = null; return; }
      if (sd && sd.res && sd.res.ok && (op === 'dataSearch' || op === 'dataSort' || op === 'dataPage')) {
        const w = Object.assign({}, sd.view);
        if (op === 'dataSearch') { w.q = String(input || ''); w.page = 0; }
        if (op === 'dataSort') { w.sortDir = w.sortCol === value ? -w.sortDir : 1; w.sortCol = String(value); }
        if (op === 'dataPage') w.page = Math.max(0, (Number(w.page) || 0) + Number(value || 0));
        v.setupData = Object.assign({}, sd, { view: w, grid: K.view(sd.res, w) });
        return;
      }
      if (op === 'dataExport' && sd && sd.res && sd.res.ok) {
        const res = sd.res;
        const out = await exportKit.run(String(value || 'xlsx'), { name: 'setup-' + sd.task.code.toLowerCase(), title: sd.task.name + ' · ' + ((R.activePod(v) || {}).name || ''),
          subtitle: sd.task.fsm || '', columns: res.columns.map((c) => ({ key: c, label: c, type: res.kinds.num[c] ? 'number' : 'text' })),
          rows: K.sort(K.filter(res.rows, res.columns, sd.view.q), sd.view.sortCol, sd.view.sortDir) });
        bus.toast(out.message, out.ok ? 'info' : 'error');
        return;
      }
      if (op === 'dataSql' && sd) {
        // read before the variable is let go (its proxy dies with it)
        const sql = String(sd.task.sql), title = String(sd.task.name);
        v.setupData = null;
        v.tab = 'sql';
        R.editor(v, sql);
        await R.run(v, sql, { title });
        return;
      }
      if (op === 'report') {
        const p = R.activePod(v) || {};
        const rows = SK.shown(su).map((t) => ({ module: t.moduleName, code: t.code, name: t.name, fsm: t.fsm || '', status: t.result ? { DONE: 'Done', MISSING: 'Not done', ERROR: 'Error' }[t.result.status] : 'Not checked',
          count: t.result && t.result.count != null ? t.result.count : '', minRows: t.minRows, mandatory: t.mandatory ? 'Yes' : 'No', checked: t.result ? t.result.at.replace('T', ' ').slice(0, 16) : '', error: t.result ? t.result.error || '' : '' }));
        const out = await exportKit.run(String(value || 'xlsx'), { name: 'fusion-setups-' + String(p.name || 'pod').toLowerCase().replace(/[^\w-]+/g, '-'), title: 'Fusion Setups · ' + (p.name || ''),
          subtitle: (su.totals.done || 0) + ' of ' + (su.totals.total || 0) + ' done', rows,
          columns: [{ key: 'module', label: 'Module' }, { key: 'name', label: 'Task' }, { key: 'fsm', label: 'FSM task' }, { key: 'status', label: 'Status' }, { key: 'count', label: 'Rows', type: 'number' },
            { key: 'minRows', label: 'Min rows', type: 'number' }, { key: 'mandatory', label: 'Mandatory' }, { key: 'checked', label: 'Checked' }, { key: 'error', label: 'Error' }, { key: 'code', label: 'Code' }] });
        bus.toast(out.message, out.ok ? 'info' : 'error');
      }
    }

    /** The SQL box as typed (the page may not have pushed its last keystrokes yet). */
    static boxSql(d) { const box = typeof document !== 'undefined' && document.getElementById('fsuSql'); return box ? box.value : d.sql; }
    static focus(idOf) { setTimeout(() => { const el = document.getElementById(idOf); if (el) el.focus(); }, 80); }
  }
  return setupChain;
});
