define(['vb/action/actionChain', 'resources/js/scenarioClient', 'resources/js/pagesClient', 'resources/js/shellBus', 'resources/js/scenarioReport', 'resources/js/exportKit'], (ActionChain, SC, PC, bus, Report, exportKit) => {
  'use strict';

  // API Scenarios. The screen opens on the list of every scenario; + New scenario (or a row) opens one scenario in a tab of
  // its own: its header (ID, name, the page it tests, type, status, made / tested by), then three tabs — Main scenario (the
  // page's own APIs: drafted from its code, run), Flow (the pages it leads to, opened once the main page's APIs have all
  // run) and Runs.
  // list: load | list | listField (key, value) | newSc (key = page) | openSc (key) | runSc (key) | deleteCard (key) | where
  // one scenario: setPage (key) | scTab (key) | draft | save | saveRun | saveRunWrites | runFlow | delete | gateSkip
  //   | toggleApis | showRun (key) | field (key, value) | stepField (step, key, value) | pick | tryStep | choice | addStep
  //   | up | down | removeStep | toggleWrites | toggleShape | apiOpen | apiVals | apiTry | apiAdd | suggest | applySuggest
  //   | closeSuggest | addMissing | extend (key) | flowPath (key) | flowLoad | jApis | jClose | jTab | jGo | jAdd
  //   | jUnlink | jRelink
  const copy = (o) => JSON.parse(JSON.stringify(o || null));
  const pairs = (text, sep) => String(text || '').split('\n').map((l) => l.trim()).filter(Boolean).map((l) => { const i = l.indexOf(sep); return i === -1 ? [l.trim(), ''] : [l.slice(0, i).trim(), l.slice(i + sep.length).trim()]; }).filter((p) => p[0]);
  class scChain extends ActionChain {
    async run(context, { act, key, value, step }) {
      const v = context.$page.variables;
      const say = (r, text) => { v.result = r.ok ? (text ? { ok: true, text } : null) : { ok: false, text: (r.body && r.body.error) || 'It did not work.' }; if (text || !r.ok) bus.toast(r.ok ? text : v.result.text, r.ok ? 'success' : 'error'); };
      const newId = () => 'u' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36);
      const labelOf = (pid) => ((v.pages || []).filter((p) => p.id === pid)[0] || {}).label || String(pid || '').split('/').pop();
      const changed = () => { try { bus.emit('api-scenarios-changed', { at: Date.now() }); } catch (e) { /* no listeners */ } };
      const tabId = () => 'api-scenario:' + v.scId;
      const retitle = () => { if (v.scId && v.sc && v.sc.id) { try { bus.rename(tabId(), (v.sc.code ? v.sc.code + ' · ' : '') + (v.sc.name || 'Scenario')); } catch (e) { /* no shell */ } } };

      // ── the list of every scenario ──
      const loadList = async () => { const l = await SC.list(''); if (l.ok) v.allSc = l.body.scenarios || []; else say(l); };
      // the page your app's window is on (it follows you back from that window)
      const where = async () => { const r = await SC.where(); v.appAt = r.ok && r.body && r.body.open ? { open: true, url: r.body.url || '', page: r.body.page || '', label: r.body.label || '' } : null; };

      // ── one scenario: its page's code (the APIs, the facts), its flow, its runs ──
      const loadApis = async (id) => { const r = await SC.apis(id || v.page); if ((id || v.page) !== v.page) return; if (r.ok) { v.apis = r.body.apis || []; v.apiChoices = r.body.choices || []; v.apiInfo = { overview: r.body.overview || null, twins: r.body.twins || [] }; } else say(r); };
      const loadFlow = async (id) => {
        if (!id) { v.flow = null; return; }
        const r = await SC.flow(id);
        if (id !== v.page) return;
        v.flow = r.ok ? r.body : { error: (r.body && r.body.error) || 'The flow could not be read.', nodes: [] };
      };
      const loadRuns = async () => { if (!v.sc || !v.sc.page) { v.runs = []; return; } const rs = await SC.runs(v.sc.page); v.runs = rs.ok ? (rs.body.runs || []).filter((x) => v.sc && x.scenario === v.sc.id) : []; };
      const nextFor = async () => { if (!v.sc || !v.sc.page) { v.nextPages = []; return; } const j = v.sc.journey || []; const last = j.length ? j[j.length - 1].page : v.sc.page; const r = await SC.next(last); if (r.ok) v.nextPages = r.body.next || []; };
      const loadContext = async () => {
        v.page = (v.sc && v.sc.page) || '';
        v.apis = []; v.apiInfo = null; v.apiTries = {}; v.apiVals = {}; v.apiOpen = ''; v.facts = null;
        if (!v.page) { v.flow = null; v.runs = []; v.nextPages = []; return; }
        if (v.showApis) loadApis(v.page);
        const [sh] = await Promise.all([PC.sheet(context.$application.path, v.page), loadFlow(v.page), loadRuns(), nextFor()]);
        const s = sh && sh.body ? (sh.body.sheet || sh.body) : null;
        v.facts = s && s.facts ? s.facts : null;
      };
      const blankSc = (page) => ({ page: page || '', name: 'New scenario', kind: 'happy', notes: '', allowWrites: false, data: [], steps: [], choices: [], journey: page ? [{ page, label: labelOf(page) }] : [] });
      const openScenario = async (id) => {
        v.run = null; v.tries = {}; v.suggestion = null; v.result = null; v.flowForce = false; v.scTab = 'main';
        if (/^new/.test(String(id))) { v.sc = blankSc(v.page || ''); await loadContext(); return; }
        const r = await SC.get(id);
        if (!r.ok) { say(r); v.sc = null; return; }
        v.sc = copy(r.body.scenario);
        await loadContext();
        if (v.runs.length) { const rr = await SC.runOf(v.sc.page, v.runs[0].id); if (rr.ok) v.run = rr.body.run; }
        retitle();
      };
      const steps = () => (v.sc && v.sc.steps) || [];
      const setSteps = (list) => { v.sc = Object.assign({}, v.sc, { steps: list }); };
      const afterChange = async () => { await Promise.all([loadRuns(), loadFlow(v.page)]); retitle(); changed(); };
      const save = async () => {
        if (!v.sc) return { ok: false, body: { error: 'No scenario.' } };
        if (!v.sc.page) return { ok: false, body: { error: 'Pick the page this scenario tests first (Page, in the header).' } };
        const r = await SC.save(v.sc);
        if (r.ok) { v.sc = copy(r.body.scenario); await afterChange(); }
        return r;
      };
      const doRun = async (id, writes, scope) => {
        v.busy = true;
        try {
          const r = await SC.run(id, writes, scope);
          const what = scope === 'main' ? 'The main page' : 'The whole flow';
          if (r.ok && r.body.run.ok) { v.run = r.body.run; say({ ok: true }, what + ' passed: ' + r.body.run.passed + ' check(s) ok.'); }
          else if (r.ok) { v.run = r.body.run; say({ ok: false, body: { error: what + ' failed: ' + r.body.run.failed + ' step(s) failed — see each step\'s checks below.' } }); }
          else say(r);
          await afterChange();
        } finally { v.busy = false; }
      };

      if (act === 'where') { await where(); return; }
      if (act === 'load') {
        v.flowOpen = true;
        const c = await PC.catalog(context.$application.path);
        v.pages = c && c.ok && c.body ? (c.body.pages || []) : [];
        if (v.scId) { await openScenario(v.scId); return; }
        // the list: opened on one page's scenarios (Application pages → API, a flow page's own tab)
        await where();
        const handed = !v.page && typeof bus.takeFocus === 'function' ? bus.takeFocus('api-scenarios') : null;
        if (handed && handed.page) v.listPage = handed.page;
        else if (v.page) v.listPage = v.page;
        await loadList();
        return;
      }
      if (act === 'list') { if (!v.scId) await loadList(); return; }
      // opened on one page's scenarios by another screen (Application pages → API): only the list takes it
      if (act === 'focus') {
        if (v.scId) return;
        const handed = typeof bus.takeFocus === 'function' ? bus.takeFocus('api-scenarios') : null;
        if (handed && handed.page) v.listPage = handed.page;
        await loadList();
        return;
      }
      if (act === 'listField') { if (key === 'q') v.listQ = String(value || ''); return; }
      if (act === 'listStatus') { v.listStatus = String(key || 'all'); return; }
      if (act === 'listPageClear') { v.listPage = ''; return; }
      if (act === 'listPage') { v.listPage = String(key || ''); return; }
      if (act === 'newSc') {
        const page = String(key || v.listPage || '');
        bus.open({ record: 'api-scenario', params: { scId: 'new-' + Date.now().toString(36), page, title: 'New scenario' } });
        return;
      }
      if (act === 'openSc') {
        const s0 = (v.allSc || []).filter((x) => x.id === key)[0];
        bus.open({ record: 'api-scenario', params: { scId: key, page: s0 ? s0.page : '', title: s0 ? (s0.code ? s0.code + ' · ' : '') + s0.name : 'Scenario' } });
        return;
      }
      if (act === 'runSc') {
        if (v.busy) return;
        v.busy = true;
        try {
          const s0 = (v.allSc || []).filter((x) => x.id === key)[0];
          const r = await SC.run(key, false, '');
          if (r.ok) say({ ok: r.body.run.ok, body: { error: (s0 ? s0.name + ': ' : '') + r.body.run.failed + ' step(s) failed.' } }, (s0 ? s0.name + ': ' : '') + 'passed, ' + r.body.run.passed + ' check(s) ok.');
          else say(r);
          await loadList();
          changed();
        } finally { v.busy = false; }
        return;
      }
      if (act === 'deleteCard') {
        const s0 = (v.allSc || []).filter((x) => x.id === key)[0];
        if (!s0) return;
        if (typeof window !== 'undefined' && window.confirm && !window.confirm('Delete the scenario ' + (s0.code ? s0.code + ' ' : '') + '"' + s0.name + '"? (Its runs stay.)')) return;
        const r = await SC.remove(key);
        if (r.ok) { await loadList(); changed(); try { bus.close('api-scenario:' + key); } catch (e) { /* not open */ } }
        say(r, 'Deleted "' + s0.name + '".');
        return;
      }

      // ── one scenario ──
      if (act === 'scTab') { v.scTab = ['main', 'flow', 'runs'].indexOf(key) !== -1 ? key : 'main'; if (v.scTab === 'flow' && !v.flow && v.page) await loadFlow(v.page); return; }
      if (act === 'gateSkip') { v.flowForce = true; return; }
      if (act === 'setPage') {
        if (!v.sc || key === v.sc.page) return;
        if (steps().length) {
          let yes = true;
          // two pages with one title: each named by its path too
          const a = labelOf(key), b = labelOf(v.sc.page);
          const na = a === b ? a + ' (' + key + ')' : a, nb = a === b ? b + ' (' + v.sc.page + ')' : b;
          try { yes = window.confirm('Test ' + na + ' instead of ' + nb + '?\n\nThe steps (and the flow pages) are for ' + nb + ': they are cleared. Then Draft from the page reads the new page\'s APIs.'); } catch (e) { /* no DOM */ }
          if (!yes) { try { const el = document.getElementById('scPageSel'); if (el) el.value = v.sc.page; } catch (e) { /* no DOM */ } return; }
        }
        const nm = !v.sc.name || /^(New scenario|Happy path — .*)$/.test(v.sc.name) ? (key ? 'Happy path — ' + labelOf(key) : 'New scenario') : v.sc.name;
        v.sc = Object.assign({}, v.sc, { page: key, name: nm, steps: [], choices: [], journey: key ? [{ page: key, label: labelOf(key) }] : [] });
        v.run = null; v.tries = {}; v.suggestion = null; v.flowForce = false;
        await loadContext();
        if (key) v.result = { ok: true, text: labelOf(key) + ': press Draft from the page to put its APIs in the order the page makes them, or Add from the page\'s APIs.' };
        return;
      }
      if (act === 'draft') {
        if (!v.sc || !v.sc.page || v.busy) { if (v.sc && !v.sc.page) say({ ok: false, body: { error: 'Pick the page this scenario tests first (Page, in the header).' } }); return; }
        v.busy = true;
        try {
          const r = await SC.draft(v.sc.page, v.sc);
          if (r.ok) {
            v.sc = copy(r.body.scenario); v.run = null; v.tries = {}; v.nextPages = r.body.next || [];
            await afterChange();
            const n = steps().filter((x) => !x.page || x.page === v.sc.page).length;
            say(r, 'Drafted ' + n + ' step(s) from ' + labelOf(v.sc.page) + ', in the order the page makes them (saved as ' + v.sc.code + '). Check the values, then Save & run.');
          } else say(r);
        } finally { v.busy = false; }
        return;
      }
      if (act === 'save') { const r = await save(); say(r, 'Saved' + (v.sc && v.sc.code ? ' as ' + v.sc.code : '') + '.'); return; }
      if (act === 'saveRun' || act === 'saveRunWrites' || act === 'runFlow' || act === 'runFlowWrites') {
        const r = await save();
        if (!r.ok) { say(r); return; }
        await doRun(v.sc.id, act === 'saveRunWrites' || act === 'runFlowWrites', act === 'runFlow' || act === 'runFlowWrites' ? '' : 'main');
        return;
      }
      if (act === 'delete') {
        if (!v.sc || !v.sc.id) return;
        if (typeof window !== 'undefined' && window.confirm && !window.confirm('Delete the scenario ' + (v.sc.code || '') + ' "' + v.sc.name + '"? (Its runs stay.)')) return;
        const r = await SC.remove(v.sc.id);
        say(r, 'Deleted.');
        if (r.ok) { changed(); try { bus.close(tabId()); } catch (e) { /* no shell */ } }
        return;
      }
      // ── the test results report of the run shown: a PDF (previewed as it prints) and an Excel workbook ──
      if (act === 'report') {
        if (!v.run) { say({ ok: false, body: { error: 'Run the scenario first: the report is of a run.' } }); return; }
        v.report = { tab: key === 'excel' ? 'excel' : 'pdf', sheet: '0', answers: !(v.report && v.report.answers === false), busy: false };
        return;
      }
      if (act === 'runReport') {
        const r = await SC.runOf(v.sc ? v.sc.page : v.page, key);
        if (!r.ok) { say(r); return; }
        v.run = r.body.run;
        v.report = { tab: 'pdf', sheet: '0', answers: true, busy: false };
        return;
      }
      if (act === 'reportClose') { v.report = null; return; }
      if (act === 'reportTab') { if (v.report) v.report = Object.assign({}, v.report, { tab: key === 'excel' ? 'excel' : 'pdf' }); return; }
      if (act === 'reportSheet') { if (v.report) v.report = Object.assign({}, v.report, { sheet: String(key || '0') }); return; }
      if (act === 'reportAnswers') { if (v.report) v.report = Object.assign({}, v.report, { answers: !v.report.answers, sheet: '0' }); return; }
      if (act === 'reportPrint' || act === 'reportPdf' || act === 'reportXlsx') {
        if (!v.report || !v.run || !v.sc) return;
        const m = Report.model(copy(v.sc), copy(v.run), { pages: v.pages || [], answers: !!v.report.answers });
        if (act === 'reportXlsx') {
          const name = Report.fileName(m, 'xlsx');
          exportKit.download(name, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', exportKit.xlsxBook(Report.sheets(m)));
          say({ ok: true }, 'Saved ' + name + ': ' + m.steps.length + ' step(s), ' + m.checks.length + ' check(s)' + (m.answers ? ', ' + m.evidence.length + ' answer(s)' : '') + '.');
          return;
        }
        const html = Report.html(m);
        if (act === 'reportPrint') { exportKit.printDocument(html); return; }
        if (v.report.busy) return;
        v.report = Object.assign({}, v.report, { busy: true });
        try {
          const r = await SC.pdf(html, m.file);
          if (r.ok && r.body.base64) {
            const bin = atob(r.body.base64);
            const bytes = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
            const name = Report.fileName(m, 'pdf');
            exportKit.download(name, 'application/pdf', bytes);
            say({ ok: true }, 'Saved ' + name + ' (' + Math.max(1, Math.round(bytes.length / 1024)) + ' KB).');
          } else if (r.body && r.body.noPdf) {
            exportKit.printDocument(html);
            bus.toast('Choose "Save as PDF" in the print dialog.', 'info');
          } else say(r);
        } finally { if (v.report) v.report = Object.assign({}, v.report, { busy: false }); }
        return;
      }
      if (act === 'showRun') { const r = await SC.runOf(v.sc ? v.sc.page : v.page, key); if (r.ok) v.run = r.body.run; else say(r); return; }
      if (act === 'toggleApis') { v.showApis = !v.showApis; if (v.showApis && !v.apis.length && v.page) await loadApis(v.page); return; }

      // the flow: where the page goes next in the app (Next → the catalog → the cart)
      if (act === 'extend') {
        if (!v.sc || v.busy) return;
        v.busy = true;
        try {
          const r = await SC.extend(v.sc, key);
          if (r.ok) {
            v.sc = copy(r.body.scenario); v.nextPages = r.body.next || [];
            await afterChange();
            const j = v.sc.journey || [];
            say(r, 'The flow goes on to ' + ((j[j.length - 1] || {}).label || key) + ': its calls added after the main page\'s, with the values picked so far. Run the whole flow.');
          } else say(r);
        } finally { v.busy = false; }
        return;
      }
      // a page of the flow map added to the flow: the path to it (pages linked on another path are taken out first)
      if (act === 'flowPath') {
        const n = ((v.flow && v.flow.nodes) || []).filter((x) => x.page === key)[0];
        if (!n || v.busy || !v.sc) return;
        const j = (v.sc.journey || []).map((x) => x.page);
        let same = 0;
        while (same < j.length && same < n.path.length && j[same] === n.path[same]) same++;
        if (same < j.length && same >= 1) {
          const drop = (v.sc.journey || []).slice(same).map((x) => x.label || x.page);
          let yes = true;
          try { yes = window.confirm('Go on to ' + n.label + ' instead?\n\nThe flow pages on the other path (' + drop.join(', ') + ') are taken out of this scenario first.'); } catch (e) { /* no DOM */ }
          if (!yes) return;
          const u = await SC.unlink(v.sc, j[same]);
          if (!u.ok) { say(u); return; }
          v.sc = copy(u.body.scenario);
        }
        v.busy = true;
        try {
          const r = await SC.path(v.sc, n.path);
          if (!r.ok) { say(r); return; }
          v.sc = copy(r.body.scenario); v.tries = {}; v.nextPages = r.body.next || []; v.suggestion = null;
          await afterChange();
          const sk = r.body.skipped || [];
          say(r, 'The flow goes on to ' + n.label + ' — ' + (r.body.added || []).length + ' page(s) added'
            + (sk.length ? '; passed through ' + sk.map((x) => (x.label || x.page.split('/').pop()) + ' (' + x.why + ')').join(', ') : '') + '. Run the whole flow.');
        } finally { v.busy = false; }
        return;
      }
      if (act === 'flowLoad') { await loadFlow(v.page); return; }
      if (act === 'flowFold') { v.flowOpen = !v.flowOpen; return; }

      // ── the flow's pages: their APIs, a list of their own, the link removed or re-made ──
      const jPage = (pid) => ((v.sc && v.sc.journey) || []).filter((x) => x.page === pid)[0] || null;
      const jIdx = (pid) => ((v.sc && v.sc.journey) || []).findIndex((x) => x.page === pid);
      if (act === 'jClose') { v.journeyApis = null; return; }
      if (act === 'jApis') {
        const j = jPage(key) || { page: key, label: labelOf(key) };
        v.journeyApis = { page: j.page, label: j.label || j.page.split('/').pop(), idx: Math.max(0, jIdx(key)), loading: true, error: '', apis: null };
        const r = await SC.apis(key);
        if (!v.journeyApis || v.journeyApis.page !== key) return;
        v.journeyApis = Object.assign({}, v.journeyApis, { loading: false, apis: r.ok ? r.body.apis || [] : [], error: r.ok ? '' : (r.body && r.body.error) || 'Could not read the page\'s APIs.' });
        return;
      }
      if (act === 'jTab') {
        // that page's own scenarios, in a tab (the list, filtered to it: + New scenario tests it on its own)
        const fnode = ((v.flow && v.flow.nodes) || []).filter((x) => x.page === key)[0];
        const j = jPage(key) || { page: key, label: fnode ? fnode.label : labelOf(key) };
        v.journeyApis = null;
        bus.open({ record: 'api-scenarios-page', params: { page: j.page, label: j.label || '' } });
        return;
      }
      if (act === 'jGo') {
        v.journeyApis = null;
        const st = steps().filter((x) => x.id === key)[0];
        if (st && v.sc) v.scTab = (!st.page || st.page === v.sc.page) ? 'main' : 'flow';
        setTimeout(() => { const el = document.getElementById('scStep-' + key); if (el) { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); el.classList.add('nx-sc-step--flash'); setTimeout(() => el.classList.remove('nx-sc-step--flash'), 1600); } }, 120);
        return;
      }
      if (act === 'jAdd') {
        const ja = v.journeyApis;
        const a = ja && (ja.apis || []).filter((x) => x.key === key)[0];
        if (!a || !v.sc) return;
        const st = copy(a.step);
        st.id = newId(); st.page = ja.page;
        delete st.accepts; delete st.api;
        const list = steps().slice();
        let at = -1;
        list.forEach((x, i) => { if ((x.page || v.sc.page) === ja.page) at = i; });
        list.splice(at === -1 ? list.length : at + 1, 0, st);
        setSteps(list);
        v.result = { ok: true, text: 'Added "' + st.name + '" after ' + (ja.label || 'the page') + '\'s other steps (step ' + (list.indexOf(st) + 1) + '). Save to keep it.' };
        return;
      }
      if (act === 'jUnlink' || act === 'jRelink') {
        if (!v.sc || v.busy) return;
        const at = jIdx(key);
        const j = v.sc.journey || [];
        if (at < 1) return;
        const after = j.slice(at + 1).map((x) => x.label || x.page);
        const n = steps().filter((x) => j.slice(at).some((y) => y.page === (x.page || v.sc.page))).length;
        const what = (j[at].label || key) + (after.length ? ' and the page' + (after.length > 1 ? 's' : '') + ' after it (' + after.join(', ') + ')' : '');
        let yes = true;
        try {
          yes = window.confirm(act === 'jUnlink'
            ? 'Remove the link to ' + what + '?\n\n' + n + ' step(s) of ' + (after.length ? 'those pages' : 'that page') + ' are taken out of this scenario, with the values only they used. The scenario is saved. Continue the flow again to link it anew.'
            : 'Reconnect ' + (j[at].label || key) + '?\n\nIts link is removed (' + n + ' step(s)' + (after.length ? ', and ' + after.join(', ') : '') + '), then the page is linked again: its steps read fresh from its code, with the values picked so far handed on. The scenario is saved.');
        } catch (e) { /* no DOM */ }
        if (!yes) return;
        v.busy = true;
        try {
          const r = act === 'jUnlink' ? await SC.unlink(v.sc, key) : await SC.relink(v.sc, key);
          if (!r.ok) { say(r); return; }
          v.sc = copy(r.body.scenario); v.nextPages = r.body.next || []; v.suggestion = null; v.journeyApis = null;
          await afterChange();
          const rm = r.body.removed || { pages: [], steps: 0 };
          say(r, act === 'jUnlink'
            ? 'Link removed: ' + rm.pages.map((x) => x.label || x.page).join(', ') + ' (' + rm.steps + ' step(s)). Continue the flow to link it again.'
            : 'Reconnected ' + (rm.pages[0] ? rm.pages[0].label || key : key) + ': ' + steps().filter((x) => x.page === key).length + ' step(s) read fresh from its code. Run the whole flow.');
        } finally { v.busy = false; }
        return;
      }

      if (act === 'field') {
        if (key === 'apiQ') { v.apiQ = value; return; }
        if (key === 'addCall') { v.addCall = value; return; }
        if (!v.sc) return;
        if (key === 'data') {
          const ls = String(value || '').split('\n').map((l) => l.trim()).filter(Boolean);
          const cols = ls.length ? ls[0].split(',').map((c) => c.trim()) : [];
          v.sc = Object.assign({}, v.sc, { data: ls.slice(1).map((l) => { const cells = l.split(','); return cols.reduce((a, c, i) => { a[c] = (cells[i] || '').trim(); return a; }, {}); }) });
          return;
        }
        v.sc = Object.assign({}, v.sc, { [key]: value });
        return;
      }
      // a value picked from a list of values (as a user picks it on the page): read from that row from now on; a search
      // as you type also searches for it (its number, else its name), so a full run finds the same row
      if (act === 'pick') {
        const st = steps().filter((x) => x.id === key)[0];
        if (!st || !st.lov) return;
        const l = st.lov;
        const fns = context.$page && context.$page.functions;
        const row = value !== '' && fns && typeof fns.lovRow === 'function' ? fns.lovRow(v.sc.id || 'new', key, value) : null;
        const from = (l.itemsPath || '') + (value !== '' ? '[' + (l.key || 'id') + '=' + value + ']' : '[0]') + '.' + (l.key || 'id');
        const n = copy(st);
        n.extract = [{ var: l.target, from }].concat((st.extract || []).filter((e) => e.var !== l.target));
        n.lov = Object.assign({}, l, { picked: value !== '' ? { key: value, text: row ? String(row.text || value) : value, sub: row ? String(row.sub || '') : '' } : null });
        if (l.search) n.params = Object.assign({}, st.params, { [l.search]: value !== '' && row ? String(row.sub || row.text || '') : '' });
        setSteps(steps().map((x) => (x.id === key ? n : x)));
        v.result = { ok: true, text: value !== '' ? 'Picked ' + (row ? row.text + (row.sub ? ' (' + row.sub + ')' : '') : value) + ' for ' + l.field + ' → {{' + l.target + '}}. Save & run to use it in the steps after.' : 'No value picked for ' + l.field + ': the first is used.' };
        return;
      }
      // one step run on its own (▶ Run): the API as it is on the screen, with the values handed on so far
      if (act === 'tryStep') {
        if (!v.sc || v.trying) return;
        v.trying = key;
        try {
          const fns = context.$page && context.$page.functions;
          const vars = fns && typeof fns.varsFor === 'function' ? fns.varsFor(v.sc, v.run, v.tries) : {};
          const r = await SC.tryStep(v.sc, key, vars, !!v.sc.allowWrites);
          if (r.ok) v.tries = Object.assign({}, v.tries, { [key]: r.body.result }); else say(r);
        } finally { v.trying = ''; }
        return;
      }
      // the page as on your screen: a choice its parts are shown by (Customer Type = Internal)
      if (act === 'choice') {
        if (!v.sc) return;
        const ch = (v.sc.choices || []).map((c) => (c.target === key ? Object.assign({}, c, { value }) : c));
        v.sc = Object.assign({}, v.sc, { choices: ch });
        const c = ch.filter((x) => x.target === key)[0];
        v.result = { ok: true, text: (c ? c.field + ': ' + ((c.values.filter((x) => x.key === value)[0] || {}).text || value) : value) + ' — the steps for fields not shown in this case are skipped. Save & run.' };
        return;
      }
      if (act === 'apiOpen') { v.apiOpen = v.apiOpen === key ? '' : key; return; }
      if (act === 'apiVals') { v.apiVals = Object.assign({}, v.apiVals, { [key]: value }); return; }
      const apiStep = (k) => {
        const a = (v.apis || []).filter((x) => x.key === k)[0];
        if (!a) return null;
        const st = copy(a.step);
        if (v.apiVals[k] !== undefined) st.params = pairs(v.apiVals[k], '=').reduce((o, p) => { o[p[0]] = p[1]; return o; }, {});
        return st;
      };
      // ▶ Test: this API alone, now, with its values (and those the scenario has handed on)
      if (act === 'apiTry') {
        const st = apiStep(key);
        if (!st || v.busy) return;
        v.busy = true; v.apiOpen = key;
        try {
          const fns = context.$page && context.$page.functions;
          const vars = v.sc && fns && typeof fns.varsFor === 'function' ? fns.varsFor(v.sc, v.run, v.tries) : {};
          const r = await SC.tryStep({ page: v.page, name: 'Test', steps: [st], choices: [] }, st.id, vars, false);
          if (r.ok) v.apiTries = Object.assign({}, v.apiTries, { [key]: r.body.result }); else say(r);
        } finally { v.busy = false; }
        return;
      }
      // + Add to scenario: the API as a step of the main page, after its other steps
      const addApi = (k) => {
        const st = apiStep(k);
        if (!st || !v.sc) return null;
        st.id = newId(); st.page = st.page || v.page;
        if (!(v.sc.choices || []).length && (v.apiChoices || []).length) v.sc = Object.assign({}, v.sc, { choices: copy(v.apiChoices) });
        const list = steps().slice();
        let at = -1;
        list.forEach((x, i) => { if ((x.page || v.sc.page) === v.sc.page) at = i; });
        list.splice(at + 1, 0, st);
        setSteps(list);
        return st;
      };
      if (act === 'apiAdd') {
        const st = addApi(key);
        if (st) v.result = { ok: true, text: 'Added "' + st.name + '" (step ' + (steps().indexOf(steps().filter((x) => x.id === st.id)[0]) + 1) + '). Add more, then Suggest order and Save.' };
        return;
      }
      // Suggest order: what each step needs and hands on, how the page runs them; what is missing
      if (act === 'suggest') {
        if (!v.sc || v.busy) return;
        v.busy = true;
        try { const r = await SC.suggest(v.sc); if (r.ok) v.suggestion = r.body; else say(r); } finally { v.busy = false; }
        return;
      }
      if (act === 'applySuggest') {
        if (!v.sc || !v.suggestion) return;
        const by = {};
        steps().forEach((x) => { by[x.id] = x; });
        const order = (v.suggestion.order || []).filter((id) => by[id]);
        setSteps(order.map((id) => by[id]).concat(steps().filter((x) => order.indexOf(x.id) === -1)));
        v.suggestion = null;
        v.result = { ok: true, text: 'Steps put in the suggested order. Save & run.' };
        return;
      }
      if (act === 'closeSuggest') { v.suggestion = null; return; }
      if (act === 'addMissing') {
        if (!v.apis.length) await loadApis(v.page);
        const st = addApi(key);
        if (!st) { say({ ok: false, body: { error: 'That API is on another page: add it from that page\'s APIs.' } }); return; }
        const r = await SC.suggest(v.sc);
        if (r.ok) v.suggestion = r.body;
        return;
      }
      if (act === 'toggleWrites') { if (v.sc) v.sc = Object.assign({}, v.sc, { allowWrites: !v.sc.allowWrites }); return; }
      // a step's editor (values sent, hands on, checks) opened or closed: key = id|1 (open now) or id|0
      if (act === 'stepOpen') {
        const at = String(key || '').lastIndexOf('|');
        if (at < 1) return;
        v.stepOpen = Object.assign({}, v.stepOpen || {}, { [key.slice(0, at)]: key.slice(at + 1) !== '1' });
        return;
      }
      if (act === 'stepField' || act === 'toggleShape') {
        const id = act === 'toggleShape' ? key : step;
        // a step being edited stays open (it may have opened only because a value was missing)
        if (act === 'toggleShape' || key !== 'name') v.stepOpen = Object.assign({}, v.stepOpen || {}, { [id]: true });
        setSteps(steps().map((s) => {
          if (s.id !== id) return s;
          const n = copy(s);
          n.expect = n.expect || {};
          if (act === 'toggleShape') n.expect.sameShape = !n.expect.sameShape;
          else if (key === 'params') n.params = pairs(value, '=').reduce((a, p) => { a[p[0]] = p[1]; return a; }, {});
          else if (key === 'extract') n.extract = pairs(value, '=').map((p) => ({ var: p[0], from: p[1] }));
          else if (key === 'fields') n.expect.fields = String(value || '').split('\n').map((l) => l.trim()).filter(Boolean).map((l) => { const i = l.indexOf('='); return i === -1 ? { path: l, equals: null } : { path: l.slice(0, i).trim(), equals: l.slice(i + 1).trim() }; });
          else if (key === 'status') n.expect.status = String(value || '').trim() || '2xx';
          else if (key === 'minRows' || key === 'maxMs') n.expect[key] = String(value || '').trim() === '' ? null : Number(value);
          else n[key] = value;
          return n;
        }));
        return;
      }
      if (act === 'addStep') {
        if (!v.sc || !v.addCall) return;
        const id = 's' + Date.now().toString(36);
        const rep = /^report:/.test(v.addCall);
        const r = ((v.facts && v.facts.integrations && v.facts.integrations.rest) || []).filter((x) => x.endpoint === v.addCall)[0] || {};
        const writes = !rep && r.method && !/^GET$/i.test(r.method);
        const st = { id, page: v.sc.page, name: rep ? 'Report ' + v.addCall.slice(7).split('/').pop().replace(/\.xdo$/, '') : (r.summary || v.addCall), endpoint: rep ? '' : v.addCall, report: rep ? { path: v.addCall.slice(7) } : null,
          params: {}, extra: '', body: '', extract: [], expect: { status: '2xx', minRows: null, maxRows: null, maxMs: 10000, sameShape: !writes && !rep, fields: [] }, writes: !!writes };
        const list = steps().slice();
        let at = -1;
        list.forEach((x, i) => { if ((x.page || v.sc.page) === v.sc.page) at = i; });
        list.splice(at + 1, 0, st);
        setSteps(list);
        v.addCall = '';
        try { const el = document.getElementById('scAddCall'); if (el) el.value = ''; } catch (e) { /* not drawn */ }
        return;
      }
      if (act === 'up' || act === 'down') {
        const list = steps().slice();
        const i = list.findIndex((s) => s.id === key);
        const j = act === 'up' ? i - 1 : i + 1;
        if (i < 0 || j < 0 || j >= list.length) return;
        const t = list[i]; list[i] = list[j]; list[j] = t;
        setSteps(list);
        return;
      }
      if (act === 'removeStep') { setSteps(steps().filter((s) => s.id !== key)); }
    }
  }
  return scChain;
});
