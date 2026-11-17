define(['resources/js/shellBus', 'resources/js/codeFixView'], (bus, CFV) => {
  'use strict';

  // Change requests: binding helpers (crChain does the work through resources/js/codeFixClient.js). The list's groups:
  // New (nothing asked yet) · In progress (a proposal, questions, applied…) · Fixed (its change saved) · On hold · Closed
  // (closed or rejected).
  const KINDS = [['fix', 'Fix a bug'], ['enhance', 'Enhance'], ['change', 'Change']];
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
    headTitle(cr) { return !cr ? 'Change request' : (cr.code ? cr.code + ' · ' : '') + (cr.title || 'New change request'); }
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
  }
  PageModule.seq = 0;
  return PageModule;
});
