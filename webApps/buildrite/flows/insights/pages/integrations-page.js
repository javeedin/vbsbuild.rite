define(['resources/js/integrationDiagram', 'resources/js/integrationReport'], (D, R) => {
  'use strict';

  // Integrations: binding helpers (intChain does the work through resources/js/pagesClient.js). No function uses `this`.
  const words = (q) => String(q || '').toLowerCase().split(/\s+/).filter(Boolean);
  const hit = (q, parts) => { const w = words(q); const hay = parts.join(' ').toLowerCase(); return w.every((x) => hay.indexOf(x) !== -1); };
  const kindColor = (k) => (D.KINDS[k] || D.KINDS.rest).color;
  const n = (x, one, many) => x + ' ' + (x === 1 ? one : (many || one + 's'));
  /** A row's object key matches an interface's: the same, or one of the reports a row runs. */
  const objMatch = (rk, k) => rk === k || (/^report:/.test(rk) && /^report:/.test(k) && rk.slice(7).split(',').indexOf(k.slice(7)) !== -1);

  function diagram(m, kind, sys, page) {
    if (!m || !m.ok) return null;
    if (kind === 'systems') return D.systemFlow(m);
    if (kind === 'pages') return D.pages(m);
    if (kind === 'pageflow') return D.pageFlow(m, page || ((m.pageFlows || [])[0] || {}).page);
    if (kind === 'journeys') return D.journeys(m);
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
        { key: 'interfaces', n: String(t.interfaces || 0), label: (t.interfaces === 1 ? 'interface' : 'interfaces') + ' (system × object)' },
        { key: 'journeys', n: String(t.journeys || 0), label: t.journeys === 1 ? 'cross-system flow' : 'cross-system flows' },
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
    /** obj: one business object (an interface's key) — a row running several reports matches each of them. */
    sheetAll(m, q, sys, dir, flow, obj) {
      return ((m && m.rows) || []).filter((r) => (!sys || r.system === sys) && (!flow || r.flow === flow) && (!dir || dir === 'all' || r.direction === dir) && (!obj || objMatch(r.objectKey, obj))
        && (!q || hit(q, [r.id, r.pageLabel, r.page, r.flow, r.trigger, r.systemName, r.method, r.path, r.endpoint, r.summary, r.object, r.action, (r.via || []).join(' '), (r.params || []).join(' '), r.report])));
    }
    sheetRows(m, q, sys, dir, flow, limit, obj) { return PageModule.prototype.sheetAll(m, q, sys, dir, flow, obj).slice(0, limit || 200); }
    sheetCount(m, q, sys, dir, flow, limit, obj) {
      const all = PageModule.prototype.sheetAll(m, q, sys, dir, flow, obj).length;
      return Math.min(all, limit || 200) + ' shown of ' + all + (all !== ((m && m.rows) || []).length ? ' (of ' + m.rows.length + ' in all)' : '');
    }
    hasMore(m, q, sys, dir, flow, limit, obj) { return PageModule.prototype.sheetAll(m, q, sys, dir, flow, obj).length > (limit || 200); }
    targetNote(r) { return [r.object ? r.object + (r.action ? ' (' + r.action + ')' : '') : '', r.kindLabel].filter(Boolean).join(' · '); }
    dirClass(d) { return 'nx-int-dir nx-int-dir--' + String(d || '').toLowerCase(); }
    methodText(r) { return r.method || ''; }
    endpointNote(r) { return r.endpoint + (r.report ? ' · report ' + r.report : '') + ((r.params || []).length ? ' · sends ' + r.params.join(', ') : ''); }

    // ── endpoints, systems ──
    endpointRows(m, q, sys) {
      return ((m && m.endpoints) || []).filter((e) => (!sys || e.system === sys) && (!q || hit(q, [e.endpoint, e.path, e.summary, e.systemName, e.pageLabels.join(' ')])));
    }
    systemCards(m) { return ((m && m.systems) || []).map((s) => Object.assign({}, s, { color: kindColor(s.kind), figures: D.figures(s), pagesText: n(s.pages.length, 'page'), servicesText: s.services.join(', ') })); }

    // ── between systems, not page by page ──
    /** One sentence: how many interfaces, which way the data goes, the cross-system flows. */
    flowsSummary(m) {
      if (!m || !m.ok) return '';
      const t = m.totals, sf = m.systemFlows || [];
      const reads = sf.filter((s) => s.returns.length || s.reports.length).length, writes = sf.filter((s) => s.sends.length).length;
      return n(t.interfaces || 0, 'interface') + ' with ' + n(t.systems, 'system') + ': the app reads from ' + n(reads, 'system') + ' and sends data to ' + n(writes, 'system')
        + '. ' + ((t.journeys || 0) ? n(t.journeys, 'cross-system flow') + ' — ' + n(t.crossActions, 'action') + ' calling two or more systems one after the other.' : 'No single action calls more than one system.');
    }
    ifaceAll(m, q, sys) {
      return ((m && m.interfaces) || []).filter((x) => (!sys || x.system === sys) && (!q || hit(q, [x.id, x.systemName, x.kindLabel, x.object, x.ops.join(' '), x.direction, x.methods.join(' '), x.setOffBy, x.pageLabels.join(' '), x.flows.join(' '), x.endpoints.join(' ')])));
    }
    ifaceRows(m, q, sys) {
      return PageModule.prototype.ifaceAll(m, q, sys).map((x) => ({ id: x.id, system: x.system, kind: x.kind, flowText: R.flowText(x, m.appName || m.app), object: x.object, ops: x.ops.join(', '),
        dirs: x.dirs.map((dd) => ({ text: dd, cls: 'nx-int-dir nx-int-dir--' + dd.toLowerCase() })), methods: x.methods.join(', '), setOffBy: x.setOffBy || '—',
        use: n(x.endpoints.length, 'endpoint') + ' · ' + n(x.calls, 'call') + ' · ' + n(x.pages.length, 'page'), pagesText: x.pageLabels.slice(0, 4).join(', ') + (x.pageLabels.length > 4 ? ' and ' + (x.pageLabels.length - 4) + ' more' : '') }));
    }
    ifaceCount(m, q, sys) { const k = PageModule.prototype.ifaceAll(m, q, sys).length; return k + ' shown of ' + (((m && m.interfaces) || []).length); }
    journeyRows(m, q, sys) {
      return ((m && m.journeys) || []).filter((j) => (!sys || j.steps.some((st) => st.system === sys)) && (!q || hit(q, [j.id, j.path, j.steps.map((st) => st.objects.join(' ')).join(' '), j.actions.map((a) => a.pageLabel + ' ' + a.trigger + ' ' + a.chain).join(' ')])))
        .map((j) => ({ id: j.id, page: (j.actions[0] || {}).page, steps: j.steps.map((st, i) => ({ n: i + 1, name: st.systemName, color: kindColor(st.kind), what: st.direction.toLowerCase() + ': ' + st.objects.slice(0, 3).join(', ') + (st.objects.length > 3 ? ' +' + (st.objects.length - 3) : ''), last: i === j.steps.length - 1 })),
          actions: n(j.actions.length, 'action') + ' · ' + n(j.pages.length, 'page'), where: j.actions.slice(0, 3).map((a) => a.pageLabel + (a.trigger ? ' — ' + a.trigger : '')).join('; ') + (j.actions.length > 3 ? '; and ' + (j.actions.length - 3) + ' more' : '') }));
    }
    handoffRows(m, sys) {
      return ((m && m.handoffs) || []).filter((h) => !sys || h.from === sys || h.to === sys).map((h) => ({ from: h.fromName, to: h.toName, fromColor: kindColor(h.fromKind), toColor: kindColor(h.toKind), actions: n(h.actions, 'action'),
        fromObjects: h.fromObjects.slice(0, 4).join(', ') + (h.fromObjects.length > 4 ? ' +' + (h.fromObjects.length - 4) : ''), toObjects: h.toObjects.slice(0, 4).join(', ') + (h.toObjects.length > 4 ? ' +' + (h.toObjects.length - 4) : ''),
        pages: h.pages.slice(0, 3).join(', ') + (h.pages.length > 3 ? ' and ' + (h.pages.length - 3) + ' more' : '') }));
    }

    /** Two-way switches: [{ key, text, cls }]. */
    viewChips(cur, list) { return list.map((c) => ({ key: c[0], text: c[1], cls: 'nx-sc-chip' + (cur === c[0] ? ' nx-sc-chip--on' : '') })); }
    sfChips(cur) { return PageModule.prototype.viewChips(cur || 'summary', [['summary', 'Summary — by business object'], ['detailed', 'Detailed — flows, pages and endpoints']]); }
    jChips(cur) { return PageModule.prototype.viewChips(cur || 'steps', [['steps', 'Steps'], ['diagram', 'Diagram']]); }
    /** The system shown in detail: the one chosen, else the busiest. */
    sfSystemOf(m, sel) { return sel && ((m && m.systems) || []).some((s) => s.id === sel) ? sel : (((m && m.systems) || [])[0] || {}).id || ''; }

    // ── page by page: each page's integration flow ──
    pageCur(m, sel) { const pf = (m && m.pageFlows) || []; return sel && pf.some((p) => p.page === sel) ? sel : ((pf[0] || {}).page || ''); }
    pageList(m, q, sel) {
      const cur = PageModule.prototype.pageCur(m, sel);
      const sysOf = (id) => ((m && m.systems) || []).filter((s) => s.id === id)[0] || { name: id, kind: 'rest' };
      return ((m && m.pageFlows) || []).filter((p) => !q || hit(q, [p.pageLabel, p.page, p.flow, p.steps.map((st) => st.trigger + ' ' + st.chain).join(' '), p.systems.map((x) => sysOf(x).name).join(' ')]))
        .map((p) => ({ id: p.page, label: p.pageLabel, flow: p.flow, on: p.page === cur, text: p.pageLabel + ' — ' + p.flow + ' (' + n(p.calls, 'call') + ', ' + n(p.steps.length, 'action') + ')',
          dots: p.systems.map((x) => ({ color: kindColor(sysOf(x).kind), name: sysOf(x).name })) }));
    }
    pageListNote(m, q) {
      const all = ((m && m.pageFlows) || []).length, shown = PageModule.prototype.pageList(m, q, '').length, none = m && m.totals ? m.totals.pages - m.totals.pagesWith : 0;
      return (shown === all ? n(all, 'page') + ' with integrations' : shown + ' of ' + all + ' pages') + (none ? ' · ' + n(none, 'page') + (none === 1 ? ' calls' : ' call') + ' no web service' : '');
    }
    pageViewChips(cur) { return PageModule.prototype.viewChips(cur || 'flow', [['flow', 'One page — flow'], ['one', 'One page — details'], ['all', 'All pages → the systems']]); }
    /** The diagram of the page view: its flow (swimlanes) or its details. */
    pageDiaKind(view) { return view === 'one' ? 'page' : 'pageflow'; }
    pageDiaNote(view) {
      return view === 'one' ? 'Details: the page → what sets each call off → its calls, numbered in the order its code makes them → the systems.'
        : 'Flow: a lane for the page and one per system. Each action starts at what sets it off and goes down call by call, each call in the lane of the system it calls; a dark arrow is where it moves on to another system.';
    }
    pageTitle(m, sel) { const p = ((m && m.pageFlows) || []).filter((x) => x.page === PageModule.prototype.pageCur(m, sel))[0]; return p ? p.pageLabel : ''; }
    pageSummary(m, sel) {
      const p = ((m && m.pageFlows) || []).filter((x) => x.page === PageModule.prototype.pageCur(m, sel))[0];
      if (!p) return '';
      const names = p.systems.map((id) => (((m.systems || []).filter((s) => s.id === id)[0]) || { name: id }).name);
      // what sets its actions off, each once (×2 when two actions start the same way)
      const seen = {};
      p.steps.forEach((st) => { const t = st.triggers[0] + (st.triggers.length > 1 ? ' +' + (st.triggers.length - 1) : ''); seen[t] = (seen[t] || 0) + 1; });
      return p.flow + ' · ' + p.page + ' — ' + n(p.calls, 'call') + ' to ' + names.join(', ') + '; ' + n(p.steps.length, 'action') + ' (' + Object.keys(seen).map((t) => t + (seen[t] > 1 ? ' ×' + seen[t] : '')).join('; ') + ')';
    }
    /** Its calls in order, under each action: [{ act, trigger (on the first call of an action), n, method, path, object, system, kind, direction, cls, id, via }]. */
    pageCalls(m, sel) {
      const p = ((m && m.pageFlows) || []).filter((x) => x.page === PageModule.prototype.pageCur(m, sel))[0];
      if (!p) return [];
      const out = [];
      p.steps.forEach((st, si) => st.calls.forEach((c, ci) => out.push({ key: si + '.' + ci, act: ci === 0 ? String(si + 1) : '', trigger: ci === 0 ? st.trigger : '', chain: ci === 0 ? st.chain : '', first: ci === 0, n: String(ci + 1),
        method: c.method, path: c.path || c.endpoint, object: c.object + (c.action ? ' (' + c.action + ')' : ''), system: c.systemName, kind: c.kind, direction: c.direction, cls: 'nx-int-dir nx-int-dir--' + String(c.direction).toLowerCase(), id: c.id, via: c.via ? 'via ' + c.via : '' })));
      return out;
    }

    // ── diagrams ──
    diaChips(cur) { return [['landscape', 'Landscape'], ['systems', 'Between systems'], ['journeys', 'Cross-system flows'], ['pages', 'All pages'], ['system', 'A system'], ['pageflow', 'A page — flow'], ['page', 'A page — details']].map((c) => ({ key: c[0], text: c[1], cls: 'nx-sc-chip' + (cur === c[0] ? ' nx-sc-chip--on' : '') })); }
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
      return kind === 'system' ? 'System: ' + d.title + ' — the pages that call it, its endpoints, and it' : kind === 'page' ? 'Page: ' + d.title + ' — what sets each call off, its calls in order, the systems'
        : kind === 'systems' ? 'Between systems: what the app sends each system, what each returns, its reports — by business object'
          : kind === 'pages' ? 'All pages: each page with integrations and the systems it calls, by flow'
            : kind === 'pageflow' ? 'Page: ' + d.title + ' — in swimlanes, system by system'
          : kind === 'journeys' ? 'Cross-system flows: each action that calls two or more systems, in the order its code calls them' : 'The app\'s flows (the source) and the systems they call (the target)';
    }
  }
  return PageModule;
});
