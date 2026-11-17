define([
  'vb/action/actionChain',
  'resources/js/fusionSqlRun',
  'resources/js/shellBus',
], (ActionChain, R, bus) => {
  'use strict';

  // Run (Ctrl+Enter): the selection, else the statement under the cursor; placeholders first. The grid: search, sort
  // (a header; again = the other way), pages. The history: a statement back into the editor, or cleared.
  class runChain extends ActionChain {
    async run(context, { op, value }) {
      const v = context.$page.variables;
      if (op === 'run') { if (!v.running) await R.run(v, R.statement(v)); return; }
      if (op === 'paramsCancel') { v.params = null; return; }
      if (op === 'paramsRun') {
        if (!v.params) return;
        const sql = String(v.params.sql), title = String(v.params.title || '');
        const values = {};
        Array.prototype.forEach.call(document.querySelectorAll('#fsqlParams .nx-fsql-param'), (el) => { values[el.dataset.name] = el.value; });
        v.params = null;
        await R.run(v, sql, { values, title });
        return;
      }
      if (op === 'search') { v.view = Object.assign({}, v.view, { q: String(value || document.getElementById('fsqlGridQ').value || ''), page: 0 }); R.regrid(v); return; }
      if (op === 'sort') {
        const same = v.view.sortCol === value;
        v.view = Object.assign({}, v.view, { sortCol: same && v.view.sortDir < 0 ? '' : value, sortDir: same ? -v.view.sortDir : 1, page: 0 });
        R.regrid(v);
        return;
      }
      if (op === 'page') { v.view = Object.assign({}, v.view, { page: (v.grid.page || 0) + Number(value || 0) }); R.regrid(v); return; }
      if (op === 'history') { const h = (v.history || [])[Number(value)]; if (h) R.editor(v, h.sql); return; }
      if (op === 'clearHistory') {
        let yes = true;
        try { yes = window.confirm('Clear the history of statements on this PC?'); } catch (e) { /* no DOM */ }
        if (!yes) return;
        v.history = [];
        R.ls.set(R.HIST, []);
        bus.toast('History cleared.', 'info');
      }
    }
  }
  return runChain;
});
