define([
  'vb/action/actionChain',
  'resources/js/fusionSqlRun',
  'resources/js/shellBus',
], (ActionChain, R, bus) => {
  'use strict';

  // A field of the page: a tab, the row limit, the editor's text (kept on this PC as a draft), a toggle.
  class setChain extends ActionChain {
    async run(context, { field, value }) {
      const v = context.$page.variables;
      if (!field) return;
      if (field === 'focus') { setChain.takeFocus(v); return; }
      if (field === 'exportOpen' || field === 'showRaw') { v[field] = !v[field]; return; }
      if (field === 'rowLimit') { const n = Math.round(Number(value)); v.rowLimit = n >= 1 && n <= 100000 ? n : (R.activePod(v) || {}).rowLimit || 100; v.rowLimitSet = true; return; }
      if (field === 'sql') { v.sql = String(value || ''); R.ls.set(R.DRAFT, v.sql); return; }
      if (['tab', 'rtab', 'qFilter'].indexOf(field) !== -1) v[field] = String(value || '');
    }
  }
  /** SQL handed by another screen (bus.focus('fusion-sql', { sql })): put in the editor, on the SQL tab. Nothing runs. */
  setChain.takeFocus = (v) => {
    const f = typeof bus.takeFocus === 'function' ? bus.takeFocus('fusion-sql') : null;
    if (!f || !f.sql) return;
    v.tab = 'sql';
    setTimeout(() => R.editor(v, String(f.sql)), 60);
    bus.toast((f.title ? f.title + ': ' : '') + 'the SQL is in the editor. Check it, then Run.', 'info');
  };
  return setChain;
});
