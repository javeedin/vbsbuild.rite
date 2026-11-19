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

  // A page row's screenshot can be pasted (Ctrl+V on its box), dropped, or picked from a file. The clipboard can only be
  // read during the event, so this module reads it (one set of listeners, whichever page instance is live), puts the image
  // on window.__nxPfImg = { row, data } and tells the chain through the pfImage event (it writes it into the flow's page).
  let firePfImage = null;
  function listenForPfImages() {
    if (typeof document === 'undefined' || window.__nxPfImg$) return;
    window.__nxPfImg$ = true;
    const imgOf = (dt) => {
      if (!dt) return null;
      const items = Array.prototype.filter.call(dt.items || [], (i) => i.kind === 'file' && /^image\//.test(i.type)).map((i) => i.getAsFile()).filter(Boolean);
      return items[0] || Array.prototype.filter.call(dt.files || [], (f) => /^image\//.test(f.type))[0] || null;
    };
    const boxOf = (t) => (t && t.closest ? t.closest('.nx-pf-shotbox[data-idx]') : null);
    const stash = (row, file) => {
      if (row == null || !file) return false;
      const fr = new FileReader();
      fr.onload = () => { window.__nxPfImg = { row: String(row), data: String(fr.result) }; if (firePfImage) firePfImage(); };
      fr.readAsDataURL(file);
      return true;
    };
    document.addEventListener('paste', (ev) => { const b = boxOf(ev.target); if (!b) return; const f = imgOf(ev.clipboardData); if (f) { ev.preventDefault(); stash(b.getAttribute('data-idx'), f); } });
    document.addEventListener('dragover', (ev) => { const b = boxOf(ev.target); if (b) { ev.preventDefault(); b.classList.add('nx-pf-shotbox--drop'); } });
    document.addEventListener('dragleave', (ev) => { const b = boxOf(ev.target); if (b && !b.contains(ev.relatedTarget)) b.classList.remove('nx-pf-shotbox--drop'); });
    document.addEventListener('drop', (ev) => { const b = boxOf(ev.target); if (!b) return; ev.preventDefault(); b.classList.remove('nx-pf-shotbox--drop'); stash(b.getAttribute('data-idx'), imgOf(ev.dataTransfer)); });
    // the "Upload" button of a row remembers its row, then opens the shared hidden file input
    let pendRow = null;
    document.addEventListener('click', (ev) => { const btn = ev.target && ev.target.closest && ev.target.closest('.nx-pf-shotpick'); if (!btn) return; pendRow = btn.getAttribute('data-idx'); const inp = document.getElementById('pfShotFile'); if (inp) { inp.value = ''; inp.click(); } });
    document.addEventListener('change', (ev) => { if (ev.target && ev.target.id === 'pfShotFile') { const f = (ev.target.files || [])[0]; if (f && /^image\//.test(f.type)) stash(pendRow, f); ev.target.value = ''; } });
  }

  class PageModule {
    constructor(context) {
      const helper = context && typeof context.getEventHelper === 'function' ? context.getEventHelper() : null;
      firePfImage = () => { if (helper) helper.fireCustomEvent('pfImage', {}); };
      listenForPfImages();
    }
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
    /** The editor's page rows: position label, the screenshot (if any), and the APIs list state for the matched page. */
    pageRows(flow, pageApis, apisOpen) {
      const pages = (flow && flow.pages) || [];
      const last = pages.length - 1;
      const pa = pageApis || {};
      const open = apisOpen || {};
      return pages.map((p, i) => {
        const api = p.page && pa[p.page] ? pa[p.page] : null;
        const isOpen = !!open[p.id];
        return {
          id: p.id, page: p.page || '', name: p.name || '', note: p.note || '', idx: i,
          label: i === 0 ? 'Start' : (i === last ? 'End' : String(i + 1)), first: i === 0, last: i === last,
          hasShot: !!(p.shot && p.shot.data), shotData: (p.shot && p.shot.data) || '',
          shotSrc: (p.shot && p.shot.src) || '',
          matched: !!p.page,
          apisOpen: isOpen,
          apisLoading: isOpen && !!(api && api.loading),
          apisError: isOpen && api && !api.loading ? (api.error || '') : '',
          apis: isOpen && api && !api.loading && !api.error ? (api.list || []) : [],
          apisCount: api && api.list ? api.list.length : null,
          apisLabel: (api && api.list ? 'APIs (' + api.list.length + ')' : 'APIs') };
      });
    }
  }
  return PageModule;
});
