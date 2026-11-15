define(['vb/action/actionChain', 'vb/action/actions', 'resources/js/vbsClient', 'resources/js/shellBus'], (ActionChain, Actions, VC, bus) => {
  'use strict';

  // Setup → Organizations & projects opened (or Refresh): the organizations and projects kept on this PC.
  class loadChain extends ActionChain {
    async run(context) {
      const v = context.$page.variables;
      // a project's tab added a repository or read its workspaces: this list read again
      bus.on('vbs-changed', 'projects', async () => {
        const s = await VC.state();
        if (s.ok) { v.orgs = s.body.orgs || []; v.projects = s.body.projects || []; }
        const d = await VC.discovered();
        if (d.ok) v.found = d.body;
      });
      const r = await VC.state();
      v.checked = true;
      if (!r.ok) { v.available = !/desktop app|Not in a browser|did not answer/.test(String((r.body && r.body.error) || '')) ? true : false; if (v.available) v.result = { ok: false, text: (r.body && r.body.error) || 'Could not read them.' }; return; }
      v.available = true;
      v.orgs = r.body.orgs || [];
      v.projects = r.body.projects || [];
      if (!v.orgs.some((o) => o.id === v.selOrg)) v.selOrg = v.orgs.length ? v.orgs[0].id : '';
      if (!v.orgs.length) v.formOrg = true;
      const f = await VC.discovered();
      if (f.ok) {
        v.found = f.body;
        // the filter kept while its organization is still there
        if (v.fOrg && !(f.body.orgs || []).some((o) => o.host + '/' + o.org === v.fOrg) && !v.orgs.some((o) => o.host + '/' + o.org === v.fOrg)) v.fOrg = '';
      }
      // opened to sign in to an organization (the set-up wizard's Sign in): its form, filled, the password to type
      const handed = typeof bus.takeFocus === 'function' ? bus.takeFocus('projects') : null;
      if (handed && handed.signIn) {
        const s = handed.signIn;
        const saved = (v.orgs || []).filter((o) => o.id === s.orgId)[0];
        if (saved) v.selOrg = saved.id;
        await Actions.callChain(context, { chain: 'actChain', params: saved ? { act: 'editOrg', key: saved.id } : { act: 'setupOrg', key: s.url } });
        setTimeout(() => { try { const el = document.getElementById(saved && saved.user ? 'vbsOPass' : 'vbsOUser'); if (el) { el.scrollIntoView({ block: 'center' }); el.focus(); } } catch (e) { /* not drawn */ } }, 120);
        bus.toast(saved ? 'Type your VB Studio password for ' + saved.name + ', then Save.' : 'Fill in your VB Studio sign-in for this organization, then Save.', 'info');
      }
    }
  }
  return loadChain;
});
