define(['vb/action/actionChain', 'resources/js/minutesClient', 'resources/js/shellBus'], (ActionChain, M, bus) => {
  'use strict';

  // The top bar's Microsoft 365 button and its panel (desktop/lib/graph.js through /__minutes/graph/*): whether Build.Rite
  // is connected (green), the sign-in expired (amber) or not connected (grey); connect in a sign-in window (or with a code),
  // a test email, the company directory, disconnect. The app (tenant + client id) is asked for when none is set up.
  // Microsoft 365 gives the recipient suggestions and "Send via Microsoft 365" in the follow-up dialog and Standup minutes.
  // acts: status | open | toggle | close | field (field, value) | setup | connect | code | recheck | copyCode | check
  //   | test | directory | signout
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const blank = { configured: false, signedIn: false, expired: false, account: '', directory: false };

  class m365Chain extends ActionChain {
    async run(context, { act, field, value }) {
      const v = context.$page.variables;
      const changed = () => { try { bus.emit('m365-changed', { at: Date.now() }); } catch (e) { /* no listeners */ } };
      const read = async (deep) => {
        const r = deep ? await M.graphCheck() : await M.graphStatus();
        const s = r && r.ok && r.body ? r.body : null;
        if (s) v.m365 = Object.assign({}, blank, s, deep && s.checkError ? { error: s.checkError } : {});
        return v.m365;
      };
      const formFrom = (s) => ({ tenantId: (s && s.tenantId) || '', clientId: (s && s.clientId) || '', directory: !!(s && s.directory), editing: !(s && s.configured) });
      const saveForm = async () => {
        const f = v.m365Form || {};
        if (!String(f.tenantId || '').trim() || !String(f.clientId || '').trim()) { bus.toast('Enter the Tenant ID and the App (client) ID of your Microsoft 365 app first.', 'error'); return false; }
        const r = await M.graphConfig({ tenantId: String(f.tenantId).trim(), clientId: String(f.clientId).trim(), directory: !!f.directory });
        if (r.ok && r.body && r.body.status) v.m365 = Object.assign({}, blank, r.body.status);
        v.m365Form = Object.assign({}, v.m365Form, { editing: false });
        return true;
      };
      const signedInSay = () => bus.toast('Connected to Microsoft 365' + (v.m365.account ? ' as ' + v.m365.account : '') + ': recipient suggestions and Send via Microsoft 365 use it now.', 'success');

      if (act === 'status') {
        await read(false);
        // a stored sign-in Microsoft no longer renews shows as expired once asked: ask quietly after start-up
        if (v.m365 && v.m365.signedIn) setTimeout(() => { M.graphCheck().then((r) => { if (r && r.ok && r.body && !r.body.signedIn && r.body.expired) bus.emit('m365-expired', {}); }).catch(() => {}); }, 4000);
        return;
      }
      if (act === 'toggle' || act === 'open') {
        if (act === 'toggle' && v.m365Open) { v.m365Open = false; return; }
        v.profileOpen = false; v.tabMenuOpen = false; v.showResults = false;
        v.m365Open = true;
        await read(false);
        v.m365Form = formFrom(v.m365);
        if (v.m365 && v.m365.signedIn) { v.m365Busy = true; try { await read(true); } finally { v.m365Busy = false; } }
        return;
      }
      if (act === 'close') { v.m365Open = false; return; }
      if (act === 'field') {
        const f = Object.assign({}, v.m365Form || {});
        f[field] = field === 'directory' ? (value === true || value === 'true') : String(value == null ? '' : value);
        v.m365Form = f;
        return;
      }
      if (act === 'setup') { v.m365Form = Object.assign(formFrom(v.m365), { editing: true }); return; }
      if (act === 'connect') {
        if (v.m365Busy) return;
        if ((v.m365Form && v.m365Form.editing) || !(v.m365 && v.m365.configured)) { if (!(await saveForm())) return; }
        v.m365Busy = true;
        try {
          bus.toast('Opening the Microsoft sign-in window…', 'info');
          const r = await M.graphInteractive();
          if (r.ok && r.body && r.body.ok) { await read(false); signedInSay(); changed(); }
          else { const msg = (r.body && r.body.error) || 'Sign-in did not complete.'; v.m365 = Object.assign({}, v.m365, { error: msg }); bus.toast(msg, 'error'); }
        } finally { v.m365Busy = false; }
        return;
      }
      if (act === 'code') {
        // the code way: Microsoft's page in your browser, the code typed there
        if (v.m365Busy) return;
        if ((v.m365Form && v.m365Form.editing) || !(v.m365 && v.m365.configured)) { if (!(await saveForm())) return; }
        const r = await M.graphSignIn();
        if (!(r.ok && r.body && r.body.ok)) { const msg = (r.body && r.body.error) || 'Could not start the sign-in.'; v.m365 = Object.assign({}, v.m365, { error: msg }); bus.toast(msg, 'error'); return; }
        v.m365 = Object.assign({}, v.m365, { pending: true, userCode: r.body.userCode, verificationUri: r.body.verificationUri, error: '' });
        for (let i = 0; i < 60; i++) {
          await sleep(3000);
          const s = await M.graphStatus();
          if (s.ok && s.body) {
            v.m365 = Object.assign({}, blank, s.body);
            if (s.body.signedIn || s.body.error || !s.body.pending) break;
          }
        }
        if (v.m365.signedIn) { signedInSay(); changed(); } else if (v.m365.error) bus.toast(v.m365.error, 'error');
        return;
      }
      if (act === 'recheck') {
        const s = (await M.graphPoll()) || (await M.graphStatus());
        if (s.ok && s.body) v.m365 = Object.assign({}, blank, s.body);
        if (v.m365.signedIn) { signedInSay(); changed(); } else bus.toast(v.m365.error || 'Not signed in yet: finish on the Microsoft page, then check again.', 'error');
        return;
      }
      if (act === 'copyCode') {
        let ok = false;
        try { await navigator.clipboard.writeText((v.m365 && v.m365.userCode) || ''); ok = true; } catch (e) { ok = false; }
        bus.toast(ok ? 'Code copied: paste it on the Microsoft page.' : 'Could not copy: type the code from here.', ok ? 'info' : 'error');
        return;
      }
      if (act === 'check') {
        v.m365Busy = true;
        try { await read(true); } finally { v.m365Busy = false; }
        const m = v.m365 || {};
        bus.toast(m.signedIn ? 'Microsoft 365 answers: connected' + (m.account ? ' as ' + m.account : '') + '.' : m.expired ? 'Your Microsoft 365 sign-in has expired: connect again.' : (m.error || 'Not connected to Microsoft 365.'), m.signedIn ? 'success' : 'error');
        changed();
        return;
      }
      if (act === 'test') {
        v.m365Busy = true;
        try {
          const r = await M.graphTest();
          if (r.ok && r.body && r.body.ok) bus.toast('Test email sent to ' + (r.body.to || v.m365.account || 'you') + ': check your inbox.', 'success');
          else { bus.toast((r.body && r.body.error) || 'Could not send the test email.', 'error'); await read(false); }
        } finally { v.m365Busy = false; }
        return;
      }
      if (act === 'directory') {
        // the whole company in the suggestions: needs User.ReadBasic.All, approved by an admin; asked for at the next sign-in
        const on = value === true || value === 'true';
        const r = await M.graphConfig({ directory: on });
        if (r.ok && r.body && r.body.status) v.m365 = Object.assign({}, blank, r.body.status);
        v.m365Form = Object.assign({}, v.m365Form, { directory: on });
        bus.toast(on ? 'The company directory will be searched once you connect again (an admin must approve User.ReadBasic.All for the app).' : 'The company directory is no longer searched.', 'info');
        changed();
        return;
      }
      if (act === 'signout') {
        let yes = true;
        try { yes = window.confirm('Disconnect Microsoft 365 on this PC? Recipient suggestions then come from Outlook on this PC, and Send via Microsoft 365 is hidden.'); } catch (e) { /* no DOM */ }
        if (!yes) return;
        const r = await M.graphSignOut();
        if (r.ok && r.body && r.body.status) v.m365 = Object.assign({}, blank, r.body.status); else await read(false);
        bus.toast('Disconnected from Microsoft 365.', 'info');
        changed();
      }
    }
  }

  return m365Chain;
});
