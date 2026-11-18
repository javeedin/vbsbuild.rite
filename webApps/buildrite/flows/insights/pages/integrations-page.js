define(['resources/js/integrationDiagram', 'resources/js/integrationReport'], (D, R) => {
  'use strict';

  // Integrations: binding helpers (intChain does the work through resources/js/pagesClient.js). No function uses `this`.
  const words = (q) => String(q || '').toLowerCase().split(/\s+/).filter(Boolean);
  const hit = (q, parts) => { const w = words(q); const hay = parts.join(' ').toLowerCase(); return w.every((x) => hay.indexOf(x) !== -1); };
  const kindColor = (k) => (D.KINDS[k] || D.KINDS.rest).color;
  const n = (x, one, many) => x + ' ' + (x === 1 ? one : (many || one + 's'));

  function diagram(m, kind, sys, page) {
    if (!m || !m.ok) return null;
    if (kind === 'system') return D.system(m, sys || (m.systems[0] && m.systems[0].id));
    if (kind === 'page') return D.page(m, page || ((m.pages.filter((p) => p.calls)[0] || {}).id));
    return D.landscape(m);
  }

  class PageModule {
    // ── the scan in figures ──
    when(m) { return m && m.at ? R.when(m.at) + (m.by ? ' by ' + m.by : '') : ''; }
    kpis(m) {
      if (!m || !m.ok) return [];
      const t = m.totals;
      const out = [
        { key: 'systems', n: String(t.systems), label: t.systems === 1 ? 'system it talks to' : 'systems it talks to' },
        { key: 'endpoints', n: String(t.endpoints), label: t.endpoints === 1 ? 'endpoint' : 'endpoints' },
        { key: 'calls', n: String(t.calls), label: (t.calls === 1 ? 'call' : 'calls') + ' (page × endpoint)' },
        { key: 'pages', n: t.pagesWith + ' / ' + t.pages, label: 'pages with integrations' },
        { key: 'reads', n: String(t.reads), label: t.reads === 1 ? 'read' : 'reads' },
        { key: 'writes', n: String(t.writes), label: t.writes === 1 ? 'write (changes data)' : 'writes (change data)' },
        { key: 'reports', n: String(t.reports), label: t.reports === 1 ? 'BI Publisher report' : 'BI Publisher reports' }
      ];
      if (t.unresolved) out.push({ key: 'unresolved', n: String(t.unresolved), label: 'not in services/', tone: 'bad' });
      return out;
    }
    kpiClass(k) { return 'nx-int-kpi' + (k.tone ? ' nx-int-kpi--' + k.tone : ''); }
    /** Each system as a bar: its reads, writes and reports (widths of the busiest system's calls). */
    systemBars(m) {
      if (!m || !m.ok) return [];
      const max = m.systems.reduce((a, s) => Math.max(a, s.calls), 1);
      const w = (x) => (x ? Math.max(1.5, (x / max) * 100) : 0) + '%';
      return m.systems.map((s) => ({ id: s.id, name: s.name, kindLabel: s.kindLabel, color: kindColor(s.kind), host: s.host,
        segs: [['read', s.reads, 'reads'], ['write', s.writes, 'writes'], ['report', s.reports, 'reports']].filter((x) => x[1]).map((x) => ({ cls: 'nx-int-seg nx-int-seg--' + x[0], w: w(x[1]), n: x[1], tip: x[1] + ' ' + x[2] })),
        text: D.figures(s) + ' · ' + n(s.pages.length, 'page') }));
    }
    dotStyle(kind) { return { background: kindColor(kind) }; }
    appOptions(m) { return ((m && m.apps) || []).map((a) => ({ id: a.app, text: a.app + ' (' + a.pages + ' pages)', on: m.app === a.app })); }

    // ── the data sheet ──
    systemOptions(m, sel, all) { return [{ id: '', text: all || 'Every system', on: !sel }].concat(((m && m.systems) || []).map((s) => ({ id: s.id, text: s.name + ' (' + s.calls + ')', on: s.id === sel }))); }
    flowOptions(m, sel) { return [{ id: '', text: 'Every flow', on: !sel }].concat(((m && m.flows) || []).filter((f) => f.calls).map((f) => ({ id: f.flow, text: f.flow + ' (' + f.calls + ')', on: f.flow === sel }))); }
    dirChips(m, cur) {
      const rows = (m && m.rows) || [];
      return [['all', 'All ' + rows.length], ['Read', 'Read ' + rows.filter((r) => r.direction === 'Read').length], ['Write', 'Write ' + rows.filter((r) => r.direction === 'Write').length], ['Report', 'Report ' + rows.filter((r) => r.direction === 'Report').length]]
        .map((c) => ({ key: c[0], text: c[1], cls: 'nx-sc-chip' + ((cur || 'all') === c[0] ? ' nx-sc-chip--on' : '') }));
    }
    sheetAll(m, q, sys, dir, flow) {
      return ((m && m.rows) || []).filter((r) => (!sys || r.system === sys) && (!flow || r.flow === flow) && (!dir || dir === 'all' || r.direction === dir)
        && (!q || hit(q, [r.id, r.pageLabel, r.page, r.flow, r.trigger, r.systemName, r.method, r.path, r.endpoint, r.summary, (r.via || []).join(' '), (r.params || []).join(' '), r.report])));
    }
    sheetRows(m, q, sys, dir, flow, limit) { return PageModule.prototype.sheetAll(m, q, sys, dir, flow).slice(0, limit || 200); }
    sheetCount(m, q, sys, dir, flow, limit) {
      const all = PageModule.prototype.sheetAll(m, q, sys, dir, flow).length;
      return Math.min(all, limit || 200) + ' shown of ' + all + (all !== ((m && m.rows) || []).length ? ' (of ' + m.rows.length + ' in all)' : '');
    }
    hasMore(m, q, sys, dir, flow, limit) { return PageModule.prototype.sheetAll(m, q, sys, dir, flow).length > (limit || 200); }
    dirClass(d) { return 'nx-int-dir nx-int-dir--' + String(d || '').toLowerCase(); }
    methodText(r) { return r.method || ''; }
    endpointNote(r) { return r.endpoint + (r.report ? ' · report ' + r.report : '') + ((r.params || []).length ? ' · sends ' + r.params.join(', ') : ''); }

    // ── endpoints, systems ──
    endpointRows(m, q, sys) {
      return ((m && m.endpoints) || []).filter((e) => (!sys || e.system === sys) && (!q || hit(q, [e.endpoint, e.path, e.summary, e.systemName, e.pageLabels.join(' ')])));
    }
    systemCards(m) { return ((m && m.systems) || []).map((s) => Object.assign({}, s, { color: kindColor(s.kind), figures: D.figures(s), pagesText: n(s.pages.length, 'page'), servicesText: s.services.join(', ') })); }

    // ── diagrams ──
    diaChips(cur) { return [['landscape', 'Landscape'], ['system', 'A system'], ['page', 'A page']].map((c) => ({ key: c[0], text: c[1], cls: 'nx-sc-chip' + (cur === c[0] ? ' nx-sc-chip--on' : '') })); }
    pageOptions(m, sel) {
      const ps = ((m && m.pages) || []).filter((p) => p.calls);
      const cur = sel || (ps[0] && ps[0].id);
      return ps.map((p) => ({ id: p.id, text: p.label + ' — ' + p.flow + ' (' + p.calls + ')', on: p.id === cur }));
    }
    diaDoc(m, kind, sys, page) { const d = diagram(m, kind, sys, page); return d ? D.doc(d) : ''; }
    /** The frame keeps the diagram's proportions at any width. */
    diaStyle(m, kind, sys, page) { const d = diagram(m, kind, sys, page); return d && d.w ? { aspectRatio: d.w + ' / ' + d.h } : {}; }
    diaTitle(m, kind, sys, page) {
      const d = diagram(m, kind, sys, page);
      if (!d) return '';
      return kind === 'system' ? 'System: ' + d.title + ' — the pages that call it, its endpoints, and it' : kind === 'page' ? 'Page: ' + d.title + ' — what it calls and where' : 'The app\'s flows (the source) and the systems they call (the target)';
    }
  }
  return PageModule;
});
