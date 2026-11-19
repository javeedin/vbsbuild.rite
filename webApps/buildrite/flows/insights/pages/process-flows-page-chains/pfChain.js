define([
  'vb/action/actionChain',
  'resources/js/processFlowClient',
  'resources/js/pagesClient',
  'resources/js/exportKit',
  'resources/js/shellBus',
], (ActionChain, PC, PagesPC, exportKit, bus) => {
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

  // The flow being edited (pages are authoritative here, not in the DOM).
  let MODEL = null;

  /** The editor as it is on screen → a flow object: the top fields from the DOM, the pages from MODEL (matched to the catalog). */
  function readEditor(v) {
    const f = MODEL || v.flow || {};
    const pagesByLabel = {};
    (v.pages || []).forEach((p) => { pagesByLabel[String(p.label).toLowerCase()] = p.id; });
    const pages = (f.pages || []).map((p, i) => {
      const name = String(p.name || '').trim();
      const page = pagesByLabel[name.toLowerCase()] || p.page || '';
      return { id: p.id || 'p' + (i + 1), page, name, note: String(p.note || '') };
    });
    return Object.assign({}, f, { name: val('pf-name'), area: val('pf-area'), owner: val('pf-owner'),
      status: val('pf-status') || f.status || 'draft', description: val('pf-desc'), pages });
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
        MODEL.pages[i][String(key) === 'note' ? 'note' : 'name'] = String(input || '');
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
        v.saved = copy(MODEL); v.doc = null; v.ai = null;
        render(v);
        setTimeout(() => { const el = byId('pf-name'); if (el) el.focus(); }, 80);
        return;
      }
      if (op === 'open') {
        const r = await PC.get(String(value));
        if (!r.ok) { say(false, (r.body && r.body.error) || 'It could not be opened.'); return; }
        MODEL = Object.assign({ pages: [] }, copy(r.body.flow));
        if (!MODEL.pages.length) MODEL.pages = [newPage()];
        v.saved = copy(MODEL); v.doc = null; v.ai = null;
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
        if (dirty(v) && !window.confirm('Leave without saving? Your changes to this process flow are lost.')) return;
        MODEL = null; v.flow = null; v.saved = null; v.doc = null; v.ai = null;
        await loadList();
        return;
      }

      // ── the editor ──
      if (op === 'addPage') {
        if (!MODEL) return;
        MODEL.pages = (MODEL.pages || []).concat([newPage()]);
        render(v, true);
        setTimeout(() => { const rows = document.querySelectorAll('#pfEditor .nx-pf-prow .nx-pf-pname'); const last = rows[rows.length - 1]; if (last) last.focus(); }, 90);
        return;
      }
      if (op === 'removePage') {
        if (!MODEL) return;
        MODEL.pages = (MODEL.pages || []).filter((_, k) => k !== i);
        if (!MODEL.pages.length) MODEL.pages = [newPage()];
        render(v, true);
        return;
      }
      if (op === 'moveUp' || op === 'moveDown') {
        if (!MODEL) return;
        const p = (MODEL.pages || []).slice();
        const j = op === 'moveUp' ? i - 1 : i + 1;
        if (j < 0 || j >= p.length) return;
        const t = p[i]; p[i] = p[j]; p[j] = t;
        MODEL.pages = p;
        render(v, true);
        return;
      }
      if (op === 'save') {
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

      // ── the document ──
      if (op === 'generate') {
        const f = readEditor(v);
        const r = await PC.document(f, v.appLabel);
        if (!r.ok) { say(false, (r.body && r.body.error) || 'The document could not be made.'); return; }
        v.doc = { name: f.name, html: r.body.html };
        setTimeout(() => { const fr = byId('pfDocFrame'); if (fr) fr.srcdoc = r.body.html; }, 60);
        return;
      }
      if (op === 'docClose') { v.doc = null; return; }
      if (op === 'print') { if (v.doc) exportKit.printDocument(v.doc.html); return; }
      if (op === 'html') {
        if (!v.doc) return;
        exportKit.download(pfChain.fileBase(v) + '.html', 'text/html', v.doc.html);
        say(true, 'Downloaded the HTML.');
        return;
      }
      if (op === 'pdf') {
        if (!MODEL || v.busy) return;
        v.busy = 'pdf';
        try {
          const r = await PC.pdf(readEditor(v), v.appLabel);
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
