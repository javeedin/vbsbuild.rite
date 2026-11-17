define([
  'vb/action/actionChain',
  'resources/js/fusionSqlClient',
  'resources/js/fusionSqlRun',
], (ActionChain, C, R) => {
  'use strict';

  // The schema browser: an owner and a kind (their object list, from the PC's cache once read), the filter (the list
  // as cached) and Search Fusion (the dictionary itself, for names beyond the list), an object opened (its columns,
  // indexes, foreign keys or arguments), a name or a column inserted at the cursor, SELECT * written, Refresh.
  class schemaChain extends ActionChain {
    async run(context, { op, value }) {
      const v = context.$page.variables;
      const p = R.activePod(v);
      if (!p) return;
      const s = v.schema;
      if (op === 'owner' || op === 'kind') {
        v.schema = Object.assign({}, s, { [op]: String(value || ''), open: '', detail: null, found: null });
        await R.schema(v, false);
        return;
      }
      if (op === 'refresh') { v.schema = Object.assign({}, s, { open: '', detail: null }); await R.schema(v, true); return; }
      if (op === 'filter') { v.schema = Object.assign({}, s, { filter: String(value || '').trim(), found: null }); return; }
      if (op === 'search') {
        v.schema = Object.assign({}, s, { loading: true, error: '' });
        const r = await C.search(p.id, s.owner, s.kind, s.filter);
        v.schema = Object.assign({}, v.schema, { loading: false, found: r.ok ? r.body.names : null, error: r.ok ? '' : r.body.error || 'The search failed.' });
        return;
      }
      if (op === 'open' || op === 'detailRefresh') {
        const name = op === 'open' ? String(value || '') : s.open;
        if (op === 'open' && s.open === name) { v.schema = Object.assign({}, s, { open: '', detail: null }); return; }
        v.schema = Object.assign({}, s, { open: name, detail: op === 'open' ? null : s.detail, detailBusy: true });
        const r = await C.detail(p.id, s.owner, s.kind, name, op === 'detailRefresh');
        if (v.schema.open !== name) return;
        v.schema = Object.assign({}, v.schema, { detailBusy: false, detail: r.ok ? r.body : null, error: r.ok ? '' : r.body.error || 'Could not read it.' });
        return;
      }
      if (op === 'insert') {
        const ed = document.getElementById('fsqlEditor');
        const text = String(value || '');
        if (!ed) return;
        const a = ed.selectionStart, b = ed.selectionEnd;
        const next = ed.value.slice(0, a) + text + ed.value.slice(b);
        R.editor(v, next);
        ed.selectionStart = ed.selectionEnd = a + text.length;
        return;
      }
      if (op === 'star') {
        const name = s.owner && s.owner !== 'FUSION' && s.owner !== 'PUBLIC' ? s.owner + '.' + s.open : s.open;
        const cols = s.detail && s.detail.columns && s.detail.columns.length ? s.detail.columns.map((c) => c.name) : null;
        R.editor(v, 'SELECT' + (cols && cols.length <= 40 ? '\n  ' + cols.join(',\n  ') + '\n' : ' * ') + 'FROM ' + name);
      }
    }
  }
  return schemaChain;
});
