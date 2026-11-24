define([
  'vb/action/actionChain',
  'resources/js/sqlClient',
  'resources/js/sqlWorksheet',
  'resources/js/shellBus',
], (ActionChain, sql, W, bus) => {
  'use strict';

  // Running SQL as SQL Developer does. Run statement (Ctrl+Enter): the selection, else the statement under the cursor.
  // Run script (F5): every statement in order, each said in Script output; a failed one is said and the next runs.
  // A query fills the grid (Fetch more brings the next rows); a change waits for Commit or Rollback; DDL cannot be
  // rolled back, so DROP and TRUNCATE ask first. Every statement goes into the history on this PC.
  const HIST = 'buildrite:sql-history';
  const EMPTY = { has: false, kind: '', columns: [], rows: [], style: {}, more: false, fetched: 0, ms: 0, message: '', error: '', statement: '' };

  class runChain extends ActionChain {
    async run(context, { op, index, name, value }) {
      const v = context.$page.variables;
      if (op === 'history') {
        const h = (v.history || [])[Number(index)];
        if (!h) return;
        v.sql = h.sql;
        try { window.localStorage.setItem('buildrite:sql-worksheet', v.sql); } catch (e) { /* no storage */ }
        const ed = document.getElementById('sqlEditor');
        if (ed) { ed.value = h.sql; ed.focus(); }
        return;
      }
      if (op === 'clearHistory') {
        if (!window.confirm('Clear the history of statements on this PC?')) return;
        v.history = [];
        try { window.localStorage.removeItem(HIST); } catch (e) { /* no storage */ }
        return;
      }
      // the bind-values dialog (:name) — close / edit a field without needing a connection
      if (op === 'bindCancel') { v.bindDlg = Object.assign({}, v.bindDlg, { open: false }); return; }
      if (op === 'bindField') {
        const nm = String(name == null ? '' : name);
        const names = ((v.bindDlg && v.bindDlg.names) || []).map((x) => (x.name === nm ? Object.assign({}, x, { value: String(value == null ? '' : value) }) : x));
        v.bindDlg = Object.assign({}, v.bindDlg, { names: names });
        return;
      }
      if (!v.session.id) { bus.toast('Connect first: choose Connect beside a connection.', 'error'); return; }
      const sid = v.session.id;

      if (op === 'commit' || op === 'rollback') {
        v.busy = op;
        const r = op === 'commit' ? await sql.commit(sid) : await sql.rollback(sid);
        v.busy = '';
        if (!this.alive(v, r)) return;
        const msg = (r.body && (r.body.message || r.body.error)) || '';
        v.session = Object.assign({}, v.session, { pending: r.ok ? false : v.session.pending });
        v.res = Object.assign({}, v.res, { message: r.ok ? msg : '', error: r.ok ? '' : msg });
        v.script = v.script.concat([{ key: String(Date.now()), short: op.toUpperCase(), outcome: msg, ms: 0, ok: r.ok }]);
        bus.toast(msg, r.ok ? 'info' : 'error');
        return;
      }
      if (op === 'cancel') { await sql.cancel(sid); return; }
      if (op === 'more') {
        v.busy = 'more';
        const r = await sql.more(sid, v.fetch);
        v.busy = '';
        if (!this.alive(v, r)) return;
        if (!r.ok) { v.res = Object.assign({}, v.res, { error: (r.body && r.body.error) || 'The next rows could not be fetched.' }); return; }
        const rows = v.raw.rows.concat(r.body.rows || []);
        v.raw = { columns: v.raw.columns, rows };
        const g = W.grid(v.raw.columns, rows);
        v.res = Object.assign({}, v.res, { rows: g.rows, fetched: rows.length, more: !!r.body.more });
        return;
      }

      // Re-run after the binds dialog: build the bind object from the entered values and run the stored statements.
      if (op === 'bindRun') {
        const d = v.bindDlg || {};
        const bindsObj = {};
        // read the fields from the DOM (the entered values), not the variable, which can lag a keystroke behind
        const entered = (d.names || []).map((x) => { const el = document.getElementById(x.id); const val = el ? el.value : x.value; return Object.assign({}, x, { value: val }); });
        entered.forEach((x) => { bindsObj[x.name] = (x.value == null || x.value === '') ? null : x.value; });
        this.rememberBinds(entered);
        v.bindDlg = Object.assign({}, d, { open: false });
        await this.exec(context, v, d.op || 'statement', d.list || [], bindsObj);
        return;
      }

      // Run statement / Run script: what to run.
      const ed = document.getElementById('sqlEditor');
      const text = ed ? ed.value : v.sql;
      let list;
      if (op === 'script') list = W.split(text);
      else {
        const a = ed ? ed.selectionStart : 0;
        const b = ed ? ed.selectionEnd : 0;
        if (b > a && text.slice(a, b).trim()) list = W.split(text.slice(a, b));
        else { const st = W.atCursor(text, a); list = st ? [st] : []; }
      }
      if (!list.length) { bus.toast('Nothing to run: write a statement first.', 'error'); return; }
      const risky = list.filter((s) => /^\s*(DROP|TRUNCATE|PURGE)\b/i.test(s.text.replace(/^\s*(--[^\n]*\n|\/\*[\s\S]*?\*\/|\s)+/, '')));
      if (risky.length && !window.confirm(risky.length + ' statement' + (risky.length === 1 ? '' : 's') + ' (' + risky.map((s) => s.text.split(/\s+/).slice(0, 3).join(' ')).join('; ')
        + ') cannot be rolled back: DDL commits at once. Run on ' + v.session.name + '?')) return;

      // Bind placeholders (:name): ask for their values first, like SQL Developer.
      const names = this.bindNames(list);
      if (names.length) {
        const saved = this.savedBinds();
        v.bindDlg = { open: true, op: op, list: list.map((s) => ({ text: s.text, start: s.start, line: s.line })),
          names: names.map((nm, i) => ({ name: nm, value: saved[nm.toLowerCase()] || '', id: 'sqlBind-' + i })), busy: '', error: '' };
        setTimeout(() => { const el = document.getElementById('sqlBind-0'); if (el) { el.focus(); el.select(); } }, 60);
        return;
      }

      await this.exec(context, v, op, list, {});
    }

    /** The union of :name bind placeholders across the statements to run (first-seen, case-insensitive unique). */
    bindNames(list) {
      const seen = {}, out = [];
      (list || []).forEach((s) => W.binds(s.text).forEach((nm) => { const k = nm.toLowerCase(); if (!seen[k]) { seen[k] = 1; out.push(nm); } }));
      return out;
    }
    savedBinds() { try { return JSON.parse(window.localStorage.getItem('buildrite:sql-binds') || '{}') || {}; } catch (e) { return {}; } }
    rememberBinds(names) {
      try {
        const m = this.savedBinds();
        (names || []).forEach((x) => { m[x.name.toLowerCase()] = x.value == null ? '' : String(x.value); });
        window.localStorage.setItem('buildrite:sql-binds', JSON.stringify(m));
      } catch (e) { /* no storage */ }
    }

    /** Run the given statements (with an optional named-bind object), and show the result — the shared run loop. */
    async exec(context, v, op, list, bindsObj) {
      const sid = v.session.id;
      v.busy = 'run';
      v.exportOpen = false;
      if (op === 'script') v.script = [];
      const out = [];
      let last = null;
      let failed = 0;
      for (const st of list) {
        const kind = W.kindOf(st.text);
        const r = await sql.run(sid, st.text, v.fetch, bindsObj);
        if (!this.alive(v, r)) { v.busy = ''; return; }
        const b = r.body || {};
        const short = st.text.replace(/\s+/g, ' ').slice(0, 160);
        if (r.ok) {
          const outcome = b.kind === 'query' ? b.fetched + ' row' + (b.fetched === 1 ? '' : 's') + (b.more ? '+' : '') + ' fetched' : b.message || 'Done.';
          v.script = v.script.concat([{ key: String(Date.now()) + ':' + st.start, short, outcome, ms: b.ms, ok: true }]);
          if (b.output && b.output.length) out.push.apply(out, b.output);
          v.session = Object.assign({}, v.session, { pending: !!b.pending });
          last = { st, b };
          this.remember(v, st.text, kind, true, outcome, b.ms);
        } else {
          failed += 1;
          const err = (b.error || 'It did not run.') + (list.length > 1 ? ' (statement at line ' + st.line + ')' : '');
          v.script = v.script.concat([{ key: String(Date.now()) + ':' + st.start, short, outcome: 'Error: ' + (b.error || '').split('\n')[0], ms: b.ms || 0, ok: false }]);
          this.remember(v, st.text, kind, false, 'Error: ' + (b.error || '').split('\n')[0].slice(0, 120), b.ms || 0);
          last = { st, b, error: err };
        }
      }
      v.busy = '';
      if (out.length) v.output = v.output.concat(out);
      // The grid shows the last query run; a change, a block or an error says itself.
      if (last && last.error) {
        v.res = Object.assign({}, EMPTY, { has: true, error: last.error, statement: last.st.text, ms: last.b.ms || 0 });
      } else if (last && last.b.kind === 'query') {
        const g = W.grid(last.b.columns, last.b.rows);
        v.raw = { columns: last.b.columns, rows: last.b.rows || [] };
        v.res = Object.assign({}, EMPTY, { has: true, kind: 'query', columns: g.columns, rows: g.rows, style: g.style, more: !!last.b.more, fetched: (last.b.rows || []).length,
          ms: last.b.ms, statement: last.st.text, message: list.length > 1 ? list.length + ' statements run' + (failed ? ', ' + failed + ' failed' : '') + '. The grid shows the last query.' : '' });
      } else if (last) {
        v.raw = { columns: [], rows: [] };
        v.res = Object.assign({}, EMPTY, { has: true, kind: last.b.kind, ms: last.b.ms, statement: last.st.text,
          message: (list.length > 1 ? list.length + ' statements run' + (failed ? ', ' + failed + ' failed' : '') + '. Last: ' : '') + (last.b.message || 'Done.') + (last.b.pending ? ' Not committed yet: Commit or Rollback.' : '') });
      }
      v.tab = op === 'script' && list.length > 1 ? 'script' : (out.length && !(last && last.b.kind === 'query') ? 'output' : 'result');
    }

    /** A session the desktop app no longer has (it was closed after 30 minutes idle, or the app restarted): said, and reset. */
    alive(v, r) {
      const e = (r.body && r.body.error) || '';
      if (/Not connected \(the session ended\)/.test(e)) {
        v.session = { id: '', name: '', user: '', target: '', banner: '', readOnly: false, pending: false, connId: '' };
        try { window.sessionStorage.removeItem('buildrite:sql-session'); } catch (x) { /* no storage */ }
        bus.toast('The session ended (idle for 30 minutes, or the app restarted): connect again.', 'error');
        return false;
      }
      return true;
    }

    remember(v, text, kind, ok, outcome, ms) {
      v.history = W.remember(v.history, { at: new Date().toISOString(), conn: v.session.name, sql: text, kind, ok, outcome, ms });
      try { window.localStorage.setItem(HIST, JSON.stringify(v.history)); } catch (e) { /* no storage */ }
    }
  }

  return runChain;
});
