define(['resources/js/shellBus'], (bus) => {
  'use strict';

  // API Scenarios: binding helpers (the chains do the work through resources/js/scenarioClient.js). None uses `this`.
  const KINDS = [['happy', 'Happy path'], ['edge', 'Edge case'], ['role', 'Role'], ['data', 'Data-driven']];
  const linesOf = (obj, sep) => Object.keys(obj || {}).map((k) => k + ' ' + sep + ' ' + obj[k]).join('\n');
  const when = (iso) => { try { const d = new Date(iso); return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) + ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }); } catch (e) { return iso || ''; } };

  class PageModule {
    constructor(context) {
      // opened on one page (Application pages → API on a page): its scenarios shown
      const helper = context && typeof context.getEventHelper === 'function' ? context.getEventHelper() : null;
      try { bus.onFocus('api-scenarios', () => { if (helper) helper.fireCustomEvent('focusRequest', {}); }); } catch (e) { /* no shell */ }
    }
    pagesShown(pages, q) {
      const t = String(q || '').trim().toLowerCase();
      return (pages || []).filter((p) => !p.deleted && (!t || (p.label + ' ' + p.id).toLowerCase().indexOf(t) !== -1)).slice(0, 400);
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
    stepRows(sc) {
      return ((sc && sc.steps) || []).map((st, i) => {
        const ex = st.expect || {};
        return { id: st.id, n: i + 1, name: st.name, call: st.report ? 'report ' + st.report.path : st.endpoint, writes: !!st.writes,
          params: linesOf(st.params, '='), extract: (st.extract || []).map((e) => e.var + ' = ' + e.from).join('\n'),
          paramHint: st.report ? 'P_CUSTOMER_ID = {{CustomerId}}' : 'ProjectId = {{ProjectId}}',
          status: ex.status || '2xx', minRows: ex.minRows == null ? '' : String(ex.minRows), maxMs: ex.maxMs == null ? '' : String(ex.maxMs), sameShape: !!ex.sameShape,
          fields: (ex.fields || []).map((f) => f.path + (f.equals === null || f.equals === undefined ? '' : ' = ' + f.equals)).join('\n'),
          hasBody: !!st.body || !!st.writes, body: st.body || '' };
      });
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
    runHead(r) { return !r ? '' : (r.ok ? '✓ Passed' : '✗ Failed') + ' — ' + r.name + ' · ' + r.passed + ' ok, ' + r.failed + ' failed, ' + r.skipped + ' not run · ' + Math.round(r.ms / 100) / 10 + ' s · ' + when(r.at) + (r.by ? ' · ' + r.by : ''); }
    runRows(r) {
      const rows = (r && r.rows) || [];
      return rows.map((row, i) => ({ label: rows.length > 1 ? 'Row ' + (i + 1) + ': ' + Object.keys(row.vars || {}).map((k) => k + '=' + row.vars[k]).join(', ') : '',
        steps: (row.steps || []).map((s) => ({ name: s.name, call: s.call, state: s.state, icon: s.state === 'ok' ? '✓' : s.state === 'fail' ? '✗' : '–',
          facts: s.status ? s.status + ' · ' + s.ms + ' ms' + (s.rows != null ? ' · ' + s.rows + ' row(s)' : '') : '', note: s.note || '', checks: s.checks || [],
          handed: Object.keys(s.extracted || {}).map((k) => k + ' = ' + s.extracted[k]).join(', '), answer: s.answer || '', url: s.request ? s.request.method + ' ' + s.request.url : 'Its answer' })) }));
    }
    runList(runs) { return (runs || []).map((h) => ({ id: h.id, ok: h.ok, icon: h.ok ? '✓' : '✗', name: h.name, counts: h.passed + ' ok · ' + h.failed + ' failed · ' + h.skipped + ' not run · ' + Math.round(h.ms / 100) / 10 + ' s', when: when(h.at), by: h.by || '' })); }
  }
  return PageModule;
});
