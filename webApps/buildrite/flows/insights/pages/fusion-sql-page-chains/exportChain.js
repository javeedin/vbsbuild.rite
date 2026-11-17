define([
  'vb/action/actionChain',
  'resources/js/exportKit',
  'resources/js/fusionSqlKit',
  'resources/js/shellBus',
], (ActionChain, exportKit, K, bus) => {
  'use strict';

  // The rows as the grid shows them (searched and sorted, every page): Excel, CSV, print or copy. Id columns stay text.
  class exportChain extends ActionChain {
    async run(context, { format }) {
      const v = context.$page.variables;
      v.exportOpen = false;
      const res = v.res;
      if (!res || !res.ok) return;
      const rows = K.sort(K.filter(res.rows, res.columns, v.view.q), v.view.sortCol, v.view.sortDir);
      const out = await exportKit.run(format, {
        name: (res.title || 'fusion-sql').replace(/[^\w-]+/g, '-').toLowerCase(),
        title: (res.title || 'Fusion SQL') + ' · ' + (res.pod || ''),
        subtitle: String(res.statement || '').replace(/\s+/g, ' ').slice(0, 200),
        columns: res.columns.map((c) => ({ key: c, label: c, type: res.kinds.num[c] ? 'number' : 'text' })),
        rows,
      });
      bus.toast(out.message, out.ok ? 'info' : 'error');
    }
  }
  return exportChain;
});
