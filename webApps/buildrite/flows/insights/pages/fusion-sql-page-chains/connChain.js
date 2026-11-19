define([
  'vb/action/actionChain',
  'resources/js/fusionSqlClient',
  'resources/js/fusionSqlRun',
  'resources/js/shellBus',
  'resources/js/aiClient',
], (ActionChain, C, R, bus, AIC) => {
  'use strict';

  // Connection: the pods (one in use), the form (address, your app's login or a Fusion user of its own — the password
  // goes to the desktop app, which keeps it in the OS keychain and never sends it back — and the runner's settings),
  // Save, Save and test (SELECT 1 FROM dual through the runner), Deploy the runner (folder, data model, report through
  // BI Publisher's catalog service, then the test). The cards: open (the tab), testPod (id) / testActive, deployActive,
  // runnerField (value: key, input) / runnerSave (the pod in use's runner settings), aiTest / aiSettings (the AI chosen
  // for SQL), cacheClear, copySql (the runner's SQL), inspector (the API calls).
  const blank = (st) => Object.assign({ id: '', name: '', url: (st.suggest && st.suggest.url) || '', login: (st.suggest && st.suggest.appUser) ? 'app' : 'own', username: '', password: '', hasPassword: false, advanced: false },
    { reportPath: st.defaults.reportPath, dataModelPath: st.defaults.dataModelPath, folderPath: st.defaults.folderPath, dataSource: st.defaults.dataSource, rowLimit: st.defaults.rowLimit, timeoutS: Math.round((st.defaults.timeoutMs || 120000) / 1000) });

  /** The runner settings of the pod in use, as the Runner settings card edits them. */
  const runnerOf = (p) => (p ? { podId: p.id, folderPath: p.folderPath, dataModelPath: p.dataModelPath, reportPath: p.reportPath, dataSource: p.dataSource, rowLimit: p.rowLimit,
    timeoutS: Math.round((p.timeoutMs || 120000) / 1000) } : null);
  /** What the cards show: the runner of the pod in use, the AI chosen for SQL, the pod's schema cache. */
  async function refresh(v) {
    const p = R.activePod(v);
    const [a, c] = await Promise.all([AIC.settings(), p ? C.cacheInfo(p.id) : Promise.resolve({ ok: false, body: {} })]);
    v.connInfo = Object.assign({}, v.connInfo, { runner: runnerOf(p), ai: a.ok ? a.body : null, cache: c.ok ? c.body : null });
  }
  /** One pod tested; its pill and the tiles follow. */
  async function testPod(v, pid) {
    v.connInfo = Object.assign({}, v.connInfo, { podBusy: pid });
    let b = {};
    try { const r = await C.test(pid); b = r.body || {}; } finally { v.connInfo = Object.assign({}, v.connInfo, { podBusy: '' }); }
    await R.settings(v);
    return b;
  }

  class connChain extends ActionChain {
    async run(context, { op, id, value, input }) {
      const v = context.$page.variables;
      const f = v.form;
      if (op === 'open') { v.tab = 'connection'; await refresh(v); return; }
      if (op === 'inspector') { v.tab = 'calls'; const r = await C.calls(false); v.calls = (r.body && r.body.calls) || []; return; }
      if (op === 'testPod' || op === 'testActive') {
        const p = op === 'testActive' ? R.activePod(v) : v.st.pods.filter((x) => x.id === id)[0];
        if (!p) return;
        if (op === 'testActive') v.connBusy = 'test';
        let b;
        try { b = await testPod(v, p.id); } finally { if (op === 'testActive') v.connBusy = ''; }
        v.connResult = b.ok ? { ok: true, title: '✓ ' + p.name + ': the runner answered in ' + b.ms + ' ms, as ' + b.user + '.', lines: ['SELECT 1 FROM dual returned 1 on ' + b.origin + '.'] }
          : { ok: false, title: '✗ ' + p.name + ': the test failed.', error: b.error };
        bus.toast(b.ok ? p.name + ' answers.' : p.name + ': the test failed.', b.ok ? 'success' : 'error');
        return;
      }
      if (op === 'runnerField') {
        const k = String(value || '');
        if (v.connInfo.runner && ['folderPath', 'dataModelPath', 'reportPath', 'dataSource', 'rowLimit', 'timeoutS'].indexOf(k) !== -1) {
          v.connInfo = Object.assign({}, v.connInfo, { runner: Object.assign({}, v.connInfo.runner, { [k]: String(input || '') }) });
        }
        return;
      }
      if (op === 'runnerSave') {
        const rn = v.connInfo.runner;
        const p = rn && v.st.pods.filter((x) => x.id === rn.podId)[0];
        if (!p) return;
        v.connBusy = 'runner';
        try {
          const r = await C.savePod({ id: p.id, name: p.name, url: p.url, login: p.login, username: p.username, folderPath: rn.folderPath, dataModelPath: rn.dataModelPath,
            reportPath: rn.reportPath, dataSource: rn.dataSource, rowLimit: rn.rowLimit, timeoutMs: Number(rn.timeoutS) * 1000 });
          if (!r.ok) { bus.toast(r.body.error || 'Could not save them.', 'error'); return; }
          await R.settings(v);
          v.connInfo = Object.assign({}, v.connInfo, { runner: runnerOf(R.activePod(v)) });
          bus.toast('Saved the runner settings of ' + p.name + '.', 'success');
        } finally { v.connBusy = ''; }
        return;
      }
      if (op === 'deployActive') {
        const p = R.activePod(v);
        if (!p) return;
        v.connBusy = 'deploy';
        v.connResult = null;
        try {
          const r = await C.deploy(p.id);
          const b = r.body || {};
          v.connResult = { ok: !!b.ok, title: b.ok ? '✓ The runner is on ' + p.name + ' and answers.' : '✗ The deploy stopped.', lines: b.steps || [], error: b.ok ? '' : b.error };
          await R.settings(v);
          if (b.ok) await R.schema(v, false);
        } finally { v.connBusy = ''; }
        return;
      }
      if (op === 'aiTest') {
        v.connInfo = Object.assign({}, v.connInfo, { aiBusy: true, aiTest: null });
        const t0 = Date.now();
        const r = await AIC.test('sql');
        const b = r.body || {};
        v.connInfo = Object.assign({}, v.connInfo, { aiBusy: false, aiTest: r.ok && b.text ? { ok: true, text: '✓ ' + String(b.text).trim().slice(0, 200) + ' (' + Math.round((Date.now() - t0) / 100) / 10 + ' s)' }
          : { ok: false, text: '✗ ' + (b.error || 'The AI did not answer.') } });
        return;
      }
      if (op === 'aiSettings') { bus.focus('ai', {}); return; }
      if (op === 'cacheClear') {
        const p = R.activePod(v);
        if (!p) return;
        let yes = true;
        try { yes = window.confirm('Clear the schema cache of ' + p.name + '? The schema browser reads it from Fusion again when you open it.'); } catch (e) { /* no DOM */ }
        if (!yes) return;
        await C.clearCache(p.id);
        v.schema = Object.assign({}, v.schema, { owners: [], names: [], open: '', detail: null, found: null, at: '' });
        await refresh(v);
        bus.toast('Cleared the schema cache of ' + p.name + '.', 'success');
        return;
      }
      if (op === 'copySql') {
        try { await navigator.clipboard.writeText(String(v.st.runnerSql || '')); bus.toast('Copied the runner\'s SQL.', 'success'); } catch (e) { bus.toast('It could not be copied here.', 'error'); }
        return;
      }
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
      if (op === 'new') { v.tab = 'connection'; v.form = blank(v.st); v.connResult = null; await refresh(v); return; }
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
        if (v.tab === 'connection') await refresh(v);
        if (v.tab === 'setups' && p) {
          const s = await C.setups(p.id);
          if (s.ok) v.setups = Object.assign({}, v.setups, { pod: p.id, modules: s.body.modules || [], tasks: s.body.tasks || [], totals: s.body.totals || {}, starterMissing: s.body.starterMissing || 0 });
        } else v.setups = Object.assign({}, v.setups, { pod: '' });
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
        await refresh(v);
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
        } finally { v.connBusy = ''; await refresh(v); }
      }
    }
  }
  return connChain;
});
