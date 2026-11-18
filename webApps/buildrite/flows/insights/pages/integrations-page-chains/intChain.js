define(['vb/action/actionChain', 'resources/js/pagesClient', 'resources/js/shellBus', 'resources/js/integrationDiagram', 'resources/js/integrationReport', 'resources/js/exportKit'],
  (ActionChain, PC, bus, D, R, exportKit) => {
    'use strict';

    // Integrations: scan the app (load | rescan | app (key)), the tabs (tab), the data sheet's filters (field q / fSystem /
    // fFlow, dir (key), more), the diagrams (dia (key), field diaSystem / diaPage, showSystem (key), showPage (key),
    // svg), the exports (pdf, excel, print); open a page's sheet (openPage (key)).
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
        if (act === 'load') { await scan(''); return; }
        if (act === 'rescan') { if (await scan('')) say({ ok: true }, 'Scanned: ' + v.m.totals.systems + ' systems, ' + v.m.totals.endpoints + ' endpoints, ' + v.m.totals.calls + ' calls.'); return; }
        if (act === 'tab') { v.tab = String(key || 'overview'); return; }
        if (act === 'field') {
          const val = String(value == null ? '' : value);
          if (key === 'app') { await scan(val); return; }
          if (['q', 'fSystem', 'fFlow', 'diaSystem', 'diaPage'].indexOf(key) !== -1) { v[key] = val; if (key !== 'diaSystem' && key !== 'diaPage') v.limit = 200; }
          return;
        }
        if (act === 'dir') { v.fDir = String(key || 'all'); v.limit = 200; return; }
        if (act === 'more') { v.limit = (v.limit || 200) + 300; return; }
        // a system's or a page's diagram (from the systems, the data sheet, the overview)
        if (act === 'dia') { v.dia = String(key || 'landscape'); return; }
        if (act === 'showSystem') { v.dia = 'system'; v.diaSystem = String(key || ''); v.tab = 'diagrams'; return; }
        if (act === 'showPage') { v.dia = 'page'; v.diaPage = String(key || ''); v.tab = 'diagrams'; return; }
        if (act === 'sheetFor') { v.fSystem = String(key || ''); v.fDir = 'all'; v.q = ''; v.limit = 200; v.tab = 'sheet'; return; }
        if (act === 'openPage') { if (key) bus.focus('app-pages', { id: String(key) }); return; }
        if (!v.m || !v.m.ok) return;
        if (act === 'svg') {
          const d = v.dia === 'system' ? D.system(v.m, v.diaSystem || v.m.systems[0].id) : v.dia === 'page' ? D.page(v.m, v.diaPage || ((v.m.pages.filter((p) => p.calls)[0] || {}).id)) : D.landscape(v.m);
          const name = 'integrations-' + v.m.app + '-' + (v.dia === 'landscape' ? 'landscape' : String(d.title || v.dia).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')) + '.svg';
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
          const html = R.html(v.m, { by: v.m.by || '', pages: v.dia === 'page' && v.diaPage ? [v.diaPage] : [] });
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
