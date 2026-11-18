define(['resources/js/mdRender', 'resources/js/fmt', 'resources/js/shellBus'], (MD, fmt, bus) => {
  'use strict';

  // The AI Assistant: binding helpers (askChain does the work). No function uses `this`.
  // In an answer (HTML made by resources/js/mdRender.js) a citation [n] and a file reference are buttons of their own:
  // a click on one is handed to the page through a hidden button (data-key, data-value), so the page's usual click
  // handling opens the source. Enter in the box sends (Shift+Enter: a new line).
  const KIND = { app: ['oj-ux-ico-home', 'The app'], page: ['oj-ux-ico-file', 'Page'], file: ['oj-ux-ico-code', 'Code'], interfaces: ['oj-ux-ico-link', 'Integrations'], pageflow: ['oj-ux-ico-link', 'Page flow'],
    journeys: ['oj-ux-ico-link', 'Cross-system flows'], flow: ['oj-ux-ico-share', 'Saved flow'], fdd: ['oj-ux-ico-book', 'Design document'] };
  const SCOPES = [['all', 'Everything', 'Code, pages, integrations, saved flows and design documents'], ['code', 'Code', 'The pages and the code that matches'],
    ['integrations', 'Integrations', 'Systems, interfaces, each page\'s calls'], ['process', 'Process', 'Saved flows, design documents, how a page works with other systems']];
  let wired = false;
  function wire() {
    if (wired || typeof document === 'undefined') return;
    wired = true;
    MD.install();
    const hook = (id, key, value) => { const b = document.getElementById(id); if (b) { b.setAttribute('data-key', key); b.setAttribute('data-value', value || ''); b.click(); } };
    document.addEventListener('click', (e) => {
      const t = e.target && e.target.closest ? e.target : null;
      if (!t) return;
      const turn = t.closest('[data-turn]');
      const cite = t.closest('.nx-md-cite');
      if (cite && turn && t.closest('.nx-ask')) { e.preventDefault(); hook('askHookCite', turn.getAttribute('data-turn'), cite.getAttribute('data-cite')); return; }
      const ref = t.closest('.nx-md-fileref');
      if (ref && t.closest('.nx-ask')) { e.preventDefault(); hook('askHookFile', ref.getAttribute('data-path'), ref.getAttribute('data-line')); return; }
      // a link in an answer: opened outside the app's tab (the desktop app opens it in the browser)
      const a = t.closest('.nx-ask-md a[href]');
      if (a && /^(https?:|mailto:)/i.test(a.getAttribute('href') || '')) { e.preventDefault(); try { window.open(a.getAttribute('href'), '_blank', 'noopener'); } catch (x) { /* blocked */ } }
    });
    document.addEventListener('keydown', (e) => {
      if (e.target && e.target.id === 'askInput' && e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); const b = document.getElementById('askSend'); if (b && !b.disabled) b.click(); }
    });
  }

  class PageModule {
    constructor(context) {
      wire();
      // another screen (or Ctrl+J) hands this one a question: bus.focus('assistant', { q, page, scope })
      const helper = context && typeof context.getEventHelper === 'function' ? context.getEventHelper() : null;
      if (bus && typeof bus.onFocus === 'function') bus.onFocus('assistant', () => { if (helper) helper.fireCustomEvent('focusRequest', {}); });
    }

    scopeChips(cur) { return SCOPES.map((s) => ({ id: s[0], text: s[1], title: s[2], cls: 'nx-ask-scope' + ((cur || 'all') === s[0] ? ' nx-ask-scope--on' : ''), on: (cur || 'all') === s[0] ? 'true' : 'false' })); }
    pageOptions(sg, cur) { return [{ id: '', text: 'Any page', on: !cur }].concat(((sg && sg.pages) || []).map((p) => ({ id: p.id, text: p.label, on: p.id === cur }))); }
    convRows(list, cur) {
      return (list || []).map((c) => ({ id: c.id, title: c.title || 'Conversation', when: PageModule.prototype.ago(c.updated), n: c.turns + (c.turns === 1 ? ' question' : ' questions'), cls: 'nx-ask-conv' + (cur && cur.id === c.id ? ' nx-ask-conv--on' : '') }));
    }
    ago(iso) {
      if (!iso) return '';
      const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
      if (s < 60) return 'just now';
      if (s < 3600) return Math.round(s / 60) + ' min ago';
      if (s < 86400) return Math.round(s / 3600) + ' h ago';
      return fmt.date(iso);
    }
    aiText(st) {
      if (!st || !st.providers) return 'AI: not set up yet';
      const id = (st.uses && st.uses.assistant) || st.active;
      const p = id ? st.providers[id] : null;
      const label = ((st.catalog || []).filter((c) => c.id === id)[0] || {}).label || id;
      return p ? 'Answers by ' + label + (p.model ? ' · ' + p.model : '') + ((st.uses && st.uses.assistant) ? '' : ' (the default)') : 'AI: not set up yet';
    }
    aiReady(st) { const id = st && ((st.uses && st.uses.assistant) || st.active); return !!(id && st.providers && st.providers[id] && st.providers[id].ready !== false); }
    /** The conversation as shown: each question and its answer (formatted), then the one being answered. */
    turns(conv, pending, secs, aiLabel) {
      const out = ((conv && conv.turns) || []).map((t, i) => {
        const a = t.a || {};
        const looked = t.looked || [];
        const cited = a.cited || [];
        const src = (x) => ({ n: x.n, key: i + ':' + x.n, label: x.label, kind: (KIND[x.kind] || KIND.file)[1], icon: (KIND[x.kind] || KIND.file)[0] });
        return {
          key: String(i), idx: String(i), q: t.q, tags: [t.scope && t.scope !== 'all' ? (SCOPES.filter((s) => s[0] === t.scope)[0] || [])[1] : '', t.pageLabel ? 'Page: ' + t.pageLabel : ''].filter(Boolean).join(' · '),
          pending: false, error: a.error || '', html: a.text ? MD.render(a.text, { cites: looked.map((x) => x.n) }) : '',
          meta: a.text ? [a.provider, a.model, a.ms ? (a.ms / 1000).toFixed(1) + ' s' : '', looked.length + ' items looked at', PageModule.prototype.ago(t.at)].filter(Boolean).join(' · ') : '',
          cited: looked.filter((x) => cited.indexOf(x.n) !== -1).map(src), others: looked.filter((x) => cited.indexOf(x.n) === -1).map(src), othersText: 'Also looked at (' + looked.filter((x) => cited.indexOf(x.n) === -1).length + ')',
          followups: (a.followups || []).map((f, k) => ({ k: String(k), text: f })), last: i === conv.turns.length - 1
        };
      });
      if (pending) {
        out.push({ key: 'p', idx: 'p', q: pending.q, tags: [pending.scope && pending.scope !== 'all' ? (SCOPES.filter((s) => s[0] === pending.scope)[0] || [])[1] : '', pending.pageLabel ? 'Page: ' + pending.pageLabel : ''].filter(Boolean).join(' · '),
          pending: true, step: secs < 2 ? 'Looking through the code, pages, integrations and flows…' : 'Asking ' + (aiLabel || 'the AI') + '… ' + secs + ' s', error: '', html: '', meta: '', cited: [], others: [], othersText: '', followups: [], last: true });
      }
      return out;
    }
    /** A source shown: a file whole (its lines numbered, the cited ones marked), or what the AI was given. */
    srcLines(src) {
      if (!src || !src.file) return [];
      const at = Number(src.line) || 0;
      return String(src.file.text || '').split('\n').map((l, i) => ({ n: String(i + 1), html: MD.colour(l, src.lang) || ' ', cls: 'nx-ask-ln' + (at && Math.abs(i + 1 - at) <= 0 ? ' nx-ask-ln--at' : '') }));
    }
  }
  return PageModule;
});
