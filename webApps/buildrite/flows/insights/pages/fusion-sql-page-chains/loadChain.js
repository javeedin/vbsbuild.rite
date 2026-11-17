define([
  'vb/action/actionChain',
  'resources/js/fusionSqlClient',
  'resources/js/fusionSqlRun',
], (ActionChain, C, R) => {
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
      }
    }
  }
  return loadChain;
});
