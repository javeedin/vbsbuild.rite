define(['vb/action/actionChain', 'resources/js/pagesClient', 'resources/js/shellBus', 'resources/js/integrationDiagram', 'resources/js/integrationReport', 'resources/js/exportKit', 'resources/js/flowModel'],
  (ActionChain, PC, bus, D, R, exportKit, FM) => {
    'use strict';

    // Integrations: scan the app (load | rescan | app (key)), the tabs (tab), the data sheet's filters (field q / fSystem /
    // fFlow, dir (key), more, clearObject), between systems (field sq / sSystem, sheetIf (an interface's id): its rows in
    // the data sheet), the diagrams (dia (key), field diaSystem / diaPage, showSystem (key), showPage (key), svg (key: a
    // diagram, else the one shown)), the exports (pdf, excel, print); open a page's sheet (openPage (key)).
    class intChain extends ActionChain {
      async run(context, { act, key, value }) {
        const v = context.$page.variables;
        const say = (r, text) => { v.result = r.ok ? (text ? { ok: true, text } : null) : { ok: false, text: (r.body && r.body.error) || 'It did not work.' }; if (text || !r.ok) bus.toast(r.ok ? text : v.result.text, r.ok ? 'success' : 'error'); };
        const scan = async (app) => {
          v.busy = true;
          try {
            const r = await PC.integrations(app || (v.m && v.m.app) || '');
            const b = r.body || {};
            if (r.ok && b.ok) { v.m = b; v.result = null; if (!b.systems.some((s) => s.id === v.diaSystem)) v.diaSystem = ''; if (!b.pages.some((p) => p.id === v.diaPage)) v.diaPage = ''; }
            else { v.m = null; v.result = { ok: false, text: b.error || 'The app could not be scanned.' }; }
            return r.ok && b.ok;
          } finally { v.busy = false; }
        };
        // saved flows: the list (Saved flows), read again when one is saved or removed in any tab
        const loadFlows = async () => {
          const r = await PC.flowsList('');
          const b = r.body || {};
          v.flows = r.ok && b.ok ? b.flows || [] : [];
          v.flowsErr = r.ok && b.ok ? '' : (b.error || 'The saved flows could not be read.');
        };
        const flowsChanged = () => { try { bus.emit('saved-flows-changed', { at: Date.now() }); } catch (e) { /* no listeners */ } };
        const openFlow = (f) => bus.open({ record: 'saved-flow', params: { flowId: f.id, title: f.id + ' · ' + f.name } });
        if (act === 'flowsLoad') { await loadFlows(); return; }
        if (act === 'load') { await scan(''); await loadFlows(); return; }
        if (act === 'rescan') { if (await scan('')) say({ ok: true }, 'Scanned: ' + v.m.totals.systems + ' systems, ' + v.m.totals.endpoints + ' endpoints, ' + v.m.totals.calls + ' calls.'); return; }
        if (act === 'tab') { v.tab = String(key || 'overview'); return; }
        if (act === 'field') {
          const val = String(value == null ? '' : value);
          if (key === 'app') { await scan(val); return; }
          // Save as flow: its fields (sf.name, sf.purpose …)
          if (String(key).indexOf('sf.') === 0) { const f = String(key).slice(3); v.saveForm = Object.assign({}, v.saveForm || {}, { [f]: val }); if (f === 'name' && val.trim()) v.saveErr = ''; return; }
          if (key === 'flowsQ') { v.flowsQ = val; return; }
          // a page chosen, or a search that leaves the page shown out: the first page it finds
          if (key === 'pgId') { v.pgId = val; if (v.pgView === 'all') v.pgView = 'flow'; return; }
          if (key === 'pgQ') {
            v.pgQ = val;
            const w = val.toLowerCase().split(/\s+/).filter(Boolean);
            const hits = ((v.m && v.m.pageFlows) || []).filter((p) => { const hay = [p.pageLabel, p.page, p.flow, p.steps.map((st) => st.trigger + ' ' + st.chain).join(' ')].join(' ').toLowerCase(); return w.every((x) => hay.indexOf(x) !== -1); });
            if (hits.length && !hits.some((p) => p.page === v.pgId)) v.pgId = hits[0].page;
            return;
          }
          if (['q', 'fSystem', 'fFlow', 'diaSystem', 'diaPage', 'sq', 'sSystem', 'sfSystem'].indexOf(key) !== -1) { v[key] = val; if (['q', 'fSystem', 'fFlow'].indexOf(key) !== -1) v.limit = 200; }
          return;
        }
        if (act === 'dir') { v.fDir = String(key || 'all'); v.limit = 200; return; }
        // System flows: the summary or the detailed flow; the cross-system flows as steps or as a diagram
        if (act === 'sfView') { v.sfView = key === 'detailed' ? 'detailed' : 'summary'; return; }
        if (act === 'jView') { v.jView = key === 'diagram' ? 'diagram' : 'steps'; return; }
        // Page flows: a page's integration flow (pgOpen (key)), one page or all pages, the previous / next page
        if (act === 'pgOpen') { v.pgId = String(key || ''); if (v.pgView === 'all') v.pgView = 'flow'; v.tab = 'pages'; return; }
        if (act === 'pgView') { v.pgView = ['all', 'one'].indexOf(key) !== -1 ? key : 'flow'; return; }
        if (act === 'pgStep') {
          const list = ((v.m && v.m.pageFlows) || []).map((p) => p.page);
          if (!list.length) return;
          const at = Math.max(0, list.indexOf(v.pgId || list[0]));
          v.pgId = list[(at + (Number(key) || 1) + list.length) % list.length];
          if (v.pgView === 'all') v.pgView = 'flow';
          return;
        }
        if (act === 'pdfPages') { v.pdfPages = !v.pdfPages; return; }
        if (act === 'plain') { v.plain = !v.plain; return; }
        // Save as flow: the page shown (or an empty flow) under a name and its details, then opened to edit
        if (act === 'saveOpen') {
          const blank = key === 'blank';
          const pg = ((v.m && v.m.pageFlows) || []).filter((p) => p.page === (v.pgId || ((v.m.pageFlows || [])[0] || {}).page))[0];
          if (!blank && !pg) { bus.toast('Pick a page with integrations first.', 'info'); return; }
          v.saveForm = { mode: blank ? 'blank' : 'page', page: pg ? pg.page : '', name: blank ? '' : pg.pageLabel + ' flow', purpose: '', area: blank ? '' : pg.flow, owner: (v.m && v.m.by) || '', status: 'draft', story: '', tags: '' };
          v.saveErr = '';
          v.saveDlg = true;
          return;
        }
        if (act === 'saveCancel') { v.saveDlg = false; return; }
        if (act === 'saveFlow') {
          const f0 = v.saveForm || {};
          if (!String(f0.name || '').trim()) { v.saveErr = 'Give the flow a name.'; return; }
          const flow = f0.mode === 'blank' ? FM.blank(f0) : FM.fromPage(v.m, f0.page, f0);
          if (!flow) { v.saveErr = 'That page makes no call now — scan again.'; return; }
          v.saveBusy = true;
          try {
            const r = await PC.flowSave(flow, f0.mode === 'blank' ? 'drawn by hand' : 'saved from Page flows');
            const b = r.body || {};
            if (!r.ok || !b.ok) { v.saveErr = b.error || 'It could not be saved.'; return; }
            v.saveDlg = false;
            await loadFlows();
            flowsChanged();
            bus.toast('Saved ' + b.flow.id + ' · ' + b.flow.name + '. Edit it, comment on it, check it against the app.', 'success');
            openFlow(b.flow);
          } finally { v.saveBusy = false; }
          return;
        }
        // Saved flows: open, copy, remove; check every one against the app now
        if (act === 'flowStatus') { v.flowsStatus = String(key || 'all'); return; }
        if (act === 'flowOpen') { const f = (v.flows || []).filter((x) => x.id === key)[0]; if (f) openFlow(f); return; }
        if (act === 'flowCopy') {
          const g = await PC.flowGet(key);
          const f = g.body && g.body.flow;
          if (!f) { bus.toast('It could not be read.', 'error'); return; }
          const r = await PC.flowSave(Object.assign({}, f, { name: 'Copy of ' + f.name, status: 'draft' }), 'a copy of ' + f.id, true);
          if (r.ok && r.body && r.body.ok) { await loadFlows(); flowsChanged(); bus.toast('Copied to ' + r.body.flow.id + '.', 'success'); openFlow(r.body.flow); } else bus.toast((r.body && r.body.error) || 'It could not be copied.', 'error');
          return;
        }
        if (act === 'flowDelete') {
          const f = (v.flows || []).filter((x) => x.id === key)[0];
          if (!f || !window.confirm('Remove ' + f.id + ' · ' + f.name + '? Its versions and comments go too.')) return;
          const r = await PC.flowRemove(key);
          if (r.ok && r.body && r.body.ok) { await loadFlows(); flowsChanged(); try { bus.close('saved-flow:' + key); } catch (e) { /* not open */ } bus.toast('Removed ' + key + '.', 'success'); } else bus.toast((r.body && r.body.error) || 'It could not be removed.', 'error');
          return;
        }
        if (act === 'flowsCheck') {
          if (!v.m || !v.m.ok) return;
          const out = {};
          (v.flows || []).forEach((f) => { out[f.id] = FM.check(f, v.m); });
          v.flowChecks = out;
          const bad = Object.keys(out).filter((k) => !out[k].ok && !out[k].skipped).length;
          bus.toast(bad ? bad + ' of ' + Object.keys(out).length + ' flows no longer match the app.' : 'Every saved flow matches the app.', bad ? 'info' : 'success');
          return;
        }
        if (act === 'more') { v.limit = (v.limit || 200) + 300; return; }
        // a system's or a page's diagram (from the systems, the data sheet, the overview)
        if (act === 'dia') { v.dia = String(key || 'landscape'); return; }
        if (act === 'showSystem') { v.dia = 'system'; v.diaSystem = String(key || ''); v.tab = 'diagrams'; return; }
        // a page's diagram: its integration flow on Page flows
        if (act === 'showPage') { v.pgId = String(key || ''); if (v.pgView === 'all') v.pgView = 'flow'; v.tab = 'pages'; v.diaPage = String(key || ''); return; }
        if (act === 'sheetFor') { v.fSystem = String(key || ''); v.fDir = 'all'; v.q = ''; v.fObject = ''; v.fObjectLabel = ''; v.limit = 200; v.tab = 'sheet'; return; }
        // an interface: the data-sheet rows behind it (its system, its business object)
        if (act === 'sheetIf') {
          const x = ((v.m && v.m.interfaces) || []).filter((y) => y.id === key)[0];
          if (x) { v.fSystem = x.system; v.fObject = x.objectKey; v.fObjectLabel = x.id + ' · ' + x.object; v.fDir = 'all'; v.fFlow = ''; v.q = ''; v.limit = 200; v.tab = 'sheet'; }
          return;
        }
        if (act === 'clearObject') { v.fObject = ''; v.fObjectLabel = ''; v.limit = 200; return; }
        if (act === 'openPage') { if (key) bus.focus('app-pages', { id: String(key) }); return; }
        if (!v.m || !v.m.ok) return;
        if (act === 'svg') {
          // key: a diagram (landscape, systems, journeys, system, page; system:<id> = that system), else the one in Diagrams
          const kind = String(key || v.dia).split(':')[0];
          const one = String(key || '').split(':')[1] || '';
          const d = kind === 'system' ? D.system(v.m, one || v.diaSystem || v.m.systems[0].id) : kind === 'page' ? D.page(v.m, one || v.diaPage || ((v.m.pages.filter((p) => p.calls)[0] || {}).id))
            : kind === 'pageflow' || kind === 'pageflow-plain' ? D.pageFlow(v.m, one || v.diaPage || ((v.m.pageFlows || [])[0] || {}).page, { plain: kind === 'pageflow-plain' })
              : kind === 'systems' ? D.systemFlow(v.m) : kind === 'journeys' ? D.journeys(v.m) : kind === 'pages' ? D.pages(v.m) : D.landscape(v.m);
          const name = 'integrations-' + v.m.app + '-' + (kind === 'landscape' ? 'landscape' : String(d.title || kind).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')) + '.svg';
          exportKit.download(name, 'image/svg+xml', d.svg);
          say({ ok: true }, 'Saved ' + name + '.');
          return;
        }
        if (act === 'excel') {
          const name = R.fileName(v.m, 'xlsx');
          exportKit.download(name, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', exportKit.xlsxBook(R.sheets(v.m)));
          say({ ok: true }, 'Saved ' + name + ': ' + v.m.totals.systems + ' systems, ' + v.m.totals.calls + ' integrations, ' + v.m.totals.endpoints + ' endpoints.');
          return;
        }
        if (act === 'pdf' || act === 'print') {
          // the report: cover, landscape, systems, the data sheet, endpoints, flows × systems, each system's diagram, and the
          // page diagram on screen when there is one
          // with every page's integration flow (Page by page) unless switched off; else the page shown in Diagrams
          const html = R.html(v.m, { by: v.m.by || '', pages: v.pdfPages !== false ? 'all' : (v.dia === 'page' && v.diaPage ? [v.diaPage] : []) });
          if (act === 'print') { exportKit.printDocument(html); return; }
          if (v.pdfBusy) return;
          v.pdfBusy = true;
          try {
            const r = await PC.integrationsPdf(html, R.fileName(v.m, 'pdf'));
            const b = r.body || {};
            if (r.ok && b.base64) {
              const bin = atob(b.base64);
              const bytes = new Uint8Array(bin.length);
              for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
              const name = R.fileName(v.m, 'pdf');
              exportKit.download(name, 'application/pdf', bytes);
              say({ ok: true }, 'Saved ' + name + ' (' + Math.max(1, Math.round(bytes.length / 1024)) + ' KB).');
            } else if (b.noPdf) { exportKit.printDocument(html); bus.toast('Choose "Save as PDF" in the print dialog.', 'info'); } else say(r);
          } finally { v.pdfBusy = false; }
        }
      }
    }
    return intChain;
  });
