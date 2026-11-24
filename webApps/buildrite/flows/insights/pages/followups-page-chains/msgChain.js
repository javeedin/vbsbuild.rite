define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/followupsClient',
  'resources/js/followup',
  'resources/js/exportKit',
  'resources/js/shellBus',
], (ActionChain, Actions, FC, F, exportKit, bus) => {
  'use strict';

  // Follow-ups › Messages: the messages the Copy to follow-up dialog offers (Jira stories, a sprint). Yours are added;
  // the built-in ones can be changed, hidden or put back as they were; the order is the dialog's order. Kept on this PC
  // (desktop/lib/followups.js, table followup_messages); the dialog reads them each time it opens, and an open dialog
  // follows a change (shellBus topic followup-messages).
  // acts: tab (key) | focus | load | pick (key) | new | field (field, value) | word (key) | save | dup | reset | remove
  //   | up (key) | down (key) | export | importFile
  const copy = (o) => JSON.parse(JSON.stringify(o || null));
  const EXPORT_KIND = 'buildrite-followup-messages';

  class msgChain extends ActionChain {
    async run(context, { act, key, field, value }) {
      const v = context.$page.variables;
      const editOf = (m) => ({ key: m.key, label: m.label, subject: m.subject, body: m.body, show: !m.hidden, builtin: !!m.builtin,
        edited: !!m.edited, mine: !!m.mine, isNew: false, original: m.original || null, updatedAt: m.updatedAt || '', author: m.author || '' });
      const load = async () => {
        const r = await FC.messages();
        if (!r.ok || !r.body || r.body.ok === false) { bus.toast((r.body && r.body.error) || 'The messages could not be read.', 'error'); return false; }
        F.use(r.body.messages || [], r.body.order || []);
        v.msgs = F.list(true);
        return true;
      };
      const changed = () => { try { bus.emit('followup-messages', { at: Date.now() }); } catch (e) { /* no shell */ } };
      const leave = () => { if (!v.msgDirty) return true; try { return window.confirm('Your changes to "' + ((v.msgEdit && v.msgEdit.label) || 'this message') + '" are not saved. Leave them?'); } catch (e) { return true; } };
      // a plain input's bound value only sets its attribute: what was typed stays on screen, so the editor's boxes are
      // set directly whenever another message is put in it
      const syncDom = () => setTimeout(() => {
        try {
          const e = v.msgEdit || {};
          const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val == null ? '' : String(val); };
          set('fmLabel', e.label); set('fmSubject', e.subject); set('fmBody', e.body);
          const cb = document.getElementById('fmShow'); if (cb) cb.checked = e.show !== false;
        } catch (x) { /* no DOM */ }
      }, 40);
      const reopen = (k) => { const m = (v.msgs || []).filter((x) => x.key === k)[0]; v.msgKey = m ? m.key : ''; v.msgEdit = m ? editOf(m) : null; v.msgDirty = false; syncDom(); };
      const orderNow = () => (v.msgs || []).map((m) => m.key).filter((k) => k !== 'blank');

      if (act === 'tab') { v.tab = key === 'messages' ? 'messages' : 'saved'; if (v.tab === 'messages') await load(); return; }
      if (act === 'focus') {
        const f = typeof bus.takeFocus === 'function' ? bus.takeFocus('followups') : null;
        if (f && f.tab === 'messages') { v.tab = 'messages'; await load(); }
        // the Jira updates bell handed over a new draft to compose: open the editor on the Saved tab
        else if (f && f.compose) { v.tab = 'saved'; await Actions.callChain(context, { chain: 'editChain', params: { act: 'draft', draft: f.compose } }); }
        return;
      }
      if (act === 'load') { await load(); if (v.msgKey && !v.msgDirty) reopen(v.msgKey); return; }
      if (act === 'pick') { if (key === v.msgKey || !leave()) return; reopen(key); return; }
      if (act === 'new') {
        if (!leave()) return;
        v.msgKey = '';
        v.msgEdit = { key: '', label: 'New message', subject: '', body: '', show: true, builtin: false, edited: false, mine: true, isNew: true, original: null };
        v.msgDirty = true;
        syncDom();
        setTimeout(() => { try { const el = document.getElementById('fmLabel'); if (el) { el.focus(); el.select(); } } catch (e) { /* no DOM */ } }, 90);
        return;
      }
      if (act === 'field') {
        if (!v.msgEdit || ['label', 'subject', 'body', 'show'].indexOf(field) === -1) return;
        const val = field === 'show' ? (value === true || value === 'true') : String(value == null ? '' : value);
        v.msgEdit = Object.assign({}, v.msgEdit, { [field]: val });
        v.msgDirty = true;
        return;
      }
      if (act === 'word') {
        // a word ({names} …) put where the cursor is in the message
        if (!v.msgEdit) return;
        let body = String(v.msgEdit.body || '');
        let at = body.length;
        try { const el = document.getElementById('fmBody'); if (el && typeof el.selectionStart === 'number') { body = el.value; at = el.selectionStart; } } catch (e) { /* no DOM */ }
        const next = body.slice(0, at) + key + body.slice(at);
        v.msgEdit = Object.assign({}, v.msgEdit, { body: next });
        v.msgDirty = true;
        setTimeout(() => { try { const el = document.getElementById('fmBody'); if (el) { el.value = next; el.focus(); el.selectionStart = el.selectionEnd = at + key.length; } } catch (e) { /* no DOM */ } }, 30);
        return;
      }
      if (act === 'save') {
        const e = v.msgEdit;
        if (!e) return;
        if (!String(e.label || '').trim()) { bus.toast('Give the message a name: it is the button in the follow-up dialog.', 'error'); return; }
        if (!String(e.body || '').trim() && !e.builtin) { bus.toast('Write the message first.', 'error'); return; }
        const r = await FC.saveMessage({ key: e.key, label: e.label, subject: e.subject, body: e.body, hidden: !e.show });
        if (!r.ok || !r.body || !r.body.message) { bus.toast((r.body && r.body.error) || 'The message could not be saved.', 'error'); return; }
        await load();
        reopen(r.body.message.key);
        changed();
        bus.toast('Saved "' + r.body.message.label + '"' + (e.show ? ': the follow-up dialog offers it now.' : ' (hidden from the follow-up dialog).'), 'success');
        return;
      }
      if (act === 'dup') {
        const e = v.msgEdit;
        if (!e || !leave()) return;
        v.msgKey = '';
        v.msgEdit = Object.assign({}, copy(e), { key: '', label: String(e.label || 'Message').slice(0, 52) + ' (copy)', builtin: false, edited: false, mine: true, isNew: true, original: null, show: true });
        v.msgDirty = true;
        syncDom();
        return;
      }
      if (act === 'reset' || act === 'remove') {
        const e = v.msgEdit;
        if (!e || !e.key) return;
        let yes = true;
        try {
          yes = window.confirm(act === 'reset'
            ? 'Put "' + ((e.original && e.original.label) || e.label) + '" back as it came (its subject and message as built in, shown in the dialog)?'
            : 'Remove your message "' + e.label + '"? The follow-up dialog stops offering it.');
        } catch (x) { /* no DOM */ }
        if (!yes) return;
        const r = await FC.removeMessage(e.key);
        if (!r.ok) { bus.toast((r.body && r.body.error) || 'It could not be done.', 'error'); return; }
        await load();
        if (act === 'reset') reopen(e.key); else { v.msgKey = ''; v.msgEdit = null; v.msgDirty = false; }
        changed();
        bus.toast(act === 'reset' ? 'Back as it came.' : 'Removed.', 'info');
        return;
      }
      if (act === 'up' || act === 'down') {
        const keys = orderNow();
        const i = keys.indexOf(key);
        const j = act === 'up' ? i - 1 : i + 1;
        if (i < 0 || j < 0 || j >= keys.length) return;
        keys.splice(j, 0, keys.splice(i, 1)[0]);
        const r = await FC.orderMessages(keys);
        if (!r.ok) { bus.toast((r.body && r.body.error) || 'The order could not be saved.', 'error'); return; }
        await load();
        changed();
        return;
      }
      if (act === 'export') {
        // yours and your changes to the built-ins, with the order: a file to give the team (Import on their PC)
        const rows = (v.msgs || []).filter((m) => m.mine || m.edited || m.hidden).map((m) => ({ key: m.key, label: m.label, subject: m.subject, body: m.body, hidden: !!m.hidden }));
        const data = { kind: EXPORT_KIND, version: 1, exportedAt: new Date().toISOString(), messages: rows, order: orderNow() };
        exportKit.download('followup-messages.json', 'application/json', JSON.stringify(data, null, 2));
        bus.toast('Exported ' + rows.length + ' message(s) and the order to followup-messages.json — Import it on another PC.', 'info');
        return;
      }
      if (act === 'importFile') {
        let el = null;
        try { el = document.getElementById('fmImportFile'); } catch (e) { el = null; }
        const file = el && el.files && el.files[0];
        if (!file) return;
        let data = null;
        try { data = JSON.parse(await file.text()); } catch (e) { data = null; }
        if (el) el.value = '';
        const list = data && Array.isArray(data.messages) ? data.messages.filter((m) => m && typeof m === 'object' && (m.label || m.key)) : null;
        if (!list) { bus.toast('That file is not an export of follow-up messages (Follow-ups › Messages › Export).', 'error'); return; }
        let yes = true;
        try { yes = window.confirm('Import ' + list.length + ' message(s)' + (Array.isArray(data.order) && data.order.length ? ' and their order' : '') + '? A message with the same key here is replaced.'); } catch (e) { /* no DOM */ }
        if (!yes) return;
        let n = 0;
        for (const m of list.slice(0, 200)) {
          const r = await FC.saveMessage({ key: m.key, label: m.label, subject: m.subject, body: m.body, hidden: !!m.hidden });
          if (r.ok && r.body && r.body.message) n++;
        }
        if (Array.isArray(data.order) && data.order.length) await FC.orderMessages(data.order);
        await load();
        if (v.msgKey) reopen(v.msgKey);
        changed();
        bus.toast('Imported ' + n + ' of ' + list.length + ' message(s).', n === list.length ? 'success' : 'error');
      }
    }
  }

  return msgChain;
});
