define(['resources/js/shellBus', 'resources/js/scenarioClient'], (bus, SC) => {
  'use strict';

  // API Scenarios: binding helpers (the chains do the work through resources/js/scenarioClient.js).
  const KINDS = [['happy', 'Happy path'], ['edge', 'Edge case'], ['role', 'Role'], ['data', 'Data-driven']];
  const linesOf = (obj, sep) => Object.keys(obj || {}).map((k) => k + ' ' + sep + ' ' + obj[k]).join('\n');
  const when = (iso) => { try { const d = new Date(iso); return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) + ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }); } catch (e) { return iso || ''; } };
  const varsIn = (t) => Array.from(String(t || '').matchAll(/\{\{\s*([\w.-]+)\s*\}\}/g)).map((m) => m[1]);
  const MIN_SEARCH = 2;
  const uniq = (a) => a.filter((x, i) => x && a.indexOf(x) === i);

  /** Is a part of the page shown for the values chosen? (lib/apiScenarios.js evalWhen, the same): true / false / null (not known). */
  function evalWhen(expr, v) {
    const close = (t) => { let d = 0, q = ''; for (let i = 0; i < t.length; i++) { const c = t[i]; if (q) { if (c === q) q = ''; continue; } if (c === '"' || c === "'") { q = c; continue; } if (c === '(') d++; else if (c === ')' && --d === 0) return i; } return -1; };
    const strip = (t) => { let x = t.trim(); while (x[0] === '(' && close(x) === x.length - 1) x = x.slice(1, -1).trim(); return x; };
    const split = (t, op) => { const out = []; let d = 0, q = '', cur = ''; for (let i = 0; i < t.length; i++) { const c = t[i]; if (q) { cur += c; if (c === q) q = ''; continue; } if (c === '"' || c === "'") { q = c; cur += c; continue; } if (c === '(') d++; if (c === ')') d--; if (!d && t.substr(i, op.length) === op) { out.push(cur); cur = ''; i += op.length - 1; continue; } cur += c; } out.push(cur); return out; };
    const name = (x) => x.split('.').pop();
    const ev = (t0) => {
      const t = strip(t0);
      const ors = split(t, '||');
      if (ors.length > 1) { const r = ors.map(ev); return r.some((x) => x === true) ? true : (r.some((x) => x === null) ? null : false); }
      const ands = split(t, '&&');
      if (ands.length > 1) { const r = ands.map(ev); return r.some((x) => x === false) ? false : (r.some((x) => x === null) ? null : true); }
      let m = /^([\w$.]+)\s*(===|!==|==|!=)\s*(['"])(.*)\3$/.exec(t);
      if (m) { const n = name(m[1]); if (!(n in v)) return null; const eq = String(v[n]) === m[4]; return m[2][0] === '!' ? !eq : eq; }
      m = /^(!?)\s*([\w$.]+)$/.exec(t);
      if (m) { const n = name(m[2]); if (!(n in v)) return null; const b = !!v[n] && v[n] !== 'false'; return m[1] ? !b : b; }
      return null;
    };
    return String(expr || '').trim() ? ev(String(expr)) : true;
  }

  /**
   * A list of values' values for an oj-select-single, as the app's own search providers work: a search as you type sends
   * the text typed to the server (the step tried with it as its search parameter: lib/apiScenarios.js tryStep), a list
   * the page loads whole is loaded once (the step tried) and filtered here. Rows: { key, text, sub }.
   */
  function LovProvider() {
    this.ctx = null;            // { sc, step, vars }: set on every render
    this._cache = new Map();    // key → row, so fetchByKeys shows the value picked
    this._all = null;           // a whole list, once loaded
    this._loading = null;
    this._bySearch = new Map(); // text → Promise<rows>
    this._listeners = {};
  }
  LovProvider.prototype = {
    seed: function (rows) { const self = this; (rows || []).forEach(function (r) { if (r && r.key != null) self._cache.set(String(r.key), r); }); },
    setAll: function (rows) { if (rows && rows.length) { this._all = rows; this.seed(rows); } },
    _try: function (search) {
      const c = this.ctx;
      if (!c || !c.sc || !c.step) return Promise.resolve([]);
      return SC.tryStep(c.sc, c.step.id, c.vars || {}, false, search).then(function (r) {
        return r.ok && r.body.result && Array.isArray(r.body.result.values) ? r.body.result.values : [];
      }, function () { return []; });
    },
    _rows: function (text) {
      const self = this;
      const c = this.ctx || {};
      const t = String(text || '').trim();
      if (c.step && c.step.lov && c.step.lov.search) {
        // a search as you type: the server runs the step with the text (blank: the first rows, as the page shows them)
        if (t.length > 0 && t.length < MIN_SEARCH) return Promise.resolve([]);
        const k = t.toLowerCase();
        if (!this._bySearch.has(k)) {
          this._bySearch.set(k, new Promise(function (res) { setTimeout(res, t ? 250 : 0); }).then(function () { return self._try(t); }).then(function (rows) {
            if (!rows.length) self._bySearch.delete(k);
            return rows;
          }));
        }
        return this._bySearch.get(k).then(function (rows) { self.seed(rows); return rows; });
      }
      // a whole list: loaded once, filtered here by name, second line or key
      const load = this._all ? Promise.resolve(this._all) : (this._loading = this._loading || this._try(undefined).then(function (rows) { self._loading = null; self.setAll(rows); return rows; }));
      return load.then(function (rows) {
        const q = t.toLowerCase();
        return !q ? rows : rows.filter(function (r) { return (String(r.text) + ' ' + String(r.sub || '') + ' ' + String(r.key)).toLowerCase().indexOf(q) !== -1; });
      });
    },
    fetchFirst: function (params) {
      const self = this;
      const fc = params && params.filterCriterion;
      const text = fc ? (fc.text != null ? fc.text : (fc.value != null ? fc.value : '')) : '';
      let done = false;
      const it = { next: function () {
        if (done) return Promise.resolve({ done: true, value: { data: [], metadata: [], fetchParameters: params } });
        done = true;
        return self._rows(text).then(function (rows) {
          const shown = rows.slice(0, 300);
          return { done: true, value: { data: shown, metadata: shown.map(function (r) { return { key: String(r.key) }; }), fetchParameters: params } };
        });
      } };
      const iterable = {};
      iterable[Symbol.asyncIterator] = function () { return it; };
      return iterable;
    },
    fetchByKeys: function (params) {
      const self = this;
      const map = new Map();
      (params && params.keys ? Array.from(params.keys) : []).forEach(function (k) { const d = self._cache.get(String(k)); if (d) map.set(k, { metadata: { key: k }, data: d }); });
      return Promise.resolve({ fetchParameters: params, results: map });
    },
    containsKeys: function (params) {
      const self = this;
      const found = new Set();
      (params && params.keys ? Array.from(params.keys) : []).forEach(function (k) { if (self._cache.has(String(k))) found.add(k); });
      return Promise.resolve({ containsParameters: params, results: found });
    },
    fetchByOffset: function (params) { return Promise.resolve({ fetchParameters: params, results: [], done: true }); },
    getCapability: function (name) {
      // text filtering advertised: oj-select-single passes the text typed and shows our rows as they are
      if (name === 'filter') return { operators: ['$co'], textFilter: {} };
      if (name === 'fetchFirst') return { iterationSpeed: 'immediate' };
      if (name === 'fetchByKeys') return { implementation: 'lookup' };
      return null;
    },
    getTotalSize: function () { return Promise.resolve(-1); },
    isEmpty: function () { return 'unknown'; },
    addEventListener: function (t, l) { (this._listeners[t] = this._listeners[t] || []).push(l); },
    removeEventListener: function (t, l) { const a = this._listeners[t]; if (a) this._listeners[t] = a.filter(function (x) { return x !== l; }); },
    dispatchEvent: function () { return true; }
  };

  class PageModule {
    constructor(context) {
      // opened on one page (Application pages → API on a page): its scenarios shown
      const helper = context && typeof context.getEventHelper === 'function' ? context.getEventHelper() : null;
      try { bus.onFocus('api-scenarios', () => { if (helper) helper.fireCustomEvent('focusRequest', {}); }); } catch (e) { /* no shell */ }
      // back from your app's window (Build.Rite's own window gets the focus again): which page is it on now?
      try { if (typeof window !== 'undefined' && helper) window.addEventListener('focus', () => { try { helper.fireCustomEvent('appWhere', {}); } catch (e) { /* page gone */ } }); } catch (e) { /* no window */ }
      this._rows = new Map();   // step id → { sig, row }: a step shown again only when it changed (the page keeps its place)
      this._prov = new Map();   // scenario id|step id → LovProvider (one per list, kept while the scenario is open)
    }
    /** A page's title (the rail of the folded pages list). */
    pageLabelOf(pages, id) {
      const p = (pages || []).filter((x) => x && x.id === id)[0];
      return p ? String(p.label || p.id) : String(id || '').split('/').pop();
    }
    pagesShown(pages, q, appAt) {
      const t = String(q || '').trim().toLowerCase();
      const live = (pages || []).filter((p) => !p.deleted);
      // pages that share a title (two "Create Equipment Request"s): said, so the one your app shows is the one tested
      const byLabel = {};
      live.forEach((p) => { const k = String(p.label || '').trim().toLowerCase(); (byLabel[k] = byLabel[k] || []).push(p.id); });
      return live.filter((p) => !t || (p.label + ' ' + p.id).toLowerCase().indexOf(t) !== -1).slice(0, 400).map((p) => {
        const twins = (byLabel[String(p.label || '').trim().toLowerCase()] || []).filter((x) => x !== p.id);
        return Object.assign({}, p, { open: !!(appAt && appAt.page === p.id), twin: twins.join(', ') });
      });
    }
    pageLabel(pages, id) { return ((pages || []).filter((p) => p.id === id)[0] || {}).label || id; }
    cards(list, sc) {
      return (list || []).map((s) => {
        const l = s.last;
        return { id: s.id, name: s.name, sub: (KINDS.filter((k) => k[0] === s.kind)[0] || KINDS[0])[1] + ' · ' + (s.steps || []).length + ' step(s)' + ((s.data || []).length ? ' · ' + s.data.length + ' data row(s)' : ''),
          last: l ? (l.ok ? '✓ passed' : '✗ failed') + ' · ' + when(l.at) : 'not run yet', lastTone: l ? (l.ok ? 'ok' : 'fail') : 'none',
          cls: 'nx-sc-card' + (sc && sc.id === s.id ? ' nx-sc-card--on' : '') };
      });
    }
    kinds(sc) { return KINDS.map((k) => ({ id: k[0], label: k[1], on: !!sc && sc.kind === k[0] })); }

    /** The values handed on so far, for a step tried on its own: the data row, the last run's, the steps tried, the values picked. */
    varsFor(sc, run, tries) {
      const vars = {};
      const put = (k, v) => { if (k && v !== undefined && v !== null && String(v) !== '') vars[k] = String(v); };
      const row0 = (sc && sc.data && sc.data[0]) || {};
      Object.keys(row0).forEach((k) => put(k, row0[k]));
      const runSteps = run && sc && run.scenario === sc.id && run.rows && run.rows[0] ? run.rows[0].steps || [] : [];
      runSteps.forEach((r) => Object.keys(r.extracted || {}).forEach((k) => put(k, r.extracted[k])));
      Object.keys(tries || {}).forEach((id) => { const t = tries[id]; Object.keys((t && t.extracted) || {}).forEach((k) => put(k, t.extracted[k])); });
      ((sc && sc.steps) || []).forEach((st) => {
        if (!st.lov || !st.lov.target) return;
        const ex = (st.extract || []).filter((e) => e.var === st.lov.target)[0];
        const m = ex ? /\[[\w.-]+=([^\]]*)\]/.exec(ex.from) : null;
        if (m) put(st.lov.target, m[1]);
      });
      return vars;
    }
    /** A row of a list of values the user picked (for the chain: its name and second line). */
    lovRow(scId, stepId, key) { const p = this._prov.get(scId + '|' + stepId); return (p && p._cache.get(String(key))) || null; }

    stepRows(sc, run, tries, trying) {
      const steps = (sc && sc.steps) || [];
      const T = tries || {};
      const scId = sc ? sc.id || 'new' : '';
      // the last run of this scenario: the values each list of values gave (lib/apiScenarios.js run → res.values)
      const runSteps = run && sc && run.scenario === sc.id && run.rows && run.rows[0] ? run.rows[0].steps || [] : [];
      const vars = this.varsFor(sc, run, T);
      const lists = {}; // target → its list's step
      steps.forEach((st) => { if (st.lov && st.lov.target) lists[st.lov.target] = st; });
      const resOf = (id) => T[id] || runSteps.filter((x) => x.step === id)[0] || null;
      const picker = (ls) => {
        const k = scId + '|' + ls.id;
        let prov = this._prov.get(k);
        if (!prov) { prov = new LovProvider(); this._prov.set(k, prov); }
        prov.ctx = { sc, step: ls, vars };
        const res = resOf(ls.id);
        if (res && res.values && !ls.lov.search) prov.setAll(res.values); else if (res && res.values) prov.seed(res.values);
        if (ls.lov.picked) prov.seed([ls.lov.picked]);
        const ex = (ls.extract || []).filter((e) => e.var === ls.lov.target)[0];
        const m = ex ? /\[[\w.-]+=([^\]]*)\]/.exec(ex.from) : null;
        const first = res && res.values && res.values[0];
        const p = ls.lov.picked;
        return { lovStep: ls.id, field: ls.lov.field, target: ls.lov.target, provider: prov, pick: m ? m[1] : null,
          placeholder: ls.lov.search ? 'Search ' + ls.lov.field + ' (type 2 letters or more)…' : 'Search ' + ls.lov.field + '…',
          pickedLabel: m ? 'picked: ' + (p && String(p.key) === m[1] ? p.text + (p.sub ? ' · ' + p.sub : '') : m[1]) : (first ? 'none picked: the first value is used (' + first.text + ')' : 'none picked: the first value is used'),
          note: ls.lov.search ? 'Type to search, as on the page: it runs ' + (ls.report ? 'the report' : 'the call') + ' with what you type and shows what it finds. Pick one, then Save & run.'
            : 'Open it to load its values from the API (or type to find one). Pick one, then Save & run.' };
      };
      const fullApi = (st) => {
        const a = st.api;
        const fillV = (v) => String(v == null ? '' : v).replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (mm, n) => (vars[n] !== undefined ? vars[n] : '{{' + n + '}}'));
        if (st.report) return 'REPORT ' + st.report.path + Object.keys(st.params || {}).map((k, i) => (i ? ' & ' : '  ·  ') + k + '=' + fillV(st.params[k])).join('') + '  ·  BI Publisher (runReport)';
        if (!a) return st.endpoint;
        const ins = {};
        (st.accepts || []).forEach((x) => { ins[x.name] = x.in; });
        let pth = a.path || '';
        const q = [];
        Object.keys(st.params || {}).forEach((k) => {
          const v = fillV(st.params[k]);
          if (pth.indexOf('{' + k + '}') !== -1) pth = pth.split('{' + k + '}').join(v);
          else if (ins[k] !== 'header') q.push(k + '=' + v);
        });
        return a.method + ' ' + (a.base || '') + pth + (q.length ? '?' + q.join('&') : '');
      };
      const triedOf = (st) => {
        const t = T[st.id];
        if (!t) return null;
        return { state: t.state, icon: t.state === 'ok' ? '✓' : t.state === 'fail' ? '✗' : '–',
          head: (t.status ? t.status + ' · ' + t.ms + ' ms' + (t.rows != null ? ' · ' + t.rows + ' row(s)' : '') : 'not sent') + ' · run on its own, ' + when(t.at),
          url: t.request ? t.request.method + ' ' + t.request.url : '', note: t.note || '', checks: t.checks || [],
          handed: Object.keys(t.extracted || {}).map((k) => k + ' = ' + t.extracted[k]).join(', '),
          values: t.lov && t.values ? t.lov.total + ' value(s): ' + t.values.slice(0, 8).map((v) => v.text + (v.sub ? ' (' + v.sub + ')' : '')).join(', ') + (t.lov.total > 8 ? ', …' : '') : '',
          answer: t.answer || '' };
      };
      const keep = new Set();
      const out = steps.map((st, i) => {
        // the lists whose value this step sends ({{customerRefId}}), and its own list
        const uses = [];
        if (st.lov && lists[st.lov.target] === st) uses.push(st);
        Object.keys(st.params || {}).forEach((k) => varsIn(st.params[k]).forEach((n) => { const l = lists[n]; if (l && l !== st && uses.indexOf(l) === -1) uses.push(l); }));
        const used = uniq([].concat(...Object.keys(st.params || {}).map((k) => varsIn(st.params[k]))).concat(uses.map((u) => u.lov.target)));
        // shown again only when it (or what it shows) changed: the page keeps its place
        // the journey: where a page starts, its name over its first step
        const jl = {};
        ((sc && sc.journey) || []).forEach((x) => { jl[x.page] = x.label; });
        const multi = ((sc && sc.journey) || []).length > 1;
        const pg = st.page || (sc && sc.page) || '';
        const prevPg = i ? (steps[i - 1].page || (sc && sc.page) || '') : null;
        const pageHead = multi && pg !== prevPg ? (i ? 'Then, on ' : 'On ') + (jl[pg] || pg.split('/').pop()) + '  ·  ' + pg : '';
        // a page the journey went on to: its link can be removed, re-made, opened in its own tab; any page: its APIs
        const jIdx = ((sc && sc.journey) || []).findIndex((x) => x.page === pg);
        // a part of the page not shown for the values chosen (the other Customer field)
        const chosen = ((sc && sc.choices) || []).reduce((a, c) => { a[c.target] = c.value; return a; }, {});
        const off = !!st.when && evalWhen(st.when, chosen) === false;
        const offNote = off ? 'Not on the page as chosen (' + ((sc && sc.choices) || []).filter((c) => new RegExp('\\b' + c.target + '\\b').test(st.when)).map((c) => c.field + ' is ' + ((c.values.filter((x) => x.key === c.value)[0] || {}).text || c.value)).join(', ') + '): skipped when run' : '';
        const sig = JSON.stringify([st, i, pageHead, jIdx, off, used.map((n) => vars[n]), uses.map((u) => [u, resOf(u.id) ? (resOf(u.id).at || run && run.id) : '']), T[st.id] ? T[st.id].at : '', trying === st.id]);
        keep.add(st.id);
        const hit = this._rows.get(st.id);
        if (hit && hit.sig === sig) return hit.row;
        const ex = st.expect || {};
        const acc = st.accepts || [];
        const row = { id: st.id, n: i + 1, name: st.name, call: st.report ? 'report ' + st.report.path : st.endpoint, writes: !!st.writes, pageHead,
          pageId: pageHead ? pg : '', pageLinked: !!pageHead && jIdx > 0,
          when: st.when ? 'On the page only when ' + st.when : '', off, offNote,
          api: fullApi(st), trying: trying === st.id, tried: triedOf(st),
          params: linesOf(st.params, '='), extract: (st.extract || []).map((e) => e.var + ' = ' + e.from).join('\n'),
          // what the call accepts, from its service (the values the page sends are filled in already)
          paramHint: st.report ? 'P_NAME = value (the report\'s parameters)' : acc.length ? 'It accepts: ' + acc.map((a) => a.name + (a.required ? ' (needed)' : '')).join(', ') + '\nOne per line: name = value, or {{var}} from an earlier step' : 'This call takes no values',
          lov: st.lov ? st.lov.field + ' on the page: shows ' + (st.lov.text || 'its name') + (st.lov.sub ? ' and ' + st.lov.sub : '') + ', keeps ' + (st.lov.key || 'id') + ' → hands it on as {{' + st.lov.target + '}}'
            + (st.lov.search ? ' · a search as you type (' + st.lov.search + ' = the text typed)' : '') : '',
          pickers: uses.map(picker),
          status: ex.status || '2xx', minRows: ex.minRows == null ? '' : String(ex.minRows), maxMs: ex.maxMs == null ? '' : String(ex.maxMs), sameShape: !!ex.sameShape,
          fields: (ex.fields || []).map((f) => f.path + (f.equals === null || f.equals === undefined ? '' : ' = ' + f.equals)).join('\n'),
          hasBody: !!st.body || !!st.writes, body: st.body || '' };
        this._rows.set(st.id, { sig, row });
        return row;
      });
      Array.from(this._rows.keys()).forEach((k) => { if (!keep.has(k)) this._rows.delete(k); });
      return out;
    }
    callOptions(facts) {
      const f = facts || {};
      const rest = ((f.integrations && f.integrations.rest) || []).map((r) => ({ id: r.endpoint, label: (r.method || '') + ' ' + (r.path || r.endpoint) + ' — ' + r.endpoint }));
      const reps = ((f.integrations && f.integrations.reports) || []).map((p) => ({ id: 'report:' + p, label: 'BI Publisher report ' + p }));
      return rest.concat(reps);
    }
    dataText(sc) {
      const rows = (sc && sc.data) || [];
      if (!rows.length) return '';
      const cols = Object.keys(rows[0]);
      return [cols.join(',')].concat(rows.map((r) => cols.map((c) => r[c] || '').join(','))).join('\n');
    }
    /** The APIs tab: every API of the page, each with where it is used, its values to test, its last test. */
    /** The pages the journey goes through: where each starts, its steps, when it was linked (a page after the first). */
    /** Each step's result in the last run of this scenario, over every data row: a failure in any row wins, then a pass, then a skip. */
    runResults(sc, run) {
      const res = {};
      if (!sc || !run || run.scenario !== sc.id) return res;
      const rank = { fail: 3, ok: 2, skip: 1 };
      (run.rows || []).forEach((row) => (row.steps || []).forEach((r) => {
        if (!r || !r.step) return;
        if (!res[r.step] || (rank[r.state] || 0) > (rank[res[r.step].state] || 0)) res[r.step] = r;
      }));
      return res;
    }
    journeyRows(sc, run) {
      const j = (sc && sc.journey) || [];
      const steps = (sc && sc.steps) || [];
      const res = this.runResults(sc, run);
      return j.map((x, idx) => {
        const mine = steps.filter((st) => (st.page || sc.page) === x.page);
        const bad = mine.filter((st) => res[st.id] && res[st.id].state === 'fail').length;
        const ran = mine.filter((st) => res[st.id]).length;
        return { page: x.page, label: x.label || x.page.split('/').pop(), idx, n: String(idx + 1), linked: idx > 0, last: idx === j.length - 1,
          steps: mine.length + (mine.length === 1 ? ' step' : ' steps') + (mine.filter((st) => st.writes).length ? ' · ' + mine.filter((st) => st.writes).length + ' change data' : ''),
          state: !ran ? '' : bad ? 'bad' : 'ok', stateText: !ran ? '' : bad ? bad + ' failed in the last run' : 'passed in the last run',
          title: x.page + (x.linkedAt ? '\nLinked ' + String(x.linkedAt).replace('T', ' ').slice(0, 16) + (x.linkedBy ? ' by ' + x.linkedBy : '') : '') };
      });
    }
    /** The APIs dialog: the page's calls in this scenario, in the order they run (the scenario's step numbers). */
    jaSequence(ja, sc, run) {
      if (!ja || !sc) return [];
      const res = this.runResults(sc, run);
      const out = [];
      (sc.steps || []).forEach((st, i) => {
        if ((st.page || sc.page) !== ja.page) return;
        const r = res[st.id];
        const m = st.report ? 'REPORT' : ((st.api && st.api.method) || (st.writes ? 'POST' : 'GET'));
        out.push({ id: st.id, n: String(i + 1), seq: String(out.length + 1), name: st.name, call: st.report ? 'report ' + st.report.path : st.endpoint, method: m, mclass: m.toLowerCase(),
          writes: !!st.writes, lov: st.lov ? st.lov.field : '', state: r ? (r.state === 'skip' ? 'skip' : r.state === 'fail' ? 'bad' : 'ok') : '',
          stateText: r ? (r.state === 'skip' ? 'skipped' : r.state === 'fail' ? '✗ ' + (r.status || 'failed') : '✓ passed' + (r.status ? ' · ' + r.status : '')) : 'not run' });
      });
      return out;
    }
    /** The flow card: the pages by how far they are from this one (a column each), each page with its state. */
    flowCols(flow) {
      if (!flow || !flow.nodes || !flow.nodes.length) return [];
      const byId = {};
      flow.nodes.forEach((n) => { byId[n.page] = n; });
      const cols = [];
      flow.nodes.forEach((n) => {
        const c = cols[n.depth] || (cols[n.depth] = { depth: n.depth, title: n.depth === 0 ? 'This page' : n.depth === 1 ? 'It leads to' : 'Then, ' + n.depth + ' pages on', nodes: [] });
        const from = n.parent && byId[n.parent] ? byId[n.parent].label : '';
        c.nodes.push({ page: n.page, label: n.label, depth: n.depth, state: n.state, stateText: n.stateText, first: n.depth === 0,
          how: n.depth ? 'from ' + from + (n.via ? ' · ' + n.via : '') : 'where the flow starts',
          apisText: n.noSheet ? 'no technical sheet' : n.apis + (n.apis === 1 ? ' API' : ' APIs') + (n.writes ? ' (' + n.writes + ' change data)' : '') + (n.apis ? ' · ' + n.passed + ' passed' : ''),
          pct: n.apis ? Math.round((100 * n.passed) / n.apis) : (n.state === 'ok' ? 100 : 0),
          also: (n.also || []).map((x) => (byId[x] ? byId[x].label : x.split('/').pop())).join(', '),
          scens: (n.scenarios || []).map((x) => x.name + ' — ' + ({ ok: 'passed', bad: 'failed', notrun: 'not run yet' }[x.state] || x.state)).join('\n'),
          nScens: (n.scenarios || []).length, noSheet: !!n.noSheet, leaf: n.depth > 0 && !(n.next || []).length,
          pathText: (n.path || []).map((x) => (byId[x] ? byId[x].label : x)).join(' → ') });
      });
      return cols.filter(Boolean);
    }
    /** The flow's headline: how far it is tested, and what is left. */
    flowHead(flow) {
      const s = flow && flow.summary;
      if (!s) return { text: '', pct: 0, done: false, left: '' };
      const pct = s.apis ? Math.round((100 * s.passed) / s.apis) : (s.pages && s.tested === s.pages ? 100 : 0);
      const parts = [s.pages + (s.pages === 1 ? ' page' : ' pages'), s.tested + ' tested'];
      if (s.failed) parts.push(s.failed + ' failed');
      parts.push(s.passed + ' of ' + s.apis + ' APIs passed');
      const left = s.complete ? 'Every page of the flow has passed: its testing is complete.'
        : s.pages <= 1 ? 'This page leads to no other page in the code: its own APIs are the whole flow.'
          : 'Testing is complete when every page of the flow has passed' + (s.untested ? ' — ' + s.untested + ' not tested yet' : '') + '.';
      return { text: parts.join(' · '), pct, done: !!s.complete, left, paths: s.paths || 0, cut: flow.cut || 0 };
    }
    /** The APIs dialog: every API of the page, in the order the page makes them, each marked with its step here (or Add). */
    jaApis(ja, sc) {
      if (!ja || !ja.apis) return [];
      const at = {};
      ((sc && sc.steps) || []).forEach((st, i) => { if ((st.page || sc.page) !== ja.page) return; const k = st.report ? 'report:' + (st.report.name || '') : st.endpoint; if (!at[k]) at[k] = String(i + 1); });
      const ROLE = { list: 'list of values', opens: 'as the page opens', next: 'when you go on', other: 'elsewhere on the page', transport: 'BI Publisher service' };
      return ja.apis.slice().sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0)).map((a, i) => {
        const st = a.step || {};
        const m = st.report ? 'REPORT' : ((st.api && st.api.method) || 'CALL');
        return { key: a.key, n: String(i + 1), method: m, mclass: m.toLowerCase(), name: st.name, path: st.report ? st.report.path : ((st.api && st.api.path) || st.endpoint),
          role: a.field ? a.field + ' · ' + ROLE.list : (ROLE[a.role] || ''), roleKey: a.role || 'other', writes: !!st.writes, transport: a.role === 'transport',
          step: at[a.key] || '', inScenario: !!at[a.key] };
      });
    }
    apiRows(apis, q, tries, sc, open, vals) {
      const t = String(q || '').trim().toLowerCase();
      const inSc = {};
      ((sc && sc.steps) || []).forEach((st) => { inSc[st.report ? 'report:' + (st.report.name || '') : st.endpoint] = true; });
      const ROLE = { list: 'a list of values', opens: 'runs as the page opens', next: 'runs when you go on', other: 'used elsewhere on the page', transport: 'BI Publisher\'s SOAP service' };
      return (apis || []).filter((a) => !t || (a.key + ' ' + a.step.name + ' ' + (a.field || '') + ' ' + ((a.step.api && a.step.api.path) || '')).toLowerCase().indexOf(t) !== -1).map((a) => {
        const st = a.step;
        const m = st.report ? 'REPORT' : ((st.api && st.api.method) || 'CALL');
        const tr = tries && tries[a.key];
        const acc = st.accepts || [];
        return { key: a.key, transport: a.role === 'transport', runsNote: a.role === 'transport' ? 'Runs the reports below: ' + (a.runs || []).join(', ') + ' — test them there' : '',
          method: m, mclass: m.toLowerCase(), name: st.name, path: st.report ? st.report.path : ((st.api && st.api.path) || st.endpoint),
          where: (a.field ? a.field + ' (' + ROLE.list + ')' : ROLE[a.role] || '') + (a.actions && a.actions.length ? ' · ' + a.actions.join(', ') : '') + (a.when ? ' · only when ' + a.when.slice(0, 80) : ''),
          inScenario: !!inSc[a.key], open: open === a.key,
          params: vals && vals[a.key] !== undefined ? vals[a.key] : linesOf(st.params, '='),
          hint: st.report ? 'Values sent (P_NAME = value): ' + (Object.keys(st.params || {}).join(', ') || 'none in the code') : 'Values sent (name = value)' + (acc.length ? ' — it accepts: ' + acc.map((x) => x.name + (x.required ? ' (needed)' : '')).join(', ') : ''),
          tried: tr ? { state: tr.state, icon: tr.state === 'ok' ? '✓' : tr.state === 'fail' ? '✗' : '–', head: tr.status ? tr.status + ' · ' + tr.ms + ' ms' + (tr.rows != null ? ' · ' + tr.rows + ' row(s)' : '') : 'not sent',
            url: tr.request ? tr.request.method + ' ' + tr.request.url : '', note: tr.note || '', values: tr.values && tr.lov ? tr.lov.total + ' value(s): ' + tr.values.slice(0, 8).map((v) => v.text + (v.sub ? ' (' + v.sub + ')' : '')).join(', ') : '', answer: tr.answer || '' } : null };
      });
    }
    /** The page's counts, as Application pages shows them. */
    overviewTiles(info) {
      const o = (info && info.overview) || {};
      return [[o.rest, 'REST calls'], [o.chains, 'action chains'], [o.modules, 'rules modules'], [o.reports, 'BI reports'], [o.actions, 'actions']].filter((x) => x[0] !== undefined).map((x) => ({ n: String(x[0]), what: x[1] }));
    }
    /** Under the choices: how the page starts (its opening chain), and what a choice does. */
    choiceNote(choices) {
      const starts = (choices || []).filter((c) => c.start).map((c) => c.field + ' starts as ' + ((c.values.filter((x) => x.key === c.start)[0] || {}).text || c.start) + (c.startFrom ? ' (' + c.startFrom + ')' : ''));
      return 'As on your screen' + (starts.length ? ' — the page: ' + starts.join(', ') : '') + '. A step for a field not shown in the case chosen is skipped when the scenario runs (▶ Run on a step still sends it).';
    }
    apiBar(sc) {
      if (!sc) return 'No scenario open: + Add to scenario starts a new one with that API.';
      return 'Building: ' + sc.name + ' · ' + ((sc.steps || []).length) + ' step(s)' + (sc.id ? '' : ' (not saved yet)') + '. Add the APIs you want, then Suggest order in the scenario.';
    }
    runHead(r) { return !r ? '' : (r.ok ? '✓ Passed' : '✗ Failed') + ' — ' + r.name + ' · ' + r.passed + ' ok, ' + r.failed + ' failed, ' + r.skipped + ' not run · ' + Math.round(r.ms / 100) / 10 + ' s · ' + when(r.at) + (r.by ? ' · ' + r.by : ''); }
    runRows(r) {
      const rows = (r && r.rows) || [];
      return rows.map((row, i) => ({ label: rows.length > 1 ? 'Row ' + (i + 1) + ': ' + Object.keys(row.vars || {}).map((k) => k + '=' + row.vars[k]).join(', ') : '',
        steps: (row.steps || []).map((s) => ({ name: s.name, call: s.call, state: s.state, icon: s.state === 'ok' ? '✓' : s.state === 'fail' ? '✗' : '–',
          facts: s.status ? s.status + ' · ' + s.ms + ' ms' + (s.rows != null ? ' · ' + s.rows + ' row(s)' : '') : '', note: s.note || '', checks: s.checks || [],
          values: s.lov && s.values ? s.lov.field + ': ' + s.lov.total + ' value(s) — ' + s.values.slice(0, 6).map((v) => v.text || v.key).join(', ') + (s.lov.total > 6 ? ', …' : '') : '',
          handed: Object.keys(s.extracted || {}).map((k) => k + ' = ' + s.extracted[k]).join(', '), answer: s.answer || '', url: s.request ? s.request.method + ' ' + s.request.url : 'Its answer' })) }));
    }
    runList(runs) { return (runs || []).map((h) => ({ id: h.id, ok: h.ok, icon: h.ok ? '✓' : '✗', name: h.name, counts: h.passed + ' ok · ' + h.failed + ' failed · ' + h.skipped + ' not run · ' + Math.round(h.ms / 100) / 10 + ' s', when: when(h.at), by: h.by || '' })); }
  }
  return PageModule;
});
