define(['vb/action/actionChain', 'resources/js/jiraItems'], (ActionChain, JI) => {
  'use strict';

  // The "follow-up" selection on the items table: a row's checkbox toggles it (act 'row'), the header checkbox selects
  // or clears the rows ON SCREEN (act 'all' — the column filters decide which, so hidden rows are never swept in),
  // act 'clear' empties it. $variables.selected is reassigned a new array each time so the checkbox and row-highlight
  // class bindings re-evaluate.
  class pickChain extends ActionChain {
    async run(context, { act, key }) {
      const v = context.$page.variables;
      const cur = (v.selected || []).slice();
      if (act === 'all') {
        // only the rows the filter/sort leave visible — tick them all, or (if every visible one is already ticked)
        // untick just those, keeping any selection on rows that are currently filtered out
        const keys = JI.keys((v.report && v.report.rows) || [], v.itemF, v.itemSort);
        const allOn = keys.length > 0 && keys.every((k) => cur.indexOf(k) >= 0);
        if (allOn) v.selected = cur.filter((k) => keys.indexOf(k) < 0);
        else { keys.forEach((k) => { if (cur.indexOf(k) < 0) cur.push(k); }); v.selected = cur; }
      } else if (act === 'clear') {
        v.selected = [];
      } else if (key) {
        const i = cur.indexOf(key);
        if (i >= 0) cur.splice(i, 1); else cur.push(key);
        v.selected = cur;
      }
    }
  }

  return pickChain;
});
