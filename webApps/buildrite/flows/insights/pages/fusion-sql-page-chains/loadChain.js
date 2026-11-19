define([
  'vb/action/actionChain',
  'resources/js/fusionSqlClient',
  'resources/js/fusionSqlRun',
  'resources/js/shellBus',
], (ActionChain, C, R, bus) => {
  'use strict';

  // Opening Fusion SQL: the pods (none: the Connection form opens), the editor's draft and the history kept on this PC,
  // the saved queries, and the schema browser of the pod in use (from its cache on this PC when it was read before).
  class loadChain extends ActionChain {
    async run(context) {
      const v = context.$page.variables;
      if (v.checked) return; // the tab kept its state
      try {
        const st = await R.settings(v);
        if (!st) return;
        v.history = R.ls.get(R.HIST, []);
        const draft = R.ls.get(R.DRAFT, '');
        if (draft && !v.sql) v.sql = draft;
        const q = await C.queries();
        v.queries = (q.body && q.body.queries) || [];
        if (!st.pods.length) return;
        await R.schema(v, false);
      } finally {
        v.checked = true;
        // SQL handed by another screen before this one was open (bus.focus('fusion-sql', { sql }))
        const f = typeof bus.takeFocus === 'function' ? bus.takeFocus('fusion-sql') : null;
        if (f && f.sql) { v.tab = 'sql'; setTimeout(() => R.editor(v, String(f.sql)), 60); bus.toast((f.title ? f.title + ': ' : '') + 'the SQL is in the editor. Check it, then Run.', 'info'); }
      }
    }
  }
  return loadChain;
});
