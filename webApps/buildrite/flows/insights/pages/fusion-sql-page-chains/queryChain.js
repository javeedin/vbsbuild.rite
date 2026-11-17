define([
  'vb/action/actionChain',
  'resources/js/fusionSqlClient',
  'resources/js/fusionSqlRun',
  'resources/js/shellBus',
], (ActionChain, C, R, bus) => {
  'use strict';

  // Saved queries (on this PC): Save the editor's SQL (a name already saved is replaced), Run (its placeholders asked),
  // Open in the editor, Delete; Export them all to a JSON file to share, Import someone's.
  class queryChain extends ActionChain {
    async run(context, { op, id, value }) {
      const v = context.$page.variables;
      const reload = async () => { const q = await C.queries(); v.queries = (q.body && q.body.queries) || []; };
      const find = () => (v.queries || []).filter((x) => x.id === id)[0];
      if (op === 'saveOpen') {
        const sql = String((document.getElementById('fsqlEditor') || {}).value || v.sql || '').trim();
        if (!sql) { bus.toast('Write the SQL first.', 'error'); return; }
        const same = (v.queries || []).filter((x) => x.sql.trim() === sql)[0];
        v.saveDlg = { id: same ? same.id : '', name: same ? same.name : '', description: same ? same.description || '' : '', sql };
        setTimeout(() => { const n = document.getElementById('fsqlSaveName'); if (n) n.focus(); }, 60);
        return;
      }
      if (op === 'saveField') { v.saveDlg = Object.assign({}, v.saveDlg, { [id]: String(value || '') }); return; }
      if (op === 'saveCancel') { v.saveDlg = null; return; }
      if (op === 'save') {
        const d = v.saveDlg;
        const r = await C.saveQuery({ id: d.id, name: (document.getElementById('fsqlSaveName') || {}).value || d.name, description: (document.getElementById('fsqlSaveDesc') || {}).value || d.description, sql: d.sql });
        if (!r.ok) { bus.toast(r.body.error || 'Could not save it.', 'error'); return; }
        v.saveDlg = null;
        await reload();
        bus.toast('Saved “' + r.body.query.name + '”.', 'success');
        return;
      }
      if (op === 'open' || op === 'run') {
        const q = find();
        if (!q) return;
        v.tab = 'sql';
        R.editor(v, q.sql);
        if (op === 'run') { C.ranQuery(q.id).then(reload); await R.run(v, q.sql, { title: q.name }); }
        return;
      }
      if (op === 'remove') {
        const q = find();
        if (!q) return;
        let yes = true;
        try { yes = window.confirm('Delete the saved query “' + q.name + '”?'); } catch (e) { /* no DOM */ }
        if (!yes) return;
        const r = await C.removeQuery(q.id);
        if (!r.ok) { bus.toast(r.body.error || 'Could not delete it.', 'error'); return; }
        await reload();
        return;
      }
      if (op === 'export') {
        const data = JSON.stringify({ kind: 'buildrite-fusion-sql-queries', exportedAt: new Date().toISOString(), queries: (v.queries || []).map((x) => ({ name: x.name, description: x.description || '', folder: x.folder || '', sql: x.sql })) }, null, 1);
        const url = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
        const a = document.createElement('a'); a.href = url; a.download = 'fusion-sql-queries.json'; document.body.appendChild(a); a.click();
        setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 0);
        bus.toast('Exported ' + v.queries.length + ' queries.', 'success');
        return;
      }
      if (op === 'import') {
        const input = document.getElementById('fsqlQImport');
        const f = input && input.files && input.files[0];
        if (!f) return;
        let list = null;
        try { const j = JSON.parse(await f.text()); list = Array.isArray(j) ? j : j.queries; } catch (e) { list = null; }
        input.value = '';
        if (!Array.isArray(list)) { bus.toast('That file has no queries (a JSON list, or { queries: [...] }).', 'error'); return; }
        const r = await C.importQueries(list);
        await reload();
        bus.toast(r.ok ? 'Imported: ' + r.body.added + ' new, ' + r.body.updated + ' replaced' + (r.body.skipped ? ', ' + r.body.skipped + ' skipped (not a SELECT, or no name)' : '') + '.' : (r.body.error || 'Could not import them.'), r.ok ? 'success' : 'error');
      }
    }
  }
  return queryChain;
});
