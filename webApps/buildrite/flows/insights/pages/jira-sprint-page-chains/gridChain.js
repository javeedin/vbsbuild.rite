define(['vb/action/actionChain', 'resources/js/jiraItems'], (ActionChain, JI) => {
  'use strict';

  // The items table's column filters and sort. Variables are reassigned (new object) so the bound view re-evaluates.
  class gridChain extends ActionChain {
    async run(context, { act, field, value, col }) {
      const v = context.$page.variables;
      // Keep the follow-up selection to the rows still on screen: a narrower filter must not leave hidden rows ticked
      // (so "Copy N to follow-up" and "Analyze N" only ever cover what you can see).
      const pruneSelection = () => {
        const sel = v.selected || [];
        if (!sel.length) return;
        const keys = JI.keys((v.report && v.report.rows) || [], v.itemF, v.itemSort);
        const next = sel.filter((k) => keys.indexOf(k) >= 0);
        if (next.length !== sel.length) v.selected = next;
      };
      if (act === 'filter') {
        const f = Object.assign({}, v.itemF || {});
        f[field] = value;
        v.itemF = f;
        pruneSelection();
        return;
      }
      // A click on a By-status / By-person / By-customer row: set that column's filter, or clear it if it is already picked.
      if (act === 'pick') {
        const f = Object.assign({}, v.itemF || {});
        f[field] = (f[field] === value) ? '' : value;
        v.itemF = f;
        pruneSelection();
        return;
      }
      if (act === 'sort') {
        const cur = v.itemSort || { col: '', dir: 'asc' };
        v.itemSort = (cur.col === col) ? { col: col, dir: cur.dir === 'asc' ? 'desc' : 'asc' } : { col: col, dir: 'asc' };
        return;
      }
      if (act === 'clear') { v.itemF = {}; v.itemSort = { col: '', dir: 'asc' }; }
    }
  }

  return gridChain;
});
