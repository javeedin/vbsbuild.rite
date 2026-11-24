define(['vb/action/actionChain', 'vb/action/actions', 'resources/js/jiraFeed', 'resources/js/followupsClient', 'resources/js/shellBus', 'resources/js/nav'], (ActionChain, Actions, F, FC, bus, nav) => {
  'use strict';

  // Build.Rite's Jira updates bell (resources/js/jiraFeed.js): read when the shell opens and every five minutes (the
  // bell counts what came since it was last opened), when it is opened, or for another number of days; a kind chosen;
  // an update opened (the story in Jira stories, its drawer). Select mode ticks updates and turns them into a follow-up
  // (kept on this PC by the desktop app, Follow-ups).
  //   init · refresh · toggle · close · kind <k> · days <n> · open <key> · selmode · selall · clearsel · followup
  const SEEN = 'buildrite.jiraSeen';
  const clock = () => { const d = new Date(); const p2 = (n) => (n < 10 ? '0' : '') + n; return p2(d.getHours()) + ':' + p2(d.getMinutes()); };
  const noSel = () => ({ on: false, ids: {} });
  class jiraFeedChain extends ActionChain {
    async run(context, { act, key, id }) {
      const v = context.$page.variables;
      if (!(nav.product && nav.product.isBuild) || !act) return;
      if (!v.jiraSel) v.jiraSel = noSel();
      const read = async (quiet) => {
        if (v.jiraBusy) return;
        v.jiraBusy = !quiet || !v.jiraEvents.length;
        try {
          const r = await F.load(context, Actions, { days: v.jiraDays });
          if (r.ok) { v.jiraEvents = r.events; v.jiraError = ''; v.jiraAt = clock(); } else v.jiraError = r.message;
          v.jiraNew = F.newSince(v.jiraEvents, v.jiraSeen);
        } finally { v.jiraBusy = false; }
      };
      if (act === 'init') {
        try { v.jiraSeen = localStorage.getItem(SEEN) || ''; } catch (e) { v.jiraSeen = ''; }
        await read(true);
        return;
      }
      if (act === 'refresh') { await read(true); return; }
      if (act === 'toggle' || act === 'close') {
        if (v.jiraOpen) {
          v.jiraOpen = false;
          v.jiraSel = noSel(); // leaving the panel drops any selection
          // all of these are seen now: the count starts again from here
          const latest = Date.parse((v.jiraEvents[0] && v.jiraEvents[0].at) || '') || 0;
          v.jiraSeen = new Date(Math.max(latest, Date.now())).toISOString();
          try { localStorage.setItem(SEEN, v.jiraSeen); } catch (e) { /* private mode */ }
          v.jiraNew = 0;
          return;
        }
        if (act === 'close') return;
        v.bellOpen = false; v.profileOpen = false; v.tabMenuOpen = false;
        v.jiraOpen = true;
        await read(false);
        return;
      }
      if (act === 'kind') { v.jiraKind = key || 'all'; return; }
      if (act === 'days') { v.jiraDays = Number(key) || 2; v.jiraEvents = []; await read(false); return; }
      // ── select mode: tick updates and make a follow-up ──
      if (act === 'selmode') { v.jiraSel = v.jiraSel.on ? noSel() : { on: true, ids: {} }; return; }
      if (act === 'selall') {
        const ids = {};
        F.filterKind(v.jiraEvents, v.jiraKind).forEach((e) => { ids[e.id] = true; });
        v.jiraSel = { on: true, ids: ids };
        return;
      }
      if (act === 'clearsel') { v.jiraSel = { on: v.jiraSel.on, ids: {} }; return; }
      if (act === 'followup') {
        const rec = F.followupFrom(v.jiraEvents, v.jiraSel.ids);
        if (!rec.count) { bus.toast('Tick the updates you want to follow up on first.', 'error'); return; }
        const r = await FC.save({ kind: 'stories', title: rec.title, subtitle: rec.subtitle, subject: rec.subject,
          to: '', message: rec.message, signoff: 'Thanks,', sprintName: '', source: 'jira-bell', lines: rec.lines });
        if (r.ok && r.body && r.body.ok) {
          bus.toast('Follow-up saved on ' + rec.stories + (rec.stories === 1 ? ' story.' : ' stories.'), 'info', { label: 'Open Follow-ups', navId: 'followups' });
          v.jiraSel = noSel();
        } else bus.toast((r.body && r.body.error) || 'Could not save (saved follow-ups need the Build.Rite desktop app).', 'error');
        return;
      }
      // day by day: Daily progress in a tab of its own (the panel closes)
      if (act === 'progress') { await this.run(context, { act: 'close' }); bus.open({ record: 'jira-progress', params: {} }); return; }
      // an update: ticked while selecting, else opened in Jira stories (its drawer; the panel stays open)
      if (act === 'open') {
        if (v.jiraSel.on) {
          const ids = Object.assign({}, v.jiraSel.ids);
          if (ids[id]) delete ids[id]; else if (id) ids[id] = true;
          v.jiraSel = { on: true, ids: ids };
          return;
        }
        if (key) bus.focus('jira', { key: key });
      }
    }
  }
  return jiraFeedChain;
});
