define([
  'vb/action/actionChain',
  'resources/js/nav',
], (ActionChain, nav) => {
  'use strict';

  // The search box (Ctrl K): Build.Rite's screens matching what is typed — their names, their group and their keywords —
  // best first (nav.search). keep: the match chosen before stays chosen when the list is drawn again.
  class searchChain extends ActionChain {
    async run(context, { keep }) {
      const pv = context.$page.variables;
      const q = String(pv.query || '');
      const before = pv.results || [];
      const chosen = keep ? (before.filter((r) => r.n === pv.resultIndex && r.type !== 'head')[0] || {}).key : '';
      const hits = nav.search(q);
      const rows = hits.length ? [{ type: 'head', key: 'head:screens', label: 'Screens', count: hits.length }] : [];
      hits.forEach((h, i) => rows.push({ type: 'row', n: i, key: 'nav:' + h.id, icon: h.icon, label: h.label, sub: h.group, hint: 'Screen',
        title: 'Open ' + h.label, open: { navId: h.id } }));
      const at = chosen ? rows.filter((r) => r.key === chosen && r.n !== undefined)[0] : null;
      pv.results = rows;
      pv.resultIndex = at ? at.n : 0;
      pv.search = { scope: 'all', expanded: '', scopes: [], count: hits.length, forQuery: q, empty: hits.length ? '' : q.trim(),
        foot: 'Searches Build.Rite\'s screens' };
      pv.showResults = !!q.trim();
    }
  }

  return searchChain;
});
