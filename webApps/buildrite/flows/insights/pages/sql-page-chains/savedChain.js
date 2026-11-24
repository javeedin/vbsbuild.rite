define([
  'vb/action/actionChain',
  'resources/js/sqlClient',
  'resources/js/sqlWorksheet',
  'resources/js/shellBus',
], (ActionChain, sql, W, bus) => {
  'use strict';

  // The bind values entered recently (by the Run dialog), for the :placeholders in some SQL — saved with the query.
  function bindsFor(sqlText) {
    let saved = {};
    try { saved = JSON.parse(window.localStorage.getItem('buildrite:sql-binds') || '{}') || {}; } catch (e) { saved = {}; }
    const out = {};
    W.binds(sqlText || '').forEach((nm) => { const v = saved[nm.toLowerCase()]; if (v != null && v !== '') out[nm] = v; });
    return out;
  }

  // The SQL library (saved queries), shared with the team on the data branch. Ops (op):
  //   load            fetch this connection's saved queries into $variables.saved.list
  //   toggle          open / close the "Saved" dropdown (loads on open)
  //   open (id)       load a saved query's SQL into the worksheet editor
  //   remove (id)     delete a saved query (and un-share it)
  //   dlgOpen         open the Save-query dialog, prefilled from the editor
  //   dlgClose        close it
  //   field (key,val) a Save-dialog field changed (name | description | share)
  //   save            save the worksheet's SQL under the dialog's name (and share it when ticked)
  const byId = (id) => { try { return document.getElementById(id); } catch (e) { return null; } };
  const editorText = () => { const el = byId('sqlEditor'); return el ? String(el.value || '') : ''; };

  class savedChain extends ActionChain {
    async run(context, { op, id, key, value }) {
      const v = context.$page.variables;
      const conn = v.session && v.session.name ? v.session.name : '';

      const load = async () => {
        const r = await sql.savedList(conn);
        v.saved = Object.assign({}, v.saved, { list: (r.ok && r.body.queries) || [], error: r.ok ? '' : ((r.body && r.body.error) || 'Could not read the saved queries.') });
      };

      if (op === 'load') { await load(); return; }

      if (op === 'toggle') {
        const open = !(v.saved && v.saved.open);
        v.saved = Object.assign({}, v.saved, { open: open });
        if (open) await load();
        return;
      }

      if (op === 'open') {
        const r = await sql.savedGet(id);
        const q = r.ok && r.body.query;
        if (!q) { bus.toast((r.body && r.body.error) || 'That query could not be opened.', 'error'); return; }
        const el = byId('sqlEditor');
        if (el) { el.value = q.sql || ''; el.focus(); }
        v.sql = q.sql || '';
        v.saved = Object.assign({}, v.saved, { open: false });
        sql.ranQuery(q.id); // best-effort usage bump
        bus.toast('Loaded “' + q.name + '” into the worksheet.', 'info');
        return;
      }

      if (op === 'remove') {
        const row = ((v.saved && v.saved.list) || []).filter((x) => x.id === id)[0];
        if (!window.confirm('Delete the saved query “' + ((row && row.name) || id) + '” for everyone?')) return;
        const r = await sql.removeQuery(id, true);
        if (!r.ok) { bus.toast((r.body && r.body.error) || 'It could not be removed.', 'error'); return; }
        await load();
        bus.toast('Removed.', 'info');
        return;
      }

      if (op === 'dlgOpen') {
        if (!editorText().trim()) { bus.toast('Write some SQL in the worksheet first, then Save query.', 'error'); return; }
        v.saveDlg = { open: true, name: '', description: '', share: true, busy: '', error: '' };
        setTimeout(() => { const el = byId('sqlSaveName'); if (el) el.focus(); }, 60);
        return;
      }
      if (op === 'dlgClose') { v.saveDlg = Object.assign({}, v.saveDlg, { open: false }); return; }
      if (op === 'field') {
        const k = String(key);
        const val = k === 'share' ? !!value : String(value == null ? '' : value);
        v.saveDlg = Object.assign({}, v.saveDlg, { [k]: val });
        return;
      }

      if (op === 'save') {
        const d = v.saveDlg || {};
        const name = String(d.name || '').trim();
        const text = editorText().trim();
        if (!name) { v.saveDlg = Object.assign({}, d, { error: 'Give the query a name.' }); const el = byId('sqlSaveName'); if (el) el.focus(); return; }
        if (!text) { v.saveDlg = Object.assign({}, d, { error: 'There is no SQL to save.' }); return; }
        v.saveDlg = Object.assign({}, d, { busy: 'save', error: '' });
        const share = d.share !== false;
        const r = await sql.saveQuery({ name: name, description: d.description || '', sql: text, conn: conn, binds: bindsFor(text) }, share);
        if (!(r.ok && r.body && r.body.query)) { v.saveDlg = Object.assign({}, v.saveDlg, { busy: '', error: (r.body && r.body.error) || 'It could not be saved.' }); return; }
        v.saveDlg = Object.assign({}, v.saveDlg, { open: false, busy: '' });
        await load();
        const git = r.body.git;
        const shared = share && git && (git.pushed || git.committed);
        bus.toast('Saved “' + name + '”' + (shared ? ' and shared with the team.' : (share ? ' on this PC (not shared: ' + ((git && (git.error || git.reason)) || 'the data branch is not set up') + ').' : '.')), 'info');
        return;
      }
    }
  }

  return savedChain;
});
