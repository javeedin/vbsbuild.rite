define(['resources/js/shellBus', 'resources/js/codeFixView', 'resources/js/codeView', 'resources/js/crKnowledge'], (bus, CFV, CV, K) => {
  'use strict';

  // Change requests: binding helpers (crChain does the work through resources/js/codeFixClient.js). The list's groups:
  // New (nothing asked yet) · In progress (a proposal, questions, applied…) · Fixed (its change saved) · On hold · Closed
  // (closed or rejected).
  const KINDS = [['fix', 'Fix a bug'], ['enhance', 'Enhance'], ['change', 'Change'], ['page', 'New page']];
  const PRIORITIES = [['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['urgent', 'Urgent']];
  const STATES = [['open', 'Open'], ['hold', 'On hold'], ['closed', 'Closed'], ['rejected', 'Rejected']];
  const CHIPS = [['all', 'All'], ['new', 'New'], ['progress', 'In progress'], ['fixed', 'Fixed'], ['hold', 'On hold'], ['closed', 'Closed']];
  const groupOf = (r) => {
    const s = r && r.status;
    if (s === 'fixed') return 'fixed';
    if (s === 'hold') return 'hold';
    if (s === 'closed' || s === 'rejected') return 'closed';
    if (!s || s === 'new') return 'new';
    return 'progress';
  };
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const dayText = (d) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(d || '')); return m ? Number(m[3]) + ' ' + MON[Number(m[2]) - 1] + ' ' + m[1] : ''; };
  const opts = (list, sel) => list.map((x) => ({ id: x[0], label: x[1], on: x[0] === sel }));
  const canAsk = (cr) => !!(cr && cr.page && String(cr.request || cr.title || '').trim());
  const kebab = (t) => String(t || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').replace(/^(\d)/, 'p-$1').slice(0, 60);
  const pageLabel = (pages, id) => { const p = (pages || []).filter((x) => x && x.id === id)[0]; return p ? String(p.label || p.id) : String(id || '').split('/').pop(); };

  class PageModule {
    constructor(context) {
      // every tab of this screen hears a change request saved or removed elsewhere (the list reads them again)
      const helper = context && typeof context.getEventHelper === 'function' ? context.getEventHelper() : null;
      const me = 'change-requests-' + (++PageModule.seq);
      try { bus.on('change-requests-changed', me, () => { if (helper) helper.fireCustomEvent('crChanged', {}); }); } catch (e) { /* no shell */ }
    }

    // ── the list ──
    groupOf(r) { return groupOf(r); }
    listChips(all, cur) {
      const list = all || [];
      return CHIPS.map((c) => {
        const n = c[0] === 'all' ? list.length : list.filter((r) => groupOf(r) === c[0]).length;
        return { key: c[0], text: c[1] + ' ' + n, cls: 'nx-sc-chip' + ((cur || 'all') === c[0] ? ' nx-sc-chip--on' : '') };
      });
    }
    listRows(all, q, status) {
      const words = String(q || '').toLowerCase().split(/\s+/).filter(Boolean);
      return (all || []).filter((r) => (!status || status === 'all' || groupOf(r) === status) && (!words.length || words.every((w) => [r.code, r.title, r.page, r.pageLabel, r.request, r.customer,
        r.requestedBy, r.fixedByShown, r.jira, r.issue, r.statusText, r.priorityText, r.kindText].join(' ').toLowerCase().indexOf(w) !== -1)))
        .map((r) => ({
          id: r.id, code: r.code || 'new', title: r.title || String(r.request || '').slice(0, 80) || '(no title)', page: r.page, pageLabel: r.pageLabel || String(r.page || '').split('/').pop(),
          kindPri: r.kindText + ' · ' + r.priorityText + ' priority', priority: r.priority, customer: r.customer || '—',
          by: (r.requestedBy || '—') + (r.requestedOn ? ' · ' + dayText(r.requestedOn) : ''),
          refs: [r.jira, r.issue].filter(Boolean).join(' · ') || '—',
          status: r.status, statusText: r.statusText + (r.overdue ? ' · overdue' : ''), overdue: !!r.overdue,
          fixed: r.fixedOnShown ? dayText(r.fixedOnShown) + (r.fixedByShown ? ' · ' + r.fixedByShown : '') : (r.dueOn ? 'due ' + dayText(r.dueOn) : '—'),
          updated: CFV.when(r.updatedAt) + (r.updatedBy ? ' · ' + r.updatedBy : '')
        }));
    }
    statusClass(key, overdue) { return 'nx-cr-status nx-cr-status--' + (key || 'new') + (overdue ? ' nx-cr-status--late' : ''); }
    priClass(p) { return 'nx-cr-pri nx-cr-pri--' + (p || 'medium'); }

    // ── one change request ──
    pageOptions(pages, sel) {
      const list = (pages || []).map((p) => ({ id: p.id, text: (p.label || p.id) + ' — ' + p.id, on: p.id === sel }));
      return [{ id: '', text: 'Pick the page…', on: !sel }].concat(list);
    }
    pageLabel(pages, id) { const p = (pages || []).filter((x) => x && x.id === id)[0]; return p ? String(p.label || p.id) : String(id || '').split('/').pop(); }
    kinds(sel) { return opts(KINDS, sel || 'change'); }
    priorities(sel) { return opts(PRIORITIES, sel || 'medium'); }
    states(sel) { return opts(STATES, sel || 'open'); }
    tabClass(t, cur) { return 'nx-sc-tab' + (t === cur ? ' nx-sc-tab--on' : ''); }
    headTitle(cr) { return !cr ? 'Change request' : (cr.code ? cr.code + ' · ' : '') + (cr.title || (cr.request ? String(cr.request).split('\n')[0].slice(0, 70) : (cr.code ? 'Change request' : 'New change request'))); }
    madeText(cr) { return !cr || !cr.createdAt ? 'not saved yet' : CFV.when(cr.createdAt) + (cr.createdBy ? ' · ' + cr.createdBy : ''); }
    updatedText(cr) { return !cr || !cr.updatedAt ? '—' : CFV.when(cr.updatedAt) + (cr.updatedBy ? ' · ' + cr.updatedBy : ''); }
    fixedText(cr) { return cr && cr.fixedOnShown && !cr.fixedOn ? 'From its saved change: ' + dayText(cr.fixedOnShown) + (cr.fixedByShown ? ' by ' + cr.fixedByShown : '') : ''; }
    histRows(cr) { return ((cr && cr.events) || []).slice().reverse().map((e) => ({ when: CFV.when(e.at), what: e.what, by: e.by || '', note: e.note || '' })); }
    /** What the Code fix tab will ask the AI: the request, with its kind and references. */
    askText(cr) { return !cr ? '' : (cr.request || cr.title || ''); }
    canAsk(cr) { return !!(cr && cr.page && String(cr.request || cr.title || '').trim()); }
    /** From Request: a new attempt only when none is under way (a proposal waiting, or applied) — else it is in Code fix. */
    canAskNew(cr, fix) { return canAsk(cr) && !(fix && /^(proposed|questions|stale|applied)$/.test(fix.status)); }
    askFacts(cr, pages) {
      if (!cr) return '';
      const kind = { fix: 'Fix a bug', enhance: 'Enhance', change: 'Change' }[cr.kind] || 'Change';
      const refs = [cr.jira ? 'Jira ' + cr.jira : '', cr.issue ? 'issue ' + cr.issue : (cr.code ? 'issue ' + cr.code : '')].filter(Boolean);
      return (cr.page ? 'Page: ' + pageLabel(pages, cr.page) + ' (' + cr.page + ')' : 'No page picked yet') + ' · ' + kind + (refs.length ? ' · written into the code with it: ' + refs.join(', ') : '');
    }

    // ── its Code Fix (resources/js/codeFixView.js: shown the same as Application pages → Code fix) ──
    fixStatus(s) { return CFV.status(s); }
    fixStatusClass(s) { return CFV.statusClass(s); }
    fixFolder(i) { return CFV.folder(i); }
    fixInWs(f) { return CFV.inWs(f); }
    fixMeta(f) { return CFV.meta(f); }
    fixDoc(text) { return CFV.doc(text); }
    fixStats(f) { return CFV.stats(f); }
    fixLine(t) { return CFV.line(t); }
    fixSign(t) { return CFV.sign(t); }
    fixCheck(c) { return CFV.check(c); }
    fixCheckClass(c) { return CFV.checkClass(c); }
    fixCheckText(c) { return CFV.checkText(c); }
    fixChecksOk(list) { return CFV.checksOk(list); }
    fixUnit(u) { return CFV.unit(u); }
    fixUnitClass(u) { return CFV.unitClass(u); }
    fixTestsText(t) { return CFV.testsText(t); }
    fixTestsCount(t) { return CFV.testsCount(t); }
    fixApproveText(f, i) { return CFV.approveText(f, i); }
    fixAppliedText(f) { return CFV.appliedText(f); }
    fixAppliedSub(f) { return CFV.appliedSub(f); }
    fixTryText(f, canRun) { return CFV.tryText(f, '', canRun); }
    fixKeepText(f, i) { return CFV.keepText(f, i); }
    fixCommittedText(f) { return CFV.committedText(f); }
    fixCanApply(f) { return CFV.canApply(f); }
    fixListText(x) { return CFV.listText(x); }
    attemptClass(id, cur) { return 'nx-cr-attempt' + (cur && cur.id === id ? ' nx-cr-attempt--on' : ''); }

    // ── How it was fixed: the story, the steps, and the code in full with the change marked ──
    story(f, cr) { return CFV.story(f, cr); }
    steps(f) { return CFV.steps(f); }
    storyClass(s) { return 'nx-cr-story' + (s.tone ? ' nx-cr-story--' + s.tone : ''); }
    proofTiles(f) {
      if (!f) return [];
      const d = f.diff || [];
      const t = f.tests;
      const cs = (t && t.checks) || f.checks || [];
      const ok = cs.filter((c) => c.ok || c.already).length;
      const tiles = [
        { k: 'files', n: String(d.length), what: d.length === 1 ? 'file changed' : 'files changed' },
        { k: 'add', n: '+' + d.reduce((n, x) => n + x.added, 0), what: 'lines added' },
        { k: 'del', n: '−' + d.reduce((n, x) => n + x.removed, 0), what: 'lines taken away' },
        { k: 'checks', n: ok + '/' + cs.length, what: t ? (t.ok ? 'checks passed — nothing broke' : 'checks — something broke') : 'checks on the proposal' }
      ];
      if (t && (t.unit || []).length) tiles.push({ k: 'unit', n: String(t.unit.filter((u) => u.ok || !u.newFailures.length).length) + '/' + t.unit.length, what: 'related test files' });
      if (f.commit) tiles.push({ k: 'commit', n: f.commit.sha, what: f.commit.pushed ? 'commit, pushed' : 'commit, on this PC' });
      return tiles;
    }
    tileClass(t) { return 'nx-cr-tile nx-cr-tile--' + t.k; }
    codeFiles(code) { return (code && code.files) || []; }
    fileClass(code, file) { return 'nx-cr-file' + (code && code.file === file ? ' nx-cr-file--on' : ''); }
    viewClass(v, cur) { return 'nx-sc-chip' + (v === cur ? ' nx-sc-chip--on' : ''); }
    codeRegions(code, view) { return !code ? [] : (view === 'before' ? code.beforeRegions : code.regions) || []; }
    /** The file in full (after the change, or as it was), its changes marked and the one gone to outlined. */
    codeDoc(code, view, at) {
      if (!code) return '';
      const before = view === 'before';
      return CV.doc(before ? code.before : code.after, code.file, '', { regions: before ? code.beforeRegions : code.regions }, at);
    }
    codeAtText(code, view, at) {
      const n = !code ? 0 : ((view === 'before' ? code.beforeRegions : code.regions) || []).length;
      return n ? 'Change ' + (Math.min(at, n - 1) + 1) + ' of ' + n : 'No change in this file';
    }
    codeHead(code, view) {
      if (!code) return '';
      const lines = (view === 'before' ? code.before : code.after).split('\n').length;
      return (view === 'before' ? (code.created ? 'A new file: there was nothing before.' : 'As it was before the change — ' + lines + ' lines; what was taken away or replaced is struck through in red, a green line marks where lines were put in.')
        : 'With the change — ' + lines + ' lines (+' + code.added + ' −' + code.removed + '); added lines green, changed amber, a red line where lines were taken away.') + ' From ' + code.from + '.';
    }
    fileDiff(f, file) { return ((f && f.diff) || []).filter((d) => d.file === file); }

    // ── a new page: what it is, where it goes in the menu, how the app links it (learnt from its code) ──
    npOf(cr) { return (cr && cr.newPage) || {}; }
    flowOptions(mi, sel) { return ((mi && mi.flows) || []).map((f) => ({ id: f.flow, text: f.flow + ' (' + f.pages.length + ' pages)', on: f.flow === sel })); }
    groupOptions(mi, sel) {
      const gs = ((mi && mi.menu && mi.menu.groups) || []).map((g) => ({ id: g.key, text: g.label + ' (' + g.items.length + ')', on: g.key === sel }));
      return [{ id: '', text: 'Not in the menu (opened from another page)', on: !sel }].concat(gs);
    }
    afterOptions(mi, group, sel) {
      const g = ((mi && mi.menu && mi.menu.groups) || []).filter((x) => x.key === group)[0];
      const items = g ? g.items : [];
      const cur = sel || (items.length ? items[items.length - 1].id : '');
      return items.map((it) => ({ id: it.id, text: 'after ' + it.label, on: it.id === cur }));
    }
    iconOptions(mi) { const seen = {}; ((mi && mi.menu && mi.menu.groups) || []).forEach((g) => g.items.forEach((it) => { if (it.icon) seen[it.icon] = true; })); return Object.keys(seen).sort(); }
    npName(cr) { const np = (cr && cr.newPage) || {}; return np.name || kebab(np.title); }
    npFiles(cr) {
      const np = (cr && cr.newPage) || {};
      const name = np.name || kebab(np.title);
      if (!name || !np.flow) return 'Give it a title and a flow: its files are named after it.';
      return 'Its files: flows/' + np.flow + '/pages/' + name + '-page.html, .js, .json (+ its chains).';
    }
    menuSummary(mi) {
      if (!mi) return '';
      if (!mi.menu || !mi.menu.found) return 'Build.Rite found no menu definition in the app: the new page is registered in its flow, and the AI is told how the page it is like is linked.';
      const n = mi.menu.groups.reduce((a, g) => a + g.items.length, 0);
      return 'Your app\'s menu is in ' + mi.menu.file + ': ' + mi.menu.groups.length + ' groups, ' + n + ' items.';
    }
    placesNeeded(mi) { return ((mi && mi.places) || []).filter((p) => p.needed); }
    placesLinks(mi) { return ((mi && mi.places) || []).filter((p) => !p.needed); }
    placeLines(p) { return (p.lines || []).map((l) => 'line ' + l.n + ': ' + l.text).join('\n'); }
    refText(mi) { return !mi || !mi.ref ? '' : 'A page in the menu is registered in these places (as ' + (mi.ref.label || mi.ref.page) + ' is' + (mi.ref.group ? ', under ' + mi.ref.group : '') + ') — the new page is added to each, the same way:'; }

    // ── the knowledge base: an FDD's sections (functional and technical), the person's notes ──
    fddOptions(lib, sel) { return [{ id: '', text: lib && lib.length ? 'Choose an FDD…' : 'No FDD in the library yet (Application → FDD library)', on: !sel }].concat((lib || []).map((d) => ({ id: d.id, text: d.name + (d.version ? ' v' + d.version : '') + ' · ' + (d.sections || 0) + ' sections', on: d.id === sel }))); }
    kbRows(doc, kb, filter, q) { return K.outline(doc, (kb && kb.sections) || [], filter, q); }
    kbChips(doc, kb, cur) {
      const all = K.outline(doc, (kb && kb.sections) || [], 'all', '');
      const tech = all.filter((r) => r.tech).length;
      return [['all', 'All ' + all.length], ['functional', 'Functional ' + (all.length - tech)], ['technical', 'Technical ' + tech]].map((c) => ({ key: c[0], text: c[1], cls: 'nx-sc-chip' + ((cur || 'all') === c[0] ? ' nx-sc-chip--on' : '') }));
    }
    kbRowClass(r) { return 'nx-cr-kbrow nx-cr-kbrow--l' + Math.min(4, r.l) + (r.on ? ' nx-cr-kbrow--on' : ''); }
    kbText(doc, kb) { return K.text(doc, (kb && kb.sections) || [], kb && kb.notes); }
    kbSummary(kb, doc) { return K.summary(kb, doc); }
    kbHas(kb) { return !!(kb && (((kb.sections || []).length) || String(kb.notes || '').trim())); }
  }
  PageModule.seq = 0;
  return PageModule;
});
