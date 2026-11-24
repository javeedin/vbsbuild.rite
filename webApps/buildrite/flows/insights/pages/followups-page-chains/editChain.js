define([
  'vb/action/actionChain',
  'resources/js/followupsClient',
  'resources/js/followup',
  'resources/js/shellBus',
], (ActionChain, FC, F, bus) => {
  'use strict';

  // Compose / edit a follow-up on the Follow-ups page. The Jira updates bell hands a new draft here (act 'draft'); "Edit"
  // on a saved follow-up loads it (act 'open'). The editor keeps the stories; you change the title, subject, recipients,
  // the message (or pick a template) and the sign-off, then Save writes it to this PC (desktop/lib/followups.js).
  //   open <id> · draft <draft> · field <field,value> · template <key> · save · close
  const str = (x) => (x == null ? '' : String(x));

  class editChain extends ActionChain {
    async run(context, { act, id, draft, field, value, key }) {
      const v = context.$page.variables;
      // A plain <input>'s bound value only sets the attribute, so set the live boxes directly when the editor is filled.
      const syncDom = () => setTimeout(() => {
        try {
          const e = v.fuEdit || {};
          const set = (eid, val) => { const el = document.getElementById(eid); if (el) el.value = val == null ? '' : String(val); };
          set('fuEditTitle', e.title); set('fuEditSubject', e.subject); set('fuEditTo', e.to); set('fuEditMsg', e.message); set('fuEditSign', e.signoff);
        } catch (err) { /* no DOM (tests) */ }
      }, 30);
      const openWith = (fu) => {
        v.fuEdit = {
          id: str(fu.id), kind: fu.kind === 'sprint' ? 'sprint' : 'stories',
          title: str(fu.title) || 'Follow-up', subtitle: str(fu.subtitle), subject: str(fu.subject),
          to: str(fu.to), message: str(fu.message), signoff: str(fu.signoff) || 'Thanks,',
          sprintName: str(fu.sprintName), source: str(fu.source) || 'followups',
          lines: Array.isArray(fu.lines) ? fu.lines : [],
        };
        try { v.fuTpls = F.list(); } catch (e) { v.fuTpls = []; }
        v.tab = 'saved';
        v.fuEditOpen = true;
        syncDom();
      };

      if (act === 'open') {
        const r = await FC.get(str(id));
        if (!(r.ok && r.body && r.body.followup)) { bus.toast('That follow-up could not be opened.', 'error'); return; }
        openWith(r.body.followup);
        return;
      }
      if (act === 'draft') { if (draft) openWith(draft); return; }
      if (act === 'field') {
        if (!v.fuEdit || ['title', 'subject', 'to', 'message', 'signoff'].indexOf(field) === -1) return;
        const e = Object.assign({}, v.fuEdit); e[field] = value; v.fuEdit = e;
        return;
      }
      if (act === 'template') {
        if (!v.fuEdit) return;
        const e = Object.assign({}, v.fuEdit);
        e.message = F.message(e.lines || [], key);
        e.subject = F.subjectFor(e.lines || [], key);
        v.fuEdit = e; syncDom();
        return;
      }
      if (act === 'close') { v.fuEditOpen = false; v.fuEdit = null; return; }
      if (act === 'save') {
        const e = v.fuEdit; if (!e) return;
        if (!(e.lines || []).length) { bus.toast('There are no stories in this follow-up.', 'error'); return; }
        v.fuSaving = true;
        try {
          const r = await FC.save({
            id: e.id || '', kind: e.kind, title: e.title, subtitle: e.subtitle, subject: e.subject,
            to: e.to, message: e.message, signoff: e.signoff, sprintName: e.sprintName, source: e.source || 'followups',
            lines: e.lines,
          });
          if (r.ok && r.body && r.body.ok) {
            const saved = r.body.followup || {};
            const list = await FC.list();
            if (list.ok && list.body && list.body.followups) v.followups = list.body.followups;
            if (saved.id) { v.selId = str(saved.id); v.detail = saved; }
            v.fuEditOpen = false; v.fuEdit = null;
            bus.toast(e.id ? 'Follow-up updated.' : 'Follow-up saved.', 'info');
          } else bus.toast((r.body && r.body.error) || 'Could not save (saved follow-ups need the Build.Rite desktop app).', 'error');
        } finally { v.fuSaving = false; }
        return;
      }
    }
  }

  return editChain;
});
