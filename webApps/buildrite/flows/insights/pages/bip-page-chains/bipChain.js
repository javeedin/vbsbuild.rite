define([
  'vb/action/actionChain',
  'resources/js/bipClient',
  'resources/js/bipKit',
  'resources/js/fusionSqlKit',
  'resources/js/exportKit',
  'resources/js/shellBus',
], (ActionChain, C, E, K, exportKit, bus) => {
  'use strict';

  // BIP Reporting:
  //   load · focus (a report handed by another screen) · tab (value) · pod (input) · toFusionSql
  //   catalog: go (value: a folder) · refresh · search (input) · index · indexStop · open (id: path, value: type) · fav (id, value: type)
  //   run: defRefresh · format (input) · bField (value: by | n | pair, input) · run · stop · gSearch (input) / gSort (value) / gPage (value)
  //        export (value) · download / openFile / openFolder (id: a run) · dm · dmCopy / dmFusion (id: a data set) · dmClose
  //   dashboard: addCard · cardField (value, input) · cardSave · cardCancel · cardRun (id) · cardRunAll · cardOpen (id) · cardRemove (id)
  //   history: hFilter (input) · hOpen (id) · hAgain (id) · hRemove (id) · settings: pField (value, input) · pSave
  // A VB variable's proxy dies when the variable is replaced: what is read after that is read from a copy.
  const copy = (x) => (x == null ? x : JSON.parse(JSON.stringify(x)));
  const say = (ok, text) => bus.toast(text, ok === true ? 'success' : ok === false ? 'error' : 'info');
  const pid = () => 'bip' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  /** The form as typed: every parameter box (a list for a multiple choice, true / false for a tick). */
  function readForm(rep) {
    const out = Object.assign({}, (rep && rep.values) || {});
    if (typeof document === 'undefined') return out;
    document.querySelectorAll('#bipParams .nx-bip-param').forEach((el) => {
      const n = el.getAttribute('data-name');
      if (!n) return;
      if (el.tagName === 'SELECT' && el.multiple) out[n] = Array.prototype.map.call(el.selectedOptions, (o) => o.value).filter(Boolean);
      else if (el.type === 'checkbox') out[n] = el.checked;
      else out[n] = el.value;
    });
    return out;
  }

  class bipChain extends ActionChain {
    async run(context, { op, id, value, input }) {
      const v = context.$page.variables;
      const k = String(id || '');
      const setCat = (x) => { v.cat = Object.assign({}, copy(v.cat), x); };
      const setRep = (x) => { v.rep = Object.assign({}, copy(v.rep), x); };
      const loadRuns = async () => { const r = await C.runs(); v.runs = r.ok ? r.body.runs : []; };
      const loadCards = async () => { const r = await C.cards(); v.cards = r.ok ? r.body.cards : []; };
      const indexInfo = async () => { const r = await C.search(v.pod, ''); setCat({ index: r.ok ? r.body.index : null }); };
      const go = async (p, refresh) => {
        setCat({ path: p || '/', loading: true, error: '', found: null, q: '' });
        const r = await C.folder(v.pod, p || '/', refresh);
        const b = r.body || {};
        setCat({ loading: false, items: r.ok ? b.items : [], at: b.at || '', src: b.src || '', error: r.ok ? (b.warning ? 'Fusion did not list this folder (' + b.warning + '): the index\'s copy is shown.' : '') : b.error || 'It could not be read.' });
      };
      const openReport = async (p, values, opts) => {
        const o = opts || {};
        v.tab = 'run';
        v.rep = { path: p, name: String(p).split('/').pop().replace(/\.xdo$/i, ''), def: null, loading: true, error: '', values: {}, format: 'csv', template: '', bucket: { pair: '', by: 'none', n: 7 } };
        v.dm = null;
        if (!o.keepResult) { v.res = null; v.view = { q: '', sortCol: '', sortDir: 1, page: 0 }; v.grid = K.view(null, {}); }
        const r = await C.definition(v.pod, p, !!o.refresh);
        const b = r.body || {};
        if (!r.ok) { setRep({ loading: false, error: b.error || 'Its definition could not be read.' }); return; }
        const def = b.def;
        const pr = E.datePairs(def.parameters)[0];
        const list = E.formats(def);
        setRep({ loading: false, def, at: b.at, src: b.src, name: def.reportName || v.rep.name, values: Object.assign(E.defaults(def.parameters), values || {}),
          format: o.format && list.some((f) => f.value === o.format) ? o.format : E.defaultFormat(def, list), bucket: { pair: pr ? pr.from + '|' + pr.to : '', by: 'none', n: 7 } });
      };
      const showResult = (b) => {
        const res = { run: b.run, columns: b.columns || [], rows: b.rows || [], sent: b.sent || (b.rows || []).length };
        res.kinds = K.kinds(res.columns, res.rows);
        v.res = res;
        v.view = { q: '', sortCol: '', sortDir: 1, page: 0 };
        v.grid = K.view(res.rows.length ? res : null, v.view);
      };
      const download = (rid) => {
        try { const a = document.createElement('a'); a.href = C.fileUrl(rid); a.download = ''; document.body.appendChild(a); a.click(); a.remove(); } catch (e) { say(false, 'It could not be downloaded here.'); }
      };

      if (op === 'load') {
        if (v.checked) return;
        try {
          const s = await C.settings();
          if (s.body && s.body.unavailable) { v.available = false; return; }
          const st = s.body || {};
          v.st = { pods: st.pods || [], active: st.active || '', prefs: st.prefs || {} };
          v.prefs = Object.assign({}, st.prefs || {});
          v.pod = st.active || ((st.pods || [])[0] || {}).id || '';
          const f = await C.favorites();
          setCat({ favorites: f.ok ? f.body.favorites : [], podId: v.pod });
          await Promise.all([loadRuns(), loadCards()]);
          if (v.pod) { await indexInfo(); await go('/', false); }
        } finally { v.checked = true; await bipChain.takeFocus(v, openReport); }
        return;
      }
      if (op === 'focus') { await bipChain.takeFocus(v, openReport); return; }
      if (op === 'tab') { v.tab = String(value || 'catalog'); if (v.tab === 'history') await loadRuns(); return; }
      if (op === 'toFusionSql') { bus.focus('fusion-sql', {}); return; }
      if (op === 'pod') {
        v.pod = String(input || '');
        setCat({ podId: v.pod, index: null });
        v.rep = null; v.res = null;
        await indexInfo();
        await go('/', false);
        v.tab = 'catalog';
        return;
      }

      // ── the catalog ──
      if (op === 'go') { v.tab = 'catalog'; await go(String(value || '/'), false); return; }
      if (op === 'refresh') { await go(v.cat.path, true); return; }
      if (op === 'search') {
        const q = String(input || '');
        if (q.trim().length < 2) { setCat({ q, found: null }); return; }
        setCat({ q });
        const r = await C.search(v.pod, q);
        if (String(v.cat.q) !== q) return; // typed on
        setCat({ found: r.ok ? r.body.items : [], index: r.ok ? r.body.index : v.cat.index });
        return;
      }
      if (op === 'index') {
        const progressId = pid();
        const update = !!v.cat.index;
        setCat({ indexing: { id: progressId, folders: 0, items: 0, label: '' } });
        const tick = setInterval(async () => {
          const pr = await C.progress(progressId);
          const last = pr.ok && pr.body.last;
          if (last && v.cat.indexing) setCat({ indexing: { id: progressId, folders: last.folders || 0, items: last.items || 0, label: last.label || '' } });
        }, 700);
        let r;
        try { r = await C.index({ pod: v.pod, root: v.st.prefs.indexRoot, update, progressId }); } finally { clearInterval(tick); }
        const b = r.body || {};
        setCat({ indexing: null });
        if (!r.ok) { say(false, b.error || 'The catalog could not be walked.'); return; }
        await indexInfo();
        say(!b.errors || !b.errors.length, b.stopped ? 'Stopped: the index was left as it was.' : (update ? 'Index updated: ' + b.added + ' new, ' + b.changed + ' changed, ' + b.removed + ' gone' : 'Indexed ' + b.items + ' items in ' + b.folders + ' folders')
          + (b.capped ? ' (stopped at the folder limit — Settings)' : '') + (b.errors && b.errors.length ? ' · ' + b.errors.length + ' folders could not be read' : '') + '.');
        if (v.cat.q && v.cat.q.trim().length >= 2) { const s = await C.search(v.pod, v.cat.q); setCat({ found: s.ok ? s.body.items : [] }); }
        return;
      }
      if (op === 'indexStop') { if (v.cat.indexing) await C.cancel(v.cat.indexing.id); return; }
      if (op === 'open') {
        const type = String(value || '');
        if (type === 'Folder') { v.tab = 'catalog'; await go(k, false); return; }
        if (type === 'DataModel') { await bipChain.showDm(v, k); return; }
        if (type === 'Report' || /\.xdo$/i.test(k)) { await openReport(k); return; }
        say(null, 'Only reports run here.');
        return;
      }
      if (op === 'fav') {
        const items = (v.cat.found || v.cat.items || []).filter((x) => x.absolutePath === k)[0];
        const name = items ? items.displayName : (v.rep && v.rep.path === k ? v.rep.name : k.split('/').pop().replace(/\.xdo$/i, ''));
        const r = await C.toggleFavorite({ pod: v.pod, path: k, name, type: String(value || 'Report') });
        if (r.ok) { setCat({ favorites: r.body.favorites }); say(true, r.body.favorite ? 'Added to the favourites.' : 'Taken off the favourites.'); }
        return;
      }

      // ── a report ──
      if (op === 'defRefresh' && v.rep) { const values = readForm(copy(v.rep)); await openReport(v.rep.path, values, { refresh: true, keepResult: true }); return; }
      // a date changed: the plan of the buckets follows (the form's values kept)
      if (op === 'pchange' && v.rep) { if (v.rep.bucket && v.rep.bucket.by !== 'none') setRep({ values: readForm(copy(v.rep)) }); return; }
      if (op === 'format' && v.rep) { setRep({ format: String(input || 'csv'), values: readForm(copy(v.rep)) }); return; }
      if (op === 'bField' && v.rep) {
        const b = copy(v.rep.bucket);
        const key = String(value || '');
        if (key === 'by') b.by = String(input || 'none');
        if (key === 'n') b.n = Math.max(1, Math.min(366, Math.round(Number(input)) || 1));
        if (key === 'pair') b.pair = String(input || '');
        setRep({ bucket: b, values: readForm(copy(v.rep)) });
        return;
      }
      if (op === 'run' && v.rep && v.rep.def && !v.running) {
        const rep = copy(v.rep);
        const values = readForm(rep);
        setRep({ values });
        const params = rep.def.parameters;
        const missing = E.missing(params, values);
        if (missing.length) { say(false, 'Give ' + missing.join(', ') + ' first.'); return; }
        let plan = [];
        if (rep.bucket.by !== 'none') {
          const pr = String(rep.bucket.pair || '').split('|');
          if (pr.length !== 2) { say(false, 'Choose the two dates the buckets cut between.'); return; }
          if (!E.isData(rep.format)) { say(false, 'Buckets join rows: choose CSV or XML output.'); return; }
          plan = E.plan({ params, dateBucket: { fromParam: pr[0], toParam: pr[1], by: rep.bucket.by, n: rep.bucket.by === 'days' ? rep.bucket.n : 1, from: values[pr[0]], to: values[pr[1]] } });
          if (!plan.length) { say(false, 'Give both dates: the range is cut between them.'); return; }
        }
        const progressId = pid();
        const t0 = Date.now();
        v.running = { id: progressId, label: plan.length > 1 ? 'Bucket 1 of ' + plan.length : 'Fusion is running the report…', secs: 0 };
        const tick = setInterval(async () => {
          const pr = await C.progress(progressId);
          const last = pr.ok && pr.body.last;
          if (v.running) v.running = { id: progressId, label: last ? last.label : v.running.label, secs: Math.round((Date.now() - t0) / 1000) };
        }, 800);
        let r;
        try {
          r = await C.run({ pod: v.pod, path: rep.path, name: rep.name, values, params: E.encode(params, values), plan, format: rep.format, template: rep.template, progressId });
        } finally { clearInterval(tick); v.running = null; }
        const b = r.body || {};
        if (b.run) { showResult(b); await loadRuns(); }
        if (!b.run) say(false, b.error || 'The report did not run.');
        else say(b.run.status === 'DONE' ? true : b.run.status === 'FAILED' ? false : null, b.run.status === 'DONE' ? (b.run.rows != null ? b.run.rows.toLocaleString() + ' rows' : 'The ' + b.run.format.toUpperCase() + ' is ready') + ' in ' + E.fmtMs(b.run.ms) + '.'
          : b.run.status === 'FAILED' ? 'The report failed: ' + String(b.error || '').split('\n')[0] : 'Some buckets failed: the rest are shown.');
        return;
      }
      if (op === 'stop') { if (v.running) await C.cancel(v.running.id); return; }
      if (v.res && (op === 'gSearch' || op === 'gSort' || op === 'gPage')) {
        const w = copy(v.view);
        if (op === 'gSearch') { w.q = String(input || ''); w.page = 0; }
        if (op === 'gSort') { w.sortDir = w.sortCol === value ? -w.sortDir : 1; w.sortCol = String(value); }
        if (op === 'gPage') w.page = Math.max(0, (Number(w.page) || 0) + Number(value || 0));
        v.view = w;
        v.grid = K.view(v.res, w);
        return;
      }
      if (op === 'export' && v.res && v.res.rows.length) {
        const res = copy(v.res);
        const out = await exportKit.run(String(value || 'xlsx'), { name: String(res.run.name).replace(/[^\w-]+/g, '-').toLowerCase(), title: res.run.name + ' · ' + res.run.pod, subtitle: res.run.path,
          columns: res.columns.map((c) => ({ key: c, label: c, type: res.kinds.num[c] ? 'number' : 'text' })), rows: K.sort(K.filter(res.rows, res.columns, v.view.q), v.view.sortCol, v.view.sortDir) });
        say(out.ok ? null : false, out.message);
        return;
      }
      if (op === 'download') { download(k); return; }
      if (op === 'openFile' || op === 'openFolder') {
        const r = await C.openRun(k, op === 'openFolder');
        if (!r.ok) say(false, r.body.error || 'It could not be opened.');
        return;
      }
      if (op === 'dm' && v.rep && v.rep.def) { await bipChain.showDm(v, v.rep.def.dataModelUrl); return; }
      if (op === 'dmClose') { v.dm = null; return; }
      if ((op === 'dmCopy' || op === 'dmFusion') && v.dm && v.dm.ok) {
        const ds = copy(v.dm.dataSets[Number(k)]);
        if (!ds) return;
        if (op === 'dmCopy') { try { await navigator.clipboard.writeText(ds.sql); say(true, 'Copied the SQL of ' + ds.name + '.'); } catch (e) { say(false, 'It could not be copied here.'); } return; }
        v.dm = null;
        bus.focus('fusion-sql', { sql: ds.sql, title: ds.name });
        return;
      }

      // ── the dashboard ──
      if (op === 'addCard' && v.rep && v.rep.def) {
        const rep = copy(v.rep);
        const values = readForm(rep);
        setRep({ values });
        const pr = String(rep.bucket.pair || '').split('|');
        const label = (n) => ((rep.def.parameters.filter((p) => p.name === n)[0] || {}).label || n);
        v.cardDlg = { name: rep.name, mode: 'count', column: '', pair: pr.length === 2 ? rep.bucket.pair : '', pairLabel: pr.length === 2 ? label(pr[0]) + ' → ' + label(pr[1]) : '', rolling: pr.length === 2, days: 30 };
        return;
      }
      if (op === 'cardCancel') { v.cardDlg = null; return; }
      if (op === 'cardField' && v.cardDlg) {
        const d = copy(v.cardDlg);
        const key = String(value || '');
        if (key === 'rolling') d.rolling = !!input;
        else if (key === 'days') d.days = Math.max(0, Math.round(Number(input)) || 0);
        else if (['name', 'mode', 'column'].indexOf(key) !== -1) d[key] = String(input || '');
        v.cardDlg = d;
        return;
      }
      if (op === 'cardSave' && v.cardDlg && v.rep) {
        const d = copy(v.cardDlg), rep = copy(v.rep);
        const params = rep.def.parameters;
        const pr = String(d.pair || '').split('|');
        const fmt = (n) => ((params.filter((p) => p.name === n)[0] || {}).dateFormatString || '');
        const r = await C.saveCard({ pod: v.pod, path: rep.path, name: d.name, format: E.dataFormat(rep.def), values: rep.values, params: E.encode(params, rep.values),
          measure: { mode: d.mode, column: d.column.trim() }, rolling: d.rolling && pr.length === 2 ? { from: pr[0], to: pr[1], days: d.days, fmtFrom: fmt(pr[0]), fmtTo: fmt(pr[1]) } : null });
        if (!r.ok) { say(false, r.body.error || 'The card could not be added.'); return; }
        v.cardDlg = null;
        await loadCards();
        say(true, 'Added "' + r.body.card.name + '" to the dashboard.');
        return;
      }
      if (op === 'cardRun' || op === 'cardRunAll') {
        const ids = op === 'cardRun' ? [k] : v.cards.map((c) => c.id);
        for (const cid of ids) {
          v.cardBusy = Object.assign({}, copy(v.cardBusy), { [cid]: true });
          const r = await C.runCard(v.pod, cid);
          const busy = copy(v.cardBusy);
          delete busy[cid];
          v.cardBusy = busy;
          if (r.ok && r.body.card) v.cards = copy(v.cards).map((c) => (c.id === cid ? r.body.card : c));
          else say(false, (r.body && r.body.error) || 'The card did not run.');
        }
        await loadRuns();
        return;
      }
      if (op === 'cardOpen') { const c = copy(v.cards.filter((x) => x.id === k)[0]); if (c) await openReport(c.path, c.values, { format: c.format }); return; }
      if (op === 'cardRemove') {
        const c = v.cards.filter((x) => x.id === k)[0];
        if (!c || !window.confirm('Remove the card "' + c.name + '" from the dashboard?')) return;
        await C.removeCard(k);
        await loadCards();
        return;
      }

      // ── history ──
      if (op === 'hFilter') { v.hFilter = String(input || ''); return; }
      if (op === 'hOpen' || op === 'hAgain') {
        const r = await C.runRows(k, 0, 50000);
        if (!r.ok) { say(false, r.body.error || 'That run could not be read.'); return; }
        const run = r.body.run;
        await openReport(run.path, run.values, { format: run.format });
        if (op === 'hOpen') showResult({ run, columns: r.body.columns, rows: r.body.rows, sent: r.body.rows.length });
        return;
      }
      if (op === 'hRemove') {
        const h = v.runs.filter((x) => x.id === k)[0];
        if (!h || !window.confirm('Delete the run of "' + h.name + '" and its files from this PC?')) return;
        await C.removeRun(k);
        if (v.res && v.res.run.id === k) v.res = null;
        await loadRuns();
        return;
      }

      // ── settings ──
      if (op === 'pField') { v.prefs = Object.assign({}, copy(v.prefs), { [String(value)]: String(input || '') }); return; }
      if (op === 'pSave') {
        const r = await C.savePrefs(copy(v.prefs));
        if (!r.ok) { say(false, r.body.error || 'Could not save them.'); return; }
        v.st = Object.assign({}, copy(v.st), { prefs: r.body.prefs });
        v.prefs = Object.assign({}, r.body.prefs);
        say(true, 'Saved.');
      }
    }

    /** The data model of a report: its data sets' SQL. */
    static async showDm(v, p) {
      v.dm = { path: p, busy: true };
      const r = await C.dataModel(v.pod, p);
      const b = r.body || {};
      v.dm = r.ok ? Object.assign({ busy: false }, b) : { path: p, busy: false, ok: false, error: b.error || 'It could not be read.' };
    }
    /** A report handed by another screen (bus.focus('bip', { path, pod, values })). */
    static async takeFocus(v, openReport) {
      const f = typeof bus.takeFocus === 'function' ? bus.takeFocus('bip') : null;
      if (!f || !f.path) return;
      if (f.pod && v.st.pods.some((p) => p.id === f.pod)) v.pod = f.pod;
      await openReport(String(f.path), f.values || null);
    }
  }
  return bipChain;
});
