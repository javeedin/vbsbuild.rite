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
  /** A URL as the editor/panel shows it: the path + query (the scheme and host dropped), for readability. */
  function loc(u) { return String(u || '').replace(/^[a-z]+:\/\/[^/]+/i, '').trim(); }

  // Match a recorded API call (method + path pattern) to a catalog API, so its Test button runs with that data.
  // This mirrors flowRecorder.callForApi on the desktop so the editor and the document agree.
  function pathOf(u) { const s = String(u || ''); const h = s.replace(/#.*$/, ''); const q = h.indexOf('?'); return (q === -1 ? h : h.slice(0, q)).replace(/^[a-z]+:\/\/[^/]+/i, '').replace(/\/+$/, '') || '/'; }
  function pathMatches(apiPath, got) {
    const pat = String(apiPath || '').replace(/[?#].*$/, '').replace(/\/+$/, '');
    const g = String(got || '').replace(/\/+$/, '');
    if (!pat) return false;
    if (g === pat || (pat.length && g.slice(-pat.length) === pat)) return true;
    try { return new RegExp(pat.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\{[^/}]+\\\}/g, '[^/]+') + '$').test(g); } catch (e) { return false; }
  }
  function callForApi(api, calls) {
    if (!api || !api.path || !calls || !calls.length) return null;
    const m = String(api.method || 'GET').toUpperCase();
    const hits = calls.filter((c) => String(c.method || 'GET').toUpperCase() === m && pathMatches(api.path, c.path || pathOf(c.url)));
    hits.sort((a, b) => Math.abs(String(a.path || pathOf(a.url)).length - api.path.length) - Math.abs(String(b.path || pathOf(b.url)).length - api.path.length));
    return hits[0] || null;
  }
  /** A short, human line of what the recorded call sends. */
  function callText(c) {
    if (!c) return '';
    const cut = (s, n) => (s && s.length > n ? s.slice(0, n) + '…' : s || '');
    const bits = [];
    if (c.query) bits.push(cut(String(c.query), 60));
    if (c.body) bits.push('body ' + cut(String(c.body), 60));
    if (c.status != null) bits.push('was ' + c.status);
    return bits.join(' · ');
  }
  /** The decoded response rows as a readable text table (columns header + rows). */
  function tableText(tb) {
    if (!tb || !Array.isArray(tb.columns) || !tb.columns.length) return '';
    const head = tb.columns.join('  |  ');
    const rows = (Array.isArray(tb.rows) ? tb.rows : []).map((r) => (Array.isArray(r) ? r.join('  |  ') : ''));
    return head + '\n' + '-'.repeat(Math.min(head.length, 120)) + '\n' + rows.join('\n');
  }
  /** A request/response body pretty-printed when it is JSON (so a one-line POST body reads nicely); else as it is. */
  function prettyBody(t) {
    const s = String(t == null ? '' : t).trim();
    if (!s || (s[0] !== '{' && s[0] !== '[')) return String(t == null ? '' : t);
    try { return JSON.stringify(JSON.parse(s), null, 2); } catch (e) { return String(t == null ? '' : t); }
  }
  /** A one-line summary of the decoded response (what kind it is, how many rows). */
  function tableInfo(call) {
    const tb = call && call.table;
    if (!tb) return '';
    const n = typeof tb.total === 'number' ? tb.total : (tb.rows ? tb.rows.length : 0);
    const kind = call.respKind === 'bip' ? 'BI Publisher report' : 'Response';
    return kind + ' · ' + n + (n === 1 ? ' row' : ' rows') + (tb.from ? ' · ' + tb.from : '');
  }
  /** The test result as a short line. */
  function testText(t) {
    if (!t) return '';
    if (t.needsConfirm) return t.message || t.error || 'This changes data — Run anyway to send it.';
    if (t.error && t.status == null) return t.error;
    return (t.ok ? '✓ ' : '✗ ') + (t.status != null ? t.status : '') + (t.ms != null ? ' · ' + t.ms + ' ms' : '') + (t.rows != null ? ' · ' + t.rows + ' row(s)' : '');
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
    /** Does this flow carry recorded API calls on any page? (then "Create scenario from the recording" is offered.) */
    hasRecordedCalls(flow) { return ((flow && flow.pages) || []).some((p) => p && Array.isArray(p.calls) && p.calls.length); }
    /** How many recorded calls across the flow, for the button's hint. */
    recordedCallCount(flow) { return ((flow && flow.pages) || []).reduce((n, p) => n + ((p && Array.isArray(p.calls)) ? p.calls.length : 0), 0); }
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
    /** The live recording's steps, numbered, for the recording panel (with the screen / dialog kind and the url). */
    recRows(recording) {
      return ((recording && recording.steps) || []).map((s, i) => ({ n: String(i + 1), name: s.name || s.page || 'Page',
        isDialog: s.kind === 'dialog', kindLabel: s.kind === 'dialog' ? 'Dialog' : 'Screen', url: loc(s.url) }));
    }
    /** The editor's page rows: position label, the screenshot (if any), and the APIs list state for the matched page. */
    pageRows(flow, pageApis, apisOpen, apiTests, apiData, recCallsOpen) {
      const pages = (flow && flow.pages) || [];
      const last = pages.length - 1;
      const pa = pageApis || {};
      const open = apisOpen || {};
      const tests = apiTests || {};
      const dOpen = apiData || {};
      const rOpen = recCallsOpen || {};
      return pages.map((p, i) => {
        const api = p.page && pa[p.page] ? pa[p.page] : null;
        const isOpen = !!open[p.id];
        const calls = (p.calls && p.calls.length) ? p.calls : [];
        const list = isOpen && api && !api.loading && !api.error ? (api.list || []) : [];
        const apis = list.map((a, k) => {
          const call = callForApi(a, calls);
          const tkey = p.id + '|' + k;
          const t = tests[tkey] || null;
          const mth = (call && call.method) || a.method || 'GET';
          return {
            idx: i, k: k, endpoint: a.endpoint || '', method: a.method || 'GET', name: a.name || '', path: a.path || '', writes: !!a.writes,
            hasData: !!call, dataText: call ? callText(call) : '', dataOpen: !!dOpen[tkey],
            // the captured request/response, shown in the expand/collapse panel
            callMethod: String(mth).toUpperCase(), callPath: (call && (call.path || call.url)) || '', callQuery: (call && call.query) || '',
            callBody: call ? prettyBody(call.body) : '', callResp: (call && call.response) || '', callStatus: call && call.status != null && call.status !== '' ? String(call.status) : '',
            callKind: (call && call.respKind) || '', callTableText: call && call.table ? tableText(call.table) : '', callTableInfo: call && call.table ? tableInfo(call) : '',
            running: !!(t && t.running),
            result: t && !t.running ? t : null,
            resultClass: t && !t.running ? (t.needsConfirm ? 'warn' : (t.ok ? 'ok' : 'bad')) : '',
            resultText: t && !t.running ? testText(t) : '',
            response: t && !t.running && t.body ? t.body : '',
            needsConfirm: !!(t && !t.running && t.needsConfirm) };
        });
        // every call captured on this page while recording, with its data — shown regardless of whether it maps to a
        // catalog API, so the recorded JSON (query/body for a request, the decoded response) is always visible
        const recThis = !!rOpen[p.id];
        const recorded = recThis ? calls.map((c) => ({
          method: String((c && c.method) || 'GET').toUpperCase(), path: loc((c && (c.path || c.url)) || ''),
          query: (c && c.query) || '', body: prettyBody(c && c.body),
          status: c && c.status != null && c.status !== '' ? String(c.status) : '',
          kind: (c && c.respKind) || '', resp: (c && c.response) || '',
          tableInfo: c && c.table ? tableInfo(c) : '', tableText: c && c.table ? tableText(c.table) : '' })) : [];
        return {
          recOpen: recThis, recCount: calls.length, recorded: recorded,
          id: p.id, page: p.page || '', name: p.name || '', note: p.note || '', idx: i,
          url: loc(p.url), fullUrl: p.url || '', kind: p.kind || '', isDialog: p.kind === 'dialog', kindLabel: p.kind === 'dialog' ? 'Dialog' : (p.kind === 'page' ? 'Screen' : ''),
          label: i === 0 ? 'Start' : (i === last ? 'End' : String(i + 1)), first: i === 0, last: i === last,
          hasShot: !!(p.shot && p.shot.data), shotData: (p.shot && p.shot.data) || '',
          shotSrc: (p.shot && p.shot.src) || '',
          matched: !!p.page, calls: calls.length,
          apisOpen: isOpen,
          apisLoading: isOpen && !!(api && api.loading),
          apisError: isOpen && api && !api.loading ? (api.error || '') : '',
          apis: apis,
          apisCount: api && api.list ? api.list.length : null,
          apisLabel: (api && api.list ? 'APIs (' + api.list.length + ')' : 'APIs') };
      });
    }
  }
  return PageModule;
});
