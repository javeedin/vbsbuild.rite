define(['resources/js/shellBus', 'resources/js/theme', 'resources/js/look', 'resources/js/warmup', 'resources/js/jiraFeed', 'resources/js/textareaSync'], (bus, theme, look, warmup, jiraFeed, textareaSync) => {
  'use strict';

  // The shell's page module: the line from the screens in the tabs (shellBus) to the shell's chains, the keyboard
  // (Ctrl+K: the search box; Ctrl+J: the AI Assistant; Escape: close the open popup), a click outside the search list, and the Jira updates'
  // five-minute check.
  const JIRA_EVERY_MS = 5 * 60 * 1000;


  const JICON = { new: 'oj-ux-ico-plus-circle', status: 'oj-ux-ico-arrow-right', assign: 'oj-ux-ico-contact', comment: 'oj-ux-ico-chat', priority: 'oj-ux-ico-flag', sprint: 'oj-ux-ico-calendar', attach: 'oj-ux-ico-attach', edit: 'oj-ux-ico-edit' };
  let jiraKept = { k: '', v: [] };

  // Microsoft 365's state for the top bar: connected · expired · off (set up but not connected) · none (no app set up)
  function m365State(m) { return !m ? 'none' : m.signedIn ? 'on' : m.expired ? 'expired' : m.configured ? 'off' : 'none'; }

  class PageModule {
    // ── The Jira updates bell (resources/js/jiraFeed.js) ──
    jiraGroups(events, kind) {
      const k = (events || []).length + '|' + ((events || [])[0] || {}).id + '|' + kind;
      if (jiraKept.k !== k) jiraKept = { k: k, v: jiraFeed.grouped(events, kind) };
      return jiraKept.v;
    }
    jiraChips(events) { return jiraFeed.chips(events); }
    jiraIcon(kind) { return JICON[kind] || 'oj-ux-ico-notification'; }
    jiraItemClass(e, seen) { return 'nx-jfeed-item nx-jfeed-item--' + e.kind + (Date.parse(e.at) > (Date.parse(seen) || 0) ? ' nx-jfeed-item--unseen' : ''); }
    // ── Your working copy (the top bar) ──
    workText(work) { const c = work && work.current; return c ? c.projectName + ' ▸ ' + c.workspace : 'Set up your workspace'; }
    workTitle(work) { const c = work && work.current; return c ? c.repo + '.git at ' + c.branch + ' — working: ' + c.working + ' · main: ' + c.main + ' (open its project)' : 'Set up your workspace: choose a VB Studio workspace and a folder on this PC'; }
    workBadge(work) {
      if (work && work.current && work.current.exists === false) return 'folders missing';
      const s = work && work.current && work.current.summary;
      if (!s) return work && work.current ? work.current.branch : '';
      const parts = [work.current.branch];
      if (s.changed) parts.push(s.changed + ' changed');
      if (s.toApply) parts.push(s.toApply + ' to apply');
      if (s.toPush) parts.push(s.toPush + ' to push');
      if (s.toGet) parts.push(s.toGet + ' to get');
      return parts.join(' · ');
    }
    workClass(work) { const c = work && work.current; const s = c && c.summary; return 'nx-work' + (!c ? ' nx-work--none' : s && (s.changed || s.toApply || s.toPush || s.toGet) ? ' nx-work--todo' : ''); }
    constructor(context) {
      // The colours chosen on this computer, before anything is drawn (theme.js; your menu, Colours).
      theme.apply(theme.load());
      // Once the first screen is up, the components the other screens use are loaded while nothing else happens, so a tab
      // opened later shows at once (resources/js/warmup.js).
      warmup.start('buildrite');
      // a text box drawn in a list keeps its text when drawn again (resources/js/textareaSync.js)
      textareaSync.start();
      // The look (Redwood or Current) last chosen on this computer, until the shell knows whose it is (lookChain).
      look.apply(look.load(''));
      const helper = context && typeof context.getEventHelper === 'function' ? context.getEventHelper() : null;
      const fire = (name, payload) => { if (helper) helper.fireCustomEvent(name, payload || {}); };
      bus.register((req) => fire('shellRequest', {
        action: req.action || 'open', navId: req.navId || '', record: req.record || '', params: req.params || {},
        id: req.id || '', title: req.title || '', message: req.message || '', tone: req.tone || '', act: req.act || {}, // an object always: VB refuses null for an object field
      }));
      if (typeof document !== 'undefined' && !PageModule.keysBound) {
        PageModule.keysBound = true;
        document.addEventListener('keydown', (e) => {
          if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && String(e.key).toLowerCase() === 'k') {
            e.preventDefault();
            const box = document.getElementById('nxCommand');
            if (box) { box.focus(); box.select(); }
          } else if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && String(e.key).toLowerCase() === 'j') {
            // Ctrl+J: the AI Assistant, from anywhere (its box ready to type in)
            e.preventDefault();
            bus.focus('assistant', {});
          } else if (e.key === 'Escape') {
            fire('dismiss');
          }
        });
        // The search list closes on a click anywhere outside the box and its list (the popups have a backdrop for that;
        // the list sits in the toolbar, above it).
        document.addEventListener('pointerdown', (e) => {
          const inBox = e.target && typeof e.target.closest === 'function' && e.target.closest('.nx-command');
          if (!inBox && document.getElementById('nxResults')) fire('searchAway');
        }, true);
        setInterval(() => fire('refreshAlerts'), JIRA_EVERY_MS);
      }
      // Microsoft 365: a screen asks for the top bar's panel (the follow-up dialog's "Microsoft 365…"), or a quiet check
      // found the stored sign-in expired (m365Chain)
      bus.on('m365-open', 'shell', () => fire('m365Request', { act: 'open' }));
      bus.on('m365-expired', 'shell', () => fire('m365Request', { act: 'status' }));
    }


    /** The menu item to highlight: the current tab's own item (a record's list for a record tab). */
    activeNav(tabList, currentTab) {
      const t = (tabList || []).filter((x) => x.id === currentTab)[0];
      return t ? t.navId : '';
    }

    /** The colour themes, for the picker in your menu. */
    themes() { return theme.THEMES; }

    /** A theme's swatch: the menu's colour and the page head's. */
    swatch(t) { return theme.swatch(t); }

    /** The menu's two looks. */
    menus() { return theme.MENUS; }

    /** The looks in your menu: Redwood, Current (resources/js/look.js). */
    looks() { return look.LOOKS; }

    // ── Microsoft 365 (the top bar's 365 button and its panel; m365Chain) ──
    /** connected · expired · off (set up but not connected) · none (no app set up) */
    m365State(m) { return m365State(m); }
    m365Class(m) { return 'nx-m365btn nx-m365btn--' + m365State(m); }
    m365Title(m) {
      const st = m365State(m);
      return st === 'on' ? 'Microsoft 365: connected' + (m.account ? ' as ' + m.account : '') + ' — recipient suggestions and Send via Microsoft 365'
        : st === 'expired' ? 'Microsoft 365: your sign-in has expired — click to connect again'
          : st === 'off' ? 'Microsoft 365: not connected — click to connect' : 'Connect Microsoft 365: recipient suggestions and sending from Build.Rite';
    }
    m365Headline(m) {
      const st = m365State(m);
      return st === 'on' ? 'Connected' + (m.account ? ' as ' + m.account : '') : st === 'expired' ? 'Your sign-in has expired' : st === 'off' ? 'Not connected' : 'Not set up yet';
    }
  }

  return PageModule;
});
