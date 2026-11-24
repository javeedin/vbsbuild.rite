define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/followupsClient',
  'resources/js/followup',
  'resources/js/shellBus',
], (ActionChain, Actions, FC, F, bus) => {
  'use strict';

  // Opening the Follow-ups page: is this the desktop app (DuckDB on this PC)? Then read the saved follow-ups, and the
  // messages the follow-up dialog offers (the Messages tab; opened on it when the dialog's "Manage messages…" sent you).
  class initChain extends ActionChain {
    async run(context) {
      const v = context.$page.variables;
      const info = await FC.info();
      v.checked = true;
      v.available = !!info.available;
      if (!v.available) { v.followups = []; return; }
      const f = typeof bus.takeFocus === 'function' ? bus.takeFocus('followups') : null;
      if (f && f.tab === 'messages') v.tab = 'messages';
      v.busy = true;
      try {
        const [r, ms] = await Promise.all([FC.list(), FC.messages()]);
        v.followups = (r.ok && r.body && r.body.followups) ? r.body.followups : [];
        if (ms.ok && ms.body && ms.body.ok !== false) { F.use(ms.body.messages || [], ms.body.order || []); v.msgs = F.list(true); }
        if (v.msgKey && !v.msgDirty) { const m = (v.msgs || []).filter((x) => x.key === v.msgKey)[0]; if (!m) { v.msgKey = ''; v.msgEdit = null; } }
      } finally {
        v.busy = false;
      }
      // the Jira updates bell handed over a new draft to compose (shellBus.focus('followups', { compose })): open the editor
      if (f && f.compose) await Actions.callChain(context, { chain: 'editChain', params: { act: 'draft', draft: f.compose } });
    }
  }

  return initChain;
});
