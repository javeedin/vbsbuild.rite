define(['resources/js/followup', 'resources/js/shellBus'], (F, bus) => {
  'use strict';

  // Follow-ups page: binding helpers. The follow-ups are kept on this PC (desktop/lib/followups.js, via
  // resources/js/followupsClient.js); the chains are followups-page-chains. No function uses `this` (a binding may call
  // one detached).

  function whenText(iso) { try { return iso ? new Date(iso).toLocaleString() : ''; } catch (e) { return ''; } }
  function scopeText(f) { return f && f.sprintName ? 'Sprint ' + f.sprintName : ((f && f.source) || 'Jira stories'); }
  function itemsText(f) { const n = (f && (f.itemCount != null ? f.itemCount : (f.lines ? f.lines.length : 0))) || 0; return n + (n === 1 ? ' story' : ' stories'); }
  function rowsOf(d) {
    return ((d && d.lines) || []).map((l) => ({ key: l.storyKey, summary: l.summary, status: l.status, assignee: l.assignee,
      sprint: l.sprint, due: l.due, overdue: l.overdue, labels: l.customer ? String(l.customer).split(', ') : [], url: l.url }));
  }
  // Two made-up stories for the message preview (Follow-ups › Messages)
  const SAMPLE = [
    { key: 'ABC-101', summary: 'Invoice approval screen', status: 'IN TEST', assignee: 'Priya Raman', sprint: '2026-11', due: '2026-11-28', overdue: false, labels: ['acme'], url: '' },
    { key: 'ABC-102', summary: 'Credit memo export', status: 'DEVELOPMENT', assignee: 'Sam Lee', sprint: '2026-11', due: '2026-12-05', overdue: false, labels: ['globex'], url: '' },
  ];

  class PageModule {
    constructor(context) {
      // Another screen opens Follow-ups on a tab (the follow-up dialog's "Manage messages…" → Messages)
      const helper = context && typeof context.getEventHelper === 'function' ? context.getEventHelper() : null;
      try { if (bus && typeof bus.onFocus === 'function') bus.onFocus('followups', () => { if (helper) helper.fireCustomEvent('focusRequest', {}); }); } catch (e) { /* no shell */ }
    }
    whenText(iso) { return whenText(iso); }
    scopeText(f) { return scopeText(f); }
    itemsText(f) { return itemsText(f); }
    rowClass(id, sel) { return 'nx-fl-row' + (id === sel ? ' nx-fl-row--on' : ''); }

    /** The header note: "3 saved follow-ups". */
    countText(list) { const n = (list || []).length; return n === 0 ? 'No follow-ups saved yet' : n + (n === 1 ? ' saved follow-up' : ' saved follow-ups'); }

    /** The open follow-up rendered as the email that was composed (for the preview iframe). */
    detailHtml(detail) {
      if (!detail) return '';
      return F.composeHtml({ title: detail.title, subtitle: detail.subtitle, when: whenText(detail.createdAt),
        message: detail.message, signoff: detail.signoff, rows: rowsOf(detail), kind: detail.kind });
    }

    // ── Compose / edit a follow-up (the dialog opened by "Edit", or by the Jira updates bell) ──
    /** The editor's live preview as the email. */
    editHtml(e) {
      if (!e) return '';
      return F.composeHtml({ title: e.title, subtitle: e.subtitle, when: '', message: e.message, signoff: e.signoff, rows: rowsOf(e), kind: e.kind });
    }
    /** "3 stories" — how many the follow-up covers. */
    editCount(e) { const n = e && e.lines ? e.lines.length : 0; return n + (n === 1 ? ' story' : ' stories'); }
    /** The editor's title: a new draft (no id) vs editing a saved one. */
    editHeading(e) { return e && e.id ? 'Edit follow-up' : 'New follow-up'; }
    editTplClass() { return 'nx-fu-tpl'; }

    // ── Messages: the messages the Copy to follow-up dialog offers ──
    tabClass(tab, cur) { return 'nx-sc-tab' + (tab === cur ? ' nx-sc-tab--on' : ''); }
    msgsCount(list) { const l = list || []; return l.filter((m) => !m.hidden).length + ' in the dialog' + (l.some((m) => m.hidden) ? ' · ' + l.filter((m) => m.hidden).length + ' hidden' : ''); }
    msgRowClass(m, key) { return 'nx-fm-row' + (m && m.key === key ? ' nx-fm-row--on' : '') + (m && m.hidden ? ' nx-fm-row--hidden' : ''); }
    /** What a message is: built in, built in and changed by you, or yours (and hidden). */
    msgTags(m) {
      if (!m) return [];
      const t = [];
      if (m.mine) t.push({ text: 'yours', cls: 'mine' });
      else if (m.edited) t.push({ text: 'changed', cls: 'edited' });
      else t.push({ text: 'built in', cls: 'builtin' });
      if (m.hidden) t.push({ text: 'hidden', cls: 'hidden' });
      return t;
    }
    isFirst(list, key) { const l = (list || []).filter((m) => m.key !== 'blank'); return !l.length || l[0].key === key; }
    isLast(list, key) { const l = (list || []).filter((m) => m.key !== 'blank'); return !l.length || l[l.length - 1].key === key; }
    words() { return F.WORDS; }
    /** The editor's message as the follow-up email (two made-up stories), and its subject with the words filled in. */
    previewHtml(e) {
      if (!e) return '';
      const body = F.fill(e.body, SAMPLE);
      return F.composeHtml({ title: 'Follow-up — preview', subtitle: 'Two sample stories', when: '', message: F.greeting(SAMPLE) + (body ? '\n\n' + body : ''),
        signoff: 'Thanks,', rows: SAMPLE, kind: 'stories' });
    }
    previewSubject(e) { return e ? F.fill(e.subject, SAMPLE) || '(no subject)' : ''; }
    /** A built-in that was changed: what it said before. */
    originalText(e) { return e && e.original ? e.original.subject + ' — ' + e.original.body : ''; }
  }

  return PageModule;
});
