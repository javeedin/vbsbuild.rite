define(['vb/action/actionChain', 'vb/action/actions'], (ActionChain, Actions) => {
  'use strict';

  // Escape or a click outside: close whichever popup is open.
  class dismissChain extends ActionChain {
    async run(context) {
      const v = context.$page.variables;
      v.profileOpen = false;
      v.m365Open = false;
      v.tabMenuOpen = false;
      v.showResults = false;
      v.navOpen = false;
      if (v.jiraOpen) await Actions.callChain(context, { chain: 'jiraFeedChain', params: { act: 'close', key: '' } });
    }
  }

  return dismissChain;
});
