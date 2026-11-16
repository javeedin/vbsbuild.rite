define(['vb/action/actionChain', 'resources/js/scenarioClient', 'resources/js/pagesClient', 'resources/js/shellBus'], (ActionChain, SC, PC, bus) => {
  'use strict';

  // API Scenarios: load | page (id) | draft | new | open (id) | run (id) | runAll | save | saveRun | saveRunWrites | delete | pick (step, value) | tryStep (step)
  //   | field (key, value) | stepField (step, key, value) | addStep | up | down | removeStep | toggleWrites | toggleShape | showRun
  const copy = (o) => JSON.parse(JSON.stringify(o || null));
  const pairs = (text, sep) => String(text || '').split('\n').map((l) => l.trim()).filter(Boolean).map((l) => { const i = l.indexOf(sep); return i === -1 ? [l.trim(), ''] : [l.slice(0, i).trim(), l.slice(i + sep.length).trim()]; }).filter((p) => p[0]);
  class scChain extends ActionChain {
    async run(context, { act, key, value, step }) {
      const v = context.$page.variables;
      const say = (r, text) => { v.result = r.ok ? (text ? { ok: true, text } : null) : { ok: false, text: (r.body && r.body.error) || 'It did not work.' }; if (text || !r.ok) bus.toast(r.ok ? text : v.result.text, r.ok ? 'success' : 'error'); };
      const loadPage = async (id) => {
        v.page = id; v.sc = null; v.run = null; v.result = null; v.tries = {}; v.nextPages = [];
        const [l, sh, rs] = await Promise.all([SC.list(id), PC.sheet(context.$application.path, id), SC.runs(id)]);
        v.scenarios = l.ok ? l.body.scenarios || [] : [];
        if (!l.ok) say(l);
        const s = sh && sh.body ? (sh.body.sheet || sh.body) : null;
        v.facts = s && s.facts ? s.facts : null;
        v.runs = rs.ok ? rs.body.runs || [] : [];
      };
      const reloadList = async () => { const l = await SC.list(v.page); if (l.ok) v.scenarios = l.body.scenarios || []; const rs = await SC.runs(v.page); if (rs.ok) v.runs = rs.body.runs || []; };
      const steps = () => (v.sc && v.sc.steps) || [];
      const setSteps = (list) => { v.sc = Object.assign({}, v.sc, { steps: list }); };
      const doRun = async (id, writes) => {
        v.busy = true;
        try {
          const r = await SC.run(id, writes);
          if (r.ok && r.body.run.ok) { v.run = r.body.run; say({ ok: true }, 'Passed: ' + r.body.run.passed + ' check(s) ok.'); }
          else if (r.ok) { v.run = r.body.run; say({ ok: false, body: { error: 'Failed: ' + r.body.run.failed + ' step(s) failed — see each step\'s checks below.' } }); }
          else say(r);
          await reloadList();
        } finally { v.busy = false; }
      };
      const save = async () => {
        const r = await SC.save(v.sc);
        if (r.ok) { v.sc = copy(r.body.scenario); await reloadList(); }
        return r;
      };

      // the page your app's window is on (it follows you back from that window)
      const where = async () => { const r = await SC.where(); v.appAt = r.ok && r.body && r.body.open ? { open: true, url: r.body.url || '', page: r.body.page || '', label: r.body.label || '' } : null; };
      if (act === 'where') { await where(); return; }
      // where the journey's last page goes next (offered to continue there)
      const nextFor = async () => { if (!v.sc) return; const j = v.sc.journey || []; const last = j.length ? j[j.length - 1].page : v.sc.page; const r = await SC.next(last); if (r.ok) v.nextPages = r.body.next || []; };
      if (act === 'extend') {
        if (!v.sc || v.busy) return;
        v.busy = true;
        try {
          const r = await SC.extend(v.sc, key);
          if (r.ok) {
            v.sc = copy(r.body.scenario); v.nextPages = r.body.next || [];
            await reloadList();
            const j = v.sc.journey || [];
            say(r, 'The journey goes on to ' + ((j[j.length - 1] || {}).label || key) + ': its calls added after these, with the values picked so far. Save & run it.');
          } else say(r);
        } finally { v.busy = false; }
        return;
      }
      if (act === 'load') {
        const c = await PC.catalog(context.$application.path);
        v.pages = c && c.ok && c.body ? (c.body.pages || []) : [];
        await where();
        const handed = typeof bus.takeFocus === 'function' ? bus.takeFocus('api-scenarios') : null;
        if (handed && handed.page) await loadPage(handed.page);
        else if (v.page) await loadPage(v.page);
        return;
      }
      if (act === 'page') { await loadPage(key); return; }
      if (act === 'draft') {
        v.busy = true;
        try {
          const r = await SC.draft(v.page);
          if (r.ok) { v.sc = copy(r.body.scenario); v.run = null; v.tries = {}; v.nextPages = r.body.next || []; await reloadList(); say(r, 'Drafted: ' + v.sc.steps.length + ' step(s) in the order the page makes them. Check the values and checks, then Save & run.'); } else say(r);
        } finally { v.busy = false; }
        return;
      }
      if (act === 'new') { v.sc = { page: v.page, name: 'New scenario', kind: 'edge', notes: '', allowWrites: false, data: [], steps: [] }; v.run = null; v.tries = {}; v.nextPages = []; return; }
      if (act === 'open') { const s = (v.scenarios || []).filter((x) => x.id === key)[0]; v.sc = copy(s); v.run = null; v.tries = {}; v.nextPages = []; nextFor();  if (s && s.last) { const r = await SC.runOf(v.page, s.last.id); if (r.ok) v.run = r.body.run; } return; }
      if (act === 'run') { await doRun(key, false); return; }
      if (act === 'runAll') { for (const s of (v.scenarios || []).slice()) { await doRun(s.id, false); } return; }
      if (act === 'save') { const r = await save(); say(r, 'Saved.'); return; }
      if (act === 'saveRun' || act === 'saveRunWrites') { const r = await save(); if (!r.ok) { say(r); return; } await doRun(v.sc.id, act === 'saveRunWrites'); return; }
      if (act === 'delete') {
        if (!v.sc || !v.sc.id) return;
        if (typeof window !== 'undefined' && window.confirm && !window.confirm('Delete the scenario "' + v.sc.name + '"? (Its runs stay.)')) return;
        const r = await SC.remove(v.sc.id); say(r, 'Deleted.'); if (r.ok) { v.sc = null; await reloadList(); }
        return;
      }
      if (act === 'showRun') { const r = await SC.runOf(v.page, key); if (r.ok) v.run = r.body.run; else say(r); return; }
      if (act === 'field') {
        if (key === 'q') { v.q = value; return; }
        if (key === 'lovQ') { v.lovQ = value; return; }
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
      if (act === 'toggleWrites') { if (v.sc) v.sc = Object.assign({}, v.sc, { allowWrites: !v.sc.allowWrites }); return; }
      if (act === 'stepField' || act === 'toggleShape') {
        const id = act === 'toggleShape' ? key : step;
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
        setSteps(steps().concat([{ id, name: rep ? 'Report ' + v.addCall.slice(7).split('/').pop().replace(/\.xdo$/, '') : (r.summary || v.addCall), endpoint: rep ? '' : v.addCall, report: rep ? { path: v.addCall.slice(7) } : null,
          params: {}, extra: '', body: '', extract: [], expect: { status: '2xx', minRows: null, maxRows: null, maxMs: 10000, sameShape: !writes && !rep, fields: [] }, writes: !!writes }]));
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
