define([
  'vb/action/actionChain',
  'resources/js/sqlClient',
  'resources/js/infolets',
  'resources/js/shellBus',
], (ActionChain, sql, I, bus) => {
  'use strict';

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
        v.mode = value === 'dash' ? 'dash' : 'work';
        if (v.mode === 'dash') await this.dashLoad(v);
        return;
      }

      // ── Save as infolet (from the current result) ──
      if (op === 'infOpen') {
        if (!(v.raw && v.raw.columns && v.raw.columns.length)) { bus.toast('Run a query first: the infolet is drawn from the result.', 'error'); return; }
        const sqlText = (byId('sqlEditor') && byId('sqlEditor').value) || v.sql || '';
        if (!sqlText.trim()) { bus.toast('There is no SQL to save as an infolet.', 'error'); return; }
        const sug = I.suggest(v.raw.columns, v.raw.rows || []);
        v.infDlg = { open: true, name: '', description: '', kind: sug.kind, label: sug.label || '', value: sug.value || '', agg: sug.agg || 'sum', limit: sug.limit || 12, share: true, busy: '', error: '', sql: sqlText };
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
        v.infDlg = Object.assign({}, v.infDlg, { open: false, busy: '' });
        const git = r.body.git, shared = share && git && (git.pushed || git.committed);
        bus.toast('Saved the infolet “' + name + '”' + (shared ? ' and shared with the team.' : (share ? ' on this PC.' : '.')), 'info');
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

    // the Save-as-infolet live preview
    preview(v) {
      const d = v.infDlg || {};
      if (!d.open || !(v.raw && v.raw.columns)) return;
      setTimeout(() => {
        const spec = { kind: d.kind || 'table', title: d.name || '', label: d.label || '', value: d.value || '', agg: d.agg || 'sum', limit: Number(d.limit) || 12 };
        const model = I.compute(spec, { columns: v.raw.columns, rows: v.raw.rows || [] });
        put('sqlInfPreview', I.cardHtml(model));
      }, 20);
    }
  }

  return dashChain;
});
