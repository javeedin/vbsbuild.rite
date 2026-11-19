define([], () => {
  'use strict';

  // Process Flows: binding helpers (none uses `this`).
  const STATUS = { draft: 'Draft', review: 'In review', approved: 'Approved', retired: 'Retired' };
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function ago(iso) {
    const d = new Date(iso);
    if (!iso || isNaN(d.getTime())) return '';
    const m = Math.max(0, Math.round((Date.now() - d.getTime()) / 60000));
    return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : m < 1440 ? Math.round(m / 60) + ' h ago' : d.getDate() + ' ' + MON[d.getMonth()] + ' ' + d.getFullYear();
  }

  class PageModule {
    statusLabel(s) { return STATUS[s] || s || 'Draft'; }
    statusRows(cur) { return Object.keys(STATUS).map((id) => ({ id, label: STATUS[id], on: (cur || 'draft') === id })); }
    chainText(names) {
      const list = (names || []).filter(Boolean);
      if (!list.length) return 'No pages yet';
      const shown = list.slice(0, 5).join('  →  ');
      return shown + (list.length > 5 ? '  →  +' + (list.length - 5) + ' more' : '');
    }
    cardMeta(f) {
      return (f.pages || 0) + (f.pages === 1 ? ' page' : ' pages') + (f.area ? ' · ' + f.area : '') + (f.updated ? ' · updated ' + ago(f.updated) : '') + (f.updatedBy ? ' · ' + f.updatedBy : '');
    }
    /** The editor's page rows, each with its position label (Start / n / End) — index work is done here, not in the template. */
    pageRows(flow) {
      const pages = (flow && flow.pages) || [];
      const last = pages.length - 1;
      return pages.map((p, i) => ({ id: p.id, page: p.page, name: p.name || '', note: p.note || '', idx: i, label: i === 0 ? 'Start' : (i === last ? 'End' : String(i + 1)), first: i === 0, last: i === last }));
    }
  }
  return PageModule;
});
