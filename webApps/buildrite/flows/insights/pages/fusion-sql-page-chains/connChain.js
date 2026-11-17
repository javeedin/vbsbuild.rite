define([
  'vb/action/actionChain',
  'resources/js/fusionSqlClient',
  'resources/js/fusionSqlRun',
  'resources/js/shellBus',
], (ActionChain, C, R, bus) => {
  'use strict';

  // Connection: the pods (one in use), the form (address, your app's login or a Fusion user of its own — the password
  // goes to the desktop app, which keeps it in the OS keychain and never sends it back — and the runner's settings),
  // Save, Save and test (SELECT 1 FROM dual through the runner), Deploy the runner (folder, data model, report through
  // BI Publisher's catalog service, then the test).
  const blank = (st) => Object.assign({ id: '', name: '', url: (st.suggest && st.suggest.url) || '', login: (st.suggest && st.suggest.appUser) ? 'app' : 'own', username: '', password: '', hasPassword: false, advanced: false },
    { reportPath: st.defaults.reportPath, dataModelPath: st.defaults.dataModelPath, folderPath: st.defaults.folderPath, dataSource: st.defaults.dataSource, rowLimit: st.defaults.rowLimit, timeoutS: Math.round((st.defaults.timeoutMs || 120000) / 1000) });

  class connChain extends ActionChain {
    async run(context, { op, id, value, input }) {
      const v = context.$page.variables;
      const f = v.form;
      const save = async () => {
        const r = await C.savePod({ id: f.id, name: f.name, url: f.url, login: f.login, username: f.username, password: f.password, reportPath: f.reportPath, dataModelPath: f.dataModelPath,
          folderPath: f.folderPath, dataSource: f.dataSource, rowLimit: f.rowLimit, timeoutMs: Number(f.timeoutS) * 1000 });
        if (!r.ok) { v.connResult = { ok: false, title: r.body.error || 'Could not save it.' }; return null; }
        v.form = Object.assign({}, f, { id: r.body.id, name: r.body.pod.name, password: '', hasPassword: r.body.pod.hasPassword });
        const had = v.st.pods.length;
        await R.settings(v);
        if (!had) await R.schema(v, false);
        return r.body.id;
      };
      if (op === 'new') { v.tab = 'connection'; v.form = blank(v.st); v.connResult = null; return; }
      if (op === 'edit') {
        const p = v.st.pods.filter((x) => x.id === id)[0];
        if (!p) return;
        v.form = Object.assign(blank(v.st), p, { password: '', timeoutS: Math.round((p.timeoutMs || 120000) / 1000), advanced: false });
        v.connResult = null;
        return;
      }
      if (op === 'cancel') { v.form = null; return; }
      if (op === 'suggest') { v.form = Object.assign({}, f, { url: v.st.suggest.url }); return; }
      if (op === 'field') {
        const [k, x] = String(value).split(':');
        if (k === 'advanced') { v.form = Object.assign({}, f, { advanced: !f.advanced }); return; }
        if (k === 'login') { v.form = Object.assign({}, f, { login: x }); return; }
        if (['name', 'url', 'username', 'password', 'reportPath', 'dataModelPath', 'folderPath', 'dataSource', 'rowLimit', 'timeoutS'].indexOf(k) !== -1) v.form = Object.assign({}, f, { [k]: String(input || '') });
        return;
      }
      if (op === 'active') {
        const r = await C.setActive(String(value || id));
        if (!r.ok) { bus.toast(r.body.error || 'Could not switch.', 'error'); return; }
        await R.settings(v);
        v.schema = Object.assign({}, v.schema, { owners: [], names: [], open: '', detail: null, found: null });
        v.rowLimitSet = false;
        const p = R.activePod(v);
        if (p) v.rowLimit = p.rowLimit || 100;
        await R.schema(v, false);
        return;
      }
      if (op === 'remove') {
        const p = v.st.pods.filter((x) => x.id === id)[0];
        if (!p) return;
        let yes = true;
        try { yes = window.confirm('Remove the pod ' + p.name + ' from this PC (its saved password too)?'); } catch (e) { /* no DOM */ }
        if (!yes) return;
        await C.removePod(id);
        if (f && f.id === id) v.form = null;
        await R.settings(v);
        return;
      }
      if (op === 'save' || op === 'test' || op === 'deploy') {
        if (!f) return;
        v.connBusy = op;
        v.connResult = null;
        try {
          const pid = await save();
          if (!pid) return;
          if (op === 'save') { v.connResult = { ok: true, title: 'Saved ' + v.form.name + '.' }; bus.toast('Saved ' + v.form.name + '.', 'success'); return; }
          if (op === 'test') {
            const r = await C.test(pid);
            const b = r.body || {};
            v.connResult = b.ok ? { ok: true, title: '✓ The runner answered in ' + b.ms + ' ms, as ' + b.user + '.', lines: ['SELECT 1 FROM dual returned 1 on ' + b.origin + '.'] }
              : { ok: false, title: '✗ The test failed.', error: b.error };
          } else {
            const r = await C.deploy(pid);
            const b = r.body || {};
            v.connResult = { ok: !!b.ok, title: b.ok ? '✓ The runner is on the pod and answers.' : '✗ The deploy stopped.', lines: b.steps || [], error: b.ok ? '' : b.error };
          }
          await R.settings(v);
          if (v.connResult.ok) await R.schema(v, false);
        } finally { v.connBusy = ''; }
      }
    }
  }
  return connChain;
});
