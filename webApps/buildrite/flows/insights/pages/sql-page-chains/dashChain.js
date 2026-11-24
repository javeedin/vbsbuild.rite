define([
  'vb/action/actionChain',
  'resources/js/sqlClient',
  'resources/js/infolets',
  'resources/js/infoletAi',
  'resources/js/sqlWorksheet',
  'resources/js/exportKit',
  'resources/js/shellBus',
], (ActionChain, sql, I, IA, W, exportKit, bus) => {
  'use strict';

  // Saved reports: the result of each opened report is kept here (out of knockout), keyed by report id, so switching tabs
  // is instant and re-render never re-queries. Module scope persists across chain invocations.
  var REP = {};

  // Infolets and dashboards for the SQL worksheet. An infolet is a named chart = its own SQL + a spec
  // { kind, title, label, value, agg, limit }; a dashboard is an ordered set of infolets, each with a width.
  // Both are shared with the team on the data branch (desktop/lib/savedSql.js). This chain:
  //   mode (value)            switch Worksheet ↔ Dashboards (loads the dashboards list)
  //   infOpen / infField / infSave / infClose   Save-as-infolet from the current result, with a live preview
  //   dashLoad / dashNew / dashField / dashBoardSave / dashBoardClose / dashOpen / dashDelete / dashClose
  //   slotAdd / slotPick / addClose / slotRemove / slotWider / slotNarrower / boardSave / boardRefresh
  const byId = (id) => { try { return document.getElementById(id); } catch (e) { return null; } };
  const put = (id, html) => { const el = byId(id); if (el) el.innerHTML = html; };

  class dashChain extends ActionChain {
    async run(context, { op, id, key, value }) {
      const v = context.$page.variables;
      const conn = v.session && v.session.name ? v.session.name : '';
      const specOf = (d) => ({ kind: d.kind || 'table', title: d.name || '', label: d.label || '', value: d.value || '', agg: d.agg || 'sum', limit: Number(d.limit) || 12 });

      // ── mode ──
      if (op === 'mode') {
        v.mode = (value === 'dash' || value === 'reports') ? value : 'work';
        if (v.mode === 'dash') await this.dashLoad(v);
        if (v.mode === 'reports') { await this.repLoad(v); this.paintReport(v); }
        return;
      }

      // ── Saved reports: a left list of saved queries AND infolets; open each as a result tab ──
      if (op === 'repLoad') { await this.repLoad(v); return; }
      if (op === 'repFilter') { v.reports = Object.assign({}, v.reports, { q: String(value == null ? '' : value) }); return; }
      if (op === 'repOpen') {
        const tabs = (v.reports.tabs || []).slice();
        let tab = tabs.filter((t) => t.id === id)[0];
        if (!tab) {
          const entry = (v.reports.list || []).filter((e) => e.rid === id)[0];
          if (!entry) { bus.toast('That report could not be opened.', 'error'); return; }
          let full, spec = null;
          if (entry.kind === 'infolet') { const r = await sql.infoletGet(entry.realId); full = r.ok && r.body.infolet; spec = full && (full.spec || {}); }
          else { const r = await sql.savedGet(entry.realId); full = r.ok && r.body.query; }
          if (!full) { bus.toast('That report could not be opened.', 'error'); return; }
          tab = { id: id, name: full.name, conn: full.conn || '', sql: full.sql || '', kind: entry.kind, spec: spec };
          tabs.push(tab);
          if (entry.kind === 'query') sql.ranQuery(entry.realId); // best-effort usage bump
        }
        v.reports = Object.assign({}, v.reports, { tabs: tabs, active: id });
        this.paintReport(v);
        return;
      }
      if (op === 'repTab') { v.reports = Object.assign({}, v.reports, { active: id }); this.paintReport(v); return; }
      if (op === 'repClose') {
        const tabs = (v.reports.tabs || []).filter((t) => t.id !== id);
        delete REP[id];
        let active = v.reports.active;
        if (active === id) active = tabs.length ? tabs[tabs.length - 1].id : '';
        v.reports = Object.assign({}, v.reports, { tabs: tabs, active: active });
        this.paintReport(v);
        return;
      }
      if (op === 'repRefresh') { delete REP[v.reports.active]; this.paintReport(v); return; }
      if (op === 'repToWorksheet') {
        const tab = (v.reports.tabs || []).filter((t) => t.id === v.reports.active)[0];
        if (!tab) return;
        v.mode = 'work';
        v.sql = tab.sql;
        setTimeout(() => { const el = byId('sqlEditor'); if (el) { el.value = tab.sql; el.focus(); } }, 40);
        bus.toast('Opened “' + tab.name + '” in the worksheet.', 'info');
        return;
      }
      if (op === 'repExport') {
        const id2 = v.reports.active, cached = REP[id2], tab = (v.reports.tabs || []).filter((t) => t.id === id2)[0];
        if (!cached || !cached.columns || cached.error) { bus.toast('Run the report first.', 'error'); return; }
        const spec = W.exportSpec(cached.columns, cached.rows || []);
        const res = await exportKit.run(value || 'csv', { name: (tab && tab.name ? tab.name.replace(/[^\w-]+/g, '_') : 'report'), title: (tab && tab.name) || 'Report', subtitle: (tab && tab.conn) || '', rows: spec.rows, columns: spec.columns });
        bus.toast(res.message + (cached.more ? ' (only the rows fetched so far)' : ''), res.ok ? 'info' : 'error');
        return;
      }

      // ── Save as infolet (from the current result) ──
      if (op === 'infOpen') {
        if (!(v.raw && v.raw.columns && v.raw.columns.length)) { bus.toast('Run a query first: the infolet is drawn from the result.', 'error'); return; }
        const sqlText = (byId('sqlEditor') && byId('sqlEditor').value) || v.sql || '';
        if (!sqlText.trim()) { bus.toast('There is no SQL to save as an infolet.', 'error'); return; }
        const sug = I.suggest(v.raw.columns, v.raw.rows || []);
        v.infDlg = { open: true, name: '', description: '', kind: sug.kind, label: sug.label || '', value: sug.value || '', agg: sug.agg || 'sum', limit: sug.limit || 12, share: true, busy: '', error: '', sql: sqlText, data: { columns: v.raw.columns, rows: v.raw.rows || [] }, toBoard: false, aiGoal: '', aiBusy: '', aiNote: '' };
        this.preview(v);
        return;
      }
      // Build an infolet with AI, straight to a dashboard (no worksheet result needed)
      if (op === 'infNewAi') {
        v.infDlg = { open: true, name: '', description: '', kind: 'bar', label: '', value: '', agg: 'sum', limit: 12, share: true, busy: '', error: '', sql: '', data: null, toBoard: !!(v.board && v.board.open), aiGoal: '', aiBusy: '', aiNote: '' };
        setTimeout(() => { const el = byId('sqlInfGoal'); if (el) el.focus(); }, 60);
        return;
      }
      if (op === 'infAi') {
        const d = v.infDlg || {};
        const goal = String(d.aiGoal || '').trim();
        if (!goal) { v.infDlg = Object.assign({}, d, { aiNote: 'Say what you want to see, in plain words.' }); return; }
        if (!(v.session && v.session.id)) { bus.toast('Connect to a database first (Worksheet tab): Ask AI reads the schema.', 'error'); return; }
        v.infDlg = Object.assign({}, d, { aiBusy: '1', aiNote: 'Asking the LLM…', error: '' });
        const r = await sql.aiAsk(v.session.id, goal, '');
        const b = r.body || {};
        if (!r.ok || !b.sql) { v.infDlg = Object.assign({}, v.infDlg, { aiBusy: '', aiNote: b.error ? 'Not written: ' + b.error : 'The LLM wrote no SQL (' + (b.explain || 'no answer') + ').' }); return; }
        v.infDlg = Object.assign({}, v.infDlg, { aiNote: 'Running the SQL…' });
        const run = await sql.run(v.session.id, b.sql, Math.max(200, Number(v.fetch) || 200));
        const rb = run.body || {};
        if (!run.ok || rb.error || rb.kind !== 'query') { v.infDlg = Object.assign({}, v.infDlg, { aiBusy: '', sql: b.sql, aiNote: 'The SQL did not return rows: ' + ((rb.error || rb.message || '').split('\n')[0] || 'no rows') + '. You can edit it in the worksheet.' }); return; }
        const data = { columns: rb.columns || [], rows: rb.rows || [] };
        const sug = I.suggest(data.columns, data.rows);
        v.infDlg = Object.assign({}, v.infDlg, { aiBusy: '', sql: b.sql, data: data, kind: sug.kind, label: sug.label || '', value: sug.value || '', agg: sug.agg || 'sum', limit: sug.limit || 12,
          name: v.infDlg.name || goal.charAt(0).toUpperCase() + goal.slice(1, 60), aiNote: 'Drafted by ' + (b.provider || 'the LLM') + ' · ' + rb.rows.length + ' rows. Adjust and Save.' });
        this.preview(v);
        return;
      }
      if (op === 'infClose') { v.infDlg = Object.assign({}, v.infDlg, { open: false }); return; }
      if (op === 'infField') {
        const k = String(key);
        const val = k === 'share' ? !!value : (k === 'limit' ? value : String(value == null ? '' : value));
        v.infDlg = Object.assign({}, v.infDlg, { [k]: val });
        this.preview(v);
        return;
      }
      if (op === 'infSave') {
        const d = v.infDlg || {};
        const name = String(d.name || '').trim();
        if (!name) { v.infDlg = Object.assign({}, d, { error: 'Give the infolet a name.' }); const el = byId('sqlInfName'); if (el) el.focus(); return; }
        if (!String(d.sql || '').trim()) { v.infDlg = Object.assign({}, d, { error: 'There is no SQL for this infolet.' }); return; }
        v.infDlg = Object.assign({}, d, { busy: 'save', error: '' });
        const share = d.share !== false;
        const spec = specOf(d); spec.title = name;
        const r = await sql.infoletSave({ name: name, description: d.description || '', sql: d.sql, conn: conn, spec: spec }, share);
        if (!(r.ok && r.body && r.body.infolet)) { v.infDlg = Object.assign({}, v.infDlg, { busy: '', error: (r.body && r.body.error) || 'It could not be saved.' }); return; }
        const infolet = r.body.infolet;
        const toBoard = d.toBoard && v.board && v.board.open;
        v.infDlg = Object.assign({}, v.infDlg, { open: false, busy: '' });
        const git = r.body.git, shared = share && git && (git.pushed || git.committed);
        if (toBoard) {
          const slots = ((v.board && v.board.slots) || []).slice();
          if (!slots.some((s) => s.infoletId === infolet.id)) {
            slots.push({ infoletId: infolet.id, name: infolet.name, kind: (infolet.spec && infolet.spec.kind) || 'table', w: 6, sql: infolet.sql, spec: infolet.spec || {} });
            v.board = Object.assign({}, v.board, { slots: slots, dirty: true });
            await this.saveBoardLayout(v);
            this.paint(v);
          }
        }
        bus.toast('Saved the infolet “' + name + '”' + (toBoard ? ' and added it to the dashboard.' : (shared ? ' and shared with the team.' : (share ? ' on this PC.' : '.'))), 'info');
        return;
      }

      // ── build a whole dashboard with AI ──
      if (op === 'boardAiOpen') { v.boardAiDlg = { open: true, goal: '', busy: '', log: [], error: '' }; setTimeout(() => { const el = byId('sqlBoardAiGoal'); if (el) el.focus(); }, 60); return; }
      if (op === 'boardAiClose') { if (v.boardAiDlg && v.boardAiDlg.busy) return; v.boardAiDlg = Object.assign({}, v.boardAiDlg, { open: false }); return; }
      if (op === 'boardAiGoal') { v.boardAiDlg = Object.assign({}, v.boardAiDlg, { goal: String(value == null ? '' : value) }); return; }
      if (op === 'boardAiGo') {
        const g = v.boardAiDlg || {};
        const goal = String(g.goal || '').trim();
        if (!goal) { v.boardAiDlg = Object.assign({}, g, { error: 'Describe the dashboard you want.' }); return; }
        if (!(v.session && v.session.id)) { bus.toast('Connect to a database first (Worksheet tab).', 'error'); return; }
        const log = (line) => { v.boardAiDlg = Object.assign({}, v.boardAiDlg, { log: (v.boardAiDlg.log || []).concat([line]) }); };
        v.boardAiDlg = Object.assign({}, g, { busy: '1', error: '', log: ['Asking the LLM for a plan…'] });
        const msgs = IA.planMessages(goal);
        const pr = await sql.aiChat(msgs.system, msgs.user);
        const plan = IA.parsePlan((pr.body && pr.body.text) || '');
        if (!plan.length) { v.boardAiDlg = Object.assign({}, v.boardAiDlg, { busy: '', error: (pr.body && pr.body.error) || 'The LLM did not return a usable plan. Try describing it differently.' }); return; }
        log('Plan: ' + plan.length + ' infolets. Building…');
        const slots = ((v.board && v.board.slots) || []).slice();
        let made = 0;
        for (const item of plan) {
          log('• ' + item.title + ' …');
          try {
            const r = await sql.aiAsk(v.session.id, item.question, '');
            const b = r.body || {};
            if (!r.ok || !b.sql) { log('   skipped (no SQL).'); continue; }
            const run = await sql.run(v.session.id, b.sql, Math.max(200, Number(v.fetch) || 200));
            const rb = run.body || {};
            if (!run.ok || rb.error || rb.kind !== 'query') { log('   skipped (' + ((rb.error || rb.message || 'no rows').split('\n')[0]) + ').'); continue; }
            const sug = I.suggest(rb.columns || [], rb.rows || []);
            const spec = { kind: sug.kind, title: item.title, label: sug.label || '', value: sug.value || '', agg: sug.agg || 'sum', limit: sug.limit || 12 };
            const sv = await sql.infoletSave({ name: item.title, description: item.question, sql: b.sql, conn: conn, spec: spec }, 'local');
            if (!(sv.ok && sv.body && sv.body.infolet)) { log('   could not save.'); continue; }
            const inf = sv.body.infolet;
            if (!slots.some((s) => s.infoletId === inf.id)) { slots.push({ infoletId: inf.id, name: inf.name, kind: spec.kind, w: 6, sql: inf.sql, spec: spec }); made++; log('   added (' + spec.kind + ').'); }
          } catch (e) { log('   error: ' + ((e && e.message) || 'failed')); }
        }
        if (!made) { v.boardAiDlg = Object.assign({}, v.boardAiDlg, { busy: '', error: 'None of the infolets could be built. See the steps above.' }); return; }
        v.board = Object.assign({}, v.board, { slots: slots, dirty: true });
        await this.saveBoardLayout(v);
        this.paint(v);
        v.boardAiDlg = { open: false, goal: '', busy: '', log: [], error: '' };
        bus.toast('Added ' + made + ' infolet' + (made === 1 ? '' : 's') + ' to the dashboard.', 'info');
        return;
      }

      // ── dashboards list / open board ──
      if (op === 'dashLoad') { await this.dashLoad(v); return; }
      if (op === 'dashNew') { v.boardDlg = { open: true, id: '', name: '', description: '', share: true, busy: '', error: '' }; setTimeout(() => { const el = byId('sqlBoardName'); if (el) el.focus(); }, 60); return; }
      if (op === 'dashBoardClose') { v.boardDlg = Object.assign({}, v.boardDlg, { open: false }); return; }
      if (op === 'dashField') { v.boardDlg = Object.assign({}, v.boardDlg, { [String(key)]: key === 'share' ? !!value : String(value == null ? '' : value) }); return; }
      if (op === 'dashBoardSave') {
        const d = v.boardDlg || {};
        const name = String(d.name || '').trim();
        if (!name) { v.boardDlg = Object.assign({}, d, { error: 'Give the dashboard a name.' }); return; }
        v.boardDlg = Object.assign({}, d, { busy: 'save', error: '' });
        const r = await sql.dashboardSave({ id: d.id || '', name: name, description: d.description || '', layout: [] }, d.share !== false);
        if (!(r.ok && r.body && r.body.dashboard)) { v.boardDlg = Object.assign({}, v.boardDlg, { busy: '', error: (r.body && r.body.error) || 'It could not be saved.' }); return; }
        v.boardDlg = { open: false, id: '', name: '', description: '', share: true, busy: '', error: '' };
        await this.dashLoad(v);
        await this.openBoard(v, r.body.dashboard.id);
        return;
      }
      if (op === 'dashOpen') { await this.openBoard(v, id); return; }
      if (op === 'dashClose') { v.board = Object.assign({}, v.board, { open: false }); await this.dashLoad(v); return; }
      if (op === 'dashDelete') {
        const row = ((v.dash && v.dash.list) || []).filter((x) => x.id === id)[0];
        if (!window.confirm('Delete the dashboard “' + ((row && row.name) || id) + '” for everyone?')) return;
        const r = await sql.dashboardRemove(id, true);
        if (!r.ok) { bus.toast((r.body && r.body.error) || 'It could not be removed.', 'error'); return; }
        await this.dashLoad(v);
        bus.toast('Removed.', 'info');
        return;
      }

      // ── editing the open board ──
      if (op === 'slotAdd') {
        const r = await sql.infoletList(); // every infolet (any connection)
        v.addInf = { open: true, list: (r.ok && r.body.infolets) || [], busy: '' };
        return;
      }
      if (op === 'addClose') { v.addInf = Object.assign({}, v.addInf, { open: false }); return; }
      if (op === 'slotPick') {
        const r = await sql.infoletGet(id);
        const inf = r.ok && r.body.infolet;
        if (!inf) { bus.toast('That infolet could not be added.', 'error'); return; }
        const slots = ((v.board && v.board.slots) || []).slice();
        if (slots.some((s) => s.infoletId === inf.id)) { bus.toast('That infolet is already on the dashboard.', 'info'); v.addInf = Object.assign({}, v.addInf, { open: false }); return; }
        slots.push({ infoletId: inf.id, name: inf.name, kind: (inf.spec && inf.spec.kind) || 'table', w: 6, sql: inf.sql, spec: inf.spec || {} });
        v.board = Object.assign({}, v.board, { slots: slots, dirty: true });
        v.addInf = Object.assign({}, v.addInf, { open: false });
        await this.saveBoardLayout(v);
        this.paint(v);
        return;
      }
      if (op === 'slotRemove') {
        const slots = ((v.board && v.board.slots) || []).filter((s) => s.infoletId !== id);
        v.board = Object.assign({}, v.board, { slots: slots, dirty: true });
        await this.saveBoardLayout(v);
        this.paint(v);
        return;
      }
      if (op === 'slotWider' || op === 'slotNarrower') {
        const slots = ((v.board && v.board.slots) || []).map((s) => {
          if (s.infoletId !== id) return s;
          const w = op === 'slotWider' ? Math.min(12, (s.w || 6) + 3) : Math.max(3, (s.w || 6) - 3);
          return Object.assign({}, s, { w: w });
        });
        v.board = Object.assign({}, v.board, { slots: slots, dirty: true });
        await this.saveBoardLayout(v);
        this.paint(v);
        return;
      }
      if (op === 'boardRefresh') { this.paint(v); return; }
      if (op === 'boardShare') {
        await this.saveBoardLayout(v, true);
        bus.toast('Dashboard shared with the team.', 'info');
        return;
      }
    }

    // ---- helpers ----
    async dashLoad(v) {
      const r = await sql.dashboardList();
      v.dash = { list: (r.ok && r.body.dashboards) || [], open: false, error: r.ok ? '' : ((r.body && r.body.error) || 'Could not read the dashboards.') };
    }

    async repLoad(v) {
      const [qr, ir] = await Promise.all([sql.savedList(), sql.infoletList()]);
      const queries = (qr.ok && qr.body.queries) || [];
      const infs = (ir.ok && ir.body.infolets) || [];
      const list = queries.map((x) => ({ rid: 'q_' + x.id, kind: 'query', realId: x.id, name: x.name, conn: x.conn || '', description: x.description || '' }))
        .concat(infs.map((x) => ({ rid: 'i_' + x.id, kind: 'infolet', realId: x.id, name: x.name, conn: x.conn || '', description: x.description || '', chart: x.kind || 'table' })));
      v.reports = Object.assign({ tabs: [], active: '', q: '' }, v.reports, { list: list, error: (qr.ok || ir.ok) ? '' : 'Could not read the reports.' });
    }

    // draw the active report tab: run its SQL on the connection (cached after the first run), inject the grid
    paintReport(v) {
      const r = v.reports || {};
      const id = r.active;
      setTimeout(async () => {
        const box = byId('sqlRepBody');
        if (!box) return;
        if (!id) { box.innerHTML = ''; return; }
        const tab = (r.tabs || []).filter((t) => t.id === id)[0];
        if (!tab) { box.innerHTML = ''; return; }
        const draw = (res) => {
          if (res.error) { box.innerHTML = '<p class="nx-rep-err">' + I.esc(String(res.error).split('\n')[0]) + '</p>'; return; }
          if (res.kind && res.kind !== 'query') { box.innerHTML = '<p class="nx-rep-empty">' + I.esc(res.message || 'This statement returned no rows.') + '</p>'; return; }
          const meta = '<p class="nx-rep-meta">' + (res.rows || []).length + ' row' + ((res.rows || []).length === 1 ? '' : 's') + (res.ms != null ? ' · ' + (res.ms / 1000).toFixed(2) + ' s' : '') + '</p>';
          // an infolet report shows its chart above the full grid
          let chart = '';
          if (tab.kind === 'infolet' && tab.spec && (res.columns || []).length) {
            chart = '<div class="nx-rep-chart">' + I.cardHtml(I.compute(tab.spec, { columns: res.columns, rows: res.rows || [] })) + '</div>';
          }
          box.innerHTML = meta + chart + I.gridHtml(res.columns || [], res.rows || [], { more: res.more });
        };
        if (REP[id]) { draw(REP[id]); return; }
        if (!(v.session && v.session.id)) { box.innerHTML = '<p class="nx-rep-empty">Connect to a database (Worksheet tab) to run this report.</p>'; return; }
        box.innerHTML = '<p class="nx-rep-empty">Running…</p>';
        try {
          const run = await sql.run(v.session.id, tab.sql, Math.max(200, Number(v.fetch) || 200));
          const b = run.body || {};
          REP[id] = { columns: b.columns || [], rows: b.rows || [], more: !!b.more, ms: b.ms, kind: b.kind, error: run.ok ? (b.error || '') : ((b.error) || 'The report could not run.'), message: b.message || '' };
          if (v.reports.active === id) draw(REP[id]);
        } catch (e) { REP[id] = { error: (e && e.message) || 'Error' }; if (v.reports.active === id) draw(REP[id]); }
      }, 30);
    }

    async openBoard(v, id) {
      const r = await sql.dashboardGet(id);
      const res = r.ok && r.body.resolved;
      if (!res) { bus.toast((r.body && r.body.error) || 'That dashboard could not be opened.', 'error'); return; }
      const slots = (res.slots || []).map((s) => ({ infoletId: s.infolet.id, name: s.infolet.name, kind: (s.infolet.spec && s.infolet.spec.kind) || 'table', w: s.w, sql: s.infolet.sql, spec: s.infolet.spec || {} }));
      v.board = { open: true, id: res.dashboard.id, name: res.dashboard.name, description: res.dashboard.description || '', slots: slots, dirty: false };
      this.paint(v);
    }

    async saveBoardLayout(v, share) {
      const b = v.board || {};
      const layout = (b.slots || []).map((s) => ({ infoletId: s.infoletId, w: s.w }));
      const r = await sql.dashboardSave({ id: b.id, name: b.name, description: b.description || '', layout: layout }, share ? true : 'local');
      if (r.ok) v.board = Object.assign({}, v.board, { dirty: false });
    }

    // draw every slot: run its SQL on the connected session, then inject the chart HTML
    paint(v) {
      const board = v.board || {};
      const slots = (board.slots || []).slice();
      const sid = v.session && v.session.id ? v.session.id : '';
      setTimeout(async () => {
        if (!slots.length) return;
        if (!sid) { slots.forEach((s) => put('sqlSlot-' + s.infoletId, '<p class="nx-if-empty">Connect to a database (Worksheet tab) to see this chart.</p>')); return; }
        for (const s of slots) {
          put('sqlSlot-' + s.infoletId, '<p class="nx-if-empty">Running…</p>');
          try {
            const r = await sql.run(sid, s.sql, Math.max(200, Number(v.fetch) || 200));
            const b = r.body || {};
            if (!r.ok || b.error) { put('sqlSlot-' + s.infoletId, '<p class="nx-if-err">' + I.esc((b.error || 'It could not run.').split('\n')[0]) + '</p>'); continue; }
            if (b.kind !== 'query') { put('sqlSlot-' + s.infoletId, '<p class="nx-if-empty">' + I.esc(b.message || 'That statement returns no rows to chart.') + '</p>'); continue; }
            const model = I.compute(s.spec || {}, { columns: b.columns || [], rows: b.rows || [] });
            put('sqlSlot-' + s.infoletId, I.cardHtml(model));
          } catch (e) { put('sqlSlot-' + s.infoletId, '<p class="nx-if-err">' + I.esc((e && e.message) || 'Error') + '</p>'); }
        }
      }, 30);
    }

    // the Save-as-infolet live preview (from the AI-drafted result, else the worksheet's result)
    preview(v) {
      const d = v.infDlg || {};
      const data = d.data || v.raw;
      if (!d.open) return;
      setTimeout(() => {
        if (!(data && data.columns && data.columns.length)) { put('sqlInfPreview', '<p class="nx-if-empty">Draft with AI, or run a query first, to see a chart.</p>'); return; }
        const spec = { kind: d.kind || 'table', title: d.name || '', label: d.label || '', value: d.value || '', agg: d.agg || 'sum', limit: Number(d.limit) || 12 };
        const model = I.compute(spec, { columns: data.columns, rows: data.rows || [] });
        put('sqlInfPreview', I.cardHtml(model));
      }, 20);
    }
  }

  return dashChain;
});
