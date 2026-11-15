define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/tabs',
  'resources/js/shellTabs',
  'resources/js/nav',
  'resources/js/shellBus',
], (ActionChain, Actions, tabs, shellTabs, nav, bus) => {
  'use strict';

  // Opening Build.Rite: your workspace in the top bar, the tabs kept from last time (or Issues), plus a deep link
  // (?open=…), and the menu as it was left (full or icons). A kept tab of a screen Build.Rite no longer has is left out.
  class shellEnterChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      try { $page.variables.navCollapsed = localStorage.getItem('buildrite.nav') === 'rail'; } catch (e) { /* private mode */ }
      try { if (bus.scope()) bus.setScope(''); } catch (e) { /* no scope kept */ }
      Actions.callChain(context, { chain: 'workChain', params: { act: 'load' } }).catch(() => {});
      let saved = null;
      try { saved = localStorage.getItem(tabs.STORE_KEY); } catch (e) { saved = null; }
      let state = tabs.restore(saved);
      // VB moves ?open=… into the page's fromUrl inputs before this runs (and drops it from the address).
      const pv = $page.variables;
      const q = new URLSearchParams();
      if (pv.open) q.set('open', pv.open);
      if (pv.id) q.set('id', pv.id);
      if (pv.number) q.set('number', pv.number);
      const link = tabs.fromQuery('?' + q.toString() || window.location.search);
      if (link) state = tabs.open(state, link);
      let keep = state.tabs.filter((t) => !!nav.item(t.navId));
      if (!keep.length) {
        const first = tabs.forItem(nav.product.home);
        keep = first ? [first] : [];
      }
      const current = keep.some((t) => t.id === state.current) ? state.current : (keep[0] ? keep[0].id : '');
      // Anything opened in the meantime (a click while it loaded) stays, after the restored tabs.
      await shellTabs.update(context, Actions, (now) => ({
        tabs: keep.concat(now.tabs.filter((t) => !keep.some((k) => k.id === t.id))),
        current: now.current && now.tabs.some((t) => t.id === now.current) ? now.current : current,
      }));
      $page.variables.shellReady = true;
    }
  }

  return shellEnterChain;
});
