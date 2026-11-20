define([
  'vb/action/actionChain',
  'resources/js/processFlowClient',
  'resources/js/pagesClient',
  'resources/js/scenarioClient',
  'resources/js/apiClient',
  'resources/js/exportKit',
  'resources/js/shellBus',
], (ActionChain, PC, PagesPC, SC, API, exportKit, bus) => {
  'use strict';

  // Process Flows: one screen — a list of flows and an editor. Ops (data-op):
  //   load · search (input) · new · open (value: id) · remove (value: id) · back
  //   pedit (an editor row input changed: key = name|note, idx, input) · addPage · moveUp / moveDown / removePage (idx) · save
  //   generate (the document → preview) · docClose · pdf · html · print · ai (draft the description) · aiUse · aiClose
  // MODEL (below) is the one true copy of the pages while editing: every keystroke in a row writes to it (pedit), so the
  // VB loop (which reuses DOM nodes and binds :value one-way) never has to be the source of truth. $variables.flow is only
  // re-rendered on structural changes, and syncRows() force-writes each row's inputs from MODEL after a re-render.
  const byId = (id) => { try { return document.getElementById(id); } catch (e) { return null; } };
  const val = (id) => { const el = byId(id); return el ? String(el.value || '') : ''; };
  const copy = (x) => (x == null ? x : JSON.parse(JSON.stringify(x)));
  /** A page's APIs (scenarioClient) as the list the editor and the document show: endpoint, method, name, path, writes. */
  function mapApis(apis) {
    return (apis || []).map((a) => {
      const st = a.step || {};
      const m = st.report ? 'REPORT' : ((st.api && st.api.method) || a.method || (st.writes ? 'POST' : 'GET'));
      return { endpoint: a.key || st.endpoint || '', report: st.report ? (st.report.name || st.report.path || '') : '',
        method: m, name: st.name || a.name || a.key || '', path: st.report ? (st.report.path || '') : ((st.api && st.api.path) || st.endpoint || a.path || ''), writes: !!st.writes };
    });
  }
  /** A page's APIs, from the cache (v.pageApis) or fetched once and cached there. */
  async function apisForPage(v, pageId) {
    if (!pageId) return [];
    if (v.pageApis && v.pageApis[pageId] && v.pageApis[pageId].list) return v.pageApis[pageId].list;
    const r = await SC.apis(pageId);
    const list = r.ok ? mapApis(r.body.apis) : [];
    v.pageApis = Object.assign({}, v.pageApis || {}, { [pageId]: { loading: false, list, error: r.ok ? '' : ((r.body && r.body.error) || 'Could not read the APIs.') } });
    return list;
  }

  // ── match a recorded call to a page's API, and turn it into a tester request (mirrors desktop/lib/flowRecorder) ──
  const pathOf = (u) => { const s = String(u || '').replace(/#.*$/, ''); const q = s.indexOf('?'); return (q === -1 ? s : s.slice(0, q)).replace(/^[a-z]+:\/\/[^/]+/i, '').replace(/\/+$/, '') || '/'; };
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
    const hits = (calls || []).filter((c) => String(c.method || 'GET').toUpperCase() === m && pathMatches(api.path, c.path || pathOf(c.url)));
    hits.sort((a, b) => Math.abs(String(a.path || pathOf(a.url)).length - api.path.length) - Math.abs(String(b.path || pathOf(b.url)).length - api.path.length));
    return hits[0] || null;
  }
  /** The path parameters (/a/b/{id} ↔ the recorded /a/b/42) as { id: '42' }, aligned from the end. */
  function pathParams(apiPath, urlPath) {
    const a = String(apiPath || '').replace(/[?#].*$/, '').replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);
    const u = String(urlPath || '').replace(/[?#].*$/, '').replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);
    const off = Math.max(0, u.length - a.length);
    const out = {};
    a.forEach((seg, idx) => { const m = /^\{(.+)\}$/.exec(seg); if (m) { try { out[m[1]] = decodeURIComponent(u[off + idx] || ''); } catch (e) { out[m[1]] = u[off + idx] || ''; } } });
    return out;
  }
  /** A tester request (apiTest.run) from a recorded call: path params filled, its query as extra, its body. */
  function reqFromCall(api, call) {
    if (!call) return { params: {}, extra: '', body: '' };
    return { params: pathParams(api.path, call.path || pathOf(call.url)), extra: String(call.query || '').replace(/^\?/, ''), body: String(call.body || '') };
  }
  const RESP_CAP = 1600;
  const trimResp = (s) => { const t = String(s || ''); return t.length > RESP_CAP ? t.slice(0, RESP_CAP) + '\n…' : t; };

  // The flow being edited (pages are authoritative here, not in the DOM).
  let MODEL = null;

  // Record from the app: while recording, poll the desktop recorder for the pages walked through so the panel updates live.
  let recTimer = null;
  let recOn = false;
  function recStopPoll() { recOn = false; if (recTimer) { clearTimeout(recTimer); recTimer = null; } }
  function recPoll(v) {
    if (!recOn) return;
    PC.recordStatus().then((r) => {
      if (!recOn || !v.recording) return;
      const b = r.body || {};
      if (r.ok) v.recording = Object.assign({}, v.recording, { running: !!b.running, steps: b.steps || [], skipped: b.skipped || 0, auto: typeof b.auto === 'boolean' ? b.auto : v.recording.auto });
      recTimer = setTimeout(() => recPoll(v), 1500);
    }).catch(() => { if (recOn) recTimer = setTimeout(() => recPoll(v), 1500); });
  }

  // a top field: the live input when the form is on screen (edit view), else MODEL's value (preview, where the form is gone)
  const top = (id, fallback) => (byId(id) ? val(id) : String(fallback || ''));
  /** The editor as it is → a flow object: the top fields (from the form, or MODEL in preview), the pages from MODEL. */
  function readEditor(v) {
    const f = MODEL || v.flow || {};
    const pagesByLabel = {};
    (v.pages || []).forEach((p) => { pagesByLabel[String(p.label).toLowerCase()] = p.id; });
    const pages = (f.pages || []).map((p, i) => {
      const name = String(p.name || '').trim();
      const page = pagesByLabel[name.toLowerCase()] || p.page || '';
      const out = { id: p.id || 'p' + (i + 1), page, name, note: String(p.note || '') };
      if (p.url) out.url = p.url;
      if (p.kind) out.kind = p.kind;
      if (p.shot && p.shot.data) out.shot = p.shot;
      if (p.calls && p.calls.length) out.calls = p.calls;
      return out;
    });
    return Object.assign({}, f, { name: top('pf-name', f.name), area: top('pf-area', f.area), owner: top('pf-owner', f.owner),
      status: (byId('pf-status') ? val('pf-status') : '') || f.status || 'draft', description: top('pf-desc', f.description), pages });
  }
  /** Read the page rows' inputs from the DOM into MODEL (name / note, and the matched catalog page). pedit keeps MODEL
   *  current on every keystroke, but this is called before any structural change or save so MODEL always matches what is
   *  on screen, whatever the timing of pedit's action chain. The rows match MODEL 1-to-1 here (no re-render yet). */
  function foldRows(v) {
    if (!MODEL || !MODEL.pages) return;
    const byLabel = {};
    (v.pages || []).forEach((p) => { byLabel[String(p.label || '').toLowerCase()] = p.id; });
    Array.prototype.slice.call(document.querySelectorAll('#pfEditor .nx-pf-prow')).forEach((row) => {
      const p = MODEL.pages[Number(row.getAttribute('data-idx'))];
      if (!p) return;
      const nm = row.querySelector('.nx-pf-pname');
      if (nm) { p.name = String(nm.value || ''); p.page = byLabel[p.name.trim().toLowerCase()] || p.page || ''; }
      const nt = row.querySelector('.nx-pf-pnote');
      if (nt) p.note = String(nt.value || '');
    });
    // the top fields too (only while the form is on screen), so Preview / PDF read them from MODEL when it is hidden
    if (byId('pf-name')) MODEL.name = val('pf-name');
    if (byId('pf-area')) MODEL.area = val('pf-area');
    if (byId('pf-owner')) MODEL.owner = val('pf-owner');
    if (byId('pf-status')) MODEL.status = val('pf-status') || MODEL.status || 'draft';
    if (byId('pf-desc')) MODEL.description = val('pf-desc');
  }
  const dirty = (v) => MODEL && v.saved && JSON.stringify(readEditor(v)) !== JSON.stringify(v.saved);
  /** After a re-render, force each page row's inputs to MODEL (oj reuses loop nodes, so a reused node keeps its old value). */
  function syncRows() {
    setTimeout(() => {
      const rows = Array.prototype.slice.call(document.querySelectorAll('#pfEditor .nx-pf-prow'));
      const pages = (MODEL && MODEL.pages) || [];
      rows.forEach((row) => {
        const p = pages[Number(row.getAttribute('data-idx'))];
        if (!p) return;
        const nm = row.querySelector('.nx-pf-pname'); if (nm) nm.value = p.name || '';
        const nt = row.querySelector('.nx-pf-pnote'); if (nt) nt.value = p.note || '';
      });
    }, 40);
  }
  const newPage = () => ({ id: 'p' + Date.now().toString(36) + Math.floor(Math.random() * 1000).toString(36), page: '', name: '', note: '' });
  /** Put MODEL on screen (re-render the loop, then fill the reused rows). With `fold`, the on-screen top fields
   *  (name / area / owner / status / description) are read into MODEL first, so re-rendering keeps them — the
   *  description textarea in particular is re-bound to MODEL on every reassignment and would otherwise be wiped. */
  function render(v, fold) {
    if (fold && MODEL) {
      MODEL.name = val('pf-name'); MODEL.area = val('pf-area'); MODEL.owner = val('pf-owner');
      MODEL.status = val('pf-status') || MODEL.status || 'draft'; MODEL.description = val('pf-desc');
    }
    v.flow = copy(MODEL); syncRows();
  }

  class pfChain extends ActionChain {
    async run(context, { op, idx, key, value, input }) {
      const v = context.$page.variables;
      const say = (ok, text) => bus.toast(text, ok ? 'success' : 'error');
      const i = Number(idx);
      const loadList = async () => { const r = await PC.list(v.q); v.flows = r.ok ? r.body.flows : []; };

      // a row input changed — keep MODEL current (no re-render: the DOM already holds the typed value)
      if (op === 'pedit') {
        if (!MODEL || !MODEL.pages || !MODEL.pages[i]) return;
        const field = String(key) === 'note' ? 'note' : 'name';
        MODEL.pages[i][field] = String(input || '');
        if (field === 'name') {
          // match the typed name to a catalog page, so "From the page" and the APIs list know which page it is
          const nm = String(input || '').trim().toLowerCase();
          const hit = (v.pages || []).filter((p) => String(p.label || '').toLowerCase() === nm)[0];
          MODEL.pages[i].page = hit ? hit.id : '';
        }
        return;
      }
      if (op === 'load') {
        const r = await PC.list('');
        if (r.body && r.body.unavailable) { v.available = false; v.checked = true; return; }
        v.flows = r.ok ? r.body.flows : [];
        v.checked = true;
        try {
          const base = (typeof window !== 'undefined' && window.vbInitConfig && window.vbInitConfig.APP_BASE_URL) || '';
          const c = await PagesPC.catalog(base);
          const pages = ((c.body && c.body.pages) || []).map((p) => ({ id: p.id, label: p.label || p.page || p.id }));
          v.pages = pages;
          v.appLabel = (pages[0] && pages[0].appName) || '';
        } catch (e) { v.pages = []; }
        return;
      }
      if (op === 'search') { v.q = String(input || ''); await loadList(); return; }
      if (op === 'new') {
        MODEL = { id: '', name: '', description: '', area: '', owner: '', status: 'draft', pages: [newPage()] };
        v.saved = copy(MODEL); v.doc = null; v.ai = null; v.apisOpen = {}; v.apiTests = {}; v.apiData = {}; v.view = 'edit';
        render(v);
        setTimeout(() => { const el = byId('pf-name'); if (el) el.focus(); }, 80);
        return;
      }
      if (op === 'open') {
        const r = await PC.get(String(value));
        if (!r.ok) { say(false, (r.body && r.body.error) || 'It could not be opened.'); return; }
        MODEL = Object.assign({ pages: [] }, copy(r.body.flow));
        if (!MODEL.pages.length) MODEL.pages = [newPage()];
        v.saved = copy(MODEL); v.doc = null; v.ai = null; v.apisOpen = {}; v.apiTests = {}; v.apiData = {}; v.view = 'edit';
        render(v);
        return;
      }
      if (op === 'remove') {
        const id = String(value);
        const f = (v.flows || []).filter((x) => x.id === id)[0] || (MODEL && MODEL.id === id ? MODEL : null);
        if (!window.confirm('Remove the process flow "' + ((f && f.name) || id) + '"?')) return;
        const r = await PC.remove(id);
        if (!r.ok) { say(false, (r.body && r.body.error) || 'It could not be removed.'); return; }
        if (MODEL && MODEL.id === id) { MODEL = null; v.flow = null; v.saved = null; }
        await loadList();
        say(true, 'Removed.');
        return;
      }
      if (op === 'back') {
        if (MODEL) foldRows(v);
        if (dirty(v) && !window.confirm('Leave without saving? Your changes to this process flow are lost.')) return;
        MODEL = null; v.flow = null; v.saved = null; v.doc = null; v.ai = null; v.apisOpen = {}; v.apiTests = {}; v.apiData = {}; v.view = 'edit';
        await loadList();
        return;
      }

      // ── Record from the app: open the real app, follow the pages walked through, build the flow ──
      if (op === 'recStart') {
        const r = await PC.recordStart('');
        if (!r.ok) { say(false, (r.body && r.body.error) || 'Recording needs the desktop app with your workspace set up.'); return; }
        v.recording = { running: true, steps: [], skipped: 0, busy: false, error: '', auto: true };
        recOn = true;
        recTimer = setTimeout(() => recPoll(v), 1200);
        return;
      }
      // capture the screen on display right now (so you choose exactly what goes into the flow)
      if (op === 'recCapture') {
        if (!v.recording || v.recording.busy) return;
        const r = await PC.recordCapture();
        const b = r.body || {};
        if (!r.ok) { say(false, (b && b.error) || 'Could not capture the screen — open your app window and try again.'); return; }
        say(true, 'Captured ' + (b.kind === 'dialog' ? 'dialog' : 'screen') + (b.name ? ' “' + b.name + '”' : '') + ' — ' + b.count + ' so far.');
        try { const st = await PC.recordStatus(); const sb = st.body || {}; if (st.ok && v.recording) v.recording = Object.assign({}, v.recording, { steps: sb.steps || [], skipped: sb.skipped || 0 }); } catch (e) { /* the poll will catch up */ }
        return;
      }
      // turn automatic capture on / off
      if (op === 'recAuto') {
        if (!v.recording) return;
        const on = !v.recording.auto;
        v.recording = Object.assign({}, v.recording, { auto: on });
        try { await PC.recordAuto(on); } catch (e) { /* ignore */ }
        return;
      }
      if (op === 'recCancel') {
        recStopPoll();
        try { await PC.recordStop(); } catch (e) { /* the window may already be gone */ }
        v.recording = null;
        return;
      }
      if (op === 'recStop') {
        if (!v.recording || v.recording.busy) return;
        recStopPoll();
        v.recording = Object.assign({}, v.recording, { busy: true });
        const r = await PC.recordStop();
        const b = r.body || {};
        const pages = (r.ok && b.pages) || [];
        if (!pages.length) { say(false, 'No app pages were recorded. Open the pages you want in the app, then Stop & save.'); v.recording = null; return; }
        // open the editor pre-filled with the recorded pages — the user names it and Saves
        MODEL = { id: '', name: '', description: '', area: '', owner: '', status: 'draft',
          pages: pages.map((p, i) => { const pg = { id: p.id || ('p' + (i + 1)), page: p.page || '', name: p.name || '', note: '' }; if (p.url) pg.url = p.url; if (p.kind) pg.kind = p.kind; if (p.shot && p.shot.data) pg.shot = { src: 'page', data: p.shot.data }; if (p.calls && p.calls.length) pg.calls = p.calls; return pg; }) };
        v.saved = copy(MODEL); v.doc = null; v.ai = null; v.apisOpen = {}; v.apiTests = {}; v.apiData = {}; v.view = 'edit'; v.recording = null;
        render(v);
        setTimeout(() => { const el = byId('pf-name'); if (el) el.focus(); }, 80);
        say(true, pages.length + ' page(s) recorded — name it and Save.');
        return;
      }

      // ── the editor ──
      if (op === 'addPage') {
        if (!MODEL) return;
        foldRows(v);
        MODEL.pages = (MODEL.pages || []).concat([newPage()]);
        render(v, true);
        setTimeout(() => { const rows = document.querySelectorAll('#pfEditor .nx-pf-prow .nx-pf-pname'); const last = rows[rows.length - 1]; if (last) last.focus(); }, 90);
        return;
      }
      if (op === 'removePage') {
        if (!MODEL) return;
        foldRows(v);
        MODEL.pages = (MODEL.pages || []).filter((_, k) => k !== i);
        if (!MODEL.pages.length) MODEL.pages = [newPage()];
        render(v, true);
        return;
      }
      if (op === 'moveUp' || op === 'moveDown') {
        if (!MODEL) return;
        foldRows(v);
        const p = (MODEL.pages || []).slice();
        const j = op === 'moveUp' ? i - 1 : i + 1;
        if (j < 0 || j >= p.length) return;
        const t = p[i]; p[i] = p[j]; p[j] = t;
        MODEL.pages = p;
        render(v, true);
        return;
      }

      // ── a page's screenshot: taken from the page (captured live, like Application pages, else the one already on its
      //    sheet), or pasted/dropped/uploaded, or removed ──
      if (op === 'shotFromPage') {
        if (!MODEL || !MODEL.pages[i]) return;
        foldRows(v);
        const pageId = MODEL.pages[i].page;
        if (!pageId) { say(false, 'Type a page name that matches one of your pages first — then its screenshot can be taken.'); return; }
        v.busy = 'shot:' + i;
        try {
          let data = '';
          let capErr = '';
          // capture it live (runs the page like Application pages does) when this app can; otherwise use a screenshot
          // already on the page's technical sheet
          const info = await PagesPC.info();
          if (info.canCapture) {
            const cap = await PagesPC.capture(pageId);
            if (cap.ok) {
              const sid = cap.body && cap.body.shot && cap.body.shot.id;
              const r = await PagesPC.shotData(pageId, sid);
              data = (r.ok && r.body && r.body.data) || '';
            } else capErr = (cap.body && cap.body.error) || '';
          }
          if (!/^data:image\//.test(data)) {
            const r = await PagesPC.shotData(pageId);
            data = (r.ok && r.body && r.body.data) || '';
          }
          if (!/^data:image\//.test(data)) {
            say(false, capErr || (info.canCapture ? 'The screenshot could not be captured — Upload an image instead.'
              : 'This page has no screenshot yet. Capture one in Application pages, or Upload an image here.'));
            return;
          }
          MODEL.pages[i].shot = { src: 'page', data };
          render(v, true);
          say(true, 'Screenshot taken from the page.');
        } finally { v.busy = ''; }
        return;
      }
      if (op === 'shotPaste') {
        const img = (typeof window !== 'undefined' && window.__nxPfImg) || null;
        if (typeof window !== 'undefined') window.__nxPfImg = null;
        if (!MODEL || !img) return;
        const r = Number(img.row);
        if (!MODEL.pages[r] || !/^data:image\//.test(String(img.data || ''))) return;
        MODEL.pages[r].shot = { src: 'pasted', data: String(img.data) };
        render(v, true);
        return;
      }
      if (op === 'shotRemove') {
        if (MODEL && MODEL.pages[i]) { delete MODEL.pages[i].shot; render(v, true); }
        return;
      }

      // ── a page's APIs: show / hide, fetched once from its code (scenarioClient) and cached ──
      if (op === 'apisToggle') {
        if (!MODEL || !MODEL.pages[i]) return;
        foldRows(v);
        const rowId = MODEL.pages[i].id;
        const pageId = MODEL.pages[i].page;
        const open = Object.assign({}, v.apisOpen || {});
        open[rowId] = !open[rowId];
        v.apisOpen = open;
        if (!open[rowId]) return;
        if (!pageId) { say(false, 'Type a page name that matches one of your pages first — then its APIs can be listed.'); return; }
        if (v.pageApis && v.pageApis[pageId] && v.pageApis[pageId].list) return;
        v.pageApis = Object.assign({}, v.pageApis || {}, { [pageId]: { loading: true, list: null, error: '' } });
        const r = await SC.apis(pageId);
        v.pageApis = Object.assign({}, v.pageApis || {}, { [pageId]: { loading: false, list: r.ok ? mapApis(r.body.apis) : [], error: r.ok ? '' : ((r.body && r.body.error) || 'Could not read the APIs.') } });
        return;
      }
      // ── show / hide an API's captured request (the data recorded for it) ──
      if (op === 'apiDataToggle') {
        if (!MODEL || !MODEL.pages[i]) return;
        foldRows(v);
        const dk = MODEL.pages[i].id + '|' + Number(key);
        const d = Object.assign({}, v.apiData || {});
        d[dk] = !d[dk];
        v.apiData = d;
        return;
      }
      // ── test one of a page's APIs, with the data captured while recording the flow (apiTestGo = after "changes data") ──
      if (op === 'apiTest' || op === 'apiTestGo') {
        if (!MODEL || !MODEL.pages[i]) return;
        foldRows(v);
        const pg = MODEL.pages[i];
        const k = Number(key);
        const list = (v.pageApis && v.pageApis[pg.page] && v.pageApis[pg.page].list) || [];
        const api = list[k];
        if (!api) return;
        const tkey = pg.id + '|' + k;
        if (api.report) { say(false, 'This is a BI Publisher report — run it from Oracle BIP Reporting.'); return; }
        if (!api.endpoint) { say(false, 'This API has no endpoint to test.'); return; }
        const reqBase = reqFromCall(api, callForApi(api, pg.calls || []));
        const confirm = op === 'apiTestGo';
        v.apiTests = Object.assign({}, v.apiTests || {}, { [tkey]: { running: true } });
        try {
          const r = await API.run(Object.assign({}, reqBase, { endpoint: api.endpoint, confirm }));
          const res = r.body || {};
          const res2 = {
            running: false, ok: !!res.ok,
            status: (res.status !== undefined && res.status !== null) ? res.status : null,
            ms: (res.ms !== undefined && res.ms !== null) ? res.ms : null,
            rows: res.table ? res.table.total : null,
            body: trimResp(res.pretty),
            needsConfirm: !!res.needsConfirm,
            message: res.needsConfirm ? (res.error || '') : '',
            error: res.needsConfirm ? '' : (res.fault || res.error || (!res.ok ? (res.statusText || 'The call failed.') : '')) };
          v.apiTests = Object.assign({}, v.apiTests || {}, { [tkey]: res2 });
        } catch (e) {
          v.apiTests = Object.assign({}, v.apiTests || {}, { [tkey]: { running: false, ok: false, status: null, error: String((e && e.message) || e) } });
        }
        return;
      }
      if (op === 'save') {
        foldRows(v);
        const f = readEditor(v);
        if (!f.name.trim()) { say(false, 'Give the process flow a name first.'); const el = byId('pf-name'); if (el) el.focus(); return; }
        v.busy = 'save';
        try {
          const r = await PC.save(f);
          if (!r.ok) { say(false, (r.body && r.body.error) || 'It could not be saved.'); return; }
          MODEL = Object.assign({ pages: [] }, copy(r.body.flow));
          if (!MODEL.pages.length) MODEL.pages = [newPage()];
          v.saved = copy(MODEL); render(v);
          await loadList();
          say(true, 'Saved ' + r.body.flow.id + '.');
        } finally { v.busy = ''; }
        return;
      }

      // the flow for the document: the pages with their screenshots (already on MODEL) and their APIs (resolved now)
      const withApisAsync = async (f) => Object.assign({}, f, {
        pages: await Promise.all((f.pages || []).map(async (p) => Object.assign({}, p, { apis: p.page ? await apisForPage(v, p.page) : [] }))) });

      // ── the document: Edit / Preview (the card document, shown inline and exported) ──
      if (op === 'view') {
        const to = String(key) === 'preview' ? 'preview' : 'edit';
        if (to !== 'preview') { v.view = 'edit'; return; }
        foldRows(v);                        // read the form (still on screen) into MODEL
        v.view = 'preview';                 // now the form is hidden; readEditor falls back to MODEL
        const f = await withApisAsync(readEditor(v));
        const r = await PC.document(f, v.appLabel);
        if (!r.ok) { say(false, (r.body && r.body.error) || 'The document could not be made.'); v.view = 'edit'; return; }
        v.doc = { name: f.name, html: r.body.html };
        setTimeout(() => { const fr = byId('pfDocFrame'); if (fr) fr.srcdoc = r.body.html; }, 60);
        return;
      }
      if (op === 'print') { if (v.doc) exportKit.printDocument(v.doc.html); return; }
      if (op === 'html') {
        if (!v.doc) return;
        exportKit.download(pfChain.fileBase(v) + '.html', 'text/html', v.doc.html);
        say(true, 'Downloaded the HTML.');
        return;
      }
      if (op === 'pdf') {
        if (!MODEL || v.busy) return;
        foldRows(v);
        v.busy = 'pdf';
        try {
          const r = await PC.pdf(await withApisAsync(readEditor(v)), v.appLabel);
          const b = r.body || {};
          if (r.ok && b.base64) {
            const bin = atob(b.base64);
            const bytes = new Uint8Array(bin.length);
            for (let k = 0; k < bin.length; k++) bytes[k] = bin.charCodeAt(k);
            exportKit.download(pfChain.fileBase(v) + '.pdf', 'application/pdf', bytes);
            say(true, 'Saved the PDF.');
          } else say(false, b.error || 'The PDF could not be made.');
        } finally { v.busy = ''; }
        return;
      }

      // ── draft the description with AI ──
      if (op === 'ai') {
        foldRows(v);
        const f = readEditor(v);
        if (!f.name.trim()) { say(false, 'Give the process flow a name first — the AI drafts from it.'); return; }
        v.busy = 'ai';
        try {
          const r = await PC.ai(f);
          const b = r.body || {};
          if (r.ok && b.text) v.ai = { text: b.text, provider: b.provider ? 'by ' + b.provider : '' };
          else say(false, b.needsSetup ? 'Set up AI first (Tools → AI settings).' : (b.error || 'The AI did not answer.'));
        } finally { v.busy = ''; }
        return;
      }
      if (op === 'aiUse') {
        if (!v.ai) return;
        const el = byId('pf-desc'); if (el) el.value = v.ai.text;
        v.ai = null;
        say(true, 'The draft is in the description.');
        return;
      }
      if (op === 'aiClose') { v.ai = null; return; }
    }

    static fileBase(v) { return String((MODEL && (MODEL.id || MODEL.name)) || 'process-flow').replace(/[^\w-]+/g, '-').toLowerCase().replace(/^-+|-+$/g, '') || 'process-flow'; }
  }
  return pfChain;
});
